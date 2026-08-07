/* 말씀의 여정 - Service Worker */
const CACHE = "btr-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./badge-96.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 네트워크 우선, 실패 시 캐시 (앱 업데이트 반영 + 오프라인 지원)
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // 낭독 MP3는 용량이 커서 캐시하지 않음 (스트리밍 재생)
        if (!e.request.url.includes(".mp3")) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});

/* ---------- 상태 저장 (IndexedDB) ---------- */
function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("btr-db", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readonly");
    const rq = tx.objectStore("kv").get(key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

// 페이지에서 오늘 진행 상태 수신
self.addEventListener("message", e => {
  if (e.data && e.data.type === "STATE") {
    idbSet("state", e.data);
  }
});

/* ---------- 주기적 백그라운드 알림 체크 ----------
   Chrome(Android)에서 PWA 설치 + 사이트 사용 빈도가 높으면
   periodicsync가 주기적으로 실행됨 */
async function checkAndNotify() {
  const state = await idbGet("state").catch(() => null);
  if (!state) return;

  const now = new Date();
  const todayKey = now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");

  // 저장된 상태가 오늘 것이고, 미완료이며, 알림 시간대(설정시각~23시)일 때만
  if (state.todayKey !== todayKey) return;
  if (state.done) return;

  const hour = now.getHours() + now.getMinutes() / 60;
  const hours = (Array.isArray(state.reminderHours) && state.reminderHours.length)
    ? state.reminderHours : [state.reminderHour || 21];
  // 선택한 시간 중 하나라도 지났으면 알림 (자정에 todayKey가 바뀌며 초기화)
  if (!hours.some(h => hour >= h)) return;

  await self.registration.showNotification("📖 오늘 말씀, 아직 남았어요", {
    body: `오늘 분량 ${state.left}장이 남았습니다 · ${state.range}`,
    icon: "icon-192.png",
    badge: "badge-96.png",
    tag: "btr-reminder",
    renotify: true,
    vibrate: [100, 50, 100],
    requireInteraction: true
  });
}

self.addEventListener("periodicsync", e => {
  if (e.tag === "btr-reminder") e.waitUntil(checkAndNotify());
});

// 알림 클릭 → 앱 열기
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return clients.openWindow("./index.html");
    })
  );
});

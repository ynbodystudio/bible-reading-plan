// 서비스 워커: 앱 파일을 폰에 보관해서, 인터넷이 없어도 앱이 열리게 합니다.
// 인터넷이 되면 항상 새 파일을 먼저 받아오고(업데이트 바로 반영), 안 되면 보관본을 씁니다.

var CACHE = 'brp-v3';
var NOTIFY_CACHE = 'brp-notify'; // 앱이 적어둔 "날짜별 알림 문구" (지우지 않음)
var FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/bible-data.js',
  'js/planner.js',
  'js/progress.js',
  'js/app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(FILES); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== NOTIFY_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// ---------- 알림 ----------
// 서버는 { kind: 'morning' | 'evening' | 'test', date } 만 보내고,
// 문구(오늘 읽을 곳)는 앱이 미리 적어둔 내용에서 찾아 씁니다.

var DEFAULT_TEXT = {
  morning: { title: '성경 묵상할 시간이에요 🍇', body: '오늘 읽을 곳을 확인해 보세요.' },
  evening: { title: '오늘 하나님 말씀에 귀 기울였나요?', body: '어디까지 읽었는지 체크해 주세요.' },
  test: { title: '알림이 잘 도착했어요 🍇', body: '정한 시간에 맞춰 알려드릴게요.' }
};

self.addEventListener('push', function (event) {
  var msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch (e) {}
  var kind = DEFAULT_TEXT[msg.kind] ? msg.kind : 'morning';

  event.waitUntil(
    caches.open(NOTIFY_CACHE)
      .then(function (cache) { return cache.match(new URL('notify-data', self.registration.scope).href); })
      .then(function (res) { return res ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var day = data && data.days && data.days[msg.date];
        var text = (day && day[kind]) || DEFAULT_TEXT[kind];
        return self.registration.showNotification(text.title, {
          body: text.body,
          icon: 'icons/icon-192.png',
          tag: 'brp-' + kind,
          data: { url: './' }
        });
      })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  event.respondWith(
    fetch(req).then(function (res) {
      if (res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('index.html');
      });
    })
  );
});

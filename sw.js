// 서비스 워커: 앱 파일을 폰에 보관해서, 인터넷이 없어도 앱이 열리게 합니다.
// 인터넷이 되면 항상 새 파일을 먼저 받아오고(업데이트 바로 반영), 안 되면 보관본을 씁니다.

var CACHE = 'brp-v2';
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
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
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

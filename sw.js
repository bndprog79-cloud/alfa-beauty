/*
 * Service worker прайса Alfa Beauty-Lab (работает только на сайте, не при открытии файлом).
 *
 * Страница (index.html) — «сначала сеть с таймаутом»: если сеть ответила за 3 секунды,
 * показываем свежую версию и обновляем кэш; если сети нет или она не успела — сохранённую копию.
 * Так после изменения цен клиент с интернетом сразу видит новые цены, а без интернета прайс всё равно открывается.
 * Manifest и иконки — «сначала кэш».
 *
 * CACHE_VERSION проставляет tools/pwa/build-pwa.js (хеш файлов сайта) — вручную не менять.
 * Новая версия → браузер ставит новый service worker, старый кэш удаляется.
 */
'use strict';

const CACHE_VERSION = '889e04035a';
const CACHE_PREFIX = 'alfa-beauty-';
const CACHE = CACHE_PREFIX + CACHE_VERSION;
const PAGE = './';
const PAGE_FILE = './index.html';
const ASSETS = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];
const NET_TIMEOUT = 3000;

const scopeUrl = new URL(PAGE, self.location).href;
const pageFileUrl = new URL(PAGE_FILE, self.location).href;
const assetUrls = ASSETS.map(function (a) { return new URL(a, self.location).href; });

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // no-cache: не брать устаревшие копии из HTTP-кэша браузера
      const files = [PAGE, PAGE_FILE].concat(ASSETS);
      return cache.addAll(files.map(function (f) { return new Request(f, { cache: 'no-cache' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // wa.me, 2ГИС, Instagram — без service worker

  const path = url.origin + url.pathname;
  if (req.mode === 'navigate' || path === scopeUrl || path === pageFileUrl) {
    event.respondWith(pageResponse(event, req));
  } else if (assetUrls.indexOf(path) !== -1) {
    event.respondWith(assetResponse(req));
  }
});

// Ответ после перенаправления нельзя отдавать на переход по странице (Safari) — копируем без него
function clean(res) {
  if (!res.redirected) return Promise.resolve(res);
  return res.blob().then(function (body) {
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (res) {
    return res || caches.match(PAGE);
  });
}

function pageResponse(event, req) {
  const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then(function (res) {
      if (!res.ok) return null;
      return clean(res).then(function (fresh) {
        const copy = fresh.clone();
        // Обновить кэш, даже если сеть ответила позже таймаута
        event.waitUntil(caches.open(CACHE).then(function (cache) {
          return Promise.all([cache.put(PAGE, copy.clone()), cache.put(PAGE_FILE, copy)]);
        }));
        return fresh;
      });
    })
    .catch(function () { return null; });
  event.waitUntil(net);

  const timeout = new Promise(function (resolve) { setTimeout(resolve, NET_TIMEOUT, null); });
  return Promise.race([net, timeout])
    .then(function (res) { return res || fromCache(req); })
    // В кэше пусто (самое первое открытие) — ждём сеть сколько потребуется
    .then(function (res) { return res || net; })
    .then(function (res) { return res || fetch(req); });
}

function assetResponse(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (res) {
    if (res) return res;
    return fetch(req).then(function (fresh) {
      if (fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE).then(function (cache) { return cache.put(req, copy); });
      }
      return fresh;
    });
  });
}

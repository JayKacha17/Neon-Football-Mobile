// Service Worker for 100% Offline Caching
const CACHE_NAME = 'neon-football-v2';
const ASSETS_TO_CACHE = [
    '/mobile/',
    '/mobile/index.html',
    '/mobile/mobile.css',
    '/mobile/mobile.js',
    '/libs/three.min.js',
    '/libs/matter.min.js',
    '/libs/qrcode.min.js',
    '/manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Only cache GET requests for static assets
    if (e.request.method !== 'GET') return;
    if (e.request.url.includes('/socket.io/')) return; // Don't intercept live sockets

    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return fetch(e.request).catch(() => {
                // Offline fallback if trying to access root
                if (e.request.mode === 'navigate') {
                    return caches.match('/mobile/index.html');
                }
            });
        })
    );
});

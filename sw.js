// Wolf service worker: network-first for the app shell so a pushed update reaches the
// phone on the next open, with the cache as the offline fallback. Artwork and fonts
// are immutable per version and come from cache first.
const VERSION = "wolf-v7";
const STAGES = [];
for (const k of ["wolf", "brain"]) for (let i = 1; i <= 10; i++) { const n = String(i).padStart(2, "0"); STAGES.push(`./img/${k}/${n}.webp`); }
const SHELL = [
  "./", "./index.html", "./styles.css", "./config.js", "./app.js", "./manifest.webmanifest",
  "./fonts/fraunces-normal.woff2", "./fonts/archivo-normal.woff2",
  "./img/icon-180.png", "./img/icon-512.png",
  "./img/bg/01.webp", "./img/bg/02.webp", "./img/bg/03.webp", "./img/bg/04.webp",
  ...STAGES
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) =>
      Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache the GitHub API; those are live reads and writes.
  if (url.hostname === "api.github.com") return;
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  const immutable = /\/(fonts|img)\//.test(url.pathname);
  const put = (res) => { if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return res; };
  if (immutable) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then(put)));
    return;
  }
  e.respondWith(
    Promise.race([
      fetch(e.request).then(put),
      new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 2500))
    ]).catch(() => caches.match(e.request).then((hit) => hit || fetch(e.request)))
  );
});

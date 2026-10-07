// Bump this version whenever the production shell, worker, or bundled samples change.
const CACHE_NAME = "muse-offline-v6";
const CACHE_PREFIX = "muse-offline-";
const BASE_URL = self.registration.scope;
const BASE_PATH = new URL(BASE_URL).pathname;
const baseUrl = (path) => new URL(path.replace(/^\/+/, ""), BASE_URL).href;
const MANIFEST_URL = baseUrl("samples/manifest.json");
let developmentSession = false;

const isDevelopmentHtml = (html) =>
  /(?:\/@vite\/client|src=["']\/src\/)/.test(html);
const isDevelopmentUrl = (url) =>
  /^\/(?:@vite|@id|@fs|src|node_modules)(?:\/|$)/.test(
    url.pathname.startsWith(BASE_PATH)
      ? `/${url.pathname.slice(BASE_PATH.length)}`
      : url.pathname,
  );

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await fetch(baseUrl("index.html"), { cache: "no-store" });
      if (!shell.ok)
        throw new Error("The application shell could not be downloaded.");
      const html = await shell.clone().text();
      // Never install a development shell or intercept Vite's development requests.
      if (isDevelopmentHtml(html))
        throw new Error("Offline caching is production-only.");

      const assetResponse = await fetch(baseUrl("asset-manifest.json"), {
        cache: "no-store",
      });
      if (!assetResponse.ok)
        throw new Error(
          "The production asset manifest could not be downloaded.",
        );
      const assets = new Set(
        [
          "sparkle-logo.png",
          "favicon.ico",
          "favicon-32x32.png",
          "favicon-16x16.png",
          "apple-touch-icon.png",
        ].map((path) => baseUrl(path)),
      );
      for (const entry of Object.values(await assetResponse.json())) {
        for (const path of [
          entry.file,
          ...(entry.css || []),
          ...(entry.assets || []),
        ]) {
          const url = new URL(path, BASE_URL);
          if (
            url.origin !== self.location.origin ||
            !url.pathname.startsWith(`${BASE_PATH}assets/`)
          )
            throw new Error("Build assets must be bundled locally.");
          assets.add(url.href);
        }
      }

      const manifestResponse = await fetch(MANIFEST_URL, { cache: "no-store" });
      const hasManifest = manifestResponse.headers
        .get("content-type")
        ?.includes("application/json");
      let samples = [];
      if (manifestResponse.ok && hasManifest) {
        samples = await manifestResponse.clone().json();
        if (!Array.isArray(samples))
          throw new Error("The sample manifest must be an array.");
        for (const sample of samples) {
          const url = new URL(sample.file, BASE_URL);
          if (
            url.origin !== self.location.origin ||
            !url.pathname.startsWith(`${BASE_PATH}samples/`)
          ) {
            throw new Error("Sample assets must be bundled on the same origin.");
          }
          assets.add(url.href);
        }
      } else if (!manifestResponse.ok && manifestResponse.status !== 404) {
        throw new Error("The sample manifest could not be downloaded.");
      }

      const cache = await caches.open(CACHE_NAME);
      // addAll rejects installation if any required asset fails; old caches remain usable.
      await cache.addAll([...assets]);
      await cache.put(baseUrl(""), shell.clone());
      await cache.put(baseUrl("index.html"), shell);
      if (hasManifest) await cache.put(MANIFEST_URL, manifestResponse);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Only discard this application's older caches after the entire new cache installed.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname === `${BASE_PATH}sw.js` ||
    isDevelopmentUrl(url) ||
    developmentSession
  )
    return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      if (request.mode === "navigate") {
        try {
          const response = await fetch(request);
          if (
            response.ok &&
            (response.headers.get("content-type") || "").includes("text/html")
          ) {
            const html = await response.clone().text();
            if (isDevelopmentHtml(html)) {
              developmentSession = true;
            } else {
              event.waitUntil(
                Promise.all([
                  cache.put(baseUrl("index.html"), response.clone()),
                  cache.put(baseUrl(""), response.clone()),
                ]),
              );
            }
          }
          return response;
        } catch (error) {
          const fallback = await cache.match(baseUrl("index.html"));
          if (fallback) return fallback;
          throw error;
        }
      }

      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        event.waitUntil(cache.put(request, response.clone()));
      }
      return response;
    })(),
  );
});

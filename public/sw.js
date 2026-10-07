// Bump this version whenever the production shell, worker, or bundled samples change.
const CACHE_NAME = "muse-offline-v5";
const CACHE_PREFIX = "muse-offline-";
const MANIFEST_URL = "/samples/manifest.json";
let developmentSession = false;

const isDevelopmentHtml = (html) =>
  /(?:\/@vite\/client|src=["']\/src\/)/.test(html);
const isDevelopmentUrl = (url) =>
  /^\/(?:@vite|@id|@fs|src|node_modules)(?:\/|$)/.test(url.pathname);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await fetch("/index.html", { cache: "no-store" });
      if (!shell.ok)
        throw new Error("The application shell could not be downloaded.");
      const html = await shell.clone().text();
      // Never install a development shell or intercept Vite's development requests.
      if (isDevelopmentHtml(html))
        throw new Error("Offline caching is production-only.");

      const assetResponse = await fetch("/asset-manifest.json", {
        cache: "no-store",
      });
      if (!assetResponse.ok)
        throw new Error(
          "The production asset manifest could not be downloaded.",
        );
      const assets = new Set(
        [
          "/sparkle-logo.png",
          "/favicon.ico",
          "/favicon-32x32.png",
          "/favicon-16x16.png",
          "/apple-touch-icon.png",
        ].map((path) => new URL(path, self.location.origin).href),
      );
      for (const entry of Object.values(await assetResponse.json())) {
        for (const path of [
          entry.file,
          ...(entry.css || []),
          ...(entry.assets || []),
        ]) {
          const url = new URL(path, self.location.origin + "/");
          if (
            url.origin !== self.location.origin ||
            !url.pathname.startsWith("/assets/")
          )
            throw new Error("Build assets must be bundled locally.");
          assets.add(url.href);
        }
      }

      const manifestResponse = await fetch(MANIFEST_URL, { cache: "no-store" });
      if (!manifestResponse.ok)
        throw new Error("The sample manifest could not be downloaded.");
      const samples = await manifestResponse.clone().json();
      if (!Array.isArray(samples))
        throw new Error("The sample manifest must be an array.");
      for (const sample of samples) {
        const url = new URL(sample.file, self.location.origin);
        if (
          url.origin !== self.location.origin ||
          !url.pathname.startsWith("/samples/")
        ) {
          throw new Error("Sample assets must be bundled on the same origin.");
        }
        assets.add(url.href);
      }

      const cache = await caches.open(CACHE_NAME);
      // addAll rejects installation if any required asset fails; old caches remain usable.
      await cache.addAll([...assets]);
      await cache.put("/", shell.clone());
      await cache.put("/index.html", shell);
      await cache.put(MANIFEST_URL, manifestResponse);
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
    url.pathname === "/sw.js" ||
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
                  cache.put("/index.html", response.clone()),
                  cache.put("/", response.clone()),
                ]),
              );
            }
          }
          return response;
        } catch (error) {
          const fallback = await cache.match("/index.html");
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

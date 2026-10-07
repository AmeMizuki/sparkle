import { db } from "./db.js";

export function lazyImage(node, options) {
  let cleanup;
  function start({ id, original = false, onError }) {
    let disposed = false;
    let url;
    node.removeAttribute("src");
    const observer = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      try {
        const record = await db.imageBlobs.get(id);
        if (disposed) return;
        const blob = original ? record?.blob : record?.thumbnail || record?.blob;
        if (!(blob instanceof Blob)) throw new Error("Image data not found");
        url = URL.createObjectURL(blob);
        node.src = url;
      } catch (error) {
        if (!disposed) onError?.(error);
      }
    });
    observer.observe(node);
    cleanup = () => {
      disposed = true;
      observer.disconnect();
      node.removeAttribute("src");
      if (url) URL.revokeObjectURL(url);
    };
  }
  start(options);
  return {
    update(next) {
      if (next.id === options.id && next.original === options.original) return;
      cleanup();
      options = next;
      start(next);
    },
    destroy() { cleanup(); },
  };
}

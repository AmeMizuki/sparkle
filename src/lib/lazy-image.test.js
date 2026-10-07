import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.js";
import { lazyImage } from "./lazy-image.js";

test("lazy images wait for visibility and release URLs, including pending reads on unmount", async (t) => {
  let observer;
  t.mock.method(db.imageBlobs, "get", async () => ({ blob: new Blob(["image"]), thumbnail: new Blob(["preview"]) }));
  const previous = globalThis.IntersectionObserver;
  t.after(() => {
    if (previous) globalThis.IntersectionObserver = previous;
    else delete globalThis.IntersectionObserver;
  });
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() {}
  };
  const node = { removeAttribute() { delete this.src; } };
  const action = lazyImage(node, { id: "one" });
  await observer.callback([{ isIntersecting: false }]);
  assert.equal(db.imageBlobs.get.mock.callCount(), 0);
  await observer.callback([{ isIntersecting: true }]);
  const url = node.src;
  assert.equal(await (await fetch(url)).text(), "preview");
  action.update({ id: "one", original: true });
  await assert.rejects(fetch(url));
  await observer.callback([{ isIntersecting: true }]);
  const original = node.src;
  assert.equal(await (await fetch(original)).text(), "image");
  action.destroy();
  await assert.rejects(fetch(original));

  let finish;
  db.imageBlobs.get.mock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const pending = lazyImage(node, { id: "two" });
  const reading = observer.callback([{ isIntersecting: true }]);
  pending.destroy();
  finish({ blob: new Blob(["late image"]) });
  await reading;
  assert.equal(node.src, undefined);
});

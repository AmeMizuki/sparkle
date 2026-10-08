import Dexie from "dexie";

export const db = new Dexie("muse-library");
db.version(1).stores({
  images: "&id,date,source,favorite,*collectionIds",
  collections: "&id,name",
  settings: "&key",
});

db.version(2).stores({
  images: "&id,date,importedAt,source,*collectionIds",
  imageBlobs: "&id",
}).upgrade(async (tx) => {
  const images = tx.table("images");
  for (const id of await images.toCollection().primaryKeys()) {
    const { blob, thumbnail, ...metadata } = await images.get(id);
    await tx.table("imageBlobs").add({ id, blob, thumbnail });
    await images.put({ ...metadata, storedType: blob.type });
  }
});

export function createId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function addImage({ blob, thumbnail, ...metadata }) {
  await db.transaction("rw", db.images, db.imageBlobs, async () => {
    await db.images.add({ ...metadata, storedType: blob.type });
    await db.imageBlobs.add({ id: metadata.id, blob, thumbnail });
  });
}

export function isQuotaError(error) {
  const pending = [error];
  const seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    if (current.name === "QuotaExceededError") return true;
    seen.add(current);
    pending.push(current.inner, current.cause);
    if (Array.isArray(current.failures))
      for (const failure of current.failures) pending.push(failure);
    else if (current.failuresByPos && typeof current.failuresByPos === "object")
      for (const failure of Object.values(current.failuresByPos)) pending.push(failure);
  }
  return false;
}

export async function deleteImages(ids) {
  await db.transaction("rw", db.images, db.imageBlobs, async () => {
    await db.images.bulkDelete(ids);
    await db.imageBlobs.bulkDelete(ids);
  });
}

export async function deleteAllImages(code, input) {
  if (typeof code !== "string" || !/^[A-Z0-9]{6}$/.test(code) || input !== code)
    throw new RangeError("Confirmation code does not match");
  await db.transaction("rw", db.images, db.imageBlobs, async () => {
    await db.images.clear();
    await db.imageBlobs.clear();
  });
}

export const loadImages = () => db.images.orderBy("date").reverse().toArray();

async function decodeImage(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function canCompressImage(blob) {
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
    return true;
  const text = new TextDecoder();
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (byte, index) => header[index] === byte,
  );
  const webp =
    text.decode(header.subarray(0, 4)) === "RIFF" &&
    text.decode(header.subarray(8, 12)) === "WEBP";
  if (!png && !webp) {
    if (typeof ImageDecoder === "undefined") return false;
    const signature = text.decode(header);
    const type = /^GIF8[79]a/.test(signature) ? "image/gif"
      : signature.slice(4, 8) === "ftyp" && ["avif", "avis"].includes(signature.slice(8, 12))
        ? "image/avif" : blob.type;
    let decoder;
    try {
      if (!type || !(await ImageDecoder.isTypeSupported(type))) return false;
      const data = await blob.arrayBuffer();
      decoder = new ImageDecoder({ data, type, preferAnimation: true, transfer: [data] });
      await decoder.tracks.ready;
      await decoder.completed;
      return decoder.tracks.selectedTrack?.frameCount === 1;
    } catch {
      return false;
    } finally {
      decoder?.close();
    }
  }
  const end = png ? blob.size : new DataView(header.buffer).getUint32(4, true) + 8;
  if (end > blob.size || end < (png ? 8 : 12)) return false;
  let offset = png ? 8 : 12;
  let hasPixels = false;
  while (offset + (png ? 12 : 8) <= end) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
    const length = new DataView(bytes.buffer).getUint32(png ? 0 : 4, !png);
    const type = text.decode(bytes.subarray(png ? 4 : 0, png ? 8 : 4));
    const next = offset + length + (png ? 12 : 8) + (png ? 0 : length % 2);
    if (next > end) return false;
    if (["acTL", "fcTL", "fdAT", "ANIM", "ANMF"].includes(type)) return false;
    if (webp && type === "VP8X") {
      if (length !== 10) return false;
      const flags = new Uint8Array(await blob.slice(offset + 8, offset + 9).arrayBuffer());
      if (flags[0] & 0x02) return false;
    }
    if (["IDAT", "VP8 ", "VP8L"].includes(type)) hasPixels = true;
    if (png && type === "IEND") return length === 0 && hasPixels;
    offset = next;
  }
  return webp && offset === end && hasPixels;
}

function encodeCanvas(canvas, type = "image/webp") {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Could not encode image")),
      type,
      0.86,
    );
  });
}

async function imageData(blob, compress = false) {
  if (compress && !(await canCompressImage(blob)))
    throw new Error("This image format may be animated or is unsupported for conversion. Use original mode to import it.");
  let image;
  try {
    image = await decodeImage(blob);
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height) throw new Error("Image has no decodable dimensions");
    const ratio = Math.min(1, 500 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot create thumbnail canvas");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const thumbnail = await encodeCanvas(canvas).catch(() =>
      encodeCanvas(canvas, "image/png").catch(() => blob),
    );
    if (!compress) return { width, height, thumbnail, blob };
    const storedRatio = Math.min(1, 2048 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * storedRatio));
    canvas.height = Math.max(1, Math.round(height * storedRatio));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const stored = await encodeCanvas(canvas);
    if (stored.type !== "image/webp")
      throw new Error("WebP encoding is unavailable in this browser. Use original mode to import it.");
    return {
      width: canvas.width,
      height: canvas.height,
      originalWidth: width,
      originalHeight: height,
      thumbnail,
      blob: stored,
    };
  } finally {
    image?.close?.();
  }
}

export async function importFiles(files, onProgress = () => {}, { preserveOriginal = true } = {}) {
  const batch = Array.from(files);
  let imported = 0;
  const errors = [];
  let quotaExceeded = false;
  onProgress({ done: 0, total: batch.length });
  const { extractMetadata } = await import("./metadata.js");
  for (let index = 0; index < batch.length; index++) {
    const file = batch[index];
    try {
      const metadata = await extractMetadata(file);
      const dimensions = await imageData(file, !preserveOriginal);
      const originalName = file.name || "Untitled image";
      const modified = Number.isFinite(file.lastModified)
        ? file.lastModified
        : Date.now();
      await addImage({
        id: createId(),
        name: originalName,
        ...dimensions,
        size: dimensions.blob.size,
        originalSize: file.size,
        originalName,
        originalWidth: dimensions.originalWidth ?? dimensions.width,
        originalHeight: dimensions.originalHeight ?? dimensions.height,
        downloadName: dimensions.blob === file
          ? originalName
          : `${originalName.replace(/\.[^.]+$/, "")}.webp`,
        date: new Date(modified).toISOString(),
        importedAt: new Date().toISOString(),
        ...metadata,
        favorite: false,
        collectionIds: [],
        sample: false,
      });
      imported++;
    } catch (error) {
      errors.push(
        `${file.name || "Untitled image"}: ${error?.message || "Unable to import image"}`,
      );
      if (isQuotaError(error)) quotaExceeded = true;
    }
    onProgress({ done: index + 1, total: batch.length });
    if (quotaExceeded) break;
  }
  return { imported, errors, quotaExceeded, notImported: batch.length - imported };
}

export async function seedSamples() {
  const settingKey = "samples-seeded";
  if (await db.settings.get(settingKey)) return;
  if (await db.images.count()) {
    await db.settings.put({ key: settingKey, value: true });
    return;
  }
  const samplesBase = new URL(
    "samples/",
    new URL(import.meta.env.BASE_URL, window.location.origin),
  );
  const response = await fetch(new URL("manifest.json", samplesBase));
  const hasManifest = response.headers
    .get("content-type")
    ?.includes("application/json");
  if (
    response.status === 404 ||
    (response.ok && !hasManifest)
  ) {
    await db.settings.put({ key: settingKey, value: true });
    return;
  }
  if (!response.ok)
    throw new Error("Could not load the offline sample manifest");
  const manifest = await response.json();
  const samples = Array.isArray(manifest) ? manifest : manifest.images;
  if (!Array.isArray(samples))
    throw new Error("Invalid offline sample manifest");
  const records = [];
  const localBlob = async (path) => {
    const url = new URL(path.replace(/^\/+/, ""), samplesBase);
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith(samplesBase.pathname)
    )
      throw new Error("Sample files must be bundled locally");
    const result = await fetch(url);
    if (!result.ok) throw new Error(`Could not load ${url.pathname}`);
    return result.blob();
  };
  for (const sample of samples) {
    const blob = await localBlob(sample.file || sample.url);
    const dimensions = await imageData(blob);
    const thumbnailPath = sample.thumbnailFile || sample.thumbnailUrl;
    records.push({
      id: sample.id || createId(),
      name: sample.name || (sample.file || sample.url).split("/").pop(),
      blob,
      ...dimensions,
      thumbnail: thumbnailPath
        ? await localBlob(thumbnailPath)
        : dimensions.thumbnail,
      size: blob.size,
      originalSize: blob.size,
      originalName: (sample.file || sample.url).split("/").pop(),
      downloadName: (sample.file || sample.url).split("/").pop(),
      date: sample.date || new Date().toISOString(),
      importedAt: new Date().toISOString(),
      source: sample.source || "Illustrative sample",
      positive: sample.positive || "",
      negative: sample.negative || "",
      parameters: sample.parameters || {},
      raw: { ...sample.raw, illustrative: true },
      favorite: Boolean(sample.favorite),
      collectionIds: sample.collectionIds || [],
      sample: true,
      warnings: [],
    });
  }
  await db.transaction(
    "rw",
    db.images,
    db.imageBlobs,
    db.collections,
    db.settings,
    async () => {
      // Recheck after fetching: a concurrent import/tab must never be overwritten or reseeded.
      if (await db.settings.get(settingKey)) return;
      if (!(await db.images.count())) {
        for (const record of records) await addImage(record);
        await db.collections.bulkPut([
          { id: "landscape", name: "Landscape studies" },
          { id: "artists", name: "Artist blends" },
          { id: "worlds", name: "Little worlds" },
        ]);
      }
      await db.settings.put({ key: settingKey, value: true });
    },
  );
}

import Dexie from "dexie";

export const db = new Dexie("muse-library");
db.version(1).stores({
  images: "&id,date,source,favorite,*collectionIds",
  collections: "&id,name",
  settings: "&key",
});

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
  // ponytail: only known static formats; GIF/AVIF stay intact without a frame decoder.
  if (!png && !webp) return false;
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
    let stored = blob;
    if (compress && thumbnail !== blob) {
      try {
        if (await canCompressImage(blob)) {
          canvas.width = width;
          canvas.height = height;
          context.drawImage(image, 0, 0, width, height);
          const encoded = await encodeCanvas(canvas);
          if (encoded.type === "image/webp" && encoded.size < blob.size)
            stored = encoded;
        }
      } catch {
        // Encoder/canvas limits must not prevent importing the original.
      }
    }
    return { width, height, thumbnail, blob: stored };
  } finally {
    image?.close?.();
  }
}

export async function importFiles(files, onProgress = () => {}) {
  const batch = Array.from(files);
  let imported = 0;
  const errors = [];
  onProgress({ done: 0, total: batch.length });
  const { extractMetadata } = await import("./metadata.js");
  for (let index = 0; index < batch.length; index++) {
    const file = batch[index];
    try {
      const metadata = await extractMetadata(file);
      const dimensions = await imageData(file, true);
      const originalName = file.name || "Untitled image";
      const modified = Number.isFinite(file.lastModified)
        ? file.lastModified
        : Date.now();
      await db.images.add({
        id: crypto.randomUUID(),
        name: originalName,
        ...dimensions,
        size: dimensions.blob.size,
        originalSize: file.size,
        originalName,
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
        `${file.name || "Untitled image"}: ${error.message || "Unable to import image"}`,
      );
    }
    onProgress({ done: index + 1, total: batch.length });
  }
  return { imported, errors };
}

export async function seedSamples() {
  const settingKey = "samples-seeded";
  if (await db.settings.get(settingKey)) return;
  if (await db.images.count()) {
    await db.settings.put({ key: settingKey, value: true });
    return;
  }
  const response = await fetch("/samples/manifest.json");
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
    const url = new URL(path, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith("/samples/")
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
      id: sample.id || crypto.randomUUID(),
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
    db.collections,
    db.settings,
    async () => {
      // Recheck after fetching: a concurrent import/tab must never be overwritten or reseeded.
      if (await db.settings.get(settingKey)) return;
      if (!(await db.images.count())) {
        await db.images.bulkAdd(records);
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

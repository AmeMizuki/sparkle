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

async function imageData(blob) {
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
    const thumbnail = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Could not create thumbnail")),
        "image/webp",
        0.86,
      );
    });
    return { width, height, thumbnail };
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
      const dimensions = await imageData(file);
      const metadata = await extractMetadata(file);
      const modified = Number.isFinite(file.lastModified)
        ? file.lastModified
        : Date.now();
      await db.images.add({
        id: crypto.randomUUID(),
        name: file.name || "Untitled image",
        blob: file,
        ...dimensions,
        size: file.size,
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
  if (!response.ok) {
    if (response.status === 404) {
      await db.settings.put({ key: settingKey, value: true });
      return;
    }
    throw new Error("Could not load the offline sample manifest");
  }
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
      date: sample.date || new Date().toISOString(),
      importedAt: new Date().toISOString(),
      source: sample.source || "Illustrative sample",
      artist: sample.artist || "",
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

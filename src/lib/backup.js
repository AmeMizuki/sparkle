import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import { createId, db } from "./db.js";

const MAX_BYTES = 200_000_000;
const READ_BYTES = 1_048_576;
const encoder = new TextEncoder();
const instructions = strToU8(`PROMPT SAVER OFFLINE RECOVERY (format 1)
Keep every ZIP in this backup together. Each ZIP opens independently in a normal unzip tool.
Extract each ZIP into its own directory: manifest.json and RECOVERY.txt repeat in every part.
Never mix backupId values. Part numbers start at 1. The final manifest has complete=true
and totalParts set; require every part from 1 through totalParts. Without it export is incomplete.
Read each manifest's entries. Group entries by file, sort by offset, and concatenate the
uncompressed entry bytes at path in that order. Require offsets to be contiguous starting at
0 and the resulting byte length to equal size. Chunk boundaries may split UTF-8 characters:
decode JSON only AFTER concatenation. ZIP tools verify CRCs; reject missing/corrupt entries.
images/NNNNNNNN/record.json contains the unchanged image record, extra imageBlobs record
fields, and blob/thumbnail descriptors (file, size, MIME type, stored name and lastModified).
Use these descriptors to recover the exact stored images and thumbnails; names in metadata
are user-provided, so sanitize them before saving to disk. Original compressed-away bytes
cannot be recovered: this backup preserves exactly the bytes currently stored in the library.
collections/NNNNNNNN.json and settings/NNNNNNNN.json are unchanged database records.
preferences.json contains the supplied application preferences. Manifest counts allow checking
all records are present. No server, application, or restore UI is needed to recover the files.
`);

// ASCII paths, no ZIP extras/comments: local header + descriptor + central header.
const overhead = (path) => 92 + 2 * path.length;
const number = (value) => String(value).padStart(8, "0");

function compressed(path, data) {
  const stream = new ZipDeflate(path, { level: 6 });
  const chunks = [];
  let bytes = 0;
  stream.ondata = (error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
    bytes += chunk.length;
  };
  stream.push(data, true);
  return {
    file: {
      filename: path,
      compression: stream.compression,
      flag: stream.flag,
      crc: stream.crc,
      size: stream.size,
    },
    chunks,
    bytes,
  };
}

const jsonBytes = (value) => {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("Backup contains non-JSON metadata");
  return encoder.encode(text);
};

function descriptor(file, blob, name) {
  return {
    file,
    size: blob.size,
    type: blob.type,
    name: blob.name || name,
    ...(Number.isFinite(blob.lastModified) ? { lastModified: blob.lastModified } : {}),
  };
}

async function snapshot() {
  return db.transaction("r", db.images, db.imageBlobs, db.collections, db.settings, async () => {
    const [images, imageBlobs, collections, settings] = await Promise.all([
      db.images.toArray(),
      db.imageBlobs.toArray(),
      db.collections.toArray(),
      db.settings.toArray(),
    ]);
    const blobs = new Map(imageBlobs.map((record) => [record.id, record]));
    if (images.length !== blobs.size)
      throw new Error("Cannot back up inconsistent image and blob records");
    for (const image of images) {
      const record = blobs.get(image.id);
      if (!(record?.blob instanceof Blob) || !(record.thumbnail instanceof Blob))
        throw new Error(`Cannot back up ${image.originalName || image.name || image.id}: missing image or thumbnail`);
    }
    return { images, blobs, collections, settings };
  });
}

function* sources(data, preferences) {
  for (let index = 0; index < data.images.length; index++) {
    const record = data.images[index];
    const { blob, thumbnail, ...imageBlobRecord } = data.blobs.get(record.id);
    const base = `images/${number(index + 1)}`;
    yield {
      file: `${base}/record.json`,
      json: {
        record,
        imageBlobRecord,
        blob: descriptor(`${base}/image`, blob, record.downloadName || record.originalName || record.name),
        thumbnail: descriptor(`${base}/thumbnail`, thumbnail, "thumbnail"),
      },
    };
    yield { file: `${base}/image`, blob };
    yield { file: `${base}/thumbnail`, blob: thumbnail };
  }
  for (const table of ["collections", "settings"])
    for (let index = 0; index < data[table].length; index++)
      yield { file: `${table}/${number(index + 1)}.json`, json: data[table][index] };
  yield { file: "preferences.json", json: preferences };
}

/** Export independent bounded ZIPs. onPart is awaited; failures leave earlier parts intact. */
export async function exportBackup({ preferences = {}, onPart, onProgress = () => {}, maxBytes = MAX_BYTES } = {}) {
  if (typeof onPart !== "function") throw new TypeError("Backup requires an onPart callback");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES)
    throw new RangeError(`maxBytes must be an integer between 1 and ${MAX_BYTES}`);
  const savedPreferences = structuredClone(preferences);
  const data = await snapshot();
  const createdAt = new Date().toISOString();
  const backupId = `${createdAt.replace(/[-:.]/g, "")}-${createId()}`;
  const counts = { images: data.images.length, collections: data.collections.length, settings: data.settings.length };
  const total = counts.images * 3 + counts.collections + counts.settings + 1;
  const recovery = compressed("RECOVERY.txt", instructions);
  const fixedBytes = 22 + overhead("RECOVERY.txt") + recovery.bytes + overhead("manifest.json");
  let part = 1;
  let done = 0;
  let sourceIndex = 0;
  let entries = [];
  let payloadBytes = 0;
  let output = [];
  let outputBytes = 0;
  let zip;

  function open() {
    zip = new Zip((error, chunk) => {
      if (error) throw error;
      outputBytes += chunk.length;
      if (outputBytes > maxBytes) throw new Error("Backup archive exceeded its size bound");
      output.push(chunk);
    });
  }

  function addCompressed(entry) {
    // ZipInputFile supports precompressed streams: preserve original CRC/size, replay DEFLATE bytes.
    const file = { ...entry.file };
    zip.add(file);
    entry.chunks.forEach((chunk, index) => file.ondata(null, chunk, index === entry.chunks.length - 1));
  }

  function manifest(list, complete) {
    return compressed("manifest.json", jsonBytes({
      format: "prompt-saver-backup",
      version: 1,
      backupId,
      createdAt,
      part,
      complete,
      totalParts: complete ? part : null,
      counts,
      entries: list,
    }));
  }

  function archiveSize(list, bytes) {
    // Reserve both possible endings; the final manifest is not assumed to compress smaller.
    return fixedBytes + bytes + Math.max(manifest(list, false).bytes, manifest(list, true).bytes);
  }

  async function finish(complete) {
    addCompressed(recovery);
    addCompressed(manifest(entries, complete));
    zip.end();
    const blob = new Blob(output, { type: "application/zip" });
    output = [];
    if (blob.size > maxBytes) throw new Error("Backup archive exceeded its size bound");
    await onPart({ blob, name: `prompt-saver-${backupId}-part-${number(part)}.zip` });
    part++;
    entries = [];
    payloadBytes = 0;
    outputBytes = 0;
    if (!complete) open();
  }

  open();
  onProgress({ done, total });
  for (const source of sources(data, savedPreferences)) {
    sourceIndex++;
    // Only this record's JSON is serialized; never materialize the whole library's bytes.
    const json = source.blob ? null : jsonBytes(source.json);
    const size = source.blob ? source.blob.size : json.length;
    let offset = 0;
    let chunkIndex = 0;
    do {
      // ponytail: cap entries per ZIP to bound manifest work; larger directories need incremental sizing.
      if (entries.length === 2048) await finish(false);
      const path = `payload/${number(sourceIndex)}/${number(chunkIndex + 1)}`;
      let length = source.blob
        ? Math.min(size - offset, Math.max(0, maxBytes - fixedBytes - payloadBytes - overhead(path)))
        : Math.min(size - offset, READ_BYTES);
      let encoded;
      let mapping;
      while (true) {
        encoded = json ? compressed(path, json.subarray(offset, offset + length)) : null;
        mapping = { path, file: source.file, offset, bytes: length, size, kind: json ? "json" : "blob" };
        const bytes = payloadBytes + overhead(path) + (encoded ? encoded.bytes : length);
        const overflow = archiveSize([...entries, mapping], bytes) - maxBytes;
        if ((length > 0 || size === 0) && overflow <= 0) break;
        if (source.blob && length > 0 && overflow > 0 && length > overflow) {
          length -= overflow;
          continue;
        }
        if (entries.length) {
          await finish(false);
          length = source.blob
            ? Math.min(size - offset, Math.max(0, maxBytes - fixedBytes - overhead(path)))
            : Math.min(size - offset, READ_BYTES);
        } else {
          if (length <= 1) throw new RangeError("maxBytes is too small for backup headers, manifest and recovery instructions");
          length = Math.floor(length / 2);
        }
      }
      entries.push(mapping);
      payloadBytes += overhead(path) + (encoded ? encoded.bytes : length);
      if (encoded) {
        addCompressed(encoded);
      } else {
        const file = new ZipPassThrough(path);
        zip.add(file);
        let read = 0;
        do {
          const amount = Math.min(READ_BYTES, length - read);
          const chunk = new Uint8Array(await source.blob.slice(offset + read, offset + read + amount).arrayBuffer());
          if (chunk.length !== amount) throw new Error(`Could not read complete backup data: ${source.file}`);
          read += amount;
          file.push(chunk, read === length);
        } while (read < length);
      }
      offset += length;
      chunkIndex++;
    } while (offset < size);
    onProgress({ done: ++done, total });
  }
  await finish(true);
  return { parts: part - 1 };
}

import * as exifr from "exifr";

const utf8 = new TextDecoder();
const latin1 = new TextDecoder("iso-8859-1");
const exifOptions = {
  userComment: true,
  xmp: true,
  iptc: true,
  reviveValues: false,
  silentErrors: false,
};
const MAX_TEXT = 8 * 1024 * 1024;
const object = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !ArrayBuffer.isView(value);
const key = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function store(raw, name, value) {
  if (Object.hasOwn(raw, name))
    raw[name] = Array.isArray(raw[name])
      ? [...raw[name], value]
      : [raw[name], value];
  else
    Object.defineProperty(raw, name, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
}

async function inflate(bytes) {
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_TEXT)
        throw new Error("Compressed metadata exceeds 8 MB");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function readPngMetadata(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const raw = {};
  const warnings = [];
  if (
    bytes.length < 8 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
  ) {
    throw new Error("Not a PNG file");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = utf8.decode(bytes.subarray(offset + 4, offset + 8));
    if (length > bytes.length - offset - 12) {
      warnings.push(`Truncated PNG ${type} chunk`);
      break;
    }
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    try {
      if (["tEXt", "zTXt", "iTXt"].includes(type)) {
        if (length > MAX_TEXT) throw new Error("Metadata exceeds 8 MB");
        const end = data.indexOf(0);
        if (end < 1 || end > 79) throw new Error("Invalid text keyword");
        const name = latin1.decode(data.subarray(0, end));
        let text;
        if (type === "tEXt") text = latin1.decode(data.subarray(end + 1));
        else if (type === "zTXt") {
          if (data[end + 1] !== 0)
            throw new Error("Unsupported compression method");
          text = latin1.decode(await inflate(data.subarray(end + 2)));
        } else {
          const compressed = data[end + 1];
          if (![0, 1].includes(compressed) || data[end + 2] !== 0)
            throw new Error("Invalid international text compression");
          const languageEnd = data.indexOf(0, end + 3);
          const translatedEnd =
            languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
          if (translatedEnd < 0)
            throw new Error("Invalid international text fields");
          const content = data.subarray(translatedEnd + 1);
          text = utf8.decode(compressed ? await inflate(content) : content);
        }
        store(raw, name, text);
      } else if (type === "eXIf") {
        Object.assign(raw, await exifr.parse(data, exifOptions));
      }
    } catch (error) {
      warnings.push(`${type}: ${error.message}`);
      store(raw, "unreadableChunks", { type, data: data.slice() });
    }
    offset += length + 12;
    if (type === "IEND") break;
  }
  return { raw, warnings };
}

function decodeComment(value) {
  if (typeof value === "string") return value.replace(/\0+$/g, "").trim();
  if (
    ArrayBuffer.isView(value) ||
    (Array.isArray(value) && value.every((v) => typeof v === "number"))
  ) {
    const bytes = Uint8Array.from(value);
    const prefix = utf8.decode(bytes.subarray(0, 8));
    if (prefix.startsWith("UNICODE")) {
      const text = bytes.subarray(8);
      const bigEndian =
        (text[0] === 0xfe && text[1] === 0xff) ||
        (text[0] === 0 && text[1] !== 0);
      return new TextDecoder(bigEndian ? "utf-16be" : "utf-16le")
        .decode(text)
        .replace(/\0/g, "")
        .trim();
    }
    return utf8
      .decode(
        prefix.startsWith("ASCII") || prefix.startsWith("JIS")
          ? bytes.subarray(8)
          : bytes,
      )
      .replace(/\0/g, "")
      .trim();
  }
  return "";
}

async function readWebp(bytes, warnings) {
  const raw = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = utf8.decode(bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    if (length > bytes.length - offset - 8) {
      warnings.push(`Truncated WebP ${name} chunk`);
      break;
    }
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    try {
      if (name === "EXIF") {
        const tiff =
          utf8.decode(data.subarray(0, 4)) === "Exif" ? data.subarray(6) : data;
        Object.assign(raw, await exifr.parse(tiff, exifOptions));
      } else if (name === "XMP ") {
        store(raw, "xmpPacket", utf8.decode(data));
        Object.assign(
          raw,
          await exifr.sidecar(data, { reviveValues: false }, "xmp"),
        );
      }
    } catch (error) {
      warnings.push(`${name.trim()}: ${error.message}`);
    }
    offset += 8 + length + (length % 2);
  }
  return raw;
}

function jpegComments(bytes) {
  const comments = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker === 0xfe)
      comments.push(utf8.decode(bytes.subarray(offset + 2, offset + length)));
    offset += length;
  }
  return comments;
}

function entriesDeep(value, result = [], depth = 0) {
  if (!object(value) || depth > 12) return result;
  for (const [name, content] of Object.entries(value)) {
    result.push([name, content]);
    if (
      Array.isArray(content) &&
      content.every((item) => typeof item === "string" || object(item))
    ) {
      for (const item of content) {
        result.push([name, item]);
        if (object(item)) entriesDeep(item, result, depth + 1);
      }
    }
    if (object(content)) entriesDeep(content, result, depth + 1);
  }
  return result;
}

function json(value) {
  if (object(value)) return value;
  if (typeof value !== "string" || !value.trim().startsWith("{")) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const aliases = {
  cfg: "cfg",
  cfgscale: "cfg",
  guidance: "cfg",
  guidancescale: "cfg",
  scale: "cfg",
  sampler: "sampler",
  samplername: "sampler",
  scheduler: "scheduler",
  schedule: "scheduler",
  scheduletype: "scheduler",
  noiseschedule: "scheduler",
  steps: "steps",
  step: "steps",
  seed: "seed",
  noiseseed: "seed",
  model: "model",
  modelname: "model",
  checkpoint: "model",
  ckptname: "model",
  unetname: "model",
  modelhash: "modelHash",
  upscaler: "upscaler",
  upscalemodel: "upscaler",
  hiresupscaler: "upscaler",
  refinerupscale: "upscaler",
  width: "width",
  height: "height",
  denoise: "denoise",
  denoisingstrength: "denoise",
  clipskip: "clipSkip",
};

function parametersFrom(value) {
  const parameters = {};
  for (const [name, content] of Object.entries(value || {})) {
    const canonical = aliases[key(name)];
    if (
      !canonical ||
      content === undefined ||
      content === null ||
      content === "" ||
      Array.isArray(content)
    )
      continue;
    const unwrapped = object(content)
      ? (content.name ?? content.title ?? content.filename)
      : content;
    if (unwrapped === undefined) continue;
    const number =
      typeof unwrapped === "string" && /^-?\d+(?:\.\d+)?$/.test(unwrapped)
        ? Number(unwrapped)
        : null;
    parameters[canonical] =
      number !== null &&
      Number.isFinite(number) &&
      (Number.isSafeInteger(number) || !Number.isInteger(number))
        ? number
        : unwrapped;
  }
  return parameters;
}

function splitSettings(text) {
  const pairs = {};
  const pattern =
    /(?:^|,\s*)([\w][\w ./-]*):\s*("(?:[^"\\]|\\.)*"|\[[^\]]*\]|.*?)(?=,\s*[\w][\w ./-]*:\s*|$)/g;
  for (const match of text.matchAll(pattern))
    pairs[match[1]] = match[2].replace(/^"|"$/g, "").trim();
  return pairs;
}

export function parseA1111(text) {
  const settingsStart = /(?:^|\n)\s*Steps:\s*\d+/g.exec(text);
  if (!settingsStart) return null;
  const prompt = text.slice(0, settingsStart.index).trim();
  const negativeStart = /(?:^|\n)Negative prompt:\s*/.exec(prompt);
  const fields = splitSettings(text.slice(settingsStart.index).trim());
  const parameters = {
    ...Object.fromEntries(
      Object.entries(fields).filter(
        ([name]) => !aliases[key(name)] && key(name) !== "size",
      ),
    ),
    ...parametersFrom(fields),
  };
  if (!parameters.scheduler && typeof parameters.sampler === "string") {
    parameters.scheduler = parameters.sampler.match(
      /\b(Karras|Exponential|SGM Uniform)\s*$/i,
    )?.[1];
    if (!parameters.scheduler) delete parameters.scheduler;
  }
  const size = fields.Size?.match(/^(\d+)\s*x\s*(\d+)$/);
  if (size) {
    parameters.width = Number(size[1]);
    parameters.height = Number(size[2]);
  }
  return {
    source: "Automatic1111",
    positive: (negativeStart
      ? prompt.slice(0, negativeStart.index)
      : prompt
    ).trim(),
    negative: negativeStart
      ? prompt.slice(negativeStart.index + negativeStart[0].length).trim()
      : "",
    parameters,
  };
}

function graphLink(value, graph) {
  return Array.isArray(value) &&
    value.length === 2 &&
    Object.hasOwn(graph, String(value[0]))
    ? String(value[0])
    : null;
}

export function parseComfyGraph(graph) {
  if (!object(graph)) return null;
  const nodes = Object.values(graph).filter(
    (node) => object(node) && typeof node.class_type === "string",
  );
  if (!nodes.length) return null;
  // ponytail: multiple image outputs use the nearest connected sampler; use output IDs if exporters provide them.
  const queue = Object.entries(graph)
    .filter(([, n]) =>
      /SaveImage|PreviewImage|ImageOutput/i.test(n?.class_type),
    )
    .map(([id]) => id);
  const visited = new Set();
  let sampler;
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = graph[id];
    if (
      /sampler/i.test(node?.class_type) &&
      node.inputs &&
      ("positive" in node.inputs || "guider" in node.inputs)
    ) {
      sampler = node;
      break;
    }
    for (const value of Object.values(node?.inputs || {})) {
      const link = graphLink(value, graph);
      if (link) queue.push(link);
    }
  }
  sampler ||= [...nodes]
    .reverse()
    .find(
      (n) =>
        /sampler/i.test(n.class_type) &&
        n.inputs &&
        ("positive" in n.inputs || "guider" in n.inputs),
    );
  const walk = (start, visit) => {
    const seen = new Set();
    const traverse = (id) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      const node = graph[id];
      if (!node) return;
      visit(node);
      for (const value of Object.values(node.inputs || {}))
        traverse(graphLink(value, graph));
    };
    traverse(graphLink(start, graph));
  };
  const texts = (start) => {
    const text = [];
    walk(start, (node) => {
      for (const [name, value] of Object.entries(node.inputs || {})) {
        if (
          /^(text|text_g|text_l|prompt|string|value)$/i.test(name) &&
          typeof value === "string" &&
          value.trim()
        )
          text.push(value.trim());
      }
    });
    return [...new Set(text)].join("\n");
  };
  const inputs = sampler?.inputs || {};
  const guider = graph[graphLink(inputs.guider, graph)]?.inputs || {};
  const positive = texts(
    inputs.positive ?? guider.positive ?? guider.conditioning,
  );
  const negative = texts(inputs.negative ?? guider.negative);
  const parameters = { ...parametersFrom(guider), ...parametersFrom(inputs) };
  // Follow only the selected sampler's ancestry, not disconnected editor nodes.
  if (sampler) {
    walk(
      [Object.entries(graph).find(([, node]) => node === sampler)[0], 0],
      (node) => {
        const fields = node.inputs || {};
        if (/CheckpointLoader|UNETLoader/i.test(node.class_type))
          parameters.model ||= fields.ckpt_name || fields.unet_name;
        if (/SamplerSelect/i.test(node.class_type))
          parameters.sampler ||= fields.sampler_name;
        if (/Scheduler|Noise/i.test(node.class_type))
          Object.assign(parameters, {
            ...parametersFrom(fields),
            ...parameters,
          });
      },
    );
  }
  for (const [id, node] of Object.entries(graph)) {
    if (/SaveImage|PreviewImage|ImageOutput/i.test(node?.class_type)) {
      walk([id, 0], (upstream) => {
        if (
          /UpscaleModelLoader/i.test(upstream.class_type) &&
          upstream.inputs?.model_name
        )
          parameters.upscaler = upstream.inputs.model_name;
      });
    }
  }
  return { source: "ComfyUI", positive, negative, parameters };
}

export function normalizeMetadata(raw = {}, warnings = []) {
  const entries = entriesDeep(raw);
  const documents = entries
    .map(([name, value]) => [name, json(decodeComment(value) || value)])
    .filter(([, value]) => object(value));
  let normalized;
  const isSwarm = ([name, doc]) =>
    ["swarmprompt", "suiimageparams"].includes(key(name)) ||
    object(doc.sui_image_params) ||
    ("negativeprompt" in doc && ("cfgscale" in doc || "swarm_version" in doc));
  const swarm = [["metadata", raw], ...documents].find(isSwarm);
  if (swarm) {
    const fields = swarm[1].sui_image_params || swarm[1];
    normalized = {
      source: "SwarmUI",
      positive: fields.prompt || fields.positive || "",
      negative:
        fields.negativeprompt ||
        fields.negative_prompt ||
        fields.negative ||
        "",
      parameters: parametersFrom(fields),
    };
  }
  if (!normalized) {
    for (const [name, doc] of documents) {
      if (
        key(name) === "prompt" ||
        key(name) === "usercomment" ||
        key(name) === "comment"
      ) {
        normalized = parseComfyGraph(
          doc.prompt && object(doc.prompt) ? doc.prompt : doc,
        );
        if (normalized) break;
      }
    }
  }
  if (!normalized) {
    const novel = documents.find(
      ([name, doc]) =>
        ["comment", "usercomment"].includes(key(name)) &&
        ("uc" in doc ||
          ("prompt" in doc && ("scale" in doc || "sampler" in doc))),
    );
    if (novel) {
      const fields = novel[1];
      const description = entries.find(
        ([name]) => key(name) === "description",
      )?.[1];
      normalized = {
        source: "NovelAI",
        positive: fields.prompt || description || "",
        negative: fields.uc || fields.negative_prompt || "",
        parameters: parametersFrom(fields),
      };
    }
  }
  if (!normalized) {
    for (const [, value] of entries) {
      const text = decodeComment(value);
      if (text) normalized = parseA1111(text);
      if (normalized) break;
    }
  }
  if (!normalized) {
    const find = (names) =>
      entries.find(
        ([name, value]) =>
          names.includes(key(name)) && typeof value === "string",
      )?.[1] || "";
    normalized = {
      source: "Unknown",
      positive: find([
        "positive",
        "positiveprompt",
        "prompt",
        "description",
        "imagedescription",
      ]),
      negative: find(["negative", "negativeprompt"]),
      parameters: parametersFrom(raw),
    };
  }
  normalized.positive =
    typeof normalized.positive === "string" ? normalized.positive : "";
  normalized.negative =
    typeof normalized.negative === "string" ? normalized.negative : "";
  const artistEntries = [
    ...entries,
    ...documents.flatMap(([, doc]) =>
      Object.entries(doc.sui_image_params || doc),
    ),
  ];
  const explicitArtist = artistEntries.find(
    ([name, value]) =>
      ["artist", "creator", "author"].includes(key(name)) &&
      (typeof value === "string" ||
        (Array.isArray(value) && value.every((v) => typeof v === "string"))),
  )?.[1];
  const taggedArtists = [
    ...normalized.positive.matchAll(/(?:^|[,\n(])\s*artist\s*:\s*([^,\n)]+)/gi),
  ].map((match) => match[1].trim());
  const byArtists = [
    ...normalized.positive.matchAll(
      /\bby\s+([^,\n;()]+?)(?=\s+(?:and\s+by|with|in the|style|rendered)\b|[,\n;()]|$)/gi,
    ),
  ].map((match) => match[1].trim());
  const artist = explicitArtist
    ? Array.isArray(explicitArtist)
      ? explicitArtist.join(", ")
      : explicitArtist
    : [...new Set([...taggedArtists, ...byArtists])].join(", ");
  for (const [name, value] of entries) {
    if (
      ["prompt", "comment", "usercomment", "swarmprompt"].includes(key(name)) &&
      typeof value === "string" &&
      value.trim().startsWith("{") &&
      !json(value)
    )
      warnings.push(`Malformed ${name} JSON metadata`);
  }
  return { ...normalized, artist, raw, warnings: [...new Set(warnings)] };
}

export async function extractMetadata(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let raw = {};
  const warnings = [];
  try {
    if (bytes[0] === 137 && utf8.decode(bytes.subarray(1, 4)) === "PNG") {
      const png = await readPngMetadata(bytes);
      raw = png.raw;
      warnings.push(...png.warnings);
    } else if (
      utf8.decode(bytes.subarray(0, 4)) === "RIFF" &&
      utf8.decode(bytes.subarray(8, 12)) === "WEBP"
    ) {
      raw = await readWebp(bytes, warnings);
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      for (const comment of jpegComments(bytes)) store(raw, "Comment", comment);
      try {
        Object.assign(raw, await exifr.parse(bytes, exifOptions));
      } catch (error) {
        warnings.push(`EXIF: ${error.message}`);
      }
    }
  } catch (error) {
    warnings.push(`Metadata: ${error.message}`);
  }
  try {
    return normalizeMetadata(raw, warnings);
  } catch (error) {
    return {
      source: "Unknown",
      artist: "",
      positive: "",
      negative: "",
      parameters: {},
      raw,
      warnings: [...warnings, `Metadata normalization: ${error.message}`],
    };
  }
}

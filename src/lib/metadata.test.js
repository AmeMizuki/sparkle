import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import {
  extractMetadata,
  normalizeMetadata,
  parseA1111,
  parseComfyGraph,
  readPngMetadata,
} from "./metadata.js";

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

function png(chunks) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...chunks,
    chunk("IDAT", deflateSync(Buffer.from([0, 100, 120, 140, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const textChunk = (name, text) =>
  chunk("tEXt", Buffer.from(`${name}\0${text}`, "latin1"));
const international = (name, text, compressed) =>
  chunk(
    "iTXt",
    Buffer.concat([
      Buffer.from(`${name}\0`, "latin1"),
      Buffer.from([compressed ? 1 : 0, 0]),
      Buffer.from("en\0Translated keyword\0"),
      compressed ? deflateSync(Buffer.from(text)) : Buffer.from(text),
    ]),
  );

test("real binary PNG metadata and generator normalization retain prompts, graphs, raw data, and malformed-chunk warnings", async () => {
  const a1111 =
    "A mountain lake, by Claude Monet\nsoft morning light\nNegative prompt: blurry, watermark\nSteps: 28, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 6.5, Seed: 9007199254740993, Size: 1024x768, Model: dreamscapeXL, Hires upscaler: 4x-UltraSharp";
  const binary = png([
    textChunk("Software", "AUTOMATIC1111"),
    textChunk("Description", "Original text"),
    textChunk("Description", "Second text"),
    chunk(
      "zTXt",
      Buffer.concat([
        Buffer.from("parameters\0"),
        Buffer.from([0]),
        deflateSync(Buffer.from(a1111)),
      ]),
    ),
    international("unicode", "日本の景色 — a landscape", true),
    international("plainUnicode", "Été à Paris", false),
    chunk("zTXt", Buffer.from("broken\0\0not deflate")),
  ]);
  const parsed = await readPngMetadata(binary);
  assert.deepEqual(parsed.raw.Description, ["Original text", "Second text"]);
  assert.equal(parsed.raw.unicode, "日本の景色 — a landscape");
  assert.equal(parsed.raw.plainUnicode, "Été à Paris");
  assert.equal(parsed.raw.parameters, a1111);
  assert.ok(parsed.warnings.some((warning) => warning.startsWith("zTXt:")));
  const metadata = await extractMetadata(
    new Blob([binary], { type: "image/png" }),
  );
  assert.equal(metadata.source, "Automatic1111");
  assert.equal(
    metadata.positive,
    "A mountain lake, by Claude Monet\nsoft morning light",
  );
  assert.equal(metadata.negative, "blurry, watermark");
  assert.equal(metadata.artist, "Claude Monet");
  assert.equal(metadata.parameters.cfg, 6.5);
  assert.equal(metadata.parameters.seed, "9007199254740993");
  assert.equal(metadata.parameters.scheduler, "Karras");
  assert.equal(metadata.parameters.model, "dreamscapeXL");
  assert.equal(metadata.parameters.upscaler, "4x-UltraSharp");
  assert.equal(metadata.parameters.width, 1024);
  assert.ok(metadata.warnings.length);
  assert.equal(parseA1111("No generation metadata"), null);
  assert.equal(
    parseA1111("a portrait\nSteps: 12, Sampler: Euler, Seed: 1").negative,
    "",
  );

  const graph = {
    1: {
      class_type: "CLIPTextEncode",
      inputs: { text: "bad anatomy, watermark", clip: ["3", 1] },
    },
    2: {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "quiet forest, artist:John Singer Sargent",
        clip: ["3", 1],
      },
    },
    3: {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "forest-xl.safetensors" },
    },
    4: {
      class_type: "ConditioningCombine",
      inputs: { conditioning_1: ["2", 0], conditioning_2: ["5", 0] },
    },
    5: { class_type: "CLIPTextEncode", inputs: { text: "soft natural light" } },
    6: {
      class_type: "KSampler",
      inputs: {
        positive: ["4", 0],
        negative: ["1", 0],
        model: ["3", 0],
        steps: 30,
        cfg: 7,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        seed: 42,
      },
    },
    7: {
      class_type: "VAEDecode",
      inputs: { samples: ["6", 0], vae: ["3", 2] },
    },
    8: { class_type: "SaveImage", inputs: { images: ["7", 0] } },
    9: {
      class_type: "KSampler",
      inputs: { positive: ["10", 0], negative: ["10", 0], seed: 999 },
    },
    10: {
      class_type: "CLIPTextEncode",
      inputs: { text: "disconnected prompt must not leak" },
    },
    11: {
      class_type: "UpscaleModelLoader",
      inputs: { model_name: "disconnected upscaler" },
    },
  };
  const comfy = normalizeMetadata({
    prompt: JSON.stringify(graph),
    workflow: '{"nodes":[]}',
  });
  assert.equal(comfy.source, "ComfyUI");
  assert.equal(
    comfy.positive,
    "quiet forest, artist:John Singer Sargent\nsoft natural light",
  );
  assert.equal(comfy.negative, "bad anatomy, watermark");
  assert.equal(comfy.artist, "John Singer Sargent");
  assert.equal(comfy.parameters.seed, 42);
  assert.equal(comfy.parameters.model, "forest-xl.safetensors");
  assert.equal(comfy.parameters.sampler, "dpmpp_2m");
  assert.equal(comfy.parameters.upscaler, undefined);
  assert.equal(comfy.raw.workflow, '{"nodes":[]}');
  const comfyBinary = await extractMetadata(
    new Blob([png([international("prompt", JSON.stringify(graph), false)])]),
  );
  assert.equal(comfyBinary.negative, comfy.negative);
  assert.equal(comfyBinary.parameters.steps, 30);

  const custom = parseComfyGraph({
    ...graph,
    6: {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        guider: ["12", 0],
        noise: ["13", 0],
        sampler: ["14", 0],
        sigmas: ["15", 0],
      },
    },
    12: {
      class_type: "CFGGuider",
      inputs: {
        positive: ["4", 0],
        negative: ["1", 0],
        model: ["3", 0],
        cfg: 4.5,
      },
    },
    13: { class_type: "RandomNoise", inputs: { noise_seed: 81 } },
    14: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    15: {
      class_type: "BasicScheduler",
      inputs: { scheduler: "normal", steps: 21 },
    },
  });
  assert.equal(custom.parameters.seed, 81);
  assert.equal(custom.parameters.cfg, 4.5);
  assert.equal(custom.parameters.sampler, "euler");
  assert.equal(custom.parameters.steps, 21);
  assert.equal(custom.negative, comfy.negative);

  const novelRaw = {
    Software: "NovelAI",
    Description: "a sea, by Hokusai",
    Comment: JSON.stringify({
      uc: "low quality",
      steps: 24,
      scale: 5,
      seed: 123,
      sampler: "k_euler_ancestral",
      width: 832,
      height: 1216,
    }),
  };
  const novel = normalizeMetadata(novelRaw);
  assert.equal(novel.source, "NovelAI");
  assert.equal(novel.positive, "a sea, by Hokusai");
  assert.equal(novel.negative, "low quality");
  assert.equal(novel.parameters.cfg, 5);
  assert.equal(novel.artist, "Hokusai");
  assert.equal(
    normalizeMetadata({
      prompt: "artist:Claude Monet, artist:Hokusai, by John Singer Sargent",
    }).artist,
    "Claude Monet, Hokusai, John Singer Sargent",
  );
  assert.strictEqual(novel.raw, novelRaw);
  const swarm = normalizeMetadata({
    parameters: JSON.stringify({
      sui_image_params: {
        prompt: "a city",
        negativeprompt: "text",
        cfgscale: 8,
        sampler: "dpmpp_2m",
        scheduler: "karras",
        steps: 32,
        seed: 72,
        model: { name: "cityXL" },
        upscaler: "ESRGAN",
      },
    }),
    Artist: "Explicit Artist",
  });
  assert.equal(swarm.source, "SwarmUI");
  assert.equal(swarm.negative, "text");
  assert.equal(swarm.parameters.model, "cityXL");
  assert.equal(swarm.parameters.cfg, 8);
  assert.equal(swarm.artist, "Explicit Artist");
  assert.equal(
    normalizeMetadata({ sui_image_params: { prompt: "nested", seed: 2 } })
      .source,
    "SwarmUI",
  );
  assert.ok(normalizeMetadata({ Comment: "{broken" }).warnings.length);
  assert.equal(normalizeMetadata({}).positive, "");
  assert.equal((await extractMetadata(new Blob([png([])]))).source, "Unknown");
  const encoded = Uint8Array.from(
    Buffer.concat([Buffer.from("ASCII\0\0\0"), Buffer.from(a1111)]),
  );
  const exifRaw = { UserComment: encoded };
  assert.equal(normalizeMetadata(exifRaw).parameters.steps, 28);
  assert.strictEqual(exifRaw.UserComment, encoded);
  const truncated = await readPngMetadata(
    binary.subarray(0, binary.length - 15),
  );
  assert.ok(
    truncated.warnings.some((warning) => warning.startsWith("Truncated")),
  );
});

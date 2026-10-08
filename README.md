<p align="center">
  <img src="public/sparkle-logo.png" alt="Sparkle" width="520">
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  A private, offline-first library for images and AI prompts.
</p>

<a href="https://github.com/AmeMizuki/sparkle/releases/download/readme-assets/preview-dashboard.mp4">
  <img src="https://github.com/AmeMizuki/sparkle/releases/download/readme-assets/preview-2.webp" alt="Sparkle Preview" width="100%">
</a>

## ✨ Features

- **Keep your library local.** Images and thumbnails stay in browser storage; imported files are never uploaded.
- **Browse and organize.** Import files or nested folders, mark favorites, and group images into collections.
- **Inspect generations.** View positive and negative prompts, generation settings, original metadata, and zoomable full-size images.
- **Find images quickly.** Search filenames, generator names, and ISO dates; filter by source or date and sort results. Longer search terms tolerate a one-character typo.
- **Personalize the workspace.** Choose English or Traditional Chinese, system/light/dark appearance, and accent and background colors. Settings persist and apply before first paint.
- **Stay focused.** The sidebar collapses to an icon rail (top-left button or `[` key), and becomes a slide-in drawer on phones. Motion respects `prefers-reduced-motion` and browser support.
- **Monitor storage and import outcomes.** Settings show site usage and the browser's estimated quota, refreshed after writes and every 30 seconds. Quota failures stop importing and show saved/not-imported counts without removing earlier successes.
- **Choose image storage.** Every import batch, including folders and drops, can keep original bytes or resize and convert to WebP.
- **Bounded ZIP backups.** Export stored images, thumbnails, prompts, metadata, collections and preferences from Settings. Every ZIP is at most 200 MB.

## Metadata support

Reads PNG `tEXt`, `zTXt`, `iTXt`; JPEG EXIF/XMP/comments; and WebP EXIF/XMP. Normalizes Automatic1111 generation text, ComfyUI prompt graphs (including custom samplers), NovelAI comments, and SwarmUI JSON. Original metadata is preserved; extraction warnings are nonfatal.

Custom nodes or stripped metadata may leave fields unknown. For ComfyUI graphs with multiple output branches, Sparkle uses the nearest connected sampler and keeps raw graph data available. Dates use the source file's last-modified timestamp, not a claimed generation timestamp.

## Develop

```sh
npm install
npm run dev
```

Run checks and tests:

```sh
npm run check
npm test
```

## Storage note

Each import batch asks whether to keep original resolution. The default preserves the exact original file. Choosing No converts to WebP (quality 0.86), limits the longest edge to 2048 pixels without upscaling, and stores WebP even when larger. Prompts and raw metadata remain separate and are not embedded in converted downloads. Animated images require original mode; static GIF/AVIF conversion requires browser `ImageDecoder` support. Unsafe frame detection or failed conversion is reported as an import failure, never silently replaced with original bytes. Existing library images and source files on your device are unchanged.

Browser site data is not a backup: clearing it deletes the library. Storage estimates include this site's database, thumbnails and cache; quotas can change and do not guarantee available writable space. Unsupported browsers display “Estimate unavailable”. Storage protection requests persistence, which browsers may decline. On quota failure the image and metadata transaction rolls back together and remaining files are not attempted; earlier successful imports remain.

### Export and backup

Create a backup in Settings, then download every ZIP link. Each archive is at most **200,000,000 bytes (200 MB)** and opens independently. Images use ZIP stored entries to avoid recompressing encoded images; JSON uses DEFLATE. Oversized images or metadata are split into chunks; headers and manifests count toward the size limit.

Each archive contains `manifest.json`, `RECOVERY.txt` and payload chunks. Follow the recovery instructions to concatenate chunks of each logical file in `offset` order, keeping separate metadata. Only the final manifest sets `complete: true` and `totalParts`; require every part with the same `backupId` for a complete backup. Failed exports show an incomplete-backup warning: retry before deleting data. Links expire on reload or when starting another backup.

Backups preserve the complete currently stored library, not original bytes discarded during conversion, and do not embed metadata into images. Files and JSON can be recovered offline using the included instructions; there is no one-click library restore UI.


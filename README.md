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
  <img src="https://github.com/AmeMizuki/sparkle/releases/download/readme-assets/preview-1.webp" alt="Sparkle Preview" width="100%">
</a>

## ✨ Features

- **Keep your library local.** Images and thumbnails stay in browser storage; imported files are never uploaded.
- **Browse and organize.** Import files or nested folders, mark favorites, and group images into collections.
- **Inspect generations.** View positive and negative prompts, generation settings, original metadata, and zoomable full-size images.
- **Find images quickly.** Search filenames, generator names, and ISO dates; filter by source or date and sort results. Longer search terms tolerate a one-character typo.
- **Personalize the workspace.** Choose English or Traditional Chinese, system/light/dark appearance, and accent and background colors. Settings persist and apply before first paint.
- **Stay focused.** The sidebar collapses to an icon rail (top-left button or `[` key), and becomes a slide-in drawer on phones. Motion respects `prefers-reduced-motion` and browser support.

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

Static PNG, JPEG, and WebP imports use full-resolution WebP (quality 0.86) when smaller. Prompts and raw metadata stay separately in the library and are not embedded in compressed downloads. Animated images, GIF/AVIF, and failed or non-beneficial conversions keep their source bytes. Existing library images are not recompressed; source files on your device are never changed.

Browser site data is not a backup. Clearing it deletes the library. Keep source files as a backup; downloaded compressed images do not contain the separately stored generation metadata. The storage-protection button requests persistent storage, which the browser may decline. Importing or removing an image from Sparkle never changes its original file on your device.

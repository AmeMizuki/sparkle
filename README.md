<p align="center">
  <img src="public/sparkle-logo.png" alt="Sparkle" width="520">
</p>

<p align="center">
  A private, offline-first library for images and AI prompts.
</p>

<p align="center">
  <img src="https://i.urusai.cc/hfixF.jpg" alt="Sparkle website preview" width="100%">
</p>

## ✨ Features

- **Keep your library local.** Images and thumbnails stay in browser storage; imported files are never uploaded.
- **Browse and organize.** Import files or nested folders, mark favorites, and group images into collections.
- **Inspect generations.** View positive and negative prompts, generation settings, original metadata, and zoomable full-size images.
- **Find images quickly.** Search filenames, artists, generator names, and ISO dates; filter by source or date and sort results. Longer search terms tolerate a one-character typo.
- **Personalize the workspace.** Choose English or Traditional Chinese, system/light/dark appearance, and accent and background colors. Settings persist and apply before first paint.
- **Stay focused.** The sidebar collapses to an icon rail (top-left button or `[` key), and becomes a slide-in drawer on phones. Motion respects `prefers-reduced-motion` and browser support.

## Metadata support

Reads PNG `tEXt`, `zTXt`, `iTXt`; JPEG EXIF/XMP/comments; and WebP EXIF/XMP. Normalizes Automatic1111 generation text, ComfyUI prompt graphs (including custom samplers), NovelAI comments, and SwarmUI JSON. Original metadata is preserved; extraction warnings are nonfatal.

Artist names are extracted from explicit artist/creator fields or `artist:Name` / `by Name` prompt tags, and can be edited manually. Custom nodes or stripped metadata may leave fields unknown. For ComfyUI graphs with multiple output branches, Sparkle uses the nearest connected sampler and keeps raw graph data available. Dates use the source file's last-modified timestamp, not a claimed generation timestamp.

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

Browser site data is not a backup. Clearing it deletes the library. Keep original files or download originals before clearing storage. The storage-protection button requests persistent storage, which the browser may decline. Removing an image from Sparkle never deletes its original file.

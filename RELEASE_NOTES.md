# Sparkle 0.2.0

This release improves image browsing, previews, and local storage, and adds GitHub Pages deployment. Images and metadata remain in your browser; files are never uploaded.

- Browse images more easily - Open images in a full-size viewer and drag to pan; use the image context menu to view, favorite, categorize, edit, or remove an image.
- Choose preview quality - Use smaller previews by default or switch to the stored image's full dimensions. View image dimensions, format, and source and stored file sizes.
- Save storage for static images - Convert PNG, JPEG, and WebP files to full-resolution WebP when it reduces file size. Metadata stays separate; animated images and files that cannot be reduced keep their original data.
- Scale local browsing - Store image and thumbnail Blobs separately from indexed metadata, migrate existing libraries automatically, and browse 24 images per page. Read Blobs only when cards enter the viewport and release Object URLs when images unmount or previews change.
- Request storage protection automatically - Request persistent storage at startup and retain the Settings retry button and denial notice; browser approval is required.
- Delete the entire image library safely - Add a Settings action requiring an initial confirmation and manual entry of the random six-character code in OTP-style slots. Keep the Delete button disabled until all six slots are filled. Present the code in spaced character tiles with selection/copy disabled; reject paste, drag-and-drop and autofill. Clear image metadata and Blobs atomically; preserve collections and preferences.
- Navigate and personalize - Use themed custom menus, transitions for library changes, and contextual help. Dark-mode hover and focus colors are improved.
- Deploy to GitHub Pages - Build and deploy automatically from GitHub Actions, with assets and offline support working under the project URL.
- Find and import reliably - Fix image reading order and numeric filename sorting, and prevent duplicate imports when dragging images from the library.
- Support browsers without `crypto.randomUUID()` - Generate UUIDv4 IDs with `crypto.getRandomValues()` when the native UUID API is unavailable, including non-secure HTTP access. Apply the same ID generator to image imports, samples, and collections.
- Simplify image details - Remove the separate Artist name field; add GitHub repository and Issues links to Help & Shortcuts.

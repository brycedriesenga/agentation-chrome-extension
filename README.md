# AnnotateWeb

A Chrome extension that brings [Agentation](https://agentation.dev)'s visual feedback tools to any website. Annotate page elements with numbered markers, add comments, and capture annotated screenshots — all from a single toolbar.

## Features

- 🎯 **Point-and-click annotations** — Click any element to add a numbered marker with a comment
- 📷 **Element screenshots** — Capture individual annotated elements with an annotation header and white background
- 🖼️ **Full-page screenshots** — Scroll-and-stitch capture that covers all annotated areas with a summary header
- ▦ **Grid screenshots** — Scroll to each annotation, crop, and arrange in a 2-column masonry grid
- 📋 **Copy feedback** — Export annotations as structured markdown (via Agentation)
- 🔢 **Badge count** — See annotation count at a glance on the extension icon
- 🔗 **No-server sharing** — Copy share text or a share URL to transfer annotations without a backend
- 📥 **Import modes** — Paste shared data and choose Replace or Merge import behavior with merge summaries
- 🎨 **Theme-aware controls** — Popup and added controls switch between Agentation-aligned dark and light themes, and SVG icons follow theme color via currentColor
- ⌨️ **Keyboard shortcut** — `Ctrl+Shift+.` to toggle annotations

## Getting Started

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

## Usage

1. Click the AnnotateWeb icon or press `Ctrl+Shift+.` to activate
2. Click on any page element to add an annotation marker
3. Type your feedback in the popup that appears
4. Use the 📷 button on any marker to screenshot that element
5. Use **Screenshot Page** in the popup for a scroll-and-stitch capture covering all annotations
6. Use **Screenshot Grid** in the popup to capture all annotated elements in a masonry grid
7. Use **Copy Share Text** to copy an encoded payload for chat/email sharing
8. Use **Copy Share URL** to generate a URL hash link (best for smaller payloads)
9. Use **Paste Shared Data** to import shared text/URL and choose **Replace** or **Merge**
10. Imports refresh in-page annotations automatically (no manual reload needed)
11. Toolbar auto-opens feedback mode when toggling on annotations or importing shared annotations

Screenshots are automatically copied to clipboard.

## Tech Stack

| Layer | Technology |
|---|---|
| Annotation Engine | [Agentation](https://agentation.dev) |
| UI Framework | React 18 |
| Build System | Vite + @crxjs/vite-plugin |
| Extension API | Chrome MV3 |

## Project Structure

```
src/
├── background/service-worker.js   # Service worker: toggle, badge, screenshot compositing
├── content/index.jsx              # Mounts Agentation toolbar into pages
├── content/screenshot.js          # Screenshot capture + annotation header logic
├── content/message-router.js      # Content-script message routing (screenshots + sharing)
├── content/share-sync.js          # Share export/import orchestration + hash import
├── content/annotation-storage.js  # LocalStorage helpers, badge update, live refresh trigger
├── content/theme.js               # Agentation theme detection + palette helpers
├── popup/                         # Extension popup (toggle, screenshots, share import/export)
└── shared/                        # Share payload + page key utilities
```

## CSS Isolation

AnnotateWeb injects a targeted CSS reset (font, line-height, text-transform, etc.) scoped to `#annotateweb-root` and `[class*="styles-module__"]` selectors. This prevents host-page CSS (Tailwind, Bootstrap, etc.) from breaking the toolbar and markers without interfering with Agentation's own styles.

## Maintenance & Compatibility

⚠️ **Important**: This extension relies on internal implementation details of the `agentation` library to provide features like "clean screenshots" and "grid capture".

If you update `agentation` in `package.json`, verify the following:

1.  **CSS Selectors**: `screenshot.js` uses specific class name patterns (e.g., `styles-module__toolbar___`) to hide UI elements during capture. If Agentation changes its CSS modules, these screenshots will include UI artifacts.
2.  **LocalStorage Schema**: The extension reads directly from `localStorage` keys starting with `feedback-annotations-`. If the data structure changes, badge counts and screenshots (which rely on `x`, `y`, `comment`, `number`, `elementPath`) will break.
3.  **Marker Positioning**: `injectTemporaryMarkers` duplicates Agentation's positioning logic (`top`/`left`). If Agentation switches to `transform` or other positioning methods, the temporary markers will be misaligned.
4.  **Screenshot API Throttling**: `captureVisibleTab` is rate-limited to ~2 calls/sec by Chrome. The extension enforces a 550ms minimum interval between captures.

## License

Private

# AnnotateWeb

A Chrome extension that brings [Agentation](https://agentation.dev)'s visual feedback tools to any website. Annotate page elements with numbered markers, add comments, and capture annotated screenshots — all from a single toolbar.

## Features

- 🎯 **Point-and-click annotations** — Click any element to add a numbered marker with a comment
- 📷 **Element screenshots** — Capture individual annotated elements with an annotation header
- 🖼️ **Full-page screenshots** — Capture the visible page with a summary of all annotations
- ▦ **Grid screenshots** — Capture individual annotated elements arranged in a clean grid layout
- 📋 **Copy feedback** — Export annotations as structured markdown (via Agentation)
- 🔢 **Badge count** — See annotation count at a glance on the extension icon
- 🔗 **No-server sharing** — Copy share text or a share URL to transfer annotations without a backend
- 📥 **Import modes** — Paste shared data and choose Replace or Merge import behavior with merge summaries
- 🎨 **Theme-aware controls** — Popup keeps its classic dark visual style while SVG/icon accents and in-page affordances adapt to Agentation light/dark mode
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
5. Use **Screenshot Page** in the popup for a full-page capture with annotation summary
6. Use **Screenshot Grid** in the popup to capture all visible annotated elements in a grid layout
7. Use **Copy Share Text** to copy an encoded payload for chat/email sharing
8. Use **Copy Share URL** to generate a URL hash link (best for smaller payloads)
9. Use **Paste Shared Data** to import shared text/URL and choose **Replace** or **Merge**
10. Imports refresh in-page annotations automatically (no manual reload needed)

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

## Maintenance & Compatibility

⚠️ **Important**: This extension relies on internal implementation details of the `agentation` library to provide features like "clean screenshots" and "grid capture".

If you update `agentation` in `package.json`, verify the following:

1.  **CSS Selectors**: `screenshot.js` uses specific class name patterns (e.g., `styles-module__toolbar___`) to hide UI elements during capture. If Agentation changes its CSS modules, these screenshots will include UI artifacts.
2.  **LocalStorage Schema**: The extension reads directly from `localStorage` keys starting with `feedback-annotations-`. If the data structure changes, badge counts and grid captures (which rely on `x`, `y`, `comment`, `number`) will break.
3.  **Marker Positioning**: `injectTemporaryMarkers` duplicates Agentation's positioning logic (`top`/`left`). If Agentation switches to `transform` or other positioning methods, the temporary markers will be misaligned.

## License

Private

# AnnotateWeb — Chrome Extension

## Overview

AnnotateWeb wraps the [Agentation](https://agentation.dev) library to enable visual annotation on any webpage. Users can place numbered markers on page elements, add feedback comments, and capture annotated screenshots.

## Architecture

```
src/
├── background/service-worker.js   # MV3 service worker: toggle, badge, screenshot compositing
├── content/index.jsx              # React entry: mounts Agentation, handles activation/badge
├── content/screenshot.js          # Screenshot capture, annotation header compositing
├── content/message-router.js      # Content-script message routing for screenshot/share actions
├── content/share-sync.js          # Share export/import orchestration + hash import
├── content/annotation-storage.js  # Agentation localStorage read/write + badge/refresh helpers
├── content/theme.js               # Detects Agentation light/dark mode for extension UI parity
├── popup/popup.html/css/js        # Extension popup UI: toggle, screenshots, share import/export
├── shared/page-key.js             # Normalized page key utility for sharing
├── shared/share-payload.js        # Share payload schema + encode/decode helpers
└── icons/                         # Extension icons (16, 48, 128) - PNG format
```

## Key Dependencies

- **Agentation** (`^2.2.1`) — Annotation toolbar, marker rendering, localStorage persistence
- **React 18** — Hosts `<Agentation>` component in content script
- **Vite + @crxjs/vite-plugin** — Build system for Chrome extension

## Data Flow

1. **Annotations** are stored in `localStorage` by Agentation under `feedback-annotations-{pathname}`
2. **`loadAnnotations(pathname)`** (exported from Agentation) reads annotation data for screenshots
3. **Badge count** is updated via callbacks (`onAnnotationAdd`, etc.). **Note:** A 250ms delay is used before reading `loadAnnotations` to allow Agentation's internal state to persist to localStorage.

## Screenshot Pipeline

### Element Screenshot
1. `screenshot.js` → `getAnnotationInfo(marker)` reads number + comment from `loadAnnotations()`
2. Hides all Agentation UI → captures visible tab → sends to service worker
3. `service-worker.js` → `compositeScreenshot()` crops and adds annotation header bar

### Full-Page Screenshot
1. `screenshot.js` → `captureFullPage()` reads all annotations, injects element highlights
2. **Injects temporary markers** (div overlays) to ensure visibility even if toolbar is collapsed
3. Hides real toolbar/tooltips → captures tab → cleans up temporary elements
4. `service-worker.js` → `compositeFullpageScreenshot()` adds multi-row annotation summary header

### Grid Screenshot
1. `screenshot.js` → `captureAnnotationGrid()` identifies visible annotated elements
2. Captures visible tab → sends to service worker with list of crop rects
3. `service-worker.js` → `compositeGridScreenshot()` crops each element, arranges in 2-column masonry grid
4. Adds same multi-row annotation summary header at the top


## Build

```bash
npm run build     # Production build → dist/
```

Load `dist/` as unpacked extension in `chrome://extensions`.

## Agentation API Used

| Export | Usage |
|---|---|
| `Agentation` | Main React component (toolbar + markers) |
| `loadAnnotations(pathname)` | Read annotations from localStorage |
| `onAnnotationAdd` callback | Badge count updates |
| `onAnnotationDelete` callback | Badge count updates |
| `onAnnotationUpdate` callback | Badge count updates |
| `onAnnotationsClear` callback | Badge count updates |

## Sharing (No Server)

- Share payloads use a versioned schema (`v`, `pageKey`, `annotations`, metadata).
- `pageKey` is normalized as `origin + pathname` (trailing slash trimmed except root).
- Popup actions support:
  - **Copy Share Text** (encoded payload)
  - **Copy Share URL** (`#annotateweb=` hash; guarded by size limit)
  - **Paste Shared Data** with **Replace** or **Merge** import modes
- Content script supports import from URL hash on page load with user confirmation.
- Imports write directly to Agentation localStorage key (`feedback-annotations-{pathname}`), update badge counts, and trigger live in-page refresh (no reload prompt).
- Merge imports return summary stats (`added`, `updated`, `skippedDuplicates`, `conflictsResolved`) for clearer UX feedback.


## Theme behavior

- Added popup sharing controls and in-page screenshot/share affordances follow Agentation's current light/dark mode using its persisted `feedback-toolbar-theme` setting (with toolbar/style detection fallback).
- If Agentation theme cannot be detected (e.g., toolbar closed), fallback uses system `prefers-color-scheme`.

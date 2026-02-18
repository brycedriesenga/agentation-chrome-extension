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
1. `screenshot.js` → `captureAnnotatedElement(marker)` reads number + comment from `loadAnnotations()`
2. Hides all Agentation UI (highlights, tooltips, markers, toolbar, overlay, `#annotateweb-root`)
3. Captures visible tab → sends to service worker
4. `service-worker.js` → `compositeScreenshot()` crops, adds white background fill + annotation header bar

### Full-Page Screenshot (Scroll-and-Stitch)
1. `screenshot.js` → `captureFullPage()` reads all annotations, calculates lowest annotation bottom edge
2. Injects temporary markers (div overlays) and highlight borders at absolute positions
3. Scrolls in viewport-sized chunks from top to lowest annotation (+60px padding), capturing at each position
4. Each capture is throttled (550ms min interval) to respect Chrome’s `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` quota
5. Sends all chunks to service worker → `stitchFullpageComposite()` stitches into one tall image + annotation summary header

### Grid Screenshot (Scroll-and-Stitch)
1. `screenshot.js` → `captureAnnotationGrid()` scrolls to each annotation element individually
2. Captures with throttle, records viewport-relative crop rect for each
3. Sends per-annotation captures to service worker → `stitchGridComposite()`
4. Crops each annotation from its capture, lays out in 2-column masonry grid with numbered badges + summary header


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

- Added popup sharing controls now fully switch between Agentation-aligned dark/light styling, while SVG/icon colors and on-page screenshot/share affordances follow the active theme via `feedback-toolbar-theme` (with toolbar/style detection fallback).
- If Agentation theme cannot be detected (e.g., toolbar closed), fallback uses system `prefers-color-scheme`.

- Screenshot actions triggered from popup close the popup immediately to restore page focus before clipboard writes.
- Annotation toggle and share imports trigger auto-open feedback mode (`Start feedback mode`) for faster workflows.

## CSS Isolation

- Targeted CSS reset scoped to `#annotateweb-root` and `[class*="styles-module__"]` selectors
- Resets commonly-inherited properties (font-family, line-height, text-transform, text-decoration, etc.)
- Does NOT use `all: revert` (that nukes Agentation’s own CSS module styles)
- Prevents host-page frameworks (Tailwind, Bootstrap, etc.) from breaking toolbar/marker styling

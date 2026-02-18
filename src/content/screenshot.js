// AnnotateWeb — Screenshot Enhancement
// Adds screenshot capture buttons to Agentation annotation markers
// Handles clean captures by hiding overlays and compositing annotation headers

import { loadAnnotations } from "agentation";
import { getThemePalette } from "./theme.js";

/**
 * Selectors for Agentation UI elements that should be hidden during captures.
 * Uses partial class matching since Agentation uses CSS modules with hashed suffixes.
 */
const AGENTATION_SELECTORS = {
    toolbar: '[class*="styles-module__toolbar___"]',
    highlights: '[class*="styles-module__selectedElementHighlight___"], [class*="styles-module__hoverHighlight___"], [class*="styles-module__singleSelectOutline___"], [class*="styles-module__multiSelectOutline___"]',
    highlightsContainer: '[class*="styles-module__highlightsContainer___"]',
    hoverHighlight: '[class*="styles-module__hoverHighlight___"]',
    hoverTooltip: '[class*="styles-module__hoverTooltip___"]',
    markerTooltips: '[class*="styles-module__markerTooltip___"]',
    markers: '[data-annotation-marker]',
    overlay: '[class*="styles-module__overlay___"]',
    screenshotButtons: '.annotateweb-screenshot-btn',
    settingsPanel: '[class*="styles-module__settingsPanel___"]',
};

/**
 * Hide a set of DOM elements and return a restore function.
 */
function hideElements(selector) {
    const elements = document.querySelectorAll(selector);
    const originals = [];
    elements.forEach((el) => {
        originals.push({ el, display: el.style.display, visibility: el.style.visibility });
        el.style.display = 'none';
    });
    return () => {
        originals.forEach(({ el, display, visibility }) => {
            el.style.display = display;
            el.style.visibility = visibility;
        });
    };
}

/**
 * Wait for the next animation frame (lets DOM changes settle).
 */
function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/**
 * Inject temporary markers into the DOM for screenshot purposes.
 * This ensures markers are visible even if the Agentation toolbar is closed/unmounted.
 */
function injectTemporaryMarkers(annotations) {
    const markers = [];
    const palette = getThemePalette();
    annotations.forEach((a, i) => {
        // Skip if invalid coords
        if (typeof a.x !== 'number' || typeof a.y !== 'number') return;

        const el = document.createElement('div');
        el.className = 'annotateweb-temp-marker';
        el.textContent = String(i + 1);
        el.style.cssText = `
            position: absolute;
            left: ${a.x}%;
            top: ${a.y}px;
            width: 24px;
            height: 24px;
            background-color: ${palette.markerBg};
            color: ${palette.markerText};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            font-family: system-ui, sans-serif;
            box-shadow: ${palette.markerShadow};
            z-index: 2147483645; /* Above highlights (ending in 40) */
            pointer-events: none;
            transform: translate(-50%, -50%); /* Agentation centers on point */
        `;
        document.body.appendChild(el);
        markers.push(el);
    });
    return markers;
}


function isIgnoredCaptureElement(el) {
    if (!el) return true;
    return Boolean(
        el.closest('[data-feedback-toolbar]') ||
        el.closest('[data-annotation-marker]') ||
        el.closest('.annotateweb-screenshot-btn') ||
        el.closest('#annotateweb-root')
    );
}

function resolveAnnotationElement(annotation) {
    if (annotation?.elementPath) {
        try {
            const byPath = document.querySelector(annotation.elementPath);
            if (byPath) return byPath;
        } catch {
            // ignore invalid selector; try coordinate fallback
        }
    }

    if (typeof annotation?.x !== 'number' || typeof annotation?.y !== 'number') {
        return null;
    }

    const viewportX = Math.round((annotation.x / 100) * window.innerWidth);
    const viewportY = Math.round(annotation.isFixed ? annotation.y : annotation.y - window.scrollY);

    if (viewportX < 0 || viewportY < 0 || viewportX > window.innerWidth || viewportY > window.innerHeight) {
        return null;
    }

    const hit = document.elementFromPoint(viewportX, viewportY);
    if (!hit || isIgnoredCaptureElement(hit)) {
        return null;
    }

    return hit;
}

/**
 * Initialize screenshot buttons on annotation markers.
 * Called after Agentation renders markers, and re-called on DOM mutations.
 */
export function initScreenshotButtons() {
    const markers = document.querySelectorAll('[data-annotation-marker]');
    const palette = getThemePalette();

    markers.forEach((marker) => {
        // Skip if already enhanced
        if (marker.dataset.screenshotEnhanced) return;
        marker.dataset.screenshotEnhanced = "true";

        // Add a screenshot button next to/inside the marker on hover
        const btn = document.createElement("button");
        btn.className = "annotateweb-screenshot-btn";
        btn.innerHTML = `<svg width="12" height="10" viewBox="0 0 24 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M23 17C23 17.5304 22.7893 18.0391 22.4142 18.4142C22.0391 18.7893 21.5304 19 21 19H3C2.46957 19 1.96086 18.7893 1.58579 18.4142C1.21071 18.0391 1 17.5304 1 17V6C1 5.46957 1.21071 4.96086 1.58579 4.58579C1.96086 4.21071 2.46957 4 3 4H7L9 1H15L17 4H21C21.5304 4 22.0391 4.21071 22.4142 4.58579C22.7893 4.96086 23 5.46957 23 6V17Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15C14.2091 15 16 13.2091 16 11C16 8.79086 14.2091 7 12 7C9.79086 7 8 8.79086 8 11C8 13.2091 9.79086 15 12 15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        btn.title = "Screenshot this element";
        btn.style.cssText = `
      position: absolute;
      top: -8px;
      right: -24px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 1px solid ${palette.buttonBorder};
      background: ${palette.buttonBg};
      backdrop-filter: blur(8px);
      color: ${palette.buttonColor};
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.15s ease, transform 0.15s ease;
      pointer-events: auto;
      z-index: 2147483647;
      padding: 0;
      line-height: 1;
      transform: scale(0.8);
    `;

        // Show on marker hover
        marker.addEventListener("mouseenter", () => {
            btn.style.opacity = "1";
            btn.style.transform = "scale(1)";
        });
        marker.addEventListener("mouseleave", () => {
            btn.style.opacity = "0";
            btn.style.transform = "scale(0.8)";
        });

        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            captureAnnotatedElement(marker);
        });

        // Make marker position relative for button positioning
        const currentPosition = window.getComputedStyle(marker).position;
        if (currentPosition === "static") {
            marker.style.position = "relative";
        }

        marker.appendChild(btn);
    });
}

/**
 * Get all annotations for the current page from Agentation's localStorage.
 * Returns the full annotations array with element, comment, selectedText, etc.
 */
function getAllAnnotations() {
    const pathname = window.location.pathname;
    return loadAnnotations(pathname);
}

/**
 * Extract annotation info for a specific marker element.
 * Finds the marker's index among all markers and looks up the
 * corresponding annotation from Agentation's localStorage.
 */
function getAnnotationInfo(marker) {
    const allMarkers = Array.from(document.querySelectorAll('[data-annotation-marker]'));
    const markerIndex = allMarkers.indexOf(marker);
    const annotations = getAllAnnotations();

    if (markerIndex >= 0 && markerIndex < annotations.length) {
        const annotation = annotations[markerIndex];
        return {
            number: String(markerIndex + 1),
            comment: annotation.comment || '',
        };
    }

    return { number: '?', comment: '' };
}

/**
 * Capture a screenshot of the element associated with an annotation marker.
 * Hides all Agentation UI overlays before capture, then composites the result
 * with an annotation header.
 */
async function captureAnnotatedElement(marker) {
    // 1. Collect annotation info BEFORE hiding anything
    const { number, comment } = getAnnotationInfo(marker);

    // 2. Find the target element under the marker
    const markerRect = marker.getBoundingClientRect();
    const originalPointerEvents = marker.style.pointerEvents;
    marker.style.pointerEvents = "none";

    const elementUnder = document.elementFromPoint(
        markerRect.left + markerRect.width / 2,
        markerRect.top + markerRect.height / 2
    );

    marker.style.pointerEvents = originalPointerEvents;

    let targetRect;
    if (elementUnder && elementUnder !== document.body && elementUnder !== document.documentElement) {
        targetRect = elementUnder.getBoundingClientRect();
    } else {
        const padding = 100;
        targetRect = {
            x: Math.max(0, markerRect.left - padding),
            y: Math.max(0, markerRect.top - padding),
            width: markerRect.width + padding * 2,
            height: markerRect.height + padding * 2,
        };
    }

    // Add some padding around the element
    const padding = 16;
    const rect = {
        x: Math.max(0, targetRect.x - padding),
        y: Math.max(0, targetRect.y - padding),
        width: targetRect.width + padding * 2,
        height: targetRect.height + padding * 2,
        dpr: window.devicePixelRatio || 1,
    };

    // 3. Show capture feedback BEFORE hiding UI
    showCaptureFeedback(targetRect);

    // 4. Hide ALL Agentation UI overlays
    const restoreFns = [];
    restoreFns.push(hideElements(AGENTATION_SELECTORS.toolbar));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.highlights));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.highlightsContainer));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.markerTooltips));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.markers));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.overlay));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.screenshotButtons));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.settingsPanel));
    restoreFns.push(hideElements('#annotateweb-root'));

    // 5. Wait for DOM to settle
    await nextFrame();

    try {
        // 6. Capture and composite
        const response = await chrome.runtime.sendMessage({
            type: "CAPTURE_AND_COMPOSITE",
            rect,
            annotationNumber: number,
            annotationComment: comment,
        });

        // 7. Restore all hidden elements
        restoreFns.forEach((fn) => fn());

        if (response.error) {
            console.error("Screenshot failed:", response.error);
            showToast("Screenshot failed — try again", "error");
            return;
        }

        // Copy to clipboard
        const copied = await copyImageToClipboard(response.dataUrl);
        showToast(copied ? "Screenshot copied to clipboard!" : "Screenshot ready, but clipboard access was blocked.", copied ? "success" : "error");
    } catch (err) {
        // Restore even on error
        restoreFns.forEach((fn) => fn());
        console.error("Screenshot error:", err);
        showToast("Screenshot failed — try again", "error");
    }
}

/**
 * Copy a data URL image to the clipboard.
 * Focuses the window first to avoid NotAllowedError when triggered from popup.
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDocumentFocus() {
    const waits = [0, 120, 280, 420];
    for (const wait of waits) {
        window.focus();
        if (wait > 0) {
            await delay(wait);
        }
        if (document.hasFocus()) {
            return true;
        }
    }
    return false;
}

async function copyImageToClipboard(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    await ensureDocumentFocus();

    const item = new ClipboardItem({
        [blob.type]: blob,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await navigator.clipboard.write([item]);
            return true;
        } catch (err) {
            if (err.name !== "NotAllowedError") {
                throw err;
            }

            await ensureDocumentFocus();
            await delay(180 + attempt * 160);
        }
    }

    return false;
}

/**
 * Show a visual flash over the captured element area.
 */
function showCaptureFeedback(rect) {
    const flash = document.createElement("div");
    flash.style.cssText = `
    position: fixed;
    top: ${rect.y}px;
    left: ${rect.x}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    background: rgba(99, 102, 241, 0.15);
    border: 2px solid rgba(99, 102, 241, 0.6);
    border-radius: 8px;
    pointer-events: none;
    z-index: 2147483646;
    transition: opacity 0.4s ease;
  `;
    document.body.appendChild(flash);

    requestAnimationFrame(() => {
        flash.style.opacity = "0";
    });

    setTimeout(() => flash.remove(), 500);
}

/**
 * Show a toast notification.
 */
function showToast(text, type = "success") {
    const existing = document.getElementById("annotateweb-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "annotateweb-toast";
    const bgColor =
        type === "success"
            ? "linear-gradient(135deg, #10b981, #059669)"
            : "linear-gradient(135deg, #ef4444, #dc2626)";
    toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: ${bgColor};
    color: white;
    padding: 10px 20px;
    border-radius: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    z-index: 2147483647;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease, transform 0.2s ease;
    backdrop-filter: blur(8px);
  `;
    toast.textContent = text;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateX(-50%) translateY(0)";
    });

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(-50%) translateY(20px)";
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

/**
 * Capture the full visible page with annotation markers visible
 * and an annotation summary header composited at the top.
 * Uses loadAnnotations to get annotation data cleanly from localStorage.
 * Injects temporary highlight borders around annotated elements.
 */
export async function captureFullPage() {
    const palette = getThemePalette();
    // 1. Get all annotation data from Agentation's localStorage
    const annotations = getAllAnnotations();
    const annotationItems = annotations.map((a, i) => ({
        number: String(i + 1),
        comment: a.comment || '',
        element: a.element || '',
    }));

    // 2. Hide toolbar, settings panel, screenshot buttons, hover elements
    const restoreFns = [];
    restoreFns.push(hideElements(AGENTATION_SELECTORS.toolbar));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.settingsPanel));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.screenshotButtons));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.hoverHighlight));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.hoverTooltip));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.markerTooltips));
    // Also hide real markers to avoid duplication/ghosting if they are present
    restoreFns.push(hideElements(AGENTATION_SELECTORS.markers));

    // 3. Inject temporary highlight borders around annotated elements
    const highlightOverlays = [];
    annotations.forEach((annotation) => {
        const el = resolveAnnotationElement(annotation);
        if (!el) return;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const overlay = document.createElement('div');
        overlay.className = 'annotateweb-highlight-overlay';
        overlay.style.cssText = `
                position: fixed;
                top: ${rect.top - 2}px;
                left: ${rect.left - 2}px;
                width: ${rect.width + 4}px;
                height: ${rect.height + 4}px;
                border: 2px solid ${palette.highlightBorder};
                border-radius: 6px;
                background: ${palette.highlightBg};
                pointer-events: none;
                z-index: 2147483640;
                box-sizing: border-box;
            `;
        document.body.appendChild(overlay);
        highlightOverlays.push(overlay);
    });

    // 4. Inject temporary markers (ensures visibility even if toolbar closed)
    const tempMarkers = injectTemporaryMarkers(annotations);

    // 5. Wait for DOM to settle
    await nextFrame();

    try {
        // 6. Capture the page (markers + highlights visible)
        const response = await chrome.runtime.sendMessage({
            type: "CAPTURE_FULLPAGE_COMPOSITE",
            annotations: annotationItems,
        });

        // 7. Remove temporary elements and restore hidden elements
        highlightOverlays.forEach((el) => el.remove());
        tempMarkers.forEach((el) => el.remove());
        restoreFns.forEach((fn) => fn());

        if (response.error) {
            showToast("Full page screenshot failed", "error");
            return null;
        }

        const copied = await copyImageToClipboard(response.dataUrl);
        showToast(copied ? "Full page screenshot copied!" : "Full page screenshot ready, but clipboard access was blocked.", copied ? "success" : "error");
        return response.dataUrl;
    } catch (err) {
        highlightOverlays.forEach((el) => el.remove());
        tempMarkers.forEach((el) => el.remove());
        restoreFns.forEach((fn) => fn());
        console.error("Full page screenshot error:", err);
        showToast("Full page screenshot failed", "error");
        return null;
    }
}

/**
 * Capture each annotated element individually and composite them into a grid.
 */
export async function captureAnnotationGrid() {
    const annotations = getAllAnnotations();

    // 1. Gather visible rects for each annotation
    // We filter to only those elements that are currently in the DOM and visible
    const gridItems = [];
    const dpr = window.devicePixelRatio || 1;

    annotations.forEach((a, i) => {
        const el = resolveAnnotationElement(a);
        if (!el) return;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        if (
            rect.bottom < 0 ||
            rect.right < 0 ||
            rect.top > window.innerHeight ||
            rect.left > window.innerWidth
        ) {
            return;
        }

        const padding = 16;
        gridItems.push({
            annotation: {
                number: String(i + 1),
                comment: a.comment || '',
            },
            rect: {
                x: Math.max(0, rect.left - padding),
                y: Math.max(0, rect.top - padding),
                width: rect.width + padding * 2,
                height: rect.height + padding * 2,
                dpr: dpr
            }
        });
    });

    if (gridItems.length === 0) {
        showToast("No visible annotated elements found", "error");
        return;
    }

    // 2. Hide everything to get clean captures
    const restoreFns = [];
    restoreFns.push(hideElements(AGENTATION_SELECTORS.toolbar));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.settingsPanel));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.highlights));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.markers));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.overlay));
    restoreFns.push(hideElements(AGENTATION_SELECTORS.screenshotButtons));
    restoreFns.push(hideElements('#annotateweb-root'));

    await nextFrame();

    try {
        // 3. Send to background for processing
        // We capture the whole tab once, then background crops each item
        const response = await chrome.runtime.sendMessage({
            type: "CAPTURE_GRID_COMPOSITE",
            items: gridItems
        });

        restoreFns.forEach((fn) => fn());

        if (response.error) {
            showToast("Grid screenshot failed", "error");
            return;
        }

        const copied = await copyImageToClipboard(response.dataUrl);
        showToast(copied ? "Grid screenshot copied!" : "Grid screenshot ready, but clipboard access was blocked.", copied ? "success" : "error");
    } catch (err) {
        restoreFns.forEach((fn) => fn());
        console.error("Grid screenshot error:", err);
        showToast("Grid screenshot failed", "error");
    }
}

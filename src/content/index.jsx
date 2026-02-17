// AnnotateWeb — Content Script
// Injects Agentation's annotation toolbar into any webpage

import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Agentation, loadAnnotations } from "agentation";
import { initScreenshotButtons, captureFullPage, captureAnnotationGrid } from "./screenshot.js";

// ─── Global Message Handlers (popup actions) ────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SCREENSHOT_FULL_PAGE") {
        captureFullPage().then(() => sendResponse({ ok: true }));
        return true;
    }
    if (message.type === "SCREENSHOT_GRID") {
        captureAnnotationGrid().then(() => sendResponse({ ok: true }));
        return true;
    }
});

// ─── App Component ───────────────────────────────────────────────────────────

function AnnotateWebApp() {
    const [active, setActive] = useState(false);
    const observerRef = useRef(null);

    // Update badge count using loadAnnotations from Agentation's localStorage
    // Wrapped in timeout to ensure Agentation has finished writing to localStorage
    const updateBadgeCount = useCallback(() => {
        setTimeout(() => {
            const annotations = loadAnnotations(window.location.pathname);
            chrome.runtime.sendMessage({
                type: "ANNOTATION_COUNT",
                count: annotations.length,
            });
        }, 250);
    }, []);

    useEffect(() => {
        // Listen for activate/deactivate messages from background
        const messageHandler = (message) => {
            if (message.type === "ACTIVATE") {
                setActive(true);
            } else if (message.type === "DEACTIVATE") {
                setActive(false);
            }
        };
        chrome.runtime.onMessage.addListener(messageHandler);

        // Keyboard shortcut: Ctrl+Shift+. to toggle annotations
        const keyHandler = (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === ".") {
                e.preventDefault();
                setActive((prev) => !prev);
            }
        };
        document.addEventListener("keydown", keyHandler);

        // window.postMessage toggle (for testing / external integrations)
        const postMessageHandler = (e) => {
            if (e.data?.type === "ANNOTATEWEB_TOGGLE") {
                setActive((prev) => !prev);
            } else if (e.data?.type === "ANNOTATEWEB_ACTIVATE") {
                setActive(true);
            } else if (e.data?.type === "ANNOTATEWEB_DEACTIVATE") {
                setActive(false);
            }
        };
        window.addEventListener("message", postMessageHandler);

        return () => {
            chrome.runtime.onMessage.removeListener(messageHandler);
            document.removeEventListener("keydown", keyHandler);
            window.removeEventListener("message", postMessageHandler);
        };
    }, []);

    useEffect(() => {
        if (active) {
            // Watch for annotation markers and add screenshot buttons
            const timer = setTimeout(() => {
                initScreenshotButtons();
            }, 500);

            // Also observe for new markers being added
            observerRef.current = new MutationObserver(() => {
                initScreenshotButtons();
            });
            observerRef.current.observe(document.body, {
                childList: true,
                subtree: true,
            });

            return () => {
                clearTimeout(timer);
                if (observerRef.current) {
                    observerRef.current.disconnect();
                }
            };
        }
    }, [active]);

    if (!active) return null;

    return (
        <Agentation
            onAnnotationAdd={() => updateBadgeCount()}
            onAnnotationDelete={() => updateBadgeCount()}
            onAnnotationUpdate={() => updateBadgeCount()}
            onAnnotationsClear={() => updateBadgeCount()}
        />
    );
}

// ─── Mount ───────────────────────────────────────────────────────────────────

function mount() {
    // Avoid double-mounting
    if (document.getElementById("annotateweb-root")) return;

    const container = document.createElement("div");
    container.id = "annotateweb-root";
    // Style it to not interfere with page layout
    container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    z-index: 2147483647;
    pointer-events: none;
  `;
    document.body.appendChild(container);

    // Inject CSS overrides to fix Agentation settings panel sizing
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      /* Fix settings panel sizing in extension context */
      [class*="styles-module__settingsPanel___"] {
        min-width: 230px !important;
        box-sizing: border-box !important;
      }
      [class*="styles-module__settingsPanel___"] * {
        box-sizing: border-box !important;
      }
      /* Fix toggle switch sizing */
      [class*="styles-module__toggleSwitch___"] {
        width: 24px !important;
        height: 16px !important;
        min-width: 24px !important;
        flex-shrink: 0 !important;
      }
      [class*="styles-module__toggleSlider___"]::before {
        width: 12px !important;
        height: 12px !important;
      }
      /* Fix checkbox sizing */
      [class*="styles-module__customCheckbox___"] {
        width: 14px !important;
        height: 14px !important;
        min-width: 14px !important;
        flex-shrink: 0 !important;
      }
      /* Fix help icon alignment */
      [class*="styles-module__helpIcon___"] {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        vertical-align: middle !important;
        width: auto !important;
        height: auto !important;
      }
      [class*="styles-module__helpIcon___"] svg {
        width: 14px !important;
        height: 14px !important;
      }
      /* Fix settings row alignment */
      [class*="styles-module__settingsRow___"] {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 8px !important;
      }
      /* Fix settings label alignment */
      [class*="styles-module__settingsLabel___"] {
        display: flex !important;
        align-items: center !important;
        gap: 2px !important;
      }
      /* Fix color options sizing */
      [class*="styles-module__colorOption___"]:not([class*="Ring"]) {
        width: 20px !important;
        height: 20px !important;
        min-width: 20px !important;
        flex-shrink: 0 !important;
      }
      [class*="styles-module__colorOptionRing___"] {
        width: 24px !important;
        height: 24px !important;
        min-width: 24px !important;
      }
    `;
    document.head.appendChild(styleEl);

    // Let Agentation render into the page DOM directly
    // (it needs access to page elements for annotation)
    const root = createRoot(container);
    root.render(<AnnotateWebApp />);
}

// Mount when the content script loads
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
} else {
    mount();
}

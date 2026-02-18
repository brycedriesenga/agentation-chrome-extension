// AnnotateWeb — Content Script
// Injects Agentation's annotation toolbar into any webpage

import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Agentation, loadAnnotations } from "agentation";
import { initScreenshotButtons, captureFullPage, captureAnnotationGrid } from "./screenshot.js";
import { createMessageRouter } from "./message-router.js";
import { maybeImportFromHash } from "./share-sync.js";

const messageRouter = createMessageRouter({ captureFullPage, captureAnnotationGrid });
chrome.runtime.onMessage.addListener(messageRouter);


function findStartFeedbackButton() {
    return document.querySelector('[data-feedback-toolbar] button[title="Start feedback mode"], [data-feedback-toolbar][title="Start feedback mode"]');
}

function openFeedbackModeWithRetry() {
    const existing = findStartFeedbackButton();
    if (existing) {
        existing.click();
        return;
    }

    let attempts = 0;
    const maxAttempts = 80;
    const interval = setInterval(() => {
        const btn = findStartFeedbackButton();
        if (btn) {
            clearInterval(interval);
            btn.click();
            return;
        }

        attempts += 1;
        if (attempts >= maxAttempts) {
            clearInterval(interval);
        }
    }, 100);

    const observer = new MutationObserver(() => {
        const btn = findStartFeedbackButton();
        if (btn) {
            clearInterval(interval);
            observer.disconnect();
            btn.click();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => observer.disconnect(), 9000);
}

function AnnotateWebApp() {
    const [active, setActive] = useState(false);
    const [renderVersion, setRenderVersion] = useState(0);
    const observerRef = useRef(null);

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
        const messageHandler = (message) => {
            if (message.type === "ACTIVATE") {
                setActive(true);
                openFeedbackModeWithRetry();
            } else if (message.type === "DEACTIVATE") {
                setActive(false);
            }
        };
        chrome.runtime.onMessage.addListener(messageHandler);

        const keyHandler = (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === ".") {
                e.preventDefault();
                setActive((prev) => !prev);
            }
        };
        document.addEventListener("keydown", keyHandler);

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

        const openFeedbackHandler = () => {
            setActive(true);
            openFeedbackModeWithRetry();
        };
        window.addEventListener("ANNOTATEWEB_OPEN_FEEDBACK", openFeedbackHandler);

        const refreshHandler = () => {
            setRenderVersion((value) => value + 1);
            updateBadgeCount();
        };
        window.addEventListener("ANNOTATEWEB_REFRESH", refreshHandler);

        return () => {
            chrome.runtime.onMessage.removeListener(messageHandler);
            document.removeEventListener("keydown", keyHandler);
            window.removeEventListener("message", postMessageHandler);
            window.removeEventListener("ANNOTATEWEB_OPEN_FEEDBACK", openFeedbackHandler);
            window.removeEventListener("ANNOTATEWEB_REFRESH", refreshHandler);
        };
    }, [updateBadgeCount]);

    useEffect(() => {
        if (!active) return undefined;

        const timer = setTimeout(() => {
            initScreenshotButtons();
            openFeedbackModeWithRetry();
        }, 500);

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
    }, [active, renderVersion]);

    if (!active) return null;

    return (
        <Agentation
            key={renderVersion}
            onAnnotationAdd={() => updateBadgeCount()}
            onAnnotationDelete={() => updateBadgeCount()}
            onAnnotationUpdate={() => updateBadgeCount()}
            onAnnotationsClear={() => {
                // Clear resets count to 0 — no need to read from localStorage
                chrome.runtime.sendMessage({
                    type: "ANNOTATION_COUNT",
                    count: 0,
                });
            }}
        />
    );
}

function mount() {
    if (document.getElementById("annotateweb-root")) return;

    const container = document.createElement("div");
    container.id = "annotateweb-root";
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

    const styleEl = document.createElement("style");
    styleEl.textContent = `
      [class*="styles-module__settingsPanel___"] {
        min-width: 230px !important;
        box-sizing: border-box !important;
      }
      [class*="styles-module__settingsPanel___"] * {
        box-sizing: border-box !important;
      }
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
      [class*="styles-module__customCheckbox___"] {
        width: 14px !important;
        height: 14px !important;
        min-width: 14px !important;
        flex-shrink: 0 !important;
      }
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
      [class*="styles-module__settingsRow___"] {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 8px !important;
      }
      [class*="styles-module__settingsLabel___"] {
        display: flex !important;
        align-items: center !important;
        gap: 2px !important;
      }
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

    const root = createRoot(container);
    root.render(<AnnotateWebApp />);

    maybeImportFromHash();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
} else {
    mount();
}

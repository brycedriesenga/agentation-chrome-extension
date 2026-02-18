// AnnotateWeb — Popup Script
// Controls the extension toggle and actions from the popup UI

import {
    buildShareUrl,
    decodeSharePayload,
    encodeSharePayload,
    getShareHashPayload,
    validateSharePayload,
} from "../shared/share-payload.js";
import { getNormalizedPageKey } from "../shared/page-key.js";

const toggleSwitch = document.getElementById("toggleSwitch");
const statusDot = document.querySelector(".status-dot");
const statusText = document.querySelector(".status-text");
const screenshotBtn = document.getElementById("screenshotBtn");
const copyShareTextBtn = document.getElementById("copyShareTextBtn");
const copyShareUrlBtn = document.getElementById("copyShareUrlBtn");
const pasteShareBtn = document.getElementById("pasteShareBtn");
const gridScreenshotBtn = document.getElementById("gridScreenshotBtn");
const sharePanel = document.getElementById("sharePanel");
const shareInput = document.getElementById("shareInput");
const confirmImportBtn = document.getElementById("confirmImportBtn");
const cancelImportBtn = document.getElementById("cancelImportBtn");
const statusMessage = document.getElementById("statusMessage");

const URL_SIZE_LIMIT = 3500;

async function applyPopupTheme(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { type: "GET_AGENTATION_THEME" });
        const theme = response?.ok ? response.theme : null;
        document.body.classList.remove("theme-light", "theme-dark");
        document.body.classList.add(theme === "light" ? "theme-light" : "theme-dark");
    } catch {
        document.body.classList.remove("theme-light", "theme-dark");
        document.body.classList.add(window.matchMedia("(prefers-color-scheme: dark)").matches ? "theme-dark" : "theme-light");
    }
}

function setStatus(message, type = "info") {
    statusMessage.textContent = message;
    statusMessage.className = `status-message${type === "error" ? " error" : ""}`;
}

function closePopupForFocusSensitiveAction() {
    setTimeout(() => window.close(), 30);
}

function withButtonFeedback(button, text) {
    const label = button.querySelector("span:last-child");
    const original = label.textContent;
    label.textContent = text;
    setTimeout(() => {
        label.textContent = original;
    }, 1400);
}

async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function getSharePayload(tabId) {
    const response = await chrome.tabs.sendMessage(tabId, { type: "EXPORT_SHARE_DATA" });
    if (!response?.ok) {
        throw new Error(response?.error || "Failed to read annotations");
    }
    return response.payload;
}

function parsePastedInput(input) {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error("Paste share text or URL first.");
    }

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        const hashPayload = getShareHashPayload(trimmed);
        if (!hashPayload) throw new Error("No annotateweb payload found in URL hash.");
        return hashPayload;
    }

    return trimmed;
}

function getImportMode() {
    const selected = document.querySelector('input[name="importMode"]:checked');
    return selected ? selected.value : "replace";
}

function getSummaryText(summary) {
    const stats = [
        `Imported ${summary.imported}`,
        `Added ${summary.added ?? 0}`,
        `Updated ${summary.updated ?? 0}`,
    ];

    if (typeof summary.skippedDuplicates === "number") {
        stats.push(`Skipped ${summary.skippedDuplicates}`);
    }

    return `${stats.join(" • ")} (${summary.mode}).`;
}

async function init() {
    const tab = await getCurrentTab();
    if (!tab) return;

    const response = await chrome.runtime.sendMessage({
        type: "GET_STATE",
        tabId: tab.id,
    });

    updateUI(response.active);
    await applyPopupTheme(tab.id);

    toggleSwitch.addEventListener("change", async () => {
        const result = await chrome.runtime.sendMessage({
            type: "TOGGLE_ANNOTATIONS",
            tabId: tab.id,
        });
        updateUI(result.active);
        if (result.active) {
            await chrome.tabs.sendMessage(tab.id, { type: "OPEN_FEEDBACK_MODE" });
        }
    });

    screenshotBtn.addEventListener("click", () => {
        closePopupForFocusSensitiveAction();
        chrome.tabs.sendMessage(tab.id, { type: "SCREENSHOT_FULL_PAGE" }).catch(() => {});
    });

    gridScreenshotBtn.addEventListener("click", () => {
        closePopupForFocusSensitiveAction();
        chrome.tabs.sendMessage(tab.id, { type: "SCREENSHOT_GRID" }).catch(() => {});
    });

    copyShareTextBtn.addEventListener("click", async () => {
        try {
            const payload = await getSharePayload(tab.id);
            const encoded = await encodeSharePayload(payload);
            await navigator.clipboard.writeText(encoded);
            withButtonFeedback(copyShareTextBtn, "Copied!");
            setStatus(`Copied ${payload.annotations.length} annotation(s) as share text.`);
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    copyShareUrlBtn.addEventListener("click", async () => {
        try {
            const payload = await getSharePayload(tab.id);
            const encoded = await encodeSharePayload(payload);
            const shareUrl = buildShareUrl(tab.url, encoded);

            if (shareUrl.length > URL_SIZE_LIMIT) {
                await navigator.clipboard.writeText(encoded);
                withButtonFeedback(copyShareTextBtn, "Copied!");
                setStatus("Share URL too long. Copied share text instead.");
                return;
            }

            await navigator.clipboard.writeText(shareUrl);
            withButtonFeedback(copyShareUrlBtn, "Copied!");
            setStatus("Copied share URL with embedded annotations.");
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    pasteShareBtn.addEventListener("click", () => {
        sharePanel.hidden = false;
        shareInput.focus();
        setStatus("Paste share text or a share URL, then import.");
    });

    cancelImportBtn.addEventListener("click", () => {
        sharePanel.hidden = true;
        shareInput.value = "";
        setStatus("");
    });

    confirmImportBtn.addEventListener("click", async () => {
        try {
            const encoded = parsePastedInput(shareInput.value);
            const decoded = await decodeSharePayload(encoded);
            const validation = validateSharePayload(decoded);
            if (!validation.valid) {
                throw new Error(validation.message);
            }

            const payload = validation.payload;
            const currentPageKey = getNormalizedPageKey(tab.url);
            const mode = getImportMode();
            const mismatch = payload.pageKey !== currentPageKey;

            if (mismatch) {
                const proceed = window.confirm(
                    "This payload was created for another page path. Import anyway?"
                );
                if (!proceed) return;
            }

            const importResponse = await chrome.tabs.sendMessage(tab.id, {
                type: "IMPORT_SHARE_DATA",
                payload,
                mode,
            });

            if (!importResponse?.ok) {
                throw new Error(importResponse?.error || "Import failed.");
            }

            await chrome.tabs.sendMessage(tab.id, { type: "OPEN_FEEDBACK_MODE" });
            setStatus(getSummaryText(importResponse.summary));
            sharePanel.hidden = true;
            shareInput.value = "";
        } catch (error) {
            setStatus(error.message, "error");
        }
    });
}

function updateUI(isActive) {
    toggleSwitch.checked = isActive;

    if (isActive) {
        statusDot.className = "status-dot active";
        statusText.textContent = "Active";
    } else {
        statusDot.className = "status-dot inactive";
        statusText.textContent = "Inactive";
    }
}

init();

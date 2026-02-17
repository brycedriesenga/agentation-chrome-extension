// AnnotateWeb — Popup Script
// Controls the extension toggle and actions from the popup UI

const toggleSwitch = document.getElementById("toggleSwitch");
const statusDot = document.querySelector(".status-dot");
const statusText = document.querySelector(".status-text");
const badge = document.getElementById("badge");
const actions = document.getElementById("actions");
const screenshotBtn = document.getElementById("screenshotBtn");

// ─── Initialize ─────────────────────────────────────────────────────────────

async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Get current state from background
    const response = await chrome.runtime.sendMessage({
        type: "GET_STATE",
        tabId: tab.id,
    });

    updateUI(response.active);

    // Toggle handler
    toggleSwitch.addEventListener("change", async () => {
        const result = await chrome.runtime.sendMessage({
            type: "TOGGLE_ANNOTATIONS",
            tabId: tab.id,
        });
        updateUI(result.active);
    });

    const gridScreenshotBtn = document.getElementById("gridScreenshotBtn");

    // Screenshot button
    screenshotBtn.addEventListener("click", async () => {
        // Send message to content script to capture full page
        await chrome.tabs.sendMessage(tab.id, { type: "SCREENSHOT_FULL_PAGE" });
        // Brief feedback
        const originalText = screenshotBtn.querySelector("span:last-child").textContent;
        screenshotBtn.querySelector("span:last-child").textContent = "Captured!";
        setTimeout(() => {
            screenshotBtn.querySelector("span:last-child").textContent = originalText;
        }, 1500);
    });

    // Grid Screenshot button
    gridScreenshotBtn.addEventListener("click", async () => {
        // Send message to content script to capture grid
        await chrome.tabs.sendMessage(tab.id, { type: "SCREENSHOT_GRID" });
        // Brief feedback
        const originalText = gridScreenshotBtn.querySelector("span:last-child").textContent;
        gridScreenshotBtn.querySelector("span:last-child").textContent = "Captured!";
        setTimeout(() => {
            gridScreenshotBtn.querySelector("span:last-child").textContent = originalText;
        }, 1500);
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

import { detectAgentationTheme } from "./theme.js";
import { importShareHash, importSharePayload, exportShareData } from "./share-sync.js";

export function createMessageRouter({ captureFullPage, captureAnnotationGrid }) {
    return (message, sender, sendResponse) => {
        if (message.type === "SCREENSHOT_FULL_PAGE") {
            captureFullPage().then(() => sendResponse({ ok: true }));
            return true;
        }

        if (message.type === "SCREENSHOT_GRID") {
            captureAnnotationGrid().then(() => sendResponse({ ok: true }));
            return true;
        }

        if (message.type === "EXPORT_SHARE_DATA") {
            sendResponse(exportShareData());
            return false;
        }

        if (message.type === "GET_AGENTATION_THEME") {
            sendResponse({ ok: true, theme: detectAgentationTheme() });
            return false;
        }

        if (message.type === "OPEN_FEEDBACK_MODE") {
            window.dispatchEvent(new CustomEvent("ANNOTATEWEB_OPEN_FEEDBACK"));
            sendResponse({ ok: true });
            return false;
        }

        if (message.type === "IMPORT_SHARE_DATA") {
            importSharePayload(message.payload, message.mode)
                .then((result) => sendResponse(result))
                .catch((error) => sendResponse({ ok: false, code: "IMPORT_FAILED", error: error.message }));
            return true;
        }

        if (message.type === "IMPORT_SHARE_HASH") {
            importShareHash(message.encoded, message.mode || "replace")
                .then((result) => sendResponse(result))
                .catch((error) => sendResponse({ ok: false, code: "DECODE_FAILED", error: error.message }));
            return true;
        }

        return false;
    };
}

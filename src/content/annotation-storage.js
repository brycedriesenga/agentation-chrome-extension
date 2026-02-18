import { loadAnnotations } from "agentation";

export function getStorageKey(pathname = window.location.pathname) {
    return `feedback-annotations-${pathname}`;
}

export function readCurrentAnnotations() {
    return loadAnnotations(window.location.pathname);
}

export function writeAnnotations(annotations) {
    localStorage.setItem(getStorageKey(), JSON.stringify(annotations));
}

export function emitAnnotationCount() {
    const count = readCurrentAnnotations().length;
    try {
        chrome.runtime.sendMessage({ type: "ANNOTATION_COUNT", count });
    } catch {
        // Extension context invalidated (extension was reloaded without page refresh)
    }
}

export function requestAnnotationRefresh() {
    window.dispatchEvent(new CustomEvent("ANNOTATEWEB_REFRESH"));
}

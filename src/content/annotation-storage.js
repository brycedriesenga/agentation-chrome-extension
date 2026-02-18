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
    chrome.runtime.sendMessage({ type: "ANNOTATION_COUNT", count });
}

export function requestAnnotationRefresh() {
    window.dispatchEvent(new CustomEvent("ANNOTATEWEB_REFRESH"));
}

import {
    buildSharePayload,
    clearShareHash,
    decodeSharePayload,
    getCurrentPageKey,
    getShareHashPayload,
    mergeAnnotationCollections,
    normalizeAnnotation,
    validateSharePayload,
} from "../shared/share-payload.js";
import {
    emitAnnotationCount,
    readCurrentAnnotations,
    requestAnnotationRefresh,
    writeAnnotations,
} from "./annotation-storage.js";

export function exportShareData() {
    const annotations = readCurrentAnnotations().map((item) => normalizeAnnotation(item));
    const payload = buildSharePayload({
        pageKey: getCurrentPageKey(),
        sourceUrl: window.location.href,
        title: document.title,
        annotations,
    });

    return { ok: true, payload, count: annotations.length };
}

export async function importSharePayload(payload, mode = "replace") {
    const validation = validateSharePayload(payload);
    if (!validation.valid) {
        return { ok: false, code: validation.code, error: validation.message };
    }

    const validatedPayload = validation.payload;
    const currentPageKey = getCurrentPageKey();
    const pageMismatch = validatedPayload.pageKey !== currentPageKey;

    const incoming = validatedPayload.annotations.map((item) => normalizeAnnotation(item));
    const existing = readCurrentAnnotations().map((item) => normalizeAnnotation(item));

    let finalAnnotations = incoming;
    let summary = {
        existing: existing.length,
        imported: incoming.length,
        final: incoming.length,
        mode,
        added: incoming.length,
        updated: 0,
        skippedDuplicates: 0,
        conflictsResolved: 0,
    };

    if (mode === "merge") {
        const mergeResult = mergeAnnotationCollections(existing, incoming);
        finalAnnotations = mergeResult.annotations;
        summary = {
            existing: existing.length,
            imported: incoming.length,
            final: finalAnnotations.length,
            mode,
            ...mergeResult.summary,
        };
    }

    writeAnnotations(finalAnnotations);
    emitAnnotationCount();
    requestAnnotationRefresh();

    return {
        ok: true,
        pageMismatch,
        summary,
    };
}

export async function importShareHash(encoded, mode = "replace") {
    const payload = await decodeSharePayload(encoded);
    return importSharePayload(payload, mode);
}

export async function maybeImportFromHash() {
    const encoded = getShareHashPayload(window.location.href);
    if (!encoded) return;

    try {
        const payload = await decodeSharePayload(encoded);
        const validation = validateSharePayload(payload);
        if (!validation.valid) {
            console.warn("Invalid shared hash payload:", validation.message);
            return;
        }

        const mismatch = payload.pageKey !== getCurrentPageKey();
        const promptMessage = mismatch
            ? "This share link is for a different page path. Import anyway?"
            : `Import ${payload.annotations.length} shared annotation(s) from URL?`;

        const shouldImport = window.confirm(promptMessage);
        if (!shouldImport) return;

        const result = await importSharePayload(payload, "replace");
        if (result.ok) {
            clearShareHash();
            window.alert(`Imported ${result.summary.imported} annotation(s).`);
        }
    } catch (error) {
        console.error("Failed to import shared hash:", error);
    }
}

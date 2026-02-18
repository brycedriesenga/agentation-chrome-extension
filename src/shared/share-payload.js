import { getNormalizedPageKey } from "./page-key.js";

const SHARE_VERSION = 1;

function toBase64Url(bytes) {
    let binary = "";
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(encoded) {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function stableHash(input) {
    let hash = 5381;
    for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) + hash) + input.charCodeAt(i);
        hash &= 0xffffffff;
    }
    return Math.abs(hash).toString(36);
}

async function gzip(text) {
    if (typeof CompressionStream === "undefined") return null;
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
}

async function gunzip(bytes) {
    if (typeof DecompressionStream === "undefined") return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
}

function getAnnotationAnchorSignature(annotation = {}) {
    return [
        annotation.elementPath || "",
        annotation.element || "",
        annotation.selectedText || "",
        typeof annotation.x === "number" ? annotation.x.toFixed(4) : "",
        typeof annotation.y === "number" ? annotation.y.toFixed(2) : "",
        annotation.comment || "",
    ].join("|");
}

function hasValidAnchor(annotation = {}) {
    const hasPath = typeof annotation.elementPath === "string" && annotation.elementPath.length > 0;
    const hasElement = typeof annotation.element === "string" && annotation.element.length > 0;
    const hasCoordinates = typeof annotation.x === "number" && typeof annotation.y === "number";
    return hasPath || hasElement || hasCoordinates;
}

function normalizeTimestamp(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return fallback;
}

export function buildStableAnnotationId(annotation = {}) {
    const signature = getAnnotationAnchorSignature(annotation);
    return `ann_${stableHash(signature || JSON.stringify(annotation))}`;
}

export function normalizeAnnotation(annotation) {
    const now = Date.now();
    const clone = structuredClone(annotation || {});

    if (!clone.annotationId) {
        clone.annotationId = buildStableAnnotationId(clone);
    }

    clone.createdAt = normalizeTimestamp(clone.createdAt, now);
    clone.updatedAt = normalizeTimestamp(clone.updatedAt, now);

    return clone;
}

export function buildSharePayload({ pageKey, annotations, sourceUrl, title }) {
    return {
        v: SHARE_VERSION,
        pageKey,
        sourceUrl,
        title: title || "",
        createdAt: Date.now(),
        exportedBy: {
            app: "annotateweb",
            format: `share-v${SHARE_VERSION}`,
        },
        annotations: annotations.map((item) => normalizeAnnotation(item)),
    };
}

export function migrateSharePayload(payload) {
    if (!payload || typeof payload !== "object") return payload;

    // Legacy migration: payloads without version are treated as v1.
    if (payload.v == null && Array.isArray(payload.annotations) && typeof payload.pageKey === "string") {
        return {
            ...payload,
            v: SHARE_VERSION,
            createdAt: normalizeTimestamp(payload.createdAt, Date.now()),
            annotations: payload.annotations.map((item) => normalizeAnnotation(item)),
        };
    }

    if (payload.v === SHARE_VERSION) {
        return {
            ...payload,
            annotations: Array.isArray(payload.annotations)
                ? payload.annotations.map((item) => normalizeAnnotation(item))
                : payload.annotations,
        };
    }

    return payload;
}

export function validateSharePayload(payload) {
    const migrated = migrateSharePayload(payload);

    if (!migrated || typeof migrated !== "object") {
        return { valid: false, code: "INVALID_PAYLOAD", message: "Payload must be an object." };
    }

    if (migrated.v !== SHARE_VERSION) {
        return { valid: false, code: "UNSUPPORTED_VERSION", message: `Unsupported payload version: ${migrated.v}` };
    }

    if (typeof migrated.pageKey !== "string" || !migrated.pageKey) {
        return { valid: false, code: "INVALID_PAGE_KEY", message: "Payload page key is missing." };
    }

    if (!Array.isArray(migrated.annotations)) {
        return { valid: false, code: "INVALID_ANNOTATIONS", message: "Payload annotations must be an array." };
    }

    const invalidAnchor = migrated.annotations.find((item) => !hasValidAnchor(item));
    if (invalidAnchor) {
        return {
            valid: false,
            code: "INVALID_ANNOTATION_ANCHOR",
            message: "At least one annotation is missing required anchor fields.",
        };
    }

    return { valid: true, payload: migrated };
}

export function mergeAnnotationCollections(existing, incoming) {
    const byId = new Map();

    const normalizedExisting = existing.map((item) => normalizeAnnotation(item));
    const normalizedIncoming = incoming.map((item) => normalizeAnnotation(item));

    normalizedExisting.forEach((item) => {
        byId.set(item.annotationId, item);
    });

    let added = 0;
    let updated = 0;
    let skippedDuplicates = 0;
    let conflictsResolved = 0;

    normalizedIncoming.forEach((item) => {
        const current = byId.get(item.annotationId);
        if (!current) {
            byId.set(item.annotationId, item);
            added += 1;
            return;
        }

        const sameContent = JSON.stringify(current) === JSON.stringify(item);
        if (sameContent) {
            skippedDuplicates += 1;
            return;
        }

        const incomingIsNewer = (item.updatedAt || 0) >= (current.updatedAt || 0);
        byId.set(item.annotationId, incomingIsNewer ? item : current);
        updated += 1;
        conflictsResolved += 1;
    });

    return {
        annotations: Array.from(byId.values()),
        summary: { added, updated, skippedDuplicates, conflictsResolved },
    };
}

export async function encodeSharePayload(payload) {
    const json = JSON.stringify(payload);
    const compressed = await gzip(json);
    if (compressed) {
        return `gz.${toBase64Url(compressed)}`;
    }

    const plainBytes = new TextEncoder().encode(json);
    return `plain.${toBase64Url(plainBytes)}`;
}

export async function decodeSharePayload(encoded) {
    if (!encoded || typeof encoded !== "string") {
        throw new Error("Invalid encoded payload");
    }

    const [mode, data] = encoded.split(".", 2);
    if (!mode || !data) {
        throw new Error("Invalid encoded payload format");
    }

    const bytes = fromBase64Url(data);
    let json;

    if (mode === "gz") {
        const inflated = await gunzip(bytes);
        if (!inflated) throw new Error("Gzip decoding is unavailable in this browser");
        json = inflated;
    } else if (mode === "plain") {
        json = new TextDecoder().decode(bytes);
    } else {
        throw new Error("Unsupported encoding mode");
    }

    return JSON.parse(json);
}

export function buildShareUrl(currentUrl, encodedPayload) {
    const url = new URL(currentUrl);
    url.hash = `annotateweb=${encodedPayload}`;
    return url.toString();
}

export function getShareHashPayload(urlValue = window.location.href) {
    const url = new URL(urlValue);
    if (!url.hash) return null;
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const params = new URLSearchParams(hash);
    return params.get("annotateweb");
}

export function clearShareHash() {
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState(null, "", url.toString());
}

export function getCurrentPageKey() {
    return getNormalizedPageKey(window.location.href);
}

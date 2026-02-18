// AnnotateWeb — Background Service Worker
// Handles content script injection toggle, screenshot capture, and image compositing

// Track which tabs have the annotation toolbar active
const activeTabs = new Set();

// Listen for messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case "TOGGLE_ANNOTATIONS":
            handleToggle(message.tabId, sendResponse);
            return true; // async response

        case "GET_STATE":
            sendResponse({ active: activeTabs.has(message.tabId) });
            return false;

        case "CAPTURE_SCREENSHOT":
            handleScreenshot(sender.tab.id, message.rect, sendResponse);
            return true; // async response

        case "CAPTURE_AND_COMPOSITE":
            handleCaptureAndComposite(
                sender.tab.id,
                message.rect,
                message.annotationNumber,
                message.annotationComment,
                sendResponse
            );
            return true; // async response

        case "CAPTURE_FULLPAGE_COMPOSITE":
            handleFullpageComposite(
                sender.tab.id,
                message.annotations,
                sendResponse
            );
            return true; // async response

        case "CAPTURE_GRID_COMPOSITE":
            handleGridComposite(
                sender.tab.id,
                message.items,
                sendResponse
            );
            return true; // async response

        case "STITCH_FULLPAGE_COMPOSITE":
            handleStitchFullpage(message, sendResponse);
            return true;

        case "STITCH_GRID_COMPOSITE":
            handleStitchGrid(message, sendResponse);
            return true;

        case "ANNOTATION_COUNT":
            updateBadge(sender.tab.id, message.count);
            return false;
    }
});

// Toggle annotations on a tab
async function handleToggle(tabId, sendResponse) {
    try {
        if (activeTabs.has(tabId)) {
            try {
                await chrome.tabs.sendMessage(tabId, { type: "DEACTIVATE" });
            } catch { /* content script may already be gone */ }
            activeTabs.delete(tabId);
            await chrome.action.setBadgeText({ text: "", tabId });
            sendResponse({ active: false });
        } else {
            // Try sending ACTIVATE; if the content script isn't loaded yet,
            // inject it programmatically and retry.
            try {
                await chrome.tabs.sendMessage(tabId, { type: "ACTIVATE" });
            } catch {
                // Content script not loaded — inject it dynamically
                const manifest = chrome.runtime.getManifest();
                const contentScriptFiles = manifest.content_scripts?.[0]?.js || [];
                if (contentScriptFiles.length > 0) {
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        files: contentScriptFiles,
                    });
                    // Wait for it to mount
                    await new Promise((r) => setTimeout(r, 600));
                }
                // Retry
                try {
                    await chrome.tabs.sendMessage(tabId, { type: "ACTIVATE" });
                } catch (retryErr) {
                    console.warn("AnnotateWeb: retry sendMessage failed", retryErr);
                }
            }
            activeTabs.add(tabId);
            sendResponse({ active: true });
        }
    } catch (err) {
        console.error("AnnotateWeb toggle error:", err);
        sendResponse({ active: false, error: err.message });
    }
}

// Capture a screenshot of the visible tab, optionally cropped to a rect
async function handleScreenshot(tabId, rect, sendResponse) {
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: "png",
        });

        if (rect) {
            const cropped = await cropScreenshot(dataUrl, rect);
            sendResponse({ dataUrl: cropped });
        } else {
            sendResponse({ dataUrl });
        }
    } catch (err) {
        console.error("AnnotateWeb screenshot error:", err);
        sendResponse({ error: err.message });
    }
}

// Capture, crop, and composite with an annotation header
async function handleCaptureAndComposite(tabId, rect, annotationNumber, annotationComment, sendResponse) {
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: "png",
        });

        const composited = await compositeScreenshot(dataUrl, rect, annotationNumber, annotationComment);
        sendResponse({ dataUrl: composited });
    } catch (err) {
        console.error("AnnotateWeb composite screenshot error:", err);
        sendResponse({ error: err.message });
    }
}

// Capture and composite with a multi-annotation header for full-page screenshots
async function handleFullpageComposite(tabId, annotations, sendResponse) {
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: "png",
        });

        if (!annotations || annotations.length === 0) {
            // No annotations — just return the raw screenshot
            sendResponse({ dataUrl });
            return;
        }

        const composited = await compositeFullpageScreenshot(dataUrl, annotations);
        sendResponse({ dataUrl: composited });
    } catch (err) {
        console.error("AnnotateWeb fullpage composite error:", err);
        sendResponse({ error: err.message });
    }
}

// Capture and composite individually cropped elements into a grid
async function handleGridComposite(tabId, items, sendResponse) {
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: "png",
        });

        if (!items || items.length === 0) {
            sendResponse({ error: "No items to capture" });
            return;
        }

        const composited = await compositeGridScreenshot(dataUrl, items);
        sendResponse({ dataUrl: composited });
    } catch (err) {
        console.error("AnnotateWeb grid composite error:", err);
        sendResponse({ error: err.message });
    }
}

// Crop a data URL image to a rect using OffscreenCanvas
async function cropScreenshot(dataUrl, rect) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const dpr = rect.dpr || 1;
    const x = Math.round(rect.x * dpr);
    const y = Math.round(rect.y * dpr);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);

    const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
    const reader = new FileReader();

    return new Promise((resolve) => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(croppedBlob);
    });
}

/**
 * Composite a screenshot with an annotation header bar.
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │  ③  "Fix this button alignment"  │  ← dark header bar
 *   ├──────────────────────────────────┤
 *   │                                  │
 *   │     [clean element screenshot]   │
 *   │                                  │
 *   └──────────────────────────────────┘
 */
async function compositeScreenshot(dataUrl, rect, annotationNumber, annotationComment) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const dpr = rect.dpr || 1;
    const cropX = Math.round(rect.x * dpr);
    const cropY = Math.round(rect.y * dpr);
    const cropW = Math.round(rect.width * dpr);
    const cropH = Math.round(rect.height * dpr);

    // ─── Header dimensions ───────────────────────────────────────────────
    const scale = dpr; // scale all header metrics by DPR for crispness
    const headerPadding = Math.round(16 * scale);
    const headerPaddingRight = Math.round(16 * scale);
    const circleRadius = Math.round(14 * scale);
    const circleMarginRight = Math.round(10 * scale);
    const fontSize = Math.round(13 * scale);
    const circleFontSize = Math.round(12 * scale);
    const lineHeight = Math.round(18 * scale);
    const cornerRadius = Math.round(12 * scale);

    // ─── Text wrapping calculation ───────────────────────────────────────
    const MIN_WIDTH = Math.round(280 * scale);
    const MAX_TEXT_WIDTH = Math.round(400 * scale);

    // Use the crop width as preferred, but enforce min/max
    const imageWidth = Math.max(MIN_WIDTH, cropW);

    // Available width for comment text
    const textAreaLeft = headerPadding + circleRadius * 2 + circleMarginRight;
    const textAreaWidth = Math.min(
        MAX_TEXT_WIDTH,
        Math.max(MIN_WIDTH, imageWidth) - textAreaLeft - headerPaddingRight
    );

    // Measure and wrap text using an offscreen canvas
    const measureCanvas = new OffscreenCanvas(1, 1);
    const measureCtx = measureCanvas.getContext("2d");
    measureCtx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

    let wrappedLines = [];
    if (annotationComment) {
        wrappedLines = wrapText(measureCtx, annotationComment, textAreaWidth);
    }

    // Calculate header height based on text lines
    const textBlockHeight = wrappedLines.length > 0
        ? wrappedLines.length * lineHeight
        : lineHeight;
    const headerHeight = Math.max(
        Math.round(48 * scale),
        textBlockHeight + headerPadding * 2
    );

    // Final canvas - at least imageWidth wide, or wider if text needs it
    const finalWidth = Math.max(imageWidth, textAreaLeft + textAreaWidth + headerPaddingRight);
    const totalHeight = headerHeight + cropH;

    const canvas = new OffscreenCanvas(finalWidth, totalHeight);
    const ctx = canvas.getContext("2d");

    // ─── Draw the header background ──────────────────────────────────────
    ctx.fillStyle = "#1a1a1a";
    // Top rounded corners
    ctx.beginPath();
    ctx.moveTo(cornerRadius, 0);
    ctx.lineTo(finalWidth - cornerRadius, 0);
    ctx.quadraticCurveTo(finalWidth, 0, finalWidth, cornerRadius);
    ctx.lineTo(finalWidth, headerHeight);
    ctx.lineTo(0, headerHeight);
    ctx.lineTo(0, cornerRadius);
    ctx.quadraticCurveTo(0, 0, cornerRadius, 0);
    ctx.closePath();
    ctx.fill();

    // ─── Draw annotation number circle ───────────────────────────────────
    const circleX = headerPadding + circleRadius;
    const circleY = headerHeight / 2;

    ctx.fillStyle = "#3c82f7";
    ctx.beginPath();
    ctx.arc(circleX, circleY, circleRadius, 0, Math.PI * 2);
    ctx.fill();

    // Number text
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${circleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(annotationNumber, circleX, circleY);

    // ─── Draw comment text (wrapped) ─────────────────────────────────────
    if (wrappedLines.length > 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const textStartX = textAreaLeft;
        const textStartY = (headerHeight - textBlockHeight) / 2;

        wrappedLines.forEach((line, i) => {
            ctx.fillText(line, textStartX, textStartY + i * lineHeight);
        });
    }

    // ─── Draw the cropped screenshot below ───────────────────────────────
    // Center the screenshot if the header is wider
    const screenshotX = Math.round((finalWidth - cropW) / 2);
    ctx.drawImage(bitmap, cropX, cropY, cropW, cropH, screenshotX, headerHeight, cropW, cropH);

    // ─── Bottom rounded corners (clip) ───────────────────────────────────
    // Draw a mask for the bottom corners
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(finalWidth, 0);
    ctx.lineTo(finalWidth, totalHeight - cornerRadius);
    ctx.quadraticCurveTo(finalWidth, totalHeight, finalWidth - cornerRadius, totalHeight);
    ctx.lineTo(cornerRadius, totalHeight);
    ctx.quadraticCurveTo(0, totalHeight, 0, totalHeight - cornerRadius);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    // ─── Export ───────────────────────────────────────────────────────────
    const finalBlob = await canvas.convertToBlob({ type: "image/png" });
    const reader = new FileReader();

    return new Promise((resolve) => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(finalBlob);
    });
}

/**
 * Wrap text into lines that fit within a max width.
 */
function wrapText(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }

    return lines;
}

/**
 * Composite a full-page screenshot with a multi-annotation summary header.
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │  ①  Fix button alignment             │
 *   │  ②  Text colour too light            │
 *   │  ③  Add hover state to nav links     │
 *   ├──────────────────────────────────────┤
 *   │                                      │
 *   │      [full page screenshot]          │
 *   │                                      │
 *   └──────────────────────────────────────┘
 */
async function compositeFullpageScreenshot(dataUrl, annotations) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const imgW = bitmap.width;
    const imgH = bitmap.height;

    // Assume DPR from image vs typical viewport
    const scale = imgW > 2000 ? 2 : 1;

    // ─── Header metrics ──────────────────────────────────────────────────
    const headerPadding = Math.round(16 * scale);
    const rowGap = Math.round(8 * scale);
    const circleRadius = Math.round(12 * scale);
    const circleMarginRight = Math.round(10 * scale);
    const fontSize = Math.round(13 * scale);
    const circleFontSize = Math.round(11 * scale);
    const lineHeight = Math.round(18 * scale);
    const cornerRadius = Math.round(12 * scale);
    const dividerHeight = Math.round(1 * scale);

    // Text measurement
    const measureCanvas = new OffscreenCanvas(1, 1);
    const measureCtx = measureCanvas.getContext("2d");
    measureCtx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

    const textAreaLeft = headerPadding + circleRadius * 2 + circleMarginRight;
    const maxTextWidth = imgW - textAreaLeft - headerPadding;

    // Calculate rows and their wrapped text
    const rows = annotations.map((a) => {
        const text = a.comment || a.element || '';
        const lines = text ? wrapText(measureCtx, text, maxTextWidth) : [''];
        return {
            number: a.number,
            lines,
            height: Math.max(circleRadius * 2, lines.length * lineHeight),
        };
    });

    // Total header height
    const totalRowsHeight = rows.reduce((sum, r) => sum + r.height, 0)
        + (rows.length - 1) * rowGap;
    const headerHeight = totalRowsHeight + headerPadding * 2;

    // ─── Create canvas ───────────────────────────────────────────────────
    const totalHeight = headerHeight + dividerHeight + imgH;
    const canvas = new OffscreenCanvas(imgW, totalHeight);
    const ctx = canvas.getContext("2d");

    // ─── Header background ───────────────────────────────────────────────
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.moveTo(cornerRadius, 0);
    ctx.lineTo(imgW - cornerRadius, 0);
    ctx.quadraticCurveTo(imgW, 0, imgW, cornerRadius);
    ctx.lineTo(imgW, headerHeight);
    ctx.lineTo(0, headerHeight);
    ctx.lineTo(0, cornerRadius);
    ctx.quadraticCurveTo(0, 0, cornerRadius, 0);
    ctx.closePath();
    ctx.fill();

    // ─── Divider line ────────────────────────────────────────────────────
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fillRect(0, headerHeight, imgW, dividerHeight);

    // ─── Draw annotation rows ────────────────────────────────────────────
    let currentY = headerPadding;

    rows.forEach((row) => {
        const rowCenterY = currentY + row.height / 2;

        // Numbered circle
        ctx.fillStyle = "#3c82f7";
        ctx.beginPath();
        ctx.arc(headerPadding + circleRadius, rowCenterY, circleRadius, 0, Math.PI * 2);
        ctx.fill();

        // Number text
        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${circleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(row.number, headerPadding + circleRadius, rowCenterY);

        // Comment text
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const textStartY = rowCenterY - (row.lines.length * lineHeight) / 2;
        row.lines.forEach((line, i) => {
            ctx.fillText(line, textAreaLeft, textStartY + i * lineHeight);
        });

        currentY += row.height + rowGap;
    });

    // ─── Draw page screenshot below ──────────────────────────────────────
    ctx.drawImage(bitmap, 0, 0, imgW, imgH, 0, headerHeight + dividerHeight, imgW, imgH);

    // ─── Export ───────────────────────────────────────────────────────────
    const finalBlob = await canvas.convertToBlob({ type: "image/png" });
    const reader = new FileReader();

    return new Promise((resolve) => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(finalBlob);
    });
}

/**
 * Composite a grid of cropped element screenshots with the annotation summary header.
 */
async function compositeGridScreenshot(dataUrl, items) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const sourceBitmap = await createImageBitmap(blob);

    const imgW = sourceBitmap.width; // Base screenshot width
    // Assume DPR based on screenshot width
    const dpr = imgW > 2000 ? 2 : 1;
    const scale = dpr;

    // Header Metrics (same as fullpage)
    const headerPadding = Math.round(16 * scale);
    const rowGap = Math.round(8 * scale);
    const circleRadius = Math.round(12 * scale);
    const circleMarginRight = Math.round(10 * scale);
    const fontSize = Math.round(13 * scale);
    const circleFontSize = Math.round(11 * scale);
    const lineHeight = Math.round(18 * scale);
    const cornerRadius = Math.round(12 * scale);
    const dividerHeight = Math.round(1 * scale);
    const gridGap = Math.round(16 * scale);
    const itemPadding = Math.round(12 * scale);

    // 1. Calculate Header Height
    // Extract annotations for header
    const annotations = items.map(item => ({
        number: item.annotation.number,
        comment: item.annotation.comment
    }));

    const measureCanvas = new OffscreenCanvas(1, 1);
    const measureCtx = measureCanvas.getContext("2d");
    measureCtx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

    const textAreaLeft = headerPadding + circleRadius * 2 + circleMarginRight;
    const maxTextWidth = imgW - textAreaLeft - headerPadding;

    const rows = annotations.map((a) => {
        const text = a.comment || '';
        const lines = text ? wrapText(measureCtx, text, maxTextWidth) : [''];
        return {
            number: a.number,
            lines,
            height: Math.max(circleRadius * 2, lines.length * lineHeight),
        };
    });

    const totalRowsHeight = rows.reduce((sum, r) => sum + r.height, 0)
        + (rows.length - 1) * rowGap;
    const headerHeight = totalRowsHeight + headerPadding * 2;


    // 2. Calculate Grid Layout
    // We'll use a 2-column layout (or 1 if very narrow)
    const cols = 2;
    const colWidth = (imgW - (cols + 1) * gridGap) / cols;

    // Calculate scaling and height for each item to fit in column
    let currentCol = 0;
    const colHeights = new Array(cols).fill(headerHeight + dividerHeight + gridGap);

    const laidOutItems = items.map(item => {
        // Source crop rect
        const sX = Math.round(item.rect.x * item.rect.dpr);
        const sY = Math.round(item.rect.y * item.rect.dpr);
        const sW = Math.round(item.rect.width * item.rect.dpr);
        const sH = Math.round(item.rect.height * item.rect.dpr);

        // Aspect ratio
        const aspect = sW / sH;

        // Target dimensions in grid
        // Fit width to colWidth, adjust height
        const tW = colWidth;
        const tH = tW / aspect;

        // Find shortest column
        const colIndex = colHeights.indexOf(Math.min(...colHeights));

        const x = gridGap + colIndex * (colWidth + gridGap);
        const y = colHeights[colIndex];

        // Update column height
        // Add item height + caption/padding if we wanted, but for now just image
        // We'll draw the number badge ON the image
        const totalItemHeight = tH;
        colHeights[colIndex] += totalItemHeight + gridGap;

        return {
            ...item,
            sourceRect: { x: sX, y: sY, width: sW, height: sH },
            targetRect: { x, y, width: tW, height: tH }
        };
    });

    const totalGridHeight = Math.max(...colHeights);

    // 3. Draw Everything
    const canvas = new OffscreenCanvas(imgW, totalGridHeight);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    // Rounded top corners
    ctx.moveTo(cornerRadius, 0);
    ctx.lineTo(imgW - cornerRadius, 0);
    ctx.quadraticCurveTo(imgW, 0, imgW, cornerRadius);
    ctx.lineTo(imgW, totalGridHeight);
    ctx.lineTo(0, totalGridHeight);
    ctx.lineTo(0, cornerRadius);
    ctx.quadraticCurveTo(0, 0, cornerRadius, 0);
    ctx.closePath();
    ctx.fill();

    // Divider
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fillRect(0, headerHeight, imgW, dividerHeight);

    // Draw Header Rows
    let currentY = headerPadding;
    rows.forEach((row) => {
        const rowCenterY = currentY + row.height / 2;

        // Numbered circle
        ctx.fillStyle = "#3c82f7";
        ctx.beginPath();
        ctx.arc(headerPadding + circleRadius, rowCenterY, circleRadius, 0, Math.PI * 2);
        ctx.fill();

        // Number text
        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${circleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(row.number, headerPadding + circleRadius, rowCenterY);

        // Comment text
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const textStartY = rowCenterY - (row.lines.length * lineHeight) / 2;
        row.lines.forEach((line, i) => {
            ctx.fillText(line, textAreaLeft, textStartY + i * lineHeight);
        });

        currentY += row.height + rowGap;
    });

    // Draw Grid Items
    laidOutItems.forEach(item => {
        const { sourceRect, targetRect } = item;

        // Draw image
        // Draw background for image to ensure contrast if transparent
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);

        ctx.drawImage(
            sourceBitmap,
            sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
            targetRect.x, targetRect.y, targetRect.width, targetRect.height
        );

        // Draw Border
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 1 * scale;
        ctx.strokeRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);

        // Draw Badge on Image (Top Left)
        const badgeX = targetRect.x + 12 * scale;
        const badgeY = targetRect.y + 12 * scale;
        const badgeRadius = 10 * scale;

        ctx.fillStyle = "#3c82f7";
        ctx.beginPath();
        ctx.arc(badgeX + badgeRadius, badgeY + badgeRadius, badgeRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${10 * scale}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.annotation.number, badgeX + badgeRadius, badgeY + badgeRadius);
    });


    // Export
    const finalBlob = await canvas.convertToBlob({ type: "image/png" });
    const reader = new FileReader();
    return new Promise((resolve) => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(finalBlob);
    });
}

// ─── Scroll-and-stitch handlers ──────────────────────────────────────────────

/**
 * Handle stitching of viewport chunks into a full-page screenshot
 * with an annotation summary header.
 */
async function handleStitchFullpage(message, sendResponse) {
    try {
        const { chunks, annotations, pageHeight, viewportHeight, viewportWidth, dpr } = message;

        if (!chunks || chunks.length === 0) {
            sendResponse({ error: "No chunks to stitch" });
            return;
        }

        const result = await stitchFullpageComposite(chunks, annotations, pageHeight, viewportHeight, viewportWidth, dpr);
        sendResponse({ dataUrl: result });
    } catch (err) {
        console.error("AnnotateWeb stitch fullpage error:", err);
        sendResponse({ error: err.message });
    }
}

/**
 * Handle compositing of per-annotation cropped screenshots into a grid.
 */
async function handleStitchGrid(message, sendResponse) {
    try {
        const { items } = message;

        if (!items || items.length === 0) {
            sendResponse({ error: "No items to composite" });
            return;
        }

        const result = await stitchGridComposite(items);
        sendResponse({ dataUrl: result });
    } catch (err) {
        console.error("AnnotateWeb stitch grid error:", err);
        sendResponse({ error: err.message });
    }
}

/**
 * Stitch viewport chunks into a single tall image,
 * then add an annotation summary header at the top.
 */
async function stitchFullpageComposite(chunks, annotations, pageHeight, viewportHeight, viewportWidth, dpr) {
    // Decode all chunk bitmaps
    const chunkBitmaps = [];
    for (const chunk of chunks) {
        const resp = await fetch(chunk.dataUrl);
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        chunkBitmaps.push({ bitmap, scrollY: chunk.scrollY });
    }

    const imgW = chunkBitmaps[0].bitmap.width;
    const scale = imgW > 2000 ? 2 : 1;
    const totalPixelHeight = Math.round(pageHeight * dpr);
    const vpPixelHeight = chunkBitmaps[0].bitmap.height;

    // 1. Stitch chunks into one tall canvas
    const stitchCanvas = new OffscreenCanvas(imgW, totalPixelHeight);
    const stitchCtx = stitchCanvas.getContext("2d");

    // Sort chunks by scrollY and draw, deduplicating overlap
    chunkBitmaps.sort((a, b) => a.scrollY - b.scrollY);

    for (const { bitmap, scrollY } of chunkBitmaps) {
        const destY = Math.round(scrollY * dpr);
        stitchCtx.drawImage(bitmap, 0, destY);
    }

    // 2. Build annotation header (reuse same metrics as compositeFullpageScreenshot)
    if (!annotations || annotations.length === 0) {
        const finalBlob = await stitchCanvas.convertToBlob({ type: "image/png" });
        return await blobToDataUrl(finalBlob);
    }

    const headerPadding = Math.round(16 * scale);
    const rowGap = Math.round(8 * scale);
    const circleRadius = Math.round(12 * scale);
    const circleMarginRight = Math.round(10 * scale);
    const fontSize = Math.round(13 * scale);
    const circleFontSize = Math.round(11 * scale);
    const lineHeight = Math.round(18 * scale);
    const cornerRadius = Math.round(12 * scale);
    const dividerHeight = Math.round(1 * scale);

    const measureCanvas = new OffscreenCanvas(1, 1);
    const measureCtx = measureCanvas.getContext("2d");
    measureCtx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

    const textAreaLeft = headerPadding + circleRadius * 2 + circleMarginRight;
    const maxTextWidth = imgW - textAreaLeft - headerPadding;

    const rows = annotations.map((a) => {
        const text = a.comment || a.element || '';
        const lines = text ? wrapText(measureCtx, text, maxTextWidth) : [''];
        return {
            number: a.number,
            lines,
            height: Math.max(circleRadius * 2, lines.length * lineHeight),
        };
    });

    const totalRowsHeight = rows.reduce((sum, r) => sum + r.height, 0)
        + (rows.length - 1) * rowGap;
    const headerHeight = totalRowsHeight + headerPadding * 2;

    // 3. Create final canvas with header + stitched page
    const finalH = headerHeight + dividerHeight + totalPixelHeight;
    const canvas = new OffscreenCanvas(imgW, finalH);
    const ctx = canvas.getContext("2d");

    // Header bg
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.moveTo(cornerRadius, 0);
    ctx.lineTo(imgW - cornerRadius, 0);
    ctx.quadraticCurveTo(imgW, 0, imgW, cornerRadius);
    ctx.lineTo(imgW, headerHeight);
    ctx.lineTo(0, headerHeight);
    ctx.lineTo(0, cornerRadius);
    ctx.quadraticCurveTo(0, 0, cornerRadius, 0);
    ctx.closePath();
    ctx.fill();

    // Divider
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fillRect(0, headerHeight, imgW, dividerHeight);

    // Annotation rows
    let currentY = headerPadding;
    rows.forEach((row) => {
        const rowCenterY = currentY + row.height / 2;

        ctx.fillStyle = "#3c82f7";
        ctx.beginPath();
        ctx.arc(headerPadding + circleRadius, rowCenterY, circleRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${circleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(row.number, headerPadding + circleRadius, rowCenterY);

        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const textStartY = rowCenterY - (row.lines.length * lineHeight) / 2;
        row.lines.forEach((line, i) => {
            ctx.fillText(line, textAreaLeft, textStartY + i * lineHeight);
        });

        currentY += row.height + rowGap;
    });

    // Draw stitched page below header
    ctx.drawImage(stitchCanvas, 0, 0, imgW, totalPixelHeight, 0, headerHeight + dividerHeight, imgW, totalPixelHeight);

    const finalBlob = await canvas.convertToBlob({ type: "image/png" });
    return await blobToDataUrl(finalBlob);
}

/**
 * Composite per-annotation screenshot crops into a masonry grid
 * with annotation summary header and numbered badges.
 */
async function stitchGridComposite(items) {
    // Decode each item's screenshot and crop to the annotation rect
    const croppedBitmaps = [];
    for (const item of items) {
        const resp = await fetch(item.dataUrl);
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);

        const dpr = item.rect.dpr || 1;
        const sX = Math.round(item.rect.x * dpr);
        const sY = Math.round(item.rect.y * dpr);
        const sW = Math.round(item.rect.width * dpr);
        const sH = Math.round(item.rect.height * dpr);

        // Crop
        const cropCanvas = new OffscreenCanvas(sW, sH);
        const cropCtx = cropCanvas.getContext("2d");
        cropCtx.drawImage(bitmap, sX, sY, sW, sH, 0, 0, sW, sH);

        const cropBlob = await cropCanvas.convertToBlob({ type: "image/png" });
        const croppedBitmap = await createImageBitmap(cropBlob);
        croppedBitmaps.push({
            bitmap: croppedBitmap,
            annotation: item.annotation,
            width: sW,
            height: sH,
        });
    }

    // Use the first cropped bitmap's width to determine scale
    const firstItem = items[0];
    const dpr = firstItem.rect.dpr || 1;
    const imgW = Math.round((firstItem.rect.width * dpr) * 3); // approximate reasonable canvas width
    const clampedW = Math.max(imgW, 800); // minimum width
    const scale = clampedW > 2000 ? 2 : 1;

    // Header metrics
    const headerPadding = Math.round(16 * scale);
    const rowGap = Math.round(8 * scale);
    const circleRadius = Math.round(12 * scale);
    const circleMarginRight = Math.round(10 * scale);
    const fontSize = Math.round(13 * scale);
    const circleFontSize = Math.round(11 * scale);
    const lineHeight = Math.round(18 * scale);
    const cornerRadius = Math.round(12 * scale);
    const dividerHeight = Math.round(1 * scale);
    const gridGap = Math.round(16 * scale);

    const annotations = items.map(item => ({
        number: item.annotation.number,
        comment: item.annotation.comment
    }));

    const measureCanvas = new OffscreenCanvas(1, 1);
    const measureCtx = measureCanvas.getContext("2d");
    measureCtx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

    const textAreaLeft = headerPadding + circleRadius * 2 + circleMarginRight;
    const maxTextWidth = clampedW - textAreaLeft - headerPadding;

    const rows = annotations.map((a) => {
        const text = a.comment || '';
        const lines = text ? wrapText(measureCtx, text, maxTextWidth) : [''];
        return {
            number: a.number,
            lines,
            height: Math.max(circleRadius * 2, lines.length * lineHeight),
        };
    });

    const totalRowsHeight = rows.reduce((sum, r) => sum + r.height, 0)
        + (rows.length - 1) * rowGap;
    const headerHeight = totalRowsHeight + headerPadding * 2;

    // Grid layout — 2-column masonry
    const cols = 2;
    const colWidth = (clampedW - (cols + 1) * gridGap) / cols;
    const colHeights = new Array(cols).fill(headerHeight + dividerHeight + gridGap);

    const laidOutItems = croppedBitmaps.map((item) => {
        const aspect = item.width / item.height;
        const tW = colWidth;
        const tH = tW / aspect;

        const colIndex = colHeights.indexOf(Math.min(...colHeights));
        const x = gridGap + colIndex * (colWidth + gridGap);
        const y = colHeights[colIndex];
        colHeights[colIndex] += tH + gridGap;

        return { ...item, targetRect: { x, y, width: tW, height: tH } };
    });

    const totalGridHeight = Math.max(...colHeights);

    // Draw
    const canvas = new OffscreenCanvas(clampedW, totalGridHeight);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.moveTo(cornerRadius, 0);
    ctx.lineTo(clampedW - cornerRadius, 0);
    ctx.quadraticCurveTo(clampedW, 0, clampedW, cornerRadius);
    ctx.lineTo(clampedW, totalGridHeight);
    ctx.lineTo(0, totalGridHeight);
    ctx.lineTo(0, cornerRadius);
    ctx.quadraticCurveTo(0, 0, cornerRadius, 0);
    ctx.closePath();
    ctx.fill();

    // Divider
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fillRect(0, headerHeight, clampedW, dividerHeight);

    // Header rows
    let currentY = headerPadding;
    rows.forEach((row) => {
        const rowCenterY = currentY + row.height / 2;

        ctx.fillStyle = "#3c82f7";
        ctx.beginPath();
        ctx.arc(headerPadding + circleRadius, rowCenterY, circleRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${circleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(row.number, headerPadding + circleRadius, rowCenterY);

        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const textStartY = rowCenterY - (row.lines.length * lineHeight) / 2;
        row.lines.forEach((line, i) => {
            ctx.fillText(line, textAreaLeft, textStartY + i * lineHeight);
        });

        currentY += row.height + rowGap;
    });

    // Grid items with badges
    laidOutItems.forEach(item => {
        const { bitmap, targetRect, annotation } = item;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);

        ctx.drawImage(
            bitmap,
            0, 0, bitmap.width, bitmap.height,
            targetRect.x, targetRect.y, targetRect.width, targetRect.height
        );

        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 1 * scale;
        ctx.strokeRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);

        // Badge
        const badgeX = targetRect.x + 12 * scale;
        const badgeY = targetRect.y + 12 * scale;
        const badgeRadius = 10 * scale;

        ctx.fillStyle = "#3c82f7";
        ctx.beginPath();
        ctx.arc(badgeX + badgeRadius, badgeY + badgeRadius, badgeRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${10 * scale}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(annotation.number, badgeX + badgeRadius, badgeY + badgeRadius);
    });

    const finalBlob = await canvas.convertToBlob({ type: "image/png" });
    return await blobToDataUrl(finalBlob);
}

/** Convert a Blob to a data URL. */
function blobToDataUrl(blob) {
    const reader = new FileReader();
    return new Promise((resolve) => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

// Update the extension badge with annotation count
function updateBadge(tabId, count) {
    const text = count > 0 ? String(count) : "";
    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1", tabId });
}

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    activeTabs.delete(tabId);
});

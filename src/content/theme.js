const THEME_SELECTORS = [
    '[class*="styles-module__settingsPanel___"]',
    '[class*="styles-module__toolbar___"]',
    '[class*="styles-module__markerTooltip___"]',
];

function parseRgb(colorString = "") {
    const match = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance([r, g, b]) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function detectAgentationTheme() {
    const storedTheme = localStorage.getItem("feedback-toolbar-theme");
    if (storedTheme === "dark" || storedTheme === "light") {
        return storedTheme;
    }

    for (const selector of THEME_SELECTORS) {
        const el = document.querySelector(selector);
        if (!el) continue;

        const bg = getComputedStyle(el).backgroundColor;
        const rgb = parseRgb(bg);
        if (!rgb) continue;

        return luminance(rgb) < 0.5 ? "dark" : "light";
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getThemePalette() {
    const theme = detectAgentationTheme();

    if (theme === "light") {
        return {
            theme,
            buttonBorder: "rgba(0, 0, 0, 0.18)",
            buttonBg: "rgba(255, 255, 255, 0.95)",
            buttonColor: "#111111",
            markerBg: "#4f46e5",
            markerText: "#ffffff",
            markerShadow: "0 2px 4px rgba(0,0,0,0.16)",
            highlightBorder: "rgba(79, 70, 229, 0.55)",
            highlightBg: "rgba(79, 70, 229, 0.10)",
        };
    }

    return {
        theme,
        buttonBorder: "rgba(255, 255, 255, 0.30)",
        buttonBg: "rgba(30, 30, 40, 0.90)",
        buttonColor: "#ffffff",
        markerBg: "#6366f1",
        markerText: "#ffffff",
        markerShadow: "0 2px 4px rgba(0,0,0,0.25)",
        highlightBorder: "rgba(99, 102, 241, 0.60)",
        highlightBg: "rgba(99, 102, 241, 0.06)",
    };
}

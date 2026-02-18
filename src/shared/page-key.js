export function getNormalizedPageKey(input = window.location.href) {
    const url = new URL(input);
    let pathname = url.pathname || "/";

    if (pathname.length > 1 && pathname.endsWith("/")) {
        pathname = pathname.slice(0, -1);
    }

    return `${url.origin}${pathname}`;
}

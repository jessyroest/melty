// Security headers, shared by `vite preview`, the Cloudflare Pages `_headers`
// file written at build time, and `vercel.json` (scripts/gen-vercel.mjs).

/** @param {string} relayUrl e.g. wss://relay.example.workers.dev */
export function securityHeaders(relayUrl) {
  const relayOrigin = new URL(relayUrl).origin;
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src 'self' ${relayOrigin}`,
    "manifest-src 'self'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/** Cloudflare Pages `_headers` format */
export function pagesHeadersFile(headers) {
  return ["/*", ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`), ""].join("\n");
}

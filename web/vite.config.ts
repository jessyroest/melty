import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { pagesHeadersFile, securityHeaders } from "./headers.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const relayUrl = new URL(env.VITE_RELAY_URL || "ws://localhost:8787");
  const publicUrl = new URL(env.VITE_PUBLIC_ORIGIN || "http://localhost:4173");
  const headers = securityHeaders(relayUrl.href);
  // share mode: app and relay behind one public host (e.g. a tunnel to `vite preview`),
  // so preview forwards the relay's WebSocket path to the local relay
  const sameHostRelay = relayUrl.host === publicUrl.host;
  let outDir = "dist";

  return {
    plugins: [
      react(),
      {
        name: "pages-headers",
        apply: "build",
        // follow --outDir (e.g. dist-share) instead of assuming dist/
        configResolved(config) {
          outDir = resolve(config.root, config.build.outDir);
        },
        closeBundle() {
          writeFileSync(resolve(outDir, "_headers"), pagesHeadersFile(headers));
        },
      },
    ],
    resolve: {
      alias: { "@relay/protocol": fileURLToPath(new URL("../relay/src/protocol.ts", import.meta.url)) },
    },
    build: {
      // no inline scripts, no data: URIs (CSP allows neither)
      modulePreload: { polyfill: false },
      assetsInlineLimit: 0,
      sourcemap: false,
    },
    // strict CSP is enforced in preview and production. The dev server injects
    // inline scripts/styles for hot reload, so it runs without one.
    preview: {
      headers,
      allowedHosts: [publicUrl.hostname],
      proxy: sameHostRelay ? { "/rooms": { target: "ws://localhost:8787", ws: true } } : undefined,
    },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  };
});

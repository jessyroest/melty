import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
      {
        // the service worker: precaches the built app shell, nothing else (see sw.template.js)
        name: "service-worker",
        apply: "build",
        generateBundle(_opts, bundle) {
          const built = Object.keys(bundle).filter((f) => f.endsWith(".js") || f.endsWith(".css") || f.endsWith(".woff2"));
          const assets = ["/index.html", ...built.map((f) => `/${f}`), "/favicon.svg", "/brand/hero.webp", "/manifest.webmanifest"];
          const version = createHash("sha256").update(built.sort().join("\n")).digest("hex").slice(0, 12);
          const source = readFileSync(fileURLToPath(new URL("./sw.template.js", import.meta.url)), "utf8")
            .replace("__VERSION__", version)
            .replace("__ASSETS__", JSON.stringify(assets.sort()));
          this.emitFile({ type: "asset", fileName: "sw.js", source });
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
      proxy: sameHostRelay ? { "/ws": { target: "ws://localhost:8787", ws: true } } : undefined,
    },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  };
});

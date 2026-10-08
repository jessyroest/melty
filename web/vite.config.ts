import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { pagesHeadersFile, securityHeaders } from "./headers.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const headers = securityHeaders(env.VITE_RELAY_URL || "ws://localhost:8787");

  return {
    plugins: [
      react(),
      {
        name: "pages-headers",
        apply: "build",
        closeBundle() {
          writeFileSync("dist/_headers", pagesHeadersFile(headers));
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
    preview: { headers },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  };
});

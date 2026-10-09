// The promo video's scene. Not part of the app: `node scripts/promo-video.mjs` builds
// this with Vite, steps it frame by frame in a local Chromium and encodes the frames.
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist-promo", emptyOutDir: true, assetsInlineLimit: 0 },
});

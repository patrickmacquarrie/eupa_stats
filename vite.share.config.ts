import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds the public stats page as one script and one stylesheet, which
// scripts/build-share.ts then inlines into a single self-contained page.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist-share",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: { input: "share.html", output: { inlineDynamicImports: true } },
  },
} as any);

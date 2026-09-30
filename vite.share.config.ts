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
    // The public page is one file: fonts are inlined into its stylesheet.
    assetsInlineLimit: 200_000,
    rollupOptions: { input: "share.html", output: { inlineDynamicImports: true } },
  },
} as any);

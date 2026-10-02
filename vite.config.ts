import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Emits sw.js with this build's files (minus demo data) and a version that changes with them. */
function serviceWorker(): Plugin {
  return {
    name: "eupa-service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".json") && f !== "sw.js").sort();
      files.push("manifest.webmanifest", "manifest-entry.webmanifest", "icon.svg", "icon-192.png", "icon-entry-192.png");
      const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
      const source = readFileSync("scripts/sw-template.js", "utf8")
        .replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(files.map((f) => `./${f}`)));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// base "./" so the build works from any static host path (GitHub Pages, a subfolder, a file share).
export default defineConfig({
  base: "./",
  plugins: [react(), serviceWorker()],
  build: {
    // The Firebase SDK (about 600 KB) is its own chunk, downloaded only when an online league is
    // opened; everything else stays well under the default warning size.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: { manualChunks: (id: string) => (/node_modules\/(firebase|@firebase)\//.test(id) ? "firebase" : undefined) },
    },
  },
  test: { environment: "node", exclude: ["e2e/**", "tests-rules/**", "node_modules/**"] },
} as any);

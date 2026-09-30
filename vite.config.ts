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
      files.push("manifest.webmanifest", "icon.svg");
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
  test: { environment: "node", exclude: ["e2e/**", "node_modules/**"] },
} as any);

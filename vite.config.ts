import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the build works from any static host path (GitHub Pages, a subfolder, a file share).
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { environment: "node" },
} as any);

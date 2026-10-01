// Security-rule tests: run inside the Firestore emulator by `npm run test:rules`.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["tests-rules/**/*.test.ts"], environment: "node", testTimeout: 20000, fileParallelism: false } });

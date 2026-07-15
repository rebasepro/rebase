import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["test/e2e/**/*.test.ts"],
        testTimeout: 180_000 // 3 min — container startup + migrations
    }
});

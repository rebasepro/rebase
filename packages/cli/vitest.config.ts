import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.ts"],
        // The DB-backed suite runs under vitest.integration.config.ts. It is
        // excluded here because those tests start real databases, and the CPU
        // they take made unrelated fast tests time out on contention alone.
        exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
        testTimeout: 15_000
    }
});

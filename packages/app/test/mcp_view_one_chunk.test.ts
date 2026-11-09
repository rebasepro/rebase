import { withoutManualChunks } from "../src/mcp_view_build";

/**
 * The MCP view builds as one chunk from the app's own config file, and rolldown
 * refuses `manualChunks` beside `codeSplitting: false`. Every scaffold sets
 * `manualChunks: rebaseManualChunks`, so a leftover key failed `rebase build`.
 */
describe("withoutManualChunks", () => {
    it("removes manualChunks from one output object and keeps the rest", () => {
        const output = { manualChunks: () => "vendor", entryFileNames: "[name].js" };
        withoutManualChunks(output);
        expect(output).toEqual({ entryFileNames: "[name].js" });
    });

    it("removes it from every output in an array", () => {
        const outputs = [{ manualChunks: { vendor: ["react"] } }, { format: "es" }];
        withoutManualChunks(outputs);
        expect(outputs).toEqual([{}, { format: "es" }]);
    });

    it("leaves a config with no output alone", () => {
        expect(() => withoutManualChunks(undefined)).not.toThrow();
    });
});

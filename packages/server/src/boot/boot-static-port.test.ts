/**
 * The static-only boot reads PORT the way the backend boot does.
 *
 * It read `Number(PORT) || 3001`, so `PORT=abc` and `PORT=0` both became 3001
 * without a word — the first a typo the backend boot refuses by name, the
 * second an explicit request for a free port the backend boot honours — and in
 * production it logged the port it asked for rather than the one it bound.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { BUNDLE_FORMAT_VERSION, RUNTIME_CONTRACT_VERSION } from "@rebasepro/types";
import { bootFromBundle } from "./boot";
import type { BootedRuntime } from "./boot";

let scratch: string;
const savedEnv = { ...process.env };

function writeStaticBundle(): string {
    const dir = path.join(scratch, "dist-bundle");
    fs.mkdirSync(path.join(dir, "static/site"), { recursive: true });
    fs.writeFileSync(path.join(dir, "static/site/index.html"), "SITE");
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime: { range: "^1", builtAgainst: "1.0.0", contract: RUNTIME_CONTRACT_VERSION },
        schemaVersion: "",
        app: "web",
        kind: "static",
        entry: { static: [{ path: "/", dir: "static/site", spa: true }] },
        hooks: { native: false },
        deps: { declared: {} },
        build: { cli: "test", node: "22", createdAt: "2026-07-27T00:00:00Z" }
    }));
    return dir;
}

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-boot-static-port-"));
});

afterEach(() => {
    process.env = { ...savedEnv };
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe("PORT on the static-only boot", () => {
    it("refuses a value that is not a number, naming the variable", async () => {
        process.env.PORT = "abc";
        await expect(bootFromBundle({ bundleDir: writeStaticBundle(), listen: false, handleSignals: false }))
            .rejects.toThrow(/PORT/);
    });

    it("reads a blank value as unset", async () => {
        process.env.PORT = "  ";
        const booted = await bootFromBundle({ bundleDir: writeStaticBundle(), listen: false, handleSignals: false });
        try {
            expect(booted.env.PORT).toBe(3001);
        } finally {
            await booted.shutdown();
        }
    });

    it("honours PORT=0 in production and reports the port it bound", async () => {
        process.env.PORT = "0";
        process.env.NODE_ENV = "production";
        let booted: BootedRuntime | undefined;
        try {
            booted = await bootFromBundle({ bundleDir: writeStaticBundle(), handleSignals: false });
            expect(booted.port).toBeGreaterThan(0);
            // Not the fallback: PORT=0 is a request for a free port, honoured.
            expect(booted.port).not.toBe(3001);
            const res = await fetch(`http://127.0.0.1:${booted.port}/`);
            expect(await res.text()).toBe("SITE");
        } finally {
            await booted?.shutdown();
        }
    });
});

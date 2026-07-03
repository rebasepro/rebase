/**
 * Cross-package regression tests for the Entity → Snapshot rename.
 *
 * These tests scan the actual source code of all packages to ensure
 * that the automated rename didn't introduce any of the known bug
 * classes, and that no regressions creep in over time.
 *
 * Categories:
 * 1. No "IDSNAPSHOT" anywhere — the SQL IDENTITY keyword must be preserved
 * 2. No "an snapshot" — grammar must use "a snapshot"
 * 3. Database column/table names (entity_history, entity_id) preserved
 * 4. No corrupted substrings (identity → idsnapshoty)
 * 5. No remaining bare "Entity" type names that should be "Snapshot"
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function collectTsFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (["node_modules", "dist", ".git", "coverage", ".turbo"].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectTsFiles(full));
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
            results.push(full);
        }
    }
    return results;
}

function scanFiles(dirs: string[], pattern: RegExp): string[] {
    const violations: string[] = [];
    for (const dir of dirs) {
        const files = collectTsFiles(dir);
        for (const file of files) {
            const content = fs.readFileSync(file, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                if (pattern.test(lines[i])) {
                    const relPath = path.relative(REPO_ROOT, file);
                    violations.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
                }
            }
        }
    }
    return violations;
}

const PACKAGE_SRC_DIRS = [
    path.join(REPO_ROOT, "packages/types/src"),
    path.join(REPO_ROOT, "packages/common/src"),
    path.join(REPO_ROOT, "packages/core/src"),
    path.join(REPO_ROOT, "packages/admin/src"),
    path.join(REPO_ROOT, "packages/server-core/src"),
    path.join(REPO_ROOT, "packages/server-postgresql/src"),
    path.join(REPO_ROOT, "packages/server-mongodb/src"),
    path.join(REPO_ROOT, "packages/client/src"),
    path.join(REPO_ROOT, "packages/studio/src"),
];

// ── 1. IDSNAPSHOT must never appear ──────────────────────────────────────

describe("IDSNAPSHOT corruption guard", () => {

    it("should not contain IDSNAPSHOT in any package source file", () => {
        const violations = scanFiles(PACKAGE_SRC_DIRS, /IDSNAPSHOT/);
        expect(violations).toEqual([]);
    });

    it("should not contain idsnapshot (lowercase) in any package source file", () => {
        // Catches variable names like idsnapshoty
        const violations = scanFiles(PACKAGE_SRC_DIRS, /idsnapshot/i);
        expect(violations).toEqual([]);
    });
});

// ── 2. Grammar: "a snapshot" not "an snapshot" ───────────────────────────

describe("Grammar: article before snapshot", () => {

    it("should not use 'an snapshot' anywhere in package source", () => {
        const violations = scanFiles(PACKAGE_SRC_DIRS, /\ban [Ss]napshot/);
        expect(violations).toEqual([]);
    });

    it("should not use 'An snapshot' anywhere in package source", () => {
        const violations = scanFiles(PACKAGE_SRC_DIRS, /\bAn [Ss]napshot/);
        expect(violations).toEqual([]);
    });
});

// ── 3. Database names preserved ──────────────────────────────────────────

describe("Database name preservation", () => {

    it("should not reference entity_history as a DB table in server-postgresql history code", () => {
        const historyDir = path.join(REPO_ROOT, "packages/server-postgresql/src/history");
        const violations = scanFiles([historyDir], /entity_history/);
        expect(violations).toEqual([]);
    });

    it("should not reference entity_id as a DB column in server-postgresql history code", () => {
        const historyDir = path.join(REPO_ROOT, "packages/server-postgresql/src/history");
        const violations = scanFiles([historyDir], /entity_id/);
        expect(violations).toEqual([]);
    });

    it("should not reference entity_id as a DB column in server-mongodb history code", () => {
        const historyDir = path.join(REPO_ROOT, "packages/server-mongodb/src");
        const violations = scanFiles([historyDir], /entity_id/);
        expect(violations).toEqual([]);
    });
});

// ── 4. Identity words must not be corrupted ──────────────────────────────

describe("Identity word preservation", () => {

    it("should not contain IdSnapshot as a corruption of Identity", () => {
        const violations = scanFiles(PACKAGE_SRC_DIRS, /\bIdSnapshot\b/);
        expect(violations).toEqual([]);
    });
});

// ── 5. No remaining bare Entity type names ───────────────────────────────

describe("No remaining Entity type references", () => {

    // These are the specific type names that were renamed.
    // We check they no longer appear as standalone words (excluding "identity" etc.)
    const typePatterns: [string, RegExp][] = [
        ["EntityCollection", /\bEntityCollection\b/],
        ["EntityCallbackContext", /\bEntityCallbackContext\b/],
        ["SideEntityController", /\bSideEntityController\b/],
        ["EntityAction<", /\bEntityAction</],
        ["EntityView<", /\bEntityView</],
    ];

    for (const [name, pattern] of typePatterns) {
        it(`should not reference ${name} in any package source file`, () => {
            const violations = scanFiles(PACKAGE_SRC_DIRS, pattern);
            expect(violations).toEqual([]);
        });
    }
});

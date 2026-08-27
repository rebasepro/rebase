/**
 * Cross-package regression tests for the Snapshot → Entity rename-back.
 *
 * These tests scan the actual source code of all packages to ensure
 * that the record noun is "entity" everywhere, and "snapshot" only
 * appears in the history feature (point-in-time copies).
 *
 * Categories:
 * 1. No "Snapshot" as the record noun (type/interface/component names)
 * 2. No "Record"-nouned components (RecordPreviewBinding, etc.)
 * 3. Firebase SDK exceptions are preserved (DocumentSnapshot, etc.)
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
    path.join(REPO_ROOT, "packages/app/src"),
    path.join(REPO_ROOT, "packages/cms/src"),
    path.join(REPO_ROOT, "packages/server/src"),
    path.join(REPO_ROOT, "packages/server-postgres/src"),
    path.join(REPO_ROOT, "packages/server-mongo/src"),
    path.join(REPO_ROOT, "packages/client/src"),
    path.join(REPO_ROOT, "packages/studio/src"),
];

// ── 0. Positive control ──────────────────────────────────────────────────

/**
 * Every test below asserts that a scan found *nothing*. `collectTsFiles`
 * returns `[]` for a directory that does not exist, so renaming or moving a
 * package silently turns this whole file into eleven assertions that `[]`
 * equals `[]`. This control fails loudly in that case, instead of the rest
 * reporting green over an empty scan.
 */
describe("scan coverage", () => {

    it("every scanned directory exists and yields source files", () => {
        for (const dir of PACKAGE_SRC_DIRS) {
            const relative = path.relative(REPO_ROOT, dir);
            expect({ relative,
exists: fs.existsSync(dir) }).toEqual({ relative,
exists: true });
            expect({ relative,
hasFiles: collectTsFiles(dir).length > 0 }).toEqual({ relative,
hasFiles: true });
        }
    });

    it("the scanner reports matches when the pattern is present", () => {
        // A scanner that always returned [] would pass every test in this file.
        // "Entity" is the noun the rename settled on, so it is everywhere.
        expect(scanFiles(PACKAGE_SRC_DIRS, /\bEntity\b/).length).toBeGreaterThan(100);
    });
});

// ── 1. No Snapshot-noun type names (except Firebase SDK) ─────────────────

describe("No Snapshot as record noun", () => {

    // These Snapshot-named types/interfaces should NOT exist — they should be Entity-named
    const snapshotTypePatterns: [string, RegExp][] = [
        ["SnapshotValues", /\bSnapshotValues\b/],
        ["SnapshotStatus", /\bSnapshotStatus\b/],
        ["SnapshotAction<", /\bSnapshotAction</],
        ["SnapshotCustomView", /\bSnapshotCustomView\b/],
        ["SnapshotForm", /\bSnapshotForm\b/],
        ["SnapshotTableController", /\bSnapshotTableController\b/],
    ];

    for (const [name, pattern] of snapshotTypePatterns) {
        it(`should not reference ${name} in any package source file`, () => {
            const violations = scanFiles(PACKAGE_SRC_DIRS, pattern);
            expect(violations).toEqual([]);
        });
    }
});

// ── 2. No Record-nouned components ───────────────────────────────────────

describe("No Record-nouned components", () => {

    const recordPatterns: [string, RegExp][] = [
        ["RecordPreviewBinding", /\bRecordPreviewBinding\b/],
        ["RecordCardBinding", /\bRecordCardBinding\b/],
        ["RecordViewBinding", /\bRecordViewBinding\b/],
        ["EditorRecordAction", /\bEditorRecordAction\b/],
        ["RecordActionsSelectDialog", /\bRecordActionsSelectDialog\b/],
    ];

    for (const [name, pattern] of recordPatterns) {
        it(`should not reference ${name} in any package source file`, () => {
            const violations = scanFiles(PACKAGE_SRC_DIRS, pattern);
            expect(violations).toEqual([]);
        });
    }
});

// ── 3. Firebase SDK names preserved ──────────────────────────────────────

describe("Firebase SDK names preserved", () => {

    it("should still reference DocumentSnapshot in firebase", () => {
        const firebaseDir = path.join(REPO_ROOT, "packages/firebase/src");
        const files = collectTsFiles(firebaseDir);
        const hasDocumentSnapshot = files.some(file => {
            const content = fs.readFileSync(file, "utf-8");
            return /\bDocumentSnapshot\b/.test(content);
        });
        expect(hasDocumentSnapshot).toBe(true);
    });

    it("should still reference onSnapshot in firebase", () => {
        const firebaseDir = path.join(REPO_ROOT, "packages/firebase/src");
        const files = collectTsFiles(firebaseDir);
        const hasOnSnapshot = files.some(file => {
            const content = fs.readFileSync(file, "utf-8");
            return /\bonSnapshot\b/.test(content);
        });
        expect(hasOnSnapshot).toBe(true);
    });
});

import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import type { SchemaReconcilePlan } from "@rebasepro/types";
import { describeReconcilePlan, parseReconcileArgs } from "./schema-reconcile";

describe("rebase schema reconcile", () => {
    it("reads every --drop, and --yes", () => {
        expect(parseReconcileArgs(["schema", "reconcile", "--drop", "a.b", "--drop", "a.c", "-y"]))
            .toEqual({ drop: ["a.b", "a.c"], yes: true });
        expect(parseReconcileArgs(["schema", "reconcile"])).toEqual({ drop: [], yes: false });
    });

    it("refuses a stray argument rather than reading it as a column", () => {
        expect(() => parseReconcileArgs(["schema", "reconcile", "voice_cache.wav"])).toThrow(/--drop|Unexpected/);
    });

    it("shows what is relaxed, what is dropped with the data at stake, and what is kept", () => {
        const plan: SchemaReconcilePlan = {
            relaxed: [{ collection: "voice_cache", table: "public.voice_cache", column: "wav" }],
            undeclared: [
                { collection: "voice_cache", table: "public.voice_cache", column: "legacy", blocksInserts: true },
                { collection: "voice_cache", table: "public.voice_cache", column: "note", blocksInserts: false }
            ],
            dropped: [{ collection: "voice_cache", table: "public.voice_cache", column: "legacy", blocksInserts: true, rowsWithValue: 12408 }],
            statements: ["…"],
            problems: [],
            digest: "d"
        };
        const lines = describeReconcilePlan(plan).map(stripVTControlCharacters);
        expect(lines[0]).toMatch(/^ {2}relax {2}public\.voice_cache\.wav/);
        expect(lines[1]).toMatch(/drop {3}public\.voice_cache\.legacy {2}12,408 row\(s\) hold a value/);
        expect(lines[2]).toMatch(/keep {3}public\.voice_cache\.note {2}no table declares it/);
        expect(lines).toHaveLength(3);
    });

    it("shows an undeclared column it relaxes once, as kept with its data, not also as blocking", () => {
        const plan: SchemaReconcilePlan = {
            relaxed: [{ collection: "voice_cache", table: "public.voice_cache", column: "wav", undeclared: true }],
            undeclared: [{ collection: "voice_cache", table: "public.voice_cache", column: "wav", blocksInserts: true }],
            dropped: [],
            statements: ["…"],
            problems: [],
            digest: "d"
        };
        const lines = describeReconcilePlan(plan).map(stripVTControlCharacters);
        expect(lines).toEqual([
            `  relax  public.voice_cache.wav  "voice_cache" does not declare it, and every insert fails on it; its data stays`
        ]);
    });
});

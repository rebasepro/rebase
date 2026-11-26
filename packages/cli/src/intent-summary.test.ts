import { describe, expect, it } from "vitest";
import {
    formatCliIntentSummary,
    formatMigrationIntentHeader,
    summarizeSqlIntent
} from "./intent-summary";

describe("SQL intent summary (Change Guide)", () => {
    const sampleSql = `
        CREATE TABLE public.invoices (id uuid primary key, amount numeric not null);
        ALTER TABLE public.posts DROP COLUMN legacy_slug;
        ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
        CREATE POLICY invoices_owner ON public.invoices FOR ALL USING (owner_id = auth.uid());
        CREATE INDEX idx_invoices_amount ON public.invoices (amount);
    `;

    it("classifies destructive, access/RLS, additive, and mechanical statements", () => {
        const result = summarizeSqlIntent(sampleSql);
        expect(result.destructive).toHaveLength(1);
        expect(result.access).toHaveLength(2);
        expect(result.additive).toHaveLength(1);
        expect(result.mechanical).toHaveLength(1);
        expect(result.meaningfulCount).toBe(4);
        expect(result.headline).toContain("1 destructive/breaking");
        expect(result.headline).toContain("2 access/RLS");
        expect(result.headline).toContain("1 additive");
    });

    it("formats a SQL migration header comment with destructive and access highlights", () => {
        const header = formatMigrationIntentHeader(sampleSql);
        expect(header).toContain("-- Intent Summary:");
        expect(header).toContain("-- [DESTRUCTIVE]");
        expect(header).toContain("-- [ACCESS/RLS]");
        expect(header).toContain("filtered mechanical: 1");
    });

    it("formats a human-readable CLI Change Guide block", () => {
        const cli = formatCliIntentSummary(sampleSql);
        expect(cli).toContain("Change Guide:");
        expect(cli).toContain("! Destructive (1):");
        expect(cli).toContain("~ Access / RLS (2):");
        expect(cli).toContain("+ Additive (1):");
        expect(cli).toContain("Mechanical (1 index/trigger statements filtered)");
    });
});

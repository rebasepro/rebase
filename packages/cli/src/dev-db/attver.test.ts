import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { blankAttverOptions, stripAttverFromArchive } from "./attver";

/** The TABLE entry pg_restore refused in CI (2026-11-13): pg_dump from the runner, server postgres:18-alpine. */
const CI_DEFINITION = [
    "CREATE TABLE public.authors (",
    "    id integer NOT NULL,",
    "    name text NOT NULL,",
    "    avatar bytea",
    ");",
    "ALTER TABLE ONLY public.authors ALTER COLUMN id SET (pg_attver=33846480);",
    "ALTER TABLE ONLY public.authors ALTER COLUMN name SET (pg_attver=33846480);",
    "ALTER TABLE ONLY public.authors ALTER COLUMN avatar SET (pg_attver=33846480);",
    "",
    ""
].join("\n");

describe("blankAttverOptions", () => {
    it("blanks the statements that only set pg_attver, keeping the length", () => {
        const blanked = blankAttverOptions(CI_DEFINITION);

        expect(blanked).not.toContain("pg_attver");
        expect(blanked).toContain("CREATE TABLE public.authors (");
        expect(Buffer.byteLength(blanked)).toBe(Buffer.byteLength(CI_DEFINITION));
        expect(blanked.split("\n").slice(5, 8).every((line) => line.trim() === "")).toBe(true);
    });

    it("keeps the other attribute options of a column", () => {
        const first = "ALTER TABLE ONLY public.t ALTER COLUMN c SET (pg_attver=7, n_distinct=5);";
        const later = "ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct=5, pg_attver=7);";
        const middle = "ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct=5, pg_attver=7, n_distinct_inherited=3);";

        for (const statement of [first, later, middle]) {
            const blanked = blankAttverOptions(statement);
            expect(blanked).not.toContain("pg_attver");
            expect(blanked.replace(/ +/g, " ")).toContain("n_distinct=5");
            expect(blanked.length).toBe(statement.length);
        }
        expect(blankAttverOptions(middle)).toContain("n_distinct_inherited=3);");
    });

    it("counts bytes, not characters, for a name outside ASCII", () => {
        const statement = "ALTER TABLE ONLY public.\"café\" ALTER COLUMN \"naïve\" SET (pg_attver=1);";
        const blanked = blankAttverOptions(statement);

        expect(blanked.trim()).toBe("");
        expect(Buffer.byteLength(blanked)).toBe(Buffer.byteLength(statement));
    });

    it("leaves a definition without pg_attver, and a row that mentions it, alone", () => {
        const other = "ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct=5);";
        const comment = "COMMENT ON TABLE public.t IS 'SET (pg_attver=1);';";

        expect(blankAttverOptions(other)).toBe(other);
        expect(blankAttverOptions(comment)).toBe(comment);
    });
});

/** Writes `ReadInt`/`ReadStr`/`ReadOffset` the way pg_dump's custom format does (intSize 4, offSize 8). */
class ArchiveWriter {
    private readonly parts: Buffer[] = [];
    length = 0;

    raw(bytes: Buffer): void {
        this.parts.push(bytes);
        this.length += bytes.length;
    }

    byte(value: number): void {
        this.raw(Buffer.from([value]));
    }

    int(value: number): void {
        const digits = Buffer.alloc(4);
        digits.writeUInt32LE(Math.abs(value));
        this.byte(value < 0 ? 1 : 0);
        this.raw(digits);
    }

    str(text: string | null): void {
        if (text === null) return this.int(-1);
        const bytes = Buffer.from(text, "utf8");
        this.int(bytes.length);
        this.raw(bytes);
    }

    offset(set: boolean, value: number): void {
        const digits = Buffer.alloc(8);
        digits.writeBigUInt64LE(BigInt(value));
        this.byte(set ? 2 : 1);
        this.raw(digits);
    }

    buffer(): Buffer {
        return Buffer.concat(this.parts);
    }
}

interface Entry {
    tag: string;
    desc: string;
    defn: string;
    data?: Buffer;
}

/** A version 1.16 custom-format archive (pg_dump 18): header, TOC, then each entry's data block. */
function archive(entries: Entry[]): Buffer {
    const tocFor = (offsets: number[]): ArchiveWriter => {
        const w = new ArchiveWriter();
        w.raw(Buffer.from("PGDMP", "latin1"));
        w.byte(1); w.byte(16); w.byte(0); // version 1.16.0
        w.byte(4); w.byte(8); w.byte(1); // intSize, offSize, archCustom
        w.byte(0); // compression: none
        for (const value of [0, 0, 0, 13, 10, 126, 0]) w.int(value);
        w.str("app"); w.str("18.5"); w.str("18.4");
        w.int(entries.length);
        entries.forEach((entry, i) => {
            w.int(i + 1); w.int(entry.data ? 1 : 0);
            w.str("1259"); w.str(String(16_000 + i)); w.str(entry.tag); w.str(entry.desc);
            w.int(entry.data ? 3 : 2); // SECTION_DATA / SECTION_PRE_DATA
            w.str(entry.defn); w.str(""); w.str(entry.data ? `COPY public.${entry.tag} FROM stdin;\n` : "");
            w.str("public"); w.str(""); w.str("heap"); w.int(114);
            w.str(""); w.str("false");
            if (i > 0) w.str("1");
            w.str(null);
            w.offset(Boolean(entry.data), offsets[i] ?? 0);
        });
        return w;
    };
    const tocLength = tocFor(entries.map(() => 0)).length;
    const offsets: number[] = [];
    let at = tocLength;
    for (const entry of entries) {
        offsets.push(at);
        if (entry.data) at += entry.data.length;
    }
    return Buffer.concat([tocFor(offsets).buffer(), ...entries.flatMap((entry) => (entry.data ? [entry.data] : []))]);
}

describe("stripAttverFromArchive", () => {
    const dirs: string[] = [];
    afterEach(() => {
        for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });
    function write(bytes: Buffer): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attver-"));
        dirs.push(dir);
        const file = path.join(dir, "dump.custom");
        fs.writeFileSync(file, bytes);
        return file;
    }

    it("blanks pg_attver in the TOC and leaves every data block where the TOC says it is", () => {
        const rows = Buffer.from("INSERT INTO public.authors VALUES (1, 'ALTER TABLE ONLY public.authors ALTER COLUMN id SET (pg_attver=1);', NULL);\n");
        const before = archive([
            { tag: "authors", desc: "TABLE", defn: CI_DEFINITION },
            { tag: "authors", desc: "TABLE DATA", defn: "", data: rows }
        ]);
        const file = write(before);

        expect(stripAttverFromArchive(file)).toBe(1);

        const after = fs.readFileSync(file);
        expect(after.length).toBe(before.length);
        const blanked = Buffer.from(blankAttverOptions(CI_DEFINITION));
        expect(after.indexOf(blanked)).toBe(before.indexOf(Buffer.from(CI_DEFINITION)));
        expect(after.subarray(after.length - rows.length).equals(rows)).toBe(true);
        expect(after.toString("latin1").match(/pg_attver/g)).toHaveLength(1); // only the row's text
    });

    it("leaves an archive without pg_attver byte for byte as it was", () => {
        const before = archive([{ tag: "t", desc: "TABLE", defn: "CREATE TABLE public.t (id integer);\n" }]);
        const file = write(before);

        expect(stripAttverFromArchive(file)).toBe(0);
        expect(fs.readFileSync(file).equals(before)).toBe(true);
    });

    it("changes nothing in a file it cannot read as a custom-format archive", () => {
        const plain = Buffer.from(`--\n-- PostgreSQL database dump\n--\n${CI_DEFINITION}`);
        const truncated = archive([{ tag: "authors", desc: "TABLE", defn: CI_DEFINITION }]).subarray(0, 120);

        for (const bytes of [plain, truncated]) {
            const file = write(bytes);
            expect(stripAttverFromArchive(file)).toBe(0);
            expect(fs.readFileSync(file).equals(bytes)).toBe(true);
        }
    });
});

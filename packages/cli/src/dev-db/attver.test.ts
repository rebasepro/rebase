import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { archiveEncoding, blankAttverOptions, stripAttverFromArchive } from "./attver";

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

/** {@link blankAttverOptions} on the UTF-8 bytes of `definition`, read back as UTF-8. */
function blankText(definition: string): string {
    return blankAttverOptions(Buffer.from(definition, "utf8")).toString("utf8");
}

describe("blankAttverOptions", () => {
    it("blanks the statements that only set pg_attver, keeping the length", () => {
        const blanked = blankText(CI_DEFINITION);

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
            const blanked = blankText(statement);
            expect(blanked).not.toContain("pg_attver");
            expect(blanked.replace(/ +/g, " ")).toContain("n_distinct=5");
            expect(blanked.length).toBe(statement.length);
        }
        expect(blankText(middle)).toContain("n_distinct_inherited=3);");
    });

    it("counts bytes, not characters, for a name outside ASCII", () => {
        const statement = "ALTER TABLE ONLY public.\"café\" ALTER COLUMN \"naïve\" SET (pg_attver=1);";
        const blanked = blankText(statement);

        expect(blanked.trim()).toBe("");
        expect(Buffer.byteLength(blanked)).toBe(Buffer.byteLength(statement));
    });

    it("leaves every byte around the statement as it was, in an encoding that is not UTF-8", () => {
        const definition = Buffer.from(
            "CREATE TABLE public.\"caf\u00e9\" (x integer);\nALTER TABLE ONLY public.\"caf\u00e9\" ALTER COLUMN x SET (pg_attver=1, n_distinct=2);\n-- \u00e9\n",
            "latin1"
        );
        const blanked = blankAttverOptions(definition);

        expect(blanked.length).toBe(definition.length);
        expect(blanked.toString("latin1")).toContain(`SET (${" ".repeat("pg_attver=1, ".length)}n_distinct=2);`);
        const changed = [...definition].flatMap((byte, i) => (blanked[i] === byte ? [] : [i]));
        expect(changed.every((i) => blanked[i] === 0x20)).toBe(true);
    });

    it("leaves a definition without pg_attver, and a row that mentions it, alone", () => {
        const other = "ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct=5);";
        const comment = "COMMENT ON TABLE public.t IS 'SET (pg_attver=1);';";

        expect(blankText(other)).toBe(other);
        expect(blankText(comment)).toBe(comment);
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

    str(text: string | Buffer | null): void {
        if (text === null) return this.int(-1);
        const bytes = typeof text === "string" ? Buffer.from(text, "utf8") : text;
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
    /** As pg_dump wrote it: text in UTF-8, or the bytes of another encoding. */
    defn: string | Buffer;
    data?: Buffer;
}

/** The ENCODING entry pg_dump writes first in every archive. */
function encoding(name: string): Entry {
    return { tag: "ENCODING", desc: "ENCODING", defn: `SET client_encoding = '${name}';\n` };
}

/**
 * A custom-format archive, version 1.16.`revision` (pg_dump 18): header, TOC,
 * then each entry's data block. Its first entry is ENCODING, as in every dump.
 */
function archive(entries: Entry[], options: { revision?: number; encoding?: string } = {}): Buffer {
    entries = [encoding(options.encoding ?? "UTF8"), ...entries];
    const tocFor = (offsets: number[]): ArchiveWriter => {
        const w = new ArchiveWriter();
        w.raw(Buffer.from("PGDMP", "latin1"));
        w.byte(1); w.byte(16); w.byte(options.revision ?? 0); // version 1.16.x
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

function latin1ToString(bytes: Buffer): string {
    return bytes.toString("latin1");
}

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
/** `bytes` in a file of its own, removed after the test. */
function write(bytes: Buffer): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attver-"));
    dirs.push(dir);
    const file = path.join(dir, "dump.custom");
    fs.writeFileSync(file, bytes);
    return file;
}

/**
 * What a pull into the managed database asks before it empties anything:
 * PGlite takes a restore in UTF8 only, and pg_restore SETs whatever encoding
 * the dump's ENCODING entry names.
 */
describe("archiveEncoding", () => {
    it("reads the encoding from the dump's ENCODING entry", () => {
        expect(archiveEncoding(write(archive([], { encoding: "LATIN1" })))).toBe("LATIN1");
        expect(archiveEncoding(write(archive([{ tag: "t", desc: "TABLE", defn: "CREATE TABLE public.t (id integer);\n" }])))).toBe("UTF8");
        expect(archiveEncoding(write(archive([{ tag: "authors", desc: "TABLE", defn: CI_DEFINITION }], { encoding: "SJIS" })))).toBe("SJIS");
    });

    it("changes nothing in the dump, pg_attver or not", () => {
        const before = archive([{ tag: "authors", desc: "TABLE", defn: CI_DEFINITION }], { encoding: "LATIN1" });
        const file = write(before);

        expect(archiveEncoding(file)).toBe("LATIN1");
        expect(fs.readFileSync(file).equals(before)).toBe(true);
    });

    it("is null for a file it cannot read as a custom-format archive", () => {
        const plain = Buffer.from("--\n-- PostgreSQL database dump\n--\nSET client_encoding = 'LATIN1';\n");
        const truncated = archive([], { encoding: "LATIN1" }).subarray(0, 40);

        expect(archiveEncoding(write(plain))).toBeNull();
        expect(archiveEncoding(write(truncated))).toBeNull();
    });
});

describe("stripAttverFromArchive", () => {
    it("blanks pg_attver in the TOC and leaves every data block where the TOC says it is", () => {
        const rows = Buffer.from("INSERT INTO public.authors VALUES (1, 'ALTER TABLE ONLY public.authors ALTER COLUMN id SET (pg_attver=1);', NULL);\n");
        const before = archive([
            { tag: "authors", desc: "TABLE", defn: CI_DEFINITION },
            { tag: "authors", desc: "TABLE DATA", defn: "", data: rows }
        ]);
        const file = write(before);

        expect(stripAttverFromArchive(file)).toEqual({ entries: 1, skipped: null, serverVersion: "18.5", dumpVersion: "18.4" });

        const after = fs.readFileSync(file);
        expect(after.length).toBe(before.length);
        const blanked = blankAttverOptions(Buffer.from(CI_DEFINITION));
        expect(after.indexOf(blanked)).toBe(before.indexOf(Buffer.from(CI_DEFINITION)));
        expect(after.subarray(after.length - rows.length).equals(rows)).toBe(true);
        expect(after.toString("latin1").match(/pg_attver/g)).toHaveLength(1); // only the row's text
    });

    it("leaves an archive without pg_attver byte for byte as it was", () => {
        const before = archive([{ tag: "t", desc: "TABLE", defn: "CREATE TABLE public.t (id integer);\n" }]);
        const file = write(before);

        expect(stripAttverFromArchive(file)).toMatchObject({ entries: 0, skipped: null });
        expect(fs.readFileSync(file).equals(before)).toBe(true);
    });

    it("changes nothing in a file it cannot read as a custom-format archive", () => {
        const plain = Buffer.from(`--\n-- PostgreSQL database dump\n--\n${CI_DEFINITION}`);
        const truncated = archive([{ tag: "authors", desc: "TABLE", defn: CI_DEFINITION }]).subarray(0, 120);

        for (const bytes of [plain, truncated]) {
            const file = write(bytes);
            expect(stripAttverFromArchive(file)).toMatchObject({ entries: 0, skipped: expect.stringMatching(/not a pg_dump custom-format archive/) });
            expect(fs.readFileSync(file).equals(bytes)).toBe(true);
        }
    });

    it("blanks a definition in a single-byte encoding at its length in bytes, and corrupts nothing after it", () => {
        // A LATIN1 database dumps its names as LATIN1 bytes: 0xE9 is "é", and
        // not UTF-8. Read as UTF-8 each became a 3-byte U+FFFD, the patch came
        // out longer than the field and overwrote the TOC after it.
        const latin1 = (text: string): Buffer => Buffer.from(text, "latin1");
        const definition = latin1([
            "CREATE TABLE public.\"caf\u00e9\" (",
            "    \"gr\u00f6\u00dfe\" integer",
            ");",
            "ALTER TABLE ONLY public.\"caf\u00e9\" ALTER COLUMN \"gr\u00f6\u00dfe\" SET (pg_attver=29166168);",
            "COMMENT ON nothing; -- \u00e9 after the statement too",
            ""
        ].join("\n"));
        const rows = Buffer.from("1\t\\N\n\\.\n");
        const before = archive([
            { tag: "caf\u00e9", desc: "TABLE", defn: definition },
            { tag: "after", desc: "TABLE", defn: "CREATE TABLE public.after (x integer);\nALTER TABLE ONLY public.after ALTER COLUMN x SET (pg_attver=7);\n" },
            { tag: "caf\u00e9", desc: "TABLE DATA", defn: "", data: rows }
        ], { encoding: "LATIN1" });
        const file = write(before);

        expect(stripAttverFromArchive(file)).toMatchObject({ entries: 2, skipped: null });

        const after = fs.readFileSync(file);
        const blanked = latin1(latin1ToString(definition).replace(/^ALTER TABLE ONLY public\."caf\u00e9".*$/m, (line) => " ".repeat(line.length)));
        const expected = Buffer.from(before);
        blanked.copy(expected, before.indexOf(definition));
        const second = Buffer.from("ALTER TABLE ONLY public.after ALTER COLUMN x SET (pg_attver=7);");
        Buffer.alloc(second.length, " ").copy(expected, before.indexOf(second));
        expect(after.equals(expected)).toBe(true);
    });

    it("leaves pg_attver alone in an entry that is not a table's, such as a comment", () => {
        // pg_dump writes attribute options only in TABLE, FOREIGN TABLE and
        // MATERIALIZED VIEW entries. Anywhere else the line is text someone
        // wrote — here, inside a COMMENT's string literal.
        const comment = "COMMENT ON TABLE public.t IS 'how to break a restore:\nALTER TABLE ONLY public.t ALTER COLUMN id SET (pg_attver=5);\n';\n";
        const before = archive([
            { tag: "t", desc: "TABLE", defn: "CREATE TABLE public.t (id integer);\n" },
            { tag: "TABLE t", desc: "COMMENT", defn: comment }
        ]);
        const file = write(before);

        expect(stripAttverFromArchive(file)).toMatchObject({ entries: 0, skipped: null });
        expect(fs.readFileSync(file).equals(before)).toBe(true);
    });

    it("blanks pg_attver in a materialized view's entry, which pg_dump writes it in too", () => {
        const definition = "CREATE MATERIALIZED VIEW public.mv AS\n SELECT 1 AS one\n  WITH NO DATA;\nALTER TABLE ONLY public.mv ALTER COLUMN one SET (pg_attver=9);\n";
        const file = write(archive([{ tag: "mv", desc: "MATERIALIZED VIEW", defn: definition }]));

        expect(stripAttverFromArchive(file)).toMatchObject({ entries: 1, skipped: null });
        expect(fs.readFileSync(file).toString("latin1")).not.toContain("pg_attver");
    });

    it("reads an archive whose format has a revision past 1.16.0", () => {
        // K_VERS_MAX accepts any 1.16 revision: a revision bump keeps the layout.
        const before = archive([{ tag: "authors", desc: "TABLE", defn: CI_DEFINITION }], { revision: 3 });
        const file = write(before);

        expect(stripAttverFromArchive(file)).toMatchObject({ entries: 1, skipped: null });
        expect(fs.readFileSync(file).toString("latin1")).not.toContain("pg_attver");
    });

    it("leaves an archive in a format it does not know as it was, and says which format", () => {
        const before = archive([{ tag: "authors", desc: "TABLE", defn: CI_DEFINITION }]);
        before[6] = 17; // version 1.17.0
        const file = write(before);

        expect(stripAttverFromArchive(file)).toEqual({
            entries: 0,
            skipped: "its archive format is version 1.17.0, which this version of Rebase does not read",
            serverVersion: null,
            dumpVersion: null
        });
        expect(fs.readFileSync(file).equals(before)).toBe(true);
    });

    it("refuses to edit a dump written in a client-only encoding, which is not ASCII-safe", () => {
        const before = archive([{ tag: "authors", desc: "TABLE", defn: CI_DEFINITION }], { encoding: "SJIS" });
        const file = write(before);

        const result = stripAttverFromArchive(file);

        expect(result.entries).toBe(0);
        expect(result.skipped).toMatch(/SJIS encoding/);
        expect(fs.readFileSync(file).equals(before)).toBe(true);
    });

    it("writes nothing when an edit would change a definition's length", () => {
        const before = archive([
            { tag: "first", desc: "TABLE", defn: CI_DEFINITION },
            { tag: "second", desc: "TABLE", defn: "CREATE TABLE public.second (x integer);\nALTER TABLE ONLY public.second ALTER COLUMN x SET (pg_attver=1);\n" }
        ]);
        const file = write(before);
        let calls = 0;
        // The first entry's edit is sound; the second one's grows by a byte.
        const growsTheSecond = (definition: Buffer): Buffer => {
            calls += 1;
            const blanked = blankAttverOptions(definition);
            return calls === 2 ? Buffer.concat([blanked, Buffer.from(" ")]) : blanked;
        };

        const result = stripAttverFromArchive(file, growsTheSecond);

        expect(result.entries).toBe(0);
        expect(result.skipped).toMatch(/changed that entry's length/);
        expect(fs.readFileSync(file).equals(before)).toBe(true);
    });
});

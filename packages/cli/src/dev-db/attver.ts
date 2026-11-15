/**
 * `pg_attver` in a dump, and taking it out before a restore.
 *
 * The November 2026 PostgreSQL minor releases (every branch from 14 up;
 * upstream commit c23382f0a8, "Introduce attribute versioning to prevent
 * unsafe deforming") keep a per-column version as an attribute option: a
 * `pg_attver` key in `pg_attribute.attoptions`, set on every column created or
 * altered. A `pg_dump` from before that release, pointed at a server from
 * after it, dumps the key like any other attribute option:
 *
 *     ALTER TABLE ONLY public.authors ALTER COLUMN id SET (pg_attver=33846480);
 *
 * and every server without the change — PGlite, which the managed development
 * database runs on, and a local Postgres on an older minor — refuses it with
 * `unrecognized parameter "pg_attver"`. The statement sits in the same archive
 * entry as the table's `CREATE TABLE`, so that entry fails whole: no table,
 * and every row, index and constraint of it after. A server with the change
 * ignores the key on input, so it carries nothing a restore needs.
 *
 * pg_dump's own fix leaves the key out, but a pull should not depend on the
 * local client being newer than the source server. So the dump is edited in
 * place before pg_restore reads it: in each TOC entry's definition, the key is
 * overwritten with spaces — the whole statement when it is the only option,
 * the key and its comma when there are others. Byte for byte the same length,
 * because the TOC records the file offset of every data block after it.
 *
 * The definitions are edited as bytes, never decoded: pg_dump writes them in
 * the database's encoding, which need not be UTF-8. Every encoding a server
 * can store is ASCII-safe — a byte below 0x80 is always that ASCII character —
 * so the ASCII statement is found by reading one character per byte, and the
 * bytes around it are written back exactly as they were. The client-only
 * encodings (SJIS, BIG5, GBK, UHC, GB18030, JOHAB, SHIFT_JIS_2004) are not
 * ASCII-safe; a dump taken in one, through `PGCLIENTENCODING` or a
 * `client_encoding` in the connection string, is left as it was.
 *
 * The same read of the TOC also answers which encoding a dump is written in
 * ({@link archiveEncoding}). A pull into the managed database asks that before
 * it empties anything.
 */
import fs from "fs";

const ATTVER_ONLY = /^(ALTER (?:FOREIGN )?TABLE (?:ONLY )?.* ALTER COLUMN .* SET )\(pg_attver=\d+\);$/gm;
const ATTVER_FIRST = /(?<=^ALTER (?:FOREIGN )?TABLE (?:ONLY )?.* ALTER COLUMN .* SET \()pg_attver=\d+, (?=.*\);$)/gm;
const ATTVER_LATER = /(?<=^ALTER (?:FOREIGN )?TABLE (?:ONLY )?.* ALTER COLUMN .* SET \(.*), pg_attver=\d+(?=.*\);$)/gm;

function spaces(text: string): string {
    return " ".repeat(text.length);
}

/**
 * A TOC entry's definition, as the bytes pg_dump wrote, without its
 * `pg_attver` options: what was taken out is spaces, and every other byte is
 * as it was. Matched one character per byte (`latin1`), which finds the ASCII
 * statement in any ASCII-safe encoding without decoding anything else.
 */
export function blankAttverOptions(definition: Buffer): Buffer {
    const text = definition.toString("latin1");
    if (!text.includes("pg_attver=")) return definition;

    const blanked = text
        .replace(ATTVER_ONLY, (statement) => spaces(statement))
        .replace(ATTVER_FIRST, (option) => spaces(option))
        .replace(ATTVER_LATER, (option) => spaces(option));

    return blanked === text ? definition : Buffer.from(blanked, "latin1");
}

/**
 * The entries whose definition can hold attribute options: pg_dump's
 * `dumpTableSchema` writes `ALTER … ALTER COLUMN … SET (…)` for every relation
 * but a view, under the entry it describes as one of these.
 */
const RELATION_ENTRIES = new Set(["TABLE", "FOREIGN TABLE", "MATERIALIZED VIEW"]);

/**
 * The encodings a server can store (`PG_SQL_ASCII` … `PG_KOI8U` in
 * pg_wchar.h), named as `pg_encoding_to_char` names them in the ENCODING
 * entry. Each is ASCII-safe; the client-only encodings after them are not.
 */
const ASCII_SAFE_ENCODINGS = new Set([
    "SQL_ASCII", "EUC_JP", "EUC_CN", "EUC_KR", "EUC_TW", "EUC_JIS_2004", "UTF8", "MULE_INTERNAL",
    "LATIN1", "LATIN2", "LATIN3", "LATIN4", "LATIN5", "LATIN6", "LATIN7", "LATIN8", "LATIN9", "LATIN10",
    "WIN1256", "WIN1258", "WIN866", "WIN874", "KOI8R", "WIN1251", "WIN1252",
    "ISO_8859_5", "ISO_8859_6", "ISO_8859_7", "ISO_8859_8",
    "WIN1250", "WIN1253", "WIN1254", "WIN1255", "WIN1257", "KOI8U"
]);

/** `K_VERS_1_12`…`K_VERS_MAX` (1.16 at any revision): the custom-format archives pg_dump 11 to 18 write. */
const OLDEST = archiveVersion(1, 12, 0);
const NEWEST = archiveVersion(1, 16, 255);
const V1_14 = archiveVersion(1, 14, 0);
const V1_15 = archiveVersion(1, 15, 0);
const V1_16 = archiveVersion(1, 16, 0);
/** `archCustom` in pg_backup.h. */
const CUSTOM_FORMAT = 1;
/** `K_OFFSET_POS_SET` in pg_backup_custom.c: the entry's data block is at the offset that follows. */
const OFFSET_SET = 2;

function archiveVersion(major: number, minor: number, revision: number): number {
    return (major << 16) | (minor << 8) | revision;
}

/** Reads a custom-format archive's header and TOC straight from the file, without loading its data. */
class ArchiveReader {
    position = 0;
    intSize = 4;
    offSize = 8;

    constructor(private readonly fd: number, private readonly size: number) {}

    bytes(length: number): Buffer {
        if (length < 0 || this.position + length > this.size) throw new RangeError("past the end of the archive");
        const buffer = Buffer.alloc(length);
        let read = 0;
        while (read < length) {
            const n = fs.readSync(this.fd, buffer, read, length - read, this.position + read);
            if (n === 0) throw new RangeError("past the end of the archive");
            read += n;
        }
        this.position += length;
        return buffer;
    }

    byte(): number {
        return this.bytes(1)[0] ?? 0;
    }

    /** `ReadInt`: a sign byte, then `intSize` bytes, least significant first. */
    int(): number {
        const negative = this.byte() !== 0;
        const digits = this.bytes(this.intSize);
        let value = 0;
        for (let i = digits.length - 1; i >= 0; i--) value = value * 256 + (digits[i] ?? 0);
        return negative ? -value : value;
    }

    /** `ReadStr`: a length, then that many bytes; a negative length is NULL. Returns the bytes and where they are. */
    str(): { at: number; bytes: Buffer } | null {
        const length = this.int();
        if (length < 0) return null;
        const at = this.position;
        return { at, bytes: this.bytes(length) };
    }

    /** `ReadStr` for a field that is ASCII in every dump: a tag, a description, a version. */
    ascii(): string | null {
        return this.str()?.bytes.toString("latin1") ?? null;
    }

    /** `ReadOffset`: a flag byte, then `offSize` bytes, least significant first. */
    offset(): { set: boolean; value: number } {
        const flag = this.byte();
        const digits = this.bytes(this.offSize);
        let value = 0;
        for (let i = digits.length - 1; i >= 0; i--) value = value * 256 + (digits[i] ?? 0);
        return { set: flag === OFFSET_SET, value };
    }
}

interface Patch {
    at: number;
    bytes: Buffer;
}

/** What {@link stripAttverFromArchive} did to a dump. */
export interface AttverStrip {
    /** How many TOC entries had their `pg_attver` options blanked. */
    entries: number;
    /**
     * Why the dump was left exactly as it was, when it could not be read or
     * edited safely; null when it was read through. A skipped dump that holds
     * `pg_attver` options fails to restore on a server without the change.
     */
    skipped: string | null;
    /** The source server's version, as the archive's header records it; null when it was not read. */
    serverVersion: string | null;
    /** The version of the pg_dump that wrote the archive, from its header; null when it was not read. */
    dumpVersion: string | null;
}

/** What the archive's header and ENCODING entry say, as far as it was read; null for what was not. */
interface ArchiveFacts {
    serverVersion: string | null;
    dumpVersion: string | null;
    encoding: string | null;
}

type Plan =
    | ({ ok: true; patches: Patch[] } & ArchiveFacts)
    | ({ ok: false; reason: string } & ArchiveFacts);

const NOT_AN_ARCHIVE = "it is not a pg_dump custom-format archive this can read";

/** The edits that blank `pg_attver` in an archive's TOC, or why there are none to make safely. */
function planPatches(fd: number, size: number, blank: (definition: Buffer) => Buffer): Plan {
    const reader = new ArchiveReader(fd, size);
    let serverVersion: string | null = null;
    let dumpVersion: string | null = null;
    let encoding: string | null = null;
    const refuse = (reason: string): Plan => ({ ok: false, reason, serverVersion, dumpVersion, encoding });

    if (reader.bytes(5).toString("latin1") !== "PGDMP") return refuse(NOT_AN_ARCHIVE);
    const major = reader.byte();
    const minor = reader.byte();
    const revision = reader.byte();
    const version = archiveVersion(major, minor, revision);
    if (version < OLDEST || version > NEWEST) {
        return refuse(`its archive format is version ${major}.${minor}.${revision}, which this version of Rebase does not read`);
    }
    reader.intSize = reader.byte();
    reader.offSize = reader.byte();
    if (reader.intSize < 1 || reader.intSize > 8 || reader.offSize < 1 || reader.offSize > 8) return refuse(NOT_AN_ARCHIVE);
    if (reader.byte() !== CUSTOM_FORMAT) return refuse(NOT_AN_ARCHIVE);

    // ReadHead: compression, creation time, database name, server and pg_dump versions.
    if (version >= V1_15) reader.byte();
    else reader.int();
    for (let i = 0; i < 7; i++) reader.int();
    reader.str();
    serverVersion = reader.ascii();
    dumpVersion = reader.ascii();

    // ReadToc, with the custom format's ReadExtraToc after each entry.
    const patches: Patch[] = [];
    let firstData = Number.POSITIVE_INFINITY;
    const entries = reader.int();
    if (entries < 0) return refuse(NOT_AN_ARCHIVE);
    for (let i = 0; i < entries; i++) {
        reader.int(); // dumpId
        reader.int(); // hadDumper
        reader.str(); // tableoid
        reader.str(); // oid
        reader.str(); // tag
        const desc = reader.ascii();
        reader.int(); // section
        const definition = reader.str();
        reader.str(); // dropStmt
        reader.str(); // copyStmt
        reader.str(); // namespace
        reader.str(); // tablespace
        if (version >= V1_14) reader.str(); // tableam
        if (version >= V1_16) reader.int(); // relkind
        reader.str(); // owner
        reader.str(); // "false": the old withOids
        while (reader.str() !== null); // dependencies, ended by NULL
        const data = reader.offset();
        if (data.set) firstData = Math.min(firstData, data.value);

        if (!definition) continue;
        if (desc === "ENCODING") {
            encoding = /client_encoding = '([^']*)'/.exec(definition.bytes.toString("latin1"))?.[1] ?? null;
        } else if (desc !== null && RELATION_ENTRIES.has(desc)) {
            const blanked = blank(definition.bytes);
            if (blanked.equals(definition.bytes)) continue;
            if (blanked.length !== definition.bytes.length) {
                return refuse(`taking pg_attver out of one of its entries would have changed that entry's length (${definition.bytes.length} bytes to ${blanked.length})`);
            }
            patches.push({ at: definition.at, bytes: blanked });
        }
    }

    // The data blocks follow the TOC. If they do not start after where this
    // read it to end, the layout was not the one assumed: change nothing.
    if (reader.position > firstData) return refuse(NOT_AN_ARCHIVE);

    // Found by matching bytes as ASCII, which only an ASCII-safe encoding
    // makes the statement it looks like.
    if (patches.length > 0 && (encoding === null || !ASCII_SAFE_ENCODINGS.has(encoding))) {
        return refuse(encoding === null
            ? "it does not say which encoding it is written in"
            : `it is written in the ${encoding} encoding, which this cannot edit safely; dump in the database's own encoding instead (unset PGCLIENTENCODING)`);
    }

    return { ok: true, patches, serverVersion, dumpVersion, encoding };
}

/** Reads every definition as it is: what {@link archiveEncoding} walks the TOC with. */
function unchanged(definition: Buffer): Buffer {
    return definition;
}

/**
 * The encoding a custom-format dump is written in, as its ENCODING entry
 * names it (`LATIN1`, `UTF8`, …), or null when this cannot read the file as
 * an archive.
 *
 * That entry is the `SET client_encoding` pg_restore starts every restore
 * with: the source database's encoding, unless pg_dump ran with
 * `PGCLIENTENCODING` naming another. The file is opened read-only and nothing
 * in it changes.
 */
export function archiveEncoding(dumpFile: string): string | null {
    const fd = fs.openSync(dumpFile, "r");
    try {
        return planPatches(fd, fs.fstatSync(fd).size, unchanged).encoding;
    } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        return null;
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Blank every `pg_attver` attribute option in a custom-format dump, in place.
 *
 * A file this does not recognise, or cannot edit safely, is left byte for
 * byte as it was — pg_restore then reads it as it is — and the result says
 * why. `blank` is the edit made to each table's definition: the pull always
 * uses the default, {@link blankAttverOptions}; it is a parameter so that the
 * guard against an edit that changes a definition's length can be tested.
 */
export function stripAttverFromArchive(
    dumpFile: string,
    blank: (definition: Buffer) => Buffer = blankAttverOptions
): AttverStrip {
    const fd = fs.openSync(dumpFile, "r+");
    try {
        let plan: Plan;
        try {
            plan = planPatches(fd, fs.fstatSync(fd).size, blank);
        } catch (error) {
            if (!(error instanceof RangeError)) throw error;
            plan = { ok: false, reason: NOT_AN_ARCHIVE, serverVersion: null, dumpVersion: null, encoding: null };
        }
        const versions = { serverVersion: plan.serverVersion, dumpVersion: plan.dumpVersion };
        if (!plan.ok) return { entries: 0, skipped: plan.reason, ...versions };
        for (const patch of plan.patches) fs.writeSync(fd, patch.bytes, 0, patch.bytes.length, patch.at);
        return { entries: plan.patches.length, skipped: null, ...versions };
    } finally {
        fs.closeSync(fd);
    }
}

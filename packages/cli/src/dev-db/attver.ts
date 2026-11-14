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
 */
import fs from "fs";

const ATTVER_ONLY = /^(ALTER (?:FOREIGN )?TABLE (?:ONLY )?.* ALTER COLUMN .* SET )\(pg_attver=\d+\);$/gm;
const ATTVER_FIRST = /(?<=^ALTER (?:FOREIGN )?TABLE (?:ONLY )?.* ALTER COLUMN .* SET \()pg_attver=\d+, (?=.*\);$)/gm;
const ATTVER_LATER = /(?<=^ALTER (?:FOREIGN )?TABLE (?:ONLY )?.* ALTER COLUMN .* SET \(.*), pg_attver=\d+(?=.*\);$)/gm;

function spaces(text: string): string {
    return " ".repeat(Buffer.byteLength(text, "utf8"));
}

/**
 * A TOC entry's definition without its `pg_attver` options, as the same
 * number of UTF-8 bytes: what was taken out is spaces.
 */
export function blankAttverOptions(definition: string): string {
    if (!definition.includes("pg_attver=")) return definition;

    return definition
        .replace(ATTVER_ONLY, (statement) => spaces(statement))
        .replace(ATTVER_FIRST, (option) => spaces(option))
        .replace(ATTVER_LATER, (option) => spaces(option));
}

/** `K_VERS_1_12`…`K_VERS_1_16`: the custom-format archives pg_dump 11 to 18 write. */
const OLDEST = archiveVersion(1, 12, 0);
const NEWEST = archiveVersion(1, 16, 0);
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

    /** `ReadStr`: a length, then that many bytes; a negative length is NULL. Returns where the bytes are. */
    str(): { at: number; text: string } | null {
        const length = this.int();
        if (length < 0) return null;
        const at = this.position;
        return { at, text: this.bytes(length).toString("utf8") };
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

/** The edits that blank `pg_attver` in an archive's TOC, or `null` when the file is not one this can read. */
function planPatches(fd: number, size: number): Patch[] | null {
    const reader = new ArchiveReader(fd, size);
    if (reader.bytes(5).toString("latin1") !== "PGDMP") return null;
    const major = reader.byte();
    const minor = reader.byte();
    const revision = reader.byte();
    const version = archiveVersion(major, minor, revision);
    if (version < OLDEST || version > NEWEST) return null;
    reader.intSize = reader.byte();
    reader.offSize = reader.byte();
    if (reader.intSize < 1 || reader.intSize > 8 || reader.offSize < 1 || reader.offSize > 8) return null;
    if (reader.byte() !== CUSTOM_FORMAT) return null;

    // ReadHead: compression, creation time, database name, server and pg_dump versions.
    if (version >= V1_15) reader.byte();
    else reader.int();
    for (let i = 0; i < 7; i++) reader.int();
    reader.str();
    reader.str();
    reader.str();

    // ReadToc, with the custom format's ReadExtraToc after each entry.
    const patches: Patch[] = [];
    let firstData = Number.POSITIVE_INFINITY;
    const entries = reader.int();
    if (entries < 0) return null;
    for (let i = 0; i < entries; i++) {
        reader.int(); // dumpId
        reader.int(); // hadDumper
        reader.str(); // tableoid
        reader.str(); // oid
        reader.str(); // tag
        reader.str(); // desc
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

        if (definition) {
            const blanked = blankAttverOptions(definition.text);
            if (blanked !== definition.text) {
                const bytes = Buffer.from(blanked, "utf8");
                if (bytes.length !== Buffer.byteLength(definition.text, "utf8")) return null;
                patches.push({ at: definition.at, bytes });
            }
        }
    }

    // The data blocks follow the TOC. If they do not start after where this
    // read it to end, the layout was not the one assumed: change nothing.
    if (reader.position > firstData) return null;

    return patches;
}

/**
 * Blank every `pg_attver` attribute option in a custom-format dump, in place.
 * Returns how many TOC entries were changed; 0 also for a file this does not
 * recognise, which pg_restore then reads as it is.
 */
export function stripAttverFromArchive(dumpFile: string): number {
    const fd = fs.openSync(dumpFile, "r+");
    try {
        let patches: Patch[] | null;
        try {
            patches = planPatches(fd, fs.fstatSync(fd).size);
        } catch (error) {
            if (error instanceof RangeError) return 0;
            throw error;
        }
        if (!patches) return 0;
        for (const patch of patches) fs.writeSync(fd, patch.bytes, 0, patch.bytes.length, patch.at);
        return patches.length;
    } finally {
        fs.closeSync(fd);
    }
}

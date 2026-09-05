/**
 * `rebase cloud db backup list` lists backups. `rebase db backup list` created
 * one: "list" was a positional the local `backupCommand` parsed permissively
 * and never read. One CLI, two spellings, and the wrong guess wrote a dump
 * instead of reading one — which on a large database is neither quick nor free,
 * and leaves a file the retention policy then has to reason about.
 */
import { backupActionOf } from "../src/backup-argv";

/** The driver's own line, as the CLI relays it. */
const line = (...args: string[]) => args;

describe("backupActionOf", () => {
    it("lists when the line says list, the way the cloud family spells it", () => {
        expect(backupActionOf(line("db", "backup", "list"))).toBe("list");
        expect(backupActionOf(line("db", "backup", "list", "--out", "./backups"))).toBe("list");
    });

    it("still creates for the local spelling", () => {
        expect(backupActionOf(line("db", "backup"))).toBe("create");
        expect(backupActionOf(line("db", "backup", "--out", "s3://bucket/prefix"))).toBe("create");
    });

    it("does not read a flag's value as the action", () => {
        // `--out list` would be a strange path, but reading position 2 blindly
        // is how the original bug worked in the first place.
        expect(backupActionOf(line("db", "backup", "--out", "list"))).toBe("create");
    });
});

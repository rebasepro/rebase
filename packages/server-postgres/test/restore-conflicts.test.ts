/**
 * `db restore` into a database that already holds what the backup creates.
 *
 * Without `--clean`, pg_restore stops at the first object that exists. The
 * restore ended in pg_restore's own `schema "rebase" already exists` and
 * execa's `Command failed with exit code 1: /opt/homebrew/bin/pg_restore …`,
 * with no word about `--clean` or a new database, and only after the cluster
 * roles from the backup's sidecar had been applied. The conflict is read from
 * the dump's table of contents and the target's catalogue before anything runs.
 */
import { parseDumpObjects } from "../src/backup/pg-tools";
import { describeRestoreConflict } from "../src/backup/backup-cli";

jest.mock("execa", () => ({ execa: jest.fn() }));

/** `pg_restore --list` of a Rebase database, pg_restore 18.6, captured verbatim. */
const LIST = `;
; Archive created at 2026-10-14 04:15:03 UTC
;     dbname: rebase
;     TOC Entries: 16
;     Format: CUSTOM
;
; Selected TOC Entries:
;
6; 2615 16425 SCHEMA - rebase rebase
223; 1259 16429 TABLE public Odd Name rebase
221; 1259 16408 TABLE public tags rebase
220; 1259 16407 SEQUENCE public tags_id_seq rebase
3492; 0 0 SEQUENCE OWNED BY public tags_id_seq rebase
222; 1259 16426 TABLE rebase users rebase
3332; 2604 16411 DEFAULT public tags id rebase
3485; 0 16429 TABLE DATA public Odd Name rebase
3483; 0 16408 TABLE DATA public tags rebase
3484; 0 16426 TABLE DATA rebase users rebase
3334; 2606 16416 CONSTRAINT public tags tags_pkey rebase
`;

describe("the objects a dump creates", () => {
    it("reads its schemas and tables, not their data or anything else", () => {
        expect(parseDumpObjects(LIST)).toEqual({
            schemas: ["rebase"],
            tables: [
                { schema: "public", table: "Odd Name" },
                { schema: "public", table: "tags" },
                { schema: "rebase", table: "users" }
            ]
        });
    });

    it("reads nothing from an empty table of contents", () => {
        expect(parseDumpObjects(";\n; Selected TOC Entries:\n;\n")).toEqual({ schemas: [], tables: [] });
    });
});

describe("the refusal", () => {
    it("names what is in the way and both ways round it", () => {
        const { message, hint } = describeRestoreConflict("shop", "./backups/x.dump",
            ["schema rebase", "table public.tags", "table rebase.users"]);
        expect(message).toBe(
            "\"shop\" already holds schema rebase, table public.tags, table rebase.users, which this backup creates. " +
            "Without --clean, pg_restore stops at the first of them. Nothing was restored or changed."
        );
        expect(hint).toContain("rebase db restore ./backups/x.dump --clean");
        expect(hint).toContain("rebase db restore ./backups/x.dump --create-db --target-db <new name>");
    });

    it("counts what it does not list", () => {
        const many = Array.from({ length: 8 }, (_, i) => `table public.t${i}`);
        expect(describeRestoreConflict("shop", "x.dump", many).message).toMatch(/table public\.t4, and 3 more, which/);
    });
});

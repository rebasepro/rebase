/**
 * After `rebase generate-sdk --register`, `openRebase()` is typed by the
 * registered `Database`, with no type argument — as a function's
 * `rebase.dataAsAdmin` is.
 *
 * Registering is a module augmentation, and an augmentation applies to the
 * whole program it is in: written into a file of the repository's tests
 * program it would register a `Database` for every other file there. So each
 * case compiles a program of its own — this checkout's sources, through the
 * `paths` of `tsconfig.typecheck.json` — around one probe file, which is what a
 * project's script is, and reads that file's diagnostics. The explicit
 * `openRebase<Database>()` form is asserted in `open-rebase-types.type-test.ts`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ts from "typescript";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * A generated `Database` and the use a script makes of it. Each line marked
 * `refused:` must not compile once the `Database` is registered; nothing else
 * may fail. (Marked in a comment of its own rather than with the compiler's
 * expect-error directive: this source is a string, which no tsc program reads.)
 */
const PROBE_BODY = `
import { openRebase } from "@rebasepro/server-postgres";

type Database = {
    posts: {
        Row: { id: string; title: string; status: "draft" | "published" };
        Insert: { title: string; status?: "draft" | "published" };
        Update: { title?: string; status?: "draft" | "published" };
    };
};

export async function script(): Promise<string[]> {
    const rebase = await openRebase({ databaseUrl: "postgres://localhost/app", collections: [] });
    await rebase.dataAsAdmin.nonsenseCollection.find({}); // refused: nonsenseCollection
    await rebase.dataAsAdmin.posts.update("1", { status: "not-an-enum-value" }); // refused: not-an-enum-value
    await rebase.dataAsAdmin.posts.update("1", { bogus: 1 }); // refused: bogus
    const ada = await rebase.withAuth({ uid: "ada" });
    await ada.data.nonsenseCollection.find({}); // refused: nonsenseCollection
    const titles: string[] = (await rebase.dataAsAdmin.posts.find()).data.map(post => post.title);
    return titles;
}
`;

/** The probe's `refused:` lines, as `line: name`. */
const REFUSED = PROBE_BODY.split("\n").flatMap((text, index) => {
    const marked = /\/\/ refused: (\S+)$/.exec(text);
    return marked ? [`${index + 1}: ${marked[1]}`] : [];
});

/** What the `--register` step writes. */
const REGISTRATION = `
declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
`;

/** The probe's own diagnostics, as `line: message`, in a program of its own. */
function diagnosticsOf(source: string): string[] {
    const parsed = ts.getParsedCommandLineOfConfigFile(path.join(REPO_ROOT, "tsconfig.typecheck.json"), { noEmit: true }, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
            throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
        }
    });
    if (!parsed) throw new Error("could not read tsconfig.typecheck.json");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-open-rebase-types-"));
    try {
        const file = path.join(dir, "script.ts");
        fs.writeFileSync(file, source);
        const program = ts.createProgram({ rootNames: [file], options: parsed.options });
        const probe = program.getSourceFile(file);
        if (!probe) throw new Error("the probe is not in its program");
        return [...program.getSyntacticDiagnostics(probe), ...program.getSemanticDiagnostics(probe)].map((diagnostic) => {
            const line = diagnostic.start === undefined ? "?" : probe.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
            return `${line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("openRebase() and a registered Database", () => {
    it("types dataAsAdmin and withAuth from the registration: a nonsense collection, value or field is an error", () => {
        const errors = diagnosticsOf(PROBE_BODY + REGISTRATION);
        // One error per refused line, naming what it refuses, and none elsewhere.
        expect(errors).toHaveLength(REFUSED.length);
        for (const refused of REFUSED) {
            const [line, name] = refused.split(": ");
            expect(errors.filter(error => error.startsWith(`${line}: `) && error.includes(name))).toHaveLength(1);
        }
    }, 120_000);

    it("without the registration the same script is untyped, which is what the case above tells apart", () => {
        // Every refused line compiles, and the rows are open records.
        const titlesLine = PROBE_BODY.split("\n").findIndex(text => text.includes("const titles")) + 1;
        expect(diagnosticsOf(PROBE_BODY)).toEqual([
            expect.stringMatching(new RegExp(`^${titlesLine}: Type 'unknown\\[\\]' is not assignable to type 'string\\[\\]'`))
        ]);
    }, 120_000);
});

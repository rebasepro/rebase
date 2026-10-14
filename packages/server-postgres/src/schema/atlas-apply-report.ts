/**
 * Atlas's `schema apply --auto-approve` report, as `rebase db push` shows it.
 *
 * Atlas prints its plan ("Planning migration statements …"), a separator, and
 * then the run ("Applying approved migration …"), echoing every statement in
 * both. The push has planned already — the plan it gated on, which a
 * destructive change listed in full — so the first section is a repeat, and a
 * reader saw each statement twice in a row. The run's section is kept: it is
 * the progress, the `-- ok` per statement and the summary.
 */

const PLANNING_HEADER = /^Planning migration statements\b/;
/** The separator Atlas ends a section with, at the start of a line. */
const SECTION_SEPARATOR = /^-{3,}\s*$/;

export interface ApplyReportFilter {
    /** The part of `chunk` to show, whole lines only; a partial line waits for the next chunk. */
    push(chunk: string): string;
    /** What is left once the stream has ended. */
    flush(): string;
}

/**
 * A stream filter that drops the planning section of an apply report, its
 * separator and the blank line after it, and passes everything else through
 * unchanged. A report with no planning section (`Schema is synced…`, an
 * error) comes out as it went in.
 */
export function createApplyReportFilter(): ApplyReportFilter {
    let pending = "";
    let state: "pass" | "planning" | "after-separator" = "pass";

    const keep = (line: string): boolean => {
        if (state === "pass" && PLANNING_HEADER.test(line)) {
            state = "planning";
            return false;
        }
        if (state === "planning") {
            if (SECTION_SEPARATOR.test(line)) state = "after-separator";
            return false;
        }
        if (state === "after-separator") {
            state = "pass";
            if (line.trim() === "") return false;
        }
        return true;
    };

    return {
        push(chunk) {
            pending += chunk;
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            return lines.filter(keep).map((line) => `${line}\n`).join("");
        },
        flush() {
            const rest = pending;
            pending = "";
            return rest !== "" && keep(rest) ? rest : "";
        }
    };
}

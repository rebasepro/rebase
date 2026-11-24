import { describe, it, expect } from "@jest/globals";
import { ScriptRun, SQL_CONSOLE_RESULT_LIMITS, sqlScriptResultFromRows, type StatementOutcome } from "../src/services/sql-script";

/**
 * How much of a result the SQL console holds.
 *
 * Every row of every statement used to be kept until the script ended, then
 * written into one frame: `TABLE events` on a million rows held 418 MB of row
 * objects and built a 475 MB string, and a 1 GiB server died of it — with every
 * other user's connection. `SELECT * FROM big; SELECT 1` showed one row and
 * peaked at the same 417 MB, for rows nobody would see. A run now keeps at most
 * {@link SQL_CONSOLE_RESULT_LIMITS} over the whole script: the statements
 * before the last give rows up so the last keeps as many as it would alone.
 *
 * The messages are the ones node-postgres hands the active query, in the order
 * Postgres sends them — what `runSqlScriptOnPool` reads off a real server
 * (`test/e2e/sql-script-e2e.test.ts` runs it against one).
 */

const integerColumn = (name: string) => ({ name, tableID: 0, columnID: 0, dataTypeID: 23 });

/** One statement's messages: its row description, `count` rows, its command tag. */
function sendStatement(run: ScriptRun, count: number, row: (index: number) => string = String, column = "g"): void {
    run.handleRowDescription({ fields: [integerColumn(column)] });
    for (let index = 1; index <= count; index++) run.handleDataRow({ fields: [row(index)] });
    run.handleCommandComplete({ text: `SELECT ${count}` });
}

async function lastStatement(run: ScriptRun): Promise<StatementOutcome> {
    run.handleReadyForQuery();
    const statements = await run.done;
    return statements[statements.length - 1];
}

describe("the rows a SQL console run keeps", () => {
    it("keeps the first maxRows rows of a 50,000-row statement and says it dropped the rest", async () => {
        const run = new ScriptRun("SELECT g FROM generate_series(1, 50000) g");
        sendStatement(run, 50_000);

        const last = await lastStatement(run);
        expect(last.rows.length).toBe(SQL_CONSOLE_RESULT_LIMITS.maxRows);
        expect(last.rows[0]).toEqual({ g: "1" });
        expect(last.rows[last.rows.length - 1]).toEqual({ g: String(SQL_CONSOLE_RESULT_LIMITS.maxRows) });
        expect(last.truncated).toBe(true);
        expect(last.received).toBe(50_000);
    });

    it("keeps a result under the limits whole, and does not call it truncated", async () => {
        const run = new ScriptRun("SELECT g FROM generate_series(1, 500) g");
        sendStatement(run, 500);

        const last = await lastStatement(run);
        expect(last.rows).toHaveLength(500);
        expect(last.truncated).toBe(false);
    });

    it("stops at the text budget when rows are wide, whatever their count", async () => {
        const run = new ScriptRun("SELECT repeat('x', 1000) FROM generate_series(1, 200)", { maxRows: 10_000, maxTextLength: 50_000 });
        sendStatement(run, 200, () => "x".repeat(1000));

        const last = await lastStatement(run);
        expect(last.rows).toHaveLength(50);
        expect(last.truncated).toBe(true);
        expect(last.received).toBe(200);
    });

    it("keeps every statement's rows when the script fits the budget", async () => {
        const run = new ScriptRun("SELECT g FROM generate_series(1, 3) g; SELECT 1 AS one; UPDATE t SET x = 1");
        sendStatement(run, 3);
        sendStatement(run, 1, () => "1", "one");
        run.handleCommandComplete({ text: "UPDATE 3" });
        run.handleReadyForQuery();

        const statements = await run.done;
        expect(statements.map(statement => statement.rows)).toEqual([
            [{ g: "1" }, { g: "2" }, { g: "3" }],
            [{ one: "1" }],
            []
        ]);
        expect(statements.map(statement => statement.tag)).toEqual(["SELECT 3", "SELECT 1", "UPDATE 3"]);
        expect(statements.some(statement => statement.truncated)).toBe(false);
    });

    it("shares one budget across the script: the earlier statement gives rows up so the last keeps its own", async () => {
        const run = new ScriptRun("SELECT g FROM generate_series(1, 50000) g; SELECT 1 AS one");
        sendStatement(run, 50_000);
        sendStatement(run, 1, () => "1", "one");
        run.handleReadyForQuery();

        const [first, second] = await run.done;
        expect(second.rows).toEqual([{ one: "1" }]);
        expect(second.truncated).toBe(false);
        // The first keeps its first rows, one fewer than the whole budget.
        expect(first.rows).toHaveLength(SQL_CONSOLE_RESULT_LIMITS.maxRows - 1);
        expect(first.rows[0]).toEqual({ g: "1" });
        expect(first.rows[first.rows.length - 1]).toEqual({ g: String(SQL_CONSOLE_RESULT_LIMITS.maxRows - 1) });
        expect(first.truncated).toBe(true);
        expect(first.received).toBe(50_000);
        const held = run.statements.reduce((total, statement) => total + statement.rows.length, 0);
        expect(held).toBe(SQL_CONSOLE_RESULT_LIMITS.maxRows);
    });

    it("never holds more than one statement's limits, however many statements fill it", async () => {
        const limits = { maxRows: 100, maxTextLength: 1_000_000 };
        const run = new ScriptRun("SELECT …; SELECT …; SELECT …", limits);
        sendStatement(run, 80);
        sendStatement(run, 80);
        sendStatement(run, 80);
        run.handleReadyForQuery();

        const statements = await run.done;
        expect(statements.map(statement => statement.rows.length)).toEqual([0, 20, 80]);
        expect(statements.map(statement => statement.truncated)).toEqual([true, true, false]);
        // The second statement kept its first rows, not its last.
        expect(statements[1].rows[0]).toEqual({ g: "1" });
    });

    it("cuts the last statement short only once the earlier ones hold nothing", async () => {
        const limits = { maxRows: 100, maxTextLength: 1_000_000 };
        const run = new ScriptRun("SELECT …; SELECT …", limits);
        sendStatement(run, 30);
        sendStatement(run, 150);
        run.handleReadyForQuery();

        const [first, second] = await run.done;
        expect(first.rows).toEqual([]);
        expect(first.truncated).toBe(true);
        expect(second.rows).toHaveLength(100);
        expect(second.truncated).toBe(true);
        expect(second.received).toBe(150);
    });

    it("does not empty the earlier statements for a row too wide to keep at all", async () => {
        const limits = { maxRows: 100, maxTextLength: 100 };
        const run = new ScriptRun("SELECT …; SELECT repeat('x', 500)", limits);
        sendStatement(run, 3);
        sendStatement(run, 1, () => "x".repeat(500), "wide");
        run.handleReadyForQuery();

        const [first, second] = await run.done;
        expect(first.rows).toHaveLength(3);
        expect(first.truncated).toBe(false);
        expect(second.rows).toEqual([]);
        expect(second.truncated).toBe(true);
    });

    it("keeps the rows of a SELECT that an UPDATE after it ends the script with", async () => {
        const run = new ScriptRun("SELECT g FROM generate_series(1, 5000) g; UPDATE t SET x = 1");
        sendStatement(run, 5_000);
        run.handleCommandComplete({ text: "UPDATE 3" });

        const last = await lastStatement(run);
        expect(last.tag).toBe("UPDATE 3");
        expect(last.rows).toEqual([]);
        expect(run.statements[0].rows).toHaveLength(5_000);
    });
});

describe("a result read in process (PGlite) keeps the same limits", () => {
    it("returns the first maxRows rows of 50,000, says it is truncated and how many there were", () => {
        const rows = Array.from({ length: 50_000 }, (_, index) => ({ g: index + 1 }));
        const result = sqlScriptResultFromRows(rows);

        expect(result.rows.length).toBe(SQL_CONSOLE_RESULT_LIMITS.maxRows);
        expect(result.rows[0]).toEqual({ g: "1" });
        expect(result.truncated).toBe(true);
        expect(result.rowCount).toBe(50_000);
    });

    it("says nothing about truncation for a result under the limits", () => {
        const result = sqlScriptResultFromRows([{ a: 1 }, { a: 2 }]);
        expect(result.rows).toEqual([{ a: "1" }, { a: "2" }]);
        expect(result.truncated).toBeUndefined();
    });
});

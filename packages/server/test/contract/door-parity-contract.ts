/**
 * One operation, one answer, whichever door it came through.
 *
 * Not a test file: the table every door is held to, and the judge that compares
 * a door's answer against it. A driver's suite supplies the doors — REST
 * (single, `/bulk`, `/_batch`), the realtime socket, the MCP tool handlers and
 * the in-process `driver.data` — on a real database, and runs every row of the
 * table through every door that can spell it. See
 * `packages/server-postgres/test/e2e/door-parity-e2e.test.ts`.
 *
 * It exists because each door had its own suite, and each suite described its
 * own door's habit. The data-doors audit (2026-10-01) drove the same operation
 * through every door and found the same row answered differently by door, over
 * and over: an upsert onto a trashed key answered "created" through every
 * upsert door while it wrote into the hidden row; an edit of a trashed row was
 * a 404 over REST and a silent success over the socket, MCP and in-process; a
 * restore left no history entry anywhere. Every one of those passed every
 * suite, because no suite stages the state a door got wrong, and no suite asks
 * a second door the same question. This is the delete contract
 * (`delete-contract.ts`) grown to the whole write surface: the rule is stated
 * once, here, and a door that answers differently fails by name.
 *
 * Deliberately not exported from the package index — test scaffolding, the
 * same as `delete-contract.ts`.
 */

/** Every way into the data plane the kit drives. */
export type Door = "rest" | "rest-bulk" | "rest-batch" | "socket" | "mcp" | "data";

export const DOORS: readonly Door[] = ["rest", "rest-bulk", "rest-batch", "socket", "mcp", "data"];

/** What the addressed key holds before the operation runs. */
export type StartingState =
    /** No row has this key. */
    | "absent"
    /** A live row, titled {@link STORED_TITLE}. */
    | "live"
    /** The same row, soft-deleted: in the trash. */
    | "trashed";

/** The title every staged row carries, so "nothing was written" is checkable. */
export const STORED_TITLE = "stored";

/**
 * One operation, addressed at the case's key (`id`).
 *
 * `values` never carries the key unless the case is about the key: a door
 * adds it where its spelling of the operation needs it in the body (a create,
 * an upsert).
 */
export type Operation =
    | { op: "create"; values: Record<string, unknown> }
    | { op: "update"; values: Record<string, unknown> }
    | { op: "upsert"; values: Record<string, unknown> }
    | { op: "delete"; hard?: boolean }
    | { op: "get" }
    /**
     * A list read narrowed to the case's key, so "the result is empty" is a
     * property of the starting state rather than of what else the table holds.
     */
    | { op: "list"; include?: string[] };

/** How a door's answer is classed. */
export type Outcome =
    /** A success, and a door that can say "created" (REST's 201) says so. */
    | "created"
    /** A success, and a door that can say "created" does not. */
    | "updated"
    /** A success; created-ness is not judged. */
    | "ok"
    | "not-found"
    | "conflict"
    | "invalid";

/** The HTTP status each refusal carries, on the doors that carry one. */
const STATUS_OF: Partial<Record<Outcome, number>> = {
    "not-found": 404,
    conflict: 409,
    invalid: 400
};

/**
 * A door's answer, normalized.
 *
 * `status` is absent on a door with no status slot (the socket). `created` is
 * absent on a door that cannot say whether its write created the row (all but
 * REST's single-row create). `rows` is what a list read returned.
 */
export type DoorAnswer =
    | { ok: true; status?: number; created?: boolean; row?: Record<string, unknown>; rows?: Record<string, unknown>[] }
    | { ok: false; status?: number; code?: string; message: string };

/** The facts after an operation, read from the database rather than through a door. */
export interface Observed {
    answer: DoorAnswer;
    /** Collection hooks that ran, in order: `beforeSave:new`, `afterDelete`, … (`afterRead` is not listed). */
    hooks: string[];
    /** History entries written for the key by the operation, in order. */
    history: { action: string; values: unknown }[];
    /** The addressed key's row after the operation. */
    state: StartingState;
    /** Its stored title, when there is a row. */
    title?: string;
}

/** What every door must answer. */
export interface Expectation {
    outcome: Outcome;
    /** The error code a refusal carries. */
    code?: string;
    hooks: string[];
    /** History actions written, in order. */
    history: string[];
    state: StartingState;
    /** The stored title after the operation (and the returned row's, on a success that returns one). */
    title?: string;
}

export interface ParityCase {
    /** Read as "given <state>, <name>". */
    name: string;
    /** The audit finding this row pins, when it pins one. */
    finding?: string;
    given: StartingState;
    when: Operation;
    then: Expectation;
    /**
     * Doors known to answer differently today, each with a pointer to the work
     * that will close it. The runner expects those to FAIL, so the day the gap
     * closes the suite says so and the entry has to be removed.
     */
    pending?: Partial<Record<Door, string>>;
}

const live = (title = STORED_TITLE) => ({ state: "live" as const, title });
const trashed = { state: "trashed" as const, title: STORED_TITLE };
const absent = { state: "absent" as const };

const saveHooks = (status: "new" | "existing") => [`beforeSave:${status}`, `afterSave:${status}`];
const everyDoor = (why: string): Partial<Record<Door, string>> =>
    Object.fromEntries(DOORS.map(door => [door, why]));

const DD4_DELETE_ENTRY = "DD-4: a delete records the admin view model (`{ __type: \"date\" }`) as its history entry";
const deleteHooks = ["beforeDelete", "afterDelete"];

/**
 * The table.
 *
 * A row reaches every door whose adapter spells its operation; a door that
 * cannot (MCP has no upsert, `_batch` no hard delete) is skipped for it, not
 * excused. The `finding` ids are the data-doors audit's.
 */
export const PARITY_CASES: readonly ParityCase[] = [
    // ── create ───────────────────────────────────────────────────────────
    {
        name: "a create on a free key",
        given: "absent",
        when: { op: "create", values: { title: "new" } },
        then: { outcome: "created", hooks: saveHooks("new"), history: ["create"], ...live("new") }
    },

    // ── update ───────────────────────────────────────────────────────────
    {
        name: "an update of a live row",
        given: "live",
        when: { op: "update", values: { title: "edited" } },
        then: { outcome: "updated", hooks: saveHooks("existing"), history: ["update"], ...live("edited") }
    },
    {
        name: "an update of a key no row has",
        given: "absent",
        when: { op: "update", values: { title: "ghost" } },
        // REST answered before any hook; the socket, MCP and `driver.data`
        // ran `beforeSave` for a row that is not there, then answered 404.
        then: { outcome: "not-found", code: "NOT_FOUND", hooks: [], history: [], ...absent }
    },
    {
        // REST answered 404, as the soft-delete page says; the socket, MCP and
        // `driver.data` edited the hidden row, ran its hooks and wrote history.
        name: "an update of a trashed row, other than a restore, is a 404",
        finding: "DD-3",
        given: "trashed",
        when: { op: "update", values: { title: "edited-while-trashed" } },
        then: { outcome: "not-found", code: "NOT_FOUND", hooks: [], history: [], ...trashed }
    },
    {
        // Every door restored the row and none recorded it: the read of the
        // previous values hid the trashed row, and history skips an update it
        // has nothing to compare with — so the trail said "deleted" while the
        // row was live.
        name: "a restore of a trashed row is an update, recorded as one",
        finding: "DD-4",
        given: "trashed",
        when: { op: "update", values: { deletedAt: null } },
        then: { outcome: "updated", hooks: saveHooks("existing"), history: ["update"], ...live() }
    },

    // ── upsert ───────────────────────────────────────────────────────────
    {
        name: "an upsert on a free key creates the row",
        given: "absent",
        when: { op: "upsert", values: { title: "upserted" } },
        then: { outcome: "created", hooks: saveHooks("new"), history: ["create"], ...live("upserted") }
    },
    {
        name: "an upsert on a live row's key updates that row",
        given: "live",
        when: { op: "upsert", values: { title: "upserted" } },
        then: { outcome: "ok", hooks: saveHooks("existing"), history: ["update"], ...live("upserted") }
    },
    {
        // It answered "created" and wrote into the deleted row: the row stayed
        // in the trash with the new values, hooks were told it was new, and
        // history gained a second `create` for a row that already existed.
        name: "an upsert on a trashed row's key is refused, naming the trash",
        finding: "DD-1",
        given: "trashed",
        when: { op: "upsert", values: { title: "revived?" } },
        then: { outcome: "conflict", code: "ROW_IN_TRASH", hooks: [], history: [], ...trashed }
    },

    // ── delete ───────────────────────────────────────────────────────────
    {
        name: "a delete of a live row puts it in the trash",
        given: "live",
        when: { op: "delete" },
        then: { outcome: "ok", hooks: deleteHooks, history: ["delete"], ...trashed },
        pending: everyDoor(DD4_DELETE_ENTRY)
    },
    {
        name: "a delete of a key no row has",
        given: "absent",
        when: { op: "delete" },
        then: { outcome: "not-found", code: "NOT_FOUND", hooks: [], history: [], ...absent }
    },
    {
        name: "a delete of a row already in the trash",
        given: "trashed",
        when: { op: "delete" },
        then: { outcome: "not-found", code: "NOT_FOUND", hooks: [], history: [], ...trashed }
    },
    {
        name: "a hard delete of a live row removes it",
        given: "live",
        when: { op: "delete", hard: true },
        then: { outcome: "ok", hooks: deleteHooks, history: ["delete"], ...absent },
        pending: everyDoor(DD4_DELETE_ENTRY)
    },
    {
        name: "a hard delete of a trashed row empties it from the trash",
        given: "trashed",
        when: { op: "delete", hard: true },
        then: { outcome: "ok", hooks: deleteHooks, history: ["delete"], ...absent },
        pending: everyDoor(DD4_DELETE_ENTRY)
    },

    // ── reads ────────────────────────────────────────────────────────────
    {
        name: "a read of a live row",
        given: "live",
        when: { op: "get" },
        then: { outcome: "ok", hooks: [], history: [], ...live() },
        pending: {
            socket: "the socket's FETCH_ONE serves the admin view model (`{ __type: \"date\" }`), "
                + "which the admin panel reads; a decision in the data-doors sweep report",
            mcp: "DD-7: get_document serves the admin view model (`{ __type: \"date\" }`); "
                + "the ai-and-extras fixer moves the MCP reads onto the REST walk"
        }
    },
    {
        name: "a read of a trashed row",
        given: "trashed",
        when: { op: "get" },
        then: { outcome: "not-found", code: "NOT_FOUND", hooks: [], history: [], ...trashed }
    }
];

/** Every key, at any depth, named `__type` — the admin view model's envelope. */
function envelopePaths(value: unknown, path = "$"): string[] {
    if (Array.isArray(value)) return value.flatMap((item, i) => envelopePaths(item, `${path}[${i}]`));
    if (value === null || typeof value !== "object" || value instanceof Date) return [];
    return Object.entries(value).flatMap(([key, inner]) =>
        key === "__type" ? [`${path}.__type`] : envelopePaths(inner, `${path}.${key}`));
}

/**
 * Compare what a door did with what the table says. An empty list is a pass;
 * each entry is one fact that differed, worded to be read in a failure.
 */
export function judge(expected: Expectation, observed: Observed): string[] {
    const wrong: string[] = [];
    const { answer } = observed;
    const succeeded = expected.outcome === "created" || expected.outcome === "updated" || expected.outcome === "ok";

    if (succeeded) {
        if (!answer.ok) {
            wrong.push(`answered ${answer.status ?? "error"} ${answer.code ?? ""} "${answer.message}", expected a success`);
        } else {
            if (expected.outcome === "created" && answer.created === false) {
                wrong.push(`answered ${answer.status} for a write that created the row; expected 201`);
            }
            if (expected.outcome === "updated" && answer.created === true) {
                wrong.push(`answered ${answer.status} — "created" — for a write that updated a stored row`);
            }
            const returned = answer.row ? [answer.row] : answer.rows ?? [];
            for (const row of returned) {
                const envelopes = envelopePaths(JSON.parse(JSON.stringify(row)));
                if (envelopes.length > 0) {
                    wrong.push(`returned the admin view model, not the row: ${envelopes.join(", ")}`);
                }
                if (expected.title !== undefined && "title" in row && row.title !== expected.title) {
                    wrong.push(`returned title ${JSON.stringify(row.title)}, expected ${JSON.stringify(expected.title)}`);
                }
            }
        }
    } else if (answer.ok) {
        wrong.push(`succeeded${answer.status ? ` (${answer.status})` : ""}; expected ${expected.outcome} ${expected.code ?? ""}`.trim());
    } else {
        const status = STATUS_OF[expected.outcome];
        if (answer.status !== undefined && answer.status !== status) {
            wrong.push(`answered status ${answer.status}, expected ${status} (${expected.outcome})`);
        }
        if (expected.code !== undefined && answer.code !== undefined && answer.code !== expected.code) {
            wrong.push(`answered code ${answer.code}, expected ${expected.code}`);
        }
        if (expected.code !== undefined && answer.code === undefined && answer.status === undefined) {
            wrong.push(`refused with neither a status nor a code ("${answer.message}"), expected ${expected.code}`);
        }
    }

    if (JSON.stringify(observed.hooks) !== JSON.stringify(expected.hooks)) {
        wrong.push(`ran hooks [${observed.hooks.join(", ")}], expected [${expected.hooks.join(", ")}]`);
    }
    const actions = observed.history.map(entry => entry.action);
    if (JSON.stringify(actions) !== JSON.stringify(expected.history)) {
        wrong.push(`wrote history [${actions.join(", ")}], expected [${expected.history.join(", ")}]`);
    }
    for (const entry of observed.history) {
        const envelopes = envelopePaths(entry.values);
        if (envelopes.length > 0) {
            wrong.push(`recorded a "${entry.action}" history entry in the admin view model, not the row: ${envelopes.join(", ")}`);
        }
    }
    if (observed.state !== expected.state) {
        wrong.push(`left the row ${observed.state}, expected ${expected.state}`);
    }
    if (expected.title !== undefined && observed.state !== "absent" && observed.title !== expected.title) {
        wrong.push(`left the stored title ${JSON.stringify(observed.title)}, expected ${JSON.stringify(expected.title)}`);
    }
    return wrong;
}

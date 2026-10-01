/**
 * How deep writes started by hooks may nest — and a refusal past that.
 *
 * A hook's `context.data` write runs the target collection's hooks too, which
 * is what makes a hook that writes its own collection recurse. Unconditional,
 * it never ends: every level is one short statement, so `statement_timeout`
 * never fires, and a request held its transaction and a row lock while its
 * `afterSave` ran tens of thousands of times — long after the client had given
 * up — until the process was killed.
 *
 * Each `save`/`delete` runs as a frame in an async-local chain; a write whose
 * chain is deeper than {@link MAX_WRITE_DEPTH} is refused, naming the hook that
 * started it and the collection it wrote. Siblings — the rows of a bulk write,
 * two writes one after another in a hook — are not nested and never add up.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ApiError } from "@rebasepro/server";

/**
 * Deep enough for any chain that ends (a hook writing another collection whose
 * hook writes a third is depth 3), shallow enough that a loop stops at once.
 */
export const MAX_WRITE_DEPTH = 16;

/** One write in progress, and which of its hooks is running. */
export interface WriteFrame {
    readonly path: string;
    readonly operation: "save" | "delete";
    readonly depth: number;
    readonly parent: WriteFrame | undefined;
    /** The hook running right now — what a nested write was started from. */
    stage: string | undefined;
}

/**
 * On `globalThis`, like the write-transaction scope beside it: a nested write
 * can reach a second copy of this package (a `dataAsAdmin` call from a hook),
 * and the chain has to be one chain.
 */
const FRAME_SLOT = Symbol.for("rebase.postgres.writeFrame");
type GlobalWithFrames = typeof globalThis & { [FRAME_SLOT]?: AsyncLocalStorage<WriteFrame> };
const frames: AsyncLocalStorage<WriteFrame> =
    ((globalThis as GlobalWithFrames)[FRAME_SLOT] ??= new AsyncLocalStorage<WriteFrame>());

/** Run one write as a frame, refusing it when the chain is already too deep. */
export function inWriteFrame<T>(
    path: string,
    operation: "save" | "delete",
    fn: (frame: WriteFrame) => Promise<T>
): Promise<T> {
    const parent = frames.getStore();
    const frame: WriteFrame = { path, operation, depth: (parent?.depth ?? 0) + 1, parent, stage: undefined };
    if (frame.depth > MAX_WRITE_DEPTH) {
        return Promise.reject(recursionError(frame));
    }
    return frames.run(frame, () => fn(frame));
}

function recursionError(frame: WriteFrame): ApiError {
    const starter = frame.parent;
    const hook = starter?.stage ?? "a hook";
    // The distinct hook → write steps in the chain, innermost first: for the
    // usual loop that is one line, `"orders" afterSave → save "orders"`.
    const steps: string[] = [];
    for (let f: WriteFrame | undefined = frame; f?.parent; f = f.parent) {
        const step = `"${f.parent.path}" ${f.parent.stage ?? "?"} → ${f.operation} "${f.path}"`;
        if (!steps.includes(step)) steps.push(step);
    }
    return new ApiError(
        500,
        "CALLBACK_RECURSION",
        `Writes started by hooks nested more than ${MAX_WRITE_DEPTH} deep, so this one was refused and the whole write ` +
        `rolled back. The ${hook} hook of "${starter?.path ?? frame.path}" ${frame.operation}s "${frame.path}" through ` +
        "`context.data`, which runs that collection's hooks again, and nothing in the chain stops it: " +
        `${steps.join("; ")}. Make the hook's write conditional — act on \`status === "new"\` only, or skip it ` +
        "when `values` already hold what it would write.",
        { chain: steps, depth: MAX_WRITE_DEPTH }
    );
}

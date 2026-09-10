/**
 * Release a Node handle's hold on the event loop, where the runtime has one.
 *
 * `unref` is Node's, not the web platform's. Node ref-counts the handles that
 * can keep a process alive — timers, `BroadcastChannel`, sockets — and gives
 * each an `unref()` that says "you are still live, but do not be the reason
 * this process refuses to exit". The browser's equivalents have no such method:
 * `setTimeout` there returns a plain number, and nothing is holding a page open
 * in the first place.
 *
 * So the call is genuinely conditional at runtime, in every package that runs
 * in both places. Spelled out at the call site it came to
 * `(handle as unknown as { unref?: () => void }).unref?.()` — a double cast,
 * because where the DOM declaration of `setTimeout` wins the handle is a
 * `number`, and `number` does not overlap an object type, so a single `as` is
 * refused. The `unknown` in the middle was there to make the refusal go away,
 * and it also discarded the check on the member's name and signature. There
 * were seven copies, which is seven chances to get one of those wrong.
 *
 * Takes `unknown` on purpose: the argument's type is exactly what is not known
 * here, and narrowing it to a timer would be a claim this cannot make about a
 * `BroadcastChannel`. A no-op on a browser handle, on `null`/`undefined`, and
 * on a Node timer that has already fired.
 */
export function unref(handle: unknown): void {
    // Separates the two runtimes' handles, and it is a fact established at
    // runtime rather than an assertion: the browser's timer handle is a number.
    if (handle === null || typeof handle !== "object") return;
    const fn = (handle as { unref?: unknown }).unref;
    // The one irreducible claim, and the narrowest available: something callable
    // under the name `unref`. Node declares it as `() => this`; the return is
    // discarded.
    if (typeof fn === "function") (fn as () => void).call(handle);
}

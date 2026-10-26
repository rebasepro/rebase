/**
 * "Simulate access" is read-only.
 *
 * The simulator answers "what does this role, user or key see". A write made
 * while simulating ran as the simulated identity for real: it committed as
 * `rebase_user` with `app.uid` set to the simulated uid, `entity_history`
 * recorded that uid as the author, callbacks saw `context.user` holding a role
 * the account may not even have, and a role-only simulation stamped owner
 * columns with the nobody uid. Only the request log named the administrator.
 * So every door that honours the simulation headers refuses anything but a
 * read, naming the simulation, rather than performing it as someone else.
 *
 * Its own module so the REST generator, history routes and the functions
 * guard can share it without importing the simulator itself.
 *
 * @module
 */

import { ApiError } from "../api/errors";
import type { DataOperation } from "./api-keys/http-operation";

/**
 * Refuse a write or delete on a request that simulates access.
 *
 * `c` is anything with the request context's `get` — the REST generator calls
 * this with a per-operation stand-in for each operation of a `_batch`.
 * `operation` is what the request does, not its verb: `POST …/query` is a read.
 */
export function refuseSimulatedWrite(c: { get: (key: string) => unknown }, operation: DataOperation): void {
    if (operation === "read" || !c.get("simulation")) return;
    throw new ApiError(403, "SIMULATION_READ_ONLY",
        "This request simulates access (x-rebase-simulate-*), and simulated access is read-only: it would " +
        `${operation === "delete" ? "delete" : "write"} as the simulated identity, not as you. ` +
        "Stop simulating to make changes.");
}

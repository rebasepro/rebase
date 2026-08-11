/**
 * What `DataDriver.delete` must answer, for every driver.
 *
 * Not a test file: a set of assertions each driver's own suite runs against its
 * own database. The two drivers cannot meet in one suite — `@rebasepro/server`
 * depends on neither, Postgres needs a container under vitest and Mongo runs on
 * `mongodb-memory-server` under jest — so the shared thing is the rule, not the
 * runner.
 *
 * It exists because the rule was previously stated twice, in each driver's
 * suite, in opposite directions. `MongoDataService.test.ts` asserted "should not
 * throw for non-existent entity" while `dataService.test.ts` asserted a 404 for
 * the same call, and both passed forever: each suite described its own driver's
 * habit and neither described the contract. A rule that lives in one place per
 * implementation is a rule each implementation gets to redefine.
 *
 * Deliberately not exported from the package index. It is test scaffolding, and
 * `@rebasepro/server`'s export surface is a compatibility promise to deployed
 * bundles (see `api-surface/`).
 */

/** Whatever shape the caller's assertion library takes. */
export interface ContractExpect {
    /** Assert the promise rejects with a 404-shaped error. */
    rejectsNotFound(promise: Promise<unknown>, id: string): Promise<void>;
}

/** The driver under test, reduced to what this contract talks about. */
export interface DeleteContractSubject {
    /** Collection path to write into and delete from. */
    path: string;
    /** Insert a row and answer with its id. */
    create(): Promise<string>;
    /** Delete through the driver's own public entry point. */
    delete(id: string): Promise<void>;
    /** Whether the row is still there, read through the driver. */
    exists(id: string): Promise<boolean>;
    /**
     * A syntactically valid id for this driver that names no row.
     *
     * Mongo needs a well-formed ObjectId or the failure is a cast error rather
     * than a miss; Postgres needs something its key column accepts. Asking the
     * driver keeps the assertion about the missing row instead of about id
     * parsing.
     */
    missingId(): Promise<string> | string;
}

/**
 * Run the contract.
 *
 * Two cases, and the pair is the point: a delete that removed a row resolves,
 * and a delete that removed nothing rejects. Either one alone can be satisfied
 * by a driver that always does the same thing.
 */
export async function assertDeleteContract(
    subject: DeleteContractSubject,
    expect: ContractExpect
): Promise<void> {
    // 1. A delete that removed the row resolves, and the row is gone.
    const id = await subject.create();
    await subject.delete(id);
    if (await subject.exists(id)) {
        throw new Error(
            `${subject.path}: delete("${id}") resolved but the row is still there — ` +
            "resolving means the row is gone because this call removed it."
        );
    }

    // 2. A delete that removed nothing rejects, rather than reporting the
    //    same success as the case above. This is the half that differed: a
    //    caller cannot tell "deleted" from "there was nothing there" without
    //    it, and on a driver with row-level security "matched nothing" is also
    //    how a refused delete arrives.
    const missing = await subject.missingId();
    await expect.rejectsNotFound(subject.delete(missing), missing);

    // 3. Deleting the same row twice is case 2 with a real id: the second call
    //    is addressing a row that is not there any more. A driver that special-
    //    cased "I deleted this recently" would pass the two above and still lie
    //    to the caller that repeated the request.
    const twice = await subject.create();
    await subject.delete(twice);
    await expect.rejectsNotFound(subject.delete(twice), twice);
}

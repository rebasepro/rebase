/**
 * A bulk create on the auth collection prepares its users several at a time
 * when the adapter says each preparation is independent — and one at a time
 * otherwise.
 *
 * The built-in adapter hashes every password with scrypt (about 30 ms each),
 * and `POST /users/bulk` with 1,000 rows did that serially: about 32 s in the
 * request. scrypt runs on libuv's thread pool, so the pool's width of hashes
 * can run at once. A preparation that runs a hook (`onCreateUser`, a custom
 * `onAdminCreateUser`) keeps its order: a hook may send an email or write
 * elsewhere, in the order the rows were given.
 *
 * Counted, not timed: the guard is how many preparations are in flight at
 * once, which does not flake on a loaded machine.
 */
import { describe, it, expect } from "@jest/globals";
import type { CollectionConfig, UserCreationPrepareResult, UserCreationWriteContract } from "@rebasepro/types";
import { prepareUserCreations, type UserCreatingAdapter } from "../src/api/rest/auth-collection-writes";

const usersCollection = { slug: "users", name: "Users", auth: true, properties: {} } as unknown as CollectionConfig;

function countingAdapter(contract: UserCreationWriteContract | undefined) {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: string[] = [];
    const adapter = {
        describeUserCreationContract: contract ? () => contract : undefined,
        async prepareUserCreation(values: Record<string, unknown>): Promise<UserCreationPrepareResult> {
            started.push(String(values.email));
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise(resolve => setTimeout(resolve, 15));
            inFlight--;
            return { values: { ...values, prepared: true }, hookHandledEmail: false, invitationSent: false };
        }
    } as unknown as UserCreatingAdapter;
    return { adapter, stats: () => ({ maxInFlight, started }) };
}

const bodies = Array.from({ length: 12 }, (_, i) => ({ email: `u${i}@example.com` }));

describe("prepareUserCreations", () => {
    it("prepares independent creations several at a time, and answers in the order given", async () => {
        const { adapter, stats } = countingAdapter({ validate: true, extraFields: ["password"], independent: true });
        const prepared = await prepareUserCreations(adapter, usersCollection, bodies, { roles: ["admin"] });

        expect(prepared.map(result => result.values.email)).toEqual(bodies.map(body => body.email));
        expect(prepared.every(result => result.values.prepared === true)).toBe(true);
        expect(stats().maxInFlight).toBeGreaterThan(1);
        expect(stats().maxInFlight).toBeLessThanOrEqual(Number(process.env.UV_THREADPOOL_SIZE) || 4);
    });

    it("prepares one at a time, in order, when the adapter does not say they are independent", async () => {
        for (const contract of [undefined, { validate: false, extraFields: [] }]) {
            const { adapter, stats } = countingAdapter(contract);
            await prepareUserCreations(adapter, usersCollection, bodies, { roles: ["admin"] });
            expect(stats().maxInFlight).toBe(1);
            expect(stats().started).toEqual(bodies.map(body => body.email));
        }
    });
});

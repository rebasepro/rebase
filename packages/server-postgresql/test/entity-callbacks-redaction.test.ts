import { describe, it, expect } from "@jest/globals";
import type { Entity, EntityAfterReadProps, EntityCallbacks } from "@rebasepro/types";

/**
 * Regression guard for the PII-redaction pattern.
 *
 * PII masking is defined in per-collection {@link EntityCallbacks.afterRead},
 * which runs inside the DataDriver. Because the driver is the single seam that
 * every read path funnels through, a field masked there stays masked on ALL
 * paths — REST, server-side `rebase.data`, and realtime — so a REST-only
 * `BackendHooks.data.afterRead` is neither required nor safe to rely on for
 * redaction.
 *
 * This suite proves the redaction contract:
 *   1. the `afterRead` masker redacts values (and does not mutate the source), and
 *   2. it is assignable to `EntityCallbacks.afterRead`, i.e. it is a valid
 *      driver/realtime callback.
 *
 * That the driver invokes `afterRead` on `fetchCollection` (REST list /
 * `rebase.data.find`) and `fetchEntity` (REST get / `rebase.data.findById`) is
 * already covered by the "storageSource in Callbacks" suite in
 * `postgresDataDriver.test.ts`; the realtime refetch invokes the identical
 * callback in `realtimeService.ts` (`fetchCollectionWithAuth` /
 * `fetchEntityWithAuth`).
 */

interface CustomerValues extends Record<string, unknown> {
    email: string;
    first_name: string;
    phone: string;
}

const maskEmail = (email: string): string => {
    const [local, domain] = email.split("@");
    return local && domain ? `${local[0]}***@${domain}` : email;
};

/**
 * A representative per-collection redactor. Typed to require only `entity`
 * (a supertype of the full props), so it is assignable to
 * `EntityCallbacks.afterRead` yet callable in isolation without constructing a
 * full `RebaseCallContext`.
 */
const redactCustomer = (
    { entity }: Pick<EntityAfterReadProps<CustomerValues>, "entity">
): Entity<CustomerValues> => ({
    ...entity,
    values: {
        ...entity.values,
        email: maskEmail(entity.values.email),
        phone: "***"
    }
});

// Compile-time proof: the redactor is a valid EntityCallbacks.afterRead, so the
// driver and realtime service accept and invoke it on every read path.
const customerCallbacks: EntityCallbacks<CustomerValues> = { afterRead: redactCustomer };
void customerCallbacks;

describe("EntityCallbacks.afterRead PII redaction contract", () => {

    const customer: Entity<CustomerValues> = {
        id: "c1",
        path: "customers",
        values: { email: "jane.doe@acme.com", first_name: "Jane", phone: "+15551234567" }
    };

    it("masks redacted fields in the returned entity", () => {
        const result = redactCustomer({ entity: customer });

        expect(result.values.email).toBe("j***@acme.com");
        expect(result.values.phone).toBe("***");
    });

    it("leaves non-redacted fields untouched", () => {
        const result = redactCustomer({ entity: customer });

        expect(result.values.first_name).toBe("Jane");
        expect(result.id).toBe("c1");
        expect(result.path).toBe("customers");
    });

    it("does not mutate the source entity", () => {
        redactCustomer({ entity: customer });

        expect(customer.values.email).toBe("jane.doe@acme.com");
        expect(customer.values.phone).toBe("+15551234567");
    });
});

import { describe, it, expect } from "@jest/globals";
import type { AfterReadProps, CollectionCallbacks } from "@rebasepro/types";

/**
 * Regression guard for the PII-redaction pattern.
 *
 * PII masking is defined in per-collection {@link CollectionCallbacks.afterRead},
 * which the DataDriver runs on every read path — REST/SDK (`restFetchService`),
 * server-side `rebase.data` (`fetchCollection`/`fetchOne`), and realtime.
 *
 * This suite proves the redaction contract:
 *   1. the `afterRead` masker redacts the flat `row` (and does not mutate the
 *      source), and
 *   2. it is assignable to `CollectionCallbacks.afterRead`, i.e. it is a valid
 *      driver/realtime callback.
 *
 * That the driver invokes `afterRead` on the REST path is guarded directly by the
 * "restFetchService runs afterRead" suite in `postgresDataDriver.test.ts`.
 */

interface CustomerValues extends Record<string, unknown> {
    id: string;
    email: string;
    first_name: string;
    phone: string;
}

const maskEmail = (email: string): string => {
    const [local, domain] = email.split("@");
    return local && domain ? `${local[0]}***@${domain}` : email;
};

/**
 * A representative per-collection redactor. Receives the flat `row` (a supertype
 * of the full props via `Pick`), so it is assignable to
 * `CollectionCallbacks.afterRead` yet callable in isolation without constructing
 * a full `RebaseCallContext`.
 */
const redactCustomer = (
    { row }: Pick<AfterReadProps<CustomerValues>, "row">
): Record<string, unknown> => ({
    ...row,
    email: maskEmail(row.email as string),
    phone: "***"
});

// Compile-time proof: the redactor is a valid CollectionCallbacks.afterRead, so the
// driver and realtime service accept and invoke it on every read path.
const customerCallbacks: CollectionCallbacks<CustomerValues> = { afterRead: redactCustomer };
void customerCallbacks;

describe("CollectionCallbacks.afterRead PII redaction contract", () => {

    const customer: Record<string, unknown> = {
        id: "c1",
        email: "jane.doe@acme.com",
        first_name: "Jane",
        phone: "+15551234567"
    };

    it("masks redacted fields in the returned row", () => {
        const result = redactCustomer({ row: customer });

        expect(result.email).toBe("j***@acme.com");
        expect(result.phone).toBe("***");
    });

    it("leaves non-redacted fields untouched", () => {
        const result = redactCustomer({ row: customer });

        expect(result.first_name).toBe("Jane");
        expect(result.id).toBe("c1");
    });

    it("does not mutate the source row", () => {
        redactCustomer({ row: customer });

        expect(customer.email).toBe("jane.doe@acme.com");
        expect(customer.phone).toBe("+15551234567");
    });
});

import { Hono } from "hono";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import { assertKnownWriteFields, assertWriteRequestValid } from "../src/api/rest/write-validation";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { ApiError, errorHandler } from "../src/api/errors";

/**
 * Per-field `access.write`, at the write boundary.
 *
 * Row access is the collection's security rules; this is the field inside the
 * row, and the two are independent. The rule that matters here is that a value
 * for a field the caller may not set is **refused**, never dropped: a write that
 * silently discards a key answers 201 for an edit that did not happen, and a
 * form has no way to find out.
 *
 * The empty list and the role list are one mechanism with two answers —
 * `VALIDATION_EXCLUDED_FIELDS` is a fact about the collection and the same for
 * everybody, `FIELD_NOT_WRITABLE` is a fact about the caller and would be a 200
 * for their colleague — so a client can tell "never" from "not yet" without
 * parsing English.
 */

const staff = {
    slug: "staff",
    name: "Staff",
    table: "staff",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        // Readable by HR, writable by HR.
        salary: { type: "number", access: { read: ["hr"], write: ["hr"] } },
        // Everyone may read it; nobody may set it through the API.
        rating: { type: "number", access: { write: [] } },
        // The old spelling of the line above, applied to both directions.
        passwordHash: { type: "string", columnName: "password_hash", excludeFromApi: true },
        // No rule at all.
        nickname: { type: "string" }
    }
} as unknown as CollectionConfig;

function thrown(fn: () => void): ApiError {
    try {
        fn();
    } catch (e) {
        return e as ApiError;
    }
    throw new Error("expected a refusal, and the write was accepted");
}

const hr = { roles: ["hr"] };
const clerk = { roles: ["staff"] };
const admin = { roles: ["admin"] };
const anon = { roles: ["anon"] };

describe("access.write on a create", () => {
    it("accepts the field from a caller holding the role", () => {
        expect(() => assertKnownWriteFields({ salary: 90_000 }, staff, { viewer: hr })).not.toThrow();
    });

    it("refuses it from a caller who does not, naming the field", () => {
        const error = thrown(() => assertKnownWriteFields({ salary: 90_000 }, staff, { viewer: clerk }));
        expect(error.code).toBe("FIELD_NOT_WRITABLE");
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain("'salary'");
    });

    it("carries `details.violations` keyed by the wire name the caller sent", () => {
        const error = thrown(() => assertKnownWriteFields({ salary: 1 }, staff, { viewer: clerk }));
        expect((error.details as { violations: unknown[] }).violations).toEqual([
            { field: "salary", code: "access", message: expect.stringContaining("'salary'") }
        ]);
    });

    it("lets `admin` through any non-empty role list", () => {
        expect(() => assertKnownWriteFields({ salary: 1 }, staff, { viewer: admin })).not.toThrow();
    });

    it("refuses an anonymous caller, who holds no application role", () => {
        expect(thrown(() => assertKnownWriteFields({ salary: 1 }, staff, { viewer: anon })).code)
            .toBe("FIELD_NOT_WRITABLE");
    });

    it("leaves a field with no rule alone", () => {
        expect(() => assertKnownWriteFields({ nickname: "ada" }, staff, { viewer: anon })).not.toThrow();
    });

    it("treats an absent viewer as the trusted server plane", () => {
        // `rebase.data` in a hook, a migration, the auth adapter. This is the
        // exemption that makes the rule enforceable at all — something has to be
        // able to write the column.
        expect(() => assertKnownWriteFields({ salary: 1 }, staff)).not.toThrow();
    });
});

describe("the empty list", () => {
    it("refuses every caller, including admin, with the excluded code", () => {
        for (const viewer of [hr, clerk, admin, anon]) {
            const error = thrown(() => assertKnownWriteFields({ rating: 5 }, staff, { viewer }));
            expect(error.code).toBe("VALIDATION_EXCLUDED_FIELDS");
        }
    });

    it("refuses the trusted plane too — `[]` is not a role check", () => {
        // The one difference from the role case, and it is the whole point of
        // `excludeFromApi`: this rule is about the API surface, not about who is
        // calling. In-process writes bypass this function entirely; a write that
        // *reaches* it is an API write.
        expect(thrown(() => assertKnownWriteFields({ rating: 5 }, staff)).code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
    });

    it("is what `excludeFromApi` expands to, under either spelling of the name", () => {
        expect(thrown(() => assertKnownWriteFields({ passwordHash: "x" }, staff, { viewer: admin })).code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(thrown(() => assertKnownWriteFields({ password_hash: "x" }, staff, { viewer: admin })).code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
    });
});

describe("every write door", () => {
    it("refuses a bulk row, naming the row index", () => {
        const error = thrown(() =>
            assertKnownWriteFields({ salary: 1 }, staff, { rowIndex: 3, viewer: clerk }));
        expect(error.code).toBe("FIELD_NOT_WRITABLE");
        expect(error.message).toContain("Row 3");
    });

    it("refuses a field operation, which names its field the same way a value does", () => {
        // `{ salary: { $inc: 1000 } }` is a write to `salary`; the key is the
        // field, so the rule needs no special case for it — and must not.
        const error = thrown(() =>
            assertKnownWriteFields({ salary: { $inc: 1000 } }, staff, { viewer: clerk }));
        expect(error.code).toBe("FIELD_NOT_WRITABLE");
    });

    it("refuses through `assertWriteRequestValid`, which is the socket's door", () => {
        const error = thrown(() =>
            assertWriteRequestValid({ salary: 1 }, staff, { viewer: clerk }));
        expect(error.code).toBe("FIELD_NOT_WRITABLE");
    });

    it("accepts through the socket's door for a caller holding the role", () => {
        expect(() => assertWriteRequestValid({ salary: 1 }, staff, { viewer: hr })).not.toThrow();
    });
});

describe("the known-fields list", () => {
    /**
     * The list in an "unknown field" error is an offer. Offering a field the
     * next request would refuse is worse than saying nothing.
     */
    it("does not name a field this caller cannot write", () => {
        const error = thrown(() => assertKnownWriteFields({ titel: "x" }, staff, { viewer: clerk }));
        expect(error.code).toBe("VALIDATION_UNKNOWN_FIELDS");
        expect(error.message).not.toContain("'salary'");
        expect(error.message).toContain("'nickname'");
    });

    it("names it for a caller who can", () => {
        const error = thrown(() => assertKnownWriteFields({ titel: "x" }, staff, { viewer: hr }));
        expect(error.message).toContain("'salary'");
    });
});

describe("strictWrites: false", () => {
    /**
     * A convenience flag must not switch off a security rule. `strictWrites`
     * says "this config does not list every column"; it says nothing about who
     * may write the columns it *does* list.
     */
    const loose = { ...staff, strictWrites: false } as unknown as CollectionConfig;

    it("still refuses a field the caller cannot write", () => {
        expect(thrown(() => assertKnownWriteFields({ salary: 1 }, loose, { viewer: clerk })).code)
            .toBe("FIELD_NOT_WRITABLE");
    });

    it("still refuses an excluded one", () => {
        expect(thrown(() => assertKnownWriteFields({ rating: 1 }, loose, { viewer: admin })).code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
    });

    it("still lets an undeclared key through, which is what the flag is for", () => {
        expect(() => assertKnownWriteFields({ whatever: 1 }, loose, { viewer: clerk })).not.toThrow();
    });
});

describe("the foreign key of a to-one relation", () => {
    /**
     * `bandId: 7` sets the column `band: { id: 7 }` sets. A write rule on the
     * relation that left its key open was one a caller stepped around by
     * spelling the write the way the row is served — and the read side already
     * treats the two as one field.
     */
    const bands = {
        slug: "bands",
        table: "bands",
        properties: { id: { type: "number", isId: "increment" } }
    } as unknown as CollectionConfig;
    const offices = {
        slug: "offices",
        table: "offices",
        properties: { id: { type: "number", isId: "increment" } }
    } as unknown as CollectionConfig;
    const banded = {
        ...staff,
        properties: {
            ...staff.properties,
            band: {
                type: "relation",
                access: { write: ["hr"] },
                relation: { kind: "belongsTo", target: () => bands, localKey: "band_id" }
            },
            office: {
                type: "relation",
                excludeFromApi: true,
                relation: { kind: "belongsTo", target: () => offices, localKey: "office_id" }
            }
        }
    } as unknown as CollectionConfig;
    const loose = { ...banded, strictWrites: false } as unknown as CollectionConfig;

    it.each(["bandId", "band_id"])("refuses `%s` from a caller who may not write the relation", (key) => {
        for (const collection of [banded, loose]) {
            const error = thrown(() => assertKnownWriteFields({ [key]: 7 }, collection, { viewer: clerk }));
            expect(error.code).toBe("FIELD_NOT_WRITABLE");
            expect((error.details as { fields: string[] }).fields).toEqual([key]);
        }
    });

    it("accepts it from a caller who may", () => {
        expect(() => assertKnownWriteFields({ bandId: 7 }, banded, { viewer: hr })).not.toThrow();
        expect(() => assertKnownWriteFields({ band_id: 7 }, loose, { viewer: hr })).not.toThrow();
    });

    it.each(["officeId", "office_id"])("refuses `%s` to everyone when the relation is `excludeFromApi`", (key) => {
        for (const viewer of [admin, hr, undefined]) {
            const error = thrown(() => assertKnownWriteFields({ [key]: 3 }, loose, { viewer }));
            expect(error.code).toBe("VALIDATION_EXCLUDED_FIELDS");
            expect((error.details as { fields: string[] }).fields).toEqual([key]);
        }
    });

    it("refuses it through `assertWriteRequestValid`, which is the socket's and MCP's door", () => {
        expect(thrown(() => assertWriteRequestValid({ bandId: 7 }, banded, { viewer: clerk })).code)
            .toBe("FIELD_NOT_WRITABLE");
    });

    it("is not offered in the known-fields list to a caller who may not write it", () => {
        expect(thrown(() => assertKnownWriteFields({ titel: "x" }, banded, { viewer: clerk })).message)
            .not.toContain("'bandId'");
        expect(thrown(() => assertKnownWriteFields({ titel: "x" }, banded, { viewer: hr })).message)
            .toContain("'bandId'");
    });

    describe("through the REST routes", () => {
        function mount(roles: string[]) {
            const save = jest.fn(async ({ values }: { values: Record<string, unknown> }) => ({ id: 1, ...values }));
            const driver = {
                key: "postgres",
                initialised: true,
                fetchOne: jest.fn(async () => ({ id: 1, name: "ada", bandId: 1 })),
                save,
                saveMany: jest.fn(async () => [])
            } as unknown as DataDriver;
            const app = new Hono();
            app.onError(errorHandler);
            app.use("/*", async (c, next) => {
                c.set("driver" as never, driver as never);
                c.set("user" as never, { uid: "u1", roles } as never);
                await next();
            });
            app.route("/", new RestApiGenerator([banded, bands, offices], driver).generateRoutes());
            const send = (method: string, path: string, body: unknown) => app.request(path, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const writes = () => save.mock.calls.length + (driver.saveMany as jest.Mock).mock.calls.length;
            return { send, writes };
        }

        it.each([
            ["POST", "/staff", { name: "ada", bandId: 7 }],
            ["PATCH", "/staff/1", { bandId: 7 }],
            ["PATCH", "/staff/1", { band_id: 7 }],
            ["POST", "/staff/bulk", { rows: [{ name: "ada", bandId: 7 }] }]
        ])("%s %s refuses the key, and writes nothing", async (method, path, body) => {
            const { send, writes } = mount(["staff"]);
            const res = await send(method, path, body);
            expect(res.status).toBe(400);
            expect((await res.json() as { error: { code: string } }).error.code).toBe("FIELD_NOT_WRITABLE");
            expect(writes()).toBe(0);
        });

        it("writes it for a caller who may write the relation", async () => {
            const { send, writes } = mount(["hr"]);
            const res = await send("PATCH", "/staff/1", { bandId: 7 });
            expect(res.status).toBe(200);
            expect(writes()).toBe(1);
        });
    });
});

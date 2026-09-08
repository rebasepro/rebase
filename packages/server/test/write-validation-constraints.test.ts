import { CollectionConfig } from "@rebasepro/types";
import { assertKnownWriteFields, assertWriteValuesValid, type WriteViolation } from "../src/api/rest/write-validation";

/** The `details` an `ApiError` carries, in the shape these rules put there. */
type ConstraintDetails = {
    collection?: string;
    violations?: WriteViolation[];
    messages?: string[];
};

/** Run `fn` and hand back the ApiError it must have thrown. */
function thrown(fn: () => void): Error & { code?: string; statusCode?: number; details?: unknown } {
    try {
        fn();
    } catch (error) {
        return error as Error & { code?: string; statusCode?: number; details?: unknown };
    }
    throw new Error("expected a validation error, and none was thrown");
}

const details = (error: { details?: unknown }): ConstraintDetails => error.details as ConstraintDetails;

/**
 * `strictWrites: false` says "this config does not list every column". It was
 * also the single early return above every other rule in `assertKnownWriteFields`,
 * so it silently switched off the `excludeFromApi` refusal — a security rule
 * that a convenience flag has no business disabling.
 */
describe("excludeFromApi is independent of strictWrites", () => {
    const users = (strictWrites?: boolean): CollectionConfig => ({
        slug: "users",
        name: "Users",
        table: "users",
        ...(strictWrites === undefined ? {} : { strictWrites }),
        properties: {
            id: { type: "string", isId: "uuid" },
            email: { type: "string" },
            passwordHash: { type: "string", columnName: "password_hash", excludeFromApi: true }
        }
    });

    it("refuses an excluded property when strictWrites is on", () => {
        const error = thrown(() => assertKnownWriteFields({ passwordHash: "x" }, users()));
        expect(error.code).toBe("VALIDATION_EXCLUDED_FIELDS");
    });

    it("still refuses it when strictWrites is off", () => {
        // The bug: `strictWrites: false` returned before this rule ran, so an
        // hour-long access token became a password the attacker chose.
        const error = thrown(() => assertKnownWriteFields({ passwordHash: "x" }, users(false)));
        expect(error.code).toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(error.statusCode).toBe(400);
    });

    it("refuses the physical column spelling too", () => {
        const error = thrown(() => assertKnownWriteFields({ password_hash: "x" }, users(false)));
        expect(error.code).toBe("VALIDATION_EXCLUDED_FIELDS");
    });

    it("keeps letting undeclared keys through when strictWrites is off", () => {
        // The flag's actual job, unchanged.
        expect(() => assertKnownWriteFields({ nickname: "ada" }, users(false))).not.toThrow();
        expect(() => assertKnownWriteFields({ nickname: "ada" }, users())).toThrow(/has no field/);
    });
});

/**
 * A string `matches` is stored in the serialized `"/…/flags"` form — that is
 * what `serializeRegExp` produces and what the Studio's collection editor
 * writes. The form hydrates it; the server used to hand it to `new RegExp`
 * literally, so the slashes became characters and the flag became a letter.
 */
describe("matches parity with the form", () => {
    const codes = (matches: string | RegExp): CollectionConfig => ({
        slug: "codes",
        name: "Codes",
        table: "codes",
        properties: { country: { type: "string", validation: { matches } } }
    });

    it("reads a serialized pattern with flags the way the form does", () => {
        expect(() => assertWriteValuesValid({ country: "US" }, codes("/^[A-Z]{2}$/i"))).not.toThrow();
        expect(() => assertWriteValuesValid({ country: "us" }, codes("/^[A-Z]{2}$/i"))).not.toThrow();
        expect(() => assertWriteValuesValid({ country: "USA" }, codes("/^[A-Z]{2}$/i"))).toThrow(/pattern/);
    });

    it("still reads a bare pattern as a pattern", () => {
        expect(() => assertWriteValuesValid({ country: "US" }, codes("^[A-Z]{2}$"))).not.toThrow();
        expect(() => assertWriteValuesValid({ country: "usa" }, codes("^[A-Z]{2}$"))).toThrow(/pattern/);
    });

    it("strips g and y out of a serialized pattern, so repeated rows agree", () => {
        const collection = codes("/[a-z]+/g");
        expect(() => assertWriteValuesValid({ country: "abc" }, collection)).not.toThrow();
        expect(() => assertWriteValuesValid({ country: "abc" }, collection)).not.toThrow();
        expect(() => assertWriteValuesValid({ country: "abc" }, collection)).not.toThrow();
    });
});

describe("enum membership", () => {
    const posts: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            status: { type: "string", enum: { draft: "Draft", published: "Published" } },
            priority: { type: "number", enum: { 1: "Low", 2: "High" } },
            tags: {
                type: "array",
                of: { type: "string", enum: [{ id: "news", label: "News" }, { id: "tech", label: "Tech" }] }
            }
        }
    };

    it("accepts a declared label", () => {
        expect(() => assertWriteValuesValid({ status: "draft" }, posts)).not.toThrow();
    });

    it("refuses an undeclared string label, naming the field and the options", () => {
        // Postgres raises 22P02 for a real enum column, which aborts the
        // transaction and renders as `Invalid data format in "posts".` with no
        // field named. On a plain `text` column nothing rejected it at all.
        const error = thrown(() => assertWriteValuesValid({ status: "archived" }, posts));
        expect(error.code).toBe("VALIDATION_CONSTRAINT");
        expect(error.message).toContain("'draft'");
        expect(error.message).toContain("'published'");
        expect(details(error).violations).toEqual([
            expect.objectContaining({ field: "status", code: "enum" })
        ]);
    });

    it("refuses an undeclared number", () => {
        const error = thrown(() => assertWriteValuesValid({ priority: 99 }, posts));
        expect(details(error).violations?.[0]).toMatchObject({ field: "priority", code: "enum" });
    });

    it("accepts a number enum id sent as a JSON number", () => {
        expect(() => assertWriteValuesValid({ priority: 2 }, posts)).not.toThrow();
    });

    it("refuses an undeclared element of an array of enums, naming the index", () => {
        const error = thrown(() => assertWriteValuesValid({ tags: ["news", "gossip"] }, posts));
        expect(details(error).violations?.[0]).toMatchObject({ field: "tags[1]", code: "enum" });
    });

    it("accepts the array form of EnumValues", () => {
        expect(() => assertWriteValuesValid({ tags: ["news", "tech"] }, posts)).not.toThrow();
    });
});

describe("email and url", () => {
    const contacts: CollectionConfig = {
        slug: "contacts",
        name: "Contacts",
        table: "contacts",
        properties: {
            email: { type: "string", email: true },
            website: { type: "string", url: true }
        }
    };

    it("refuses a value that is not an email, though the OpenAPI said format: email", () => {
        const error = thrown(() => assertWriteValuesValid({ email: "ada at example.com" }, contacts));
        expect(details(error).violations?.[0]).toMatchObject({ field: "email", code: "email" });
    });

    it("accepts an ordinary address", () => {
        expect(() => assertWriteValuesValid({ email: "ada@example.com" }, contacts)).not.toThrow();
    });

    it("refuses a relative reference for a url property", () => {
        const error = thrown(() => assertWriteValuesValid({ website: "example.com/about" }, contacts));
        expect(details(error).violations?.[0]).toMatchObject({ field: "website", code: "url" });
    });

    it("accepts an absolute URL", () => {
        expect(() => assertWriteValuesValid({ website: "https://example.com/about" }, contacts)).not.toThrow();
    });

    it("says nothing about an empty string, which is an unset field", () => {
        expect(() => assertWriteValuesValid({ email: "", website: "" }, contacts)).not.toThrow();
    });
});

describe("required on create", () => {
    const authors: CollectionConfig = {
        slug: "authors",
        name: "Authors",
        table: "authors",
        properties: { id: { type: "number", isId: "increment" } }
    };

    const posts: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string", validation: { required: true } },
            slug: { type: "string", validation: { required: true }, defaultValue: "untitled" },
            createdAt: { type: "date", autoValue: "on_create", validation: { required: true } },
            secret: { type: "string", excludeFromApi: true, validation: { required: true } },
            author: { type: "relation", relationName: "author", validation: { required: true } }
        },
        relations: [
            { kind: "belongsTo", relationName: "author", target: () => authors, localKey: "author_id" }
        ]
    };

    it("names the missing field, in the wire spelling, before any hook runs", () => {
        // The old answer was a 23502 naming the *column* — and only after
        // `beforeSave` had already charged the card.
        const error = thrown(() => assertWriteValuesValid({ authorId: 1 }, posts, { status: "new" }));
        expect(error.code).toBe("VALIDATION_CONSTRAINT");
        expect(details(error).violations).toEqual([
            expect.objectContaining({ field: "title", code: "required" })
        ]);
    });

    it("skips a property the create path or the server fills in", () => {
        // `id` (generated), `slug` (defaultValue), `createdAt` (autoValue) and
        // `secret` (excludeFromApi) all have a value by the time the INSERT runs.
        expect(() => assertWriteValuesValid({ title: "Hello", authorId: 1 }, posts, { status: "new" })).not.toThrow();
    });

    it("accepts either spelling of an owning relation", () => {
        expect(() => assertWriteValuesValid({ title: "Hello", author: 1 }, posts, { status: "new" })).not.toThrow();
        expect(() => assertWriteValuesValid({ title: "Hello", authorId: 1 }, posts, { status: "new" })).not.toThrow();
        const error = thrown(() => assertWriteValuesValid({ title: "Hello" }, posts, { status: "new" }));
        expect(details(error).violations?.[0]).toMatchObject({ field: "author", code: "required" });
    });

    it("treats an explicit null as absent", () => {
        const error = thrown(() => assertWriteValuesValid({ title: null, authorId: 1 }, posts, { status: "new" }));
        expect(details(error).violations?.[0]).toMatchObject({ field: "title", code: "required" });
    });

    it("says nothing on a partial update, which omits keys legitimately", () => {
        expect(() => assertWriteValuesValid({ title: "Hi" }, posts, { status: "existing" })).not.toThrow();
        // And nothing at all without a status: the caller has not said which
        // this is, so `required` stays the database's NOT NULL.
        expect(() => assertWriteValuesValid({ title: "Hi" }, posts)).not.toThrow();
    });

    it("uses the author's own requiredMessage when there is one", () => {
        const collection: CollectionConfig = {
            slug: "t", name: "T", table: "t",
            properties: { name: { type: "string", validation: { required: true, requiredMessage: "Every widget needs a name." } } }
        };
        const error = thrown(() => assertWriteValuesValid({}, collection, { status: "new" }));
        expect(error.message).toContain("Every widget needs a name.");
    });
});

describe("the 400 carries structured violations alongside the message list", () => {
    const products: CollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            price: { type: "number", validation: { min: 0 } },
            sku: { type: "string", validation: { length: 8 } }
        }
    };

    it("reports every failing field at once, each with a field and a code", () => {
        const error = thrown(() => assertWriteValuesValid({ price: -5, sku: "abc" }, products));
        const d = details(error);
        expect(d.collection).toBe("products");
        expect(d.violations).toEqual([
            expect.objectContaining({ field: "price", code: "min" }),
            expect.objectContaining({ field: "sku", code: "length" })
        ]);
        // The message list is kept, and the joined message is still the
        // human-readable sentence a form without violation support shows.
        expect(d.messages).toHaveLength(2);
        expect(error.message).toBe(d.messages!.join(" "));
    });

    it("dots the field through a map, so a nested input can be marked", () => {
        const collection: CollectionConfig = {
            slug: "orders", name: "Orders", table: "orders",
            properties: {
                address: {
                    type: "map",
                    properties: { zip: { type: "string", validation: { length: 5 } } }
                }
            }
        };
        const error = thrown(() => assertWriteValuesValid({ address: { zip: "1" } }, collection));
        expect(details(error).violations?.[0]).toMatchObject({ field: "address.zip", code: "length" });
    });
});

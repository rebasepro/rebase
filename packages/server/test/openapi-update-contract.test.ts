/**
 * The published OpenAPI spec must describe the update endpoint the server serves.
 *
 * It did not. `PUT /data/{slug}/{id}` was the only update route, and PUT means
 * replace — while the handler merges, writing the columns in the body and
 * leaving the rest, which is what the SDK's `update(id, Partial<M>)` sends. The
 * spec then reused the *create* input schema for it, so every
 * `validation.required` property was marked required on an update too.
 *
 * That is a contract nobody implements: a client generated from the spec demands
 * fields the server does not, and a spec-validating gateway in front of the API
 * would reject partial updates the server accepts. The generated spec is a
 * first-class developer surface — this pins it to the truth.
 */
import { generateOpenApiSpec } from "../src/api/openapi-generator";
import { CollectionConfig } from "../../types/src/types/collections";

const collection = {
    slug: "users", name: "Users", singularName: "User", table: "users",
    properties: {
        name: { name: "Name", type: "string", validation: { required: true } },
        bio: { name: "Bio", type: "string" }
    }
} as unknown as CollectionConfig;

describe("openapi update contract", () => {
    const spec = generateOpenApiSpec([collection]) as any;
    const op = spec.paths["/data/users/{id}"];

    it("describes the update under one verb", () => {
        // PUT used to be listed beside PATCH, marked deprecated, pointing at the
        // same handler — so a generator had to pick, and the one it picked meant
        // "replace" for an operation that merges.
        expect(op.patch).toBeDefined();
        expect(op.put).toBeUndefined();
    });

    it("uses an Update schema with no required fields", () => {
        const ref = op.patch.requestBody.content["application/json"].schema.$ref;
        expect(ref).toBe("#/components/schemas/UserUpdate");
        const upd = spec.components.schemas.UserUpdate;
        expect(upd.required).toBeUndefined();
        expect(Object.keys(upd.properties)).toEqual(expect.arrayContaining(["name", "bio"]));
    });

    it("still marks required fields on create", () => {
        const inp = spec.components.schemas.UserInput;
        expect(inp.required).toEqual(["name"]);
    });
});

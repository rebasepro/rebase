/**
 * A `databaseDefault` column is not required in the create body: the database
 * fills it when the INSERT leaves it out, and the server's create check agrees.
 */
import { buildCollectionInputSchema } from "../src/api/openapi-generator";
import type { CollectionConfig } from "@rebasepro/types";

describe("openapi create body and databaseDefault", () => {
    it("lists a required column the database fills as optional", () => {
        const collection: CollectionConfig = {
            slug: "tickets", name: "Tickets", table: "tickets",
            properties: {
                title: { type: "string", validation: { required: true } },
                code: { type: "string", validation: { required: true }, databaseDefault: true }
            }
        };

        const schema = buildCollectionInputSchema(collection) as { required?: string[]; properties: Record<string, unknown> };
        expect(schema.required).toEqual(["title"]);
        expect(schema.properties).toHaveProperty("code");
    });
});

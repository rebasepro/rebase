import type { Property, PropertyBuilderProps } from "@rebasepro/types";
import { resolveProperty } from "../src/util/resolutions";

/** A `dynamicProps` builder is handed the record's id as `id`. */
describe("resolveProperty: what a dynamicProps builder is handed", () => {
    it("names the record's id `id`", () => {
        const seen: PropertyBuilderProps[] = [];
        const property = {
            type: "string",
            name: "Slug",
            dynamicProps: (props: PropertyBuilderProps) => {
                seen.push(props);
                return { readOnly: props.id !== undefined };
            }
        } as unknown as Property;

        const resolved = resolveProperty({
            property,
            propertyKey: "slug",
            values: { slug: "a" },
            path: "posts",
            entityId: "p1",
            authController: { user: null } as never
        });

        expect(seen[0].id).toBe("p1");
        expect(seen[0]).not.toHaveProperty("entityId");
        expect(resolved).toMatchObject({ readOnly: true });
    });
});

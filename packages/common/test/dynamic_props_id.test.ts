import type { Property, PropertyBuilderProps } from "@rebasepro/types";
import { resolveProperty } from "../src/util/resolutions";
import { resetDeprecationWarningsForTests } from "../src/util/deprecation";

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
        expect(Object.keys(seen[0])).not.toContain("entityId");
        expect(resolved).toMatchObject({ readOnly: true });
    });

    // Released as `entityId` (0.28). A JS config written against it —
    // `({ entityId }) => ({ readOnly: Boolean(entityId) })` — must still see the
    // id, or every existing record's field turns editable.
    it("still hands the deprecated `entityId`, warning once and only when it is read", () => {
        resetDeprecationWarningsForTests();
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const resolve = (dynamicProps: (props: PropertyBuilderProps) => Partial<Property>) => resolveProperty({
                property: { type: "string", name: "Slug", dynamicProps } as unknown as Property,
                propertyKey: "slug",
                values: { slug: "a" },
                path: "posts",
                entityId: "p1",
                authController: { user: null } as never
            });

            resolve((props) => ({ readOnly: props.id !== undefined }));
            expect(warn).not.toHaveBeenCalled();

            const legacy = ({ entityId }: PropertyBuilderProps) => ({ readOnly: Boolean(entityId) });
            expect(resolve(legacy)).toMatchObject({ readOnly: true });
            expect(resolve(legacy)).toMatchObject({ readOnly: true });
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain("`id`");
        } finally {
            warn.mockRestore();
        }
    });
});

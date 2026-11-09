import type { Property, PropertyBuilderProps, StringProperty } from "@rebasepro/types";
import { resolveProperty } from "../src/util/resolutions";
import { resetDeprecationWarningsForTests } from "../src/util/deprecation";

/** A `dynamicProps` builder is handed the record's id as `id`. */
describe("resolveProperty: what a dynamicProps builder is handed", () => {
    it("names the record's id `id`", () => {
        const seen: PropertyBuilderProps[] = [];
        const property: Property = {
            type: "string",
            name: "Slug",
            dynamicProps: (props: PropertyBuilderProps) => {
                seen.push(props);
                return { name: props.id !== undefined ? "Slug (saved)" : "Slug" };
            }
        };

        const resolved = resolveProperty({
            property,
            propertyKey: "slug",
            values: { slug: "a" },
            path: "posts",
            entityId: "p1",
            authController: { user: null }
        });

        expect(seen[0].id).toBe("p1");
        expect(Object.keys(seen[0])).not.toContain("entityId");
        expect(resolved).toMatchObject({ name: "Slug (saved)" });
    });

    // Released as `entityId` (0.28). A JS config written against it —
    // `({ entityId }) => ({ readOnly: Boolean(entityId) })` — must still see the
    // id, or every existing record's field turns editable.
    it("still hands the deprecated `entityId`, warning once and only when it is read", () => {
        resetDeprecationWarningsForTests();
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const resolve = (dynamicProps: NonNullable<StringProperty["dynamicProps"]>) => resolveProperty({
                property: { type: "string", name: "Slug", dynamicProps },
                propertyKey: "slug",
                values: { slug: "a" },
                path: "posts",
                entityId: "p1",
                authController: { user: null }
            });

            resolve((props) => ({ description: String(props.id) }));
            expect(warn).not.toHaveBeenCalled();

            const legacy = ({ entityId }: PropertyBuilderProps) => ({ description: String(entityId) });
            expect(resolve(legacy)).toMatchObject({ description: "p1" });
            expect(resolve(legacy)).toMatchObject({ description: "p1" });
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain("`id`");
        } finally {
            warn.mockRestore();
        }
    });
});

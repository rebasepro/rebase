import { toFindParams } from "../../src/hooks/data/collectionQuery";

/**
 * The assembler exists because four call sites each listed the fields they
 * forwarded, and `searchExplain` reached three of them. The miss was invisible:
 * the option simply never left the browser, and the feature it enabled looked
 * broken somewhere else entirely.
 */
describe("toFindParams", () => {
    it("forwards the query as given", () => {
        const params = toFindParams({
            where: { status: ["==", "published"] },
            limit: 25,
            offset: 50,
            orderBy: ["created_at", "desc"],
            include: ["author"]
        });
        expect(params).toMatchObject({
            where: { status: ["==", "published"] },
            limit: 25,
            offset: 50,
            orderBy: ["created_at", "desc"],
            include: ["author"]
        });
    });

    it("asks for a match explanation exactly when there is a search to explain", () => {
        expect(toFindParams({ searchString: "auditor" }))
            .toMatchObject({ searchString: "auditor", searchExplain: true });
    });

    it("does not ask when there is no search string", () => {
        const params = toFindParams({ limit: 10 });
        expect(params.searchExplain).toBeUndefined();
        expect(params.searchString).toBeUndefined();
    });

    it("treats an empty search as no search — it would cost a headline for nothing", () => {
        const params = toFindParams({ searchString: "" });
        expect(params.searchExplain).toBeUndefined();
        expect(params.searchString).toBeUndefined();
    });

    it("keeps the derived flag out of the caller's hands, so two paths cannot disagree", () => {
        const listen = toFindParams({ searchString: "x", limit: 10 });
        const find = toFindParams({ searchString: "x", limit: 10, offset: 0 });
        expect(listen.searchExplain).toBe(find.searchExplain);
    });
});

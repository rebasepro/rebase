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

/**
 * A `limit` below 1 is a bug in whatever computed it, and the API refuses one —
 * so forwarding it turns a client bug into a 400 that reads as the server being
 * broken. That is how a restored, empty scroll entry presented: an
 * `Invalid limit: 0` error where a collection table should have been.
 */
describe("toFindParams — an unusable limit stays in the browser", () => {

    let warn: jest.SpyInstance;
    beforeEach(() => {
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    it("drops a limit of zero, so the read falls back to the server's page size", () => {
        expect(toFindParams({ limit: 0 }).limit).toBeUndefined();
        expect(warn).toHaveBeenCalled();
    });

    it("drops a negative and a fractional limit too", () => {
        expect(toFindParams({ limit: -5 }).limit).toBeUndefined();
        expect(toFindParams({ limit: 1.5 }).limit).toBeUndefined();
    });

    it("leaves an absent limit absent, and says nothing about it", () => {
        expect("limit" in toFindParams({ where: { a: ["==", 1] } })).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });

    it("forwards a usable limit untouched", () => {
        expect(toFindParams({ limit: 1 }).limit).toBe(1);
        expect(toFindParams({ limit: 250 }).limit).toBe(250);
        expect(warn).not.toHaveBeenCalled();
    });

    // Above the ceiling is an intent, not a glitch: trimming it would hand back
    // a page the caller cannot tell apart from the whole collection, so it
    // travels and is refused where the ceiling lives.
    it("still sends a limit above the API ceiling, to be refused there", () => {
        expect(toFindParams({ limit: 5000 }).limit).toBe(5000);
    });
});

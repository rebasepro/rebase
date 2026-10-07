/**
 * Every (collection, filters) pair a user ever opened used to keep its scroll
 * position, with the rows it showed, for the rest of the session. The 20 used
 * most recently keep theirs now.
 */
import { clearCollectionScrollCache, useScrollRestoration } from "../../src/components/common/useScrollRestoration";

describe("the scroll positions kept per collection view", () => {
    beforeEach(() => clearCollectionScrollCache());

    // Not a React hook in practice: it holds no state of its own.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const controller = useScrollRestoration();
    const save = (path: string, scrollOffset = 100) =>
        controller.updateCollectionScroll({ path, scrollOffset, data: [] });

    it("keeps the 20 written most recently", () => {
        for (let i = 0; i < 21; i++) save(`c${i}`);
        expect(controller.getCollectionScroll("c0")).toBeUndefined();
        expect(controller.getCollectionScroll("c1")).toBeDefined();
        expect(controller.getCollectionScroll("c20")).toBeDefined();
    });

    it("counts writing a view again as using it", () => {
        for (let i = 0; i < 20; i++) save(`c${i}`);
        save("c0", 300);
        save("c20");
        expect(controller.getCollectionScroll("c0")?.scrollOffset).toBe(300);
        expect(controller.getCollectionScroll("c1")).toBeUndefined();
    });

    it("tells filter combinations apart", () => {
        controller.updateCollectionScroll({ path: "c", scrollOffset: 1, data: [], filters: { a: ["==", 1] } });
        controller.updateCollectionScroll({ path: "c", scrollOffset: 2, data: [] });
        expect(controller.getCollectionScroll("c", { a: ["==", 1] })?.scrollOffset).toBe(1);
        expect(controller.getCollectionScroll("c")?.scrollOffset).toBe(2);
    });
});

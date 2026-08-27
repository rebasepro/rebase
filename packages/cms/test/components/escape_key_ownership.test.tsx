/**
 * @jest-environment jsdom
 *
 * Who owns Escape when two layers are open.
 *
 * Several components register a global keydown listener and act on Escape: the
 * split view closes the record panel, the inspector closes itself, the relation
 * and user selectors close their popovers. One keystroke, several owners — and
 * the mechanism a component picks to claim the key is what decides whether the
 * others still fire.
 *
 * These pin the two mechanisms, because they are easy to confuse and only one
 * of them works between listeners on the *same* element.
 * See docs/bug-classes.md.
 */

/**
 * A keystroke targets the focused element, so it travels
 * window → document → target and back. Dispatching on `window` instead would
 * give the event a one-element path that never reaches `document`, and every
 * capture-phase listener in the app would look dead.
 */
const fire = () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true
    }));
};

describe("claiming a global key", () => {

    it("stopPropagation does NOT stop another listener on the same element", () => {
        const ran: string[] = [];
        const first = (e: KeyboardEvent) => {
            ran.push("first");
            e.stopPropagation();
        };
        const second = () => {
            ran.push("second");
        };
        window.addEventListener("keydown", first);
        window.addEventListener("keydown", second);

        fire();

        // Both ran. `stopPropagation` governs the *phases* of an event's travel
        // between elements; it says nothing about the other listeners already
        // registered on the element it is called from.
        expect(ran).toEqual(["first", "second"]);

        window.removeEventListener("keydown", first);
        window.removeEventListener("keydown", second);
    });

    it("stopImmediatePropagation does — but only for listeners added after it", () => {
        const ran: string[] = [];
        const first = (e: KeyboardEvent) => {
            ran.push("first");
            e.stopImmediatePropagation();
        };
        const second = () => {
            ran.push("second");
        };
        window.addEventListener("keydown", first);
        window.addEventListener("keydown", second);

        fire();

        expect(ran).toEqual(["first"]);

        window.removeEventListener("keydown", first);
        window.removeEventListener("keydown", second);
    });

    it("registration order decides, and a layer that opens later registers later", () => {
        const ran: string[] = [];
        // The split view mounts with the collection and keeps its listener for
        // as long as a record is selected.
        const longLived = () => ran.push("split");
        window.addEventListener("keydown", longLived);

        // The inspector registers only once it is open, which is always after.
        const justOpened = (e: KeyboardEvent) => {
            ran.push("inspector");
            e.stopImmediatePropagation();
        };
        window.addEventListener("keydown", justOpened);

        fire();

        // Too late: the layer that opened last runs last, so claiming the key
        // from there cannot stop the layer underneath from having acted.
        expect(ran).toEqual(["split", "inspector"]);

        window.removeEventListener("keydown", longLived);
        window.removeEventListener("keydown", justOpened);
    });

    it("a capture listener on document beats a bubble listener on window", () => {
        const ran: string[] = [];
        const onWindowBubble = () => ran.push("split");
        const onDocumentCapture = (e: KeyboardEvent) => {
            ran.push("overlay");
            e.stopPropagation();
        };
        window.addEventListener("keydown", onWindowBubble);
        document.addEventListener("keydown", onDocumentCapture, true);

        fire();

        // Capture travels window → document → target before anything bubbles
        // back, so this one runs first *and* `stopPropagation` is enough: the
        // window-bubble listener is on a different element, further along the
        // path that just got cut. This is the idiom that works regardless of
        // which layer mounted first.
        expect(ran).toEqual(["overlay"]);

        window.removeEventListener("keydown", onWindowBubble);
        document.removeEventListener("keydown", onDocumentCapture, true);
    });
});

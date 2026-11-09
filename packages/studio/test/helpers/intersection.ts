/**
 * An `IntersectionObserver` for jsdom, which lays nothing out and has none.
 *
 * A test decides what is "on screen" itself; this is the rest of the
 * interface, so an observer stand-in is a real `IntersectionObserver` and
 * hands its callback a complete entry.
 */
export abstract class TestIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly scrollMargin = "0px";
    readonly thresholds = [0];

    constructor(private readonly callback: IntersectionObserverCallback) {}

    abstract observe(element: Element): void;

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] { return []; }

    /** Tell the callback, on a microtask as a browser would, whether `element` is visible. */
    protected report(element: Element, isIntersecting: boolean): void {
        const rect = element.getBoundingClientRect();
        const entry: IntersectionObserverEntry = {
            target: element,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
            boundingClientRect: rect,
            intersectionRect: rect,
            rootBounds: null,
            time: 0
        };
        queueMicrotask(() => this.callback([entry], this));
    }
}

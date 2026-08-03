/**
 * @jest-environment jsdom
 */
import React from "react";
import { render } from "@testing-library/react";
import {
    RelationPreviewDepthContext,
    RelationPreviewDepthProvider,
    useRelationPreviewDepth
} from "../../src/preview/components/RelationPreviewDepth";

/**
 * A relation preview renders its target row through `EntityPreview`, which
 * renders that row's preview properties through `PropertyPreview` — so a target
 * with a relation of its own produced a second interactive relation card
 * *inside* the first, complete with its own navigate button pointing somewhere
 * the outer card never claimed to be about. A selector inside a selector.
 *
 * The depth context is what stops it. These pin the contract the preview reads,
 * since the nesting itself only shows up in a full admin render.
 */
describe("relation preview nesting depth", () => {

    const Probe = ({ onDepth }: { onDepth: (d: number) => void }) => {
        onDepth(useRelationPreviewDepth());
        return null;
    };

    it("is zero outside any relation preview", () => {
        let depth = -1;
        render(<Probe onDepth={d => { depth = d; }}/>);
        // Zero is what makes the top-level card render as a card.
        expect(depth).toBe(0);
    });

    it("is one inside a relation preview", () => {
        let depth = -1;
        render(
            <RelationPreviewDepthProvider>
                <Probe onDepth={d => { depth = d; }}/>
            </RelationPreviewDepthProvider>
        );
        expect(depth).toBe(1);
    });

    it("keeps counting rather than saturating", () => {
        // A boolean would read the same at every depth and invites being reset
        // by whichever layer thinks it is the outermost.
        let depth = -1;
        render(
            <RelationPreviewDepthProvider>
                <RelationPreviewDepthProvider>
                    <RelationPreviewDepthProvider>
                        <Probe onDepth={d => { depth = d; }}/>
                    </RelationPreviewDepthProvider>
                </RelationPreviewDepthProvider>
            </RelationPreviewDepthProvider>
        );
        expect(depth).toBe(3);
    });

    it("builds on whatever depth it is given", () => {
        let depth = -1;
        render(
            <RelationPreviewDepthContext.Provider value={4}>
                <RelationPreviewDepthProvider>
                    <Probe onDepth={d => { depth = d; }}/>
                </RelationPreviewDepthProvider>
            </RelationPreviewDepthContext.Provider>
        );
        expect(depth).toBe(5);
    });

    it("does not leak out of the subtree", () => {
        // Two relation columns side by side in a table: the second must not
        // inherit the first's depth and flatten itself for no reason.
        let sibling = -1;
        render(
            <>
                <RelationPreviewDepthProvider><span/></RelationPreviewDepthProvider>
                <Probe onDepth={d => { sibling = d; }}/>
            </>
        );
        expect(sibling).toBe(0);
    });
});

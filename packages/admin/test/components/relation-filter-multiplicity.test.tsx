/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import { EntityRelation } from "@rebasepro/types";

/**
 * How many values the filter is asking for is the operator's business.
 *
 * `RelationSelector` sized itself from the relation's cardinality, which is
 * right where it *edits* a relation — a `manyToMany` field holds a list — and
 * wrong in a filter, where `tags == <one tag>` is a perfectly ordinary
 * question about a to-many link. Because the selector could only ever emit a
 * list there, every single-value operator had to be withheld from a to-many
 * relation, so `==` was unreachable and you asked it as a one-element `in`.
 *
 * The mock records what the field asks the selector for, and lets a test drive
 * a selection back through it — the two directions that have to agree.
 */
let lastProps: Record<string, unknown> = {};

beforeAll(() => {
    // The operator Select is Radix-backed and needs pointer capture and
    // scrollIntoView, neither of which jsdom implements. Without these the
    // dropdown never opens and an operator switch cannot be driven at all —
    // which is why the earlier tests in this area had to inject the operator
    // through the `value` prop instead of changing it the way a user does.
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

/** Pick an operator from the dropdown, as a user would. */
function chooseOperator(label: string) {
    fireEvent.click(screen.getByRole("combobox"));
    const option = screen.queryAllByRole("option").find(o => o.textContent === label);
    if (!option) throw new Error(`No "${label}" option. Offered: ${JSON.stringify(screen.queryAllByRole("option").map(o => o.textContent))}`);
    fireEvent.click(option);
}

jest.mock("../../src/components/RelationSelector", () => ({
    RelationSelector: (props: Record<string, unknown>) => {
        lastProps = props;
        const emit = props.onValueChange as (v: unknown) => void;
        return (
            <div data-testid="relation-selector" data-multiple={String(props.multiple)}>
                <button data-testid="pick-one" onClick={() => emit(new EntityRelation("7", "tags"))}/>
                <button data-testid="pick-two" onClick={() =>
                    emit([new EntityRelation("7", "tags"), new EntityRelation("8", "tags")])}/>
            </div>
        );
    }
}));

import { RelationFilterField } from "../../src/components/SelectableTable/filters/RelationFilterField";

const manyToMany = {
    kind: "manyToMany",
    target: () => ({ slug: "tags" }),
    through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
} as never;
const belongsTo = { kind: "belongsTo", target: () => ({ slug: "authors" }) } as never;

const OPERATORS = ["==", "!=", "in", "not-in", "is-null", "is-not-null"] as never;

function renderField(relation: never, value?: unknown) {
    const setValue = jest.fn();
    render(
        <RelationFilterField
            name="tags"
            relation={relation}
            value={value as never}
            setValue={setValue as never}
            hidden={false}
            setHidden={() => undefined}
            operators={OPERATORS}
        />
    );
    return setValue;
}

const isMultiple = () => screen.getByTestId("relation-selector").getAttribute("data-multiple");

describe("relation filter multiplicity follows the operator", () => {

    beforeEach(() => {
        jest.clearAllMocks();
        lastProps = {};
    });

    it("asks for one value under `==`, even on a to-many relation", () => {
        renderField(manyToMany, ["==", undefined]);
        expect(isMultiple()).toBe("false");
    });

    it("asks for many under `in`, even though the operator alone changed", () => {
        renderField(manyToMany, ["in", []]);
        expect(isMultiple()).toBe("true");
    });

    it("asks for one under `==` on a to-one relation, as before", () => {
        renderField(belongsTo, ["==", undefined]);
        expect(isMultiple()).toBe("false");
    });

    it("asks for many under `not-in` on a to-one relation", () => {
        // The mirror of the bug: a to-one relation with a list operator needs
        // a multi-select, which cardinality alone would also have got wrong.
        renderField(belongsTo, ["not-in", []]);
        expect(isMultiple()).toBe("true");
    });

    it("emits a single relation under `==`, not a one-element list", () => {
        // The whole point. An array reaching `==` compiles to nonsense, which
        // is why the operator used to be withheld rather than fixed.
        const setValue = renderField(manyToMany, ["==", undefined]);
        fireEvent.click(screen.getByTestId("pick-one"));
        const [emitted] = setValue.mock.calls.at(-1) as [[string, unknown]];
        expect(emitted[0]).toBe("==");
        expect(Array.isArray(emitted[1])).toBe(false);
        expect((emitted[1] as EntityRelation).id).toBe("7");
    });

    it("emits a list under `in`", () => {
        const setValue = renderField(manyToMany, ["in", []]);
        fireEvent.click(screen.getByTestId("pick-two"));
        const [emitted] = setValue.mock.calls.at(-1) as [[string, unknown[]]];
        expect(emitted[0]).toBe("in");
        expect(emitted[1].map((r) => (r as EntityRelation).id)).toEqual(["7", "8"]);
    });

    describe("switching the operator, the way a user does", () => {

        it("resizes the selector when the operator changes", () => {
            renderField(manyToMany);
            expect(isMultiple()).toBe("false");   // opens on `==`
            chooseOperator("In");
            expect(isMultiple()).toBe("true");
            chooseOperator("==");
            expect(isMultiple()).toBe("false");
        });

        it("offers `==` on a to-many relation at all", () => {
            // The operator that could not be rendered before. Listing it is
            // the visible half of the fix.
            renderField(manyToMany);
            fireEvent.click(screen.getByRole("combobox"));
            expect(screen.queryAllByRole("option").map(o => o.textContent))
                .toEqual(["==", "!=", "In", "Not in", "Is empty", "Is not empty"]);
        });

        it("hands the selector no value when narrowing a list to one", () => {
            // `in [7, 8]` → `==` cannot keep both. `updateFilter` drops the
            // held value on the arity change, and the selector is told so —
            // otherwise a two-chip selection would sit under an operator that
            // takes one, and `==` would be handed an array.
            renderField(manyToMany, ["in", [new EntityRelation("7", "tags"), new EntityRelation("8", "tags")]]);
            expect(isMultiple()).toBe("true");
            expect(lastProps.value).toBeDefined();
            chooseOperator("==");
            expect(isMultiple()).toBe("false");
            expect(lastProps.value).toBeUndefined();
        });

        it("keeps the single selection when widening one to a list", () => {
            // The other direction is safe to carry over: one value is a valid
            // one-element list, so the user does not lose their choice.
            const setValue = renderField(manyToMany, ["==", new EntityRelation("7", "tags")]);
            chooseOperator("In");
            expect(isMultiple()).toBe("true");
            const [emitted] = setValue.mock.calls.at(-1) as [[string, unknown[]]];
            expect(emitted[0]).toBe("in");
            expect((emitted[1] as EntityRelation[]).map(r => r.id)).toEqual(["7"]);
        });
    });

    it("passes the prop explicitly, so the selector never falls back to cardinality", () => {
        // Omitting it is what the *editing* uses want — there the relation's
        // cardinality is the shape of the stored value — so the filter has to
        // opt out rather than the selector change its default.
        renderField(manyToMany, ["==", undefined]);
        expect(lastProps.multiple).toBe(false);
    });
});

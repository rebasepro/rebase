/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * "Posts with no tags" — the control, not the SQL.
 *
 * The driver answers `["in", null]` on a to-many relation with `NOT EXISTS`,
 * but nothing reaches it unless the checkbox is on screen and emits that pair.
 * The checkbox used to be hidden for a to-many relation outright, so this is
 * the half of the feature no driver test can see.
 *
 * `RelationSelector` is mocked: it opens a data-loading popover that wants the
 * whole provider stack, and it is not what is under test here.
 */
jest.mock("../../src/components/RelationSelector", () => ({
    RelationSelector: ({ disabled }: { disabled?: boolean }) => (
        <div data-testid="relation-selector" data-disabled={disabled ? "true" : "false"}/>
    )
}));

import { RelationFilterField } from "../../src/components/SelectableTable/filters/RelationFilterField";

const manyToMany = {
    kind: "manyToMany",
    target: () => ({ slug: "tags" }),
    through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
} as never;

const belongsTo = { kind: "belongsTo", target: () => ({ slug: "authors" }) } as never;

/** What `resolveFilterOperators` hands a relation property on postgres. */
const RELATION_OPERATORS = ["==", "!=", "in", "not-in", "is-null", "is-not-null"] as never;

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
            operators={RELATION_OPERATORS}
        />
    );
    return setValue;
}

describe("the null checkbox on a relation filter", () => {

    beforeEach(() => jest.clearAllMocks());

    it("is on screen for a to-many relation", () => {
        renderField(manyToMany);
        expect(screen.getByText("Filter for empty relations")).toBeTruthy();
    });

    it("emits `is-null`, not a null paired with the selected operator", () => {
        // The to-many default operator is `in`, and `["in", null]` is not
        // portable — Postgres dropped it and Mongo rejects `$in: null`.
        // `is-null` is an operator every driver implements outright.
        const setValue = renderField(manyToMany);
        fireEvent.click(screen.getByRole("checkbox"));
        expect(setValue).toHaveBeenCalledWith(["is-null", null]);
    });

    it("emits `is-not-null` when the selected operator is a negative one", () => {
        // The checkbox is a toggle, so the operator it sits beside is what
        // says which way round it means.
        const setValue = renderField(manyToMany, ["not-in", []]);
        fireEvent.click(screen.getByRole("checkbox"));
        expect(setValue).toHaveBeenLastCalledWith(["is-not-null", null]);
    });

    it("clears the filter when unticked rather than leaving a null behind", () => {
        const setValue = renderField(manyToMany);
        const checkbox = screen.getByRole("checkbox");
        fireEvent.click(checkbox);
        fireEvent.click(checkbox);
        expect(setValue).toHaveBeenLastCalledWith(undefined);
    });

    it("comes back ticked when the saved filter is already a null check", () => {
        // The value round-trips: `is-null` is in the operator list, so the
        // control can render the filter it produced.
        renderField(manyToMany, ["is-null", null]);
        expect(screen.getByRole("checkbox").getAttribute("data-state")).toBe("checked");
        expect(screen.getByTestId("relation-selector").getAttribute("data-disabled")).toBe("true");
    });

    it("disables the value selector while the null filter is on", () => {
        renderField(manyToMany);
        expect(screen.getByTestId("relation-selector").getAttribute("data-disabled")).toBe("false");
        fireEvent.click(screen.getByRole("checkbox"));
        expect(screen.getByTestId("relation-selector").getAttribute("data-disabled")).toBe("true");
    });

    it("still works on a to-one relation, where it always did", () => {
        // It used to emit `["==", null]`, which Postgres read as IS NULL.
        // `is-null` is the same question asked portably.
        const setValue = renderField(belongsTo);
        expect(screen.getByText("Filter for null values")).toBeTruthy();
        fireEvent.click(screen.getByRole("checkbox"));
        expect(setValue).toHaveBeenCalledWith(["is-null", null]);
    });

    it("gives each field its own checkbox id", () => {
        // Every filterable property renders one of these in the same dialog.
        // A hardcoded id made the label toggle whichever checkbox the document
        // matched first, which was never the one the user clicked.
        const { container } = render(
            <>
                <RelationFilterField name="tags" relation={manyToMany} setValue={() => undefined}
                    hidden={false} setHidden={() => undefined} operators={RELATION_OPERATORS}/>
                <RelationFilterField name="author" relation={belongsTo} setValue={() => undefined}
                    hidden={false} setHidden={() => undefined} operators={RELATION_OPERATORS}/>
            </>
        );
        const ids = Array.from(container.querySelectorAll("[role=checkbox]")).map(el => el.id);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
        expect(ids.every(Boolean)).toBe(true);
    });
});

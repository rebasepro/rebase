/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The same null checkbox, on the path that is not Postgres.
 *
 * `reference` is the document-store property — Firestore and MongoDB declare
 * `supportsReferences` and no relations at all — so this field is the one that
 * actually reaches those drivers. It emitted `[selected operator, null]`, and
 * with `in` selected that is `{ field: { $in: null } }` on Mongo, which the
 * server rejects outright: "$in needs an array". Verified against a real
 * MongoDB, not inferred.
 *
 * So the operator itself has to say what is being asked. These pin that it
 * does, and that the field never emits a null operand.
 */
jest.mock("../../src/hooks/useSelectionDialog", () => ({
    useSelectionDialog: () => ({ open: () => undefined, close: () => undefined })
}));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({ getCollection: () => undefined })
}));
jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

import { ReferenceFilterField } from "../../src/components/SelectableTable/filters/ReferenceFilterField";

/** What `resolveFilterOperators` hands a reference property on firestore. */
const REFERENCE_OPERATORS = ["==", "!=", "in", "not-in", "is-null", "is-not-null"] as never;

function renderField(value?: unknown) {
    const setValue = jest.fn();
    render(
        <ReferenceFilterField
            path="authors"
            value={value as never}
            setValue={setValue as never}
            hidden={false}
            setHidden={() => undefined}
            operators={REFERENCE_OPERATORS}
        />
    );
    return setValue;
}

describe("the null checkbox on a reference filter", () => {

    beforeEach(() => jest.clearAllMocks());

    it("emits `is-null` rather than pairing null with the selected operator", () => {
        const setValue = renderField();
        fireEvent.click(screen.getByRole("checkbox"));
        expect(setValue).toHaveBeenCalledWith(["is-null", null]);
    });

    it("emits `is-not-null` beside a negative operator", () => {
        const setValue = renderField(["not-in", []]);
        fireEvent.click(screen.getByRole("checkbox"));
        expect(setValue).toHaveBeenLastCalledWith(["is-not-null", null]);
    });

    it("never emits a null operand, whichever operator is selected", () => {
        // The Mongo driver maps `in`/`not-in` straight onto `$in`/`$nin`, and
        // Mongo rejects either with a non-array. Nothing this field emits may
        // put a null where a value is expected.
        for (const op of ["==", "!=", "in", "not-in"]) {
            const setValue = renderField([op, []]);
            fireEvent.click(screen.getAllByRole("checkbox")[0]);
            const [emitted] = setValue.mock.calls[setValue.mock.calls.length - 1] as [[string, unknown]];
            expect(["is-null", "is-not-null"]).toContain(emitted[0]);
            screen.getAllByRole("checkbox").forEach(node => node.remove());
        }
    });

    it("comes back ticked when the saved filter is already a null check", () => {
        renderField(["is-null", null]);
        expect(screen.getByRole("checkbox").getAttribute("data-state")).toBe("checked");
    });

    it("gives each field its own checkbox id", () => {
        const { container } = render(
            <>
                <ReferenceFilterField path="authors" setValue={() => undefined} hidden={false}
                    setHidden={() => undefined} operators={REFERENCE_OPERATORS}/>
                <ReferenceFilterField path="editors" setValue={() => undefined} hidden={false}
                    setHidden={() => undefined} operators={REFERENCE_OPERATORS}/>
            </>
        );
        const ids = Array.from(container.querySelectorAll("[role=checkbox]")).map(el => el.id);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
        expect(ids.every(Boolean)).toBe(true);
    });
});

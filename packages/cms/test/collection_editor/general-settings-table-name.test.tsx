/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { Formex, useCreateFormex } from "@rebasepro/forms";

/**
 * The table name of a collection that already exists.
 *
 * The field was editable, and nothing downstream could carry out the edit: the
 * schema is only ever changed additively, so a new table name created a new,
 * empty table, pointed the collection at it, and left every row behind in the
 * old one. The slug beside it — the other half of the collection's identity —
 * was already fixed once the collection existed; the table is now too.
 */

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
    IconForView: () => null
}));

jest.mock("../../src/collection_editor/_cms_internals", () => ({
    FieldCaption: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    SearchIconsView: () => null
}));

jest.mock("../../src/collection_editor/useCollectionsConfigController", () => ({
    useCollectionsConfigController: () => ({ readOnly: false })
}));

import { GeneralSettingsForm } from "../../src/collection_editor/ui/collection_editor/GeneralSettingsForm";

function Harness({ isNewCollection }: { isNewCollection: boolean }) {
    const formex = useCreateFormex<Record<string, unknown>>({
        initialValues: { name: "Posts", slug: "posts", table: "posts", properties: {} }
    });
    return (
        <Formex value={formex}>
            <GeneralSettingsForm isNewCollection={isNewCollection}/>
        </Formex>
    );
}

describe("the table name field", () => {
    it("is fixed once the collection exists", () => {
        render(<Harness isNewCollection={false}/>);
        expect(screen.getByLabelText(/Table name/)).toHaveProperty("disabled", true);
    });

    it("is still chosen when the collection is created", () => {
        render(<Harness isNewCollection={true}/>);
        expect(screen.getByLabelText(/Table name/)).toHaveProperty("disabled", false);
    });
});

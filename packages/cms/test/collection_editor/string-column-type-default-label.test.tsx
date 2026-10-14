/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { Formex, useCreateFormex } from "@rebasepro/forms";
import { RebaseI18nProvider } from "@rebasepro/app";

/**
 * The column type a string property gets when it names none.
 *
 * The schema planner makes such a column `TEXT` (`stringType` in
 * server-postgres's plan-schema: "`text` is the default"), and the review
 * dialog shows `ADD COLUMN … TEXT`. The editor's select said
 * "Default (varchar)", so the label promised a bounded column the DDL never
 * created.
 */

jest.mock("../../src/collection_editor/_cms_internals", () => ({
    FieldCaption: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}));

import { StringPropertyField } from "../../src/collection_editor/ui/collection_editor/properties/StringPropertyField";

function renderField(initialValues: Record<string, unknown>) {
    function Harness() {
        const formex = useCreateFormex<Record<string, unknown>>({ initialValues });
        return (
            <Formex value={formex}>
                <StringPropertyField widgetId={"text_field"} disabled={false} showErrors={false}/>
            </Formex>
        );
    }
    render(<RebaseI18nProvider locale="en"><Harness/></RebaseI18nProvider>);
}

describe("the string column type select", () => {
    it("names the type the default column is created with", () => {
        renderField({ type: "string" });
        expect(screen.queryByText("Default (varchar)")).toBeNull();
        expect(screen.getByText("Default (text)")).toBeTruthy();
    });

    it("still names an explicit varchar", () => {
        renderField({ type: "string", columnType: "varchar" });
        expect(screen.getByText("varchar (variable length)")).toBeTruthy();
    });
});

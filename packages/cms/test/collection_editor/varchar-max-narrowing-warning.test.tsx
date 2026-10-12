/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { Formex, FormexController, useCreateFormex } from "@rebasepro/forms";

/**
 * The property editor says when a smaller `validation.max` narrows a column.
 *
 * On a `varchar` or `char` string, `max` is the column's width, so lowering it
 * is a DDL change on a live table: `rebase db push` asks before it narrows,
 * and Postgres refuses it while a stored value is longer. The editor showed a
 * plain number field, and nothing said the edit was more than a form rule.
 */

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(",")})` : key
    })
}));

jest.mock("../../src/collection_editor/_cms_internals", () => ({
    FieldCaption: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}));

import { StringPropertyValidation } from "../../src/collection_editor/ui/collection_editor/properties/validation/StringPropertyValidation";

type Draft = Record<string, unknown>;

function renderEditor(initialValues: Draft) {
    let controller: FormexController<Draft> | undefined;
    function Harness() {
        const formex = useCreateFormex<Draft>({ initialValues });
        controller = formex;
        return (
            <Formex value={formex}>
                <StringPropertyValidation max={true} disabled={false} showErrors={false}/>
            </Formex>
        );
    }
    render(<Harness/>);
    return {
        setMax: (max: number | undefined) => act(() => { controller!.setFieldValue("validation.max", max); })
    };
}

const warning = () => screen.queryByText(/^varchar_narrowing_warning/);

describe("the max length of an existing string column", () => {
    it("warns when it narrows a varchar", () => {
        const { setMax } = renderEditor({ type: "string", columnType: "varchar", validation: { max: 100 } });
        expect(warning()).toBeNull();
        setMax(40);
        expect(warning()?.textContent).toBe("varchar_narrowing_warning(columnType=varchar,max=40)");
    });

    it("warns when it narrows a char", () => {
        const { setMax } = renderEditor({ type: "string", columnType: "char", validation: { max: 10 } });
        setMax(2);
        expect(warning()?.textContent).toBe("varchar_narrowing_warning(columnType=char,max=2)");
    });

    it("warns when it gives an unbounded varchar a width", () => {
        const { setMax } = renderEditor({ type: "string", columnType: "varchar" });
        setMax(40);
        expect(warning()).not.toBeNull();
    });

    it("says nothing when it widens the column, or stays the same", () => {
        const { setMax } = renderEditor({ type: "string", columnType: "varchar", validation: { max: 100 } });
        setMax(200);
        expect(warning()).toBeNull();
        setMax(100);
        expect(warning()).toBeNull();
    });

    it("says nothing on a text column, where max is a form rule only", () => {
        const { setMax } = renderEditor({ type: "string", validation: { max: 100 } });
        setMax(40);
        expect(warning()).toBeNull();
    });

    it("says nothing for a property that does not exist yet", () => {
        const { setMax } = renderEditor({});
        setMax(40);
        expect(warning()).toBeNull();
    });
});

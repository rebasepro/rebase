/**
 * The Undo the form has no button for.
 *
 * `useUndoableDiscard` is what both Discard affordances go through — the form's
 * own confirmed one and the identity bar's, which does not confirm at all. The
 * snackbar it raises is the only place the way back is offered, so the action
 * has to survive the reset that raised it.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { useCreateFormex, type FormexController } from "@rebasepro/forms";
import { useUndoableDiscard } from "../../src/form/useUndoableDiscard";

type Product = { name: string };

const stored: Product = { name: "Wooden chair" };

let controller: FormexController<Product>;

function DiscardHarness() {
    const formex = useCreateFormex<Product>({ initialValues: stored });
    const discard = useUndoableDiscard();
    controller = formex;
    return <>
        <span data-testid={"name"}>{formex.values.name}</span>
        <button onClick={() => discard(formex, "existing")}>Discard</button>
    </>;
}

describe("useUndoableDiscard", () => {

    it("offers an Undo that puts the edit back", async () => {
        render(<SnackbarProvider><DiscardHarness/></SnackbarProvider>);

        act(() => {
            controller.setFieldValue("name", "Steel chair");
        });
        expect(screen.getByTestId("name").textContent).toEqual("Steel chair");

        act(() => {
            screen.getByText("Discard").click();
        });
        expect(screen.getByTestId("name").textContent).toEqual("Wooden chair");

        act(() => {
            screen.getByText("Undo").click();
        });
        expect(screen.getByTestId("name").textContent).toEqual("Steel chair");
        // Back as an unsaved edit, so Save is live again.
        expect(controller.dirty).toBe(true);
    });

});

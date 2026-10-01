import React, { useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Button, Dialog, DialogContent, DialogTitle, Menu, MenuItem, Sheet } from "../src";

/**
 * Where focus goes when a kit modal opens and closes, and what a click on the
 * backdrop does.
 *
 * Both modals used to cancel Radix's open-focus and do nothing else, so a
 * keyboard user who opened a dialog was left on the trigger behind it — a
 * trigger Radix had just hidden from assistive technology — and Enter fired it
 * a second time underneath the open dialog. Closing dropped focus to <body>.
 */

function DialogHarness({ withInitialFocus = false, dismissOnBackdrop, onOpenChange }: {
    withInitialFocus?: boolean;
    dismissOnBackdrop?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const [open, setOpen] = useState(false);
    const fieldRef = useRef<HTMLInputElement>(null);
    return <>
        <button onClick={() => setOpen(true)}>Add item</button>
        <Dialog open={open}
                onOpenChange={(o) => {
                    onOpenChange?.(o);
                    setOpen(o);
                }}
                dismissOnBackdrop={dismissOnBackdrop}
                initialFocus={withInitialFocus ? fieldRef : undefined}>
            <DialogTitle>New item</DialogTitle>
            <DialogContent>
                <input aria-label="Name" ref={fieldRef}/>
                <button onClick={() => setOpen(false)}>Cancel</button>
            </DialogContent>
        </Dialog>
    </>;
}

/** Radix attaches its outside-pointer listener a task after mount. */
const nextTask = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("Dialog focus", () => {

    it("moves focus into the dialog when it opens, not leaving it on the trigger", async () => {
        render(<DialogHarness/>);
        const trigger = screen.getByRole("button", { name: "Add item" });
        trigger.focus();
        fireEvent.click(trigger);

        const dialog = await screen.findByRole("dialog");
        await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
        // The container, not the first field: no phone keyboard over an
        // untouched form, and the dialog is what gets announced.
        expect(document.activeElement).toBe(dialog);
    });

    it("focuses the element named by initialFocus instead", async () => {
        render(<DialogHarness withInitialFocus/>);
        fireEvent.click(screen.getByRole("button", { name: "Add item" }));
        const field = await screen.findByRole("textbox", { name: "Name" });
        await waitFor(() => expect(document.activeElement).toBe(field));
    });

    it("returns focus to the trigger when it closes", async () => {
        render(<DialogHarness/>);
        const trigger = screen.getByRole("button", { name: "Add item" });
        trigger.focus();
        fireEvent.click(trigger);
        await screen.findByRole("dialog");

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    });
});

describe("Dialog opened from a menu item", () => {

    function MenuDialogHarness() {
        const [open, setOpen] = useState(false);
        return <>
            <Menu trigger={<Button>Actions</Button>}>
                <MenuItem onClick={() => setOpen(true)}>Delete…</MenuItem>
            </Menu>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTitle>Delete?</DialogTitle>
                <button onClick={() => setOpen(false)}>Cancel</button>
            </Dialog>
        </>;
    }

    it("returns focus to the menu's trigger, since the item is gone", async () => {
        render(<MenuDialogHarness/>);
        const trigger = screen.getByRole("button", { name: "Actions" });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: "Enter" });
        const item = await screen.findByRole("menuitem", { name: "Delete…" });
        item.focus();
        fireEvent.click(item);

        await screen.findByRole("dialog");
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    });
});

describe("Dialog backdrop", () => {

    /** The overlay: the dimmed layer that is a sibling of the paper, not inside it. */
    function backdrop(): HTMLElement {
        const dialog = screen.getByRole("dialog");
        const layer = dialog.parentElement!;
        const overlay = Array.from(layer.children).find((el) => el !== dialog);
        if (!(overlay instanceof HTMLElement)) throw new Error("no overlay beside the dialog");
        return overlay;
    }

    it("leaves a record dialog open by default", async () => {
        const onOpenChange = jest.fn();
        render(<DialogHarness onOpenChange={onOpenChange}/>);
        fireEvent.click(screen.getByRole("button", { name: "Add item" }));
        await screen.findByRole("dialog");
        await nextTask();

        fireEvent.pointerDown(backdrop());
        await nextTask();
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("closes a dialog that opts in with dismissOnBackdrop", async () => {
        const onOpenChange = jest.fn();
        render(<DialogHarness dismissOnBackdrop onOpenChange={onOpenChange}/>);
        fireEvent.click(screen.getByRole("button", { name: "Add item" }));
        await screen.findByRole("dialog");
        await nextTask();

        fireEvent.pointerDown(backdrop());
        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });

    it("does not close on a click inside the paper, even when opted in", async () => {
        const onOpenChange = jest.fn();
        render(<DialogHarness dismissOnBackdrop onOpenChange={onOpenChange}/>);
        fireEvent.click(screen.getByRole("button", { name: "Add item" }));
        await screen.findByRole("dialog");
        await nextTask();

        fireEvent.pointerDown(screen.getByRole("textbox", { name: "Name" }));
        await nextTask();
        expect(onOpenChange).not.toHaveBeenCalled();
    });
});

describe("Sheet focus", () => {

    function SheetHarness() {
        const [open, setOpen] = useState(false);
        return <>
            <button onClick={() => setOpen(true)}>Open record</button>
            <Sheet open={open} onOpenChange={setOpen} title="Record">
                <button onClick={() => setOpen(false)}>Close record</button>
            </Sheet>
        </>;
    }

    it("moves focus into the sheet when it opens and back to the trigger when it closes", async () => {
        render(<SheetHarness/>);
        const trigger = screen.getByRole("button", { name: "Open record" });
        trigger.focus();
        fireEvent.click(trigger);

        const sheet = await screen.findByRole("dialog");
        await waitFor(() => expect(document.activeElement).toBe(sheet));

        fireEvent.click(screen.getByRole("button", { name: "Close record" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    });
});

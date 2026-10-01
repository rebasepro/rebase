import React, { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { DebouncedTextField } from "../src";

/**
 * What a form submits is what the field shows.
 *
 * The field reports its value 150ms after the last keystroke, or on blur. Enter
 * submits a form without blurring anything, so typing a name at a normal pace
 * and pressing Enter submitted the value from before typing started — the
 * property editor's Name and ID, and the collection details form.
 */
describe("DebouncedTextField", () => {

    function Form({ onSubmit }: { onSubmit: (value: string) => void }) {
        const [name, setName] = useState("");
        const latest = useRef(name);
        latest.current = name;
        return <form onSubmit={(e) => {
            e.preventDefault();
            onSubmit(latest.current);
        }}>
            <DebouncedTextField label="Name" value={name} onChange={(e) => setName(e.target.value)}/>
            <button type="submit">Create</button>
        </form>;
    }

    it("reports the typed value before Enter submits the form", async () => {
        const onSubmit = jest.fn();
        const user = userEvent.setup();
        render(<Form onSubmit={onSubmit}/>);
        await user.type(screen.getByLabelText("Name"), "orders{Enter}");
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith("orders");
    });

    it("reports a pending value when it unmounts instead of dropping it", async () => {
        const onChange = jest.fn();
        const user = userEvent.setup();
        const { unmount } = render(<DebouncedTextField label="Name" value="" onChange={(e) => onChange(e.target.value)}/>);
        await user.type(screen.getByLabelText("Name"), "abc");
        expect(onChange).not.toHaveBeenCalled();
        unmount();
        expect(onChange).toHaveBeenCalledWith("abc");
    });
});

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Alert, Avatar, Menu, MenuItem, SearchBar } from "../src";

/**
 * Small a11y contracts the kit got wrong:
 * - an `Avatar` was always a `<button>`, so the user-menu triggers (a
 *   `div role="button"` around it) were a button inside a button: two tab
 *   stops, the inner one named only by an initial and doing nothing;
 * - an `Alert` had no live-region role, so an error that appeared after a
 *   failed save was not announced;
 * - a disabled `SearchBar` only set `pointer-events: none`: the input stayed
 *   in the tab order and typing still searched.
 */
describe("Avatar", () => {
    it("is not a button when nothing makes it interactive", () => {
        render(<Avatar>F</Avatar>);
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.getByText("F")).toBeInTheDocument();
    });

    it("is a button when given an onClick", () => {
        const onClick = jest.fn();
        render(<Avatar onClick={onClick}>F</Avatar>);
        fireEvent.click(screen.getByRole("button"));
        expect(onClick).toHaveBeenCalled();
    });

    it("is a button when it is a menu's trigger", () => {
        render(<Menu trigger={<Avatar>A</Avatar>}><MenuItem>Sign out</MenuItem></Menu>);
        expect(screen.getByRole("button")).toHaveTextContent("A");
    });
});

describe("Alert", () => {
    it("announces errors and warnings assertively and the rest politely", () => {
        const { rerender } = render(<Alert color="error">Save failed</Alert>);
        expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
        rerender(<Alert color="warning">Careful</Alert>);
        expect(screen.getByRole("alert")).toHaveTextContent("Careful");
        rerender(<Alert color="info">Saved</Alert>);
        expect(screen.getByRole("status")).toHaveTextContent("Saved");
    });
});

describe("SearchBar", () => {
    it("a disabled search bar cannot be typed into", () => {
        const onTextSearch = jest.fn();
        render(<SearchBar disabled onTextSearch={onTextSearch} placeholder="Search"/>);
        expect(screen.getByRole("textbox", { name: "Search" })).toBeDisabled();
    });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import { Chip } from "../src";

afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
});

describe("Chip picks its ink from the nearest declared theme", () => {
    it("uses dark ink inside a data-theme=\"dark\" region on a light page", () => {
        document.documentElement.setAttribute("data-theme", "light");
        render(
            <div>
                <Chip colorScheme="blue">page</Chip>
                <div data-theme="dark"><Chip colorScheme="blue">region</Chip></div>
            </div>
        );
        const page = screen.getByText("page").closest("div") as HTMLElement;
        const region = screen.getByText("region").closest("div") as HTMLElement;
        expect(page.style.color).not.toBe(region.style.color);
    });

    it("falls back to the document's theme where no region declares one", () => {
        document.documentElement.classList.add("dark");
        render(<div><Chip colorScheme="blue">a</Chip></div>);
        const darkInk = (screen.getByText("a").closest("div") as HTMLElement).style.color;
        document.documentElement.classList.remove("dark");
        const { unmount } = render(<div><Chip colorScheme="blue">b</Chip></div>);
        const lightInk = (screen.getByText("b").closest("div") as HTMLElement).style.color;
        expect(darkInk).not.toBe(lightInk);
        unmount();
    });
});

/**
 * What a closed `Select` with a long option list costs, and what it still does.
 *
 * Radix renders a closed select's items anyway — into a detached fragment, so
 * that typing a letter on the focused trigger can pick an option, and inside a
 * form into a hidden native `<select>` too. Every enum field paid for its whole
 * list on every render of the form around it: 500 options was 100 ms to mount
 * and 17 ms per re-render (jsdom), 2,000 was 400 / 60 ms.
 *
 * Above 50 options a closed select now renders only the option it shows, and
 * answers typed letters itself from the item list. A select of 50 or fewer is
 * untouched.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { Select, SelectItem } from "../src/components/Select";

// jsdom has no layout: an opened Radix select scrolls its selected item into view.
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
}

let itemRenders = 0;

/** Rendered inside every option, so each render of an option counts once. */
function Counted({ children }: { children: string }) {
    itemRenders++;
    return <>{children}</>;
}

const COUNTRIES = ["Austria", "Belgium", "Germany", "Georgia", "Ghana", "Greece", "Spain"];

/** n options: the countries above first, then filler that matches no letter typed below. */
function optionLabels(n: number): string[] {
    return Array.from({ length: n }, (_, i) => i < COUNTRIES.length ? COUNTRIES[i] : `Zone ${i}`);
}

function Countries({
    n,
    value,
    onValueChange = () => undefined,
    tick = 0
}: {
    n: number,
    value?: string,
    onValueChange?: (value: string) => void,
    tick?: number
}) {
    void tick;
    return (
        <form data-testid={"form"}>
            <Select name={"country"} value={value} onValueChange={onValueChange} aria-label={"Country"}>
                {optionLabels(n).map((label, i) => (
                    <SelectItem key={i} value={`v${i}`}>
                        <Counted>{label}</Counted>
                    </SelectItem>
                ))}
            </Select>
        </form>
    );
}

beforeEach(() => {
    itemRenders = 0;
});

describe("a closed select with a long option list", () => {

    test.each([500, 2000])("renders only the option it shows, at mount and on a re-render (n=%i)", (n) => {
        const { rerender } = render(<Countries n={n} value={"v3"}/>);
        // Twice: in the trigger, and as the hidden option the form submits.
        expect(itemRenders).toBeLessThanOrEqual(2);

        itemRenders = 0;
        rerender(<Countries n={n} value={"v3"} tick={1}/>);
        expect(itemRenders).toBeLessThanOrEqual(2);
    });

    test("renders every option once it is opened", () => {
        render(<Countries n={500} value={"v3"}/>);
        act(() => {
            fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
        });
        expect(screen.getAllByRole("option")).toHaveLength(500);
    });

    test("a select of 50 options is unchanged: it renders them all while closed", () => {
        render(<Countries n={50} value={"v3"}/>);
        expect(itemRenders).toBeGreaterThanOrEqual(50);
    });

    test("still submits its value with the form", () => {
        render(<Countries n={500} value={"v2"}/>);
        const form = screen.getByTestId("form") as HTMLFormElement;
        expect(new FormData(form).get("country")).toBe("v2");
    });

    // The hidden native select holds only the option shown, so for one commit
    // after the value moves it has no match — and Radix reports what it holds.
    test("a value set by the form is kept, not cleared by the hidden native select", () => {
        const changes: string[] = [];
        const { rerender } = render(<Countries n={500} value={"v0"} onValueChange={(v) => changes.push(v)}/>);
        rerender(<Countries n={500} value={"v6"} onValueChange={(v) => changes.push(v)}/>);
        expect(changes).toEqual([]);
        const form = screen.getByTestId("form") as HTMLFormElement;
        expect(new FormData(form).get("country")).toBe("v6");
    });
});

describe("typing on a closed select with a long option list", () => {

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /** A controlled select, the way a form field holds one. */
    function Controlled({ initial, onChange }: { initial?: string, onChange: (value: string) => void }) {
        const [value, setValue] = React.useState(initial);
        return <Countries n={500} value={value} onValueChange={(v) => {
            onChange(v);
            setValue(v);
        }}/>;
    }

    function type(key: string) {
        act(() => {
            fireEvent.keyDown(screen.getByRole("combobox"), { key });
        });
    }

    test("picks the next option whose label starts with the letters typed", () => {
        const changes: string[] = [];
        render(<Controlled onChange={(v) => changes.push(v)}/>);

        type("g");
        expect(changes).toEqual(["v2"]); // Germany

        type("h");
        expect(changes).toEqual(["v2", "v4"]); // "gh": Ghana
    });

    test("pressing the same letter again cycles through the options it starts", () => {
        const changes: string[] = [];
        render(<Controlled initial={"v2"} onChange={(v) => changes.push(v)}/>);

        type("g");
        type("g");
        type("g");
        expect(changes).toEqual(["v3", "v4", "v5"]); // Georgia, Ghana, Greece
    });

    test("forgets what was typed after a second without a key, as Radix does", () => {
        const changes: string[] = [];
        render(<Controlled onChange={(v) => changes.push(v)}/>);

        type("g");
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        type("s");
        expect(changes).toEqual(["v2", "v6"]); // Germany, then "s" alone: Spain
    });

    test("does not open the select while a letter is typed", () => {
        render(<Controlled onChange={() => undefined}/>);
        type("g");
        expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe("false");
    });

    test("an option shown as a component is matched by its textValue", () => {
        const changes: string[] = [];
        const Chip = ({ id }: { id: string }) => <span>{id === "a" ? "Alpha" : "Bravo"}</span>;
        render(
            <Select value={undefined} onValueChange={(v) => changes.push(v)} aria-label={"Code"}>
                {Array.from({ length: 60 }, (_, i) => (
                    <SelectItem key={i} value={`c${i}`} textValue={i === 41 ? "Bravo" : `Code ${i}`}>
                        <Chip id={i === 41 ? "b" : "a"}/>
                    </SelectItem>
                ))}
            </Select>
        );
        act(() => {
            fireEvent.keyDown(screen.getByRole("combobox"), { key: "b" });
        });
        expect(changes).toEqual(["c41"]);
    });

    test("the form submits the option typed", () => {
        render(<Controlled initial={"v0"} onChange={() => undefined}/>);
        type("s");
        const form = screen.getByTestId("form") as HTMLFormElement;
        expect(new FormData(form).get("country")).toBe("v6");
    });
});

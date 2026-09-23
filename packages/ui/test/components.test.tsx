import React from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    Button,
    Badge,
    Alert,
    Checkbox,
    Card,
    Typography,
    MultiSelect,
    MultiSelectItem,
    IconButton,
    TextField,
    DebouncedTextField,
    Avatar,
    Select,
    SelectItem,
    DateTimeField,
    Slider
} from "../src";
import "@testing-library/jest-dom";

// jsdom has neither: Radix measures a popover's content and cmdk scrolls the
// active option into view.
class NoopResizeObserver implements ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
}
globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.scrollIntoView = function () { /* noop */ };

describe("UI Components", () => {
    describe("Button Component", () => {
        it("renders button with children text", () => {
            render(<Button>Click Me</Button>);
            const button = screen.getByRole("button", { name: /click me/i });
            expect(button).toBeInTheDocument();
            expect(button).not.toBeDisabled();
        });

        it("calls onClick handler when clicked", () => {
            const handleClick = jest.fn();
            render(<Button onClick={handleClick}>Click Me</Button>);
            const button = screen.getByRole("button", { name: /click me/i });
            fireEvent.click(button);
            expect(handleClick).toHaveBeenCalledTimes(1);
        });

        it("disables button when disabled prop is true", () => {
            render(<Button disabled>Click Me</Button>);
            const button = screen.getByRole("button", { name: /click me/i });
            expect(button).toBeDisabled();
        });
    });

    describe("Badge Component", () => {
        it("renders children and badge dot", () => {
            const { container } = render(
                <Badge color="primary">
                    <span>Item</span>
                </Badge>
            );
            expect(screen.getByText("Item")).toBeInTheDocument();
            const dot = container.querySelector(".bg-primary");
            expect(dot).toBeInTheDocument();
        });
    });

    describe("Alert Component", () => {
        it("renders alert with correct message", () => {
            render(<Alert color="error">Something went wrong!</Alert>);
            expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
        });

        /**
         * This block used to pass `severity="error"`, a prop `AlertProps` does
         * not declare. React drops an unknown prop silently, so the alert
         * rendered in its default `info` blue while the test — which only read
         * the text — reported that an error alert renders correctly. The colour
         * is asserted now, so the prop has to be both spelled right and wired.
         */
        it("applies the colour it was given, not the default", () => {
            const { container: errorAlert } = render(<Alert color="error">Boom</Alert>);
            const { container: infoAlert } = render(<Alert>Note</Alert>);

            expect(errorAlert.querySelector(".text-red-800")).toBeInTheDocument();
            expect(errorAlert.querySelector(".text-blue-800")).not.toBeInTheDocument();
            // The default, for contrast — otherwise "always red" would pass.
            expect(infoAlert.querySelector(".text-blue-800")).toBeInTheDocument();
        });
    });

    describe("Checkbox Component", () => {
        it("renders unchecked checkbox by default", () => {
            render(<Checkbox checked={false} />);
            const checkbox = screen.getByRole("checkbox");
            expect(checkbox).toBeInTheDocument();
            expect(checkbox).not.toBeChecked();
        });

        it("renders checked checkbox when checked prop is true", () => {
            render(<Checkbox checked={true} />);
            const checkbox = screen.getByRole("checkbox");
            expect(checkbox).toBeChecked();
        });
    });

    describe("Card Component", () => {
        it("renders card content", () => {
            render(<Card>Card Content</Card>);
            expect(screen.getByText("Card Content")).toBeInTheDocument();
        });
    });

    describe("Typography Component", () => {
        it("renders typography text with correct tag", () => {
            render(<Typography variant="h1">Header Text</Typography>);
            const header = screen.getByRole("heading", { level: 1 });
            expect(header).toBeInTheDocument();
            expect(header).toHaveTextContent("Header Text");
        });
    });

    describe("TextField Component", () => {
        // `TextField` accepts every input attribute, `onFocus` and `onBlur`
        // included, and then set its own handlers after the spread. So a
        // caller's blur handler never ran: `DebouncedTextField` never flushed
        // the last keystrokes on blur, and a form's `Field` never marked a field
        // touched.
        it.each([false, true])("calls the caller's onFocus and onBlur (multiline: %s)", (multiline) => {
            const onFocus = jest.fn();
            const onBlur = jest.fn();
            render(<TextField aria-label="name" multiline={multiline} value="" onChange={() => { /* noop */ }}
                              onFocus={onFocus} onBlur={onBlur}/>);

            const field = screen.getByLabelText("name");
            fireEvent.focus(field);
            fireEvent.blur(field);
            expect(onFocus).toHaveBeenCalledTimes(1);
            expect(onBlur).toHaveBeenCalledTimes(1);
        });

        it("DebouncedTextField hands over the last keystrokes on blur, not 150ms later", () => {
            jest.useFakeTimers();
            try {
                const onChange = jest.fn();
                const { unmount } = render(<DebouncedTextField aria-label="title" name="title" value="" onChange={onChange}/>);

                const field = screen.getByLabelText("title");
                fireEvent.change(field, { target: { value: "hello" } });
                fireEvent.blur(field);
                expect(onChange).toHaveBeenCalledTimes(1);
                expect(onChange.mock.calls[0][0].target.value).toBe("hello");

                // Closing the form straight after loses nothing, and sends nothing twice.
                unmount();
                act(() => {
                    jest.advanceTimersByTime(500);
                });
                expect(onChange).toHaveBeenCalledTimes(1);
            } finally {
                jest.useRealTimers();
            }
        });

        // The single-line branch passed `disabled` to the input; the multiline
        // branch only set `aria-disabled`, so a disabled textarea took typing.
        it.each([false, true])("is natively disabled (multiline: %s)", (multiline) => {
            const { container } = render(<TextField aria-label="notes" multiline={multiline} disabled value="x"
                                                    onChange={() => { /* noop */ }}/>);
            expect(container.querySelector(multiline ? "textarea" : "input")).toBeDisabled();
        });

        // A number field blurs itself on wheel, so scrolling the page past it does
        // not change the number. It found the element through `inputRef.current`,
        // and a callback ref has none: the render crashed.
        it("takes a callback inputRef on a number field, and still blurs on wheel", () => {
            let element: HTMLInputElement | null = null;
            render(<TextField aria-label="stock" type="number" value={1} onChange={() => { /* noop */ }}
                              inputRef={(node: HTMLInputElement | null) => { element = node; }}/>);

            const field = screen.getByLabelText("stock");
            expect(element).toBe(field);
            act(() => field.focus());
            fireEvent.wheel(field);
            expect(field).not.toHaveFocus();
        });

        it("blurs a number field on wheel with the default ref too, and still calls the caller's onWheel", () => {
            const onWheel = jest.fn();
            render(<TextField aria-label="stock" type="number" value={1} onChange={() => { /* noop */ }}
                              onWheel={onWheel}/>);

            const field = screen.getByLabelText("stock");
            act(() => field.focus());
            fireEvent.wheel(field);
            expect(field).not.toHaveFocus();
            expect(onWheel).toHaveBeenCalledTimes(1);
        });
    });

    /**
     * One failed image left the avatar on its initials for good. The photo URL
     * box in the user settings feeds the preview as you type, so the first
     * keystroke failed to load and the finished URL never showed.
     */
    describe("Avatar Component", () => {
        it("shows a new image after an earlier one failed", () => {
            const { container, rerender } = render(<Avatar src="h" alt="me">J</Avatar>);
            fireEvent.error(container.querySelector("img")!);
            expect(container.querySelector("img")).toBeNull();
            expect(screen.getByText("J")).toBeInTheDocument();

            rerender(<Avatar src="https://example.com/me.png" alt="me">J</Avatar>);
            expect(container.querySelector("img")).toHaveAttribute("src", "https://example.com/me.png");
        });
    });

    /**
     * Radix reads a value of `""` as "nothing selected" and shows the
     * placeholder, so an item whose value is `""` (an "inherit the default"
     * choice) left the trigger blank while it was the selected one.
     */
    describe("Select Component", () => {
        it("shows the selected item whose value is the empty string", () => {
            render(<Select aria-label="cpu" value="" placeholder="Pick one" onValueChange={() => { /* noop */ }}>
                <SelectItem value="">Inherited — 1 CPU</SelectItem>
                <SelectItem value="2">2 CPU</SelectItem>
            </Select>);

            expect(screen.getByRole("combobox", { name: "cpu" })).toHaveTextContent("Inherited — 1 CPU");
        });

        it("still shows the placeholder for an empty value no item has", () => {
            render(<Select aria-label="cpu" value="" placeholder="Pick one" onValueChange={() => { /* noop */ }}>
                <SelectItem value="1">1 CPU</SelectItem>
                <SelectItem value="2">2 CPU</SelectItem>
            </Select>);

            expect(screen.getByRole("combobox", { name: "cpu" })).toHaveTextContent("Pick one");
        });

        it("shows a non-empty selected item as before", () => {
            render(<Select aria-label="cpu" value="2" placeholder="Pick one" onValueChange={() => { /* noop */ }}>
                <SelectItem value="">Inherited — 1 CPU</SelectItem>
                <SelectItem value="2">2 CPU</SelectItem>
            </Select>);

            expect(screen.getByRole("combobox", { name: "cpu" })).toHaveTextContent("2 CPU");
        });
    });

    /**
     * With a `timezone`, a typed wall-clock time is converted to UTC with that
     * zone's offset. The offset was taken at the wall-clock time read as if it
     * were UTC, which is a different instant: within a few hours of a DST switch
     * it is the other side of the switch, so the stored time was an hour out
     * and read back as a different time from the one typed.
     */
    describe("DateTimeField in a named timezone", () => {
        const typeIn = (timezone: string, wallClock: string) => {
            const onChange = jest.fn();
            const { container } = render(<DateTimeField aria-label="when" mode="date_time" timezone={timezone}
                                                        value={null} onChange={onChange}/>);
            fireEvent.change(container.querySelector("input")!, { target: { value: wallClock } });
            expect(onChange).toHaveBeenCalledTimes(1);
            return (onChange.mock.calls[0][0] as Date).toISOString();
        };

        it.each([
            // Hours after the spring switch: EDT, not the EST of 04:00 UTC.
            ["America/New_York", "2024-03-10T04:00", "2024-03-10T08:00:00.000Z"],
            // Half an hour before the autumn switch: CEST, not the CET of 01:30 UTC.
            ["Europe/Berlin", "2024-10-27T01:30", "2024-10-26T23:30:00.000Z"],
            // Away from any switch.
            ["America/New_York", "2024-07-01T12:00", "2024-07-01T16:00:00.000Z"],
            ["Asia/Kolkata", "2024-01-15T09:30", "2024-01-15T04:00:00.000Z"],
            // A time the spring switch skips moves forward, as before.
            ["America/New_York", "2024-03-10T02:30", "2024-03-10T07:30:00.000Z"]
        ])("stores %s %s as %s", (timezone, wallClock, utc) => {
            expect(typeIn(timezone, wallClock)).toBe(utc);
        });
    });

    // The thumbs were counted from `value` alone, so an uncontrolled range
    // slider rendered one thumb for its two values.
    describe("Slider Component", () => {
        it("renders a thumb per value when uncontrolled", () => {
            render(<Slider defaultValue={[20, 80]}/>);
            expect(screen.getAllByRole("slider")).toHaveLength(2);
        });

        it("renders a thumb per value when controlled", () => {
            render(<Slider value={[10, 50, 90]} onValueChange={() => { /* noop */ }}/>);
            expect(screen.getAllByRole("slider")).toHaveLength(3);
        });
    });

    /**
     * A disabled `IconButton` was only `aria-disabled` with pointer events off.
     * A button that disables itself on click keeps the focus, so Enter or Space
     * fired it again: the autofill Send button started a second run that way.
     */
    describe("IconButton Component", () => {
        function SendOnce({ component }: { component?: "div" }) {
            const [sending, setSending] = React.useState(false);
            const [sent, setSent] = React.useState(0);
            return <>
                <IconButton
                    aria-label="send"
                    component={component}
                    disabled={sending}
                    onClick={() => {
                        setSent((count) => count + 1);
                        setSending(true);
                    }}>
                    <span>x</span>
                </IconButton>
                <output>{sent}</output>
            </>;
        }

        it("does not fire again from the keyboard once it disables itself", async () => {
            const user = userEvent.setup();
            render(<SendOnce/>);
            const button = screen.getByRole("button", { name: "send" });

            await user.click(button);
            await user.keyboard("{Enter}");
            await user.keyboard(" ");

            expect(screen.getByRole("status")).toHaveTextContent("1");
            expect(button).toBeDisabled();
        });

        it("fires from the keyboard while enabled", async () => {
            const user = userEvent.setup();
            const onClick = jest.fn();
            render(<IconButton aria-label="add" onClick={onClick}><span>+</span></IconButton>);

            screen.getByRole("button", { name: "add" }).focus();
            await user.keyboard("{Enter}");
            expect(onClick).toHaveBeenCalledTimes(1);
        });

        it("drops the click of a disabled non-button element", () => {
            const onClick = jest.fn();
            render(<IconButton aria-label="open" component="div" disabled onClick={onClick}><span>o</span></IconButton>);

            fireEvent.click(screen.getByRole("button", { name: "open" }));
            expect(onClick).not.toHaveBeenCalled();
        });
    });

    /**
     * `disabled` only picked the dimmed background. The trigger stayed a live
     * button, so an array-of-enum property with `admin.disabled` could be opened,
     * changed and saved from the form, and each chip's remove icon and the clear
     * icon kept working on the closed field.
     */
    describe("MultiSelect Component", () => {
        const renderTags = (disabled: boolean, onValueChange: jest.Mock) => render(
            <MultiSelect disabled={disabled} value={["a"]} onValueChange={onValueChange} aria-label="tags">
                <MultiSelectItem value="a">Alpha</MultiSelectItem>
                <MultiSelectItem value="b">Beta</MultiSelectItem>
            </MultiSelect>
        );

        it("does not open or change its value when disabled", () => {
            const onValueChange = jest.fn();
            const { container } = renderTags(true, onValueChange);

            const trigger = screen.getByRole("button", { name: "tags" });
            fireEvent.click(trigger);
            expect(screen.queryAllByRole("option")).toHaveLength(0);

            // The chip's remove icon and the clear icon sit inside the trigger.
            container.querySelectorAll("svg").forEach((icon) => fireEvent.click(icon));
            expect(onValueChange).not.toHaveBeenCalled();
            expect(trigger).toBeDisabled();
        });

        it("opens and changes its value when enabled", () => {
            const onValueChange = jest.fn();
            renderTags(false, onValueChange);

            fireEvent.click(screen.getByRole("button", { name: "tags" }));
            const beta = screen.getAllByRole("option").find((option) => option.textContent?.includes("Beta"));
            expect(beta).toBeDefined();
            fireEvent.click(beta!);
            expect(onValueChange).toHaveBeenCalledWith(["a", "b"]);
        });
    });
});

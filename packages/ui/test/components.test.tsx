import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, Badge, Alert, Checkbox, Card, Typography } from "../src";
import "@testing-library/jest-dom";

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
});

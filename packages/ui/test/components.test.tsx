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
            render(<Alert severity="error">Something went wrong!</Alert>);
            expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
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

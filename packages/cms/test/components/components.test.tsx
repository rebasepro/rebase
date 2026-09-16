/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, test, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock @rebasepro/app hooks and LoginView component
jest.mock("@rebasepro/app", () => ({
    useRebaseRegistry: jest.fn(),
    useAuthController: jest.fn(),
    useTranslation: () => ({ t: (key: string) => key === "copy" ? "Copy" : key }),
    LoginView: ({ authController }: any) => <div data-testid="login-view">Login View</div>
}));

// Mock some of @rebasepro/ui components that require theme context or specific providers
jest.mock("@rebasepro/ui", () => {
    const original = jest.requireActual("@rebasepro/ui") as any;
    return {
        ...original,
        Tooltip: ({ children, title }: any) => (
            <div data-testid="tooltip" data-title={title ? "has-title" : "no-title"}>
                {children}
                {title && <div data-testid="tooltip-content">{title}</div>}
            </div>
        ),
        Typography: ({ children, className, variant, color, ...props }: any) => (
            <span data-testid="typography" className={className} data-variant={variant} data-color={color} {...props}>
                {children}
            </span>
        ),
        IconButton: ({ children, onClick, ...props }: any) => (
            <button data-testid="icon-button" onClick={onClick} {...props}>
                {children}
            </button>
        ),
        CopyIcon: ({ onClick, ...props }: any) => (
            <span data-testid="copy-icon" onClick={onClick} {...props}>
                CopyIcon
            </span>
        ),
        CircularProgressCenter: ({ size }: any) => (
            <div data-testid="loading-spinner" data-size={size}>
                Loading...
            </div>
        )
    };
});

import { FieldCaption } from "../../src/components/FieldCaption";
import { RebaseAuthGate } from "../../src/components/RebaseAuthGate";
import { PropertyKeyHint } from "../../src/components/PropertyKeyHint";
import { PropertyConfigBadge } from "../../src/components/PropertyConfigBadge";
import { useRebaseRegistry, useAuthController } from "@rebasepro/app";
import { PropertyConfig } from "@rebasepro/cms-types";

describe("React Components Tests", () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("FieldCaption Component", () => {
        test("should render null if no children are provided", () => {
            const { container } = render(<FieldCaption error={false} />);
            expect(container.firstChild).toBeNull();
        });

        test("should render with secondary color variant when error is false", () => {
            render(<FieldCaption error={false}>Caption Text</FieldCaption>);
            const caption = screen.getByTestId("typography");
            expect(caption).toBeTruthy();
            expect(caption.textContent).toBe("Caption Text");
            expect(caption.getAttribute("data-color")).toBe("secondary");
        });

        test("should render with error color variant when error is true", () => {
            render(<FieldCaption error={true}>Error Text</FieldCaption>);
            const caption = screen.getByTestId("typography");
            expect(caption).toBeTruthy();
            expect(caption.getAttribute("data-color")).toBe("error");
        });
    });

    describe("RebaseAuthGate Component", () => {
        test("should show loading spinner when auth is initial loading", () => {
            (useAuthController as any).mockReturnValue({
                initialLoading: true,
                user: null
            });
            (useRebaseRegistry as any).mockReturnValue({});

            render(
                <RebaseAuthGate>
                    <div data-testid="child">Authenticated Child</div>
                </RebaseAuthGate>
            );

            expect(screen.getByTestId("loading-spinner")).toBeTruthy();
            expect(screen.queryByTestId("login-view")).toBeNull();
            expect(screen.queryByTestId("child")).toBeNull();
        });

        test("should show LoginView when user is not authenticated", () => {
            (useAuthController as any).mockReturnValue({
                initialLoading: false,
                user: null
            });
            (useRebaseRegistry as any).mockReturnValue({
                authConfig: {}
            });

            render(
                <RebaseAuthGate>
                    <div data-testid="child">Authenticated Child</div>
                </RebaseAuthGate>
            );

            expect(screen.getByTestId("login-view")).toBeTruthy();
            expect(screen.queryByTestId("loading-spinner")).toBeNull();
            expect(screen.queryByTestId("child")).toBeNull();
        });

        test("should render children when user is authenticated", () => {
            (useAuthController as any).mockReturnValue({
                initialLoading: false,
                user: { uid: "user-123" }
            });
            (useRebaseRegistry as any).mockReturnValue({});

            render(
                <RebaseAuthGate>
                    <div data-testid="child">Authenticated Child</div>
                </RebaseAuthGate>
            );

            expect(screen.getByTestId("child")).toBeTruthy();
            expect(screen.queryByTestId("loading-spinner")).toBeNull();
            expect(screen.queryByTestId("login-view")).toBeNull();
        });
    });

    describe("PropertyKeyHint Component", () => {
        beforeEach(() => {
            // Mock navigator.clipboard API
            Object.defineProperty(navigator, "clipboard", {
                value: {
                    writeText: jest.fn().mockResolvedValue(undefined)
                },
                configurable: true
            });
        });

        // It replaced a tooltip that opened whenever a field took focus and
        // covered the label being read. Inline and out of the tab order is the
        // whole point, so both are pinned.
        test("renders the key inline, with no floating layer, outside the tab order", () => {
            render(<PropertyKeyHint propertyKey="my_property_key"/>);

            const hint = screen.getByRole("button", { name: "Copy my_property_key" });
            expect(hint.textContent).toContain("my_property_key");
            expect(hint.tabIndex).toBe(-1);
            expect(screen.queryByTestId("tooltip")).toBeNull();
        });

        test("copies the key on click without also clicking what the label sits in", async () => {
            jest.useFakeTimers();
            const onParentClick = jest.fn();

            render(
                <div onClick={onParentClick}>
                    <PropertyKeyHint propertyKey="my_property_key"/>
                </div>
            );

            expect(screen.getByTestId("copy-icon")).toBeTruthy();

            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "Copy my_property_key" }));
            });

            expect(navigator.clipboard.writeText).toHaveBeenCalledWith("my_property_key");
            expect(onParentClick).not.toHaveBeenCalled();
            expect(screen.queryByTestId("copy-icon")).toBeNull();

            await act(async () => {
                jest.advanceTimersByTime(1600);
            });

            expect(screen.getByTestId("copy-icon")).toBeTruthy();

            jest.useRealTimers();
        });
    });

    describe("PropertyConfigBadge Component", () => {
        test("should render with configured color", () => {
            const config: PropertyConfig = {
                property: { type: "string" },
                color: "#ff00ff"
            };

            const { container } = render(<PropertyConfigBadge propertyConfig={config} />);
            const badgeDiv = container.firstChild as HTMLDivElement;
            expect(badgeDiv).toBeTruthy();
            expect(badgeDiv.style.background).toBe("rgb(255, 0, 255)"); // equivalent of #ff00ff in RGB style
        });

        test("should render with fallback/disabled styling", () => {
            const config: PropertyConfig = {
                property: { type: "string" },
                color: "#ff00ff"
            };

            const { container } = render(<PropertyConfigBadge propertyConfig={config} disabled={true} />);
            const badgeDiv = container.firstChild as HTMLDivElement;
            expect(badgeDiv).toBeTruthy();
            expect(badgeDiv.style.background).toBe("");
            expect(badgeDiv.className).toContain("bg-surface-400");
        });
    });
});

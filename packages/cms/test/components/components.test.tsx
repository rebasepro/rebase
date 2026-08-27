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
import { PropertyIdCopyTooltip, PropertyIdCopyTooltipContent } from "../../src/components/PropertyIdCopyTooltip";
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

    describe("PropertyIdCopyTooltip Component", () => {
        beforeEach(() => {
            // Mock navigator.clipboard API
            Object.defineProperty(navigator, "clipboard", {
                value: {
                    writeText: jest.fn().mockResolvedValue(undefined)
                },
                configurable: true
            });
        });

        test("should render PropertyIdCopyTooltip and contain children", () => {
            render(
                <PropertyIdCopyTooltip propertyKey="my_property_key">
                    <button data-testid="target-button">Hover me</button>
                </PropertyIdCopyTooltip>
            );

            expect(screen.getByTestId("target-button")).toBeTruthy();
            expect(screen.getByTestId("tooltip")).toBeTruthy();
        });

        test("should render content, show copy text initially, and toggle to 'Copied' on click", async () => {
            jest.useFakeTimers();

            render(<PropertyIdCopyTooltipContent propertyKey="my_property_key" />);

            // Check initial text
            const typographies = screen.getAllByTestId("typography");
            const labelTypo = typographies[0];
            const keyTypo = typographies[1];

            expect(labelTypo.textContent).toBe("Property ID");
            expect(keyTypo.textContent).toBe("my_property_key");

            const copyButton = screen.getByTestId("copy-icon");

            // Click copy button
            await act(async () => {
                fireEvent.click(copyButton);
            });

            expect(navigator.clipboard.writeText).toHaveBeenCalledWith("my_property_key");
            expect(labelTypo.textContent).toBe("Copied");

            // Fast-forward 2 seconds
            await act(async () => {
                jest.advanceTimersByTime(2000);
            });

            expect(labelTypo.textContent).toBe("Property ID");

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

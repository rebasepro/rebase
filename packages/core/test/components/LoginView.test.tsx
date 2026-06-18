import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { LoginView } from "../../src/components/LoginView/LoginView";
import "@testing-library/jest-dom";

// Polyfill TextEncoder/TextDecoder for JSDOM
import { TextEncoder, TextDecoder } from "util";
Object.assign(global, { TextEncoder,
TextDecoder });

// Mock window.matchMedia
if (typeof window !== "undefined") {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: jest.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn()
        }))
    });
}

// Mock react-i18next globally
jest.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: {
            language: "en",
            changeLanguage: jest.fn().mockResolvedValue(undefined)
        }
    })
}));

// Mock other hooks from '../../src/hooks'
jest.mock("../../src/hooks", () => {
    const original = jest.requireActual("../../src/hooks");
    return {
        ...original,
        useTranslation: () => ({
            t: (key: string) => key,
            i18n: {
                language: "en",
                changeLanguage: jest.fn().mockResolvedValue(undefined)
            }
        }),
        useModeController: () => ({
            mode: "light",
            setMode: jest.fn()
        }),
        useRebaseContext: () => ({
            baseUrl: "http://localhost:3001"
        })
    };
});

describe("LoginView Component", () => {
    let mockAuthController: any;

    beforeEach(() => {
        mockAuthController = {
            capabilities: {
                registration: true,
                passwordReset: true
            },
            authProviderError: null,
            user: null,
            forgotPassword: jest.fn().mockResolvedValue(undefined),
            emailPasswordLogin: jest.fn().mockResolvedValue(undefined),
            register: jest.fn().mockResolvedValue(undefined),
            initialLoading: false,
            authLoading: false,
            oauthLogin: jest.fn(),
            googleLogin: jest.fn()
        };
    });

    it("renders login view with email and password fields after clicking Sign in with email", async () => {
        render(<LoginView authController={mockAuthController} />);

        // Click Sign in with email first to reveal the inputs
        const signInWithEmailButton = screen.getByRole("button", { name: /Sign in with email/i });
        fireEvent.click(signInWithEmailButton);

        // Wait a short bit and verify inputs are visible
        const emailInput = await screen.findByPlaceholderText("you@example.com");
        const passwordInput = await screen.findByPlaceholderText("••••••••");

        expect(emailInput).toBeInTheDocument();
        expect(passwordInput).toBeInTheDocument();
    });

    it("calls emailPasswordLogin when form is submitted", async () => {
        render(<LoginView authController={mockAuthController} />);

        // Click Sign in with email to reveal inputs
        const signInWithEmailButton = screen.getByRole("button", { name: /Sign in with email/i });
        fireEvent.click(signInWithEmailButton);

        const emailInput = await screen.findByPlaceholderText("you@example.com");
        const passwordInput = await screen.findByPlaceholderText("••••••••");
        const submitButton = await screen.findByRole("button", { name: /Sign in/i });

        fireEvent.change(emailInput, { target: { value: "test@rebase.pro" } });
        fireEvent.change(passwordInput, { target: { value: "password123" } });

        await act(async () => {
            fireEvent.click(submitButton);
        });

        expect(mockAuthController.emailPasswordLogin).toHaveBeenCalledWith("test@rebase.pro", "password123");
    });

    it("switches to registration mode and calls register on submit", async () => {
        render(<LoginView authController={mockAuthController} />);

        // Click Create one button/link
        const signUpLink = screen.getByRole("button", { name: /Create one/i });
        fireEvent.click(signUpLink);

        // Wait for registration submit button/inputs to be visible
        const registerButton = await screen.findByRole("button", { name: /Create account/i });
        const nameInput = await screen.findByPlaceholderText("Jane Doe (optional)");
        const emailInput = await screen.findByPlaceholderText("you@example.com");
        const passwordInput = await screen.findByPlaceholderText("••••••••");

        fireEvent.change(emailInput, { target: { value: "new@rebase.pro" } });
        fireEvent.change(passwordInput, { target: { value: "password123" } });
        fireEvent.change(nameInput, { target: { value: "New User" } });

        await act(async () => {
            fireEvent.click(registerButton);
        });

        expect(mockAuthController.register).toHaveBeenCalledWith("new@rebase.pro", "password123", "New User");
    });
});

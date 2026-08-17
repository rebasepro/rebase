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

    describe("OAuth buttons need both halves configured", () => {
        const GOOGLE_ID = "test-client-id.apps.googleusercontent.com";

        it("renders the Google button when the client id and the backend provider agree", () => {
            mockAuthController.capabilities.enabledProviders = ["google"];
            render(<LoginView authController={mockAuthController} googleClientId={GOOGLE_ID}/>);
            expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeInTheDocument();
        });

        it("hides the Google button when the backend reports no google provider", () => {
            mockAuthController.capabilities.enabledProviders = [];
            render(<LoginView authController={mockAuthController} googleClientId={GOOGLE_ID}/>);
            expect(screen.queryByRole("button", { name: /Sign in with Google/i })).not.toBeInTheDocument();
        });

        it("hides the Google button when the backend has the provider but no client id was given", () => {
            mockAuthController.capabilities.enabledProviders = ["google"];
            render(<LoginView authController={mockAuthController}/>);
            expect(screen.queryByRole("button", { name: /Sign in with Google/i })).not.toBeInTheDocument();
        });

        it("warns which half of a half-configured provider is missing", () => {
            jest.useFakeTimers();
            const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
            try {
                mockAuthController.capabilities.enabledProviders = [];
                render(<LoginView authController={mockAuthController} googleClientId={GOOGLE_ID}/>);
                act(() => { jest.advanceTimersByTime(3500); });

                expect(warn).toHaveBeenCalledWith(expect.stringContaining("GOOGLE_CLIENT_ID"));
            } finally {
                warn.mockRestore();
                jest.useRealTimers();
            }
        });

        // Uses github, not google: the warning dedupes per provider for the
        // lifetime of the module, and the test above already spent "google".
        it("stays silent while the backend config is still in flight", () => {
            jest.useFakeTimers();
            const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
            try {
                // Mount with the pre-config empty array, then let the real
                // provider list land before the warning is due.
                mockAuthController.capabilities.enabledProviders = [];
                const { rerender } = render(
                    <LoginView authController={mockAuthController} githubClientId="gh-client-id"/>
                );
                act(() => { jest.advanceTimersByTime(1000); });

                mockAuthController = {
                    ...mockAuthController,
                    capabilities: { ...mockAuthController.capabilities,
enabledProviders: ["github"] }
                };
                rerender(<LoginView authController={mockAuthController} githubClientId="gh-client-id"/>);
                act(() => { jest.advanceTimersByTime(5000); });

                expect(warn).not.toHaveBeenCalled();
            } finally {
                warn.mockRestore();
                jest.useRealTimers();
            }
        });
    });

    it("does not render additionalComponent or noUserComponent in bootstrap mode", () => {
        const additionalText = "Custom Additional Component Content";
        const noUserText = "Custom No User Component Content";

        render(
            <LoginView
                authController={mockAuthController}
                needsSetup={true}
                additionalComponent={<div data-testid="additional">{additionalText}</div>}
                noUserComponent={<div data-testid="no-user">{noUserText}</div>}
            />
        );

        // Verify that the setup inputs are present (indicating we are in bootstrap mode)
        expect(screen.getByPlaceholderText("Jane Doe (optional)")).toBeInTheDocument();

        // Verify that neither of the user-defined components is rendered
        expect(screen.queryByTestId("additional")).not.toBeInTheDocument();
        expect(screen.queryByTestId("no-user")).not.toBeInTheDocument();
    });

    /**
     * The opt-in belongs to the screen where you pick *how* to sign in, not to
     * the password form. Asked on the form, it reached only the people who got
     * that far by typing an address — anyone using Google was never offered it.
     *
     * Which makes the tick outlive a screen change, so these check both halves:
     * that it is offered in the right place, and that a box ticked on screen one
     * is still read after a sign-in that happens on screen two.
     */
    describe("newsletter opt-in", () => {
        const optIn = () => screen.getByText("join_newsletter").closest("label")!
            .querySelector("button")!;

        it("is offered on the provider screen, not on the credentials form", async () => {
            render(<LoginView authController={mockAuthController} onNewsletterOptIn={jest.fn()}/>);

            expect(screen.getByText("join_newsletter")).toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: /Sign in with email/i }));
            await screen.findByPlaceholderText("you@example.com");

            expect(screen.queryByText("join_newsletter")).not.toBeInTheDocument();
        });

        it("is not offered at all when the host wires no callback", () => {
            render(<LoginView authController={mockAuthController}/>);
            expect(screen.queryByText("join_newsletter")).not.toBeInTheDocument();
        });

        it("subscribes the address that signed in, with a tick made a screen earlier", async () => {
            const onNewsletterOptIn = jest.fn();
            render(<LoginView authController={mockAuthController} onNewsletterOptIn={onNewsletterOptIn}/>);

            fireEvent.click(optIn());
            fireEvent.click(screen.getByRole("button", { name: /Sign in with email/i }));

            const emailInput = await screen.findByPlaceholderText("you@example.com");
            fireEvent.change(emailInput, { target: { value: "reader@example.com" } });
            fireEvent.change(await screen.findByPlaceholderText("••••••••"), { target: { value: "password123" } });

            await act(async () => {
                fireEvent.click(await screen.findByRole("button", { name: /^Sign in$/i }));
            });

            expect(onNewsletterOptIn).toHaveBeenCalledWith("reader@example.com");
        });

        it("does not subscribe when the box was left alone", async () => {
            const onNewsletterOptIn = jest.fn();
            render(<LoginView authController={mockAuthController} onNewsletterOptIn={onNewsletterOptIn}/>);

            fireEvent.click(screen.getByRole("button", { name: /Sign in with email/i }));
            fireEvent.change(await screen.findByPlaceholderText("you@example.com"), { target: { value: "reader@example.com" } });
            fireEvent.change(await screen.findByPlaceholderText("••••••••"), { target: { value: "password123" } });

            await act(async () => {
                fireEvent.click(await screen.findByRole("button", { name: /^Sign in$/i }));
            });

            expect(onNewsletterOptIn).not.toHaveBeenCalled();
        });

        it("does not subscribe an address the controller rejected", async () => {
            const onNewsletterOptIn = jest.fn();
            mockAuthController.emailPasswordLogin = jest.fn().mockRejectedValue(new Error("bad credentials"));
            render(<LoginView authController={mockAuthController} onNewsletterOptIn={onNewsletterOptIn}/>);

            fireEvent.click(optIn());
            fireEvent.click(screen.getByRole("button", { name: /Sign in with email/i }));
            fireEvent.change(await screen.findByPlaceholderText("you@example.com"), { target: { value: "reader@example.com" } });
            fireEvent.change(await screen.findByPlaceholderText("••••••••"), { target: { value: "password123" } });

            await act(async () => {
                fireEvent.click(await screen.findByRole("button", { name: /^Sign in$/i }));
            });

            // A ticked box on a failed attempt would subscribe an address
            // nobody proved they control.
            expect(onNewsletterOptIn).not.toHaveBeenCalled();
        });

        it("keeps the opt-in on the form in bootstrap mode, which has no provider screen", () => {
            render(
                <LoginView
                    authController={mockAuthController}
                    needsSetup={true}
                    onNewsletterOptIn={jest.fn()}
                />
            );

            expect(screen.getByPlaceholderText("Jane Doe (optional)")).toBeInTheDocument();
            expect(screen.getByText("join_newsletter")).toBeInTheDocument();
        });
    });

    describe("provider sign-in failures", () => {
        /** Stands in for Google's script, handing back the popup callback. */
        function installGoogleScript(): { fire: (response: { code?: string; error?: string }) => void } {
            let callback: ((response: { code?: string; error?: string }) => void) | undefined;
            (window as any).google = {
                accounts: {
                    oauth2: {
                        initCodeClient: (config: any) => {
                            callback = config.callback;
                            return { requestCode: jest.fn() };
                        }
                    }
                }
            };
            return { fire: (response) => act(() => { callback?.(response); }) };
        }

        afterEach(() => {
            delete (window as any).google;
        });

        function renderWithGoogle() {
            mockAuthController.capabilities = {
                ...mockAuthController.capabilities,
                enabledProviders: ["google"]
            };
            return render(
                <LoginView authController={mockAuthController} googleClientId="client-id.apps.googleusercontent.com"/>
            );
        }

        it("shows the backend's reason on the provider screen when a sign-in is refused", () => {
            // What the demo returned: the popup closes and the visitor is back
            // on an unchanged login screen, so this message is the only place
            // the refusal is visible.
            mockAuthController.authProviderError = new Error("No account exists for this google identity, and new sign-ups are disabled on this backend.");
            renderWithGoogle();

            expect(screen.getByText(/new sign-ups are disabled/i)).toBeInTheDocument();
        });

        it("does not show a stale failure once the user is signed in", () => {
            mockAuthController.authProviderError = new Error("Registration is disabled");
            mockAuthController.user = { uid: "1" };
            renderWithGoogle();

            expect(screen.queryByText(/Registration is disabled/i)).not.toBeInTheDocument();
        });

        it("reports a Google popup error the controller never sees", () => {
            const google = installGoogleScript();
            renderWithGoogle();

            google.fire({ error: "invalid_client" });

            expect(screen.getByText(/invalid_client/)).toBeInTheDocument();
            expect(mockAuthController.googleLogin).not.toHaveBeenCalled();
        });

        it("stays quiet when the visitor closes the popup", () => {
            const google = installGoogleScript();
            renderWithGoogle();

            google.fire({ error: "popup_closed" });

            expect(screen.queryByText(/popup_closed/)).not.toBeInTheDocument();
        });
    });
});

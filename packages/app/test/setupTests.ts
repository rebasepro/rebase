import { configure } from "@testing-library/react";

/**
 * testing-library's 1000ms `waitFor` default is a bet on scheduler latency, not
 * on the component, and `pnpm -r test` runs every package's workers at once.
 * Set globally so the flake cannot just move to the next call site. Nothing is
 * weakened — a component that never settles still fails.
 */
configure({ asyncUtilTimeout: 15_000 });

// Polyfill TextEncoder/TextDecoder for JSDOM (required by react-router)
import { TextEncoder, TextDecoder } from "util";
Object.assign(global, { TextEncoder,
TextDecoder });

// Jest setup file for JSDOM environment
// Mock window.matchMedia which is not implemented in JSDOM
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

// Mock ResizeObserver which is not implemented in JSDOM
global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn()
}));

// Mock IntersectionObserver which is not implemented in JSDOM
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
    root: null,
    rootMargin: "",
    thresholds: []
}));

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

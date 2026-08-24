// CMS test setup
// This file is referenced by jest.setupFilesAfterSetup in package.json.
// Add any global test setup logic here.

import { configure } from "@testing-library/react";
import { TextEncoder, TextDecoder } from "util";

/**
 * testing-library resolves `waitFor` against a 1000ms default, which is a bet
 * on how quickly this machine schedules a microtask — not on the component.
 * `pnpm -r test` runs every package's workers at once, so the bet is lost
 * exactly under the conditions CI creates, and it fails as a timeout on
 * whichever assertion happened to be inside the callback.
 *
 * Set globally rather than per call site: there are 86 `waitFor` calls in this
 * package, they fail one at a time under contention, and patching whichever one
 * surfaced last time just moves the flake. Nothing is weakened — the callback
 * still has to succeed, a component that never settles still fails, and a
 * timeout only has to stop a hang.
 */
configure({ asyncUtilTimeout: 15_000 });
Object.assign(global, { TextDecoder,
TextEncoder });

// Mock window.matchMedia for jsdom environment (used by useLargeLayout in @rebasepro/app)
Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn()
    }))
});

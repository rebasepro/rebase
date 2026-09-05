/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { render } from "@testing-library/react";

import { useData } from "../../src/hooks/data/useData";
import { useAuthController } from "../../src/hooks/useAuthController";
import { useCustomizationController } from "../../src/hooks/useCustomizationController";
import { useDialogsController } from "../../src/hooks/useDialogsController";
import { useStorageSource } from "../../src/hooks/useStorageSource";
import { useRebaseRegistry, useRebaseRegistryDispatch } from "../../src/hooks/useRebaseRegistry";

/**
 * Every one of these contexts defaulted to `{} as Whatever` — a lie the type
 * system agreed with. Called outside `<Rebase>`, the hook handed back an empty
 * object and the failure surfaced one call later as "data.collection is not a
 * function", in a component's render, naming neither the hook nor the provider
 * that was missing.
 */

const cases: [string, () => unknown][] = [
    ["useData", useData],
    ["useAuthController", useAuthController],
    ["useCustomizationController", useCustomizationController],
    ["useDialogsController", useDialogsController],
    ["useStorageSource", useStorageSource],
    ["useRebaseRegistry", useRebaseRegistry],
    ["useRebaseRegistryDispatch", useRebaseRegistryDispatch]
];

// React logs the thrown error itself; the assertion below is the report.
let consoleError: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
    consoleError.mockRestore();
});

describe("core hooks used outside <Rebase>", () => {

    it.each(cases)("%s names itself and the provider", (name, hook) => {
        function Probe() {
            hook();
            return null;
        }

        expect(() => render(<Probe/>))
            .toThrow(`${name} must be used inside <Rebase>`);
    });
});

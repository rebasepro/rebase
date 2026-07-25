/**
 * @jest-environment jsdom
 */
import React from "react";
import { resolveComponentRef } from "../src/hooks/useResolvedComponent";

describe("resolveComponentRef", () => {

    // ── Nullish inputs ────────────────────────────────────────────────

    it("returns undefined for undefined input", () => {
        expect(resolveComponentRef(undefined)).toBeUndefined();
    });

    it("returns undefined for null input", () => {
        expect(resolveComponentRef(null as any)).toBeUndefined();
    });

    // ── String inputs (should never reach runtime) ────────────────────

    it("returns undefined for a raw string and logs a warning", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        const result = resolveComponentRef("../../components/MyField" as any);
        expect(result).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("raw string ComponentRef")
        );
        warnSpy.mockRestore();
    });

    // ── LazyComponentRef (Vite-transformed) ───────────────────────────

    it("wraps a LazyComponentRef in React.lazy", () => {
        const FakeComponent = () => null;
        const ref = {
            __rebaseLazy: true as const,
            load: () => Promise.resolve({ default: FakeComponent })
        };
        const result = resolveComponentRef(ref);
        expect(result).toBeDefined();
        // React.lazy produces an object with $$typeof = Symbol(react.lazy)
        expect((result as any).$$typeof).toBeDefined();
    });

    it("returns the same lazy wrapper for the same LazyComponentRef (cache hit)", () => {
        const ref = {
            __rebaseLazy: true as const,
            load: () => Promise.resolve({ default: () => null })
        };
        const first = resolveComponentRef(ref);
        const second = resolveComponentRef(ref);
        expect(first).toBe(second);
    });

    // ── Direct React components ───────────────────────────────────────

    it("returns a named function component as-is", () => {
        function MyComponent() { return null; }
        const result = resolveComponentRef(MyComponent as any);
        expect(result).toBe(MyComponent);
    });

    it("returns a class component as-is", () => {
        class MyClassComponent extends React.Component {
            render() { return null; }
        }
        const result = resolveComponentRef(MyClassComponent as any);
        expect(result).toBe(MyClassComponent);
    });

    it("returns a function component with props (length > 0) as-is", () => {
        function WithProps(_props: { name: string }) { return null; }
        const result = resolveComponentRef(WithProps as any);
        expect(result).toBe(WithProps);
    });

    it("returns a named zero-param component (uppercase) as-is", () => {
        function Header() { return null; }
        const result = resolveComponentRef(Header as any);
        expect(result).toBe(Header);
    });

    // ── Manual lazy loaders ───────────────────────────────────────────

    it("wraps an anonymous arrow lazy loader with React.lazy", () => {
        // Anonymous arrow function with zero params = treated as lazy loader
        const loader = () => Promise.resolve({ default: (() => null) as React.ComponentType });
        const result = resolveComponentRef(loader as any);
        expect(result).toBeDefined();
        expect(result).not.toBe(loader);
        // React.lazy wraps produce $$typeof
        expect((result as any).$$typeof).toBeDefined();
    });

    it("caches the lazy wrapper for the same loader function", () => {
        const loader = () => Promise.resolve({ default: (() => null) as React.ComponentType });
        const first = resolveComponentRef(loader as any);
        const second = resolveComponentRef(loader as any);
        expect(first).toBe(second);
    });

    // ── Loaders whose inferred name looks like a component ────────────
    //
    // The documented way to attach a custom component is
    //
    //     admin: { Field: () => import("./MyField"), Preview: () => import("./MyPreview") }
    //
    // and JavaScript names an anonymous function after the property key it is
    // assigned to, so both arrows arrive here called "Field" and "Preview".
    // Classification used to be "starts with an uppercase letter → component",
    // which matched every one of them: the loader was handed to React as a
    // component, React called it, got a Promise, and rendered nothing. The demo's
    // custom body-parts preview column was blank because of this.

    it("wraps a lazy loader whose inferred name is capitalised (the `Preview:` key case)", () => {
        // Written exactly as a collection file writes it — not as a bare `const`.
        const admin = { Preview: () => import("./__mocks__/lazyComponent") };
        expect(admin.Preview.name).toBe("Preview"); // the trap, stated outright

        const result = resolveComponentRef(admin.Preview as any);
        expect(result).not.toBe(admin.Preview);
        expect((result as any).$$typeof).toBeDefined(); // React.lazy wrapper
    });

    it("wraps a capitalised `Field:` loader too", () => {
        const admin = { Field: () => import("./__mocks__/lazyComponent") };
        const result = resolveComponentRef(admin.Field as any);
        expect(result).not.toBe(admin.Field);
        expect((result as any).$$typeof).toBeDefined();
    });

    it("still returns a capitalised zero-prop component as-is", () => {
        // The other side of the same decision: no dynamic import, named like a
        // component, so it must not be wrapped in React.lazy.
        const admin = { Preview: () => null };
        const result = resolveComponentRef(admin.Preview as any);
        expect(result).toBe(admin.Preview);
    });

    // ── forwardRef / memo ────────────────────────────────────────────

    it("returns a React.forwardRef component as-is", () => {
        const FwdComp = React.forwardRef((_props, _ref) => null);
        FwdComp.displayName = "FwdComp";
        const result = resolveComponentRef(FwdComp as any);
        expect(result).toBe(FwdComp);
    });

    it("returns a React.memo component as-is", () => {
        function Plain() { return null; }
        const Memoed = React.memo(Plain);
        const result = resolveComponentRef(Memoed as any);
        expect(result).toBe(Memoed);
    });

    // ── Edge cases ────────────────────────────────────────────────────

    it("returns undefined for a plain object without __rebaseLazy", () => {
        const result = resolveComponentRef({ foo: "bar" } as any);
        expect(result).toBeUndefined();
    });
});

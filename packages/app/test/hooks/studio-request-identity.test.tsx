/**
 * @jest-environment jsdom
 */
import React from "react";
import { renderHook } from "@testing-library/react";
import { StudioBridgeProvider, toPublicApiUrl, useStudioCapabilities } from "../../src/hooks/useStudioBridge";
import type { StudioCapabilities } from "../../src/hooks/useStudioBridge";

/**
 * A host that runs every Studio request as a service key (the hosted console,
 * through its proxy) says so with `requestIdentity`, and may name the
 * project's public API origin for the URLs the tools show. Unset, nothing
 * changes: an admin panel's tools run as the signed-in user, and show the
 * URLs they request.
 */
describe("the host's request identity", () => {
    it("is unset by default, so the tools keep their run-as and no-auth choices", () => {
        const { result } = renderHook(() => useStudioCapabilities());
        expect(result.current).toEqual({ codebase: true });
        expect(result.current.requestIdentity).toBeUndefined();
    });

    it("reaches the tools when the host passes it", () => {
        const capabilities: StudioCapabilities = {
            codebase: false,
            requestIdentity: { kind: "service-key", publicApiOrigin: "https://my-app.example.com" }
        };
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <StudioBridgeProvider value={{ capabilities }}>{children}</StudioBridgeProvider>
        );
        const { result } = renderHook(() => useStudioCapabilities(), { wrapper });
        expect(result.current.requestIdentity).toEqual({ kind: "service-key", publicApiOrigin: "https://my-app.example.com" });
    });
});

describe("toPublicApiUrl", () => {
    const proxy = "https://console.example.com/api/functions/studio/p1/proxy";

    it("swaps the proxy base for the project's public origin", () => {
        const capabilities: StudioCapabilities = {
            codebase: false,
            requestIdentity: { kind: "service-key", publicApiOrigin: "https://my-app.example.com/" }
        };
        expect(toPublicApiUrl(`${proxy}/api/data/posts?limit=5`, `${proxy}/`, capabilities))
            .toBe("https://my-app.example.com/api/data/posts?limit=5");
    });

    it("leaves the URL alone when no public origin is named", () => {
        const url = `${proxy}/api/data/posts`;
        expect(toPublicApiUrl(url, proxy, { codebase: true })).toBe(url);
        expect(toPublicApiUrl(url, proxy, { codebase: false, requestIdentity: { kind: "service-key" } })).toBe(url);
    });

    it("leaves a URL that is not under the API base alone", () => {
        const capabilities: StudioCapabilities = {
            codebase: false,
            requestIdentity: { kind: "service-key", publicApiOrigin: "https://my-app.example.com" }
        };
        expect(toPublicApiUrl("https://elsewhere.example.com/x", proxy, capabilities)).toBe("https://elsewhere.example.com/x");
    });
});

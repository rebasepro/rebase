import { jest } from "@jest/globals";
import type { ResponseMeta, Transport } from "../../src/transport";

/**
 * What a fake transport's request answers with: the parsed body, as the
 * server would have sent it. Its arguments are `Transport["request"]`'s.
 */
export type RequestAnswer = (path: string, init?: RequestInit, meta?: ResponseMeta) => Promise<unknown>;

/**
 * A `Transport["request"]` answering from `answer`, with the arguments it was
 * called with passed through as they came.
 *
 * `request<T>` lets each caller name the body it expects, and the real
 * transport hands the parsed JSON back as that `T` unchecked (`body as T` in
 * `transport.ts`). The fake answers the same way, with the same one assertion.
 */
export function fakeRequest(answer: RequestAnswer): Transport["request"] {
    return async <T = unknown>(...args: Parameters<Transport["request"]>): Promise<T> => {
        const body: unknown = await answer(...args);
        // The caller's `T` is its claim about the body, as with the real
        // transport's parsed JSON: there is no value to check it against.
        return body as T;
    };
}

/**
 * A whole `Transport` whose requests go to `answer` and whose other members
 * are inert. Override any member with `overrides`.
 */
export function fakeTransport(answer: RequestAnswer, overrides: Partial<Transport> = {}): Transport {
    return {
        request: fakeRequest(answer),
        baseUrl: "http://localhost",
        apiPath: "/api",
        fetchFn: globalThis.fetch,
        setToken: jest.fn<Transport["setToken"]>(),
        setAuthTokenGetter: jest.fn<Transport["setAuthTokenGetter"]>(),
        setOnUnauthorized: jest.fn<Transport["setOnUnauthorized"]>(),
        getHeaders: jest.fn<Transport["getHeaders"]>().mockReturnValue({}),
        resolveToken: jest.fn<Transport["resolveToken"]>().mockResolvedValue(null),
        ...overrides
    };
}

/**
 * A {@link fakeTransport} over a jest mock, so a test can queue answers
 * (`mockRequest.mockResolvedValueOnce(...)`) and read the calls back.
 */
export function createMockTransport(overrides: Partial<Transport> = {}): { transport: Transport; mockRequest: jest.Mock<RequestAnswer> } {
    const mockRequest = jest.fn<RequestAnswer>();
    return { transport: fakeTransport(mockRequest, overrides), mockRequest };
}

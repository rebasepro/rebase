/**
 * A client's bad token is the client's problem, and the log says so in one line.
 *
 * Every request carrying a token this backend did not sign — another
 * backend's session, a stale one from before a secret rotation, a mangled
 * header — logged `❌ [ERROR] [JWT] Verification failed` with the library's
 * whole stack, and so did every `verifyCredential` call that correctly
 * answered null. The request was answered with a 401; nothing on the server
 * had failed, yet the error log filled with stacks no one could act on.
 * A wrong signature is still worth a line an operator sees, since a forgery
 * looks exactly like it — one line, at warn.
 */
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

import { logger } from "../src/utils/logger";
import { createJwtService } from "../src/auth/jwt";

const ours = createJwtService({ secret: "jwt-refusal-logging-ours-0123456789abcdef", accessExpiresIn: "1h" });
const theirs = createJwtService({ secret: "jwt-refusal-logging-theirs-0123456789abcd", accessExpiresIn: "1h" });

const logged = () => [
    ...jest.mocked(logger.error).mock.calls.map(call => ["error", ...call]),
    ...jest.mocked(logger.warn).mock.calls.map(call => ["warn", ...call]),
    ...jest.mocked(logger.debug).mock.calls.map(call => ["debug", ...call])
];

describe("a token that does not verify", () => {
    it.each([
        // Another backend's, or a forgery: the same thing from here, so an
        // operator sees it — once, without a stack.
        ["another backend's signature", "warn", async () => theirs.generateAccessToken("u1", [])],
        ["a malformed token", "debug", async () => "not-a-token"],
        ["a download token presented as a session", "debug", async () => ours.generateDownloadToken("default/a.txt")]
    ])("%s is refused with one %s line and no stack", async (_name, level, mint) => {
        jest.clearAllMocks();
        expect(await ours.verifyAccessToken(await mint())).toBeNull();

        expect(logger.error).not.toHaveBeenCalled();
        const lines = logged();
        expect(lines).toHaveLength(1);
        expect(lines[0][0]).toBe(level);
        expect(JSON.stringify(lines[0])).not.toMatch(/\bat \w|stack/);
    });

    it("still verifies its own", async () => {
        jest.clearAllMocks();
        expect(await ours.verifyAccessToken(await ours.generateAccessToken("u1", ["editor"])))
            .toEqual(expect.objectContaining({ uid: "u1", roles: ["editor"] }));
        expect(logger.error).not.toHaveBeenCalled();
    });
});

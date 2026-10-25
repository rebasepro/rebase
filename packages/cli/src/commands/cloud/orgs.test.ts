/**
 * `rebase cloud orgs members …` and `rebase cloud orgs invites …`.
 *
 * Pinned: invite sends one request to the control plane's `invites` function
 * with the lowercased address and the role, and prints the link (the control
 * plane may send no email) and whether the email went out; inviting and
 * invitations take a login session, never REBASE_TOKEN; remove asks first and
 * resolves a member by email or user id; role changes go through the data API
 * (whose hooks refuse what an admin may not do); a bad role or action is
 * refused before any call; `--json` is one JSON value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireSessionClient: vi.fn(),
        getContextOrg: vi.fn(() => "org-1")
    };
});

import * as context from "./context";
import { orgsCommand } from "./orgs";

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", "orgs", ...words];
}

const LINK = "https://app.example/invite/rin_" + "a".repeat(48);
const INVITE = {
    id: "inv-1", email: "new@x.com", role: "admin",
    invitedBy: { userId: "u-owner", email: "owner@acme.test" },
    expiresAt: "2026-11-01T10:00:00.000Z", expired: false, createdAt: "2026-10-25T10:00:00.000Z"
};

const invoke = vi.fn(async (_name: string, body: unknown, opts?: { method?: string; path?: string }) => {
    if (opts?.method === "GET") return { invites: [INVITE], canManage: true };
    if (opts?.method === "DELETE") return { invite: INVITE };
    if (opts?.path?.endsWith("/resend")) return { invite: INVITE, link: LINK, emailDelivery: { sent: true } };
    const email = (body as { email: string }).email;
    // Only a control plane from before invitations-for-everyone answers this.
    if (email === "older-cp@x.com") return { kind: "added", userId: "u-2", role: "member", email };
    return { kind: "invited", invite: { ...INVITE, email }, link: LINK, emailDelivery: { sent: false, reason: "not_configured" } };
});
const findMembers = vi.fn(async () => ({ data: [
    { id: "m-1", userId: "u-owner", role: "owner" },
    { id: "m-2", userId: "u-ana", role: "member" }
] }));
const findUsers = vi.fn(async () => ({ data: [
    { id: "u-owner", email: "owner@acme.test" },
    { id: "u-ana", email: "ana@acme.test" }
] }));
const deleteMember = vi.fn(async () => ({}));
const updateMember = vi.fn(async () => ({}));

const client = {
    functions: { invoke },
    data: {
        collection: (name: string) => name === "users"
            ? { find: findUsers }
            : { find: findMembers, delete: deleteMember, update: updateMember }
    }
};

beforeEach(() => {
    setJsonModeForTest(true);
    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ client, url: "https://cp.example" });
    (context.requireSessionClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ client, url: "https://cp.example" });
});
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

async function stdoutOf(run: () => Promise<unknown>): Promise<{ out: string; exited: boolean }> {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
        chunks.push(typeof s === "string" ? s : String(s));
        return true;
    };
    const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
        throw new Error("__exit__");
    }) as never);
    let exited = false;
    try {
        await run();
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = orig;
        exit.mockRestore();
    }
    return { out: chunks.join(""), exited };
}

const run = (...words: string[]) => stdoutOf(() => orgsCommand(words[0], argv(...words)));

describe("rebase cloud orgs members", () => {
    it("lists members with their email, as one JSON value", async () => {
        const { out, exited } = await run("members", "--json");
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual({
            org: "org-1",
            members: [
                { id: "m-1", userId: "u-owner", email: "owner@acme.test", role: "owner" },
                { id: "m-2", userId: "u-ana", email: "ana@acme.test", role: "member" }
            ]
        });
    });

    it("invites by email through the invites function with a session, and returns the link and the email outcome", async () => {
        const { out, exited } = await run("members", "invite", "New@X.com", "--role", "admin", "--json");
        expect(exited).toBe(false);
        expect(context.requireSessionClient).toHaveBeenCalledWith(expect.any(Array), "invite people to an organization");
        expect(context.requireClient).not.toHaveBeenCalled();
        expect(invoke).toHaveBeenCalledWith("invites", { organizationId: "org-1", email: "new@x.com", role: "admin" });
        const body = JSON.parse(out);
        expect(body.kind).toBe("invited");
        expect(body.link).toBe(LINK);
        expect(body.emailDelivery).toEqual({ sent: false, reason: "not_configured" });
        expect(body.org).toBe("org-1");
    });

    it("invites an existing account like anyone else, defaulting the role to member", async () => {
        const { out } = await run("members", "invite", "existing@x.com", "--org", "org-2", "--json");
        expect(invoke).toHaveBeenCalledWith("invites", { organizationId: "org-2", email: "existing@x.com", role: "member" });
        expect(JSON.parse(out)).toMatchObject({ org: "org-2", kind: "invited", link: LINK });
    });

    it("refuses --role owner before any call: invite as admin, promote once they have joined", async () => {
        const { out, exited } = await run("members", "invite", "a@x.com", "--role", "owner");
        expect(exited).toBe(true);
        const error = JSON.parse(out).error;
        expect(error.code).toBe("invite_role_not_allowed");
        expect(error.hint).toMatch(/--role admin/);
        expect(error.hint).toMatch(/members role a@x\.com owner/);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("still reports what an older control plane that adds directly did", async () => {
        const { out } = await run("members", "invite", "older-cp@x.com", "--json");
        expect(JSON.parse(out)).toMatchObject({ kind: "added", userId: "u-2" });
    });

    it("prints the link and the email outcome for a person", async () => {
        setJsonModeForTest(false);
        const logs: string[] = [];
        const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
        const err = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
        try {
            await run("members", "invite", "new@x.com");
        } finally {
            log.mockRestore();
            err.mockRestore();
        }
        const text = logs.join("\n");
        expect(text).toContain("Invitation sent to new@x.com");
        expect(text).not.toMatch(/added|is now a member/);
        expect(text).toContain(LINK);
        expect(text).toMatch(/sends no email/);
    });

    it("refuses a bad role, a missing address and an unknown action before any call", async () => {
        for (const words of [
            ["members", "invite", "a@x.com", "--role", "superuser"],
            ["members", "invite"],
            ["members", "kick", "a@x.com"],
            ["members", "role", "ana@acme.test", "god"],
            ["members", "remove", "--role", "admin", "ana@acme.test"]
        ]) {
            const { out, exited } = await run(...words);
            expect(exited, words.join(" ")).toBe(true);
            expect(["usage", "unknown_command"]).toContain(JSON.parse(out).error.code);
        }
        expect(invoke).not.toHaveBeenCalled();
        expect(deleteMember).not.toHaveBeenCalled();
    });

    it("asks before removing: without --yes off a terminal it refuses and removes nothing", async () => {
        const { out, exited } = await run("members", "remove", "ana@acme.test");
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("confirmation_required");
        expect(deleteMember).not.toHaveBeenCalled();
    });

    it("removes a member named by email or by user id, with --yes", async () => {
        const { out } = await run("members", "remove", "ANA@acme.test", "--yes", "--json");
        expect(deleteMember).toHaveBeenCalledWith("m-2");
        expect(JSON.parse(out)).toEqual({ org: "org-1", removed: { userId: "u-ana", email: "ana@acme.test", role: "member" } });
        await run("members", "remove", "u-ana", "--yes");
        expect(deleteMember).toHaveBeenLastCalledWith("m-2");
    });

    it("refuses to remove someone who is not a member", async () => {
        const { out, exited } = await run("members", "remove", "ghost@x.com", "--yes");
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("not_found");
        expect(deleteMember).not.toHaveBeenCalled();
    });

    it("changes a role through the data API, and relays the server's refusal", async () => {
        const { out } = await run("members", "role", "ana@acme.test", "admin", "--json");
        expect(updateMember).toHaveBeenCalledWith("m-2", { role: "admin" });
        expect(JSON.parse(out)).toMatchObject({ role: "admin", previousRole: "member", changed: true });

        updateMember.mockRejectedValueOnce(new Error("Only an organization's owner can grant or remove the owner role."));
        const refused = await run("members", "role", "ana@acme.test", "owner");
        expect(refused.exited).toBe(true);
        expect(refused.out).toContain("Only an organization's owner can grant or remove the owner role.");
    });
});

describe("rebase cloud orgs invites", () => {
    it("lists pending invitations with a session", async () => {
        const { out } = await run("invites", "--json");
        expect(context.requireSessionClient).toHaveBeenCalledWith(expect.any(Array), "manage invitations");
        expect(invoke).toHaveBeenCalledWith("invites", undefined, { method: "GET", path: "org/org-1" });
        expect(JSON.parse(out)).toEqual({ org: "org-1", invites: [INVITE] });
    });

    it("revokes by email or id", async () => {
        const { out } = await run("invites", "revoke", "new@x.com", "--json");
        expect(invoke).toHaveBeenCalledWith("invites", undefined, { method: "DELETE", path: "inv-1" });
        expect(JSON.parse(out).revoked.id).toBe("inv-1");
        await run("invites", "revoke", "inv-1");
        expect(invoke).toHaveBeenLastCalledWith("invites", undefined, { method: "DELETE", path: "inv-1" });
    });

    it("resends, returning the new link", async () => {
        const { out } = await run("invites", "resend", "inv-1", "--json");
        expect(invoke).toHaveBeenCalledWith("invites", {}, { path: "inv-1/resend" });
        expect(JSON.parse(out)).toMatchObject({ link: LINK, emailDelivery: { sent: true } });
    });

    it("refuses an unknown invitation and a missing reference", async () => {
        const unknown = await run("invites", "revoke", "nobody@x.com");
        expect(unknown.exited).toBe(true);
        expect(JSON.parse(unknown.out).error.code).toBe("not_found");
        const missing = await run("invites", "revoke");
        expect(missing.exited).toBe(true);
        expect(JSON.parse(missing.out).error.code).toBe("usage");
        expect(invoke).not.toHaveBeenCalledWith("invites", undefined, expect.objectContaining({ method: "DELETE" }));
    });
});

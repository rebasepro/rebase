/**
 * `rebase cloud access …` and `rebase cloud access invites …`.
 *
 * Pinned: the exact request each action sends to the control plane
 * (`project-access` and `invites`, project-scoped); every change takes a login
 * session, never REBASE_TOKEN; a bad role or action is refused before any
 * call; removing someone whose access comes from the organization is refused
 * with the command that does it; changes ask first; an older control plane is
 * `not_served`; `--json` is one JSON value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireSessionClient: vi.fn(),
        requireProject: vi.fn(async () => "proj-1"),
        displayProjectRef: vi.fn(() => "shop")
    };
});

import * as context from "./context";
import { fakeCloudClient } from "../../../test/helpers/cloud-client";
import { accessCommand } from "./access";

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", "access", ...words];
}

const LINK = "https://app.example/invite/rin_" + "b".repeat(48);
const INVITE = {
    id: "inv-9", email: "dev@x.com", role: "developer",
    invitedBy: { userId: "u-owner", email: "owner@acme.test" },
    expiresAt: "2026-12-01T10:00:00.000Z", expired: false, createdAt: "2026-11-22T10:00:00.000Z"
};
const MEMBERS = [
    { userId: "u-owner", email: "owner@acme.test", role: "admin", organizationRole: "owner", projectRole: null },
    { userId: "u-ana", email: "ana@acme.test", role: "admin", organizationRole: null, projectRole: "admin" },
    { userId: "u-bo", email: "bo@acme.test", role: "developer", organizationRole: "member", projectRole: "viewer" }
];

class NotServed extends Error {
    status = 404;
    code = "FUNCTION_NOT_FOUND";
}

let served = true;
const invoke = vi.fn(async (name: string, body: unknown, opts?: { method?: string; path?: string }) => {
    if (!served) throw new NotServed("Function not found");
    if (name === "project-access") {
        if (opts?.method === "GET") return { members: MEMBERS, canManage: true };
        if (opts?.method === "PATCH") return { member: { ...MEMBERS[1], role: (body as { role: string }).role, projectRole: (body as { role: string }).role } };
        if (opts?.method === "DELETE") return { removed: true, adminPanel: "revoked" };
    }
    if (opts?.method === "GET") return { invites: [INVITE], canManage: true };
    if (opts?.method === "DELETE") return { invite: INVITE };
    if (opts?.path?.endsWith("/resend")) return { invite: INVITE, link: LINK, emailDelivery: { sent: true } };
    const email = (body as { email: string }).email;
    return { kind: "invited", invite: { ...INVITE, email }, link: LINK, emailDelivery: { sent: true } };
});

const client = fakeCloudClient({ invoke });

beforeEach(() => {
    served = true;
    setJsonModeForTest(true);
    vi.mocked(context.requireClient).mockResolvedValue({ client, url: "https://cp.example" });
    vi.mocked(context.requireSessionClient).mockResolvedValue({ client, url: "https://cp.example" });
});
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

async function run(...words: string[]): Promise<{ out: string; exited: boolean }> {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
        chunks.push(typeof s === "string" ? s : String(s));
        return true;
    };
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("__exit__");
    });
    let exited = false;
    try {
        await accessCommand(argv(...words));
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = orig;
        exit.mockRestore();
    }
    return { out: chunks.join(""), exited };
}

describe("rebase cloud access", () => {
    it("lists who can reach the project with GET project-access/<project>", async () => {
        const { out, exited } = await run("--json");
        expect(exited).toBe(false);
        expect(invoke).toHaveBeenCalledWith("project-access", undefined, { method: "GET", path: "proj-1" });
        expect(JSON.parse(out)).toEqual({ project: "proj-1", members: MEMBERS, canManage: true });
    });

    it("invites by email to the project with a session: POST invites { scope: project }", async () => {
        const { out, exited } = await run("invite", "Dev@X.com", "--role", "viewer", "--json");
        expect(exited).toBe(false);
        expect(context.requireSessionClient).toHaveBeenCalledWith(expect.any(Array), "invite people to a project");
        expect(context.requireClient).not.toHaveBeenCalled();
        expect(invoke).toHaveBeenCalledWith("invites", { scope: "project", projectId: "proj-1", email: "dev@x.com", role: "viewer" });
        expect(JSON.parse(out)).toMatchObject({ project: "proj-1", kind: "invited", link: LINK, emailDelivery: { sent: true } });
    });

    it("defaults the invited role to developer", async () => {
        await run("invite", "dev@x.com", "--json");
        expect(invoke).toHaveBeenCalledWith("invites", { scope: "project", projectId: "proj-1", email: "dev@x.com", role: "developer" });
    });

    it("changes a project role with PATCH project-access/<project>/members/<uid>, after asking", async () => {
        const refused = await run("role", "ana@acme.test", "viewer");
        expect(refused.exited).toBe(true);
        expect(JSON.parse(refused.out).error.code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalledWith("project-access", expect.anything(), expect.objectContaining({ method: "PATCH" }));

        const { out, exited } = await run("role", "ANA@acme.test", "viewer", "--yes", "--json");
        expect(exited).toBe(false);
        expect(invoke).toHaveBeenCalledWith("project-access", { role: "viewer" }, { method: "PATCH", path: "proj-1/members/u-ana" });
        expect(JSON.parse(out)).toMatchObject({ project: "proj-1", previousRole: "admin", changed: true, member: { role: "viewer" } });
    });

    it("says so, and sends nothing, when the role is already the project's", async () => {
        const { out } = await run("role", "u-ana", "admin", "--json");
        expect(JSON.parse(out)).toMatchObject({ changed: false });
        expect(invoke).not.toHaveBeenCalledWith("project-access", expect.anything(), expect.objectContaining({ method: "PATCH" }));
    });

    it("removes a project role with DELETE project-access/<project>/members/<uid>", async () => {
        const { out, exited } = await run("remove", "bo@acme.test", "--yes", "--json");
        expect(exited).toBe(false);
        expect(invoke).toHaveBeenCalledWith("project-access", undefined, { method: "DELETE", path: "proj-1/members/u-bo" });
        expect(JSON.parse(out)).toMatchObject({
            project: "proj-1",
            removed: { userId: "u-bo", email: "bo@acme.test", projectRole: "viewer" },
            adminPanel: "revoked"
        });
    });

    it("refuses to remove someone who reaches the project through the organization, naming the command that does", async () => {
        const { out, exited } = await run("remove", "owner@acme.test", "--yes");
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.hint).toMatch(/orgs members remove/);
        expect(invoke).not.toHaveBeenCalledWith("project-access", undefined, expect.objectContaining({ method: "DELETE" }));
    });

    it("refuses a bad role, a missing address and an unknown action before any call", async () => {
        for (const words of [
            ["invite", "a@x.com", "--role", "owner"],
            ["invite", "a@x.com", "--role", "member"],
            ["invite"],
            ["kick", "a@x.com"],
            ["role", "ana@acme.test", "god"],
            ["remove", "--role", "admin", "ana@acme.test"],
            ["invites", "burn", "inv-9"]
        ]) {
            const { out, exited } = await run(...words);
            expect(exited, words.join(" ")).toBe(true);
            expect(["usage", "unknown_command"]).toContain(JSON.parse(out).error.code);
        }
        expect(invoke).not.toHaveBeenCalled();
    });

    it("answers not_served on a control plane without project access", async () => {
        served = false;
        for (const words of [["--json"], ["invite", "a@x.com"], ["invites"]]) {
            const { out, exited } = await run(...words);
            expect(exited, words.join(" ")).toBe(true);
            expect(JSON.parse(out).error.code).toBe("not_served");
        }
    });
});

describe("rebase cloud access invites", () => {
    it("lists the project's pending invitations with GET invites/project/<project>", async () => {
        const { out } = await run("invites", "--json");
        expect(invoke).toHaveBeenCalledWith("invites", undefined, { method: "GET", path: "project/proj-1" });
        expect(JSON.parse(out)).toEqual({ project: "proj-1", invites: [INVITE] });
    });

    it("revokes one by email with DELETE invites/<id>, after asking", async () => {
        const { out } = await run("invites", "revoke", "dev@x.com", "--yes", "--json");
        expect(invoke).toHaveBeenCalledWith("invites", undefined, { method: "DELETE", path: "inv-9" });
        expect(JSON.parse(out)).toMatchObject({ project: "proj-1", revoked: { id: "inv-9" } });
    });

    it("resends one by id with POST invites/<id>/resend, and prints the new link", async () => {
        const { out } = await run("invites", "resend", "inv-9", "--json");
        expect(invoke).toHaveBeenCalledWith("invites", {}, { path: "inv-9/resend" });
        expect(JSON.parse(out)).toMatchObject({ project: "proj-1", link: LINK });
    });

    it("refuses an invitation that is not pending", async () => {
        const { out, exited } = await run("invites", "revoke", "ghost@x.com", "--yes");
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("not_found");
    });
});

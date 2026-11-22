/**
 * Which organization an org-scoped command acts on, and `orgs members invite`
 * on the control plane Rebase Cloud runs today.
 *
 * Pinned: `--org`, then `rebase cloud use`, then the linked project's
 * organization — read off the project record, the link's own `orgId` only when
 * that cannot answer, and never from a link to another control plane or a
 * direct link — and a human-mode note saying the linked one was used. `orgs
 * members list` in a linked directory used to refuse with `no_org`.
 *
 * `members invite` asks the `invites` function first; where it is not served,
 * it adds a person who already has a verified account, as the console's "Add
 * member" does, and tells the inviter plainly when the person has none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireSessionClient: vi.fn(),
        getContextOrg: vi.fn(() => undefined),
        readLink: vi.fn(() => null)
    };
});

import * as context from "./context";
import { fakeCloudClient, type InvokeAnswer } from "../../../test/helpers/cloud-client";
import { orgsCommand } from "./orgs";
import { resolveOrgScope } from "./org-scope";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const CP = "https://cp.example";

let projectRow: Record<string, unknown> | undefined;
let members: Array<Record<string, unknown>>;
let created: Array<Record<string, unknown>>;
let answer: InvokeAnswer;
let invoke: ReturnType<typeof vi.fn<InvokeAnswer>>;
let stdout: string[];
let stderr: string[];

const notServed = () => Object.assign(new Error("No function named 'invites'."), { status: 404, code: "FUNCTION_NOT_FOUND" });

function client() {
    return fakeCloudClient({
        invoke,
        collection: (slug) => {
            if (slug === "projects") return { findById: () => projectRow };
            if (slug === "users") return { find: () => ({ data: [{ id: "u-owner", email: "owner@acme.test" }] }) };
            return {
                find: () => ({ data: members }),
                create: (data) => {
                    created.push(data);
                    return { id: "m-new", ...data };
                }
            };
        }
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    projectRow = { id: "proj_1", organization: "org-of-project" };
    members = [{ id: "m-1", userId: "u-owner", role: "owner" }];
    created = [];
    answer = () => undefined;
    invoke = vi.fn<InvokeAnswer>((name, body, opts) => answer(name, body, opts));
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
        stdout.push(String(chunk));
        return true;
    }) as typeof process.stdout.write);
    const capture = (...args: unknown[]) => { stderr.push(args.map(String).join(" ")); };
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Exited(Number(code ?? 0));
    });
    vi.mocked(context.getContextOrg).mockReturnValue(undefined);
    vi.mocked(context.readLink).mockReturnValue({ url: CP, projectId: "proj_1", slug: "trips", orgId: "org-in-link" });
    vi.mocked(context.requireClient).mockImplementation(async () => ({ client: client(), url: CP }));
    vi.mocked(context.requireSessionClient).mockImplementation(async () => ({ client: client(), url: CP }));
    context.setJsonModeForTest(true);
});

afterEach(() => {
    context.setJsonModeForTest(false);
    vi.restoreAllMocks();
});

const argv = (...words: string[]) => ["node", "rebase", "cloud", "orgs", ...words];
const out = () => JSON.parse(stdout.join(""));

describe("resolveOrgScope", () => {
    it("takes --org first, then the active organization, then the linked project's", async () => {
        const c = client();
        expect(await resolveOrgScope(c, CP, "org-flag")).toEqual({ org: "org-flag", source: "flag" });

        vi.mocked(context.getContextOrg).mockReturnValue("org-active");
        expect(await resolveOrgScope(c, CP, undefined)).toEqual({ org: "org-active", source: "active" });

        vi.mocked(context.getContextOrg).mockReturnValue(undefined);
        expect(await resolveOrgScope(c, CP, undefined)).toEqual({ org: "org-of-project", source: "linked_project", project: "trips" });
    });

    it("reads the project record, since a project can move; the link's orgId only when the record cannot say", async () => {
        projectRow = { id: "proj_1" };
        expect(await resolveOrgScope(client(), CP, undefined)).toMatchObject({ org: "org-in-link", source: "linked_project" });
    });

    it("ignores a link to another control plane, and a direct link to a backend", async () => {
        vi.mocked(context.readLink).mockReturnValue({ url: "https://other-cp.example", projectId: "proj_1", orgId: "org-in-link" });
        expect(await resolveOrgScope(client(), CP, undefined)).toBeUndefined();

        vi.mocked(context.readLink).mockReturnValue({ url: "https://api.shop.example", projectId: "", mode: "direct", apiUrl: "https://api.shop.example" });
        expect(await resolveOrgScope(client(), CP, undefined)).toBeUndefined();
    });

    it("treats a trailing slash as the same control plane", async () => {
        vi.mocked(context.readLink).mockReturnValue({ url: `${CP}/`, projectId: "proj_1" });
        expect(await resolveOrgScope(client(), CP, undefined)).toMatchObject({ org: "org-of-project" });
    });
});

describe("orgs members list with no --org and no `cloud use`", () => {
    it("lists the linked project's organization", async () => {
        await orgsCommand("members", argv("members"));

        expect(out()).toMatchObject({ org: "org-of-project", members: [{ userId: "u-owner", email: "owner@acme.test", role: "owner" }] });
    });

    it("says which organization it used, in words", async () => {
        context.setJsonModeForTest(false);

        await orgsCommand("members", argv("members"));

        expect(stderr.join("\n")).toContain("Using org org-of-project, the organization of the linked project trips.");
    });

    it("refuses with no_org outside a linked directory, naming all three ways to say one", async () => {
        vi.mocked(context.readLink).mockReturnValue(null);

        await expect(orgsCommand("members", argv("members"))).rejects.toBeInstanceOf(Exited);

        const error = out().error;
        expect(error.code).toBe("no_org");
        expect(error.hint).toContain("--org <id>");
        expect(error.hint).toContain("rebase cloud use");
        expect(error.hint).toContain("rebase cloud link");
    });

    it("never deletes an organization it inferred from the link", async () => {
        await expect(orgsCommand("delete", argv("delete", "--yes"))).rejects.toBeInstanceOf(Exited);

        expect(out().error.code).toBe("no_org");
    });
});

describe("orgs members invite on a control plane without invitations", () => {
    it("adds a person who has a verified account, as the console does", async () => {
        answer = (name) => {
            if (name === "invites") throw notServed();
            if (name === "invite-by-email") return { found: true, uid: "u-new" };
            return undefined;
        };

        await orgsCommand("members", argv("members", "invite", "New@Example.com", "--role", "admin", "--org", "org-1"));

        expect(invoke.mock.calls.map(([name, body]) => [name, body])).toEqual([
            ["invites", { organizationId: "org-1", email: "new@example.com", role: "admin" }],
            ["invite-by-email", { email: "new@example.com", organizationId: "org-1" }]
        ]);
        expect(created).toEqual([{ organizationId: "org-1", userId: "u-new", role: "admin" }]);
        expect(out()).toEqual({ org: "org-1", kind: "added", userId: "u-new", role: "admin", email: "new@example.com" });
    });

    it("says plainly that someone with no account must sign up first, and adds nobody", async () => {
        answer = (name) => {
            if (name === "invites") throw notServed();
            if (name === "invite-by-email") return { found: false };
            return undefined;
        };

        await expect(orgsCommand("members", argv("members", "invite", "nobody@example.com"))).rejects.toBeInstanceOf(Exited);

        expect(created).toEqual([]);
        const error = out().error;
        expect(error.code).toBe("no_account");
        expect(error.message).toContain("nobody@example.com has no Rebase account with a verified email address");
        expect(error.hint).toContain(`sign up at ${CP}/login`);
    });

    it("reports someone who is already a member without writing", async () => {
        members = [{ id: "m-1", userId: "u-owner", role: "owner" }, { id: "m-2", userId: "u-new", role: "member" }];
        answer = (name) => {
            if (name === "invites") throw notServed();
            if (name === "invite-by-email") return { found: true, uid: "u-new" };
            return undefined;
        };

        await orgsCommand("members", argv("members", "invite", "new@example.com"));

        expect(created).toEqual([]);
        expect(out()).toMatchObject({ kind: "already_member", userId: "u-new", role: "member" });
    });

    it("relays the control plane's refusal for a member who is not an owner or admin", async () => {
        answer = (name) => {
            if (name === "invites") throw notServed();
            throw Object.assign(new Error("You must be an organization owner or admin to invite members"), { status: 403, code: "forbidden" });
        };

        await expect(orgsCommand("members", argv("members", "invite", "new@example.com"))).rejects.toBeInstanceOf(Exited);

        expect(created).toEqual([]);
        expect(out().error.message).toContain("owner or admin");
    });

    it("keeps the invitation when the control plane serves one", async () => {
        answer = (name) => name === "invites"
            ? { kind: "invited", invite: { id: "inv-1", email: "new@example.com", role: "member", invitedBy: { userId: null, email: null }, expiresAt: "2026-12-01T00:00:00Z", expired: false, createdAt: null }, link: "https://cp.example/invite/x", emailDelivery: { sent: true } }
            : undefined;

        await orgsCommand("members", argv("members", "invite", "new@example.com"));

        expect(invoke.mock.calls.map(([name]) => name)).toEqual(["invites"]);
        expect(out()).toMatchObject({ kind: "invited", link: "https://cp.example/invite/x" });
    });
});

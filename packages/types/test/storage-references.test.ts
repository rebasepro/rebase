import {
    isStorageReference,
    parseStorageReference,
    resolveStorageReferences,
    storageReference,
    storageReferencesForDownloadUrls,
    storageTargetOfDownloadUrl,
    storageTargetsInText,
    STORAGE_REFERENCE_SCHEME
} from "../src/controllers/storage-references";

/**
 * A stored object named inside text — a markdown body above all.
 *
 * The markdown editor used to write the object's download URL into the text,
 * and a private object's URL carries a token that expires in minutes. Every
 * reader after that — the panel's own preview, a published site — got a 401
 * for an image that was still in the bucket. The text now names the object,
 * and whoever renders it asks for a URL then.
 */
describe("storage references", () => {
    it.each([
        "posts/cover.png",
        "posts/My Photo (1).png",
        "posts/100% done #2.png",
        "posts/it's*here!.png",
        "posts/caffè/über.png",
        "public/posts/a.png"
    ])("round-trips %s", (key) => {
        const reference = storageReference(key);
        expect(reference.startsWith(STORAGE_REFERENCE_SCHEME)).toBe(true);
        expect(parseStorageReference(reference)).toEqual({ key });
    });

    it("carries a named source, and only a named one", () => {
        expect(parseStorageReference(storageReference("a.png", "media"))).toEqual({ key: "a.png", storageId: "media" });
        expect(storageReference("a.png", "(default)")).toBe(storageReference("a.png"));
    });

    it("is something a markdown destination keeps whole: no space, parenthesis or quote", () => {
        const reference = storageReference("posts/My Photo (1) 'final'.png", "media");
        expect(reference).not.toMatch(/[\s()'"<>]/);
    });

    it("is not confused with a URL or a key", () => {
        expect(isStorageReference("https://example.com/a.png")).toBe(false);
        expect(isStorageReference("posts/a.png")).toBe(false);
        expect(parseStorageReference("https://example.com/a.png")).toBeNull();
        expect(parseStorageReference(`${STORAGE_REFERENCE_SCHEME}`)).toBeNull();
    });

    it("refuses a reference that would climb out of its prefix", () => {
        expect(parseStorageReference(`${STORAGE_REFERENCE_SCHEME}posts/../secret.png`)).toBeNull();
    });
});

describe("resolveStorageReferences", () => {
    const markdown = [
        "# A post",
        "",
        `![cover](${storageReference("posts/cover.png")})`,
        "",
        `Again: ![cover](${storageReference("posts/cover.png")} "Cover")`,
        "",
        `![clip](${storageReference("posts/clip.png", "media")})`,
        "",
        "![external](https://cdn.example.com/x.png)"
    ].join("\n");

    it("swaps each reference for the URL the resolver gives, asking once per object", async () => {
        const asked: string[] = [];
        const resolved = await resolveStorageReferences(markdown, async ({ key, storageId }) => {
            asked.push(`${storageId ?? "(default)"}:${key}`);
            return `https://api.example.com/api/storage/file/${key}?token=fresh-${asked.length}`;
        });

        expect(asked.sort()).toEqual(["(default):posts/cover.png", "media:posts/clip.png"]);
        expect(resolved).not.toContain(STORAGE_REFERENCE_SCHEME);
        expect(resolved).toContain("![external](https://cdn.example.com/x.png)");
        expect(resolved.match(/posts\/cover\.png\?token=fresh-\d/g)).toHaveLength(2);
        expect(resolved).toContain(` "Cover")`);
    });

    it("writes the URL as one link destination, whatever characters it carries", async () => {
        const resolved = await resolveStorageReferences(
            `![a](${storageReference("posts/My Photo (1).png")} "t")`,
            async ({ key }) => `https://x/${key}?token=abc`
        );
        expect(resolved).toBe(`![a](https://x/posts/My%20Photo%20%281%29.png?token=abc "t")`);
    });

    it("leaves a reference it cannot resolve as it was", async () => {
        const resolved = await resolveStorageReferences(markdown, async ({ key }) =>
            key === "posts/clip.png" ? null : `https://x/${key}`);
        expect(resolved).toContain(storageReference("posts/clip.png", "media"));
        expect(resolved).toContain("https://x/posts/cover.png");
    });

    it("leaves text with no reference untouched, without asking", async () => {
        let asked = 0;
        const text = "plain ![a](https://x/a.png)";
        expect(await resolveStorageReferences(text, async () => { asked++; return "y"; })).toBe(text);
        expect(asked).toBe(0);
    });
});

describe("resolveStorageReferences against a client", () => {
    /** A storage source that mints a new token per call, as the server does. */
    const source = (name: string) => {
        let minted = 0;
        return {
            calls: [] as string[],
            async getSignedUrl(key: string) {
                this.calls.push(key);
                if (key.endsWith("missing.png")) return { url: null, fileNotFound: true };
                return { url: `https://api.example.com/${name}/${key}?token=t${++minted}` };
            }
        };
    };

    it("asks the default source, and a named source by its key", async () => {
        const defaultSource = source("default");
        const media = source("media");
        const created: string[] = [];
        const client = {
            storage: defaultSource as never,
            createStorageSource: (id: string) => { created.push(id); return media as never; }
        };
        const text = `![a](${storageReference("a.png")}) ![b](${storageReference("b.png", "media")}) ![c](${storageReference("c.png", "media")})`;

        const resolved = await resolveStorageReferences(text, client);

        expect(resolved).toBe("![a](https://api.example.com/default/a.png?token=t1) " +
            "![b](https://api.example.com/media/b.png?token=t1) ![c](https://api.example.com/media/c.png?token=t2)");
        // One source per named key, not one per reference.
        expect(created).toEqual(["media"]);
    });

    it("renders a fresh URL every time, while the stored text never changes", async () => {
        const client = { storage: source("default") as never };
        const stored = `![a](${storageReference("a.png")})`;

        const first = await resolveStorageReferences(stored, client);
        const later = await resolveStorageReferences(stored, client);

        expect(first).not.toBe(later);
        expect(stored).not.toContain("token=");
    });

    it("leaves a missing object's reference, and one for a source the client cannot reach", async () => {
        const client = { storage: source("default") as never };
        const text = `![m](${storageReference("missing.png")}) ![n](${storageReference("n.png", "media")})`;
        expect(await resolveStorageReferences(text, client)).toBe(text);
    });
});

/**
 * Text saved before references existed holds the download URL itself, its
 * token long expired. The token says which object it was for, so a reader can
 * still find the object and give it a fresh URL.
 */
describe("download URLs saved in text before references", () => {
    const base64url = (value: string) => Buffer.from(value, "utf-8").toString("base64")
        .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    /** A token shaped as the server mints one: only the payload is read. */
    const token = (payload: Record<string, unknown>) =>
        `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify({ exp: 1, ...payload }))}.c2lnbmF0dXJl`;
    const legacy = (key: string, payload: Record<string, unknown> = { purpose: "file-read", path: `default/${key}`, storageId: "(default)" }, query = "") =>
        `https://api.example.com/api/storage/file/${key.split("/").map(encodeURIComponent).join("/")}?token=${token(payload)}${query}`;

    it("names the object its token was minted for", () => {
        expect(storageTargetOfDownloadUrl(legacy("posts/cover.png"))).toEqual({ key: "posts/cover.png" });
        expect(storageTargetOfDownloadUrl(legacy("posts/My Photo (1).png"))).toEqual({ key: "posts/My Photo (1).png" });
        expect(storageTargetOfDownloadUrl(legacy("caffè.png"))).toEqual({ key: "caffè.png" });
    });

    it("keeps a named source, from the URL or from the token", () => {
        expect(storageTargetOfDownloadUrl(legacy("a.png", { purpose: "file-read", path: "default/a.png", storageId: "media" }, "&storageId=media")))
            .toEqual({ key: "a.png", storageId: "media" });
        expect(storageTargetOfDownloadUrl(legacy("a.png", { purpose: "file-read", path: "default/a.png", storageId: "media" })))
            .toEqual({ key: "a.png", storageId: "media" });
        // Minted before tokens named their source: the default one.
        expect(storageTargetOfDownloadUrl(legacy("a.png", { purpose: "file-read", path: "default/a.png" })))
            .toEqual({ key: "a.png" });
    });

    it("is not fooled by a URL that only looks like one", () => {
        expect(storageTargetOfDownloadUrl("https://cdn.example.com/storage/file/a.png?token=abc")).toBeNull();
        expect(storageTargetOfDownloadUrl(legacy("a.png", { purpose: "access", path: "default/a.png" }))).toBeNull();
        expect(storageTargetOfDownloadUrl(legacy("a.png", { purpose: "file-read", path: "default/b.png" }))).toBeNull();
        expect(storageTargetOfDownloadUrl("https://api.example.com/api/storage/file/public/a.png")).toBeNull();
        expect(storageTargetOfDownloadUrl("not a url")).toBeNull();
    });

    it("are rendered with a fresh URL, as references are", async () => {
        const text = `![a](${legacy("posts/cover.png")}) ![b](${storageReference("b.png")}) ![c](https://cdn.example.com/c.png?token=x.y.z)`;
        const asked: string[] = [];
        const resolved = await resolveStorageReferences(text, async ({ key, storageId }) => {
            asked.push(`${storageId ?? "(default)"}:${key}`);
            return `https://api.example.com/fresh/${key}`;
        });
        expect(asked.sort()).toEqual(["(default):b.png", "(default):posts/cover.png"]);
        expect(resolved).toBe("![a](https://api.example.com/fresh/posts/cover.png) ![b](https://api.example.com/fresh/b.png) " +
            "![c](https://cdn.example.com/c.png?token=x.y.z)");
    });

    it("keep the old URL when the object cannot be found", async () => {
        const text = `![a](${legacy("gone.png")})`;
        expect(await resolveStorageReferences(text, async () => null)).toBe(text);
    });

    it("can be rewritten into references for good", () => {
        const text = `![a](${legacy("posts/cover.png")} "Cover") and ![b](https://cdn.example.com/b.png)`;
        expect(storageReferencesForDownloadUrls(text))
            .toBe(`![a](${storageReference("posts/cover.png")} "Cover") and ![b](https://cdn.example.com/b.png)`);
    });

    it("are listed with the references, for whoever needs to know which files a text uses", () => {
        const text = `![a](${legacy("posts/old.png")}) ![b](${storageReference("b.png", "media")}) ![c](https://cdn.example.com/c.png)`;
        expect(storageTargetsInText(text)).toEqual([{ key: "b.png", storageId: "media" }, { key: "posts/old.png" }]);
        expect(storageTargetsInText("no files here")).toEqual([]);
    });
});

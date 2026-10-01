import {
    isStorageReference,
    parseStorageReference,
    resolveStorageReferences,
    storageReference,
    STORAGE_REFERENCE_SCHEME
} from "../src/controllers/storage";

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

/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { render, waitFor } from "@testing-library/react";
import { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { schema } from "../../src/editor/schema";
import { createImageSrcResolverPlugin } from "../../src/editor/extensions/Image";
import { ImageComponent } from "../../src/editor/nodeViews/ImageComponent";

/**
 * The editor shows an image the text names by reference.
 *
 * Uploaded images are stored as `rebase-storage:` references, which a browser
 * cannot load; the image node asks the editor's resolver for a URL each time
 * it is shown.
 */
describe("the editor's image node", () => {
    const view = (resolve?: (src: string) => Promise<string | null | undefined>) => {
        const state = EditorState.create({
            schema,
            plugins: resolve ? [createImageSrcResolverPlugin(resolve)] : []
        });
        return { state } as unknown as EditorView;
    };

    const image = (src: string) => schema.nodes.image.create({ src, alt: "cover" });

    it("shows a reference through the resolver", async () => {
        const asked: string[] = [];
        const { container } = render(<ImageComponent
            node={image("rebase-storage:posts/cover.png")}
            view={view(async (src) => { asked.push(src); return "https://api.example.com/api/storage/file/posts/cover.png?token=t1"; })}
            getPos={() => 0}/>);

        await waitFor(() => expect(container.querySelector("img")?.getAttribute("src"))
            .toBe("https://api.example.com/api/storage/file/posts/cover.png?token=t1"));
        expect(asked).toEqual(["rebase-storage:posts/cover.png"]);
    });

    it("never hands the browser the reference itself", async () => {
        const { container } = render(<ImageComponent
            node={image("rebase-storage:posts/cover.png")}
            view={view()}
            getPos={() => 0}/>);

        await new Promise(resolve => setTimeout(resolve, 10));
        expect(container.querySelector("img")?.getAttribute("src") ?? "").not.toContain("rebase-storage:");
    });

    it("shows an ordinary URL as it is", () => {
        const { container } = render(<ImageComponent
            node={image("https://cdn.example.com/x.png")}
            view={view(async () => "https://wrong.example.com")}
            getPos={() => 0}/>);

        expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example.com/x.png");
    });

    it("renews an image whose URL was saved before references, showing the saved one meanwhile", async () => {
        const base64url = (value: string) => Buffer.from(value, "utf-8").toString("base64")
            .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
        const payload = base64url(JSON.stringify({ purpose: "file-read", path: "default/posts/old.png", exp: 1 }));
        const saved = `https://api.example.com/api/storage/file/posts/old.png?token=${base64url("{}")}.${payload}.c2ln`;
        const asked: string[] = [];
        const { container } = render(<ImageComponent
            node={image(saved)}
            view={view(async (src) => { asked.push(src); return "https://api.example.com/api/storage/file/posts/old.png?token=fresh"; })}
            getPos={() => 0}/>);

        expect(container.querySelector("img")?.getAttribute("src")).toBe(saved);
        await waitFor(() => expect(container.querySelector("img")?.getAttribute("src"))
            .toBe("https://api.example.com/api/storage/file/posts/old.png?token=fresh"));
        expect(asked).toEqual([saved]);
    });
});

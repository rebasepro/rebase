/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render, waitFor } from "@testing-library/react";
import { isStorageReference, parseStorageReference } from "@rebasepro/types";

/**
 * An image put into a markdown body is stored as a reference, not a URL.
 *
 * The editor used to upload the image and write `getSignedUrl(key).url` into
 * the text. A private object's URL carries a download token that expires in
 * five minutes, so the saved post — in the panel's own preview and on every
 * site that published it — showed a broken image from then on, for a file
 * that was still in the bucket.
 */

type EditorProps = {
    handleImageUpload: (file: File) => Promise<string>;
    resolveImageSrc?: (src: string) => Promise<string | null | undefined>;
};
let editorProps: EditorProps | undefined;

jest.mock("../../src/editor", () => ({
    RichTextEditor: (props: EditorProps) => {
        editorProps = props;
        return null;
    }
}));

const putObject = jest.fn(async ({ key }: { key: string }) => ({ key, bucket: "default", storageUrl: `local://default/${key}` }));
let minted = 0;
const getSignedUrl = jest.fn(async (key: string) => ({ url: `https://api.example.com/api/storage/file/${key}?token=t${++minted}` }));
const mediaGetSignedUrl = jest.fn(async (key: string) => ({ url: `https://api.example.com/api/storage/file/${key}?storageId=media&token=m` }));

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useAuthController: () => ({ user: { uid: "u1" } }),
        useStorageSource: () => ({ putObject, getSignedUrl }),
        useStorageSources: () => ({ registry: {}, sources: { media: { putObject, getSignedUrl: mediaGetSignedUrl } } })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { MarkdownEditorFieldBinding } from "../../src/form/field_bindings/MarkdownEditorFieldBinding";

async function mount(storage?: Record<string, unknown>) {
    editorProps = undefined;
    render(<MarkdownEditorFieldBinding
        property={{ type: "string", admin: { markdown: true }, storage: { storagePath: "posts", ...storage } } as never}
        propertyKey="body"
        value={""}
        setValue={() => undefined}
        setFieldValue={() => undefined}
        context={{ values: {}, entityId: "1", path: "posts", formex: { version: 0 } } as never}
        includeDescription={false}
        showError={false}
        isSubmitting={false}
        disabled={false}
        minimalistView={true}
        hideLabel={true}
        partOfArray={false}
        autoFocus={false}
        underlyingValueHasChanged={false}/>);
    await waitFor(() => expect(editorProps).toBeDefined());
}

describe("an image uploaded into a markdown field", () => {
    beforeEach(() => {
        putObject.mockClear();
        getSignedUrl.mockClear();
        mediaGetSignedUrl.mockClear();
    });

    it("goes into the text as a storage reference, with no token and no URL", async () => {
        await mount();

        let src = "";
        await act(async () => {
            src = await editorProps!.handleImageUpload(new File(["png"], "cover image.png", { type: "image/png" }));
        });

        expect(isStorageReference(src)).toBe(true);
        expect(src).not.toContain("token=");
        expect(src).not.toContain("http");
        const uploadedKey = putObject.mock.calls[0][0].key;
        expect(parseStorageReference(src)).toEqual({ key: uploadedKey });
        // Nothing to sign at upload time: the URL belongs to whoever renders it.
        expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it("names the property's storage source in the reference", async () => {
        await mount({ storageSource: "media" });

        let src = "";
        await act(async () => {
            src = await editorProps!.handleImageUpload(new File(["png"], "a.png", { type: "image/png" }));
        });

        expect(parseStorageReference(src)?.storageId).toBe("media");
    });

    it("hands the editor a resolver that signs a fresh URL for a reference, on the right source", async () => {
        await mount();

        let first: string | null | undefined;
        let second: string | null | undefined;
        let media: string | null | undefined;
        await act(async () => {
            first = await editorProps!.resolveImageSrc!("rebase-storage:posts/a.png");
            second = await editorProps!.resolveImageSrc!("rebase-storage:posts/a.png");
            media = await editorProps!.resolveImageSrc!("rebase-storage:posts/b.png?storageId=media");
        });

        expect(first).toContain("token=t");
        expect(second).not.toBe(first);
        expect(getSignedUrl).toHaveBeenCalledWith("posts/a.png");
        expect(media).toContain("storageId=media");
        expect(mediaGetSignedUrl).toHaveBeenCalledWith("posts/b.png");
    });

    it("leaves an ordinary URL alone", async () => {
        await mount();
        let src: string | null | undefined;
        await act(async () => {
            src = await editorProps!.resolveImageSrc!("https://cdn.example.com/x.png");
        });
        expect(src).toBe("https://cdn.example.com/x.png");
        expect(getSignedUrl).not.toHaveBeenCalled();
    });
});

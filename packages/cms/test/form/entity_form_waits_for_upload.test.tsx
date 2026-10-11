/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { Entity, StorageSource } from "@rebasepro/types";
import type { EntityCustomViewParams, FormContext } from "@rebasepro/cms-types";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useSnackbarController: () => ({ open: () => undefined }),
        useStorageSource: () => ({})
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { EntityForm } from "../../src/form/EntityForm";
import { StorageUploadProgress } from "../../src/form/components/StorageUploadProgress";

/**
 * Save waits for a file upload in progress.
 *
 * A file field writes its value only when the upload ends. Save pressed while
 * an image was still uploading wrote the record without it, and the file landed
 * afterwards with nothing pointing at it.
 */

type Post = Record<string, unknown>;
const collection = {
    slug: "posts",
    name: "Posts",
    properties: {
        title: { type: "string", name: "Title" },
        image: { type: "string", name: "Image", storage: { storagePath: "images" } }
    }
} as never;

let finishUpload: () => void = () => undefined;
const storageSource = {
    putObject: () => new Promise((resolve) => {
        finishUpload = () => resolve({ key: "images/cat.png", storageUrl: "https://x/images/cat.png" });
    })
} as unknown as StorageSource;

let context: FormContext<Post>;
function UploadingField({ formContext }: EntityCustomViewParams<Post>) {
    context = formContext;
    const [entry] = React.useState(() => ({ id: 1, file: new File(["x"], "cat.png"), fileName: "cat.png", size: "medium" as const }));
    return <StorageUploadProgress
        storagePath="images"
        entry={entry}
        storageSource={storageSource}
        imageSize={10}
        simple={true}
        onFileUploadComplete={async (value) => {
            formContext.setFieldValue("image", value);
        }}/>;
}

describe("EntityForm: Save and an upload in progress", () => {
    it("waits for the upload and saves its path", async () => {
        const payloads: Post[] = [];
        render(<EntityForm<Post>
            path="posts"
            collection={collection}
            initialStatus="new"
            Builder={UploadingField}
            onSubmit={async (values: Post) => {
                payloads.push(values);
                return { id: "1", path: "posts", values } as Entity<Post>;
            }}/>);

        await act(async () => {
            context.setFieldValue("title", "Cat");
        });
        let submitted: Promise<void> | undefined;
        await act(async () => {
            submitted = Promise.resolve(context.submit());
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(payloads).toHaveLength(0);

        await act(async () => {
            finishUpload();
            await submitted;
        });
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({ title: "Cat", image: "images/cat.png" });
    });
});

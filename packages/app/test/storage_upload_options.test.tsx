import React from "react";
import { render } from "@testing-library/react";
import type { StorageSource, StringProperty, UploadFileProps } from "@rebasepro/types";
import { useStorageUploadController } from "../src/util/useStorageUploadController";

/**
 * A field's uploads carry what the property declares. `storage.public` was
 * read by nothing in the panel, so a `public: true` field stored private files
 * behind expiring URLs, and no upload said which property it was for, so the
 * server could not hold it to the property's own `maxSize`/`acceptedFiles`.
 */

jest.mock("../src/hooks", () => ({
    ...jest.requireActual("../src/hooks"),
    useAuthController: () => ({ user: null })
}));

function sourceRecording(calls: UploadFileProps[]): StorageSource {
    return {
        putObject: async (props) => {
            calls.push(props);
            return { key: props.key, storageUrl: props.key };
        },
        getSignedUrl: async () => ({ url: null }),
        getObject: async () => null,
        deleteObject: async () => undefined,
        listObjects: async () => ({ items: [], prefixes: [] })
    };
}

function uploadThrough(property: StringProperty, collectionSlug?: string): Promise<UploadFileProps[]> {
    const calls: UploadFileProps[] = [];
    const source = sourceRecording(calls);
    let upload: ((props: UploadFileProps) => Promise<unknown>) | undefined;
    function Probe() {
        const { resolvedStorageSource } = useStorageUploadController({
            entityValues: {},
            value: null,
            propertyKey: "avatar",
            property,
            storageSource: source,
            collectionSlug,
            disabled: false,
            onChange: () => undefined
        });
        upload = resolvedStorageSource.putObject;
        return null;
    }
    render(<Probe/>);
    return upload!({ file: new File(["x"], "a.png", { type: "image/png" }), key: "avatars/a.png" }).then(() => calls);
}

describe("useStorageUploadController — what an upload carries", () => {
    it("stores a public property's files as public", async () => {
        const [call] = await uploadThrough({ type: "string", storage: { storagePath: "avatars", public: true } });

        expect(call.public).toBe(true);
    });

    it("names the property the file is for", async () => {
        const [call] = await uploadThrough({ type: "string", storage: { storagePath: "avatars" } }, "users");

        expect(call.context).toEqual({ collection: "users", property: "avatar" });
        expect(call.public).toBeUndefined();
    });
});

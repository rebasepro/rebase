import { resolveStoragePathString, resolveStorageFilenameString, resolveStorageSource } from "../src/util/storage";
import { StorageConfig, StringProperty, StorageSource, UploadedFileContext } from "@rebasepro/types";
import { resetDeprecationWarningsForTests } from "../src/util/deprecation";

// Minimal File mock for Node environment
class MockFile {
    name: string;
    type: string;
    size: number;
    constructor(name: string, type = "image/jpeg", size = 1024) {
        this.name = name;
        this.type = type;
        this.size = size;
    }
}

// Helpers
function makeParams(overrides: Partial<{
    input: string | ((context: UploadedFileContext) => string);
    entityId: string;
    path: string;
    fileName: string;
    propertyKey: string;
}> = {}) {
    const file = new MockFile(overrides.fileName ?? "photo.jpg") as unknown as File;
    const storage: StorageConfig = {
        storagePath: "/uploads",
        acceptedFiles: ["image/*"]
    };
    const property: StringProperty = {
        type: "string",
        name: "Image",
        storage
    };
    return {
        input: overrides.input ?? "{path}/{entityId}/{file}",
        storage,
        values: {},
        entityId: overrides.entityId ?? "entity-123",
        path: overrides.path ?? "products",
        property,
        file,
        propertyKey: overrides.propertyKey ?? "thumbnail"
    };
}

describe("Storage Path Resolution", () => {

    describe("resolveStoragePathString", () => {
        it("replaces {entityId} placeholder", () => {
            const params = makeParams({ input: "uploads/{entityId}/images" });
            const result = resolveStoragePathString(params);
            expect(result).toBe("uploads/entity-123/images");
        });

        it("replaces {id}, the record's id, as {entityId} is", () => {
            expect(resolveStoragePathString(makeParams({ input: "uploads/{id}/images" }))).toBe("uploads/entity-123/images");
        });

        it("hands a function the record's id as `id`", () => {
            const input = jest.fn((context: UploadedFileContext) => `uploads/${String(context.id)}`);
            expect(resolveStoragePathString(makeParams({ input: input }))).toBe("uploads/entity-123");
            expect(Object.keys(input.mock.calls[0][0])).not.toContain("entityId");
        });

        // Released as `entityId` (0.28): a JS config that still reads it gets the
        // id — not `.../undefined/...` — and one warning naming `id`.
        it("still hands a function the deprecated `entityId`, warning once when it is read", () => {
            resetDeprecationWarningsForTests();
            const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
            try {
                const quiet = jest.fn((context: UploadedFileContext) => `uploads/${String(context.id)}`);
                resolveStoragePathString(makeParams({ input: quiet }));
                expect(warn).not.toHaveBeenCalled();

                const legacy = (context: UploadedFileContext) => `uploads/${String(context.entityId)}`;
                expect(resolveStoragePathString(makeParams({ input: legacy }))).toBe("uploads/entity-123");
                expect(resolveStoragePathString(makeParams({ input: legacy }))).toBe("uploads/entity-123");
                expect(warn).toHaveBeenCalledTimes(1);
                expect(String(warn.mock.calls[0][0])).toContain("`id`");
            } finally {
                warn.mockRestore();
            }
        });

        it("replaces {path} placeholder", () => {
            const params = makeParams({ input: "{path}/media" });
            const result = resolveStoragePathString(params);
            expect(result).toBe("products/media");
        });

        it("replaces {rand} placeholder with random string", () => {
            const params = makeParams({ input: "uploads/{rand}" });
            const result = resolveStoragePathString(params);
            expect(result).not.toContain("{rand}");
            expect(result.startsWith("uploads/")).toBe(true);
        });

        it("replaces {file} placeholder", () => {
            const params = makeParams({ input: "files/{file}",
fileName: "document.pdf" });
            const result = resolveStoragePathString(params);
            expect(result).toBe("files/document.pdf");
        });

        it("replaces {propertyKey}", () => {
            const params = makeParams({ input: "{propertyKey}/files",
propertyKey: "avatar" });
            const result = resolveStoragePathString(params);
            expect(result).toBe("avatar/files");
        });

        it("handles multiple placeholders", () => {
            const params = makeParams({ input: "{path}/{entityId}/files" });
            const result = resolveStoragePathString(params);
            expect(result).toBe("products/entity-123/files");
        });

        it("returns literal path when no placeholders", () => {
            const params = makeParams({ input: "static/uploads" });
            const result = resolveStoragePathString(params);
            expect(result).toBe("static/uploads");
        });

        it("calls function input when provided", () => {
            const params = {
                ...makeParams(),
                input: (() => "custom/path") as any
            };
            const result = resolveStoragePathString(params);
            expect(result).toBe("custom/path");
        });
    });

    describe("resolveStorageFilenameString", () => {
        it("replaces {file.name} and {file.ext}", async () => {
            const params = makeParams({ input: "{file.name}_thumb.{file.ext}",
fileName: "photo.jpg" });
            const result = await resolveStorageFilenameString(params);
            expect(result).toBe("photo_thumb.jpg");
        });

        it("replaces {rand} with unique string", async () => {
            const params = makeParams({ input: "{rand}.jpg" });
            const result = await resolveStorageFilenameString(params);
            expect(result).not.toContain("{rand}");
            expect(result.endsWith(".jpg")).toBe(true);
        });

        it("replaces {entityId}", async () => {
            const params = makeParams({ input: "{entityId}_{file}",
entityId: "e42",
fileName: "avatar.png" });
            const result = await resolveStorageFilenameString(params);
            expect(result).toBe("e42_avatar.png");
        });

        it("calls async function input when provided", async () => {
            const params = {
                ...makeParams(),
                input: (async () => "dynamic-name.jpg") as any
            };
            const result = await resolveStorageFilenameString(params);
            expect(result).toBe("dynamic-name.jpg");
        });

        it("generates random fallback when function returns empty", async () => {
            const params = {
                ...makeParams(),
                input: (() => "") as any
            };
            const result = await resolveStorageFilenameString(params);
            expect(result).toBeTruthy();
            expect(result.length).toBeGreaterThan(0);
        });

        it("still hands a fileName function the deprecated `entityId`, warning once", async () => {
            resetDeprecationWarningsForTests();
            const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
            try {
                const legacy = (context: UploadedFileContext) => `${String(context.entityId)}_${context.file.name}`;
                expect(await resolveStorageFilenameString(makeParams({ input: legacy }))).toBe("entity-123_photo.jpg");
                expect(await resolveStorageFilenameString(makeParams({ input: legacy }))).toBe("entity-123_photo.jpg");
                expect(warn).toHaveBeenCalledTimes(1);
                expect(String(warn.mock.calls[0][0])).toContain("`id`");
            } finally {
                warn.mockRestore();
            }
        });
    });
});

describe("resolveStorageSource", () => {
    const defaultSource = { id: "default" } as unknown as StorageSource;
    const mediaSource = { id: "media" } as unknown as StorageSource;
    const sources = { media: mediaSource };

    it("returns the default when no key is given", () => {
        expect(resolveStorageSource({ defaultSource })).toBe(defaultSource);
        expect(resolveStorageSource({ sourceKey: null, sources, defaultSource })).toBe(defaultSource);
    });

    it("resolves a key from the sources map", () => {
        expect(resolveStorageSource({ sourceKey: "media", sources, defaultSource })).toBe(mediaSource);
    });

    it("never answers the default source for a key that names another", async () => {
        // The panel learns its named sources from GET /storage/sources; one
        // failed fetch used to send a property's uploads to the default bucket.
        const unresolved = resolveStorageSource({ sourceKey: "media", sources: {}, defaultSource });

        expect(unresolved).not.toBe(defaultSource);
        await expect(unresolved.putObject({ file: new File(["x"], "x.txt"), key: "x.txt" }))
            .rejects.toThrow(/"media"/);
    });

    it("routes an unresolved key through the server when it can build a source", () => {
        const routed = { id: "routed" } as unknown as StorageSource;
        const asked: string[] = [];
        const createSource = (key: string) => {
            asked.push(key);
            return routed;
        };

        expect(resolveStorageSource({ sourceKey: "media", sources: {}, defaultSource, createSource })).toBe(routed);
        expect(asked).toEqual(["media"]);
    });

    it("does not take the default from a registry that lacks the key", () => {
        const registry = {
            get: () => undefined,
            getDefault: () => defaultSource,
            getOrDefault: () => defaultSource,
            has: () => false,
            list: () => ["(default)"]
        };

        expect(resolveStorageSource({ sourceKey: "media", sources: {}, registry, defaultSource })).not.toBe(defaultSource);
    });

    it("answers the default source for the default key", () => {
        expect(resolveStorageSource({ sourceKey: "(default)", sources: {}, defaultSource })).toBe(defaultSource);
    });

    it("prefers an explicit registry over the sources map", () => {
        const registrySource = { id: "registry" } as unknown as StorageSource;
        const registry = {
            get: () => undefined,
            getDefault: () => defaultSource,
            getOrDefault: () => registrySource,
            has: () => true,
            list: () => ["media"]
        };
        expect(resolveStorageSource({ sourceKey: "media", sources, registry, defaultSource })).toBe(registrySource);
    });
});

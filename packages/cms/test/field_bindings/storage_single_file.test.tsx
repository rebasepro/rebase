/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react";

/**
 * A field that holds one path asks for one file.
 *
 * `useDropzone` was never given `multiple`, and react-dropzone defaults it to
 * `true` — so a `type: "string"` property with a storage config offered a
 * picker that accepted several files, uploaded the first, and said nothing
 * about the rest. Measured on a scaffold: two files selected on an author's
 * picture, one thumbnail, one `POST /api/storage/upload → 201`, and the second
 * file neither uploaded nor mentioned.
 *
 * The controller already knows the answer — `multipleFilesSupported` is what
 * decides whether the value is a string or an array — it just was not being
 * asked.
 */

const actualApp = jest.requireActual("@rebasepro/app") as Record<string, unknown>;

/** `multipleFilesSupported` for the property under test, set per case. */
let multipleFilesSupported = false;

/**
 * Four hooks replaced, the other 190-odd exports left alone.
 *
 * A `{...requireActual(), override}` spread cannot do it here: `@rebasepro/app`
 * has circular internal imports, so when the factory runs — during the
 * component's own `require` — the real module's exports are only half
 * populated, and the spread copies the half. A proxy defers each lookup to the
 * moment it is read, by which time the module is whole.
 */
jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useAuthController: () => ({ user: null }),
        useSnackbarController: () => ({ open: jest.fn() }),
        useStorageSource: () => ({ uploadFile: jest.fn(), getDownloadURL: jest.fn() }),
        useStorageUploadController: () => ({
            internalValue: [],
            setInternalValue: jest.fn(),
            onFilesAdded: jest.fn(),
            storage: {},
            onFileUploadComplete: jest.fn(),
            storagePathBuilder: () => "x",
            multipleFilesSupported,
            resolvedStorageSource: { uploadFile: jest.fn(), getDownloadURL: jest.fn() }
        })
    };
    return new Proxy({}, {
        get: (_target, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { StorageUploadFieldBinding } from "../../src/form/field_bindings/StorageUploadFieldBinding";

const props = {
    propertyKey: "picture",
    value: null,
    setValue: () => undefined,
    error: undefined,
    showError: false,
    autoFocus: false,
    touched: false,
    includeDescription: false,
    isSubmitting: false,
    minimalistView: false,
    hideLabel: true,
    context: { values: {}, entityId: "e1", path: "authors", disabled: false } as never
};

function fileInput(property: unknown, multiple: boolean): HTMLInputElement {
    multipleFilesSupported = multiple;
    const { container } = render(
        <StorageUploadFieldBinding {...props} property={property as never}/>
    );
    const input = container.querySelector("input[type=file]");
    expect(input).toBeTruthy();
    return input as HTMLInputElement;
}

describe("a storage field's file picker", () => {

    it("takes one file for a single-value property", () => {
        expect(fileInput({
            dataType: "string",
            type: "string",
            name: "Picture",
            storage: { storagePath: "author_pictures" }
        }, false).multiple).toBe(false);
    });

    it("still takes several for an array property", () => {
        expect(fileInput({
            dataType: "array",
            type: "array",
            name: "Gallery",
            of: { dataType: "string", type: "string", storage: { storagePath: "gallery" } }
        }, true).multiple).toBe(true);
    });
});

// Guards the mock: if `@rebasepro/app` stops exporting the controller this
// file replaces, the replacement silently becomes a new export instead of an
// override, and both cases above would then exercise the real one.
it("overrides a hook that exists", () => {
    expect(typeof actualApp.useStorageUploadController).toBe("function");
});

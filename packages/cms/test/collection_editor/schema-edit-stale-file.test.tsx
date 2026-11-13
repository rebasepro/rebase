/**
 * @jest-environment jsdom
 */
/**
 * A file changed on disk since the edit was prepared offers Reload, keyed on
 * the server's own code (`SCHEMA_EDIT_STALE_FILE`). It was keyed on the
 * sentence the message happened to contain, under the general refusal code:
 * a reworded message would have lost the Reload, and any refusal quoting that
 * sentence would have offered it.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import { RebaseI18nProvider } from "@rebasepro/app";

import { SchemaEditRefusalView } from "../../src/collection_editor/ui/collection_editor/SchemaEditRefusalView";
import { SchemaEditRefused } from "../../src/collection_editor/useLocalCollectionsConfigController";

function renderRefusal(error: Error, onReload: () => void) {
    return render(
        <RebaseI18nProvider>
            <SchemaEditRefusalView error={error} onReload={onReload}/>
        </RebaseI18nProvider>
    );
}

describe("a stale schema file", () => {
    it("offers Reload for SCHEMA_EDIT_STALE_FILE, whatever the message says", () => {
        const onReload = jest.fn();
        renderRefusal(new SchemaEditRefused("backend/schema/posts.ts was saved meanwhile.", "SCHEMA_EDIT_STALE_FILE"), onReload);
        fireEvent.click(screen.getByRole("button"));
        expect(onReload).toHaveBeenCalledTimes(1);
    });

    it("does not offer it for another refusal that quotes the old sentence", () => {
        renderRefusal(new SchemaEditRefused("posts.ts changed since the edit was prepared, and is edited in code.", "SCHEMA_EDIT_REFUSED"), jest.fn());
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.getByText(/is edited in code/)).toBeTruthy();
    });
});

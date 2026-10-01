/**
 * The receipt after a DDL failure says how far the change got.
 *
 * The statements run one at a time with no transaction around them, so a
 * failure at statement k leaves 1…k-1 applied. The dialog said "The database
 * was not changed" whatever k was.
 */
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import { SchemaChangeDialog } from "../../src/collection_editor/ui/collection_editor/SchemaChangeDialog";
import type { LiveSchemaResult } from "../../src/collection_editor/liveSchemaClient";

const STATEMENTS = [
    'ALTER TABLE "public"."posts" ADD COLUMN IF NOT EXISTS "author_id" UUID;',
    'ALTER TABLE "public"."posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."authors" ("id")'
];

const failed = (appliedStatements: number | undefined): LiveSchemaResult => ({
    applied: false,
    applyError: "canceling statement due to statement timeout",
    appliedStatements,
    committed: { sha: "abc123def456", branch: "main", files: ["config/collections/posts.ts"] },
    statements: STATEMENTS,
    summary: "Committed abc123def on main.",
    withheldConstraints: []
});

const receipt = (result: LiveSchemaResult) => render(
    <SchemaChangeDialog
        open
        collectionId="posts"
        result={result}
        applying={false}
        onConfirm={() => undefined}
        onClose={() => undefined}
    />
);

describe("the receipt of a change whose DDL failed", () => {
    it("does not say the database was not changed when a statement had already run", () => {
        receipt(failed(1));
        expect(screen.queryByText("The database was not changed")).toBeNull();
        expect(screen.getByText(/1 of 2 statements ran/)).toBeTruthy();
    });

    it("says it was not changed when nothing ran", () => {
        receipt(failed(0));
        expect(screen.getByText("The database was not changed")).toBeTruthy();
    });

    it("says it does not know when the server could not say", () => {
        receipt(failed(undefined));
        expect(screen.queryByText("The database was not changed")).toBeNull();
        expect(screen.getByText(/may have been changed in part/)).toBeTruthy();
    });
});

describe("a plan that commits a change and runs nothing", () => {
    it("does not say there is no change to make when a security rule changes", () => {
        render(<SchemaChangeDialog
            open
            collectionId="posts"
            plan={{
                applicable: true,
                verdict: "safe",
                changes: [{ kind: "change-security-rules", verdict: "safe", collection: "posts", detail: "Who can read posts changes." }],
                statements: [],
                files: ["config/collections/posts.ts"],
                message: "feat(schema): change the security rules of posts",
                withheldConstraints: []
            }}
            applying={false}
            onConfirm={() => undefined}
            onClose={() => undefined}
        />);
        expect(screen.queryByText(/there is no schema change to make/)).toBeNull();
        expect(screen.getByText(/when it takes effect/)).toBeTruthy();
    });
});

/**
 * @jest-environment jsdom
 */
/**
 * The schema change dialog speaks the admin's language.
 *
 * Every word of it was an English literal: the title, the verdict, the chips,
 * the disclosures, the receipt and every button. A Spanish admin got a Spanish
 * collection editor that opened an English dialog for its most consequential
 * step. The server's own sentences (each change's detail, remedy and summary)
 * are data and stay as the server wrote them.
 */
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { RebaseI18nProvider } from "@rebasepro/app";

import { SchemaChangeDialog } from "../../src/collection_editor/ui/collection_editor/SchemaChangeDialog";
import type { LiveSchemaPlan, LiveSchemaResult } from "../../src/collection_editor/liveSchemaClient";

const refusedPlan: LiveSchemaPlan = {
    applicable: false,
    verdict: "needs-migration",
    changes: [{
        kind: "remove-property",
        verdict: "needs-migration",
        collection: "posts",
        property: "subtitle",
        detail: "Server detail: drop subtitle.",
        remedy: "Server remedy: write a migration.",
        sourceOnly: "Server source-only note: the column stays."
    }],
    statements: ["ALTER TABLE \"public\".\"posts\" DROP COLUMN \"subtitle\";"],
    files: ["config/collections/posts.ts"],
    message: "feat(schema): remove subtitle from posts",
    withheldConstraints: [
        { target: "posts.slug", kind: "not-null", reason: "Server reason one.", remedy: "Server fix one." },
        { target: "posts.title", kind: "not-null", reason: "Server reason two.", remedy: "Server fix two." }
    ],
    followUp: ["Server follow-up."]
};

const failedReceipt: LiveSchemaResult = {
    applied: false,
    applyError: "canceling statement due to statement timeout",
    appliedStatements: 1,
    committed: { sha: "abc123def456", branch: "main", files: ["config/collections/posts.ts"] },
    statements: ["ALTER TABLE a;", "ALTER TABLE b;"],
    summary: "Server summary.",
    withheldConstraints: []
};

function renderInSpanish(props: Partial<React.ComponentProps<typeof SchemaChangeDialog>>) {
    return render(
        <RebaseI18nProvider locale="es">
            <SchemaChangeDialog
                open
                collectionId="posts"
                applying={false}
                onConfirm={() => undefined}
                onClose={() => undefined}
                {...props}
            />
        </RebaseI18nProvider>
    );
}

describe("the schema change dialog, in Spanish", () => {
    it("reviews a refused change in Spanish, with the server's sentences as written", async () => {
        renderInSpanish({ plan: refusedPlan, onSourceOnly: () => undefined });

        expect(await screen.findByText("Revisar el cambio de esquema")).toBeTruthy();
        expect(screen.getByText("Esto necesita una migración")).toBeTruthy();
        expect(screen.getByText("requiere migración")).toBeTruthy();
        expect(screen.getByText("Editar solo el código fuente: hacer commit de la colección y dejar la base de datos")).toBeTruthy();
        expect(screen.getByText("2 restricciones no se aplicarán")).toBeTruthy();
        expect(screen.getByText("Una cosa que hacer después")).toBeTruthy();
        expect(screen.getByText("Sentencias que se ejecutarán (1)")).toBeTruthy();
        expect(screen.getByText("Archivos de los que se hará commit (1)")).toBeTruthy();
        expect(screen.getByText("Mensaje del commit (1)")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Editar solo el código fuente" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Hacer commit y aplicar" })).toBeTruthy();

        expect(screen.getByText("Server detail: drop subtitle.")).toBeTruthy();
        expect(screen.getByText("Server source-only note: the column stays.")).toBeTruthy();

        for (const english of [
            "Review schema change",
            "This needs a migration",
            "needs migration",
            "2 constraints will not be enforced",
            "One thing to do afterwards",
            "Statements that will run (1)",
            "Cancel",
            "Edit source only",
            "Commit and apply"
        ]) {
            expect(screen.queryByText(english)).toBeNull();
        }
    });

    it("says a plan that failed and a plan that is still coming in Spanish", async () => {
        const { unmount } = renderInSpanish({ planError: "Server: connection refused", onRetry: () => undefined });
        expect(await screen.findByText("No se pudo planificar el cambio")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
        expect(screen.queryByText("The change could not be planned")).toBeNull();
        unmount();

        renderInSpanish({});
        expect(await screen.findByText("Calculando qué haría este cambio…")).toBeTruthy();
    });

    it("says a commit-only plan in Spanish", async () => {
        renderInSpanish({
            plan: {
                applicable: true,
                verdict: "safe",
                changes: [],
                statements: [],
                files: ["config/collections/posts.ts"],
                message: "chore(schema): touch posts",
                withheldConstraints: []
            }
        });
        expect(await screen.findByText("Listo para hacer commit")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Hacer commit" })).toBeTruthy();
        expect(screen.queryByText("Ready to commit")).toBeNull();
    });

    it("writes the receipt of a partly applied change in Spanish", async () => {
        renderInSpanish({ result: failedReceipt });

        expect(await screen.findByText("Cambio de esquema aplicado")).toBeTruthy();
        expect(screen.getByText("Se ejecutaron 1 de 2 sentencias y luego una falló")).toBeTruthy();
        expect(screen.getByText(/El commit está en main de todos modos/)).toBeTruthy();
        expect(screen.getByText("Commit hecho")).toBeTruthy();
        expect(screen.getByText(/abc123def en main/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Cerrar" })).toBeTruthy();
        expect(screen.getByText("Server summary.")).toBeTruthy();

        expect(screen.queryByText("Schema change applied")).toBeNull();
        expect(screen.queryByText(/statements ran, then one failed/)).toBeNull();
        expect(screen.queryByText("Committed")).toBeNull();
    });
});

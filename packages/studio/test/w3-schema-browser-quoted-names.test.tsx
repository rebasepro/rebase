/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>
}));

import { SchemaBrowser } from "../src/components/SQLEditor/SchemaBrowser";
import { tableStatementTemplates } from "../src/utils/sql_utils";

/**
 * The statements the SQL console's schema browser writes into the editor.
 *
 * An unquoted name is folded to lower case, and a reserved word is not a name:
 * `SELECT * FROM user` answers with the current role, and `SELECT * FROM Posts`
 * reads a table `posts` that is not there.
 */
describe("the schema browser's statement templates", () => {
    const posts = {
        tableName: "Posts",
        columns: [
            { name: "id", dataType: "integer", isPrimaryKey: true },
            { name: "createdAt", dataType: "timestamp with time zone", isPrimaryKey: false }
        ]
    };

    it("quotes the table and every column, in public and elsewhere", () => {
        expect(tableStatementTemplates("public", posts)).toEqual({
            selectTop: "SELECT * FROM \"Posts\" LIMIT 100;",
            selectAll: "SELECT \n  \"id\",\n  \"createdAt\"\nFROM \"Posts\";",
            insert: "INSERT INTO \"Posts\" (\n  \"id\",\n  \"createdAt\"\n) VALUES (\n  ?,\n  ?\n);",
            update: "UPDATE \"Posts\" \nSET \n  \"id\" = ?,\n  \"createdAt\" = ?\nWHERE id = ?;"
        });
        expect(tableStatementTemplates("Sales Data", { tableName: "order", columns: [] }).selectTop)
            .toBe("SELECT * FROM \"Sales Data\".\"order\" LIMIT 100;");
    });

    it("writes a quoted SELECT for a table named by a reserved word", () => {
        const onTableClick = jest.fn<(sql: string) => void>();
        render(
            <SchemaBrowser
                onTableClick={onTableClick}
                schemas={{ public: [{ schemaName: "public", tableName: "user", columns: [] }] }}
                isSchemaLoading={false}
                schemaError={null}
                onRetrySchema={() => undefined}
            />
        );
        fireEvent.click(screen.getByRole("button", { name: "SELECT" }));
        expect(onTableClick).toHaveBeenCalledWith("SELECT * FROM \"user\" LIMIT 100;");
    });
});

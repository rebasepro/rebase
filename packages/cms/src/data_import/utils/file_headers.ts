import type { Worksheet } from "exceljs";

/**
 * Extract column headers from the first row of an ExcelJS worksheet.
 * Returns an array of header strings in column order.
 */
export function getWorksheetHeaders(worksheet: Worksheet): string[] {
    const headers: string[] = [];
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        headers[colNumber - 1] = cell.text ?? `Column${colNumber}`;
    });
    return headers.filter(Boolean);
}

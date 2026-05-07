export interface GoogleSheetsConfig {
    spreadsheetId: string;
}

export interface GoogleSheetsData {
    values: any[][];
    headers: string[];
    rows: Record<string, any>[];
    spreadsheetId: string;
    sheetName?: string;
}

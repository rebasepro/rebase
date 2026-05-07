export type GoogleSheetsConnectionConfig = {
    type: "google_sheets";
    id: string;
    title: string;
    spreadsheetId: string;
    // user that added the data source
    uid?: string;
    teamId?: string;
}

/**
 * RFC 4180 CSV, read back: quoted fields may hold commas, line breaks and
 * doubled quotes; a record ends at CRLF or LF. An empty unquoted field is
 * `null` (the export writes NULL as nothing), an empty quoted one `""`.
 */
export function parseCsv(text: string): (string | null)[][] {
    const records: (string | null)[][] = [];
    let record: (string | null)[] = [];
    let field = "";
    let quoted = false;
    let wasQuoted = false;
    let i = 0;
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

    const endField = () => {
        record.push(field === "" && !wasQuoted ? null : field);
        field = "";
        wasQuoted = false;
    };
    const endRecord = () => {
        endField();
        // A trailing line break leaves one empty record behind: not a row.
        if (!(record.length === 1 && record[0] === null)) records.push(record);
        record = [];
    };

    while (i < source.length) {
        const ch = source[i];
        if (quoted) {
            if (ch === "\"") {
                if (source[i + 1] === "\"") {
                    field += "\"";
                    i += 2;
                    continue;
                }
                quoted = false;
                i++;
                continue;
            }
            field += ch;
            i++;
            continue;
        }
        if (ch === "\"" && field === "") {
            quoted = true;
            wasQuoted = true;
            i++;
        } else if (ch === ",") {
            endField();
            i++;
        } else if (ch === "\r" && source[i + 1] === "\n") {
            endRecord();
            i += 2;
        } else if (ch === "\n") {
            endRecord();
            i++;
        } else {
            field += ch;
            i++;
        }
    }
    if (field !== "" || wasQuoted || record.length > 0) endRecord();
    return records;
}

/** The first record as column names, the rest as rows keyed by them. */
export function parseCsvWithHeader(text: string): { columns: string[]; rows: Record<string, string | null>[] } {
    const [header, ...body] = parseCsv(text);
    const columns = (header ?? []).map(name => (name ?? "").trim());
    const rows = body.map(record => {
        const row: Record<string, string | null> = {};
        columns.forEach((column, index) => {
            if (column) row[column] = record[index] ?? null;
        });
        return row;
    });
    return { columns, rows };
}

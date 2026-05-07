import { Type } from "lucide-react";
export function downloadDataAsCsv(data: object[], name: string) {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(","),
        ...data.map(row => headers.map(header => {
            const value = (row as any)[header];
            if (value === null || value === undefined) return "";
            if (Array.isArray(value)) return `"${JSON.stringify(value).replace(/"/g, "\"\"")}"`;
            return `"${String(value).replace(/"/g, "\"\"")}"`;
        }).join(","))
    ].join("\r\n");

    downloadBlob([csvContent], `${name}.csv`, "text/csv");
}

export function downloadBlob(content: BlobPart[], filename: string, contentType: string) {
    const blob = new Blob(content, { type: contentType });
    const url = URL.createObjectURL(blob);
    const pom = document.createElement("a");
    pom.href = url;
    pom.setAttribute("download", filename);
    pom.click();
}

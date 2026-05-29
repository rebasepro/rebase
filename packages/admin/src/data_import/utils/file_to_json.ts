import ExcelJS from "exceljs";
import { getWorksheetHeaders } from "./file_headers";
import { mapJsonParse, unflattenObject } from "./transforms";

// Re-export for backwards compat (tests import from this file)
export { unflattenObject } from "./transforms";

type ConversionResult = {
    data: object[];
    propertiesOrder: string[]
}

export function convertFileToJson(file: File): Promise<ConversionResult> {
    return new Promise((resolve, reject) => {
        if (file.type === "application/json") {
            console.debug("Converting JSON file to JSON", file.name);
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = e.target?.result as string;
                    const jsonData = JSON.parse(data);
                    if (!Array.isArray(jsonData)) {
                        reject(new Error("JSON file should contain an array of objects"));
                    } else {
                        const propertiesOrder = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
                        resolve({
                            data: jsonData,
                            propertiesOrder
                        });
                    }
                } catch (e) {
                    console.error("Error parsing JSON file", e);
                    reject(e);
                }
            };
            reader.readAsText(file);
        } else {
            console.debug("Converting Excel file to JSON", file.name);
            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const buffer = e.target?.result as ArrayBuffer;
                    const workbook = new ExcelJS.Workbook();
                    await workbook.xlsx.load(buffer);
                    const worksheet = workbook.worksheets[0];
                    if (!worksheet) {
                        reject(new Error("No worksheets found in file"));
                        return;
                    }

                    const headers = getWorksheetHeaders(worksheet);

                    // Convert rows to JSON objects (skip header row)
                    const parsedData: Array<Record<string, any>> = [];
                    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                        if (rowNumber === 1) return;
                        const obj: Record<string, any> = {};
                        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                            const header = headers[colNumber - 1];
                            if (header) {
                                obj[header] = cell.value;
                            }
                        });
                        parsedData.push(obj);
                    });

                    const cleanedData = parsedData.map(mapJsonParse);
                    const jsonData = cleanedData.map(unflattenObject);
                    resolve({
                        data: jsonData,
                        propertiesOrder: headers
                    });
                } catch (err) {
                    console.error("Error parsing Excel file", err);
                    reject(err);
                }
            };
            reader.readAsArrayBuffer(file);
        }
    });
}

export function downloadImage(dataUrl: string, filename: string) {
    const a = document.createElement("a");

    a.setAttribute("download", filename);
    a.setAttribute("href", dataUrl);
    a.click();
}

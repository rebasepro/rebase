/** Bytes as the largest unit that keeps the number above one: `12.4 MB`. */
export function formatBytes(bytes: number, locale?: string): string {
    const units = ["B", "kB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    const digits = unit === 0 || value >= 100 ? 0 : 1;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

/** Milliseconds as `840 ms`, `12.3 s`, `4 min 2 s` or `3 h 5 min`. */
export function formatDuration(ms: number, locale?: string): string {
    const number = (value: number, digits: number) =>
        new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
    if (ms < 1000) return `${number(ms, ms < 10 ? 2 : ms < 100 ? 1 : 0)} ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${number(seconds, 1)} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ${Math.floor(seconds % 60)} s`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** A count with the locale's grouping: `12,345`. */
export function formatCount(value: number, locale?: string): string {
    return new Intl.NumberFormat(locale).format(value);
}

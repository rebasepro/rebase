/**
 * @ignore
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => unknown>(func: T, wait = 166) {
    let timeout: ReturnType<typeof setTimeout>;

    function debounced(this: unknown, ...args: Parameters<T>) {
        const later = () => {
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    }

    debounced.clear = () => {
        clearTimeout(timeout);
    };

    return debounced as T & Cancelable;
}

/**
 * @ignore
 */
export interface Cancelable {
    clear(): void;
}

import React, { useContext } from "react";

/**
 * The uploads a record form is waiting for.
 *
 * A file field writes its value — the stored path — only when the upload
 * finishes, so a Save pressed while a 30 MB image was still uploading wrote
 * the record without it, and the file landed afterwards with nothing pointing
 * at it. An upload hands its promise to `track`; the form's submit waits for
 * every tracked upload before it reads the values.
 */
export interface FormUploadTracker {
    track(upload: Promise<unknown>): void;
}

export const FormUploadsContext = React.createContext<FormUploadTracker | undefined>(undefined);

/** The enclosing record form's upload tracker; `undefined` outside a form (a table cell). */
export function useFormUploadTracker(): FormUploadTracker | undefined {
    return useContext(FormUploadsContext);
}

/**
 * A tracker and the wait for it. `wait()` resolves once nothing tracked is in
 * flight, including uploads started while it was waiting.
 */
export function createFormUploadTracker(): FormUploadTracker & { wait(): Promise<void>; pending(): number } {
    const inFlight = new Set<Promise<unknown>>();
    return {
        track(upload) {
            const settled = upload.then(() => undefined, () => undefined);
            inFlight.add(settled);
            settled.then(() => inFlight.delete(settled));
        },
        async wait() {
            while (inFlight.size > 0) {
                await Promise.all([...inFlight]);
            }
        },
        pending() {
            return inFlight.size;
        }
    };
}

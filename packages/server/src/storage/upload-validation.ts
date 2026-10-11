/**
 * What every storage controller checks about a file before it stores it: the
 * source's own size cap and, when configured, its allowed content types.
 *
 * One function for the three controllers, which carried a copy each. Both
 * refusals are `ApiError`s, so they reach the caller as what they are. A plain
 * `Error` was a 500 "Internal Server Error" on `/upload` and a 502 on TUS —
 * after the client had sent every byte.
 */

import { ApiError } from "../api/errors";

export function validateUploadedFile(
    file: { size: number; type: string },
    maxSize: number,
    allowedMimeTypes: string[] | undefined
): void {
    if (file.size > maxSize) {
        throw new ApiError(
            413,
            "PAYLOAD_TOO_LARGE",
            `File size ${file.size} exceeds this storage source's maximum of ${maxSize} bytes.`,
            { size: file.size, maxFileSize: maxSize }
        );
    }

    if (allowedMimeTypes && allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(file.type)) {
        // The code a property's `acceptedFiles` refusal answers with: to the
        // caller, "this source does not take this type" is the same mistake.
        throw ApiError.badRequest(
            `File type ${file.type || "(none)"} is not allowed on this storage source. ` +
            `Allowed types: ${allowedMimeTypes.join(", ")}.`,
            "STORAGE_FILE_TYPE_REFUSED",
            { allowedMimeTypes, contentType: file.type }
        );
    }
}

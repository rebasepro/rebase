/**
 * Byte-range requests for served objects.
 *
 * Without `Accept-Ranges`, a browser will not offer to seek in an audio or
 * video element served from here: it has no way to ask for the middle of a file,
 * so scrubbing means fetching the whole thing from the start, and on a long
 * recording it means fetching it again for every seek. Safari goes further and
 * refuses to play a `<video>` at all unless the first response is a `206`.
 *
 * So this is not a performance nicety. For media it is the difference between a
 * player that works and one that does not.
 *
 * ## What is implemented, and what is refused
 *
 * A single range — `bytes=0-499`, `bytes=500-`, `bytes=-500`. That is what every
 * browser sends for media playback.
 *
 * Multiple ranges in one request (`bytes=0-99,200-299`) are **not** served.
 * Answering them means composing a `multipart/byteranges` body, and nothing that
 * matters sends them; a server may always answer a range request with the whole
 * `200` instead, which is what happens here. Refusing to guess is better than a
 * half-implemented multipart encoder.
 *
 * An unsatisfiable range — one starting past the end of the object — is a `416`
 * with a `Content-Range: bytes /<size>`, as RFC 9110 requires. Answering `200`
 * there would hand a player the whole file when it asked for a byte that does
 * not exist, and it would never notice.
 */

/** A resolved, inclusive byte range within an object of known size. */
export interface ByteRange {
    start: number;
    /** Inclusive, as the header is. */
    end: number;
    /** `end - start + 1`. */
    length: number;
}

export type RangeParse =
    /** No `Range` header, or one this server declines to honour. Serve `200`. */
    | { kind: "none" }
    /** Serve `206` with this range. */
    | { kind: "range"; range: ByteRange }
    /** Serve `416`. The range cannot be satisfied for an object of this size. */
    | { kind: "unsatisfiable" };

/**
 * Parse a `Range` header against an object of `size` bytes.
 *
 * Deliberately conservative: anything malformed, multi-range, or in a unit other
 * than bytes resolves to `none`, which serves the whole object. A range request
 * answered with `200` is always legal; a range answered wrongly is a corrupted
 * download.
 */
export function parseRange(header: string | undefined, size: number): RangeParse {
    if (!header) return { kind: "none" };

    const match = /^bytes=(.*)$/i.exec(header.trim());
    if (!match) return { kind: "none" };

    const spec = match[1].trim();
    // Multiple ranges: legal to decline, and declining is what we do.
    if (spec.includes(",")) return { kind: "none" };

    const parts = /^(\d*)-(\d*)$/.exec(spec);
    if (!parts) return { kind: "none" };

    const [, rawStart, rawEnd] = parts;

    // A zero-length object cannot satisfy any range. `bytes=0-` against an empty
    // file is unsatisfiable rather than an empty 206.
    if (size === 0) return { kind: "unsatisfiable" };

    let start: number;
    let end: number;

    if (rawStart === "") {
        // Suffix form: `bytes=-500` means the LAST 500 bytes, not "up to 500".
        if (rawEnd === "") return { kind: "none" };
        const suffix = Number(rawEnd);
        if (!Number.isSafeInteger(suffix)) return { kind: "none" };
        if (suffix === 0) return { kind: "unsatisfiable" };
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(rawStart);
        if (!Number.isSafeInteger(start)) return { kind: "none" };
        if (start >= size) return { kind: "unsatisfiable" };

        if (rawEnd === "") {
            end = size - 1;
        } else {
            end = Number(rawEnd);
            if (!Number.isSafeInteger(end)) return { kind: "none" };
            // An end past the object is clamped, not refused — a player asking
            // for more than exists should get what exists.
            end = Math.min(end, size - 1);
        }

        if (end < start) return { kind: "unsatisfiable" };
    }

    return { kind: "range", range: { start, end, length: end - start + 1 } };
}

/** The `Content-Range` for a served range. */
export function contentRange(range: ByteRange, size: number): string {
    return `bytes ${range.start}-${range.end}/${size}`;
}

/** The `Content-Range` for a `416`, which names the size and no range. */
export function unsatisfiableContentRange(size: number): string {
    return `bytes */${size}`;
}

/**
 * A double holds 15 significant decimal digits exactly; a 16th may already be
 * rounded (`9007199254740993` reads back as …992).
 */
const MAX_EXACT_SIGNIFICANT_DIGITS = 15;

/**
 * JSON's number grammar: an optional minus, an integer part with no leading
 * zero, an optional fraction and an optional exponent. No `+`, no thousands
 * separator, no currency or percent sign, no hexadecimal, no `Infinity`.
 */
const NUMBER_SPELLING = /^-?(0|[1-9]\d*)(\.(\d+))?([eE][+-]?\d+)?$/;

/**
 * The number a text spells, when it spells one that a number gives back with
 * nothing lost — otherwise `undefined`.
 *
 * This is the one answer to "is this text a number" for both the inference
 * that picks a column's type and the import that converts its cells, so the
 * two cannot disagree. It refuses what `Number()` would forgive and silently
 * change: a leading zero (`02134` is a zip code, `00123` a code — as numbers
 * they lose the zero), more significant digits than a double holds exactly (a
 * 20-digit SKU), and anything that is not a plain decimal (`1,234`, `$1.00`,
 * `12%`, `+15551234567`, `N/A`). Formatting a number does not carry —
 * `10.00` and `1e3` — is allowed: their value is exact.
 */
export function readNumberExactly(text: string): number | undefined {
    const trimmed = text.trim();
    const match = NUMBER_SPELLING.exec(trimmed);
    if (!match) return undefined;
    const integerPart = match[1];
    const fraction = (match[3] ?? "").replace(/0+$/, "");
    const significant = (integerPart + fraction).replace(/^0+/, "");
    if (significant.length > MAX_EXACT_SIGNIFICANT_DIGITS) return undefined;
    const value = Number(trimmed);
    // `1e400` overflows to Infinity and `1e-400` underflows to 0.
    if (!Number.isFinite(value) || (value === 0 && significant !== "")) return undefined;
    return value;
}

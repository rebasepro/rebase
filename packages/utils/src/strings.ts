const tokenizeRegex = /[A-Z]{2,}(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|[0-9]+(?:[a-z](?![a-z]))?|[A-Z]/g;

export const toKebabCase = (str?: string) => {
    if (!str || typeof str !== "string") return "";
    const regExpMatchArray = str.match(tokenizeRegex);
    if (!regExpMatchArray) return "";
    return regExpMatchArray
        .map(x => x.toLowerCase())
        .join("-");
};

const snakeCaseRegex = tokenizeRegex;

export const toSnakeCase = (str?: string) => {
    if (!str || typeof str !== "string") return "";
    const regExpMatchArray = str.match(snakeCaseRegex);
    if (!regExpMatchArray) return "";
    return regExpMatchArray
        .map(x => x.toLowerCase())
        .join("_");
};

export function camelCase(str: string): string {
    if (!str) return "";
    if (str.length === 1) return str.toLowerCase();

    // Split by hyphens, underscores, or spaces and filter out empty strings
    const parts = str.split(/[-_ ]+/).filter(Boolean);

    if (parts.length === 0) return "";

    // Start with first part in lowercase
    return parts[0].toLowerCase() +
        // Transform remaining parts to have first letter uppercase
        parts.slice(1)
            .map(part => part.charAt(0).toUpperCase() + part.substring(1).toLowerCase())
            .join("");
}

/**
 * A random base-36 string of exactly `strLength` characters.
 *
 * Not `Math.random().toString(36).slice(2, 2 + strLength)`: that has no
 * guaranteed length. Base-36 of a double drops trailing zeros, so the source
 * string is short about once in 36 calls and the slice quietly returns fewer
 * characters than asked for — `randomString(10)` returning 9. These values
 * prefix uploaded filenames to keep them apart, so a short one is a likelier
 * collision, and it fails at the rate that makes a test look flaky.
 */
export function randomString(strLength = 5) {
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    let result = "";
    for (let i = 0; i < strLength; i++) {
        result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return result;
}

export function randomColor() {
    return Math.floor(Math.random() * 16777215).toString(16);
}

export function slugify(text?: string, separator = "_", lowercase = true) {
    if (!text) return "";
    const from = "ãàáäâẽèéëêìíïîõòóöôùúüûñç·/_,:;-"
    const to = `aaaaaeeeeeiiiiooooouuuunc${separator}${separator}${separator}${separator}${separator}${separator}${separator}`;

    for (let i = 0, l = from.length; i < l; i++) {
        text = text.replace(new RegExp(from.charAt(i), "g"), to.charAt(i));
    }

    text = text
        .toString() // Cast to string
        .trim() // Remove whitespace from both sides of a string
        .replace(/^\s+|\s+$/g, "")
        .replace(/\s+/g, separator) // Replace spaces with separator
        .replace(/&/g, separator) // Replace & with separator
        .replace(/[^\w\\-]+/g, "") // Remove all non-word chars
        .replace(new RegExp("\\" + separator + "\\" + separator + "+", "g"),
            separator); // Replace multiple separators with single one

    return lowercase
        ? text.toLowerCase() // Convert the string to lowercase letters
        : text;
}

export function unslugify(slug?: string): string {
    if (!slug) return "";
    if (slug.includes("-") || slug.includes("_") || !slug.includes(" ")) {
        const result = slug.replace(/[-_]/g, " ");
        return result.replace(/\w\S*/g, function (txt) {
            return txt.charAt(0).toUpperCase() + txt.substring(1);
        }).trim();
    } else {
        return slug.trim();
    }
}

/**
 * Are these two identifiers one edit apart, ignoring case?
 *
 * Tight on purpose. A suggester that fires on two edits offers `columnWidth`
 * for `colWith` and `readOnly` for `required`, and a "did you mean" that is
 * usually wrong teaches people to stop reading them. One edit covers what
 * actually happens — a dropped letter (`multilne`), a doubled one, a transposed
 * pair (`validaton`), a wrong case — and nothing else.
 *
 * Lives here rather than beside either caller because both the CLI's manifest
 * reader and the server's collection validator answer the same question about
 * an unknown key, and two copies of a similarity rule is two rules the moment
 * one of them is tuned.
 */
export function isNearMiss(a: string, b: string): boolean {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    if (x === y) return true;
    if (Math.abs(x.length - y.length) > 1) return false;

    const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < shorter.length && j < longer.length) {
        if (shorter[i] === longer[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (shorter.length === longer.length) i++;
        j++;
    }
    return edits + (longer.length - j) + (shorter.length - i) <= 1;
}

/**
 * The key in `known` that `key` was probably meant to be, if any.
 *
 * `undefined` when nothing is close — which is the common case for a key that
 * is simply from a newer version, and the reason the caller must be able to say
 * "unknown" without saying "wrong".
 */
export function suggestNearMiss(known: readonly string[], key: string): string | undefined {
    return known.find(candidate => isNearMiss(candidate, key));
}

export function prettifyIdentifier(input: string) {
    if (!input) return "";

    let text = input;

    // 1. Handle camelCase and Acronyms
    // Group 1 ($1 $2): Lowercase followed by Uppercase (e.g., imageURL -> image URL)
    // Group 2 ($3 $4): Uppercase followed by Uppercase+lowercase (e.g., XMLParser -> XML Parser)
    text = text.replace(/([a-z])([A-Z])|([A-Z])([A-Z][a-z])/g, "$1$3 $2$4");

    // 2. Replace hyphens/underscores with spaces
    text = text.replace(/[_-]+/g, " ");

    // 3. Capitalize first letter of each word (Title Case)
    const s = text
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
    return s;
}

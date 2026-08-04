import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from "crypto";
import { promisify } from "util";

// `promisify` resolves to the 4-argument overload of `scrypt`, which has no
// options parameter — so passing one is a type error, and that is exactly why
// the parameters below sat unused. Named here so the options overload is the
// one this module calls.
const scryptAsync = promisify(scrypt) as (
    password: string,
    salt: Buffer,
    keylen: number,
    options: ScryptOptions
) => Promise<Buffer>;

// Scrypt parameters (recommended values for 2024+).
//
// Passed explicitly. They were declared here and handed to neither call, which
// happened to be harmless because they are also Node's defaults — so raising
// any of them would have changed nothing while reading as though it had. That
// is the failure worth avoiding: the next person to strengthen this needs the
// edit to take effect.
const SALT_LENGTH = 32;
const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export interface PasswordValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Password requirements:
 * - Minimum 8 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 */
export function validatePasswordStrength(password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (password.length < 8) {
        errors.push("Password must be at least 8 characters long");
    }

    if (!/[A-Z]/.test(password)) {
        errors.push("Password must contain at least one uppercase letter");
    }

    if (!/[a-z]/.test(password)) {
        errors.push("Password must contain at least one lowercase letter");
    }

    if (!/[0-9]/.test(password)) {
        errors.push("Password must contain at least one number");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Hash a password using Node's built-in scrypt
 * Returns format: salt:hash (both hex encoded)
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
    return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

/**
 * Verify a password against a scrypt hash
 * Expects format: salt:hash (both hex encoded)
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [saltHex, hashHex] = storedHash.split(":");
    if (!saltHex || !hashHex) {
        return false;
    }

    const salt = Buffer.from(saltHex, "hex");
    const storedKey = Buffer.from(hashHex, "hex");

    const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);

    // Use timing-safe comparison to prevent timing attacks
    return timingSafeEqual(derivedKey, storedKey);
}

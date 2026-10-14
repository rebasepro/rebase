/**
 * Connection-string passwords, replaced before a line is printed.
 *
 * A refusal that repeats what was typed repeats a password with it, and these
 * lines land in terminals, CI logs and issues. `user:***@` is the form every
 * other message uses: the driver's `redactConnectionPasswords` in
 * `@rebasepro/server-postgres`, which its entry does not export, and this
 * mirrors. Covers the user-info password and a `password=` parameter.
 */
export function redactConnectionPasswords(text: string): string {
    return text
        .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@'"]*):[^\s/?#'"]*@/gi, "$1:***@")
        .replace(/(\bpassword\s*=\s*)('[^']*'|[^\s&'"]+)/gi, "$1***");
}

import type { AuthAdapter } from "@rebasepro/types";
import { createCustomAuthAdapter } from "../../src/auth/custom-auth-adapter";

/** An auth adapter that signs every request in as the same non-admin editor, as the admin panel's uploads are. */
export function signedInEditor(): AuthAdapter {
    return createCustomAuthAdapter({
        verifyRequest: async () => ({ uid: "editor-1", email: "editor-1@example.test", roles: ["editor"], isAdmin: false })
    });
}

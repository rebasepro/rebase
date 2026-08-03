import React from "react";
import { autocompleteStream } from "../api";
import { EditorAIController } from "@rebasepro/admin";

/**
 * Inline continuation for the rich-text editor's slash command.
 *
 * No token is threaded through any more. The previous version demanded a
 * Firebase ID token and threw `"Firebase token is required"` when it could not
 * get one — in a Rebase app there is no such thing, and the token it actually
 * sent was a Rebase JWT the receiving service had no way to verify. The hosted
 * service authenticates nobody; see `src/api.ts`.
 */
export function useEditorAIController({ endpoint }: { endpoint?: string } = {}): EditorAIController {
    return React.useMemo(() => ({
        autocomplete: (textBefore: string, textAfter: string, onUpdate: (delta: string) => void) =>
            autocompleteStream({
                endpoint,
                textBefore,
                textAfter,
                onDelta: onUpdate
            })
    }), [endpoint]);
}

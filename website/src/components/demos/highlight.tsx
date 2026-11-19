import React from "react";

// A small TS/JSON tokenizer for the fixed snippets in the demos, coloured like
// the site's other code panels (BackendContent): keywords blue, calls amber,
// strings emerald, comments muted. Not a highlighter: enough for strings we
// wrote ourselves, without shipping one.
const TOKEN = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*")|\b(export|const|import|from|typeof)\b|([A-Za-z_$][\w$]*)(?=\s*[(<])/g;

export function highlight(code: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    let last = 0;
    for (const m of code.matchAll(TOKEN)) {
        const at = m.index ?? 0;
        if (at > last) out.push(code.slice(last, at));
        const cls = m[1] ? "text-tone-500"
            : m[2] ? "text-emerald-400"
                : m[3] ? "text-blue-400"
                    : "text-amber-400";
        out.push(<span key={at} className={cls}>{m[0]}</span>);
        last = at + m[0].length;
    }
    if (last < code.length) out.push(code.slice(last));
    return out;
}

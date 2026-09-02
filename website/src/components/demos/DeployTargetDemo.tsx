import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * "It is four commands" is a claim, so the figure has to be the four commands —
 * typed, in order, with the output they actually produce.
 *
 * Every command here is lifted from docs/deployment/self-hosting. If that page
 * changes, this one is wrong; keep them together.
 */

type LineKind = "cmd" | "out" | "ok" | "note";

interface Line {
    kind: LineKind;
    text: string;
}

interface Target {
    id: string;
    label: string;
    /** What the reader is renting, in their words. */
    subtitle: string;
    lines: Line[];
}

const TARGETS: Target[] = [
    {
        id: "vps",
        label: "dt.vps.label",
        subtitle: "dt.vps.sub",
        lines: [
            { kind: "cmd", text: "rebase build" },
            { kind: "out", text: "collections   12 compiled" },
            { kind: "out", text: "bundle        dist-bundle/  (format 2)" },
            { kind: "cmd", text: "rsync -a dist-bundle docker-compose.yml root@box.example.eu:/srv/api/" },
            { kind: "cmd", text: "ssh root@box.example.eu 'cd /srv/api && docker compose up -d'" },
            { kind: "out", text: "✔ db    postgres:18-alpine   healthy" },
            { kind: "out", text: "✔ api   rebasepro/server     listening on :8080" },
            { kind: "cmd", text: "DATABASE_URL=$PROD_DATABASE_URL rebase db push" },
            { kind: "out", text: "dry run    12 tables, 34 policies, 0 destructive changes" },
            { kind: "out", text: "applied    RLS enabled on every table" },
            { kind: "ok", text: "GET https://api.example.eu/health  →  200 OK" }
        ]
    },
    {
        id: "compose",
        label: "dt.compose.label",
        subtitle: "dt.compose.sub",
        lines: [
            { kind: "cmd", text: "rebase build" },
            { kind: "cmd", text: "docker compose up -d db" },
            { kind: "out", text: "✔ db    postgres:18-alpine   healthy" },
            { kind: "cmd", text: "rebase db push" },
            { kind: "out", text: "applied    12 tables, 34 policies" },
            { kind: "cmd", text: "docker compose up" },
            { kind: "out", text: "api   bundle mounted at /bundle" },
            { kind: "out", text: "api   REST · auth · storage · realtime · functions · cron" },
            { kind: "ok", text: "GET http://localhost:8080/health  →  200 OK" }
        ]
    },
    {
        id: "image",
        label: "dt.image.label",
        subtitle: "dt.image.sub",
        lines: [
            { kind: "cmd", text: "rebase build" },
            { kind: "cmd", text: "npm install --omit=dev --prefix dist-bundle" },
            { kind: "note", text: "# Dockerfile" },
            { kind: "note", text: "#   FROM rebasepro/server:0.17.3" },
            { kind: "note", text: "#   COPY dist-bundle /bundle" },
            { kind: "cmd", text: "docker build -t registry.example.eu/acme/api:1.4.0 ." },
            { kind: "cmd", text: "docker push registry.example.eu/acme/api:1.4.0" },
            { kind: "out", text: "1.4.0   pushed   digest sha256:9f2c…" },
            { kind: "ok", text: "Upgrading Rebase later = change the tag. The bundle is untouched." }
        ]
    },
    {
        id: "metal",
        label: "dt.metal.label",
        subtitle: "dt.metal.sub",
        lines: [
            { kind: "cmd", text: "npm install -g @rebasepro/server @rebasepro/server-postgres" },
            { kind: "cmd", text: "rsync -a dist-bundle/ deploy@rack.internal:/srv/myapp/dist-bundle/" },
            { kind: "cmd", text: "ssh deploy@rack.internal 'systemctl start rebase'" },
            { kind: "note", text: "# rebase.service" },
            { kind: "note", text: "#   ExecStart=rebase-server /srv/myapp/dist-bundle" },
            { kind: "out", text: "rebase-server   listening on :8080" },
            { kind: "ok", text: "GET /livez → 200 · liveness never touches the database" }
        ]
    }
];

const CHAR_MS = 14;
const AFTER_CMD_MS = 300;
const AFTER_OUT_MS = 150;

/**
 * Labels and captions are keys; the terminal reel is not. A command is a
 * command in every language, and translating one would make it wrong.
 */
const EN: Record<string, string> = {
    "dt.vps.label": "A VPS you rent",
    "dt.vps.sub": "Hetzner, OVHcloud, Scaleway, IONOS — anything with SSH and Docker",
    "dt.compose.label": "Docker, locally first",
    "dt.compose.sub": "The same four commands, before any of it leaves your laptop",
    "dt.image.label": "A pinned image, from CI",
    "dt.image.sub": "Bake the bundle in so the thing you tested is the thing that runs",
    "dt.metal.label": "Your own rack",
    "dt.metal.sub": "No Docker, no orchestrator — a Node process under systemd",
    "dt.footnote": "Commands taken verbatim from the self-hosting guide. There is no application image to build — the runtime is published, your project travels as a bundle.",
    "dt.replay": "Replay",
    "dt.skip": "Skip"
};

export const DEPLOY_TARGET_STRINGS = Object.keys(EN);

export function DeployTargetDemo({ s = {} }: { s?: Record<string, string> }) {
    /** Resolve a key; anything that is not one passes through. */
    const T = (k: string) => s[k] ?? EN[k] ?? k;

    const [targetId, setTargetId] = useState(TARGETS[0].id);
    const [step, setStep] = useState(0);
    const [chars, setChars] = useState(0);

    const target = useMemo(() => TARGETS.find((t) => t.id === targetId)!, [targetId]);
    const lines = target.lines;
    const done = step >= lines.length;
    const scrollRef = useRef<HTMLDivElement>(null);

    // Restart the reel whenever the reader picks a different target.
    useEffect(() => {
        setStep(0);
        setChars(0);
    }, [targetId]);

    useEffect(() => {
        if (done) return;
        const line = lines[step];

        if (line.kind === "cmd" && chars < line.text.length) {
            const id = setTimeout(() => setChars((c) => c + 1), CHAR_MS);
            return () => clearTimeout(id);
        }

        const wait = line.kind === "cmd" ? AFTER_CMD_MS : line.kind === "ok" ? 260 : AFTER_OUT_MS;
        const id = setTimeout(() => {
            setStep((s) => s + 1);
            setChars(0);
        }, wait);
        return () => clearTimeout(id);
    }, [step, chars, done, lines]);

    // Keep the newest line in view without dragging the whole page along.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [step, chars]);

    const skipToEnd = () => {
        setStep(lines.length);
        setChars(0);
    };

    const replay = () => {
        setStep(0);
        setChars(0);
    };

    return (
        <div className="frame overflow-hidden">

            {/* Target picker */}
            <div className="flex flex-wrap gap-2 border-b border-surface-800/60 bg-surface-950/50 px-4 py-3 sm:px-5">
                {TARGETS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTargetId(t.id)}
                        aria-pressed={t.id === targetId}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                            t.id === targetId
                                ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                                : "text-surface-400 ring-1 ring-inset ring-surface-800 hover:text-surface-200 hover:ring-surface-700"
                        }`}>
                        {T(t.label)}
                    </button>
                ))}
            </div>

            <p className="px-5 pt-4 text-sm text-surface-400 sm:px-6">{T(target.subtitle)}</p>

            {/* Terminal */}
            <div
                ref={scrollRef}
                onClick={done ? undefined : skipToEnd}
                className={`mx-5 mb-5 mt-4 h-[19rem] overflow-y-auto rounded-xl border border-surface-800/80 bg-[#0b0c0f] p-4 font-mono text-[12.5px] leading-[1.75] sm:mx-6 sm:mb-6 sm:p-5 ${
                    done ? "" : "cursor-pointer"
                }`}>
                {lines.slice(0, step).map((line, i) => (
                    <TerminalLine key={i} line={line} />
                ))}

                {!done && (
                    <TerminalLine
                        line={{ ...lines[step], text: lines[step].kind === "cmd" ? lines[step].text.slice(0, chars) : lines[step].text }}
                        caret={lines[step].kind === "cmd"}
                    />
                )}
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-800/60 bg-surface-950/40 px-5 py-3 sm:px-6">
                <p className="text-[11px] leading-relaxed text-surface-500">
                    {T("dt.footnote")}
                </p>
                <button
                    type="button"
                    onClick={done ? replay : skipToEnd}
                    className="flex-none rounded-lg px-3 py-1.5 text-xs font-medium text-surface-400 ring-1 ring-inset ring-surface-800 transition-colors hover:text-white hover:ring-surface-700">
                    {done ? T("dt.replay") : T("dt.skip")}
                </button>
            </div>
        </div>
    );
}

function TerminalLine({ line, caret }: { line: Line; caret?: boolean }) {
    if (line.kind === "cmd") {
        return (
            <div className="flex gap-2">
                <span className="flex-none select-none text-primary">$</span>
                <span className="text-surface-100 break-all">
                    {line.text}
                    {caret && <span className="ml-0.5 inline-block h-[1.05em] w-[0.5em] translate-y-[0.15em] bg-primary/90 animate-pulse" />}
                </span>
            </div>
        );
    }

    if (line.kind === "ok") {
        return (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-emerald-500/[0.07] px-3 py-2 ring-1 ring-inset ring-emerald-500/20">
                <svg className="mt-[3px] flex-none text-emerald-400" width="13" height="13" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12 5 5L20 7"/>
                </svg>
                <span className="text-emerald-300 break-all">{line.text}</span>
            </div>
        );
    }

    if (line.kind === "note") {
        return <div className="text-surface-600 break-all">{line.text}</div>;
    }

    return <div className="pl-4 text-surface-400 break-all">{line.text}</div>;
}

export default DeployTargetDemo;

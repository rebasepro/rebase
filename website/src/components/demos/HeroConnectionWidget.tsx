import React, { useEffect, useState } from "react";
import { highlight } from "./highlight";

/**
 * `rebase schema introspect`, made touchable: point it at a database and
 * watch it read the catalog and write one `defineTable` module per table.
 *
 * Code-first figure (a terminal, then generated source), so it stays a dark
 * panel on a light page, like every code well (global.css `.island-dark`).
 */

type Phase = "idle" | "running" | "done";

const LOG: { label: string; text: string }[] = [
    { label: "connect", text: "postgres 16 · db.yourhost.com/production" },
    { label: "read", text: "4 tables · 1 enum · 3 foreign keys" },
    { label: "write", text: "backend/schema/products.ts" },
    { label: "", text: "backend/schema/orders.ts" },
    { label: "", text: "backend/schema/order_items.ts" },
    { label: "", text: "backend/schema/customers.ts" }
];

const FILES: Record<string, string> = {
    "products.ts": `export const products = defineTable("products", {
  columns: {
    id: col.uuid().primaryKey().defaultRandom(),
    name: col.text().notNull(),
    category: col.varchar({ length: 32 }),
    price: col.numeric({ precision: 10, scale: 2 }),
    createdAt: col.timestamp({ withTimezone: true }),
  },
  relations: {
    orderItems: rel.hasMany(() => orderItems),
  },
  rls: "inherit",
});`,
    "orders.ts": `export const orders = defineTable("orders", {
  columns: {
    id: col.uuid().primaryKey().defaultRandom(),
    customerId: col.uuid().notNull(),
    status: col.varchar({ length: 16 }).default("pending"),
    total: col.numeric({ precision: 10, scale: 2 }),
    placedAt: col.timestamp({ withTimezone: true }),
  },
  relations: {
    customer: rel.belongsTo(() => customers),
    items: rel.hasMany(() => orderItems),
  },
  rls: "inherit",
});`,
    "order_items.ts": `export const orderItems = defineTable("order_items", {
  columns: {
    id: col.uuid().primaryKey().defaultRandom(),
    orderId: col.uuid().notNull(),
    productId: col.uuid().notNull(),
    quantity: col.integer().notNull().default(1),
  },
  relations: {
    order: rel.belongsTo(() => orders),
    product: rel.belongsTo(() => products),
  },
  rls: "inherit",
});`,
    "customers.ts": `export const customers = defineTable("customers", {
  columns: {
    id: col.uuid().primaryKey().defaultRandom(),
    email: col.text().notNull().unique(),
    name: col.text(),
  },
  relations: {
    orders: rel.hasMany(() => orders),
  },
  rls: "inherit",
});`
};

const STEP_MS = 320;

export default function HeroConnectionWidget() {
    const [phase, setPhase] = useState<Phase>("idle");
    const [shown, setShown] = useState(0);
    const [file, setFile] = useState("products.ts");
    const [url, setUrl] = useState("postgres://admin:••••••@db.yourhost.com:5432/production");

    useEffect(() => {
        if (phase !== "running") return;
        if (shown >= LOG.length) {
            const t = setTimeout(() => setPhase("done"), 650);
            return () => clearTimeout(t);
        }
        const t = setTimeout(() => setShown((n) => n + 1), STEP_MS);
        return () => clearTimeout(t);
    }, [phase, shown]);

    const run = (e: React.FormEvent) => {
        e.preventDefault();
        if (phase === "running") return;
        setFile("products.ts");
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduced) {
            setShown(LOG.length);
            setPhase("done");
        } else {
            setShown(0);
            setPhase("running");
        }
    };

    // The files the log has written so far: the directory fills line by line.
    const written = LOG.slice(0, phase === "done" ? LOG.length : phase === "running" ? shown : 0)
        .filter((l) => l.text.startsWith("backend/schema/"))
        .map((l) => l.text.slice("backend/schema/".length));

    const status = phase === "idle" ? "ready" : phase === "running" ? "reading…" : "4 tables written";

    return (
        <div className="frame island-dark w-full not-content">
            <div className="frame-head">
                <span>~/shop</span>
                <span className="ml-auto flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${
                        phase === "done" ? "bg-emerald-400" : phase === "running" ? "bg-amber-400 animate-pulse" : "bg-tone-600"
                    }`}/>
                    {status}
                </span>
            </div>

            {/* The command, and the one thing it needs */}
            <form onSubmit={run} className="px-4 sm:px-5 pt-4 pb-4 border-b border-hairline font-mono text-xs">
                <label htmlFor="introspect-url" className="block text-tone-300">
                    <span className="text-tone-500 select-none">$ </span>
                    rebase schema introspect <span className="text-tone-500">--database-url</span>
                </label>
                <div className="mt-2.5 flex items-stretch gap-2">
                    <input
                        id="introspect-url"
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        spellCheck={false}
                        autoComplete="off"
                        className="flex-1 min-w-0 rounded-md bg-surface-well/70 ring-1 ring-tone-800 px-3 py-2 text-[11px] text-tone-200 outline-none transition-shadow focus:ring-primary/70"
                    />
                    <button
                        type="submit"
                        disabled={phase === "running"}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 font-sans text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60 cursor-pointer disabled:cursor-default">
                        {phase === "done" ? "Run again" : "Run"}
                        <span aria-hidden="true" className="text-white/70">↵</span>
                    </button>
                </div>
            </form>

            {/* Output: one layout for every phase — the schema directory on the
                left fills as files are written, the right column carries the
                description, then the log, then the file. Fixed height, so the
                hero never jumps. */}
            <div className="h-[19.5rem] sm:h-[17.5rem] overflow-hidden grid grid-cols-1 grid-rows-[auto_1fr] sm:grid-rows-1 sm:grid-cols-[9.5rem_1fr]" aria-live="polite">
                <div className="flex sm:flex-col gap-0.5 overflow-x-auto px-2 py-2 sm:py-3 border-b sm:border-b-0 sm:border-r border-hairline font-mono text-[11px]">
                    <span className="hidden sm:block px-2 pb-2 text-[10px] uppercase tracking-[0.18em] text-tone-600">backend/schema</span>
                    {written.length === 0 && (
                        <span className="px-2 py-1 text-tone-600 italic">empty</span>
                    )}
                    {written.map((name) => (
                        <button
                            key={name}
                            type="button"
                            disabled={phase !== "done"}
                            onClick={() => setFile(name)}
                            aria-pressed={phase === "done" && file === name}
                            className={`hcw-in shrink-0 text-left rounded px-2 py-1 transition-colors ${
                                phase !== "done" ? "text-tone-400 cursor-default"
                                    : file === name ? "bg-tone-800/70 text-tone-max cursor-pointer" : "text-tone-500 hover:text-tone-300 cursor-pointer"
                            }`}>
                            {name}
                        </button>
                    ))}
                </div>

                <div className="min-w-0 min-h-0">
                    {phase === "idle" && (
                        <ul className="px-4 sm:px-5 py-4 space-y-2.5 font-mono text-[11px] leading-relaxed text-tone-500">
                            <li>Reads tables, enums, keys and foreign keys from the catalog.</li>
                            <li>Writes one <span className="text-tone-300">defineTable</span> module per table, the source of the API, the SDK and the panel.</li>
                            <li>Copies no rows. Changes nothing in the database.</li>
                        </ul>
                    )}

                    {phase === "running" && (
                        <ol className="px-4 sm:px-5 py-4 space-y-1.5 font-mono text-[11px] leading-relaxed">
                            {LOG.slice(0, shown).map((line, i) => (
                                <li key={i} className="flex gap-2.5 hcw-in">
                                    <span className="w-14 shrink-0 text-tone-500">{line.label}</span>
                                    <span className="text-emerald-400 select-none w-2">{line.label ? "✓" : ""}</span>
                                    <span className="text-tone-300 truncate">{line.text}</span>
                                </li>
                            ))}
                            {shown < LOG.length && (
                                <li className="flex gap-2.5">
                                    <span className="w-14 shrink-0"/>
                                    <span className="mt-0.5 h-3.5 w-1.5 bg-primary animate-pulse"/>
                                </li>
                            )}
                        </ol>
                    )}

                    {phase === "done" && (
                        <pre key={file} className="hcw-in h-full overflow-auto px-4 sm:px-5 py-3 sm:py-4 font-mono text-[11px] leading-relaxed text-tone-300"><code>{highlight(FILES[file])}</code></pre>
                    )}
                </div>
            </div>

            <div className="px-4 sm:px-5 py-2.5 border-t border-hairline font-mono text-[10px] text-tone-500 flex items-center gap-x-3 gap-y-1 flex-wrap">
                {phase === "done" ? (
                    <>
                        <span className="text-tone-600">served</span>
                        <span className="text-tone-300">GET /api/data/products</span>
                        <span className="text-tone-600">·</span>
                        <span className="text-tone-300">typed SDK</span>
                        <span className="text-tone-600">·</span>
                        <span className="text-tone-300">openapi.json</span>
                    </>
                ) : (
                    <span>Runs against your database, on your machine.</span>
                )}
            </div>

            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes hcwIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
                .hcw-in { animation: hcwIn .28s cubic-bezier(.16,1,.3,1) both; }
                @media (prefers-reduced-motion: reduce) { .hcw-in { animation: none; } }
            ` }}/>
        </div>
    );
}

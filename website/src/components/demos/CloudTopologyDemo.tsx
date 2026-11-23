import React, { useState } from "react";
import { Server, Database, HardDrive, ShieldCheck, AlertTriangle, Globe } from "lucide-react";

export const CLOUD_TOPOLOGY_STRINGS = [
    "cloud.demo.app.label",
    "cloud.demo.app.shared",
    "cloud.demo.app.reserved",
    "cloud.demo.app.dedicated",
    "cloud.demo.app.shared.note",
    "cloud.demo.app.reserved.note",
    "cloud.demo.app.dedicated.note",
    "cloud.demo.db.label",
    "cloud.demo.db.dedicated",
    "cloud.demo.db.external",
    "cloud.demo.db.dedicated.note",
    "cloud.demo.db.external.note",
    "cloud.demo.storage.label",
    "cloud.demo.storage.managed",
    "cloud.demo.storage.external",
    "cloud.demo.storage.managed.note",
    "cloud.demo.storage.external.note",
    "cloud.demo.footprint.title",
    "cloud.demo.footprint.region",
    "cloud.demo.footprint.backups",
    "cloud.demo.footprint.egress",
    "cloud.demo.footprint.egressVal",
    "cloud.demo.footprint.network",
    "cloud.demo.footprint.networkLocal",
    "cloud.demo.footprint.networkExternal",
    "cloud.demo.warning.title",
    "cloud.demo.warning.body",
] as const;

export type CloudTopologyStrings = Record<(typeof CLOUD_TOPOLOGY_STRINGS)[number], string>;

type AppTenancy = "shared" | "reserved" | "dedicated";
type DbMode = "dedicated" | "external";
type StorageMode = "managed" | "external";

const APP_SPECS: Record<AppTenancy, { machine: string; qos: string }> = {
    shared: { machine: "Hetzner CX / CPX · burstable", qos: "Burstable pod" },
    reserved: { machine: "Hetzner CPX · guaranteed", qos: "Guaranteed QoS" },
    dedicated: { machine: "Hetzner CCX · dedicated node", qos: "Isolated host" },
};

export function CloudTopologyDemo({ s }: { s: CloudTopologyStrings }) {
    const [appTenancy, setAppTenancy] = useState<AppTenancy>("reserved");
    const [dbMode, setDbMode] = useState<DbMode>("dedicated");
    const [storageMode, setStorageMode] = useState<StorageMode>("managed");

    const crossBoundary = dbMode === "external";
    const appSpec = APP_SPECS[appTenancy];

    const appNote =
        appTenancy === "shared"
            ? s["cloud.demo.app.shared.note"]
            : appTenancy === "reserved"
              ? s["cloud.demo.app.reserved.note"]
              : s["cloud.demo.app.dedicated.note"];

    return (
        <div className="frame overflow-hidden">
            <div className="frame-head">
                <span>{s["cloud.demo.footprint.title"]}</span>
                <span className="ml-auto font-mono text-2xs text-tone-400">eu-central-1 · Hetzner</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-tone-max/8">
                {/* Left: interactive resource dials */}
                <div className="lg:col-span-6 p-6 sm:p-8 flex flex-col gap-7 min-w-0">
                    {/* App runtime */}
                    <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.16em] text-tone-300">
                                <Server size={14} className="text-primary-light shrink-0" aria-hidden="true" />
                                {s["cloud.demo.app.label"]}
                            </span>
                            <span className="font-mono text-2xs text-tone-400">{appSpec.qos}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2" role="group" aria-label={s["cloud.demo.app.label"]}>
                            {(["shared", "reserved", "dedicated"] as const).map((tier) => {
                                const active = appTenancy === tier;
                                return (
                                    <button
                                        key={tier}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => setAppTenancy(tier)}
                                        className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                                            active
                                                ? "border-primary bg-primary/15 text-tone-max"
                                                : "border-tone-max/10 bg-tone-max/[0.02] text-tone-400 hover:border-tone-max/20 hover:text-tone-200"
                                        }`}
                                    >
                                        {s[`cloud.demo.app.${tier}`]}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="mt-2.5 text-xs leading-relaxed text-page-copy">{appNote}</p>
                    </div>

                    {/* Database */}
                    <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.16em] text-tone-300">
                                <Database size={14} className="text-cyan-300 shrink-0" aria-hidden="true" />
                                {s["cloud.demo.db.label"]}
                            </span>
                            <span className="font-mono text-2xs text-tone-400">
                                {dbMode === "dedicated" ? "CNPG · PG 17" : "BYODB"}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2" role="group" aria-label={s["cloud.demo.db.label"]}>
                            {(["dedicated", "external"] as const).map((mode) => {
                                const active = dbMode === mode;
                                return (
                                    <button
                                        key={mode}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => setDbMode(mode)}
                                        className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                                            active
                                                ? "border-primary bg-primary/15 text-tone-max"
                                                : "border-tone-max/10 bg-tone-max/[0.02] text-tone-400 hover:border-tone-max/20 hover:text-tone-200"
                                        }`}
                                    >
                                        {s[`cloud.demo.db.${mode}`]}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="mt-2.5 text-xs leading-relaxed text-page-copy">
                            {dbMode === "dedicated" ? s["cloud.demo.db.dedicated.note"] : s["cloud.demo.db.external.note"]}
                        </p>
                    </div>

                    {/* Storage */}
                    <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.16em] text-tone-300">
                                <HardDrive size={14} className="text-emerald-400 shrink-0" aria-hidden="true" />
                                {s["cloud.demo.storage.label"]}
                            </span>
                            <span className="font-mono text-2xs text-tone-400">
                                {storageMode === "managed" ? "Hetzner S3" : "BYOS"}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2" role="group" aria-label={s["cloud.demo.storage.label"]}>
                            {(["managed", "external"] as const).map((mode) => {
                                const active = storageMode === mode;
                                return (
                                    <button
                                        key={mode}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => setStorageMode(mode)}
                                        className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                                            active
                                                ? "border-primary bg-primary/15 text-tone-max"
                                                : "border-tone-max/10 bg-tone-max/[0.02] text-tone-400 hover:border-tone-max/20 hover:text-tone-200"
                                        }`}
                                    >
                                        {s[`cloud.demo.storage.${mode}`]}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="mt-2.5 text-xs leading-relaxed text-page-copy">
                            {storageMode === "managed"
                                ? s["cloud.demo.storage.managed.note"]
                                : s["cloud.demo.storage.external.note"]}
                        </p>
                    </div>
                </div>

                {/* Right: live resolved topology readout */}
                <div className="lg:col-span-6 p-6 sm:p-8 bg-surface-frame/50 flex flex-col justify-between gap-6 min-w-0">
                    <div className="flex flex-col gap-3">
                        <div className="rounded-lg border border-tone-max/10 bg-surface-card/70 px-4 py-3 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-tone-100">{s["cloud.demo.app.label"]}</p>
                                <p className="mt-0.5 font-mono text-2xs text-tone-400 truncate">{appSpec.machine}</p>
                            </div>
                            <span className="shrink-0 rounded-md border border-tone-max/10 bg-tone-max/[0.04] px-2 py-0.5 font-mono text-2xs text-primary-light">
                                fsn1
                            </span>
                        </div>

                        <div className="rounded-lg border border-tone-max/10 bg-surface-card/70 px-4 py-3 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-tone-100">{s["cloud.demo.db.label"]}</p>
                                <p className="mt-0.5 font-mono text-2xs text-tone-400 truncate">
                                    {dbMode === "dedicated"
                                        ? "CloudNativePG · PostgreSQL 17 · 10 GiB+"
                                        : "External PostgreSQL · DATABASE_URL"}
                                </p>
                            </div>
                            <span className="shrink-0 rounded-md border border-tone-max/10 bg-tone-max/[0.04] px-2 py-0.5 font-mono text-2xs text-cyan-300">
                                {dbMode === "dedicated" ? "fsn1 → nbg1" : "external"}
                            </span>
                        </div>

                        <div className="rounded-lg border border-tone-max/10 bg-surface-card/70 px-4 py-3 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-tone-100">{s["cloud.demo.storage.label"]}</p>
                                <p className="mt-0.5 font-mono text-2xs text-tone-400 truncate">
                                    {storageMode === "managed"
                                        ? "Hetzner Object Storage · /api/storage"
                                        : "External S3 / R2 / GCS · /api/storage"}
                                </p>
                            </div>
                            <span className="shrink-0 rounded-md border border-tone-max/10 bg-tone-max/[0.04] px-2 py-0.5 font-mono text-2xs text-emerald-400">
                                {storageMode === "managed" ? "managed S3" : "BYOS"}
                            </span>
                        </div>
                    </div>

                    {crossBoundary && (
                        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 flex items-start gap-3">
                            <AlertTriangle size={16} className="shrink-0 text-amber-300 mt-0.5" aria-hidden="true" />
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-tone-100">{s["cloud.demo.warning.title"]}</p>
                                <p className="mt-1 text-xs leading-relaxed text-tone-300">{s["cloud.demo.warning.body"]}</p>
                            </div>
                        </div>
                    )}

                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-tone-max/8 text-xs">
                        <div className="min-w-0">
                            <dt className="flex items-center gap-1.5 font-mono text-3xs uppercase tracking-[0.14em] text-tone-500">
                                <Globe size={12} aria-hidden="true" />
                                {s["cloud.demo.footprint.region"]}
                            </dt>
                            <dd className="mt-1 font-mono text-xs text-tone-200 truncate">Falkenstein, DE (fsn1)</dd>
                        </div>
                        <div className="min-w-0">
                            <dt className="flex items-center gap-1.5 font-mono text-3xs uppercase tracking-[0.14em] text-tone-500">
                                <ShieldCheck size={12} aria-hidden="true" />
                                {s["cloud.demo.footprint.backups"]}
                            </dt>
                            <dd className="mt-1 font-mono text-xs text-tone-200 truncate">
                                {dbMode === "dedicated" ? "Nuremberg, DE (nbg1)" : "Managed by your DB host"}
                            </dd>
                        </div>
                        <div className="min-w-0">
                            <dt className="font-mono text-3xs uppercase tracking-[0.14em] text-tone-500">
                                {s["cloud.demo.footprint.network"]}
                            </dt>
                            <dd className="mt-1 font-mono text-xs text-tone-200 truncate">
                                {crossBoundary
                                    ? s["cloud.demo.footprint.networkExternal"]
                                    : s["cloud.demo.footprint.networkLocal"]}
                            </dd>
                        </div>
                        <div className="min-w-0">
                            <dt className="font-mono text-3xs uppercase tracking-[0.14em] text-tone-500">
                                {s["cloud.demo.footprint.egress"]}
                            </dt>
                            <dd className="mt-1 font-mono text-xs text-tone-200 truncate">
                                {s["cloud.demo.footprint.egressVal"]}
                            </dd>
                        </div>
                    </dl>
                </div>
            </div>
        </div>
    );
}

export default CloudTopologyDemo;

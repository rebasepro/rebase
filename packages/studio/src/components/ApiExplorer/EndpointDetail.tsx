import React from "react";
import {
    ArrowRightFromLineIcon,
    Chip,
    cls,
    defaultBorderMixin,
    iconSize,
    SlidersHorizontalIcon,
    Typography,
    UploadIcon
} from "@rebasepro/ui";
import type { ParsedEndpoint, OpenApiSpec, OpenApiSchema } from "./types";
import { resolveRef, resolveRefName } from "./parseSpec";

/**
 * Renders the documentation view for a single API endpoint:
 * parameters, request body schema, response schemas.
 */
export function EndpointDetail({ endpoint, spec }: { endpoint: ParsedEndpoint; spec: OpenApiSpec }) {
    return (
        <div className="p-6 space-y-8 max-w-4xl">
            {/* Summary / Description */}
            {(endpoint.summary || endpoint.description) && (
                <div>
                    {endpoint.summary && (
                        <Typography variant="h6" className="font-semibold mb-1">
                            {endpoint.summary}
                        </Typography>
                    )}
                    {endpoint.description && (
                        <Typography variant="body2" className="text-text-secondary dark:text-text-secondary-dark">
                            {endpoint.description}
                        </Typography>
                    )}
                </div>
            )}

            {/* Parameters */}
            {endpoint.parameters.length > 0 && (
                <section>
                    <SectionHeading icon={<SlidersHorizontalIcon size={iconSize.small} className="text-text-secondary dark:text-text-secondary-dark" />} title="Parameters"/>
                    <div className={cls("rounded-lg border overflow-hidden", defaultBorderMixin)}>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-surface-100 dark:bg-surface-900 text-left">
                                    <th className="px-4 py-2 font-medium text-text-secondary dark:text-text-secondary-dark">
                                        Name
                                    </th>
                                    <th className="px-4 py-2 font-medium text-text-secondary dark:text-text-secondary-dark">
                                        In
                                    </th>
                                    <th className="px-4 py-2 font-medium text-text-secondary dark:text-text-secondary-dark">
                                        Type
                                    </th>
                                    <th className="px-4 py-2 font-medium text-text-secondary dark:text-text-secondary-dark">
                                        Description
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {endpoint.parameters.map((p, i) => (
                                    <tr
                                        key={p.name + i}
                                        className={cls("border-t", defaultBorderMixin)}
                                    >
                                        <td className="px-4 py-2.5">
                                            <code className="text-xs font-mono font-semibold">{p.name}</code>
                                            {p.required && <span className="text-red-500 ml-1 text-xs">*</span>}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <Chip
                                                size="smallest"
                                                colorScheme={p.in === "path" ? "orangeDarker" : "cyanDarker"}
                                            >
                                                {p.in}
                                            </Chip>
                                        </td>
                                        <td className="px-4 py-2.5 text-xs font-mono text-text-secondary dark:text-text-secondary-dark">
                                            {schemaTypeLabel(p.schema)}
                                        </td>
                                        <td className="px-4 py-2.5 text-xs text-text-secondary dark:text-text-secondary-dark">
                                            {p.description ?? "—"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* Request Body */}
            {endpoint.requestBody && (
                <section>
                    <SectionHeading icon={<UploadIcon size={iconSize.small} className="text-text-secondary dark:text-text-secondary-dark" />} title="Request Body"/>
                    {Object.entries(endpoint.requestBody.content ?? {}).map(([contentType, media]) => (
                        <div key={contentType}>
                            <Chip size="smallest" colorScheme="blueDarker" className="mb-3">
                                {contentType}
                            </Chip>
                            {media.schema && <SchemaBlock schema={media.schema} spec={spec} depth={0}/>}
                        </div>
                    ))}
                </section>
            )}

            {/* Responses */}
            <section>
                <SectionHeading icon={<ArrowRightFromLineIcon size={iconSize.small} className="text-text-secondary dark:text-text-secondary-dark" />} title="Responses"/>
                <div className="space-y-3">
                    {Object.entries(endpoint.responses).map(([code, res]) => (
                        <div
                            key={code}
                            className={cls("rounded-lg border overflow-hidden", defaultBorderMixin)}
                        >
                            <div
                                className={cls(
                                    "flex items-center gap-3 px-4 py-2.5",
                                    "bg-surface-50 dark:bg-surface-900/50"
                                )}
                            >
                                <StatusBadge code={code}/>
                                <Typography
                                    variant="body2"
                                    className="text-text-secondary dark:text-text-secondary-dark text-xs"
                                >
                                    {res.description}
                                </Typography>
                            </div>
                            {res.content &&
                                Object.entries(res.content).map(
                                    ([ct, media]) =>
                                        media.schema && (
                                            <div
                                                key={ct}
                                                className={cls("px-4 py-3 border-t", defaultBorderMixin)}
                                            >
                                                <SchemaBlock schema={media.schema} spec={spec} depth={0}/>
                                            </div>
                                        )
                                )}
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

/* ── Schema Block ─────────────────────────────────────────────────── */

function SchemaBlock({ schema, spec, depth }: { schema: OpenApiSchema; spec: OpenApiSpec; depth: number }) {
    // Resolve $ref
    if (schema.$ref) {
        const name = resolveRefName(schema.$ref);
        const resolved = resolveRef(spec, schema.$ref) as OpenApiSchema;
        return (
            <div>
                <Typography
                    variant="caption"
                    className="text-primary dark:text-primary-dark font-mono text-xs mb-2 block"
                >
                    {name}
                </Typography>
                <SchemaBlock schema={resolved} spec={spec} depth={depth}/>
            </div>
        );
    }

    // Object with properties
    if (schema.properties) {
        const required = new Set(schema.required ?? []);
        return (
            <div
                className={cls(
                    "rounded-lg overflow-hidden",
                    depth > 0 && `border ml-4 mt-1 ${defaultBorderMixin}`
                )}
            >
                <table className="w-full text-xs">
                    <tbody>
                        {Object.entries(schema.properties).map(([key, prop]) => (
                            <tr
                                key={key}
                                className={cls("border-t first:border-t-0", defaultBorderMixin)}
                            >
                                <td className="px-3 py-2 align-top w-36">
                                    <code className="font-mono font-semibold text-text-primary dark:text-text-primary-dark">
                                        {key}
                                    </code>
                                    {required.has(key) && <span className="text-red-500 ml-0.5">*</span>}
                                    {prop.readOnly && (
                                        <span className="ml-1.5 text-[9px] text-text-secondary dark:text-text-secondary-dark italic">
                                            read-only
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2 align-top w-28">
                                    <span className="font-mono text-text-secondary dark:text-text-secondary-dark">
                                        {schemaTypeLabel(prop)}
                                    </span>
                                </td>
                                <td className="px-3 py-2 align-top text-text-secondary dark:text-text-secondary-dark">
                                    {prop.description ?? ""}
                                    {prop.enum && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {prop.enum.map((v) => (
                                                <span
                                                    key={String(v)}
                                                    className="px-1.5 py-0.5 rounded bg-surface-200 dark:bg-surface-800 text-[10px] font-mono"
                                                >
                                                    {String(v)}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {prop.properties && <SchemaBlock schema={prop} spec={spec} depth={depth + 1}/>}
                                    {prop.$ref && <SchemaBlock schema={prop} spec={spec} depth={depth + 1}/>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    // Array
    if (schema.type === "array" && schema.items) {
        return (
            <div>
                <span className="font-mono text-xs text-text-secondary dark:text-text-secondary-dark">Array of:</span>
                <SchemaBlock schema={schema.items} spec={spec} depth={depth + 1}/>
            </div>
        );
    }

    // Primitive
    return (
        <span className="font-mono text-xs text-text-secondary dark:text-text-secondary-dark">
            {schemaTypeLabel(schema)}
        </span>
    );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function schemaTypeLabel(schema?: OpenApiSchema): string {
    if (!schema) return "any";
    if (schema.$ref) return resolveRefName(schema.$ref);
    if (schema.type === "array") return `${schemaTypeLabel(schema.items)}[]`;
    if (schema.format) return `${schema.type} (${schema.format})`;
    return schema.type ?? "object";
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            {icon}
            <Typography variant="subtitle2" className="font-semibold text-sm">
                {title}
            </Typography>
        </div>
    );
}

function StatusBadge({ code }: { code: string }) {
    const n = parseInt(code, 10);
    const color =
        n < 300
            ? "text-emerald-600 dark:text-emerald-400"
            : n < 400
              ? "text-blue-600 dark:text-blue-400"
              : n < 500
                ? "text-amber-600 dark:text-amber-400"
                : "text-red-600 dark:text-red-400";

    return <span className={cls("text-xs font-semibold font-mono", color)}>{code}</span>;
}

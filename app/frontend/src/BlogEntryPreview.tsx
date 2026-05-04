import React from "react";
import type { EntityCustomViewParams } from "@rebasepro/types";

/**
 * Custom entity view that renders a real-time blog post preview.
 * Uses `modifiedValues` to show live updates as the user types in the form.
 *
 * Inspired by the original FireCMS demo blog preview.
 */
export function BlogEntryPreview({
    entity,
    modifiedValues,
}: EntityCustomViewParams) {
    const values = { ...entity?.values, ...modifiedValues } as Record<string, any>;

    const title = values.title ?? "Untitled Blog Post";
    const heroImage = values.hero_image;
    const excerpt = values.excerpt;
    const content = values.content as Array<{ type: string; value: string }> | undefined;
    const status = values.status;
    const publishDate = values.publish_date;

    return (
        <div style={styles.container}>
            <div style={styles.article}>
                {/* Status badge */}
                {status && (
                    <div style={styles.statusRow}>
                        <span style={{
                            ...styles.statusBadge,
                            backgroundColor: statusColors[status] ?? "#888",
                        }}>
                            {status.replace("_", " ").toUpperCase()}
                        </span>
                        {publishDate && (
                            <span style={styles.date}>
                                {new Date(publishDate).toLocaleDateString("en-US", {
                                    year: "numeric",
                                    month: "long",
                                    day: "numeric",
                                })}
                            </span>
                        )}
                    </div>
                )}

                {/* Hero image */}
                {heroImage && (
                    <div style={styles.heroContainer}>
                        <img
                            src={heroImage}
                            alt={title}
                            style={styles.heroImage}
                        />
                    </div>
                )}

                {/* Title */}
                <h1 style={styles.title}>{title}</h1>

                {/* Excerpt */}
                {excerpt && (
                    <p style={styles.excerpt}>{excerpt}</p>
                )}

                {/* Divider */}
                <hr style={styles.divider} />

                {/* Content blocks */}
                {content && content.length > 0 ? (
                    <div style={styles.contentBlocks}>
                        {content.map((block, index) => (
                            <div key={index} style={styles.block}>
                                {block.type === "text" && block.value && (
                                    <div
                                        style={styles.textBlock}
                                        dangerouslySetInnerHTML={{
                                            __html: simpleMarkdownToHtml(block.value),
                                        }}
                                    />
                                )}
                                {block.type === "image" && block.value && (
                                    <div style={styles.imageBlock}>
                                        <img
                                            src={block.value}
                                            alt={`Content image ${index + 1}`}
                                            style={styles.contentImage}
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p style={styles.emptyContent}>
                        Start adding content blocks in the form to see a live preview here.
                    </p>
                )}
            </div>
        </div>
    );
}

// ── Simple markdown → HTML converter ──────────────────────────────────
// Converts basic markdown syntax to HTML for the preview.
// Not a full parser — just enough for headings, bold, italic, links, and paragraphs.
function simpleMarkdownToHtml(md: string): string {
    let html = md
        // Headings
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        // Bold
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        // Italic
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        // Inline code
        .replace(/`(.+?)`/g, "<code style='background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:0.9em'>$1</code>")
        // Links
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#4f46e5">$1</a>')
        // Line breaks → paragraphs
        .replace(/\n\n/g, "</p><p>")
        .replace(/\n/g, "<br/>");

    return `<p>${html}</p>`;
}

// ── Status colors ─────────────────────────────────────────────────────
const statusColors: Record<string, string> = {
    draft: "#6b7280",
    needs_review: "#f59e0b",
    published: "#10b981",
    archived: "#ef4444",
};

// ── Styles ────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
    container: {
        width: "100%",
        height: "100%",
        overflowY: "auto",
        backgroundColor: "#fafafa",
        display: "flex",
        justifyContent: "center",
        padding: "32px 16px",
    },
    article: {
        maxWidth: 720,
        width: "100%",
        backgroundColor: "#fff",
        borderRadius: 12,
        padding: "40px 48px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)",
    },
    statusRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 20,
    },
    statusBadge: {
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        padding: "3px 10px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
    },
    date: {
        color: "#9ca3af",
        fontSize: 13,
    },
    heroContainer: {
        width: "100%",
        borderRadius: 8,
        overflow: "hidden",
        marginBottom: 28,
    },
    heroImage: {
        width: "100%",
        height: "auto",
        display: "block",
        objectFit: "cover" as const,
        maxHeight: 360,
    },
    title: {
        fontSize: 32,
        fontWeight: 800,
        lineHeight: 1.2,
        margin: "0 0 16px 0",
        color: "#111827",
    },
    excerpt: {
        fontSize: 18,
        lineHeight: 1.6,
        color: "#6b7280",
        margin: "0 0 24px 0",
        fontStyle: "italic",
    },
    divider: {
        border: "none",
        borderTop: "1px solid #e5e7eb",
        margin: "24px 0",
    },
    contentBlocks: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 24,
    },
    block: {},
    textBlock: {
        fontSize: 16,
        lineHeight: 1.75,
        color: "#374151",
    },
    imageBlock: {
        borderRadius: 8,
        overflow: "hidden",
    },
    contentImage: {
        width: "100%",
        height: "auto",
        display: "block",
    },
    emptyContent: {
        color: "#9ca3af",
        fontStyle: "italic",
        textAlign: "center" as const,
        padding: "40px 0",
        fontSize: 15,
    },
};

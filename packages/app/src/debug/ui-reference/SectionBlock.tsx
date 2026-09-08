import React from "react";
import { cls, defaultBorderMixin, Typography } from "@rebasepro/ui";

/**
 * One chapter of the UI reference page.
 *
 * `max-w-5xl` and `border-b` cannot share an element here. Several mocks are
 * app-scale and intrinsically wider than 64rem (the CRM dashboard reaches
 * 1483px), so a section's own rule used to stop at 1264px while its content
 * ran past it, and every such section read as a broken edge.
 *
 * Split instead: the SECTION spans the column, so its rule always reaches its
 * own edges; the CONTENT keeps a measure, so a form column never stretches to
 * 700px on a wide monitor. `wide` opts the app-scale mocks out of the measure;
 * they pair it with `overflow-x-auto` so they scroll inside themselves rather
 * than pushing the page.
 */
export function SectionBlock({ id, title, wide, children }: { id: string; title: string; wide?: boolean; children: React.ReactNode }) {
    return (
        <section id={id} className={cls("px-6 py-8 border-b scroll-mt-0", defaultBorderMixin)}>
            <div className={wide ? undefined : "max-w-5xl"}>
                <Typography variant="h5" className="mb-1">{title}</Typography>
                <div className="mt-4">{children}</div>
            </div>
        </section>
    );
}

/** The small monospace caption this page uses to name a specimen. */
export function SpecimenLabel({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <Typography variant="caption" color="secondary" className={cls("block mb-2 font-mono", className)}>
            {children}
        </Typography>
    );
}

/** A 6px hue dot: the product's status vocabulary. `className` carries the hue. */
export function Dot({ className }: { className: string }) {
    return <span aria-hidden className={cls("inline-block w-1.5 h-1.5 rounded-full shrink-0", className)}/>;
}

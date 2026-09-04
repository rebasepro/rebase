import React from "react";
import { useCurrentFrame } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { Frame } from "../components/Frame";
import { Code, CodeCaption } from "../components/Code";
import { ramp, ENTER } from "../components/motion";
import { FONT, INK, PRIMARY_LIGHT } from "../theme";

/**
 * 03 · ONE DEFINITION, EVERY SURFACE — 235 frames.
 *
 * Claim 2 of the four the product is allowed to lead with, and the reason the
 * ground is RAISED: this is a machine being opened, not evidence being shown.
 *
 * The six surfaces hang off one spine that draws down the middle of the frame.
 * Six connectors from the file to six cards would be more literal and much
 * worse — a bundle of curves says "integration diagram", and the claim is the
 * opposite of an integration: there is no second data model to connect to.
 */

const COLLECTION = `import { defineCollection } from "@rebasepro/cms-types";

export const orders = defineCollection({
    name: "Orders",
    slug: "orders",
    table: "orders",
    properties: {
        reference: { name: "Reference", type: "string" },
        total:     { name: "Total",     type: "number" },
        status:    { name: "Status",    type: "string" },
        customer:  { name: "Customer",  type: "reference",
                     collection: "customers" }
    },
    securityRules: [
        { operation: "select",
          using: "customer_id = rebase.uid()" }
    ]
});`;

const SURFACES: [string, string][] = [
    ["Drizzle schema", "Typed tables and relations"],
    ["REST routes", "CRUD, filters, pagination"],
    ["OpenAPI spec", "Generated, always current"],
    ["Typed SDK", "Accessors, not string paths"],
    ["RLS policies", "Applied by migration"],
    /* NOT "Optional". The film stopped selling the panel as a thing you might
       skip two commits ago, and this label was still saying it. */
    ["Admin panel", "Rendered from the same file"],
];

export const S03_OneDefinition: React.FC = () => {
    const frame = useCurrentFrame();

    // The spine draws downward as the surfaces land, so the line is always
    // just ahead of the row it is about to introduce.
    const spine = ramp(frame, 56, 82, ENTER);

    return (
        <Scene>
            <Stage>
                <Chapter n="02" label="One definition, every surface" delay={4} />
                <div style={{ marginTop: 22, marginBottom: 52 }}>
                    <DisplayLine size={DISPLAY.statement} delay={10}>There is no second data model.</DisplayLine>
                </div>

                {/* `stretch`, not `flex-start`: the two columns have to be the
                    same height for the list to align to the frame at all. The
                    right column then pads down past the file caption, so its
                    first item starts level with the frame's top edge, and
                    space-between lands its last item on the frame's bottom.
                    Before this the list ran 295-800 against a frame at
                    318-960 — two columns that were meant to read as one
                    statement and shared neither a top nor a bottom. */}
                <div style={{ display: "flex", gap: 76, alignItems: "stretch" }}>
                    <div style={{ width: 780, flexShrink: 0 }}>
                        <CodeCaption delay={20}>collections/orders.ts</CodeCaption>
                        <Frame
                            delay={22}
                            style={{ marginTop: 12 }}
                            bodyStyle={{ padding: "26px 30px" }}
                        >
                            <Code code={COLLECTION} delay={34} step={2} size={18} />
                        </Frame>
                    </div>

                    <div
                        style={{
                            position: "relative",
                            flex: 1,
                            paddingLeft: 44,
                            // Clears the file caption above the frame (13px
                            // mono + its 12px margin) so the two columns start
                            // on the same line.
                            paddingTop: 34,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                        }}
                    >
                        {/* The spine. */}
                        <div
                            style={{
                                position: "absolute",
                                left: 0,
                                top: 44,
                                width: 1,
                                height: `${spine * 100}%`,
                                background: `linear-gradient(to bottom, ${PRIMARY_LIGHT}, ${INK.rule})`,
                            }}
                        />
                        {SURFACES.map(([label, note], i) => {
                            const t = ramp(frame, 62 + i * 11, 22);
                            return (
                                <div
                                    key={label}
                                    style={{
                                        position: "relative",
                                        opacity: t,
                                        transform: `translateX(${(1 - t) * 22}px)`,
                                    }}
                                >
                                    {/* The tick that attaches this row to the spine. */}
                                    <div
                                        style={{
                                            position: "absolute",
                                            left: -44,
                                            top: 15,
                                            width: 28,
                                            height: 1,
                                            background: INK.rule,
                                        }}
                                    />
                                    <div
                                        style={{
                                            fontFamily: FONT.display,
                                            fontWeight: 600,
                                            fontSize: 30,
                                            letterSpacing: "-0.018em",
                                            color: INK.high,
                                        }}
                                    >
                                        {label}
                                    </div>
                                    <div
                                        style={{
                                            fontFamily: FONT.body,
                                            fontSize: 19,
                                            color: INK.muted,
                                            marginTop: 3,
                                        }}
                                    >
                                        {note}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </Stage>
        </Scene>
    );
};

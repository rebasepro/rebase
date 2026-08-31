import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp } from "../components/motion";
import { CHROMA, FONT, INK, TRACKING } from "../theme";

/**
 * CANDIDATE — who can see what.
 *
 * A matrix: collections down, roles across, and the verdict in every cell. It
 * is the only two-dimensional layout in the film, and it is the right one for
 * the claim it carries — "granular per collection, per operation, per role" is
 * a sentence nobody can picture, and a grid with a hundred and twenty answers
 * in it is the picture.
 *
 * The headline does NOT count the cells. It said "a hundred and twenty
 * answers" and the grid holds forty — a number invented to sound like the
 * point rather than to be true, in a scene whose whole subject is that the
 * database does not take anyone's word for anything.
 *
 * The verdicts are the interesting part, not the ticks. Half the cells are
 * neither yes nor no: `own` is a policy with a USING clause, `pub` is a policy
 * with a status predicate. A permissions table that only said allow and deny
 * would be describing a simpler product than this one.
 *
 * Cells fill row by row and fast. Reading any single cell is not the point —
 * the shape of the grid is, and the shape says that access is not one switch.
 */

const ROLES = ["anon", "authenticated", "customer", "support", "admin"];

type V = "all" | "own" | "read" | "pub" | "self" | "none";

const VERDICT: Record<V, { label: string; hue: string; fill: number }> = {
    all: { label: "all rows", hue: CHROMA.cyan, fill: 0.16 },
    own: { label: "own rows", hue: CHROMA.yellow, fill: 0.14 },
    self: { label: "self", hue: CHROMA.yellow, fill: 0.14 },
    read: { label: "read", hue: CHROMA.violet, fill: 0.14 },
    pub: { label: "published", hue: CHROMA.violet, fill: 0.14 },
    none: { label: "—", hue: "#6A6A6A", fill: 0.03 },
};

const ROWS: { table: string; cells: V[] }[] = [
    { table: "products", cells: ["read", "read", "read", "read", "all"] },
    { table: "orders", cells: ["none", "own", "own", "all", "all"] },
    { table: "order_items", cells: ["none", "own", "own", "all", "all"] },
    { table: "customers", cells: ["none", "own", "own", "all", "all"] },
    { table: "tickets", cells: ["none", "own", "own", "all", "all"] },
    { table: "posts", cells: ["pub", "pub", "pub", "pub", "all"] },
    { table: "authors", cells: ["read", "read", "read", "read", "all"] },
    { table: "users", cells: ["none", "self", "self", "none", "all"] },
];

const X = 214;
const NAME_W = 268;
const CELL_W = 244;
const CELL_H = 66;
const GAP = 10;
const TOP = 232;
const HEAD = 52;

/** Row by row, left to right, fast. */
const cellAt = (r: number, c: number) => 30 + r * 11 + c * 3;

export const Matrix: React.FC = () => {
    const frame = useCurrentFrame();

    return (
        <AbsoluteFill>
            <div
                style={{
                    position: "absolute",
                    left: X,
                    top: 118,
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    opacity: ramp(frame, 4, 16),
                }}
            >
                <span
                    style={{
                        fontFamily: FONT.body,
                        fontSize: 14,
                        fontWeight: 600,
                        color: INK.muted,
                        textTransform: "uppercase",
                        letterSpacing: TRACKING.eyebrow,
                    }}
                >
                    Row-level security
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: 14, color: INK.muted }}>
                    · 8 collections × 5 roles · 26 policies
                </span>
            </div>

            {ROLES.map((role, c) => (
                <div
                    key={role}
                    style={{
                        position: "absolute",
                        left: X + NAME_W + c * (CELL_W + GAP),
                        top: TOP,
                        width: CELL_W,
                        fontFamily: FONT.mono,
                        fontSize: 16,
                        color: INK.copy,
                        opacity: ramp(frame, 14 + c * 4, 16),
                    }}
                >
                    {role}
                </div>
            ))}

            {ROWS.map((row, r) => (
                <React.Fragment key={row.table}>
                    <div
                        style={{
                            position: "absolute",
                            left: X,
                            top: TOP + HEAD + r * (CELL_H + GAP) + 20,
                            width: NAME_W,
                            fontFamily: FONT.mono,
                            fontSize: 19,
                            color: INK.high,
                            opacity: ramp(frame, 24 + r * 8, 16),
                        }}
                    >
                        {row.table}
                    </div>

                    {row.cells.map((v, c) => {
                        const spec = VERDICT[v];
                        const up = ramp(frame, cellAt(r, c), 13);
                        return (
                            <div
                                key={`${row.table}-${ROLES[c]}`}
                                style={{
                                    position: "absolute",
                                    left: X + NAME_W + c * (CELL_W + GAP),
                                    top: TOP + HEAD + r * (CELL_H + GAP),
                                    width: CELL_W,
                                    height: CELL_H,
                                    borderRadius: 10,
                                    background: `${spec.hue}${Math.round(spec.fill * 255)
                                        .toString(16)
                                        .padStart(2, "0")}`,
                                    border: `1px solid ${spec.hue}${v === "none" ? "1A" : "40"}`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontFamily: FONT.mono,
                                    fontSize: 15,
                                    color: v === "none" ? INK.muted : spec.hue,
                                    opacity: up,
                                }}
                            >
                                {spec.label}
                            </div>
                        );
                    })}
                </React.Fragment>
            ))}

            <div
                style={{
                    position: "absolute",
                    left: X,
                    top: 900,
                    width: 1500,
                    fontFamily: FONT.display,
                    fontSize: 44,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: INK.high,
                    opacity: ramp(frame, 168, 26),
                }}
            >
                Access is not a switch.
            </div>
            <div
                style={{
                    position: "absolute",
                    left: X,
                    top: 964,
                    width: 1440,
                    fontFamily: FONT.body,
                    fontSize: 23,
                    color: INK.copy,
                    opacity: ramp(frame, 186, 26),
                }}
            >
                Written once in the collection file, compiled to Postgres policies,
                and enforced where your code cannot forget to ask.
            </div>
        </AbsoluteFill>
    );
};

export const MATRIX_DURATION = 300;

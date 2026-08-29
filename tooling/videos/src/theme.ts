/**
 * The design system, as video tokens.
 *
 * These are not new values. Every one is lifted from the shipped system so a
 * frame of this video and a screenshot of rebase.pro are the same product:
 *
 *   - grounds + chroma  →  website/src/styles/global.css  (@theme)
 *   - surfaces, primary →  packages/ui/src/theme.css
 *   - the six hues      →  website/src/components/NeatBackground.tsx, by way
 *                          of the generated src/data/neat-config.ts
 *
 * The one rule that is easy to break here and hard to see afterwards: the
 * weight ceiling is 600. The display tier separates itself by SIZE and
 * TRACKING, never by reaching for 700. (The old bento renders in this package
 * predate that rule — they are the reason it is written down.)
 */

/** THE FOUR GROUNDS. A scene sits on exactly one, and the ground says what kind
 *  of thing you are being told. See global.css for the full argument. */
export const GROUND = {
    /** EVIDENCE — you are being shown something real. */
    base: "#08090A",
    /** MECHANISM — a machine being opened.
     *
     *  NOT USED AS A FILM GROUND, and the reason is in global.css: RAISED and
     *  LIT ("a Neat canvas") are alternative registers, not layers. A section
     *  is one or the other. The film has ONE continuous Neat plane, so every
     *  scene is already LIT, and putting raised underneath it stacked two
     *  registers that the design language keeps apart.
     *
     *  It looked exactly as wrong as that description sounds. The plane is
     *  screen-blended, so a lifted ground shows through everywhere the ribbon
     *  is dark: measured, the frame's median went 9 -> 22 and the whole shot
     *  turned to flat haze. Three scenes had it and all three read as dirty.
     *
     *  Kept as a token because it is part of the system and the panel surfaces
     *  inside a scene are entitled to it. The FIELD is not. */
    raised: "#14161B",
    /** THE CLAIM the product rests on: security lives in the database. */
    claim: "#0021C1",
    /** THE ASK. The site spends this on its closing CTA; the film does not —
     *  coral only exists at high lightness, so a card on it has to invert to
     *  near-black ink, and fifty seconds of dark strata ending on one bright
     *  pink frame reads as a different piece of film. Kept because it is part
     *  of the system, unspent here. */
    ask: "#FB5066",
    /** THE SECOND FIELD. Ultramarine, already a chroma token and already
     *  documented as field-only: at 1.89:1 it cannot be ink on the page
     *  ground, but white ON it is 10.49:1, which is exactly this use. The film
     *  needs more than one flat colour to have a rhythm, and inventing a hue
     *  to get it would be replacing the design language rather than extending
     *  it. */
    deep: "#2E0EC7",
} as const;

/** The ground a scene sits on. */
export type Ground = keyof typeof GROUND;

/**
 * Ink, per ground. Not one palette — one per surface.
 *
 * `INK.muted` (#797979) is a grey chosen against near-black, where it is a
 * comfortable 4.6:1. On the two chroma fields it is a disaster: **2.4:1 on
 * #0021C1 and 2.3:1 on #2E0EC7**, which is what made the eyebrow on the claim
 * scene and the whole summary line on the agent scene nearly unreadable. Grey
 * only recedes against dark; against a saturated mid-tone it just muddies.
 *
 * So a chroma ground gets WHITE AT ALPHA instead, which recedes by losing
 * contrast with the ground rather than by being a different colour. The design
 * system already knows this — it is why ultramarine is documented as
 * field-only with white type — the film just was not applying it.
 *
 * Card borders and fills move for the same reason: a 9%-white hairline is
 * visible on #08090A and gone on #2E0EC7, so the agent scene's three cards had
 * effectively no edges at all.
 */
export interface Tone {
    high: string;
    copy: string;
    muted: string;
    rule: string;
    cardBorder: string;
    cardFill: string;
}

const DARK_TONE: Tone = {
    high: "#F7F8F8",
    copy: "#B4B8BD",
    muted: "#797979",
    rule: "rgba(255,255,255,0.10)",
    cardBorder: "rgba(255,255,255,0.09)",
    cardFill: "rgba(255,255,255,0.022)",
};

/** Measured on #0021C1: copy 7.6:1, muted 4.8:1. */
const CHROMA_TONE: Tone = {
    high: "#FFFFFF",
    copy: "rgba(255,255,255,0.82)",
    muted: "rgba(255,255,255,0.66)",
    rule: "rgba(255,255,255,0.26)",
    cardBorder: "rgba(255,255,255,0.24)",
    cardFill: "rgba(255,255,255,0.07)",
};

export const TONE: Record<Ground, Tone> = {
    base: DARK_TONE,
    raised: DARK_TONE,
    claim: CHROMA_TONE,
    ask: CHROMA_TONE,
    deep: CHROMA_TONE,
};

export const INK = {
    /** Full-strength type on a dark ground. */
    high: "#F7F8F8",
    /** Body copy. 8.9:1 on base — the reading colour. */
    copy: "#B4B8BD",
    /** Eyebrows and captions. */
    muted: "#797979",
    /** Hairlines. */
    rule: "rgba(255,255,255,0.10)",
    ruleSoft: "rgba(255,255,255,0.06)",
} as const;

/** The product accent. A chroma hue never means "clickable"; this does. */
export const PRIMARY = "#0070F4";
export const PRIMARY_LIGHT = "#4E9BFF";

/** Chroma — the six hues the Neat canvas has been rendering all along.
 *  Marketing only. Ultramarine is 1.89:1 as ink and may only ever be a field. */
export const CHROMA = {
    coral: "#FB5066",
    cyan: "#36CCD6",
    yellow: "#FFC600",
    violet: "#8B6AE6",
    ultramarine: "#2E0EC7",
    blush: "#FF9A9E",
} as const;

/* The six hues are NOT re-exported for the gradient to consume. The gradient
 * is the real @firecms/neat and reads its colours from the generated
 * src/data/neat-config.ts, which is the site's own config — so there is one
 * copy of the palette in play, not two that can disagree. These tokens are
 * here for type and rules only. */

export const FONT = {
    display: "'Instrument Sans', system-ui, sans-serif",
    body: "'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

/** Tracking, keyed to rendered size — not to tag depth. */
export const TRACKING = {
    display: "-0.032em",
    display2: "-0.028em",
    title: "-0.018em",
    heading: "-0.01em",
    eyebrow: "0.22em",
} as const;

/** The one treatment every product surface gets. A demo that draws its own
 *  window chrome must not also get a frame head. */
export const FRAME = {
    radius: 14,
    border: `1px solid ${INK.rule}`,
    background: "#000000",
    boxShadow: [
        "inset 0 1px 0 rgba(255,255,255,0.05)",
        "0 2px 8px rgba(0,0,0,0.5)",
        "0 32px 72px -16px rgba(0,0,0,0.85)",
    ].join(", "),
} as const;

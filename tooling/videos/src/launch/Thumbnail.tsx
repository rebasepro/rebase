import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { NeatCanvas } from "../gradient/NeatCanvas";
import { HERO_TONES } from "../data/neat-config";
import { Mark } from "../components/Mark";
import { CHROMA, FONT, GROUND, INK, RADIUS, SURFACE, TRACKING } from "../theme";

/**
 * YouTube thumbnails for the launch teaser, three ways in.
 *
 * A thumbnail is read at a few hundred pixels wide, in a feed, beside other
 * thumbnails: one claim in as few words as will carry it, set as large as
 * the frame allows, and one piece of the product as proof. Same ground,
 * ribbon, faces and mark as the film, so the click lands where it promised.
 *
 * Rendered at 1920x1080 and scaled to YouTube's 1280x720 on export.
 *
 *   trust  — the agent angle: "Your agent built it. Can you trust it?", with
 *            the API's real refusal (the 403 SCOPE_MISSING body).
 *   panel  — the teaser's own end-card line, with the demo's product cards.
 *   rules  — the claim on the blue field, with the policy the generator
 *            prints for an owner rule (the AS PERMISSIVE … TO line left out).
 */

export type ThumbVariant = "trust" | "panel" | "rules";

const PAD = 110;

/** The site's loud register, as the series films draw it, kept off the
 *  headline: full strength along the top and the right, gone by the middle. */
const Ribbon: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => {
    const fade = "radial-gradient(120% 95% at 100% 0%, #000 30%, transparent 72%)";
    return (
        <NeatCanvas
            framing="hero"
            tone={HERO_TONES.loud}
            opacity={opacity}
            camera={{ cameraX: 0, cameraY: -14, cameraZoom: 2.05, cameraRotationZ: 0.46 }}
            time={1.1}
            style={{ mixBlendMode: "screen", WebkitMaskImage: fade, maskImage: fade }}
        />
    );
};

/** The mark and the name, bottom left, as on the end card. */
const Lockup: React.FC = () => (
    <div style={{ position: "absolute", left: PAD, bottom: 90, display: "flex", alignItems: "center", gap: 22 }}>
        <Mark size={84} animate={false} />
        <span style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 64, color: INK.high, letterSpacing: TRACKING.title }}>Rebase</span>
    </div>
);

const Headline: React.FC<{ children: React.ReactNode; size: number; width?: number; top?: number }> = ({ children, size, width = 1000, top = 120 }) => (
    <div
        style={{
            position: "absolute",
            left: PAD,
            top,
            width,
            fontFamily: FONT.display,
            fontWeight: 600,
            fontSize: size,
            lineHeight: 0.98,
            letterSpacing: TRACKING.display,
            color: INK.high,
        }}
    >
        {children}
    </div>
);

/** A product window, tilted a little toward the viewer. */
const Card: React.FC<{ left: number; top: number; width: number; height?: number; children: React.ReactNode; tilt?: number; border?: string }> = ({
    left,
    top,
    width,
    height,
    children,
    tilt = -4,
    border = SURFACE.hairlineStrong,
}) => (
    <div
        style={{
            position: "absolute",
            left,
            top,
            width,
            height,
            borderRadius: RADIUS.xl * 1.4,
            border: `2px solid ${border}`,
            background: SURFACE.sheet,
            overflow: "hidden",
            transform: `perspective(1800px) rotateY(${tilt}deg)`,
            boxShadow: "0 40px 120px rgba(0,0,0,0.55)",
        }}
    >
        {children}
    </div>
);

const Trust: React.FC = () => (
    <>
        <Headline size={156} width={1150} top={110}>
            Your agent
            <br />
            built it.
            <br />
            Can you <span style={{ color: CHROMA.cyan }}>trust</span> it?
        </Headline>
        <Card left={1150} top={560} width={700} tilt={-8} border={CHROMA.coral}>
            <div style={{ padding: "20px 28px", borderBottom: `1px solid ${SURFACE.hairline}`, fontFamily: FONT.mono, fontSize: 24, color: INK.muted }}>agent · mcp</div>
            <div style={{ padding: "26px 30px 32px", fontFamily: FONT.mono, fontSize: 30, lineHeight: 1.55 }}>
                <div style={{ color: INK.copy }}>
                    <span style={{ color: CHROMA.yellow }}>agent</span> › update_document
                </div>
                <div style={{ color: CHROMA.coral, fontSize: 44, fontWeight: 500, margin: "10px 0 12px" }}>403 SCOPE_MISSING</div>
                <div style={{ color: INK.copy, fontSize: 25 }}>
                    This credential does not hold
                    <br />
                    "data:write" for collection
                    <br />
                    "articles".
                </div>
            </div>
        </Card>
        <Lockup />
    </>
);

const Panel: React.FC = () => (
    <>
        <Headline size={150} width={900} top={150}>
            A backend
            <br />
            for your
            <br />
            <span style={{ color: CHROMA.cyan }}>Postgres.</span>
        </Headline>
        <Card left={1000} top={170} width={1080} height={675} tilt={-10}>
            <OffthreadVideo src={staticFile("demo/panel.mp4")} startFrom={1} muted style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "left top" }} />
        </Card>
        <Lockup />
    </>
);

const Rules: React.FC = () => (
    <>
        <Headline size={176} width={1700} top={120}>
            Postgres keeps
            <br />
            the <span style={{ color: CHROMA.yellow }}>rules.</span>
        </Headline>
        <Card left={PAD} top={560} width={1600} tilt={0} border="rgba(255,255,255,0.22)">
            <div style={{ padding: "28px 34px", fontFamily: FONT.mono, fontSize: 40, lineHeight: 1.5, color: INK.high, whiteSpace: "pre" }}>
                <span style={{ color: "#4E9BFF" }}>CREATE POLICY</span> <span style={{ color: "#34D399" }}>"own_orders"</span> ON <span style={{ color: "#34D399" }}>"public"."orders"</span>
                {"\n"}
                {"  "}
                <span style={{ color: "#4E9BFF" }}>USING</span> ((customer_id)::text = (<span style={{ color: "#4E9BFF" }}>SELECT</span> rebase.uid()));
            </div>
        </Card>
        <div style={{ position: "absolute", right: PAD, bottom: 90, display: "flex", alignItems: "center", gap: 22 }}>
            <Mark size={84} animate={false} />
            <span style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 64, color: INK.high, letterSpacing: TRACKING.title }}>Rebase</span>
        </div>
    </>
);

export const LaunchThumbnail: React.FC<{ variant: ThumbVariant }> = ({ variant }) => (
    <AbsoluteFill style={{ background: variant === "rules" ? GROUND.claim : GROUND.base }}>
        <Ribbon opacity={variant === "rules" ? 0.75 : 1} />
        {variant === "trust" && <Trust />}
        {variant === "panel" && <Panel />}
        {variant === "rules" && <Rules />}
    </AbsoluteFill>
);

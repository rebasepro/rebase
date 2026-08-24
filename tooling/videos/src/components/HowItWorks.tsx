import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence
} from "remotion";

const STEPS = [
  {
    number: "1",
    title: "Connect your Postgres",
    description:
      "Point Rebase at any existing Postgres database. It introspects your schema — tables, types, relations — instantly.",
    code: "$ npx @rebasepro/cli init",
    icon: "🔌"
  },
  {
    number: "2",
    title: "Get everything, instantly",
    description:
      "Admin panel, entity forms, a REST API, typed SDK, and real-time subscriptions — all generated from your schema.",
    code: null,
    icon: "⚡"
  },
  {
    number: "3",
    title: "Extend forever",
    description:
      "Customize with TypeScript. Add callbacks, custom views, business logic, and granular permissions — all version-controlled.",
    code: null,
    icon: "🔧"
  }
] as const;

/**
 * A single animated step card.
 */
const StepCard: React.FC<{
  step: (typeof STEPS)[number];
  index: number;
}> = ({ step, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterDelay = index * 15;

  const progress = spring({
    frame: frame - enterDelay,
    fps,
    config: { damping: 14,
mass: 0.7 }
  });

  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const translateY = interpolate(progress, [0, 1], [60, 0]);
  const scale = interpolate(progress, [0, 1], [0.9, 1]);

  // Number circle glow pulse
  const glowOpacity = interpolate(
    spring({
      frame: frame - enterDelay - 5,
      fps,
      config: { damping: 20,
mass: 1 }
    }),
    [0, 1],
    [0, 0.4]
  );

  return (
    <div
      style={{
        flex: 1,
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center" as const,
        padding: "0 24px",
        position: "relative"
      }}
    >
      {/* Step number circle */}
      <div style={{ position: "relative",
marginBottom: 24 }}>
        <div
          style={{
            position: "absolute",
            inset: -8,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(0,112,244,0.3) 0%, transparent 70%)",
            opacity: glowOpacity
          }}
        />
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "rgba(0,112,244,0.1)",
            border: "2px solid rgba(0,112,244,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 700,
            color: "#0070F4",
            position: "relative"
          }}
        >
          {step.number}
        </div>
      </div>

      {/* Icon */}
      <div style={{ fontSize: 32,
marginBottom: 12 }}>{step.icon}</div>

      {/* Title */}
      <h3
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 24,
          fontWeight: 700,
          color: "#fff",
          marginBottom: 12
        }}
      >
        {step.title}
      </h3>

      {/* Description */}
      <p
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 15,
          fontWeight: 400,
          color: "rgba(255,255,255,0.5)",
          lineHeight: 1.6,
          maxWidth: 320
        }}
      >
        {step.description}
      </p>

      {/* Optional code snippet */}
      {step.code && (
        <div
          style={{
            marginTop: 20,
            padding: "10px 20px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            color: "rgba(255,255,255,0.5)"
          }}
        >
          {step.code}
        </div>
      )}
    </div>
  );
};

/**
 * Connecting line between step circles.
 */
const ConnectingLine: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lineProgress = spring({
    frame: frame - 10,
    fps,
    config: { damping: 30,
mass: 1.2 }
  });

  const width = interpolate(lineProgress, [0, 1], [0, 100]);

  return (
    <div
      style={{
        position: "absolute",
        top: 108,
        left: "22%",
        right: "22%",
        height: 1,
        background: "linear-gradient(90deg, rgba(0,112,244,0.4) 0%, rgba(0,112,244,0.15) 50%, rgba(0,112,244,0.4) 100%)",
        clipPath: `inset(0 ${100 - width}% 0 0)`
      }}
    />
  );
};

/**
 * HowItWorks — three-step animated flow.
 * Duration: ~4 seconds at 30fps (120 frames)
 */
export const HowItWorks: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ── Title entrance ──
  const titleProgress = spring({
    frame,
    fps,
    config: { damping: 16,
mass: 0.7 }
  });
  const titleOpacity = interpolate(titleProgress, [0, 1], [0, 1]);
  const titleY = interpolate(titleProgress, [0, 1], [30, 0]);

  // ── Fade out ──
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp",
extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut,
        padding: "0 80px"
      }}
    >
      {/* Section title */}
      <h2
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 44,
          fontWeight: 700,
          color: "#fff",
          textAlign: "center" as const,
          marginBottom: 60,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`
        }}
      >
        From zero to admin panel in{" "}
        <span style={{ color: "#0070F4" }}>minutes</span>
      </h2>

      {/* Steps row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 40,
          width: "100%",
          maxWidth: 1200,
          position: "relative"
        }}
      >
        <ConnectingLine/>
        {STEPS.map((step, i) => (
          <StepCard key={i} step={step} index={i}/>
        ))}
      </div>
    </AbsoluteFill>
  );
};

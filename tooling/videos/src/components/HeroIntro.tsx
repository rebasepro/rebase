import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { RebaseLogo } from "./RebaseLogo";

/**
 * Animated badge pill with icon and label.
 */
const FeatureBadge: React.FC<{
  label: string;
  icon: string;
  delay: number;
  x: number;
  y: number;
}> = ({ label, icon, delay, x, y }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14,
mass: 0.6 }
  });

  const scale = interpolate(progress, [0, 1], [0.5, 1]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const translateY = interpolate(progress, [0, 1], [20, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `scale(${scale}) translateY(${translateY}px)`,
        opacity,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(255,255,255,0.05)",
        backdropFilter: "blur(12px)",
        fontSize: 14,
        fontWeight: 500,
        color: "rgba(255,255,255,0.7)",
        whiteSpace: "nowrap" as const
      }}
    >
      <span style={{ fontSize: 14,
color: "#0070F4" }}>{icon}</span>
      {label}
    </div>
  );
};

/**
 * A subtle grid of dots in the background.
 */
const GridBackground: React.FC<{ opacity: number }> = ({ opacity }) => {
  const dots: { x: number; y: number; delay: number }[] = [];
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 36; col++) {
      dots.push({
        x: col * 40 + 20,
        y: row * 40 + 20,
        delay: (row + col) * 0.03
      });
    }
  }

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <svg
      width="1440"
      height="810"
      style={{ position: "absolute",
top: 0,
left: 0,
opacity }}
    >
      {dots.map((dot, i) => {
        const dotOpacity = interpolate(
          spring({
            frame: frame - dot.delay * fps,
            fps,
            config: { damping: 100 }
          }),
          [0, 1],
          [0, 0.15]
        );
        return (
          <circle
            key={i}
            cx={dot.x}
            cy={dot.y}
            r={1.5}
            fill="#0070F4"
            opacity={dotOpacity}
          />
        );
      })}
    </svg>
  );
};

/**
 * HeroIntro — cinematic opening with logo, headline, tagline, and feature badges.
 * Duration: ~5 seconds at 30fps (150 frames)
 */
export const HeroIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ── Logo entrance ──
  const logoProgress = spring({
    frame,
    fps,
    config: { damping: 14,
mass: 0.8 }
  });
  const logoScale = interpolate(logoProgress, [0, 1], [0.3, 1]);
  const logoOpacity = interpolate(logoProgress, [0, 1], [0, 1]);
  const logoRotate = interpolate(logoProgress, [0, 1], [180, 0]);

  // ── Headline entrance ──
  const headlineProgress = spring({
    frame: frame - 15,
    fps,
    config: { damping: 16,
mass: 0.7 }
  });
  const headlineOpacity = interpolate(headlineProgress, [0, 1], [0, 1]);
  const headlineY = interpolate(headlineProgress, [0, 1], [40, 0]);

  // ── Tagline entrance ──
  const taglineProgress = spring({
    frame: frame - 28,
    fps,
    config: { damping: 18,
mass: 0.6 }
  });
  const taglineOpacity = interpolate(taglineProgress, [0, 1], [0, 1]);
  const taglineY = interpolate(taglineProgress, [0, 1], [30, 0]);

  // ── Command line entrance ──
  const cmdProgress = spring({
    frame: frame - 45,
    fps,
    config: { damping: 18,
mass: 0.6 }
  });
  const cmdOpacity = interpolate(cmdProgress, [0, 1], [0, 1]);
  const cmdY = interpolate(cmdProgress, [0, 1], [20, 0]);

  // ── Cursor blink for terminal ──
  const cursorVisible = Math.floor(frame / 15) % 2 === 0;

  // ── Typing effect for npx command ──
  const typingStart = 55;
  const command = "npx @rebasepro/cli init";
  const charsTyped = Math.min(
    command.length,
    Math.max(0, Math.floor((frame - typingStart) / 2))
  );
  const displayedCommand = command.slice(0, charsTyped);

  // ── Radial glow pulse ──
  const glowPulse = interpolate(Math.sin(frame / 30), [-1, 1], [0.3, 0.6]);

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
        background:
          "radial-gradient(ellipse at 50% 40%, rgba(0,112,244,0.08) 0%, #000 70%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut
      }}
    >
      <GridBackground opacity={0.6}/>

      {/* Radial glow behind logo */}
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(0,112,244,0.15) 0%, transparent 70%)",
          opacity: glowPulse,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -60%)",
          pointerEvents: "none"
        }}
      />

      {/* Logo */}
      <div
        style={{
          transform: `scale(${logoScale}) rotate(${logoRotate}deg)`,
          opacity: logoOpacity,
          marginBottom: 32
        }}
      >
        <RebaseLogo size={100}/>
      </div>

      {/* Headline */}
      <h1
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 64,
          fontWeight: 800,
          lineHeight: 1.1,
          textAlign: "center" as const,
          color: "#fff",
          opacity: headlineOpacity,
          transform: `translateY(${headlineY}px)`,
          maxWidth: 900
        }}
      >
        Ship your back-office
        <br/>
        in a{" "}
        <span
          style={{
            background:
              "linear-gradient(135deg, #0070F4 0%, #FF3773 50%, #FFA400 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}
        >
          sprint
        </span>
        .
      </h1>

      {/* Tagline */}
      <p
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 22,
          fontWeight: 400,
          color: "rgba(255,255,255,0.55)",
          textAlign: "center" as const,
          maxWidth: 620,
          lineHeight: 1.6,
          marginTop: 20,
          opacity: taglineOpacity,
          transform: `translateY(${taglineY}px)`
        }}
      >
        Admin panel, APIs, and typed SDK — generated from a{" "}
        <span style={{ color: "#fff",
fontWeight: 600 }}>
          single TypeScript schema
        </span>
        .
      </p>

      {/* Terminal command */}
      <div
        style={{
          marginTop: 40,
          opacity: cmdOpacity,
          transform: `translateY(${cmdY}px)`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 28px",
          borderRadius: 12,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 16,
          color: "rgba(255,255,255,0.5)"
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.3)" }}>$</span>
        <span style={{ color: "#0070F4" }}>{displayedCommand}</span>
        <span
          style={{
            width: 2,
            height: 20,
            background: "#0070F4",
            opacity: cursorVisible ? 1 : 0,
            marginLeft: -4
          }}
        />
      </div>

      {/* Feature badges floating at the bottom */}
      <FeatureBadge label="Admin Panel" icon="📊" delay={38} x={120} y={580}/>
      <FeatureBadge
        label="REST API"
        icon="🔌"
        delay={42}
        x={340}
        y={620}
      />
      <FeatureBadge label="Typed SDK" icon="⌨️" delay={46} x={880} y={580}/>
      <FeatureBadge label="Real-time" icon="⚡" delay={50} x={1080} y={620}/>
      <FeatureBadge
        label="Built-in Auth"
        icon="🔐"
        delay={54}
        x={580}
        y={650}
      />
    </AbsoluteFill>
  );
};

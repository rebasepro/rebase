import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { RebaseLogo } from "./RebaseLogo";

const FEATURES = [
  { icon: "📊",
label: "Admin Panel",
color: "#0070F4" },
  { icon: "🔌",
label: "REST API",
color: "#FF3773" },
  { icon: "⌨️",
label: "Typed TypeScript SDK",
color: "#FFA400" },
  { icon: "🔐",
label: "Built-in Auth",
color: "#0070F4" },
  { icon: "⚡",
label: "Real-time Subscriptions",
color: "#FF3773" },
  { icon: "📦",
label: "Data Import / Export",
color: "#FFA400" },
  { icon: "📋",
label: "Kanban Boards",
color: "#0070F4" },
  { icon: "🕐",
label: "Data History & Audit",
color: "#FF3773" }
];

/**
 * FeatureShowcase — radial burst of features around the logo.
 * Duration: ~4 seconds at 30fps (120 frames)
 */
export const FeatureShowcase: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ── Logo entrance ──
  const logoProgress = spring({
    frame,
    fps,
    config: { damping: 12,
mass: 0.6 }
  });
  const logoScale = interpolate(logoProgress, [0, 1], [0.5, 1]);
  const logoOpacity = interpolate(logoProgress, [0, 1], [0, 1]);

  // ── Radial glow pulse ──
  const glowPulse = interpolate(Math.sin(frame / 25), [-1, 1], [0.2, 0.5]);

  // ── Fade out ──
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp",
extrapolateRight: "clamp" }
  );

  const centerX = 720;
  const centerY = 405;
  const radius = 260;

  return (
    <AbsoluteFill
      style={{
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut
      }}
    >
      {/* Radial glow */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(0,112,244,0.12) 0%, transparent 70%)",
          opacity: glowPulse,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)"
        }}
      />

      {/* Center logo */}
      <div
        style={{
          position: "absolute",
          left: centerX - 45,
          top: centerY - 45,
          transform: `scale(${logoScale})`,
          opacity: logoOpacity
        }}
      >
        <RebaseLogo size={90}/>
      </div>

      {/* Feature pills arranged in a circle */}
      {FEATURES.map((feature, i) => {
        const angle = (i / FEATURES.length) * Math.PI * 2 - Math.PI / 2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;

        const delay = 15 + i * 6;
        const progress = spring({
          frame: frame - delay,
          fps,
          config: { damping: 14,
mass: 0.6 }
        });

        const pillScale = interpolate(progress, [0, 1], [0.3, 1]);
        const pillOpacity = interpolate(progress, [0, 1], [0, 1]);

        // Subtle orbit float
        const floatOffset = Math.sin((frame + i * 20) / 40) * 4;

        // Line from center to pill
        const lineOpacity = interpolate(progress, [0, 1], [0, 0.15]);

        return (
          <React.Fragment key={i}>
            {/* Connecting line */}
            <svg
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 1440,
                height: 810,
                pointerEvents: "none"
              }}
            >
              <line
                x1={centerX}
                y1={centerY}
                x2={x}
                y2={y + floatOffset}
                stroke={feature.color}
                strokeWidth={1}
                opacity={lineOpacity}
              />
            </svg>

            {/* Feature pill */}
            <div
              style={{
                position: "absolute",
                left: x - 90,
                top: y - 20 + floatOffset,
                width: 180,
                transform: `scale(${pillScale})`,
                opacity: pillOpacity,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "10px 18px",
                borderRadius: 999,
                border: `1px solid ${feature.color}33`,
                background: `${feature.color}0D`,
                backdropFilter: "blur(8px)",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                color: "#fff",
                whiteSpace: "nowrap" as const
              }}
            >
              <span style={{ fontSize: 16 }}>{feature.icon}</span>
              {feature.label}
            </div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

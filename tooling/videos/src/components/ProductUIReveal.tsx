import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  staticFile
} from "remotion";

export const ProductUIReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ── Enter animations ──
  const progress = spring({
    frame,
    fps,
    config: { damping: 14,
mass: 0.8 }
  });

  // Background fade in
  const bgOpacity = interpolate(progress, [0, 1], [0, 1]);

  // Image 1: demo-admin-panel.png (Main Dashboard)
  const img1Progress = spring({
    frame: frame - 15,
    fps,
    config: { damping: 12,
mass: 0.9 }
  });
  const img1Scale = interpolate(img1Progress, [0, 1], [0.8, 1]);
  const img1Opacity = interpolate(img1Progress, [0, 1], [0, 1]);
  const img1Y = interpolate(img1Progress, [0, 1], [100, 0]);

  // Image 2: entity_view.png (Secondary view overlapping right)
  const img2Progress = spring({
    frame: frame - 30,
    fps,
    config: { damping: 14,
mass: 0.8 }
  });
  const img2X = interpolate(img2Progress, [0, 1], [200, 0]);
  const img2Opacity = interpolate(img2Progress, [0, 1], [0, 1]);
  const img2Rotate = interpolate(img2Progress, [0, 1], [5, -3]);

  // Image 3: users_table.png (Overlapping bottom left)
  const img3Progress = spring({
    frame: frame - 45,
    fps,
    config: { damping: 14,
mass: 0.8 }
  });
  const img3Y = interpolate(img3Progress, [0, 1], [200, 0]);
  const img3Opacity = interpolate(img3Progress, [0, 1], [0, 1]);
  const img3Rotate = interpolate(img3Progress, [0, 1], [-5, 2]);

  // ── Text entrance ──
  const textProgress = spring({
    frame: frame - 60,
    fps,
    config: { damping: 16,
mass: 0.6 }
  });
  const textOpacity = interpolate(textProgress, [0, 1], [0, 1]);
  const textY = interpolate(textProgress, [0, 1], [20, 0]);

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
        background: "radial-gradient(ellipse at center, #111 0%, #000 100%)",
        opacity: fadeOut * bgOpacity,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          width: 800,
          height: 800,
          background: "radial-gradient(circle, rgba(0,112,244,0.1) 0%, transparent 70%)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none"
        }}
      />

      {/* Main Admin Panel UI */}
      <div
        style={{
          position: "absolute",
          top: "15%",
          left: "15%",
          right: "15%",
          transform: `translateY(${img1Y}px) scale(${img1Scale})`,
          opacity: img1Opacity,
          borderRadius: 16,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          border: "1px solid rgba(255,255,255,0.1)",
          overflow: "hidden"
        }}
      >
        <Img src={staticFile("demo-admin-panel.png")} style={{ width: "100%",
display: "block" }}/>
      </div>

      {/* Entity View (Right Overlay) */}
      <div
        style={{
          position: "absolute",
          top: "35%",
          right: "5%",
          width: "45%",
          transform: `translateX(${img2X}px) rotate(${img2Rotate}deg)`,
          opacity: img2Opacity,
          borderRadius: 12,
          boxShadow: "0 30px 60px -15px rgba(0, 0, 0, 0.6)",
          border: "1px solid rgba(255,255,255,0.1)",
          overflow: "hidden"
        }}
      >
        <Img src={staticFile("entity_view.png")} style={{ width: "100%",
display: "block" }}/>
      </div>

      {/* Users Table (Bottom Left Overlay) */}
      <div
        style={{
          position: "absolute",
          bottom: "10%",
          left: "8%",
          width: "50%",
          transform: `translateY(${img3Y}px) rotate(${img3Rotate}deg)`,
          opacity: img3Opacity,
          borderRadius: 12,
          boxShadow: "0 30px 60px -15px rgba(0, 0, 0, 0.6)",
          border: "1px solid rgba(255,255,255,0.1)",
          overflow: "hidden"
        }}
      >
        <Img src={staticFile("users_table.png")} style={{ width: "100%",
display: "block" }}/>
      </div>

      {/* Title / Description */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: textOpacity,
          transform: `translateY(${textY}px)`
        }}
      >
        <div
          style={{
            background: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(10px)",
            padding: "16px 32px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.1)"
          }}
        >
          <h2
            style={{
              margin: 0,
              color: "#fff",
              fontFamily: "'Inter', sans-serif",
              fontSize: 24,
              fontWeight: 600
            }}
          >
            A powerful, auto-generated back-office
          </h2>
        </div>
      </div>
    </AbsoluteFill>
  );
};

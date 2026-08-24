import { AbsoluteFill, Video, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import React from "react";

export const RealProductVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: {
      damping: 200
    },
    from: 0.95,
    to: 1
  });

  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill className="bg-rebase-surface flex items-center justify-center font-inter">
      <AbsoluteFill className="p-8 flex flex-col items-center justify-center" style={{ opacity }}>
        <div
          className="w-full h-full relative rounded-2xl overflow-hidden shadow-[0_0_80px_rgba(42,107,255,0.15)] border border-rebase-border bg-black flex flex-col"
          style={{ transform: `scale(${scale})` }}
        >
          {/* Actual Product Video (Live Puppeteer Recording) */}
          <Video
            src={staticFile("live_app_editing_dark.mp4")}
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

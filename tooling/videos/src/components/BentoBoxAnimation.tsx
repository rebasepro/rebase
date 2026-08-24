import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Video, staticFile } from "remotion";

export const BentoBoxAnimation: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Helper for staggered springs
  const getSpring = (delay: number) => 
    spring({
      frame: Math.max(0, frame - delay),
      fps,
      config: { damping: 14, mass: 0.8 },
    });

  // Fade out at end
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // We have say 8 boxes. We stagger them.
  const boxes = Array.from({ length: 8 }).map((_, i) => getSpring(i * 3));

  // Common box style
  const boxStyle: React.CSSProperties = {
    background: "var(--surface-900)",
    borderRadius: 16,
    border: "1px solid rgba(255, 255, 255, 0.05)",
    boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.5)",
    overflow: "hidden",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    padding: 24,
  };

  // Helper to apply spring
  const animatedStyle = (springVal: number): React.CSSProperties => ({
    opacity: interpolate(springVal, [0, 1], [0, 1]),
    transform: `translateY(${interpolate(springVal, [0, 1], [40, 0])}px) scale(${interpolate(springVal, [0, 1], [0.95, 1])})`,
  });

  return (
    <AbsoluteFill
      style={{
        background: "#050505",
        opacity: fadeOut,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        fontFamily: "'Inter', sans-serif",
        color: "#fff",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "250px 1fr 1fr 320px",
          gridTemplateRows: "180px 220px 200px",
          gap: 20,
          width: "100%",
          maxWidth: 1360,
          height: "100%",
          maxHeight: 720,
        }}
      >
        {/* Box 1: Sidebar (Search/Filter) */}
        <div style={{ ...boxStyle, ...animatedStyle(boxes[0]), gridRow: "1 / -1", padding: 16 }}>
          <div style={{ background: "var(--surface-800)", padding: "12px 16px", borderRadius: 8, marginBottom: 16, fontWeight: 500, border: "1px solid rgba(255, 255, 255, 0.03)" }}>
            Filter by country
          </div>
          <div style={{ background: "var(--surface-800)", padding: "12px 16px", borderRadius: 8, color: "var(--surface-400)", display: "flex", alignItems: "center", gap: 12, border: "1px solid rgba(255, 255, 255, 0.03)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            Search users
          </div>
          <div style={{ marginTop: "auto", height: 250, background: "var(--surface-800)", borderRadius: 12, position: 'relative', overflow: 'hidden', border: "1px solid rgba(255, 255, 255, 0.03)" }}>
            {/* Mock chart */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', background: 'linear-gradient(0deg, rgba(0,112,244,0.15) 0%, transparent 100%)' }} />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', position: 'absolute', bottom: 0 }}>
              <path d="M0,80 Q10,70 20,75 T40,60 T60,65 T80,40 T100,20 L100,100 L0,100 Z" fill="none" stroke="var(--primary)" strokeWidth="2" />
              <path d="M0,70 Q10,60 20,80 T40,50 T60,70 T80,50 T100,30 L100,100 L0,100 Z" fill="none" stroke="var(--accent-pink)" strokeWidth="1.5" opacity={0.6} />
              <path d="M0,90 Q10,80 20,90 T40,80 T60,85 T80,70 T100,60 L100,100 L0,100 Z" fill="none" stroke="var(--accent-orange)" strokeWidth="1.5" opacity={0.6} />
            </svg>
          </div>
        </div>

        {/* Box 2: Pie Chart / Revenue */}
        <div style={{ ...boxStyle, ...animatedStyle(boxes[1]), gridColumn: "2 / 3" }}>
          <div style={{ display: 'flex', alignItems: 'center', height: '100%', justifyContent: 'center', gap: 24 }}>
             {/* Simple CSS Donut Chart */}
             <div style={{ 
                 width: 120, height: 120, borderRadius: '50%', 
                 background: 'conic-gradient(var(--accent-orange) 0% 30%, var(--accent-pink) 30% 60%, var(--primary) 60% 85%, var(--surface-700) 85% 100%)',
                 position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center'
             }}>
                 <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--surface-900)' }} />
             </div>
             <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--surface-300)', marginBottom: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-orange)' }}/> SaaS Subscriptions
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--surface-300)', marginBottom: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-pink)' }}/> Professional Services
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--surface-300)', marginBottom: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)' }}/> On-Premise Licensing
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--surface-300)' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--surface-700)' }}/> Hardware
                </div>
             </div>
          </div>
        </div>

        {/* Box 3: Total Orders */}
        <div style={{ ...boxStyle, ...animatedStyle(boxes[2]), gridColumn: "3 / 4" }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ color: 'var(--surface-300)', fontWeight: 600, fontSize: 14 }}>Total Orders</div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
          </div>
          <div style={{ fontSize: 46, fontWeight: 800, marginBottom: 8, letterSpacing: -1 }}>21,892.0</div>
          <div style={{ color: '#00E676', fontWeight: 600, fontSize: 18 }}>+67.3%</div>
        </div>

        {/* Box 4: Right Sidebar (New Subscriptions) */}
        <div style={{ ...boxStyle, ...animatedStyle(boxes[3]), gridColumn: "4 / 5", gridRow: "1 / 3" }}>
          <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 18 }}>
              New subscriptions <span style={{ color: 'var(--primary)', fontWeight: 500, fontSize: 14, marginLeft: 8 }}>Last 7 days</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 32 }}>
            <div>
               <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>3.77</div>
               <div style={{ fontSize: 10, color: 'var(--surface-400)', marginTop: 4 }}>Dataset 1, Daily<br/>avg.</div>
            </div>
            <div>
               <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>3.35</div>
               <div style={{ fontSize: 10, color: 'var(--surface-400)', marginTop: 4 }}>Dataset 2,<br/>Daily avg.</div>
            </div>
            <div>
               <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>3.56</div>
               <div style={{ fontSize: 10, color: 'var(--surface-400)', marginTop: 4 }}>Dataset 3,<br/>Daily avg.</div>
            </div>
          </div>
          
          {/* Bar Chart Mock */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 180, gap: 6, position: 'relative', marginTop: 'auto' }}>
            {/* Grid lines */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, borderTop: '1px dashed var(--surface-700)' }} />
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1px dashed var(--surface-700)' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: '1px dashed var(--surface-700)' }} />
            
            {Array.from({length: 14}).map((_, i) => (
               <div key={i} style={{ 
                   width: '100%', 
                   height: `${Math.random() * 60 + 30}%`, 
                   background: i % 3 === 0 ? 'var(--primary)' : i % 3 === 1 ? 'var(--primary-dark)' : 'var(--surface-500)', 
                   borderRadius: '4px 4px 0 0',
                   zIndex: 1
               }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 10, color: 'var(--surface-400)' }}>
              <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
          </div>
        </div>

        {/* Box 5: Main Line Chart (Churn) */}
        <div style={{ ...boxStyle, ...animatedStyle(boxes[4]), gridColumn: "2 / 4", gridRow: "2 / 3" }}>
          <div style={{ color: 'var(--surface-400)', fontSize: 12, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase' }}>CURRENT CHURN</div>
          <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 16, letterSpacing: -1 }}>6.53%</div>
          <div style={{ flex: 1, position: 'relative' }}>
             {/* Grid lines */}
             <div style={{ position: 'absolute', top: '25%', left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.05)' }} />
             <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.05)' }} />
             <div style={{ position: 'absolute', top: '75%', left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.05)' }} />
             
             <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', position: 'absolute', zIndex: 1 }}>
              <path d="M0,50 Q10,55 20,50 T40,60 T60,30 T80,45 T100,20" fill="none" stroke="var(--primary)" strokeWidth="2.5" />
              <circle cx="100" cy="20" r="3" fill="var(--white)" />
            </svg>
          </div>
        </div>

        {/* Box 6: Active Users Map (Replaced with App Video) */}
        <div style={{ ...boxStyle, ...animatedStyle(boxes[5]), gridColumn: "2 / 3", gridRow: "3 / 4", padding: 0 }}>
          <div style={{ width: '100%', height: '100%', position: 'relative', background: '#0a101a', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 16, left: 16, fontSize: 10, color: 'var(--surface-400)', zIndex: 10, background: 'rgba(10,16,26,0.8)', padding: '4px 8px', borderRadius: 4 }}>
                Live App Editing
            </div>
            <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
              <Video
                src={staticFile("live_app_editing_dark.mp4")}
                style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.8 }}
                muted
              />
            </div>
          </div>
        </div>

        {/* Box 7: Product List */}
        <div style={{ ...boxStyle, ...animatedStyle(boxes[6]), gridColumn: "3 / 4", gridRow: "3 / 4" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Product List with Correct Category Filter</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
             <div style={{ display: 'flex', padding: '0 16px 8px 16px', fontSize: 10, color: 'var(--surface-500)', fontWeight: 600, textTransform: 'uppercase' }}>
                <div style={{ width: '25%' }}>Cost</div>
                <div style={{ width: '25%' }}>Category</div>
                <div style={{ width: '50%' }}>Name</div>
             </div>
             
             {[
               {cost: '1.7182500154', cat: 'Accessories', name: 'HDE Pattern Suspenders'},
               {cost: '7.6001998776', cat: 'Socks', name: 'Huf Plantlife Crew Socks'},
               {cost: '28.42983091', cat: 'Fashion Hoodies...', name: 'Independent Trading Co. Mens Sherpa'}
             ].map((item, i) => (
                <div key={i} style={{ display: 'flex', background: 'var(--surface-800)', padding: '12px 16px', borderRadius: 8, fontSize: 11, alignItems: 'center' }}>
                   <div style={{ width: '25%', color: 'var(--surface-400)', fontFamily: 'monospace' }}>{item.cost}</div>
                   <div style={{ width: '25%' }}>{item.cat}</div>
                   <div style={{ width: '50%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                </div>
             ))}
          </div>
        </div>

        {/* Box 8: Right Text Content & Branding */}
        <div style={{ ...boxStyle, ...animatedStyle(boxes[7]), gridColumn: "4 / 5", gridRow: "3 / 4", justifyContent: 'space-between' }}>
           <div>
             <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 16 }}>Weekly Subscription Pulse</div>
             <div style={{ fontSize: 13, color: 'var(--surface-300)', lineHeight: 1.6 }}>
               Subscription volume has stabilized this week with 320 net new users, maintaining the baseline established earlier this month.
               <br/><br/>
               <span style={{ color: '#fff', fontWeight: 500 }}>Peak Activity:</span> The highest volume occurred on Tuesday, aligning with the weekly newsletter blast.
             </div>
           </div>
           
           <div style={{ position: 'absolute', bottom: 24, right: 24 }}>
               <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--surface-800)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--surface-400)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
               </div>
           </div>
        </div>

      </div>
    </AbsoluteFill>
  );
};

import React, { useEffect, useState } from "react";

export function CustomFieldsDemo() {
    const [step, setStep] = useState(0);
    const [rating, setRating] = useState(0);
    const [color, setColor] = useState("#8b5cf6");

    useEffect(() => {
        let isMounted = true;
        const loop = async () => {
            while (isMounted) {
                setStep(0);
                setRating(0);
                setColor("#8b5cf6");
                await new Promise(r => setTimeout(r, 1500));
                if (!isMounted) return;

                // Move to rating
                setStep(1);
                await new Promise(r => setTimeout(r, 800));
                if (!isMounted) return;

                // Click 4 stars
                setRating(4);
                setStep(2);
                await new Promise(r => setTimeout(r, 1200));
                if (!isMounted) return;

                // Move to color
                setStep(3);
                await new Promise(r => setTimeout(r, 800));
                if (!isMounted) return;

                // Select a new color
                setColor("#10b981");
                setStep(4);
                await new Promise(r => setTimeout(r, 1500));
                if (!isMounted) return;

                // Switch to Map
                setStep(5);
                await new Promise(r => setTimeout(r, 3000));
            }
        };
        loop();
        return () => { isMounted = false; };
    }, []);

    return (
        <div className="w-full h-full bg-surface-950 text-surface-200 flex flex-col font-sans select-none pointer-events-none p-6">
            <div className="flex items-center gap-2 mb-6 border-b border-surface-800 pb-4">
                <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>
                <h3 className="text-sm font-semibold text-white">Custom Widget Configuration</h3>
            </div>

            <div className="flex flex-col gap-8">
                {/* Custom Rating Field */}
                <div className={`transition-opacity duration-300 ${step >= 0 ? 'opacity-100' : 'opacity-50'}`}>
                    <label className="block text-sm font-medium text-text-secondary-dark mb-2">Customer Rating (Custom Component)</label>
                    <div className={`field flex items-center gap-2 p-3 transition-all ${step === 1 || step === 2 ? 'ring-2 ring-primary/50' : ''}`}>
                        {[1, 2, 3, 4, 5].map((star) => (
                            <svg 
                                key={star} 
                                className={`w-6 h-6 transition-colors duration-300 ${star <= rating ? 'text-amber-400 fill-amber-400' : 'text-surface-700'}`} 
                                viewBox="0 0 24 24" 
                                fill="none" 
                                stroke="currentColor" 
                                strokeWidth="2"
                            >
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                            </svg>
                        ))}
                        <span className="ml-2 text-xs text-surface-500 font-mono">{rating}/5</span>
                    </div>
                </div>

                {/* Custom Color Picker Field */}
                <div className={`transition-opacity duration-300 ${step >= 3 ? 'opacity-100' : 'opacity-40'}`}>
                    <label className="block text-sm font-medium text-text-secondary-dark mb-2">Brand Color (ColorPicker Widget)</label>
                    <div className={`field flex items-center gap-4 p-3 transition-all ${step === 3 || step === 4 ? 'ring-2 ring-emerald-500/50' : ''}`}>
                        <div className="w-10 h-10 rounded-full border-2 border-surface-700 shadow-inner transition-colors duration-500" style={{ backgroundColor: color }}></div>
                        <div className="flex-1">
                            <div className="flex gap-2">
                                {['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6'].map((preset) => (
                                    <div 
                                        key={preset}
                                        className={`w-6 h-6 rounded border cursor-pointer transition-transform ${color === preset ? 'scale-110 border-white' : 'border-surface-600'}`}
                                        style={{ backgroundColor: preset }}
                                    ></div>
                                ))}
                            </div>
                            <div className="mt-2 text-xs font-mono text-surface-500">{color.toUpperCase()}</div>
                        </div>
                    </div>
                </div>

                {/* Simulated Map Field */}
                <div className={`transition-opacity duration-300 ${step >= 5 ? 'opacity-100' : 'opacity-40'}`}>
                    <label className="block text-sm font-medium text-text-secondary-dark mb-2">Location (Mapx Widget)</label>
                    <div className="field relative h-24 overflow-hidden flex items-center justify-center">
                        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary via-surface-900 to-black"></div>
                        <svg className="w-6 h-6 text-primary absolute animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ top: '30%', left: '45%' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                        <div className="absolute bottom-2 left-2 text-[10px] text-surface-500 font-mono">40.7128° N, 74.0060° W</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

import React, { useEffect, useRef, useState } from "react";

export const AnimateHeight = ({
                                  children,
                                  isOpen,
                                  duration = "duration-500",
                                  easing = "ease-in-out"
                              }: {
    children: React.ReactNode;
    isOpen: boolean;
    duration?: string;
    easing?: string;
}) => {
    const [currentMaxHeight, setCurrentMaxHeight] = useState("0px");
    const contentRef = useRef<HTMLDivElement | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);

    useEffect(() => {
        const contentElement = contentRef.current;
        let timeoutId: NodeJS.Timeout | undefined;
        let animFrameId: number | undefined;

        if (!contentElement) {
            if (!isOpen) {
                setCurrentMaxHeight("0px");
            }
            return;
        }

        // Get the actual height
        const getActualHeight = () => {
            // Temporarily set height to auto to measure content
            const originalHeight = contentElement.style.maxHeight;
            contentElement.style.maxHeight = "auto";
            const height = contentElement.scrollHeight;
            contentElement.style.maxHeight = originalHeight;
            return height;
        };

        if (isOpen) {
            setIsAnimating(true);
            const height = getActualHeight();
            setCurrentMaxHeight(`${height}px`);

            // After animation completes, set to auto for dynamic content
            timeoutId = setTimeout(() => {
                setCurrentMaxHeight("auto");
                setIsAnimating(false);
            }, 300); // Match the duration-300 timing
        } else {
            setIsAnimating(true);
            // First set to actual height, then animate to 0
            const height = getActualHeight();
            setCurrentMaxHeight(`${height}px`);

            // Force reflow, then animate to 0
            animFrameId = requestAnimationFrame(() => {
                setCurrentMaxHeight("0px");
                timeoutId = setTimeout(() => {
                    setIsAnimating(false);
                }, 300);
            });
        }

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (animFrameId) cancelAnimationFrame(animFrameId);
        };
    }, [isOpen]);

    // Handle content changes when open
    useEffect(() => {
        if (isOpen && !isAnimating && currentMaxHeight === "auto") {
            // Content changed while open, just keep it at auto
            return;
        }
    }, [children, isOpen, isAnimating, currentMaxHeight]);

    return (
        <div
            ref={contentRef}
            style={{ maxHeight: currentMaxHeight }}
            className={`overflow-hidden transition-[max-height] ${duration} ${easing}`}
        >
            {children}
        </div>
    );
};

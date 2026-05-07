import { RefObject, useEffect, useState } from "react";
import { WidgetSize } from "../types";

export const useResizeObserver = (elementRef: RefObject<any>): WidgetSize | undefined => {
    const [size, setSize] = useState<WidgetSize | undefined>(undefined);

    useEffect(() => {
        const handleResize = (entries: ResizeObserverEntry[]) => {
            if (entries[0]) {
                const {
                    width,
                    height
                } = entries[0].contentRect;
                setSize({
                    width,
                    height
                });
            }
        };

        const observer = new ResizeObserver(handleResize);
        const element = elementRef.current;

        if (element) {
            observer.observe(element);
        }

        return () => {
            if (element) {
                observer.unobserve(element);
            }
        };
    }, []);

    return size;
};

export function measureElementSize(element: HTMLElement): WidgetSize {
    const {
        width,
        height
    } = element.getBoundingClientRect();
    return {
        width,
        height
    };
}

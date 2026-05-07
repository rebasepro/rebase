import { Download } from "lucide-react";
import { IconButton } from "@rebasepro/ui";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import React from "react";

export function DownloadButton({
                                   dashboardContainerRef
                               }: {
    dashboardContainerRef: React.RefObject<HTMLDivElement | null>
}) {

    const onClick = async () => {
        if (!dashboardContainerRef.current) return;

        const container = dashboardContainerRef.current;

        // Find the transform wrapper with zoom transition
        const transformWrapper = container.querySelector('.dashboard-zoom-transition') as HTMLElement;
        if (!transformWrapper) {
            console.error("Dashboard transform wrapper not found");
            return;
        }

        // Store original styles
        const originalContainerOverflow = container.style.overflow;
        const originalContainerHeight = container.style.height;
        const originalContainerMaxHeight = container.style.maxHeight;
        const originalContainerPadding = container.style.padding;

        // Temporarily make container show all content (no scrollbars, no padding)
        container.style.overflow = 'visible';
        container.style.height = 'auto';
        container.style.maxHeight = 'none';
        container.style.padding = '0';

        // Store and temporarily remove margins from transform wrapper
        const originalMarginLeft = transformWrapper.style.marginLeft;
        const originalMarginRight = transformWrapper.style.marginRight;
        transformWrapper.style.marginLeft = '0';
        transformWrapper.style.marginRight = '0';

        try {
            // Detect if dark mode is active
            const isDarkMode = document.documentElement.classList.contains('dark') ||
                              document.body.classList.contains('dark');

            // Get the computed background color from the container
            const computedStyle = window.getComputedStyle(container);
            const backgroundColor = computedStyle.backgroundColor || (isDarkMode ? '#1a1a1a' : '#ffffff');

            // Wait for layout to settle
            await new Promise(resolve => setTimeout(resolve, 150));

            const dataUrl = await toPng(transformWrapper, {
                backgroundColor,
                pixelRatio: 2,
                cacheBust: true
            });

            // Get element dimensions
            const width = transformWrapper.offsetWidth;
            const height = transformWrapper.offsetHeight;

            // Create PDF with appropriate dimensions
            const orientation = width > height ? 'landscape' : 'portrait';
            const pdf = new jsPDF({
                orientation,
                unit: 'px',
                format: [width, height],
                compress: true
            });

            // Add image to PDF
            pdf.addImage(dataUrl, 'PNG', 0, 0, width, height, undefined, 'FAST');

            // Download PDF
            pdf.save('dataki_dashboard.pdf');
        } catch (error) {
            console.error("Error generating PDF:", error);
        } finally {
            // Restore original styles
            container.style.overflow = originalContainerOverflow;
            container.style.height = originalContainerHeight;
            container.style.maxHeight = originalContainerMaxHeight;
            container.style.padding = originalContainerPadding;
            transformWrapper.style.marginLeft = originalMarginLeft;
            transformWrapper.style.marginRight = originalMarginRight;
        }
    };

    return (
        <IconButton variant="ghost" onClick={onClick}>
            <Download/>
        </IconButton>
    );
}


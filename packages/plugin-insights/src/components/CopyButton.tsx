import { IconButton, Tooltip } from "@rebasepro/ui";
import { Check, Copy } from "lucide-react";
import React, { useCallback, useState } from "react";

export interface CopyButtonProps {
    /** The text to copy to clipboard */
    textToCopy: string;
    /** Tooltip text when not copied (default: "Copy") */
    tooltip?: string;
    /** Tooltip text after copied (default: "Copied!") */
    copiedTooltip?: string;
    /** Duration in ms to show the check icon (default: 2000) */
    checkDuration?: number;
    /** Button size */
    size?: "smallest" | "small" | "medium" | "large";
    /** Whether the button is disabled */
    disabled?: boolean;
    /** Additional CSS class name */
    className?: string;
}

/**
 * A button that copies text to clipboard and shows a check icon briefly after copying.
 */
export function CopyButton({
    textToCopy,
    tooltip = "Copy",
    copiedTooltip = "Copied!",
    checkDuration = 2000,
    size = "small",
    disabled,
    className
}: CopyButtonProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(textToCopy);
            setCopied(true);
            setTimeout(() => setCopied(false), checkDuration);
        } catch (error) {
            console.error("Failed to copy to clipboard:", error);
        }
    }, [textToCopy, checkDuration]);

    return (
        <Tooltip title={copied ? copiedTooltip : tooltip}>
            <IconButton
                onClick={handleCopy}
                size={size}
                disabled={disabled}
                className={className}
            >
                {copied ? <Check size={16} /> : <Copy size={16} />}
            </IconButton>
        </Tooltip>
    );
}

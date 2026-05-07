import { Code, Plus, Trash2 } from "lucide-react";
import React, { useCallback, useState } from "react";
import { BooleanSwitchWithLabel, Button, Chip, cls, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, TextField, Typography } from "@rebasepro/ui";
import { Dashboard } from "../../types";
import { useDataki } from "../../DatakiProvider";
import { CopyButton } from "../CopyButton";

export interface EmbedDialogProps {
    dashboard: Dashboard;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function EmbedDialog({
    dashboard,
    open,
    onOpenChange
}: EmbedDialogProps) {

    const datakiConfig = useDataki();
    const [enabled, setEnabled] = useState<boolean>(
        dashboard.embedConfig?.enabled ?? false
    );
    const [allowedDomains, setAllowedDomains] = useState<string[]>(
        dashboard.embedConfig?.allowedDomains || []
    );
    const [embedApiKey, setEmbedApiKey] = useState<string>(
        dashboard.embedConfig?.embedApiKey || ""
    );
    const [newDomain, setNewDomain] = useState("");
    const [saving, setSaving] = useState(false);

    const embedScriptUrl = `${window.location.origin}/embed/dataki-embed.es.js`;
    const embedDocsUrl = "https://dataki.ai/embed";

    // Reset state when dialog opens
    React.useEffect(() => {
        if (open) {
            setEnabled(dashboard.embedConfig?.enabled ?? false);
            setAllowedDomains(dashboard.embedConfig?.allowedDomains || []);
            setEmbedApiKey(dashboard.embedConfig?.embedApiKey || "");
            setNewDomain("");
        }
    }, [open, dashboard.embedConfig]);

    // Generate a secure API key
    const generateApiKey = useCallback(() => {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        const key = Array.from(array, byte => byte.toString(16).padStart(2, "0")).join("");
        setEmbedApiKey(key);
    }, []);

    // Generate API key on first enable if not present
    React.useEffect(() => {
        if (enabled && !embedApiKey) {
            generateApiKey();
        }
    }, [enabled, embedApiKey, generateApiKey]);

    const embedCode = `<script type="module" src="${embedScriptUrl}" />\n\n<dataki-dashboard \n  dashboard-id="${dashboard.id}"\n  api-key="${embedApiKey}"\n  theme="light"\n/>`;

    const embedCodePreview = (
        <>
            <span className="tok-tag">&lt;script</span>{" "}
            <span className="tok-attr">type</span>=<span className="tok-str">"module"</span>{" "}
            <span className="tok-attr">src</span>=<span className="tok-str">{"\"" + embedScriptUrl + "\""}</span>{" "}
            <span className="tok-tag">/&gt;</span>
            {"\n\n"}
            <span className="tok-tag">&lt;dataki-dashboard</span>{"\n"}
            {"  "}<span className="tok-attr">dashboard-id</span>=<span className="tok-str">{"\"" + dashboard.id + "\""}</span>{"\n"}
            {"  "}<span className="tok-attr">api-key</span>=<span className="tok-str">{"\"" + embedApiKey + "\""}</span>{"\n"}
            {"  "}<span className="tok-attr">theme</span>=<span className="tok-str">"light"</span>{"\n"}
            <span className="tok-tag">/&gt;</span>
        </>
    );

    const handleAddDomain = useCallback(() => {
        const trimmed = newDomain.trim();
        if (!trimmed) return;

        // Validate domain format (basic validation)
        const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^localhost(?::\d+)?$/i;

        if (!domainRegex.test(trimmed)) {
            alert("Please enter a valid domain (e.g., example.com or localhost:3000)");
            return;
        }

        if (allowedDomains.includes(trimmed)) {
            alert("This domain is already in the list");
            return;
        }

        setAllowedDomains([...allowedDomains, trimmed]);
        setNewDomain("");
    }, [newDomain, allowedDomains]);

    const handleRemoveDomain = useCallback((domain: string) => {
        setAllowedDomains(allowedDomains.filter(d => d !== domain));
    }, [allowedDomains]);

    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            await datakiConfig.updateDashboard(dashboard.id, {
                embedConfig: {
                    enabled,
                    allowedDomains,
                    embedApiKey
                }
            }, "embed_config_update");
            onOpenChange(false);
        } catch (error) {
            console.error("Failed to update embed config:", error);
            alert("Failed to save embed configuration");
        } finally {
            setSaving(false);
        }
    }, [dashboard.id, enabled, allowedDomains, embedApiKey, datakiConfig, onOpenChange]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleAddDomain();
        }
    }, [handleAddDomain]);

    const handleCancel = useCallback(() => {
        // Reset to original values
        setEnabled(dashboard.embedConfig?.enabled ?? false);
        setAllowedDomains(dashboard.embedConfig?.allowedDomains || []);
        setEmbedApiKey(dashboard.embedConfig?.embedApiKey || "");
        setNewDomain("");
        onOpenChange(false);
    }, [dashboard.embedConfig, onOpenChange]);

    const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
        if (!nextOpen) {
            // Treat only closing as cancel/reset.
            handleCancel();
        } else {
            // When opening, let the parent control `open` and let the effect hydrate state.
            onOpenChange(true);
        }
    }, [handleCancel, onOpenChange]);

    return (
        <Dialog
            open={open}
            onOpenChange={handleDialogOpenChange}
            maxWidth={"4xl"}
        >
            <DialogTitle className="flex items-center justify-between">
                <div className="flex-1 w-full">
                    Embed Dashboard
                </div>
                <BooleanSwitchWithLabel
                    value={enabled}
                    fullWidth={false}
                    size={"small"}
                    className="p-4"
                    onValueChange={setEnabled}
                    label="Enable Embedding"
                />
            </DialogTitle>

            <DialogContent className="flex flex-col gap-6">

                {/* API Key Section */}
                <div className={cls("flex flex-col gap-3", !enabled && "opacity-50 pointer-events-none")}>
                    <div>
                        <Typography variant="label" className="font-medium mb-2">
                            API Key
                        </Typography>
                        <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark">
                            Required for all embed requests. Keep this secure and regenerate if compromised.
                        </Typography>
                    </div>

                    <div className="flex gap-2 items-center">
                        <div
                            className="flex-1 p-3 bg-surface-accent-50 dark:bg-surface-accent-900 rounded-lg font-mono text-sm break-all">
                            {embedApiKey || "No API key generated"}
                        </div>
                        <CopyButton
                            textToCopy={embedApiKey}
                            tooltip="Copy API key"
                            disabled={!enabled || !embedApiKey}
                        />
                        <Button
                            onClick={generateApiKey}
                            disabled={!enabled}
                            variant="outlined"
                        >
                            Regenerate
                        </Button>
                    </div>

                </div>

                {/* Allowed Domains Section */}
                <div className={cls("flex flex-col gap-3", !enabled && "opacity-50 pointer-events-none")}>
                    <div>
                        <Typography variant="label" className="font-medium mb-2">
                            Allowed Domains
                        </Typography>
                        <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark">
                            Restrict embed access to specific domains. Leave empty to allow all domains.
                        </Typography>
                    </div>

                    <div className="flex gap-2">
                        <TextField
                            value={newDomain}
                            onChange={(e) => setNewDomain(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="example.com or localhost:3000"
                            className="flex-1"
                            size="small"
                            disabled={!enabled}
                        />
                        <Button
                            onClick={handleAddDomain}
                            disabled={!newDomain.trim() || !enabled}
                            variant="outlined"
                        >
                            <Plus size="small"/>
                            Add
                        </Button>
                    </div>

                    {allowedDomains.length > 0 && (
                        <div
                            className="flex flex-wrap gap-2 p-3 bg-surface-50 dark:bg-surface-900 rounded-lg">
                            {allowedDomains.map((domain) => (
                                <Chip
                                    key={domain}
                                    size="small"
                                    className="flex items-center gap-1"
                                >
                                    {domain}
                                    <IconButton
                                        size="smallest"
                                        onClick={() => handleRemoveDomain(domain)}
                                        className="ml-1"
                                        disabled={!enabled}
                                    >
                                        <Trash2 size="smallest"/>
                                    </IconButton>
                                </Chip>
                            ))}
                        </div>
                    )}

                    {allowedDomains.length === 0 && (
                        <div
                            className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                            <Typography variant="caption" className="text-yellow-800 dark:text-yellow-200">
                                ⚠️ No domains specified. The dashboard will be accessible from any domain.
                            </Typography>
                        </div>
                    )}
                </div>

                {/* Embed Code Section */}
                <div className={cls("flex flex-col gap-3", !enabled && "opacity-50 pointer-events-none")}>
                    <Typography variant="label" className="font-medium flex gap-2">
                        <Code size="small"/>
                        Embed Code
                    </Typography>

                    <Typography
                        variant="caption"
                        className="text-text-secondary dark:text-text-secondary-dark"
                    >
                        Need help integrating the embed or need more customization options? See the docs at{" "}
                        <a
                            href={embedDocsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2"
                        >
                            {embedDocsUrl}
                        </a>
                        .
                    </Typography>

                    <div className="relative">
                        <pre className="docs-code p-4 bg-surface-accent-100 dark:bg-surface-accent-900 rounded-lg overflow-x-auto">
                            <code>{embedCodePreview}</code>
                        </pre>
                        <div className="absolute top-2 right-2">
                            <CopyButton
                                textToCopy={embedCode}
                                tooltip="Copy code"
                                disabled={!enabled}
                            />
                        </div>
                    </div>
                </div>

            </DialogContent>

            <DialogActions>
                <Button
                    onClick={handleCancel}
                    variant="text"
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleSave}
                    disabled={saving}
                    variant="filled"
                >
                    {saving ? "Saving..." : "Save Configuration"}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

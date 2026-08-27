import React, { useState } from "react";
import {
    Alert,
    Button,
    CheckCircleIcon,
    CopyIcon,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    MailIcon,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { UserCreationResult } from "@rebasepro/cms-types";

export function CreationResultDialog({
    result,
    onClose
}: {
    result: UserCreationResult;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const snackbarController = useSnackbarController();
    const [copied, setCopied] = useState(false);

    const handleCopyPassword = async () => {
        if (!result.temporaryPassword) return;
        try {
            await navigator.clipboard.writeText(result.temporaryPassword);
            setCopied(true);
            snackbarController.open({
                type: "success",
                message: t("password_copied") ?? "Password copied to clipboard"
            });
            setTimeout(() => setCopied(false), 3000);
        } catch {
            // Fallback for older browsers
            const textArea = document.createElement("textarea");
            textArea.value = result.temporaryPassword;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
        }
    };

    if (result.invitationSent) {
        // Invitation sent via email
        return (
            <Dialog open={true} onOpenChange={(open) => !open ? onClose() : undefined} maxWidth="xl">
                <DialogTitle variant="h5" gutterBottom={false}>
                    <div className="flex items-center gap-3">
                        <MailIcon/>
                        {t("invitation_sent_title") ?? "Invitation Sent"}
                    </div>
                </DialogTitle>
                <DialogContent>
                    <div className="flex flex-col gap-4 py-2">
                        <Alert color="success">
                            <Typography>
                                {(t("invitation_sent") ?? "An invitation email has been sent to {{email}}. They can use the link to set their password.")
                                    .replace("{{email}}", result.user.email ?? "")}
                            </Typography>
                        </Alert>
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button variant="filled" onClick={onClose}>
                        {t("ok")}
                    </Button>
                </DialogActions>
            </Dialog>
        );
    }

    if (result.temporaryPassword) {
        // No email — show temporary password
        return (
            <Dialog open={true} onOpenChange={(open) => !open ? onClose() : undefined} maxWidth="xl">
                <DialogTitle variant="h5" gutterBottom={false}>
                    {t("temporary_password") ?? "Temporary Password"}
                </DialogTitle>
                <DialogContent>
                    <div className="flex flex-col gap-4 py-2">
                        <Alert color="warning">
                            <Typography variant="body2">
                                {result.emailDeliveryFailed
                                    ? (t("temporary_password_email_failed_description") ??
                                        "The email could not be delivered. Share this temporary password with the user securely. It will not be shown again.")
                                    : (t("temporary_password_description") ??
                                        "Email is not configured. Share this temporary password with the user securely. It will not be shown again.")}
                            </Typography>
                        </Alert>

                        <div>
                            <Typography variant="caption" color="secondary" className="mb-1">
                                {t("email")}
                            </Typography>
                            <Typography>
                                {result.user.email}
                            </Typography>
                        </div>

                        <div>
                            <Typography variant="caption" color="secondary" className="mb-1">
                                {t("temporary_password") ?? "Temporary Password"}
                            </Typography>
                            <div className="flex items-center gap-2 mt-1">
                                <code className="flex-grow bg-surface-100 dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-3 py-2 font-mono text-base select-all">
                                    {result.temporaryPassword}
                                </code>
                                <Tooltip title={t("copy_password") ?? "Copy password"} asChild>
                                    <IconButton onClick={handleCopyPassword}>
                                        {copied ? <CheckCircleIcon className="text-green-600"/> : <CopyIcon/>}
                                    </IconButton>
                                </Tooltip>
                            </div>
                        </div>
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button variant="filled" onClick={onClose}>
                        {t("ok")}
                    </Button>
                </DialogActions>
            </Dialog>
        );
    }

    // Shouldn't happen, but fallback
    return null;
}

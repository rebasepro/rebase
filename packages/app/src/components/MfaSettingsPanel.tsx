import React, { useCallback, useEffect, useId, useState } from "react";
import type { MfaEnrollment, MfaFactorInfo, MfaSettingsController } from "@rebasepro/cms-types";
import {
    Alert,
    Button,
    Card,
    Chip,
    CircularProgress,
    CopyIcon,
    ExternalLinkIcon,
    IconButton,
    LoadingButton,
    PlusIcon,
    TextField,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useTranslation } from "../hooks";

/**
 * The account's own second factors: add an authenticator app, see which are
 * on the account, remove one, and replace the recovery codes.
 *
 * Once the account has a verified factor, every change to its factors needs a
 * session that presented one, and the server refuses the rest with
 * `AAL2_REQUIRED`. That refusal is a question, not a failure: the panel asks
 * for a code, steps the session up with it, and does what was asked.
 */
export function MfaSettingsPanel({ mfa }: { mfa: MfaSettingsController }) {
    const { t } = useTranslation();
    const [factors, setFactors] = useState<MfaFactorInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
    const [enrollCode, setEnrollCode] = useState("");
    const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
    // An action the server refused for want of the second factor, waiting for it.
    const [stepUp, setStepUp] = useState<{ retry: () => Promise<void> } | null>(null);
    const [stepUpCode, setStepUpCode] = useState("");
    const enrollCodeId = useId();
    const stepUpCodeId = useId();

    const load = useCallback(async () => {
        try {
            setFactors(await mfa.listFactors());
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, [mfa]);

    useEffect(() => {
        void load();
    }, [load]);

    const verifiedFactor = factors?.find(factor => factor.verified);

    /**
     * Run an action, and park it behind the step-up prompt when the server
     * wants the second factor first.
     */
    const run = async (key: string, action: () => Promise<void>) => {
        setBusy(key);
        setError(null);
        try {
            await action();
        } catch (e: unknown) {
            if (e instanceof Error && "code" in e && e.code === "AAL2_REQUIRED" && verifiedFactor) {
                setStepUp({ retry: action });
                setStepUpCode("");
                return;
            }
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(null);
        }
    };

    const startEnrollment = () => run("enroll", async () => {
        setEnrollment(await mfa.enroll());
        setEnrollCode("");
        setRecoveryCodes(null);
    });

    const confirmEnrollment = (current: MfaEnrollment) => run("confirm", async () => {
        await mfa.verifyEnrollment(current.factorId, enrollCode.trim());
        setEnrollment(null);
        // Shown once the factor is confirmed: before that they recover nothing.
        if (current.recoveryCodes) setRecoveryCodes(current.recoveryCodes);
        await load();
    });

    const removeFactor = (factorId: string) => run(`remove:${factorId}`, async () => {
        await mfa.removeFactor(factorId);
        await load();
    });

    const regenerateCodes = () => run("codes", async () => {
        setRecoveryCodes(await mfa.regenerateRecoveryCodes());
    });

    const answerStepUp = async (pending: { retry: () => Promise<void> }) => {
        if (!verifiedFactor) return;
        setBusy("step-up");
        setError(null);
        try {
            await mfa.stepUp(verifiedFactor.id, stepUpCode.trim());
        } catch (e: unknown) {
            setError(e instanceof Error && "code" in e && e.code === "INVALID_CODE"
                ? t("auth_mfa_code_invalid")
                : e instanceof Error ? e.message : String(e));
            setBusy(null);
            return;
        }
        setStepUp(null);
        setBusy(null);
        await run("retry", pending.retry);
    };

    const copy = (text: string) => {
        void navigator.clipboard?.writeText(text);
    };

    return (
        <div className="flex flex-col gap-6 max-w-xl">
            <div>
                <Typography variant="h6" className="mb-1">{t("mfa_settings_title")}</Typography>
                <Typography variant="body2" color="secondary">{t("mfa_settings_description")}</Typography>
            </div>

            {factors === null
                ? <div className="flex justify-center p-8"><CircularProgress/></div>
                : factors.length === 0
                    ? <Typography variant="body2" color="secondary">{t("mfa_no_factors")}</Typography>
                    : (
                        <div className="flex flex-col gap-3">
                            {factors.map(factor => (
                                <Card key={factor.id} className="flex justify-between items-center p-4">
                                    <div className="flex flex-col min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Typography variant="body1" className="truncate">
                                                {factor.friendlyName || t("auth_mfa_factor_totp")}
                                            </Typography>
                                            {!factor.verified && (
                                                <Chip colorScheme="yellow" size="small">{t("mfa_factor_unconfirmed")}</Chip>
                                            )}
                                        </div>
                                        <Typography variant="caption" color="secondary">
                                            {t("mfa_factor_added", { date: new Date(factor.createdAt).toLocaleDateString() })}
                                        </Typography>
                                    </div>
                                    <div className="ml-4">
                                        {busy === `remove:${factor.id}`
                                            ? <CircularProgress size="small"/>
                                            : (
                                                <Tooltip title={t("mfa_remove_factor")} asChild>
                                                    <IconButton
                                                        aria-label={t("mfa_remove_factor")}
                                                        disabled={busy !== null || stepUp !== null}
                                                        onClick={() => removeFactor(factor.id)}>
                                                        <Trash2Icon/>
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}

            {stepUp && (
                <Card className="flex flex-col gap-4 p-4">
                    <div>
                        <Typography variant="subtitle1" className="mb-1">{t("mfa_step_up_title")}</Typography>
                        <Typography variant="body2" color="secondary">{t("mfa_step_up_body")}</Typography>
                    </div>
                    <TextField
                        id={stepUpCodeId}
                        label={t("auth_mfa_code_label")}
                        autoComplete="one-time-code"
                        value={stepUpCode}
                        onChange={(e) => setStepUpCode(e.target.value)}
                    />
                    <div className="flex gap-2">
                        <LoadingButton
                            variant="filled"
                            loading={busy === "step-up"}
                            disabled={busy !== null || !stepUpCode.trim()}
                            onClick={() => answerStepUp(stepUp)}>
                            {t("auth_mfa_verify")}
                        </LoadingButton>
                        <Button variant="text" disabled={busy !== null} onClick={() => setStepUp(null)}>
                            {t("cancel")}
                        </Button>
                    </div>
                </Card>
            )}

            {enrollment && (
                <Card className="flex flex-col gap-4 p-4">
                    <Typography variant="body2" color="secondary">{t("mfa_enroll_instructions")}</Typography>
                    <div className="flex items-center gap-2">
                        <Typography variant="body1" className="font-mono tracking-wider break-all">
                            {enrollment.secret.replace(/(.{4})(?=.)/g, "$1 ")}
                        </Typography>
                        <Tooltip title={t("copy")} asChild>
                            <IconButton size="small" aria-label={t("copy")} onClick={() => copy(enrollment.secret)}>
                                <CopyIcon size={16}/>
                            </IconButton>
                        </Tooltip>
                    </div>
                    <Button
                        component="a"
                        href={enrollment.uri}
                        variant="text"
                        className="self-start"
                        startIcon={<ExternalLinkIcon size={16}/>}>
                        {t("mfa_open_in_app")}
                    </Button>
                    <TextField
                        id={enrollCodeId}
                        label={t("auth_mfa_code_label")}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        value={enrollCode}
                        onChange={(e) => setEnrollCode(e.target.value)}
                    />
                    <div className="flex gap-2">
                        <LoadingButton
                            variant="filled"
                            loading={busy === "confirm"}
                            disabled={busy !== null || enrollCode.trim().length !== 6}
                            onClick={() => confirmEnrollment(enrollment)}>
                            {t("mfa_enroll_confirm")}
                        </LoadingButton>
                        <Button variant="text" disabled={busy !== null} onClick={() => setEnrollment(null)}>
                            {t("cancel")}
                        </Button>
                    </div>
                </Card>
            )}

            {recoveryCodes && (
                <div className="flex flex-col gap-3">
                    <Typography variant="subtitle1">{t("mfa_recovery_codes_title")}</Typography>
                    <Alert color="warning">{t("mfa_recovery_codes_save")}</Alert>
                    <div className="grid grid-cols-2 gap-2">
                        {recoveryCodes.map(code => (
                            <Typography key={code} variant="body2" className="font-mono">{code}</Typography>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <Button startIcon={<CopyIcon size={16}/>} onClick={() => copy(recoveryCodes.join("\n"))}>
                            {t("copy")}
                        </Button>
                        <Button variant="text" onClick={() => setRecoveryCodes(null)}>
                            {t("mfa_recovery_codes_done")}
                        </Button>
                    </div>
                </div>
            )}

            {error && <Typography color="error">{error}</Typography>}

            {!enrollment && !stepUp && (
                <div className="flex flex-wrap gap-2">
                    <LoadingButton
                        variant="filled"
                        color="primary"
                        startIcon={<PlusIcon size={16}/>}
                        loading={busy === "enroll"}
                        disabled={busy !== null}
                        onClick={startEnrollment}>
                        {t("mfa_add_authenticator")}
                    </LoadingButton>
                    {verifiedFactor && (
                        <LoadingButton
                            variant="filled"
                            loading={busy === "codes"}
                            disabled={busy !== null}
                            onClick={regenerateCodes}>
                            {t("mfa_regenerate_codes")}
                        </LoadingButton>
                    )}
                </div>
            )}
        </div>
    );
}

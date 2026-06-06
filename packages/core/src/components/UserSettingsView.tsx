
import React, { useEffect, useState } from "react";
import {
    Avatar,
    Button,
    CircularProgress,
    IconButton,
    Tab,
    Tabs,
    TextField,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useAuthController, useTranslation } from "../hooks";

interface SessionInfo {
    id: string;
    userAgent?: string;
    ipAddress?: string;
    createdAt: string;
    isCurrentSession?: boolean;
}

interface ExtendedAuthController {
    user: { displayName?: string | null; photoURL?: string | null; email?: string | null } | null;
    updateProfile?: (displayName: string, photoURL: string) => Promise<void>;
    changePassword?: (oldPassword: string, newPassword: string) => Promise<void>;
    fetchSessions?: () => Promise<SessionInfo[]>;
    revokeSession?: (id: string) => Promise<void>;
    revokeAllSessions?: () => Promise<void>;
    signOut: () => Promise<void>;
}

type ActiveTab = "profile" | "security" | "sessions";

export function UserSettingsView() {
    const authController = useAuthController() as ExtendedAuthController;
    const user = authController.user;
    const { t } = useTranslation();

    const hasPasswordChange = !!authController.changePassword;
    const [activeTab, setActiveTab] = useState<ActiveTab>("profile");

    // Profile state
    const [displayName, setDisplayName] = useState(user?.displayName || "");
    const [photoURL, setPhotoURL] = useState(user?.photoURL || "");
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState<string | null>(null);

    // Password change state
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [changingPassword, setChangingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

    // Sessions state
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [loadingSessions, setLoadingSessions] = useState(false);
    const [sessionsError, setSessionsError] = useState<string | null>(null);
    const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
    const [revokingAll, setRevokingAll] = useState(false);

    useEffect(() => {
        setDisplayName(user?.displayName || "");
        setPhotoURL(user?.photoURL || "");
        if (activeTab === "sessions") {
            loadSessions();
        }
    }, [activeTab, user]);

    const handleSaveProfile = async () => {
        setSavingProfile(true);
        setProfileError(null);
        try {
            if (authController.updateProfile) {
                await authController.updateProfile(displayName, photoURL);
            } else {
                throw new Error("updateProfile not implemented in this auth controller.");
            }
        } catch (e: unknown) {
            setProfileError(e instanceof Error ? e.message : String(e));
        } finally {
            setSavingProfile(false);
        }
    };

    const handleChangePassword = async () => {
        setPasswordError(null);
        setPasswordSuccess(null);

        // Validate
        if (newPassword.length < 8) {
            setPasswordError(t("password_too_short"));
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError(t("passwords_dont_match"));
            return;
        }

        setChangingPassword(true);
        try {
            if (authController.changePassword) {
                await authController.changePassword(currentPassword, newPassword);
                setPasswordSuccess(t("password_changed"));
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
                // Backend invalidates all sessions on password change,
                // so the user will be logged out shortly
                setTimeout(() => {
                    authController.signOut();
                }, 2000);
            }
        } catch (e: unknown) {
            setPasswordError(e instanceof Error ? e.message : String(e));
        } finally {
            setChangingPassword(false);
        }
    };

    const loadSessions = async () => {
        setLoadingSessions(true);
        setSessionsError(null);
        try {
            if (authController.fetchSessions) {
                const fetchedSessions = await authController.fetchSessions();
                const sortedSessions = (fetchedSessions || []).sort((a: SessionInfo, b: SessionInfo) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );
                setSessions(sortedSessions);
            } else {
                throw new Error("fetchSessions not implemented in this auth controller.");
            }
        } catch (e: unknown) {
            setSessionsError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoadingSessions(false);
        }
    };

    const handleRevokeSession = async (id: string, isCurrentSession?: boolean) => {
        setRevokingSessionId(id);
        try {
            if (authController.revokeSession) {
                await authController.revokeSession(id);
                setSessions(sessions.filter(s => s.id !== id));
                if (isCurrentSession) {
                    await authController.signOut();
                }
            } else {
                throw new Error("revokeSession not implemented in this auth controller.");
            }
        } catch (e: unknown) {
            setSessionsError(e instanceof Error ? e.message : String(e));
        } finally {
            setRevokingSessionId(null);
        }
    };

    const handleRevokeAll = async () => {
        setRevokingAll(true);
        try {
            if (authController.revokeAllSessions) {
                await authController.revokeAllSessions();
            } else {
                throw new Error("revokeAllSessions not implemented in this auth controller.");
            }
        } catch (e: unknown) {
            setSessionsError(e instanceof Error ? e.message : String(e));
        } finally {
            setRevokingAll(false);
        }
    };

    if (!user) return null;

    return (
        <div className="flex-grow max-w-4xl w-full mx-auto p-4 sm:p-6 md:p-12">
            <Typography variant="h4" className="mb-8">{t("account_settings")}</Typography>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)} className="mb-8">
                <Tab value="profile">{t("profile")}</Tab>
                {hasPasswordChange && <Tab value="security">{t("security")}</Tab>}
                <Tab value="sessions">{t("sessions")}</Tab>
            </Tabs>

            {activeTab === "profile" && (
                <div className="flex flex-col gap-6 max-w-xl">
                    <div className="flex items-center gap-6 mb-2">
                        <Avatar src={photoURL || undefined} className="w-24 h-24 text-3xl">
                            {displayName ? displayName[0].toUpperCase() : (user.email ? user.email[0].toUpperCase() : "A")}
                        </Avatar>
                    </div>
                    <TextField
                        label={t("display_name")}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                    />
                    <TextField
                        label={t("photo_url")}
                        value={photoURL}
                        onChange={(e) => setPhotoURL(e.target.value)}
                    />
                    {profileError && <Typography color="error">{profileError}</Typography>}
                    <div className="mt-4">
                        <Button variant="filled" onClick={handleSaveProfile} disabled={savingProfile}>
                            {savingProfile ? t("saving") : t("save_profile")}
                        </Button>
                    </div>
                </div>
            )}

            {activeTab === "security" && hasPasswordChange && (
                <div className="flex flex-col gap-6 max-w-xl">
                    <Typography variant="h6" className="mb-2">{t("change_password")}</Typography>

                    <TextField
                        label={t("current_password")}
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        autoComplete="current-password"
                    />
                    <TextField
                        label={t("new_password")}
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                    />
                    <TextField
                        label={t("confirm_password")}
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                    />

                    {passwordError && (
                        <Typography color="error">{passwordError}</Typography>
                    )}
                    {passwordSuccess && (
                        <Typography className="text-emerald-600 dark:text-emerald-400">{passwordSuccess}</Typography>
                    )}

                    <div className="mt-4">
                        <Button
                            variant="filled"
                            onClick={handleChangePassword}
                            disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                        >
                            {changingPassword ? t("changing_password") : t("change_password")}
                        </Button>
                    </div>
                </div>
            )}

            {activeTab === "sessions" && (
                <div className="flex flex-col gap-4 max-w-3xl">
                    {loadingSessions ? (
                        <div className="flex justify-center p-8"><CircularProgress/></div>
                    ) : sessionsError ? (
                        <Typography color="error">{sessionsError}</Typography>
                    ) : sessions.length === 0 ? (
                        <Typography>{t("no_active_sessions")}</Typography>
                    ) : (
                        <div className="flex flex-col gap-4">
                            <div className="flex justify-end mb-2">
                                <Button
                                    variant="text"
                                    color="error"
                                    onClick={handleRevokeAll}
                                    disabled={revokingAll}
                                >
                                    {revokingAll ? t("revoking") : t("revoke_all_sessions")}
                                </Button>
                            </div>
                            {sessions.map(session => (
                                <div key={session.id} className="flex justify-between items-center p-4 bg-white dark:bg-surface-950 border rounded-lg dark:border-surface-700 shadow-sm">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Typography variant="body1">
                                                {session.userAgent || t("unknown_device")}
                                            </Typography>
                                            {session.isCurrentSession && (
                                                <span className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-200 rounded-full">
                                                    {t("current")}
                                                </span>
                                            )}
                                        </div>
                                        <Typography variant="caption" color="secondary">
                                            IP: {session.ipAddress || "Unknown"} • Created: {new Date(session.createdAt).toLocaleString()}
                                        </Typography>
                                    </div>
                                    <div className="ml-4">
                                        {revokingSessionId === session.id ? (
                                            <CircularProgress size="small"/>
                                        ) : (
                                            <IconButton onClick={() => handleRevokeSession(session.id, session.isCurrentSession)} aria-label="Revoke Session">
                                                <Trash2Icon/>
                                            </IconButton>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

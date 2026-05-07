import { useEffect, useState } from "react";
import { useDataki } from "../DatakiProvider";
import {
    checkUserHasDrivePermission,
    createSheet,
    exchangeCodeForToken,
    getUserGoogleCredentials,
    postUserCredentials
} from "../api";
import { GoogleSheetsDataSource } from "../types";
import { useSnackbarController } from "@rebasepro/core";

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID;

const SCOPES = "https://www.googleapis.com/auth/drive.file";

declare global {
    interface Window {
        gapi: any;
        google: any;
    }
}

export interface GoogleSheetsPickerProps {
    open: boolean;
    onClose: () => void;
    teamId: string;
    onSuccess?: (sheet?: GoogleSheetsDataSource) => void;
    onAnalyticsEvent?: (event: string, params?: any) => void;
    onPickerActiveChange?: (active: boolean) => void;
}

export const GoogleSheetsPicker = ({
    open,
    onClose,
    teamId,
    onSuccess,
    onAnalyticsEvent,
    onPickerActiveChange
}: GoogleSheetsPickerProps) => {

    const snackbar = useSnackbarController();
    const datakiConfig = useDataki();
    const [pickerApiLoaded, setPickerApiLoaded] = useState(false);

    useEffect(() => {
        const gapiLoaded = () => {
            if (window.gapi.picker) {
                setPickerApiLoaded(true);
            } else {
                window.gapi.load("picker", () => {
                    setPickerApiLoaded(true);
                });
            }
        };

        if (window.gapi) {
            gapiLoaded();
        }
    }, []);

    const createPicker = (accessToken: string) => {
        if (!pickerApiLoaded) {
            console.error("Picker API not loaded yet.");
            onClose();
            return;
        }

        const pickerCallback = async (data: any) => {
            if (data.action === window.google.picker.Action.PICKED) {
                onAnalyticsEvent?.("sheet_picked", { docs: data.docs });
                onPickerActiveChange?.(false);
                const file = data.docs[0];
                try {
                    const firebaseToken = await datakiConfig.getDatakiAuthToken();

                    const newSheet = await createSheet(
                        teamId,
                        { spreadsheetId: file.id },
                        firebaseToken,
                        datakiConfig.apiEndpoint
                    );
                    onSuccess?.(newSheet);
                } catch (e: any) {
                    console.error("Error creating/updating sheet:", e);
                    snackbar.open({
                        type: "error",
                        message: "Failed to add the selected Google Sheet. " + e.message
                    });
                }
                onClose();
            } else if (data.action === window.google.picker.Action.CANCEL) {
                onAnalyticsEvent?.("picker_cancelled", {});
                onPickerActiveChange?.(false);
                onClose();
            }
            // Don't close on other actions - picker is still active
        };

        const picker = new window.google.picker.PickerBuilder()
            .addView(window.google.picker.ViewId.SPREADSHEETS)
            .setOAuthToken(accessToken)
            .setDeveloperKey(GOOGLE_API_KEY)
            .setCallback(pickerCallback)
            .setAppId(APP_ID)
            .setOrigin(window.location.origin)
            .build();
        picker.setVisible(true);
        onPickerActiveChange?.(true);
    };

    const initiatePickerFlow = async () => {
        if (!pickerApiLoaded || !window.google) {
            console.error("Picker or GSI API not loaded yet.");
            onClose();
            return;
        }

        try {
            const firebaseToken = await datakiConfig.getDatakiAuthToken();
            const hasDrivePermission = await checkUserHasDrivePermission(firebaseToken, datakiConfig.apiEndpoint);

            if (hasDrivePermission) {
                const existingCredentials = await getUserGoogleCredentials(firebaseToken, datakiConfig.apiEndpoint);
                if (existingCredentials && existingCredentials.access_token) {
                    createPicker(existingCredentials.access_token);
                    return;
                }
            }

            onAnalyticsEvent?.("oauth_flow_initiated", {});
            const codeClient = window.google.accounts.oauth2.initCodeClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: SCOPES,
                ux_mode: "popup",
                callback: async (codeResponse: any) => {
                    if (codeResponse.error) {
                        onAnalyticsEvent?.("oauth_flow_error", { error: codeResponse.error });
                        throw codeResponse;
                    }

                    if (codeResponse.code) {
                        onAnalyticsEvent?.("oauth_flow_success", {});
                        const tokens = await exchangeCodeForToken("postmessage", codeResponse.code, datakiConfig.apiEndpoint);
                        const firebaseTokenForSave = await datakiConfig.getDatakiAuthToken();
                        await postUserCredentials(tokens, firebaseTokenForSave, datakiConfig.apiEndpoint);
                        createPicker(tokens.access_token);
                    } else {
                        onClose();
                    }
                }
            });
            codeClient.requestCode();

        } catch (error) {
            console.error("Error during picker authentication flow:", error);
            onClose();
        }
    };

    useEffect(() => {
        if (open) {
            onAnalyticsEvent?.("open_sheets_picker", {});
            initiatePickerFlow();
        }
    }, [open]);

    return null;
};

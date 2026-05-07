import { useEffect, useRef } from "react";
import { DatakiAuthController, OauthParams } from "../hooks/useDatakiAuthController";
import {
    cleanUpSubscribe,
    clearPendingRedirect,
    loadPendingRedirect,
    loadSubscribeToNewsletter
} from "../utils/local_storage";
import { useNavigate } from "react-router-dom";

const checkedCodes = new Set<string>();

export function useManageOauthCallback(authController: DatakiAuthController) {
    const subscribing = useRef(false);
    const navigate = useNavigate();

    useEffect(() => {

        const url = new URL(window.location.href);
        const searchParams = new URLSearchParams(url.search);
        const params: Partial<OauthParams> = {};

        for (const [key, value] of searchParams.entries()) {
            params[key as keyof OauthParams] = value as any;
        }

        const code = params.code;
        if (!code || checkedCodes.has(code)) {
            return;
        }
        checkedCodes.add(code);
        authController.updateOauth(params).then((credential: any) => {

            const subscribeToNewsletter = loadSubscribeToNewsletter();
            if (subscribeToNewsletter && credential?.user.email && !subscribing.current) {
                subscribing.current = true;
                subscribeNewsletter(credential.user.email)
                    .finally(() => {
                        subscribing.current = false;
                    });
            }
            cleanUpSubscribe();

            const pendingRedirect = loadPendingRedirect();
            if (pendingRedirect) {
                navigate(pendingRedirect, { replace: true });
                clearPendingRedirect();
            }

        });
    }, [authController]);

}

const subscribeNewsletter = (email: string) => {
    const url = " https://datakiapi-4mgflsd2ha-ey.a.run.app/notifications/newsletter";
    return fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            email_address: email,
            source: "dataki-app"
        })
    }).then((res) => {
        console.log("newsletter response", res);
    });
}


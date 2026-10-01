import React, { useCallback, useSyncExternalStore } from "react";
import { Alert, Typography } from "@rebasepro/ui";
import type { RealtimeConnectionState, RebaseClient } from "@rebasepro/types";
import { useRebaseClient } from "../hooks/useRebaseClient";
import { useTranslation } from "../hooks/useTranslation";

const noUnsubscribe = () => undefined;

/**
 * The realtime connection's state, re-rendering on every change.
 *
 * `undefined` when there is no client, or it was built without realtime —
 * there is no connection to describe.
 *
 * @group Hooks and utilities
 */
export function useRealtimeConnectionState(): RealtimeConnectionState | undefined {
    const ws = useRebaseClient<RebaseClient>()?.ws;
    // A client implementation that predates the state (or is not the Rebase
    // SDK at all) has nothing to subscribe to, which reads as "no state".
    const observable = ws && typeof ws.onStateChange === "function" ? ws : undefined;
    const subscribe = useCallback(
        (notify: () => void) => observable ? observable.onStateChange(notify) : noUnsubscribe,
        [observable]
    );
    const read = useCallback(() => observable?.state, [observable]);
    return useSyncExternalStore(subscribe, read, read);
}

export interface ConnectionLostBannerProps {
    className?: string;
}

/**
 * Says that live updates have stopped, while they have.
 *
 * Shown once the realtime client reports the connection `disconnected`: the
 * socket has been down for longer than a blip, so tables, boards and open
 * records are showing what they last received and nothing else will arrive
 * until it is back. They keep their data rather than turning into errors — this
 * banner is how the user learns it may be out of date. It disappears by itself
 * when the connection returns, and every live view then refreshes.
 *
 * A brief drop (`reconnecting`) shows nothing: a deploy blips every socket for
 * a second or two, and a banner that flashes on each one teaches people to
 * ignore it.
 *
 * @group Components
 */
export function ConnectionLostBanner({ className }: ConnectionLostBannerProps) {
    const state = useRealtimeConnectionState();
    const { t } = useTranslation();

    if (state !== "disconnected") return null;

    return (
        <div role="status" aria-live="polite" className={className}>
            <Alert color="warning" size="small">
                <div className="flex flex-col gap-0.5">
                    <Typography variant="label">
                        {t("realtime_connection_lost_title")}
                    </Typography>
                    <Typography variant="body2" color="secondary">
                        {t("realtime_connection_lost_body")}
                    </Typography>
                </div>
            </Alert>
        </div>
    );
}

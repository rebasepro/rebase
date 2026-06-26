import { useSnackbarController } from "@rebasepro/core";

export function useSafeSnackbarController(): ReturnType<typeof useSnackbarController> | undefined {
    try {
        return useSnackbarController();
    } catch {
        return undefined;
    }
}

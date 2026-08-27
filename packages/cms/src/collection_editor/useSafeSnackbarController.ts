import { useSnackbarController } from "@rebasepro/app";

export function useSafeSnackbarController(): ReturnType<typeof useSnackbarController> | undefined {
    try {
        return useSnackbarController();
    } catch {
        return undefined;
    }
}

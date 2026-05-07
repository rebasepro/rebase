export function savePendingRedirect(url: string) {
    localStorage.setItem("pendingRedirect", url);
}

export function loadPendingRedirect() {
    return localStorage.getItem("pendingRedirect");
}

export function clearPendingRedirect() {
    localStorage.removeItem("pendingRedirect");
}

export function loadSubscribeToNewsletter() {
    return localStorage.getItem("subscribeToNewsletter") === "true";
}

export function saveSubscribeToNewsletter(subscribeToNewsletter: boolean) {
    localStorage.setItem("subscribeToNewsletter", subscribeToNewsletter ? "true" : "false");
}

export function cleanUpSubscribe() {
    localStorage.removeItem("subscribeToNewsletter");
}

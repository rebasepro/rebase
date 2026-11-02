/**
 * The admin's two touch points with Sign in with Apple that do not go through
 * `client.auth`: telling a closed popup from a failure, and putting Apple's
 * script on the page before the click.
 *
 * The popup itself is `client.auth.signInWithApplePopup` in
 * `@rebasepro/client`, which this package reaches only structurally — so the
 * script URL is repeated here. Once the tag this adds has loaded, the client
 * finds `window.AppleID` and opens the popup without loading anything.
 */

/** Must match `APPLE_JS_SDK_URL` in `@rebasepro/client`. */
const APPLE_JS_SDK_URL = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleauth.js";

/** Whether an `appleLogin` rejection is the visitor closing the popup or declining. */
export function isAppleCancellation(error: unknown): boolean {
    return typeof error === "object" && error !== null
        && "code" in error && error.code === "APPLE_SIGN_IN_CANCELLED";
}

/**
 * Add Apple's script to the page once. With it loaded before the click, the
 * popup opens in the click's own task — later than that, Safari blocks it.
 */
export function preloadAppleSdk(): void {
    if (typeof document === "undefined") return;
    if (document.querySelector(`script[src="${APPLE_JS_SDK_URL}"]`)) return;
    const script = document.createElement("script");
    script.src = APPLE_JS_SDK_URL;
    script.async = true;
    document.head.appendChild(script);
}

---
sourceHash: 6a3ef60662c3afa5
title: Authentifizierung
sidebar_label: Authentifizierung
description: Clientseitige Authentifizierung mit dem Rebase SDK — E-Mail/Passwort-Anmeldung, OAuth-Anbieter, Sitzungsverwaltung und Auth-Status-Listener.
---

## Übersicht

Das Modul `client.auth` verwaltet die Benutzerauthentifizierung, Token-Verwaltung und Sitzungspersistenz. Sobald sich ein Benutzer anmeldet, enthalten alle nachfolgenden Datenanfragen automatisch das JWT.

Das SDK speichert Sitzungen standardmäßig in `localStorage` und erneuert Tokens automatisch vor ihrem Ablauf.

:::note[Jede Anmeldemethode liefert eine flache Sitzung]
`signInWithEmail`, `signUp` und jede `signInWith*`-Methode geben **`{ user, accessToken, refreshToken }`** zurück — das SDK hat die Daten bereits für Sie ausgepackt.

Die darunterliegende REST-API gibt das Token stattdessen verschachtelt zurück, als `{ user, tokens: { accessToken, … } }`. Dieser Unterschied spielt nur eine Rolle, wenn Sie `/api/auth/*` direkt mit `fetch` aufrufen, wo `body.accessToken` `undefined` ist und sich das Token unter `body.tokens.accessToken` befindet. Siehe [das Wire-Format](/docs/backend/auth-endpoints/#response-format).
:::

## E-Mail / Passwort

### Anmelden

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### Registrieren

```typescript
const { user, confirmationRequired } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

Wenn [`requireEmailVerification`](/docs/backend/email-verification/) aktiviert ist,
gibt es keine Sitzung, bis die Adresse bestätigt wurde: `confirmationRequired` ist `true` und `user` ist `null`. Bitten Sie die Person daher, ihre E-Mails zu prüfen. Andernfalls ist `confirmationRequired` `false` und `user` ist das angemeldete Konto. In Version 0.23 löst `signUp` zu `{ user, accessToken, refreshToken }` auf und meldet den Benutzer immer an.

## OAuth-Anbieter

Das SDK enthält dedizierte Methoden für gängige OAuth-Anbieter sowie ein generisches `signInWithOAuth()` für benutzerdefinierte Anbieter.

### Google

Unterstützt drei Aufrufvarianten:

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Weitere Anbieter

Jeder Anbieter folgt dem Authorization-Code-Flow mit `(code, redirectUri)`:

```typescript
await client.auth.signInWithGitHub(code, redirectUri);
await client.auth.signInWithMicrosoft(code, redirectUri);
await client.auth.signInWithFacebook(code, redirectUri);
await client.auth.signInWithLinkedin(code, redirectUri);
await client.auth.signInWithDiscord(code, redirectUri);
await client.auth.signInWithGitLab(code, redirectUri);
await client.auth.signInWithBitbucket(code, redirectUri);
await client.auth.signInWithSlack(code, redirectUri);
await client.auth.signInWithSpotify(code, redirectUri);
```

Twitter erfordert zusätzlich den PKCE-Code-Verifier:

```typescript
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### Apple

Im Browser öffnet `signInWithApplePopup()` das Popup von Apple, prüft `state` und
meldet sich mit dem Code an. Rufen Sie es über einen Click-Handler auf. Rufen Sie beim Mounten
`preloadAppleSignIn()` auf, da Safari Popups blockiert, die auf das Herunterladen eines Skripts warten:

```typescript
import { preloadAppleSignIn } from "@rebasepro/client";

void preloadAppleSignIn();                                          // on mount
await client.auth.signInWithApplePopup({ clientId: "com.example.web" }); // on click
```

Ohne `clientId` liest das SDK die Services-ID von `/auth/config`, was
das Popup verzögert. Die Redirect-URI ist standardmäßig der Ursprung der Seite plus `/` und
muss eine Return-URL auf der Services-ID sein (HTTPS, niemals `localhost`). Ein geschlossenes
Popup wird mit dem Code `APPLE_SIGN_IN_CANCELLED` abgelehnt.

Eine native iOS- oder macOS-App sendet den Autorisierungscode aus Apples nativem
Sign-In mit ihrer Bundle-ID. Die Bundle-ID muss in `APPLE_BUNDLE_IDS` aufgeführt sein:

```typescript
await client.auth.signInWithApple({
    code: credential.authorizationCode,
    bundleId: "com.example.ios",
    user: { name: { firstName: "Jane" } } // sent by Apple on the first sign-in only
});
```

### Generisches OAuth

Für jeden im Backend registrierten Anbieter:

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Magic Links

Ein Ein-Klick-Anmeldelink per E-Mail. Der Link lautet immer `<base>/auth/magic-link?token=…`, wobei `<base>` die `email.magicLinkUrl` des Backends ist oder dessen Basis-URL zum Zurücksetzen des Passworts (`FRONTEND_URL` in der Laufzeitumgebung), falls diese nicht gesetzt ist. Es gibt kein anfragebezogenes `redirectTo`. Stellen Sie diesen Pfad in Ihrem Frontend bereit und übergeben Sie das Token zurück, um es gegen eine Sitzung einzutauschen. Das CMS stellt dies bereit und meldet sich an (über den Code-Schritt, falls ein zweiter Faktor vorhanden ist); andere Frontends benötigen eine Landingpage.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` antwortet gleich, unabhängig davon, ob für die Adresse ein
Konto existiert oder nicht. Das ist Absicht: Ein Endpunkt, der „Benutzer existiert nicht“ meldet,
wäre ein Orakel für die Aufzählung von Benutzerkonten, nutzen Sie das Ergebnis daher nicht,
um einer Person mitzuteilen, ob sie registriert ist — der Endpunkt weiß es nicht.

Für den Versand muss im Backend ein E-Mail-Dienst konfiguriert sein, andernfalls
antwortet `sendMagicLink` mit 503 `EMAIL_NOT_CONFIGURED`.

## Einmalcodes

Ein sechsstelliger Code per E-Mail für dieselbe Aufgabe, wenn ein Link unpraktisch ist — eine native
App, ein zweites Gerät, ein Browser, der Links verändert.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Das Mitsenden der Adresse mit dem Code stellt sicher, dass ein sechsstelliger Rateversuch ein Versuch
gegen *ein* bestimmtes Konto bleibt und nicht gegen alle Konten gleichzeitig.

## Anonyme Sitzungen

Melden Sie einen Besucher ganz ohne Zugangsdaten an, damit er die App nutzen
kann, bevor er einen Grund zur Registrierung hat:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

Das Konto ist echt: Es hat eine ID, Rollen und eine Sitzung, sodass Row-Level Security
seine Zeilen genauso eingrenzt wie bei einem registrierten Benutzer. Was es nicht hat, ist
ein Rückweg — niemand kann sich ein zweites Mal *als* dieses Konto anmelden, sodass alles, was ihm
gehört, mit der Sitzung verloren geht.

`linkAnonymous` sorgt dafür, dass das Konto nicht länger flüchtig ist. Der Benutzer **behält seine ID**,
sodass alles, was er im anonymen Zustand erstellt hat, in seinem Besitz bleibt:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Fehler | Bedeutung |
|---------|-------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Das Backend hat die anonyme Authentifizierung nicht aktiviert oder seit der Anmeldung dieses Gasts deaktiviert: Ein Gast wird nur dann zu einem Konto, wenn `allowAnonymous` aktiviert ist |
| `REGISTRATION_DISABLED` (403) | Die Registrierung ist im Backend deaktiviert, und die Umwandlung in ein Konto ist eine Registrierung |
| `NOT_ANONYMOUS` (400) | Die aktuelle Sitzung gehört zu einem regulären Konto |
| `EMAIL_EXISTS` (409) | Für die Adresse existiert bereits ein Konto — melden Sie sich stattdessen bei diesem an |

<span class="since-badge" data-since="0.27">Seit 0.27</span> Ein Gast, der nie wiederkehrt, bleibt als Zeile bestehen. Ein Administrator kann
diese mit `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` und
`client.admin.deleteGuests({ lastSeenBefore })` oder auf Rebase Cloud mit
[`rebase cloud guests`](/docs/cli/cloud/#guests) bereinigen. Diese Methoden betreffen ausschließlich Gäste,
und `deleteGuests` arbeitet stapelweise: Wiederholen Sie dies, solange `remaining` ungleich 0 ist,
wobei `offset` darauf gesetzt wird, wie viele bisher übersprungen wurden.

## Verknüpfen eines Anbieters mit einem bestehenden Konto

`signInWithGoogle` und ähnliche Methoden melden einen Benutzer *an*. `linkProvider` verknüpft eine
Identität eines Drittanbieters mit dem bereits angemeldeten Konto, sodass dieselbe Person über
beide Wege zurückkehren kann:

```typescript
await client.auth.linkProvider("google", { idToken });
```

Die Sitzung beweist bereits den Kontobesitz, daher muss der Anbieter im Gegensatz zur Anmeldung
die E-Mail-Adresse nicht verifiziert haben, und die beiden Adressen müssen nicht übereinstimmen.
Es verhält sich idempotent erfolgreich (`alreadyLinked: true`), wenn diese Identität bereits mit
diesem Konto verknüpft ist, und bricht mit `IDENTITY_ALREADY_LINKED` (409) ab, wenn sie zu einem anderen gehört.

## Suchen eines Benutzers nach E-Mail-Adresse

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Drei nicht-sensible Felder und sonst nichts — genug, um vor dem Versenden einer
Einladung „Sie laden Jane ein“ anzuzeigen. Opt-in: nur für angemeldete Aufrufer und ein 404-Fehler,
es sei denn, das Backend setzt `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Multi-Faktor-Authentifizierung

Einrichten eines Faktors, der zweite Schritt einer Anmeldung, Wiederherstellungscodes und das Entfernen eines Faktors: [Multi-Faktor-Authentifizierung](/docs/sdk/multi-factor-authentication/).

## Abmelden

```typescript
await client.auth.signOut();
```

Dies widerruft das Refresh-Token auf dem Server, leert die lokale Sitzung und löst ein `SIGNED_OUT`-Event aus.

## Sitzungsverwaltung

### Aktuelle Sitzung abrufen

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

**Speichern Sie niemals das Sitzungsobjekt dauerhaft.** `getSession()` ist eine Momentaufnahme. Jede Erneuerung
des Access-Tokens (etwa einmal pro Stunde) ersetzt die Sitzung durch ein neues Objekt. Eine Sitzung, die seit dem
Laden der Seite behalten wird, enthält daher ein Token, das der Server nach Ablauf ablehnt, und die App wirkt abgemeldet.
Lesen Sie die Sitzung ab, wenn Sie sie benötigen.

### Senden des Tokens an eigene Routen

Der Aufruf einer Funktion in `backend/functions/` erfordert keine Token-Verwaltung:
`client.functions.invoke` erneuert das Token vor dem Senden und versucht es bei einem 401-Fehler
einmal erneut.

```typescript
const saved = await client.functions.invoke("progress", { level: 3 }, { path: "save" });
```

Fragen Sie bei allen anderen Anfragen das Token jedes Mal mit `getAccessToken()` an.
Es erneuert ein abgelaufenes oder bald ablaufendes Token, wartet auf die beim Laden
wiederhergestellte Sitzung und gibt `null` zurück, wenn niemand angemeldet ist.

```typescript
const token = await client.auth.getAccessToken();
await fetch("https://other.example.com/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: file
});
```

### Aktuellen Benutzer abrufen (servervalidiert)

```typescript
const user = await client.auth.getUser();
// Fetches the user from the backend (GET /auth/me)
```

### Benutzerprofil aktualisieren

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Token erneuern

Die Token-Erneuerung erfolgt automatisch, Sie können sie jedoch manuell auslösen:

```typescript
const session = await client.auth.refreshSession();
```

Eine Anfrage wird niemals mit einem Token gesendet, von dem der Client weiß, dass es abgelaufen ist: Anfragen
teilen sich eine Aktualisierung und werden einmal mit dem neuen Token gesendet. Ein Token, das der Server
vorzeitig ablehnt, erhält dennoch eine Aktualisierung und anschließend einen erneuten Versuch pro Anfrage.

## Wo die Sitzung gespeichert wird: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modus | Wo sich das Refresh-Token befindet | Standard |
|------|----------------------------|---------|
| `"cookie"` | Ein **HttpOnly**-Cookie, das das Backend setzt. Skripte auf Ihrer Seite können es nicht lesen, was es XSS-sicher macht | Im Browser |
| `"json"` | Wird im Response-Body zurückgegeben und im `storage` aufbewahrt (standardmäßig `localStorage`) | Außerhalb des Browsers (Node, Worker, React Native) sowie im Browser, wenn Sie Ihren eigenen `storage` übergeben |

Beide Seiten müssen übereinstimmen. Der Cookie-Modus erfordert `auth.cookieAuth` im
Backend, und die Rebase-Runtime, auf der Rebase Cloud läuft, schaltet dies immer ein.
Der Json-Modus erfordert ein Backend ohne diese Option: Bei einem `cookieAuth`-Backend wird
einem Json-Client kein Refresh-Token übergeben, und seine Sitzung endet, sobald das Access-Token
abläuft (ca. eine Stunde nach der Anmeldung). Wenn die Antwort auf eine Anmeldung zeigt, dass die
Modi nicht übereinstimmen, protokolliert der Client einen Fehler mit dem Hinweis, welcher Modus verwendet werden soll.

Die Übergabe eines eigenen `storage` hält einen Browser-Client im Json-Modus. Dies ist für einen
zweiten Client auf der Seite gedacht, der seine eigene Anmeldung getrennt vom Cookie der Seite
verwaltet: Im Cookie-Modus würde in diesem Speicher nichts abgelegt werden.

## Auf die Wiederherstellung der Sitzung warten

**Eine wiederhergestellte Sitzung ist beim ersten Rendern noch nicht verfügbar.** `getSession()` ist
synchron, weshalb es beim Laden der Seite `null` zurückgibt, während die Wiederherstellung noch
läuft — und im Cookie-Modus läuft *immer* eine Wiederherstellung, da sich das Refresh-Token
in einem Cookie befindet, das die Seite nicht lesen kann, sodass der Client beim Server
ein frisches Access-Token anfordern muss.

Das synchrone Auslesen führt bei jedem Neuladen zu einem kurzen Aufblitzen des Abmeldezustands:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` löst auf, sobald der Client den Versuch abgeschlossen hat —
unabhängig davon, ob eine Sitzung gefunden wurde oder nicht:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

In React entspricht das einem Effect:

```tsx
import { useEffect, useState } from "react";

function useCurrentUser() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        client.auth.isInitialized().then(() => {
            if (cancelled) return;
            setUser(client.auth.getSession()?.user ?? null);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, []);

    return { user, loading };
}
```

`useRebaseAuthController` in `@rebasepro/app` übernimmt dies bereits, sodass eine auf
der generierten Vorlage basierende App dies automatisch enthält. Datenanfragen müssen nicht warten: Eine Anfrage,
die während der Wiederherstellung gestellt wird, wird gesendet, sobald diese abgeschlossen ist — als wiederhergestellter
Benutzer oder anonym —, sodass ein erstes Rendern niemals eine öffentliche Liste anstelle der benutzereigenen Daten anzeigt.

Eine Wiederherstellung mit Erneuerung (ein abgelaufenes gespeichertes Token oder Cookie-Modus) erreicht
`onAuthStateChange` als `TOKEN_REFRESHED`; ein noch gültiges gespeichertes Token wird stillschweigend
übernommen. Ein Listener kann Ihnen daher nicht mitteilen, ob die Wiederherstellung abgeschlossen ist: Ein Startvorgang,
der nichts auslöst, ist nicht von einem noch laufenden zu unterscheiden. Warten Sie für diesen Status auf `isInitialized()`
und verwenden Sie den Listener für spätere Änderungen.

`restoreOutcome()` gibt an, wie die Wiederherstellung endete, sobald `isInitialized()` aufgelöst
wurde: `"restored"`, `"none"` (nichts wiederherzustellen), `"refused"` (der Server hat die Sitzung abgelehnt)
oder `"unreachable"` (der Server konnte nicht erreicht werden, daher wurde die Sitzung weder bestätigt noch
abgelehnt). Im Cookie-Modus ist `"unreachable"` ohne Sitzung der einzige Fall, in dem nicht sicher feststeht,
ob der Benutzer tatsächlich abgemeldet ist:

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

## Auth-Status-Listener

Reagieren Sie auf Authentifizierungsänderungen in Ihrer gesamten Anwendung:

```typescript
const unsubscribe = client.auth.onAuthStateChange((event, session) => {
    // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
    console.log("Auth event:", event);
    console.log("Session:", session?.user?.email);
});

// Stop listening
unsubscribe();
```

| Event | Wann |
|-------|------|
| `SIGNED_IN` | Eine Anmeldung oder Registrierung wurde abgeschlossen |
| `TOKEN_REFRESHED` | Das Access-Token wurde erneuert — einschließlich der stillen Erneuerung, die eine Sitzung beim Laden der Seite wiederherstellt |
| `USER_UPDATED` | `updateUser()` hat das Profil geändert, `linkAnonymous()` hat aus einem Gast ein Konto gemacht, `changeEmail()` hat eine Adressänderung initiiert oder `confirmEmailChange()` hat dieses Konto auf die neue Adresse umgestellt |
| `SIGNED_OUT` | Eine Abmeldung, `revokeAllSessions()` oder eine Aktualisierung, die endgültig fehlgeschlagen ist |

## Passwortverwaltung

### Passwort vergessen

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Passwort zurücksetzen (mit Token)

```typescript
const { success, message } = await client.auth.resetPassword(
    resetToken,
    "newSecurePassword"
);
```

### Passwort ändern (authentifiziert)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

Jede andere Sitzung des Kontos wird beendet: Jeder andere Sitzungsinhaber muss sich
mit dem neuen Passwort anmelden. Dieses Gerät bleibt angemeldet. Der Server antwortet mit einer
neuen Sitzung, die der Client übernimmt (was `TOKEN_REFRESHED` auslöst).

## E-Mail-Verifizierung

Bei der Registrierung wird dem neuen Konto der Verifizierungslink per E-Mail zugesendet,
wenn E-Mail konfiguriert ist. `sendVerificationEmail()` versendet ihn erneut.

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link. Signed in as that account, this
// keeps everything on it.
const { passwordRemoved } = await client.auth.verifyEmail(token);

// Signed out, an account that holds a password answers PROOF_REQUIRED:
try {
    await client.auth.verifyEmail(token);
} catch (e) {
    if (e instanceof Error && "code" in e && e.code === "PROOF_REQUIRED") {
        // Keep the password, and sign in:
        await client.auth.verifyEmail(token, { password });
        // …or verify without it, which removes it:
        // await client.auth.verifyEmail(token, { removeUnproven: true });
    }
}
```

Der Link bestätigt den Zugriff auf das Postfach, nicht wer die Adresse registriert hat. Ein Passwort,
das weder durch die Sitzung noch durch den Aufruf bestätigt wird, wird daher entfernt statt beibehalten —
siehe [E-Mail-Verifizierung](/docs/backend/email-verification/).

Bei einem Backend mit `requireEmailVerification` löst `signUp()` mit
`{ confirmationRequired: true, user: null }` und ohne Sitzung auf: Das Konto
wird angemeldet, sobald dem Link mit dem zugehörigen Passwort gefolgt wird.

## Ändern der E-Mail-Adresse

Ein angemeldeter Benutzer überträgt sein eigenes Konto auf eine andere Adresse. Es
ändert sich nichts, bis die neue Adresse bestätigt wird:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

Der Link ist 24 Stunden gültig; `getUser()` meldet die ausstehende Adresse als
`pendingEmail`. Die Bestätigung erfordert keine Sitzung, und ein als dieses Konto
angemeldeter Client übernimmt die neue Adresse und löst `USER_UPDATED` aus. Mögliche
Ablehnungsgründe sind unter [Ändern einer E-Mail-Adresse](/docs/backend/auth-endpoints/#changing-an-email-address) aufgeführt.

## Sitzungsverwaltung (Multi-Device)

```typescript
// List all active sessions, one per sign-in
const sessions = await client.auth.getSessions();
// [{ id, userAgent, ipAddress, createdAt, isCurrentSession }, …]

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

Jedes Access-Token benennt die Anmeldung, zu der es gehört, sodass genau ein Eintrag
`isCurrentSession: true` hat: das anfragende Gerät. Das Widerrufen einer Sitzung beendet das
Refresh-Token dieses Geräts sowie dessen Access-Token gemeinsam ab der nächsten Anfrage
über HTTP und über einen offenen Realtime-Socket. Das Abmelden (`signOut()`) bewirkt dasselbe
für das Gerät, das sich abmeldet. Ein vor dieser Version ausgestelltes Access-Token benennt
keine Sitzung; es funktioniert weiter, bis es innerhalb der Stunde abläuft.

## Auth-Konfiguration

Fragen Sie die Authentifizierungskonfiguration des Backends ab:

```typescript
const config = await client.auth.getAuthConfig();
// {
//   hasBuiltInAuthRoutes: boolean,
//   emailPasswordLogin: boolean,
//   registrationEnabled: boolean,   // open right now, bootstrap window included
//   passwordReset: boolean,         // needs an email service
//   adminPasswordReset: boolean,
//   sessionManagement: boolean,
//   profileUpdate: boolean,
//   emailVerification: boolean,
//   magicLink: boolean, emailOtp?: boolean,
//   anonymousLogin: boolean, enabledProviders: string[],
//   providerClientIds?: Record<string, string>,   // public ids, e.g. { apple: Services ID }
//   externalLoginUrl?: string, needsSetup?: boolean, storage?: boolean
// }
```

## Benutzerdefinierter Sitzungsspeicher

Standardmäßig werden Sitzungen in `localStorage` gespeichert. Sie können dies über die Option `auth` anpassen:

```typescript
import { createRebaseClient, createCookieStorage } from "@rebasepro/client";

// Use cookies instead of localStorage
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    auth: {
        storage: createCookieStorage({
            path: "/",
            sameSite: "Lax",
            secure: true
        }),
        autoRefresh: true,       // default: true
        persistSession: true     // default: true
    }
});
```

## Eigenen Auth-Anbieter verwenden

Clerk, Firebase Auth oder eine Sitzung, die Ihre App bereits hat, mit einem Token-Getter
anstelle von `client.auth`: [Eigener Auth-Anbieter](/docs/sdk/your-own-auth-provider/).

## Struktur des User-Objekts

```typescript
// Canonical type — import from @rebasepro/types
interface User {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    providerId: string;
    isAnonymous: boolean;
    emailVerified?: boolean;
    pendingEmail?: string | null; // an address change waiting for its link
    roles?: string[];          // text[] from the users table
    metadata?: Record<string, unknown>;
}
```

## Nächste Schritte

- **[Daten abfragen](/docs/sdk/querying)** — CRUD-Operationen und Query-Builder
- **[Echtzeit-Abonnements](/docs/sdk/realtime)** — Live-Daten mit WebSockets
- **[Authentifizierungs-Backend](/docs/backend/authentication)** — Serverseitige Auth-Konfiguration

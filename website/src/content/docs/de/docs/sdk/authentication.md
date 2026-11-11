---
sourceHash: 3ef13c31e76183aa
title: Authentifizierung
sidebar_label: Authentifizierung
description: Clientseitige Authentifizierung mit dem Rebase SDK — E-Mail/Passwort-Anmeldung, OAuth-Provider, Sitzungsverwaltung und Auth-Status-Listener.
---

## Übersicht

Das Modul `client.auth` übernimmt die Benutzerauthentifizierung, Token-Verwaltung und Sitzungspersistenz. Sobald sich ein Benutzer anmeldet, enthalten alle nachfolgenden Datenanfragen automatisch das JWT.

Das SDK speichert Sitzungen standardmäßig in `localStorage` und aktualisiert Tokens automatisch, bevor sie ablaufen.

:::note[Jede Anmeldemethode liefert eine flache Sitzung zurück]
`signInWithEmail`, `signUp` und jede `signInWith*`-Methode geben **`{ user, accessToken, refreshToken }`** zurück — das SDK hat die Datenstruktur bereits für Sie aufgelöst.

Die darunterliegende REST-API gibt das Token stattdessen verschachtelt zurück, als `{ user, tokens: { accessToken, … } }`. Dieser Unterschied ist nur relevant, wenn Sie `/api/auth/*` direkt über `fetch` aufrufen, wo `body.accessToken` `undefined` ist und sich das Token unter `body.tokens.accessToken` befindet. Siehe [Wire-Format](/docs/backend/auth-endpoints/#response-format).
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
gibt es keine Sitzung, bis die Adresse bestätigt wurde: `confirmationRequired` ist `true` und `user` ist `null`. Weisen Sie die Person daher an, die E-Mail zu öffnen. Andernfalls ist `confirmationRequired` `false` und `user` das angemeldete Konto.

## OAuth-Provider

Das SDK enthält dedizierte Methoden für gängige OAuth-Provider sowie ein generisches `signInWithOAuth()` für beliebige benutzerdefinierte Provider.

### Google

Unterstützt drei Aufrufarten:

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Weitere Provider

Jeder Provider folgt dem Authorization-Code-Flow mit `(code, redirectUri)`:

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

Twitter erfordert zusätzlich den PKCE Code Verifier:

```typescript
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### Apple

Im Browser öffnet `signInWithApplePopup()` das Popup von Apple, überprüft `state` und
meldet sich mit dem Code an. Rufen Sie es in einem Click-Handler auf. Rufen Sie `preloadAppleSignIn()`
beim Mounten auf, da Safari Popups blockiert, die auf das Herunterladen eines Skripts warten:

```typescript
import { preloadAppleSignIn } from "@rebasepro/client";

void preloadAppleSignIn();                                          // on mount
await client.auth.signInWithApplePopup({ clientId: "com.example.web" }); // on click
```

Ohne `clientId` liest das SDK die Services ID aus `/auth/config`, was
das Popup verzögert. Die Redirect-URI ist standardmäßig der Ursprung (Origin) der Seite plus `/` und
muss als Return-URL bei der Services ID hinterlegt sein (HTTPS, niemals `localhost`). Ein geschlossenes
Popup wird mit dem Code `APPLE_SIGN_IN_CANCELLED` abgelehnt.

Eine native iOS- oder macOS-App sendet den Authorization Code aus Apples nativem
Sign-In zusammen mit ihrer Bundle-ID. Die Bundle-ID muss in `APPLE_BUNDLE_IDS` aufgeführt sein:

```typescript
await client.auth.signInWithApple({
    code: credential.authorizationCode,
    bundleId: "com.example.ios",
    user: { name: { firstName: "Jane" } } // sent by Apple on the first sign-in only
});
```

### Generisches OAuth

Für jeden im Backend registrierten Provider:

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Magic Links

Ein One-Click-Anmeldelink per E-Mail. Der Link lautet immer `<base>/auth/magic-link?token=…`, wobei `<base>` dem `email.magicLinkUrl` des Backends entspricht oder dessen Basis-URL zum Zurücksetzen des Passworts (`FRONTEND_URL` auf der Runtime), falls ersteres nicht gesetzt ist. Es gibt kein anfragespezifisches `redirectTo`. Stellen Sie diesen Pfad in Ihrem Frontend bereit und übergeben Sie das Token zurück, um es gegen eine Sitzung einzutauschen. Das CMS stellt diesen Pfad bereit und führt die Anmeldung durch (inklusive Code-Schritt bei vorhandenem zweiten Faktor); andere Frontends benötigen eine Landingpage.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` gibt die gleiche Antwort zurück, unabhängig davon, ob für die Adresse ein
Konto existiert oder nicht. Das ist Absicht: Ein Endpunkt, der "Benutzer nicht gefunden" zurückgibt, wäre ein Orakel für
Account-Enumeration. Nutzen Sie das Ergebnis daher nicht, um einer Person mitzuteilen, ob sie
registriert ist — das Ergebnis gibt darüber keine Auskunft.

Das Versenden erfordert einen im Backend konfigurierten E-Mail-Dienst, andernfalls
antwortet `sendMagicLink` mit 503 `EMAIL_NOT_CONFIGURED`.

## Einmal-Codes

Ein sechsstelliger Code per E-Mail für dieselbe Aufgabe in Fällen, in denen ein Link unpraktisch ist — eine native
App, ein zweites Gerät oder ein Browser, der Links verändert.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Das Senden der Adresse zusammen mit dem Code stellt sicher, dass ein sechsstelliger Rateversuch nur
*ein* einzelnes Konto betrifft und nicht alle Konten gleichzeitig.

## Anonyme Sitzungen

Melden Sie einen Besucher ganz ohne Zugangsdaten an, damit er die App nutzen kann,
bevor er einen Grund zur Registrierung hat:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

Das Konto ist echt: Es verfügt über eine ID, Rollen und eine Sitzung, sodass Row-Level Security
seine Zeilen genauso filtert wie bei einem registrierten Benutzer. Was es nicht hat, ist
ein Weg zurück — niemand kann sich ein zweites Mal *als* dieses Konto anmelden, sodass alles, was ihm gehört,
mit der Sitzung verloren geht.

Mit `linkAnonymous` ist das Konto kein Einwegkonto mehr. Der Benutzer **behält seine ID**, sodass
alles, was er anonym erstellt hat, in seinem Besitz bleibt:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Fehler | Bedeutung |
|--------|-----------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Das Backend hat die anonyme Authentifizierung nicht aktiviert oder seit der Anmeldung dieses Gastes deaktiviert: Ein Gast wird nur zu einem Konto, solange `allowAnonymous` aktiv ist |
| `REGISTRATION_DISABLED` (403) | Die Registrierung ist im Backend deaktiviert, und die Umwandlung in ein Konto ist eine Registrierung |
| `NOT_ANONYMOUS` (400) | Die aktuelle Sitzung gehört zu einem regulären Konto |
| `EMAIL_EXISTS` (409) | Für die Adresse existiert bereits ein Konto — melden Sie sich stattdessen bei diesem an |

Ein Gast, der nie zurückkehrt, bleibt als Zeile bestehen. Ein Administrator bereinigt
diese mit `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` und
`client.admin.deleteGuests({ lastSeenBefore })` oder auf Rebase Cloud mit
[`rebase cloud guests`](/docs/cli/cloud/#guests). Diese Methoden betreffen ausschließlich Gäste,
und `deleteGuests` arbeitet in Batches: Wiederholen Sie den Aufruf, solange `remaining` nicht 0 ist, wobei
`offset` auf die Anzahl der bisher übersprungenen Einträge gesetzt wird.

## Verknüpfen eines Providers mit einem bestehenden Konto

`signInWithGoogle` und ähnliche Methoden melden einen Benutzer *an*. `linkProvider` verknüpft eine
Provider-Identität mit dem bereits angemeldeten Konto, sodass dieselbe Person sich
über beide Wege anmelden kann:

```typescript
await client.auth.linkProvider("google", { idToken });
```

Die Sitzung weist den Kontobesitz bereits nach. Im Gegensatz zur Anmeldung
muss der Provider die E-Mail-Adresse daher nicht verifiziert haben, und die beiden Adressen müssen nicht
übereinstimmen. Die Aktion ist idempotent erfolgreich (`alreadyLinked: true`), wenn diese Identität
bereits mit diesem Konto verknüpft ist, und schlägt mit `IDENTITY_ALREADY_LINKED` (409) fehl, wenn
sie zu einem anderen Konto gehört.

## Suchen eines Benutzers nach E-Mail

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Drei unkritische Felder und nichts weiter — ausreichend, um "Sie laden Jane ein" anzuzeigen,
bevor eine Einladung gesendet wird. Opt-in: Nur für angemeldete Aufrufer und ein 404,
es sei denn, das Backend setzt `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Multi-Faktor-Authentifizierung

Registrieren eines Faktors, der zweite Schritt einer Anmeldung, Wiederherstellungscodes und das Entfernen eines Faktors: [Multi-Faktor-Authentifizierung](/docs/sdk/multi-factor-authentication/).

## Abmelden

```typescript
await client.auth.signOut();
```

Dies widerruft das Refresh-Token auf dem Server, löscht die lokale Sitzung und löst ein `SIGNED_OUT`-Event aus.

## Sitzungsverwaltung

### Aktuelle Sitzung abrufen

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

**Speichern Sie das Session-Objekt niemals dauerhaft.** `getSession()` ist ein Snapshot. Jede Erneuerung
des Access-Tokens, etwa einmal pro Stunde, ersetzt die Sitzung durch ein neues
Objekt. Eine Sitzung, die beim Laden der Seite gespeichert wurde, enthält daher ein Token, das der Server
nach Ablauf ablehnt, und die App wirkt abgemeldet. Lesen Sie die Sitzung erst dann aus, wenn Sie sie benötigen.

### Senden des Tokens an eigene Routen

Der Aufruf einer Funktion in `backend/functions/` erfordert keine Token-Verwaltung:
`client.functions.invoke` erneuert das Token vor dem Senden und unternimmt bei
einem 401-Fehler einen erneuten Versuch.

```typescript
const saved = await client.functions.invoke("progress", { level: 3 }, { path: "save" });
```

Fordern Sie das Token für alle anderen Anfragen jedes Mal mit `getAccessToken()` an.
Es erneuert ein abgelaufenes oder bald ablaufendes Token, wartet auf die beim
Laden wiederhergestellte Sitzung und gibt `null` zurück, wenn niemand angemeldet ist.

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

### Token aktualisieren

Die Token-Aktualisierung erfolgt automatisch, kann aber auch manuell angestoßen werden:

```typescript
const session = await client.auth.refreshSession();
```

Eine Anfrage wird niemals mit einem Token gesendet, von dem der Client weiß, dass es abgelaufen ist: Anfragen
teilen sich einen gemeinsamen Refresh-Vorgang und werden einmal mit dem neuen Token gesendet. Ein Token, das der Server
vorzeitig ablehnt, erhält dennoch einen Refresh-Versuch und anschließend einen erneuten Versuch pro Anfrage.

## Speicherort der Sitzung: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modus | Speicherort des Refresh-Tokens | Standard |
|-------|-------------------------------|----------|
| `"cookie"` | Ein vom Backend gesetztes **HttpOnly**-Cookie. Skripte auf Ihrer Seite können es nicht auslesen, was es XSS-sicher macht | Im Browser |
| `"json"` | Im Response-Body zurückgegeben, im `storage` gespeichert (standardmäßig `localStorage`) | Außerhalb des Browsers (Node, Worker, React Native) und im Browser, wenn Sie einen eigenen `storage` übergeben |

Der Cookie-Modus erfordert `auth.cookieAuth` im Backend: Die Rebase-Runtime (und damit
Rebase Cloud) aktiviert dies immer, und seit Version 0.30 tut dies auch `initializeRebaseBackend`,
sofern nicht explizit `cookieAuth: false` gesetzt ist. Der Json-Modus funktioniert mit beiden: Seine Auth-Anfragen
enthalten den Header `x-rebase-auth-flow: json`, worauf das Refresh-Token im Response-Body
zurückgegeben wird. Ein Backend vor Version 0.29 liefert an einen Json-Client kein Token aus, sodass dessen Sitzung
nach etwa einer Stunde endet und der Client protokolliert, welcher Modus verwendet werden soll (außer es wurde `storage` übergeben).

Die Übergabe eines eigenen `storage` hält einen Browser-Client im Json-Modus — nützlich für einen zweiten
Client, der eine separate Anmeldung unabhängig vom Cookie der Seite verwaltet, wie etwa ein Gast
neben dem angemeldeten Konto. Dessen Refresh-Token liegt in diesem Speicher, wo Skripte der Seite
ihn auslesen können; belassen Sie das primäre Konto der Seite daher im Cookie-Modus.

## Warten auf die Wiederherstellung der Sitzung

**Eine wiederhergestellte Sitzung ist beim ersten Rendern noch nicht verfügbar.** `getSession()` ist
synchron, weshalb es beim Laden der Seite `null` zurückgibt, während die Wiederherstellung noch läuft —
und im Cookie-Modus ist eine Wiederherstellung *immer* im Gange, da sich das Refresh-Token
in einem Cookie befindet, das die Seite nicht auslesen kann, sodass der Client beim Server
ein neues Access-Token anfordern muss.

Das synchrone Auslesen führt bei jedem Neuladen zu einem kurzen Aufblitzen des abgemeldeten Zustands (Logged-out-Flash):

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` wird aufgelöst, sobald der Client den Versuch abgeschlossen hat — unabhängig davon,
ob eine Sitzung gefunden wurde oder nicht:

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
der generierten Vorlage aufbauende App dies automatisch erhält. Datenanfragen müssen nicht warten: Eine Anfrage, die
während der Wiederherstellung gestellt wird, wird gesendet, sobald diese abgeschlossen ist — als wiederhergestellter Benutzer oder anonym —, sodass ein
erstes Rendern niemals eine öffentliche Liste anstelle der benutzerbezogenen Daten abruft.

Eine Wiederherstellung, die ein Refresh durchführt (bei einem abgelaufenen gespeicherten Token oder im Cookie-Modus), erreicht
`onAuthStateChange` als `TOKEN_REFRESHED`; ein noch gültiges gespeichertes Token wird stillschweigend
übernommen. Daher kann ein Listener nicht mitteilen, ob die Wiederherstellung abgeschlossen ist: Ein Startvorgang, der
nichts auslöst, ist nicht von einem noch laufenden Vorgang zu unterscheiden. Warten Sie bei dieser Frage auf `isInitialized()`
und verwenden Sie den Listener für spätere Änderungen.

`restoreOutcome()` gibt an, wie die Wiederherstellung endete, sobald `isInitialized()`
aufgelöst wurde: `"restored"`, `"none"` (nichts zum Wiederherstellen), `"refused"` (der Server
hat die Sitzung abgelehnt) oder `"unreachable"` (der Server konnte nicht erreicht werden, sodass
die Sitzung weder bestätigt noch abgelehnt wurde). Im Cookie-Modus ist `"unreachable"`
ohne Sitzung der einzige Fall, in dem "abgemeldet" nicht gesichert ist:

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

| Ereignis | Wann |
|----------|------|
| `SIGNED_IN` | Eine Anmeldung oder Registrierung wurde abgeschlossen |
| `TOKEN_REFRESHED` | Das Access-Token wurde erneuert — einschließlich der stillen Erneuerung, die eine Sitzung beim Laden der Seite wiederherstellt |
| `USER_UPDATED` | `updateUser()` hat das Profil geändert, `linkAnonymous()` hat einen Gast in ein Konto umgewandelt, `changeEmail()` hat eine Adressänderung gestartet oder `confirmEmailChange()` hat dieses Konto auf seine neue Adresse umgestellt |
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
neuen Sitzung, und der Client übernimmt diese (wobei `TOKEN_REFRESHED` ausgelöst wird).

## E-Mail-Verifizierung

Bei der Registrierung wird dem neuen Konto ein Verifizierungslink per E-Mail gesendet, sofern E-Mail
konfiguriert ist. `sendVerificationEmail()` versendet diesen erneut.

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

Der Link verifiziert den Posteingang, nicht wer die Adresse registriert hat. Ein Passwort,
das weder durch die Sitzung noch durch den Aufruf belegt wird, wird daher entfernt statt beibehalten — siehe
[E-Mail-Verifizierung](/docs/backend/email-verification/).

Auf einem Backend mit `requireEmailVerification` löst `signUp()` mit
`{ confirmationRequired: true, user: null }` und ohne Sitzung auf: Das Konto
meldet sich an, sobald dem Link mit dem zugehörigen Passwort gefolgt wurde.

## E-Mail-Adresse ändern

Ein angemeldeter Benutzer überträgt sein Konto auf eine andere Adresse. Es
ändert sich nichts, bis die neue Adresse bestätigt wird:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

Der Link ist 24 Stunden lang gültig; `getUser()` meldet die ausstehende Adresse als
`pendingEmail`. Die Bestätigung erfordert keine Sitzung, und ein als dieses
Konto angemeldeter Client übernimmt die neue Adresse und löst `USER_UPDATED` aus. Die Ablehnungsgründe sind
in [E-Mail-Adresse ändern](/docs/backend/auth-endpoints/#changing-an-email-address) aufgeführt.

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
`isCurrentSession: true` aufweist: das anfragende Gerät. Das Widerrufen einer Sitzung beendet das
Refresh-Token dieses Geräts und sein Access-Token zusammen, ab der nächsten Anfrage,
über HTTP und über einen offenen Realtime-Socket. Das Abmelden (`signOut()`) bewirkt das
Gleiche für das Gerät, das sich abmeldet. Ein vor dieser Version ausgestelltes Access-Token
benennt keine Sitzung; es bleibt bis zu seinem Ablauf innerhalb einer Stunde gültig.

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
//   magicLink: boolean, emailOtp?: boolean, deviceLogin?: boolean,
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

## Eigenen Auth-Provider verwenden

Clerk, Firebase Auth oder eine Sitzung, die Ihre App bereits hat, mit einem Token-Getter
anstelle von `client.auth`: [Eigener Auth-Provider](/docs/sdk/your-own-auth-provider/).

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
- **[Realtime-Abonnements](/docs/sdk/realtime)** — Live-Daten mit WebSockets
- **[Authentifizierungs-Backend](/docs/backend/authentication)** — Serverseitige Auth-Konfiguration

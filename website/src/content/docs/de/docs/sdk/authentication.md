---
sourceHash: e886a47c056f9c06
title: Authentifizierung
sidebar_label: Authentifizierung
description: Clientseitige Authentifizierung mit dem Rebase SDK — E-Mail/Passwort-Anmeldung, OAuth-Anbieter, Sitzungsverwaltung und Auth-Status-Listener.
---

## Übersicht

Das Modul `client.auth` verarbeitet die Benutzerauthentifizierung, Token-Verwaltung und Sitzungspersistenz. Sobald sich ein Benutzer anmeldet, enthalten alle nachfolgenden Datenanfragen automatisch das JWT.

Das SDK speichert Sitzungen standardmäßig in `localStorage` und aktualisiert Tokens automatisch, bevor sie ablaufen.

:::note[Jede Anmeldemethode liefert eine vereinfachte Sitzung zurück]
`signInWithEmail`, `signUp` und jede `signInWith*`-Methode geben **`{ user, accessToken, refreshToken }`** zurück — das SDK hat die Envelope-Struktur bereits für Sie aufgelöst.

Die darunterliegende REST-API gibt das Token stattdessen verschachtelt zurück, als `{ user, tokens: { accessToken, … } }`. Dieser Unterschied ist nur relevant, wenn Sie `/api/auth/*` auch direkt mit `fetch` aufrufen, wo `body.accessToken` `undefined` ist und sich das Token unter `body.tokens.accessToken` befindet. Siehe [Wire-Format](/docs/backend/auth-endpoints/#response-format).
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
gibt es keine Sitzung, bis die Adresse bestätigt wurde: `confirmationRequired` ist `true` und `user` ist `null`. Weisen Sie die Person daher an, die E-Mail zu öffnen. Andernfalls ist `confirmationRequired` `false` und `user` das angemeldete Konto. In Version 0.23 löst `signUp` `{ user, accessToken, refreshToken }` auf und meldet immer an.

## OAuth-Anbieter

Das SDK enthält dedizierte Methoden für gängige OAuth-Anbieter sowie ein generisches `signInWithOAuth()` für jeden benutzerdefinierten Anbieter.

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

Apple und Twitter erfordern zusätzliche Parameter:

```typescript
// Apple — optional user info from first sign-in
await client.auth.signInWithApple(code, redirectUri, {
    name: { firstName: "Jane", lastName: "Doe" },
    email: "jane@example.com"
});

// Twitter — requires PKCE code verifier
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
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

Ein Ein-Klick-Anmeldelink per E-Mail. Der Link lautet immer `<base>/auth/magic-link?token=…`, wobei `<base>` der Wert von `email.magicLinkUrl` des Backends ist, oder dessen Basis-URL zum Zurücksetzen des Passworts (`FRONTEND_URL` in der Runtime), falls Ersteres nicht gesetzt ist. Es gibt kein anfragebezogenes `redirectTo`. Stellen Sie diesen Pfad in Ihrem Frontend bereit und übergeben Sie das Token zurück, um es gegen eine Sitzung einzutauschen. Das CMS stellt diesen Pfad bereit und meldet an (über den Code-Schritt, wenn ein zweiter Faktor vorliegt); andere Frontends benötigen eine Landingpage.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` liefert die gleiche Antwort, unabhängig davon, ob für die Adresse ein
Konto existiert oder nicht. Das ist Absicht: Ein Endpunkt, der "Benutzer existiert nicht"
melden würde, wäre ein Orakel für Account-Enumeration. Nutzen Sie das Ergebnis daher nicht,
um einer Person mitzuteilen, ob sie registriert ist — der Endpunkt weiß es nicht.

Das Senden erfordert einen im Backend konfigurierten E-Mail-Dienst, andernfalls
antwortet `sendMagicLink` mit 503 `EMAIL_NOT_CONFIGURED`.

## Einmal-Codes

Ein sechsstelliger Code per E-Mail für den gleichen Zweck, wenn ein Link unpraktisch ist — eine native
App, ein zweites Gerät oder ein Browser, der Links verändert.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Das Senden der Adresse zusammen mit dem Code stellt sicher, dass ein Erraten des sechsstelligen Codes nur einen Versuch gegen *ein* bestimmtes Konto darstellt und nicht gegen alle Konten gleichzeitig.

## Anonyme Sitzungen

Melden Sie einen Besucher ganz ohne Anmeldedaten an, damit er die App nutzen kann,
bevor er einen Grund zur Registrierung hat:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

Das Konto ist echt: Es besitzt eine ID, Rollen und eine Sitzung, sodass Row-Level Security
seine Zeilen genauso filtert wie bei einem registrierten Benutzer. Was es nicht hat, ist
ein Weg zurück — niemand kann sich ein zweites Mal *als* dieses Konto anmelden, sodass alles, was
ihm gehört, mit der Sitzung verloren geht.

Mit `linkAnonymous` hört es auf, ein Einwegkonto zu sein. Der Benutzer **behält seine ID**,
sodass alles, was er im anonymen Zustand erstellt hat, in seinem Besitz bleibt:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Fehler | Bedeutung |
|---------|-------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Das Backend hat die anonyme Authentifizierung nicht aktiviert oder seit der Anmeldung dieses Gastes deaktiviert: Ein Gast wird nur dann zu einem Konto, wenn `allowAnonymous` aktiviert ist |
| `REGISTRATION_DISABLED` (403) | Die Registrierung ist im Backend deaktiviert, und die Umwandlung in ein Konto stellt eine Registrierung dar |
| `NOT_ANONYMOUS` (400) | Die aktuelle Sitzung gehört zu einem regulären Konto |
| `EMAIL_EXISTS` (409) | Für die Adresse existiert bereits ein Konto — melden Sie sich stattdessen bei diesem an |

<span class="since-badge" data-since="0.27">Seit 0.27</span> Ein Gast, der nie wiederkehrt, bleibt als Zeile bestehen. Ein Administrator bereinigt
diese mit `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` und
`client.admin.deleteGuests({ lastSeenBefore })` oder in der Rebase Cloud mit
[`rebase cloud guests`](/docs/cli/cloud/#guests). Diese Methoden betreffen ausschließlich Gäste,
und `deleteGuests` arbeitet stapelweise: Wiederholen Sie den Aufruf, solange `remaining` nicht 0 ist, wobei
`offset` auf die Anzahl der bisher übersprungenen Einträge gesetzt wird.

## Einen Anbieter mit einem bestehenden Konto verknüpfen

`signInWithGoogle` und ähnliche Methoden melden einen Benutzer *an*. `linkProvider` verknüpft eine
Anbieter-Identität mit dem bereits angemeldeten Konto, sodass dieselbe Person
über beide Wege zurückkehren kann:

```typescript
await client.auth.linkProvider("google", { idToken });
```

Die Sitzung belegt bereits den Kontobesitz; im Gegensatz zur Anmeldung ist es daher nicht
erforderlich, dass der Anbieter die E-Mail-Adresse verifiziert hat, und die beiden Adressen müssen nicht
übereinstimmen. Es ist idempotent erfolgreich (`alreadyLinked: true`), wenn diese Identität
bereits mit diesem Konto verknüpft ist, und schlägt mit `IDENTITY_ALREADY_LINKED` (409) fehl,
wenn sie zu einem anderen gehört.

## Benutzer per E-Mail nachschlagen

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Drei unkritische Felder und nichts weiter — ausreichend, um "Sie laden Jane ein" anzuzeigen,
bevor eine Einladung versendet wird. Opt-in: Nur für angemeldete Aufrufer und ein 404-Fehler,
sofern das Backend nicht `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`) setzt.

## Multi-Faktor-Authentifizierung

Registrieren eines Faktors, der zweite Schritt einer Anmeldung, Wiederherstellungscodes und das Entfernen eines Faktors: [Multi-Faktor-Authentifizierung](/docs/sdk/multi-factor-authentication/).

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

Die Token-Aktualisierung erfolgt automatisch, Sie können sie jedoch auch manuell auslösen:

```typescript
const session = await client.auth.refreshSession();
```

Eine Anfrage wird niemals mit einem Token gesendet, von dem der Client weiß, dass es abgelaufen ist: Anfragen
teilen sich einen Refresh-Vorgang und werden einmalig mit dem neuen Token gesendet. Ein Token, das der Server
vorzeitig ablehnt, erhält dennoch einen Refresh-Versuch und anschließend einen erneuten Versuch pro Anfrage.

## Speicherort der Sitzung: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modus | Wo sich das Refresh-Token befindet | Wann es verwendet werden sollte |
|------|----------------------------|----------------|
| `"json"` *(Standard)* | Im Response-Body zurückgegeben, in `localStorage` gespeichert | Eine native App, ein Skript oder alles ohne Cookie-Speicher eines Browsers |
| `"cookie"` | Ein vom Backend gesetztes **HttpOnly**-Cookie | Eine Browser-App. Auf Ihrer Seite ausgeführte Skripte können es nicht lesen, was es XSS-sicher macht |

Der Cookie-Modus erfordert `auth.cookieAuth` im Backend und wird von der generierten
Frontend-Vorlage standardmäßig verwendet.

## Warten auf die Wiederherstellung der Sitzung

**Eine wiederhergestellte Sitzung ist beim ersten Rendern nicht verfügbar.** `getSession()` ist
synchron, daher liefert es beim Laden der Seite `null` zurück, während die Wiederherstellung noch
im Gange ist — und im Cookie-Modus ist eine Wiederherstellung *immer* im Gange, da sich das Refresh-Token
in einem Cookie befindet, das die Seite nicht lesen kann. Der Client muss daher beim Server
ein neues Access-Token anfordern.

Das synchrone Auslesen führt bei jedem Neuladen zu einem kurzen Aufblitzen des abgemeldeten Zustands:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` löst auf, sobald der Client den Versuch abgeschlossen hat — unabhängig davon,
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

`useRebaseAuthController` in `@rebasepro/app` übernimmt dies bereits, sodass eine mit
der generierten Vorlage erstellte App dies automatisch erhält. Datenanfragen müssen nicht warten: Eine Anfrage,
die während der Wiederherstellung gestellt wird, wird gesendet, sobald diese abgeschlossen ist — entweder als der wiederhergestellte Benutzer oder anonym —, sodass ein
erstes Rendern niemals eine öffentliche Auflistung anstelle der benutzerdefinierten Daten anzeigt.

Eine Wiederherstellung mit Token-Aktualisierung (ein abgelaufenes gespeichertes Token oder im Cookie-Modus) erreicht
`onAuthStateChange` als `TOKEN_REFRESHED`; ein noch gültiges gespeichertes Token wird
still übernommen. Daher kann ein Listener Ihnen nicht mitteilen, wann die Wiederherstellung abgeschlossen ist: Ein Startvorgang, der
nichts auslöst, ist nicht von einem noch laufenden zu unterscheiden. Warten Sie für diese Prüfung
auf `isInitialized()` und nutzen Sie den Listener für nachfolgende Änderungen.

`restoreOutcome()` gibt an, wie die Wiederherstellung beendet wurde, sobald `isInitialized()`
aufgelöst ist: `"restored"`, `"none"` (nichts wiederherzustellen), `"refused"` (der Server
hat die Sitzung abgelehnt) oder `"unreachable"` (der Server konnte nicht erreicht werden,
sodass die Sitzung weder bestätigt noch abgelehnt wurde). Im Cookie-Modus ist `"unreachable"`
ohne Sitzung der einzige Fall, in dem nicht sicher ist, ob der Benutzer tatsächlich "abgemeldet" ist:

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
| `USER_UPDATED` | `updateUser()` hat das Profil geändert, `linkAnonymous()` hat aus einem Gast ein Konto gemacht, `changeEmail()` hat eine Adressänderung gestartet oder `confirmEmailChange()` hat dieses Konto auf seine neue Adresse umgestellt |
| `SIGNED_OUT` | Eine Abmeldung, `revokeAllSessions()` oder eine endgültig fehlgeschlagene Token-Aktualisierung |

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

Alle anderen Sitzungen des Kontos werden beendet: Jeder andere Sitzungsinhaber muss sich
mit dem neuen Passwort neu anmelden. Dieses Gerät bleibt angemeldet. Der Server antwortet mit einer
neuen Sitzung, und der Client übernimmt diese (wodurch `TOKEN_REFRESHED` ausgelöst wird).

## E-Mail-Verifizierung

Bei der Registrierung wird dem neuen Konto ein Verifizierungslink per E-Mail gesendet, sofern E-Mail
konfiguriert ist. `sendVerificationEmail()` sendet diesen erneut.

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
das weder durch die Sitzung noch durch den Aufruf bestätigt wird, wird daher entfernt statt beibehalten — siehe
[E-Mail-Verifizierung](/docs/backend/email-verification/).

Auf einem Backend mit `requireEmailVerification` löst `signUp()` mit
`{ confirmationRequired: true, user: null }` und ohne Sitzung auf: Das Konto
meldet sich an, sobald dem Link gefolgt und das Passwort angegeben wurde.

## E-Mail-Adresse ändern

Ein angemeldeter Benutzer überträgt sein eigenes Konto auf eine andere Adresse. Es
ändert sich nichts, bis die neue Adresse bestätigt wird:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

Der Link ist 24 Stunden lang gültig; `getUser()` gibt die ausstehende Adresse als
`pendingEmail` an. Die Bestätigung erfordert keine Sitzung, und ein als dieses
Konto angemeldeter Client übernimmt die neue Adresse und löst `USER_UPDATED` aus. Die Ablehnungsgründe sind
unter [E-Mail-Adresse ändern](/docs/backend/auth-endpoints/#changing-an-email-address) aufgeführt.

## Sitzungsverwaltung (mehrere Geräte)

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
Refresh-Token dieses Geräts und dessen Access-Token zusammen, ab der nächsten Anfrage,
sowohl über HTTP als auch über einen offenen Realtime-Socket. Das Abmelden (`signOut()`) bewirkt
dasselbe für das abmeldende Gerät. Ein vor diesem Release ausgestelltes Access-Token
benennt keine Sitzung; es funktioniert weiter, bis es innerhalb einer Stunde abläuft.

## Auth-Konfiguration

Rufen Sie die Authentifizierungskonfiguration des Backends ab:

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

## Verwenden eines eigenen Auth-Anbieters

In Version 0.24 authentifiziert ein Token-Getter
nur HTTP-Anfragen, und der Realtime-Socket bleibt
anonym.

Wenn sich Benutzer über einen eigenen Anbieter anmelden (Clerk, Firebase Auth oder eine
bereits in Ihrer App vorhandene Sitzung), ist `client.auth` nicht beteiligt. Übergeben Sie dem Client
stattdessen einen Getter für das Token des Anbieters. Dieser wird jedes Mal aufgerufen, wenn ein Token
benötigt wird: für jede HTTP-Anfrage und jedes Mal, wenn sich der Realtime-Socket
authentifiziert.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));

// Optional: let Clerk recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await clerk.session?.reload();
    return true;
});

// The socket authenticates as the Clerk user.
client.data.posts.listen({}, (response) => render(response.data));
```

- Der Getter hat Vorrang vor der clientspezifischen Sitzung. Wenn er `null` zurückgibt oder
  einen Fehler auslöst, sendet der Client das Token, das er hält (falls vorhanden): das seiner Sitzung, ein über
  `client.setToken()` gesetztes oder die Option `token`.
- Die Option `token` wird jedes Mal ausgelesen, wenn ein Token benötigt wird, bis `setToken()` oder
  eine Anmeldung sie ersetzt. Sie kann daher als Getter deklariert werden
  (`get token() { return currentToken; }`).
- `setOnUnauthorized` deckt einen 401-Fehler über HTTP sowie Authentifizierungsfehler auf dem Socket ab
  und ersetzt die eigene Sitzungsaktualisierung des Clients.

Das Backend muss das Token des Anbieters verifizieren: Siehe
[Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters). Setzen Sie im Admin-Panel
den Getter auf dem Client, den Sie an `<Rebase client>` übergeben
([Eigener Auth-Anbieter](/docs/frontend/authentication#your-own-auth-provider)).

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

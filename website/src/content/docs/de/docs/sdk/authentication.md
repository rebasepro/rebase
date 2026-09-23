---
sourceHash: 9268d903ba4bf874
title: Authentifizierung
sidebar_label: Authentifizierung
description: Clientseitige Authentifizierung mit dem Rebase SDK — E-Mail/Passwort-Anmeldung, OAuth-Anbieter, Sitzungsverwaltung und Auth-Status-Listener.
---

## Übersicht

Das Modul `client.auth` verwaltet die Benutzerauthentifizierung, Token-Verwaltung und Sitzungspersistenz. Sobald sich ein Benutzer anmeldet, enthalten alle nachfolgenden Datenanfragen automatisch das JWT.

Das SDK speichert Sitzungen standardmäßig im `localStorage` und aktualisiert Tokens automatisch, bevor sie ablaufen.

:::note[Jede Anmeldemethode liefert eine verflachte Sitzung zurück]
`signInWithEmail`, `signUp` und jede `signInWith*`-Methode geben
**`{ user, accessToken, refreshToken }`** zurück — das SDK hat den
Umschlag bereits für Sie entpackt.

Die darunterliegende REST-API gibt das Token stattdessen verschachtelt zurück, als
`{ user, tokens: { accessToken, … } }`. Dieser Unterschied ist nur relevant, wenn Sie
`/api/auth/*` auch direkt mit `fetch` aufrufen, wobei `body.accessToken` `undefined` ist
und das Token unter `body.tokens.accessToken` liegt. Siehe
[das Wire-Format](/docs/backend/auth-endpoints/#response-format).
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
const { user } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

## OAuth-Anbieter

Das SDK enthält dedizierte Methoden für beliebte OAuth-Anbieter sowie ein generisches `signInWithOAuth()` für jeden benutzerdefinierten Anbieter.

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

Ein Ein-Klick-Anmeldelink per E-Mail. Der Link führt zu einer Seite Ihrer Anwendung und enthält ein Token; übergeben Sie das Token zurück, um es gegen eine Sitzung einzutauschen.

```typescript
// 1. Ask for the link. `redirectTo` is where the link points.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` liefert die gleiche Antwort, unabhängig davon, ob für die Adresse ein Konto existiert oder nicht. Das ist Absicht: Ein Endpunkt, der „Benutzer existiert nicht“ meldet, wäre ein Orakel für die Konto-Enumeration (Account Enumeration). Nutzen Sie das Ergebnis daher nicht, um einer Person mitzuteilen, ob sie registriert ist — der Endpunkt weiß es nicht.

Beide erfordern einen im Backend konfigurierten E-Mail-Dienst, andernfalls antworten sie mit 503 `EMAIL_NOT_CONFIGURED`.

## Einmalcodes

Ein sechsstelliger Code per E-Mail für Fälle, in denen ein Link unpraktisch ist — eine native App, ein zweites Gerät, ein Browser, der Links beschädigt.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Das Senden der Adresse zusammen mit dem Code stellt sicher, dass ein sechsstelliger Rateversuch ein Versuch gegen *ein einzelnes* Konto bleibt und nicht gegen alle Konten gleichzeitig gerichtet ist.

## Anonyme Sitzungen

Melden Sie einen Besucher ganz ohne Anmeldedaten an, sodass er die App nutzen kann, bevor er einen Grund zur Registrierung hat:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

Das Konto ist echt: Es besitzt eine ID, Rollen und eine Sitzung, sodass Row-Level Security seine Zeilen genauso eingrenzt wie bei einem registrierten Benutzer. Was es nicht hat, ist ein Weg zurück — niemand kann sich ein zweites Mal *als* dieses Konto anmelden, daher geht alles, was ihm gehört, mit der Sitzung verloren.

Mit `linkAnonymous` hört es auf, ein Wegwerfkonto zu sein. Der Benutzer **behält seine ID**, sodass alles, was er im anonymen Zustand erstellt hat, in seinem Besitz bleibt:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Fehler | Bedeutung |
|---------|-------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Das Backend hat die anonyme Authentifizierung nicht aktiviert |
| `NOT_ANONYMOUS` (400) | Die aktuelle Sitzung gehört zu einem regulären Konto |
| `EMAIL_EXISTS` (409) | Für die Adresse existiert bereits ein Konto — melden Sie sich stattdessen bei diesem an |

## Einen Anbieter mit einem bestehenden Konto verknüpfen

`signInWithGoogle` und Co. melden einen Benutzer *an*. `linkProvider` verknüpft eine Anbieteridentität mit dem bereits angemeldeten Konto, sodass dieselbe Person über beide Wege zurückkehren kann:

```typescript
await client.auth.linkProvider("google", { idToken });
```

Die Sitzung beweist bereits den Kontobesitz. Im Gegensatz zur Anmeldung muss der Anbieter die E-Mail-Adresse daher nicht verifiziert haben, und die beiden Adressen müssen nicht übereinstimmen. Die Verknüpfung gelingt idempotent (`alreadyLinked: true`), wenn diese Identität dem Konto bereits zugeordnet ist, und verweigert die Verknüpfung mit `IDENTITY_ALREADY_LINKED` (409), wenn sie zu einem anderen Konto gehört.

## Benutzer per E-Mail nachschlagen

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Drei unkritische Felder und nichts weiter — genug, um „Sie laden Jane ein“ anzuzeigen, bevor eine Einladung gesendet wird.

## Multi-Faktor-Authentifizierung

TOTP-Faktoren — eine Authentifikator-App — plus die Challenge, die eine Sitzung von `aal1` auf `aal2` hochstuft.

### Faktor registrieren

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
showRecoveryCodes(recoveryCodes);
```

**Zeigen Sie die Wiederherstellungscodes einmalig und nie wieder an.** Da nur deren Hashes gespeichert werden, können sie später nicht mehr angezeigt werden.

Der Faktor ist erst nutzbar, wenn der Benutzer nachweist, dass sein Authentifikator einen Code aus diesem Secret generiert hat:

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

### Mit MFA anmelden

Eine Anmeldung an einem Konto mit eingerichteter MFA liefert keine Sitzung. Sie wird mit `401 MFA_REQUIRED` abgelehnt, und die `details` des Fehlers enthalten ein `mfaToken` und die verifizierten `factors` des Kontos. Übergeben Sie dieses Token an `challenge` und `verifyChallenge`, um die Sitzung zu erhalten:

```typescript
import { RebaseApiError } from "@rebasepro/client";

type MfaRequired = {
    mfaToken: string;
    factors: { id: string; factorType: string; friendlyName?: string }[];
};

try {
    await client.auth.signInWithEmail(email, password);
} catch (e) {
    if (!(e instanceof RebaseApiError) || e.code !== "MFA_REQUIRED") throw e;
    const { mfaToken, factors } = e.details as MfaRequired;

    const { challengeId } = await client.auth.mfa.challenge(factors[0].id, { mfaToken });

    // A TOTP code, or one of the recovery codes.
    const { user } = await client.auth.mfa.verifyChallenge(challengeId, "418293", { mfaToken });
}
```

Das `mfaToken` wird nur bei diesen beiden Anfragen gesendet und nie im Client hinterlegt. `verifyChallenge` erstellt die `aal2`-Sitzung, dieser Client übernimmt sie und sendet `SIGNED_IN` wie bei jeder anderen Anmeldung. Das `mfaToken` läuft fünf Minuten nach der Anmeldung ab, die es geliefert hat, und eine Challenge fünf Minuten nachdem sie geöffnet wurde. Eine Challenge, deren Rateversuche das Limit erreicht haben, bleibt für den Rest ihrer Lebensdauer ungültig — andernfalls würde eine offene Challenge unbegrenzte Versuche für sechs Ziffern ermöglichen.

Ohne `mfaToken` stufen die beiden Aufrufe die Sitzung, die dieser Client bereits hält, von `aal1` auf `aal2` hoch.

### Faktor entfernen

```typescript
await client.auth.mfa.unenroll(factorId);
```

Erfordert eine `aal2`-Sitzung — also eine, die bereits eine Challenge beantwortet hat —, damit ein gestohlenes `aal1`-Token MFA nicht deaktivieren kann. Durch das Entfernen des letzten verifizierten Faktors werden auch die Wiederherstellungscodes gelöscht.

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

### Aktuellen Benutzer abrufen (serververifiziert)

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

## Wo die Sitzung gespeichert wird: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modus | Wo sich das Refresh-Token befindet | Wann man ihn verwendet |
|------|----------------------------|----------------|
| `"json"` *(Standard)* | Im Response-Body zurückgegeben, im `localStorage` gehalten | Eine native App, ein Skript, alles ohne den Cookie-Speicher eines Browsers |
| `"cookie"` | Ein **HttpOnly**-Cookie, das das Backend setzt | Eine Browser-App. Skripte auf Ihrer Seite können es nicht lesen, was es XSS-sicher macht |

Der Cookie-Modus erfordert `auth.cookieAuth` im Backend und wird von der generierten Frontend-Vorlage standardmäßig verwendet.

## Auf die Wiederherstellung der Sitzung warten

**Eine wiederhergestellte Sitzung ist beim ersten Rendern noch nicht verfügbar.** `getSession()` ist synchron, weshalb es beim Laden der Seite `null` zurückgibt, während die Wiederherstellung noch läuft — und im Cookie-Modus läuft *immer* eine Wiederherstellung, da sich das Refresh-Token in einem Cookie befindet, das die Seite nicht lesen kann, sodass der Client beim Server ein neues Access-Token anfragen muss.

Das synchrone Auslesen führt bei jedem Neuladen zu einem kurzen Aufblitzen des abgemeldeten Zustands (Flash):

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` löst auf, sobald der Client den Versuch abgeschlossen hat — unabhängig davon, ob eine Sitzung gefunden wurde oder nicht:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

In React entspricht das einem einzigen Effect:

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

`useRebaseAuthController` in `@rebasepro/app` erledigt dies bereits, sodass eine auf der generierten Vorlage aufbauende App dies automatisch mitbringt.

Eine erfolgreiche Wiederherstellung erreicht `onAuthStateChange` auch als `TOKEN_REFRESHED` — es *ist* eine Aktualisierung —, aber ein Listener allein kann Ihnen nicht sagen, ob die Wiederherstellung abgeschlossen ist: Ein Start ohne Sitzung löst gar nichts aus, was von einem noch laufenden Vorgang nicht zu unterscheiden ist. Warten Sie für diese Prüfung `isInitialized()` ab und nutzen Sie den Listener für spätere Änderungen.

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
| `USER_UPDATED` | `updateUser()` hat das Profil geändert |
| `SIGNED_OUT` | Eine Abmeldung oder eine Aktualisierung, die endgültig fehlgeschlagen ist |

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

## E-Mail-Verifizierung

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link
await client.auth.verifyEmail(token);
```

## Sitzungsverwaltung (Multi-Device)

```typescript
// List all active sessions
const sessions = await client.auth.getSessions();

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

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
//   magicLink: boolean,
//   anonymousLogin: boolean,
//   enabledProviders: string[],
//   needsSetup: boolean
// }
```

## Benutzerdefinierter Sitzungsspeicher

Standardmäßig werden Sitzungen im `localStorage` gespeichert. Sie können dies über die Option `auth` anpassen:

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
    roles?: string[];          // text[] from the users table
    metadata?: Record<string, unknown>;
}
```

## Nächste Schritte

- **[Daten abfragen](/docs/sdk/querying)** — CRUD-Operationen und Query-Builder
- **[Echtzeit-Abonnements](/docs/sdk/realtime)** — Live-Daten mit WebSockets
- **[Authentifizierungs-Backend](/docs/backend/authentication)** — Serverseitige Auth-Konfiguration

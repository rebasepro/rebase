---
sourceHash: 71a134ba2ec7ae97
title: Authentifizierung
sidebar_label: Authentifizierung
description: Konfigurieren Sie JWT-Authentifizierung, OAuth-Anbieter, SMTP-E-Mail, Bot-Schutz und die Benutzertabelle im Rebase-Backend.
---

Authentifizierung umfasst drei Seiten, da es sich um drei Aufgaben handelt. Diese hier behandelt die **Konfiguration**: Was in den `auth`-Block und in die Umgebungsvariablen gehört.

- [Endpunkte und Tokens](/docs/backend/auth-endpoints/) — die Routen, die das Backend bereitstellt, die Antwortstrukturen, MFA, der Datenbankkontext, den eine Policy sieht, JWKS und Service Keys.
- [Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters/) — Ersetzen des integrierten Anbieters durch Clerk, Firebase Auth oder Ihren eigenen.

## Übersicht

Rebase enthält ein vollständiges Backend-Authentifizierungssystem:

- **JWT-Tokens** — Access- und Refresh-Token-Ablauf mit konfigurierbarer Gültigkeitsdauer
- **OAuth-Anbieter** — Google, LinkedIn, GitHub, Microsoft, Apple und weitere
- **SMTP-E-Mail** — Abläufe für Passwort-Reset und E-Mail-Verifizierung
- **Auth-Hooks** — Lifecycle-Hooks für die Benutzererstellung und mehr
- **Benutzerdefinierte Auth-Adapter** — Binden Sie Firebase Auth, Auth0, Clerk oder einen beliebigen externen Anbieter an
- **Service Key** — Statischer Schlüssel für die Server-zu-Server-Authentifizierung
- **Auto-Bootstrapping** — Außerhalb der Produktionsumgebung erhält der erste Benutzer automatisch die Admin-Rolle; ein Produktions-Deployment benennt seinen Admin über `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Konfiguration

<span class="since-badge" data-since="0.31">Seit 0.31</span>

:::note[Wo dies hingehört]
**Managed Runtime:** Umgebungsvariablen — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` und die `*_CLIENT_ID` / `*_CLIENT_SECRET`-Paare der Anbieter, eines für jeden der zwölf Anbieter ([die Schreibweisen](#die-schreibweisen-in-umgebungsvariablen); Apples Konfiguration besteht aus vier Schlüsseln, nicht einem Paar). Die Benutzertabelle ist die [`defineAuthTable`](#die-benutzertabelle), die aus `backend/schema/index.ts` exportiert wird.
**Keine Managed Route:** `auth.hooks`. Dies sind Funktionen; ejecten Sie, um sie zu übergeben.
**Ejected:** `initializeRebaseBackend({ auth })` in `backend/src/index.ts`.
:::

Der `auth`-Block in `initializeRebaseBackend` steuert die gesamte Backend-Authentifizierung:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
        jwtSecret: env.JWT_SECRET,           // Required — signing secret
        accessExpiresIn: "1h",               // Access token lifetime (default: 1h)
        refreshExpiresIn: "30d",             // Refresh token lifetime (default: 30d)
        serviceKey: env.REBASE_SERVICE_KEY,  // Optional — for server-to-server calls
        allowRegistration: true,             // Allow new signups (default: false)

        // OAuth providers
        google: env.GOOGLE_CLIENT_ID
            ? { clientId: env.GOOGLE_CLIENT_ID }
            : undefined,

        // SMTP email (for password reset, email verification)
        email: env.SMTP_HOST
            ? {
                from: env.SMTP_FROM || `${env.APP_NAME} <noreply@example.com>`,
                smtp: {
                    host: env.SMTP_HOST,
                    port: env.SMTP_PORT,              // 587 for TLS, 465 for SSL
                    secure: env.SMTP_SECURE,           // true for port 465
                    auth: env.SMTP_USER
                        ? { user: env.SMTP_USER, pass: env.SMTP_PASS! }
                        : undefined,
                    name: env.SMTP_NAME,               // Optional EHLO/HELO hostname
                    timeoutMs: 30_000,                 // Connect, greeting and silence limit (the default)
                },
                appName: env.APP_NAME,
                logoUrl: env.EMAIL_LOGO_URL,           // Logo shown atop the default templates
                resetPasswordUrl: env.FRONTEND_URL,    // URL for password reset page
            }
            : undefined,

        // Lifecycle hooks
        hooks: {
            afterUserCreate: async (user) => {
                console.log(`New user registered: ${user.email}`);
            }
        }
    }
});
```

### Der `auth`-Block im Detail

| Schlüssel | Typ | Standard | Funktion |
|-----|------|---------|--------------|
| `jwtSecret` | `string` | — | HS256-Signierschlüssel. In der Produktion erforderlich |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Asymmetrische Signierschlüssel — siehe [Asymmetrische Tokens und JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | erster Schlüssel | Welcher von `signingKeys` neue Tokens ausstellt |
| `accessExpiresIn` | `string` | `1h` | Gültigkeitsdauer des Access-Tokens |
| `refreshExpiresIn` | `string` | `30d` | Gültigkeitsdauer des Refresh-Tokens. Gleitend: Jede Rotation verlängert sie; dies gibt also an, wie lange eine Sitzung bei **Inaktivität** bestehen bleibt. Die Runtime übergibt `JWT_REFRESH_EXPIRES_IN`, standardmäßig ebenfalls `30d`. Browser begrenzen das Refresh-Cookie auf 400 Tage, ein längerer Wert bringt im Cookie-Modus also keinen Vorteil |
| `refreshTokenReuseIntervalSeconds` | `number` | `10` | Zeitspanne, in der ein bereits rotierter Refresh-Token noch ein Geschwister-Token seiner Sitzung erzeugen kann, damit ein Client, der die Antwort auf einen Refresh verloren hat, nicht abgemeldet wird |
| `refreshTokenReuse` | `"reject" \| "revoke-session"` | `"reject"` | Was geschieht, wenn ein Refresh-Token nach diesem Zeitfenster vorgelegt wird. `"reject"` lehnt ihn ab (`TOKEN_ALREADY_USED`) und protokolliert dies, wobei die Sitzung bestehen bleibt: Dies ist keine Erkennung von Wiederverwendung (Reuse Detection), da derjenige, der zuerst aktualisiert hat, die Sitzung behält. `"revoke-session"` beendet die gesamte Anmeldung bei einem solchen Replay (`SESSION_REVOKED`), wie es GoTrue tut, und der Eigentümer meldet sich erneut an. `AUTH_REFRESH_TOKEN_REUSE` |
| `requireAuth` | `boolean` | `true` | Erfordert eine Sitzung für die Daten-API |
| `allowRegistration` | `boolean` | `false` | Öffnet `POST /api/auth/register`. Außerhalb der Produktion wird der erste Benutzer bei leerer Tabelle in jedem Fall zugelassen; in der Produktion wird der Admin über `REBASE_ADMIN_EMAIL` benannt |
| `disableSelfRegistration` | `boolean` | `false` | Kill-Switch: Schließt auch das Bootstrap-Fenster für den ersten Benutzer, das `allowRegistration: false` offen lässt |
| `allowAnonymous` | `boolean` | `false` | Aktiviert `POST /api/auth/anonymous`. Bewusst nicht von `allowRegistration` abhängig — eine öffentliche, überwiegend lesende App benötigt möglicherweise Sitzungen ohne Konten. Die Umwandlung eines Gasts in ein Konto (`POST /api/auth/anonymous/link`) ist eine Registrierung und erfordert zusätzlich `allowRegistration` — sowie weiterhin aktives `allowAnonymous`: Ist es deaktiviert, werden auch bereits angemeldete Gäste abgewiesen, sodass keiner zu einem Konto werden kann (`403 ANONYMOUS_AUTH_DISABLED`) |
| `allowUserLookup` | `boolean` | `false` | Bindet `POST /api/auth/find-user` für Einladungsabläufe per E-Mail ein |
| `captcha` | `CaptchaConfig` | — | Bot-Schutz für Routen, die E-Mails versenden — siehe [Bot-Schutz](#bot-schutz) |
| `defaultRole` | `string` | — | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. Sie darf weder `admin` sein noch eine deklarierte Rolle, die Scopes der Admin-Ebene enthält: Beides wird beim Booten verweigert |
| `serviceKey` | `string` | — | Statischer Schlüssel für Server-zu-Server-Aufrufe — siehe [Service-Key-Authentifizierung](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, für Passwort-Reset, Verifizierung, Einladungen und Magic Links |
| `magicLink` | `boolean` | `false` | Aktiviert passwortlose E-Mail-Anmeldung. Erfordert konfiguriertes `email`; andernfalls antworten die Routen mit `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Aktiviert sechsstellige Anmeldecodes per E-Mail — siehe [Einmalcodes](#einmalcodes-per-e-mail). Gleiche E-Mail-Anforderung |
| `deviceLogin` | `{ verificationUrl: string }` | — | Ermöglicht einem Terminal oder einem anderen Gerät ohne Browser die Anmeldung über einen solchen — siehe [Geräte-Anmeldung](/docs/backend/device-sign-in/). Erfordert eine SQL-Datenbank |
| `magicLinkCreatesUsers` | `boolean` | `false` | Passwortlose Registrierung: Eine Magic-Link- oder E-Mail-Code-Anfrage für eine Adresse ohne Konto erstellt ein neues Konto (ohne Passwort, unverifiziert bis Link oder Code genutzt werden), solange `allowRegistration` aktiv ist. Führt `beforeUserCreate` und die Standardrolle aus. Wenn deaktiviert, erstellen diese Anfragen nichts und antworten bei einer unbekannten Adresse genauso wie bei einer bekannten. `AUTH_MAGIC_LINK_CREATES_USERS` |
| `requireEmailVerification` | `boolean` | `false` | Verweigert die Passwort-Anmeldung, bis die Adresse verifiziert ist, und registriert mit vorheriger Bestätigung (Confirm-First) — siehe [E-Mail-Verifizierung](/docs/backend/email-verification/). Erfordert `email`; ohne bricht der Bootvorgang ab |
| `cookieAuth` | `CookieAuthConfig \| false` | aktiv | Überträgt das Refresh-Token als `httpOnly` `Secure` `SameSite`-Cookie anstelle im JSON-Body; `false` liefert es im Body zurück — siehe unten |
| `providers` | `OAuthProvider[]` | `[]` | Das kanonische OAuth-Array; die benannten Anbieterfelder werden darin aufgelöst |
| `allowedRedirectUris` | `string[]` | — | Schränkt ein, welche Redirect-URIs die OAuth-Routen akzeptieren |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Refresh-Tokens in einem `httpOnly`-Cookie

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

Das Refresh-Token ist der langlebige Berechtigungsnachweis, und im Body kann jedes
XSS auf der Seite darauf zugreifen. `cookieAuth` speichert es in einem Cookie,
das von Skripten auf der Seite nicht gelesen werden kann: standardmäßig aktiv, sofern
nicht anders konfiguriert – immer in der Runtime und seit Version 0.30 auch in
`initializeRebaseBackend`. Das **Access**-Token verbleibt im Body für den `Authorization`-Header.
Eine Anfrage mit `x-rebase-auth-flow: json` erhält das Refresh-Token im Body; bei
`cookieAuth: false` gilt dies für jede Anfrage, und ein Browser-Client benötigt `authFlowMode: "json"`.

Zwei Dinge müssen beachtet werden, da die Anmeldung sonst fehlschlägt anstatt kontrolliert
zurückzufallen: Client-Fetches an die Auth-Endpunkte erfordern `credentials: "include"`,
und CORS muss Credentials erlauben — was eine explizite Origin-Liste bedeutet, niemals
`origin: "*"`. `AUTH_COOKIE_SAME_SITE` ist die Umgebungsvariablen-Schreibweise von `sameSite` und
`AUTH_COOKIE_SECURE` die von `secure`.

Das Cookie trägt das Attribut `Secure`, sofern Sie es nicht deaktivieren, und nichts an
der Anfrage kann dies automatisch tun: Wenn es anhand des Anfrageprotokolls ermittelt wird
(welches hinter einem TLS-terminierenden Proxy `http` ist), würde das Token im Klartext
gesendet. `AUTH_COOKIE_SECURE=false` ist der einzige Ausweg für ein Deployment, das über
reines HTTP betrieben wird (eine LAN-Adresse, eine Appliance), und gibt beim Booten eine
Warnung aus. `http://localhost` benötigt dies nicht.

| Schlüssel | Standard | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | aktuelle Domain | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` ist nur für ein echtes Cross-Site-Frontend gedacht |
| `secure` | `true` | Standardmäßig Secure; `AUTH_COOKIE_SECURE=false` für reines HTTP |

:::caution[Tabellen-Hooks werden für Auth-Benutzer nicht ausgelöst]
Die Erstellung und Aktualisierung von Benutzern über das Auth-System — Registrierung,
Admin-Benutzerverwaltung und OAuth — schreiben **direkt** in den Benutzerspeicher und
umgehen die Save-Pipeline der Tabelle. Ein `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`-Hook
auf der Benutzertabelle wird für diese Pfade **nicht** ausgeführt. Für Nebeneffekte wie das
Bereitstellen eines persönlichen Teams bei der Registrierung verwenden Sie die
Auth-Lifecycle-Hooks (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), welche
den vollständig ausgefüllten Benutzerdatensatz erhalten.

OAuth führt dieselben Hooks wie die anderen Anmeldungen aus: `beforeLogin` (mit der
Adresse des Anbieters und `"oauth"`), `beforeUserCreate`, wenn die Anmeldung das Konto
erstellt, `afterUserCreate` und `onAuthenticated`. `onAuthenticated` wird auch bei einem
Token-Refresh (`"refresh"`), einem Passwort-Reset (`"password-reset"`) und einem zweiten
Faktor (`"mfa"`) ausgelöst. `beforeLogin` wird bei einem Refresh nicht ausgeführt, da es
sich nicht um eine Anmeldung handelt. Um ein Konto zu sperren, das bereits angemeldet ist,
deaktivieren Sie es mit `PUT /api/admin/users/:uid { disabled: true }`: Dies verweigert
jede Anmeldung und jeden Refresh und beendet jede aktive Sitzung und jedes Token des Kontos.

`beforeEmailChange(user, newEmail)` wird ausgeführt, wenn ein angemeldeter Benutzer
anfordert, sein Konto auf eine andere Adresse zu übertragen. Eine Adressregel, die Sie bei
der Registrierung in `beforeUserCreate` durchsetzen (z. B. nur die eigene Domain), gehört
auch hierhin, da sich ein Mitglied sonst mit einer erlaubten Adresse registrieren und
anschließend zu einer beliebigen anderen wechseln könnte.

Ein Hook, der die Aktion verweigert (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete`,
`beforeEmailChange`), wirft einen Fehler (throw). Der Aufrufer erhält `400 HOOK_REJECTED`
mit der Fehlermeldung oder dem Status, den der Fehler trägt: ein `ApiError` oder jeder Fehler
mit einem 4xx-`status`.
:::

### Bot-Schutz

Rate Limiting begrenzt einzelne Aufrufer. Tausend Adressen, die jeweils eine einzige
Anfrage senden, überschreiten jedoch niemals ein IP-basiertes Limitfenster — und
`/auth/register`, `/auth/forgot-password` sowie `/auth/magic-link` versenden alle E-Mails,
sodass der Preis für ein ungeschütztes Formular mit der Reputation Ihrer Absender-Domain bezahlt wird.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Oder über Umgebungsvariablen, wie es bei einem Managed Deployment der Fall ist:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

Der Client sendet das Token des Widgets als `captchaToken` im JSON-Body oder im
widget-eigenen Header `cf-turnstile-response` / `h-captcha-response`. Beide werden
akzeptiert; setzen Sie `tokenField`, um einen anderen Body-Schlüssel zu verwenden.

**`login` ist standardmäßig nicht geschützt.** Eine Challenge bei jeder Anmeldung
belastet jeden echten Benutzer, und gegen Credential Stuffing sind der Rate Limiter
und die Kontosperrung gedacht. Fügen Sie es zu `routes` hinzu, falls gewünscht.

`POST /auth/anonymous/link`, bei dem ein Gast eine E-Mail und ein Passwort erhält,
zählt als Registrierung: Es erfordert die `register`-Challenge und führt `beforeUserCreate`
aus, genau wie `/auth/register`. Die Gastanmeldung selbst (`POST /auth/anonymous`) erfordert
keine Challenge.

#### Fail-Closed-Verhalten

Kann der Anbieter nicht erreicht werden, schlägt die Verifizierung fehl und die
Anfrage wird abgewiesen. Ein Angreifer, der einen solchen Ausfall herbeiführen kann,
könnte andernfalls den Schutz deaktivieren — was eine Challenge keinesfalls zulassen darf.

Der Nachteil ist, dass ein Anbieterausfall Neuregistrierungen blockiert. Dies ist laut,
sichtbar und lässt sich durch das Entfernen eines Konfigurationsschlüssels beheben — ein
besseres Fehlerverhalten als ein stiller Fehler, der erst bemerkt wird, wenn die E-Mail-Domain
auf einer Blocklist landet.

#### Eine Fehlkonfiguration verhindert das Booten

`enabled: true` ohne Anbieter, mit einem unbekannten Anbieter oder ohne Secret führt zum
Abbruch beim Start. Eine Challenge, die stillschweigend fehlt, obwohl die Konfiguration ihre
Anwesenheit vorschreibt, ist ein untragbarer Fehler.

Der Aufrufer erfährt lediglich, dass die Challenge fehlgeschlagen ist — niemals, ob das Token
fehlte, fehlerhaft formatiert war, bereits verwendet wurde oder nicht verifiziert werden konnte.
Die genaue Ursache wird protokolliert, da eine detaillierte Rückmeldung an ein Skript diesem
verraten würde, wie es sein Ziel erreicht.

### E-Mail in der Entwicklungsumgebung

Ohne `SMTP_HOST` können Auth-E-Mails nicht zugestellt werden. Anstatt die Anfrage abzulehnen,
fängt ein Entwicklungsserver die Nachricht ab und gibt die Links in der Konsole aus:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Folgen Sie dem Link, und der Ablauf wird auf der entsprechenden Seite abgeschlossen:
Das CMS bedient `/reset-password`, `/verify-email`, `/confirm-email-change` sowie `/auth/magic-link`
für Magic Links; ein anderes Frontend benötigt jeweils eine eigene Seite für diese Pfade (siehe
[Magic Links](/docs/sdk/authentication/#magic-links) im SDK). Am Token selbst ändert sich
nichts — es wird exakt so erzeugt, gespeichert und validiert wie bei einem echten Posteingang;
lediglich die Zustellung unterscheidet sich.

Dies ist aktiv, sobald alle drei Bedingungen erfüllt sind, und es gibt keine Einstellung,
die dies ändert:

- `SMTP_HOST` ist nicht gesetzt — ein konfigurierter Mailserver hat immer Vorrang;
- `NODE_ENV` ist nicht `production`. Eine abgefangene E-Mail zum Zurücksetzen des Passworts
  enthält ein funktionierendes Reset-Token; der Abfangpuffer ist somit ein Speicher für
  Zugangsdaten und darf in der Produktion nicht existieren;
- `FRONTEND_URL` ist eine absolute `http(s)`-URL, da der per E-Mail gesendete Link andernfalls
  keine Basis hat und ungültig wäre.

Wenn eine dieser Bedingungen nicht zutrifft, antworten `POST /auth/magic-link` und
`POST /auth/forgot-password` wie bisher mit `503 EMAIL_NOT_CONFIGURED`. Setzen Sie in der
Produktion `SMTP_HOST` (oder `auth.email.sendEmail`), um E-Mails tatsächlich zu versenden.

#### Abgefangene E-Mails ohne Terminal lesen

Das Protokoll nützt nur demjenigen, der es aktiv beobachtet. Ein Server in Docker, ein zweites
Fenster oder eine vorbeigescrollte Zeile führen dazu, dass ein ausgegebener Link unauffindbar
ist — daher werden dieselben abgefangenen E-Mails auch über HTTP bereitgestellt:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Jede Nachricht enthält `to`, `subject`, `at`, die Text- und HTML-Bestandteile (`html` und `text`)
sowie `links` — die im Textkörper gefundenen absoluten URLs in Dokumentenreihenfolge, was genau
dem Teil entspricht, den man tatsächlich benötigt.

Dafür ist der Scope `users:write` erforderlich, über denselben Schutzmechanismus, den auch Cron,
Protokolle und Backups nutzen. Der Endpunkt antwortet mit `501 DEV_MAILBOX_UNAVAILABLE`, wenn nichts
vorliegt — bei konfiguriertem SMTP wurden E-Mails zugestellt statt zurückgehalten. `NODE_ENV=production`
verweigert den Zugriff unabhängig von anderen Einstellungen: Der Inhalt dieser Nachrichten ermöglicht
einen funktionierenden Login.

### Einmalcodes per E-Mail

Ein Magic Link öffnet die Sitzung auf dem Gerät, auf dem sich das E-Mail-Postfach befindet.
Auf einem Laptop ist das das richtige Gerät, überall sonst jedoch das falsche — auf einem
Fernseher, einem Terminal, einem zweiten Browser oder einem Kiosk-System. Ein Code überbrückt
diese Lücke, da der Benutzer ihn manuell überträgt.

```ts
auth: {
    emailOtp: true,   // or AUTH_EMAIL_OTP=true
    email: { /* … */ }
}
```

```ts
await rebase.auth.sendEmailOtp("someone@example.com");
// …the person reads six digits out of their inbox…
const { user } = await rebase.auth.verifyEmailOtp("someone@example.com", "384102");
```

Die Adresse wird zusammen mit dem Code erneut übermittelt, und das ist keine reine
Bequemlichkeit. Gespeichert wird ein Hash aus Adresse *und* Code zusammen. Ein Rateversuch
richtet sich somit gezielt gegen ein bestimmtes Konto — und nicht gegen alle Konten in der
Tabelle gleichzeitig, was bei einer reinen Code-Suche aus einer Million Möglichkeiten
resultieren würde.

Was sechs Ziffern darüber hinaus ausreichend sicher macht:

- **Zehn Minuten** Gültigkeit und einmalige Verwendung.
- **Fünf Verifizierungsversuche pro Adresse und Zeitfenster**, basierend auf der Adresse
  statt der IP des Aufrufers: Eine IP kann vom Angreifer gewechselt werden, das angegriffene
  Konto hingegen nicht. Die Zähler befinden sich dort, wo auch der Rate-Limit-Speicher des
  Deployments liegt — standardmäßig pro Replik, geteilt bei `REBASE_RATE_LIMIT_STORE=sql`.
- **Gleichmäßig verteilte Ziffern**, generiert über `randomInt` statt über Modulo von zufälligen Bytes.
- `POST /auth/otp` antwortet bei einer Adresse ohne Konto identisch, sodass es nicht zur
  Überprüfung verwendet werden kann, ob jemand bereits Kunde ist.

Das Auslesen eines Codes aus dem Postfach verifiziert die Adresse, sodass eine erfolgreiche
Anmeldung diese als verifiziert markiert — genau wie das Aufrufen eines Magic Links. Bei einem
Konto, das noch nicht verifiziert war, entfernt dieser erste Nachweis zudem alles, was niemand
bewiesen hat: das Passwort und jede verknüpfte Identität, deren Anbieter die Adresse nicht
verifiziert hat. Siehe [Konto-Verknüpfung](#konto-verknüpfung-über-verschiedene-anmeldemethoden-hinweg).

### Branding der Standard-E-Mails

Die integrierten Vorlagen für Passwort-Reset, Verifizierung, Einladung, Begrüßung, Magic Links
und E-Mail-Änderung rendern ein Logo über der Infokarte. Dieses stammt aus `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Es muss ein **PNG oder JPG unter einer absoluten `http(s)`-URL** sein. E-Mail-Clients rendern
kein SVG und blockieren `data:`-URIs. Zudem wird das Bild vom Client des Empfängers und nicht
von Ihrem Server abgerufen — ein relativer Pfad, eine Data-URI oder eine lokale Datei führt daher
zu gar keinem Logo anstelle eines fehlerhaften Bildes. `appName` dient als `alt`-Text, sodass
ein Client mit deaktivierten Bildern dennoch den Namen anzeigt.

Das Fallback-Verhalten ist bewusst asymmetrisch gestaltet. `appName` fällt auf `Rebase` zurück,
das Logo jedoch nur so lange auf das Rebase-Signet, wie die Installation **nicht** umbenannt
wurde. Setzen Sie `appName` auf einen anderen Wert, wird kein Logo angezeigt, bis Sie `logoUrl`
konfigurieren — andernfalls würden die Benutzer von Acme ein Rebase-Logo in E-Mails erhalten, die
von der Domain von Acme signiert sind.

Wenn Sie ein Template über `email.templates` ersetzen, gilt dies alles nicht: Ihre Funktion
steuert den gesamten Body. `templates.emailChange(confirmUrl, user, newEmail)` ist der Link,
der an die neue Adresse gesendet wird, wenn ein Benutzer diese ändert, und
`templates.emailChangeNotice(user, newEmail)` die Benachrichtigung an die alte Adresse;
`user.email` ist in beiden Fällen die aktuelle Adresse.

### OAuth-Anbieter

Jeder OAuth-Anbieter wird mindestens mit einer `clientId` konfiguriert. Einige Anbieter erfordern ein `clientSecret`:

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", bundleIds: ["..."], teamId: "...", keyId: "...", privateKey: "..." },
    facebook:  { clientId: "...", clientSecret: "..." },
    twitter:   { clientId: "...", clientSecret: "..." },
    discord:   { clientId: "...", clientSecret: "..." },
    gitlab:    { clientId: "...", clientSecret: "..." },
    bitbucket: { clientId: "...", clientSecret: "..." },
    slack:     { clientId: "...", clientSecret: "..." },
    spotify:   { clientId: "...", clientSecret: "..." },
}
```

`gitlab` akzeptiert zudem eine optionale `baseUrl` für eine selbst gehostete GitLab-Instanz.

#### Die Schreibweisen in Umgebungsvariablen

Ein Managed- oder Bundle-Deployment besitzt keinen `auth`-Block im Code — der Server wird
vollständig über Umgebungsvariablen konfiguriert —, daher verfügt jeder der oben genannten
Anbieter über ein `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`-Paar. Beide Teile müssen
gesetzt sein, damit der Anbieter überhaupt konfiguriert ist:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` listet dann `discord` in `enabledProviders` auf, worüber überprüft
werden kann, ob das Paar übernommen wurde.

Google wird allein über `GOOGLE_CLIENT_ID` konfiguriert: Der ID-Token-Ablauf benötigt kein Secret, daher ist `GOOGLE_CLIENT_SECRET` optional.

Apple besitzt kein Client-Secret: Rebase signiert pro Austausch ein ES256-JWT. Es erfordert `APPLE_TEAM_ID`,
`APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` (den Inhalt der `.p8`-Datei, inklusive Zeilenumbrüchen)
sowie `APPLE_CLIENT_ID` (die Services-ID für das Web), `APPLE_BUNDLE_IDS` (kommagetrennte IDs
Ihrer nativen iOS- und macOS-Apps) oder beides. Die Services-ID ist öffentlich, daher stellt
`/auth/config` sie für **Sign in with Apple** im Admin-Bereich bereit.

Zwei Optionen besitzen keine Entsprechung als Umgebungsvariable und erfordern den `auth`-Block
(also ein ejected oder im Code konfiguriertes Backend): `microsoft.tenantId`, das standardmäßig
`common` verwendet und jeden Entra-Tenant akzeptiert (bei jedem Tenant gilt eine Adresse nur dann
als verifiziert, wenn die App-Registrierung den Claim `xms_edov` ausgibt), sowie `gitlab.baseUrl`
für eine selbst gehostete Instanz.

Jedes benannte Feld wird beim Start in `auth.providers` aufgelöst, welches das kanonische Array
und den Erweiterungspunkt für alles darstellt, was die benannten Felder nicht abdecken. Einträge
werden mit den `create*Provider`-Factories erstellt, und beide Formen werden zusammengeführt —
benannte Felder werden an explizite Einträge angehängt:

```typescript no-verify
import { createGoogleProvider, createGitHubProvider } from "@rebasepro/server";

auth: {
    providers: [
        createGoogleProvider({ clientId: "…", clientSecret: "…" }),
        createGitHubProvider({ clientId: "…", clientSecret: "…" })
    ]
}
```

#### Einschränken der Redirect-URIs

```typescript no-verify
auth: { allowedRedirectUris: ["https://admin.example.com/"] }
```

Bleibt dies unkonfiguriert, ist die einzige Überprüfung eines OAuth-Redirects der Abgleich
des Anbieters mit dessen registrierten URIs — was **jede** auf diesem OAuth-Client registrierte
URI autorisiert, einschließlich des `localhost`-Eintrags für die Entwicklung und des Staging-Hosts,
den niemand entfernt hat. Das Auflisten der Origins, die dieses Backend tatsächlich bedient,
schränkt dies genau darauf ein. URIs werden anhand von Origin und Pfad verglichen; Query-Parameter,
Fragmente und ein abschließender Schrägstrich werden ignoriert.

### Konto-Verknüpfung über verschiedene Anmeldemethoden hinweg

Was passiert, wenn sich jemand mit E-Mail/Passwort als `ada@example.com` registriert und
später bei einem Google-Konto mit derselben Adresse auf „Sign in with Google“ klickt?
Rebase **verknüpft beide zu einem einzigen Konto**, aber nur dann, wenn der Anbieter
bestätigt, dass die E-Mail verifiziert ist. Es wird niemals stillschweigend ein zweites Konto
für dieselbe Adresse erstellt.

Bei `POST /api/auth/<provider>` ist die Auflösungsreihenfolge wie folgt:

1. **Bekannte Anbieter-Identität**: Hat sich genau diese Anbieter-Identität zuvor bereits
   angemeldet, wird dieser Benutzer zurückgegeben. Die E-Mail-Adresse wird nicht abgefragt.
2. **Bestehendes Konto mit derselben E-Mail, Anbieter hat die E-Mail verifiziert**: Die
   Identität wird angehängt und der Benutzer daran angemeldet. Ein Konto, zwei Zugangswege.
   Ein unverifiziertes Konto wird zuvor verifiziert (siehe unten).
3. **Bestehendes Konto mit derselben E-Mail, Anbieter hat sie nicht verifiziert**:
   Abgewiesen mit `403 EMAIL_NOT_VERIFIED` und `details.reason` `provider-email-unverified`.
   Es wird nichts erstellt oder geändert.
4. **Kein Konto mit dieser E-Mail**: Ein neues Konto wird erstellt; es ist verifiziert,
   falls der Anbieter die E-Mail verifiziert hat.

Schritt 3 ist der sicherheitskritische Fall. Würde eine unbestätigte E-Mail des Anbieters
für eine Verknüpfung ausreichen, könnte jeder, der einen Anbieter dazu bringt, eine fremde
Adresse auszugeben, das passende Rebase-Konto übernehmen. Google bestätigt bei echten
Google-Konten immer `email_verified`, sodass Schritt 2 der normale Pfad für die Google-Anmeldung
ist; Schritt 3 fängt vor allem Anbieter ab, bei denen Benutzer eine beliebige, unbestätigte
Adresse angeben können.

Auch die Seite des Kontos spielt eine Rolle. Nichts überprüft die bei `POST /auth/register`
angegebene Adresse, sodass jeder eine fremde Adresse mit einem Passwort registrieren oder sich
darüber über einen Anbieter anmelden könnte, der die Adresse nicht garantiert, und abwarten
könnte. Die Verknüpfung der Google-Anmeldung des tatsächlichen Eigentümers mit diesem Konto
darf den Zugangsweg der anderen Person nicht bestehen lassen.

Ein Anbieter, der die Adresse verifiziert hat, ein Verifizierungslink, ein Magic Link,
ein E-Mail-Code oder ein Passwort-Reset beweisen alle den Besitz der Adresse und verifizieren
das Konto. Bei einem Konto, das noch nicht verifiziert war, entfernt der erste dieser
Nachweise das Passwort (ein Reset setzt das neue) und jede verknüpfte Identität, deren Anbieter
diese Adresse nicht bestätigt hat, und beendet jede Sitzung, bevor das Konto als verifiziert
markiert wird: Ein von niemandem verifiziertes Passwort ist nach der ersten Google-Anmeldung gelöscht.

Ein Verifizierungslink behält bei, was die Person, die ihm folgt, ebenfalls nachweist:
eine aktive Sitzung des Kontos oder dessen Passwort. Siehe [E-Mail-Verifizierung](/docs/backend/email-verification/).
Konten, die von einem Administrator mit `POST /api/admin/users` erstellt wurden, werden als verifiziert
gespeichert, sodass eine eingeladene Person sofort „Sign in with Google“ nutzen kann. Ein
benutzerdefiniertes Auth-Repository ohne `unlinkUserIdentity` weist einen solchen Nachweis mit
`409 UNVERIFIED_IDENTITIES` ab, wenn eine Identität zu entfernen ist.

Dieses Verhalten ist nicht konfigurierbar — es gibt bewusst keine Option, Verknüpfungen
anhand unbestätigter E-Mails zuzulassen.

### E-Mail-Verifizierung

Bei der Registrierung wird dem neuen Konto ein Verifizierungslink per E-Mail zugesendet.
Das Aufrufen dieses Links behält nur das bei, was die aufrufende Person ebenfalls nachweist.
`requireEmailVerification` erzwingt eine vorherige Bestätigung bei der Registrierung (Confirm-First).
Siehe [E-Mail-Verifizierung](/docs/backend/email-verification/).

## Automatisch erstellte Tabellen

Beim ersten Start stellt Rebase das `rebase`-Schema und die folgenden Tabellen in der Datenbank automatisch bereit:

- **`rebase.users`** — Benutzerkonten mit E-Mail, Passwort-Hash, Metadaten und einer `roles` text[]-Spalte (Rollen werden als Inline-Text-Arrays gespeichert, um Abfragen zu optimieren und Joins zu vermeiden).
- **`rebase.user_identities`** — Die mit jedem Konto verknüpften OAuth-Identitäten, eine Zeile pro Anbieter-Identität.
- **`rebase.refresh_tokens`** — Langlebige Sitzungen mit gehashten Refresh-Tokens, User-Agents und IP-Adressen. Enthält einen Unique-Index auf `token_hash`. Eine Anmeldung entspricht einer `session_id`, die von jedem daraus rotierten Token geteilt wird; es gibt keine Beschränkung pro Gerät, sodass zwei Browser hinter derselben IP zwei Sitzungen darstellen. Jedes Token einer Sitzung enthält zudem sein Assurance-Level (`aal`) und die Methode der Anmeldung (`method`, was `providerId` meldet).
- **`rebase.password_reset_tokens`** — Ablaufbare Einmal-Tokens für Abläufe zur Passwortwiederherstellung.
- **`rebase.magic_link_tokens`** — Ablaufbare Einmal-Tokens für die Anmeldung per Magic Link.
- **`rebase.mfa_factors`** — Registrierte Multi-Faktor-Authentifizierungsmethoden (z. B. mit AES-256 verschlüsselte TOTP-Secrets).
- **`rebase.mfa_challenges`** — Verifizierungsprotokolle zur Nachverfolgung aktiver MFA-Verifizierungsversuche.
- **`rebase.recovery_codes`** — Gehashte Multi-Faktor-Backup-/Wiederherstellungscodes.
- **`rebase.app_config`** — Key-Value-Speicher für Systemkonfigurationen.

Tokens, die ablaufen — Reset-Links, Magic Links und E-Mail-Codes, Refresh-Tokens,
MFA-Challenges —, werden einmal pro Stunde nach ihrem Ablauf gelöscht. Der Bereinigungslauf
(Sweep) läuft auf den Prozessen, die die Timer verwalten (jede Rolle außer `functions` in
einem Split-Deployment, es sei denn, `REBASE_CRON_SCHEDULER=false` nimmt sie von der `api`)
und auf einer Instanz der Flotte: Jede Stunde wird in `rebase.cron_claims` unter der Job-ID
`rebase:auth:expired-tokens` beansprucht, analog zu einem Cron-Slot. Bei `cronPersistence: false`
gibt es keine Claims-Tabelle, und jede dieser Instanzen führt den Sweep durch. Ein abgelaufenes
Token wird bei Vorlage abgewiesen, unabhängig davon, ob der Sweep bereits gelaufen ist; der Sweep
verhindert lediglich das unkontrollierte Anwachsen der Tabellen.

## Bootstrap des ersten Benutzers

Wenn noch keine Benutzer in der Datenbank existieren und der Server **nicht** mit `NODE_ENV=production`
läuft, wird die erste Person, die sich registriert, automatisch zum Admin. Danach wird die
Registrierung über die Einstellung `allowRegistration` gesteuert.

In der Produktion ist dieses Fenster geschlossen, da ein Host mit einem öffentlichen Namen
erreichbar ist, bevor sich der Betreiber registriert hat, und wer auch immer zuerst eintrifft,
die Kontrolle übernehmen würde. Ein Produktions-Deployment benennt seinen ersten Admin stattdessen
über Umgebungsvariablen — `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD`, die beim Start erstellt
werden, solange die Tabelle noch leer ist — oder weist die Rolle über den Service Key zu. Bei
geschlossenem Zeitfenster verweigert eine leere Tabelle die Bootstrap-Registrierung mit
`SETUP_REQUIRED` (und weist darauf hin), ein über die offene Registrierung erstelltes erstes
Konto ist ein gewöhnliches Benutzerkonto, `GET /api/auth/config` meldet niemals `needsSetup`,
`POST /api/admin/bootstrap` wird abgewiesen, und das Boot-Protokoll warnt, wenn die Tabelle leer
ist und kein Admin benannt wurde.

Auf einem Laptop bedeutet dies, dass Sie eine neue Datenbank jederzeit ohne manuelles Seeding
initialisieren können. Um gleichzeitige Ausführungen und Race Conditions bei der Schema-Generierung
bei Hot Reloading (HMR) oder beim Start zu verhindern, werden Bootstrap-Operationen über einen
Postgres Advisory Lock synchronisiert:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Die Benutzertabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Benutzer werden in der Tabelle gespeichert, die mit `defineAuthTable` in
`backend/schema` deklariert ist. Es handelt sich um eine gewöhnliche Tabelle, der die
für Auth erforderlichen Spalten hinzugefügt wurden, mit einer Policy, die es jedem Benutzer
erlaubt, seine eigene Zeile zu lesen, und einer Admin-Beschränkung für die Spalte `roles`.
Ihr `auth`-Block deklariert die Rollen, die Scopes der App, persönliche API-Schlüssel sowie
die Hooks, die ausgeführt werden, wenn ein Admin einen Benutzer erstellt oder ein Passwort zurücksetzt:

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        roles: { support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] } },
        personalKeys: true,
    },
});
```

[Die Benutzertabelle](/docs/schema/auth-table/) behandelt die Spalten, die injizierten
Policies, `onCreateUser` und `onResetPassword`; [Rollen und Scopes](/docs/backend/roles-and-scopes/)
beschreibt, was jede Rolle und jeder Scope gewährt.

## Nächste Schritte

- **[Endpunkte und Tokens](/docs/backend/auth-endpoints/)** — alle Routen, die diese Konfiguration bereitstellt
- **[Rollen und Scopes](/docs/backend/roles-and-scopes/)** — was jede Rolle tun darf und wie Schlüssel und Tokens dies einschränken
- **[Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters/)** — Anbindung Ihres eigenen Identitätsanbieters
- **[Frontend-Authentifizierung](/docs/frontend/authentication/)** — Login-UI, Auth-Controller, Benutzerverwaltung
- **[Row-Level Security](/docs/collections/security-rules/)** — Zugriffskontrolle auf Zeilenebene
- **[Typisierte SDK-Authentifizierung](/docs/sdk/authentication/)** — Auth-Methoden im typisierten SDK

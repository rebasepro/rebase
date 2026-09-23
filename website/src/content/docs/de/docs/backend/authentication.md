---
sourceHash: 3c10e2e8a92e2f64
title: Authentifizierung
sidebar_label: Authentifizierung
description: Konfigurieren Sie JWT-Authentifizierung, OAuth-Provider, SMTP-E-Mail, Bot-Schutz und die Users-Collection im Rebase-Backend.
---

Authentifizierung besteht aus drei Seiten, da sie drei Aufgaben umfasst. Diese Seite behandelt die **Konfiguration**: was in den `auth`-Block und in die Umgebungsvariablen gehört.

- [Endpunkte und Tokens](/docs/backend/auth-endpoints/) — die vom Backend bereitgestellten Routen, die Antwortformate, MFA, der Datenbankkontext für Richtlinien, JWKS und Service-Keys.
- [Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters/) — Ersetzen des integrierten Providers durch Clerk, Firebase Auth oder eine eigene Lösung.

## Übersicht

Rebase enthält ein vollständiges Backend-Authentifizierungssystem:

- **JWT-Tokens** — Access- und Refresh-Token-Flow mit konfigurierbarer Ablaufzeit
- **OAuth-Provider** — Google, LinkedIn, GitHub, Microsoft, Apple und mehr
- **SMTP-E-Mail** — Passwort-Reset- und E-Mail-Verifizierungs-Flows
- **Auth-Hooks** — Lifecycle-Hooks für die Benutzererstellung und mehr
- **Benutzerdefinierte Auth-Adapter** — Binden Sie Firebase Auth, Auth0, Clerk oder beliebige externe Provider an
- **Service-Key** — Statischer Schlüssel für Server-zu-Server-Authentifizierung
- **Auto-Bootstrapping** — Außerhalb der Produktion erhält der erste Benutzer automatisch die Admin-Rolle; ein Produktions-Deployment benennt seinen Admin über `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Konfiguration

:::note[Wo dies hingehört]
**Verwaltete Runtime (Managed Runtime):** Umgebungsvariablen — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` und die Provider-Paare `*_CLIENT_ID` / `*_CLIENT_SECRET`, eines für jeden der zwölf Provider ([die Schreibweisen](#schreibweise-in-umgebungsvariablen); bei Apple sind es vier Schlüssel statt eines Paares). Die Users-Collection ist diejenige, die das Bundle benennt (konventionsgemäß `collections/users`).
**Kein verwalteter Pfad:** `auth.hooks`. Dies sind Funktionen; verwenden Sie Eject, um sie zu übergeben.
**Ejected:** `initializeRebaseBackend({ auth })` in `backend/src/index.ts`.
:::

Der `auth`-Block in `initializeRebaseBackend` steuert die gesamte Backend-Authentifizierung:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
        collection: usersCollection,         // Your users collection definition
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

| Schlüssel | Typ | Standard | Beschreibung |
|-----|------|---------|--------------|
| `collection` | `CollectionConfig` | — | Die Users-Collection. Siehe [Auth-Konfiguration auf Collection-Ebene](#auth-konfiguration-auf-collection-ebene) |
| `jwtSecret` | `string` | — | HS256-Signiergeheimnis. In der Produktion erforderlich |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Asymmetrische Signierschlüssel — siehe [Asymmetrische Tokens und JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | erster Schlüssel | Welcher Schlüssel aus `signingKeys` neue Tokens signiert |
| `accessExpiresIn` | `string` | `1h` | Lebensdauer des Access-Tokens |
| `refreshExpiresIn` | `string` | `30d` | Lebensdauer des Refresh-Tokens. Gleitend: Jede Rotation verlängert ihn wieder. Die Runtime übergibt `JWT_REFRESH_EXPIRES_IN`, dessen eigener Standardwert `400d` ist |
| `requireAuth` | `boolean` | `true` | Erfordert eine Sitzung für die Daten-API |
| `allowRegistration` | `boolean` | `false` | Gibt `POST /api/auth/register` frei. Außerhalb der Produktion wird der erste Benutzer bei einer leeren Tabelle in jedem Fall zugelassen; in der Produktion wird der Admin über `REBASE_ADMIN_EMAIL` festgelegt |
| `disableSelfRegistration` | `boolean` | `false` | Kill-Switch: Schließt auch das Bootstrap-Fenster für den ersten Benutzer, das `allowRegistration: false` offen lässt |
| `allowAnonymous` | `boolean` | `false` | Aktiviert `POST /api/auth/anonymous`. Bewusst nicht an `allowRegistration` gekoppelt — eine öffentlich lesbare App benötigt möglicherweise Sitzungen ohne Benutzerkonten |
| `allowUserLookup` | `boolean` | `false` | Stellt `POST /api/auth/find-user` für Einladungs-Flows per E-Mail bereit |
| `defaultRole` | `string` | — | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist |
| `serviceKey` | `string` | — | Statischer Schlüssel für Server-zu-Server-Aufrufe — siehe [Service-Key-Authentifizierung](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP für Passwort-Reset, Verifizierung, Einladungen und Magic Links |
| `magicLink` | `boolean` | `false` | Aktiviert passwortlose E-Mail-Anmeldung. Erfordert konfiguriertes `email`; andernfalls antworten die Routen mit `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Aktiviert sechsstellige Anmeldecodes per E-Mail — siehe [Einmalcodes per E-Mail](#einmalcodes-per-e-mail). Gleiche E-Mail-Voraussetzung |
| `cookieAuth` | `CookieAuthConfig` | — | Liefert das Refresh-Token als `httpOnly` `Secure` `SameSite`-Cookie anstelle im JSON-Body aus — siehe unten |
| `providers` | `OAuthProvider[]` | `[]` | Das kanonische OAuth-Array; die benannten Provider-Felder werden darin zusammengeführt |
| `allowedRedirectUris` | `string[]` | — | Schränkt ein, welche Redirect-URIs die OAuth-Routen akzeptieren |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Refresh-Tokens in einem `httpOnly`-Cookie

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

Das Refresh-Token ist die langlebige Anmeldeinformation, und im standardmäßigen JSON-Body-Modus
kann jeder XSS-Angriff auf der Seite dieses auslesen. `cookieAuth` verschiebt es in ein Cookie, auf das
das JavaScript der Seite keinen Zugriff hat. Das **Access-Token** verbleibt im JSON-Body,
da der Client es in einem `Authorization`-Header mitsenden muss.

Zwei Dinge müssen beachtet werden, da die Anmeldung sonst fehlschlägt statt sanft abzustufen: Client-Fetches
an die Auth-Endpunkte erfordern `credentials: "include"`, und CORS muss Credentials zulassen —
was eine explizite Liste von Origins erfordert, niemals `origin: "*"`.
`AUTH_COOKIE_SAME_SITE` ist die Umgebungsvariablen-Schreibweise für `sameSite` und
`AUTH_COOKIE_SECURE` für `secure`.

Das Cookie trägt das `Secure`-Attribut, sofern Sie es nicht deaktivieren, und keine Eigenschaft des Requests
kann dies ändern: Das Flag wurde früher aus dem Request-Protokoll gelesen, welches hinter
jedem TLS-terminierenden Proxy `http` ist. Dadurch wurde das Refresh-Token in der
gängigsten Produktionstopologie im Klartext übertragen. `AUTH_COOKIE_SECURE=false` ist der einzige Ausweg für
Deployments, die tatsächlich über einfaches HTTP betrieben werden — etwa eine LAN-Adresse oder eine Appliance — und
es gibt beim Booten eine Warnung aus. `http://localhost` benötigt dies nicht: Browser behandeln dies als
vertrauenswürdige Origin und akzeptieren `Secure`-Cookies dort.

| Schlüssel | Standard | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | aktuelle Domain | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` ist nur für ein echtes Cross-Site-Frontend gedacht |
| `secure` | `true` | Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für reines HTTP |

:::caution[Collection-Callbacks werden für Auth-Benutzer nicht ausgelöst]
Benutzererstellung und -aktualisierungen über das Auth-System — Registrierung,
Admin-Benutzerverwaltung und OAuth — schreiben **direkt** in den Benutzerspeicher und
umgehen die Save-Pipeline der Collection. Ein `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`-Callback
auf der Auth- (Users-) Collection wird für diese Pfade **nicht** ausgeführt. Für
Nebeneffekte wie das Bereitstellen eines persönlichen Teams bei der Registrierung sollten Sie die Auth-Lifecycle-Hooks
(`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …) verwenden, die
den vollständig ausgefüllten Benutzerdatensatz erhalten.

OAuth führt weniger davon aus als die Registrierung. Eine Anmeldung über einen Provider löst
`afterUserCreate` aus, wenn das Konto erstellt wird, aber keinen anderen Lifecycle-Hook:
`beforeUserCreate`, `beforeLogin` und `onAuthenticated` laufen auf der OAuth-Route nicht ab,
sodass Prüfungen oder Audit-Trails an diesen Stellen einen OAuth-Benutzer niemals erfassen.
:::

### Bot-Schutz

Rate-Limiting beschränkt einen einzelnen Aufrufer. Tausend Adressen, die jeweils eine einzige Anfrage senden,
erreichen niemals ein Limit pro IP-Fenster — und `/auth/register`, `/auth/forgot-password` und
`/auth/magic-link` versenden alle E-Mails. Die Zeche für ein ungeschütztes Formular zahlt man daher
mit der Reputation der sendenden Domain.

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
widget-eigenen Header `cf-turnstile-response` / `h-captcha-response`. Beide Varianten
werden akzeptiert; setzen Sie `tokenField`, um einen anderen Schlüssel im Body zu verwenden.

**`login` ist standardmäßig nicht geschützt.** Eine Challenge bei jedem Login belastet alle
echten Benutzer, und gegen Credential Stuffing sind Rate-Limiter und Kontosperren
gedacht. Fügen Sie es zu `routes` hinzu, wenn Sie es wünschen.

`POST /auth/anonymous/link`, wo ein Gast eine E-Mail-Adresse und ein Passwort
erhält, zählt als Registrierung: Es verlangt die `register`-Challenge und führt
`beforeUserCreate` aus, wie `/auth/register`. Die Gast-Anmeldung selbst
(`POST /auth/anonymous`) verlangt keine Challenge.

#### Fail-Closed-Verhalten

Kann der Provider nicht erreicht werden, schlägt die Verifizierung fehl und die Anfrage wird
abgewiesen. Ein Angreifer, der diesen Ausfall herbeiführen kann, könnte den
Schutz sonst ausschalten — genau das darf eine Challenge niemals zulassen.

Der Nachteil ist, dass ein Provider-Ausfall Neuregistrierungen blockiert. Das ist laut, sichtbar und
lässt sich durch Entfernen eines Konfigurationsschlüssels rückgängig machen — ein weitaus besseres Fehlerbild als ein
stiller Ausfall, den man erst bemerkt, wenn die Mail-Domain auf einer Blockliste landet.

#### Fehlkonfiguration verhindert den Start

`enabled: true` ohne Provider, mit unbekanntem Provider oder ohne Secret verweigert
den Start. Eine Challenge, die stillschweigend fehlt, während die Konfiguration ihre Anwesenheit meldet,
ist der eine Fehler, den es hier nicht geben darf.

Dem Aufrufer wird lediglich mitgeteilt, dass die Challenge fehlgeschlagen ist — niemals, ob das Token
fehlte, fehlerhaft war, bereits verwendet wurde oder nicht verifiziert werden konnte. Die genaue Ursache
wird geloggt, denn eine detaillierte Rückmeldung an ein Skript würde diesem verraten, wie es sich anpassen muss.

### E-Mail während der Entwicklung

Ohne `SMTP_HOST` können Authentifizierungs-Mails nirgendwohin gesendet werden. Anstatt die
Anfrage abzulehnen, fängt ein Entwicklungsserver die Nachricht ab und gibt ihre Links aus:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Folgen Sie dem Link, um den Flow abzuschließen. Am Token selbst ändert sich nichts — es wird
exakt so generiert, gespeichert und validiert wie bei einem echten Posteingang; lediglich
die Zustellung unterscheidet sich.

Dieses Verhalten ist aktiv, wenn alle drei folgenden Bedingungen erfüllt sind (es gibt keine Einstellung, die dies überschreibt):

- `SMTP_HOST` ist nicht gesetzt — ein konfigurierter Mailserver hat immer Vorrang;
- `NODE_ENV` ist nicht `production`. Eine abgefangene E-Mail zum Zurücksetzen des Passworts enthält ein
  gültiges Reset-Token; der Erfassungsspeicher ist somit ein Speicher für Zugangsdaten und darf
  in der Produktion keinesfalls existieren;
- `FRONTEND_URL` ist eine absolute `http(s)`-URL, da der per E-Mail gesendete
  Link sonst keine Basis hat und ungültig wäre.

Trifft eine dieser Bedingungen nicht zu, antworten `POST /auth/magic-link` und
`POST /auth/forgot-password` wie gewohnt mit `503 EMAIL_NOT_CONFIGURED`. Setzen Sie in der
Produktion `SMTP_HOST` (oder `auth.email.sendEmail`), um E-Mails tatsächlich zu versenden.

#### Abrufen der erfassten E-Mails ohne Terminal

Das Terminal-Log ist nur für denjenigen nützlich, der es aktiv beobachtet. Ein Server in Docker, ein
zweites Fenster oder eine vorbeigescrollte Zeile führen dazu, dass ein ausgegebener Link
nicht mehr auffindbar ist — daher wird dieselbe Erfassung über HTTP bereitgestellt:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Jede Nachricht enthält `to`, `subject`, `at`, die `html`- und `text`-Teile sowie
`links` — die im Text gefundenen absoluten URLs in Dokumentreihenfolge, was
genau der Teil ist, den man benötigt.

Dieser Endpunkt ist nur für Admins zugänglich (über dieselbe Zugriffskontrolle wie Cron, Logs und Backups)
und antwortet mit `501 DEV_MAILBOX_UNAVAILABLE`, wenn nichts auszuliefern ist — bei konfiguriertem SMTP
wurden die E-Mails zugestellt statt abgefangen. `NODE_ENV=production` lehnt den Zugriff
unabhängig von allen anderen Parametern ab: Der Inhalt dieser Nachrichten ermöglicht einen funktionierenden Login.

### Einmalcodes per E-Mail

Ein Magic Link öffnet die Sitzung auf dem Gerät, auf dem sich das E-Mail-Postfach befindet. Das ist
auf einem Laptop das richtige Gerät, aber fast überall sonst das falsche — auf einem Fernseher,
einem Terminal, einem Zweitbrowser oder einem Kiosk-Terminal. Ein Code überbrückt diese Lücke, da eine Person
ihn übertragen kann.

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

Die Adresse wird zusammen mit dem Code erneut übermittelt, und das ist kein bloßer Komfort. Gespeichert
wird ein Hash aus der Adresse *zusammen mit* dem Code. Ein Rateversuch ist somit ein Rateversuch
gegen ein bestimmtes Konto — und nicht gegen alle Konten in der Tabelle gleichzeitig,
was bei einer reinen Code-Suche aus einer Million Möglichkeiten entstehen würde.

Weitere Maßnahmen, die dafür sorgen, dass sechs Ziffern ausreichend sicher sind:

- **Zehn Minuten Gültigkeit** und einmalige Verwendung.
- **Fünf Verifizierungsversuche pro Adresse und Zeitfenster**, gekoppelt an die Adresse
  und nicht an die IP des Aufrufers: Eine IP kann vom Angreifer gewechselt werden, das angegriffene Konto
  jedoch nicht. Die Zähler befinden sich dort, wo auch der Rate-Limit-Speicher des Deployments
  liegt — standardmäßig pro Replikat, geteilt bei `REBASE_RATE_LIMIT_STORE=sql`.
- **Gleichverteilte Ziffern**, erzeugt über `randomInt` anstelle eines Modulo auf Zufallsbytes.
- `POST /auth/otp` antwortet bei einer Adresse ohne Konto absolut identisch, sodass es nicht
  dazu missbraucht werden kann, herauszufinden, ob jemand registriert ist.

Das Auslesen eines Codes aus dem Postfach bestätigt den Besitz der Adresse. Ein
erfolgreicher Login markiert sie daher als verifiziert — genau wie das Anklicken
eines Magic Links. Bei einem noch nicht verifizierten Konto entfernt dieser erste
Nachweis außerdem, was niemand nachgewiesen hat: das Passwort und jede verknüpfte
Identität, deren Provider die Adresse nicht verifiziert hat. Siehe
[Account-Verknüpfung](#account-verknüpfung-über-verschiedene-anmeldemethoden-hinweg).

### Branding der Standard-E-Mails

Die integrierten Vorlagen für Passwort-Reset, Verifizierung, Einladung, Begrüßung und Magic Links
stellen ein Logo über der Infokarte dar. Dieses stammt aus `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Es muss sich um ein **PNG oder JPG unter einer absoluten `http(s)`-URL** handeln. E-Mail-Clients
stellen kein SVG dar und blockieren `data:`-URIs. Zudem wird das Bild vom Client des
Empfängers abgerufen und nicht von Ihrem Server — ein relativer Pfad, eine Data-URI oder eine lokale
Datei führt daher dazu, dass gar kein Logo statt eines defekten Bildes angezeigt wird. `appName` wird als `alt`-Text
verwendet, sodass ein Client mit deaktivierten Bildern dennoch den Namen anzeigt.

Das Fallback-Verhalten ist bewusst asymmetrisch. `appName` fällt auf `Rebase` zurück, aber
das Logo fällt nur dann auf das Rebase-Zeichen zurück, wenn die Installation **nicht** umbenannt
wurde. Setzen Sie `appName` auf einen anderen Wert, erhalten Sie kein Logo, bis Sie
`logoUrl` definieren — andernfalls würden die Benutzer von Acme ein Rebase-Logo in E-Mails erhalten, die von
der Acme-Domain signiert wurden.

Wenn Sie eine Vorlage über `email.templates` ersetzen, gilt dies alles nicht: Ihre
Funktion steuert den gesamten Body.

### OAuth-Provider

Jeder OAuth-Provider wird mindestens mit einer `clientId` konfiguriert. Einige Provider erfordern zusätzlich ein `clientSecret`:

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", teamId: "...", keyId: "...", privateKey: "..." },
    facebook:  { clientId: "...", clientSecret: "..." },
    twitter:   { clientId: "...", clientSecret: "..." },
    discord:   { clientId: "...", clientSecret: "..." },
    gitlab:    { clientId: "...", clientSecret: "..." },
    bitbucket: { clientId: "...", clientSecret: "..." },
    slack:     { clientId: "...", clientSecret: "..." },
    spotify:   { clientId: "...", clientSecret: "..." },
}
```

`gitlab` akzeptiert außerdem eine optionale `baseUrl` für selbst gehostete GitLab-Instanzen.

#### Schreibweise in Umgebungsvariablen

Ein Managed- oder Bundle-Deployment hat keinen `auth`-Block im Code — der Server
wird vollständig über Umgebungsvariablen konfiguriert. Daher besitzt jeder oben genannte Provider ein
`<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`-Paar, und beide Teile müssen
gesetzt sein, damit der Provider überhaupt konfiguriert wird:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` listet anschließend `discord` unter `enabledProviders` auf. So lässt sich
überprüfen, ob das Schlüsselpaar übernommen wurde.

Apple ist die Ausnahme: Hier gibt es kein statisches Client Secret, da Rebase für jeden Token-Austausch
ein kurzlebiges ES256-JWT signiert. Es werden alle vier Variablen benötigt:
`APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` — der
Inhalt der `.p8`-Datei inklusive Zeilenumbrüchen.

Zwei Optionen haben keine Entsprechung in Umgebungsvariablen und erfordern den `auth`-Block (also
ein Ejected- oder code-konfiguriertes Backend): `microsoft.tenantId` (welches sonst
standardmäßig auf `common` gesetzt wird und jede Adresse als nicht verifiziert meldet) und
`gitlab.baseUrl` für selbst gehostete Instanzen.

Jedes benannte Feld wird beim Start in `auth.providers` aufgelöst. Dies ist das
kanonische Array und der Erweiterungspunkt für alles, was die benannten Felder nicht
abdecken. Einträge werden mit den `create*Provider`-Factories erstellt, und beide Formen
werden zusammengeführt — benannte Felder werden an explizite Einträge angehängt:

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

Bleibt diese Option ungesetzt, erfolgt die einzige Prüfung eines OAuth-Redirects über den
Abgleich der im Provider hinterlegten URIs. Dies autorisiert **jede** URI, die auf diesem OAuth-Client
registriert ist — einschließlich des `localhost`-Eintrags, den jemand für die Entwicklung hinzugefügt hat,
und des Staging-Hosts, den niemand entfernt hat. Indem Sie die Origins auflisten, die dieses Backend
tatsächlich bedient, schränken Sie die Weiterleitung darauf ein. URIs werden anhand von Origin plus Pfad
verglichen; Query-Parameter, Fragmente und abschließende Slashes werden ignoriert.

### Account-Verknüpfung über verschiedene Anmeldemethoden hinweg

Was passiert, wenn sich jemand mit E-Mail/Passwort als `ada@example.com` registriert
und später auf „Mit Google anmelden“ mit einem Google-Konto derselben Adresse
klickt? Rebase **verknüpft beide zu einem einzigen Konto** — jedoch nur, wenn der
Provider die E-Mail als verifiziert bestätigt *und* die Adresse des Kontos selbst
verifiziert ist. Es wird niemals stillschweigend ein zweites Konto für dieselbe
Adresse erstellt.

Bei `POST /api/auth/<provider>` gilt folgende Auflösungsreihenfolge:

1. **Bekannte Provider-Identität** — Hat sich genau diese Provider-Identität schon
   einmal angemeldet, wird dieser Benutzer zurückgegeben. Die E-Mail-Adresse wird
   nicht herangezogen.
2. **Bestehendes Konto mit gleicher E-Mail, beide Seiten verifiziert** — Der
   Provider hat die E-Mail verifiziert, und das Konto ebenfalls. Die Identität wird
   mit dem bestehenden Konto verknüpft und der Benutzer angemeldet. Ein Konto, zwei
   Zugangswege.
3. **Bestehendes Konto mit gleicher E-Mail, eine Seite nicht verifiziert** — Wird
   mit `403 EMAIL_NOT_VERIFIED` abgewiesen. Es wird nichts erstellt oder geändert.
   `details.reason` nennt die Seite: `provider-email-unverified`, oder
   `local-account-unverified` (das Konto hat ein Passwort) /
   `local-account-unverified-passwordless` (es hat keines).
4. **Kein Konto mit dieser E-Mail** — Ein neues Konto wird erstellt, als
   verifiziert, wenn der Provider die E-Mail verifiziert hat.

Schritt 3 ist der sicherheitskritische Fall. Wäre eine unbestätigte Provider-E-Mail
für eine Verknüpfung ausreichend, könnte jeder, der einen Provider dazu bringt, eine fremde
Adresse auszugeben, das entsprechende Rebase-Konto übernehmen. Google bestätigt
`email_verified` bei echten Google-Konten immer, weshalb Schritt 2 der Normalfall für
den Google-Login ist. Schritt 3 fängt vor allem Provider ab, bei denen Benutzer eine
beliebige unbestätigte Adresse angeben können.

Die Seite des Kontos zählt aus demselben Grund. Nichts verifiziert die Adresse, die
`POST /auth/register` erhält. Jeder kann also die Adresse einer anderen Person mit
einem Passwort registrieren oder sich über einen Provider, der nicht für sie bürgt,
damit anmelden, und abwarten. Würde die Google-Anmeldung des Eigentümers mit diesem
Konto verknüpft, bliebe der Zugang der anderen Person darauf bestehen.

Ein Magic Link, ein E-Mail-Code oder ein Passwort-Reset weist die Adresse nach und
verifiziert das Konto. Bei einem noch nicht verifizierten Konto entfernt der erste
solche Nachweis das Passwort (ein Reset setzt das neue) und jede verknüpfte
Identität, deren Provider diese Adresse nicht verifiziert hat, und beendet jede
Sitzung, bevor er das Konto als verifiziert markiert. Danach gilt Schritt 2. Konten,
die ein Admin mit `POST /api/admin/users` anlegt, werden als verifiziert
gespeichert, sodass eingeladene Personen „Mit Google anmelden“ sofort nutzen können.
<span class="since-badge" data-since="0.23">Seit 0.23</span> Ein eigenes Auth-Repository ohne `unlinkUserIdentity` lehnt einen solchen Nachweis
mit `409 UNVERIFIED_IDENTITIES` ab, wenn eine Identität zu entfernen ist.

Dieses Verhalten ist nicht konfigurierbar — es gibt bewusst keine Option, Verknüpfungen
anhand unbestätigter E-Mails zuzulassen.

Um eine Zurückweisung aus Schritt 3 aufzulösen, meldet sich der Benutzer mit seiner bestehenden
Methode an und ruft den expliziten Verknüpfungsendpunkt auf:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

Das Verknüpfen im authentifizierten Zustand erfordert absichtlich **keine** verifizierte
E-Mail und verlangt auch nicht, dass die E-Mail-Adressen übereinstimmen — die Google-Adresse
eines Benutzers unterscheidet sich oft von der App-Adresse. Diese Asymmetrie ist gewollt: Bei der
Anmeldung ist die E-Mail des Providers der einzige Nachweis, der die eingehende Identität
an ein Konto bindet. Hier jedoch hat der Aufrufer die Inhaberschaft bereits durch eine gültige Sitzung
nachgewiesen. Es wird `409 IDENTITY_ALREADY_LINKED` zurückgegeben, wenn die Provider-Identität
einem anderen Benutzer gehört; der Aufruf ist idempotent, wenn sie bereits mit dem Aufrufer verknüpft ist.

#### Die umgekehrte Richtung

Ein Benutzer, der sich über Google registriert hat und kein Passwort besitzt:

- **Eine Registrierung mit derselben E-Mail** wird mit `409 EMAIL_EXISTS` abgewiesen.
- **`POST /api/auth/change-password`** liefert `400 INVALID_ACCOUNT` zurück — es gibt
  kein bestehendes Passwort, gegen das geprüft werden könnte.
- **`forgot-password` → `reset-password` ist der offizielle Weg, eines hinzuzufügen.**
  Hierbei wird der Besitz der Adresse per E-Mail erneut nachgewiesen, woraufhin das Konto
  über beide Anmeldemethoden verfügt.

## Automatisch erstellte Tabellen

Beim ersten Start richtet Rebase automatisch das `auth`-Schema und die folgenden Tabellen in der Datenbank ein (gebunden an das in Ihrer Collection definierte Schema, z. B. `rebase`):

- **`rebase.users`** — Benutzerkonten mit E-Mail, Passwort-Hash, Metadaten und einer `roles`-Spalte vom Typ `text[]` (Rollen werden als Inline-Text-Arrays gespeichert, um Abfragen zu optimieren und Joins zu vermeiden).
- **`rebase.refresh_tokens`** — Langlebige Sitzungen mit gehashten Refresh-Tokens, User-Agents und IP-Adressen. Enthält einen Unique Index auf `token_hash` und einen Unique Constraint auf `(user_id, user_agent, ip_address)`, um aktive Gerätesitzungen zu verfolgen.
- **`rebase.password_reset_tokens`** — Ablaufbare Einmal-Tokens für Abläufe zur Passwortwiederherstellung.
- **`rebase.mfa_factors`** — Eingerichtete Multi-Faktor-Authentifizierungsmethoden (z. B. mit AES-256 verschlüsselte TOTP-Secrets).
- **`rebase.mfa_challenges`** — Verifizierungsprotokolle zur Nachverfolgung aktiver MFA-Verifizierungsversuche.
- **`rebase.recovery_codes`** — Gehashte Multi-Faktor-Backup-/Recovery-Codes.
- **`rebase.app_config`** — Key-Value-Speicher für Systemkonfigurationen.

## Bootstrap des ersten Benutzers

Wenn noch keine Benutzer in der Datenbank existieren und der Server **nicht** mit `NODE_ENV=production` läuft,
wird die erste registrierte Person automatisch zum Admin. Danach wird die Registrierung
über die Einstellung `allowRegistration` gesteuert.

In der Produktion ist dieses Zeitfenster geschlossen, da ein Host mit öffentlichem Namen erreichbar ist,
bevor der Betreiber sich registriert hat — wer zuerst käme, hätte die Kontrolle. Ein Produktions-Deployment
benennt seinen ersten Admin stattdessen über Umgebungsvariablen — `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD`,
die beim Booten erstellt werden, solange die Tabelle noch leer ist — oder weist die Rolle über den Service-Key zu.
Ist das Fenster geschlossen, weist eine leere Tabelle die Bootstrap-Registrierung mit `SETUP_REQUIRED` ab (und gibt dies an),
ein über die offene Registrierung erstelltes erstes Konto ist ein normales Konto, `GET /api/auth/config` meldet niemals
`needsSetup`, `POST /api/admin/bootstrap` schlägt fehl, und das Boot-Log warnt, wenn die Tabelle leer ist und kein Admin benannt wurde.

Auf einem Entwicklungsrechner bedeutet dies, dass Sie eine frische Datenbank jederzeit bootstrappen können,
ohne sie manuell mit Seed-Daten zu befüllen. Um gleichzeitige Ausführungen und Race Conditions bei der
Schema-Generierung beim Hot Reloading (HMR) oder beim Start zu verhindern, werden Bootstrapping-Vorgänge
über einen Postgres Advisory Lock synchronisiert:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Auth-Konfiguration auf Collection-Ebene

Anstatt sich ausschließlich auf die standardmäßigen Datenbank-Auth-Regeln zu verlassen, können Sie jede Postgres-Collection (wie `users.ts` oder eine benutzerdefinierte `members.ts`-Collection) als Authentifizierungs-Collection deklarieren. Dies wird über die Eigenschaft `auth` direkt an der Collection konfiguriert:

```typescript
import { randomBytes } from "node:crypto";
import { defineCollection } from "@rebasepro/cms-types";

const membersCollection = defineCollection({
  name: "Members",
  slug: "members",
  table: "members",
  auth: {
    enabled: true,
    
    // Customize what happens when an admin creates a user via the REST API
    onCreateUser: async (values, ctx) => {
      const hash = await ctx.hashPassword("welcome123");
      return {
        values: { ...values, passwordHash: hash, emailVerified: true },
        temporaryPassword: "welcome123"
      };
    },

    // Customize what happens when an admin resets a user's password in the admin panel
    onResetPassword: async (userId, ctx) => {
      const tempPassword = randomBytes(12).toString("base64url");
      return {
        temporaryPassword: tempPassword, // saved as the new password, then shown to the admin
        invitationSent: false
      };
    },

    // Inject/override auth-specific actions (e.g. show/hide the reset password button)
    actions: {
      resetPassword: true // Or false to disable, or a custom EntityAction
    }
  },
  properties: { ... }
});
```

Ein von `onResetPassword` zurückgegebenes `temporaryPassword` wird zum Passwort des Kontos. Rebase hasht es mit dem konfigurierten Algorithmus, speichert es, meldet den Benutzer von allen bestehenden Sitzungen ab und zeigt es dem Admin zur Weitergabe an. Der Hook speichert es nicht selbst und hat auch keine Möglichkeit dazu. Geben Sie kein `temporaryPassword` zurück, wenn der Hook stattdessen einen eigenen Link zum Zurücksetzen per E-Mail versendet: Das Passwort bleibt dann unverändert, bis der Benutzer ein neues festlegt – seine Sitzungen enden trotzdem.

Wenn benutzerdefinierte Hooks (`onCreateUser`, `onResetPassword`) aufgerufen werden, erhalten sie eine `AuthCollectionContext`-Fassade, die Folgendes enthält:
- `hashPassword(password: string): Promise<string>` — Hasht das Passwort mit dem konfigurierten Hashing-Algorithmus (z. B. scrypt).
- `sendEmail?: (options) => Promise<EmailSendResult>` — Versendet eine E-Mail (nur verfügbar, wenn der E-Mail-Dienst konfiguriert ist). Gibt zurück, was der Provider gemeldet hat — `messageId`, `accepted`, `rejected` — sodass ein Hook die ID speichern und später Antworten zuordnen kann.
- `emailConfigured: boolean` — Gibt an, ob der E-Mail-Dienst konfiguriert ist.
- `appName: string` — Der App-Name aus der E-Mail-Konfiguration.
- `resetPasswordUrl: string` — Die Basis-URL für den Link zum Zurücksetzen des Passworts.

## Nächste Schritte

- **[Endpunkte und Tokens](/docs/backend/auth-endpoints/)** — alle Routen, die diese Konfiguration bereitstellt
- **[Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters/)** — Anbindung eigener Identity-Provider
- **[Frontend-Authentifizierung](/docs/frontend/authentication/)** — Login-UI, Auth-Controller, Benutzerverwaltung
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules/)** — Zugriffskontrolle auf Zeilenebene (Row-Level Security)
- **[Client-SDK-Authentifizierung](/docs/sdk/authentication/)** — Authentifizierungsmethoden im Client-SDK

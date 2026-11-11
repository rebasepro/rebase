---
sourceHash: 3c34341487182d4a
title: Authentifizierung
sidebar_label: Authentifizierung
description: Konfigurieren Sie JWT-Authentifizierung, OAuth-Anbieter, SMTP-E-Mail, Bot-Schutz und die Users-Collection im Rebase-Backend.
---

Die Authentifizierung umfasst drei Seiten, da sie drei Aufgaben erfüllt. Diese Seite behandelt die **Konfiguration**: was in den `auth`-Block und in die Umgebung gehört.

- [Endpoints and tokens](/docs/backend/auth-endpoints/) — die vom Backend bereitgestellten Routen, die Antwortstrukturen, MFA, der Datenbankkontext, den eine Policy sieht, JWKS und Service-Keys.
- [Custom auth adapters](/docs/backend/auth-adapters/) — Ersetzen des integrierten Providers durch Clerk, Firebase Auth oder eine eigene Lösung.

## Übersicht

Rebase enthält ein vollständiges Backend-Authentifizierungssystem:

- **JWT-Tokens** — Access- und Refresh-Token-Ablauf mit konfigurierbarer Ablaufzeit
- **OAuth-Anbieter** — Google, LinkedIn, GitHub, Microsoft, Apple und weitere
- **SMTP-E-Mail** — Abläufe für das Zurücksetzen von Passwörtern und die E-Mail-Verifizierung
- **Auth-Hooks** — Lifecycle-Hooks für die Benutzererstellung und mehr
- **Eigene Auth-Adapter** — Einbindung von Firebase Auth, Auth0, Clerk oder beliebigen externen Anbietern
- **Service-Key** — Statischer Schlüssel für die Server-zu-Server-Authentifizierung
- **Automatisches Bootstrapping** — Außerhalb von Produktionsumgebungen erhält der erste Benutzer automatisch die Administratorrolle; ein produktives Deployment benennt seinen Administrator über `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime:** Umgebung — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` und die Paare `*_CLIENT_ID` / `*_CLIENT_SECRET` für jeden der zwölf Anbieter ([die Schreibweisen](#die-umgebungsvariablen-schreibweisen); bei Apple sind es vier Schlüssel statt eines Paars). Die Users-Collection ist diejenige, die das Bundle benennt (standardmäßig `collections/users`).
**Keine Managed Route:** `auth.hooks`. Dies sind Funktionen; verwenden Sie Eject, um sie zu übergeben.
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

| Schlüssel | Typ | Standard | Funktionsweise |
|-----------|-----|----------|----------------|
| `collection` | `CollectionConfig` | — | Die Users-Collection. Siehe [Auth-Konfiguration auf Collection-Ebene](#auth-konfiguration-auf-collection-ebene) |
| `jwtSecret` | `string` | — | HS256-Signierschlüssel. In Produktionsumgebungen erforderlich |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Asymmetrische Signierschlüssel — siehe [Asymmetric Tokens and JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | erster Schlüssel | Welcher der `signingKeys` neue Tokens ausstellt |
| `accessExpiresIn` | `string` | `1h` | Gültigkeitsdauer des Access-Tokens |
| `refreshExpiresIn` | `string` | `30d` | Gültigkeitsdauer des Refresh-Tokens. Gleitend: Jede Rotation verlängert sie, gibt also an, wie lange eine Sitzung bei **Inaktivität** überdauert. Die Runtime übergibt `JWT_REFRESH_EXPIRES_IN`, standardmäßig ebenfalls `30d`. Browser begrenzen das Refresh-Cookie auf 400 Tage, daher bringt ein höherer Wert im Cookie-Modus keinen Vorteil |
| `refreshTokenReuseIntervalSeconds` | `number` | `10` | Wie lange ein Refresh-Token, das bereits rotiert wurde, noch eine Geschwistersitzung erzeugen kann, damit ein Client, der eine Refresh-Antwort verloren hat, nicht abgemeldet wird |
| `refreshTokenReuse` | `"reject" \| "revoke-session"` | `"reject"` | Was geschieht, wenn ein Refresh-Token nach diesem Zeitfenster vorgelegt wird. `"reject"` weist es ab (`TOKEN_ALREADY_USED`), protokolliert dies und die Sitzung bleibt bestehen: Dies ist keine Erkennung von Wiederverwendung, da derjenige, der zuerst aktualisiert hat, die Sitzung behält. `"revoke-session"` beendet bei einem solchen Replay die gesamte Anmeldung (`SESSION_REVOKED`), wie es auch GoTrue tut, und der Eigentümer muss sich erneut anmelden. `AUTH_REFRESH_TOKEN_REUSE` |
| `requireAuth` | `boolean` | `true` | Eine aktive Sitzung für die Daten-API erzwingen |
| `allowRegistration` | `boolean` | `false` | `POST /api/auth/register` freigeben. Außerhalb von Produktionsumgebungen wird der erste Benutzer bei einer leeren Tabelle in jedem Fall zugelassen; in Produktionsumgebungen wird der Administrator über `REBASE_ADMIN_EMAIL` festgelegt |
| `disableSelfRegistration` | `boolean` | `false` | Notfallschalter: Schließt auch das Bootstrap-Fenster für den ersten Benutzer, das `allowRegistration: false` offen lässt |
| `allowAnonymous` | `boolean` | `false` | Aktiviert `POST /api/auth/anonymous`. Bewusst nicht durch `allowRegistration` beschränkt — eine öffentlich lesbare App benötigt möglicherweise Sitzungen ohne Benutzerkonten. Die Umwandlung eines Gasts in ein Konto (`POST /api/auth/anonymous/link`) ist eine Registrierung und erfordert zusätzlich `allowRegistration` — sowie weiterhin aktives `allowAnonymous`: Ist es deaktiviert, werden auch bereits angemeldete Gäste abgewiesen, sodass keiner zu einem Konto werden kann (`403 ANONYMOUS_AUTH_DISABLED`) |
| `allowUserLookup` | `boolean` | `false` | Bindet `POST /api/auth/find-user` für Einladungsabläufe per E-Mail ein |
| `captcha` | `CaptchaConfig` | — | Bot-Schutz für Routen, die E-Mails versenden — siehe [Bot-Schutz](#bot-schutz) |
| `defaultRole` | `string` | — | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. Es darf weder `admin` noch eine deklarierte Rolle sein, die Scopes der Administrationsebene besitzt: Beides wird beim Start verweigert |
| `serviceKey` | `string` | — | Statischer Schlüssel für Server-zu-Server-Aufrufe — siehe [Service Key Authentication](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP für Passwort-Reset, Verifizierung, Einladungen und Magic-Links |
| `magicLink` | `boolean` | `false` | Passwortlose E-Mail-Anmeldung aktivieren. Erfordert konfiguriertes `email`; andernfalls antworten die Routen mit `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Sechsstellige Anmeldecodes per E-Mail aktivieren — siehe [Einmalcodes per E-Mail](#einmalcodes-per-e-mail). Gleiche E-Mail-Voraussetzung |
| `deviceLogin` | `{ verificationUrl: string }` | — | Ermöglicht die Anmeldung an einem Terminal oder Gerät ohne Browser über einen anderen Browser — siehe [Geräte-Anmeldung](/docs/backend/device-sign-in/). Benötigt eine SQL-Datenbank |
| `magicLinkCreatesUsers` | `boolean` | `false` | Passwortlose Registrierung: Eine Anfrage per Magic-Link oder E-Mail-Code für eine Adresse ohne Konto legt eines an (ohne Passwort, unbestätigt bis zur Nutzung von Link oder Code), sofern `allowRegistration` aktiv ist. Führt `beforeUserCreate` und die Standardrolle aus. Deaktiviert legen solche Anfragen nichts an und antworten bei einer unbekannten Adresse genauso wie bei einer bekannten. `AUTH_MAGIC_LINK_CREATES_USERS` |
| `requireEmailVerification` | `boolean` | `false` | Passwortanmeldung verweigern, bis die Adresse bestätigt ist, und Registrierung im Confirm-First-Verfahren durchführen — siehe [E-Mail-Verifizierung](/docs/backend/email-verification/). Benötigt `email`; der Start schlägt andernfalls fehl |
| `cookieAuth` | `CookieAuthConfig \| false` | aktiv | Liefert das Refresh-Token als `httpOnly` `Secure` `SameSite`-Cookie statt im JSON-Body aus; `false` liefert es im Body zurück — siehe unten |
| `providers` | `OAuthProvider[]` | `[]` | Das kanonische OAuth-Array; die benannten Anbieter-Felder werden darin zusammengeführt |
| `allowedRedirectUris` | `string[]` | — | Schränkt ein, welche Redirect-URIs die OAuth-Routen akzeptieren |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Refresh-Tokens in einem `httpOnly`-Cookie

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

Das Refresh-Token ist das langlebige Authentifizierungsmerkmal, und im Body könnte jedes XSS auf der Seite darauf zugreifen. `cookieAuth` speichert es in einem Cookie, das Skripte auf der Seite nicht erreichen können: standardmäßig aktiv, in der Runtime immer und seit 0.30 auch in `initializeRebaseBackend`. Das **Access**-Token verbleibt für den `Authorization`-Header im Body. Eine Anfrage mit `x-rebase-auth-flow: json` erhält das Refresh-Token im Body; mit `cookieAuth: false` gilt dies für jede Anfrage, und ein Browser-Client benötigt `authFlowMode: "json"`.

Zwei Voraussetzungen müssen erfüllt sein, damit die Anmeldung ordnungsgemäß funktioniert statt fehlzuschlagen: Client-Abrufe der Auth-Endpunkte erfordern `credentials: "include"`, und CORS muss Credentials erlauben — was eine explizite Liste von Origins verlangt, niemals `origin: "*"`. `AUTH_COOKIE_SAME_SITE` ist die Schreibweise für `sameSite` als Umgebungsvariable, und `AUTH_COOKIE_SECURE` für `secure`.

Das Cookie trägt standardmäßig das Attribut `Secure`, sofern es nicht deaktiviert wird, und keine Eigenschaft der Anfrage kann dies ändern: Aus dem Protokoll der Anfrage gelesen, das hinter einem TLS-terminierenden Proxy `http` lautet, würde das Token im Klartext übertragen. `AUTH_COOKIE_SECURE=false` ist die einzige Ausweichmöglichkeit für Deployments, die über einfaches HTTP betrieben werden (eine LAN-Adresse, eine Appliance), und gibt beim Start eine Warnung aus. Für `http://localhost` ist dies nicht erforderlich.

| Schlüssel | Standard | |
|-----------|----------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | aktuelle Domain | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` ist nur für tatsächlich seitenübergreifende (Cross-Site) Frontends gedacht |
| `secure` | `true` | Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für reines HTTP |

:::caution[Collection-Callbacks werden für Auth-Benutzer nicht ausgelöst]
Die Erstellung und Aktualisierung von Benutzern über das Authentifizierungssystem — Registrierung, administrative Benutzerverwaltung und OAuth — schreibt **direkt** in den Benutzerspeicher und umgeht die Save-Pipeline der Collection. Ein `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`-Callback auf der Auth-Collection (Users) wird für diese Pfade **nicht** ausgeführt. Für Nebeneffekte wie das Einrichten eines persönlichen Teams bei der Registrierung sollten Sie die Auth-Lifecycle-Hooks (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …) verwenden, die den vollständig befüllten Benutzerdatensatz erhalten.

OAuth führt dieselben Hooks wie die anderen Anmeldeverfahren aus: `beforeLogin` (mit der Adresse des Anbieters und `"oauth"`), `beforeUserCreate`, wenn die Anmeldung das Konto anlegt, `afterUserCreate` und `onAuthenticated`. `onAuthenticated` wird auch bei einem Token-Refresh (`"refresh"`), einem Passwort-Reset (`"password-reset"`) und einem zweiten Faktor (`"mfa"`) ausgelöst. `beforeLogin` läuft bei einem Refresh nicht ab, da dies keine Neuanmeldung darstellt. Um ein bereits angemeldetes Konto zu sperren, deaktivieren Sie es über `PUT /api/admin/users/:uid { disabled: true }`: Dies verweigert jede Anmeldung sowie jeden Refresh und beendet alle Sitzungen und Tokens, die das Konto hält.

`beforeEmailChange(user, newEmail)` wird ausgeführt, wenn ein angemeldeter Benutzer den Wechsel seines Kontos zu einer anderen Adresse anfordert. Eine Adressregel, die Sie bei der Registrierung in `beforeUserCreate` durchsetzen (z. B. nur die eigene Domain), gehört auch hierher; andernfalls könnte sich ein Mitglied mit einer erlaubten Adresse registrieren und anschließend zu einer beliebigen anderen wechseln.

Ein Hook, der die Aktion verweigert (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete`, `beforeEmailChange`), wirft einen Fehler. Der Aufrufer erhält `400 HOOK_REJECTED` mit der Meldung des Fehlers oder dem Status, den der Fehler mitführt: ein `ApiError` oder ein beliebiger Fehler mit einem 4xx-`status`.
:::

### Bot-Schutz

Rate-Limiting schränkt einzelne Aufrufer ein. Tausend unterschiedliche Adressen, die jeweils eine einzelne Anfrage senden, überschreiten jedoch nie ein IP-bezogenes Zeitfenster — und `/auth/register`, `/auth/forgot-password` sowie `/auth/magic-link` versenden alle E-Mails. Die Kosten für ein ungeschütztes Formular schlagen sich somit in der Reputation Ihrer Absenderdomain nieder.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Oder über Umgebungsvariablen, was bei einem Managed Deployment zum Einsatz kommt:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

Der Client sendet das Token des Widgets als `captchaToken` im JSON-Body oder im Widget-eigenen Header `cf-turnstile-response` / `h-captcha-response`. Beide werden akzeptiert; konfigurieren Sie `tokenField`, um einen anderen Schlüssel im Body zu verwenden.

**`login` ist standardmäßig nicht geschützt.** Eine Challenge bei jedem Login belastet jeden echten Benutzer, und gegen Credential Stuffing sind Rate-Limiter und Kontosperren vorgesehen. Fügen Sie es bei Bedarf zu `routes` hinzu.

`POST /auth/anonymous/link`, bei dem ein Gast eine E-Mail und ein Passwort erhält, zählt als Registrierung: Es verlangt die `register`-Challenge und führt `beforeUserCreate` aus, genau wie `/auth/register`. Die Gastanmeldung selbst (`POST /auth/anonymous`) erfordert keine Challenge.

#### Fail-Closed-Verhalten

Kann der Anbieter nicht erreicht werden, schlägt die Verifizierung fehl und die Anfrage wird abgewiesen. Ein Angreifer, der in der Lage wäre, einen solchen Ausfall herbeizuführen, könnte andernfalls den Schutz deaktivieren — was eine Challenge unter keinen Umständen zulassen darf.

Die Konsequenz ist, dass ein Ausfall des Anbieters Neuregistrierungen blockiert. Dies ist deutlich wahrnehmbar, sichtbar und lässt sich durch Entfernen eines einzigen Konfigurationsschlüssels rückgängig machen — ein weitaus besseres Fehlerszenario als ein unbemerkter Fehler, der erst auffällt, wenn die Mail-Domain auf einer Blocklist landet.

#### Fehlkonfiguration verhindert den Start

`enabled: true` ohne Anbieter, mit unbekanntem Anbieter oder ohne Secret verhindert den Start des Systems. Eine Challenge, die stillschweigend fehlt, während die Konfiguration ihr Vorhandensein vorgibt, ist der schwerwiegendste Fehler, der hier vermieden werden muss.

Dem Aufrufer wird lediglich mitgeteilt, dass die Challenge fehlgeschlagen ist — niemals, ob das Token fehlte, fehlerhaft war, bereits verwendet wurde oder nicht überprüfbar war. Welcher Fall vorlag, wird im Protokoll vermerkt; genaue Rückmeldungen an ein Skript würden diesem nur Hinweise für Angriffe liefern.

### E-Mail in der Entwicklung

Ohne `SMTP_HOST` können Authentifizierungs-E-Mails nirgendwohin zugestellt werden. Anstatt die Anfrage abzuweisen, fängt ein Entwicklungsserver die Nachricht ab und gibt die enthaltenen Links im Terminal aus:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Folgen Sie dem Link, und der Ablauf wird auf der Seite abgeschlossen, die diesen Pfad bereitstellt: Das CMS bedient `/reset-password`, `/verify-email`, `/confirm-email-change` sowie `/auth/magic-link` für Magic-Links; ein anderes Frontend benötigt jeweils eine eigene Seite (siehe [Magic Links](/docs/sdk/authentication/#magic-links) im SDK). Am Token selbst ändert sich nichts — es wird exakt so erzeugt, gespeichert und validiert wie bei einem echten Posteingang; lediglich der Übertragungsweg unterscheidet sich.

Dies ist immer dann aktiv, wenn alle drei folgenden Bedingungen erfüllt sind, und keine Einstellung kann dies ändern:

- `SMTP_HOST` ist nicht gesetzt — ein konfigurierter Mailserver hat immer Vorrang;
- `NODE_ENV` ist nicht `production`. Eine abgefangene E-Mail zum Zurücksetzen des Passworts enthält ein funktionierendes Reset-Token; der Abfangpuffer fungiert somit als Speicher für Zugangsdaten und darf in der Produktion keinesfalls existieren;
- `FRONTEND_URL` ist eine absolute `http(s)`-URL, da der per E-Mail versendete Link andernfalls keine Basis hätte und ungültig wäre.

Trifft eine dieser Bedingungen nicht zu, antworten `POST /auth/magic-link` und `POST /auth/forgot-password` wie bisher mit `503 EMAIL_NOT_CONFIGURED`. Setzen Sie in der Produktionsumgebung `SMTP_HOST` (oder `auth.email.sendEmail`), um E-Mails tatsächlich zu versenden.

#### Abgefangene E-Mails ohne Terminal einsehen

Das Protokoll hilft nur demjenigen, der es aktiv beobachtet. Ein Server in Docker, ein zweites Konsolenfenster oder eine bereits weitergescrollte Zeile führen dazu, dass ein ausgegebener Link verloren geht. Daher wird derselbe Puffer auch über HTTP bereitgestellt:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → leert das Postfach
```

Jede Nachricht enthält `to`, `subject`, `at`, die Textteile `html` und `text` sowie `links` — die im Body gefundenen absoluten URLs in Dokumentenreihenfolge, also genau den Teil, den man benötigt.

Hierfür ist der Scope `users:write` erforderlich, abgesichert über denselben Mechanismus wie Cron, Logs und Backups. Der Endpunkt antwortet mit `501 DEV_MAILBOX_UNAVAILABLE`, wenn nichts auszuliefern ist — bei konfiguriertem SMTP wurden die E-Mails zugestellt statt zwischengespeichert. `NODE_ENV=production` verweigert diesen Endpunkt in jedem Fall: Der Inhalt dieser Nachrichten ermöglicht einen direkten Login.

### Einmalcodes per E-Mail

Ein Magic-Link öffnet die Sitzung auf dem Gerät, auf dem sich das Postfach befindet. Auf einem Laptop ist das passend, überall sonst jedoch meist ungeeignet — an einem Fernseher, einem Terminal, einem Zweitbrowser oder einem Kiosk. Ein Code schließt diese Lücke, da der Benutzer ihn manuell übertragen kann.

```ts
auth: {
    emailOtp: true,   // or AUTH_EMAIL_OTP=true
    email: { /* … */ }
}
```

```ts
await rebase.auth.sendEmailOtp("someone@example.com");
// …der Benutzer liest sechs Ziffern aus seinem Posteingang ab…
const { user } = await rebase.auth.verifyEmailOtp("someone@example.com", "384102");
```

Die Adresse wird zusammen mit dem Code erneut übermittelt, und das ist kein reiner Komfort. Gespeichert wird ein Hash aus der Adresse *zusammen mit* dem Code. Ein Rateversuch richtet sich somit immer nur gegen ein bestimmtes Konto — und nicht gegen alle Konten in der Tabelle gleichzeitig, was eine reine Code-Suche bei einer Million Möglichkeiten ermöglichen würde.

Weitere Sicherheitsmaßnahmen, die sechs Ziffern ausreichend sicher machen:

- **Zehn Minuten Gültigkeit** und einmalige Verwendung.
- **Fünf Verifizierungsversuche pro Adresse und Zeitfenster**, gekoppelt an die Adresse und nicht an die IP des Aufrufers: Eine IP kann vom Angreifer gewechselt werden, das angegriffene Konto hingegen nicht. Die Zähler liegen dort, wo sich der Rate-Limit-Speicher des Deployments befindet — standardmäßig pro Replika, geteilt bei `REBASE_RATE_LIMIT_STORE=sql`.
- **Gleichverteilte Ziffern**, erzeugt über `randomInt` statt über Modulo-Operationen auf zufälligen Bytes.
- `POST /auth/otp` liefert für eine Adresse ohne Konto exakt dieselbe Antwort, sodass der Endpunkt nicht zur Feststellung genutzt werden kann, ob jemand Kunde ist.

Das Ablesen eines Codes aus dem Posteingang verifiziert die Adresse. Ein erfolgreicher Login markiert sie daher als verifiziert — genau wie das Aufrufen eines Magic-Links. Bei einem Konto, das zuvor noch nicht verifiziert war, entfernt dieser erste Nachweis zudem alle unbewiesenen Angaben: das Passwort sowie jede verknüpfte Identität, deren Anbieter die Adresse nicht verifiziert hat. Siehe [Konto-Verknüpfung über Anmeldemethoden hinweg](#konto-verknüpfung-über-anmeldemethoden-hinweg).

### Branding der Standard-E-Mails

Die integrierten Vorlagen für Passwort-Reset, Verifizierung, Einladung, Begrüßung, Magic-Links und E-Mail-Änderung rendern ein Logo über der Karte. Dieses stammt aus `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Es muss sich um ein **PNG oder JPG unter einer absoluten `http(s)`-URL** handeln. E-Mail-Clients unterstützen oft kein SVG und blockieren `data:`-URIs. Zudem wird das Bild vom Client des Empfängers und nicht von Ihrem Server abgerufen — ein relativer Pfad, ein Data-URI oder eine lokale Datei führt daher dazu, dass kein Logo statt eines defekten Bildes angezeigt wird. `appName` dient als `alt`-Text, sodass ein Client mit deaktivierten Bildern dennoch den Namen anzeigt.

Das Fallback-Verhalten ist bewusst asymmetrisch gestaltet. `appName` fällt auf `Rebase` zurück, das Logo fällt jedoch nur dann auf das Rebase-Signet zurück, solange die Installation **nicht** umbenannt wurde. Setzen Sie `appName` auf einen anderen Wert, erhalten Sie kein Logo, bis Sie `logoUrl` konfigurieren — andernfalls würden die Benutzer von Acme ein Rebase-Signet in E-Mails erhalten, die von der Domain von Acme signiert sind.

Ersetzen Sie eine Vorlage über `email.templates`, greift dieser Mechanismus nicht: Ihre Funktion steuert dann den gesamten E-Mail-Body. `templates.emailChange(confirmUrl, user, newEmail)` ist der Link, der an die neue Adresse gesendet wird, wenn ein Benutzer diese ändert, und `templates.emailChangeNotice(user, newEmail)` die Benachrichtigung an die alte Adresse; `user.email` ist in beiden Fällen die bisherige Adresse.

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

`gitlab` akzeptiert zudem eine optionale `baseUrl` für selbst gehostete GitLab-Instanzen.

#### Die Umgebungsvariablen-Schreibweisen

Ein Managed- oder Bundle-Deployment besitzt keinen `auth`-Block im Code — es konfiguriert den Server vollständig über Umgebungsvariablen. Daher verfügt jeder oben genannte Anbieter über ein Paar aus `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`. Beide Werte müssen gesetzt sein, damit der Anbieter konfiguriert wird:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` listet `discord` anschließend unter `enabledProviders` auf; so lässt sich überprüfen, ob ein Paar übernommen wurde.

Google wird ausschließlich über `GOOGLE_CLIENT_ID` konfiguriert: Der ID-Token-Ablauf benötigt kein Secret, weshalb `GOOGLE_CLIENT_SECRET` optional ist.

Apple nutzt kein Client-Secret: Rebase signiert für jeden Austausch ein ES256-JWT. Erforderlich sind `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` (der Inhalt der `.p8`-Datei inklusive Zeilenumbrüchen) sowie `APPLE_CLIENT_ID` (die Services-ID für das Web), `APPLE_BUNDLE_IDS` (kommagetrennte IDs Ihrer nativen iOS- und macOS-Apps) oder beides. Die Services-ID ist öffentlich, daher stellt `/auth/config` sie für die Option **Sign in with Apple** im Admin-Bereich bereit.

Zwei Optionen besitzen keine Entsprechung als Umgebungsvariable und erfordern den `auth`-Block (also ein ejected oder code-konfiguriertes Backend): `microsoft.tenantId`, das standardmäßig auf `common` gesetzt ist und jeden Entra-Mandanten akzeptiert (bei jedem Mandanten gilt eine Adresse nur dann als verifiziert, wenn die App-Registrierung den Claim `xms_edov` ausgibt), sowie `gitlab.baseUrl` für selbst gehostete Instanzen.

Jedes benannte Feld wird beim Start in `auth.providers` aufgelöst, welches das kanonische Array und der Erweiterungspunkt für alle Fälle ist, die nicht durch die benannten Felder abgedeckt werden. Einträge werden mit den Factory-Funktionen `create*Provider` erstellt, und beide Formen werden zusammengeführt — benannte Felder werden nach expliziten Einträgen angehängt:

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

Bleibt diese Einstellung leer, besteht die einzige Prüfung eines OAuth-Redirects im Abgleich der beim Anbieter registrierten URIs — was **jede** auf diesem OAuth-Client registrierte URI autorisiert, einschließlich des `localhost`-Eintrags aus der Entwicklung und des Staging-Hosts, der nicht entfernt wurde. Die Angabe der Origins, die dieses Backend tatsächlich bedient, schränkt dies auf die gewünschten Adressen ein. URIs werden anhand von Origin und Pfad verglichen; Query-Parameter, Fragmente und abschließende Schrägstriche werden ignoriert.

### Konto-Verknüpfung über Anmeldemethoden hinweg

Was passiert, wenn sich jemand per E-Mail/Passwort als `ada@example.com` registriert und später bei einem Google-Konto mit derselben Adresse auf „Mit Google anmelden“ klickt? Rebase **verknüpft beide zu einem einzigen Konto**, jedoch nur, wenn der Anbieter die E-Mail-Adresse als verifiziert bestätigt. Es wird niemals stillschweigend ein zweites Konto für dieselbe Adresse erstellt.

Bei `POST /api/auth/<provider>` gilt folgende Auflösungsreihenfolge:

1. **Bekannte Identität des Anbieters**: Hat sich diese exakte Identität des Anbieters bereits angemeldet, wird dieser Benutzer zurückgegeben. Die E-Mail-Adresse wird nicht herangezogen.
2. **Bestehendes Konto mit derselben E-Mail, Anbieter hat die E-Mail verifiziert**: Die Identität wird angehängt und der Benutzer eingeloggt. Ein Konto, zwei Zugangswege. Ein noch nicht verifiziertes Konto wird zuvor verifiziert (siehe unten).
3. **Bestehendes Konto mit derselben E-Mail, Anbieter hat sie nicht verifiziert**: Abgewiesen mit `403 EMAIL_NOT_VERIFIED` und dem Grund `details.reason: provider-email-unverified`. Es wird nichts angelegt oder verändert.
4. **Kein Konto mit dieser E-Mail**: Ein neues Konto wird erstellt, verifiziert, falls der Anbieter die E-Mail bestätigt hat.

Schritt 3 ist der sicherheitskritische Fall. Wäre eine unbestätigte E-Mail des Anbieters ausreichend für eine Verknüpfung, könnte jeder, der einen Anbieter dazu bringt, eine fremde Adresse auszugeben, das passende Rebase-Konto übernehmen. Google bestätigt für echte Google-Konten immer `email_verified`, daher ist Schritt 2 der reguläre Weg für den Google-Login; Schritt 3 greift vor allem bei Anbietern, die Benutzern die Angabe beliebiger, unbestätigter Adressen erlauben.

Auch die Kontoseite ist relevant. Nichts verifiziert die Adresse, die an `POST /auth/register` übergeben wird; somit könnte sich jeder mit der Adresse einer anderen Person und einem Passwort registrieren oder sich darüber über einen Anbieter anmelden, der die Adresse nicht garantiert, und abwarten. Wird die Google-Anmeldung des tatsächlichen Eigentümers mit diesem Konto verknüpft, darf der Zugangsweg der anderen Person keinesfalls erhalten bleiben.

Ein Anbieter, der die Adresse verifiziert hat, ein Bestätigungslink, ein Magic-Link, ein E-Mail-Code oder ein Passwort-Reset weisen die Adresse nach und verifizieren das Konto. Bei einem Konto, das noch nicht verifiziert war, entfernt der erste Nachweis dieser Art das Passwort (ein Reset setzt das neue) sowie jede verknüpfte Identität, deren Anbieter diese Adresse nicht verifiziert hat, und beendet alle Sitzungen, bevor das Konto als verifiziert markiert wird: Ein von niemandem verifiziertes Passwort ist nach dem ersten Google-Login somit entfernt.

Ein Verifizierungslink behält das bei, was die Person, die ihm folgt, ebenfalls nachweist: eine aktive Sitzung des Kontos oder dessen Passwort. Siehe [E-Mail-Verifizierung](/docs/backend/email-verification/). Konten, die von einem Administrator über `POST /api/admin/users` angelegt werden, werden direkt als verifiziert gespeichert, sodass ein eingeladener Benutzer „Mit Google anmelden“ sofort nutzen kann. Ein benutzerdefiniertes Auth-Repository ohne `unlinkUserIdentity` weist einen solchen Nachweis mit `409 UNVERIFIED_IDENTITIES` ab, wenn eine Identität zu entfernen wäre.

Dieses Verhalten ist nicht konfigurierbar — es gibt bewusst keine Option, Verknüpfungen anhand unbestätigter E-Mail-Adressen zuzulassen.

### E-Mail-Verifizierung

Bei der Registrierung erhält das neue Konto einen Verifizierungslink; wird diesem gefolgt, bleibt nur erhalten, was die ausführende Person ebenfalls nachweist. `requireEmailVerification` stellt die Registrierung auf Confirm-First um. Siehe [E-Mail-Verifizierung](/docs/backend/email-verification/).

## Automatisch erstellte Tabellen

Beim ersten Start richtet Rebase automatisch das `rebase`-Schema und die folgenden Tabellen in der Datenbank ein (gebunden an das in Ihrer Collection definierte Schema, z. B. `rebase`):

- **`rebase.users`** — Benutzerkonten mit E-Mail, Passwort-Hash, Metadaten und einer Spalte `roles` vom Typ text[] (Rollen werden als Inline-Text-Arrays gespeichert, um Abfragen zu optimieren und Joins zu vermeiden).
- **`rebase.user_identities`** — Die mit jedem Konto verknüpften OAuth-Identitäten, eine Zeile pro Anbieter-Identität.
- **`rebase.refresh_tokens`** — Langlebige Sitzungen mit gehashten Refresh-Tokens, User-Agents und IP-Adressen. Enthält einen eindeutigen Index auf `token_hash`. Ein Login entspricht einer `session_id`, die von jedem daraus rotierten Token geteilt wird; es gibt keine Beschränkung pro Gerät, sodass zwei Browser hinter derselben IP zwei Sitzungen darstellen. Jedes Token einer Sitzung führt zudem sein Sicherheitslevel (`aal`) und die Anmeldemethode (`method`, ausgegeben als `providerId`) mit.
- **`rebase.password_reset_tokens`** — Ablaufende Einmal-Tokens für Abläufe zur Passwortwiederherstellung.
- **`rebase.magic_link_tokens`** — Ablaufende Einmal-Tokens für die Anmeldung per Magic-Link.
- **`rebase.mfa_factors`** — Registrierte Multi-Faktor-Authentifizierungsmethoden (z. B. TOTP-Secrets, verschlüsselt mit AES-256).
- **`rebase.mfa_challenges`** — Verifizierungsprotokolle zur Nachverfolgung aktiver MFA-Verifizierungsversuche.
- **`rebase.recovery_codes`** — Gehashte Multi-Faktor-Backup-/Wiederherstellungscodes.
- **`rebase.app_config`** — Key-Value-Speicher für Systemkonfigurationen.

Tokens mit Ablaufzeit — Reset-Links, Magic-Links, E-Mail-Codes, Refresh-Tokens, MFA-Challenges — werden einmal pro Stunde nach ihrem Ablauf gelöscht. Der Bereinigungsvorgang läuft auf den Prozessen, die die Timer verwalten (alle Rollen außer `functions` in einem Split-Deployment, es sei denn, `REBASE_CRON_SCHEDULER=false` nimmt sie von der `api`), und zwar auf einer Instanz der Flotte: Jede Stunde wird in `rebase.cron_claims` unter der Job-ID `rebase:auth:expired-tokens` reserviert, analog zu einem Cron-Slot. Bei `cronPersistence: false` existiert keine Claims-Tabelle und jede entsprechende Instanz führt die Bereinigung durch. Ein abgelaufenes Token wird bei Vorlage immer abgewiesen, unabhängig davon, ob die Bereinigung bereits stattgefunden hat; der Prozess verhindert lediglich das Anwachsen der Tabellen.

## Bootstrap des ersten Benutzers

Wenn keine Benutzer in der Datenbank existieren und der Server **nicht** mit `NODE_ENV=production` läuft, wird die erste Person, die sich registriert, automatisch zum Administrator. Danach wird die Registrierung über die Einstellung `allowRegistration` gesteuert.

In Produktionsumgebungen ist dieses Fenster geschlossen, da ein Host mit einem öffentlichen Namen erreichbar ist, bevor der Betreiber sich registriert hat, und wer zuerst zugreift, die Kontrolle übernähme. Ein produktives Deployment benennt seinen ersten Administrator stattdessen über Umgebungsvariablen — `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD`, die beim Start erstellt werden, solange die Tabelle leer ist — oder weist die Rolle über den Service-Key zu. Bei geschlossenem Fenster weist eine leere Tabelle die Bootstrap-Registrierung mit `SETUP_REQUIRED` ab (und meldet dies entsprechend), ein erstes über eine offene Registrierung angelegtes Konto ist ein gewöhnliches Benutzerkonto, `GET /api/auth/config` meldet niemals `needsSetup`, `POST /api/admin/bootstrap` schlägt fehl und das Startprotokoll warnt, wenn die Tabelle leer ist und kein Administrator festgelegt wurde.

Auf einem Entwicklungsrechner können Sie eine frische Datenbank somit jederzeit ohne manuelles Seeding initialisieren. Um konkurrierende Ausführungen und Race Conditions bei der Schema-Generierung bei Hot-Reloading (HMR) oder beim Start zu verhindern, werden Bootstrapping-Vorgänge über einen Postgres Advisory Lock synchronisiert:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Auth-Konfiguration auf Collection-Ebene

Anstatt sich ausschließlich auf die standardmäßigen Auth-Regeln der Datenbank zu verlassen, können Sie jede Postgres-Collection (wie `users.ts` oder eine eigene Collection `members.ts`) als Authentifizierungs-Collection definieren. Dies wird über die Eigenschaft `auth` an der Collection selbst konfiguriert:

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
    },

    // What each role may do beyond its rows, the app's own scopes,
    // and whether accounts may create personal API keys
    roles: {
      support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] }
    },
    scopes: {
      "project:deploy": { label: "Deploy projects", target: "project" }
    },
    personalKeys: true
  },
  properties: { ... }
});
```

`roles`, `scopes` und `personalKeys` deklarieren das Zugriffsmodell: welche Scopes der Administrationsebene die jeweilige Rolle besitzt, welche Scopes die Anwendung für ihre eigenen Operationen definiert und ob Konten [persönliche API-Schlüssel](/docs/backend/api-keys/#personal-keys) erstellen dürfen. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/).

Ein von `onResetPassword` zurückgegebenes `temporaryPassword` wird zum neuen Passwort des Kontos. Rebase hasht es mit dem konfigurierten Algorithmus, speichert es, meldet den Benutzer aus allen bestehenden Sitzungen ab und zeigt es dem Administrator zur Weitergabe an. Der Hook speichert es nicht und hat dazu keine Möglichkeit. Geben Sie kein `temporaryPassword` zurück, wenn der Hook stattdessen einen eigenen Reset-Link per E-Mail versendet: Das Passwort bleibt dann unverändert, bis der Benutzer selbst ein neues festlegt, wenngleich bestehende Sitzungen dennoch beendet werden.

Wenn benutzerdefinierte Hooks (`onCreateUser`, `onResetPassword`) aufgerufen werden, erhalten sie eine `AuthCollectionContext`-Fassade mit folgenden Methoden und Eigenschaften:
- `hashPassword(password: string): Promise<string>` — Hasht das Passwort mit dem konfigurierten Hashing-Algorithmus (z. B. scrypt).
- `sendEmail?: (options) => Promise<EmailSendResult>` — Versendet eine E-Mail (nur verfügbar, wenn der E-Mail-Dienst konfiguriert ist). Löst mit den Rückmeldungen des Anbieters auf — `messageId`, `accepted`, `rejected` —, sodass ein Hook die ID speichern und spätere Antworten zuordnen kann.
- `emailConfigured: boolean` — Gibt an, ob der E-Mail-Dienst konfiguriert ist.
- `appName: string` — Der Anwendungsname aus der E-Mail-Konfiguration.
- `resetPasswordUrl: string` — Die Basis-URL für Links zum Zurücksetzen von Passwörtern.

## Nächste Schritte

- **[Endpoints and tokens](/docs/backend/auth-endpoints/)** — alle Routen, die durch diese Konfiguration bereitgestellt werden
- **[Roles and scopes](/docs/backend/roles-and-scopes/)** — Berechtigungen der Rollen und Einschränkungen durch Keys und Tokens
- **[Custom auth adapters](/docs/backend/auth-adapters/)** — Anbindung eigener Identitätsanbieter
- **[Frontend Authentication](/docs/frontend/authentication/)** — Login-UI, Auth-Controller, Benutzerverwaltung
- **[Security Rules (RLS)](/docs/collections/security-rules/)** — Zugriffskontrolle auf Zeilenebene (Row-Level Security)
- **[Typed SDK Authentication](/docs/sdk/authentication/)** — Auth-Methoden im typisierten SDK

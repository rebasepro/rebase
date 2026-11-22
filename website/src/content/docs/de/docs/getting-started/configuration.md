---
sourceHash: df5e0441849e5e57
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projektstammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> ein erforderlicher Wert fehlt oder fehlerhaft formatiert ist (eine URL, die keine URL ist, ein Port, der
> keine Zahl ist), verweigert der Server den Start und benennt die Variable.
>
> Wo das Schema liegt, hängt davon ab, wie Sie das Backend ausführen. Ein von
> der Runtime gestartetes Projekt – `rebase dev`, `rebase start`, das veröffentlichte Image – verwendet das
> Schema der Runtime (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, das [`rebase eject`](/docs/cli)
> ausgeführt hat, besitzt eine eigene `backend/src/env.ts`, die `loadEnv({ extend })` aufruft, und kann dort
> eigene typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **In der Entwicklung optional** – wenn nicht gesetzt, führt `rebase dev` ein verwaltetes PostgreSQL für das Projekt aus, dessen Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktion erforderlich** (in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **Bei einer verwalteten Datenbank bedeutet `sslmode=require` möglicherweise nicht das, was es vermuten lässt.**
>
> Für `psql` und jedes libpq-Tool bedeutet `require` „verschlüsselt, Zertifikat nicht
> geprüft“. Der Node-Treiber, auf dem Rebase läuft, interpretiert dies als `verify-full`. Eine
> Datenbank, deren Zertifikat nicht von einer öffentlichen Zertifizierungsstelle signiert wurde – was bei verwaltetem
> Postgres üblich ist –, weist die Runtime mit `self-signed certificate` ab, während `psql`
> sich mit derselben URL problemlos verbindet. Die Runtime und `rebase db`-Befehle brechen mit einer
> entsprechenden Meldung ab.
>
> Wählen Sie eine der folgenden Optionen:
>
> - **`sslmode=no-verify`** – verschlüsselt, nicht geprüft: das, was `require` für
>   libpq bedeutet. Dies ist eine node-postgres-Schreibweise, die libpq nicht kennt, weshalb `psql`, `pg_dump`
>   und Atlas dies mit `invalid sslmode value: "no-verify"` ablehnen. Die Rebase-eigenen
>   Befehle (`rebase db push`, `rebase db backup`, `rebase db restore`) übergeben es
>   an diese Tools als `sslmode=require`, sodass sie mit der konfigurierten URL funktionieren; für
>   manuelles `psql` tauschen Sie es gegen `sslmode=require` aus.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** – Prüfung gegen das
>   CA-Zertifikat des Anbieters. Verhält sich für jedes Tool gleich.
>
> `uselibpqcompat=true&sslmode=require`, was die Warnung des Node-Treibers
> vorschlägt, funktioniert auch für die Runtime; die Befehle von Rebase entfernen `uselibpqcompat`,
> bevor sie die URL an libpq-Tools übergeben, die sie sonst ablehnen würden.

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** – siehe unten. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, daher injiziert der
> Dev-Server diese Variable. In der Produktion liefert das Rebase-Backend die SPA aus, sodass die
> API der eigene Origin der Seite ist und der Client dies von selbst auflöst.
>
> Das feste Einbinden einer absoluten URL in ein Produktions-Bundle funktioniert genau so lange, bis ein zweiter
> Hostname auf dieselbe Anwendung verweist: Eine benutzerdefinierte Domain lädt die Seite dann von
> `example.com` und ruft die API unter `example.rebase.website` auf. Das ist
> cross-origin, wodurch jeder Preflight-Request fehlschlägt. Das Erlauben des Origins in CORS
> löst das Problem **nicht** – das Refresh-Cookie ist `SameSite=Lax` und wird
> cross-site nicht übertragen. Sie würden also die Konsolenfehler beheben, hätten aber weiterhin eine defekte
> Authentifizierung. Wenn die Variable ungesetzt bleibt, funktioniert jede Domain, die auf die App verweist, ganz ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` ausgelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort ignoriert, da der Port aufgelöst wird, bevor diese Datei geladen wird – und bindet andernfalls einen Port, der vom Projektpfad abgeleitet wird, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner gibt die genutzte Prioritätsstufe an. | `3001` |
| `LOG_LEVEL` | Ausführlichkeit der Protokollierung: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer `Failed query: [redacted]`-Zeile an. Jedes fehlschlagende Statement wird standardmäßig geschwärzt, da eine fehlgeschlagene Abfrage gebundene Parameter enthält – eine E-Mail, einen Passwort-Hash. Setzen Sie dies auf `true`, während Sie DDL-, RLS- oder Change-Capture-Fehler diagnostizieren. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste erlaubter Origins. **In Produktion erforderlich**, es sei denn, `FRONTEND_URL` ist gesetzt: Ein Produktionsstart ohne beides bricht ab. In der Entwicklung wird sie zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu CORS_ORIGINS verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (für Schema-Introspektion und Admin-Operationen). Die dort benannte Datenbank ist weder diejenige, die die SQL-Konsole als aktuell ansieht, noch das, was ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der die Verbindung der Anwendung liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert den PostgreSQL-Rollenwechsel im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Studios SQL-Konsole meldet dann, dass die Zeilen als Verbindungseigentümer gelesen wurden, nennt diesen und graut die Rollenauswahl aus. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies bei einem Checkout, der [auf einen Branch gewechselt](/docs/backend/branching/#cli-integration) ist. Ein Server mit dieser Variable behält die Branch-Registry auf dieser Datenbank und kopiert neue Branches standardmäßig davon, sodass Studios Branches-Ansicht die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

In der Entwicklung ist **localhost sowie alles erlaubt, was in `CORS_ORIGINS` (oder `FRONTEND_URL`) angegeben ist** – dieselbe Liste, die die Produktion verwendet, wobei localhost hinzugefügt und nicht ersetzt wird. Die Variable funktioniert in beiden Umgebungen auf dieselbe Weise, und die Fälle, in denen sie in der Entwicklung benötigt wird, sind die üblichen:

```bash
# Ein Telefon im LAN, der Rechner eines Kollegen, ein ngrok-Tunnel,
# ein weitergeleiteter Codespaces-Port – alles Nicht-Localhost-Origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Ein Origin, der weder localhost noch aufgeführt ist, wird abgewiesen, und die Verweigerung wird **einmal pro Origin** mit der genauen Zeile protokolliert, die ihn erlauben würde. Das Verweigern ist keine reine Vorsichtsmaßnahme: Die API sendet Anmeldedaten. Die einfache Übernahme eines beliebigen `Origin` würde es jeder Website, die der Entwickler zufällig besucht, ermöglichen, authentifizierte Anfragen mit dessen Sitzung an den Dev-Server zu senden und die Antworten auszulesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Geheimnis für die JWT-Signierung (in Produktion erforderlich, in der Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Access-Tokens (RS256), sodass jede Entität, die das JWKS hält, eine Sitzung verifizieren kann, ohne selbst Tokens erstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEMs. Ohne diesen Schlüssel bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt den `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie dies bei jedem Schlüsselwechsel – eine Rotation erfordert die Unterscheidbarkeit von alt und neu. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access-Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens. Gleitend – jede Rotation verlängert ihn, sodass dies steuert, wie lange eine Sitzung bei **Inaktivität** überlebt. Setzen Sie `400d` für Sitzungen, die lange Abwesenheiten überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Registrierung neuer Benutzer erlauben (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden einlassen, und dieser wird der Administrator. In Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein erster über eine offene Registrierung erstellter Account ist ein gewöhnlicher Benutzer und der Administrator wird über `REBASE_ADMIN_EMAIL` unten festgelegt oder mit dem Service-Key zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standard des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Notausschalter. Schließt das Bootstrap-Fenster für den ersten Benutzer, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank geschlossen ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, da das Deployment sonst keine Möglichkeit hat, seinen ersten angemeldeten Benutzer zu erstellen. Jedes ausgelieferte Deployment-Artefakt setzt diesen Wert. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Admin-Kontos, das beim Booten erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. So erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt der Erste im Internet sein zu müssen. Der Bootvorgang warnt, wenn die Tabelle in Produktion leer und diese Variable nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Geheimnis. Wenn ungesetzt, werden die Geheimnisse stattdessen mit `JWT_SECRET` verschlüsselt und beim Start wird einmal gewarnt – eine Rotation von `JWT_SECRET` meldet somit alle ab *und* macht jeden registrierten Authentifikator unlesbar. Setzen Sie einen dedizierten Schlüssel (32+ Zufallszeichen), bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *weggewechselt* wird. Setzen Sie während einer Rotation beide: Neue Geheimnisse werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende bleiben lesbar, sodass niemand während der Rotation aus seinem Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Geheimnis neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht an `ALLOW_REGISTRATION` gekoppelt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API erzwingen. Setzen Sie dies auf `false` für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Stellt `POST /api/auth/find-user` bereit, das eine E-Mail-Adresse in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für Einladungsabläufe auflöst. Nur für authentifizierte Aufrufer, und es gibt niemals E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: Es stellt eine Angriffsfläche für Aufzählung (Enumeration) dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite`-Attribut für das Refresh-Cookie: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure`-Attribut für das Refresh-Cookie. Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für reines HTTP – etwa ein Deployment auf einer LAN-Adresse, wo der Browser das Cookie sonst verwerfen und die Sitzung nach Ablauf des Access-Tokens ohne Fehlermeldung enden würde. Warnt beim Start. `http://localhost` benötigt dies nicht. | `true` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client-ID (Backend-Validierung) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client-Secret | — |
| `GITHUB_CLIENT_ID` | GitHub OAuth Client-ID | — |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth Client-Secret | — |
| `MICROSOFT_CLIENT_ID` | Microsoft OAuth Client-ID | — |
| `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth Client-Secret | — |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth Client-ID | — |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth Client-Secret | — |
| `FACEBOOK_CLIENT_ID` | Facebook OAuth Client-ID | — |
| `FACEBOOK_CLIENT_SECRET` | Facebook OAuth Client-Secret | — |
| `TWITTER_CLIENT_ID` | X/Twitter OAuth Client-ID | — |
| `TWITTER_CLIENT_SECRET` | X/Twitter OAuth Client-Secret | — |
| `DISCORD_CLIENT_ID` | Discord OAuth Client-ID | — |
| `DISCORD_CLIENT_SECRET` | Discord OAuth Client-Secret | — |
| `GITLAB_CLIENT_ID` | GitLab OAuth Client-ID. Die `baseUrl` einer selbst gehosteten Instanz hat keine Umgebungsvariable – konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab OAuth Client-Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket OAuth Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket OAuth Client-Secret | — |
| `SLACK_CLIENT_ID` | Slack OAuth Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack OAuth Client-Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth Client-Secret | — |
| `APPLE_CLIENT_ID` | Apple Services ID für Web-Logins. Sie ist öffentlich und wird in `GET /auth/config` veröffentlicht. Apple verwendet kein statisches Client-Secret, da Rebase für jeden Token-Austausch ein kurzlebiges ES256-JWT signiert. Apple erfordert daher `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` sowie diesen Wert oder `APPLE_BUNDLE_IDS`, und konfiguriert andernfalls nichts. | — |
| `APPLE_BUNDLE_IDS` | Kommagetrennte Bundle-IDs der nativen iOS/macOS-Apps, deren Codes für „Mit Apple anmelden“ akzeptiert werden. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, der Aussteller (Issuer) des JWT. | — |
| `APPLE_KEY_ID` | Key-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten `.p8`-Schlüsseldatei inklusive Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Öffentlicher Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deploy; er enthält keine Geheimnisse. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` ermöglicht er es dem Admin-Gate, ein Plattform-Token für `cron:read` und für nichts anderes zu akzeptieren. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, mit der das `aud` eines Plattform-Tokens übereinstimmen muss, damit ein für ein anderes Projekt erstelltes Token abgewiesen wird. Ist nur eine der beiden Variablen gesetzt, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Ziel des Buttons **Continue with Rebase Cloud** im Admin-Panel: die Seite des Projekts in der Konsole der Plattform, die die Eigentümer des Projekts anmeldet und zurückkehrt. Die Plattform setzt dies beim Deploy zusammen mit den beiden obigen Variablen; damit akzeptiert `POST /api/auth/platform-signin` das einminütige `auth:admin-signin`-Token der Plattform und öffnet eine Admin-Sitzung. Ohne diese Variable funktioniert der Zugang weiterhin über **Open CMS** in der Konsole, und der Login-Bildschirm erklärt dies lediglich. | — |
| `REBASE_RATE_LIMIT_STORE` | Speicherort für Rate-Limit-Zähler für Auth-Routen und für `rateLimit` in benutzerdefinierten Funktionen: `memory` (prozessbezogen) oder `sql` (über Replikate geteilt). Ein Prozess kann seine eigene Replikat-Anzahl nicht erkennen, daher muss ein Deployment mit mehreren Instanzen dies angeben – drei Replikate mit der Standardeinstellung erzwingen das Dreifache des Limits. Jeder andere Wert **verhindert den Start**, anstatt ein Fallback zu nutzen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Aktiviert den passwortlosen Magic-Link-Anmeldeablauf. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Aktiviert die passwortlose Anmeldung mit einem sechsstelligen, per E-Mail gesendeten Code. Gleiche E-Mail-Voraussetzung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Magic-Link- oder E-Mail-Code-Anfrage für eine unbekannte Adresse erstellt das Konto, sofern die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh-Token nach Ablauf seines Wiederverwendungsfensters erneut eingereicht wird: `reject` (ablehnen, Sitzung beibehalten) oder `revoke-session` (Sitzung beenden). Jeder andere Wert führt zu einem Startabbruch. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrierung mit vorheriger Bestätigung: Keine Passwortanmeldung, bevor die Adresse verifiziert ist. Erfordert E-Mail; der Start bricht ohne ab. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert die Captcha-Verifizierung auf den Auth-Routen: `turnstile` oder `hcaptcha`. Ungesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig zur Überprüfung des vom Browser gesendeten Tokens verwendet wird. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Auth-Routen (z. B. `register,login`). Ungesetzt schützt das Standard-Set des Anbieters. | — |

### Speicher (Storage)

<span class="since-badge" data-since="0.35">Seit 0.35</span>

:::caution[Storage verfügt über keine Row-Level Security, daher wird ein Zugriffsmodell benötigt]
Tabellen werden durch Postgres-RLS geschützt. Objektspeicher hat kein Äquivalent –
Schlüssel teilen sich einen flachen Namensraum. Bei einem konfigurierten Bucket ohne Zugriffsmodell
**verweigert der Server in der Produktion den Start**. Erfüllen Sie dies mit genau einer der folgenden Optionen:
einem `storageAuthorize`-Hook, der aus `backend/storage.ts` exportiert wird (Standard im Scaffold),
`STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Speicher-Backend: `local`, `s3`, `gcs` oder `platform` (Dateien in einem Präfix der Hosting-Plattform, übertragen über URLs, die ihr Storage-Broker signiert; von der Plattform gesetzt). In Produktion deaktiviert `local` den Speicher, es sei denn, `FORCE_LOCAL_STORAGE=true`. | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird relativ zu dem Verzeichnis aufgelöst, in dem der Server läuft: das Projekt-Root unter `rebase dev`, `backend/` in einem von `rebase eject` erstellten Server. | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Erlaubt lokalen Speicher in Produktion – nur mit einem persistenten Volume für `STORAGE_PATH` und den daneben liegenden `<STORAGE_PATH>__<key>`-Verzeichnissen benannter lokaler Buckets zulässig. | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Sekunden, die die Download-URL einer privaten Datei gültig ist – das Token, das `getSignedUrl()` darin einbettet. Maximal `604800` (eine Woche). | `300` |
| `STORAGE_MAX_FILE_SIZE` | Größte Datei, die die Quelle akzeptiert, in Bytes, auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Ein Wert, der keine ganze Zahl an Bytes ist, verhindert den Start. | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS-Access-Key | — |
| `S3_SECRET_ACCESS_KEY` | AWS-Secret-Key | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 etc.) | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für S3-Bucket erzwingen (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für einen Bucket gedacht, der tatsächlich ein öffentliches CDN ist. Eine der Möglichkeiten, die obige Startprüfung zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jeder angemeldete Benutzer darf jedes Objekt lesen, schreiben, auflisten und löschen. Im Konfigurationsobjekt aus gutem Grund `INSECURE` genannt: Es ist nur in einer Single-Tenant-App vertretbar, in der jedem Konto jede Datei anvertraut wird. | `false` |
| `STORAGE_POLICIES` | Speicherzugriffsregeln als JSON: `[{ "path", "operations"?, "allow" }]`, wobei `allow` den Wert `"public"`, `"authenticated"`, `"owner"` oder `{ "roles": [...] }` hat. Standardmäßig abweisen; erfüllt die Startprüfung. Eine ungültige Liste verhindert den Start. Siehe [Speicher-Autorisierung](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | Der Storage-Broker der Plattform für `STORAGE_TYPE=platform`. Wird von der Plattform gesetzt, die den Broker betreibt. | — |
| `STORAGE_BROKER_PROJECT` | Die Projekt-ID, auf die der Broker die Dateien dieses Deployments beschränkt, für `STORAGE_TYPE=platform`. Wird von der Plattform gesetzt. | — |
| `STORAGE_RENDITION_CACHE` | Generierte Bildvarianten (Skalierungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu berechnen. | `false` |

### E-Mail (Optional)
`MAGIC_LINK_URL`.

| Variable | Beschreibung |
|----------|-------------|
| `SMTP_HOST` | Host des SMTP-Servers |
| `SMTP_PORT` | Port des SMTP-Servers |
| `SMTP_SECURE` | Sichere Verbindung aktivieren (`true`/`false`) |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | Absenderadresse für System-E-Mails |
| `SMTP_NAME` | Anzeigename für die Absenderadresse |
| `APP_NAME` | Produktname, der in E-Mail-Betreffzeilen und -Texten verwendet wird (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo am Anfang der Standard-E-Mail-Vorlagen. Absolute `http(s)`-PNG- oder -JPG-URL – E-Mail-Clients entfernen SVG und blockieren `data:`-URIs. Ungesetzt erhält eine App mit dem Namen `Rebase` das Rebase-Logo und eine umbenannte App keines. |
| `MAGIC_LINK_URL` | Wohin ein per E-Mail gesendeter Magic Link führt. An eine Basis-URL wird `/auth/magic-link?token=…` angehängt; eine URL, die `{token}` enthält, stellt den vollständigen Link dar (für ein Frontend, das `/auth/magic-link` nicht bedient). Setzen Sie sie in `.env` in Anführungszeichen, da ein nicht maskiertes `#` einen Kommentar einleitet: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Bei einem Wert mit Raute (`#`) oder Dateipfad ohne `{token}` wird beim Start gewarnt. Wenn nicht gesetzt, dient `FRONTEND_URL` als Basis. |

### Datenbank-Verbindungspool (Connection Pool)

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximale Anzahl an gepoolten Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung gehalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt diese: `LISTEN`/`NOTIFY` übersteht keinen Transaktions-Pooler wie PgBouncer; ohne diese Verbindung werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, anstatt unbemerkt verloren zu gehen. Auch der [Job-Worker](/docs/backend/jobs) hält sein Wake-up-`LISTEN` darüber. Füllt `directConnectionString` des Postgres-Adapters, wenn dies nicht gesetzt ist. | — |
| `DATABASE_READ_URL` | Read Replica, z. B. ein Hot Standby. Wenn hier ein anderer Server angegeben ist, werden authentifizierte Lesezugriffe (Listen, Einzelzeilen, Zählungen, Aggregate) dort unter derselben Row-Level Security ausgeführt; Schreibvorgänge, Anmeldungen, Realtime, Crons, Jobs, die SQL-Konsole und `rebase.sql` verbleiben auf der primären Instanz. Ein lesender Benutzer, der gerade geschrieben hat, liest für die Dauer von `REBASE_READ_STICKY_MS` von der primären Instanz; dasselbe gilt für alle, wenn das Replikat um mehr als `REBASE_READ_MAX_LAG_MS` hinterherhinkt oder fehlschlägt. Füllt `readConnectionString` des Postgres-Adapters, wenn dieser ungesetzt ist; bis einschließlich Version 0.28 wurde der Pool des Replikats zwar geöffnet, aber nie ausgelesen. | — |
| `REBASE_READ_STICKY_MS` | Zeitspanne nach einem Schreibvorgang, für die Leseanfragen desselben Benutzers an die primäre Datenbank geleitet werden, damit ein Speichervorgang, gefolgt von einer Listenabfrage, die Änderung direkt anzeigt. Pro Serverinstanz. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Replikat-Verzögerung (Lag), ab der alle Lesezugriffe an die primäre Datenbank gehen. | `1000` |
| `DATABASE_POOLED` | `true`, wenn `DATABASE_URL` über einen Transaktionsmodus-Pooler wie PgBouncer läuft. Der Pool sendet dann beim Verbindungsaufbau weder `search_path` noch `statement_timeout` (der Pooler würde diese ablehnen oder verwerfen) und setzt beides in jeder Transaktion; der Startvorgang weist der Datenbankrolle einen standardmäßigen `search_path` von `public` für Anweisungen außerhalb einer Transaktion zu. `DATABASE_DIRECT_URL` wird dadurch erforderlich; Realtime, das Aufwecken des Job-Workers, Index-Erstellungen, Branching und die SQL-Konsole nutzen diese direkte Verbindung. Die URL des Replikats wird ebenfalls als gepoolt angenommen. `DATABASE_POOLED__<KEY>` für eine weitere Datenquelle. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig von individuellen Anforderungen. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server stillschweigend zu serialisieren. | — |

### Laufzeitverhalten (Runtime behaviour)

Wird von der Runtime ausgelesen – `rebase dev`, `rebase start` und dem offiziellen Server-Image. Ein Projekt, das „ejected“ wurde, verwaltet diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) durch, das Tabellen meldet, die ohne Richtlinien ausgeliefert werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime enthält keine Kopie; ohne das Paket verweigert der Start unter Nennung des Pakets den Dienst. `false` hält den Scan auf diesem Prozess deaktiviert. | — |
| `REBASE_RLS_REQUEST_ROLE` | Die Postgres-Rolle, unter der angemeldete und anonyme Anfragen ausgeführt werden. Weisen Sie jedem Projekt auf einem geteilten Cluster eine eigene zu. Eine Datenbank speichert die Rolle, unter der sie läuft; ein für eine andere Rolle konfigurierter Start bricht ab, bis `rebase db request-role migrate` sie migriert. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` erstellt die Request-Rolle und erlaubt der Verbindung, zu dieser zu wechseln; `never` überlässt beides Ihnen und prüft die Konfiguration lediglich. | `auto` |
| `REBASE_RLS_GRANTS` | Berechtigungen, die Rebase der Request-Rolle erteilt: `schema` (jede Tabelle in den bereitgestellten Schemas plus Standardprivilegien), `managed` (nur die bereitgestellten Tabellen) oder `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` schränkt die permissiven Richtlinien von Rebase auf die Request-Rolle(n) ein, sodass andere Rollen, die dieselben Tabellen lesen, keine Rechte daraus erhalten. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` erstellt Richtlinien, die nur der Server-Kontext oder ein Admin erfüllen kann, `TO public` und führt Admins als Request-Rolle aus. Standardmäßig lauten sie `TO rebase_admin`, sodass eigentümergefilterte Lesezugriffe angemeldeter Benutzer den Eigentümerindex verwenden können. Siehe [Admin-Anfragen und `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` entfernt die Baseline-Richtlinie für Server/Admin von jeder Tabelle. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` setzt zusätzlich `request.jwt.claims` und `request.jwt.claim.*`, sodass mit `auth.uid()` geschriebene Richtlinien den Aufrufer erkennen. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Verhalten beim Start, wenn ein anderes Login in die Request-Rolle wechseln kann: `warn`, `refuse` oder `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Der Client muss entsprechend konfiguriert werden – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische Assets und Admin-Assets des Bundles über diesen Prozess ausliefern. Deaktivieren, wenn ein CDN vorgeschaltet ist. | `true` |
| `REBASE_STUDIO` | Die integrierte, eigenständige Rebase Studio-Konsole unter `/_studio` bereitstellen, wenn ein statisches Studio-Bundle verfügbar ist. Auf `false` setzen zum Deaktivieren. | `true` |
| `REBASE_STUDIO_DIR` | Verzeichnis mit der vorgefertigten Standalone-Rebase-Studio-SPA, die unter `/_studio` ausgeliefert wird. Standardmäßig `/studio` im Container-Image. | `/studio` |
| `REBASE_HISTORY` | [Entitäts-Änderungshistorie](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli-Kompression für Antworten aktivieren. | `true` |
| `REBASE_PUSH` | `true` aktiviert [Push-Benachrichtigungen](/docs/backend/push-notifications/): die `/api/push`-Routen, die Tabelle `rebase.push_subscriptions` und `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Das VAPID-Schlüsselpaar, mit dem Push-Nachrichten signiert werden. Außerhalb der Produktion wird bei Fehlen ein Paar generiert und in `.rebase-dev-secrets.json` gespeichert; in der Produktion bleibt Push ohne diese Schlüssel deaktiviert. | — |
| `REBASE_VAPID_SUBJECT` | Eine `mailto:`-Adresse oder `https://`-URL, über die Push-Dienste Kontakt aufnehmen können. Standardmäßig der Origin einer `https`-basierten `REBASE_PUBLIC_URL`. | — |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verhindert den Start, anstatt das Limit stillschweigend aufzuheben). `0` schaltet das Limit aus. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände möglich. Wenn ungesetzt (in jeder Umgebung): `/api/docs` wird den Aufrufern bereitgestellt, für die `GET /api/schema/tables` Tabellen beschreibt, jeweils mit dem Dokument für ihre Tabellen, und es gibt keine Swagger-UI. `true` veröffentlicht das gesamte Dokument für jeden, mit der Swagger-**UI** unter `/api/swagger` außerhalb der Produktion (niemals in Produktion). `false` belässt das Dokument hinter der Admin-Schranke. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt `includeSubDomains` zum `Strict-Transport-Security`-Header hinzu, sodass Browser reines HTTP auf jeder Subdomain des Hosts für sechs Monate verweigern – einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn wirklich jede Subdomain der Domain ausschließlich HTTPS nutzt. Jeder Wert außer `true`/`false` verhindert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn ungesetzt, ist der Endpunkt für jeden offen, der den Port erreichen kann – in einem privaten Netzwerk in Ordnung, in einem öffentlichen nicht (die Startprotokolle weisen darauf hin). | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Booten am Schema der Tabellen ändern darf. `ensure` (Standard, überall – einschließlich Produktion) führt den **additiven** Durchlauf aus: Fehlende Tabellen, Spalten und Enum-Typen erstellen, niemals etwas löschen oder umschreiben. `none` lässt das Schema der deklarierten Tabellen unberührt, aber die Tabellen des Frameworks selbst (Auth, API-Keys, Jobs, Cron) werden weiterhin erstellt und aktuell gehalten; `REBASE_PROVISION=false` schaltet auch diese ab. Das veröffentlichte Image akzeptiert nur diese beiden Werte und **verweigert den Start bei `push`**. In einem [Split-Deployment](/docs/deployment/split-processes) darf genau ein Prozess provisionieren; alle anderen Rollen müssen `none` setzen, sonst schlägt der Start fehl. | `ensure` |
| `REBASE_PROVISION` | `false` bewirkt, dass die Runtime nichts an der Datenbank ändert: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Richtlinie, Rolle oder Berechtigung, weder beim Booten noch später (einschließlich der framework-eigenen). Fehlende Elemente werden stattdessen namentlich gemeldet. Gedacht für Datenbanken, die nur über Ihren eigenen Änderungsprozess modifiziert werden dürfen. Siehe [Wenn nur Ihr Änderungsprozess die Datenbank ändern darf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Es werden nur `true` und `false` akzeptiert. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Start verweigern, wenn die Datenbank zuletzt mit einer anderen Tabellendefinition provisioniert wurde als die, mit der dieser Prozess gebaut wurde. Wenn ungesetzt (oder ein anderer Wert als `true`/`1`), wird stattdessen nur gewarnt. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Start verweigern, wenn eine Funktions- oder Cron-Datei beim Importieren einen Fehler wirft oder nicht geparst werden kann (unter Nennung jeder Datei und des Grundes), sodass ein Rolling-Deployment die alte Version weiterlaufen lässt. Gilt auch bei einem Neustart. Wenn ungesetzt (oder ein anderer Wert als `true`), wird die fehlerhafte Datei übersprungen und der Rest bereitgestellt. Eine Datei, die fehlerfrei importiert wird, aber keine Funktion oder keinen Job exportiert, wird immer übersprungen und führt nie zum Startabbruch. | skip |
| `REALTIME_CDC` | Change-Capture auf Datenbankebene: `auto` (Änderungen aus dem WAL lesen, wo die Datenbank es erlaubt, sonst Trigger verwenden, andernfalls Fallback auf Anwendungsebene, wobei jedes Fallback als Info geloggt wird), `trigger` (Trigger erzwingen, warnen falls unmöglich), `wal` (Änderungen aus dem Write-Ahead-Log statt über Trigger lesen; erfordert `wal_level=logical` und eine Rolle mit Replikationsrechten, fällt sonst auf `trigger` zurück), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Channels und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein expliziter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Abonnements ein Realtime-Socket halten darf; das nächste wird mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl – jeder andere Wert bricht den Serverstart ab. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Wie viele Realtime-Sockets ein Benutzer oder ein API-Schlüssel auf einer Serverinstanz offenhalten darf. Sockets eines Administrators im Impersonation-Modus zählen für den Administrator. Der Anmeldeversuch eines weiteren Sockets wird mit `TOO_MANY_SOCKETS` abgelehnt und der Socket geschlossen (4002); das SDK versucht es weiter, sodass er verbunden wird, sobald ein anderer schließt. Eine positive ganze Zahl – jeder andere Wert bricht den Serverstart ab. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Kein Limit |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Maximale Wartezeit in ms, die eine Änderung auf den Refetch wartet, der sie an aktive Abonnenten ausliefert. Ein Refetch wartet 300 ms, wenn keine Änderung eintritt, und maximal diesen Wert bei einem kontinuierlichen Strom von Schreibvorgängen. Eine positive ganze Zahl – jeder andere Wert bricht den Serverstart ab. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Zeit in ms, für die die Gesamtzahl eines großen Listenabonnements wiederverwendet werden darf, bevor sie neu gezählt wird; Frames, die diesen Wert wiederverwenden, enthalten `meta.totalAsOf`. Wenn ungesetzt, zählt jeder Frame neu. Hat Vorrang vor `realtime.recountIntervalMs`. | Ungesetzt |
| `REALTIME_RECOUNT_MIN_ROWS` | Mindestanzahl des letzten Gesamtergebnisses, ab der `REALTIME_RECOUNT_INTERVAL_MS` angewendet wird; kleinere Listen werden in jedem Frame neu gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | `localhost`- und Loopback-Werte unter `NODE_ENV=production` zulassen. Standardmäßig deaktiviert, damit ein Produktionsstart deutlich fehlschlägt, anstatt zu versuchen, sich mit einer nicht vorhandenen Datenbank zu verbinden. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schema-Durchlauf aus und beendet den Prozess, ohne einen Socket zu öffnen – genau das Verhalten, das ein Migrations-Job benötigt (aus demselben Image und Bundle wie der darauffolgende Server). Erstellt auch die Tabellen, die ein Serverprozess sonst erst bei der ersten Nutzung anlegen würde, und startet weder Cron noch Job-Queues. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein reguläres Deployment nicht versehentlich in einen reinen Migrationsprozess verwandeln kann. Kann nicht zusammen mit `REBASE_PROVISION=false` verwendet werden. | — |
| `REBASE_PROVISION_SQL_OUT` | Ein Dateipfad. Ein Provisioning-Lauf (`REBASE_PROVISION_ONLY=true`) schreibt jede durchgeführte Schemaänderung der Reihe nach als SQL-Skript in diese Datei, um sie prüfen und mit `psql` anwenden zu können. Geschriebene Datenzeilen sind nicht enthalten. Auf einem Serverprozess nicht zulässig. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt es Maschinen (einem Agenten, einem CI-Job), Schemaänderungen über `/api/admin/schema` tatsächlich *anzuwenden*, statt sie nur zu planen. Standardmäßig aus: Die Anmeldedaten für solche Änderungen sind typischerweise diejenigen, die am ehesten in CI-Variablen hinterlegt sind. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Maximale Ausführungszeit einer benutzerdefinierten Funktion, bevor die Anfrage abgebrochen wird. Entspricht der Option `functionsTimeoutMs`. `0` schaltet das Timeout aus. Eine Funktion, die ein eigenes Timeout deklariert (`defineFunction(…, { timeoutMs })`), verwendet stattdessen dieses. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Das maximale Timeout in ms, das eine Funktion über `defineFunction(…, { timeoutMs })` für sich festlegen darf; fordert sie mehr an, wird dieser Wert erzwungen. Eine positive Zahl; jeder andere Wert wird als ungesetzt interpretiert. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` sorgt dafür, dass eine unbehandelte Promise-Rejection den Prozess beendet, anstatt sie nur zu protokollieren. Empfohlen unter einem Orchestrator, der den Container neu startet; deaktivieren, wenn ein Neustart problematischer ist als ein Speicherleck. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Unterdrückt die Startwarnung auf Plattformen, die von der Runtime als Scale-to-Zero erkannt werden (wo ein Timer, der in einer inaktiven Instanz ausgelöst werden soll, in gar keiner Instanz ausgelöst wird). Ändert sonst nichts: Setzen Sie dies, wenn Sie mindestens eine Instanz dauerhaft am Laufen halten. | — |
| `TRUSTED_PROXY_HOPS` | Anzahl der vorgeschalteten Proxys vor diesem Server, damit der Rate-Limiter die echte Client-Adresse aus `X-Forwarded-For` extrahieren kann. Ausfallsicherer Standardwert `0`: Ohne Proxy würde das Vertrauen in diesen Header jedem Aufrufer das Fälschen seiner Identität ermöglichen. | `0` |

:::note[Boot-Provisioning ist additiv und kein Migrationswerkzeug]
Der Boot-Durchlauf läuft unbeaufsichtigt ab, ohne dass jemand ein Diff prüft;
daher wird er niemals eine Spalte löschen, einen Typ einschränken oder eine Tabelle neu schreiben.
Aus diesem Grund verweigert das Image auch `REBASE_MIGRATE_ON_BOOT=push`: Ein vollständiger
Push berechnet ein Diff und führt ohne Zögern ein `DROP COLUMN` aus – ein
Container-Neustart darf niemals im Zuge einer Neuplanung versehentlich eine
Produktionsspalte zerstören können.

Destruktive oder tiefgreifende Strukturänderungen bleiben dort, wo sie überprüft werden können:
`rebase db generate` + `rebase db migrate`, oder `rebase db push` aus einem Checkout bzw. CI,
das die Änderungen simuliert (Dry-Run), destruktive Änderungen ohne Bestätigung ablehnt und
vorab ein Backup anlegen kann.
:::

### Split-Deployments

Ein einzelnes Image und Bundle kann mehrfach gestartet werden, wobei jede Instanz einen
anderen Teil des Projekts bedient. Da diese Seite den Anspruch erhebt, jede Variable
aufzuführen, ist hier jeweils eine Zeile gelistet. Was jede Kombination *bereitstellt und verwaltet* –
und welche Kombinationen den Start verweigern –, finden Sie unter
**[Split-Prozesse](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Ungesetzt folgt der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Ungesetzt folgt der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | In diesem Prozess nur die namentlich genannten benutzerdefinierten Funktionen bereitstellen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen außer den genannten bereitstellen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess Funktionsanfragen weiterleitet, die er nicht selbst bedient. Auf einem `worker`: wohin seine eigenen `rebase.functions`-Aufrufe gehen. Eine `http(s)`-URL. | — |

### MCP-Schnittstelle

Ein optionaler Model Context Protocol-Endpunkt unter `/mcp`, über den ein KI-Client
dieses Projekt **als der angemeldete Benutzer** lesen und beschreiben kann.
Standardmäßig deaktiviert – und im Gegensatz zu allen anderen Schnittstellen schaltet
kein `REBASE_ROLE` diesen Endpunkt ein: Die Rollen beschreiben eine Prozessstruktur,
während dies eine bewusste Entscheidung ist, Zugangsdaten an Software von Drittanbietern
zu übergeben. Sie sollte von einem Menschen getroffen und nicht von der Berufsbezeichnung
eines Containers geerbt werden.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | MCP-Schnittstelle aktivieren. Erfordert `REBASE_PUBLIC_URL`; ohne diese wird die Schnittstelle nicht bereitgestellt und dies im Startprotokoll vermerkt. | `false` |
| `REBASE_PUBLIC_URL` | Der extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Schnittstelle kann diesen nicht selbst ableiten – würde der Origin aus dem `Host`-Header übernommen, wären die Aussteller-Identität (Issuer) und die Audience, gegen die die Tokens geprüft werden, Werte, die der Aufrufer beliebig manipulieren könnte. | — |
| `REBASE_MCP_VIEW` | Pfad zur projekteigenen MCP-App-Ansicht (`rebase-view.html`, generiert durch `rebaseMcpViewPlugin()`), die Claude anstelle der generischen Ansicht bereitgestellt wird, damit Ihre benutzerdefinierten Ansichten, Felder und Aktionen dargestellt werden. Ohne diese sucht das Backend neben dem Frontend, das es ausliefert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Dynamische OAuth-Client-Registrierung (RFC 7591) erlauben, sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um eine vorherige Registrierung von Clients zu erzwingen. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Standardmäßig deaktiviert, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes Bundle enthält keinen
`backend/schema`-Quellcode zur Bearbeitung. Wenn diese Variablen gesetzt sind, liest
der Schema-Editor den Quellcode aus dem Repository, committet jede Änderung zurück und führt dessen DDL auf
dieser Datenbank aus. Nur für Admins und manuell von einer Person angewendet, es sei denn,
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` bestimmt etwas anderes. Ein angegebenes Repository
ohne gültige Anmeldedaten verhindert den Start. Siehe
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository, in das Schemaänderungen committet werden sollen, im Format `owner/name`. Das Setzen dieser Variable aktiviert das Feature. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, in den der Commit geschrieben wird. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Speicherort von `backend/schema` in diesem Repository, relativ zum Repository-Root. Ein Pfad, der das Repository verlässt, bricht den Start ab; ebenso das veraltete `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein Fine-Grained Token mit Lese- und Schreibzugriff auf die Inhalte des Repositorys. Setzen Sie entweder dieses Token oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub-App, um als App statt über ein Token zu committen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installations-ID der App auf dem Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit maskierten Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Ungesetzt bedeutet, dass geplante Backups deaktiviert sind. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. Erforderlich bei gesetztem `BACKUP_SCHEDULE`, da dieses sonst nicht ausgeführt werden kann. `rebase db backup` greift standardmäßig auf `./backups` an dem Ort zurück, an dem es ausgeführt wurde. | — |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Ungesetzt oder `0` behält alles. | — |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens N der neuesten Backups aufbewahren, ungeachtet der Retention-Regel. | — |
| `PG_DUMP_PATH` | Pfad zur `pg_dump`-Binärdatei überschreiben – Version muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Pfad zur `pg_restore`-Binärdatei überschreiben. | — |
| `PSQL_PATH` | Pfad zur `psql`-Binärdatei überschreiben, die `rebase db restore --clean` ausführt, um das Restore in einer einzigen Transaktion durchzuführen. | — |
| `PG_DUMPALL_PATH` | Pfad zu `pg_dumpall`, wenn es nicht im `PATH` liegt. Ohne diese Datei – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) enthält die PostgreSQL 18 Client-Tools,
sodass ein geplantes Backup darin gegen jeden Server bis Postgres 18 läuft.
Außerhalb des Images müssen Sie diese selbst installieren (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups enthalten Geheimnisse und personenbezogene Daten (PII). Verwenden Sie ein privates Ziel mit
Verschlüsselung im Ruhezustand (Encryption-at-Rest).

### Bundle-Bereitstellung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft beim
Start ein Bundle ab. Diese Variablen steuern, welches Bundle wie geladen wird.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Das, was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Von wo das Bundle-Archiv heruntergeladen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Das Bearer-Token für diesen Abruf. Behandeln Sie es wie ein Geheimnis: Es autorisiert einen Mandanten zum Herunterladen seines eigenen Codes. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Wohin ein heruntergeladenes Bundle entpackt wird. Muss beschreibbar sein und die Zeitspanne zwischen Download und Start überdauern. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image für das Bundle bereitstellt, über die hinaus, die es selbst deklariert. | — |

### Ressourcen-Bindungen (Resource bindings)

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `backend/resources.ts` deklariert,
wird über danach benannte Umgebungsvariablen gebunden. Die Basisnamen stehen unten;
eine Nicht-Standard-Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an, sodass ein Bucket namens
`media` als `S3_BUCKET__MEDIA` gelesen wird. `rebase status` gibt pro Ressource
die exakte Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, wenn es nicht der Standard-Postgres-Treiber ist. Mit Suffix pro Datenquelle versehen: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Mit Suffix pro Topic versehen. | — |

### Die Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hier hat Einfluss auf ein Deployment.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Wohin `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service-Key senden, in der Shell oder in `.env`. Setzen Sie dies, wenn der Server auf andere Weise läuft als über `rebase dev` in diesem Projekt: `rebase start`, ein Container, ein anderer Host. Ungesetzt verwenden sie den von `rebase dev` gespeicherten Server, solange dieser läuft, und senden andernfalls nichts. | — |
| `REBASE_SERVICE_KEY` | Der Service-Key, mit dem sich diese Befehle authentifizieren, gelesen aus `.env`: dieselbe Variable, die auch der Server liest (siehe oben). | — |
| `SERVICE_KEY` | Ein älterer Name für diesen Schlüssel. Wenn er in `.env` gesetzt ist, lesen `rebase api-keys` und `rebase storage` ihn anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env`-Datei die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_ROOT_RULES` | `0` verhindert, dass `rebase init` und `rebase skills install` die Projektregeln in `CLAUDE.md` und `AGENTS.md` im Repository-Root schreiben – gedacht für Roots, deren Agenten-Dateien Sie manuell pflegen. | on |
| `REBASE_CLOUD_URL` | Die Control-Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, unter dem sich `rebase cloud login` anmeldet, anstatt danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Das zugehörige Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in der Shell-History landet. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der Sitzung aus `rebase cloud login` und liest oder schreibt die gespeicherte Sitzung nicht. In einem Verzeichnis, das mit `rebase cloud init --claim` verknüpft wurde, wird es zugunsten des projekteigenen Tokens zurückgestellt, wenn es keinen Scope für das Projekt besitzt. Die empfohlene Methode zur Ausführung von `rebase cloud` in CI – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) übergibt es an die CLI, die seine Cloud-Tools starten, und sendet es nie an die App: Setzen Sie dafür `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt die zugrunde liegenden Fehler- und Anfrage-Details anstelle der kurzen Nachricht aus. Der erste Schritt zur Fehlersuche, wenn ein `rebase cloud`-Befehl fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle der `<db>_dev_diff`, die sie neben `DATABASE_URL` erstellen. Rebase erstellt oder löscht hier angegebene Datenbanken nicht und verweigert eine Datenbank, die mit `DATABASE_URL` identisch ist. Bei der verwalteten Entwicklungsdatenbank setzt die CLI dies auf ein eigenes, temporäres In-Memory-PGlite. Setzen Sie dies dort, wo `CREATE DATABASE` nicht erlaubt ist. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und provisioniert nichts – Sie stellen Ihre eigene bereit. Entspricht `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixiert den Port des Frontend-Dev-Servers, den `rebase dev` andernfalls aus dem Projektpfad ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` auf die Bereitmeldung des Backends wartet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert die Meldung. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einfügt. | — |
| `DO_NOT_TRACK` | Die toolübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe speziell für Rebase. Benötigt keine Datei, weshalb es sich optimal für CI und Container-Images eignet. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Wohin Telemetriedaten gesendet werden (für einen selbst gehosteten Collector). | — |

## Geheimnisse in der Entwicklung

`JWT_SECRET` ist in der Produktion erforderlich. Außerhalb der Produktion werden
es und `REBASE_SERVICE_KEY` automatisch für Sie generiert, sodass Sie direkt ohne
vorherige Konfiguration starten können.

Diese generierten Werte werden in `.rebase-dev-secrets.json` zwischengespeichert, neben
`.rebase-dev-port` und `.rebase-dev-url`, und sind mit diesen zusammen in `.gitignore` eingetragen. Früher
wurden sie bei jedem Start neu generiert – ein Neustart des Dev-Servers meldete Sie somit aus
Ihrer eigenen App ab und entwertete jeden zuvor erstellten API-Schlüssel.

- Wenn Sie eine der beiden Variablen explizit setzen, wird Ihr Wert verwendet; es wird nichts zwischengespeichert oder gelesen.
- Mit `REBASE_DEV_SECRETS_FILE` können Sie den Cache an einen anderen Ort verweisen – ein Pfad, und die
  einzige Variable in diesem Abschnitt, die Sie jemals bewusst konfigurieren würden.
- Löschen Sie die Datei, um beide Geheimnisse neu zu generieren. Beim nächsten Start wird eine neue Datei geschrieben.
- Wenn die Datei nicht geschrieben werden kann – beispielsweise in einem schreibgeschützten Container –, startet der Server
  dennoch mit einem flüchtigen Secret, genau wie früher.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion
wird auch nichts automatisch generiert: Ein Start ohne `JWT_SECRET` schlägt fehl und nennt die Variable;
dieses Verhalten ist unverändert:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Backend-Konfigurationsobjekt

Das an `initializeRebaseBackend()` übergebene `RebaseBackendConfig` bietet programmatische Steuerung:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    schemaDir: "./schema",     // The backend/schema directory: the tables, and what the schema editor writes
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // No bucket configured in production means storage is off, not local:
    // uploads answer 501 rather than landing on a filesystem that is erased
    // on the next redeploy.
    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : env.STORAGE_TYPE === "gcs"
            ? {
                type: "gcs",
                bucket: env.GCS_BUCKET!,
                projectId: env.GCS_PROJECT_ID,
                keyFilename: env.GCS_KEY_FILENAME
            }
            : isProduction && !env.FORCE_LOCAL_STORAGE
                ? undefined
                : {
                    type: "local",
                    basePath: env.STORAGE_PATH || "./uploads"
                },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Publish the whole OpenAPI document at /api/docs to everyone

    logging: {
        level: "info"
    }
});
```

Dieselben Optionen –
ohne `app`, `server` und `basePath` und mit einem erforderlichen `provision` – erstellen ein
Backend, das nichts bereitstellt, bis Sie es mounten: `createRebaseBackend`. Siehe
[Benutzerdefinierte Serverintegration](/docs/backend/custom-server/).

### Ändern von `basePath`

`basePath` verschiebt jede API-Route, daher muss der Client entsprechend konfiguriert werden –
andernfalls fragt er weiterhin `/api/...` an und erhält für alles einen 404-Fehler:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Das Admin-Panel übernimmt dies automatisch vom übergebenen Client; es ist keine weitere
Konfiguration erforderlich. Wenn Sie eine Request-URL manuell zusammenbauen, verknüpfen Sie diese über den Client,
anstatt `/api` manuell zu schreiben:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung (Troubleshooting)

### Keine Berechtigung im SQL-Editor (`permission denied for table <name>`)

* **Symptome:** Benutzerdefinierte Abfragen im SQL-Editor von Rebase Studio schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellenansicht (Spreadsheet) des CMS Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, SQL-Editor-Abfragen durch temporäres Wechseln der Datenbankrollen auszuführen, um sie an die Anwendungsrolle des aktiven Benutzers anzupassen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung nutzen, bei der Rollen nur in Datenbanktabellen statt als echte PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standard-Verbindungsbenutzer ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie Ihrer Backend-`.env`-Konfiguration `DISABLE_DB_ROLE_SWITCHING=true` hinzu. Dies zwingt Rebase dazu, SQL-Editor-Abfragen mit den Rechten des Verbindungseigentümers (in der Regel ein Superuser/Owner) auszuführen. Der SQL-Editor weist dann über den Ergebnissen darauf hin, dass sie als Verbindungseigentümer gelesen wurden, und graut die Rollenauswahl aus.

### Schema-Abruf im SQL-Editor fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden oder der SQL-Editor wirft den Fehler `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Ursache:** Rebase benötigt administrative Berechtigungen, um Datenbank-Systemkataloge abzufragen und administrative Befehle auszuführen. Wenn dem Bootstrapper kein `adminConnectionString` übergeben wird oder `getAdmin()` so überschrieben ist, dass es `undefined` zurückgibt, schlagen diese Operationen fehl.
* **Lösung:** Stellen Sie sicher, dass `adminConnectionString` während der Backend-Bootstrapper-Initialisierung konfiguriert ist:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Nächste Schritte

- **[Deployment](/docs/getting-started/deployment)** — Leitfaden für das Produktions-Deployment
- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration

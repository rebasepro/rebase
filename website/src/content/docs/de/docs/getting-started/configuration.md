---
sourceHash: 21a2078200ddc8c0
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projektstammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> ein erforderlicher Wert fehlt oder fehlerhaft ist (eine URL, die keine URL ist, ein Port,
> der keine Zahl ist), verweigert der Server den Start und benennt die Variable.
>
> Wo das Schema liegt, hängt davon ab, wie Sie das Backend ausführen. Ein Projekt, das von
> der Runtime gestartet wird – `rebase dev`, `rebase start`, das veröffentlichte Image – verwendet
> das Schema der Runtime (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, für das [`rebase eject`](/docs/cli)
> ausgeführt wurde, besitzt eine `backend/src/env.ts`, die `loadEnv({ extend })` aufruft, und kann dort
> eigene typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge (Connection String). **In der Entwicklung optional** – wenn nicht gesetzt, führt `rebase dev` ein verwaltetes PostgreSQL für das Projekt aus, mit Daten unter `.rebase/`. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktion erforderlich** (in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **Bei einer verwalteten Datenbank bedeutet `sslmode=require` möglicherweise nicht das, was es aussagt.**
>
> Für `psql` und jedes libpq-Tool bedeutet `require` „verschlüsselt, Zertifikat nicht
> geprüft“. Der Node-Treiber, auf dem Rebase läuft, interpretiert dies als `verify-full`. Eine
> Datenbank, deren Zertifikat von keiner öffentlichen Zertifizierungsstelle signiert wurde – üblich bei verwaltetem
> Postgres –, verweigert der Runtime daher den Zugriff mit `self-signed certificate`, während `psql`
> sich mit derselben URL verbindet. Die Runtime und `rebase db`-Befehle brechen mit einer
> Meldung ab, die genau darauf hinweist.
>
> Wählen Sie eine der Optionen:
>
> - **`sslmode=no-verify`** – verschlüsselt, nicht geprüft: was `require` für
>   libpq bedeutet. Dies ist eine node-postgres-Schreibweise, die libpq nicht kennt, weshalb `psql`, `pg_dump`
>   und Atlas dies mit `invalid sslmode value: "no-verify"` ablehnen. Rebase-eigene
>   Befehle (`rebase db push`, `rebase db backup`, `rebase db restore`) übergeben es
>   an diese als `sslmode=require`, sodass sie mit der konfigurierten URL funktionieren; für
>   manuelles `psql` ersetzen Sie es durch `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** – Prüfung gegen das
>   CA-Zertifikat des Anbieters. Für jedes Tool identisch.
>
> `uselibpqcompat=true&sslmode=require`, was die Warnung des Node-Treibers selbst
> vorschlägt, funktioniert auch für die Runtime; Rebase-Befehle entfernen `uselibpqcompat`,
> bevor sie die URL an libpq-Tools übergeben, die sie sonst ablehnen würden.

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** – siehe unten. | Page Origin |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth-Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, daher injiziert der
> Dev-Server diese Variable. In der Produktion liefert das Rebase-Backend die SPA aus, sodass die
> API der Origin der Seite selbst entspricht und der Client dies eigenständig so auflöst.
>
> Das feste Einbinden einer absoluten URL in ein Produktions-Bundle funktioniert genau so lange, bis ein zweiter
> Hostname auf dieselbe App zeigt: Eine benutzerdefinierte Domain lädt die Seite dann von
> `example.com` und ruft die API unter `example.rebase.website` auf, was
> Cross-Origin ist, sodass jede Anfrage am Preflight scheitert. Das Erlauben der Origin in CORS
> behebt dies **nicht** – das Refresh-Cookie ist `SameSite=Lax` und wird nicht
> Cross-Site gesendet. Sie würden also die Konsolenfehler beseitigen, hätten aber dennoch eine defekte
> Authentifizierung. Wenn die Variable ungesetzt bleibt, funktioniert jede Domain, die auf die App zeigt,
> ganz ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort nicht gelesen, da der Port aufgelöst wird, bevor diese Datei geladen wird – und bindet andernfalls einen Port, der vom Projektpfad abgeleitet wird, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner gibt die verwendete Methode an. | `3001` |
| `LOG_LEVEL` | Protokollierungs-Ausführlichkeit: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer Zeile `Failed query: [redacted]` an. Jedes fehlerhafte Statement wird standardmäßig maskiert, da eine fehlgeschlagene Abfrage ihre gebundenen Parameter enthält – eine E-Mail-Adresse, einen Passwort-Hash. Setzen Sie dies auf `true`, wenn Sie einen DDL-, RLS- oder Change-Capture-Fehler diagnostizieren. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste der erlaubten Origins. **In der Produktion erforderlich**, es sei denn, `FRONTEND_URL` ist gesetzt: Ein Produktionsstart ohne beides bricht ab. In der Entwicklung wird dies zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu CORS_ORIGINS verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (für Schema-Introspektion und Admin-Operationen). Die darin angegebene Datenbank ist nicht diejenige, die die SQL-Konsole als aktuell bezeichnet, noch die, die ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der die eigene Verbindung der App liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert den PostgreSQL-Rollenwechsel im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Studios SQL-Konsole meldet dann, dass die Zeilen als Verbindungseigentümer gelesen wurden, benennt diesen und deaktiviert die Rollenauswahl. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies bei einem Checkout, der [zu einem Branch gewechselt](/docs/backend/branching/#cli-integration) ist. Ein Server mit dieser Einstellung behält die Branch-Registry auf dieser Datenbank und kopiert neue Branches standardmäßig davon, sodass das Branches-Panel in Studio die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

Die Entwicklungsumgebung erlaubt **localhost plus alles, was `CORS_ORIGINS` (oder `FRONTEND_URL`)
angibt** – dieselbe Liste, die die Produktion verwendet, wobei localhost hinzugefügt statt
ersetzt wird. Die Variable funktioniert in beiden Umgebungen gleich, und die
Fälle, in denen sie in der Entwicklung benötigt wird, sind die üblichen:

```bash
# Ein Telefon im LAN, der Rechner eines Kollegen, ein ngrok-Tunnel,
# ein weitergeleiteter Codespaces-Port – alle Nicht-Localhost-Origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Eine Origin, die weder localhost noch aufgeführt ist, wird abgelehnt, und die Ablehnung wird
**einmal pro Origin** mit der genauen Zeile protokolliert, die sie erlauben würde. Das Verweigern ist
keine reine Vorsichtsmaßnahme: Die API sendet Anmeldedaten. Die Rückgabe einer
beliebigen `Origin` würde es jeder Website, die der Entwickler zufällig besucht, ermöglichen,
authentifizierte Anfragen mit dessen Sitzung an den Dev-Server zu senden und die
Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Secret für die JWT-Signierung (in Produktion erforderlich, in der Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Access Tokens (RS256), sodass jede Entität mit dem JWKS eine Sitzung überprüfen kann, ohne selbst eine erstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEM. Ohne diesen Schlüssel bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie ihn, wann immer sich der Schlüssel ändert – eine Rotation erfordert, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh Tokens. Gleitend – jede Rotation verlängert ihn, daher regelt dies, wie lange eine Sitzung **Inaktivität** übersteht. Setzen Sie `400d` für Sitzungen, die eine lange Abwesenheit überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Registrierung neuer Benutzer erlauben (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden aufnehmen, und dieser wird der Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein über die offene Registrierung erstelltes erstes Konto ist ein normales Konto, und der Administrator wird über `REBASE_ADMIN_EMAIL` unten benannt oder über den Service-Key zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standardwert des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Not-Aus-Schalter. Schließt das Erstbenutzer-Bootstrap-Fenster, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank gesperrt ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, da das Deployment sonst keine Möglichkeit hat, seinen ersten angemeldeten Aufrufer zu erzeugen. Jedes ausgelieferte Deployment-Artefakt setzt dies. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Admin-Kontos, das beim Start erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. So erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt mit dem Internet darum zu konkurrieren. Beim Start wird gewarnt, wenn die Tabelle in Produktion leer und dieser Wert nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, sonst wird es abgelehnt und das Konto nicht erstellt. Nach der ersten Anmeldung ändern. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Secret. Wenn nicht gesetzt, werden die Secrets stattdessen mit `JWT_SECRET` verschlüsselt und beim Start wird einmal gewarnt – eine Rotation von `JWT_SECRET` meldet somit alle Benutzer ab *und* macht jedes registrierte Authentifikator-Gerät unentschlüsselbar. Setzen Sie einen dedizierten Schlüssel (mind. 32 zufällige Zeichen), bevor sich jemand anmeldet. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *weg-rotiert* wird. Setzen Sie während einer Rotation beide: Neue Secrets werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende bleiben lesbar, sodass niemand während der Rotation aus seinem Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Secret neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht durch `ALLOW_REGISTRATION` eingeschränkt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API erzwingen. Auf `false` setzen für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Stellt `POST /api/auth/find-user` bereit, wodurch eine E-Mail-Adresse in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für Einladungs-Flows per E-Mail aufgelöst wird. Nur für authentifizierte Aufrufer, und gibt niemals E-Mail-Adresse, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: Stellt eine Angriffsfläche für Aufzählungen (Enumeration) dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite`-Attribut des Refresh-Cookies: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure`-Flag auf dem Refresh-Cookie. Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für reines HTTP – z. B. bei Bereitstellung auf einer LAN-Adresse, wo der Browser das Cookie andernfalls verwerfen würde und die Sitzung beim Ablauf des Access Tokens ohne Fehlermeldung sterben würde. Warnt beim Start. `http://localhost` benötigt dies nicht. | `true` |
| `GOOGLE_CLIENT_ID` | Google OAuth-Client-ID (Backend-Validierung) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth-Client-Secret | — |
| `GITHUB_CLIENT_ID` | GitHub OAuth-Client-ID | — |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth-Client-Secret | — |
| `MICROSOFT_CLIENT_ID` | Microsoft OAuth-Client-ID | — |
| `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth-Client-Secret | — |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth-Client-ID | — |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth-Client-Secret | — |
| `FACEBOOK_CLIENT_ID` | Facebook OAuth-Client-ID | — |
| `FACEBOOK_CLIENT_SECRET` | Facebook OAuth-Client-Secret | — |
| `TWITTER_CLIENT_ID` | X/Twitter OAuth-Client-ID | — |
| `TWITTER_CLIENT_SECRET` | X/Twitter OAuth-Client-Secret | — |
| `DISCORD_CLIENT_ID` | Discord OAuth-Client-ID | — |
| `DISCORD_CLIENT_SECRET` | Discord OAuth-Client-Secret | — |
| `GITLAB_CLIENT_ID` | GitLab OAuth-Client-ID. Für die `baseUrl` einer selbst gehosteten Instanz gibt es keine Umgebungsvariable – konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab OAuth-Client-Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket OAuth-Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket OAuth-Client-Secret | — |
| `SLACK_CLIENT_ID` | Slack OAuth-Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack OAuth-Client-Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth-Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth-Client-Secret | — |
| `APPLE_CLIENT_ID` | Apple Services ID für Web-Anmeldungen. Sie ist öffentlich und wird in `GET /auth/config` veröffentlicht. Apple hat kein statisches Client-Secret, da Rebase für jeden Token-Austausch ein kurzlebiges ES256-JWT signiert. Daher benötigt Apple `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` sowie diesen Wert oder `APPLE_BUNDLE_IDS`, und konfiguriert ohne diese nichts. | — |
| `APPLE_BUNDLE_IDS` | Kommagetrennte Bundle-IDs der nativen iOS/macOS-Apps, deren „Mit Apple anmelden“-Codes akzeptiert werden. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, der Aussteller (Issuer) des JWTs. | — |
| `APPLE_KEY_ID` | Key-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten Schlüsseldatei (`.p8`), inklusive Zeilenumbrüche (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Der öffentliche Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens überprüft werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deploy, er enthält keine Geheimnisse. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` ermöglicht er es dem Admin-Gate, ein Plattform-Token für `cron:read` und für nichts anderes zu akzeptieren. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, der das `aud` eines Plattform-Tokens entsprechen muss, damit ein für ein anderes Projekt erstelltes Token abgelehnt wird. Wenn nur eine der beiden Variablen gesetzt ist, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Wohin **Continue with Rebase Cloud** im Admin-Panel führt: die Projektseite in der Konsole der Plattform, die die Eigentümer des Projekts anmeldet und zurückkehrt. Die Plattform setzt diese beim Deploy zusammen mit den beiden obigen Variablen; damit akzeptiert `POST /api/auth/platform-signin` das einminütige `auth:admin-signin`-Token der Plattform und öffnet eine Admin-Sitzung. Ohne sie funktioniert der Zugriff weiterhin über **Open CMS** in der Konsole, und der Anmeldebildschirm erklärt dies lediglich. | — |
| `REBASE_RATE_LIMIT_STORE` | Speicherort der Rate-Limit-Zähler für die Auth-Routen und für `rateLimit` in benutzerdefinierten Funktionen: `memory` (pro Prozess) oder `sql` (über Replikate hinweg geteilt). Ein Prozess kann seine eigene Replikat-Anzahl nicht einsehen, daher muss ein Deployment mit mehreren Instanzen dies angeben – drei Replikate mit dem Standardwert erzwingen das dreifache Limit. Jeder andere Wert **verhindert den Start** anstelle eines Fallbacks, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Aktiviert den passwortlosen Anmeldelink-Flow (Magic Link). Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Aktiviert die passwortlose Anmeldung mit einem sechsstelligen Code per E-Mail. Gleiche E-Mail-Anforderung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Magic-Link- oder E-Mail-Code-Anfrage für eine unbekannte Adresse erstellt das Konto, solange die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh-Token nach Ablauf seines Wiederverwendungsfensters erneut eingereicht wird: `reject` (ablehnen, Sitzung beibehalten) oder `revoke-session` (Sitzung beenden). Jeder andere Wert lässt den Start fehlschlagen. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Bestätigung vor Registrierung erzwingen: Keine Passwort-Anmeldung, bis die Adresse bestätigt ist. Erfordert E-Mail; der Start wird andernfalls verweigert. | `false` |
| `CAPTCHA_PROVIDER` | Captcha-Verifizierung auf Auth-Routen aktivieren: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, serverseitig zur Validierung des vom Browser gesendeten Tokens verwendet. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Auth-Routen (z. B. `register,login`). Nicht gesetzt schützt den Standardsatz des Anbieters. | — |

### Storage

:::caution[Storage bietet keine Row-Level Security und benötigt daher ein Zugriffsmodell]
Tabellen werden durch Postgres RLS geschützt. Objektspeicher hat kein Äquivalent –
Schlüssel teilen sich einen flachen Namespace. Ist ein Bucket konfiguriert und
kein Zugriffsmodell definiert, **verweigert der Server in der Produktion den Start**.
Erfüllen Sie diese Voraussetzung mit genau einer der folgenden Optionen:
ein aus `backend/storage.ts` exportierter `storageAuthorize`-Hook (Standard im Scaffold),
`STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Storage-Backend: `local`, `s3` oder `gcs`. In der Produktion deaktiviert `local` den Speicher, es sei denn, `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird relativ zum Ausführungsverzeichnis des Servers gelesen: das Projektstammverzeichnis unter `rebase dev`, `backend/` in einem durch `rebase eject` erzeugten Server | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in der Produktion erlauben – nur mit einem persistenten Volume, das `STORAGE_PATH` und die daneben liegenden Verzeichnisse `<STORAGE_PATH>__<key>` benannter lokaler Buckets enthält | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Gültigkeitsdauer (in Sekunden) der Download-URL einer privaten Datei – das Token, das `getSignedUrl()` hineinschreibt. Maximal `604800` (eine Woche) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Größte Datei, die die Quelle akzeptiert (in Bytes) auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Ein Wert, der keine ganze Zahl von Bytes ist, verhindert den Start | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS Access Key | — |
| `S3_SECRET_ACCESS_KEY` | AWS Secret Key | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 etc.) | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für S3-Buckets erzwingen (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wenn Workload Identity Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für Buckets, die tatsächlich als öffentliches CDN dienen. Eine der drei Möglichkeiten, die Start-Schutzprüfung unten zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jedem angemeldeten Aufrufer das Lesen, Schreiben, Auflisten und Löschen aller Objekte erlauben. Im Konfigurationsobjekt aus gutem Grund `INSECURE` genannt: Dies ist nur in Single-Tenant-Apps vertretbar, in denen jedem Konto Zugriff auf jede Datei gewährt wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bildvarianten (Größenänderungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu generieren. | `false` |

### E-Mail (Optional)
`MAGIC_LINK_URL`.

| Variable | Beschreibung |
|----------|-------------|
| `SMTP_HOST` | SMTP-Server-Host |
| `SMTP_PORT` | SMTP-Server-Port |
| `SMTP_SECURE` | Sichere Verbindung aktivieren (`true`/`false`) |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | Absenderadresse für System-E-Mails |
| `SMTP_NAME` | Anzeigename für die Absenderadresse |
| `APP_NAME` | Produktname für E-Mail-Betreffzeilen und -Inhalte (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo am Anfang der Standard-E-Mail-Vorlagen. Absolute `http(s)`-PNG- oder JPG-URL – Clients entfernen SVG und blockieren `data:`-URIs. Wenn nicht gesetzt, erhält eine App mit dem Namen `Rebase` das Rebase-Logo und eine umbenannte App keines |
| `MAGIC_LINK_URL` | Ziel des per E-Mail versendeten Magic Links. An eine Basis-URL wird `/auth/magic-link?token=…` angehängt; eine URL, die `{token}` enthält, stellt den gesamten Link dar (für Frontends, die `/auth/magic-link` nicht bedienen). In `.env` in Anführungszeichen setzen, da ein `#` sonst als Kommentar interpretiert wird: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Bei Werten mit Hash oder Dateipfad ohne `{token}` wird beim Start gewarnt. Wenn nicht gesetzt, dient `FRONTEND_URL` als Basis |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximale Anzahl an gepoolten Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Zeitspanne in Millisekunden, die eine ungenutzte Verbindung aufrechterhalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Zeitspanne in Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine solche: `LISTEN`/`NOTIFY` funktioniert über Transaktions-Pooler wie PgBouncer nicht, und ohne direkte Verbindung werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, statt lautlos verloren zu gehen. Auch der [Job-Worker](/docs/backend/jobs) hält sein Wake-up-`LISTEN` darüber. Füllt `directConnectionString` des Postgres-Adapters, wenn dieser ungesetzt ist. | — |
| `DATABASE_READ_URL` | Read-Replica, wie z. B. ein Hot-Standby. Wenn ein anderer Server angegeben ist, werden authentifizierte Lesezugriffe (Listen, Einzelzeilen, Zählungen, Aggregate) dort unter derselben Row-Level Security bedient; Schreibvorgänge, Anmeldung, Realtime, Crons, Jobs, die SQL-Konsole und `rebase.sql` verbleiben auf der Primärdatenbank. Ein Leser, der gerade geschrieben hat, liest für die Dauer von `REBASE_READ_STICKY_MS` von der Primärdatenbank, und alle tun dies, solange das Replikat um mehr als `REBASE_READ_MAX_LAG_MS` hinterherhinkt oder fehlschlägt. Füllt `readConnectionString` des Postgres-Adapters, wenn dieser ungesetzt ist; bis einschließlich Version 0.28 wurde der Pool des Replikats zwar geöffnet, aber nie ausgelesen. | — |
| `REBASE_READ_STICKY_MS` | Dauer nach einem Schreibvorgang, für die Leseanfragen desselben Benutzers an die Primärdatenbank gehen, damit ein Speichervorgang gefolgt von einer Listenabfrage die Änderungen anzeigt. Pro Serverinstanz. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Maximaler Replikations-Lag, ab dem alle Leseanfragen an die Primärdatenbank weitergeleitet werden. | `1000` |
| `DATABASE_POOLED` | `true`, wenn `DATABASE_URL` über einen Pooler im Transaktionsmodus wie PgBouncer läuft. Der Pool sendet dann beim Verbinden weder `search_path` noch `statement_timeout` (der Pooler würde diese ablehnen oder verwerfen) und setzt beides in jeder Transaktion; der Bootvorgang gibt der Datenbankrolle einen standardmäßigen `search_path` von `public` für Anweisungen außerhalb einer Transaktion. `DATABASE_DIRECT_URL` wird dadurch erforderlich, und Realtime, das Wake-up des Job-Workers, Indexerstellungen, Branching und die SQL-Konsole nutzen diese. Die URL des Replikats wird ebenfalls als gepoolt angenommen. `DATABASE_POOLED__<KEY>` für eine andere Datenquelle. | — |
| `REBASE_DB_POOL_MAX` | Obergrenze für jeden Pool im Prozess, unabhängig von dessen jeweiliger Anforderung. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server lautlos zu serialisieren. | — |

### Laufzeitverhalten (Runtime)

Wird von der Runtime gelesen – `rebase dev`, `rebase start` und dem offiziellen
Server-Image. Ein Projekt, für das `eject` ausgeführt wurde, steuert diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) aus, das Tabellen meldet, die ohne Richtlinien bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime liefert keine eigene Kopie mit, und ohne das Paket bricht der Start unter Nennung des Pakets ab. `false` hält den Scan auf diesem Prozess deaktiviert. | — |
| `REBASE_RLS_REQUEST_ROLE` | Die Postgres-Rolle, unter der authentifizierte und anonyme Anfragen ausgeführt werden. Vergeben Sie für jedes Projekt auf einem geteilten Cluster eine eigene Rolle. Eine Datenbank zeichnet die Rolle auf, unter der sie läuft, und ein Start mit einer anderen Konfiguration bricht ab, bis `rebase db request-role migrate` sie migriert. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` erstellt die Request-Rolle und erlaubt der Verbindung, zu ihr zu wechseln; `never` überlässt beides Ihnen und prüft die Rollen nur. | `auto` |
| `REBASE_RLS_GRANTS` | Was Rebase der Request-Rolle gewährt: `schema` (jede Tabelle in den Schemas, die es bedient, plus Standardberechtigungen), `managed` (nur die Tabellen, die es bedient) oder `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` beschränkt die permissiven Richtlinien von Rebase auf die Request-Rolle(n), sodass andere Rollen, die dieselben Tabellen lesen, keine Berechtigungen daraus erhalten. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` schreibt die Richtlinien, die nur der Serverkontext oder ein Admin erfüllen kann, als `TO public` und führt Administratoren als Request-Rolle aus. Standardmäßig lauten sie `TO rebase_admin`, sodass eigentümerbezogene Lesezugriffe authentifizierter Benutzer den Eigentümerindex nutzen können. Siehe [Admin-Anfragen und `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` entfernt die Basisrichtlinie für Server-oder-Admin von jeder Tabelle. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` setzt zusätzlich `request.jwt.claims` und `request.jwt.claim.*`, sodass mit `auth.uid()` geschriebene Richtlinien den Aufrufer erkennen. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Verhalten beim Start, wenn ein anderes Login in die Request-Rolle wechseln kann: `warn`, `refuse` oder `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Dem Client muss dasselbe mitgeteilt werden – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische/Admin-Assets des Bundles von diesem Prozess aus bereitstellen. Deaktivieren, wenn ein CDN davor geschaltet ist. | `true` |
| `REBASE_STUDIO` | Die integrierte Standalone-Konsole Rebase Studio unter `/_studio` bereitstellen, wenn ein statisches Studio-Bundle verfügbar ist. Auf `false` setzen zum Deaktivieren. | `true` |
| `REBASE_STUDIO_DIR` | Verzeichnis mit der vorgefertigten Standalone-SPA für Rebase Studio, die unter `/_studio` bereitgestellt wird. Standardmäßig `/studio` im Container-Image. | `/studio` |
| `REBASE_HISTORY` | [Entitäts-Änderungshistorie](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli-Kompression für Antworten aktivieren. | `true` |
| `REBASE_PUSH` | `true` aktiviert [Push-Benachrichtigungen](/docs/backend/push-notifications/): die `/api/push`-Routen, die Tabelle `rebase.push_subscriptions` und `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Das VAPID-Schlüsselpaar, mit dem Push-Nachrichten signiert werden. Außerhalb der Produktion wird bei Fehlen ein Paar generiert und in `.rebase-dev-secrets.json` gespeichert; in der Produktion bleibt Push ohne diese Schlüssel deaktiviert. | — |
| `REBASE_VAPID_SUBJECT` | Eine `mailto:`-Adresse oder `https://`-URL, die Push-Dienste kontaktieren können. Standardmäßig die Origin einer `https`-basierten `REBASE_PUBLIC_URL`. | — |
| `REBASE_MAX_BODY_SIZE` | Maximale Größe des Request-Bodys **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verhindert den Start, anstatt das Limit lautlos aufzuheben). `0` schaltet das Limit ab. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände möglich. Nicht gesetzt (in jeder Umgebung): `/api/docs` wird den Aufrufern bereitgestellt, für die `GET /api/schema/tables` Tabellen beschreibt (jeweils das Dokument der für sie sichtbaren Tabellen), und es gibt keine Swagger-UI. `true` veröffentlicht das gesamte Dokument für jeden, mit der Swagger-**UI** unter `/api/swagger` außerhalb der Produktion (niemals in Produktion). `false` behält das Dokument hinter dem Admin-Gate. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt `includeSubDomains` zum `Strict-Transport-Security`-Header hinzu, sodass Browser für sechs Monate unverschlüsseltes HTTP auf jeder Subdomain des Hosts verweigern – einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn jede Subdomain der Domain ausschließlich HTTPS nutzt. Jeder Wert außer `true`/`false` verhindert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn ungesetzt, bleibt der Endpunkt für jeden erreichbar, der Zugriff auf den Port hat – in einem privaten Netzwerk in Ordnung, in einem öffentlichen nicht (die Startprotokolle weisen darauf hin). | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start am Schema der Tabellen ändern darf. `ensure` (Standardwert überall – auch in Produktion) führt den **additiven** Durchlauf aus: fehlende Tabellen, Spalten und Enum-Typen erstellen, niemals etwas löschen oder umschreiben. `none` lässt das Schema der deklarierten Tabellen unberührt, aber die Tabellen des Frameworks selbst (Auth, API-Keys, Jobs, Cron) werden weiterhin erstellt und aktuell gehalten; `REBASE_PROVISION=false` schaltet auch diese ab. Das veröffentlichte Image akzeptiert nur diese beiden Optionen und **verweigert den Start bei `push`**. In einem [Split-Deployment](/docs/deployment/split-processes) darf genau ein Prozess das Provisioning übernehmen, alle anderen Rollen müssen `none` setzen oder brechen den Start ab. | `ensure` |
| `REBASE_PROVISION` | `false` sorgt dafür, dass die Runtime keinerlei Änderungen an der Datenbank vornimmt: keine Tabelle, Spalte, Index, Funktion, Trigger, Richtlinie, Rolle oder Berechtigung, weder beim Start noch später (einschließlich der Framework-eigenen). Fehlende Elemente werden stattdessen namentlich gemeldet. Gedacht für Datenbanken, die ausschließlich durch Ihren Änderungsprozess modifiziert werden dürfen. Siehe [Wenn nur Ihr Änderungsprozess die Datenbank ändern darf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Es werden nur `true` und `false` akzeptiert. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Start verweigern, wenn die Datenbank zuletzt aus einer anderen Tabellenmenge bereitgestellt wurde, als für diesen Prozess gebaut wurde. Ungesetzt (oder jeder andere Wert als `true`/`1`) gibt stattdessen eine Warnung aus. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Start verweigern, wenn eine Funktions- oder Cron-Datei beim Importieren einen Fehler wirft oder nicht geparst werden kann (unter Nennung der Datei und des Grundes), sodass bei einem Rolling Deployment die alte Version weiterläuft. Gilt auch bei einem Neustart. Ungesetzt (oder jeder andere Wert als `true`) überspringt die Datei und stellt den Rest bereit. Eine Datei, die fehlerfrei importiert wird, aber keine Funktion und keinen Job exportiert, wird immer übersprungen und nicht abgewiesen. | skip |
| `REALTIME_CDC` | Change Data Capture auf Datenbankebene: `auto` (Änderungen aus dem WAL lesen, wo die Datenbank es erlaubt, sonst Trigger verwenden, sonst Fallback auf Anwendungsebene mit Protokollierung auf Info-Level), `trigger` (Trigger erzwingen, warnen falls unmöglich), `wal` (Änderungen aus dem Write-Ahead-Log statt über Trigger lesen; benötigt `wal_level=logical` und eine Rolle mit Replikationsrechten, sonst Fallback auf `trigger`), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Kanäle und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein instanziierter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Maximale Anzahl von Subscriptions, die ein Realtime-Socket halten darf; weitere werden mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Maximale Anzahl an Realtime-Sockets, die ein Benutzer oder ein API-Schlüssel auf einer Serverinstanz geöffnet halten darf. Impersonating-Sockets eines Administrators zählen zulasten des Administrators. Die Anmeldung des nächsten Sockets wird mit `TOO_MANY_SOCKETS` abgelehnt und der Socket geschlossen (4002); das SDK versucht es weiter, sodass er verbunden wird, sobald ein anderer schließt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Kein Limit |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Maximale Wartezeit (in ms) für das erneute Abrufen (Refetch) nach einer Änderung, um diese an Live-Abonnenten zu senden. Ein Refetch wartet 300 ms ohne weitere Änderung und maximal diese Dauer bei einem stetigen Strom von Schreibvorgängen. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Dauer in ms, für die die Gesamtzahl einer großen Listen-Subscription wiederverwendet werden darf, bevor sie neu gezählt wird; Frames, die diesen Wert wiederverwenden, tragen `meta.totalAsOf`. Wenn ungesetzt, wird bei jedem Frame gezählt. Hat Vorrang vor `realtime.recountIntervalMs`. | Ungesetzt |
| `REALTIME_RECOUNT_MIN_ROWS` | Die kleinste Zeilenzahl, ab der `REALTIME_RECOUNT_INTERVAL_MS` greift; kleinere Listen werden bei jedem Frame neu gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`/Loopback-Werte unter `NODE_ENV=production`. Standardmäßig deaktiviert, damit ein Produktionsstart deutlich fehlschlägt, statt sich mit einer nicht vorhandenen lokalen Datenbank zu verbinden. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet den Prozess, ohne einen Socket zu öffnen – genau das Verhalten, das für einen Migrations-Job benötigt wird (aus demselben Image und Bundle wie der nachfolgende Server). Erstellt auch die Tabellen, die ein Serverprozess sonst erst bei der ersten Nutzung anlegen würde, und startet weder Cron noch Job-Queues. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein normales Deployment nicht versehentlich in einen Migrationslauf verwandeln kann. In Kombination mit `REBASE_PROVISION=false` ungültig. | — |
| `REBASE_PROVISION_SQL_OUT` | Ein Dateipfad. Ein Provisioning-Lauf (`REBASE_PROVISION_ONLY=true`) schreibt jede vorgenommene Schemaänderung in chronologischer Reihenfolge als SQL-Skript dorthin, um sie zu prüfen und mit `psql` anzuwenden. Geschriebene Datenzeilen sind nicht enthalten. Für Prozesse, die Serveranfragen bedienen, unzulässig. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt es Maschinen (einem Agenten, einem CI-Job), Schemaänderungen über `/api/admin/schema` direkt *anzuwenden*, anstatt sie nur zu planen. Standardmäßig deaktiviert: Die Anmeldedaten für solche Änderungen liegen am ehesten in CI-Variablen vor. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Maximale Ausführungszeit einer benutzerdefinierten Funktion, bevor die Anfrage abgebrochen wird. Entspricht der Option `functionsTimeoutMs`. `0` schaltet das Limit ab. Eine Funktion, die ihr eigenes Limit deklariert (`defineFunction(…, { timeoutMs })`), verwendet stattdessen dieses. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Maximales Timeout in ms, das eine Funktion über `defineFunction(…, { timeoutMs })` für sich selbst deklarieren darf; fordert sie mehr an, wird dieser Wert verwendet. Eine positive Zahl; alles andere wird als ungesetzt interpretiert. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` sorgt dafür, dass ein unbehandelter Promise-Fehler (Unhandled Rejection) den Prozess beendet, anstatt ihn nur zu protokollieren. Sinnvoll unter einem Orchestrator, der den Prozess neu startet; deaktivieren, wenn ein Neustart gravierender als ein Leak ist. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Unterdrückt die Startwarnung auf Plattformen, die die Runtime als Scale-to-Zero erkennt, wo ein Timer in einer inaktiven Instanz sonst in gar keiner Instanz auslösen würde. Ändert nichts anderes: Setzen Sie dies, wenn Sie mindestens eine Instanz dauerhaft betreiben. | — |
| `TRUSTED_PROXY_HOPS` | Anzahl der vorgeschalteten Proxys, damit der Rate-Limiter die reale Client-Adresse aus `X-Forwarded-For` auslesen kann. Ausfallsicherer Standardwert ist `0`: Ohne Proxy würde das Vertrauen in diesen Header jedem Aufrufer ermöglichen, seine Identität zu fälschen. | `0` |

:::note[Boot-Provisioning ist additiv und kein Migrationswerkzeug]
Der Boot-Durchlauf läuft unbeaufsichtigt ohne menschliche Kontrolle eines Diffs,
daher wird er niemals eine Spalte löschen, einen Typ einschränken oder eine Tabelle umschreiben.
Aus diesem Grund verweigert das Image auch `REBASE_MIGRATE_ON_BOOT=push`: Ein vollständiger
Push berechnet ein Diff und führt bei Bedarf auch ein `DROP COLUMN` aus – ein Neustart
eines Containers darf jedoch niemals als Nebeneffekt eines Neuansetzens (Rescheduling)
eine Produktionsspalte zerstören können.

Destruktive oder strukturverändernde Anpassungen gehören an Orte, an denen sie überprüft werden können:
`rebase db generate` + `rebase db migrate`, oder `rebase db push` aus einem Checkout bzw. einer CI,
was die Änderung im Trockenlauf testet, destruktive Änderungen ohne Bestätigung verweigert und
zuvor ein Backup anlegen kann.
:::

### Split-Deployments

Ein Image und ein Bundle können mehrfach gestartet werden, wobei jede Instanz einen
anderen Teil des Projekts bedient. Hier ist jeweils eine Zeile aufgeführt, um Vollständigkeit
zu gewährleisten; welche Kombinationen was *bereitstellen und verwalten* – und welche
Kombinationen den Start verweigern –, erfahren Sie unter
**[Geteilte Prozesse (Split Processes)](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Wenn nicht gesetzt, bestimmt die Rolle das Verhalten. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Wenn nicht gesetzt, bestimmt die Rolle das Verhalten. | — |
| `REBASE_FUNCTIONS_ONLY` | Nur die angegebenen benutzerdefinierten Funktionen in diesem Prozess ausführen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen außer den angegebenen ausführen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. Auf einem `worker` das Ziel für eigene `rebase.functions`-Aufrufe. Eine `http(s)`-URL. | — |

### MCP-Schnittstelle

Ein optionaler Model Context Protocol-Endpunkt unter `/mcp`, damit ein KI-Client dieses
Projekt **als der angemeldete Benutzer** lesen und schreiben kann. Standardmäßig aus,
und – anders als bei jeder anderen Schnittstelle – schaltet keine `REBASE_ROLE` diesen ein:
Die anderen beschreiben eine Prozessform, während dies eine Entscheidung ist, Anmeldedaten
an Drittanbieter-Software zu übergeben. Sie sollte von einem Menschen getroffen und
nicht von der Aufgabenbeschreibung eines Containers geerbt werden.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | MCP-Schnittstelle aktivieren. Erfordert `REBASE_PUBLIC_URL`; ohne diese wird die Schnittstelle nicht eingebunden und dies im Startprotokoll vermerkt. | `false` |
| `REBASE_PUBLIC_URL` | Die extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Schnittstelle kann diese nicht ableiten – das Auslesen der Origin aus dem `Host`-Header würde die Issuer-Identität und die Zielgruppe (Audience), gegen die Tokens geprüft werden, zu einem vom Aufrufer manipulierbaren Wert machen. | — |
| `REBASE_MCP_VIEW` | Pfad zur projekteigenen MCP-App-Ansicht (`rebase-view.html`, generiert von `rebaseMcpViewPlugin()`), die Claude anstelle der generischen Ansicht bereitgestellt wird, damit Ihre benutzerdefinierten Ansichten, Felder und Aktionen gerendert werden. Ohne diesen Pfad sucht das Backend neben dem Frontend, das es ausliefert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Dynamische OAuth-Client-Registrierung erlauben (RFC 7591), sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um eine Vorabregistrierung von Clients zu erzwingen. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Deaktiviert, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes Bundle
enthält keinen `backend/schema`-Quellcode zum Bearbeiten. Sind diese Variablen gesetzt, liest
der Schema-Editor den Quellcode aus dem Repository, committet jede Änderung dorthin zurück
und führt das DDL auf dieser Datenbank aus. Nur für Admins und von Personen angewendet,
sofern `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` nichts anderes festlegt. Ein angegebenes Repository
ohne nutzbare Anmeldedaten verhindert den Start. Siehe
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository für Schemaänderungs-Commits im Format `owner/name`. Das Setzen dieser Variable aktiviert die Funktion. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, in den der Commit geschrieben wird. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Speicherort von `backend/schema` in diesem Repository (relativ zum Repo-Root). Ein Pfad, der das Repository verlässt, verhindert den Start, ebenso wie das veraltete `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein Fine-Grained Token mit Lese- und Schreibzugriff auf die Inhalte des Repositorys. Setzen Sie entweder dies oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub App, um Commits als App statt über ein Token durchzuführen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installations-ID der App im Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit maskierten Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Wenn nicht gesetzt, sind geplante Backups deaktiviert. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. Erforderlich zusammen mit `BACKUP_SCHEDULE`, das ohne diesen Wert nicht startet. `rebase db backup` greift standardmäßig auf `./backups` am Ausführungsort zurück. | — |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Nicht gesetzt oder `0` behält alle Backups. | — |
| `BACKUP_KEEP_MINIMUM` | Mindestens N der neuesten Backups immer behalten, unabhängig von der Retention-Einstellung. | — |
| `PG_DUMP_PATH` | Überschreibt den Pfad zur `pg_dump`-Binärdatei – sie muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Überschreibt den Pfad zur `pg_restore`-Binärdatei. | — |
| `PSQL_PATH` | Überschreibt die `psql`-Binärdatei, die `rebase db restore --clean` ausführt, um die Wiederherstellung in einer Transaktion durchzuführen. | — |
| `PG_DUMPALL_PATH` | Pfad zu `pg_dumpall`, falls es nicht im `PATH` liegt. Ohne diese Datei – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) enthält die PostgreSQL 18-Client-Tools,
sodass ein geplantes Backup darin gegen jeden Server bis Postgres 18 ausgeführt werden kann.
Außerhalb des Images müssen Sie diese selbst installieren (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups enthalten Secrets und personenbezogene Daten (PII). Verwenden Sie ein privates Ziel
mit serverseitiger Verschlüsselung (Encryption-at-Rest).

### Bundle-Bereitstellung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft
beim Start ein Bundle ab. Diese Variablen steuern, welches Bundle wie geladen wird.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | URL zum Abrufen des Bundle-Archivs, falls kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Das Bearer-Token für diesen Abruf. Behandeln Sie es vertraulich: Es autorisiert einen Mandanten zum Herunterladen seines Codes. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Zielverzeichnis zum Entpacken eines abgerufenen Bundles. Muss beschreibbar sein und den Zeitraum zwischen Abruf und Start überstehen. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image dem Bundle über die selbst deklarierten hinaus bereitstellt. | — |

### Ressourcen-Bindings

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `backend/resources.ts` deklariert,
wird über gleichnamige Umgebungsvariablen gebunden. Die Basisnamen finden Sie unten;
eine Nicht-Standard-Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an. Ein Bucket
namens `media` liest somit `S3_BUCKET__MEDIA`. `rebase status`
gibt pro Ressource
die exakte Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, sofern es nicht der Standard-Postgres-Treiber ist. Mit Suffix pro Quelle versehen: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Mit Suffix pro Topic versehen. | — |

### Die Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hiervon wirkt sich auf ein Deployment aus.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Wohin `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service-Key senden (in der Shell oder in `.env`). Setzen Sie dies, wenn der Server auf andere Weise als über `rebase dev` in diesem Projekt läuft: `rebase start`, ein Container, ein anderer Host. Wenn ungesetzt, verwenden sie den Server, den `rebase dev` während seiner Laufzeit aufgezeichnet hat, und senden nichts, wenn er nicht läuft. | — |
| `REBASE_SERVICE_KEY` | Der Service-Key, mit dem sich diese Befehle authentifizieren, gelesen aus `.env`: dieselbe Variable, die der Server liest (siehe oben). | — |
| `SERVICE_KEY` | Eine ältere Bezeichnung für diesen Schlüssel. Wenn in `.env` gesetzt, lesen `rebase api-keys` und `rebase storage` diesen anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env`-Datei die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_ROOT_RULES` | `0` verhindert, dass `rebase init` und `rebase skills install` die Regeln des Projekts in `CLAUDE.md` und `AGENTS.md` im Repository-Root schreiben, falls Sie diese Dateien manuell pflegen möchten. | on |
| `REBASE_CLOUD_URL` | Die Control-Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, mit dem sich `rebase cloud login` ohne Eingabeaufforderung anmeldet. | — |
| `REBASE_CLOUD_PASSWORD` | Das zugehörige Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in der Shell-Historie landet. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der Sitzung aus `rebase cloud login` und liest bzw. schreibt die gespeicherte Sitzung niemals. In einem Verzeichnis, das mit `rebase cloud init --claim` verknüpft wurde, wird es zugunsten des projekteigenen Tokens zurückgestellt, wenn es keinen Scope für das Projekt besitzt. Der empfohlene Weg zur Ausführung von `rebase cloud` in CI – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) übergibt es an die CLI, die seine Cloud-Tools starten, und sendet es niemals an die App: Setzen Sie dafür `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt den zugrundeliegenden Fehler und Anfragedetails anstelle der kurzen Nachricht aus. Der erste Schritt zur Fehlersuche, wenn ein `rebase cloud`-Befehl fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle der `<db>_dev_diff`, die sie neben `DATABASE_URL` erstellen. Rebase erstellt oder löscht keine hier benannte Datenbank und verweigert eine Angabe, die `DATABASE_URL` gleicht. Bei der verwalteten Entwicklungsdatenbank setzt die CLI dies auf ein eigenes, temporäres In-Memory-PGlite. Setzen Sie dies, wenn `CREATE DATABASE` nicht gewährt ist. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und führt kein Provisioning durch – Sie stellen Ihre eigene bereit. Entspricht `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixiert den Port des Frontend-Dev-Servers, den `rebase dev` andernfalls aus dem Projektpfad ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` auf die Rückmeldung des Backends wartet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert die Meldung. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einfügt. | — |
| `DO_NOT_TRACK` | Die toolübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe, spezifisch für Rebase. Benötigt keine Datei und eignet sich daher ideal für CI und Container-Images. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Ziel-Endpunkt für Telemetriedaten bei einem selbst gehosteten Collector. | — |

## Secrets in der Entwicklung

`JWT_SECRET` ist in der Produktion erforderlich. Dieser Wert und `REBASE_SERVICE_KEY` werden
außerhalb davon automatisch für Sie generiert, sodass Sie sofort ohne Konfigurationsaufwand starten können.

Diese generierten Werte werden in `.rebase-dev-secrets.json` neben
`.rebase-dev-port` und `.rebase-dev-url` zwischengespeichert und mit diesen git-ignoriert. Zuvor
wurden sie bei jedem Start neu generiert – ein Neustart des Entwicklungsservers meldete Sie
daher von Ihrer eigenen App ab und entwertete soeben erstellte API-Schlüssel.

- Wenn Sie eine der beiden Variablen explizit festlegen, wird Ihr Wert verwendet; es wird nichts zwischengespeichert oder gelesen.
- Verweisen Sie den Cache mit `REBASE_DEV_SECRETS_FILE` auf einen anderen Ort – ein Pfad, und die
  einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets neu zu generieren. Der nächste Start legt eine neue Datei an.
- Kann die Datei nicht geschrieben werden – etwa in einem schreibgeschützten Container –, startet der Server
  dennoch mit einem flüchtigen Secret, genau wie früher.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion
wird auch nichts automatisch generiert: Ein Start ohne `JWT_SECRET` schlägt fehl, nennt die Variable,
und das Verhalten bleibt unverändert:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Backend-Konfigurationsobjekt

Das an `initializeRebaseBackend()` übergebene `RebaseBackendConfig` bietet programmatische Kontrolle:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    schemaDir: "./schema",     // Das Verzeichnis backend/schema: die Tabellen und was der Schema-Editor schreibt
    basePath: "/api",        // Basispfad für alle API-Routen (Standard: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentifizierungskonfiguration
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Authentifizierung für Daten-API verlangen (Standard: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // Kein konfigurierter Bucket in der Produktion bedeutet, dass Storage deaktiviert ist, nicht lokal:
    // Uploads antworten mit 501, anstatt auf einem Dateisystem zu landen, das beim nächsten
    // Redeploy gelöscht wird.
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

    history: true,           // Entitäts-Änderungshistorie aktivieren

    enableSwagger: true,     // Veröffentlicht das gesamte OpenAPI-Dokument unter /api/docs für alle

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
    apiPath: "/v1"          // muss mit dem basePath des Backends übereinstimmen
});
```

Das Admin-Panel übernimmt dies automatisch von dem ihm übergebenen Client; es muss nichts
weiter konfiguriert werden. Wenn Sie eine Anfrage-URL manuell zusammensetzen, beziehen Sie die Basis
über den Client, anstatt `/api` fest zu kodieren:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // z. B. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### Keine Berechtigung im SQL-Editor (`permission denied for table <name>`)

* **Symptome:** Benutzerdefinierte Abfragen im SQL-Editor von Rebase Studio schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellenansicht des CMS Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, Abfragen im SQL-Editor auszuführen, indem die Datenbankrollen temporär gewechselt werden, um der Anwendungsrolle des aktiven Benutzers zu entsprechen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung nutzen, bei der Rollen nur in Datenbanktabellen und nicht als echte PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer (Verbindungseigentümer) ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase dazu, Abfragen im SQL-Editor mit den Berechtigungen des Verbindungseigentümers auszuführen (in der Regel Superuser/Owner). Der SQL-Editor zeigt dann über den Ergebnissen an, dass diese als Verbindungseigentümer gelesen wurden, und deaktiviert die Rollenauswahl.

### Laden des Schemas im SQL-Editor fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden oder der SQL-Editor gibt den Fehler `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.` aus.
* **Ursache:** Rebase benötigt administrative Berechtigungen, um Datenbank-Systemkataloge abzufragen und administrative Befehle auszuführen. Wenn `adminConnectionString` dem Bootstrapper nicht übergeben wird oder `getAdmin()` überschrieben wurde, um `undefined` zurückzugeben, schlagen diese Vorgänge fehl.
* **Lösung:** Stellen Sie sicher, dass `adminConnectionString` während der Initialisierung des Backend-Bootstrappers konfiguriert ist:
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

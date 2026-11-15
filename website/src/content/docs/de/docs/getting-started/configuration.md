---
sourceHash: fa28c44bef748bed
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projekt-Stammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> eine erforderliche Variable fehlt oder fehlerhaft ist (eine URL, die keine URL ist, ein Port,
> der keine Zahl ist), verweigert der Server den Start und nennt die entsprechende Variable.
>
> Wo das Schema definiert ist, hängt davon ab, wie Sie das Backend ausführen. Ein Projekt, das über
> die Runtime gestartet wird – `rebase dev`, `rebase start`, das veröffentlichte Image –, verwendet
> das Schema, das der Runtime gehört (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, für das [`rebase eject`](/docs/cli)
> ausgeführt wurde, besitzt eine `backend/src/env.ts`, die `loadEnv({ extend })` aufruft, und kann dort
> eigene typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **Optional in der Entwicklung** – wenn nicht gesetzt, führt `rebase dev` ein verwaltetes PostgreSQL für das Projekt aus, dessen Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktion erforderlich** (wird in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` ist eine node-postgres-Schreibweise, keine von libpq.**
>
> Rebase und der Node-Treiber akzeptieren dies – verschlüsseln, aber das
> Zertifikat nicht prüfen. `psql`, `pg_dump`, `pg_restore` und Atlas tun dies nicht
> und stufen die Verbindung nicht herab: Sie verweigern den Start mit `invalid sslmode value: "no-verify"`.
>
> Die Rebase-eigenen Befehle (`rebase db push`, `rebase db backup`, `rebase db
> restore`) schreiben dies vor dem Aufruf externer Shell-Befehle in das äquivalente `sslmode=require` um,
> sodass sie mit der konfigurierten URL funktionieren. Der manuelle Aufruf von `psql` tut dies
> nicht – ersetzen Sie den Wert dort durch `sslmode=require`, was die Verbindung auf exakt
> dieselbe Weise ohne Verifizierung verschlüsselt.

### Frontend

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** – siehe unten. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, weshalb der Dev-Server
> dies injiziert. In der Produktion liefert das Rebase-Backend die SPA aus, sodass die
> API die eigene Origin der Seite darstellt und der Client dies selbstständig so auflöst.
>
> Das feste Einbinden einer absoluten URL in ein Produktions-Bundle funktioniert genau so lange,
> bis ein zweiter Hostname auf dieselbe App zeigt: Eine benutzerdefinierte Domain lädt die Seite dann von
> `example.com` und ruft die API unter `example.rebase.website` auf, was Cross-Origin ist,
> sodass jeder Request den Preflight fehlschlagen lässt. Das Erlauben der Origin in CORS
> behebt dies **nicht** – das Refresh-Cookie ist `SameSite=Lax` und wird nicht
> Cross-Site gesendet. Sie würden also die Konsolenfehler beseitigen, aber die Authentifizierung
> bliebe weiterhin fehlerhaft. Wenn ungesetzt, funktioniert jede Domain, die auf die App zeigt,
> völlig ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort nicht gelesen, da der Port vor dem Laden dieser Datei aufgelöst wird – und bindet andernfalls einen vom Projektpfad abgeleiteten Port, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner gibt die genutzte Prioritätsstufe an. | `3001` |
| `LOG_LEVEL` | Logging-Detailgrad: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer Zeile `Failed query: [redacted]` an. Jedes fehlgeschlagene Statement wird standardmäßig unkenntlich gemacht, da eine fehlgeschlagene Abfrage gebundene Parameter enthält – eine E-Mail, ein Passwort-Hash. Setzen Sie dies auf `true`, während Sie einen DDL-, RLS- oder Change-Capture-Fehler diagnostizieren. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste der erlaubten Origins. **In Produktion erforderlich**, es sei denn, `FRONTEND_URL` ist gesetzt: Ein Produktionsstart ohne beides verweigert den Start. In der Entwicklung wird sie zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu `CORS_ORIGINS` verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (für Schema-Introspektion und administrative Operationen). Die dort benannte Datenbank ist weder diejenige, die die SQL-Konsole als aktuell ansieht, noch die, die ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der die eigene Verbindung der App liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert den PostgreSQL-Rollenwechsel im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Studios SQL-Konsole meldet dann, dass die Zeilen als Verbindungseigentümer gelesen wurden, nennt diesen und graut die Rollenauswahl aus. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies auf einem Checkout, der [auf einen Branch gewechselt wurde](/docs/backend/branching/#cli-integration). Ein Server damit behält die Branch-Registry auf dieser Datenbank und kopiert neue Branches standardmäßig davon, sodass die Branches-Ansicht von Studio die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

Die Entwicklungsumgebung erlaubt **localhost plus alles, was `CORS_ORIGINS` (oder `FRONTEND_URL`)
angibt** – dieselbe Liste, die die Produktion verwendet, wobei localhost hinzugefügt statt
ersetzt wird. Die Variable funktioniert also in beiden Umgebungen gleich, und die Fälle,
die sie in der Entwicklung benötigen, sind die typischen:

```bash
# Ein Telefon im LAN, der Rechner eines Kollegen, ein ngrok-Tunnel,
# ein weitergeleiteter Codespaces-Port – alles Nicht-Localhost-Origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Eine Origin, die weder localhost noch aufgeführt ist, wird abgelehnt, und die Ablehnung wird
**einmal pro Origin** mit der exakten Zeile protokolliert, die sie erlauben würde. Das Ablehnen ist
keine bloße Vorsichtsmaßnahme: Die API sendet Anmeldedaten. Die unreflektierte Übernahme eines
beliebigen `Origin`-Headers würde es jeder Seite, die der Entwickler zufällig besucht, ermöglichen,
authentifizierte Anfragen mit dessen Sitzung an den Dev-Server zu stellen und die Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `JWT_SECRET` | Geheimnis für die JWT-Signierung (in Produktion erforderlich, in Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Zugriffstokens (RS256), sodass jede Entität mit dem JWKS eine Sitzung verifizieren kann, ohne selbst Tokens erstellen zu können. Akzeptiert einen PEM-Schlüssel mit echten Zeilenumbrüchen, einen PEM-Schlüssel mit `\n`-Escapes oder Base64 des gesamten PEM. Ohne diese Angabe bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie dies bei jedem Schlüsselwechsel – eine Rotation erfordert, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh Tokens. Gleitend – jede Rotation verlängert sie, daher bestimmt dies, wie lange eine Sitzung bei **Inaktivität** bestehen bleibt. Setzen Sie `400d` für Sitzungen, die lange Abwesenheiten überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Registrierung neuer Benutzer erlauben (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden zulassen, und dieser jemand wird der Administrator. In Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein erster über die offene Registrierung erstellter Account ist ein gewöhnlicher Account, und der Admin wird mit `REBASE_ADMIN_EMAIL` unten benannt oder über den Service-Key zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standard des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Not-Aus-Schalter. Schließt das Bootstrap-Fenster für den ersten Benutzer, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank gesperrt ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, da das Deployment sonst keine Möglichkeit hat, seinen ersten angemeldeten Aufrufer zu erzeugen. Jedes ausgelieferte Deployment-Artefakt setzt dies. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Admin-Kontos, das beim Start erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. Auf diese Weise erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt ein Wettrennen mit dem Internet darum zu veranstalten. Der Start warnt, wenn die Tabelle in Produktion leer und dies nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto wird nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Geheimnis. Wenn nicht gesetzt, werden die Geheimnisse stattdessen mit `JWT_SECRET` verschlüsselt und der Start warnt einmalig – eine Rotation von `JWT_SECRET` meldet somit alle Benutzer ab *und* hinterlässt jeden registrierten Authentifikator unentschlüsselbar. Setzen Sie einen dedizierten Schlüssel (mind. 32 zufällige Zeichen), bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *wegrotiert* wird. Setzen Sie während einer Rotation beide: Neue Geheimnisse werden mit `MFA_ENCRYPTION_KEY` geschrieben, und bestehende sind weiterhin lesbar, sodass niemand mitten in der Rotation aus seinem Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Geheimnis neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht durch `ALLOW_REGISTRATION` eingeschränkt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API verlangen. Auf `false` setzen für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Stellt `POST /api/auth/find-user` bereit, wodurch eine E-Mail-Adresse in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für Einladungsabläufe aufgelöst wird. Nur für authentifizierte Aufrufer; gibt niemals die E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: stellt eine Angriffsfläche für Aufzählungen (Enumeration) dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite`-Attribut des Refresh-Cookies: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure`-Attribut des Refresh-Cookies. Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für unverschlüsseltes HTTP – ein Deployment auf einer LAN-Adresse, bei dem der Browser das Cookie andernfalls verwerfen würde und die Sitzung beim Ablauf des Access Tokens fehlerlos sterben würde. Warnt beim Start. `http://localhost` benötigt dies nicht. | `true` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client-ID (Backend-Validierung) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | — |
| `GITHUB_CLIENT_ID` | GitHub OAuth Client-ID | — |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth Client Secret | — |
| `MICROSOFT_CLIENT_ID` | Microsoft OAuth Client-ID | — |
| `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth Client Secret | — |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth Client-ID | — |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth Client Secret | — |
| `FACEBOOK_CLIENT_ID` | Facebook OAuth Client-ID | — |
| `FACEBOOK_CLIENT_SECRET` | Facebook OAuth Client Secret | — |
| `TWITTER_CLIENT_ID` | X/Twitter OAuth Client-ID | — |
| `TWITTER_CLIENT_SECRET` | X/Twitter OAuth Client Secret | — |
| `DISCORD_CLIENT_ID` | Discord OAuth Client-ID | — |
| `DISCORD_CLIENT_SECRET` | Discord OAuth Client Secret | — |
| `GITLAB_CLIENT_ID` | GitLab OAuth Client-ID. Die `baseUrl` einer selbst gehosteten Instanz hat keine Umgebungsvariable – konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab OAuth Client Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket OAuth Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket OAuth Client Secret | — |
| `SLACK_CLIENT_ID` | Slack OAuth Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack OAuth Client Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth Client Secret | — |
| `APPLE_CLIENT_ID` | Apple Services-ID für die Web-Anmeldung. Sie ist öffentlich und wird in `GET /auth/config` veröffentlicht. Apple hat kein statisches Client Secret, da Rebase für jeden Token-Austausch ein kurzlebiges ES256-JWT signiert. Apple benötigt daher `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` sowie diese Variable oder `APPLE_BUNDLE_IDS` und konfiguriert ohne diese nichts. | — |
| `APPLE_BUNDLE_IDS` | Kommagetrennte Bundle-IDs der nativen iOS/macOS-Apps, deren „Mit Apple anmelden“-Codes akzeptiert werden. | — |
| `APPLE_TEAM_ID` | Apple Developer Team-ID, der Aussteller (Issuer) des JWT. | — |
| `APPLE_KEY_ID` | Key-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten `.p8`-Schlüsseldatei, inklusive Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (Wird in Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Der öffentliche Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deploy, und er enthält nichts Geheimes. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` erlaubt er dem Admin-Gate, ein Plattform-Token für `cron:read` zu akzeptieren und für sonst nichts. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, mit der die `aud` eines Plattform-Tokens übereinstimmen muss, damit ein für ein anderes Projekt erstelltes Token abgelehnt wird. Wenn nur eine der beiden Variablen gesetzt ist, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Speicherort der Rate-Limit-Zähler für die Auth-Routen und für `rateLimit` in benutzerdefinierten Funktionen: `memory` (pro Prozess) oder `sql` (geteilt über Replikate). Ein Prozess kann seine eigene Replikat-Anzahl nicht einsehen; ein Deployment mit Peers muss dies daher angeben – drei Replikate auf dem Standardwert erzwingen das Dreifache des Limits. Jeder andere Wert **verhindert den Start**, anstatt auf einen Fallback zurückzugreifen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Aktiviert den passwortlosen Anmelde-Link-Ablauf. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwo hingehen kann. | `false` |
| `AUTH_EMAIL_OTP` | Aktiviert die passwortlose Anmeldung mit einem sechsstelligen, per E-Mail gesendeten Code. Gleiche E-Mail-Anforderung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Magic-Link- oder E-Mail-Code-Anfrage für eine unbekannte Adresse erstellt das Konto, sofern die Registrierung offen ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh-Token nach Ablauf seines Wiederverwendungsfensters erneut abgespielt wird: `reject` (ablehnen, Sitzung beibehalten) oder `revoke-session` (Sitzung beenden). Jeder andere Wert lässt den Start fehlschlagen. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrierung mit vorheriger Bestätigung: Keine Passwort-Anmeldung, bis die Adresse bestätigt ist. Erfordert E-Mail; der Start verweigert ohne diese den Dienst. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert die Captcha-Verifizierung auf den Auth-Routen: `turnstile` oder `hcaptcha`. Wenn ungesetzt, wird kein Captcha verwendet. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig verwendet wird, um das vom Browser gesendete Token zu verifizieren. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Auth-Routen (z. B. `register,login`). Wenn ungesetzt, wird der Standard-Satz des Anbieters geschützt. | — |

### Speicher (Storage)

:::caution[Storage hat keine Row-Level Security und benötigt daher ein Zugriffsmodell]
Tabellen werden durch Postgres-RLS geschützt. Objektspeicher hat kein Äquivalent –
Schlüssel teilen sich einen flachen Namensraum. Bei konfiguriertem Bucket und fehlendem Zugriffsmodell
**verweigert der Server in Produktion den Start**. Erfüllen Sie diese Anforderung mit genau einer der folgenden Optionen:
ein aus `backend/storage.ts` exportierter `storageAuthorize`-Hook (Standard des Scaffolds),
`STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `STORAGE_TYPE` | Speicher-Backend: `local`, `s3` oder `gcs`. In Produktion deaktiviert `local` den Speicher, es sei denn, `FORCE_LOCAL_STORAGE=true`. | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird aus dem Verzeichnis gelesen, in dem der Server läuft: das Projekt-Root unter `rebase dev`, `backend/` in einem von `rebase eject` erstellten Server. | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in Produktion erlauben – nur mit einem persistenten Volume, das `STORAGE_PATH` und die daneben liegenden `<STORAGE_PATH>__<key>`-Verzeichnisse benannter lokaler Buckets hält. | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Sekunden, die die Download-URL einer privaten Datei gültig ist – das Token, das `getSignedUrl()` hineinschreibt. Maximal `604800` (eine Woche). | `300` |
| `STORAGE_MAX_FILE_SIZE` | Größte Datei, die die Quelle akzeptiert, in Bytes, auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Ein nicht ganzzahliger Bytewert verweigert den Start. | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`). | — |
| `S3_REGION` | AWS-Region. | — |
| `S3_ACCESS_KEY_ID` | AWS-Access-Key. | — |
| `S3_SECRET_ACCESS_KEY` | AWS-Secret-Key. | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 etc.). | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für S3-Bucket erzwingen (`true`/`false`). | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`). | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für einen Bucket gedacht, der tatsächlich ein öffentliches CDN ist. Eine der drei Möglichkeiten, die Startprüfung unten zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jedem angemeldeten Aufrufer das Lesen, Schreiben, Auflisten und Löschen aller Objekte erlauben. Im Konfigurationsobjekt aus gutem Grund als `INSECURE` benannt: nur in einer Single-Tenant-App vertretbar, in der jedem Konto jede Datei anvertraut wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bildvarianten (Größenanpassungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu berechnen. | `false` |

### E-Mail (Optional)

| Variable | Beschreibung |
|----------|--------------|
| `SMTP_HOST` | SMTP-Server-Host |
| `SMTP_PORT` | SMTP-Server-Port |
| `SMTP_SECURE` | Sichere Verbindung aktivieren (`true`/`false`) |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | Absenderadresse für System-E-Mails |
| `SMTP_NAME` | Anzeigename der Absenderadresse |
| `APP_NAME` | Produktname, der in E-Mail-Betreffzeilen und -Texten verwendet wird (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo, das über den Standard-E-Mail-Vorlagen angezeigt wird. Absolute `http(s)`-PNG- oder JPG-URL – Clients entfernen SVG und blockieren `data:`-URIs. Wenn ungesetzt, erhält eine noch `Rebase` benannte App das Rebase-Zeichen und eine umbenannte App keines. |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `DB_POOL_MAX` | Maximale Anzahl gepoolter Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung gehalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine: `LISTEN`/`NOTIFY` überlebt einen Transaktions-Pooler wie PgBouncer nicht, und ohne sie werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, anstatt stillschweigend verloren zu gehen. Der [Job-Worker](/docs/backend/jobs) hält sein Aufwach-`LISTEN` ebenfalls darüber. Füllt `directConnectionString` des Postgres-Adapters, wenn dieser ungesetzt ist. | — |
| `DATABASE_READ_URL` | Read Replica, z. B. ein Hot Standby. Wenn hier ein anderer Server angegeben ist, werden authentifizierte Lesevorgänge (Listen, einzelne Zeilen, Counts, Aggregate) dort unter derselben Row-Level Security bedient; Schreibvorgänge, Anmeldungen, Realtime, Crons, Jobs, die SQL-Konsole und `rebase.sql` verbleiben auf der primären Datenbank. Ein Leser, der gerade geschrieben hat, liest für die Dauer von `REBASE_READ_STICKY_MS` von der primären Datenbank, und alle tun dies, solange das Replikat um mehr als `REBASE_READ_MAX_LAG_MS` hinterherhinkt oder fehlschlägt. Füllt `readConnectionString` des Postgres-Adapters, wenn dieser ungesetzt ist; bis einschließlich Version 0.28 wurde der Pool des Replikats geöffnet und nie daraus gelesen. | — |
| `REBASE_READ_STICKY_MS` | Nach einem Schreibvorgang: Wie lange Leseanfragen desselben Benutzers an die primäre Datenbank gehen, damit ein Speichervorgang gefolgt von einer Listenabfrage das Gespeicherte anzeigt. Pro Serverinstanz. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Replikat-Verzögerung, ab der jeder Lesevorgang an die primäre Datenbank geht. | `1000` |
| `DATABASE_POOLED` | `true`, wenn `DATABASE_URL` über einen Transaktionsmodus-Pooler wie PgBouncer läuft. Der Pool sendet dann beim Verbindungsaufbau kein `search_path` oder `statement_timeout` (der Pooler würde diese ablehnen oder verwerfen) und setzt beides in jeder Transaktion; der Start weist der Datenbankrolle ein Standard-`search_path` von `public` für Anweisungen außerhalb einer Transaktion zu. `DATABASE_DIRECT_URL` wird dadurch erforderlich, und Realtime, das Aufwecken des Job-Workers, Indexerstellungen, Branching und die SQL-Konsole verwenden diese. Die URL des Replikats wird ebenfalls als gepoolt angenommen. `DATABASE_POOLED__<KEY>` für eine andere Datenquelle. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was der jeweilige Pool angefordert hat. Nur Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server stillschweigend zu serialisieren. | — |

### Runtime-Verhalten

Gelesen von der Runtime – `rebase dev`, `rebase start` und dem veröffentlichten Server-Image.
Ein Projekt, für das `eject` ausgeführt wurde, steuert diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) aus, welches Tabellen meldet, die ohne Richtlinien bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime enthält keine Kopie, und ohne das Paket bricht der Start unter Nennung des Fehlers ab. `false` hält den Scan auf diesem Prozess deaktiviert. | — |
| `REBASE_RLS_REQUEST_ROLE` | Die Postgres-Rolle, unter der authentifizierte und anonyme Anfragen ausgeführt werden. Weisen Sie jedem Projekt auf einem geteilten Cluster eine eigene zu. Eine Datenbank zeichnet die Rolle auf, unter der sie läuft, und ein für eine andere konfigurierter Start verweigert die Ausführung, bis `rebase db request-role migrate` sie verschiebt. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` erstellt die Request-Rolle und erlaubt der Verbindung, zu ihr zu wechseln; `never` überlässt beides Ihnen und prüft sie nur. | `auto` |
| `REBASE_RLS_GRANTS` | Was Rebase der Request-Rolle gewährt: `schema` (jede Tabelle in den bereitgestellten Schemas plus Standardprivilegien), `managed` (nur die bereitgestellten Tabellen) oder `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` beschränkt die permissiven Richtlinien von Rebase auf die Request-Rolle(n), sodass andere Rollen, die dieselben Tabellen lesen, nichts daraus erhalten. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` schreibt Richtlinien, die nur der Serverkontext oder ein Administrator bestehen kann, `TO public` und führt Administratoren als Request-Rolle aus. Standardmäßig lauten sie `TO rebase_admin`, sodass owner-bezogene Lesevorgänge angemeldeter Benutzer den Owner-Index nutzen können. Siehe [Admin-Anfragen und `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` entfernt die Server-oder-Admin-Basisrichtlinie von jeder Tabelle. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` setzt zusätzlich `request.jwt.claims` und `request.jwt.claim.*`, sodass mit `auth.uid()` geschriebene Richtlinien den Aufrufer sehen. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Was beim Start geschieht, wenn ein anderes Login in die Request-Rolle wechseln kann: `warn`, `refuse` oder `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Dem Client muss dasselbe mitgeteilt werden – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische Assets und Admin-Assets des Bundles von diesem Prozess aus bereitstellen. Deaktivieren, wenn ein CDN davor geschaltet ist. | `true` |
| `REBASE_HISTORY` | [Entitäts-Änderungshistorie](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli-Antworten aktivieren. | `true` |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verweigert den Start, anstatt das Limit stillschweigend aufzuheben). `0` schaltet das Limit aus. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände möglich. Wenn ungesetzt, in jeder Umgebung: `/api/docs` wird den Aufrufern bereitgestellt, für die `GET /api/schema/tables` Tabellen beschreibt (jeweils das Dokument der für sie beschriebenen Tabellen), und es gibt keine Swagger-UI. `true` veröffentlicht das gesamte Dokument für alle, mit der Swagger-**UI** unter `/api/swagger` außerhalb der Produktion (niemals in Produktion). `false` hält das Dokument hinter dem Admin-Gate. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt `includeSubDomains` zum `Strict-Transport-Security`-Header hinzu, sodass Browser unverschlüsseltes HTTP auf jeder Subdomain des Hosts für sechs Monate verweigern – einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn jede Subdomain der Domain ausschließlich HTTPS verwendet. Jeder andere Wert als `true`/`false` verweigert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn ungesetzt, bleibt der Endpunkt für jeden erreichbar, der auf den Port zugreifen kann – in einem privaten Netzwerk in Ordnung, auf einem öffentlichen nicht, worauf die Start-Logs hinweisen. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start am Schema der Tabellen vornehmen darf. `ensure` (Standardwert überall – auch in Produktion) führt den **additiven** Durchlauf aus: Fehlende Tabellen, Spalten und Enum-Typen anlegen, niemals löschen oder umschreiben. `none` lässt das Schema der deklarierten Tabellen unberührt, aber die frameworkeigenen Tabellen (Auth, API-Keys, Jobs, Cron) werden weiterhin erstellt und aktuell gehalten; `REBASE_PROVISION=false` schaltet auch diese ab. Das veröffentlichte Image akzeptiert nur diese beiden Werte und **verweigert den Start bei `push`**. In einem [Split Deployment](/docs/deployment/split-processes) darf genau ein Prozess provisionieren; jede andere Rolle muss `none` setzen oder verweigert den Start. | `ensure` |
| `REBASE_PROVISION` | `false` sorgt dafür, dass die Runtime nichts in ihrer Datenbank ändert: Keine Tabelle, Spalte, kein Index, keine Funktion, kein Trigger, keine Richtlinie, Rolle oder Berechtigung, weder beim Start noch später – einschließlich der frameworkeigenen. Fehlendes wird stattdessen namentlich gemeldet. Für Datenbanken gedacht, die nur durch Ihren Änderungsprozess modifiziert werden dürfen. Siehe [Wenn nur Ihr Änderungsprozess die Datenbank ändern darf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Nur `true` und `false` werden akzeptiert. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Verweigert den Start, wenn die Datenbank zuletzt mit einem anderen Satz von Tabellen provisioniert wurde, als für diesen Prozess gebaut wurde. Wenn ungesetzt (oder alles andere als `true`/`1`), wird stattdessen gewarnt. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Verweigert den Start, wenn eine Funktions- oder Cron-Datei beim Importieren einen Fehler wirft oder nicht geparst werden kann, unter Nennung der Datei und des Grunds, sodass ein Rolling Deployment die alte Version weiter ausliefert. Auch ein Neustart wird daran gemessen. Wenn ungesetzt (oder alles andere als `true`), wird die Datei übersprungen und der Rest ausgeliefert. Eine Datei, die fehlerfrei importiert wird, aber keine Funktion oder keinen Job exportiert, wird immer übersprungen und nicht abgewiesen. | skip |
| `REALTIME_CDC` | Change Data Capture auf Datenbankebene: `auto` (Änderungen aus dem WAL lesen, wo die Datenbank dies erlaubt, andernfalls Trigger nutzen, andernfalls Fallback auf Anwendungsebene, wobei jeder Fallback als Info protokolliert wird), `trigger` (erzwingen, warnen falls unmöglich), `wal` (Änderungen aus dem Write-Ahead-Log statt über Trigger lesen; benötigt `wal_level=logical` und eine Rolle mit Replikationsrechten, andernfalls Fallback auf `trigger`), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Kanäle und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein instanziierter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Abonnements ein Realtime-Socket halten darf; das nächste wird mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Wie viele Realtime-Sockets ein Benutzer oder ein API-Schlüssel auf einer Serverinstanz offen halten darf. Identitätswechselnde Sockets eines Administrators werden dem Administrator angerechnet. Die Anmeldung des nächsten wird mit `TOO_MANY_SOCKETS` abgelehnt und der Socket geschlossen (4002); das SDK versucht es weiter, sodass er verbunden wird, wenn ein anderer schließt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Kein Limit |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Maximale Wartezeit in ms, bis eine Änderung durch das Refetch an Live-Abonnenten ausgeliefert wird. Ein Refetch wartet 300 ms ohne Änderung und bei einem stetigen Strom von Schreibvorgängen höchstens diese Zeitspanne. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Dauer in ms, für die der Gesamtwert eines Abonnements einer großen Liste wiederverwendet werden darf, bevor er erneut gezählt wird; Frames, die ihn wiederverwenden, tragen `meta.totalAsOf`. Wenn ungesetzt, zählt jeder Frame. Hat Vorrang vor `realtime.recountIntervalMs`. | Unset |
| `REALTIME_RECOUNT_MIN_ROWS` | Die kleinste letzte Gesamtanzahl, für die `REALTIME_RECOUNT_INTERVAL_MS` gilt; kleinere Listen werden bei jedem Frame gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`/Loopback-Werte unter `NODE_ENV=production`. Standardmäßig deaktiviert, sodass ein Produktionsstart deutlich fehlschlägt, anstatt sich mit einer nicht vorhandenen Datenbank zu verbinden. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet sich, ohne einen Socket zu öffnen – die Struktur, die ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der nachfolgende Server. Erstellt auch die Tabellen, die ein ausführender Prozess sonst bei der ersten Verwendung anlegen würde, und startet keine Cron- oder Job-Warteschlange. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht substituiertes `${SOMETHING}` in einer Compose-Datei ein normales Deployment nicht versehentlich in eines verwandeln kann, das migriert und die Bereitstellung verweigert. In Kombination mit `REBASE_PROVISION=false` nicht zulässig. | — |
| `REBASE_PROVISION_SQL_OUT` | Ein Dateipfad. Ein Provisionierungslauf (`REBASE_PROVISION_ONLY=true`) schreibt jede vorgenommene Schemaänderung der Reihe nach als SQL-Skript dorthin, um sie zu überprüfen und mit `psql` anzuwenden. Geschriebene Zeilen sind nicht enthalten. Auf einem Serverprozess nicht zulässig. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt einer Maschine – einem Agenten, einem CI-Job –, eine Schemaänderung über `/api/admin/schema` nicht nur zu planen, sondern auch *anzuwenden*. Deaktiviert, sofern nicht explizit angefordert: Die Anmeldedaten, die eine solche Änderung vornehmen könnten, befinden sich am ehesten in einer CI-Variable. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Maximale Laufzeit einer benutzerdefinierten Funktion, bevor ihr Request abgebrochen wird. Dieselbe Einstellung wie die Option `functionsTimeoutMs`. `0` deaktiviert das Limit. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` sorgt dafür, dass ein nicht abgefangener Promise-Fehler (Unhandled Rejection) den Prozess beendet, anstatt ihn nur zu protokollieren. Aktiviert unter einem Orchestrator, der den Prozess neu startet; deaktiviert, wo ein Neustart schlimmer ist als ein Leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Unterdrückt die Startwarnung auf Plattformen, die von der Runtime als Scale-to-Zero erkannt werden, auf denen ein Timer in einer inaktiven Instanz in gar keiner Instanz auslöst. Ändert sonst nichts: Setzen Sie dies, wenn Sie mindestens eine Instanz dauerhaft betreiben. | — |
| `TRUSTED_PROXY_HOPS` | Anzahl der vorgeschalteten Proxys vor diesem Server, damit der Rate-Limiter die reale Client-Adresse aus `X-Forwarded-For` auslesen kann. Ausfallsicherer Standardwert `0`: Ohne Proxy würde das Vertrauen in den Header jedem Aufrufer das Fälschen einer Identität ermöglichen. | `0` |

:::note[Start-Provisionierung ist additiv und kein Migrationswerkzeug]
Der Startdurchlauf läuft unbeaufsichtigt und ohne menschliche Prüfung eines Diffs;
er wird daher niemals eine Spalte löschen, einen Typ einschränken oder eine Tabelle
umschreiben. Aus diesem Grund verweigert das Image auch `REBASE_MIGRATE_ON_BOOT=push`:
Ein vollständiger Push berechnet ein Diff und führt bereitwillig `DROP COLUMN` aus –
ein Container-Neustart darf niemals in der Lage sein, eine Produktionsspalte als
Nebeneffekt eines Neuansetzens (Rescheduling) zu zerstören.

Destruktive oder umstrukturierende Änderungen verbleiben dort, wo sie überprüft werden können:
`rebase db generate` + `rebase db migrate`, oder `rebase db push` aus einem Checkout
oder der CI, was die Änderung trocken testet (Dry-Run), destruktive Änderungen ohne
Bestätigung verweigert und vorher ein Backup erstellen kann.
:::

### Split Deployments

Ein einzelnes Image und ein Bundle können mehrfach gestartet werden, wobei jede Instanz
einen anderen Teil des Projekts bedient. Hier ist jede Option einzeilig aufgeführt, da diese Seite
den Anspruch hat, alle Variablen zu listen; was jede Kombination *bereitstellt und verwaltet* –
und welche Kombinationen den Start verweigern –, finden Sie unter
**[Split Processes](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Wenn ungesetzt, richtet es sich nach der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Wenn ungesetzt, richtet es sich nach der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | Nur die genannten benutzerdefinierten Funktionen in diesem Prozess bereitstellen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen außer den genannten bereitstellen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. Auf einem `worker`, wohin dessen eigene `rebase.functions`-Aufrufe gehen. Eine `http(s)`-URL. | — |

### MCP-Schnittstelle

Ein optionaler Model Context Protocol-Endpunkt unter `/mcp`, damit ein KI-Client dieses Projekt
**als der angemeldete Benutzer** lesen und schreiben kann. Standardmäßig aus, sofern nicht gesetzt,
und – im Gegensatz zu jeder anderen Schnittstelle – schaltet kein `REBASE_ROLE` diesen ein:
Die anderen beschreiben eine Prozessform, während dies eine Entscheidung ist, Anmeldedaten
an Software von Drittanbietern zu übergeben; diese sollte von einem Menschen getroffen werden,
anstatt von der Aufgabenbezeichnung eines Containers geerbt zu werden.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_MCP_ENABLED` | Aktiviert die MCP-Schnittstelle. Erfordert `REBASE_PUBLIC_URL`; ohne diese wird die Schnittstelle nicht aktiviert, was im Start-Log vermerkt wird. | `false` |
| `REBASE_PUBLIC_URL` | Die extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Schnittstelle kann diese nicht ableiten – das Auslesen der Origin aus dem `Host`-Header würde die Ausstelleridentität und die Audience, gegen die ihre eigenen Tokens geprüft werden, zu einem vom Aufrufer manipulierbaren Wert machen. | — |
| `REBASE_MCP_VIEW` | Pfad zur projekteigenen MCP-App-Ansicht (`rebase-view.html`, generiert durch `rebaseMcpViewPlugin()`), die Claude anstelle der generischen Ansicht bereitgestellt wird, damit Ihre benutzerdefinierten Ansichten, Felder und Aktionen gerendert werden. Ohne diese sucht das Backend neben dem von ihm bereitgestellten Frontend. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Dynamische OAuth-Client-Registrierung (RFC 7591) erlauben, sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um eine vorherige Registrierung von Clients zu erzwingen. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Deaktiviert, sofern nicht `REBASE_LIVE_SCHEMA_REPOSITORY` gesetzt ist. Ein gebautes Bundle hat keine
`backend/schema`-Quellen zur Bearbeitung; sind diese Variablen gesetzt, liest der Schema-Editor
die Quelldateien aus dem Repository, committet jede Änderung dorthin zurück und führt sein DDL auf
dieser Datenbank aus. Nur für Admins und von Hand angewendet, es sei denn,
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` bestimmt etwas anderes. Ein angegebenes Repository
ohne nutzbare Anmeldedaten verweigert den Start. Siehe
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository für Schema-Commits im Format `owner/name`. Das Setzen dieser Variable aktiviert das Feature. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, auf dem der Commit landet. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Pfad zu `backend/schema` im Repository, relativ zum Repo-Root. Ein Pfad, der das Repository verlässt, verweigert den Start; ebenso das entfernte `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein fein abgestimmtes Token mit Lese- und Schreibzugriff auf den Repository-Inhalt. Setzen Sie entweder dies oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub-App, um als App statt mit einem Token zu committen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installations-ID der App auf dem Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit Escaped Newlines oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Wenn ungesetzt, sind geplante Backups deaktiviert. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. Erforderlich bei gesetztem `BACKUP_SCHEDULE`, das ohne diesen Wert die Ausführung verweigert. `rebase db backup` greift standardmäßig auf `./backups` am Ausführungsort zurück. | — |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Wenn ungesetzt oder `0`, wird alles aufbewahrt. | — |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens N der neuesten Backups aufbewahren, unabhängig von der Retention-Einstellung. | — |
| `PG_DUMP_PATH` | Überschreibt die `pg_dump`-Binärdatei – sie muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Überschreibt die `pg_restore`-Binärdatei. | — |
| `PSQL_PATH` | Überschreibt die `psql`-Binärdatei, die `rebase db restore --clean` ausführt, um den Restore in einer Transaktion durchzuführen. | — |
| `PG_DUMPALL_PATH` | Speicherort von `pg_dumpall`, wenn es nicht im `PATH` liegt. Ohne diese Angabe – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) liefert die PostgreSQL-18-Client-Tools
mit, sodass ein geplantes Backup darin gegen jeden Server bis einschließlich Postgres 18 läuft.
Installieren Sie diese außerhalb des Images selbst (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups enthalten Geheimnisse und personenbezogene Daten. Nutzen Sie ein privates Ziel
mit serverseitiger Verschlüsselung (Encryption-at-Rest).

### Bundle-Bereitstellung

Ein verwaltetes Deployment transportiert seinen Code nicht im Image: Die Runtime ruft beim
Start ein Bundle ab. Diese Variablen steuern, welches und wie.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Wird von `rebase start` lokal gesetzt. | — |
| `REBASE_BUNDLE_URL` | Ort, von dem das Bundle-Archiv abgerufen werden soll, wenn kein lokales existiert. | — |
| `REBASE_BUNDLE_TOKEN` | Das Bearer-Token für diesen Abruf. Behandeln Sie es als Geheimnis: Es autorisiert einen Mandanten zum Herunterladen seines eigenen Codes. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Ort, an den ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und zwischen Abruf und Start persistent bleiben. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image dem Bundle über die selbst deklarierten hinaus bereitstellt. | — |

### Ressourcen-Bindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `backend/resources.ts` deklariert,
wird über nach ihm benannte Umgebungsvariablen gebunden. Die Basisnamen stehen unten;
eine Nicht-Standard-Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an, sodass
ein Bucket namens `media` den Wert `S3_BUCKET__MEDIA` liest. `rebase status`
gibt pro Ressource die exakte Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, sofern es nicht der Standard-Postgres-Treiber ist. Erhält ein quellenspezifisches Suffix: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Erhält ein topic-spezifisches Suffix. | — |

### Die eigene Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hier hat Einfluss auf ein Deployment.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_BASE_URL` | Wohin `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service-Key senden, in der Shell oder in `.env`. Setzen Sie dies, wenn der Server auf andere Weise als über `rebase dev` in diesem Projekt läuft: `rebase start`, ein Container, ein anderer Host. Wenn ungesetzt, nutzen sie den Server, den `rebase dev` während der Laufzeit aufgezeichnet hat, und senden nichts, wenn er nicht läuft. | — |
| `REBASE_SERVICE_KEY` | Der Service-Key, mit dem sich diese Befehle authentifizieren, gelesen aus `.env`: dieselbe Variable, die auch der Server liest (siehe oben). | — |
| `SERVICE_KEY` | Ein älterer Name für diesen Schlüssel. Wenn in `.env` gesetzt, lesen `rebase api-keys` und `rebase storage` ihn anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env`-Datei die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_ROOT_RULES` | `0` verhindert, dass `rebase init` und `rebase skills install` die Regeln des Projekts in `CLAUDE.md` und `AGENTS.md` im Repository-Root schreiben – gedacht für Roots, deren Agenten-Dateien Sie manuell pflegen. | on |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, als das sich `rebase cloud login` anmeldet, anstatt interaktiv danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Dessen Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in der Shell-Historie landet. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der `rebase cloud login`-Sitzung und liest oder schreibt niemals die gespeicherte Sitzung. In einem Verzeichnis, das mit `rebase cloud init --claim` verknüpft wurde, wird es zugunsten des tokenspezifischen Tokens dieses Projekts zurückgestellt, wenn es keinen Scope für das Projekt besitzt. Der empfohlene Weg, um `rebase cloud` in der CI auszuführen – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) übergibt es an die CLI, die seine Cloud-Tools starten, und sendet es niemals an die App: Setzen Sie dafür `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt die zugrunde liegenden Fehler- und Anfragedetails anstelle der kurzen Nachricht aus. Der erste Schritt, wenn ein `rebase cloud`-Befehl ohne hilfreiche Meldung fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle der `<db>_dev_diff`, die sie neben `DATABASE_URL` erstellen. Rebase erstellt oder löscht hier angegebene Datenbanken nicht und verweigert eine Angabe, die mit `DATABASE_URL` identisch ist. Auf der verwalteten Entwicklungsdatenbank setzt die CLI dies auf ein eigenes, flüchtiges In-Memory-PGlite. Setzen Sie dies dort, wo `CREATE DATABASE` nicht gewährt ist. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und provisioniert nichts – Sie stellen Ihre eigene bereit. Entspricht `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixiert den Port des Frontend-Dev-Servers, den `rebase dev` andernfalls aus dem Projektpfad ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` darauf wartet, dass sich das Backend meldet, bevor es einen fehlgeschlagenen Start meldet. `0` deaktiviert die Meldung. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einfügt. | — |
| `DO_NOT_TRACK` | Die werkzeugübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe, spezifisch für Rebase. Benötigt keine Datei, weshalb es die bevorzugte Variante in der CI und in Images ist. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Zieladresse, an die Telemetriedaten gesendet werden, für einen selbst gehosteten Collector. | — |

## Secrets in der Entwicklung

`JWT_SECRET` ist in der Produktion erforderlich. Es und `REBASE_SERVICE_KEY` werden
außerhalb davon automatisch für Sie generiert, sodass Sie ohne jegliche Konfiguration starten können.

Diese generierten Werte werden in `.rebase-dev-secrets.json` gecacht, neben
`.rebase-dev-port` und `.rebase-dev-url` und zusammen mit diesen per Git ignoriert. Zuvor
wurden sie bei jedem Start neu generiert – ein Neustart des Dev-Servers meldete Sie daher
von Ihrer eigenen App ab und machte jeden soeben erstellten API-Schlüssel ungültig.

- Setzen Sie eine der beiden Variablen explizit, wird Ihr Wert verwendet; es wird nichts zwischengespeichert oder gelesen.
- Verlegen Sie den Cache mit `REBASE_DEV_SECRETS_FILE` an einen anderen Ort – ein Pfad und die
  einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets zu rotieren. Der nächste Start schreibt eine neue Datei.
- Kann die Datei nicht geschrieben werden – etwa in einem Read-Only-Container –, startet der Server
  dennoch mit einem flüchtigen Secret, genau wie zuvor.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion
wird auch nichts generiert: Ein Start ohne `JWT_SECRET` schlägt fehl und nennt die Variable;
dieses Verhalten bleibt unverändert:

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

Dieselben Optionen – ohne `app`, `server` und `basePath` und mit einem erforderlichen `provision` –
erstellen ein Backend, das nichts bedient, bis Sie es mounten: `createRebaseBackend`. Siehe
[Benutzerdefinierte Server-Integration](/docs/backend/custom-server/).

### Ändern von `basePath`

`basePath` verschiebt jede API-Route, daher muss dem Client dasselbe mitgeteilt werden –
andernfalls fragt er weiterhin `/api/...` an und erhält für alles einen 404-Fehler:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Das Admin-Panel übernimmt dies automatisch von dem Client, den es übergeben bekommt; sonst muss
nichts konfiguriert werden. Wenn Sie eine Request-URL manuell zusammensetzen, nutzen Sie den Client,
anstatt `/api` selbst zu schreiben:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### Keine Berechtigung im SQL-Editor (`permission denied for table <name>`)

* **Symptome:** Im SQL-Editor von Rebase Studio ausgeführte benutzerdefinierte Abfragen schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellenansicht (CMS) Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, SQL-Editor-Abfragen durch einen temporären Wechsel der Datenbankrollen passend zur Anwendungsrolle des aktiven Benutzers auszuführen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen und nicht als echte PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer des Verbindungseigentümers ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase dazu, SQL-Editor-Abfragen mit den Rechten des Verbindungseigentümers (in der Regel ein Superuser/Owner) auszuführen. Der SQL-Editor weist dann über den Ergebnissen darauf hin, dass diese als Verbindungseigentümer gelesen wurden, und graut die Rollenauswahl aus.

### Abruf des Datenbankschemas im SQL-Editor fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden oder der SQL-Editor wirft den Fehler `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Ursache:** Rebase benötigt administrative Rechte, um Datenbanksystemkataloge abzufragen und administrative Befehle auszuführen. Wenn dem Bootstrapper kein `adminConnectionString` übergeben wird oder `getAdmin()` so überschrieben ist, dass es `undefined` zurückgibt, schlagen diese Operationen fehl.
* **Lösung:** Stellen Sie sicher, dass `adminConnectionString` während der Initialisierung des Backend-Bootstrappers konfiguriert ist:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Nächste Schritte

- **[Bereitstellung](/docs/getting-started/deployment)** – Leitfaden für das Deployment in Produktion
- **[Backend-Übersicht](/docs/backend)** – Vollständige Referenz zur Backend-Konfiguration

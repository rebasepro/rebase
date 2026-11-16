---
sourceHash: cf61934167f91e79
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Stammverzeichnis des Projekts.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> etwas Erforderliches fehlt oder fehlerhaft formatiert ist (eine URL, die keine URL ist, ein Port,
> der keine Zahl ist), verweigert der Server den Start und nennt die entsprechende Variable.
>
> Wo sich das Schema befindet, hängt davon ab, wie Sie das Backend ausführen. Ein Projekt, das über
> die Runtime gestartet wird – `rebase dev`, `rebase start`, das veröffentlichte Image –, verwendet
> das Schema, das der Runtime gehört (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, für das [`rebase eject`](/docs/cli)
> ausgeführt wurde, besitzt eine `backend/src/env.ts`, die `loadEnv({ extend })` aufruft, und kann dort
> eigene typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge (Connection String). **Optional in der Entwicklung** – falls nicht gesetzt, führt `rebase dev` ein verwaltetes PostgreSQL für das Projekt aus, dessen Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktion erforderlich** (wird in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` ist eine node-postgres-Schreibweise, keine von libpq.**
>
> Rebase und der Node-Treiber akzeptieren dies – verschlüsseln, aber das
> Zertifikat nicht prüfen. `psql`, `pg_dump`, `pg_restore` und Atlas tun dies nicht
> und stufen nicht herab: Sie verweigern den Start mit `invalid sslmode value: "no-verify"`.
>
> Die Rebase-eigenen Befehle (`rebase db push`, `rebase db backup`, `rebase db
> restore`) schreiben dies vor der Befehlsausführung in das äquivalente `sslmode=require` um,
> sodass sie mit der konfigurierten URL funktionieren. Wenn Sie `psql` manuell aufrufen,
> geschieht dies nicht – ersetzen Sie es dort durch `sslmode=require`, was auf genau
> dieselbe Weise verschlüsselt, ohne zu verifizieren.

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** – siehe unten. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, daher injiziert der
> Dev-Server diese Variable. In der Produktion liefert das Rebase-Backend die SPA aus, sodass
> die API der eigene Origin der Seite ist und der Client dies von selbst so auflöst.
>
> Das feste Einbinden einer absoluten URL in ein Produktions-Bundle funktioniert genau so lange,
> bis ein zweiter Hostname auf dieselbe App verweist: Eine benutzerdefinierte Domain lädt die Seite
> dann von `example.com` und ruft die API unter `example.rebase.website` auf, was
> Cross-Origin ist, sodass jeder Request beim Preflight fehlschlägt. Das Erlauben des Origins in CORS
> behebt dies ebenfalls **nicht** – das Refresh-Cookie ist `SameSite=Lax` und wird nicht
> Cross-Site gesendet. Sie würden also die Konsolenfehler beheben und hätten immer noch eine defekte
> Authentifizierung. Wenn die Variable nicht gesetzt ist, funktioniert jede Domain, die auf die App verweist,
> ganz ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort nicht gelesen, da der Port aufgelöst wird, bevor diese Datei geladen wird – und bindet andernfalls einen Port, der vom Projektpfad abgeleitet wird, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beiden, und das Startbanner nennt die verwendete Stufe. | `3001` |
| `LOG_LEVEL` | Protokollierungs-Ausführlichkeit: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer Zeile `Failed query: [redacted]` an. Jedes fehlschlagende Statement wird standardmäßig bereinigt, da eine fehlgeschlagene Abfrage ihre gebundenen Parameter enthält – eine E-Mail, einen Passwort-Hash. Setzen Sie dies auf `true`, während Sie einen DDL-, RLS- oder Change-Capture-Fehler analysieren. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste erlaubter Origins. **In Produktion erforderlich**, es sei denn, `FRONTEND_URL` ist gesetzt: Ein Produktionsstart mit keinem von beiden verweigert den Dienst. In der Entwicklung wird dies zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu CORS_ORIGINS verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (für Schema-Introspektion und Admin-Operationen). Die darin angegebene Datenbank ist nicht diejenige, die die SQL-Konsole als aktuell bezeichnet, noch diejenige, die ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der sich die Verbindung der App selbst befindet (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert den PostgreSQL-Rollenwechsel im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Die SQL-Konsole von Studio gibt dann an, dass die Zeilen als Verbindungseigentümer gelesen wurden, nennt diesen und graut die Rollenauswahl aus. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies auf einem Checkout, der [zu einem Branch gewechselt wurde](/docs/backend/branching/#cli-integration). Ein Server mit dieser Einstellung behält die Branch-Registry auf dieser Datenbank und kopiert neue Branches standardmäßig davon, sodass das Branches-Panel von Studio die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

Die Entwicklungsumgebung erlaubt **localhost plus alles, was `CORS_ORIGINS` (oder `FRONTEND_URL`)
angibt** – dieselbe Liste, die die Produktion verwendet, wobei localhost hinzugefügt statt
ersetzt wird. Die Variable funktioniert also in beiden Umgebungen auf dieselbe Weise, und die
Fälle, in denen sie in der Entwicklung benötigt wird, sind die üblichen:

```bash
# Ein Telefon im LAN, der Rechner eines Kollegen, ein ngrok-Tunnel,
# ein weitergeleiteter Codespaces-Port – alles Origins ungleich localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Ein Origin, der weder localhost noch aufgeführt ist, wird abgelehnt, und die Ablehnung wird
**einmal pro Origin** mit der genauen Zeile protokolliert, die ihn zulassen würde. Die Ablehnung ist
keine Vorsicht um ihrer selbst willen: Die API sendet Anmeldedaten. Das Widerspiegeln eines
beliebigen `Origin` würde es jeder Website, die der Entwickler besucht, ermöglichen,
authentifizierte Anfragen mit dessen Sitzung an den Dev-Server zu stellen und die
Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Geheimnis für die JWT-Signierung (in Produktion erforderlich, in der Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Zugriffstokens (RS256), sodass jede Entität, die das JWKS besitzt, eine Sitzung überprüfen kann, ohne selbst Tokens erstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEM. Ohne diesen Schlüssel bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie dies bei jedem Schlüsselwechsel – eine Schlüsselrotation setzt voraus, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access-Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens. Gleitend (sliding) – jede Rotation verlängert ihn, dies regelt also, wie lange eine Sitzung bei **Inaktivität** überlebt. Setzen Sie `400d` für Sitzungen, die eine lange Abwesenheit überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Registrierung neuer Benutzer erlauben (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden einlassen, und dieser jemand wird zum Admin. In der Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein erster über eine offene Registrierung erstellter Account ist ein gewöhnlicher Account, und der Admin wird mit `REBASE_ADMIN_EMAIL` unten benannt oder mit dem Service-Schlüssel zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standardwert des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Notfallschalter (Kill Switch). Schließt das Erstbenutzer-Bootstrap-Fenster, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank geschlossen ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, da das Deployment sonst keine Möglichkeit hat, seinen ersten angemeldeten Aufrufer zu erzeugen. Jedes ausgelieferte Deployment-Artefakt setzt diesen Wert. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Admin-Kontos, das beim Start erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. Auf diese Weise erhält ein Produktions-Deployment seinen Admin: Der Betreiber benennt das erste Konto, anstatt mit dem Internet darum zu konkurrieren. Der Start warnt, wenn die Tabelle in Produktion leer und dieser Wert nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto wird nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Geheimnis. Wenn nicht gesetzt, werden die Geheimnisse stattdessen mit `JWT_SECRET` verschlüsselt und der Start gibt eine einmalige Warnung aus – eine Rotation von `JWT_SECRET` würde also alle Benutzer abmelden *und* jeden registrierten Authentifikator unentschlüsselbar machen. Legen Sie einen dedizierten Schlüssel (32+ Zufallszeichen) fest, bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *wegrotiert* wird. Setzen Sie während einer Rotation beide: Neue Geheimnisse werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende sind weiterhin lesbar, sodass niemand mitten in der Rotation aus seinem Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Geheimnis neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht an `ALLOW_REGISTRATION` gekoppelt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API verlangen. Auf `false` setzen für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Stellt `POST /api/auth/find-user` bereit, wodurch eine E-Mail-Adresse in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für Einladungsabläufe per E-Mail aufgelöst wird. Nur authentifizierte Aufrufer; gibt niemals die E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: Stellt eine Aufzählungsoberfläche dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite`-Attribut des Refresh-Cookies: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure`-Attribut des Refresh-Cookies. Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für einfaches HTTP – ein Deployment auf einer LAN-Adresse, bei dem der Browser das Cookie andernfalls verwerfen würde und die Sitzung nach Ablauf des Access-Tokens ohne Fehler enden würde. Gibt beim Start eine Warnung aus. `http://localhost` benötigt dies nicht. | `true` |
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
| `GITLAB_CLIENT_ID` | GitLab OAuth Client-ID. Die `baseUrl` einer selbst gehosteten Instanz hat keine Schreibweise als Umgebungsvariable – konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab OAuth Client Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket OAuth Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket OAuth Client Secret | — |
| `SLACK_CLIENT_ID` | Slack OAuth Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack OAuth Client Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth Client Secret | — |
| `APPLE_CLIENT_ID` | Apple Services-ID für die Web-Anmeldung. Sie ist öffentlich und wird in `GET /auth/config` veröffentlicht. Apple hat kein statisches Client Secret, da Rebase für jeden Token-Austausch ein kurzlebiges ES256-JWT signiert. Daher benötigt Apple `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` sowie diesen Wert oder `APPLE_BUNDLE_IDS` und konfiguriert ohne diese Angaben nichts. | — |
| `APPLE_BUNDLE_IDS` | Kommagetrennte Bundle-IDs der nativen iOS/macOS-Apps, deren „Mit Apple anmelden“-Codes akzeptiert werden. | — |
| `APPLE_TEAM_ID` | Apple Developer Team-ID, der Aussteller (Issuer) des JWT. | — |
| `APPLE_KEY_ID` | Key-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten Schlüsseldatei `.p8`, inklusive Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Der öffentliche Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deployment und er enthält keine Geheimnisse. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` ermöglicht er es dem Admin-Gate, ein Plattform-Token für `cron:read` zu akzeptieren – und für sonst nichts. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, mit der das `aud` eines Plattform-Tokens übereinstimmen muss, damit ein für ein anderes Projekt erstelltes Token abgelehnt wird. Wenn nur eine der beiden Variablen gesetzt ist, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Speicherort für Rate-Limit-Zähler für Auth-Routen und für `rateLimit` in benutzerdefinierten Funktionen: `memory` (pro Prozess) oder `sql` (über Replikate geteilt). Ein Prozess kann seine eigene Replikatanzahl nicht sehen; ein Deployment mit Peers muss dies daher angeben – drei Replikate beim Standardwert erzwingen das Dreifache des Limits. Jeder andere Wert **verweigert den Start**, anstatt ein Fallback zu nutzen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Aktiviert den passwortlosen Ablauf per Anmelde-Link. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Aktiviert die passwortlose Anmeldung mit einem sechsstelligen Code per E-Mail. Gleiche E-Mail-Anforderung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Magic-Link- oder E-Mail-Code-Anfrage für eine unbekannte Adresse erstellt das Konto, solange die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh-Token nach Ablauf seines Wiederverwendungsfensters erneut abgespielt wird: `reject` (ablehnen, Sitzung beibehalten) oder `revoke-session` (Anmeldung beenden). Jeder andere Wert führt zum Fehlschlagen des Serverstarts. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrierung mit vorheriger Bestätigung: Keine Passwortanmeldung, bis die Adresse bestätigt ist. Erfordert E-Mail; der Start wird ohne abgelehnt. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert die Captcha-Verifizierung auf Auth-Routen: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig verwendet wird, um das vom Browser gesendete Token zu verifizieren. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Auth-Routen (z. B. `register,login`). Nicht gesetzt schützt den Standard-Satz des Anbieters. | — |

### Storage

:::caution[Storage verfügt über keine Row-Level Security und benötigt daher ein Zugriffsmodell]
Tabellen werden durch Postgres-RLS geschützt. Für Object Storage gibt es kein Äquivalent –
Schlüssel teilen sich einen flachen Namensraum. Bei konfiguriertem Bucket und fehlendem Zugriffsmodell
**verweigert der Server in der Produktion den Start**. Erfüllen Sie dies mit genau einer der folgenden Optionen:
einem aus `backend/storage.ts` exportierten `storageAuthorize`-Hook (wird vom Scaffold
bereitgestellt), `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Storage-Backend: `local`, `s3` oder `gcs`. In Produktion deaktiviert `local` den Storage, es sei denn, `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird ausgehend von dem Verzeichnis gelesen, in dem der Server läuft: das Projekt-Stammverzeichnis unter `rebase dev`, `backend/` in einem von `rebase eject` erstellten Server | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in Produktion erlauben – nur mit einem persistenten Volume, das `STORAGE_PATH` und die danebenliegenden `<STORAGE_PATH>__<key>`-Verzeichnisse benannter lokaler Buckets enthält | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Sekunden, die die Download-URL einer privaten Datei gültig ist – das Token, das `getSignedUrl()` darin einfügt. Maximal `604800` (eine Woche) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Größte Datei, die die Quelle akzeptiert, in Bytes, auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Ein Wert, der keine ganze Byte-Zahl ist, verweigert den Start | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS-Access-Key | — |
| `S3_SECRET_ACCESS_KEY` | AWS-Secret-Key | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 etc.) | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für S3-Bucket erzwingen (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für einen Bucket gedacht, der tatsächlich ein öffentliches CDN ist. Eine der drei Möglichkeiten, den unten stehenden Startschutz zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jedem angemeldeten Aufrufer das Lesen, Schreiben, Auflisten und Löschen aller Objekte gestatten. Im Konfigurationsobjekt aus gutem Grund als `INSECURE` benannt: Dies ist nur in einer Single-Tenant-App vertretbar, in der jedem Account für jede Datei vertraut wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bildwiedergaben (Größenanpassungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu generieren. | `false` |

### E-Mail (Optional)

| Variable | Beschreibung |
|----------|-------------|
| `SMTP_HOST` | Host des SMTP-Servers |
| `SMTP_PORT` | Port des SMTP-Servers |
| `SMTP_SECURE` | Sichere Verbindung aktivieren (`true`/`false`) |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | Absenderadresse für System-E-Mails |
| `SMTP_NAME` | Anzeigename für die Absenderadresse |
| `APP_NAME` | Produktname, der in Betreffzeilen und E-Mail-Texten verwendet wird (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo, das oben in den Standard-E-Mail-Vorlagen angezeigt wird. Absolute `http(s)`-PNG- oder JPG-URL – E-Mail-Clients entfernen SVGs und blockieren `data:`-URIs. Wenn nicht gesetzt, erhält eine App, die noch `Rebase` heißt, das Rebase-Logo; eine umbenannte App erhält keines |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximale Anzahl gepoolter Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung gehalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine: `LISTEN`/`NOTIFY` übersteht keinen Transaktions-Pooler wie PgBouncer; ohne diese Verbindung werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, anstatt stillschweigend verloren zu gehen. Der [Job Worker](/docs/backend/jobs) hält sein Wake-up-`LISTEN` ebenfalls darüber. Füllt das `directConnectionString` des Postgres-Adapters, wenn dieses nicht gesetzt ist. | — |
| `DATABASE_READ_URL` | Read Replica, z. B. ein Hot Standby. Wenn hier ein anderer Server angegeben ist, werden authentifizierte Lesevorgänge (Listen, einzelne Zeilen, Counts, Aggregate) dort unter derselben Row-Level Security bedient; Schreibvorgänge, Anmeldungen, Realtime, Crons, Jobs, die SQL-Konsole und `rebase.sql` verbleiben auf dem Primary. Ein Leser, der gerade geschrieben hat, liest für `REBASE_READ_STICKY_MS` vom Primary; alle lesen vom Primary, solange das Replikat mehr als `REBASE_READ_MAX_LAG_MS` hinterherhinkt oder fehlschlägt. Füllt das `readConnectionString` des Postgres-Adapters, wenn dieses nicht gesetzt ist; bis einschließlich Version 0.28 wurde der Pool des Replikats geöffnet, aber nie daraus gelesen. | — |
| `REBASE_READ_STICKY_MS` | Wie lange nach einem Schreibvorgang die Lesevorgänge desselben Benutzers an den Primary gehen, damit ein Speichern gefolgt von einer Listenansicht die Änderung anzeigt. Pro Server-Instanz. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Replikat-Verzögerung (Lag), ab der jeder Lesevorgang an den Primary geht. | `1000` |
| `DATABASE_POOLED` | `true`, wenn `DATABASE_URL` über einen Pooler im Transaktionsmodus wie PgBouncer läuft. Der Pool sendet dann beim Verbinden kein `search_path` oder `statement_timeout` (der Pooler würde diese ablehnen oder verwerfen) und setzt beides in jeder Transaktion; der Start weist der Datenbankrolle ein Standard-`search_path` von `public` für Anweisungen außerhalb einer Transaktion zu. `DATABASE_DIRECT_URL` wird dadurch erforderlich, und Realtime, das Wake-up des Job Workers, Index-Erstellungen, Branching und die SQL-Konsole verwenden es. Die Replikat-URL wird ebenfalls als gepoolt angenommen. `DATABASE_POOLED__<KEY>` für eine weitere Datenquelle. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was jeder einzelne angefordert hat. Nur reine Ziffern: Ein ungültiger Wert wird ignoriert, anstatt den Server stillschweigend zu serialisieren. | — |

### Runtime-Verhalten

Wird von der Runtime gelesen – `rebase dev`, `rebase start` und dem veröffentlichten Server-Image.
Ein Projekt, für das ein Eject durchgeführt wurde, steuert diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) aus, das Tabellen meldet, die ohne Richtlinien bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime liefert keine Kopie mit, und ohne das Paket verweigert der Start den Dienst unter Nennung des Pakets. `false` hält den Scan von diesem Prozess fern. | — |
| `REBASE_RLS_REQUEST_ROLE` | Die Postgres-Rolle, unter der authentifizierte und anonyme Anfragen ausgeführt werden. Weisen Sie jedem Projekt auf einem gemeinsam genutzten Cluster eine eigene zu. Eine Datenbank zeichnet die Rolle auf, unter der sie läuft, und ein Start, der für eine andere Rolle konfiguriert ist, verweigert den Dienst, bis `rebase db request-role migrate` sie migriert. Siehe [Ausführen auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` erstellt die Request-Rolle und erlaubt der Verbindung, zu ihr zu wechseln; `never` überlässt beides Ihnen und überprüft sie lediglich. | `auto` |
| `REBASE_RLS_GRANTS` | Was Rebase der Request-Rolle gewährt: `schema` (jede Tabelle in den Schemas, die es bedient, plus Standardberechtigungen), `managed` (nur die Tabellen, die es bedient) oder `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` grenzt die permissiven Richtlinien von Rebase auf die Request-Rolle(n) ein, sodass andere Rollen, die dieselben Tabellen lesen, keine Rechte daraus erhalten. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` schreibt die Richtlinien, die nur der Serverkontext oder ein Admin erfüllen kann, `TO public` und führt Admins als Request-Rolle aus. Standardmäßig sind sie `TO rebase_admin`, sodass eigentümergefilterte Lesevorgänge angemeldeter Benutzer den Owner-Index verwenden können. Siehe [Admin-Anfragen und `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` entfernt die Basisrichtlinie für Server oder Admins von jeder Tabelle. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` setzt zusätzlich `request.jwt.claims` und `request.jwt.claim.*`, sodass Richtlinien, die mit `auth.uid()` geschrieben wurden, den Aufrufer sehen. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Verhalten beim Start, wenn ein anderer Login in die Request-Rolle wechseln kann: `warn`, `refuse` oder `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Basispfad für alle API-Routen. Dem Client muss dasselbe mitgeteilt werden – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische/Admin-Assets des Bundles von diesem Prozess aus bereitstellen. Deaktivieren Sie dies, wenn ein CDN vorgeschaltet ist. | `true` |
| `REBASE_HISTORY` | [Entitäts-Änderungshistorie](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli-Komprimierung für Antworten. | `true` |
| `REBASE_PUSH` | `true` aktiviert [Push-Benachrichtigungen](/docs/backend/push-notifications/): die Routen `/api/push`, die Tabelle `rebase.push_subscriptions` und `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Das VAPID-Schlüsselpaar, mit dem Push-Nachrichten signiert werden. Außerhalb der Produktion wird bei fehlender Konfiguration ein Paar generiert und in `.rebase-dev-secrets.json` gespeichert; in der Produktion bleibt Push ohne diese Schlüssel deaktiviert. | — |
| `REBASE_VAPID_SUBJECT` | Eine `mailto:`-Adresse oder `https://`-URL, die Push-Dienste kontaktieren können. Standardmäßig der Origin einer `https`-`REBASE_PUBLIC_URL`. | — |
| `REBASE_MAX_BODY_SIZE` | Maximale Größe des Request-Bodys **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verweigert den Start, anstatt das Limit stillschweigend aufzuheben). `0` schaltet das Limit aus. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Dreistufig. Nicht gesetzt in jeder Umgebung: `/api/docs` wird Aufrufern bereitgestellt, denen `GET /api/schema/tables` Tabellen beschreibt (jeweils das Dokument der Tabellen, die ihnen beschrieben werden), und es gibt kein Swagger-UI. `true` veröffentlicht das gesamte Dokument für jeden, mit der Swagger-**UI** unter `/api/swagger` außerhalb der Produktion (niemals in der Produktion). `false` hält das Dokument hinter dem Admin-Gate. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt `includeSubDomains` zum `Strict-Transport-Security`-Header hinzu, sodass Browser für sechs Monate einfaches HTTP auf jeder Subdomain des Hosts verweigern – einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn jede Subdomain der Domain ausschließlich HTTPS verwendet. Jeder Wert außer `true`/`false` verweigert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn nicht gesetzt, bleibt der Endpunkt für alles offen, was den Port erreichen kann – in Ordnung in einem privaten Netzwerk, nicht in einem öffentlichen, worauf die Startprotokolle hinweisen. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start am Schema der Tabellen durchführen darf. `ensure` (der Standardwert überall – einschließlich Produktion) führt den **additiven** Durchlauf aus: fehlende Tabellen, Spalten und Enum-Typen erstellen, niemals etwas löschen oder umschreiben. `none` lässt das Schema der deklarierten Tabellen unberührt, aber die frameworkeigenen Tabellen (Auth, API-Schlüssel, Jobs, Cron) werden weiterhin erstellt und aktuell gehalten; `REBASE_PROVISION=false` schaltet auch diese ab. Das veröffentlichte Image akzeptiert nur diese beiden Werte und **verweigert den Start bei `push`**. In einem [Split Deployment](/docs/deployment/split-processes) darf genau ein Prozess provisionieren, sodass jede andere Rolle `none` setzen muss oder den Start verweigert. | `ensure` |
| `REBASE_PROVISION` | `false` sorgt dafür, dass die Runtime nichts in ihrer Datenbank ändert: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Richtlinie, keine Rolle und keine Berechtigung, weder beim Start noch später – einschließlich der frameworkeigenen Objekte. Stattdessen wird gemeldet, was namentlich fehlt. Für eine Datenbank, die nur durch Ihren Änderungsprozess geändert werden darf. Siehe [Wenn nur Ihr Änderungsprozess die Datenbank ändern darf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Nur `true` und `false` werden akzeptiert. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Verweigert den Start, wenn die Datenbank zuletzt aus einer anderen Gruppe von Tabellen provisioniert wurde, als für diesen Prozess kompiliert wurde. Nicht gesetzt (oder alles außer `true`/`1`) gibt stattdessen eine Warnung aus. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Verweigert den Start, wenn eine Funktions- oder Cron-Datei beim Importieren einen Fehler wirft oder nicht geparst werden kann, und nennt jede Datei sowie den Grund, sodass bei einem Rolling Deploy die alte Version weiter bedient. Ein Neustart unterliegt denselben Bedingungen. Nicht gesetzt (oder alles außer `true`) überspringt die Datei und stellt den Rest bereit. Eine Datei, die fehlerfrei importiert wird und keine Funktion oder keinen Job exportiert, wird immer übersprungen und nicht abgewiesen. | skip |
| `REALTIME_CDC` | Change Capture auf Datenbankebene: `auto` (Änderungen aus dem WAL lesen, wo die Datenbank dies zulässt, andernfalls Trigger verwenden, andernfalls Fallback auf App-Ebene, wobei jeder Fallback als Info protokolliert wird), `trigger` (erzwingen, warnen falls unmöglich), `wal` (Änderungen aus dem Write-Ahead Log statt über Trigger lesen; erfordert `wal_level=logical` und eine Rolle mit Replikationsberechtigung, andernfalls Fallback auf `trigger`), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Kanäle und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein konstruierter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Abonnements ein einzelner Realtime-Socket halten darf; das nächste wird mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Wie viele Realtime-Sockets ein Benutzer oder ein API-Schlüssel auf einer Serverinstanz geöffnet halten darf. Die imitierenden (impersonating) Sockets eines Administrators zählen für den Administrator. Die Anmeldung des nächsten wird mit `TOO_MANY_SOCKETS` abgelehnt und der Socket geschlossen (4002); das SDK versucht es weiter, sodass er verbunden wird, wenn ein anderer Socket schließt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Kein Limit |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Die maximale Zeit in ms, die eine Änderung auf den Refetch wartet, der sie an aktive Abonnenten übermittelt. Ein Refetch wartet 300 ms ohne Änderung und bei einem kontinuierlichen Strom von Schreibvorgängen höchstens diese Zeit. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Wie lange der Gesamtwert (Total) eines Abonnements für große Listen in ms wiederverwendet werden darf, bevor er erneut gezählt wird; Frames, die ihn wiederverwenden, enthalten `meta.totalAsOf`. Wenn nicht gesetzt, zählt jeder Frame. Hat Vorrang vor `realtime.recountIntervalMs`. | Nicht gesetzt |
| `REALTIME_RECOUNT_MIN_ROWS` | Die kleinste Zeilenanzahl des letzten Gesamtwerts, für die `REALTIME_RECOUNT_INTERVAL_MS` gilt; kleinere Listen werden bei jedem Frame gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`/Loopback-Werte unter `NODE_ENV=production`. Standardmäßig deaktiviert, damit ein Produktionsstart deutlich fehlschlägt, anstatt sich mit einer Datenbank zu verbinden, die nicht existiert. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet sich, ohne einen Socket zu öffnen – genau das Verhalten, das ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der nachfolgende Server. Es erstellt auch die Tabellen, die ein bereitstellender Prozess sonst bei der ersten Verwendung anlegen würde, und startet weder Cron noch Job-Warteschlangen. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein gewöhnliches Deployment nicht versehentlich in eines verwandeln kann, das nur migriert und den Dienst verweigert. Wird zusammen mit `REBASE_PROVISION=false` abgelehnt. | — |
| `REBASE_PROVISION_SQL_OUT` | Ein Dateipfad. Ein Provisionierungslauf (`REBASE_PROVISION_ONLY=true`) schreibt jede vorgenommene Schemaänderung der Reihe nach als SQL-Skript in diese Datei, um sie mit `psql` zu überprüfen und anzuwenden. Geschriebene Datenzeilen sind nicht enthalten. Wird auf einem Prozess abgelehnt, der Anfragen bedient. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt es einer Maschine – einem Agenten, einem CI-Job –, eine Schemaänderung über `/api/admin/schema` tatsächlich *anzuwenden*, nicht nur zu planen. Deaktiviert, sofern nicht explizit angefordert: Die Anmeldedaten, die eine solche Änderung vornehmen könnten, befinden sich am ehesten in einer CI-Variable. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Wie lange eine benutzerdefinierte Funktion laufen darf, bevor ihre Anfrage abgebrochen wird. Derselbe Schalter wie die Option `functionsTimeoutMs`. `0` deaktiviert das Limit. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` bewirkt, dass eine unbehandelte Promise Rejection den Prozess beendet, anstatt ihn nur zu protokollieren. Aktiviert unter einem Orchestrator, der den Dienst neu startet; deaktiviert, wo ein Neustart schlimmer ist als ein Ressourcenleck. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Unterdrückt die Startwarnung auf einer Plattform, die von der Runtime als Scale-to-Zero erkannt wird, wo ein Timer, der in einer inaktiven Instanz ausgelöst wird, in keiner Instanz ausgeführt wird. Ändert sonst nichts: Setzen Sie dies, wenn Sie mindestens eine Instanz dauerhaft am Laufen halten. | — |
| `TRUSTED_PROXY_HOPS` | Wie viele Proxys diesem Server vorgeschaltet sind, damit der Rate-Limiter die echte Client-Adresse aus `X-Forwarded-For` lesen kann. Failsafe-Standardwert `0`: Ohne Proxy würde das Vertrauen in den Header jedem Aufrufer ermöglichen, eine gefälschte Identität vorzutäuschen. | `0` |

:::note[Boot-Provisionierung ist additiv und kein Migrationswerkzeug]
Der Startdurchlauf läuft unbeaufsichtigt ab, ohne dass jemand ein Diff prüft. Daher wird er niemals
eine Spalte löschen, einen Typ einschränken oder eine Tabelle neu schreiben. Das ist auch der Grund,
warum das Image `REBASE_MIGRATE_ON_BOOT=push` verweigert: Ein vollständiger Push berechnet ein Diff
und führt ohne Weiteres ein `DROP COLUMN` aus, und ein Container-Neustart darf niemals in der Lage sein,
eine Produktionsspalte als Nebeneffekt eines Neuplanungsprozesses (Rescheduling) zu zerstören.

Destruktive oder umstrukturierende Änderungen verbleiben dort, wo sie überprüft werden können: `rebase db
generate` + `rebase db migrate` oder `rebase db push` aus einem Checkout oder der CI,
was die Änderung trocken ausführt (Dry-Run), destruktive Änderungen ohne Bestätigung verweigert und
zuvor ein Backup erstellen kann.
:::

### Split Deployments

Ein einzelnes Image und ein Bundle können mehrfach gestartet werden, wobei jeder Prozess
einen anderen Teil des Projekts bedient. Hier ist jeweils eine Zeile aufgeführt, da diese Seite
den Anspruch erhebt, jede Variable aufzulisten; was jede Kombination *bereitstellt und verwaltet* –
und welche Kombinationen den Start verweigern –, finden Sie unter
**[Split-Prozesse](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Nicht gesetzt folgt der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Nicht gesetzt folgt der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | In diesem Prozess nur die benannten benutzerdefinierten Funktionen bereitstellen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen außer den benannten bereitstellen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. Auf einem `worker`, wohin seine eigenen `rebase.functions`-Aufrufe gehen. Eine `http(s)`-URL. | — |

### MCP-Schnittstelle

Ein optionaler Model Context Protocol-Endpunkt unter `/mcp`, damit ein KI-Client dieses Projekt
**als der angemeldete Benutzer** lesen und schreiben kann. Standardmäßig deaktiviert, und – im Gegensatz
zu jeder anderen Oberfläche – schaltet kein `REBASE_ROLE` diesen Endpunkt ein: Die anderen beschreiben
eine Prozessform, während dies die bewusste Entscheidung ist, Anmeldedaten an Software von Drittanbietern
zu übergeben. Diese Entscheidung sollte von einem Menschen getroffen und nicht von der Berufsbezeichnung
eines Containers geerbt werden.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Stellt die MCP-Schnittstelle bereit. Erfordert `REBASE_PUBLIC_URL`; ohne diese verweigert die Schnittstelle die Bereitstellung und gibt dies im Startprotokoll an. | `false` |
| `REBASE_PUBLIC_URL` | Der extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Schnittstelle kann ihn nicht ableiten – die Übernahme des Origins aus dem `Host`-Header würde die Identität des Ausstellers und die Zielgruppe (Audience), gegen die seine eigenen Tokens geprüft werden, zu einem vom Aufrufer bereitgestellten Wert machen. | — |
| `REBASE_MCP_VIEW` | Pfad zur projekteigenen MCP-App-Ansicht (`rebase-view.html`, geschrieben von `rebaseMcpViewPlugin()`), die Claude anstelle der generischen Ansicht bereitgestellt wird, damit Ihre benutzerdefinierten Ansichten, Felder und Aktionen dargestellt werden. Ohne diesen Pfad sucht das Backend neben dem von ihm bereitgestellten Frontend. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Dynamische OAuth-Client-Registrierung erlauben (RFC 7591), sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um zu verlangen, dass Clients im Voraus registriert werden. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Deaktiviert, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes Bundle enthält
keinen `backend/schema`-Quellcode zum Bearbeiten. Wenn diese Variablen gesetzt sind, liest der
Schema-Editor den Quellcode aus dem Repository, committet jede Änderung zurück und führt dessen DDL auf
dieser Datenbank aus. Nur für Admins und von einer Person angewendet, es sei denn,
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` gibt etwas anderes vor. Ein angegebenes Repository ohne
verwendbare Anmeldedaten verweigert den Start. Siehe
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository, in das Schemaänderungen committet werden sollen, als `owner/name`. Das Setzen dieser Variable aktiviert die Funktion. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, auf dem der Commit landet. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Wo sich `backend/schema` in diesem Repository befindet, relativ zum Repository. Ein Pfad, der das Repository verlässt, verweigert den Start, ebenso wie das entfernte `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein fein abgestimmtes Token (Fine-grained Token) mit Lese- und Schreibzugriff auf die Inhalte des Repositorys. Setzen Sie entweder dies oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub-App, um als App statt mit einem Token zu committen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installation der App auf dem Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit maskierten Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Nicht gesetzt bedeutet, dass geplante Backups deaktiviert sind. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. Erforderlich zusammen mit `BACKUP_SCHEDULE`, das ohne diesen Wert nicht ausgeführt wird. `rebase db backup` greift auf `./backups` an dem Ort zurück, an dem es ausgeführt wurde. | — |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Nicht gesetzt oder `0` behält alle Backups. | — |
| `BACKUP_KEEP_MINIMUM` | Behält immer mindestens N der neuesten Backups, unabhängig von der Aufbewahrungsrichtlinie. | — |
| `PG_DUMP_PATH` | Überschreibt die `pg_dump`-Binärdatei – sie muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Überschreibt die `pg_restore`-Binärdatei. | — |
| `PSQL_PATH` | Überschreibt die `psql`-Binärdatei, die `rebase db restore --clean` ausführt, um die Wiederherstellung in einer einzigen Transaktion auszuführen. | — |
| `PG_DUMPALL_PATH` | Speicherort von `pg_dumpall`, wenn es sich nicht im `PATH` befindet. Ohne diese Datei – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) enthält die PostgreSQL 18-Client-Tools,
sodass ein geplantes Backup darin gegen jeden Server bis einschließlich Postgres 18 ausgeführt werden kann.
Außerhalb des Images müssen Sie diese selbst installieren (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups enthalten Secrets und personenbezogene Daten (PII). Verwenden Sie ein privates Ziel mit
Ruhezustandsverschlüsselung (Encryption-at-Rest).

### Bundle-Bereitstellung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft beim Start
ein Bundle ab. Diese Variablen steuern, welches Bundle wie abgerufen wird.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Das, was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Ort, von dem das Bundle-Archiv abgerufen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Die Bearer-Anmeldedaten für diesen Abruf. Behandeln Sie dies als Geheimnis: Es autorisiert einen Mandanten, seinen eigenen Code herunterzuladen. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Verzeichnis, in das ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und die Zeit zwischen Abruf und Start überstehen. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image dem Bundle über die selbst deklarierten hinaus bereitstellt. | — |

### Ressourcen-Bindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `backend/resources.ts` deklariert,
wird durch entsprechend benannte Umgebungsvariablen gebunden. Die Basisnamen sind unten aufgeführt; eine
nicht standardmäßige Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an, sodass ein Bucket namens
`media` als `S3_BUCKET__MEDIA` gelesen wird. `rebase status` gibt pro Ressource
die genaue Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, wenn es nicht der standardmäßige Postgres-Treiber ist. Erhält ein Suffix pro Quelle: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Erhält ein Suffix pro Topic. | — |

### Die eigene Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hier beeinflusst ein Deployment.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Wohin `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service-Schlüssel senden, in der Shell oder in `.env`. Setzen Sie dies, wenn der Server auf andere Weise als über `rebase dev` in diesem Projekt läuft: `rebase start`, ein Container, ein anderer Host. Wenn nicht gesetzt, verwenden sie den von `rebase dev` erfassten Server, während dieser läuft, und senden nichts, wenn er nicht läuft. | — |
| `REBASE_SERVICE_KEY` | Der Service-Schlüssel, mit dem sich diese Befehle authentifizieren, gelesen aus `.env`: dieselbe Variable, die der Server liest (siehe oben). | — |
| `SERVICE_KEY` | Ein älterer Name für diesen Schlüssel. Wenn er in `.env` gesetzt ist, lesen `rebase api-keys` und `rebase storage` ihn anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env`-Datei die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_ROOT_RULES` | `0` verhindert, dass `rebase init` und `rebase skills install` die Projektregeln in die Dateien `CLAUDE.md` und `AGENTS.md` im Repository-Root schreiben – gedacht für ein Root-Verzeichnis, dessen Agenten-Dateien Sie manuell pflegen. | on |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, als das sich `rebase cloud login` anmeldet, anstatt danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Das zugehörige Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in die Shell-Historie gelangt. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der `rebase cloud login`-Sitzung und liest oder schreibt niemals die gespeicherte Sitzung. In einem Verzeichnis, das mit `rebase cloud init --claim` verknüpft wurde, wird es für das projekteigene Token zurückgestellt, wenn es keinen Scope für das Projekt besitzt. Die Methode zur Ausführung von `rebase cloud` in der CI – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) übergibt es an die CLI, die seine Cloud-Tools starten, und sendet es niemals an die App: Setzen Sie dafür `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt den zugrunde liegenden Fehler und die Anfragedetails anstelle der kurzen Nachricht aus. Das Erste, was Sie setzen sollten, wenn ein `rebase cloud`-Befehl ohne hilfreiche Meldung fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle der Datenbank `<db>_dev_diff`, die sie neben `DATABASE_URL` erstellen. Rebase erstellt oder löscht keine hier benannte Datenbank und verweigert eine, die mit `DATABASE_URL` identisch ist. Bei der verwalteten Entwicklungsdatenbank setzt die CLI dies auf ein eigenes, flüchtiges In-Memory-PGlite. Setzen Sie dies dort ein, wo `CREATE DATABASE` nicht gewährt wird. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und provisioniert nichts – Sie bringen Ihre eigene mit. Entspricht `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Legt den Port des Frontend-Dev-Servers fest, den `rebase dev` andernfalls aus dem Pfad des Projekts ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` darauf wartet, dass sich das Backend meldet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert den Bericht. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einfügt. | — |
| `DO_NOT_TRACK` | Die toolübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe, spezifisch für Rebase. Benötigt keine Datei, weshalb dies die Variante ist, die in der CI und in einem Image verwendet werden sollte. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Wohin Telemetriedaten gesendet werden, für einen selbst gehosteten Collector. | — |

## Secrets in der Entwicklung

`JWT_SECRET` ist in der Produktion erforderlich. Es und `REBASE_SERVICE_KEY` werden
außerhalb der Produktion automatisch für Sie generiert, sodass Sie starten können, ohne etwas einrichten zu müssen.

Diese generierten Werte werden in `.rebase-dev-secrets.json` neben
`.rebase-dev-port` und `.rebase-dev-url` zwischengespeichert und mit diesen git-ignoriert. Zuvor
wurden sie bei jedem Start neu generiert – ein Neustart des Dev-Servers meldete Sie daher von
Ihrer eigenen App ab und machte jeden gerade erstellten API-Schlüssel ungültig.

- Setzen Sie eine der beiden Variablen explizit, wird Ihr Wert verwendet; es wird nichts zwischengespeichert oder gelesen.
- Verweisen Sie den Cache mit `REBASE_DEV_SECRETS_FILE` an einen anderen Ort – ein Pfad und die
  einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets neu zu generieren (Rotation). Beim nächsten Start wird eine neue Datei geschrieben.
- Wenn die Datei nicht geschrieben werden kann – beispielsweise in einem schreibgeschützten Container –, startet der Server
  dennoch mit einem flüchtigen Secret, genau wie zuvor.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion
wird auch nichts generiert: Ein Start ohne `JWT_SECRET` schlägt unter Nennung der Variable fehl, und
dieses Verhalten bleibt unverändert:

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
ohne `app`, `server` und `basePath` sowie mit einem erforderlichen `provision` – erstellen ein
Backend, das nichts bereitstellt, bis Sie es mounten: `createRebaseBackend`. Siehe
[Benutzerdefinierte Server-Integration](/docs/backend/custom-server/).

### Ändern von `basePath`

`basePath` verschiebt jede API-Route, daher muss dem Client dasselbe mitgeteilt werden –
andernfalls fragt er weiterhin nach `/api/...` und erhält für alles einen 404:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Das Admin-Panel übernimmt dies von dem Client, der ihm übergeben wird; es muss nichts
weiter konfiguriert werden. Wenn Sie eine Anfrage-URL manuell erstellen, verbinden Sie diese über den Client,
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

* **Symptome:** Benutzerdefinierte Abfragen, die im SQL-Editor von Rebase Studio ausgeführt werden, schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellen-CMS-Ansicht Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, Abfragen im SQL-Editor auszuführen, indem temporär die Datenbankrollen gewechselt werden, um der Anwendungsrolle des aktiven Benutzers zu entsprechen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen und nicht als tatsächliche PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer des Verbindungseigentümers ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase dazu, Abfragen im SQL-Editor mit den Berechtigungen des Verbindungseigentümers (in der Regel ein Superuser/Owner) auszuführen. Der SQL-Editor zeigt dann über den Ergebnissen an, dass diese als Verbindungseigentümer gelesen wurden, und graut die Rollenauswahl aus.

### Schema-Abruf im SQL-Editor fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio lädt den Schemabaum nicht oder der SQL-Editor wirft den Fehler `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Ursache:** Rebase benötigt administrative Berechtigungen, um Datenbank-Systemkataloge abzufragen und administrative Befehle auszuführen. Wenn `adminConnectionString` dem Bootstrapper nicht bereitgestellt wird oder `getAdmin()` so überschrieben ist, dass es `undefined` zurückgibt, schlagen diese Operationen fehl.
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

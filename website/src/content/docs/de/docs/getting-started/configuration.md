---
sourceHash: a6ecab532bd0be01
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projekt-Root.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> etwas Erforderliches fehlt oder fehlerhaft formatiert ist (eine URL, die keine URL ist, ein Port,
> der keine Zahl ist), verweigert der Server den Start und nennt die Variable.
>
> Wo das Schema liegt, hängt davon ab, wie Sie das Backend ausführen. Ein Projekt, das
> über die Runtime gestartet wird – `rebase dev`, `rebase start`, das veröffentlichte Image –, verwendet
> das Schema, das der Runtime gehört (`loadBootEnv` in `@rebasepro/server`), was die
> Vereinigung jeder unten aufgeführten Tabelle darstellt. Ein Projekt, das [`rebase eject`](/docs/cli)
> ausgeführt hat, besitzt eine `backend/src/env.ts`, die `loadEnv({ extend })` aufruft, und kann dort eigene
> typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge (Connection String). **In der Entwicklung optional** – wenn nicht gesetzt, führt `rebase dev` eine verwaltete PostgreSQL-Instanz für das Projekt aus, deren Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktion erforderlich** (in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` ist eine Schreibweise von node-postgres, nicht von libpq.**
>
> Rebase und der Node-Treiber akzeptieren dies – verschlüsseln, aber das
> Zertifikat nicht prüfen. `psql`, `pg_dump`, `pg_restore` und Atlas tun dies nicht und
> verhalten sich nicht abwärtskompatibel: Sie verweigern den Start mit `invalid sslmode value: "no-verify"`.
>
> Die Rebase-eigenen Befehle (`rebase db push`, `rebase db backup`, `rebase db
> restore`) schreiben dies vor dem Shell-Aufruf in das äquivalente `sslmode=require` um,
> sodass sie mit der konfigurierten URL funktionieren. Der manuelle Aufruf von `psql` tut dies
> nicht – tauschen Sie dort `sslmode=require` aus, was auf genau dieselbe Weise
> ohne Verifizierung verschlüsselt.

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das Client-SDK. **Nur in der Entwicklung setzen** – siehe unten. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Google-OAuth-Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend separate Origins, daher schleust der Dev-Server
> dies ein. In der Produktion liefert das Rebase-Backend die SPA aus, sodass die
> API die eigene Origin der Seite ist und der Client sie auf diese Weise selbst auflöst.
>
> Das Einbetten einer absoluten URL in ein Produktions-Bundle funktioniert so lange, bis ein zweiter
> Hostname auf dieselbe App verweist: Eine benutzerdefinierte Domain lädt dann die Seite von
> `example.com` und ruft die API auf `example.rebase.website` auf, was
> Cross-Origin ist, sodass jeder Request beim Preflight fehlschlägt. Das Erlauben der Origin in CORS
> behebt dies ebenfalls **nicht** – das Refresh-Cookie ist `SameSite=Lax` und wird nicht
> Cross-Site gesendet, sodass Sie zwar die Konsolenfehler beseitigen würden, die Authentifizierung aber
> dennoch defekt wäre. Wenn es ungesetzt bleibt, funktioniert jede Domain, die auf die App verweist,
> völlig ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **ausschließlich aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort nicht gelesen, da der Port aufgelöst wird, bevor diese Datei geladen wird – und bindet andernfalls einen Port, der aus dem Projektpfad abgeleitet wird, sodass mehrere Projekte gleichzeitig ausgeführt werden können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner nennt die gewählte Stufe. | `3001` |
| `LOG_LEVEL` | Logging-Ausführlichkeit: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer Zeile wie `Failed query: [redacted]` an. Jede fehlschlagende Anweisung wird standardmäßig zensiert (redacted), da eine fehlgeschlagene Query ihre gebundenen Parameter enthält – eine E-Mail-Adresse, einen Passwort-Hash. Setzen Sie dies auf `true`, wenn Sie einen DDL-, RLS- oder Change-Capture-Fehler analysieren. Wird ignoriert, wenn `NODE_ENV=production` ist. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste erlaubter Origins. **In der Produktion erforderlich**, wenn sie sich von der Backend-Domain unterscheiden. In der Entwicklung wird sie zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu CORS_ORIGINS verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge mit Administratorrechten (wird für Schema-Introspektion und Admin-Operationen verwendet). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert das Wechseln von PostgreSQL-Rollen im SQL Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). | `false` |

#### CORS in der Entwicklung

Die Entwicklungsumgebung erlaubt **localhost plus alles, was `CORS_ORIGINS` (oder `FRONTEND_URL`)
benennt** – dieselbe Liste, die die Produktion verwendet, wobei localhost hinzugefügt statt
ersetzt wird. Die Variable funktioniert also in beiden Umgebungen auf dieselbe Weise, und die
Fälle, die sie in der Entwicklung benötigen, sind die typischen:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Eine Origin, die weder localhost noch aufgeführt ist, wird abgewiesen, und die Abweisung wird
**einmal pro Origin** mit der genauen Zeile protokolliert, die sie zulassen würde. Das Abweisen ist
keine Vorsicht um ihrer selbst willen: Die API sendet Anmeldedaten (Credentials). Das bloße Reflektieren
einer beliebigen `Origin` würde es jeder Website, die der Entwickler zufällig besucht, ermöglichen,
authentifizierte Anfragen mit dessen Sitzung an den Dev-Server zu stellen und die
Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Geheimnis für die JWT-Signierung (in Produktion erforderlich, in Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Access Tokens (RS256), sodass jede Instanz, die das JWKS besitzt, eine Sitzung verifizieren kann, ohne selbst eine erstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEM. Ohne diese Angabe bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie dies bei jedem Schlüsselwechsel – die Rotation hängt davon ab, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh Tokens. Gleitend – jede Rotation verlängert ihn, bestimmt also, wie lange eine Sitzung bei **Inaktivität** überlebt. | `400d` |
| `ALLOW_REGISTRATION` | Registrierung neuer Benutzer erlauben (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden zulassen, und dieser wird zum Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Zeitfenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein erster über die offene Registrierung erstellter Account ist ein gewöhnlicher Benutzer, und der Administrator wird unten über `REBASE_ADMIN_EMAIL` benannt oder über den Service-Schlüssel zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standard des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Not-Aus-Schalter (Kill Switch). Schließt das Bootstrap-Fenster für den ersten Benutzer, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank geschlossen ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` weiter unten, da das Deployment sonst keine Möglichkeit hat, seinen ersten angemeldeten Aufrufer zu erstellen. Jedes ausgelieferte Deployment-Artefakt setzt diesen Wert. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Admin-Kontos, das beim Booten erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. Auf diese Weise erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt mit dem Internet darum zu konkurrieren. Beim Booten wird gewarnt, wenn die Tabelle in der Produktion leer ist und dieser Wert nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto nicht erstellt. Nach der ersten Anmeldung ändern. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Geheimnis. Wenn nicht gesetzt, werden die Geheimnisse stattdessen mit `JWT_SECRET` verschlüsselt und beim Start wird einmal gewarnt – eine Rotation von `JWT_SECRET` meldet somit alle Benutzer ab *und* macht jeden registrierten Authentifikator unentschlüsselbar. Legen Sie einen dedizierten Schlüssel (32+ Zufallszeichen) fest, bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *wegrotiert* wird. Setzen Sie während einer Rotation beide: Neue Geheimnisse werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende sind weiterhin lesbar, sodass niemand mitten in der Rotation aus seinem Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Geheimnis neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht durch `ALLOW_REGISTRATION` beschränkt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API vorschreiben. Auf `false` setzen für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Stellt `POST /api/auth/find-user` bereit, wodurch eine E-Mail-Adresse in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für Einladungsabläufe aufgelöst wird. Nur für authentifizierte Aufrufer, und es gibt niemals E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: Es stellt eine Angriffsfläche für Aufzählungsangriffe (Enumeration Surface) dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` für das Refresh-Cookie: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` für das Refresh-Cookie. Standardmäßig sicher (true); `AUTH_COOKIE_SECURE=false` für reines HTTP – ein Deployment auf einer LAN-Adresse, bei dem der Browser das Cookie andernfalls verwerfen würde und die Sitzung beim Ablauf des Access Tokens ohne Fehler enden würde. Gibt beim Booten eine Warnung aus. `http://localhost` benötigt dies nicht. | `true` |
| `GOOGLE_CLIENT_ID` | Google-OAuth-Client-ID (Backend-Validierung) | — |
| `GOOGLE_CLIENT_SECRET` | Google-OAuth-Client-Secret | — |
| `GITHUB_CLIENT_ID` | GitHub-OAuth-Client-ID | — |
| `GITHUB_CLIENT_SECRET` | GitHub-OAuth-Client-Secret | — |
| `MICROSOFT_CLIENT_ID` | Microsoft-OAuth-Client-ID | — |
| `MICROSOFT_CLIENT_SECRET` | Microsoft-OAuth-Client-Secret | — |
| `LINKEDIN_CLIENT_ID` | LinkedIn-OAuth-Client-ID | — |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn-OAuth-Client-Secret | — |
| `FACEBOOK_CLIENT_ID` | Facebook-OAuth-Client-ID | — |
| `FACEBOOK_CLIENT_SECRET` | Facebook-OAuth-Client-Secret | — |
| `TWITTER_CLIENT_ID` | X/Twitter-OAuth-Client-ID | — |
| `TWITTER_CLIENT_SECRET` | X/Twitter-OAuth-Client-Secret | — |
| `DISCORD_CLIENT_ID` | Discord-OAuth-Client-ID | — |
| `DISCORD_CLIENT_SECRET` | Discord-OAuth-Client-Secret | — |
| `GITLAB_CLIENT_ID` | GitLab-OAuth-Client-ID. Die `baseUrl` einer selbst gehosteten Instanz hat keine Umgebungsvariable – konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab-OAuth-Client-Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket-OAuth-Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket-OAuth-Client-Secret | — |
| `SLACK_CLIENT_ID` | Slack-OAuth-Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack-OAuth-Client-Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify-OAuth-Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify-OAuth-Client-Secret | — |
| `APPLE_CLIENT_ID` | Apple-Services-ID. Apple hat kein statisches Client-Secret – Rebase signiert ein kurzlebiges ES256-JWT pro Token-Austausch –, daher werden alle vier `APPLE_*`-Werte benötigt, und ohne sie wird nichts konfiguriert. | — |
| `APPLE_TEAM_ID` | Apple Developer Team-ID, der Aussteller (Issuer) des JWT. | — |
| `APPLE_KEY_ID` | Key-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten Schlüsseldatei `.p8`, inklusive Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch generiert). | — |
| `REBASE_RATE_LIMIT_STORE` | Wo die Zähler für das Auth-Rate-Limiting gespeichert werden: `memory` (pro Prozess) oder `sql` (über Replikate hinweg geteilt). Ein Prozess kann seine eigene Replikatanzahl nicht sehen, daher muss ein Deployment mit mehreren Instanzen dies deklarieren – drei Replikate beim Standardwert setzen das Dreifache des Limits durch. Jeder andere Wert **verweigert den Start**, anstatt auf einen Fallback zurückzugreifen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Bindet den passwortlosen Anmeldelink-Flow ein. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Bindet die passwortlose Anmeldung mit einem sechsstelligen Code ein, der per E-Mail gesendet wird. Gleiche E-Mail-Anforderung wie oben. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert die Captcha-Verifizierung auf den Auth-Routen: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Geheimnis des Anbieters, das serverseitig verwendet wird, um das vom Browser gesendete Token zu verifizieren. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Auth-Routen (z. B. `register,login`). Nicht gesetzt schützt den Standard-Satz des Anbieters. | — |

### Storage

:::caution[Storage hat keine Row-Level-Security, benötigt also ein Zugriffsmodell]
Collections werden durch Postgres RLS geschützt. Object Storage hat keine Entsprechung –
Keys teilen sich einen einzigen flachen Namespace –, daher **verweigert der Server in der Produktion den Start**,
wenn ein Bucket konfiguriert ist, aber kein Zugriffsmodell vorliegt. Erfüllen Sie dies mit genau einer der folgenden Optionen:
einem aus `config/index.ts` exportierten `storageAuthorize`-Hook (Standard des Scaffolds),
`STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Speicher-Backend: `local`, `s3` oder `gcs`. In der Produktion deaktiviert `local` den Speicher, es sei denn, `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in der Produktion erlauben – nur mit einem unter `STORAGE_PATH` gemounteten persistenten Volume (durable volume) | `false` |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS-Zugriffsschlüssel (Access Key) | — |
| `S3_SECRET_ACCESS_KEY` | AWS-Geheimschlüssel (Secret Key) | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 usw.) | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für S3-Bucket erzwingen (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für einen Bucket gedacht, der tatsächlich ein öffentliches CDN ist. Eine der drei Möglichkeiten, den unten genannten Boot-Schutz zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jedem angemeldeten Aufrufer das Lesen, Schreiben, Auflisten und Löschen aller Objekte erlauben. Im Konfigurationsobjekt aus gutem Grund als `INSECURE` benannt: Es ist nur in einer Single-Tenant-App vertretbar, in der jedem Konto bezüglich jeder Datei vertraut wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bildausgabevarianten (Renditions: Skalierungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu erzeugen. | `false` |

### E-Mail (Optional)

| Variable | Beschreibung |
|----------|-------------|
| `SMTP_HOST` | SMTP-Server-Host |
| `SMTP_PORT` | SMTP-Server-Port |
| `SMTP_SECURE` | Sichere Verbindung aktivieren (`true`/`false`) |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | Absenderadresse für System-E-Mails |
| `SMTP_NAME` | Anzeigename der Absenderadresse |
| `APP_NAME` | Produktname, der in E-Mail-Betreffzeilen und -Texten verwendet wird (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo, das über den Standard-E-Mail-Vorlagen angezeigt wird. Absolute `http(s)`-PNG- oder JPG-URL – Clients entfernen SVG und blockieren `data:`-URIs. Wenn nicht gesetzt, erhält eine App, die noch `Rebase` heißt, das Rebase-Zeichen, und eine umbenannte App keines |

### Datenbank-Verbindungspool (Connection Pool)

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximale Anzahl gepoolter Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung gehalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine: `LISTEN`/`NOTIFY` funktioniert nicht über einen Transaktions-Pooler wie PgBouncer; ohne diese Einstellung werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, anstatt stillschweigend verloren zu gehen. | — |
| `DATABASE_READ_URL` | Read-Replica. Lesezugriffe gehen dorthin, wenn gesetzt und von `DATABASE_URL` abweichend; schlägt die Verbindung fehl, fällt alles mit einer Warnung auf die primäre Datenbank zurück. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was jeder einzelne angefordert hat. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server stillschweigend zu serialisieren. | — |

### Laufzeitverhalten (Runtime Behaviour)

Wird von der Runtime gelesen – `rebase dev`, `rebase start` und dem veröffentlichten
Server-Image. Ein Projekt, das ausgeklinkt wurde (ejected), steuert diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Führt das Row-Level-Security-Audit beim Start aus und bindet dessen Endpunkt ein, der Tabellen meldet, die ohne Richtlinien (Policies) bereitgestellt werden. | — |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Dem Client muss dasselbe mitgeteilt werden – siehe [Ändern von `basePath`](#changing-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische/Admin-Assets des Bundles aus diesem Prozess ausliefern. Deaktivieren, wenn ein CDN davor geschaltet ist. | `true` |
| `REBASE_HISTORY` | [Änderungshistorie von Entitäten](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli-Antworten komprimieren. | `true` |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body, **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verweigert den Start, anstatt das Limit stillschweigend aufzuheben). | — |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände: Nicht gesetzt bedeutet in der Entwicklung aktiviert, in der Produktion deaktiviert; `false` deaktiviert sie überall. Beachten Sie, dass `true` in der Produktion die **Spezifikation** unter `/api/docs` bereitstellt, aber nicht die Swagger-**UI** unter `/api/swagger` – die UI wird separat über `NODE_ENV` gesteuert. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn nicht gesetzt, bleibt der Endpunkt für alles offen, was den Port erreichen kann – in einem privaten Netzwerk in Ordnung, in einem öffentlichen nicht, worauf die Boot-Logs hinweisen. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start mit dem Schema tun darf. `ensure` (der Standardwert überall – einschließlich Produktion) führt den **additiven** Durchlauf aus: Fehlende Tabellen, Spalten und Enum-Typen anlegen, niemals etwas löschen oder umschreiben. `none` rührt nichts an. Das veröffentlichte Image akzeptiert nur diese beiden und **verweigert den Start bei `push`**. In einem [Split Deployment](/docs/deployment/split-processes) darf genau ein Prozess bereitstellen (provision), daher müssen alle anderen Rollen `none` setzen oder den Start verweigern. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Verweigert den Start, wenn die Datenbank zuletzt aus einem anderen Satz von Collections bereitgestellt wurde, als aus dem dieser Prozess gebaut wurde. Nicht gesetzt (oder alles andere als `true`/`1`) gibt stattdessen eine Warnung aus. | warn |
| `REALTIME_CDC` | Change-Capture auf Datenbankebene: `auto` (aktivieren, wo die Verbindung es unterstützt, andernfalls stillschweigender Fallback), `trigger` (erzwingen, warnen falls unmöglich), `wal` (fällt aktuell auf `trigger` zurück), `off`. Siehe [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Channels und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein konstruierter Transport übergeben wurde. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`/Loopback-Werte unter `NODE_ENV=production`. Standardmäßig deaktiviert, sodass ein Produktionsstart unmissverständlich fehlschlägt, anstatt sich mit einer Datenbank zu verbinden, die nicht vorhanden ist. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Was der Boot-Vorgang mit einem Schlüssel in Ihren Collections macht, den diese Version nicht liest: `warn`, `error` (Start verweigern – sinnvoll in CI) oder `off`. Regelt nur Schlüssel, die *nicht erkannt* werden, was meist ein Tippfehler und gelegentlich beabsichtigte Metadaten sind; ein Schlüssel, von dem bekannt ist, dass er verschoben wurde, ist immer fatal, da das konfigurierte Feature andernfalls stillschweigend fehlt. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schema-Durchlauf aus und beendet sich, ohne einen Socket zu öffnen – genau das Format, das ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der nachfolgende Server. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein normales Deployment nicht versehentlich in eines verwandeln kann, das migriert und die Auslieferung verweigert. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt es einer Maschine – einem Agenten, einem CI-Job –, eine Schemaänderung über `/api/admin/schema` tatsächlich *anzuwenden* (apply) und nicht nur zu planen. Standardmäßig deaktiviert, es sei denn, explizit angefordert: Die Anmeldedaten, die eine solche Änderung vornehmen könnten, befinden sich am ehesten in einer CI-Variable. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Wie lange eine benutzerdefinierte Funktion ausgeführt werden darf, bevor ihre Anfrage abgebrochen wird. Derselbe Parameter wie die Option `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` bewirkt, dass ein nicht abgefangenes Promise-Rejection den Prozess beendet, anstatt es nur zu protokollieren. Aktiviert unter einem Orchestrator, der Sie neu startet; deaktiviert, wo ein Neustart schlimmer als ein Speicherleck ist. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Hält den Cron-Scheduler auf einer Plattform aktiv, die die Runtime andernfalls als Scale-to-Zero erkennt, wo ein Timer, der in einer inaktiven Instanz ausgelöst wird, in keiner Instanz ausgelöst wird. | — |
| `TRUSTED_PROXY_HOPS` | Wie viele Proxys vor diesem Server geschaltet sind, damit der Rate-Limiter die echte Client-Adresse aus `X-Forwarded-For` auslesen kann. Ausfallsicherer Standardwert `0`: Ohne Proxy würde das Vertrauen auf den Header jedem Aufrufer das Fälschen einer Identität ermöglichen. | `0` |

:::note[Boot-Provisioning ist additiv und kein Migrationswerkzeug]
Der Boot-Durchlauf erfolgt unbeaufsichtigt, ohne dass jemand ein Diff prüft. Daher wird er niemals eine
Spalte löschen, einen Typ einschränken oder eine Tabelle umschreiben. Aus diesem Grund verweigert das Image auch
`REBASE_MIGRATE_ON_BOOT=push`: Ein vollständiger Push berechnet ein Diff und führt bedenkenlos
`DROP COLUMN` aus – und ein Container-Neustart darf niemals in der Lage sein, eine
Produktionsspalte als Nebeneffekt eines Neuansetzens (Rescheduling) zu zerstören.

Destruktive oder strukturverändernde Änderungen bleiben dort, wo sie überprüft werden können: `rebase db
generate` + `rebase db migrate` oder `rebase db push` aus einem Checkout oder CI,
was die Änderung im Probelauf (Dry-Run) testet, destruktive Änderungen ohne Bestätigung ablehnt und
zuvor ein Backup erstellen kann.
:::

### Split-Deployments

Ein einzelnes Image und ein Bundle können mehrfach gestartet werden, wobei jedes einen
anderen Teil des Projekts bedient. Hier steht jeweils nur eine Zeile, da diese Seite den Anspruch erhebt,
jede Variable aufzulisten; was jede Kombination *bereitstellt und verwaltet* – und welche
Kombinationen den Start verweigern –, finden Sie unter
**[Split-Prozesse](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Wenn nicht gesetzt, folgt er der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Wenn nicht gesetzt, folgt er der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | Nur die angegebenen benutzerdefinierten Funktionen in diesem Prozess bereitstellen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen außer den angegebenen bereitstellen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. | — |

### MCP-Oberfläche

Ein optionaler Model Context Protocol (MCP)-Endpunkt unter `/mcp`, damit ein KI-Client dieses Projekt
**als der angemeldete Benutzer** lesen und schreiben kann. Deaktiviert, sofern nicht gesetzt, und –
im Gegensatz zu jeder anderen Oberfläche – schaltet keine `REBASE_ROLE` diesen ein: die anderen beschreiben eine
Prozessform, während dies eine Entscheidung ist, Zugangsdaten an Software von Drittanbietern zu übergeben,
und von einer Person getroffen werden sollte, anstatt von der Aufgabenbezeichnung eines
Containers geerbt zu werden.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Bindet die MCP-Oberfläche ein. Erfordert `REBASE_PUBLIC_URL`; ohne diese wird die Oberfläche nicht eingebunden und dies im Boot-Log vermerkt. | `false` |
| `REBASE_PUBLIC_URL` | Die extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Oberfläche kann diese nicht ableiten – die Übernahme der Origin aus dem `Host`-Header würde die Ausstelleridentität (Issuer) und die Audience, gegen die ihre eigenen Tokens geprüft werden, zu einem vom Aufrufer bereitgestellten Wert machen. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Erlaubt dynamische OAuth-Client-Registrierung (RFC 7591), sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um zu verlangen, dass Clients vorab registriert werden. | `true` |

### Backups

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Wenn nicht gesetzt, sind geplante Backups deaktiviert. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Nicht gesetzt oder `0` behält alles. | — |
| `BACKUP_KEEP_MINIMUM` | Unabhängig von den Aufbewahrungsregeln immer mindestens N der neuesten Backups behalten. | — |
| `PG_DUMP_PATH` | Überschreibt das `pg_dump`-Binary – es muss mit der Hauptversion (Major Version) des Servers übereinstimmen. | — |
| `PG_RESTORE_PATH` | Überschreibt das `pg_restore`-Binary. | — |

Backups enthalten Geheimnisse und personenbezogene Daten (PII). Verwenden Sie ein privates Ziel mit
Verschlüsselung im Ruhezustand (Encryption-at-Rest).
| `PG_DUMPALL_PATH` | Speicherort von `pg_dumpall`, wenn es sich nicht im `PATH` befindet. Ohne diesen – und ohne installierte PostgreSQL-Client-Tools – schlägt ein Globals-Backup mit einem Fehler fehl, der diese Variable nennt. | — |

### Bundle-Bereitstellung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft beim
Start ein Bundle ab. Diese Variablen bestimmen, welches und wie.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Von wo das Bundle-Archiv abgerufen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Das Bearer-Credential für diesen Abruf. Behandeln Sie es als Geheimnis: Es autorisiert einen Mandanten, seinen eigenen Code herunterzuladen. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Wohin ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und die Zeit zwischen Abruf und Start überstehen. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image dem Bundle bereitstellt, über die hinaus, die es selbst deklariert. | — |

### Ressourcen-Bindings

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `config/resources.ts` deklariert,
wird über danach benannte Umgebungsvariablen gebunden. Die Basisnamen finden Sie unten; eine
Nicht-Standard-Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an, sodass ein Bucket namens
`media` die Variable `S3_BUCKET__MEDIA` liest. `rebase status`
 gibt für jede Ressource
die genaue Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, wenn es nicht der standardmäßige Postgres-Treiber ist. Mit Suffix pro Quelle versehen: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Mit Suffix pro Topic versehen. | — |

### Die eigene Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hiervon wirkt sich auf ein Deployment aus.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Das Backend, mit dem `rebase auth` und `rebase api-keys` kommunizieren, anstatt es aus dem Projekt abzuleiten. | — |
| `REBASE_PORT` | Der Port, den diese Befehle beim Ableiten dieser URL annehmen. | — |
| `SERVICE_KEY` | Der Service-Schlüssel, mit dem sie sich authentifizieren, anstatt danach zu fragen. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env` die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, als das sich `rebase cloud login` anmeldet, anstatt danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Dessen Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in die Shell-Historie gelangt. | — |
| `REBASE_DEBUG` | `1` gibt den zugrunde liegenden Fehler und Anfragedetails anstelle der Kurznachricht aus. Die erste Option, die gesetzt werden sollte, wenn ein `rebase cloud`-Befehl nicht hilfreich fehlschlägt. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und stellt nichts bereit – Sie bringen Ihre eigene mit. Dasselbe wie `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixiert den Port des Frontend-Dev-Servers, den `rebase dev` andernfalls aus dem Pfad des Projekts ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` darauf wartet, dass sich das Backend meldet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert den Bericht. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in den aus `docker-compose.yml` abgeleiteten Verbindungsstring einfügt. | — |
| `DO_NOT_TRACK` | Die werkzeugübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe speziell für Rebase. Benötigt keine Datei und ist daher in CI und in einem Image zu verwenden. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Wohin Telemetrie für einen selbst gehosteten Collector gesendet wird. | — |

## Secrets in der Entwicklung

`JWT_SECRET` und `REBASE_SERVICE_KEY` sind in der Produktion erforderlich und werden
außerhalb dieser für Sie generiert, sodass Sie starten können, ohne etwas einrichten zu müssen.

Diese generierten Werte werden in `.rebase-dev-secrets.json` zwischengespeichert, neben
`.rebase-dev-port` und `.rebase-dev-url` und zusammen mit diesen in `.gitignore` eingetragen. Zuvor
wurden sie bei jedem Start neu generiert – ein Neustart des Dev-Servers meldete Sie also von
Ihrer eigenen App ab und entwertete alle API-Schlüssel, die Sie gerade erstellt hatten.

- Setzen Sie eine der Variablen explizit, wird Ihr Wert verwendet; es wird nichts zwischengespeichert oder gelesen.
- Verweisen Sie mit `REBASE_DEV_SECRETS_FILE` auf einen anderen Speicherort für den Cache – ein Pfad und
  die einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets zu rotieren. Beim nächsten Start wird eine neue geschrieben.
- Wenn die Datei nicht geschrieben werden kann – beispielsweise in einem schreibgeschützten Container –, startet
  der Server trotzdem mit einem kurzlebigen (ephemeren) Secret, genau wie zuvor.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion
schlägt ein Start, der eines der Secrets generieren müsste, weiterhin fehl und nennt die Variable;
dies bleibt unverändert:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
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
    collectionsDir: "./config/collections",
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

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

### Ändern von `basePath`

`basePath` verschiebt jede API-Route, daher muss dem Client dasselbe mitgeteilt werden –
andernfalls fragt er weiterhin nach `/api/...` und erhält für alles einen 404-Fehler:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Das Admin-Panel übernimmt dies von dem Client, den es erhält; weiter muss nichts
konfiguriert werden. Wenn Sie eine Request-URL manuell erstellen, verbinden Sie sie über den Client,
anstatt `/api` selbst zu schreiben:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### SQL-Editor: Berechtigung verweigert (`permission denied for table <name>`)

* **Symptome:** Im Rebase Studio SQL-Editor ausgeführte benutzerdefinierte Abfragen schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellenkalkulations-CMS-Ansicht Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, SQL-Editor-Abfragen auszuführen, indem die Datenbankrollen vorübergehend gewechselt werden, um der Anwendungsrolle des aktiven Benutzers zu entsprechen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen und nicht als tatsächliche PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer des Verbindungseigentümers (Connection Owner) ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase dazu, SQL-Editor-Abfragen mit den Berechtigungen des Verbindungseigentümers (in der Regel ein Superuser/Owner) auszuführen.

### Schema-Abruf im SQL-Editor fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden oder der SQL-Editor wirft den Fehler `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Ursache:** Rebase benötigt Administratorrechte, um Datenbanksystemkataloge abzufragen und administrative Befehle auszuführen. Wenn dem Bootstrapper kein `adminConnectionString` bereitgestellt wird oder `getAdmin()` so überschrieben ist, dass es `undefined` zurückgibt, schlagen diese Operationen fehl.
* **Lösung:** Stellen Sie sicher, dass `adminConnectionString` bei der Initialisierung des Backend-Bootstrappers konfiguriert ist:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Nächste Schritte

- **[Deployment](/docs/getting-started/deployment)** — Leitfaden für das Produktions-Deployment
- **[Backend-Übersicht](/docs/backend)** — Vollständige Backend-Konfigurationsreferenz

---

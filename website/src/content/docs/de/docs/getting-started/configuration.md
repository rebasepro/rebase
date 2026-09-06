---
sourceHash: f6312cfcb6187cea
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projekt-Stammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Fehlt
> etwas Erforderliches oder ist es falsch formatiert (eine URL, die keine ist, ein
> Port, der keine Zahl ist), verweigert der Server den Start und nennt die Variable.
>
> Wo das Schema liegt, hängt davon ab, wie Sie das Backend betreiben. Ein von der
> Runtime gebootetes Projekt — `rebase dev`, `rebase start`, das veröffentlichte
> Image — verwendet das Schema der Runtime (`loadBootEnv` in `@rebasepro/server`),
> die Vereinigung aller Tabellen unten. Ein Projekt, das [`rebase eject`](/docs/cli)
> ausgeführt hat, besitzt eine eigene `backend/src/env.ts` mit
> `loadEnv({ extend })` und kann dort eigene typisierte Variablen ergänzen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **In der Entwicklung optional** — ohne sie betreibt `rebase dev` eine verwaltete PostgreSQL für das Projekt, mit ihren Daten unter `.rebase/`. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktion erforderlich** (in der Entwicklung automatisch erzeugt). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` ist eine node-postgres-Schreibweise, keine von libpq.**
>
> Rebase und der Node-Treiber akzeptieren sie — verschlüsseln, aber das
> Zertifikat nicht prüfen. `psql`, `pg_dump`, `pg_restore` und Atlas tun das
> nicht, und sie fallen auch nicht weich zurück: Sie verweigern den Start mit
> `invalid sslmode value: "no-verify"`.
>
> Die Rebase-eigenen Befehle (`rebase db push`, `rebase db backup`, `rebase db
> restore`) schreiben sie vor dem Aufruf in das gleichwertige
> `sslmode=require` um und funktionieren daher mit der URL, wie sie konfiguriert
> ist. Ein `psql` von Hand tut das nicht — setzen Sie dort `sslmode=require` ein,
> das auf genau dieselbe Weise verschlüsselt, ohne zu prüfen.

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das Client-SDK. **Nur in der Entwicklung setzen** — siehe unten. | Ursprung der Seite |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client-ID. Ermöglicht "Mit Google anmelden". | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, daher setzt der
> Dev-Server sie ein. In der Produktion liefert das Rebase-Backend die SPA aus,
> die API ist also der Origin der Seite selbst, und der Client löst sie von allein
> so auf.
>
> Eine absolute URL in ein Produktions-Bundle zu backen funktioniert genau so
> lange, bis ein zweiter Hostname auf dieselbe App zeigt: Eine eigene Domain lädt
> die Seite dann von `example.com` und ruft die API auf
> `example.rebase.website` auf — das ist cross-origin, jede Anfrage scheitert also
> am Preflight. Den Origin in CORS zu erlauben behebt es **nicht**: Das
> Refresh-Cookie ist `SameSite=Lax` und wird nicht site-übergreifend gesendet, Sie
> hätten also die Konsolenfehler beseitigt und trotzdem kaputte Auth. Ungesetzt
> funktioniert jede Domain, die auf die App zeigt, ganz ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** — ein `PORT` in `.env` wird dort nicht gelesen, weil der Port aufgelöst wird, bevor diese Datei geladen ist — und bindet sonst einen aus dem Projektpfad abgeleiteten Port, damit mehrere Projekte gleichzeitig laufen können. `rebase dev --port` sticht beides, und das Start-Banner nennt die verwendete Stufe. | `3001` |
| `LOG_LEVEL` | Logging-Ausführlichkeit: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer `Failed query: [redacted]`-Zeile. Jede fehlgeschlagene Anweisung wird standardmäßig redigiert, weil eine fehlgeschlagene Abfrage ihre gebundenen Parameter mitführt — eine E-Mail-Adresse, einen Passwort-Hash. Auf `true` setzen, während ein DDL-, RLS- oder Change-Capture-Fehler untersucht wird. Wird bei `NODE_ENV=production` ignoriert. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste erlaubter Origins. **In der Produktion erforderlich**, wenn sie sich von der Backend-Domain unterscheiden. In der Entwicklung wird sie zu localhost *hinzugefügt* — siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Alternative zu `CORS_ORIGINS`, in beiden Umgebungen. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (für Schema-Introspektion und administrative Operationen). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert das Wechseln der PostgreSQL-Rolle im SQL-Editor (nützlich bei eigener Authentifizierung, bei der DB-Rollen nicht abgebildet sind). | `false` |

#### CORS in der Entwicklung

Die Entwicklung erlaubt **localhost, plus was auch immer `CORS_ORIGINS` (oder
`FRONTEND_URL`) nennt** — dieselbe Liste, die die Produktion verwendet, nur mit
localhost ergänzt statt ersetzt. Die Variable wirkt also in beiden Umgebungen
gleich, und die Fälle, die sie in der Entwicklung brauchen, sind die
gewöhnlichen:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Ein Origin, der weder localhost noch gelistet ist, wird abgelehnt, und die
Ablehnung wird **einmal pro Origin** protokolliert, mitsamt der exakten Zeile,
die ihn erlauben würde. Das Ablehnen ist keine Vorsicht um ihrer selbst willen:
Die API sendet Zugangsdaten, einen beliebigen `Origin` zurückzuspiegeln ließe
also jede Website, die die Entwicklerin gerade besucht, authentifizierte
Anfragen mit ihrer Sitzung gegen den Dev-Server stellen und die Antworten lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Geheimnis für die JWT-Signierung (in der Produktion erforderlich, in der Entwicklung automatisch erzeugt) | — |
| `JWT_PRIVATE_KEY` | PEM-Privatschlüssel, um Access-Tokens asymmetrisch (RS256) zu signieren, sodass alles, was das JWKS hat, eine Sitzung prüfen kann, ohne selbst eine ausstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEM. Ohne ihn bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie ihn immer, wenn der Schlüssel wechselt — eine Rotation hängt davon ab, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access-Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens. Gleitend — jede Rotation setzt sie neu an, sie bestimmt also, wie lange eine Sitzung **Inaktivität** überlebt. | `400d` |
| `ALLOW_REGISTRATION` | Ermöglicht neuen Benutzern die Registrierung (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, was hier auch stehen mag — eine leere Benutzertabelle muss jemanden hereinlassen, und dieser jemand wird Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle weist die Bootstrap-Registrierung mit `SETUP_REQUIRED` ab, ein über offene Registrierung angelegtes erstes Konto ist ein gewöhnliches Konto, und der Administrator wird unten mit `REBASE_ADMIN_EMAIL` benannt oder per Service-Key zugewiesen. Die `.env.example` des Scaffolds setzt sie auf `true`; der Framework-Standard ist aus. | `false` |
| `DISABLE_SELF_REGISTRATION` <span class="since-badge" data-since="0.18">Since 0.18</span> | Notschalter. Schließt das Bootstrap-Fenster für den ersten Benutzer, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt — die Registrierung ist damit auch gegen eine leere Datenbank zu. Kombinieren Sie ihn mit `REBASE_ADMIN_EMAIL` unten, sonst hat die Bereitstellung keine Möglichkeit, ihren ersten angemeldeten Aufrufer zu erzeugen. Jedes ausgelieferte Bereitstellungsartefakt setzt ihn. | — |
| `REBASE_ADMIN_EMAIL` <span class="since-badge" data-since="0.18">Since 0.18</span> | E-Mail-Adresse des ersten Admin-Kontos, beim Start angelegt, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. So bekommt eine Produktionsbereitstellung ihren Administrator: Die Betreiberin benennt das erste Konto, statt mit dem Internet darum zu rennen. Der Start warnt, wenn die Tabelle in der Produktion leer ist und dies ungesetzt bleibt. | — |
| `REBASE_ADMIN_PASSWORD` <span class="since-badge" data-since="0.18">Since 0.18</span> | Passwort für dieses Konto. Mindestens 12 Zeichen, sonst wird es abgelehnt und das Konto nicht angelegt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Geheimnis. Ungesetzt werden die Geheimnisse stattdessen mit `JWT_SECRET` verschlüsselt und der Start warnt einmal — eine Rotation von `JWT_SECRET` meldet also alle ab *und* macht jeden eingerichteten Authenticator unentschlüsselbar. Setzen Sie einen eigenen Schlüssel (32+ zufällige Zeichen), bevor sich jemand einrichtet. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, *von dem weg* rotiert wird. Setzen Sie während einer Rotation beide: Neue Geheimnisse werden mit `MFA_ENCRYPTION_KEY` geschrieben, vorhandene bleiben lesbar, sodass niemand mitten in der Rotation aus dem eigenen Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Geheimnis neu verschlüsselt ist. | — |
| `ALLOW_ANONYMOUS` | Aktiviert die anonyme Anmeldung (`POST /api/auth/anonymous`). Opt-in, und bewusst nicht an `ALLOW_REGISTRATION` gekoppelt. | `false` |
| `AUTH_REQUIRE` | Verlangt Authentifizierung für die Daten-API. Auf `false` setzen für eine vollständig öffentliche Lese-Oberfläche — RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Bindet `POST /api/auth/find-user` ein, das eine E-Mail-Adresse zu einem minimalen öffentlichen Profil (`uid`, `displayName`, `photoURL`) auflöst, für Einladungs-Flows per E-Mail. Nur für authentifizierte Aufrufer, und es gibt nie E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig aus: Es ist eine Aufzählungsfläche. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` am Refresh-Cookie: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein wirklich site-übergreifendes Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` am Refresh-Cookie. Standardmäßig an; `AUTH_COOKIE_SECURE=false` für einfaches HTTP — etwa eine Bereitstellung unter einer LAN-Adresse, bei der der Browser das Cookie sonst verwirft und die Sitzung beim Ablauf des Access-Tokens ohne Fehlermeldung endet. Der Start warnt dann. `http://localhost` braucht das nicht. | `true` |
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
| `GITLAB_CLIENT_ID` | GitLab OAuth Client-ID. Die `baseUrl` einer selbst gehosteten Instanz hat keine Schreibweise als Umgebungsvariable — konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab OAuth Client-Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket OAuth Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket OAuth Client-Secret | — |
| `SLACK_CLIENT_ID` | Slack OAuth Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack OAuth Client-Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth Client-Secret | — |
| `APPLE_CLIENT_ID` | Apple Services ID. Apple hat kein statisches Client-Secret — Rebase signiert pro Token-Austausch ein kurzlebiges ES256-JWT —, es braucht daher alle vier `APPLE_*`-Werte und konfiguriert ohne sie nichts. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, der Aussteller des JWT. | — |
| `APPLE_KEY_ID` | Key ID des bei Apple registrierten Privatschlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der `.p8`-Privatschlüsseldatei, samt Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch erzeugt.) | — |
| `REBASE_RATE_LIMIT_STORE` | Wo die Zähler des Auth-Rate-Limits liegen: `memory` (pro Prozess) oder `sql` (über Repliken geteilt). Ein Prozess kann seine eigene Replikanzahl nicht sehen, eine Bereitstellung mit Nachbarn muss es also sagen — drei Repliken auf dem Standardwert setzen das Dreifache des Limits durch. Jeder andere Wert **verweigert den Start**, statt zurückzufallen, `postgres` eingeschlossen. | `memory` |
| `AUTH_MAGIC_LINK` | Bindet den passwortlosen Anmelde-Link-Flow ein. Braucht einen konfigurierten E-Mail-Dienst, sonst hat der Link kein Ziel. | `false` |
| `AUTH_EMAIL_OTP` | Bindet die passwortlose Anmeldung mit einem sechsstelligen, per E-Mail gesendeten Code ein. Dieselbe E-Mail-Voraussetzung wie oben. | `false` |
| `CAPTCHA_PROVIDER` | Schaltet die Captcha-Prüfung auf den Auth-Routen ein: `turnstile` oder `hcaptcha`. Ungesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, serverseitig verwendet, um das vom Browser gesendete Token zu prüfen. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Auth-Routen, die geschützt werden sollen (zum Beispiel `register,login`). Ungesetzt schützt den Standardsatz des Anbieters. | — |

### Speicher

:::caution[Storage hat keine Row-Level-Security und braucht deshalb ein Zugriffsmodell]
Collections sind durch Postgres-RLS geschützt. Objektspeicher hat kein Äquivalent
— Schlüssel teilen sich einen flachen Namensraum —, deshalb **verweigert der
Server in der Produktion den Start**, wenn ein Bucket konfiguriert ist und es
kein Zugriffsmodell gibt. Erfüllen Sie es mit genau einem von: einem
`storageAuthorize`-Hook, exportiert aus `config/index.ts` (was das Scaffold
mitliefert), `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Speicher-Backend: `local`, `s3` oder `gcs`. In der Produktion deaktiviert `local` den Speicher, sofern nicht `FORCE_LOCAL_STORAGE=true` gesetzt ist | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Erlaubt lokalen Speicher in der Produktion — nur mit einem dauerhaften Volume, eingehängt unter `STORAGE_PATH` | `false` |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS-Zugriffsschlüssel | — |
| `S3_SECRET_ACCESS_KEY` | AWS-Geheimschlüssel | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Erzwingt Path-Style-URLs für den S3-Bucket (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird meist aus den Zugangsdaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Zugangsdaten liefert. | — |
| `STORAGE_PUBLIC_READ` | Liefert jedes Objekt an jeden aus, ohne Token. Nur für einen Bucket, der wirklich ein öffentliches CDN ist. Eine der drei Möglichkeiten, die Start-Absicherung oben zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Lässt jeden angemeldeten Aufrufer jedes Objekt lesen, schreiben, auflisten und löschen. Im Konfigurationsobjekt aus gutem Grund `INSECURE` genannt: Es ist nur in einer Single-Tenant-App vertretbar, in der jedem Konto jede Datei anvertraut wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Speichert erzeugte Bild-Renditionen (Größenänderungen, Formatumwandlungen) zwischen, statt sie pro Anfrage zu erzeugen. | `false` |

### E-Mail (Optional)

| Variable | Beschreibung |
|----------|-------------|
| `SMTP_HOST` | SMTP-Server-Host |
| `SMTP_PORT` | SMTP-Server-Port |
| `SMTP_SECURE` | Sichere Verbindung aktivieren (`true`/`false`) |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | Absenderadresse für System-E-Mails |
| `SMTP_NAME` | Anzeigename an der Absenderadresse |
| `APP_NAME` | Produktname, der in E-Mail-Betreffs und -Texten verwendet wird (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo über den Standard-E-Mail-Vorlagen. Absolutes `http(s)`-PNG oder -JPG — Clients entfernen SVG und blockieren `data:`-URIs. Ungesetzt bekommt eine noch `Rebase` heißende App die Rebase-Marke, eine umbenannte keine |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximale Anzahl gepoolter Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine untätige Verbindung gehalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) braucht eine: `LISTEN`/`NOTIFY` überlebt keinen Transaktions-Pooler wie PgBouncer, und ohne sie werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert statt still verloren zu gehen. | — |
| `DATABASE_READ_URL` | Read-Replica. Lesezugriffe gehen dorthin, wenn sie gesetzt ist und sich von `DATABASE_URL` unterscheidet; scheitert die Verbindung, fällt alles mit einer Warnung auf die primäre zurück. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, angewandt unabhängig davon, was jeder einzelne angefordert hat. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, statt den Server still zu serialisieren. | — |

### Laufzeitverhalten

Wird von der Laufzeitumgebung gelesen — `rebase dev`, `rebase start` und dem
veröffentlichten Server-Image. Ein Projekt, das ejected hat, trifft diese
Entscheidungen stattdessen in eigenem Code.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Führt beim Start das Row-Level-Security-Audit aus und bindet dessen Endpunkt ein, der Tabellen meldet, die ohne Policies ausgeliefert werden. | — |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Dem Client muss dasselbe gesagt werden — siehe [`basePath` ändern](#basepath-ändern). | `/api` |
| `REBASE_SERVE_STATIC` | Liefert die statischen/Admin-Assets des Bundles aus diesem Prozess aus. Abschalten, wenn ein CDN davorsteht. | `true` |
| `REBASE_HISTORY` | Zeichnet die [Änderungshistorie von Entitäten](/docs/backend/history) auf. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli für Antworten. | `true` |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body, **in Bytes** (`10485760`, nicht `10MB` — ein Wert, der keine Zahl ist, verweigert den Start, statt still das Limit zu entfernen). | — |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Dreiwertig: ungesetzt heißt an in der Entwicklung, aus in der Produktion; `false` schaltet überall beides ab. Beachten Sie, dass `true` in der Produktion die **Spezifikation** unter `/api/docs` ausliefert, aber nicht die Swagger-**UI** unter `/api/swagger` — die UI ist separat an `NODE_ENV` gekoppelt. | — |
| `REBASE_METRICS` | Stellt Prometheus-Metriken unter `/metrics` bereit. | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token, das `/metrics` schützt. Ungesetzt bleibt der Endpunkt für alles offen, was den Port erreicht — in einem privaten Netz in Ordnung, in einem öffentlichen nicht, und die Start-Logs sagen das. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Laufzeitumgebung beim Start am Schema tun darf. `ensure` (der Standard, überall — auch in der Produktion) führt den **additiven** Durchgang aus: fehlende Tabellen, Spalten und Enum-Typen anlegen, nie eine verwerfen oder umschreiben. `none` fasst nichts an. Das veröffentlichte Image akzeptiert nur diese beiden und **verweigert bei `push` den Start**. In einer [aufgeteilten Bereitstellung](/docs/deployment/split-processes) darf genau ein Prozess bereitstellen, jede andere Rolle muss also `none` setzen oder den Start verweigern. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Verweigert den Start, wenn die Datenbank zuletzt aus einem anderen Satz von Collections bereitgestellt wurde, als dieser Prozess gebaut wurde. Ungesetzt (oder alles außer `true`/`1`) warnt stattdessen. | warn |
| `REALTIME_CDC` | Änderungserfassung auf Datenbankebene: `auto` (einschalten, wo die Verbindung es unterstützt, sonst still zurückfallen), `trigger` (erzwingen, warnen, wenn unmöglich), `wal` (fällt heute auf `trigger` zurück), `off`. Siehe [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Kanäle und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein konstruierter Transport übergeben wurde. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`-/Loopback-Werte unter `NODE_ENV=production`. Aus, damit ein Produktionsstart laut scheitert, statt sich mit einer Datenbank zu verbinden, die es nicht gibt. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Was der Start mit einem Schlüssel in Ihren Collections tut, den diese Version nicht liest: `warn`, `error` (Start verweigern — in CI lohnend) oder `off`. Regelt nur Schlüssel, die er nicht *erkennt*; das sind meist Tippfehler und gelegentlich absichtliche Metadaten. Ein Schlüssel, von dem er weiß, dass er umgezogen ist, ist immer fatal, weil die Funktion, die er konfigurierte, sonst still fehlt. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schema-Durchgang aus und beendet sich, ohne einen Socket zu öffnen — die Form, die ein Migrations-Job will, aus demselben Image und demselben Bundle wie der Server danach. Ein leerer Wert gilt als *ungesetzt*, damit ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei aus einer gewöhnlichen Bereitstellung keine machen kann, die migriert und den Dienst verweigert. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` lässt eine Maschine — einen Agenten, einen CI-Job — eine Schemaänderung über `/api/admin/schema` *anwenden*, nicht nur planen. Aus, sofern nicht ausdrücklich gewünscht: Die Zugangsdaten, die eine solche Änderung machen würden, sind die, die am ehesten in einer CI-Variablen liegen. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Wie lange eine eigene Function laufen darf, bevor ihre Anfrage abgebrochen wird. Derselbe Regler wie die Option `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` lässt eine unbehandelte Promise-Rejection den Prozess beenden, statt sie zu protokollieren. An unter einem Orchestrator, der Sie neu startet; aus dort, wo ein Neustart schlimmer ist als ein Leck. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Hält den Cron-Scheduler auf einer Plattform am Laufen, die die Laufzeitumgebung sonst als Scale-to-Zero erkennt, wo ein Timer, der in einer untätigen Instanz feuert, in gar keiner Instanz feuert. | — |
| `TRUSTED_PROXY_HOPS` | Wie viele Proxys vor diesem Server stehen, damit der Rate Limiter die echte Client-Adresse aus `X-Forwarded-For` lesen kann. Ausfallsicherer Standard `0`: Ohne Proxy ließe das Vertrauen auf den Header jeden Aufrufer eine Identität fälschen. | `0` |

:::note[Die Bereitstellung beim Start ist additiv und kein Migrationswerkzeug]
Der Start-Durchgang läuft unbeaufsichtigt, ohne dass jemand einen Diff liest — er
wird deshalb nie eine Spalte verwerfen, einen Typ verengen oder eine Tabelle
umschreiben. Deshalb verweigert das Image auch `REBASE_MIGRATE_ON_BOOT=push`: Ein
vollständiger Push berechnet einen Diff und würde bereitwillig `DROP COLUMN`
ausführen, und ein Container-Neustart darf niemals eine Produktionsspalte als
Nebeneffekt einer Neuplanung zerstören können.

Zerstörende oder umformende Änderungen bleiben dort, wo sie geprüft werden
können: `rebase db generate` + `rebase db migrate`, oder `rebase db push` aus
einem Checkout oder aus CI — das probt die Änderung, verweigert zerstörende ohne
Bestätigung und kann vorher ein Backup anlegen.
:::

### Aufgeteilte Bereitstellungen

Ein Image und ein Bundle lassen sich mehrfach starten, jedes für einen anderen
Teil des Projekts. Hier je eine Zeile, weil diese Seite beansprucht, jede
Variable aufzulisten; was jede Kombination *einbindet und besitzt* — und welche
Kombinationen den Start verweigern — steht auf
**[Aufgeteilte Prozesse](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Ungesetzt folgt der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Ungesetzt folgt der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | Bedient in diesem Prozess nur die genannten eigenen Functions. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Bedient jede eigene Function außer den genannten. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Function-Anfrage weiterleitet, die er nicht selbst bedient. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Ungesetzt bedeutet, geplante Backups sind aus. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- / `gs://bucket/prefix`-URL. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Löscht Backups, die älter als N Tage sind. Ungesetzt oder `0` behält alles. | — |
| `BACKUP_KEEP_MINIMUM` | Behält immer mindestens N der neuesten Backups, was die Aufbewahrung auch sagt. | — |
| `PG_DUMP_PATH` | Überschreibt die `pg_dump`-Binärdatei — sie muss zur Hauptversion des Servers passen. | — |
| `PG_RESTORE_PATH` | Überschreibt die `pg_restore`-Binärdatei. | — |

Backups enthalten Geheimnisse und personenbezogene Daten. Verwenden Sie ein
privates Ziel mit Verschlüsselung im Ruhezustand.
| `PG_DUMPALL_PATH` | Wo `pg_dumpall` liegt, wenn es nicht im `PATH` ist. Ohne diese Angabe — und ohne installierte PostgreSQL-Clienttools — schlägt ein Globals-Backup mit einem Fehler fehl, der diese Variable nennt. | — |

### Bundle-Auslieferung

Eine verwaltete Bereitstellung trägt ihren Code nicht im Image: Die
Laufzeitumgebung holt beim Start ein Bundle. Diese Variablen entscheiden, welches
und wie.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Woher das Bundle-Archiv geholt wird, wenn es kein lokales gibt. | — |
| `REBASE_BUNDLE_TOKEN` | Die Bearer-Zugangsdaten für diesen Abruf. Behandeln Sie sie als Geheimnis: Sie sind es, die einen Tenant berechtigen, seinen eigenen Code herunterzuladen. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Wohin ein geholtes Bundle entpackt wird. Muss beschreibbar sein und zwischen Abruf und Start bestehen bleiben. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image dem Bundle bereitstellt, über die hinaus, die es selbst deklariert. | — |

### Ressourcen-Bindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in
`config/resources.ts` deklariert, wird von Umgebungsvariablen gebunden, die nach
ihm benannt sind. Die Basisnamen stehen unten; eine nicht-standardmäßige
Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an, ein Bucket namens
`media` liest also `S3_BUCKET__MEDIA`. `rebase status`
<span class="since-badge" data-since="0.18">Since 0.18</span> gibt pro Ressource
die exakte Variable aus, die es liest, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle bereitstellt, wenn es nicht der Postgres-Standard ist. Pro Quelle mit Suffix: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Pro Topic mit Suffix. | — |

### Die eigene Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hiervon betrifft eine
Bereitstellung.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Das Backend, mit dem `rebase auth` und `rebase api-keys` sprechen, statt es aus dem Projekt abzuleiten. | — |
| `REBASE_PORT` | Der Port, den diese Befehle beim Ableiten dieser URL annehmen. | — |
| `SERVICE_KEY` | Der Service-Key, mit dem sie sich authentifizieren, statt nachzufragen. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env` die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` spricht. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, mit dem `rebase cloud login` sich anmeldet, statt nachzufragen. | — |
| `REBASE_CLOUD_PASSWORD` | Dessen Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in die Shell-Historie gerät. | — |
| `REBASE_DEBUG` | `1` gibt den zugrunde liegenden Fehler und die Request-Details aus statt der Kurzmeldung. Das Erste, was man setzt, wenn ein `rebase cloud`-Befehl wenig hilfreich scheitert. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und stellt nichts bereit — Sie bringen Ihre eigene mit. Wie `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Legt den Port des Frontend-Dev-Servers fest, den `rebase dev` sonst aus dem Projektpfad ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` darauf wartet, dass sich das Backend meldet, bevor es sagt, es sei nicht gestartet. `0` schaltet die Meldung ab. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einsetzt. | — |
| `DO_NOT_TRACK` | Die werkzeugübergreifende Konvention. Auf alles außer `0` gesetzt sendet die CLI keine Telemetrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe, speziell für Rebase. Braucht keine Datei, weshalb sie in CI und in einem Image die richtige Wahl ist. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Wohin Telemetrie gesendet wird, für einen selbst gehosteten Collector. | — |

## Geheimnisse in der Entwicklung

`JWT_SECRET` und `REBASE_SERVICE_KEY` sind in der Produktion erforderlich und
werden außerhalb davon für Sie erzeugt, sodass Sie loslegen können, ohne etwas
einzurichten.

Diese erzeugten Werte werden in `.rebase-dev-secrets.json` zwischengespeichert,
neben `.rebase-dev-port` und `.rebase-dev-url` und mit ihnen gitignoriert. Früher
wurden sie bei jedem Start neu erzeugt — ein Neustart des Dev-Servers meldete Sie
also aus Ihrer eigenen App ab und entwertete jeden gerade erstellten
API-Schlüssel.

- Setzen Sie eine der beiden Variablen ausdrücklich, wird Ihre verwendet; nichts
  wird zwischengespeichert oder gelesen.
- Legen Sie den Cache mit `REBASE_DEV_SECRETS_FILE` woanders hin — ein Pfad, und
  die einzige Variable in diesem Abschnitt, die Sie je absichtlich setzen würden.
- Löschen Sie die Datei, um beide Geheimnisse zu rollen. Der nächste Start
  schreibt eine frische.
- Lässt sich die Datei nicht schreiben — etwa in einem schreibgeschützten
  Container —, startet der Server trotzdem mit einem flüchtigen Geheimnis, genau
  wie früher.

In der Produktion wird nichts zwischengespeichert, ebenso wenig unter einem
Test-Runner. In der Produktion scheitert ein Start, der eines der beiden
Geheimnisse erzeugen musste, weiterhin und nennt die Variable — daran hat sich
nichts geändert:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Backend-Konfigurationsobjekt

Das an `initializeRebaseBackend()` übergebene `RebaseBackendConfig`-Objekt bietet programmatische Steuerung:

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

### `basePath` ändern

`basePath` verschiebt jede API-Route, dem Client muss also dasselbe gesagt
werden — sonst fragt er weiter nach `/api/...` und bekommt für alles ein 404:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Das Admin-Panel übernimmt das von dem Client, den es bekommt; sonst muss nichts
konfiguriert werden. Wenn Sie eine Request-URL von Hand bauen, setzen Sie sie aus
dem Client zusammen, statt `/api` selbst zu schreiben:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### SQL-Editor: Berechtigung verweigert (`permission denied for table <name>`)

* **Symptome:** Eigene Abfragen im SQL-Editor von Rebase Studio scheitern mit `cause: error: permission denied for table <name>`, obwohl die Tabellenansicht des CMS die Daten problemlos lädt.
* **Ursache:** Standardmäßig versucht Rebase, Abfragen des SQL-Editors auszuführen, indem es vorübergehend die Datenbankrolle auf die Anwendungsrolle des aktiven Benutzers umstellt (etwa `SET LOCAL ROLE "admin"`). Wenn Sie eine eigene Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen existieren statt als echte PostgreSQL-Rollen, schlägt der Rollenwechsel fehl oder es fehlen Datenbankrechte. Die Tabellenansicht des CMS läuft unter dem Besitzer der Verbindung und umgeht das.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zur `.env`-Konfiguration Ihres Backends hinzu. Das zwingt Rebase, Abfragen des SQL-Editors mit den Rechten des Verbindungsbesitzers auszuführen (in der Regel ein Superuser/Owner).

### SQL-Editor: Schema konnte nicht geladen werden (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio lädt den Schemabaum nicht, oder der SQL-Editor wirft `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Ursache:** Rebase braucht administrative Rechte, um Systemkataloge der Datenbank abzufragen und administrative Befehle auszuführen. Wird `adminConnectionString` dem Bootstrapper nicht übergeben oder `getAdmin()` so überschrieben, dass es `undefined` zurückgibt, scheitern diese Operationen.
* **Lösung:** Stellen Sie sicher, dass `adminConnectionString` bei der Initialisierung des Backend-Bootstrappers konfiguriert ist:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Nächste Schritte

- **[Bereitstellung](/docs/getting-started/deployment)** — Anleitung zur Produktionsbereitstellung
- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration
---

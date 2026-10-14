---
sourceHash: 1e15534f9a5fc19a
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projektstammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> ein erforderlicher Wert fehlt oder fehlerhaft ist (eine URL, die keine URL ist, ein Port,
> der keine Zahl ist), verweigert der Server den Start und nennt die Variable.
>
> Wo das Schema liegt, hängt davon ab, wie Sie das Backend ausführen. Ein Projekt, das von
> der Runtime gestartet wird – `rebase dev`, `rebase start`, das veröffentlichte Image –, verwendet
> das Schema, das der Runtime gehört (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, das [`rebase eject`](/docs/cli)
> ausgeführt hat, besitzt eine Datei `backend/src/env.ts`, die `loadEnv({ extend })` aufruft, und kann dort
> eigene typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **Optional in der Entwicklung** – wenn nicht gesetzt, führt `rebase dev` ein verwaltetes PostgreSQL für das Projekt aus, dessen Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **Erforderlich in der Produktion** (wird in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` ist eine Schreibweise von node-postgres, nicht von libpq.**
>
> Rebase und der Node-Treiber akzeptieren es – verschlüsseln, aber das Zertifikat
> nicht überprüfen. `psql`, `pg_dump`, `pg_restore` und Atlas tun dies nicht und
> stufen die Verbindung nicht herab: Sie verweigern den Start mit `invalid sslmode value: "no-verify"`.
>
> Die Rebase-eigenen Befehle (`rebase db push`, `rebase db backup`, `rebase db
> restore`) schreiben dies vor dem Shell-Aufruf in das äquivalente `sslmode=require` um,
> sodass sie mit der konfigurierten URL funktionieren. Wenn Sie manuell zu `psql` greifen,
> funktioniert dies nicht – tauschen Sie es dort gegen `sslmode=require` aus, was auf genau
> dieselbe Weise verschlüsselt, ohne zu verifizieren.

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** – siehe unten. | Page Origin |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, daher injiziert der
> Dev-Server diesen Wert. In der Produktion liefert das Rebase-Backend die SPA aus, sodass
> die API die eigene Origin der Seite ist und der Client dies selbstständig so auflöst.
>
> Das feste Einbinden einer absoluten URL in ein Produktions-Bundle funktioniert genau so lange,
> bis ein zweiter Hostname auf dieselbe App verweist: Eine benutzerdefinierte Domain lädt die Seite dann
> von `example.com` und ruft die API unter `example.rebase.website` auf, was Cross-Origin ist,
> sodass jeder Request beim Preflight fehlschlägt. Das Erlauben der Origin in CORS behebt dies
> ebenfalls **nicht** – das Refresh-Cookie ist `SameSite=Lax` und wird nicht Cross-Site
> gesendet, sodass Sie zwar die Konsolenfehler beseitigen würden, die Authentifizierung aber dennoch
> defekt bliebe. Bleibt der Wert ungesetzt, funktioniert jede Domain, die auf die App verweist,
> ganz ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort nicht gelesen, da der Port aufgelöst wird, bevor diese Datei geladen wird – und bindet andernfalls einen vom Projektpfad abgeleiteten Port, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner nennt die gewählte Stufe. | `3001` |
| `LOG_LEVEL` | Protokollierungs-Detaillierungsgrad: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer Zeile `Failed query: [redacted]` an. Jedes fehlschlagende Statement wird standardmäßig zensiert, da eine fehlgeschlagene Abfrage ihre gebundenen Parameter enthält – eine E-Mail-Adresse, einen Passwort-Hash. Setzen Sie dies auf `true`, während Sie einen DDL-, RLS- oder Change-Capture-Fehler diagnostizieren. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste der erlaubten Origins. **Erforderlich in der Produktion**, wenn sie sich von der Backend-Domain unterscheiden. In der Entwicklung wird sie zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu CORS_ORIGINS verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (wird für Schema-Introspektion und Admin-Operationen verwendet). Die dort angegebene Datenbank ist nicht diejenige, die die SQL-Konsole als aktuell bezeichnet, noch diejenige, die ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der die Verbindung der App selbst liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert den PostgreSQL-Rollenwechsel im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Studios SQL-Konsole meldet dann, dass die Zeilen als Verbindungsinhaber gelesen wurden, nennt diesen und graut die Rollenauswahl aus. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies bei einem Checkout, der [auf einen Branch gewechselt ist](/docs/backend/branching/#cli-integration). Ein Server mit dieser Variable behält die Branch-Registry auf dieser Datenbank und kopiert neue Branches standardmäßig von ihr, sodass der Branches-Bereich von Studio die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

Die Entwicklung erlaubt **localhost sowie alles, was in `CORS_ORIGINS` (oder `FRONTEND_URL`)
angegeben ist** – dieselbe Liste, die die Produktion verwendet, wobei localhost hinzugefügt
statt ersetzt wird. Die Variable funktioniert also in beiden Umgebungen gleich, und die
Fälle, die sie in der Entwicklung benötigen, sind die üblichen:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Eine Origin, die weder localhost ist noch in der Liste aufgeführt ist, wird abgelehnt, und die Ablehnung
wird **einmal pro Origin** mit der genauen Zeile protokolliert, die sie zulassen würde. Das Ablehnen ist
keine reine Vorsichtsmaßnahme: Die API sendet Anmeldedaten, daher würde das Reflektieren eines
beliebigen `Origin`-Headers jeder Website, die der Entwickler zufällig besucht, ermöglichen,
authentifizierte Anfragen mit seiner Sitzung an den Dev-Server zu senden und die Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Geheimnis für die JWT-Signierung (in Produktion erforderlich, in Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Access-Tokens (RS256), sodass jede Instanz, die das JWKS besitzt, eine Sitzung verifizieren kann, ohne selbst Tokens erstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEM. Ohne diesen Schlüssel bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie diesen Wert immer, wenn sich der Schlüssel ändert – eine Rotation hängt davon ab, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access-Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens. Gleitend – jede Rotation verlängert ihn, daher steuert dies, wie lange eine Sitzung bei **Inaktivität** überlebt. Setzen Sie `400d` für Sitzungen, die eine lange Abwesenheit überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Registrierung neuer Benutzer zulassen (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden zulassen, und dieser jemand wird der Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein erster über die offene Registrierung erstellter Account ist ein gewöhnlicher Account, und der Admin wird unten mit `REBASE_ADMIN_EMAIL` benannt oder mit dem Service-Key zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Framework-Standard ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Notfallschalter. Schließt das Bootstrap-Fenster für den ersten Benutzer, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank geschlossen ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, da das Deployment sonst keine Möglichkeit hat, seinen ersten angemeldeten Aufrufer zu erzeugen. Jedes ausgelieferte Deployment-Artefakt setzt dies. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Admin-Accounts, der beim Start erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. So erhält ein Produktions-Deployment seinen Admin: Der Betreiber benennt das erste Konto, anstatt ein Wettrennen mit dem Internet zu veranstalten. Der Start warnt, wenn die Tabelle in der Produktion leer ist und dies nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto wird nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Geheimnis. Ungesetzt werden die Geheimnisse stattdessen mit `JWT_SECRET` verschlüsselt und der Start warnt einmal – die Rotation von `JWT_SECRET` meldet somit jeden Benutzer ab *und* macht jeden registrierten Authentifikator unentschlüsselbar. Legen Sie einen dedizierten Schlüssel fest (mind. 32 zufällige Zeichen), bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *wegrotiert* wird. Setzen Sie während einer Rotation beide: Neue Geheimnisse werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende sind weiterhin lesbar, sodass niemand während der Rotation aus seinem eigenen Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Geheimnis neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht an `ALLOW_REGISTRATION` gekoppelt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API verlangen. Auf `false` setzen für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Bindet `POST /api/auth/find-user` ein, das eine E-Mail-Adresse zu einem minimalen öffentlichen Profil (`uid`, `displayName`, `photoURL`) für Einladungs-Flows per E-Mail auflöst. Nur für authentifizierte Aufrufer; gibt niemals die E-Mail-Adresse, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: Es stellt eine Angriffsfläche für Enumeration dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` für das Refresh-Cookie: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` für das Refresh-Cookie. Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für reines HTTP – ein Deployment auf einer LAN-Adresse, bei dem der Browser das Cookie sonst verwerfen würde und die Sitzung beim Ablauf des Access-Tokens ohne Fehler enden würde. Gibt beim Start eine Warnung aus. `http://localhost` benötigt dies nicht. | `true` |
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
| `APPLE_CLIENT_ID` | Apple Services ID. Apple hat kein statisches Client-Secret – Rebase signiert ein kurzlebiges ES256-JWT pro Token-Austausch – daher werden alle vier `APPLE_*`-Werte benötigt, und ohne sie wird nichts konfiguriert. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, der Aussteller (Issuer) des JWT. | — |
| `APPLE_KEY_ID` | Schlüssel-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten Schlüsseldatei `.p8`, inklusive aller Zeilenumbrüche (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (Wird in der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Der öffentliche Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deploy und er enthält nichts Geheimes. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` ermöglicht er dem Admin-Gate, ein Plattform-Token für `cron:read` zu akzeptieren und für sonst nichts. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, mit der die `aud` eines Plattform-Tokens übereinstimmen muss, damit ein für ein anderes Projekt erstelltes Token abgelehnt wird. Wenn nur eine der beiden Variablen gesetzt ist, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Wo die Zähler für Auth-Rate-Limits liegen: `memory` (pro Prozess) oder `sql` (über Replikate hinweg geteilt). Ein Prozess kann seine eigene Replikatanzahl nicht sehen, daher muss ein Deployment mit Peers dies angeben – drei Replikate erzwingen beim Standard das dreifache Limit. Jeder andere Wert **verweigert den Start**, anstatt ein Fallback zu nutzen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Den passwortlosen Anmeldelink-Flow einbinden. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwo hingehen kann. | `false` |
| `AUTH_EMAIL_OTP` | Passwortlose Anmeldung mit einem sechsstelligen, per E-Mail gesendeten Code einbinden. Gleiche E-Mail-Anforderung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Magic-Link- oder E-Mail-Code-Anfrage für eine unbekannte Adresse erstellt das Konto, solange die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh-Token nach Ablauf seines Wiederverwendungsfensters erneut abgespielt wird: `reject` (ablehnen, Sitzung beibehalten) oder `revoke-session` (Anmeldung beenden). Jeder andere Wert lässt den Start fehlschlagen. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Bestätigung vor Registrierung: Keine Passwort-Anmeldung, bis die Adresse bestätigt ist. Benötigt E-Mail; der Start wird ohne E-Mail verweigert. | `false` |
| `CAPTCHA_PROVIDER` | Captcha-Verifizierung auf den Auth-Routen aktivieren: `turnstile` oder `hcaptcha`. Ungesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig verwendet wird, um das vom Browser gesendete Token zu verifizieren. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Auth-Routen (zum Beispiel `register,login`). Ungesetzt schützt das Standard-Set des Anbieters. | — |

### Speicher (Storage)

:::caution[Storage hat keine Row-Level-Security, benötigt also ein Zugriffsmodell]
Collections werden durch Postgres RLS geschützt. Objektspeicher hat kein Äquivalent –
Schlüssel teilen sich einen einzigen flachen Namensraum – daher **verweigert der Server
in der Produktion den Start**, wenn ein Bucket ohne Zugriffsmodell konfiguriert ist.
Erfüllen Sie diese Voraussetzung mit genau einer der folgenden Optionen:
einem `storageAuthorize`-Hook, der aus `config/index.ts` exportiert wird (Standard
im Scaffold), `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Speicher-Backend: `local`, `s3` oder `gcs`. In der Produktion deaktiviert `local` den Speicher, es sei denn, `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird von dem Verzeichnis aus gelesen, in dem der Server läuft: das Projektstammverzeichnis unter `rebase dev`, `backend/` in einem von `rebase eject` geschriebenen Server | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in der Produktion erlauben – nur mit einem persistenten Volume, das `STORAGE_PATH` und die daneben liegenden `<STORAGE_PATH>__<key>`-Verzeichnisse benannter lokaler Buckets enthält | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Sekunden, die die Download-URL einer privaten Datei gültig ist – das Token, das `getSignedUrl()` hineinschreibt. Maximal `604800` (eine Woche) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Größte Datei, die die Quelle akzeptiert, in Bytes, auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Keine ganze Zahl an Bytes verweigert den Start | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS Access Key | — |
| `S3_SECRET_ACCESS_KEY` | AWS Secret Key | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 etc.) | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für S3-Bucket erzwingen (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für einen Bucket gedacht, der tatsächlich ein öffentliches CDN ist. Eine der drei Möglichkeiten, die unten stehende Start-Sicherung zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jedem angemeldeten Aufrufer das Lesen, Schreiben, Auflisten und Löschen aller Objekte erlauben. Im Konfigurationsobjekt aus gutem Grund als `INSECURE` benannt: Es ist nur in einer Single-Tenant-App vertretbar, in der jedem Konto jede Datei anvertraut wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bildwiedergaben (Größenanpassungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu erzeugen. | `false` |

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
| `APP_NAME` | Produktname, der in E-Mail-Betreffzeilen und Texten verwendet wird (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo, das über den Standard-E-Mail-Vorlagen angezeigt wird. Absolute `http(s)`-PNG- oder -JPG-Datei – Clients entfernen SVG und blockieren `data:`-URIs. Ungesetzt erhält eine App, die immer noch `Rebase` heißt, das Rebase-Logo und eine umbenannte keines |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximale Anzahl gepoolter Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung gehalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (ungepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine: `LISTEN`/`NOTIFY` überlebt keinen Transaktions-Pooler wie PgBouncer, und ohne sie werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, anstatt stillschweigend verloren zu gehen. Der [Job-Worker](/docs/backend/jobs) hält sein Wake-up-`LISTEN` ebenfalls darauf. <span class="since-badge" data-since="0.25">Seit 0.25</span> Füllt `directConnectionString` des Postgres-Adapters, wenn dies nicht gesetzt ist. | — |
| `DATABASE_READ_URL` | Read-Replica. Leseoperationen gehen dorthin, wenn sie gesetzt ist und sich von `DATABASE_URL` unterscheidet; schlägt die Verbindung fehl, fällt alles mit einer Warnung auf die primäre Instanz zurück. <span class="since-badge" data-since="0.25">Seit 0.25</span> Füllt `readConnectionString` des Postgres-Adapters, wenn dies nicht gesetzt ist; unter 0.24 wird diese Option ignoriert. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, die unabhängig von den angeforderten Werten angewendet wird. Nur einfache Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server stillschweigend zu serialisieren. | — |

### Runtime-Verhalten

Wird von der Runtime gelesen – `rebase dev`, `rebase start` und dem veröffentlichten
Server-Image. Ein Projekt, das den Eject-Befehl ausgeführt hat, steuert diese Entscheidungen
stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) aus, das Tabellen meldet, die ohne Richtlinien bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime liefert keine Kopie mit, und ohne das Paket verweigert der Start die Ausführung unter Nennung des Pakets. `false` hält den Scan von diesem Prozess fern. | — |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Der Client muss dieselbe Information erhalten – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische/Admin-Assets des Bundles von diesem Prozess aus bereitstellen. Deaktivieren, wenn ein CDN vorgeschaltet ist. | `true` |
| `REBASE_HISTORY` | [Entitäts-Änderungshistorie](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli-Antworten. | `true` |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body, **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verweigert den Start, anstatt das Limit stillschweigend zu entfernen). | — |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände: Ungesetzt bedeutet an in der Entwicklung, aus in der Produktion; `false` schaltet beides überall aus. Beachten Sie, dass `true` in der Produktion die **Spezifikation** unter `/api/docs` bereitstellt, aber nicht die Swagger **UI** unter `/api/swagger` – die UI ist separat an `NODE_ENV` gebunden. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt `includeSubDomains` zum `Strict-Transport-Security`-Header hinzu, sodass Browser reines HTTP auf jeder Subdomain des Hosts für sechs Monate verweigern – einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn jede Subdomain der Domain ausschließlich HTTPS nutzt. Alles außer `true`/`false` verweigert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Bleibt dies ungesetzt, ist der Endpunkt für jeden zugänglich, der den Port erreichen kann – in Ordnung in einem privaten Netzwerk, unzulässig in einem öffentlichen, was die Start-Logs auch melden. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start mit dem Schema tun darf. `ensure` (der Standard, überall – Produktion eingeschlossen) führt den **additiven** Durchlauf aus: Fehlende Tabellen, Spalten und Enum-Typen erstellen, niemals eine löschen oder umschreiben. `none` rührt nichts an. Das veröffentlichte Image akzeptiert nur diese beiden Werte und **verweigert den Start bei `push`**. In einem [Split-Deployment](/docs/deployment/split-processes) darf genau ein Prozess die Bereitstellung durchführen, daher müssen alle anderen Rollen `none` setzen oder den Start verweigern. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Verweigert den Start, wenn die Datenbank zuletzt aus einer anderen Gruppe von Collections bereitgestellt wurde als der, aus der dieser Prozess gebaut wurde. Ungesetzt (oder alles andere als `true`/`1`) gibt stattdessen eine Warnung aus. | warn |
| `REALTIME_CDC` | Change-Capture auf Datenbankebene: `auto` (aktivieren, wo die Verbindung es unterstützt, sonst stillschweigender Fallback), `trigger` (erzwingen, warnen falls unmöglich), `wal` (fällt aktuell auf `trigger` zurück), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). <span class="since-badge" data-since="0.25">Seit 0.25</span> Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Kanäle und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein instanziierter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Abonnements ein Realtime-Socket halten darf; das nächste wird mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl – alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | <span class="since-badge" data-since="0.25">Seit 0.25</span> Wie viele Realtime-Sockets ein Benutzer auf einer Serverinstanz geöffnet halten darf. Die Anmeldung des nächsten wird mit `TOO_MANY_SOCKETS` verweigert und der Socket geschlossen (4002); das SDK versucht es weiter, sodass er hineinkommt, wenn ein anderer geschlossen wird. Eine positive ganze Zahl – alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Kein Limit |
| `REALTIME_REFETCH_MAX_WAIT_MS` | <span class="since-badge" data-since="0.25">Seit 0.25</span> Die maximale Zeit, die eine Änderung auf das erneute Abrufen (Refetch) wartet, das sie an Live-Abonnenten liefert, in ms. Ein Refetch wartet 300 ms ohne Änderung und maximal diese Zeitspanne bei einem kontinuierlichen Schreibstrom. Eine positive ganze Zahl – alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | <span class="since-badge" data-since="0.25">Seit 0.25</span> Wie lange der Gesamtwert eines Abonnements einer großen Liste wiederverwendet werden darf, bevor er erneut gezählt wird, in ms; Frames, die ihn wiederverwenden, tragen `meta.totalAsOf`. Ungesetzt zählt jeder Frame. Hat Vorrang vor `realtime.recountIntervalMs`. | Unset |
| `REALTIME_RECOUNT_MIN_ROWS` | <span class="since-badge" data-since="0.25">Seit 0.25</span> Der kleinste Gesamtwert, für den `REALTIME_RECOUNT_INTERVAL_MS` gilt; kleinere Listen werden bei jedem Frame gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`/Loopback-Werte unter `NODE_ENV=production`. Standardmäßig aus, damit ein Produktionsstart deutlich fehlschlägt, anstatt sich mit einer nicht vorhandenen Datenbank zu verbinden. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Wie der Start mit einem Schlüssel in Ihren Collections umgeht, den diese Version nicht liest: `warn`, `error` (Start verweigern – sinnvoll in CI) oder `off`. Regelt nur Schlüssel, die er nicht *erkennt*, was meist ein Tippfehler und gelegentlich absichtliche Metadaten sind; ein Schlüssel, von dem bekannt ist, dass er verschoben wurde, ist immer fatal, da das Feature, das er konfiguriert hat, sonst stillschweigend fehlt. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet den Prozess, ohne einen Socket zu öffnen – die Form, die ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der Server, der darauf folgt. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein normales Deployment nicht versehentlich in eines verwandeln kann, das nur migriert und den Dienst verweigert. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` ermöglicht einer Maschine – einem Agenten, einem CI-Job –, eine Schemaänderung über `/api/admin/schema` *anzuwenden*, nicht nur zu planen. Standardmäßig aus: Die Anmeldedaten, die eine solche Änderung vornehmen könnten, befinden sich am ehesten in einer CI-Variable. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Wie lange eine benutzerdefinierte Funktion laufen darf, bevor ihre Anfrage abgebrochen wird. Derselbe Regler wie die Option `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` führt dazu, dass eine unbehandelte Promise-Rejection den Prozess beendet, anstatt sie nur zu protokollieren. Aktiviert unter einem Orchestrator, der Sie neu startet; deaktiviert, wo ein Neustart schlimmer ist als ein Leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Hält den Cron-Scheduler auf einer Plattform aktiv, die die Runtime andernfalls als Scale-to-Zero erkennt, wo ein Timer, der in einer inaktiven Instanz auslöst, in gar keiner Instanz auslöst. | — |
| `TRUSTED_PROXY_HOPS` | Wie viele Proxys vor diesem Server liegen, damit der Rate Limiter die echte Client-Adresse aus `X-Forwarded-For` lesen kann. Failsafe-Standard ist `0`: Ohne Proxy würde das Vertrauen in den Header jedem Aufrufer ermöglichen, eine Identität zu fälschen. | `0` |

:::note[Boot-Provisioning ist additiv und kein Migrationswerkzeug]
Der Startdurchlauf erfolgt unbeaufsichtigt, ohne dass jemand ein Diff prüft; daher
wird er niemals eine Spalte löschen, einen Typ einschränken oder eine Tabelle umschreiben.
Das ist auch der Grund, warum das Image `REBASE_MIGRATE_ON_BOOT=push` verweigert: Ein
vollständiges Push berechnet ein Diff und führt bereitwillig `DROP COLUMN` aus, und ein
Container-Neustart darf niemals als Nebeneffekt eines Neuansetzens eine Produktionsspalte
zerstören können.

Destruktive oder umstrukturierende Änderungen verbleiben dort, wo sie überprüft werden können:
`rebase db generate` + `rebase db migrate`, oder `rebase db push` aus einem Checkout oder CI,
was die Änderung im Probelauf prüft, destruktive Änderungen ohne Bestätigung verweigert und
zuvor ein Backup erstellen kann.
:::

### Split-Deployments

Ein einzelnes Image und ein Bundle können mehrfach gestartet werden, wobei jede Instanz
einen anderen Teil des Projekts bedient. Hier jeweils eine Zeile, da diese Seite den Anspruch
hat, jede Variable aufzulisten; was jede Kombination *einbindet und besitzt* – und welche
Kombinationen den Start verweigern –, finden Sie unter
**[Aufgeteilte Prozesse (Split Processes)](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Ungesetzt folgt der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Ungesetzt folgt der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | In diesem Prozess nur die benannten benutzerdefinierten Funktionen bedienen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen außer den benannten bedienen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. | — |

### MCP-Oberfläche

Ein optionaler Model Context Protocol-Endpunkt unter `/mcp`, damit ein KI-Client dieses
Projekt **als angemeldeter Benutzer** lesen und schreiben kann. Standardmäßig aus, und –
anders als bei jeder anderen Oberfläche – schaltet keine `REBASE_ROLE` dies ein: Die anderen
beschreiben eine Prozessform, während dies eine Entscheidung ist, Anmeldedaten an
Drittanbieter-Software zu übergeben, und von einer Person getroffen werden sollte, statt
von der Berufsbezeichnung eines Containers geerbt zu werden.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Die MCP-Oberfläche einbinden. Erfordert `REBASE_PUBLIC_URL`; ohne diese lehnt die Oberfläche das Einbinden ab und vermerkt dies im Start-Log. | `false` |
| `REBASE_PUBLIC_URL` | Die extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Oberfläche kann sie nicht ableiten – die Übernahme der Origin aus dem `Host`-Header würde die Identität des Ausstellers (Issuer) und die Audience, gegen die die eigenen Tokens geprüft werden, zu einem vom Aufrufer bereitgestellten Wert machen. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Dynamische OAuth-Client-Registrierung (RFC 7591) erlauben, damit sich ein Client selbst registrieren kann. Auf `false` setzen, um zu verlangen, dass Clients im Voraus registriert werden. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Aus, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes Bundle hat keinen
Collection-Quellcode zum Bearbeiten; sind diese Variablen gesetzt, liest der Collection-Editor
des Admins den Quellcode aus dem Repository, committet jede Änderung zurück und führt dessen DDL
auf dieser Datenbank aus. Nur für Admins, und von einer Person angewendet, es sei denn,
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` bestimmt etwas anderes. Ein Repository, das ohne
verwendbare Anmeldedaten benannt wird, verweigert den Start. Siehe
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository, in das Schemaänderungen committet werden sollen, im Format `owner/name`. Das Setzen dieser Variable aktiviert das Feature. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, auf dem der Commit landet. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Wo der Collection-Quellcode in diesem Repository liegt, relativ zum Repo. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein feingranulares Token mit Lese- und Schreibzugriff auf die Inhalte des Repositorys. Setzen Sie entweder dies oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub App, um als App statt mit einem Token zu committen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installation der App auf dem Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit maskierten Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Ungesetzt bedeutet, dass geplante Backups deaktiviert sind. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Ungesetzt oder `0` behält alles. | — |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens N der neuesten Backups behalten, unabhängig von den Aufbewahrungsregeln. | — |
| `PG_DUMP_PATH` | Überschreibt die `pg_dump`-Binärdatei – sie muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Überschreibt die `pg_restore`-Binärdatei. | — |
| `PG_DUMPALL_PATH` | Wo `pg_dumpall` liegt, wenn es sich nicht im `PATH` befindet. Ohne diesen Pfad – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) enthält die PostgreSQL 18 Client-Tools,
sodass ein geplantes Backup darin gegen jeden Server bis zu Postgres 18 ausgeführt werden kann.
Außerhalb des Images installieren Sie diese selbst (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups enthalten Secrets und personenbezogene Daten (PII). Verwenden Sie ein privates
Ziel mit Verschlüsselung im Ruhezustand (Encryption-at-Rest).

### Bundle-Bereitstellung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft
beim Start ein Bundle ab. Diese Variablen bestimmen, welches und wie.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Von wo das Bundle-Archiv abgerufen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Die Bearer-Anmeldedaten für diesen Abruf. Behandeln Sie dies als Geheimnis: Es autorisiert einen Mandanten, seinen eigenen Code herunterzuladen. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Wohin ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und die Zeitspanne zwischen Abruf und Start überstehen. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image für das Bundle bereitstellt, über die hinaus, die es selbst deklariert. | — |

### Ressourcen-Bindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `config/resources.ts`
deklariert, wird durch nach ihm benannte Umgebungsvariablen gebunden. Die Basisnamen
stehen unten; eine vom Standard abweichende Ressource hängt `__` und ihren Schlüssel
in Großbuchstaben an, sodass ein Bucket namens `media` die Variable `S3_BUCKET__MEDIA` liest.
`rebase status` gibt pro Ressource die genaue Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, wenn es nicht der Standard-Postgres-Treiber ist. Mit Suffix pro Quelle versehen: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Mit Suffix pro Topic versehen. | — |

### Die eigene Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hier beeinflusst ein Deployment.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Das Backend, mit dem `rebase auth` und `rebase api-keys` kommunizieren, anstatt es vom Projekt abzuleiten. | — |
| `REBASE_PORT` | Der Port, den diese Befehle bei der Ableitung dieser URL annehmen. | — |
| `SERVICE_KEY` | Der Service-Key, mit dem sie sich authentifizieren, anstatt danach zu fragen. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env`-Datei die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` spricht. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, als das sich `rebase cloud login` anmeldet, anstatt danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Dessen Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in den Shell-Verlauf gelangt. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der `rebase cloud login`-Sitzung und liest oder schreibt niemals die gespeicherte Sitzung. Die Methode zur Ausführung von `rebase cloud` in CI – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) liest denselben Namen als Alias für `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt den zugrunde liegenden Fehler und Request-Details anstelle der kurzen Nachricht aus. Das Erste, was gesetzt werden sollte, wenn ein `rebase cloud`-Befehl ohne hilfreiche Meldung fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | <span class="since-badge" data-since="0.25">Seit 0.25</span> Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle von `<db>_dev_diff`, das sie neben `DATABASE_URL` erstellen. Rebase erstellt oder löscht keine hier benannte Datenbank und verweigert eine, die `DATABASE_URL` entspricht. Auf der verwalteten Entwicklungsdatenbank setzt die CLI dies auf ein eigenes, temporäres In-Memory-PGlite. Setzen Sie dies dort ein, wo `CREATE DATABASE` nicht erlaubt ist. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und stellt nichts bereit – Sie bringen Ihre eigene mit. Dasselbe wie `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixiert den Port des Frontend-Dev-Servers, den `rebase dev` sonst aus dem Projektpfad ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` darauf wartet, dass sich das Backend meldet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert den Bericht. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einfügt. | — |
| `DO_NOT_TRACK` | Die werkzeugübergreifende Konvention. Auf alles außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe, speziell für Rebase. Benötigt keine Datei, weshalb dies die Variante für CI und Images ist. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Wohin Telemetriedaten gesendet werden, für einen selbst gehosteten Collector. | — |

## Secrets in der Entwicklung

`JWT_SECRET` und `REBASE_SERVICE_KEY` sind in der Produktion erforderlich und werden
außerhalb davon für Sie generiert, sodass Sie starten können, ohne etwas einrichten zu müssen.

Diese generierten Werte werden in `.rebase-dev-secrets.json` gecacht, neben
`.rebase-dev-port` und `.rebase-dev-url`, und mit diesen per Git ignoriert. Zuvor
wurden sie bei jedem Start neu generiert – sodass ein Neustart des Dev-Servers Sie aus
Ihrer eigenen App abmeldete und jeden gerade erstellten API-Schlüssel ungültig machte.

- Setzen Sie eine der beiden Variablen explizit, wird Ihr Wert verwendet; nichts wird gecacht oder gelesen.
- Verweisen Sie den Cache mit `REBASE_DEV_SECRETS_FILE` auf einen anderen Ort – ein Pfad, und
  die einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets zu rotieren. Der nächste Start schreibt eine neue.
- Kann die Datei nicht geschrieben werden – etwa in einem schreibgeschützten Container –, startet der
  Server trotzdem mit einem flüchtigen Secret, genau wie früher.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der
Produktion schlägt ein Start, der eines der beiden Secrets generieren müsste, weiterhin fehl
und nennt die Variable, was unverändert bleibt:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
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

<span class="since-badge" data-since="0.25">Seit 0.25</span> Dieselben Optionen,
ohne `app`, `server` und `basePath` und mit einem erforderlichen `provision`, bauen ein
Backend auf, das nichts ausliefert, bis Sie es mounten: `createRebaseBackend`. Siehe
[Benutzerdefinierte Server-Integration](/docs/backend/custom-server/).

### Ändern von `basePath`

`basePath` verschiebt jede API-Route, daher muss der Client entsprechend konfiguriert werden –
andernfalls fragt er weiterhin nach `/api/...` und erhält für alles einen 404-Fehler:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Das Admin-Panel übernimmt dies von dem Client, den es übergeben bekommt; sonst muss
nichts konfiguriert werden. Wenn Sie eine Request-URL manuell zusammensetzen, verknüpfen
Sie diese über den Client, anstatt `/api` selbst zu schreiben:

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
* **Ursache:** Standardmäßig versucht Rebase, Abfragen im SQL-Editor auszuführen, indem temporär die Datenbankrollen gewechselt werden, um der Anwendungsrolle des aktiven Benutzers zu entsprechen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen und nicht als echte PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer des Verbindungsinhabers ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase, SQL-Editor-Abfragen mit den Berechtigungen des Verbindungsinhabers (normalerweise ein Superuser/Owner) auszuführen. Der SQL-Editor meldet dann über den Ergebnissen, dass sie als Verbindungsinhaber gelesen wurden, und graut seine Rollenauswahl aus.

### Abrufen des Schemas im SQL-Editor fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden, oder der SQL-Editor gibt `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.` aus.
* **Ursache:** Rebase benötigt administrative Berechtigungen, um Datenbanksystemkataloge abzufragen und administrative Befehle auszuführen. Wenn `adminConnectionString` dem Bootstrapper nicht bereitgestellt wird oder `getAdmin()` überschrieben wird, um `undefined` zurückzugeben, schlagen diese Operationen fehl.
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

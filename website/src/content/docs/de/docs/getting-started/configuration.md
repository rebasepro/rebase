---
sourceHash: acc55c3c58895863
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projekt-Stammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> ein erforderlicher Wert fehlt oder fehlerhaft formatiert ist (eine URL, die keine URL ist, ein Port,
> der keine Zahl ist), verweigert der Server den Start und benennt die Variable.
>
> Wo das Schema definiert ist, hängt davon ab, wie Sie das Backend ausführen. Ein durch
> die Runtime gestartetes Projekt – `rebase dev`, `rebase start`, das veröffentlichte Image – verwendet
> das Schema der Runtime (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, für das [`rebase eject`](/docs/cli)
> ausgeführt wurde, besitzt eine eigene `backend/src/env.ts`, die `loadEnv({ extend })` aufruft, und kann dort eigene
> typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **In der Entwicklung optional** – wenn nicht gesetzt, führt `rebase dev` eine verwaltete PostgreSQL-Instanz für das Projekt aus, deren Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktion erforderlich** (wird in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` ist eine node-postgres-Schreibweise, keine von libpq.**
>
> Rebase und der Node-Treiber akzeptieren dies – verschlüsseln, aber das
> Zertifikat nicht prüfen. `psql`, `pg_dump`, `pg_restore` und Atlas tun dies nicht und
> tolerieren es auch nicht: Sie verweigern den Start mit `invalid sslmode value: "no-verify"`.
>
> Die Rebase-eigenen Befehle (`rebase db push`, `rebase db backup`, `rebase db
> restore`) schreiben dies vor dem Shell-Aufruf in das äquivalente `sslmode=require` um,
> sodass sie mit der konfigurierten URL funktionieren. Der manuelle Aufruf von `psql` tut dies
> nicht – ersetzen Sie den Wert dort durch `sslmode=require`, was exakt genauso
> verschlüsselt, ohne zu verifizieren.

### Frontend

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** – siehe unten. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Google-OAuth-Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, weshalb der Dev-Server
> dies injiziert. In der Produktion liefert das Rebase-Backend die SPA aus, sodass die
> API der eigene Origin der Seite ist und der Client dies von selbst so auflöst.
>
> Das feste Einbinden einer absoluten URL in ein Produktions-Bundle funktioniert genau so lange,
> bis ein zweiter Hostname auf dieselbe App verweist: Eine benutzerdefinierte Domain lädt die Seite dann von
> `example.com` und ruft die API unter `example.rebase.website` auf, was
> Cross-Origin ist, sodass jeder Request beim Preflight fehlschlägt. Das Erlauben des Origins in CORS
> behebt dies **nicht** – das Refresh-Cookie hat `SameSite=Lax` und wird
> nicht Cross-Site gesendet. Sie würden also die Konsolenfehler beseitigen, hätten aber dennoch eine defekte
> Authentifizierung. Wenn der Wert nicht gesetzt ist, funktioniert jede Domain, die auf die App verweist,
> ganz ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** – ein `PORT` in der `.env` wird dort nicht gelesen, da der Port vor dem Laden dieser Datei aufgelöst wird – und bindet andernfalls einen vom Projektpfad abgeleiteten Port, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner gibt die verwendete Methode an. | `3001` |
| `LOG_LEVEL` | Protokollierungs-Ausführlichkeit: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer Zeile `Failed query: [redacted]` an. Jedes fehlschlagende Statement wird standardmäßig geschwärzt, da eine fehlgeschlagene Abfrage gebundene Parameter enthält – eine E-Mail, einen Passwort-Hash. Setzen Sie dies während der Diagnose eines DDL-, RLS- oder Change-Capture-Fehlers auf `true`. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste erlaubter Origins. **In der Produktion erforderlich**, sofern `FRONTEND_URL` nicht gesetzt ist: Ein Produktionsstart ohne beides bricht ab. In der Entwicklung wird dies zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Dient in beiden Umgebungen als Alternative zu CORS_ORIGINS. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (für Schema-Introspektion und Admin-Operationen verwendet). Die dort angegebene Datenbank ist weder diejenige, die die SQL-Konsole als aktuell betrachtet, noch das, was ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der die eigene Verbindung der App liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert den PostgreSQL-Rollenwechsel im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Die SQL-Konsole von Studio meldet dann, dass Zeilen als Verbindungseigentümer gelesen wurden, benennt diesen und blendet die Rollenauswahl aus. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies bei einem Checkout, der [auf einen Branch gewechselt](/docs/backend/branching/#cli-integration) ist. Ein Server mit dieser Variablen hält das Branch-Register auf dieser Datenbank und kopiert neue Branches standardmäßig davon, sodass Studios Branch-Ansicht die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

Die Entwicklungsumgebung erlaubt **localhost sowie alle in `CORS_ORIGINS` (oder `FRONTEND_URL`)
angegebenen Origins** – dieselbe Liste, die die Produktion verwendet, wobei localhost hinzugefügt statt
ersetzt wird. Die Variable funktioniert also in beiden Umgebungen identisch, und die
Fälle, die sie in der Entwicklung erfordern, sind die üblichen:

```bash
# Ein Telefon im LAN, der Rechner eines Kollegen, ein ngrok-Tunnel,
# ein weitergeleiteter Codespaces-Port – alle Nicht-Localhost-Origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Ein Origin, der weder localhost noch aufgeführt ist, wird abgelehnt, und die Ablehnung wird
**einmal pro Origin** mit der genauen Zeile protokolliert, die ihn erlauben würde. Die Ablehnung ist
keine Vorsicht um ihrer selbst willen: Die API sendet Anmeldedaten. Die Spiegelung eines
beliebigen `Origin` würde es jeder Website, die der Entwickler zufällig besucht, ermöglichen,
authentifizierte Anfragen mit dessen Sitzung an den Dev-Server zu stellen und die
Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `JWT_SECRET` | Geheimnis für die JWT-Signierung (in Produktion erforderlich, in Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Zugriffstokens (RS256), sodass jede Instanz mit dem JWKS eine Sitzung überprüfen kann, ohne selbst Tokens ausstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEM. Ohne diesen Schlüssel bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie dies bei jedem Schlüsselwechsel – die Rotation hängt davon ab, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access-Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens. Gleitend – jede Rotation verlängert ihn, dies steuert also, wie lange eine Sitzung bei **Inaktivität** bestehen bleibt. Setzen Sie `400d` für Sitzungen, die lange Abwesenheiten überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Registrierung neuer Benutzer erlauben (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden einlassen, und dieser wird zum Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein über die offene Registrierung erstelltes erstes Konto ist ein normales Konto, und der Administrator wird über `REBASE_ADMIN_EMAIL` unten benannt oder mit dem Service-Key zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standardwert des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Notfallschalter (Kill Switch). Schließt das Erstbenutzer-Bootstrap-Fenster, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank gesperrt ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, da das Deployment sonst keine Möglichkeit hat, den ersten angemeldeten Benutzer zu erzeugen. Jedes ausgelieferte Deployment-Artefakt setzt dies. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail des ersten Admin-Kontos, das beim Booten erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. So erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt sich ein Wettrennen mit dem Internet zu liefern. Beim Booten wird gewarnt, wenn die Tabelle in der Produktion leer ist und dieser Wert nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto nicht erstellt. Nach der ersten Anmeldung ändern. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Geheimnis. Wenn ungesetzt, werden die Geheimnisse stattdessen mit `JWT_SECRET` verschlüsselt und beim Start wird einmal gewarnt – die Rotation von `JWT_SECRET` meldet dann alle Benutzer ab *und* macht jeden registrierten Authentifikator unentschlüsselbar. Setzen Sie einen dedizierten Schlüssel (32+ zufällige Zeichen), bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *wegrotiert* wird. Setzen Sie während einer Rotation beide Schlüssel: Neue Geheimnisse werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende bleiben lesbar, sodass niemand während der Rotation aus seinem Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Geheimnis neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht an `ALLOW_REGISTRATION` gekoppelt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API vorschreiben. Auf `false` setzen für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Stellt `POST /api/auth/find-user` bereit, wodurch eine E-Mail zu einem minimalen öffentlichen Profil (`uid`, `displayName`, `photoURL`) für Einladungsabläufe aufgelöst wird. Nur für authentifizierte Aufrufer; gibt niemals die E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: stellt eine Angriffsfläche für Enumeration dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` des Refresh-Cookies: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` auf dem Refresh-Cookie. Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für reines HTTP – z. B. ein Deployment auf einer LAN-Adresse, bei der der Browser das Cookie sonst verwerfen würde und die Sitzung beim Ablauf des Zugriffstokens ohne Fehler enden würde. Warnt beim Start. `http://localhost` benötigt dies nicht. | `true` |
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
| `APPLE_CLIENT_ID` | Apple-Services-ID für Web-Anmeldungen. Ist öffentlich und wird in `GET /auth/config` publiziert. Apple hat kein statisches Client-Secret, da Rebase für jeden Token-Austausch ein kurzlebiges ES256-JWT signiert. Apple benötigt daher `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` plus diesen Wert oder `APPLE_BUNDLE_IDS`, und konfiguriert ohne diese nichts. | — |
| `APPLE_BUNDLE_IDS` | Kommagetrennte Bundle-IDs der nativen iOS/macOS-Apps, deren Codes für „Mit Apple anmelden“ akzeptiert werden. | — |
| `APPLE_TEAM_ID` | Apple Developer Team-ID, der Aussteller (Issuer) des JWT. | — |
| `APPLE_KEY_ID` | Schlüssel-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten `.p8`-Schlüsseldatei inklusive Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Öffentlicher Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deploy; er enthält keine Geheimnisse. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` erlaubt er es dem Admin-Gate, ein Plattform-Token für `cron:read` zu akzeptieren, und für nichts anderes. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, mit der die `aud` eines Plattform-Tokens übereinstimmen muss, damit ein für ein anderes Projekt erstelltes Token abgelehnt wird. Ist nur eine der beiden Variablen gesetzt, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Speicherort für Authentifizierungs-Rate-Limit-Zähler: `memory` (pro Prozess) oder `sql` (über Replikate geteilt). Ein Prozess kann seine eigene Replikatanzahl nicht sehen, daher muss ein Deployment mit Peers dies angeben – drei Replikate beim Standardwert erzwingen das dreifache Limit. Jeder andere Wert **verhindert den Start**, anstatt auf einen Ausweichwert zurückzugreifen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Aktiviert den passwortlosen Magic-Link-Anmeldeablauf. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Aktiviert die passwortlose Anmeldung mit einem sechsstelligen, per E-Mail gesendeten Code. Dieselbe E-Mail-Anforderung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Anfrage per Magic-Link oder E-Mail-Code für eine unbekannte Adresse erstellt das Konto, sofern die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh-Token nach Ablauf seines Wiederverwendungsfensters erneut eingereicht wird: `reject` (Token ablehnen, Sitzung beibehalten) oder `revoke-session` (Sitzung beenden). Jeder andere Wert lässt den Start fehlschlagen. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrierung mit vorheriger Bestätigung: Keine Passwortanmeldung, bis die Adresse bestätigt ist. Erfordert E-Mail; der Start wird ohne abgelehnt. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert Captcha-Prüfung auf den Authentifizierungsrouten: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig zur Überprüfung des vom Browser gesendeten Tokens verwendet wird. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Authentifizierungsrouten (z. B. `register,login`). Wenn nicht gesetzt, wird der Standardsatz des Anbieters geschützt. | — |

### Storage

:::caution[Storage verfügt über keine Row-Level-Security und benötigt daher ein Zugriffsmodell]
Tabellen werden durch Postgres-RLS geschützt. Für Object Storage gibt es kein Äquivalent –
Schlüssel teilen sich einen flachen Namespace. Ist ein Bucket konfiguriert und kein
Zugriffsmodell definiert, **verweigert der Server in der Produktion den Start**. Erfüllen Sie
die Anforderung durch genau eine der folgenden Optionen: einen aus `backend/storage.ts` exportierten
`storageAuthorize`-Hook (Standard im Scaffold), `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `STORAGE_TYPE` | Storage-Backend: `local`, `s3` oder `gcs`. In der Produktion deaktiviert `local` den Storage, es sei denn, `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Storage. Ein relativer Pfad wird ausgehend vom Verzeichnis gelesen, in dem der Server läuft: das Projekt-Root unter `rebase dev`, `backend/` in einem durch `rebase eject` erzeugten Server | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Storage in der Produktion erlauben – nur mit einem persistenten Volume, das `STORAGE_PATH` und die benachbarten `<STORAGE_PATH>__<key>`-Verzeichnisse benannter lokaler Buckets enthält | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Gültigkeitsdauer der Download-URL einer privaten Datei in Sekunden – das Token, das `getSignedUrl()` einfügt. Maximal `604800` (eine Woche) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maximale Dateigröße, die die Quelle akzeptiert, in Bytes, auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Ein Wert, der keine ganze Byte-Zahl ist, verweigert den Start | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS-Access-Key | — |
| `S3_SECRET_ACCESS_KEY` | AWS-Secret-Key | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 etc.) | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für S3-Bucket erzwingen (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für einen Bucket gedacht, der tatsächlich als öffentliches CDN dient. Eine der drei Möglichkeiten, die Startbedingung unten zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jedem angemeldeten Aufrufer das Lesen, Schreiben, Auflisten und Löschen jedes Objekts erlauben. Im Konfigurationsobjekt aus gutem Grund als `INSECURE` benannt: Dies ist nur in einer Single-Tenant-App vertretbar, in der jedem Konto bezüglich jeder Datei vertraut wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bildwiedergaben (Größenanpassungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu berechnen. | `false` |

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
| `APP_NAME` | Produktname für E-Mail-Betreffzeilen und -Texte (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo am Anfang der Standard-E-Mail-Vorlagen. Absolute `http(s)`-PNG- oder JPG-URL – E-Mail-Clients entfernen SVG und blockieren `data:`-URIs. Ungesetzt erhält eine App mit dem Namen `Rebase` das Rebase-Logo; eine umbenannte App erhält keines |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `DB_POOL_MAX` | Maximale Anzahl an Pool-Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung gehalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine: `LISTEN`/`NOTIFY` funktioniert über einen Transaction-Pooler wie PgBouncer nicht, und ohne direkte Verbindung werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, anstatt unbemerkt verloren zu gehen. Auch der [Job-Worker](/docs/backend/jobs) hält sein Aufwach-`LISTEN` darüber. Füllt die `directConnectionString` des Postgres-Adapters aus, wenn diese nicht gesetzt ist. | — |
| `DATABASE_READ_URL` | Read-Replica, wie z. B. ein Hot-Standby. Wenn ein anderer Server angegeben ist, werden authentifizierte Lesezugriffe (Listen, einzelne Zeilen, Counts, Aggregate) dort unter derselben Row-Level-Security ausgeführt; Schreibvorgänge, Anmeldungen, Realtime, Crons, Jobs, die SQL-Konsole und `rebase.sql` verbleiben auf dem primären Server. Ein Leser, der gerade geschrieben hat, liest für die Dauer von `REBASE_READ_STICKY_MS` vom primären Server, und alle tun dies, solange das Replikat mehr als `REBASE_READ_MAX_LAG_MS` hinterherhinkt oder fehlschlägt. Füllt die `readConnectionString` des Postgres-Adapters aus, wenn diese nicht gesetzt ist; bis einschließlich Version 0.28 wurde der Pool des Replikats zwar geöffnet, aber nie ausgelesen. | — |
| `REBASE_READ_STICKY_MS` | Dauer nach einem Schreibvorgang, für die Lesezugriffe desselben Benutzers an den primären Server gehen, sodass ein Speichervorgang gefolgt von einer Listenabfrage den neuen Stand widerspiegelt. Pro Server-Instanz. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Replica-Lag, ab dem alle Lesezugriffe an den primären Server geleitet werden. | `1000` |
| `DATABASE_POOLED` | `true`, wenn `DATABASE_URL` über einen Pooler im Transaktionsmodus wie PgBouncer läuft. Der Pool sendet dann beim Verbindungsaufbau kein `search_path` oder `statement_timeout` (der Pooler würde dies ablehnen oder verwerfen) und setzt beides in jeder Transaktion; der Bootvorgang weist der Datenbankrolle für Anweisungen außerhalb einer Transaktion einen Standard-`search_path` von `public` zu. `DATABASE_DIRECT_URL` wird dadurch erforderlich, und Realtime, das Aufwachen des Job-Workers, Indexerstellungen, Branching sowie die SQL-Konsole verwenden diese. Die URL des Replikats wird ebenfalls als gepoolt angenommen. `DATABASE_POOLED__<KEY>` für eine weitere Datenquelle. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was einzeln angefordert wurde. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server stillschweigend zu serialisieren. | — |

### Runtime-Verhalten

Wird von der Runtime gelesen – `rebase dev`, `rebase start` und dem veröffentlichten Server-Image.
Ein Projekt, für das `eject` ausgeführt wurde, steuert diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) aus, welches Tabellen meldet, die ohne Richtlinien bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime enthält keine eigene Kopie, und ohne das Paket bricht der Start unter Nennung des Pakets ab. `false` hält den Scan von diesem Prozess fern. | — |
| `REBASE_RLS_REQUEST_ROLE` | Die Postgres-Rolle, unter der authentifizierte und anonyme Anfragen ausgeführt werden. Weisen Sie jedem Projekt auf einem gemeinsam genutzten Cluster eine eigene zu. Eine Datenbank zeichnet die Rolle auf, unter der sie läuft, und ein für eine andere Rolle konfigurierter Start verweigert den Dienst, bis `rebase db request-role migrate` die Migration durchführt. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` erstellt die Request-Rolle und erlaubt der Verbindung, zu dieser zu wechseln; `never` überlässt beides Ihnen und prüft dies lediglich. | `auto` |
| `REBASE_RLS_GRANTS` | Was Rebase der Request-Rolle gewährt: `schema` (jede Tabelle in den bereitgestellten Schemas plus Standardprivilegien), `managed` (nur die bereitgestellten Tabellen) oder `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` schränkt die permissiven Richtlinien von Rebase auf die Request-Rolle(n) ein, sodass andere Rollen, die dieselben Tabellen lesen, keine Berechtigungen daraus erhalten. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` erstellt die Richtlinien, die nur der Server-Kontext oder ein Administrator erfüllen kann, `TO public`, und führt Administratoren als Request-Rolle aus. Standardmäßig lauten sie `TO rebase_admin`, sodass eigentümerbezogene Lesezugriffe angemeldeter Benutzer den Eigentümer-Index nutzen können. Siehe [Admin-Anfragen und `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` entfernt die Server- oder Admin-Basisrichtlinie von jeder Tabelle. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` setzt zusätzlich `request.jwt.claims` und `request.jwt.claim.*`, sodass mit `auth.uid()` verfasste Richtlinien den Aufrufer erkennen. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Verhalten beim Start, wenn ein anderes Login in die Request-Rolle wechseln kann: `warn`, `refuse` oder `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Dem Client muss dasselbe mitgeteilt werden – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische/Admin-Assets des Bundles über diesen Prozess ausliefern. Deaktivieren Sie dies, wenn ein CDN vorgeschaltet ist. | `true` |
| `REBASE_HISTORY` | [Entitäts-Änderungshistorie](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | Antworten mit gzip/brotli komprimieren. | `true` |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body, **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verweigert den Start, anstatt das Limit stillschweigend aufzuheben). `0` schaltet das Limit aus. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände. <span class="since-badge" data-since="0.31">Seit 0.31</span> Wenn nicht gesetzt, in jeder Umgebung: `/api/docs` wird den Aufrufern bereitgestellt, für die `GET /api/schema/tables` Tabellen beschreibt, jeweils das Dokument der für sie beschriebenen Tabellen, und es gibt keine Swagger-UI. `true` veröffentlicht das gesamte Dokument für alle, mit der Swagger-**UI** unter `/api/swagger` außerhalb der Produktion (niemals in der Produktion). `false` hält das Dokument hinter dem Admin-Gate. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt dem `Strict-Transport-Security`-Header `includeSubDomains` hinzu, sodass Browser für sechs Monate reines HTTP auf jeder Subdomain des Hosts verweigern – einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn jede Subdomain der Domain ausschließlich über HTTPS läuft. Jeder Wert außer `true`/`false` verweigert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn ungesetzt, bleibt der Endpunkt für jeden offen, der den Port erreichen kann – in einem privaten Netzwerk in Ordnung, in einem öffentlichen nicht, und die Startprotokolle weisen darauf hin. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start am Tabellenschema ändern darf. `ensure` (der Standardwert überall – einschließlich Produktion) führt den **additiven** Durchlauf aus: Fehlende Tabellen, Spalten und Enum-Typen erstellen, niemals etwas löschen oder umschreiben. `none` lässt das Schema der deklarierten Tabellen unangetastet, die Framework-eigenen Tabellen (Auth, API-Keys, Jobs, Cron) werden jedoch weiterhin erstellt und aktuell gehalten; `REBASE_PROVISION=false` schaltet auch diese ab. Das veröffentlichte Image akzeptiert nur diese beiden Werte und **verweigert den Start bei `push`**. In einem [Split-Deployment](/docs/deployment/split-processes) darf genau ein Prozess provisionieren, sodass jede andere Rolle `none` setzen muss oder den Start verweigert. | `ensure` |
| `REBASE_PROVISION` | `false` sorgt dafür, dass die Runtime nichts in ihrer Datenbank ändert: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Richtlinie, Rolle oder Berechtigung, weder beim Start noch später, einschließlich der Framework-eigenen. Stattdessen wird namentlich gemeldet, was fehlt. Für eine Datenbank, die nur durch Ihren Änderungsprozess verändert werden darf. Siehe [Wenn nur Ihr Änderungsprozess die Datenbank ändern darf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Nur `true` und `false` werden akzeptiert. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Start verweigern, wenn die Datenbank zuletzt aus einer anderen Tabellenmenge provisioniert wurde als der, aus der dieser Prozess erstellt wurde. Wenn ungesetzt (oder bei jedem anderen Wert als `true`/`1`), wird stattdessen gewarnt. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Start verweigern, wenn eine Funktions- oder Cron-Datei beim Importieren einen Fehler auslöst oder nicht geparst werden kann, unter Nennung der jeweiligen Datei und des Grundes, sodass ein Rolling Deployment die alte Version weiter ausliefert. Auch ein Neustart wird daran gebunden. Wenn ungesetzt (oder bei jedem anderen Wert als `true`), wird die Datei übersprungen und der Rest ausgeliefert. Eine Datei, die sauber importiert wird und keine Funktion oder keinen Job exportiert, wird immer übersprungen, nicht abgelehnt. | skip |
| `REALTIME_CDC` | Change Capture auf Datenbankebene: `auto` (aktivieren, wo die Verbindung es unterstützt, andernfalls stillschweigend zurückfallen), `trigger` (erzwingen, warnen wenn unmöglich), `wal` (Änderungen aus dem Write-Ahead-Log statt über Trigger lesen; erfordert `wal_level=logical` und eine Rolle mit Replikationsrechten, fällt andernfalls auf `trigger` zurück), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Channels und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein instanziierter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Abonnements ein Realtime-Socket halten darf; das nächste wird mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Wie viele Realtime-Sockets ein Benutzer oder ein API-Schlüssel auf einer Server-Instanz geöffnet halten darf. Sockets eines Administrators mit Identitätswechsel zählen für den Administrator. Die Anmeldung des nächsten wird mit `TOO_MANY_SOCKETS` abgelehnt und das Socket geschlossen (4002); das SDK versucht es weiter, sodass es verbunden wird, sobald ein anderes schließt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Kein Limit |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Maximale Wartezeit in ms, die eine Änderung auf das erneute Abrufen (Refetch) wartet, das sie an aktive Abonnenten zustellt. Ein Refetch wartet 300 ms ohne Änderung und bei einem stetigen Strom von Schreibvorgängen höchstens diese Zeit. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Wie lange die Gesamtzahl eines großen Listenabonnements in ms wiederverwendet werden darf, bevor sie erneut gezählt wird; Frames, die sie wiederverwenden, tragen `meta.totalAsOf`. Wenn ungesetzt, wird bei jedem Frame neu gezählt. Hat Vorrang vor `realtime.recountIntervalMs`. | Ungesetzt |
| `REALTIME_RECOUNT_MIN_ROWS` | Die kleinste letzte Gesamtzahl, für die `REALTIME_RECOUNT_INTERVAL_MS` gilt; kleinere Listen werden bei jedem Frame gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`- bzw. Loopback-Werte unter `NODE_ENV=production`. Standardmäßig deaktiviert, sodass ein Produktionsstart deutlich fehlschlägt, anstatt sich mit einer nicht vorhandenen Datenbank zu verbinden. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet sich, ohne einen Socket zu öffnen – genau das Verhalten, das ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der nachfolgende Server. Es erstellt auch die Tabellen, die ein Serverprozess sonst bei der ersten Verwendung erstellen würde, und startet weder Cron noch Job-Warteschlangen. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein normales Deployment nicht versehentlich in eines verwandeln kann, das migriert und den Dienst verweigert. In Kombination mit `REBASE_PROVISION=false` nicht zulässig. | — |
| `REBASE_PROVISION_SQL_OUT` | Ein Dateipfad. Ein Provisionierungslauf (`REBASE_PROVISION_ONLY=true`) schreibt jede durchgeführte Schemaänderung der Reihe nach als SQL-Skript in diese Datei, um sie mit `psql` zu überprüfen und anzuwenden. Geschriebene Zeilen sind nicht enthalten. Auf einem Prozess, der Anfragen bedient, nicht zulässig. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt es einer Maschine – einem Agenten, einem CI-Job –, eine Schemaänderung über `/api/admin/schema` nicht nur zu planen, sondern auch *anzuwenden*. Deaktiviert, sofern nicht explizit angefordert: Die Anmeldedaten, die eine solche Änderung durchführen könnten, liegen am ehesten in einer CI-Variablen. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Maximale Ausführungszeit einer benutzerdefinierten Funktion, bevor deren Anfrage abgebrochen wird. Derselbe Parameter wie die Option `functionsTimeoutMs`. `0` schaltet das Timeout ab. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` bewirkt, dass eine unbehandelte Promise-Rejection den Prozess beendet, anstatt ihn nur zu protokollieren. Aktivieren Sie dies unter einem Orchestrator, der den Prozess neu startet; deaktivieren Sie es, wenn ein Neustart schlimmer ist als ein Leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Unterdrückt die Startwarnung auf Plattformen, die von der Runtime als Scale-to-Zero erkannt werden, auf denen ein Timer in einer inaktiven Instanz in gar keiner Instanz ausgelöst wird. Ändert sonst nichts: Setzen Sie dies, wenn Sie mindestens eine Instanz dauerhaft betreiben. | — |
| `TRUSTED_PROXY_HOPS` | Anzahl der vorgeschalteten Proxys vor diesem Server, damit der Rate-Limiter die echte Client-Adresse aus `X-Forwarded-For` lesen kann. Ausfallsicherer Standardwert `0`: Ohne Proxy würde das Vertrauen in den Header jedem Aufrufer erlauben, eine Identität vorzutäuschen. | `0` |

:::note[Boot-Provisionierung ist additiv und kein Migrationswerkzeug]
Der Boot-Durchlauf läuft unbeaufsichtigt und ohne dass jemand ein Diff prüft; er wird daher niemals eine Spalte löschen, einen Typ einschränken oder eine Tabelle umschreiben. Aus diesem Grund verweigert das Image auch `REBASE_MIGRATE_ON_BOOT=push`: Ein vollständiger Push berechnet ein Diff und führt ohne Weiteres ein `DROP COLUMN` aus, und ein Container-Neustart darf niemals als Nebeneffekt eines Neuansetzens eine Produktionsspalte zerstören können.

Destruktive oder umstrukturierende Änderungen verbleiben dort, wo sie überprüft werden können: `rebase db generate` + `rebase db migrate`, oder `rebase db push` aus einem Checkout oder CI, was die Änderung trocken ausführt (Dry-Run), destruktive Änderungen ohne Bestätigung ablehnt und zuvor ein Backup erstellen kann.
:::

### Split-Deployments

Ein einzelnes Image und ein einzelnes Bundle können mehrfach gestartet werden, wobei jede Instanz einen anderen Teil des Projekts bedient. Hier jeweils eine Zeile, da diese Seite den Anspruch hat, jede Variable aufzulisten; was jede Kombination *bereitstellt und verwaltet* – und welche Kombinationen den Start verweigern – finden Sie unter **[Split-Prozesse](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Wenn ungesetzt, richtet es sich nach der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess die Worker der Job-Warteschlange ausführt. Wenn ungesetzt, richtet es sich nach der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | In diesem Prozess nur die genannten benutzerdefinierten Funktionen bereitstellen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Jede benutzerdefinierte Funktion außer den genannten bereitstellen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. Auf einem `worker`, wohin dessen eigene `rebase.functions`-Aufrufe gehen. Eine `http(s)`-URL. | — |

### MCP-Schnittstelle

Ein optionaler Model Context Protocol-Endpunkt unter `/mcp`, damit ein KI-Client dieses Projekt **als der angemeldete Benutzer** lesen und beschreiben kann. Standardmäßig deaktiviert, und – anders als bei jeder anderen Schnittstelle – schaltet keine `REBASE_ROLE` ihn ein: Die anderen beschreiben eine Prozessform, während dies eine Entscheidung ist, Anmeldedaten an Software von Drittanbietern zu übergeben. Sie sollte von einer Person getroffen und nicht von der Aufgabenbezeichnung eines Containers geerbt werden.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_MCP_ENABLED` | Bindet die MCP-Schnittstelle ein. Erfordert `REBASE_PUBLIC_URL`; ohne diese wird die Schnittstelle nicht eingebunden und dies im Startprotokoll vermerkt. | `false` |
| `REBASE_PUBLIC_URL` | Der extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Schnittstelle kann diesen nicht ableiten – die Übernahme des Origins aus dem `Host`-Header würde die Issuer-Identität und die Audience, gegen die ihre eigenen Tokens geprüft werden, zu einem vom Aufrufer bereitgestellten Wert machen. | — |
| `REBASE_MCP_VIEW` | Pfad zur projekteigenen MCP-App-Ansicht (`rebase-view.html`, generiert von `rebaseMcpViewPlugin()`), die Claude anstelle der generischen Ansicht bereitgestellt wird, damit Ihre benutzerdefinierten Ansichten, Felder und Aktionen dargestellt werden. Ohne diesen sucht das Backend neben dem Frontend, das es ausliefert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Dynamische OAuth-Client-Registrierung erlauben (RFC 7591), sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um eine vorherige Registrierung der Clients zu erzwingen. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Deaktiviert, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes Bundle enthält keinen `backend/schema`-Quellcode zum Bearbeiten; wenn diese Variablen gesetzt sind, liest der Schema-Editor den Quellcode aus dem Repository, committet jede Änderung dorthin zurück und führt sein DDL auf dieser Datenbank aus. Nur für Admins und von einer Person angewendet, es sei denn, `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` bestimmt etwas anderes. Ein angegebenes Repository ohne verwendbare Anmeldedaten verweigert den Start. Siehe [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository, in das Schemaänderungen committet werden sollen, im Format `owner/name`. Das Setzen dieser Variablen aktiviert die Funktion. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, auf dem der Commit landet. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Speicherort von `backend/schema` in diesem Repository, relativ zum Repository-Root. Ein Pfad, der das Repository verlässt, verweigert den Start; dasselbe gilt für das entfernte `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein fein abgestimmtes Token mit Lese- und Schreibzugriff auf den Repository-Inhalt. Setzen Sie entweder dies oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub App, um als App statt mit einem Token zu committen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installation der App auf dem Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit maskierten Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Wenn ungesetzt, sind geplante Backups deaktiviert. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. Erforderlich zusammen mit `BACKUP_SCHEDULE`, welches ohne diesen Wert die Ausführung verweigert. `rebase db backup` fällt auf `./backups` an dem Ort zurück, an dem es ausgeführt wurde. | — |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Ungesetzt oder `0` behält alles. | — |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens N der neuesten Backups behalten, unabhängig von der Aufbewahrungsfrist. | — |
| `PG_DUMP_PATH` | Pfad zur `pg_dump`-Binärdatei überschreiben – sie muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Pfad zur `pg_restore`-Binärdatei überschreiben. | — |
| `PSQL_PATH` | Pfad zur `psql`-Binärdatei überschreiben, die `rebase db restore --clean` ausführt, um die Wiederherstellung in einer einzigen Transaktion durchzuführen. | — |
| `PG_DUMPALL_PATH` | Speicherort von `pg_dumpall`, wenn es nicht im `PATH` liegt. Ohne diese Datei – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) enthält die PostgreSQL 18-Client-Tools, sodass ein geplantes Backup darin gegen jeden Server bis Postgres 18 ausgeführt werden kann. Außerhalb des Images installieren Sie diese selbst (`apt-get install postgresql-client-18`, `brew install libpq`).

Backups enthalten Geheimnisse und personenbezogene Daten. Verwenden Sie ein privates Ziel mit Verschlüsselung im Ruhezustand (Encryption-at-Rest).

### Bundle-Bereitstellung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft beim Start ein Bundle ab. Diese Variablen bestimmen, welches und wie.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Ort, von dem das Bundle-Archiv abgerufen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Das Bearer-Token für diesen Abruf. Behandeln Sie es als Geheimnis: Es autorisiert einen Mandanten, seinen eigenen Code herunterzuladen. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Ort, an den ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und zwischen dem Abruf und dem Start erhalten bleiben. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image dem Bundle über die selbst deklarierten hinaus bereitstellt. | — |

### Ressourcen-Bindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `backend/resources.ts` deklariert, wird über danach benannte Umgebungsvariablen gebunden. Die Basisnamen finden Sie unten; eine Nicht-Standardressource hängt `__` und ihren Schlüssel in Großbuchstaben an, sodass ein Bucket namens `media` als `S3_BUCKET__MEDIA` gelesen wird. `rebase status` gibt pro Ressource die genaue Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, sofern es sich nicht um den standardmäßigen Postgres-Treiber handelt. Mit Suffix pro Quelle: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Mit Suffix pro Topic. | — |

### Eigene Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hiervon beeinflusst ein Deployment.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_BASE_URL` | Wohin `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service-Key senden, in der Shell oder in der `.env`. Setzen Sie diesen Wert, wenn der Server auf andere Weise als über `rebase dev` in diesem Projekt läuft: `rebase start`, ein Container, ein anderer Host. Wenn ungesetzt, verwenden sie den Server, den `rebase dev` während seiner Laufzeit aufgezeichnet hat, und senden nichts, wenn er nicht läuft. | — |
| `REBASE_SERVICE_KEY` | Der Service-Key, mit dem sich diese Befehle authentifizieren, gelesen aus der `.env`: dieselbe Variable, die der Server liest (siehe oben). | — |
| `SERVICE_KEY` | Eine ältere Bezeichnung für diesen Schlüssel. Wenn in der `.env` gesetzt, lesen `rebase api-keys` und `rebase storage` ihn anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env`-Datei die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_ROOT_RULES` | `0` verhindert, dass `rebase init` und `rebase skills install` die Projektregeln in die Dateien `CLAUDE.md` und `AGENTS.md` im Repository-Root schreiben – für den Fall, dass Sie Agenten-Dateien im Root manuell pflegen. | on |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, unter dem sich `rebase cloud login` anmeldet, anstatt danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Das zugehörige Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in den Shell-Verlauf gelangt. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der Sitzung aus `rebase cloud login` und liest oder schreibt die gespeicherte Sitzung niemals. In einem Verzeichnis, das mit `rebase cloud init --claim` verknüpft wurde, wird es zugunsten des projekteigenen Tokens zurückgestellt, wenn es keinen Gültigkeitsbereich für das Projekt besitzt. Die Methode zur Ausführung von `rebase cloud` im CI – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) übergibt es an die CLI, die seine Cloud-Tools starten, und sendet es niemals an die App: Setzen Sie dafür `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt den zugrunde liegenden Fehler und Anfragedetails anstelle der Kurznachricht aus. Die erste Maßnahme, wenn ein `rebase cloud`-Befehl ohne hilfreiche Meldung fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle der Datenbank `<db>_dev_diff`, die sie neben `DATABASE_URL` erstellen. Rebase erstellt oder löscht hier benannte Datenbanken nicht und verweigert eine Angabe, die mit `DATABASE_URL` identisch ist. Auf der verwalteten Entwicklungsdatenbank setzt die CLI dies auf ein eigenes temporäres In-Memory-PGlite. Setzen Sie dies dort, wo `CREATE DATABASE` nicht gewährt wird. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und provisioniert nichts – Sie bringen Ihre eigene mit. Entspricht `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Legt den Port des Frontend-Dev-Servers fest, den `rebase dev` andernfalls aus dem Projektpfad ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` darauf wartet, dass sich das Backend meldet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert die Meldung. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einfügt. | — |
| `DO_NOT_TRACK` | Die werkzeugübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe speziell für Rebase. Benötigt keine Datei und ist daher die bevorzugte Variante in CI-Umgebungen und in Images. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Zieladresse für Telemetriedaten bei einem selbst gehosteten Collector. | — |

## Secrets in der Entwicklung

`JWT_SECRET` ist in der Produktion erforderlich. Dieser Wert und `REBASE_SERVICE_KEY` werden
außerhalb der Produktion automatisch für Sie generiert, sodass Sie ohne Einrichtung starten können.

Diese generierten Werte werden in `.rebase-dev-secrets.json` zwischengespeichert, neben
`.rebase-dev-port` und `.rebase-dev-url`, und sind zusammen mit ihnen in gitignore eingetragen. Zuvor wurden
sie bei jedem Start neu generiert – ein Neustart des Dev-Servers meldete Sie daher aus
Ihrer eigenen App ab und entwertete jeden zuvor erstellten API-Schlüssel.

- Setzen Sie eine der Variablen explizit, wird Ihr Wert verwendet; es wird nichts zwischengespeichert oder gelesen.
- Leiten Sie den Cache mit `REBASE_DEV_SECRETS_FILE` auf einen anderen Ort um – ein Pfad und die
  einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets neu zu generieren. Der nächste Start schreibt eine neue Datei.
- Wenn die Datei nicht geschrieben werden kann – beispielsweise in einem schreibgeschützten Container –, startet der Server
  dennoch mit einem ephemeren Secret, genau wie früher.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion
wird auch nichts automatisch generiert: Ein Start ohne `JWT_SECRET` schlägt fehl und nennt die Variable,
was unverändert bleibt:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Backend-Konfigurationsobjekt

<span class="since-badge" data-since="0.31">Seit 0.31</span>

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

Dieselben Optionen – ohne `app`, `server` und `basePath` sowie mit einem erforderlichen `provision` – erstellen ein Backend, das nichts ausliefert, bis Sie es mounten: `createRebaseBackend`. Siehe [Benutzerdefinierte Server-Integration](/docs/backend/custom-server/).

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

Das Admin-Panel übernimmt dies automatisch vom übergebenen Client; es muss nichts
weiter konfiguriert werden. Wenn Sie eine Anfrage-URL manuell zusammensetzen, verketten Sie sie über den Client,
anstatt `/api` manuell einzutragen:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### Keine Berechtigung im SQL-Editor (`permission denied for table <name>`)

* **Symptome:** Im SQL-Editor von Rebase Studio ausgeführte benutzerdefinierte Abfragen schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellen-CMS-Ansicht Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, SQL-Editor-Abfragen durch temporären Wechsel der Datenbankrollen entsprechend der Anwendungsrolle des aktiven Benutzers auszuführen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen und nicht als echte PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer des Verbindungseigentümers ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie Ihrer Backend-Konfiguration in `.env` die Zeile `DISABLE_DB_ROLE_SWITCHING=true` hinzu. Dadurch wird Rebase gezwungen, Abfragen im SQL-Editor mit den Rechten des Verbindungseigentümers (in der Regel ein Superuser/Owner) auszuführen. Der SQL-Editor zeigt dann über den Ergebnissen an, dass diese als Verbindungseigentümer gelesen wurden, und blendet die Rollenauswahl aus.

### Abruf des Schemas im SQL-Editor fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden oder der SQL-Editor gibt den Fehler `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.` aus.
* **Ursache:** Rebase benötigt administrative Rechte, um Datenbanksystemkataloge abzufragen und administrative Befehle auszuführen. Wenn dem Bootstrapper keine `adminConnectionString` übergeben wird oder `getAdmin()` so überschrieben ist, dass `undefined` zurückgegeben wird, schlagen diese Operationen fehl.
* **Lösung:** Stellen Sie sicher, dass `adminConnectionString` während der Bootstrapper-Initialisierung des Backends konfiguriert ist:
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

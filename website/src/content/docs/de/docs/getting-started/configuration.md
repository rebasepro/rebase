---
sourceHash: 58e2c845978a7611
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projektstammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> eine erforderliche Variable fehlt oder fehlerhaft ist (eine URL, die keine URL ist, ein Port,
> der keine Zahl ist), verweigert der Server den Start und nennt die entsprechende Variable.
>
> Wo das Schema definiert ist, hängt davon ab, wie Sie das Backend ausführen. Ein von der
> Runtime gestartetes Projekt – `rebase dev`, `rebase start`, das veröffentlichte Image – verwendet
> das Schema, das der Runtime gehört (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, das [`rebase eject`](/docs/cli)
> ausgeführt hat, besitzt eine eigene Datei `backend/src/env.ts`, die `loadEnv({ extend })` aufruft,
> und kann dort eigene typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **Optional in der Entwicklung** – wenn nicht gesetzt, führt `rebase dev` eine verwaltete PostgreSQL-Instanz für das Projekt aus, deren Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mindestens 32 Zeichen). **In der Produktion erforderlich** (wird in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` ist eine Schreibweise von node-postgres, nicht von libpq.**
>
> Rebase und der Node-Treiber akzeptieren sie – verschlüsseln, aber das
> Zertifikat nicht prüfen. `psql`, `pg_dump`, `pg_restore` und Atlas tun dies nicht
> und degradieren nicht: Sie verweigern den Start mit `invalid sslmode value: "no-verify"`.
>
> Die eigenen Befehle von Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) schreiben sie vor dem Shell-Aufruf in das äquivalente `sslmode=require` um,
> sodass sie mit der konfigurierten URL funktionieren. Wenn Sie `psql` manuell aufrufen,
> gilt das nicht – ersetzen Sie den Wert dort durch `sslmode=require`, was auf genau
> dieselbe Weise ohne Verifizierung verschlüsselt.

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** – siehe unten. | Page-Origin |
| `VITE_GOOGLE_CLIENT_ID` | Google-OAuth-Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, daher injiziert
> der Dev-Server diesen Wert. In der Produktion liefert das Rebase-Backend die SPA aus,
> sodass die API die eigene Origin der Seite ist und der Client dies selbstständig auflöst.
>
> Das feste Einbinden einer absoluten URL in ein Produktions-Bundle funktioniert nur so
> lange, bis ein zweiter Hostname auf dieselbe App zeigt: Eine benutzerdefinierte Domain lädt
> die Seite dann von `example.com` und ruft die API unter `example.rebase.website` auf,
> was Cross-Origin ist, sodass jeder Request beim Preflight fehlschlägt. Das Erlauben der Origin
> in CORS behebt dies **nicht** – das Refresh-Cookie ist `SameSite=Lax` und wird nicht
> Cross-Site gesendet, sodass Sie zwar die Konsolenfehler beseitigen würden, die Authentifizierung
> aber weiterhin defekt wäre. Wenn die Variable nicht gesetzt ist, funktioniert jede auf die
> App zeigende Domain gänzlich ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **ausschließlich aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort nicht gelesen, da der Port aufgelöst wird, bevor diese Datei geladen wird – und bindet andernfalls einen Port, der vom Projektpfad abgeleitet wird, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner gibt die verwendete Prioritätsstufe an. | `3001` |
| `LOG_LEVEL` | Logging-Detailgrad: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer `Failed query: [redacted]`-Zeile an. Jedes fehlschlagende Statement wird standardmäßig geschwärzt, da eine fehlgeschlagene Abfrage gebundene Parameter enthält – etwa eine E-Mail-Adresse oder einen Passwort-Hash. Setzen Sie dies während der Diagnose eines DDL-, RLS- oder Change-Capture-Fehlers auf `true`. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste erlaubter Origins. **In Produktion erforderlich**, falls abweichend von der Backend-Domain. In der Entwicklung wird sie zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu CORS_ORIGINS verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge mit Administratorrechten (wird für Schema-Introspektion und Administrationsoperationen verwendet). Die hier angegebene Datenbank ist weder diejenige, die die SQL-Konsole als aktuell bezeichnet, noch diejenige, die ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der die eigene Verbindung der App liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert das Wechseln von PostgreSQL-Rollen im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Die SQL-Konsole von Studio zeigt dann an, dass die Zeilen als Verbindungseigentümer gelesen wurden, nennt diesen und graut die Rollenauswahl aus. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies bei einem Checkout, der [auf einen Branch umgestellt wurde](/docs/backend/branching/#cli-integration). Ein Server mit dieser Variable behält die Branch-Registry auf dieser Datenbank und kopiert neue Branches standardmäßig von dort, sodass der Branches-Bereich von Studio die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

Die Entwicklungsumgebung erlaubt **localhost plus alle in `CORS_ORIGINS` (oder `FRONTEND_URL`)
angegebenen Origins** – dieselbe Liste, die die Produktion verwendet, wobei localhost hinzugefügt
statt ersetzt wird. Die Variable funktioniert in beiden Umgebungen also gleich, und die Fälle,
die sie in der Entwicklung erfordern, sind die üblichen:

```bash
# Ein Telefon im LAN, der Rechner eines Kollegen, ein ngrok-Tunnel,
# ein weitergeleiteter Codespaces-Port – alles Nicht-Localhost-Origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Eine Origin, die weder localhost ist noch in der Liste steht, wird abgelehnt, und die Ablehnung
wird **einmal pro Origin** mit der genauen Zeile protokolliert, die sie erlauben würde. Das Ablehnen
ist keine reine Vorsichtsmaßnahme: Die API sendet Anmeldedaten. Das einfache Reflektieren eines
beliebigen `Origin`-Headers würde es jeder Website, die der Entwickler zufällig besucht, ermöglichen,
mit dessen Session authentifizierte Anfragen an den Dev-Server zu stellen und die Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Secret für das JWT-Signieren (in Produktion erforderlich, in der Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Access-Tokens (RS256), sodass jeder im Besitz des JWKS eine Session verifizieren kann, ohne selbst Tokens ausstellen zu können. Akzeptiert einen PEM-String mit echten Zeilenumbrüchen, einen PEM-String mit `\n`-Escapes oder die Base64-Kodierung des gesamten PEM. Ohne diese Angabe bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt den `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie diesen Wert immer dann, wenn der Schlüssel geändert wird – die Schlüsselrotation erfordert, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access-Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens. Gleitend – jede Rotation verlängert ihn, daher regelt dies, wie lange eine Session bei **Inaktivität** überlebt. Setzen Sie `400d` für Sessions, die eine lange Abwesenheit überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Registrierung neuer Benutzer erlauben (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden zulassen, und diese Person wird Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein über eine offene Registrierung erstelltes erstes Konto ist ein normales Konto, und der Administrator wird unten über `REBASE_ADMIN_EMAIL` benannt oder mit dem Service-Key zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standardwert des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Not-Aus-Schalter. Schließt das Bootstrap-Fenster für den ersten Benutzer, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank geschlossen ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, da das Deployment andernfalls keine Möglichkeit hat, seinen ersten angemeldeten Aufrufer zu erzeugen. Jedes ausgelieferte Deployment-Artefakt setzt diesen Wert. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Admin-Kontos, das beim Booten erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. Auf diese Weise erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt ein Wettrennen mit dem Internet zu veranstalten. Der Bootvorgang warnt, wenn die Tabelle in Produktion leer und diese Variable nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Secret. Wenn nicht gesetzt, werden die Secrets stattdessen mit `JWT_SECRET` verschlüsselt und der Start warnt einmal – eine Rotation von `JWT_SECRET` meldet somit alle Benutzer ab *und* führt dazu, dass jeder registrierte Authentifikator unlesbar wird. Setzen Sie einen dedizierten Schlüssel (32+ Zufallszeichen), bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *wegrotiert* wird. Setzen Sie während einer Rotation beide: Neue Secrets werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende bleiben lesbar, sodass niemand mitten in der Rotation aus dem eigenen Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Secret neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht an `ALLOW_REGISTRATION` gekoppelt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API verlangen. Auf `false` setzen für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Mountet `POST /api/auth/find-user`, wodurch eine E-Mail-Adresse in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für Einladungsabläufe per E-Mail aufgelöst wird. Nur für authentifizierte Aufrufer; gibt niemals die E-Mail-Adresse, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: Es stellt eine Enumerationsfläche dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite`-Attribut des Refresh-Cookies: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure`-Attribut des Refresh-Cookies. Standardmäßig aktiviert; `AUTH_COOKIE_SECURE=false` für unverschlüsseltes HTTP – etwa ein Deployment auf einer LAN-Adresse, bei dem der Browser das Cookie andernfalls verwerfen würde und die Session beim Ablauf des Access-Tokens ohne Fehlermeldung sterben würde. Gibt beim Booten eine Warnung aus. `http://localhost` benötigt dies nicht. | `true` |
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
| `GITLAB_CLIENT_ID` | GitLab-OAuth-Client-ID. Die `baseUrl` einer selbst gehosteten Instanz hat keine Entsprechung als Umgebungsvariable – konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab-OAuth-Client-Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket-OAuth-Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket-OAuth-Client-Secret | — |
| `SLACK_CLIENT_ID` | Slack-OAuth-Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack-OAuth-Client-Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify-OAuth-Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify-OAuth-Client-Secret | — |
| `APPLE_CLIENT_ID` | Apple Services-ID. Apple hat kein statisches Client-Secret – Rebase signiert pro Token-Austausch ein kurzlebiges ES256-JWT – daher werden alle vier `APPLE_*`-Werte benötigt, und ohne sie wird nichts konfiguriert. | — |
| `APPLE_TEAM_ID` | Apple Developer Team-ID, der Aussteller (Issuer) des JWTs. | — |
| `APPLE_KEY_ID` | Key-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten `.p8`-Schlüsseldatei inklusive Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (Wird in der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Der öffentliche Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deployment und er enthält keine Geheimnisse. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` ermöglicht er es dem Admin-Gate, ein Plattform-Token für `cron:read` zu akzeptieren – und für nichts anderes. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, mit der die `aud` eines Plattform-Tokens übereinstimmen muss, damit ein für ein anderes Projekt erstelltes Token abgewiesen wird. Wenn nur eine der beiden Variablen gesetzt ist, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Wo die Zähler für Auth-Rate-Limits liegen: `memory` (pro Prozess) oder `sql` (über Replikate hinweg geteilt). Ein Prozess kann seine eigene Replikatanzahl nicht sehen, daher muss ein Deployment mit Peers dies angeben – drei Replikate beim Standardwert erzwingen das Dreifache des Limits. Jeder andere Wert **verweigert den Start**, anstatt ein Fallback durchzuführen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Aktiviert den passwortlosen Ablauf per Anmeldelink. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Aktiviert die passwortlose Anmeldung mit einem sechsstelligen Code per E-Mail. Gleiche E-Mail-Voraussetzung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Magic-Link- oder E-Mail-Code-Anfrage für eine unbekannte Adresse erstellt das Konto, sofern die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh-Token nach Ablauf seines Wiederverwendungsfensters erneut eingereicht wird: `reject` (ablehnen, Session beibehalten) oder `revoke-session` (Anmeldung beenden). Jeder andere Wert führt zu einem Startabbruch. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrierung mit vorheriger Bestätigung: Keine Passwortanmeldung, bevor die Adresse verifiziert ist. Erfordert E-Mail-Dienst; der Start wird ohne diesen verweigert. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert die Captcha-Verifizierung auf den Auth-Routen: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig zur Überprüfung des vom Browser gesendeten Tokens verwendet wird. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Auth-Routen (zum Beispiel `register,login`). Nicht gesetzt schützt die Standardauswahl des Anbieters. | — |

### Speicher (Storage)

:::caution[Storage besitzt keine Row-Level Security und benötigt daher ein Zugriffsmodell]
Collections werden durch Postgres-RLS geschützt. Für Object Storage gibt es kein Äquivalent –
Keys teilen sich einen flachen Namespace. Ist ein Bucket konfiguriert, aber kein Zugriffsmodell
definiert, **verweigert der Server in Produktion den Start**. Erfüllen Sie dies durch genau eines der
folgenden Elemente: einen aus `config/index.ts` exportierten `storageAuthorize`-Hook (Standard des
Scaffolds), `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Storage-Backend: `local`, `s3` oder `gcs`. In der Produktion deaktiviert `local` den Speicher, sofern nicht `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird relativ zu dem Verzeichnis gelesen, in dem der Server läuft: das Projekt-Root unter `rebase dev`, `backend/` in einem von `rebase eject` erzeugten Server | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in Produktion erlauben – nur mit einem persistenten Volume für `STORAGE_PATH` und den daneben liegenden Verzeichnissen `<STORAGE_PATH>__<key>` für benannte lokale Buckets | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Gültigkeitsdauer der Download-URL einer privaten Datei in Sekunden – das Token, das `getSignedUrl()` darin einbettet. Maximal `604800` (eine Woche) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Größte von der Quelle akzeptierte Datei in Bytes auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Ein Wert, der keine ganze Zahl an Bytes ist, verweigert den Start | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS-Access-Key | — |
| `S3_SECRET_ACCESS_KEY` | AWS-Secret-Key | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 etc.) | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für den S3-Bucket erzwingen (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für einen Bucket gedacht, der tatsächlich ein öffentliches CDN ist. Eine der drei Möglichkeiten, die unten beschriebene Startprüfung zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jedem angemeldeten Aufrufer das Lesen, Schreiben, Auflisten und Löschen jedes Objekts erlauben. Im Konfigurationsobjekt aus gutem Grund als `INSECURE` benannt: Dies ist nur in einer Single-Tenant-App vertretbar, in der jedem Konto bezüglich aller Dateien vertraut wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bildwiedergaben (Größenänderungen, Formatkonvertierungen) zwischenspeichern, anstatt sie bei jeder Anfrage neu zu erzeugen. | `false` |

### E-Mail (Optional)

| Variable | Beschreibung |
|----------|-------------|
| `SMTP_HOST` | Host des SMTP-Servers |
| `SMTP_PORT` | Port des SMTP-Servers |
| `SMTP_SECURE` | Sichere Verbindung aktivieren (`true`/`false`) |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | Absenderadresse für System-E-Mails |
| `SMTP_NAME` | Anzeigename der Absenderadresse |
| `APP_NAME` | Produktname, der in Betreffzeilen und Texten von E-Mails verwendet wird (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo, das über den Standard-E-Mail-Vorlagen angezeigt wird. Absolute `http(s)`-PNG- oder JPG-URL – Clients entfernen SVG und blockieren `data:`-URIs. Wenn nicht gesetzt, erhält eine App, die noch `Rebase` heißt, das Rebase-Logo; eine umbenannte App erhält keines |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximale Anzahl gepoolter Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung aufrechterhalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine solche: `LISTEN`/`NOTIFY` funktioniert nicht über einen Transaktions-Pooler wie PgBouncer; ohne direkte Verbindung werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, statt stillschweigend verloren zu gehen. Der [Job-Worker](/docs/backend/jobs) hält sein Wake-up-`LISTEN` ebenfalls darauf. Füllt `directConnectionString` des Postgres-Adapters aus, wenn dieser nicht gesetzt ist. | — |
| `DATABASE_READ_URL` | Read-Replikat. Lesezugriffe werden dorthin geleitet, wenn die Variable gesetzt ist und sich von `DATABASE_URL` unterscheidet; schlägt die Verbindung fehl, wird mit einer Warnung auf die primäre Datenbank zurückgegriffen. Füllt `readConnectionString` des Postgres-Adapters aus, wenn dieser nicht gesetzt ist; in Version 0.24 wird diese Option ignoriert. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was der jeweilige Pool angefordert hat. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server stillschweigend zu serialisieren. | — |

### Runtime-Verhalten

Wird von der Runtime gelesen – `rebase dev`, `rebase start` und das veröffentlichte Server-Image.
Ein Projekt, das ein Eject durchgeführt hat, steuert diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) aus, welches Tabellen meldet, die ohne Policies bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime liefert keine Kopie mit, und ohne das Paket verweigert der Start mit Nennung des Pakets den Dienst. `false` hält den Scan von diesem Prozess fern. | — |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Dem Client muss derselbe Pfad mitgeteilt werden – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische Assets/Admin-Assets des Bundles von diesem Prozess aus bereitstellen. Deaktivieren, wenn ein CDN davor geschaltet ist. | `true` |
| `REBASE_HISTORY` | [Entitätsänderungshistorie](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | Antworten mit gzip/brotli komprimieren. | `true` |
| `REBASE_MAX_BODY_SIZE` | Maximale Größe des Request-Bodys **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verweigert den Start, anstatt das Limit stillschweigend aufzuheben). `0` schaltet das Limit aus. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände: nicht gesetzt bedeutet an in der Entwicklung, aus in der Produktion; `false` schaltet beides überall aus. Beachten Sie, dass `true` in der Produktion die **Spezifikation** unter `/api/docs` bereitstellt, jedoch nicht die Swagger-**UI** unter `/api/swagger` – die UI ist separat an `NODE_ENV` gebunden. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt `includeSubDomains` zum `Strict-Transport-Security`-Header hinzu, sodass Browser für sechs Monate unverschlüsseltes HTTP auf jeder Subdomain des Hosts verweigern – einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn jede Subdomain der Domain ausschließlich HTTPS verwendet. Jeder andere Wert als `true`/`false` verweigert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Nicht gesetzt lässt den Endpunkt für jeden offen, der den Port erreichen kann – in einem privaten Netzwerk in Ordnung, in einem öffentlichen nicht, worauf die Start-Logs hinweisen. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Booten am Schema vornehmen darf. `ensure` (standardmäßig überall aktiv – einschließlich Produktion) führt den **additiven** Durchlauf aus: fehlende Tabellen, Spalten und Enum-Typen anlegen, niemals löschen oder umschreiben. `none` rührt nichts an. Das veröffentlichte Image akzeptiert nur diese beiden Werte und **verweigert den Start bei `push`**. In einem [Split-Deployment](/docs/deployment/split-processes) darf genau ein Prozess das Provisioning übernehmen, sodass jede andere Rolle `none` setzen muss, um nicht den Start zu verweigern. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Start verweigern, wenn die Datenbank zuletzt aus einer anderen Zusammenstellung von Collections provisioniert wurde, als für diesen Prozess gebaut wurde. Nicht gesetzt (oder alles andere als `true`/`1`) gibt stattdessen eine Warnung aus. | warn |
| `REALTIME_CDC` | Change-Capture auf Datenbankebene: `auto` (aktivieren, wo die Verbindung es unterstützt, sonst stillschweigendes Fallback), `trigger` (erzwingen, warnen falls unmöglich), `wal` (degradiert derzeit zu `trigger`), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Kanäle und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein instanziierter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Subscriptions ein Realtime-Socket halten darf; die nächste wird mit `TOO_MANY_SUBSCRIPTIONS` abgewiesen. Eine positive ganze Zahl – alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Wie viele Realtime-Sockets ein Benutzer auf einer Serverinstanz offen halten darf. Die Anmeldung des nächsten Sockets wird mit `TOO_MANY_SOCKETS` abgewiesen und der Socket geschlossen (4002); das SDK versucht es weiter, sodass er verbunden wird, sobald ein anderer schließt. Eine positive ganze Zahl – alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Keine Obergrenze |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Die maximale Zeit in ms, die eine Änderung auf das erneute Abrufen (Refetch) wartet, welches sie an Live-Abonnenten ausliefert. Ein Refetch wartet 300 ms ohne Änderung und bei einem kontinuierlichen Schreibstrom höchstens so lange wie hier definiert. Eine positive ganze Zahl – alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Wie lange der Gesamtwert (Total) eines großen Listen-Abonnements in ms wiederverwendet werden darf, bevor er erneut gezählt wird; Frames, die ihn wiederverwenden, tragen `meta.totalAsOf`. Nicht gesetzt führt dazu, dass jeder Frame zählt. Hat Vorrang vor `realtime.recountIntervalMs`. | Nicht gesetzt |
| `REALTIME_RECOUNT_MIN_ROWS` | Die Mindestanzahl des letzten Gesamtwerts, für die `REALTIME_RECOUNT_INTERVAL_MS` gilt; kleinere Listen werden bei jedem Frame gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`- bzw. Loopback-Werte unter `NODE_ENV=production`. Standardmäßig deaktiviert, damit ein Produktionsstart mit einem deutlichen Fehler abbricht, anstatt sich mit einer nicht vorhandenen Datenbank zu verbinden. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Wie der Start mit einem Schlüssel in Ihren Collections umgeht, den diese Version nicht liest: `warn`, `error` (Start verweigern – sinnvoll in CI) oder `off`. Regelt nur Schlüssel, die *nicht erkannt* werden (meist Tippfehler, gelegentlich beabsichtigte Metadaten); ein Schlüssel, von dem das System weiß, dass er verschoben wurde, ist immer fatal, da das konfigurierte Feature andernfalls stillschweigend fehlt. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet den Prozess, ohne einen Socket zu öffnen – genau das Format, das ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der nachfolgende Server. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein reguläres Deployment nicht versehentlich in eines verwandeln kann, das migriert und dann den Dienst verweigert. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt es einer Maschine – einem Agenten, einem CI-Job –, eine Schemaänderung über `/api/admin/schema` nicht nur zu planen, sondern auch *anzuwenden*. Deaktiviert, sofern nicht explizit angefordert: Die Anmeldedaten, die eine solche Änderung durchführen könnten, liegen am ehesten in einer CI-Variable. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Wie lange eine benutzerdefinierte Funktion laufen darf, bevor ihre Anfrage abgebrochen wird. Derselbe Parameter wie die Option `functionsTimeoutMs`. `0` deaktiviert das Timeout. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` bewirkt, dass eine unbehandelte Promise-Rejection den Prozess beendet, anstatt sie nur zu protokollieren. Aktivieren unter einem Orchestrator, der den Container neu startet; deaktivieren, wo ein Neustart schlimmer als ein Speicherleck ist. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Hält den Cron-Scheduler auf einer Plattform aktiv, die die Runtime andernfalls als Scale-to-Zero einstuft, wo ein Timer, der in einer inaktiven Instanz auslöst, in gar keiner Instanz ausgelöst werden würde. | — |
| `TRUSTED_PROXY_HOPS` | Wie viele Proxys diesem Server vorgeschaltet sind, damit der Rate-Limiter die echte Client-Adresse aus `X-Forwarded-For` ermitteln kann. Ausfallsicherer Standardwert `0`: Ohne Proxy würde das Vertrauen in den Header jedem Aufrufer ermöglichen, eine Identität vorzutäuschen. | `0` |

:::note[Boot-Provisioning ist additiv und kein Migrationswerkzeug]
Der Boot-Durchlauf läuft unbeaufsichtigt und ohne dass jemand ein Diff prüft; daher wird er
niemals eine Spalte löschen, einen Typ einschränken oder eine Tabelle neu schreiben. Aus diesem
Grund verweigert das Image auch `REBASE_MIGRATE_ON_BOOT=push`: Ein vollständiger Push berechnet
ein Diff und führt ohne Zögern ein `DROP COLUMN` aus. Ein Container-Neustart darf niemals in der
Lage sein, als Nebeneffekt eines Neuansetzens eine Produktionsspalte zu zerstören.

Destruktive oder umstrukturierende Änderungen bleiben dort, wo sie überprüft werden können:
`rebase db generate` + `rebase db migrate` oder `rebase db push` aus einem Checkout oder CI,
welches die Änderung trocken durchspielt, destruktive Operationen ohne Bestätigung verweigert
und vorher ein Backup erstellen kann.
:::

### Split-Deployments

Ein Image und ein Bundle können mehrfach gestartet werden, wobei jede Instanz einen anderen Teil
des Projekts bedient. Hier ist jeweils eine Zeile aufgeführt, da diese Seite den Anspruch hat, jede
Variable aufzulisten; was jede Kombination *mountet und verwaltet* – und welche Kombinationen
den Start verweigern –, finden Sie unter **[Split-Prozesse](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Wenn nicht gesetzt, richtet es sich nach der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Wenn nicht gesetzt, richtet es sich nach der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | Nur die benannten benutzerdefinierten Funktionen in diesem Prozess bereitstellen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen außer den benannten bereitstellen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. | — |

### MCP-Schnittstelle

Ein optionaler Model Context Protocol-Endpunkt unter `/mcp`, damit ein KI-Client dieses Projekt
**als der angemeldete Benutzer** lesen und beschreiben kann. Standardmäßig aus, und – im Gegensatz
zu jeder anderen Oberfläche – schaltet keine `REBASE_ROLE` diesen Endpunkt ein: Die anderen
beschreiben eine Prozessform, während dies die Entscheidung ist, Drittanbietersoftware Zugangsdaten
zu überlassen. Diese Entscheidung sollte von einem Menschen getroffen und nicht von der Aufgabenbezeichnung
eines Containers geerbt werden.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Mountet die MCP-Schnittstelle. Erfordert `REBASE_PUBLIC_URL`; ohne diese Angabe wird die Schnittstelle nicht gemountet und dies im Start-Log vermerkt. | `false` |
| `REBASE_PUBLIC_URL` | Die extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Schnittstelle kann diese nicht ableiten – das Übernehmen der Origin aus dem `Host`-Header würde die Issuer-Identität und die Audience, gegen die die eigenen Tokens geprüft werden, zu einem vom Aufrufer manipulierbaren Wert machen. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Dynamische OAuth-Client-Registrierung (RFC 7591) erlauben, sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um eine Vorab-Registrierung von Clients zu erzwingen. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Standardmäßig deaktiviert, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes
Bundle enthält keinen Collection-Quellcode zur Bearbeitung. Wenn diese Variablen gesetzt sind,
liest der Collection-Editor der Administration den Quellcode aus dem Repository, committet jede
Änderung dorthin zurück und führt sein DDL auf dieser Datenbank aus. Nur für Administratoren und
von einer Person angewendet, sofern `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` nichts anderes besagt.
Wird ein Repository ohne verwendbare Anmeldedaten angegeben, verweigert der Server den Start. Siehe
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository, in das Schemaänderungen committet werden sollen, im Format `owner/name`. Das Setzen dieser Variable aktiviert das Feature. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, auf dem der Commit landet. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Pfad zu den Collection-Quellen im Repository, relativ zum Repository-Root. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein fein abgestimmtes Token mit Lese- und Schreibzugriff auf den Repository-Inhalt. Setzen Sie entweder dies oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub-App, um als App statt mit einem Token zu committen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installations-ID der App für das Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit Escaped-Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Nicht gesetzt bedeutet, dass geplante Backups deaktiviert sind. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Nicht gesetzt oder `0` behält alles. | — |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens N der neuesten Backups aufbewahren, ungeachtet der Retention-Vorgabe. | — |
| `PG_DUMP_PATH` | Überschreibt die `pg_dump`-Binärdatei – sie muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Überschreibt die `pg_restore`-Binärdatei. | — |
| `PSQL_PATH` | Überschreibt die `psql`-Binärdatei, die von `rebase db restore --clean` ausgeführt wird, um die Wiederherstellung in einer einzigen Transaktion abzuwickeln. | — |
| `PG_DUMPALL_PATH` | Speicherort von `pg_dumpall`, wenn es sich nicht im `PATH` befindet. Ohne diese Angabe – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) liefert die PostgreSQL-18-Client-Tools mit,
sodass ein geplantes Backup darin gegen jeden Server bis einschließlich Postgres 18 ausgeführt werden kann.
Außerhalb des Images müssen Sie diese selbst installieren (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups enthalten Secrets und personenbezogene Daten. Verwenden Sie ein privates Ziel mit
Ruhezustandsverschlüsselung (Encryption-at-Rest).

### Bundle-Auslieferung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft beim Booten ein
Bundle ab. Diese Variablen steuern, welches Bundle und auf welche Weise.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Das, was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Von wo das Bundle-Archiv abgerufen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Das Bearer-Token für diesen Abruf. Behandeln Sie es wie ein Geheimnis: Es autorisiert einen Mandanten zum Herunterladen des eigenen Codes. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Wohin ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und die Zeitspanne zwischen Abruf und Booten überdauern. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image für das Bundle bereitstellt, über die selbst deklarierten hinaus. | — |

### Ressourcen-Bindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `config/resources.ts` deklariert,
wird über danach benannte Umgebungsvariablen gebunden. Die Basisnamen stehen unten; eine Ressource,
die nicht der Standard ist, hängt `__` und ihren Schlüssel in Großbuchstaben an. Ein Bucket namens
`media` liest also `S3_BUCKET__MEDIA`. `rebase status` gibt pro Ressource die genaue Variable aus,
die gelesen wird, sowie die Information, ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, wenn es nicht der Postgres-Standardtreiber ist. Mit Suffix pro Quelle: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Mit Suffix pro Topic. | — |

### Eigene Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hier hat Einfluss auf ein Deployment.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Wohin `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service-Key senden, in der Shell oder in `.env`. Setzen Sie diesen Wert, wenn der Server in diesem Projekt auf andere Weise als über `rebase dev` läuft: `rebase start`, ein Container, ein anderer Host. Wenn nicht gesetzt, verwenden sie den Server, den `rebase dev` während seiner Laufzeit aufgezeichnet hat, und senden nichts, wenn er nicht läuft. | — |
| `REBASE_SERVICE_KEY` | Der Service-Key, mit dem sich diese Befehle authentifizieren, gelesen aus `.env`: dieselbe Variable, die auch der Server liest (siehe oben). | — |
| `SERVICE_KEY` | Eine ältere Bezeichnung für diesen Schlüssel. Wenn in `.env` gesetzt, lesen `rebase api-keys` und `rebase storage` diesen anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env`-Datei die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_CLOUD_URL` | Die Control-Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, als das sich `rebase cloud login` anmeldet, anstatt interaktiv danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Das zugehörige Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in der Shell-Historie landet. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der Session aus `rebase cloud login` und liest oder schreibt niemals die gespeicherte Session. Der Weg, um `rebase cloud` in CI auszuführen – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) liest denselben Namen als Alias für `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt den zugrunde liegenden Fehler und Request-Details anstelle der kurzen Nachricht aus. Der erste Schritt, wenn ein `rebase cloud`-Befehl mit einer wenig hilfreichen Meldung fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle der `<db>_dev_diff`, die sie neben `DATABASE_URL` anlegen. Rebase erstellt oder löscht hier angegebene Datenbanken nicht und verweigert eine Angabe, die mit `DATABASE_URL` identisch ist. Bei der verwalteten Entwicklungsdatenbank setzt die CLI dies auf ein eigenes, temporäres In-Memory-PGlite. Setzen Sie diesen Wert dort, wo `CREATE DATABASE` nicht gestattet ist. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und provisioniert nichts – Sie bringen Ihre eigene mit. Entspricht `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixiert den Port des Frontend-Dev-Servers, den `rebase dev` andernfalls aus dem Pfad des Projekts ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` darauf wartet, dass sich das Backend meldet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert die Meldung. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einsetzt. | — |
| `DO_NOT_TRACK` | Die werkzeugübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe speziell für Rebase. Benötigt keine Datei und ist daher die Wahl für CI und Container-Images. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Zieladresse, an die Telemetriedaten für einen selbst gehosteten Collector gesendet werden. | — |

## Secrets in der Entwicklung

`JWT_SECRET` und `REBASE_SERVICE_KEY` sind in der Produktion erforderlich und werden außerhalb
dieser für Sie generiert, sodass Sie ohne jegliche Konfiguration starten können.

Diese generierten Werte werden in `.rebase-dev-secrets.json` gecacht, direkt neben
`.rebase-dev-port` und `.rebase-dev-url` und zusammen mit diesen git-ignoriert. Zuvor wurden
sie bei jedem Start neu generiert – ein Neustart des Dev-Servers meldete Sie daher aus Ihrer
eigenen App ab und machte jeden gerade erstellten API-Schlüssel ungültig.

- Setzen Sie eine der beiden Variablen explizit, wird Ihr Wert verwendet; es wird nichts gecacht oder gelesen.
- Verweisen Sie den Cache mit `REBASE_DEV_SECRETS_FILE` an einen anderen Ort – ein Pfad und die
  einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets neu zu generieren (Rotation). Der nächste Start schreibt eine neue Datei.
- Kann die Datei nicht geschrieben werden – etwa in einem schreibgeschützten Container –, startet
  der Server trotzdem mit einem kurzlebigen Secret, genau wie zuvor.

In der Produktion oder unter einem Test-Runner wird nichts gecacht. In der Produktion schlägt
ein Bootvorgang, der eines der Secrets generieren müsste, weiterhin unter Nennung der Variablen fehl:

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

    // Wenn in der Produktion kein Bucket konfiguriert ist, ist der Speicher deaktiviert,
    // nicht lokal: Uploads antworten mit 501, anstatt auf einem Dateisystem zu landen,
    // das beim nächsten Redeploy gelöscht wird.
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

    history: true,           // Entitätsänderungshistorie aktivieren

    enableSwagger: true,     // OpenAPI-Dokumentation unter /api/docs aktivieren

    logging: {
        level: "info"
    }
});
```

Dieselben Optionen – ohne `app`, `server` und `basePath` und mit einem obligatorischen `provision` –
erstellen ein Backend, das nichts bedient, bis Sie es mounten: `createRebaseBackend`. Siehe
[Benutzerdefinierte Serverintegration](/docs/backend/custom-server/).

### Ändern von `basePath`

`basePath` verschiebt jede API-Route, sodass der Client entsprechend konfiguriert werden muss –
andernfalls fragt er weiterhin `/api/...` an und erhält für alles einen 404-Fehler:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // muss mit dem basePath des Backends übereinstimmen
});
```

Das Admin-Panel übernimmt dies automatisch von dem Client, der ihm übergeben wird; es muss
nichts weiter konfiguriert werden. Wenn Sie eine Anfrage-URL manuell zusammensetzen, verknüpfen
Sie diese über den Client, anstatt `/api` selbst zu schreiben:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // z. B. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### Keine Berechtigung im SQL-Editor (`permission denied for table <name>`)

* **Symptome:** Im SQL-Editor von Rebase Studio ausgeführte benutzerdefinierte Abfragen schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellen-CMS-Ansicht Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, Abfragen im SQL-Editor auszuführen, indem es die Datenbankrollen vorübergehend wechselt, um sie an die Anwendungsrolle des aktiven Benutzers anzupassen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen statt als tatsächliche PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer des Verbindungseigentümers ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie Ihrer Backend-`.env`-Konfiguration `DISABLE_DB_ROLE_SWITCHING=true` hinzu. Dadurch wird Rebase gezwungen, Abfragen im SQL-Editor mit den Berechtigungen des Verbindungseigentümers (in der Regel ein Superuser/Owner) auszuführen. Der SQL-Editor zeigt dann über den Ergebnissen an, dass diese als Verbindungseigentümer gelesen wurden, und graut die Rollenauswahl aus.

### Abrufen des Schemas im SQL-Editor fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden oder der SQL-Editor meldet `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Ursache:** Rebase benötigt Administratorrechte, um Systemkataloge der Datenbank abzufragen und administrative Befehle auszuführen. Wenn dem Bootstrapper kein `adminConnectionString` übergeben wird oder `getAdmin()` so überschrieben ist, dass es `undefined` zurückgibt, schlagen diese Vorgänge fehl.
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
- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration

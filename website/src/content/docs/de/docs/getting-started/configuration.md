---
sourceHash: ec6f07e74d4a291d
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Stammverzeichnis des Projekts.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> ein erforderlicher Wert fehlt oder fehlerhaft formatiert ist (eine URL, die keine URL ist, ein Port,
> der keine Zahl ist), verweigert der Server den Start und nennt die betroffene Variable.
>
> Wo sich das Schema befindet, hängt davon ab, wie Sie das Backend ausführen. Ein Projekt, das über
> die Runtime gestartet wird – `rebase dev`, `rebase start`, das veröffentlichte Image –, verwendet
> das Schema der Runtime (`loadBootEnv` in `@rebasepro/server`), welches die
> Schnittmenge/Vereinigung aller unten stehenden Tabellen darstellt. Ein Projekt, bei dem [`rebase eject`](/docs/cli)
> ausgeführt wurde, besitzt eine eigene `backend/src/env.ts`, die `loadEnv({ extend })` aufruft und dort eigene
> typisierte Variablen hinzufügen kann.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **In der Entwicklungsumgebung optional** – ist sie nicht gesetzt, führt `rebase dev` eine verwaltete PostgreSQL-Instanz für das Projekt aus, deren Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktionsumgebung erforderlich** (wird in der Entwicklungsumgebung automatisch generiert). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` ist eine Schreibweise von node-postgres, nicht von libpq.**
>
> Rebase und der Node-Treiber akzeptieren dies – verschlüsseln, aber das
> Zertifikat nicht überprüfen. `psql`, `pg_dump`, `pg_restore` und Atlas tun dies nicht
> und stufen das Verhalten nicht herab: Sie verweigern den Start mit `invalid sslmode value: "no-verify"`.
>
> Die Rebase-eigenen Befehle (`rebase db push`, `rebase db backup`, `rebase db
> restore`) schreiben diesen Wert vor dem Shell-Aufruf in das äquivalente `sslmode=require` um,
> sodass sie mit der konfigurierten URL funktionieren. Wenn Sie `psql` manuell aufrufen,
> funktioniert dies nicht – verwenden Sie dort stattdessen `sslmode=require`, was die Verbindung
> auf genau dieselbe Weise ohne Zertifikatsprüfung verschlüsselt.

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklungsumgebung setzen** – siehe unten. | Page Origin |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth-Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklungsumgebung sind Frontend und Backend separate Origins, daher injiziert der
> Entwicklungsserver diesen Wert. In der Produktion liefert das Rebase-Backend die SPA aus,
> sodass die API dem Origin der Seite selbst entspricht und der Client dies eigenständig auflöst.
>
> Das feste Einbinden einer absoluten URL in ein Produktions-Bundle funktioniert nur so lange,
> bis ein zweiter Hostname auf dieselbe App verweist: Eine benutzerdefinierte Domain lädt die Seite dann von
> `example.com` und ruft die API unter `example.rebase.website` auf, was Cross-Origin ist,
> sodass jeder Preflight-Request fehlschlägt. Den Origin in CORS zu erlauben, behebt dies **nicht** –
> das Refresh-Cookie ist auf `SameSite=Lax` gesetzt und wird nicht Cross-Site gesendet;
> dadurch würden zwar die Konsolenfehler verschwinden, die Authentifizierung bliebe jedoch fehlerhaft.
> Bleibt der Wert ungesetzt, funktioniert jede Domain, die auf die App zeigt, ganz ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` ausgelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** – ein `PORT` in der `.env` wird dort nicht berücksichtigt, da der Port vor dem Laden dieser Datei ermittelt wird – und bindet andernfalls einen Port, der vom Projektpfad abgeleitet wird, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner gibt an, welche Prioritätsstufe verwendet wurde. | `3001` |
| `LOG_LEVEL` | Logging-Detailgrad: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer `Failed query: [redacted]`-Zeile an. Jedes fehlschlagende Statement wird standardmäßig bereinigt (redacted), da eine fehlgeschlagene Abfrage gebundene Parameter enthält – eine E-Mail-Adresse, einen Passwort-Hash. Setzen Sie dies während der Diagnose eines DDL-, RLS- oder Change-Capture-Fehlers auf `true`. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste erlaubter Origins. **In Produktion erforderlich**, es sei denn, `FRONTEND_URL` ist gesetzt: Ein Produktionsstart ohne beides bricht ab. In der Entwicklung wird dieser Wert zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Dient in beiden Umgebungen als Alternative zu `CORS_ORIGINS`. | — |
| `ADMIN_CONNECTION_STRING` | Datenbankverbindungszeichenfolge mit Administratorrechten (verwendet für Schema-Introspektion und Administrationsoperationen). Die darin angegebene Datenbank ist nicht diejenige, die die SQL-Konsole als aktuell bezeichnet, noch diejenige, die ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der die Verbindung der App selbst liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert das Wechseln der PostgreSQL-Rollen im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Die SQL-Konsole von Studio weist dann darauf hin, dass die Zeilen als Verbindungseigentümer gelesen wurden, nennt diesen und blendet die Rollenauswahl aus. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies bei einem Checkout, der [auf einen Branch gewechselt ist](/docs/backend/branching/#cli-integration). Ein Server mit dieser Variablen hält das Branch-Register auf dieser Datenbank und kopiert neue Branches standardmäßig davon, sodass der Branches-Bereich von Studio die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

In der Entwicklungsumgebung sind **localhost sowie alle in `CORS_ORIGINS` (oder `FRONTEND_URL`) angegebenen Adressen**
erlaubt – dieselbe Liste, die auch in der Produktion verwendet wird, wobei localhost hinzugefügt statt
ersetzt wird. Die Variable funktioniert in beiden Umgebungen auf dieselbe Weise, und die
Fälle, in denen sie in der Entwicklung benötigt wird, sind die üblichen:

```bash
# Ein Telefon im LAN, der Rechner eines Kollegen, ein ngrok-Tunnel,
# ein weitergeleiteter Codespaces-Port – alles Origins ungleich localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Ein Origin, der weder localhost noch aufgelistet ist, wird abgewiesen, und die Verweigerung wird
**einmal pro Origin** mit der genauen Zeile protokolliert, die ihn zulassen würde. Diese Verweigerung ist
keine übertriebene Vorsicht: Die API überträgt Zugangsdaten (Credentials), und das bloße Zurückspiegeln eines
beliebigen `Origin`-Headers würde es jeder Website, die der Entwickler zufällig besucht, ermöglichen,
mit dessen Sitzung authentifizierte Anfragen an den Entwicklungsserver zu senden und die
Antworten mitzulesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Secret für das Signieren von JWTs (in Produktion erforderlich, in der Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zur asymmetrischen Signierung von Access-Tokens (RS256), sodass jede Entität mit Zugriff auf das JWKS eine Sitzung verifizieren kann, ohne selbst Tokens ausstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEM. Ohne diese Variable bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt den `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie diesen Wert, wann immer der Schlüssel geändert wird – die Schlüsselrotation erfordert, dass alte und neue Schlüssel unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access-Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens. Gleitend (sliding) – jede Rotation erneuert die Frist, sodass dieser Wert bestimmt, wie lange eine Sitzung bei **Inaktivität** bestehen bleibt. Setzen Sie `400d` für Sitzungen, die lange Abwesenheiten überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Registrierung neuer Benutzer erlauben (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden einlassen, und dieser Benutzer wird zum Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Zeitfenster geschlossen: Eine leere Tabelle lehnt die Bootstrap-Registrierung mit `SETUP_REQUIRED` ab; ein erstes über die offene Registrierung erstelltes Konto ist ein normales Benutzerkonto, und der Administrator wird über `REBASE_ADMIN_EMAIL` unten festgelegt oder mit dem Service-Key zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standardwert des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Not-Aus-Schalter (Kill Switch). Schließt das Bootstrap-Fenster für den ersten Benutzer, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank blockiert ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, andernfalls kann das Deployment keinen ersten angemeldeten Aufrufer erzeugen. Jedes ausgelieferte Deployment-Artefakt setzt diesen Wert. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Administratorkontos, das beim Start erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. So erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt ein Wettrennen im Internet zu riskieren. Beim Start wird eine Warnung ausgegeben, wenn die Tabelle in Produktion leer ist und diese Variable nicht gesetzt wurde. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto wird nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Secret. Ist dieser Wert nicht gesetzt, werden die Secrets stattdessen mit `JWT_SECRET` verschlüsselt und beim Start wird einmalig gewarnt – die Rotation von `JWT_SECRET` würde in diesem Fall alle Benutzer abmelden *und* jeden eingerichteten Authentifikator unentschlüsselbar machen. Setzen Sie einen dedizierten Schlüssel (mind. 32 Zufallszeichen), bevor sich Benutzer registrieren. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, der im Rahmen einer Rotation *abgelöst* wird. Setzen Sie während einer Rotation beide Werte: Neue Secrets werden mit `MFA_ENCRYPTION_KEY` geschrieben, und bestehende bleiben lesbar, sodass niemand während der Rotation aus seinem Konto ausgesperrt wird. Entfernen Sie ihn, sobald alle Secrets neu verschlüsselt wurden. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht an `ALLOW_REGISTRATION` gebunden. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API erzwingen. Setzen Sie diesen Wert auf `false` für eine vollständig öffentliche Leseoberfläche – RLS greift weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Stellt `POST /api/auth/find-user` bereit, wodurch eine E-Mail-Adresse in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für Einladungsabläufe aufgelöst wird. Nur für authentifizierte Aufrufer; gibt niemals die E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert, da es eine Angriffsfläche zur Benutzeraufzählung (Enumeration) darstellt. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite`-Attribut des Refresh-Cookies: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für Frontends gedacht, die tatsächlich auf einer anderen Domain laufen. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure`-Attribut des Refresh-Cookies. Standardmäßig aktiviert; `AUTH_COOKIE_SECURE=false` ist für reines HTTP gedacht – etwa bei einem Deployment auf einer LAN-Adresse, bei dem der Browser das Cookie andernfalls verwerfen würde und die Sitzung nach Ablauf des Access-Tokens ohne Fehlermeldung enden würde. Gibt beim Start eine Warnung aus. `http://localhost` benötigt dies nicht. | `true` |
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
| `GITLAB_CLIENT_ID` | GitLab OAuth-Client-ID. Für die `baseUrl` einer selbst gehosteten Instanz gibt es keine Umgebungsvariable – konfigurieren Sie GitLab hierfür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab OAuth-Client-Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket OAuth-Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket OAuth-Client-Secret | — |
| `SLACK_CLIENT_ID` | Slack OAuth-Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack OAuth-Client-Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth-Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth-Client-Secret | — |
| `APPLE_CLIENT_ID` | Apple Services-ID. Apple verwendet kein statisches Client-Secret – Rebase signiert pro Token-Austausch ein kurzlebiges ES256-JWT –, daher werden alle vier `APPLE_*`-Werte benötigt; ohne sie wird nichts konfiguriert. | — |
| `APPLE_TEAM_ID` | Apple Developer Team-ID, der Aussteller (Issuer) des JWTs. | — |
| `APPLE_KEY_ID` | Schlüssel-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten `.p8`-Schlüsseldatei inklusive Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Der öffentliche Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; bei einer Schlüsselrotation können hier mehrere PEM-Blöcke stehen. Die Plattform setzt ihn beim Deploy; er enthält keine Geheimnisse. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` ermöglicht er es dem Admin-Gate, ein Plattform-Token für `cron:read` zu akzeptieren, und für nichts anderes. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, der das `aud`-Feld eines Plattform-Tokens entsprechen muss, damit ein für ein anderes Projekt ausgestelltes Token abgelehnt wird. Wenn nur eine der beiden Variablen gesetzt ist, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Speicherort für Rate-Limit-Zähler der Authentifizierung: `memory` (prozessbezogen) oder `sql` (über Replikate hinweg geteilt). Ein Prozess kann die Anzahl seiner Replikate nicht selbst erkennen; ein Deployment mit mehreren Instanzen muss dies daher explizit angeben – drei Replikate mit der Standardeinstellung erlauben das Dreifache des Limits. Jeder andere Wert **verhindert den Start**, anstatt auf einen Fallback zurückzugreifen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Aktiviert den passwortlosen Ablauf per Anmeldelink. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nicht zugestellt werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Aktiviert die passwortlose Anmeldung mit einem sechsstelligen Code per E-Mail. Gleiche E-Mail-Anforderung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Anfrage nach einem Magic Link oder E-Mail-Code für eine unbekannte Adresse erstellt das Konto, sofern die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh-Token nach Ablauf seines Wiederverwendungsfensters erneut eingereicht wird: `reject` (Token ablehnen, Sitzung beibehalten) oder `revoke-session` (Sitzung beenden). Jeder andere Wert führt zu einem Startfehler. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrierung mit vorheriger Bestätigung: Keine Passwort-Anmeldung möglich, bevor die E-Mail-Adresse verifiziert wurde. Erfordert einen E-Mail-Dienst; ohne diesen verweigert der Server den Start. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert die Captcha-Verifizierung auf den Authentifizierungsrouten: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig zur Verifizierung des vom Browser gesendeten Tokens verwendet wird. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Authentifizierungsrouten (z. B. `register,login`). Bleibt der Wert ungesetzt, wird die Standardauswahl des Anbieters geschützt. | — |

### Speicher (Storage)

:::caution[Storage besitzt keine Row-Level Security und benötigt daher ein Zugriffsmodell]
Collections werden durch Postgres RLS geschützt. Object Storage hat kein Äquivalent –
Schlüssel teilen sich einen flachen Namensraum. Ist ein Bucket konfiguriert, aber kein Zugriffsmodell definiert,
**verweigert der Server in der Produktion den Start**. Erfüllen Sie dies mit genau einer der folgenden Optionen:
einem aus `config/index.ts` exportierten `storageAuthorize`-Hook (Standard im Scaffold),
`STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Storage-Backend: `local`, `s3` oder `gcs`. In der Produktion deaktiviert `local` den Speicher, es sei denn, `FORCE_LOCAL_STORAGE=true` ist gesetzt. | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird relativ zu dem Verzeichnis gelesen, in dem der Server ausgeführt wird: das Projektstammverzeichnis unter `rebase dev`, `backend/` in einem von `rebase eject` erstellten Server. | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in der Produktion erlauben – nur in Verbindung mit einem persistenten Volume, das `STORAGE_PATH` und die daneben liegenden `<STORAGE_PATH>__<key>`-Verzeichnisse benannter lokaler Buckets enthält. | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Gültigkeitsdauer in Sekunden für Download-URLs privater Dateien – das Token, das `getSignedUrl()` einfügt. Maximal `604800` (eine Woche). | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maximale Dateigröße, die die Quelle akzeptiert, in Bytes, auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Ein Wert, der keine ganze Zahl von Bytes ist, verhindert den Start. | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`). | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS Access Key | — |
| `S3_SECRET_ACCESS_KEY` | AWS Secret Key | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 etc.). | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für den S3-Bucket erzwingen (`true`/`false`). | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`). | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird in der Regel aus den Zugangsdaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Zugangsdaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für Buckets geeignet, die tatsächlich als öffentliches CDN dienen. Eine der drei Möglichkeiten, die Startprüfung unten zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jedem angemeldeten Aufrufer das Lesen, Schreiben, Auflisten und Löschen jedes Objekts gestatten. Im Konfigurationsobjekt aus gutem Grund als `INSECURE` benannt: Dies ist nur in Single-Tenant-Apps vertretbar, in denen jedem Konto für jede Datei vertraut wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bildvarianten (Skalierungen, Formatkonvertierungen) zwischenspeichern, anstatt sie bei jeder Anfrage neu zu erzeugen. | `false` |

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
| `APP_NAME` | Produktname, der in Betreffzeilen und Texten von E-Mails verwendet wird (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo, das oben in Standard-E-Mail-Vorlagen angezeigt wird. Absolute `http(s)`-PNG- oder JPG-URL – E-Mail-Clients entfernen SVGs und blockieren `data:`-URIs. Ungesetzt erhält eine App, die noch `Rebase` heißt, das Rebase-Logo, und eine umbenannte App keines. |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximale Anzahl gepoolter Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung gehalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) erfordert eine solche: `LISTEN`/`NOTIFY` funktioniert nicht über einen Transaktions-Pooler wie PgBouncer; ohne diese Verbindung werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, statt unbemerkt verloren zu gehen. Der [Job-Worker](/docs/backend/jobs) hält sein Aufwach-`LISTEN` ebenfalls darüber. Füllt `directConnectionString` des Postgres-Adapters, wenn dieser ungesetzt ist. | — |
| `DATABASE_READ_URL` | Read-Replica. Lesezugriffe werden dorthin geleitet, wenn gesetzt und abweichend von `DATABASE_URL`; schlägt die Verbindung fehl, fällt das System mit einer Warnung auf die primäre Datenbank zurück. Füllt `readConnectionString` des Postgres-Adapters, wenn dieser ungesetzt ist; in Version 0.24 wird diese Option ignoriert. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was einzeln angefordert wurde. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server unbemerkt zu serialisieren. | — |

### Runtime-Verhalten

Wird von der Runtime ausgelesen – `rebase dev`, `rebase start` und dem veröffentlichten Server-Image.
Ein Projekt, das „ejected“ wurde, verwaltet diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) aus, das Tabellen meldet, die ohne Policies bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime liefert keine Kopie mit, und ohne das Paket verweigert der Start mit Nennung des Pakets den Dienst. `false` hält den Scan auf diesem Prozess deaktiviert. | — |
| `REBASE_BASE_PATH` | Basispfad für alle API-Routen. Dem Client muss derselbe Pfad mitgeteilt werden – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische Assets/Admin-Assets des Bundles von diesem Prozess aus bereitstellen. Deaktivieren Sie dies, wenn ein CDN vorgeschaltet ist. | `true` |
| `REBASE_HISTORY` | [Entitäts-Änderungshistorie](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli-Antwortkomprimierung. | `true` |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body, **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, führt zum Startabbruch, anstatt das Limit stillschweigend aufzuheben). `0` schaltet das Limit aus. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände: ungesetzt bedeutet in der Entwicklung aktiviert, in Produktion deaktiviert; `false` schaltet beides überall aus. Beachten Sie, dass `true` in der Produktion die **Spezifikation** unter `/api/docs` bereitstellt, nicht jedoch das Swagger-**UI** unter `/api/swagger` – das UI wird separat über `NODE_ENV` gesteuert. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt `includeSubDomains` zum `Strict-Transport-Security`-Header hinzu, sodass Browser für sechs Monate einfaches HTTP auf jeder Subdomain des Hosts verweigern – einschließlich Hosts, die nicht von diesem Prozess bedient werden. Schalten Sie dies nur ein, wenn ausnahmslos jede Subdomain der Domain reines HTTPS verwendet. Jeder andere Wert als `true`/`false` verweigert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Bleibt der Wert ungesetzt, ist der Endpunkt für jeden zugänglich, der den Port erreichen kann – in einem privaten Netzwerk in Ordnung, in einem öffentlichen nicht (die Startprotokolle weisen darauf hin). | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start mit dem Collection-Schema tun darf. `ensure` (Standard überall – auch in Produktion) führt den **additiven** Durchlauf aus: Fehlende Tabellen, Spalten und Enum-Typen erstellen, niemals etwas löschen oder umschreiben. `none` lässt das Collection-Schema unberührt, aber die framework-eigenen Tabellen (Authentifizierung, API-Schlüssel, Jobs, Cron) werden weiterhin erstellt und aktuell gehalten; `REBASE_PROVISION=false` schaltet auch diese ab. Das veröffentlichte Image akzeptiert nur diese beiden Werte und **verweigert den Start bei `push`**. In einem [Split Deployment](/docs/deployment/split-processes) darf genau ein Prozess das Provisioning übernehmen; jede andere Rolle muss `none` setzen oder bricht den Start ab. | `ensure` |
| `REBASE_PROVISION` | `false` sorgt dafür, dass die Runtime keinerlei Änderungen an der Datenbank vornimmt: keine Tabellen, Spalten, Indizes, Funktionen, Trigger, Policies, Rollen oder Grants, weder beim Start noch später – framework-eigene Objekte eingeschlossen. Stattdessen wird namentlich gemeldet, was fehlt. Gedacht für Datenbanken, die ausschließlich durch Ihren Migrations-/Change-Prozess verändert werden dürfen. Siehe [Wenn nur Ihr Änderungsprozess die Datenbank verändern darf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Es werden nur `true` und `false` akzeptiert. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Verweigert den Start, wenn die Datenbank zuletzt mit einem anderen Satz von Collections bereitgestellt wurde als dem, aus dem dieser Prozess gebaut wurde. Ist die Variable nicht gesetzt (oder enthält einen anderen Wert als `true`/`1`), wird stattdessen nur gewarnt. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Verweigert den Start, wenn eine Funktions- oder Cron-Datei beim Importieren einen Fehler wirft oder nicht geparst werden kann (unter Nennung der Datei und des Grundes), sodass bei einem Rolling Deployment die alte Version aktiv bleibt. Auch ein Neustart wird daran gemessen. Ist der Wert ungesetzt (oder ungleich `true`), wird die Datei übersprungen und der Rest weiter bedient. Eine Datei, die fehlerfrei importiert wird, aber keine Funktion oder keinen Job exportiert, wird immer übersprungen und führt nicht zum Abbruch. | skip |
| `REALTIME_CDC` | Change Data Capture auf Datenbankebene: `auto` (aktivieren, wo die Verbindung es unterstützt, sonst stiller Fallback), `trigger` (erzwingen, Warnung falls nicht möglich), `wal` (fällt derzeit auf `trigger` zurück), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Channels und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein instanziierter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Abonnements ein einzelner Realtime-Socket halten darf; ein weiteres wird mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Wie viele Realtime-Sockets ein Benutzer oder ein API-Schlüssel auf einer Serverinstanz geöffnet halten darf. Sockets eines Administrators mit Identitätswechsel (Impersonation) zählen zu Lasten des Administrators. Die nächste Anmeldung wird mit `TOO_MANY_SOCKETS` abgelehnt und der Socket geschlossen (4002); das SDK versucht es weiter, sodass die Verbindung aufgebaut wird, sobald ein anderer schließt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Keine Obergrenze |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Die maximale Wartezeit in Millisekunden für einen Refetch, der Änderungen an aktive Abonnenten ausliefert. Ein Refetch wartet 300 ms ohne Änderung, und bei einem kontinuierlichen Schreibstrom höchstens diese Zeitspanne. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Wie lange der Gesamtwert (Total) eines Abonnements für große Listen wiederverwendet werden darf, bevor er erneut gezählt wird (in ms); Frames, die ihn wiederverwenden, tragen `meta.totalAsOf`. Ungesetzt wird jeder Frame gezählt. Hat Vorrang vor `realtime.recountIntervalMs`. | Nicht gesetzt |
| `REALTIME_RECOUNT_MIN_ROWS` | Der Mindestwert der letzten Gesamtzahl, ab dem `REALTIME_RECOUNT_INTERVAL_MS` greift; kleinere Listen werden in jedem Frame neu gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`- bzw. Loopback-Werte unter `NODE_ENV=production`. Standardmäßig deaktiviert, damit ein Produktionsstart deutlich fehlschlägt, statt sich mit einer nicht vorhandenen Datenbank zu verbinden. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Verhalten beim Start bei Schlüsseln in Ihren Collections, die diese Version nicht liest: `warn`, `error` (Start verweigern – empfehlenswert in CI) oder `off`. Regelt nur Schlüssel, die *nicht erkannt* werden (meist Tippfehler, gelegentlich gewollte Metadaten); ein Schlüssel, von dem bekannt ist, dass er verschoben wurde, führt immer zum Fehler, da das konfigurierte Feature andernfalls unbemerkt fehlen würde. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet sich, ohne einen Socket zu öffnen – das Format, das ein Migrations-Job benötigt, aus demselben Image und Bundle wie der nachfolgende Server. Erstellt auch Tabellen, die ein Serverprozess sonst bei der ersten Verwendung anlegen würde, und startet weder Cron noch Job-Queues. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein normales Deployment nicht versehentlich in einen reinen Migrationsprozess verwandeln kann. Kann nicht zusammen mit `REBASE_PROVISION=false` verwendet werden. | — |
| `REBASE_PROVISION_SQL_OUT` | Ein Dateipfad. Ein Provisioning-Lauf (`REBASE_PROVISION_ONLY=true`) schreibt jede vorgenommene Schemaänderung der Reihe nach als SQL-Skript in diese Datei, um sie zu überprüfen und per `psql` anzuwenden. Geschriebene Datenzeilen sind nicht enthalten. Auf einem Serverprozess nicht zulässig. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` gestattet Maschinen – einem Agenten, einem CI-Job –, Schemaänderungen über `/api/admin/schema` nicht nur zu planen, sondern auch direkt *anzuwenden*. Deaktiviert, solange nicht explizit gefordert: Die Zugangsdaten, die eine solche Änderung vornehmen könnten, liegen am ehesten in einer CI-Variablen. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Wie lange eine benutzerdefinierte Funktion laufen darf, bevor ihre Anfrage abgebrochen wird. Entspricht der Option `functionsTimeoutMs`. `0` schaltet das Timeout aus. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` sorgt dafür, dass eine nicht abgefangene Promise-Rejection den Prozess beendet, anstatt nur protokolliert zu werden. Empfohlen unter einem Orchestrator, der den Container neu startet; deaktivieren, falls ein Neustart schlimmer ist als ein Ressourcenleck. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Hält den Cron-Scheduler auf Plattformen aktiv, die die Runtime andernfalls als Scale-to-Zero erkennt, wo ein Timer in einer inaktiven Instanz in keiner Instanz feuern würde. | — |
| `TRUSTED_PROXY_HOPS` | Anzahl der vorgeschalteten Proxys vor diesem Server, damit der Rate-Limiter die reale Client-Adresse aus `X-Forwarded-For` auslesen kann. Ausfallsicherer Standardwert ist `0`: Ohne Proxy würde das Vertrauen in diesen Header jedem Aufrufer erlauben, eine Identität vorzutäuschen. | `0` |

:::note[Boot-Provisioning ist additiv und kein Migrationswerkzeug]
Der Boot-Durchlauf erfolgt unbeaufsichtigt, ohne dass ein Benutzer ein Diff prüft. Daher wird
er niemals eine Spalte löschen, einen Typ einschränken oder eine Tabelle neu schreiben. Das ist auch
der Grund, warum das Image `REBASE_MIGRATE_ON_BOOT=push` verweigert: Ein vollständiger Push berechnet
ein Diff und würde problemlos `DROP COLUMN` ausführen – ein Container-Neustart darf niemals
in der Lage sein, eine Produktionsspalte als Nebeneffekt eines Reschedulings zu zerstören.

Destruktive oder umstrukturierende Änderungen verbleiben dort, wo sie überprüft werden können:
`rebase db generate` + `rebase db migrate` oder `rebase db push` aus einem Checkout oder der CI,
was die Änderung trocken durchspielt (Dry-Run), destruktive Operationen ohne Bestätigung verweigert
und vorab ein Backup erstellen kann.
:::

### Split Deployments

Ein einzelnes Image und ein Bundle können mehrfach gestartet werden, wobei jede Instanz einen
anderen Teil des Projekts bedient. Hier jeweils eine Zeile zur Vollständigkeit;
was jede Kombination *bereitstellt und verwaltet* – und welche Kombinationen
den Start verweigern –, finden Sie unter
**[Split Processes](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Ungesetzt richtet sich nach der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess die Job-Queue-Worker ausführt. Ungesetzt richtet sich nach der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | Bedient in diesem Prozess ausschließlich die benannten benutzerdefinierten Funktionen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Bedient alle benutzerdefinierten Funktionen außer den benannten. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. Auf einem `worker`: wohin seine eigenen `rebase.functions`-Aufrufe gehen. Eine `http(s)`-URL. | — |

### MCP-Oberfläche

Ein optionaler Model Context Protocol-Endpunkt unter `/mcp`, damit ein KI-Client dieses Projekt
**als der angemeldete Benutzer** lesen und beschreiben kann. Standardmäßig aus, und – anders als bei
jeder anderen Oberfläche – schaltet keine `REBASE_ROLE` ihn ein: Die anderen beschreiben die Form eines
Prozesses, während dies die Entscheidung ist, Zugangsdaten an Software von Drittanbietern zu übergeben;
sie sollte von einer Person getroffen und nicht von der Rolle eines Containers geerbt werden.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Stellt die MCP-Oberfläche bereit. Erfordert `REBASE_PUBLIC_URL`; ohne diese wird die Oberfläche nicht bereitgestellt und dies im Startprotokoll vermerkt. | `false` |
| `REBASE_PUBLIC_URL` | Der extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Oberfläche kann diesen nicht ableiten – die Übernahme des Origins aus dem `Host`-Header würde die Issuer-Identität und die Audience, gegen die eigene Tokens geprüft werden, zu einem vom Aufrufer manipulierbaren Wert machen. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Erlaubt dynamische OAuth-Client-Registrierung (RFC 7591), sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um eine Vorab-Registrierung von Clients zu erzwingen. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Standardmäßig deaktiviert, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes Bundle enthält keinen
Collection-Quellcode zur Bearbeitung. Sind diese Variablen gesetzt, liest der Collection-Editor des Admin-Bereichs
den Quellcode aus dem Repository, committet jede Änderung dorthin zurück und führt das DDL auf
dieser Datenbank aus. Nur für Admins und manuell von einer Person angewendet, es sei denn,
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` bestimmt etwas anderes. Ein Repository ohne nutzbare
Zugangsdaten verhindert den Start. Siehe
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository, in das Schemaänderungen committet werden sollen, im Format `owner/name`. Das Setzen dieser Variable aktiviert die Funktion. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, auf dem der Commit landet. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Speicherort des Collection-Quellcodes im Repository (relativ zum Repo-Root). | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein fein abgestimmtes Token (Fine-grained Token) mit Lese- und Schreibzugriff auf den Repository-Inhalt. Setzen Sie entweder dies oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub App, um als App statt mit einem Token zu committen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installations-ID der App im Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit maskierten Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Nicht gesetzt bedeutet, dass geplante Backups deaktiviert sind. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Löscht Backups, die älter als N Tage sind. Nicht gesetzt oder `0` behält alle Backups. | — |
| `BACKUP_KEEP_MINIMUM` | Behält immer mindestens N der neuesten Backups, unabhängig von der Retention-Regel. | — |
| `PG_DUMP_PATH` | Überschreibt die `pg_dump`-Binärdatei – muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Überschreibt die `pg_restore`-Binärdatei. | — |
| `PSQL_PATH` | Überschreibt die `psql`-Binärdatei, die `rebase db restore --clean` ausführt, um die Wiederherstellung in einer einzigen Transaktion durchzuführen. | — |
| `PG_DUMPALL_PATH` | Speicherort von `pg_dumpall`, wenn es nicht im `PATH` liegt. Ohne diese Angabe – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) enthält die PostgreSQL 18-Client-Tools,
sodass ein geplantes Backup darin gegen jeden Server bis Postgres 18 ausgeführt werden kann.
Außerhalb des Images müssen Sie diese selbst installieren (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups enthalten Secrets und personenbezogene Daten (PII). Verwenden Sie ein privates Ziel
mit serverseitiger Verschlüsselung (Encryption-at-Rest).

### Bundle-Bereitstellung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft beim
Start ein Bundle ab. Diese Variablen steuern, welches Bundle wie geladen wird.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Wird von `rebase start` lokal gesetzt. | — |
| `REBASE_BUNDLE_URL` | URL, von der das Bundle-Archiv abgerufen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Das Bearer-Token für diesen Abruf. Behandeln Sie es als Geheimnis: Es autorisiert einen Mandanten zum Download seines eigenen Codes. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Zielverzeichnis, in das ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und die Zeitspanne zwischen Abruf und Boot überstehen. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image für das Bundle bereitstellt, über die selbst deklarierten hinaus. | — |

### Ressourcen-Bindings

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `config/resources.ts` deklariert,
wird über gleichnamige Umgebungsvariablen gebunden. Die Basisnamen finden Sie unten;
eine Nicht-Standard-Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an, sodass ein Bucket namens
`media` als `S3_BUCKET__MEDIA` gelesen wird. `rebase status`
gibt pro Ressource
die exakte Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, wenn es nicht der Postgres-Standardtreiber ist. Wird pro Quelle angehängt: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Wird pro Topic angehängt. | — |

### Eigene Umgebungsvariablen der CLI

Werden von `rebase` ausgewertet, nicht vom Server. Nichts hiervon wirkt sich auf ein Deployment aus.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Wohin `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service-Key senden, in der Shell oder in `.env`. Setzen Sie dies, wenn der Server auf andere Weise als über `rebase dev` in diesem Projekt läuft: `rebase start`, ein Container, ein anderer Host. Ungesetzt nutzen sie den Server, den `rebase dev` protokolliert hat, solange dieser läuft, und senden nichts, wenn er gestoppt ist. | — |
| `REBASE_SERVICE_KEY` | Der Service-Key, mit dem sich diese Befehle authentifizieren, aus `.env` gelesen: dieselbe Variable, die auch der Server liest (siehe oben). | — |
| `SERVICE_KEY` | Ein älterer Name für diesen Schlüssel. Wenn er in `.env` gesetzt ist, lesen `rebase api-keys` und `rebase storage` ihn anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Bestimmt, welche `.env` die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, unter dem sich `rebase cloud login` anmeldet, anstatt interaktiv zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Das zugehörige Passwort, damit ein Secret-Manager es übergeben kann, ohne dass es in die Shell-History gelangt. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der `rebase cloud login`-Sitzung und liest oder schreibt niemals die gespeicherte Sitzung. In einem Verzeichnis, das mit `rebase cloud init --claim` verknüpft ist, wird es zugunsten des Tokens dieses Projekts zurückgestellt, wenn es keinen Scope für das Projekt besitzt. Der Standardweg, um `rebase cloud` in CI auszuführen – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) übergibt es an die CLI, die seine Cloud-Tools starten, und sendet es nie an die App: Setzen Sie dafür `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt die zugrunde liegenden Fehler- und Anfragedetails anstelle der Kurznachricht aus. Die erste Maßnahme, wenn ein `rebase cloud`-Befehl ohne hilfreiche Meldung fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle der `<db>_dev_diff`, die sie neben `DATABASE_URL` erstellen. Rebase erstellt oder löscht keine hier angegebene Datenbank und verweigert eine, die identisch mit `DATABASE_URL` ist. Bei der verwalteten Entwicklungsdatenbank setzt die CLI dies auf ein eigenes temporäres In-Memory-PGlite. Setzen Sie dies, wenn keine `CREATE DATABASE`-Berechtigung vorliegt. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und provisioniert nichts – Sie stellen Ihre eigene bereit. Entspricht `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Legt den Port des Frontend-Dev-Servers fest, den `rebase dev` andernfalls aus dem Projektpfad ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` wartet, bis sich das Backend meldet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert den Bericht. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in den Connection-String einträgt, den es aus der `docker-compose.yml` ableitet. | — |
| `DO_NOT_TRACK` | Die übergreifende Konvention für Entwicklerwerkzeuge. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe speziell für Rebase. Erfordert keine Datei und eignet sich daher besonders für CI und Container-Images. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Zieladresse für Telemetriedaten bei Verwendung eines selbst gehosteten Collectors. | — |

## Secrets in der Entwicklung

`JWT_SECRET` ist in der Produktion erforderlich. Dieser Wert und `REBASE_SERVICE_KEY` werden
außerhalb der Produktion automatisch für Sie generiert, sodass Sie direkt starten können, ohne etwas konfigurieren zu müssen.

Diese generierten Werte werden in `.rebase-dev-secrets.json` gecacht, direkt neben
`.rebase-dev-port` und `.rebase-dev-url` und zusammen mit diesen per gitignore ausgeschlossen. Zuvor
wurden sie bei jedem Start neu generiert – ein Neustart des Entwicklungsservers meldete Sie daher
von Ihrer eigenen App ab und invalidierte jeden gerade erstellten API-Schlüssel.

- Setzen Sie eine der beiden Variablen explizit, wird Ihr Wert verwendet; es wird nichts zwischengespeichert oder gelesen.
- Mit `REBASE_DEV_SECRETS_FILE` können Sie den Cache auf einen anderen Pfad umleiten – die
  einzige Variable in diesem Abschnitt, die man jemals bewusst setzen würde.
- Löschen Sie die Datei, um beide Secrets neu zu generieren. Der nächste Start schreibt eine neue Datei.
- Kann die Datei nicht geschrieben werden – etwa in einem schreibgeschützten Container –, startet der Server
  dennoch mit einem flüchtigen Secret, genau wie früher.

In der Produktion oder unter einem Test-Runner wird nichts gecacht. In der Produktion wird
auch nichts automatisch generiert: Ein Start ohne `JWT_SECRET` schlägt unter Nennung der Variablen fehl;
dieses Verhalten ist unverändert:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Backend-Konfigurationsobjekt

Das an `initializeRebaseBackend()` übergebene `RebaseBackendConfig` bietet programmatische Steuerungsmöglichkeiten:

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
        requireAuth: true,    // Authentifizierung für Daten-API erzwingen (Standard: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // Ist in der Produktion kein Bucket konfiguriert, ist der Storage deaktiviert (nicht lokal):
    // Uploads antworten mit 501, anstatt auf einem Dateisystem zu landen, das beim
    // nächsten Redeploy gelöscht wird.
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

    enableSwagger: true,     // OpenAPI-Dokumentation unter /api/docs aktivieren

    logging: {
        level: "info"
    }
});
```

Dieselben Optionen –
ohne `app`, `server` und `basePath` und mit einem obligatorischen `provision` – erzeugen ein
Backend, das nichts ausliefert, bis Sie es mounten: `createRebaseBackend`. Siehe
[Custom Server Integration](/docs/backend/custom-server/).

### Ändern von `basePath`

`basePath` verschiebt alle API-Routen, daher muss der Client entsprechend konfiguriert werden –
andernfalls fragt er weiterhin `/api/...` an und erhält für jeden Aufruf einen 404-Fehler:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // muss mit dem basePath des Backends übereinstimmen
});
```

Das Admin-Panel übernimmt diesen Pfad automatisch aus dem übergebenen Client; eine weitere
Konfiguration ist nicht erforderlich. Wenn Sie eine Anfrage-URL manuell zusammensetzen, beziehen Sie
diese aus dem Client, anstatt `/api` fest zu kodieren:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // z. B. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### SQL-Editor: Keine Berechtigung (`permission denied for table <name>`)

* **Symptome:** Benutzerdefinierte Abfragen im SQL-Editor von Rebase Studio schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellenansicht (Spreadsheet-CMS) Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, SQL-Editor-Abfragen auszuführen, indem temporär die Datenbankrolle gewechselt wird, um sie an die Anwendungsrolle des aktiven Benutzers anzupassen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung nutzen, bei der Rollen nur in Datenbanktabellen und nicht als echte PostgreSQL-Rollen existieren, schlägt dieser Rollenwechsel fehl oder es fehlen Datenbankprivilegien. Die CMS-Tabellenansicht wird unter dem Standard-Verbindungsbenutzer ausgeführt und umgeht diesen Mechanismus.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase dazu, Abfragen im SQL-Editor mit den Berechtigungen des Verbindungseigentümers (in der Regel ein Superuser/Owner) auszuführen. Der SQL-Editor zeigt dann oberhalb der Ergebnisse an, dass diese als Verbindungseigentümer gelesen wurden, und deaktiviert die Rollenauswahl.

### SQL-Editor: Schema-Abruf fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann die Schema-Struktur nicht laden oder der SQL-Editor wirft den Fehler `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Ursache:** Rebase benötigt administrative Berechtigungen, um Systemkataloge der Datenbank abzufragen und Administrationsbefehle auszuführen. Wenn dem Bootstrapper kein `adminConnectionString` übergeben wird oder `getAdmin()` so überschrieben ist, dass es `undefined` zurückgibt, schlagen diese Vorgänge fehl.
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

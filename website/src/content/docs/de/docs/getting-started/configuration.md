---
sourceHash: 11b34d6efd4ef32e
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projektstammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> eine erforderliche Angabe fehlt oder fehlerhaft ist (eine URL, die keine URL ist, ein Port,
> der keine Zahl ist), verweigert der Server den Start und nennt die entsprechende Variable.
>
> Wo sich das Schema befindet, hängt davon ab, wie Sie das Backend ausführen. Ein Projekt, das
> von der Laufzeitumgebung gestartet wird – `rebase dev`, `rebase start`, das veröffentlichte Image –, verwendet
> das Schema der Runtime (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, für das [`rebase eject`](/docs/cli)
> ausgeführt wurde, besitzt eine eigene `backend/src/env.ts`, die `loadEnv({ extend })` aufruft, und kann dort
> eigene typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **In der Entwicklung optional** – wenn nicht gesetzt, führt `rebase dev` ein verwaltetes PostgreSQL für das Projekt aus, dessen Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mindestens 32 Zeichen). **In der Produktion erforderlich** (wird in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` ist eine node-postgres-Schreibweise, keine von libpq.**
>
> Rebase und der Node-Treiber akzeptieren sie – verschlüsseln, aber das
> Zertifikat nicht prüfen. `psql`, `pg_dump`, `pg_restore` und Atlas akzeptieren sie nicht
> und stufen nicht ab: Sie verweigern den Start mit `invalid sslmode value: "no-verify"`.
>
> Die eigenen Befehle von Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) schreiben dies vor dem Ausführen in das äquivalente `sslmode=require` um,
> sodass sie mit der konfigurierten URL funktionieren. Der manuelle Aufruf von `psql` tut dies
> nicht – ersetzen Sie es dort durch `sslmode=require`, was auf genau dieselbe Weise
> ohne Verifizierung verschlüsselt.

### Frontend

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `VITE_API_URL` | Backend-API-URL für das Client-SDK. **Nur in der Entwicklung setzen** – siehe unten. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client-ID. Aktiviert "Mit Google anmelden". | — |

> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, daher injiziert der
> Dev-Server diese Variable. In der Produktion liefert das Rebase-Backend die SPA aus, sodass die
> API der eigene Origin der Seite ist und der Client dies selbstständig so auflöst.
>
> Eine absolute URL fest in ein Produktions-Bundle einzubinden funktioniert genau so lange, bis ein
> zweiter Hostname auf dieselbe App verweist: Eine benutzerdefinierte Domain lädt die Seite dann von
> `example.com` und ruft die API unter `example.rebase.website` auf. Das ist Cross-Origin,
> wodurch jeder Request den Preflight nicht besteht. Den Origin in CORS zu erlauben,
> behebt das Problem ebenfalls **nicht** – das Refresh-Cookie ist `SameSite=Lax` und wird
> nicht Cross-Site gesendet. Sie würden also die Konsolenfehler beseitigen, hätten aber
> weiterhin eine defekte Authentifizierung. Wenn die Variable ungesetzt bleibt, funktioniert jede
> Domain, die auf die App verweist, ganz ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort nicht gelesen, da der Port vor dem Laden dieser Datei aufgelöst wird – und bindet andernfalls einen vom Projektpfad abgeleiteten Port, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beidem, und das Startbanner nennt die verwendete Stufe. | `3001` |
| `LOG_LEVEL` | Logging-Detailgrad: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer Zeile `Failed query: [redacted]`. Jede fehlschlagende Anweisung wird standardmäßig zensiert, da eine fehlgeschlagene Abfrage ihre gebundenen Parameter enthält – eine E-Mail-Adresse, einen Passwort-Hash. Setzen Sie dies auf `true`, während Sie einen DDL-, RLS- oder Change-Capture-Fehler diagnostizieren. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste der erlaubten Origins. **In Produktion erforderlich**, falls abweichend von der Backend-Domain. In der Entwicklung wird sie zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu CORS_ORIGINS verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (wird für Schema-Introspektion und administrative Operationen verwendet). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert den Wechsel von PostgreSQL-Rollen im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). | `false` |

#### CORS in der Entwicklung

Die Entwicklung erlaubt **localhost sowie alle in `CORS_ORIGINS` (oder `FRONTEND_URL`)
angegebenen Origins** – dieselbe Liste, die die Produktion verwendet, wobei localhost
hinzugefügt statt ersetzt wird. Die Variable funktioniert also in beiden Umgebungen
auf dieselbe Weise, und die Fälle, in denen sie in der Entwicklung benötigt wird, sind die üblichen:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Ein Origin, der weder localhost noch aufgeführt ist, wird abgewiesen, und die Abweisung
wird **einmal pro Origin** mit der genauen Zeile protokolliert, die ihn erlauben würde.
Das Abweisen ist keine Vorsicht um ihrer selbst willen: Die API sendet Anmeldedaten. Die
Rückspiegelung eines beliebigen `Origin` würde es jeder Website, die der Entwickler zufällig
besucht, erlauben, mit dessen Sitzung authentifizierte Anfragen an den Entwicklungsserver
zu stellen und die Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `JWT_SECRET` | Secret für die JWT-Signierung (in Produktion erforderlich, in Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Zugriffstokens (RS256), sodass jeder im Besitz des JWKS eine Sitzung verifizieren kann, ohne selbst Tokens erstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEM. Ohne diese Angabe bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie diesen Wert jedes Mal, wenn der Schlüssel geändert wird – die Schlüsselrotation erfordert, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh Tokens. Gleitend – jede Rotation verlängert sie, dieser Wert regelt also, wie lange eine Sitzung **Inaktivität** übersteht. | `400d` |
| `ALLOW_REGISTRATION` | Neuen Benutzern die Registrierung erlauben (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von diesem Wert – eine leere Benutzertabelle muss jemanden zulassen, und dieser jemand wird Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein über die offene Registrierung erstelltes erstes Konto ist ein gewöhnliches Konto, und der Administrator wird unten mit `REBASE_ADMIN_EMAIL` benannt oder mit dem Service-Schlüssel zugewiesen. Die Datei `.env.example` des Scaffolds setzt dies auf `true`; der Standardwert des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Notfallschalter. Schließt das Bootstrap-Fenster für den ersten Benutzer, das `ALLOW_REGISTRATION=false` außerhalb der Produktion absichtlich offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank gesperrt ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, andernfalls hat das Deployment keine Möglichkeit, seinen ersten angemeldeten Aufrufer zu erstellen. Jedes ausgelieferte Deployment-Artefakt setzt diese Variable. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Admin-Kontos, das beim Start erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. Auf diese Weise erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt darum mit dem Internet um die Wette zu laufen. Der Start warnt, wenn die Tabelle in Produktion leer und diese Variable nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Secret. Wenn nicht gesetzt, werden die Secrets stattdessen mit `JWT_SECRET` verschlüsselt und der Start warnt einmal – eine Rotation von `JWT_SECRET` meldet somit alle Benutzer ab *und* führt dazu, dass jeder registrierte Authentifikator unentschlüsselbar wird. Legen Sie einen dedizierten Schlüssel (32+ zufällige Zeichen) fest, bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *wegrotiert* wird. Setzen Sie während einer Rotation beide: Neue Secrets werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende sind weiterhin lesbar, sodass niemand mitten in der Rotation aus seinem Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Secret neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht durch `ALLOW_REGISTRATION` eingeschränkt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API verlangen. Setzen Sie `false` für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Stellt `POST /api/auth/find-user` bereit, wodurch eine E-Mail-Adresse in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für Einladungsabläufe per E-Mail aufgelöst wird. Nur für authentifizierte Aufrufer, und es werden niemals E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurückgegeben. Standardmäßig deaktiviert: Es stellt eine Angriffsfläche für Aufzählungen (Enumeration) dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` für das Refresh-Cookie: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` für das Refresh-Cookie. Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für reines HTTP – ein Deployment auf einer LAN-Adresse, bei dem der Browser das Cookie andernfalls verwerfen würde und die Sitzung beim Ablauf des Zugriffstokens ohne Fehler enden würde. Gibt beim Booten eine Warnung aus. `http://localhost` benötigt dies nicht. | `true` |
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
| `GITLAB_CLIENT_ID` | GitLab OAuth Client-ID. Die `baseUrl` einer selbst gehosteten Instanz hat keine Entsprechung als Umgebungsvariable – konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab OAuth Client-Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket OAuth Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket OAuth Client-Secret | — |
| `SLACK_CLIENT_ID` | Slack OAuth Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack OAuth Client-Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth Client-Secret | — |
| `APPLE_CLIENT_ID` | Apple Services-ID. Apple hat kein statisches Client-Secret – Rebase signiert ein kurzlebiges ES256-JWT pro Token-Austausch – daher werden alle vier `APPLE_*`-Werte benötigt, und ohne sie wird nichts konfiguriert. | — |
| `APPLE_TEAM_ID` | Apple Developer Team-ID, der Aussteller (Issuer) des JWTs. | — |
| `APPLE_KEY_ID` | Schlüssel-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten Schlüsseldatei `.p8`, inklusive Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch generiert). | — |
| `REBASE_RATE_LIMIT_STORE` | Wo Zähler für Authentifizierungs-Rate-Limits gespeichert werden: `memory` (pro Prozess) oder `sql` (geteilt über Replikate hinweg). Ein Prozess kann seine eigene Anzahl an Replikaten nicht sehen, daher muss ein Deployment mit Peers dies angeben – drei Replikate auf dem Standardwert erzwingen das dreifache Limit. Jeder andere Wert **verweigert den Start**, anstatt auf einen Fallback zurückzugreifen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Stellt den passwortlosen Ablauf per Anmelde-Link bereit. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Stellt die passwortlose Anmeldung mit einem sechsstelligen, per E-Mail gesendeten Code bereit. Gleiche E-Mail-Anforderung wie oben. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert die Captcha-Verifizierung auf den Authentifizierungsrouten: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig verwendet wird, um das vom Browser gesendete Token zu überprüfen. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Authentifizierungsrouten, die geschützt werden sollen (z. B. `register,login`). Nicht gesetzt schützt die Standardauswahl des Anbieters. | — |

### Storage

:::caution[Storage besitzt keine Row-Level Security und benötigt daher ein Zugriffsmodell]
Collections werden durch Postgres-RLS geschützt. Für Object Storage gibt es kein Äquivalent –
Schlüssel teilen sich einen einzigen flachen Namensraum. Bei einem konfigurierten Bucket und ohne Zugriffsmodell
**verweigert der Server in der Produktion den Start**. Erfüllen Sie diese Anforderung mit genau einer der folgenden Optionen:
einem aus `config/index.ts` exportierten `storageAuthorize`-Hook (was das Scaffold
mitliefert), `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `STORAGE_TYPE` | Storage-Backend: `local`, `s3` oder `gcs`. In der Produktion deaktiviert `local` den Storage, es sei denn, `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in der Produktion erlauben – nur mit einem dauerhaften Volume, das unter `STORAGE_PATH` gemountet ist | `false` |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS-Zugriffsschlüssel | — |
| `S3_SECRET_ACCESS_KEY` | Geheimer AWS-Schlüssel | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 usw.) | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für den S3-Bucket erzwingen (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Dienstkonto-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für einen Bucket gedacht, der tatsächlich ein öffentliches CDN ist. Eine der drei Möglichkeiten, die Boot-Prüfung unten zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jedem angemeldeten Aufrufer das Lesen, Schreiben, Auflisten und Löschen jedes Objekts gestatten. Im Konfigurationsobjekt aus gutem Grund `INSECURE` genannt: Es ist nur in einer Single-Tenant-App vertretbar, in der jedem Konto jede Datei anvertraut wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bildwiedergaben (Größenanpassungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu erzeugen. | `false` |

### E-Mail (Optional)

| Variable | Beschreibung |
|----------|--------------|
| `SMTP_HOST` | Host des SMTP-Servers |
| `SMTP_PORT` | Port des SMTP-Servers |
| `SMTP_SECURE` | Sichere Verbindung aktivieren (`true`/`false`) |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | Absenderadresse für System-E-Mails |
| `SMTP_NAME` | Anzeigename für die Absenderadresse |
| `APP_NAME` | Produktname, der in E-Mail-Betreffzeilen und -Texten verwendet wird (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo, das oben in den Standard-E-Mail-Vorlagen angezeigt wird. Absolute `http(s)`-PNG- oder -JPG-URL – Clients entfernen SVG und blockieren `data:`-URIs. Wenn nicht gesetzt, erhält eine noch `Rebase` genannte App das Rebase-Zeichen und eine umbenannte keines |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `DB_POOL_MAX` | Maximale Anzahl an gepoolten Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine inaktive Verbindung aufrechterhalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine solche: `LISTEN`/`NOTIFY` funktioniert nicht über einen Transaktions-Pooler wie PgBouncer; ohne sie werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, statt lautlos verloren zu gehen. | — |
| `DATABASE_READ_URL` | Read-Replikat. Lesezugriffe gehen dorthin, wenn gesetzt und abweichend von `DATABASE_URL`; schlägt die Verbindung fehl, fällt alles mit einer Warnung auf die primäre Datenbank zurück. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was der jeweilige Pool angefordert hat. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server lautlos zu serialisieren. | — |

### Laufzeitverhalten

Wird von der Runtime gelesen – `rebase dev`, `rebase start` und dem veröffentlichten
Server-Image. Ein Projekt, für das `eject` ausgeführt wurde, steuert diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_RLS_AUDIT` | Führt die Prüfung auf Row-Level Security beim Start aus und bindet deren Endpunkt ein, welcher Tabellen meldet, die ohne Richtlinien bereitgestellt werden. | — |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Dem Client muss derselbe Pfad mitgeteilt werden – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische/Admin-Assets des Bundles aus diesem Prozess bereitstellen. Deaktivieren Sie dies, wenn ein CDN davor geschaltet ist. | `true` |
| `REBASE_HISTORY` | [Entitätsänderungshistorie](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | Antworten mit gzip/brotli komprimieren. | `true` |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body, **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verweigert den Start, anstatt das Limit stillschweigend aufzuheben). | — |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände: Nicht gesetzt bedeutet in der Entwicklung aktiviert, in der Produktion deaktiviert; `false` deaktiviert beides überall. Beachten Sie, dass `true` in der Produktion die **Spezifikation** unter `/api/docs` bereitstellt, jedoch nicht die Swagger-**Benutzeroberfläche** unter `/api/swagger` – die UI wird separat über `NODE_ENV` gesteuert. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn nicht gesetzt, bleibt der Endpunkt für alles offen, was den Port erreichen kann – in einem privaten Netzwerk in Ordnung, in einem öffentlichen nicht, worauf die Boot-Logs hinweisen. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start mit dem Schema tun darf. `ensure` (der Standard überall – einschließlich Produktion) führt den **additiven** Schritt aus: Fehlende Tabellen, Spalten und Enum-Typen anlegen, niemals löschen oder umschreiben. `none` rührt nichts an. Das veröffentlichte Image akzeptiert nur diese beiden und **verweigert den Start bei `push`**. In einem [getrennten Deployment](/docs/deployment/split-processes) darf genau ein Prozess die Bereitstellung übernehmen, daher müssen alle anderen Rollen `none` setzen oder den Start verweigern. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Start verweigern, wenn die Datenbank zuletzt aus einem anderen Satz von Collections bereitgestellt wurde, als diesem Prozess zugrunde liegt. Nicht gesetzt (oder alles andere als `true`/`1`) gibt stattdessen eine Warnung aus. | warn |
| `REALTIME_CDC` | Change-Capture auf Datenbankebene: `auto` (aktivieren, wo die Verbindung es unterstützt, sonst stiller Fallback), `trigger` (erzwingen, warnen falls unmöglich), `wal` (fällt aktuell auf `trigger` zurück), `off`. Siehe [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Kanäle und Anwesenheit (Presence): `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein konstruierter Transport übergeben wurde. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | `localhost`/Loopback-Werte unter `NODE_ENV=production` zulassen. Standardmäßig deaktiviert, damit ein Produktionsstart deutlich fehlschlägt, anstatt sich mit einer Datenbank zu verbinden, die nicht existiert. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Was der Startvorgang mit einem Schlüssel in Ihren Collections tun soll, den diese Version nicht liest: `warn`, `error` (Start verweigern – sinnvoll in CI), oder `off`. Regelt nur Schlüssel, die *nicht erkannt* werden (meist Tippfehler, gelegentlich beabsichtigte Metadaten); ein Schlüssel, von dem bekannt ist, dass er verschoben wurde, ist immer fatal, da das konfigurierte Feature andernfalls stillschweigend fehlt. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet sich, ohne einen Socket zu öffnen – genau das Verhalten, das ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der nachfolgende Server. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein normales Deployment nicht in eines verwandeln kann, das migriert und die Bereitstellung verweigert. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt einer Maschine – einem Agenten, einem CI-Job –, eine Schemaänderung über `/api/admin/schema` tatsächlich *anzuwenden* und nicht nur zu planen. Deaktiviert, sofern nicht ausdrücklich angefordert: Der Anmeldedatensatz, der eine solche Änderung durchführen könnte, liegt am ehesten in einer CI-Variable. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Wie lange eine benutzerdefinierte Funktion ausgeführt werden darf, bevor ihre Anfrage abgebrochen wird. Derselbe Schalter wie die Option `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` sorgt dafür, dass eine nicht behandelte Promise-Rejection den Prozess beendet, anstatt sie nur zu protokollieren. Aktivieren unter einem Orchestrator, der neu startet; deaktivieren, wenn ein Neustart schlimmer ist als ein Leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Hält den Cron-Scheduler auf Plattformen aktiv, die die Runtime andernfalls als Scale-to-Zero erkennt, wo ein Timer, der in einer inaktiven Instanz ausgelöst wird, in gar keiner Instanz ausgelöst wird. | — |
| `TRUSTED_PROXY_HOPS` | Wie viele Proxies vor diesem Server liegen, damit der Rate Limiter die echte Client-Adresse aus `X-Forwarded-For` auslesen kann. Ausfallsicherer Standardwert `0`: Ohne Proxy würde das Vertrauen in den Header jedem Aufrufer erlauben, eine Identität vorzutäuschen. | `0` |

:::note[Die Bereitstellung beim Booten ist additiv und kein Migrationswerkzeug]
Der Boot-Durchlauf läuft unbeaufsichtigt und ohne dass jemand ein Diff prüft; daher wird er niemals
eine Spalte löschen, einen Typ einschränken oder eine Tabelle umschreiben. Aus diesem Grund verweigert
das Image auch `REBASE_MIGRATE_ON_BOOT=push`: Ein vollständiger Push berechnet ein Diff und führt ohne
Weiteres ein `DROP COLUMN` aus, und ein Container-Neustart darf niemals im Zuge eines Reschedulings
eine Produktionsspalte zerstören können.

Destruktive oder umstrukturierende Änderungen bleiben dort, wo sie überprüft werden können: `rebase db
generate` + `rebase db migrate` oder `rebase db push` aus einem Checkout oder der CI,
was die Änderung im Probelauf prüft, destruktive Änderungen ohne Bestätigung verweigert
und zuvor ein Backup erstellen kann.
:::

### Geteilte Deployments (Split Deployments)

Ein einziges Image und ein Bundle können mehrfach gestartet werden, wobei jede Instanz einen
anderen Teil des Projekts bedient. Hier jeweils eine Zeile, da diese Seite den Anspruch erhebt,
jede Variable aufzuführen; was jede Kombination *bereitstellt und verwaltet* – und welche
Kombinationen den Start verweigern – finden Sie unter
**[Geteilte Prozesse (Split Processes)](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Wenn nicht gesetzt, folgt er der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Wenn nicht gesetzt, folgt er der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | Nur die genannten benutzerdefinierten Funktionen in diesem Prozess bereitstellen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen außer den genannten bereitstellen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. | — |

### MCP-Schnittstelle

Ein optionaler Model-Context-Protocol-Endpunkt unter `/mcp`, damit ein KI-Client dieses Projekt
**als der angemeldete Benutzer** lesen und schreiben kann. Deaktiviert, sofern nicht gesetzt, und – anders
als bei jeder anderen Oberfläche – schaltet keine `REBASE_ROLE` diesen Endpunkt ein: Die anderen beschreiben
eine Prozessform, während dies eine Entscheidung ist, Anmeldedaten an Software von Drittanbietern
zu übergeben, und diese sollte von einer Person getroffen und nicht von der Berufsbezeichnung eines Containers geerbt werden.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_MCP_ENABLED` | Die MCP-Schnittstelle einbinden. Erfordert `REBASE_PUBLIC_URL`; ohne diese Angabe lehnt die Schnittstelle das Laden ab und meldet dies im Boot-Log. | `false` |
| `REBASE_PUBLIC_URL` | Der extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Schnittstelle kann diesen nicht ableiten – die Übernahme des Origins aus dem `Host`-Header würde die Ausstelleridentität und die Audience, gegen die ihre eigenen Tokens geprüft werden, zu einem Wert machen, den der Aufrufer vorgibt. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Dynamische OAuth-Client-Registrierung (RFC 7591) erlauben, damit sich ein Client selbst registrieren kann. Auf `false` setzen, um zu verlangen, dass Clients im Voraus registriert werden. | `true` |

### Backups

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Nicht gesetzt bedeutet, dass geplante Backups deaktiviert sind. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- / `gs://bucket/prefix`-URL. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Nicht gesetzt oder `0` behält alles. | — |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens N der neuesten Backups behalten, unabhängig von der Aufbewahrungsfrist. | — |
| `PG_DUMP_PATH` | Überschreiben der `pg_dump`-Binärdatei – sie muss der Hauptversion des Servers entsprechen. | — |
| `PG_RESTORE_PATH` | Überschreiben der `pg_restore`-Binärdatei. | — |

Backups enthalten Secrets und personenbezogene Daten (PII). Verwenden Sie ein privates Ziel mit
Ruhezustandsverschlüsselung (Encryption-at-Rest).
| `PG_DUMPALL_PATH` | Wo sich `pg_dumpall` befindet, wenn es nicht im `PATH` liegt. Ohne dies – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

### Bundle-Auslieferung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft beim
Start ein Bundle ab. Diese Variablen bestimmen, welches und wie.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Das, was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Von wo das Bundle-Archiv abgerufen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Die Bearer-Anmeldeinformation für diesen Abruf. Behandeln Sie dies als Geheimnis: Es autorisiert einen Mandanten, seinen eigenen Code herunterzuladen. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Wohin ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und zwischen Abruf und Bootvorgang erhalten bleiben. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image dem Bundle über die selbst deklarierten hinaus bereitstellt. | — |

### Ressourcen-Bindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `config/resources.ts` deklariert,
wird über nach ihm benannte Umgebungsvariablen gebunden. Die Basisnamen stehen unten; eine
Nicht-Standard-Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an, sodass ein Bucket namens
`media` als `S3_BUCKET__MEDIA` gelesen wird. `rebase status`
gibt für jede Ressource
die genaue Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, wenn es nicht der standardmäßige Postgres-Treiber ist. Wird pro Quelle angehängt: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Wird pro Topic angehängt. | — |

### Die Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hier hat Auswirkungen auf ein Deployment.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_BASE_URL` | Das Backend, mit dem `rebase auth` und `rebase api-keys` kommunizieren, anstatt es aus dem Projekt abzuleiten. | — |
| `REBASE_PORT` | Der Port, den diese Befehle annehmen, wenn sie diese URL ableiten. | — |
| `SERVICE_KEY` | Der Service-Schlüssel, mit dem sie sich authentifizieren, anstatt danach zu fragen. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env`-Datei die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, als das sich `rebase cloud login` anmeldet, anstatt danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Dessen Passwort, damit ein Secret-Speicher es übergeben kann, ohne dass es in den Verlauf der Shell gelangt. | — |
| `REBASE_DEBUG` | `1` gibt den zugrunde liegenden Fehler und Anfragedetails anstelle der Kurznachricht aus. Das Erste, was gesetzt werden sollte, wenn ein `rebase cloud`-Befehl ohne hilfreiche Meldung fehlschlägt. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und stellt nichts bereit – Sie bringen Ihre eigene mit. Entspricht `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixiert den Port des Frontend-Dev-Servers, den `rebase dev` ansonsten aus dem Projektpfad ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` darauf wartet, dass sich das Backend meldet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert die Meldung. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einfügt. | — |
| `DO_NOT_TRACK` | Die werkzeugübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe, speziell für Rebase. Benötigt keine Datei und ist daher die Variante zur Verwendung in CI und in einem Image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Wohin Telemetriedaten gesendet werden, für einen selbst gehosteten Collector. | — |

## Secrets in der Entwicklung

`JWT_SECRET` und `REBASE_SERVICE_KEY` sind in der Produktion erforderlich und werden
außerhalb davon für Sie generiert, sodass Sie starten können, ohne etwas einrichten zu müssen.

Diese generierten Werte werden in `.rebase-dev-secrets.json` neben
`.rebase-dev-port` und `.rebase-dev-url` zwischengespeichert und mit diesen gitignoriert. Zuvor
wurden sie bei jedem Start neu generiert – ein Neustart des Dev-Servers meldete Sie somit
von Ihrer eigenen App ab und machte jeden gerade erstellten API-Schlüssel ungültig.

- Setzen Sie eine der Variablen explizit, wird Ihre Angabe verwendet; es wird nichts zwischengespeichert oder gelesen.
- Verweisen Sie den Cache mit `REBASE_DEV_SECRETS_FILE` an einen anderen Ort – ein Pfad und die
  einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets neu zu generieren. Der nächste Start schreibt eine neue Datei.
- Wenn die Datei nicht geschrieben werden kann – etwa in einem schreibgeschützten Container –, startet der Server
  dennoch mit einem flüchtigen Secret, genau wie früher.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion schlägt
ein Start, der eines der Secrets hätte generieren müssen, weiterhin unter Nennung der Variablen fehl:

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

Das Admin-Panel übernimmt dies von dem Client, der ihm übergeben wird; sonst muss nichts
konfiguriert werden. Wenn Sie eine Request-URL manuell zusammenbauen, verbinden Sie sie über den Client,
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

* **Symptome:** Im SQL-Editor von Rebase Studio ausgeführte benutzerdefinierte Abfragen schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellen-CMS-Ansicht Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, Abfragen im SQL-Editor auszuführen, indem temporär die Datenbankrollen gewechselt werden, um der Anwendungsrolle des aktiven Benutzers zu entsprechen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen und nicht als tatsächliche PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer des Verbindungseigentümers ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase dazu, SQL-Editor-Abfragen mit den Rechten des Verbindungseigentümers auszuführen (in der Regel ein Superuser/Owner).

### SQL-Editor: Abrufen des Schemas fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden oder der SQL-Editor wirft `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Ursache:** Rebase benötigt administrative Berechtigungen, um Datenbanksystemkataloge abzufragen und administrative Befehle auszuführen. Wenn dem Bootstrapper kein `adminConnectionString` übergeben wird oder `getAdmin()` so überschrieben ist, dass es `undefined` zurückgibt, schlagen diese Operationen fehl.
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

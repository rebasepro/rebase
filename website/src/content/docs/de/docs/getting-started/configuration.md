---
sourceHash: 2685a77f978aeef3
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projekt-Root-Verzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> ein erforderlicher Wert fehlt oder fehlerhaft formatiert ist (eine URL, die keine URL
> ist, ein Port, der keine Zahl ist), verweigert der Server den Start und benennt die Variable.
>
> Wo sich das Schema befindet, hängt davon ab, wie Sie das Backend ausführen. Ein von
> der Laufzeitumgebung gestartetes Projekt – `rebase dev`, `rebase start`, das veröffentlichte
> Image – verwendet das Schema der Laufzeitumgebung (`loadBootEnv` in `@rebasepro/server`),
> welches die Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, bei
> dem [`rebase eject`](/docs/cli) ausgeführt wurde, besitzt eine `backend/src/env.ts`,
> die `loadEnv({ extend })` aufruft, und kann dort eigene typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **In der Entwicklung optional** – wenn nicht gesetzt, führt `rebase dev` eine verwaltete PostgreSQL-Instanz für das Projekt aus, deren Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktion erforderlich** (in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> Standardmäßig prüft node-postgres bei `sslmode=require` das Zertifikat. Libpq-Tools
> wie `psql` unterstützen `require` mit schwächerer Prüfung und weisen `no-verify`
> zurück. Verwenden Sie `sslmode=verify-full&sslrootcert=/path/to/ca.pem` zur Prüfung
> der CA und des Hostnamens. Soll nur verschlüsselt werden, geben Sie Rebase
> `sslmode=no-verify`. Rebase reicht `sslmode=require` an Ptah Compat sowie die
> PostgreSQL-Werkzeuge für Sicherung und Wiederherstellung weiter. Verwenden Sie für
> direkte libpq-Aufrufe `sslmode=require`.

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** – siehe unten. | Seitenursprung |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth-Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, daher injiziert der
> Dev-Server diesen Wert. In der Produktion liefert das Rebase-Backend die SPA aus,
> sodass die API der Origin der Seite selbst entspricht und der Client dies automatisch
> so auflöst.
>
> Das Einbetten einer absoluten URL in ein Produktions-Bundle funktioniert so lange,
> bis ein zweiter Hostname auf dieselbe Anwendung verweist: Eine benutzerdefinierte
> Domain lädt die Seite dann von `example.com` und ruft die API unter `example.rebase.website`
> auf, was Cross-Origin ist, sodass jeder Request beim Preflight fehlschlägt. Das
> Erlauben der Origin in CORS behebt dies ebenfalls **nicht** – das Refresh-Cookie ist
> `SameSite=Lax` und wird nicht seitenübergreifend gesendet. Die Konsolenfehler wären
> zwar behoben, aber die Authentifizierung bliebe fehlerhaft. Wenn die Variable nicht
> gesetzt ist, funktioniert jede auf die App verweisende Domain ohne jegliche CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort nicht gelesen, da der Port vor dem Laden dieser Datei aufgelöst wird – und bindet ansonsten einen aus dem Projektpfad abgeleiteten Port, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner gibt die verwendete Methode an. | `3001` |
| `LOG_LEVEL` | Protokollierungsdetailgrad: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer `Failed query: [redacted]`-Zeile. Standardmäßig wird jedes fehlgeschlagene Statement unkenntlich gemacht, da eine fehlgeschlagene Abfrage ihre gebundenen Parameter enthält – eine E-Mail, ein Passwort-Hash. Setzen Sie dies auf `true`, während Sie einen DDL-, RLS- oder Change-Capture-Fehler diagnostizieren. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste der erlaubten Origins. **In der Produktion erforderlich**, sofern `FRONTEND_URL` nicht gesetzt ist: Ein Produktionsstart ohne beides verweigert den Start. In der Entwicklung wird dies zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu CORS_ORIGINS verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (für Schema-Introspektion und Admin-Operationen verwendet). Die darin benannte Datenbank ist weder diejenige, die die SQL-Konsole als aktuell bezeichnet, noch diejenige, die ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der die Verbindung der App selbst liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert den PostgreSQL-Rollenwechsel im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Die SQL-Konsole von Studio meldet dann, dass die Zeilen als Verbindungsinhaber gelesen wurden, benennt diesen und blendet die Rollenauswahl aus. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies bei einem Checkout, der [auf einen Branch gewechselt ist](/docs/backend/branching/#cli-integration). Ein Server mit dieser Variablen verwaltet das Branch-Register auf dieser Datenbank und kopiert neue Branches standardmäßig von dort, sodass der Branches-Bereich von Studio die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

In der Entwicklung ist **localhost sowie alles erlaubt, was in `CORS_ORIGINS` (oder `FRONTEND_URL`)
angegeben ist** – dieselbe Liste, die die Produktion verwendet, wobei localhost hinzugefügt statt
ersetzt wird. Die Variable funktioniert also in beiden Umgebungen auf dieselbe Weise, und die
Fälle, in denen sie in der Entwicklung benötigt wird, sind die üblichen:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Ein Origin, der weder localhost noch aufgeführt ist, wird abgewiesen, und die Abweisung wird
**einmal pro Origin** mit der genauen Zeile protokolliert, die ihn erlauben würde. Das Abweisen ist
keine reine Vorsichtsmaßnahme: Die API sendet Anmeldeinformationen (Credentials). Ein blindes Reflektieren
eines beliebigen `Origin`-Headers würde es jeder Website, die der Entwickler zufällig besucht, ermöglichen,
mit dessen Sitzung authentifizierte Anfragen an den Dev-Server zu senden und die Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Secret für die JWT-Signierung (in Produktion erforderlich, in Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Zugriffstokens (RS256), sodass jede Entität, die das JWKS besitzt, eine Sitzung verifizieren kann, ohne selbst Tokens erstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEM. Ohne diese Angabe bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie dies bei jedem Schlüsselwechsel – die Rotation setzt voraus, dass Alt und Neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Zugriffstokens (Access Token) | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens. Gleitend (Sliding) – jede Rotation erneuert sie, sodass dies steuert, wie lange eine Sitzung bei **Inaktivität** überlebt. Setzen Sie `400d` für Sitzungen, die eine lange Abwesenheit überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Erlaubt neuen Benutzern die Registrierung (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden zulassen, und dieser jemand wird der Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein über die offene Registrierung erstelltes erstes Konto ist ein normales Konto, und der Administrator wird über `REBASE_ADMIN_EMAIL` unten benannt oder mit dem Service-Schlüssel zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standardwert des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Not-Aus-Schalter (Kill Switch). Schließt das Erstbenutzer-Bootstrap-Fenster, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank gesperrt ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, da das Deployment sonst keine Möglichkeit hat, seinen ersten angemeldeten Aufrufer zu erzeugen. Jedes ausgelieferte Deployment-Artefakt setzt diesen Wert. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Admin-Kontos, das beim Start erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. Auf diese Weise erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt ein Wettrennen im Internet darum zu veranstalten. Der Startvorgang warnt, wenn die Tabelle in der Produktion leer ist und dieser Wert nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Secret. Wenn nicht gesetzt, werden die Secrets stattdessen mit `JWT_SECRET` verschlüsselt und beim Start wird einmal gewarnt – die Rotation von `JWT_SECRET` meldet somit alle Benutzer ab *und* führt dazu, dass jeder registrierte Authentifikator nicht mehr entschlüsselt werden kann. Legen Sie einen dedizierten Schlüssel (mind. 32 Zufallszeichen) fest, bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *wegrotiert* wird. Setzen Sie während einer Rotation beide: Neue Secrets werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende sind weiterhin lesbar, sodass niemand mitten in der Rotation aus seinem eigenen Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Secret neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Aktiviert die anonyme Anmeldung (`POST /api/auth/anonymous`). Opt-in und bewusst nicht an `ALLOW_REGISTRATION` gekoppelt. | `false` |
| `AUTH_REQUIRE` | Erfordert Authentifizierung für die Daten-API. Setzen Sie `false` für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Bindet `POST /api/auth/find-user` ein, wodurch eine E-Mail-Adresse in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für E-Mail-Einladungsabläufe aufgelöst wird. Nur für authentifizierte Aufrufer, und es gibt niemals die E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: Stellt eine Aufzählungsoberfläche (Enumeration Surface) dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` für das Refresh-Cookie: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` für das Refresh-Cookie. Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für reines HTTP – z. B. ein Deployment auf einer LAN-Adresse, wo der Browser das Cookie sonst verwerfen würde und die Sitzung nach Ablauf des Zugriffstokens ohne Fehler beendet würde. Gibt beim Start eine Warnung aus. `http://localhost` benötigt dies nicht. | `true` |
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
| `GITLAB_CLIENT_ID` | GitLab OAuth-Client-ID. Die `baseUrl` einer selbst gehosteten Instanz hat keine Umgebungsvariablen-Schreibweise – konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab OAuth-Client-Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket OAuth-Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket OAuth-Client-Secret | — |
| `SLACK_CLIENT_ID` | Slack OAuth-Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack OAuth-Client-Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth-Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth-Client-Secret | — |
| `APPLE_CLIENT_ID` | Apple Services ID für Web-Logins. Sie ist öffentlich und wird in `GET /auth/config` veröffentlicht. Apple verwendet kein statisches Client Secret, da Rebase für jeden Token-Austausch ein kurzlebiges ES256-JWT signiert. Apple erfordert daher `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` sowie diesen Wert oder `APPLE_BUNDLE_IDS` und konfiguriert ohne diese nichts. | — |
| `APPLE_BUNDLE_IDS` | Kommagetrennte Bundle-IDs der nativen iOS/macOS-Apps, deren „Mit Apple anmelden“-Codes akzeptiert werden. | — |
| `APPLE_TEAM_ID` | Apple Developer Team-ID, der Aussteller (Issuer) des JWTs. | — |
| `APPLE_KEY_ID` | Key-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten Schlüsseldatei `.p8`, inklusive Zeilenumbrüche (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn als `Authorization: Bearer <key>` übergeben. (In der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Der öffentliche Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deployment und er enthält keine Geheimnisse. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` ermöglicht er es dem Admin-Gate, ein Plattform-Token für `cron:read` und für nichts anderes zu akzeptieren. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, mit der die `aud` eines Plattform-Tokens übereinstimmen muss, sodass ein für ein anderes Projekt erstelltes Token abgelehnt wird. Wenn nur eine der beiden Variablen gesetzt ist, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Wohin **Weiter mit Rebase Cloud** im Admin-Panel führt: die Projektseite in der Konsole der Plattform, die die Eigentümer des Projekts anmeldet und zurückkehrt. Die Plattform setzt diesen Wert beim Deployment zusammen mit den beiden obigen Variablen; damit akzeptiert `POST /api/auth/platform-signin` das einminütige `auth:admin-signin`-Token der Plattform und öffnet eine Admin-Sitzung. Ohne diesen Wert funktioniert der Zugang weiterhin über **CMS öffnen** in der Konsole, und der Anmeldebildschirm erklärt dies lediglich. | — |
| `REBASE_RATE_LIMIT_STORE` | Wo Rate-Limit-Zähler gespeichert werden, sowohl für die Auth-Routen als auch für `rateLimit` in benutzerdefinierten Funktionen: `memory` (pro Prozess) oder `sql` (über Replikate hinweg geteilt). Ein Prozess kann seine eigene Replikatanzahl nicht sehen, daher muss ein Deployment mit Peers dies angeben – drei Replikate beim Standardwert erzwingen das Dreifache des Limits. Jeder andere Wert **verweigert den Start**, anstatt ein Fallback zu nutzen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Bindet den passwortlosen Anmeldelink-Flow (Magic Link) ein. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Bindet passwortloses Anmelden mit einem sechsstelligen, per E-Mail gesendeten Code ein. Dieselbe E-Mail-Anforderung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Magic-Link- oder E-Mail-Code-Anfrage für eine unbekannte Adresse erstellt das Konto, solange die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh-Token nach Ablauf seines Wiederverwendungsfensters erneut abgespielt wird: `reject` (ablehnen, Sitzung beibehalten) oder `revoke-session` (Sitzung beenden). Jeder andere Wert lässt den Start fehlschlagen. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrierung mit vorheriger Bestätigung: Keine Passwortanmeldung, bis die Adresse verifiziert ist. Erfordert E-Mail; der Start wird ohne abgelehnt. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert die Captcha-Verifizierung auf den Auth-Routen: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig zur Verifizierung des vom Browser gesendeten Tokens verwendet wird. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Auth-Routen (z. B. `register,login`). Wenn nicht gesetzt, wird der Standard-Satz des Anbieters geschützt. | — |

### Speicher (Storage)

:::caution[Storage hat keine Row-Level Security und benötigt daher ein Zugriffsmodell]
Tabellen werden durch Postgres-RLS geschützt. Objektspeicher hat kein Äquivalent –
Schlüssel teilen sich einen einzigen flachen Namensraum –, sodass bei einem konfigurierten Bucket
ohne Zugriffsmodell der Server **in der Produktion den Start verweigert**. Erfüllen Sie diese
Voraussetzung mit genau einer der folgenden Optionen: einem aus `backend/storage.ts` exportierten
`storageAuthorize`-Hook (Standard im Scaffold), `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Speicher-Backend: `local`, `s3` oder `gcs`. In der Produktion deaktiviert `local` den Speicher, es sei denn, `FORCE_LOCAL_STORAGE=true`. | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird von dem Verzeichnis aus gelesen, in dem der Server ausgeführt wird: das Projekt-Root unter `rebase dev`, `backend/` in einem durch `rebase eject` erstellten Server. | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in der Produktion zulassen – nur mit einem persistenten Volume, das `STORAGE_PATH` und die `<STORAGE_PATH>__<key>`-Verzeichnisse benannter lokaler Buckets daneben enthält. | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Sekunden, die die Download-URL einer privaten Datei gültig ist – das Token, das `getSignedUrl()` darin einbettet. Maximal `604800` (eine Woche). | `300` |
| `STORAGE_MAX_FILE_SIZE` | Größte Datei, die die Quelle akzeptiert, in Bytes, auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Ein Wert, der keine ganze Zahl von Bytes ist, verweigert den Start. | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`). | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS Access Key | — |
| `S3_SECRET_ACCESS_KEY` | AWS Secret Key | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 etc.). | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für den S3-Bucket erzwingen (`true`/`false`). | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`). | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldeinformationen abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldeinformationen bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für einen Bucket gedacht, der tatsächlich ein öffentliches CDN ist. Eine der drei Möglichkeiten, die Start-Schutzprüfung unten zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jedem angemeldeten Aufrufer das Lesen, Schreiben, Auflisten und Löschen aller Objekte gestatten. Im Konfigurationsobjekt aus gutem Grund als `INSECURE` benannt: Es ist nur in einer Single-Tenant-App vertretbar, in der jedem Konto jede Datei anvertraut wird. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bilddarstellungen (Größenanpassungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu generieren. | `false` |

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
| `APP_NAME` | In E-Mail-Betreffzeilen und -Texten verwendeter Produktname (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo, das oben in den Standard-E-Mail-Vorlagen angezeigt wird. Absolute `http(s)`-PNG oder -JPG – Clients entfernen SVG und blockieren `data:`-URIs. Wenn nicht gesetzt, erhält eine noch `Rebase` benannte App das Rebase-Logo und eine umbenannte App keines. |
| `MAGIC_LINK_URL` | Wohin ein per E-Mail gesendeter Magic Link verweist. An eine Basis wird `/auth/magic-link?token=…` angehängt; eine URL, die `{token}` enthält, stellt den gesamten Link dar, für ein Frontend, das `/auth/magic-link` nicht bedient. Setzen Sie den Wert in `.env` in Anführungszeichen, da ein nicht in Anführungszeichen gesetztes `#` einen Kommentar einleitet: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Vor einem Wert mit einer Raute oder einem Dateipfad ohne `{token}` wird beim Start gewarnt. Wenn nicht gesetzt, ist die Basis `FRONTEND_URL`. |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximale Anzahl gepoolter Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung aufrechterhalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine solche Verbindung: `LISTEN`/`NOTIFY` funktioniert nicht über einen Transaktions-Pooler wie PgBouncer, und ohne sie werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, anstatt stillschweigend verloren zu gehen. Der [Job-Worker](/docs/backend/jobs) hält sein Wake-up-`LISTEN` ebenfalls darauf. Füllt `directConnectionString` des Postgres-Adapters aus, wenn dieser nicht gesetzt ist. | — |
| `DATABASE_READ_URL` | Read-Replica, wie z. B. ein Hot Standby. Wenn sie einen anderen Server benennt, werden Lesezugriffe angemeldeter Benutzer (Listen, einzelne Zeilen, Counts, Aggregate) dort unter derselben Row-Level Security bedient; Schreibvorgänge, Anmeldungen, Realtime, Crons, Jobs, die SQL-Konsole und `rebase.sql` verbleiben auf dem Primärserver. Ein lesender Benutzer, der gerade geschrieben hat, liest für die Dauer von `REBASE_READ_STICKY_MS` vom Primärserver, und alle tun dies, während das Replikat mehr als `REBASE_READ_MAX_LAG_MS` hinterherhinkt oder fehlschlägt. Füllt `readConnectionString` des Postgres-Adapters aus, wenn dieser nicht gesetzt ist; bis einschließlich 0.28 wurde der Pool des Replikats geöffnet und nie daraus gelesen. | — |
| `REBASE_READ_STICKY_MS` | Wie lange nach einem Schreibvorgang Lesezugriffe desselben Benutzers an den Primärserver geleitet werden, damit ein Speichern gefolgt von einer Listenanzeige den gespeicherten Stand widerspiegelt. Pro Serverinstanz. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Replikat-Verzögerung (Lag), ab der jeder Lesezugriff an den Primärserver geht. | `1000` |
| `DATABASE_POOLED` | `true`, wenn `DATABASE_URL` über einen Pooler im Transaktionsmodus wie PgBouncer läuft. Der Pool sendet beim Verbindungsaufbau kein `search_path` oder `statement_timeout` (der Pooler würde diese ablehnen oder verwerfen) und setzt beide in jeder Transaktion; der Startvorgang weist der Datenbankrolle einen Standard-`search_path` von `public` für Anweisungen außerhalb einer Transaktion zu. `DATABASE_DIRECT_URL` wird dadurch erforderlich, und Realtime, das Aufwecken des Job-Workers, Indexerstellungen, Branching und die SQL-Konsole verwenden diese. Die Replikat-URL wird ebenfalls als gepoolt angenommen. `DATABASE_POOLED__<KEY>` für eine weitere Datenquelle. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was jeder einzelne angefordert hat. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server stillschweigend zu serialisieren. | — |

### Laufzeitverhalten

Wird von der Laufzeitumgebung gelesen – `rebase dev`, `rebase start` und das veröffentlichte
Server-Image. Ein Projekt, bei dem ein Eject durchgeführt wurde, trifft diese
Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) aus, das Tabellen meldet, die ohne Richtlinien bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` unter seinen Abhängigkeiten deklarieren: Die Laufzeitumgebung liefert keine Kopie mit, und ohne das Paket verweigert der Start unter Nennung des Pakets den Dienst. `false` hält den Scan von diesem Prozess fern. | — |
| `REBASE_RLS_REQUEST_ROLE` | Die Postgres-Rolle, unter der authentifizierte und anonyme Anfragen ausgeführt werden. Weisen Sie jedem Projekt auf einem gemeinsam genutzten Cluster eine eigene zu. Eine Datenbank zeichnet die Rolle auf, unter der sie ausgeführt wird, und ein Start, der für eine andere konfiguriert ist, verweigert den Start, bis `rebase db request-role migrate` die Migration durchführt. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` erstellt die Anfrage-Rolle und erlaubt der Verbindung, zu ihr zu wechseln; `never` überlässt beides Ihnen und überprüft sie lediglich. | `auto` |
| `REBASE_RLS_GRANTS` | Was Rebase der Anfrage-Rolle gewährt: `schema` (jede Tabelle in den Schemas, die es bedient, plus Standardberechtigungen), `managed` (nur die Tabellen, die es bedient) oder `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` beschränkt die permissiven Richtlinien von Rebase auf die Anfrage-Rolle(n), sodass andere Rollen, die dieselben Tabellen lesen, von diesen Richtlinien nicht profitieren. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` schreibt Richtlinien, die nur der Serverkontext oder ein Admin erfüllen kann, als `TO public` und führt Administratoren als Anfrage-Rolle aus. Standardmäßig lauten sie `TO rebase_admin`, sodass lesende Zugriffe angemeldeter Benutzer mit Owner-Scope den Owner-Index nutzen können. Siehe [Admin-Anfragen und `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` entfernt die Baseline-Richtlinie für Server oder Administratoren von jeder Tabelle. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` setzt zusätzlich `request.jwt.claims` und `request.jwt.claim.*`, sodass mit `auth.uid()` geschriebene Richtlinien den Aufrufer sehen. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Was beim Start geschieht, wenn ein anderes Login zur Anfrage-Rolle wechseln kann: `warn`, `refuse` oder `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Dem Client muss dasselbe mitgeteilt werden – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Liefert die statischen/Admin-Assets des Bundles von diesem Prozess aus. Deaktivieren Sie dies, wenn ein CDN davor geschaltet ist. | `true` |
| `REBASE_HISTORY` | Zeichnet den [Änderungsverlauf von Entitäten](/docs/backend/history) auf. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli-Antworten komprimieren. | `true` |
| `REBASE_PUSH` | `true` aktiviert [Push-Benachrichtigungen](/docs/backend/push-notifications/): die `/api/push`-Routen, die Tabelle `rebase.push_subscriptions` und `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Das VAPID-Schlüsselpaar, mit dem Push-Nachrichten signiert werden. Außerhalb der Produktion wird bei Fehlen ein Paar generiert und in `.rebase-dev-secrets.json` gespeichert; in der Produktion bleibt Push ohne diese Schlüssel deaktiviert. | — |
| `REBASE_VAPID_SUBJECT` | Eine `mailto:`-Adresse oder `https://`-URL, über die Push-Dienste Kontakt aufnehmen können. Standardmäßig die Origin einer HTTPS-basierten `REBASE_PUBLIC_URL`. | — |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body, **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verweigert den Start, anstatt das Limit stillschweigend aufzuheben). `0` schaltet das Limit ab. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände. Wenn nicht gesetzt (in jeder Umgebung): `/api/docs` wird den Aufrufern bereitgestellt, für die `GET /api/schema/tables` Tabellen beschreibt, jeweils für das Dokument der Tabellen, die ihnen beschrieben werden; es gibt keine Swagger-UI. `true` veröffentlicht das gesamte Dokument für alle, mit der Swagger-**UI** unter `/api/swagger` außerhalb der Produktion (niemals in der Produktion). `false` hält das Dokument hinter dem Admin-Gate. | — |
| `REBASE_METRICS` | Macht Prometheus-Metriken unter `/metrics` verfügbar. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt dem `Strict-Transport-Security`-Header `includeSubDomains` hinzu, sodass Browser für sechs Monate reines HTTP auf jeder Subdomain des Hosts verweigern – einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn jede Subdomain der Domain ausschließlich HTTPS verwendet. Jeder andere Wert als `true`/`false` verweigert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn nicht gesetzt, bleibt der Endpunkt für alles offen, was den Port erreichen kann – in einem privaten Netzwerk in Ordnung, in einem öffentlichen Netzwerk nicht, und die Startprotokolle weisen darauf hin. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Laufzeitumgebung beim Start am Schema der Tabellen ändern darf. `ensure` (der Standardwert, überall – einschließlich Produktion) führt den **additiven** Durchlauf aus: Fehlende Tabellen, Spalten und Enum-Typen erstellen, niemals eine löschen oder umschreiben. `none` lässt das Schema der deklarierten Tabellen unberührt, aber die framework-eigenen Tabellen (Auth, API-Schlüssel, Jobs, Cron) werden weiterhin erstellt und aktuell gehalten; `REBASE_PROVISION=false` schaltet auch diese ab. Das veröffentlichte Image akzeptiert nur diese beiden und **verweigert den Start bei `push`**. In einem [Split Deployment](/docs/deployment/split-processes) darf genau ein Prozess das Provisioning übernehmen, sodass jede andere Rolle `none` setzen muss oder den Start verweigert. | `ensure` |
| `REBASE_PROVISION` | `false` veranlasst die Laufzeitumgebung, nichts an ihrer Datenbank zu ändern: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Richtlinie, keine Rolle oder Berechtigung, weder beim Start noch später, einschließlich derjenigen des Frameworks selbst. Stattdessen wird namentlich gemeldet, was fehlt. Für eine Datenbank, die nur Ihr Änderungsprozess modifizieren darf. Siehe [Wenn nur Ihr Änderungsprozess die Datenbank modifizieren darf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Es werden nur `true` und `false` akzeptiert. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Verweigert den Start, wenn die Datenbank zuletzt aus einem anderen Tabellensatz bereitgestellt wurde, als aus dem dieser Prozess gebaut wurde. Wenn nicht gesetzt (oder bei einem anderen Wert als `true`/`1`), wird stattdessen gewarnt. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Verweigert den Start, wenn eine Funktions- oder Cron-Datei beim Importieren einen Fehler wirft oder nicht geparst werden kann, wobei jede Datei und der Grund genannt werden, sodass bei einem Rolling Deployment die alte Version weiter ausliefert. Ein Neustart ist ebenfalls daran gebunden. Wenn nicht gesetzt (oder bei einem anderen Wert als `true`), wird die Datei übersprungen und der Rest ausgeliefert. Eine Datei, die fehlerfrei importiert wird und keine Funktion oder keinen Job exportiert, wird immer übersprungen und nicht abgewiesen. | skip |
| `REALTIME_CDC` | Change Capture auf Datenbankebene: `auto` (Änderungen aus dem WAL lesen, wo die Datenbank es erlaubt, andernfalls Trigger verwenden, andernfalls Fallback auf Anwendungsebene, wobei jeder Fallback als Info protokolliert wird), `trigger` (erzwingen, warnen falls unmöglich), `wal` (Änderungen aus dem Write-Ahead-Log statt aus Triggern lesen; erfordert `wal_level=logical` und eine Rolle mit Replikationsberechtigung, fällt andernfalls auf `trigger` zurück), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Kanäle und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein konstruierter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Abonnements ein Realtime-Socket halten darf; das nächste wird mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Wie viele Realtime-Sockets ein Benutzer oder ein API-Schlüssel auf einer Serverinstanz offenhalten darf. Die imitierenden (impersonating) Sockets eines Administrators zählen zu Lasten des Administrators. Die Anmeldung des nächsten Sockets wird mit `TOO_MANY_SOCKETS` verweigert und der Socket geschlossen (4002); das SDK versucht es weiter, sodass es hineingelangt, sobald ein anderer schließt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Kein Limit |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Die maximale Zeit in ms, die eine Änderung auf den Refetch wartet, der sie an aktive Abonnenten übermittelt. Ein Refetch wartet 300 ms ohne Änderung und maximal diese Zeitspanne bei einem kontinuierlichen Schreibstrom. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Wie lange in ms die Gesamtzahl eines großen Listen-Abonnements wiederverwendet werden darf, bevor sie erneut gezählt wird; Frames, die sie wiederverwenden, tragen `meta.totalAsOf`. Wenn nicht gesetzt, zählt jeder Frame. Hat Vorrang vor `realtime.recountIntervalMs`. | Nicht gesetzt |
| `REALTIME_RECOUNT_MIN_ROWS` | Der kleinste letzte Gesamtwert, für den `REALTIME_RECOUNT_INTERVAL_MS` gilt; kleinere Listen werden in jedem Frame gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`- bzw. Loopback-Werte unter `NODE_ENV=production`. Standardmäßig deaktiviert, sodass ein Produktionsstart deutlich fehlschlägt, anstatt sich mit einer nicht vorhandenen Datenbank zu verbinden. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet sich, ohne einen Socket zu öffnen – die Form, die ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der nachfolgende Server. Erstellt auch die Tabellen, die ein ausliefernder Prozess sonst bei der ersten Verwendung erstellen würde, und startet weder Cron noch Job-Warteschlangen. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein normales Deployment nicht versehentlich in eines verwandeln kann, das migriert und die Auslieferung verweigert. In Kombination mit `REBASE_PROVISION=false` unzulässig. | — |
| `REBASE_PROVISION_SQL_OUT` | Ein Dateipfad. Ein Provisioning-Lauf (`REBASE_PROVISION_ONLY=true`) schreibt jede vorgenommene Schemaänderung in der Reihenfolge als SQL-Skript dorthin, um sie zu überprüfen und mit `psql` anzuwenden. Geschriebene Zeilen sind nicht enthalten. Auf einem Prozess, der Requests bedient, nicht zulässig. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt einer Maschine – einem Agenten, einem CI-Job –, eine Schemaänderung über `/api/admin/schema` tatsächlich *anzuwenden*, nicht nur zu planen. Standardmäßig aus: Die Berechtigung, die eine solche Änderung vornehmen könnte, liegt am ehesten in einer CI-Variable. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Wie lange eine benutzerdefinierte Funktion ausgeführt werden darf, bevor ihre Anfrage abgebrochen wird. Derselbe Schalter wie die Option `functionsTimeoutMs`. `0` deaktiviert das Limit. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` führt dazu, dass eine unbehandelte Promise-Rejection den Prozess beendet, anstatt sie nur zu protokollieren. Aktiviert unter einem Orchestrator, der den Prozess neu startet; deaktiviert dort, wo ein Neustart schlimmer ist als ein Leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Unterdrückt die Startwarnung auf einer Plattform, die von der Laufzeitumgebung als Scale-to-Zero erkannt wird, auf der ein Timer, der in einer inaktiven Instanz ausgelöst wird, in keiner Instanz ausgeführt wird. Ändert sonst nichts: Setzen Sie dies, wenn Sie mindestens eine Instanz dauerhaft am Laufen halten. | — |
| `TRUSTED_PROXY_HOPS` | Wie viele Proxys vor diesem Server geschaltet sind, damit der Rate-Limiter die echte Client-Adresse aus `X-Forwarded-For` lesen kann. Ausfallsicherer Standardwert `0`: Ohne Proxy würde das Vertrauen in den Header jedem Aufrufer das Fälschen einer Identität ermöglichen. | `0` |

:::note[Boot-Provisioning ist additiv und kein Migrationswerkzeug]
Der Startdurchlauf erfolgt unbeaufsichtigt, ohne dass jemand ein Diff prüft. Daher wird
er niemals eine Spalte löschen, einen Typ einschränken oder eine Tabelle umschreiben. Aus
diesem Grund verweigert das Image auch `REBASE_MIGRATE_ON_BOOT=push`: Ein vollständiger
Push berechnet ein Diff und würde ohne Weiteres ein `DROP COLUMN` ausführen – und ein
Container-Neustart darf niemals als Nebeneffekt einer Neuplanung eine Produktionsspalte
zerstören können.

Destruktive oder umstrukturierende Änderungen bleiben dort, wo sie überprüft werden können:
`rebase db generate` + `rebase db migrate` oder `rebase db push` aus einem Checkout oder CI,
was die Änderung im Testlauf (Dry Run) ausführt, destruktive Änderungen ohne Bestätigung
verweigert und zuvor ein Backup erstellen kann.
:::

### Split Deployments

Ein Image und ein Bundle können mehrfach gestartet werden, wobei jede Instanz einen
anderen Teil des Projekts bedient. Hier jeweils eine Zeile, da diese Seite den
Anspruch erhebt, jede Variable aufzulisten; was jede Kombination *einbindet und verwaltet* –
und welche Kombinationen den Start verweigern –, erfahren Sie unter
**[Aufgeteilte Prozesse](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Wenn nicht gesetzt, folgt er der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Wenn nicht gesetzt, folgt er der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | Bedient in diesem Prozess nur die benannten benutzerdefinierten Funktionen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Bedient jede benutzerdefinierte Funktion mit Ausnahme der benannten. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. Auf einem `worker`, wohin seine eigenen `rebase.functions`-Aufrufe gehen. Eine `http(s)`-URL. | — |

### MCP-Oberfläche

Ein optionaler Model Context Protocol-Endpunkt unter `/mcp`, sodass ein KI-Client dieses
Projekt **als angemeldeter Benutzer** lesen und schreiben kann. Standardmäßig deaktiviert, und –
anders als bei jeder anderen Oberfläche – schaltet keine `REBASE_ROLE` diesen ein: Die anderen
beschreiben eine Prozessform, während dies eine Entscheidung ist, Anmeldeinformationen an
Drittanbieter-Software zu übergeben, die von einer Person getroffen werden sollte, anstatt von
der Aufgabenbezeichnung eines Containers geerbt zu werden.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Bindet die MCP-Oberfläche ein. Erfordert `REBASE_PUBLIC_URL`; ohne diese wird die Einbindung verweigert und im Startprotokoll darauf hingewiesen. | `false` |
| `REBASE_PUBLIC_URL` | Die extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Oberfläche kann diese nicht ableiten – die Übernahme der Origin aus dem `Host`-Header würde die Identität des Ausstellers und die Zielgruppe (Audience), gegen die eigene Tokens geprüft werden, zu einem vom Aufrufer bereitgestellten Wert machen. | — |
| `REBASE_MCP_VIEW` | Pfad zur projekteigenen MCP-App-Ansicht (`rebase-view.html`, generiert durch `rebaseMcpViewPlugin()`), die Claude anstelle der generischen Ansicht bereitgestellt wird, sodass Ihre benutzerdefinierten Ansichten, Felder und Aktionen gerendert werden. Ohne diesen Pfad sucht das Backend neben dem von ihm bereitgestellten Frontend. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Erlaubt OAuth Dynamic Client Registration (RFC 7591), sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um eine vorherige Registrierung von Clients zu erzwingen. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Deaktiviert, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes Bundle
besitzt keinen `backend/schema`-Quellcode zum Bearbeiten; wenn diese Variablen gesetzt sind,
liest der Schema-Editor den Quellcode aus dem Repository, committet jede Änderung zurück
und führt deren DDL auf dieser Datenbank aus. Nur für Admins und von einer Person angewendet,
es sei denn, `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` gibt etwas anderes vor. Ein angegebenes
Repository ohne verwendbare Zugangsdaten verweigert den Start. Siehe
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository, in das Schema-Änderungen committet werden sollen, als `owner/name`. Das Setzen dieser Variablen aktiviert das Feature. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, auf dem der Commit landet. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Wo `backend/schema` in diesem Repository liegt, relativ zum Repo. Ein Pfad, der das Repository verlässt, verweigert den Start, ebenso wie das entfernte `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein fein abgestimmtes Token mit Lese- und Schreibzugriff auf die Inhalte des Repositorys. Setzen Sie entweder dies oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub App, um als App statt mit einem Token zu committen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installation der App auf dem Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit maskierten Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Nicht gesetzt bedeutet, dass geplante Backups deaktiviert sind. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- / `gs://bucket/prefix`-URL. Erforderlich zusammen mit `BACKUP_SCHEDULE`, das ohne diesen Wert die Ausführung verweigert. `rebase db backup` fällt auf `./backups` an dem Ort zurück, an dem es ausgeführt wurde. | — |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Nicht gesetzt oder `0` behält alles. | — |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens N der neuesten Backups aufbewahren, unabhängig von der Aufbewahrungsfrist. | — |
| `PG_DUMP_PATH` | Überschreibt die `pg_dump`-Binärdatei – sie muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Überschreibt die `pg_restore`-Binärdatei. | — |
| `PSQL_PATH` | Überschreibt die `psql`-Binärdatei, die von `rebase db restore --clean` ausgeführt wird, um die Wiederherstellung in einer einzigen Transaktion abzuwickeln. | — |
| `PG_DUMPALL_PATH` | Speicherort von `pg_dumpall`, wenn es sich nicht im `PATH` befindet. Ohne diese Angabe – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Laufzeit-Image (`rebasepro/server`) liefert die PostgreSQL 18-Client-Tools
mit, sodass ein geplantes Backup darin gegen jeden Server bis einschließlich Postgres 18
läuft. Außerhalb des Images installieren Sie diese selbst (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups enthalten Geheimnisse und personenbezogene Daten (PII). Verwenden Sie ein privates
Ziel mit Verschlüsselung im Ruhezustand (Encryption at Rest).

### Bundle-Bereitstellung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Laufzeitumgebung
ruft beim Start ein Bundle ab. Diese Variablen entscheiden, welches und wie.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Von wo das Bundle-Archiv abgerufen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Die Bearer-Zugangsberechtigung für diesen Abruf. Behandeln Sie dies als Geheimnis: Es autorisiert einen Mandanten, seinen eigenen Code herunterzuladen. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Wohin ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und die Zeitspanne zwischen Abruf und Start überstehen. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Laufzeit-Image dem Bundle über die selbst deklarierten hinaus bereitstellt. | — |

### Ressourcen-Bindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `backend/resources.ts` deklariert,
wird durch nach ihnen benannte Umgebungsvariablen gebunden. Die Basisnamen finden Sie unten;
eine nicht standardmäßige Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an, sodass
ein Bucket namens `media` `S3_BUCKET__MEDIA` liest. `rebase status` gibt pro Ressource
die genaue Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, sofern es sich nicht um den Standard-Postgres-Treiber handelt. Mit Suffix pro Quelle: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Mit Suffix pro Topic. | — |

### Die Umgebung der CLI selbst

Wird von `rebase` gelesen, nicht vom Server. Nichts hiervon wirkt sich auf ein Deployment aus.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Wohin `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service-Schlüssel senden, in der Shell oder in `.env`. Setzen Sie diesen Wert, wenn der Server auf andere Weise als über `rebase dev` in diesem Projekt ausgeführt wird: `rebase start`, ein Container, ein anderer Host. Wenn nicht gesetzt, verwenden sie den Server, den `rebase dev` während seiner Laufzeit aufgezeichnet hat, und senden nichts, wenn er nicht läuft. | — |
| `REBASE_SERVICE_KEY` | Der Service-Schlüssel, mit dem sich diese Befehle authentifizieren, gelesen aus `.env`: dieselbe Variable, die der Server liest (siehe oben). | — |
| `SERVICE_KEY` | Ein älterer Name für diesen Schlüssel. Wenn `.env` ihn setzt, lesen `rebase api-keys` und `rebase storage` ihn anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env`-Datei die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_ROOT_RULES` | `0` verhindert, dass `rebase init` und `rebase skills install` die Regeln des Projekts in `CLAUDE.md` und `AGENTS.md` im Repository-Root schreiben – nützlich für ein Root-Verzeichnis, dessen Agenten-Dateien Sie manuell pflegen. | on |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, unter dem sich `rebase cloud login` anmeldet, anstatt danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Dessen Passwort, sodass ein Secret-Store es übergeben kann, ohne dass es in den Shell-Verlauf gelangt. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der Sitzung aus `rebase cloud login` und liest oder schreibt die gespeicherte Sitzung niemals. In einem Verzeichnis, das durch `rebase cloud init --claim` verknüpft wurde, wird es für das eigene Token dieses Projekts beiseite gelegt, wenn es keinen Scope für das Projekt besitzt. Die Methode zur Ausführung von `rebase cloud` in CI – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) übergibt es an die CLI, die seine Cloud-Tools starten, und sendet es niemals an die App: Setzen Sie dafür `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt den zugrunde liegenden Fehler und Anfragedetails anstelle der Kurznachricht aus. Die erste Maßnahme, wenn ein `rebase cloud`-Befehl ohne hilfreiche Meldung fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Leere Dev-Datenbank für `db push` und `db generate`. Der Name bleibt für bestehende Projekte erhalten. Rebase verwaltet eine hier angegebene Datenbank nicht und verweigert die Ziel-URL. Verwaltetes PGlite erhält eine flüchtige In-Memory-Datenbank. Verwenden Sie dies ohne `CREATE DATABASE`; `db migrate` braucht sie nicht. | `<db>_dev_diff` |
| `PTAH_TRUST_REPLAY_SQL` | Bei externem PostgreSQL, auch einem lokalen Docker-Compose-Dienst, kann Ptah für `db push`, `db push --dry-run` und `db generate` SQL wiedergeben. Setzen Sie `PTAH_DEV_SERVER_DISPOSABLE=1` nur für einen vollständig verwerfbaren Dev-Server. Auf einem gemeinsam genutzten Server erlaubt `PTAH_TRUST_REPLAY_SQL=1` die Wiedergabe mit den Rechten der Dev-Verbindung. Setzen Sie es nur für SQL, dem Sie vertrauen. Verwaltetes PGlite ist bereits verwerfbar. | — |
| `PTAH_DEV_SERVER_DISPOSABLE` | Nur auf `1` setzen, wenn der gesamte Entwicklungsserver verworfen werden kann. Rebase setzt dies für seinen verwalteten PGlite-Entwicklungsserver automatisch. | nicht gesetzt |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und stellt nichts bereit – Sie bringen Ihre eigene mit. Identisch mit `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Legt den Port des Frontend-Dev-Servers fest, den `rebase dev` andernfalls aus dem Projektpfad ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` darauf wartet, dass sich das Backend meldet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert die Meldung. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in den aus `docker-compose.yml` abgeleiteten Verbindungsstring einfügt. | — |
| `DO_NOT_TRACK` | Die toolübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe, speziell für Rebase. Benötigt keine Datei, weshalb dies die bevorzugte Variable für CI und in Images ist. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Wohin Telemetriedaten gesendet werden, für einen selbst gehosteten Collector. | — |

## Secrets in der Entwicklung

`JWT_SECRET` ist in der Produktion erforderlich. Dieser Schlüssel und `REBASE_SERVICE_KEY` werden
außerhalb davon automatisch für Sie generiert, sodass Sie starten können, ohne etwas einrichten zu müssen.

Diese generierten Werte werden in `.rebase-dev-secrets.json` zwischengespeichert, neben
`.rebase-dev-port` und `.rebase-dev-url`, und zusammen mit diesen ignoriert (gitignored). Zuvor
wurden sie bei jedem Start neu generiert – ein Neustart des Dev-Servers meldete Sie daher von
Ihrer eigenen App ab und machte jeden gerade erstellten API-Schlüssel ungültig.

- Wenn Sie eine der Variablen explizit festlegen, wird Ihr Wert verwendet; es wird nichts zwischengespeichert oder gelesen.
- Verweisen Sie den Cache mit `REBASE_DEV_SECRETS_FILE` an einen anderen Ort – ein Pfad und die
  einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets zu rotieren. Beim nächsten Start wird eine neue Datei geschrieben.
- Wenn die Datei nicht geschrieben werden kann – beispielsweise in einem schreibgeschützten Container –, startet der Server trotzdem mit einem flüchtigen Secret, genau wie zuvor.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion
wird auch nichts generiert: Ein Start ohne `JWT_SECRET` schlägt unter Nennung der Variable fehl,
und das ist unverändert:

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

Dieselben Optionen, ohne `app`, `server` und `basePath` und mit einem erforderlichen `provision`,
erstellen ein Backend, das nichts bedient, bis Sie es mounten: `createRebaseBackend`. Siehe
[Benutzerdefinierte Server-Integration](/docs/backend/custom-server/).

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

Das Admin-Panel übernimmt dies von dem Client, der ihm übergeben wird; es muss nichts weiter
konfiguriert werden. Wenn Sie eine Request-URL manuell erstellen, fügen Sie sie über den Client
zusammen, anstatt `/api` selbst zu schreiben:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### Keine Berechtigung im SQL-Editor (`permission denied for table <name>`)

* **Symptome:** Benutzerdefinierte Abfragen, die im SQL-Editor von Rebase Studio ausgeführt werden, schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellenkalkulations-CMS-Ansicht Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, SQL-Editor-Abfragen auszuführen, indem die Datenbankrollen vorübergehend gewechselt werden, um der Anwendungsrolle des aktiven Benutzers zu entsprechen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen und nicht als tatsächliche PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer des Verbindungsinhabers ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase dazu, SQL-Editor-Abfragen mit den Berechtigungen des Verbindungsinhabers auszuführen (in der Regel ein Superuser/Owner). Der SQL-Editor zeigt dann über den Ergebnissen an, dass diese als Verbindungsinhaber gelesen wurden, und blendet die Rollenauswahl aus.

### Schema-Abruf im SQL-Editor fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden, oder der SQL-Editor gibt `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.` aus.
* **Ursache:** Rebase benötigt administrative Berechtigungen, um Datenbank-Systemkataloge abzufragen und administrative Befehle auszuführen. Wenn `adminConnectionString` dem Bootstrapper nicht bereitgestellt wird oder `getAdmin()` so überschrieben wird, dass es `undefined` zurückgibt, schlagen diese Operationen fehl.
* **Lösung:** Stellen Sie sicher, dass `adminConnectionString` während der Initialisierung des Backend-Bootstrappers konfiguriert ist:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Nächste Schritte

- **[Deployment](/docs/getting-started/deployment)** – Leitfaden für das Produktions-Deployment
- **[Backend-Übersicht](/docs/backend)** – Vollständige Referenz zur Backend-Konfiguration

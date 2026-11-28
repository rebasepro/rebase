---
sourceHash: dae0d9a7e36f01c4
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Environment Variables

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projektstammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> ein erforderlicher Wert fehlt oder fehlerhaft formatiert ist (eine URL, die keine URL ist, ein Port,
> der keine Zahl ist), verweigert der Server den Start und nennt die betreffende Variable.
>
> Wo das Schema liegt, hängt davon ab, wie Sie das Backend ausführen. Ein von der
> Runtime gestartetes Projekt — `rebase dev`, `rebase start`, das veröffentlichte Image — verwendet das
> Schema, das der Runtime gehört (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, bei dem [`rebase eject`](/docs/cli)
> ausgeführt wurde, besitzt eine `backend/src/env.ts`, die `loadEnv({ extend })` aufruft, und kann dort
> eigene typisierte Variablen hinzufügen.

### Required

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **In der Entwicklung optional** — falls nicht gesetzt, führt `rebase dev` ein verwaltetes PostgreSQL für das Projekt aus, dessen Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mindestens 32 Zeichen). **In der Produktion erforderlich** (in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **Bei einer Managed Database bedeutet `sslmode=require` möglicherweise nicht das, wonach es aussieht.**
>
> Für `psql` und jedes libpq-Tool bedeutet `require` „verschlüsselt, Zertifikat nicht
> überprüft“. Der Node-Treiber, auf dem Rebase läuft, interpretiert dies als `verify-full`. Eine
> Datenbank, deren Zertifikat nicht von einer öffentlichen Zertifizierungsstelle signiert wurde — was bei Managed
> Postgres häufig vorkommt —, lehnt die Runtime mit `self-signed certificate` ab, während sich `psql`
> mit derselben URL problemlos verbindet. Die Runtime und `rebase db`-Befehle brechen mit einer
> entsprechenden Meldung ab.
>
> Wählen Sie eine der Optionen:
>
> - **`sslmode=no-verify`** — verschlüsselt, nicht überprüft: was `require` für
>   libpq bedeutet. Dies ist eine Schreibweise von node-postgres, die libpq nicht kennt, weshalb `psql`, `pg_dump`
>   und Atlas sie mit `invalid sslmode value: "no-verify"` ablehnen. Die Rebase-eigenen
>   Befehle (`rebase db push`, `rebase db backup`, `rebase db restore`) übergeben es
>   an diese als `sslmode=require`, sodass sie mit der konfigurierten URL funktionieren; für
>   manuelles `psql` ersetzen Sie es durch `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — anhand des CA-Zertifikats
>   des Anbieters überprüft. Identisch für jedes Tool.
>
> `uselibpqcompat=true&sslmode=require`, was die Warnung des Node-Treibers selbst
> vorschlägt, funktioniert auch für die Runtime; die Befehle von Rebase entfernen `uselibpqcompat`,
> bevor sie die URL an libpq-Tools übergeben, die sie sonst ablehnen würden.

### Frontend

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** — siehe unten. | Seitenursprung |
| `VITE_GOOGLE_CLIENT_ID` | Google-OAuth-Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, daher injectet der
> Dev-Server diesen Wert. In der Produktion liefert das Rebase-Backend die SPA aus, sodass die
> API der Origin der Seite selbst ist und der Client dies automatisch so auflöst.
>
> Das Einbetten einer absoluten URL in ein Produktions-Bundle funktioniert genau so lange, bis ein zweiter
> Hostname auf dieselbe App verweist: Eine benutzerdefinierte Domain lädt die Seite dann von
> `example.com` und ruft die API unter `example.rebase.website` auf. Das ist
> Cross-Origin, weshalb jeder Request beim Preflight fehlschlägt. Den Origin in CORS zu erlauben,
> behebt dies **nicht** — das Refresh-Cookie ist `SameSite=Lax` und wird nicht
> cross-site gesendet. Sie würden also lediglich die Konsolenfehler beseitigen, hätten aber immer noch eine defekte
> Authentifizierung. Wenn der Wert nicht gesetzt ist, funktioniert jede Domain, die auf die App verweist,
> völlig ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **ausschließlich aus der Shell-Umgebung** — ein `PORT` in `.env` wird dort nicht gelesen, da der Port aufgelöst wird, bevor diese Datei geladen wird — und bindet andernfalls einen vom Projektpfad abgeleiteten Port, sodass mehrere Projekte gleichzeitig ausgeführt werden können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner gibt an, welcher Wert verwendet wurde. | `3001` |
| `LOG_LEVEL` | Logging-Detaillierungsgrad: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer Zeile wie `Failed query: [redacted]` an. Jedes fehlschlagende Statement wird standardmäßig geschwärzt, da eine fehlgeschlagene Abfrage gebundene Parameter enthalten kann — eine E-Mail-Adresse, einen Passwort-Hash. Setzen Sie dies auf `true`, wenn Sie einen DDL-, RLS- oder Change-Capture-Fehler diagnostizieren. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste der zulässigen Origins. **In der Produktion erforderlich**, es sei denn, `FRONTEND_URL` ist gesetzt: Ein Produktionsstart ohne beides schlägt fehl. In der Entwicklung wird sie zu localhost *hinzugefügt* — siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu CORS_ORIGINS verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (wird für Schema-Introspektion und Admin-Operationen verwendet). Die darin angegebene Datenbank ist weder diejenige, die von der SQL-Konsole als aktuell betrachtet wird, noch diejenige, von der ein neuer Branch standardmäßig kopiert wird: Beides ist die Datenbank, auf der die Verbindung der App selbst liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert den PostgreSQL-Rollenwechsel im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Die SQL-Konsole von Studio meldet dann, dass die Zeilen als Verbindungseigentümer gelesen wurden, nennt diesen und deaktiviert die Rollenauswahl. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies bei einem Checkout, der [zu einem Branch gewechselt wurde](/docs/backend/branching/#cli-integration). Ein damit konfigurierter Server behält die Branch-Registrierung auf dieser Datenbank und kopiert neue Branches standardmäßig von dort, sodass der Branches-Bereich von Studio die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

In der Entwicklung sind **localhost sowie alle in `CORS_ORIGINS` (oder `FRONTEND_URL`)
genannten Origins** erlaubt — dieselbe Liste, die auch in der Produktion verwendet wird, wobei
localhost hinzugefügt statt ersetzt wird. Die Variable funktioniert also in beiden Umgebungen gleich,
und die Fälle, in denen sie in der Entwicklung benötigt wird, sind die üblichen:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Ein Origin, der weder localhost noch aufgeführt ist, wird abgewiesen, und die Ablehnung wird
**einmal pro Origin** mit der genauen Zeile protokolliert, die ihn zulassen würde. Diese Verweigerung
ist keine übertriebene Vorsicht: Da die API Anmeldeinformationen (Credentials) sendet, würde das Reflektieren
eines beliebigen `Origin` dazu führen, dass jede Website, die der Entwickler zufällig besucht,
mit dessen Sitzung authentifizierte Anfragen an den Dev-Server senden und die Antworten lesen könnte.

### Authentication

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `JWT_SECRET` | Geheimnis für die JWT-Signierung (in Produktion erforderlich, in Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Access-Tokens (RS256), sodass jede Instanz mit Zugriff auf das JWKS eine Session verifizieren kann, ohne selbst eine erstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEMs. Ohne diesen Schlüssel bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie diesen Wert immer, wenn sich der Schlüssel ändert — die Rotation erfordert, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access-Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens. Gleitend — jede Rotation verlängert sie, daher bestimmt dies, wie lange eine Session bei **Inaktivität** bestehen bleibt. Setzen Sie `400d` für Sessions, die auch längere Abwesenheiten überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Erlaubt neuen Benutzern die Registrierung (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung — eine leere Benutzertabelle muss jemanden zulassen, und dieser wird zum Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Zeitfenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein über die offene Registrierung erstelltes erstes Konto ist ein normales Konto, und der Administrator wird über `REBASE_ADMIN_EMAIL` (unten) angegeben oder mit dem Service-Key zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standardwert des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Not-Aus-Schalter (Kill Switch). Schließt das Bootstrap-Fenster für den ersten Benutzer, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank geschlossen bleibt. Verwenden Sie dies zusammen mit `REBASE_ADMIN_EMAIL` (unten), da das Deployment sonst keine Möglichkeit hat, seinen ersten angemeldeten Aufrufer zu erstellen. Jedes ausgelieferte Deployment-Artefakt setzt diesen Wert. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail-Adresse des ersten Admin-Kontos, das beim Start erstellt wird, **solange die Benutzertabelle noch leer ist**, und niemals danach. So erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt mit dem Internet darum zu konkurrieren. Beim Start wird gewarnt, wenn die Tabelle in der Produktion leer und dieser Wert nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Secret. Falls nicht gesetzt, werden die Secrets stattdessen mit `JWT_SECRET` verschlüsselt und beim Start wird einmalig gewarnt — eine Rotation von `JWT_SECRET` würde somit alle Benutzer abmelden *und* jeden registrierten Authenticator unentschlüsselbar machen. Legen Sie einen dedizierten Schlüssel fest (32+ Zufallszeichen), bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, der abgelöst werden soll (*rotated away from*). Setzen Sie während einer Rotation beide: Neue Secrets werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende bleiben lesbar, sodass niemand während der Rotation aus dem eigenen Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Secret neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Aktiviert die anonyme Anmeldung (`POST /api/auth/anonymous`). Opt-in und bewusst nicht an `ALLOW_REGISTRATION` gekoppelt. | `false` |
| `AUTH_REQUIRE` | Erfordert Authentifizierung für die Daten-API. Auf `false` setzen für eine vollständig öffentliche Leseoberfläche — RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Bindet `POST /api/auth/find-user` ein, das eine E-Mail-Adresse für Einladungsabläufe in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) auflöst. Nur für authentifizierte Aufrufer; gibt niemals die E-Mail-Adresse, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: stellt eine Angriffsfläche für Aufzählung (Enumeration) dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` für das Refresh-Cookie: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` für das Refresh-Cookie. Standardmäßig aktiviert (true); `AUTH_COOKIE_SECURE=false` für reines HTTP — ein Deployment auf einer LAN-Adresse, bei dem der Browser das Cookie andernfalls verwerfen würde und die Session beim Ablauf des Access-Tokens ohne Fehlermeldung beendet würde. Gibt beim Start eine Warnung aus. `http://localhost` benötigt dies nicht. | `true` |
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
| `GITLAB_CLIENT_ID` | GitLab-OAuth-Client-ID. Die `baseUrl` einer selbst gehosteten Instanz hat keine Entsprechung als Umgebungsvariable — konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab-OAuth-Client-Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket-OAuth-Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket-OAuth-Client-Secret | — |
| `SLACK_CLIENT_ID` | Slack-OAuth-Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack-OAuth-Client-Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify-OAuth-Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify-OAuth-Client-Secret | — |
| `APPLE_CLIENT_ID` | Apple Services ID für die Web-Anmeldung. Sie ist öffentlich und wird in `GET /auth/config` veröffentlicht. Apple hat kein statisches Client-Secret, da Rebase für jeden Token-Austausch ein kurzlebiges ES256-JWT signiert. Daher benötigt Apple `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` sowie diesen Wert oder `APPLE_BUNDLE_IDS` und konfiguriert ohne diese Angaben nichts. | — |
| `APPLE_BUNDLE_IDS` | Kommagetrennte Bundle-IDs der nativen iOS/macOS-Apps, deren „Mit Apple anmelden“-Codes akzeptiert werden. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, der Aussteller (Issuer) des JWT. | — |
| `APPLE_KEY_ID` | Key-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten Schlüsseldatei (`.p8`), einschließlich aller Zeilenumbrüche (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Der öffentliche Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deployment und er enthält keine Geheimnisse. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` ermöglicht er dem Admin-Gate, ein Plattform-Token für `cron:read` zu akzeptieren — und für nichts anderes. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, mit der der `aud`-Wert eines Plattform-Tokens übereinstimmen muss, damit ein für ein anderes Projekt erstelltes Token abgewiesen wird. Wenn nur eine der beiden Variablen gesetzt ist, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Wohin **Continue with Rebase Cloud** im Admin-Panel führt: die Projektseite in der Konsole der Plattform, die die Eigentümer des Projekts anmeldet und zurückkehrt. Die Plattform setzt dies beim Deployment zusammen mit den beiden oben genannten Werten; damit akzeptiert `POST /api/auth/platform-signin` das einminütige `auth:admin-signin`-Token der Plattform und öffnet eine Admin-Sitzung. Ohne diesen Wert funktioniert der Zugang weiterhin über **Open CMS** in der Konsole, und der Anmeldebildschirm erklärt dies lediglich. | — |
| `REBASE_RATE_LIMIT_STORE` | Wo die Rate-Limit-Zähler gespeichert werden, für die Auth-Routen und für `rateLimit` in benutzerdefinierten Funktionen: `memory` (prozessbezogen) oder `sql` (über Replikate hinweg geteilt). Ein Prozess kann die Anzahl seiner Replikate nicht sehen, daher muss ein Deployment mit mehreren Instanzen dies angeben — drei Replikate beim Standardwert erzwingen das dreifache Limit. Jeder andere Wert **verhindert den Start**, anstatt auf einen Standardwert zurückzufallen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Bindet den passwortlosen Anmeldelink-Flow (Magic Link) ein. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Bindet die passwortlose Anmeldung mit einem per E-Mail gesendeten sechsstelligen Code ein. Dieselbe E-Mail-Anforderung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Anfrage per Magic Link oder E-Mail-Code für eine unbekannte Adresse erstellt das Konto, sofern die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten bei der erneuten Verwendung eines Refresh-Tokens nach Ablauf des Wiederverwendungsfensters: `reject` (Token ablehnen, Session beibehalten) oder `revoke-session` (Anmeldung beenden). Jeder andere Wert lässt den Start fehlschlagen. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Bestätigung vor Registrierung: Keine Passwort-Anmeldung, bis die E-Mail-Adresse verifiziert wurde. Erfordert E-Mail-Konfiguration; der Start wird andernfalls verweigert. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert die Captcha-Verifizierung für Auth-Routen: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig verwendet wird, um das vom Browser gesendete Token zu überprüfen. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Auth-Routen, die geschützt werden sollen (z. B. `register,login`). Nicht gesetzt schützt den Standard-Satz des Anbieters. | — |

### Storage

:::caution[Storage verfügt über keine Row-Level Security und benötigt daher ein Zugriffsmodell]
Tabellen werden durch Postgres RLS geschützt. Objektspeicher hat kein Äquivalent —
Schlüssel teilen sich einen einzigen flachen Namensraum —, weshalb der Server **in der Produktion den Start verweigert**,
wenn ein Bucket konfiguriert ist, aber kein Zugriffsmodell existiert. Erfüllen Sie diese Anforderung mit genau einer der folgenden Optionen:
einem aus `backend/storage.ts` exportierten `storageAuthorize`-Hook (Standard im Scaffold),
`STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `STORAGE_TYPE` | Storage-Backend: `local`, `s3`, `gcs` oder `platform` (Dateien in einem Präfix, das der Hosting-Plattform gehört, übertragen über URLs, die ihr Storage-Broker signiert; von der Plattform gesetzt). In der Produktion deaktiviert `local` den Storage, es sei denn, `FORCE_LOCAL_STORAGE=true` ist gesetzt | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird von dem Verzeichnis aus gelesen, in dem der Server läuft: das Projektstammverzeichnis unter `rebase dev`, `backend/` bei einem durch `rebase eject` erstellten Server | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Erlaubt lokalen Speicher in der Produktion — nur mit einem persistenten Volume, das `STORAGE_PATH` und die danebenliegenden `<STORAGE_PATH>__<key>`-Verzeichnisse benannter lokaler Buckets enthält | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Sekunden, die die Download-URL einer privaten Datei gültig ist — das Token, das `getSignedUrl()` darin einfügt. Maximal `604800` (eine Woche) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maximale Dateigröße, die die Quelle akzeptiert, in Bytes, auf jedem Upload-Pfad — `__<KEY>` für eine benannte Quelle. Ein Wert, der keine ganze Zahl von Bytes ist, verweigert den Start | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS-Access-Key | — |
| `S3_SECRET_ACCESS_KEY` | AWS-Secret-Key | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 usw.) | — |
| `S3_FORCE_PATH_STYLE` | Erzwingt Path-Style-URLs für den S3-Bucket (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldeinformationen abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldeinformationen bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Liefert jedes Objekt für jeden ohne Token aus. Nur für Buckets, die tatsächlich als öffentliches CDN dienen. Eine der Möglichkeiten, die obige Startprüfung zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Erlaubt jedem angemeldeten Benutzer, jedes Objekt zu lesen, zu schreiben, aufzulisten und zu löschen. Im Konfigurationsobjekt aus gutem Grund als `INSECURE` benannt: nur in einer Single-Tenant-App vertretbar, in der jedem Account bezüglich jeder Datei vertraut wird. | `false` |
| `STORAGE_POLICIES` | Speicherzugriffsregeln als JSON: `[{ "path", "operations"?, "allow" }]`, wobei `allow` den Wert `"public"`, `"authenticated"`, `"owner"` oder `{ "roles": [...] }` annehmen kann. Standardmäßig verweigert (Deny by default) und erfüllt die Startprüfung. Eine ungültige Liste verweigert den Start. Siehe [Storage-Autorisierung](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | Der Storage-Broker der Plattform für `STORAGE_TYPE=platform`. Wird von der Plattform festgelegt, die den Broker betreibt. | — |
| `STORAGE_BROKER_PROJECT` | Die Projekt-ID, auf die der Broker die Dateien dieses Deployments beschränkt, für `STORAGE_TYPE=platform`. Wird von der Plattform festgelegt. | — |
| `STORAGE_RENDITION_CACHE` | Generierte Bildversionen (Größenanpassungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu generieren. | `false` |

### Email (Optional)
`MAGIC_LINK_URL`.

| Variable | Beschreibung |
|----------|--------------|
| `SMTP_HOST` | SMTP-Server-Host |
| `SMTP_PORT` | SMTP-Server-Port |
| `SMTP_SECURE` | Sichere Verbindung aktivieren (`true`/`false`) |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | Absenderadresse für System-E-Mails |
| `SMTP_NAME` | Anzeigename der Absenderadresse |
| `APP_NAME` | Produktname, der in E-Mail-Betreffzeilen und Texten verwendet wird (Standard: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo, das oben in den Standard-E-Mail-Vorlagen angezeigt wird. Absolute `http(s)`-PNG- oder JPG-URL — E-Mail-Clients entfernen SVGs und blockieren `data:`-URIs. Wenn nicht gesetzt, erhält eine App, die noch `Rebase` heißt, das Rebase-Logo, und eine umbenannte App keines |
| `MAGIC_LINK_URL` | Wohin ein per E-Mail gesendeter Magic Link führt. An eine Basis wird `/auth/magic-link?token=…` angehängt; eine URL, die `{token}` enthält, ist der vollständige Link für ein Frontend, das `/auth/magic-link` nicht bereitstellt. Setzen Sie sie in `.env` in Anführungszeichen, da ein nicht quotiertes `#` einen Kommentar einleitet: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Ein Wert mit einer Raute oder einem Dateipfad ohne `{token}` löst beim Start eine Warnung aus. Wenn nicht gesetzt, ist die Basis `FRONTEND_URL` |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `DB_POOL_MAX` | Maximale Anzahl gepoolter Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung gehalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine solche: `LISTEN`/`NOTIFY` übersteht keinen Transaktions-Pooler wie PgBouncer, und ohne sie werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, anstatt stillschweigend verloren zu gehen. Der [Job-Worker](/docs/backend/jobs) führt darüber auch sein Wake-up-`LISTEN` aus. Füllt das `directConnectionString` des Postgres-Adapters, wenn dieses nicht gesetzt ist. | — |
| `DATABASE_READ_URL` | Read-Replica, wie beispielsweise ein Hot Standby. Wenn hier ein anderer Server angegeben ist, werden authentifizierte Lesezugriffe (Listen, einzelne Zeilen, Counts, Aggregate) dort unter derselben Row-Level Security bedient; Schreibvorgänge, Anmeldungen, Realtime, Crons, Jobs, die SQL-Konsole und `rebase.sql` verbleiben auf der primären Datenbank. Ein Leser, der gerade geschrieben hat, liest für die Dauer von `REBASE_READ_STICKY_MS` von der primären Datenbank, und alle Benutzer tun dies, solange das Replikat um mehr als `REBASE_READ_MAX_LAG_MS` hinterherhinkt oder fehlschlägt. Füllt das `readConnectionString` des Postgres-Adapters, wenn dieses nicht gesetzt ist; bis einschließlich Version 0.28 wurde der Pool des Replikats geöffnet, aber nie daraus gelesen. | — |
| `REBASE_READ_STICKY_MS` | Dauer nach einem Schreibvorgang, für die Lesezugriffe desselben Benutzers an die primäre Datenbank geleitet werden, damit nach einem Speichern und anschließendem Auflisten die Änderungen sichtbar sind. Pro Serverinstanz. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Verzögerung des Replikats (Lag), ab der alle Lesezugriffe an die primäre Datenbank geleitet werden. | `1000` |
| `DATABASE_POOLED` | `true`, wenn `DATABASE_URL` über einen Pooler im Transaktionsmodus wie PgBouncer läuft. Der Pool sendet dann beim Verbindungsaufbau kein `search_path` oder `statement_timeout` (der Pooler würde diese ablehnen oder verwerfen) und setzt beides in jeder Transaktion; beim Start erhält die Datenbankrolle für Anweisungen außerhalb einer Transaktion einen Standard-`search_path` von `public`. `DATABASE_DIRECT_URL` wird dadurch erforderlich, und Realtime, das Wake-up des Job-Workers, Indexerstellungen, Branching und die SQL-Konsole verwenden diese. Die URL des Replikats wird ebenfalls als gepoolt angenommen. `DATABASE_POOLED__<KEY>` für eine andere Datenquelle. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was der jeweilige Pool angefordert hat. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server stillschweigend zu serialisieren. | — |

### Laufzeitverhalten

Wird von der Runtime gelesen — `rebase dev`, `rebase start` und das veröffentlichte
Server-Image. Ein Projekt, bei dem ein Eject durchgeführt wurde, steuert diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) aus, das Tabellen meldet, die ohne Policies bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime liefert keine Kopie mit, und ohne das Paket verweigert der Start mit Nennung des Pakets den Dienst. `false` deaktiviert den Scan auf diesem Prozess. | — |
| `REBASE_RLS_REQUEST_ROLE` | Die Postgres-Rolle, unter der authentifizierte und anonyme Anfragen ausgeführt werden. Weisen Sie jedem Projekt auf einem gemeinsam genutzten Cluster eine eigene Rolle zu. Eine Datenbank zeichnet die Rolle auf, unter der sie läuft, und ein Start mit einer abweichenden Konfiguration verweigert den Start, bis `rebase db request-role migrate` die Migration durchführt. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` erstellt die Request-Rolle und ermöglicht der Verbindung den Wechsel zu dieser; `never` überlässt beides Ihnen und überprüft sie lediglich. | `auto` |
| `REBASE_RLS_GRANTS` | Was Rebase der Request-Rolle gewährt: `schema` (jede Tabelle in den bereitgestellten Schemas plus Standardprivilegien), `managed` (nur die bereitgestellten Tabellen) oder `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` beschränkt die permissiven Policies von Rebase auf die Request-Rolle(n), sodass andere Rollen, die dieselben Tabellen lesen, keine Berechtigungen daraus erhalten. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` schreibt die Policies, die nur der Serverkontext oder ein Administrator passieren kann, mit `TO public` und führt Administratoren als Request-Rolle aus. Standardmäßig lauten sie `TO rebase_admin`, sodass eigentümerbezogene Lesezugriffe angemeldeter Benutzer den Eigentümer-Index nutzen können. Siehe [Admin-Anfragen und `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` entfernt die Server-oder-Admin-Basis-Policy von jeder Tabelle. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` setzt zusätzlich `request.jwt.claims` und `request.jwt.claim.*`, sodass mit `auth.uid()` geschriebene Policies den Aufrufer sehen. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Was beim Start geschieht, wenn ein anderes Login in die Request-Rolle wechseln kann: `warn`, `refuse` oder `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Dem Client muss dasselbe mitgeteilt werden — siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Statische/Admin-Assets des Bundles von diesem Prozess aus ausliefern. Deaktivieren, wenn ein CDN davor geschaltet ist. | `true` |
| `REBASE_STUDIO` | Das integrierte Admin-Panel unter `/_studio` bereitstellen, wenn dessen statisches Bundle verfügbar ist: die Tabellen eines Projekts als Collections, dessen Benutzer und Rollen und das Studio. Damit wird ein Projekt ohne Code verwaltet. Auf `false` setzen zum Deaktivieren. | `true` |
| `REBASE_STUDIO_DIR` | Verzeichnis, das das vorgefertigte Admin-Panel enthält, das unter `/_studio` bereitgestellt wird. Standardmäßig `/studio` im Container-Image. | `/studio` |
| `REBASE_HISTORY` | Zeichnet den [Entitäts-Änderungsverlauf](/docs/backend/history) auf. | `true` |
| `REBASE_COMPRESSION` | Antworten mit gzip/brotli komprimieren. | `true` |
| `REBASE_PUSH` | `true` aktiviert [Push-Benachrichtigungen](/docs/backend/push-notifications/): die `/api/push`-Routen, die Tabelle `rebase.push_subscriptions` und `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Das VAPID-Schlüsselpaar, mit dem Push-Nachrichten signiert werden. Außerhalb der Produktion wird bei Fehlen ein Paar generiert und in `.rebase-dev-secrets.json` gespeichert; in der Produktion bleibt Push ohne diese Schlüssel deaktiviert. | — |
| `REBASE_VAPID_SUBJECT` | Eine `mailto:`-Adresse oder `https://`-URL, die von den Push-Diensten kontaktiert werden kann. Standardmäßig der Origin einer `https`-`REBASE_PUBLIC_URL`. | — |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body, **in Bytes** (`10485760`, nicht `10MB` — ein Wert, der keine Zahl ist, verweigert den Start, anstatt das Limit stillschweigend aufzuheben). `0` deaktiviert das Limit. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Dreiwertiger Zustand (Tri-State). Nicht gesetzt, in jeder Umgebung: `/api/docs` wird für die Aufrufer bereitgestellt, für die `GET /api/schema/tables` Tabellen beschreibt (jeweils das Dokument der für sie beschriebenen Tabellen), und es gibt keine Swagger-UI. `true` veröffentlicht das gesamte Dokument für alle, mit der Swagger-**UI** unter `/api/swagger` außerhalb der Produktion (niemals in der Produktion). `false` behält das Dokument hinter dem Admin-Zugangsschutz. | — |
| `REBASE_DEPLOYMENT_ID` | Das Deployment, das dieser Prozess ausführt, wie von der Plattform benannt; wird in der Zeile genannt, die angibt, dass die Runtime lauscht. Wird von Rebase Cloud gesetzt. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt `includeSubDomains` zum `Strict-Transport-Security`-Header hinzu, sodass Browser für sechs Monate einfaches HTTP auf jeder Subdomain des Hosts verweigern — einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn jede Subdomain der Domain ausschließlich HTTPS nutzt. Jeder Wert außer `true`/`false` verweigert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn nicht gesetzt, bleibt der Endpunkt für alles offen, was den Port erreichen kann — in einem privaten Netzwerk in Ordnung, in einem öffentlichen nicht, worauf die Startprotokolle hinweisen. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start mit dem Schema der Tabellen tun darf. `ensure` (der Standardwert überall — einschließlich Produktion) führt den **additiven** Durchlauf aus: fehlende Tabellen, Spalten und Enum-Typen erstellen, niemals etwas löschen oder umschreiben. `none` lässt das Schema der deklarierten Tabellen unberührt, aber die framework-eigenen Tabellen (Auth, API-Keys, Jobs, Cron) werden weiterhin erstellt und aktuell gehalten; `REBASE_PROVISION=false` schaltet auch diese ab. Das veröffentlichte Image akzeptiert nur diese beiden Werte und **verweigert bei `push` den Start**. Bei einem [Split-Deployment](/docs/deployment/split-processes) darf genau ein Prozess provisionieren, sodass jede andere Rolle `none` setzen muss, um nicht den Start zu verweigern. | `ensure` |
| `REBASE_PROVISION` | `false` sorgt dafür, dass die Runtime nichts in ihrer Datenbank ändert: weder Tabelle, Spalte, Index, Funktion, Trigger, Policy, Rolle noch Grant, weder beim Start noch später, einschließlich der Framework-eigenen Elemente. Stattdessen wird namentlich gemeldet, was fehlt. Für Datenbanken, die nur durch Ihren eigenen Änderungsprozess modifiziert werden dürfen. Siehe [Wenn nur Ihr Änderungsprozess die Datenbank ändern darf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Es werden nur `true` und `false` akzeptiert. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Start verweigern, wenn die Datenbank zuletzt aus einer anderen Gruppe von Tabellen provisioniert wurde, als dieser Prozess erstellt wurde. Nicht gesetzt (oder jeder andere Wert als `true`/`1`) gibt stattdessen eine Warnung aus. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Start verweigern, wenn eine Funktions- oder Cron-Datei beim Importieren einen Fehler wirft oder nicht geparst werden kann, unter Nennung der Datei und des Grundes, sodass bei einem Rolling Deploy die alte Version weiter ausliefert. Ein Neustart verhält sich ebenso. Nicht gesetzt (oder alles außer `true`) überspringt die Datei und liefert den Rest aus. Eine Datei, die fehlerfrei importiert wird und keine Funktion oder keinen Job exportiert, wird immer übersprungen und nicht abgewiesen. | skip |
| `REALTIME_CDC` | Change Capture auf Datenbankebene: `auto` (Änderungen aus dem WAL lesen, wo die Datenbank dies zulässt, sonst Trigger verwenden, sonst Fallback auf Anwendungsebene, wobei jeder Fallback als Info protokolliert wird), `trigger` (erzwingen, warnen falls unmöglich), `wal` (Änderungen aus dem Write-Ahead-Log statt über Trigger lesen; erfordert `wal_level=logical` und eine Rolle mit Replikationsberechtigung, fällt sonst auf `trigger` zurück), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Channels und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein konstruierter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Subscriptions ein Realtime-Socket halten darf; die nächste wird mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl — alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Wie viele Realtime-Sockets ein Benutzer oder ein API-Schlüssel auf einer Serverinstanz geöffnet halten darf. Impersonating-Sockets eines Administrators zählen für den Administrator. Die Anmeldung des nächsten wird mit `TOO_MANY_SOCKETS` verweigert und der Socket geschlossen (4002); das SDK versucht es weiter, sodass er verbunden wird, sobald ein anderer schließt. Eine positive ganze Zahl — alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Keine Obergrenze |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Die maximale Zeit, die eine Änderung auf das Refetch wartet, das sie an Live-Abonnenten ausliefert, in ms. Ein Refetch wartet 300 ms ohne Änderung und bei einem stetigen Strom von Schreibvorgängen höchstens so lange. Eine positive ganze Zahl — alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Wie lange die Gesamtzahl (Total) einer großen Listen-Subscription wiederverwendet werden darf, bevor sie erneut gezählt wird, in ms; Frames, die sie wiederverwenden, tragen `meta.totalAsOf`. Wenn nicht gesetzt, zählt jeder Frame neu. Hat Vorrang vor `realtime.recountIntervalMs`. | Nicht gesetzt |
| `REALTIME_RECOUNT_MIN_ROWS` | Die kleinste letzte Gesamtzahl, für die `REALTIME_RECOUNT_INTERVAL_MS` gilt; kleinere Listen werden bei jedem Frame gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`/Loopback-Werte unter `NODE_ENV=production`. Standardmäßig deaktiviert, damit ein Produktionsstart deutlich fehlschlägt, anstatt sich mit einer nicht vorhandenen Datenbank zu verbinden. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet sich, ohne einen Socket zu öffnen — genau das Format, das ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der nachfolgende Server. Es erstellt auch die Tabellen, die ein ausliefernder Prozess sonst bei der ersten Verwendung anlegen würde, und startet weder Cron noch Job-Warteschlangen. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein normales Deployment nicht versehentlich in eines verwandeln kann, das nur migriert und den Dienst verweigert. Wird in Kombination mit `REBASE_PROVISION=false` abgewiesen. | — |
| `REBASE_PROVISION_SQL_OUT` | Ein Dateipfad. Ein Bereitstellungslauf (`REBASE_PROVISION_ONLY=true`) schreibt jede vorgenommene Schemaänderung der Reihe nach als SQL-Skript dorthin, um sie zu überprüfen und mit `psql` anzuwenden. Geschriebene Zeilen sind nicht enthalten. Wird auf einem ausliefernden Prozess abgewiesen. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt einer Maschine — einem Agenten, einem CI-Job —, eine Schemaänderung über `/api/admin/schema` tatsächlich *anzuwenden* und nicht nur zu planen. Deaktiviert, sofern nicht explizit angefordert: Die Anmeldeinformationen, die eine solche Änderung vornehmen könnten, befinden sich am ehesten in einer CI-Variable. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Wie lange eine benutzerdefinierte Funktion ausgeführt werden darf, bevor ihre Anfrage abgebrochen wird. Dieselbe Einstellung wie die Option `functionsTimeoutMs`. `0` schaltet das Timeout ab. Eine Funktion, die ein eigenes Timeout deklariert (`defineFunction(…, { timeoutMs })`), verwendet stattdessen dieses. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Das maximale Timeout, das eine Funktion für sich selbst mit `defineFunction(…, { timeoutMs })` deklarieren darf, in ms; fordert sie mehr an, erhält sie diesen Wert. Eine positive Zahl; alles andere wird als nicht gesetzt interpretiert. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` bewirkt, dass eine unbehandelte Promise-Rejection den Prozess beendet, anstatt sie nur zu protokollieren. Sinnvoll unter einem Orchestrator, der den Prozess neu startet; deaktiviert lassen, wenn ein Neustart schlimmer wäre als ein Memory Leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Unterdrückt die Startwarnung auf Plattformen, die von der Runtime als Scale-to-Zero erkannt werden, bei denen ein Timer, der in einer inaktiven Instanz ausgelöst wird, in keiner Instanz feuert. Ändert sonst nichts: Setzen Sie dies, wenn Sie mindestens eine Instanz dauerhaft ausführen. | — |
| `TRUSTED_PROXY_HOPS` | Wie viele Proxys vor diesem Server geschaltet sind, damit der Rate-Limiter die echte Client-Adresse aus `X-Forwarded-For` auslesen kann. Ausfallsicherer Standardwert `0`: Ohne Proxy würde das Vertrauen in den Header jedem Aufrufer das Fälschen einer Identität erlauben. | `0` |

:::note[Boot-Provisioning ist additiv und kein Migrationswerkzeug]
Der Boot-Durchlauf läuft unbeaufsichtigt ab, ohne dass jemand ein Diff prüft. Daher wird er niemals eine Spalte löschen, einen Typ einschränken oder eine Tabelle umschreiben. Aus diesem Grund verweigert das Image auch `REBASE_MIGRATE_ON_BOOT=push`: Ein vollständiger Push berechnet ein Diff und führt bedenkenlos ein `DROP COLUMN` aus — und ein Container-Neustart darf niemals als Nebeneffekt eines Neu-Schedulings eine Produktionsspalte zerstören können.

Destruktive oder umstrukturierende Änderungen bleiben dort, wo sie überprüft werden können: `rebase db generate` + `rebase db migrate` oder `rebase db push` aus einem Checkout oder CI, was die Änderung als Trockenlauf (dry-run) testet, destruktive Änderungen ohne Bestätigung ablehnt und zuvor ein Backup erstellen kann.
:::

### Split-Deployments

Ein einziges Image und Bundle kann mehrfach gestartet werden, wobei jede Instanz einen anderen Teil des Projekts bedient. Hier jeweils eine Zeile, da diese Seite den Anspruch erhebt, jede Variable aufzulisten; was jede Kombination *einbindet und verwaltet* — und welche Kombinationen den Start verweigern —, finden Sie unter **[Split-Prozesse](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Wenn nicht gesetzt, folgt er der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Wenn nicht gesetzt, folgt er der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | In diesem Prozess nur die benannten benutzerdefinierten Funktionen bereitstellen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen außer den benannten bereitstellen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. Auf einem `worker`, wohin dessen eigene `rebase.functions`-Aufrufe gehen. Eine `http(s)`-URL. | — |

### MCP-Oberfläche

Ein Opt-in-Endpunkt für das Model Context Protocol unter `/mcp`, damit ein KI-Client dieses Projekt **als angemeldeter Benutzer** lesen und schreiben kann. Standardmäßig deaktiviert und — im Gegensatz zu jeder anderen Oberfläche — schaltet kein `REBASE_ROLE` diesen Endpunkt ein: Die anderen beschreiben die Prozessform, während dies eine Entscheidung ist, Anmeldeinformationen an Drittanbietersoftware zu übergeben, und sie sollte von einer Person getroffen werden, anstatt von der Aufgabenbezeichnung eines Containers geerbt zu werden.

`rebase dev` setzt `REBASE_MCP_ENABLED=true` für das Backend, das es startet, es sei denn, die Shell oder `.env` enthält bereits eine entsprechende Zeile, und dieses Backend nennt sein eigenes `http://localhost:<port>` als öffentliche URL, wenn `REBASE_PUBLIC_URL` nicht gesetzt ist. Bei keinem anderen Befehl geschieht dies: Ein Produktionsprozess benötigt beide Variablen.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_MCP_ENABLED` | Bindet die MCP-Oberfläche ein. Erfordert `REBASE_PUBLIC_URL`; ohne diese verweigert die Oberfläche die Einbindung und meldet dies im Startprotokoll. | `false` |
| `REBASE_PUBLIC_URL` | Der extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Oberfläche kann diesen nicht ableiten — würde der Origin aus dem `Host`-Header übernommen, wären die Ausstelleridentität und die Audience, gegen die die eigenen Tokens geprüft werden, Werte, die der Aufrufer vorgibt. | — |
| `REBASE_MCP_VIEW` | Pfad zur projekteigenen MCP-App-Ansicht (`rebase-view.html`, geschrieben von `rebaseMcpViewPlugin()`), die Claude anstelle der generischen Ansicht bereitgestellt wird, damit Ihre benutzerdefinierten Ansichten, Felder und Aktionen dargestellt werden. Ohne diesen Pfad sucht das Backend neben dem Frontend, das es ausliefert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Erlaubt dynamische OAuth-Client-Registrierung (RFC 7591), sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um eine vorherige Registrierung der Clients zu erzwingen. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Deaktiviert, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes Bundle verfügt über keinen `backend/schema`-Quellcode zum Bearbeiten; sind diese Variablen gesetzt, liest der Schema-Editor den Quellcode aus dem Repository, committet jede Änderung zurück und führt dessen DDL auf dieser Datenbank aus. Nur für Admins und von einer Person angewendet, sofern `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` nichts anderes festlegt. Ein angegebenes Repository ohne verwendbare Anmeldeinformationen verweigert den Start. Siehe [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository, in das Schemaänderungen committet werden sollen, im Format `owner/name`. Das Setzen dieser Variable aktiviert das Feature. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, auf dem der Commit landet. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Wo `backend/schema` in diesem Repository liegt, relativ zum Repository. Ein Pfad, der das Repository verlässt, verweigert den Start, ebenso wie das entfernte `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein Fine-Grained Token mit Lese- und Schreibzugriff auf die Inhalte des Repositorys. Setzen Sie entweder diese oder die drei `_GITHUB_APP_*`-Variablen, nicht beide. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub-App, um als App statt mit einem Token zu committen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installation der App im Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit maskierten Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Nicht gesetzt bedeutet, dass geplante Backups deaktiviert sind. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- / `gs://bucket/prefix`-URL. Erforderlich zusammen mit `BACKUP_SCHEDULE`, das ohne diese Angabe die Ausführung verweigert. `rebase db backup` greift auf `./backups` an dem Ort zurück, an dem es ausgeführt wurde. | — |
| `BACKUP_RETENTION_DAYS` | Löscht Backups, die älter als N Tage sind. Nicht gesetzt oder `0` behält alles. | — |
| `BACKUP_KEEP_MINIMUM` | Behält immer mindestens N der neuesten Backups, unabhängig von der Aufbewahrungsfrist. | — |
| `PG_DUMP_PATH` | Überschreibt die `pg_dump`-Binärdatei — sie muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Überschreibt die `pg_restore`-Binärdatei. | — |
| `PSQL_PATH` | Überschreibt die `psql`-Binärdatei, die von `rebase db restore --clean` ausgeführt wird, um die Wiederherstellung in einer einzigen Transaktion auszuführen. | — |
| `PG_DUMPALL_PATH` | Speicherort von `pg_dumpall`, wenn es sich nicht im `PATH` befindet. Ohne diese Angabe — und ohne installierte PostgreSQL-Client-Tools — schlägt ein Globals-Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) enthält die PostgreSQL-18-Client-Tools, sodass ein geplantes Backup darin gegen jeden Server bis zu Postgres 18 läuft. Außerhalb des Images müssen Sie diese selbst installieren (`apt-get install postgresql-client-18`, `brew install libpq`).

Backups enthalten Geheimnisse und personenbezogene Daten (PII). Verwenden Sie ein privates Ziel mit Verschlüsselung im Ruhezustand (Encryption-at-Rest).

### Bundle-Auslieferung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft beim Start ein Bundle ab. Diese Variablen bestimmen, welches Bundle und wie.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Woher das Bundle-Archiv abgerufen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Das Bearer-Credential für diesen Abruf. Behandeln Sie es als Geheimnis: Es autorisiert einen Mandanten zum Herunterladen seines eigenen Codes. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Wohin ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und zwischen dem Abruf und dem Start erhalten bleiben. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image für das Bundle bereitstellt, über die hinaus, die es selbst deklariert. | — |

### Ressourcen-Bindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `backend/resources.ts` deklariert, wird durch nach ihnen benannte Umgebungsvariablen gebunden. Die Basisnamen finden Sie unten; eine nicht standardmäßige Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an, sodass ein Bucket namens `media` beispielsweise `S3_BUCKET__MEDIA` liest. `rebase status` gibt pro Ressource die genaue Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, wenn es nicht der standardmäßige Postgres-Treiber ist. Mit Suffix pro Quelle: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Mit Suffix pro Topic. | — |

### Die eigene Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hiervon wirkt sich auf ein Deployment aus.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_BASE_URL` | Wohin `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service-Key senden, in der Shell oder in `.env`. Setzen Sie diesen Wert, wenn der Server auf andere Weise als über `rebase dev` in diesem Projekt ausgeführt wird: `rebase start`, ein Container, ein anderer Host. Wenn nicht gesetzt, verwenden sie den von `rebase dev` aufgezeichneten Server, solange dieser läuft, und senden andernfalls nichts. | — |
| `REBASE_SERVICE_KEY` | Der Service-Key, mit dem sich diese Befehle authentifizieren, gelesen aus `.env`: dieselbe Variable, die der Server liest (siehe oben). | — |
| `SERVICE_KEY` | Eine ältere Bezeichnung für diesen Schlüssel. Wenn `.env` diesen setzt, lesen `rebase api-keys` und `rebase storage` ihn anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env` die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_ROOT_RULES` | `0` verhindert, dass `rebase init` und `rebase skills install` die Regeln des Projekts in `CLAUDE.md` und `AGENTS.md` im Repository-Wurzelverzeichnis schreiben, falls Sie die Agentendateien manuell pflegen. | an |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, als das sich `rebase cloud login` anmeldet, anstatt danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Dessen Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in den Shell-Verlauf gelangt. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der `rebase cloud login`-Sitzung und liest oder schreibt niemals die gespeicherte Sitzung. In einem Verzeichnis, das von `rebase cloud init --claim` verknüpft wurde, wird es zugunsten des projekteigenen Tokens zurückgestellt, wenn es keinen Scope für das Projekt besitzt. Die Methode zur Ausführung von `rebase cloud` in CI — siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) übergibt es an die CLI, die seine Cloud-Tools starten, und sendet es niemals an die App: Setzen Sie dafür `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt den zugrunde liegenden Fehler und die Anfragedetails anstelle der Kurzmitteilung aus. Das Erste, was Sie setzen sollten, wenn ein `rebase cloud`-Befehl ohne hilfreiche Meldung fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle der `<db>_dev_diff`, die sie neben `DATABASE_URL` erstellen. Rebase erstellt oder löscht hier angegebene Datenbanken nicht und lehnt eine Datenbank ab, die mit `DATABASE_URL` identisch ist. Auf der verwalteten Entwicklungsdatenbank setzt die CLI diesen Wert auf ein eigenes flüchtiges In-Memory-PGlite. Setzen Sie dies dort, wo `CREATE DATABASE` nicht gewährt wird. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und provisioniert nichts — Sie bringen Ihre eigene mit. Identisch mit `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Legt den Port des Frontend-Dev-Servers fest, den `rebase dev` sonst aus dem Pfad des Projekts ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` darauf wartet, dass sich das Backend meldet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert den Bericht. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einfügt. | — |
| `DO_NOT_TRACK` | Die werkzeugübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keine Telemetrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe, speziell für Rebase. Benötigt keine Datei, weshalb dies die bevorzugte Variable für CI und Images ist. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Wohin Telemetriedaten gesendet werden, für einen selbst gehosteten Collector. | — |
| `REBASE_NO_UPDATE_CHECK` | `1` verhindert, dass die CLI die npm-Registry (oder `npm_config_registry`) einmal täglich in einem Hintergrundprozess nach den dist-tags von `@rebasepro/cli` abfragt, und blendet die Zeile „Rebase X is out; this CLI is Y“ aus, mit der jeder Befehl außer `rebase upgrade` auf stderr endet. Die Antwort wird in `~/.rebase/release-check.json` gespeichert, und die Anfrage sendet sonst nichts. In CI bereits deaktiviert; `NO_UPDATE_NOTIFIER` bewirkt dasselbe. | — |
| `REBASE_RELEASE_NOTICE_SHOWN` | Wird von der CLI für die von ihr gestarteten Prozesse gesetzt, sodass ein Befehl, der die CLI erneut ausführt, die Zeile „Rebase X is out“ nur einmal ausgibt. Wenn Sie diesen Wert selbst setzen, wird die Zeile für diesen Prozess ausgeblendet, ähnlich wie bei `REBASE_NO_UPDATE_CHECK`. | — |

## Secrets in der Entwicklung

`JWT_SECRET` ist in der Produktion erforderlich. Es und `REBASE_SERVICE_KEY` werden
außerhalb der Produktion automatisch für Sie generiert, sodass Sie ohne vorherige Einrichtung starten können.

Diese generierten Werte werden in `.rebase-dev-secrets.json` zwischengespeichert, neben
`.rebase-dev-port` und `.rebase-dev-url` und zusammen mit ihnen per `.gitignore` ignoriert. Zuvor wurden
sie bei jedem Start neu generiert — ein Neustart des Dev-Servers meldete Sie daher von
Ihrer eigenen App ab und entwertete jeden soeben erstellten API-Schlüssel.

- Wenn Sie eine der Variablen explizit setzen, wird Ihr Wert verwendet; nichts wird zwischengespeichert oder gelesen.
- Leiten Sie den Cache mit `REBASE_DEV_SECRETS_FILE` an einen anderen Ort weiter — ein Pfad und
  die einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets zu rotieren. Beim nächsten Start wird eine neue Datei geschrieben.
- Wenn die Datei nicht geschrieben werden kann — etwa in einem schreibgeschützten Container —, startet der Server
  trotzdem mit einem flüchtigen Secret, genau wie zuvor.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion
wird auch nichts generiert: Ein Start ohne `JWT_SECRET` schlägt unter Nennung der Variable fehl, und das bleibt unverändert:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Backend Config Object

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

Dieselben Optionen,
ohne `app`, `server` und `basePath` und mit einem erforderlichen `provision`, erstellen ein
Backend, das nichts ausliefert, bis Sie es mounten: `createRebaseBackend`. Siehe
[Benutzerdefinierte Server-Integration](/docs/backend/custom-server/).

### Ändern von `basePath`

`basePath` verschiebt jede API-Route, daher muss dem Client dasselbe mitgeteilt werden —
andernfalls fragt er weiterhin `/api/...` an und erhält für alles einen 404-Fehler:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Das Admin-Panel übernimmt dies von dem Client, den es erhält; nichts weiter muss
konfiguriert werden. Wenn Sie eine Anfrage-URL manuell erstellen, bauen Sie diese ausgehend vom Client zusammen,
anstatt `/api` selbst zu schreiben:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### SQL Editor Permission Denied (`permission denied for table <name>`)

* **Symptome:** Benutzerdefinierte Abfragen, die im SQL-Editor von Rebase Studio ausgeführt werden, schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellenansicht (Spreadsheet) des CMS Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, Abfragen im SQL-Editor auszuführen, indem die Datenbankrollen temporär gewechselt werden, um der Anwendungsrolle des aktiven Benutzers zu entsprechen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen und nicht als tatsächliche PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer des Verbindungseigentümers ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase dazu, Abfragen im SQL-Editor mit den Berechtigungen des Verbindungseigentümers (in der Regel ein Superuser/Owner) auszuführen. Der SQL-Editor meldet dann über den Ergebnissen, dass sie als Verbindungseigentümer gelesen wurden, und deaktiviert die Rollenauswahl.

### SQL Editor Schema Fetch Failed (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schema-Baum nicht laden oder der SQL-Editor gibt `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.` aus.
* **Ursache:** Rebase benötigt administrative Berechtigungen, um Datenbanksystemkataloge abzufragen und administrative Befehle auszuführen. Wenn dem Bootstrapper kein `adminConnectionString` übergeben wird oder `getAdmin()` überschrieben wurde, um `undefined` zurückzugeben, schlagen diese Operationen fehl.
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

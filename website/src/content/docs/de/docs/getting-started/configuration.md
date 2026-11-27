---
sourceHash: bafbb63e7ad2ac20
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projektstammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> eine erforderliche Variable fehlt oder fehlerhaft ist (eine URL, die keine URL ist; ein Port,
> der keine Zahl ist), verweigert der Server den Start und nennt die entsprechende Variable.
>
> Wo das Schema definiert ist, hängt davon ab, wie Sie das Backend ausführen. Ein Projekt,
> das von der Runtime gestartet wird – `rebase dev`, `rebase start`, das veröffentlichte Image –,
> verwendet das Schema der Runtime (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, bei dem [`rebase eject`](/docs/cli)
> ausgeführt wurde, besitzt eine eigene `backend/src/env.ts`, die `loadEnv({ extend })` aufruft,
> und kann dort eigene typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **In der Entwicklung optional** – wenn nicht gesetzt, führt `rebase dev` eine verwaltete PostgreSQL-Instanz für das Projekt aus, deren Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktion erforderlich** (wird in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **Bei einer Managed Database bedeutet `sslmode=require` möglicherweise nicht das, was es vermuten lässt.**
>
> Für `psql` und jedes libpq-Tool bedeutet `require` „verschlüsselt, Zertifikat nicht
> geprüft“. Der Node-Treiber, auf dem Rebase läuft, interpretiert dies als `verify-full`.
> Daher verweigert eine Datenbank, deren Zertifikat nicht von einer öffentlichen Zertifizierungsstelle
> signiert wurde – was bei Managed Postgres häufig vorkommt –, die Verbindung zur Runtime mit
> `self-signed certificate`, während `psql` sich mit derselben URL problemlos verbindet.
> Die Runtime und die `rebase db`-Befehle brechen mit einer entsprechenden Meldung ab.
>
> Wählen Sie eine der folgenden Optionen:
>
> - **`sslmode=no-verify`** – verschlüsselt, nicht geprüft: das, was `require` für
>   libpq bedeutet. Dies ist eine Schreibweise von node-postgres, die libpq fehlt, sodass `psql`, `pg_dump`
>   und Atlas dies mit `invalid sslmode value: "no-verify"` ablehnen. Die eigenen Befehle von Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) übergeben dies an diese Tools als
>   `sslmode=require`, sodass sie mit der konfigurierten URL funktionieren; für manuelles `psql`
>   wechseln Sie zu `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** – Prüfung gegen das
>   CA-Zertifikat des Anbieters. Einheitlich für jedes Tool.
>
> `uselibpqcompat=true&sslmode=require`, was die Warnung des Node-Treibers selbst vorschlägt,
> funktioniert auch für die Runtime; die Rebase-Befehle entfernen `uselibpqcompat`, bevor sie
> die URL an die libpq-Tools übergeben, da diese den Parameter sonst ablehnen.

### Frontend

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** – siehe unten. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client-ID. Aktiviert „Mit Google anmelden“. | — |

> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend separate Origins, weshalb der Dev-Server
> diesen Wert injiziert. In der Produktion liefert das Rebase-Backend die SPA aus,
> sodass die API die eigene Origin der Seite ist und der Client sie eigenständig so auflöst.
>
> Das feste Einbinden einer absoluten URL in ein Produktions-Bundle funktioniert nur so lange,
> bis ein zweiter Hostname auf dieselbe App zeigt: Eine benutzerdefinierte Domain lädt die Seite dann von
> `example.com` und ruft die API unter `example.rebase.website` auf, was Cross-Origin ist,
> sodass jeder Preflight-Request fehlschlägt. Das Erlauben der Origin in CORS behebt dies **nicht** – das
> Refresh-Cookie ist `SameSite=Lax` und wird nicht Cross-Site gesendet. Sie würden also lediglich die
> Konsolenfehler beseitigen, die Authentifizierung bliebe jedoch defekt. Wenn die Variable nicht gesetzt ist,
> funktioniert jede Domain, die auf die App zeigt, ganz ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` ausgelesen. `rebase dev` liest ihn **ausschließlich aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort nicht gelesen, da der Port aufgelöst wird, bevor diese Datei geladen wird – und bindet andernfalls einen Port, der vom Projektpfad abgeleitet wird, sodass mehrere Projekte gleichzeitig laufen können. `rebase dev --port` hat Vorrang vor beiden, und das Start-Banner gibt die verwendete Methode an. | `3001` |
| `LOG_LEVEL` | Protokollierungs-Ausführlichkeit: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer `Failed query: [redacted]`-Zeile an. Jedes fehlschlagende Statement wird standardmäßig unkenntlich gemacht, da eine fehlgeschlagene Abfrage gebundene Parameter enthält – etwa eine E-Mail-Adresse oder einen Passwort-Hash. Setzen Sie dies auf `true`, wenn Sie einen DDL-, RLS- oder Change-Capture-Fehler untersuchen. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste der erlaubten Origins. **In der Produktion erforderlich**, sofern `FRONTEND_URL` nicht gesetzt ist: Ein Produktionsstart ohne beides verweigert den Dienst. In der Entwicklung wird dies zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu `CORS_ORIGINS` verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge mit Administratorrechten (wird für die Schema-Introspektion und Admin-Operationen verwendet). Die dort angegebene Datenbank ist weder diejenige, die die SQL-Konsole als aktuell bezeichnet, noch die, die ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der die eigene Verbindung der App liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert das Wechseln der PostgreSQL-Rolle im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Die SQL-Konsole von Studio weist dann darauf hin, dass die Zeilen als Verbindungseigentümer gelesen wurden, nennt diesen und deaktiviert die Rollenauswahl. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies bei einem Checkout, der [auf einen Branch gewechselt](/docs/backend/branching/#cli-integration) ist. Ein Server mit dieser Variablen verwaltet die Branch-Registry auf dieser Datenbank und kopiert neue Branches standardmäßig davon, sodass die Branches-Ansicht von Studio die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

Die Entwicklung erlaubt **localhost sowie alle in `CORS_ORIGINS` (oder `FRONTEND_URL`) angegebenen Origins** – dieselbe
Liste, die die Produktion verwendet, wobei localhost hinzugefügt statt ersetzt wird. Die Variable
funktioniert also in beiden Umgebungen gleich, und die Fälle, in denen sie in der Entwicklung benötigt wird,
sind die üblichen:

```bash
# Ein Telefon im LAN, der Rechner eines Kollegen, ein ngrok-Tunnel,
# ein weitergeleiteter Codespaces-Port – alles Nicht-Localhost-Origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Eine Origin, die weder localhost ist noch aufgeführt wird, wird abgelehnt, und die Ablehnung wird
**einmal pro Origin** mit der genauen Zeile protokolliert, die sie zulassen würde. Die Ablehnung ist
keine Vorsichtsmaßnahme um ihrer selbst willen: Die API sendet Anmeldedaten. Das Widerspiegeln
eines beliebigen `Origin`-Headers würde es jeder Seite, die der Entwickler zufällig besucht, ermöglichen,
authentifizierte Anfragen mit dessen Sitzung an den Dev-Server zu stellen und die Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `JWT_SECRET` | Geheimnis für die JWT-Signierung (in Produktion erforderlich, in Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zur asymmetrischen Signierung von Access Tokens (RS256), sodass jede Instanz mit dem JWKS eine Sitzung verifizieren kann, ohne selbst Tokens erstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEMs. Ohne diesen Schlüssel bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt den `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie ihn bei jedem Schlüsselwechsel – die Rotation erfordert, dass alte und neue Schlüssel unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh Tokens. Gleitend – jede Rotation verlängert ihn, sodass dies regelt, wie lange eine Sitzung bei **Inaktivität** bestehen bleibt. Setzen Sie `400d` für Sitzungen, die lange Abwesenheiten überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Registrierung neuer Benutzer erlauben (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden einlassen, und dieser jemand wird der Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Zeitfenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`. Ein erstes Konto, das über die offene Registrierung erstellt wird, ist ein normales Konto, und der Administrator wird über `REBASE_ADMIN_EMAIL` unten benannt oder über den Service Key zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Standardwert des Frameworks ist deaktiviert. | `false` |
| `DISABLE_SELF_REGISTRATION` | Not-Aus-Schalter. Schließt das Erstbenutzer-Bootstrap-Zeitfenster, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank gesperrt ist. Kombinieren Sie dies mit `REBASE_ADMIN_EMAIL` unten, da das Deployment sonst keine Möglichkeit hat, seinen ersten angemeldeten Aufrufer zu erzeugen. Jedes ausgelieferte Deployment-Artefakt setzt dies. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail des ersten Administratorkontos, das beim Start erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. Auf diese Weise erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt mit dem Internet darum zu konkurrieren. Der Start warnt, wenn die Tabelle in der Produktion leer ist und dies nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Geheimnis. Wenn nicht gesetzt, werden die Geheimnisse stattdessen mit `JWT_SECRET` verschlüsselt und der Start warnt einmal – eine Rotation von `JWT_SECRET` meldet somit alle Benutzer ab *und* führt dazu, dass alle registrierten Authentifikatoren nicht mehr entschlüsselt werden können. Richten Sie einen dedizierten Schlüssel ein (32+ Zufallszeichen), bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *weggewechselt* wird. Setzen Sie während einer Rotation beide: Neue Geheimnisse werden mit `MFA_ENCRYPTION_KEY` geschrieben, und bestehende bleiben lesbar, sodass niemand während der Rotation aus seinem Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Geheimnis neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Anonyme Anmeldung aktivieren (`POST /api/auth/anonymous`). Opt-in und bewusst nicht durch `ALLOW_REGISTRATION` beschränkt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API verlangen. Auf `false` setzen für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Stellt `POST /api/auth/find-user` bereit, wodurch eine E-Mail-Adresse in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für Einladungsabläufe aufgelöst wird. Nur für authentifizierte Aufrufer; gibt niemals die E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: stellt eine Angriffsfläche zur Benutzeraufzählung dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite`-Attribut des Refresh-Cookies: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure`-Flag auf dem Refresh-Cookie. Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für reines HTTP – ein Deployment auf einer LAN-Adresse, bei dem der Browser das Cookie sonst verwerfen würde und die Sitzung beim Ablauf des Access Tokens fehlerlos beendet würde. Gibt beim Start eine Warnung aus. `http://localhost` benötigt dies nicht. | `true` |
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
| `GITLAB_CLIENT_ID` | GitLab OAuth Client-ID. Die `baseUrl` einer selbst gehosteten Instanz hat keine Umgebungsvariable – konfigurieren Sie GitLab dafür im `auth`-Block. | — |
| `GITLAB_CLIENT_SECRET` | GitLab OAuth Client Secret | — |
| `BITBUCKET_CLIENT_ID` | Bitbucket OAuth Client-ID | — |
| `BITBUCKET_CLIENT_SECRET` | Bitbucket OAuth Client Secret | — |
| `SLACK_CLIENT_ID` | Slack OAuth Client-ID | — |
| `SLACK_CLIENT_SECRET` | Slack OAuth Client Secret | — |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth Client-ID | — |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth Client Secret | — |
| `APPLE_CLIENT_ID` | Apple Services ID für Web-Logins. Sie ist öffentlich und wird unter `GET /auth/config` veröffentlicht. Apple hat kein statisches Client Secret, da Rebase für jeden Token-Austausch ein kurzlebiges ES256-JWT signiert. Apple benötigt daher `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` sowie diesen Wert oder `APPLE_BUNDLE_IDS`, und konfiguriert ohne diese Angaben nichts. | — |
| `APPLE_BUNDLE_IDS` | Kommagetrennte Bundle-IDs der nativen iOS/macOS-Apps, deren „Mit Apple anmelden“-Codes akzeptiert werden. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, der Aussteller (Issuer) des JWTs. | — |
| `APPLE_KEY_ID` | Key-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten `.p8`-Schlüsseldatei inklusive Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Der öffentliche Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deploy; er enthält keine Geheimnisse. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` ermöglicht er es dem Admin-Gate, ein Plattform-Token für `cron:read` zu akzeptieren – und für sonst nichts. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, mit der das `aud` eines Plattform-Tokens übereinstimmen muss, damit ein für ein anderes Projekt erstelltes Token abgelehnt wird. Wenn nur eine der beiden Variablen gesetzt ist, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Ziel des Buttons **Continue with Rebase Cloud** im Admin-Panel: die Seite des Projekts in der Plattform-Konsole, die die Eigentümer des Projekts anmeldet und zurückleitet. Die Plattform setzt dies beim Deploy zusammen mit den beiden obigen Variablen; damit akzeptiert `POST /api/auth/platform-signin` das einminütige `auth:admin-signin`-Token der Plattform und öffnet eine Admin-Sitzung. Ohne diese Variable funktioniert der Zugang weiterhin über die Schaltfläche **Open CMS** der Konsole, und der Anmeldebildschirm erklärt dies lediglich. | — |
| `REBASE_RATE_LIMIT_STORE` | Speicherort der Rate-Limit-Zähler für die Auth-Routen und für `rateLimit` in benutzerdefinierten Funktionen: `memory` (prozessbezogen) oder `sql` (über Replikate geteilt). Ein Prozess kann seine eigene Replikatanzahl nicht sehen, weshalb ein Deployment mit mehreren Instanzen dies deklarieren muss – drei Replikate mit dem Standardwert erzwingen das Dreifache des Limits. Jeder andere Wert **verhindert den Start**, anstatt auf einen Fallback zurückzugreifen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Bereitstellung des passwortlosen Magic-Link-Anmeldeablaufs. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Bereitstellung der passwortlosen Anmeldung mit einem sechsstelligen Code per E-Mail. Gleiche E-Mail-Anforderung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Magic-Link- oder E-Mail-Code-Anfrage für eine unbekannte Adresse erstellt das Konto, sofern die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh Token nach Ablauf seines Wiederverwendungsfensters erneut eingereicht wird: `reject` (Token ablehnen, Sitzung beibehalten) oder `revoke-session` (Sitzung beenden). Jeder andere Wert führt zu einem Startfehler. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Erst-Bestätigen-Registrierung: Keine Passwort-Anmeldung, bis die Adresse bestätigt wurde. Erfordert E-Mail-Dienst; der Start wird ohne diesen verweigert. | `false` |
| `CAPTCHA_PROVIDER` | Captcha-Verifizierung auf den Auth-Routen aktivieren: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig verwendet wird, um das vom Browser gesendete Token zu überprüfen. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Auth-Routen (z. B. `register,login`). Wenn nicht gesetzt, wird der Standardsatz des Anbieters geschützt. | — |

### Storage

:::caution[Storage hat keine Row-Level Security, daher wird ein Zugriffsmodell benötigt]
Tabellen werden durch Postgres-RLS geschützt. Für Object Storage gibt es kein Äquivalent –
Schlüssel teilen sich einen flachen Namensraum. Bei einem konfigurierten Bucket ohne Zugriffsmodell
**verweigert der Server in der Produktion den Start**. Erfüllen Sie diese Anforderung mit genau einer
der folgenden Optionen: Ein aus `backend/storage.ts` exportierter `storageAuthorize`-Hook (Standard im Scaffold),
`STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `STORAGE_TYPE` | Storage-Backend: `local`, `s3`, `gcs` oder `platform` (Dateien in einem Präfix der Hosting-Plattform, übertragen über URLs, die ihr Storage-Broker signiert; von der Plattform gesetzt). In der Produktion deaktiviert `local` den Storage, es sei denn, `FORCE_LOCAL_STORAGE=true` ist gesetzt | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird aus dem Verzeichnis gelesen, in dem der Server ausgeführt wird: das Projektstammverzeichnis unter `rebase dev`, `backend/` in einem durch `rebase eject` erzeugten Server | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in der Produktion erlauben – nur mit einem persistenten Volume, das `STORAGE_PATH` und die daneben liegenden Verzeichnisse `<STORAGE_PATH>__<key>` benannter lokaler Buckets enthält | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Sekunden, die die Download-URL einer privaten Datei gültig ist – das Token, das `getSignedUrl()` einfügt. Maximal `604800` (eine Woche) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maximale Dateigröße, die die Quelle akzeptiert, in Bytes, auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Keine ganze Zahl an Bytes verhindert den Start | `52428800` (50 MB) |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS Access Key | — |
| `S3_SECRET_ACCESS_KEY` | AWS Secret Key | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 etc.) | — |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs für S3-Buckets erzwingen (`true`/`false`) | `false` |
| `GCS_BUCKET` | GCS-Bucket-Name (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Service-Account-Schlüsseldatei. Auf GCP weglassen, wo Workload Identity die Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Jedes Objekt für jeden ohne Token bereitstellen. Nur für einen Bucket gedacht, der tatsächlich als öffentliches CDN fungiert. Eine der Möglichkeiten, den obigen Start-Schutz zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Jeder angemeldete Benutzer darf jedes Objekt lesen, schreiben, auflisten und löschen. Im Konfigurationsobjekt aus gutem Grund `INSECURE` genannt: Dies ist nur in einer Single-Tenant-Anwendung vertretbar, in der jedem Konto jede Datei anvertraut wird. | `false` |
| `STORAGE_POLICIES` | Speicherzugriffsregeln als JSON: `[{ "path", "operations"?, "allow" }]`, wobei `allow` entweder `"public"`, `"authenticated"`, `"owner"` oder `{ "roles": [...] }` ist. Standardmäßig ablehnend („deny by default“) und erfüllt den Start-Schutz. Eine ungültige Liste verhindert den Start. Siehe [Storage-Autorisierung](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | Der Storage-Broker der Plattform für `STORAGE_TYPE=platform`. Wird von der Plattform gesetzt, die den Broker betreibt. | — |
| `STORAGE_BROKER_PROJECT` | Die Projekt-ID, auf die der Broker die Dateien dieses Deployments beschränkt, für `STORAGE_TYPE=platform`. Von der Plattform gesetzt. | — |
| `STORAGE_RENDITION_CACHE` | Generierte Bildwiedergaben (Skalierungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu berechnen. | `false` |

### E-Mail (optional)
`MAGIC_LINK_URL`.

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
| `EMAIL_LOGO_URL` | Logo am oberen Rand der Standard-E-Mail-Vorlagen. Absolute `http(s)`-PNG- oder -JPG-URL – E-Mail-Clients entfernen SVG und blockieren `data:`-URIs. Wenn nicht gesetzt, erhält eine App, die noch `Rebase` heißt, das Rebase-Logo; eine umbenannte App erhält keines |
| `MAGIC_LINK_URL` | Ziel des versendeten Magic Links. An eine Basis-URL wird `/auth/magic-link?token=…` angehängt; eine URL, die `{token}` enthält, bildet den vollständigen Link, für Frontends, die `/auth/magic-link` nicht bedienen. Setzen Sie den Wert in `.env` in Anführungszeichen, da ein ungequotetes `#` einen Kommentar einleitet: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Ein Wert mit einem Hash oder Dateipfad ohne `{token}` löst beim Start eine Warnung aus. Wenn nicht gesetzt, ist die Basis `FRONTEND_URL` |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `DB_POOL_MAX` | Maximale Anzahl an Pool-Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung aufrechterhalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) erfordert eine solche: `LISTEN`/`NOTIFY` funktioniert nicht über einen Transaktions-Pooler wie PgBouncer; ohne diese Verbindung werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, statt lautlos verloren zu gehen. Auch der [Job Worker](/docs/backend/jobs) hält sein Wake-up-`LISTEN` darüber. Füllt `directConnectionString` des Postgres-Adapters, wenn dieser ungesetzt ist. | — |
| `DATABASE_READ_URL` | Read Replica, etwa ein Hot Standby. Wenn hier ein anderer Server angegeben ist, werden authentifizierte Lesezugriffe (Listen, Einzelzeilen, Zählungen, Aggregate) dort unter derselben Row-Level Security ausgeführt; Schreibzugriffe, Logins, Realtime, Cronjobs, Jobs, die SQL-Konsole und `rebase.sql` verbleiben auf der primären Datenbank. Ein Benutzer, der gerade geschrieben hat, liest für die Dauer von `REBASE_READ_STICKY_MS` von der primären Datenbank, und alle Benutzer tun dies, wenn das Replikat um mehr als `REBASE_READ_MAX_LAG_MS` hinterherhinkt oder fehlschlägt. Füllt `readConnectionString` des Postgres-Adapters, wenn dieser ungesetzt ist; bis einschließlich Version 0.28 wurde der Pool des Replikats zwar geöffnet, aber nie daraus gelesen. | — |
| `REBASE_READ_STICKY_MS` | Dauer nach einem Schreibvorgang, für die Lesezugriffe desselben Benutzers an die primäre Datenbank gehen, damit ein Speichervorgang gefolgt von einer Listenansicht die Änderung direkt anzeigt. Pro Serverinstanz. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Replikat-Verzögerung, ab der alle Lesezugriffe an die primäre Datenbank weitergeleitet werden. | `1000` |
| `DATABASE_POOLED` | `true`, wenn `DATABASE_URL` über einen Pooler im Transaktionsmodus wie PgBouncer läuft. Der Pool sendet dann beim Verbindungsaufbau weder `search_path` noch `statement_timeout` (der Pooler würde dies ablehnen oder verwerfen) und setzt beides in jeder Transaktion; der Start weist der Datenbankrolle für Anweisungen außerhalb einer Transaktion einen standardmäßigen `search_path` von `public` zu. `DATABASE_DIRECT_URL` wird dadurch erforderlich, und Realtime, das Aufwecken des Job Workers, Index-Erstellungen, Branching und die SQL-Konsole greifen darauf zurück. Die URL des Replikats wird ebenfalls als gepoolt angenommen. `DATABASE_POOLED__<KEY>` für eine weitere Datenquelle. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was der jeweilige Pool angefordert hat. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server lautlos zu serialisieren. | — |

### Laufzeitverhalten

Wird von der Runtime ausgelesen – `rebase dev`, `rebase start` und dem veröffentlichten
Server-Image. Ein Projekt, bei dem `eject` ausgeführt wurde, steuert diese Entscheidungen
stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) durch, welches Tabellen meldet, die ohne Richtlinien bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime enthält keine Kopie, und ohne das Paket verweigert der Start den Dienst unter Nennung des Pakets. `false` deaktiviert den Scan auf diesem Prozess. | — |
| `REBASE_RLS_REQUEST_ROLE` | Die Postgres-Rolle, unter der authentifizierte und anonyme Anfragen ausgeführt werden. Weisen Sie jedem Projekt auf einem gemeinsam genutzten Cluster eine eigene Rolle zu. Eine Datenbank speichert die Rolle, unter der sie läuft, und ein Start mit einer abweichenden Konfiguration verweigert den Dienst, bis `rebase db request-role migrate` die Migration durchführt. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` erstellt die Request-Rolle und erlaubt der Verbindung, zu ihr zu wechseln; `never` überlässt beides Ihnen und prüft die Rollen lediglich. | `auto` |
| `REBASE_RLS_GRANTS` | Was Rebase der Request-Rolle gewährt: `schema` (jede Tabelle in den bereitgestellten Schemas plus Standardprivilegien), `managed` (nur die bereitgestellten Tabellen) oder `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` beschränkt die Richtlinien von Rebase auf die Request-Rolle(n), sodass andere Rollen, die dieselben Tabellen lesen, keine Berechtigungen daraus ableiten. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` erstellt Richtlinien, die nur der Serverkontext oder ein Admin erfüllen kann, `TO public` und führt Admins als Request-Rolle aus. Standardmäßig lauten sie `TO rebase_admin`, sodass eigentümergefilterte Lesezugriffe angemeldeter Benutzer den Eigentümerindex nutzen können. Siehe [Admin-Anfragen und `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` entfernt die Basisrichtlinie für Server oder Administratoren von jeder Tabelle. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` setzt zusätzlich `request.jwt.claims` und `request.jwt.claim.*`, sodass mit `auth.uid()` verfasste Richtlinien den Aufrufer erkennen. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Verhalten beim Start, wenn ein anderer Login in die Request-Rolle wechseln kann: `warn`, `refuse` oder `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Basispfad für alle API-Routen. Dem Client muss derselbe Pfad mitgeteilt werden – siehe [`basePath` ändern](#basepath-ändern). | `/api` |
| `REBASE_SERVE_STATIC` | Statische/Admin-Assets des Bundles von diesem Prozess aus bereitstellen. Deaktivieren Sie dies, wenn ein CDN vorgeschaltet ist. | `true` |
| `REBASE_STUDIO` | Das integrierte Admin-Panel unter `/_studio` bereitstellen, wenn sein statisches Bundle verfügbar ist: die Tabellen des Projekts als Collections, Benutzer und Rollen eingeschlossen, und das Studio. Damit wird ein Projekt ohne Code verwaltet. Auf `false` setzen zum Deaktivieren. | `true` |
| `REBASE_STUDIO_DIR` | Verzeichnis mit dem vorgefertigten Admin-Panel, das unter `/_studio` bereitgestellt wird. Standardmäßig `/studio` im Container-Image. | `/studio` |
| `REBASE_HISTORY` | [Änderungshistorie für Entitäten](/docs/backend/history) aufzeichnen. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli-Kompression für Antworten. | `true` |
| `REBASE_PUSH` | `true` aktiviert [Push-Benachrichtigungen](/docs/backend/push-notifications/): die `/api/push`-Routen, die Tabelle `rebase.push_subscriptions` und `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Das VAPID-Schlüsselpaar, mit dem Push-Nachrichten signiert werden. Außerhalb der Produktion wird bei Fehlen ein Paar generiert und in `.rebase-dev-secrets.json` gespeichert; in der Produktion bleibt Push ohne diese Schlüssel deaktiviert. | — |
| `REBASE_VAPID_SUBJECT` | Eine `mailto:`-Adresse oder `https://`-URL, über die die Push-Dienste Kontakt aufnehmen können. Standardmäßig die Origin einer `https`-`REBASE_PUBLIC_URL`. | — |
| `REBASE_MAX_BODY_SIZE` | Maximale Größe des Request-Bodys **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, bricht den Start ab, anstatt das Limit stillschweigend aufzuheben). `0` schaltet das Limit aus. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände möglich: Nicht gesetzt in jeder Umgebung: `/api/docs` wird den Aufrufern bereitgestellt, für die `GET /api/schema/tables` Tabellen beschreibt, jeweils mit den für sie sichtbaren Tabellen, und es gibt keine Swagger-UI. `true` veröffentlicht das gesamte Dokument für alle, mit der Swagger-**UI** unter `/api/swagger` außerhalb der Produktion (niemals in Produktion). `false` hält das Dokument hinter der Admin-Schranke. | — |
| `REBASE_DEPLOYMENT_ID` | Das Deployment, das dieser Prozess ausführt, wie die Plattform es benennt; wird in der Zeile genannt, die sagt, dass die Runtime lauscht. Rebase Cloud setzt sie. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt `includeSubDomains` zum `Strict-Transport-Security`-Header hinzu, sodass Browser reines HTTP auf jeder Subdomain des Hosts für sechs Monate verweigern – einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn ausnahmslos jede Subdomain der Domain ausschließlich HTTPS verwendet. Jeder andere Wert als `true`/`false` verweigert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn nicht gesetzt, bleibt der Endpunkt für jeden zugänglich, der den Port erreichen kann – in einem privaten Netzwerk in Ordnung, in einem öffentlichen nicht (der Start protokolliert dies entsprechend). | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start am Tabellenschema ändern darf. `ensure` (Standardwert überall – einschließlich Produktion) führt den **additiven** Durchlauf aus: Erstellt fehlende Tabellen, Spalten und Enum-Typen, löscht oder ändert jedoch niemals bestehende. `none` lässt das Schema der deklarierten Tabellen unverändert, die frameworkeigenen Tabellen (Auth, API-Keys, Jobs, Cron) werden jedoch weiterhin erstellt und aktuell gehalten; `REBASE_PROVISION=false` deaktiviert auch diese. Das veröffentlichte Image akzeptiert nur diese beiden Optionen und **verweigert den Start bei `push`**. In einem [Split-Deployment](/docs/deployment/split-processes) darf genau ein Prozess provisionieren, daher müssen alle anderen Rollen `none` setzen oder den Dienst verweigern. | `ensure` |
| `REBASE_PROVISION` | `false` bewirkt, dass die Runtime keinerlei Änderungen an der Datenbank vornimmt: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Policy, Rolle oder Berechtigung, weder beim Start noch später, einschließlich der frameworkeigenen Objekte. Stattdessen wird namentlich gemeldet, was fehlt. Gedacht für Datenbanken, die nur über Ihren eigenen Deployment-Prozess geändert werden dürfen. Siehe [Wenn nur Ihr Änderungsprozess die Datenbank verändern darf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Es werden nur `true` und `false` akzeptiert. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Verweigert den Start, wenn die Datenbank zuletzt mit einem anderen Satz von Tabellen provisioniert wurde, als für diesen Prozess kompiliert wurde. Wenn nicht gesetzt (oder ein anderer Wert als `true`/`1`), wird stattdessen gewarnt. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Verweigert den Start, wenn eine Funktions- oder Cron-Datei beim Importieren einen Fehler auslöst oder nicht geparst werden kann, unter Nennung der Datei und des Grundes. Dadurch bleibt bei einem Rolling Deployment die alte Version aktiv. Ein Neustart unterliegt denselben Regeln. Wenn nicht gesetzt (oder ein anderer Wert als `true`), wird die Datei übersprungen und der Rest bereitgestellt. Eine Datei, die fehlerfrei importiert wird, aber keine Funktion oder keinen Job exportiert, wird immer übersprungen und führt nicht zum Abbruch. | skip |
| `REALTIME_CDC` | Change Data Capture auf Datenbankebene: `auto` (Änderungen aus dem WAL lesen, wo die Datenbank dies zulässt, andernfalls Trigger verwenden, sonst Fallback auf Anwendungsebene; jeder Fallback wird als Info protokolliert), `trigger` (Trigger erzwingen, Warnung falls nicht möglich), `wal` (Änderungen aus dem Write-Ahead Log statt über Trigger lesen; erfordert `wal_level=logical` und eine replikationsberechtigte Rolle, fällt sonst auf `trigger` zurück), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Channels und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein expliziter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Subscriptions ein Realtime-Socket halten darf; weitere werden mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Wie viele Realtime-Sockets ein Benutzer oder ein API-Schlüssel auf einer Serverinstanz offenhalten darf. Imitierende Sockets eines Administrators werden dem Administrator angerechnet. Die Anmeldung eines weiteren Sockets wird mit `TOO_MANY_SOCKETS` abgelehnt und der Socket geschlossen (4002); das SDK versucht es erneut, sodass er sich verbindet, sobald ein anderer schließt. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Keine Obergrenze |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Maximale Zeitspanne in ms, die eine Änderung auf den Refetch wartet, der sie an aktive Abonnenten übermittelt. Ein Refetch wartet ohne weitere Änderungen 300 ms, bei einem stetigen Schreibfluss jedoch maximal diesen Wert. Eine positive ganze Zahl – jeder andere Wert stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Zeit in ms, für die die Gesamtzahl einer großen Listen-Subscription wiederverwendet werden darf, bevor sie neu gezählt wird; Frames, die den Wert wiederverwenden, enthalten `meta.totalAsOf`. Wenn nicht gesetzt, zählt jeder Frame neu. Hat Vorrang vor `realtime.recountIntervalMs`. | Nicht gesetzt |
| `REALTIME_RECOUNT_MIN_ROWS` | Die kleinste Gesamtzahl, ab der `REALTIME_RECOUNT_INTERVAL_MS` greift; kleinere Listen werden bei jedem Frame gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Erlaubt `localhost`/Loopback-Werte unter `NODE_ENV=production`. Standardmäßig deaktiviert, damit ein Produktionsstart deutlich fehlschlägt, statt sich mit einer nicht vorhandenen Datenbank zu verbinden. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet den Prozess, ohne einen Socket zu öffnen – das Format, das ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der nachfolgende Server. Es erstellt auch die Tabellen, die ein Serverprozess sonst bei der ersten Verwendung anlegen würde, und startet weder Cron noch Job-Queues. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein reguläres Deployment nicht versehentlich in einen Migrationslauf verwandeln kann. Zusammen mit `REBASE_PROVISION=false` nicht zulässig. | — |
| `REBASE_PROVISION_SQL_OUT` | Ein Dateipfad. Ein Provisioning-Lauf (`REBASE_PROVISION_ONLY=true`) schreibt jede durchgeführte Schemaänderung in chronologischer Reihenfolge als SQL-Skript zur Prüfung und manuellen Ausführung mit `psql` in diese Datei. Geschriebene Datenzeilen sind nicht enthalten. Auf einem Serverprozess, der Anfragen bedient, nicht zulässig. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt es Maschinen – etwa Agenten oder CI-Jobs –, Schemaänderungen über `/api/admin/schema` direkt *anzuwenden*, statt sie nur zu planen. Standardmäßig aus: Die Anmeldedaten für solche Änderungen liegen am ehesten in einer CI-Variable. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Maximale Ausführungszeit einer benutzerdefinierten Funktion, bevor ihr Request abgebrochen wird. Derselbe Parameter wie die Option `functionsTimeoutMs`. `0` deaktiviert das Limit. Eine Funktion, die ein eigenes Limit deklariert (`defineFunction(…, { timeoutMs })`), verwendet stattdessen dieses. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Maximales Timeout in ms, das eine Funktion mit `defineFunction(…, { timeoutMs })` für sich selbst definieren darf; fordert sie mehr an, greift dieser Wert. Eine positive Zahl; jeder andere Wert gilt als nicht gesetzt. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` bewirkt, dass eine unbehandelte Promise-Rejection den Prozess beendet, anstatt nur protokolliert zu werden. Empfohlen unter Orchestratoren, die den Container neu starten; deaktiviert lassen, wenn ein Neustart problematischer als ein Leak ist. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Unterdrückt die Startwarnung auf Plattformen, die von der Runtime als Scale-to-Zero erkannt werden (wo ein Timer in einer inaktiven Instanz gar nicht ausgelöst werden kann). Ändert sonst nichts: Setzen Sie dies, wenn Sie mindestens eine Instanz dauerhaft betreiben. | — |
| `TRUSTED_PROXY_HOPS` | Anzahl der vorgeschalteten Proxys vor diesem Server, damit der Rate Limiter die echte Client-Adresse aus `X-Forwarded-For` lesen kann. Ausfallsicherer Standardwert `0`: Ohne Proxy würde das Vertrauen in diesen Header jedem Aufrufer erlauben, eine falsche Identität vorzutäuschen. | `0` |

:::note[Das Boot-Provisioning ist additiv und kein Migrationstool]
Der Startdurchlauf erfolgt unbeaufsichtigt, ohne dass ein Entwickler ein Diff prüft.
Daher wird er niemals eine Spalte löschen, einen Typ einschränken oder eine Tabelle neu schreiben.
Aus diesem Grund lehnt das Image auch `REBASE_MIGRATE_ON_BOOT=push` ab: Ein vollständiger
Push berechnet ein Diff und führt bei Bedarf ein `DROP COLUMN` aus. Ein Container-Neustart
darf niemals im Rahmen einer Neuplanung versehentlich eine Produktionsspalte löschen können.

Destruktive oder restrukturierende Änderungen gehören an Orte, an denen sie überprüft werden können:
`rebase db generate` + `rebase db migrate` oder `rebase db push` aus einem Checkout oder einer CI,
welches die Änderungen vorab testet, destruktive Vorgänge ohne Bestätigung ablehnt und zuvor ein Backup erstellen kann.
:::

### Split-Deployments

Ein einzelnes Image und Bundle kann mehrfach gestartet werden, wobei jede Instanz einen anderen
Teil des Projekts bedient. Hier folgt je eine Zeile zur Übersicht; welche Kombinationen was
*bereitstellen und verwalten* – und welche Konfigurationen den Start verweigern –, erfahren Sie unter
**[Split Processes](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreibt, ob *dieser* Prozess die Cron-Timer ausführt. Wenn nicht gesetzt, richtet es sich nach der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreibt, ob dieser Prozess Job-Queue-Worker ausführt. Wenn nicht gesetzt, richtet es sich nach der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | In diesem Prozess ausschließlich die genannten benutzerdefinierten Funktionen ausführen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen mit Ausnahme der genannten ausführen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess Funktionsaufrufe weiterleitet, die er nicht selbst bedient. Auf einem `worker` das Ziel für dessen eigene Aufrufe von `rebase.functions`. Eine `http(s)`-URL. | — |

### MCP-Schnittstelle

Ein optionaler Model Context Protocol (MCP)-Endpunkt unter `/mcp`, über den ein KI-Client dieses Projekt
**als der angemeldete Benutzer** lesen und beschreiben kann. Standardmäßig deaktiviert, und – anders als
bei allen anderen Bereichen – schaltet keine `REBASE_ROLE` diesen Endpunkt automatisch ein: Die Rollen
beschreiben die Form des Prozesses, während dies die Entscheidung ist, Drittanbieter-Software Anmeldedaten
zu übergeben. Diese Entscheidung sollte von einem Menschen getroffen und nicht von der Funktion
eines Containers geerbt werden.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_MCP_ENABLED` | Stellt die MCP-Schnittstelle bereit. Erfordert `REBASE_PUBLIC_URL`; ohne diese verweigert der Endpunkt die Bereitstellung und vermerkt dies im Startprotokoll. | `false` |
| `REBASE_PUBLIC_URL` | Die extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Schnittstelle kann diese nicht ableiten – die Übernahme der Origin aus dem `Host`-Header würde dazu führen, dass die Aussteller-Identität und die Zielgruppe (Audience), gegen die Tokens geprüft werden, vom Aufrufer bestimmt werden könnten. | — |
| `REBASE_MCP_VIEW` | Pfad zur projekteigenen MCP-App-Ansicht (`rebase-view.html`, generiert von `rebaseMcpViewPlugin()`), die Claude anstelle der generischen Ansicht bereitgestellt wird, damit Ihre benutzerdefinierten Ansichten, Felder und Aktionen dargestellt werden. Fehlt die Angabe, sucht das Backend neben dem von ihm ausgelieferten Frontend. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Dynamische OAuth-Client-Registrierung (RFC 7591) erlauben, sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um eine Vorab-Registrierung von Clients zu erzwingen. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Deaktiviert, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes Bundle enthält keinen
`backend/schema`-Quellcode zum Bearbeiten. Sind diese Variablen gesetzt, liest der Schema-Editor den Quellcode
aus dem Repository, committet jede Änderung zurück und führt das entsprechende DDL auf dieser Datenbank aus.
Nur für Administratoren verfügbar und manuell durch eine Person ausgeführt, es sei denn,
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` erlaubt anderes. Ein angegebenes Repository ohne gültige
Anmeldedaten verhindert den Start. Siehe
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository, in das Schemaänderungen committet werden sollen, im Format `owner/name`. Das Setzen dieser Variablen aktiviert die Funktion. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, auf dem der Commit landet. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Speicherort von `backend/schema` in diesem Repository (relativ zum Repository-Stamm). Ein Pfad, der das Repository verlässt, verweigert den Start, ebenso wie das entfernte `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein fein abgestimmtes Token mit Lese- und Schreibzugriff auf die Inhalte des Repositorys. Setzen Sie entweder dies oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID einer GitHub App, um Commits als App statt über ein persönliches Token durchzuführen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installations-ID der App auf dem Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit maskierten Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Nicht gesetzt bedeutet, dass automatische Backups deaktiviert sind. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. Erforderlich zusammen mit `BACKUP_SCHEDULE`, welches ohne diesen Wert die Ausführung verweigert. `rebase db backup` greift standardmäßig auf `./backups` im Ausführungsverzeichnis zurück. | — |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Nicht gesetzt oder `0` behält alle Backups. | — |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens N der neuesten Backups behalten, unabhängig von den Aufbewahrungsregeln. | — |
| `PG_DUMP_PATH` | Überschreibt den Pfad zum `pg_dump`-Binary – dieses muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Überschreibt den Pfad zum `pg_restore`-Binary. | — |
| `PSQL_PATH` | Überschreibt das `psql`-Binary, das von `rebase db restore --clean` verwendet wird, um die Wiederherstellung in einer einzigen Transaktion durchzuführen. | — |
| `PG_DUMPALL_PATH` | Pfad zu `pg_dumpall`, falls es nicht im `PATH` liegt. Ohne diese Angabe – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einer Fehlermeldung fehl, die diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) enthält die Client-Tools von PostgreSQL 18,
sodass ein geplantes Backup darin gegen jeden Server bis Postgres 18 ausgeführt werden kann.
Außerhalb des Images müssen Sie diese selbst installieren (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups enthalten Secrets und personenbezogene Daten (PII). Verwenden Sie ein privates Ziel
mit serverseitiger Verschlüsselung (Encryption-at-Rest).

### Bundle-Bereitstellung

Ein verwaltetes Deployment enthält seinen Anwendungscode nicht im Image: Die Runtime ruft
beim Start ein Bundle ab. Die folgenden Variablen steuern, welches Bundle bezogen wird und wie.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Das, was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Bezugsquelle des Bundle-Archivs, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Die Bearer-Zugangsberechtigung für diesen Abruf. Wie ein Secret behandeln: Es autorisiert einen Mandanten zum Herunterladen seines eigenen Codes. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Zielverzeichnis zum Entpacken eines abgerufenen Bundles. Muss beschreibbar sein und den Zeitraum zwischen Abruf und Start überstehen. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image für das Bundle bereitstellt, über die selbst deklarierten hinaus. | — |

### Ressourcenbindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `backend/resources.ts` deklariert,
wird über gleichnamige Umgebungsvariablen gebunden. Die Basisnamen finden Sie unten; eine Ressource,
die nicht die Standardressource ist, hängt `__` und ihren Bezeichner in Großbuchstaben an. Ein Bucket
namens `media` liest demnach `S3_BUCKET__MEDIA`. `rebase status` gibt für jede Ressource die genaue Variable
aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, sofern es nicht der Standard-Postgres-Treiber ist. Erhält ein quellenspezifisches Suffix: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Erhält ein topic-spezifisches Suffix. | — |

### Die eigene Umgebung der CLI

Wird von `rebase` ausgewertet, nicht vom Server. Keine der folgenden Variablen beeinflusst ein Deployment.

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `REBASE_BASE_URL` | Zieladresse, an die `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service Key senden, entweder in der Shell oder in `.env`. Setzen Sie dies, wenn der Server auf andere Weise als über `rebase dev` in diesem Projekt läuft: `rebase start`, ein Container oder ein anderer Host. Wenn nicht gesetzt, verwenden diese Befehle den Server, den `rebase dev` hinterlegt hat, solange dieser aktiv ist, und senden andernfalls nichts. | — |
| `REBASE_SERVICE_KEY` | Der Service Key, mit dem sich diese Befehle authentifizieren, aus `.env` gelesen: dieselbe Variable, die auch der Server ausliest (siehe oben). | — |
| `SERVICE_KEY` | Ein älterer Name für diesen Schlüssel. Wenn in `.env` gesetzt, lesen `rebase api-keys` und `rebase storage` diesen anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Bestimmt, welche `.env`-Datei die CLI liest und schreibt, falls es nicht die des Projekts ist. | — |
| `REBASE_ROOT_RULES` | `0` verhindert, dass `rebase init` und `rebase skills install` die Projektregeln in die Dateien `CLAUDE.md` und `AGENTS.md` im Repository-Stammverzeichnis schreiben, falls Sie diese Dateien manuell pflegen möchten. | on |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, unter dem `rebase cloud login` die Anmeldung durchführt, anstatt interaktiv danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Das zugehörige Passwort, damit ein Secret-Manager dieses übergeben kann, ohne dass es in der Shell-Historie landet. | — |
| `REBASE_TOKEN` | Ein über `rebase cloud tokens create` erstelltes Token. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der Sitzung aus `rebase cloud login` und liest oder schreibt die gespeicherte Sitzung nicht. In einem Verzeichnis, das mit `rebase cloud init --claim` verknüpft wurde, wird es zugunsten des tokenspezifischen Tokens des Projekts zurückgestellt, wenn es keinen Gültigkeitsbereich für dieses Projekt besitzt. Dient zur Ausführung von `rebase cloud` in CI-Umgebungen – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) übergibt dies an die CLI, die seine Cloud-Tools starten, und sendet es nie an die App: Verwenden Sie dafür `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt den zugrundeliegenden Fehler und detaillierte Anfrageinformationen anstelle der Kurzmitteilung aus. Der erste Schritt zur Fehlerdiagnose, wenn ein `rebase cloud`-Befehl ohne aufschlussreiche Meldung fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle der temporären Datenbank `<db>_dev_diff`, die sie neben `DATABASE_URL` erstellen. Rebase erstellt oder löscht hier angegebene Datenbanken nicht und verweigert eine Angabe, die mit `DATABASE_URL` identisch ist. Bei der verwalteten Entwicklungsdatenbank setzt die CLI dies automatisch auf eine eigene temporäre In-Memory-PGlite-Instanz. Setzen Sie diese Variable dort, wo keine Rechte für `CREATE DATABASE` vorliegen. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und führt kein Provisioning durch – Sie stellen eine eigene Datenbank bereit. Entspricht `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixiert den Port des Frontend-Dev-Servers, den `rebase dev` ansonsten aus dem Projektpfad ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wartezeit in ms, die `rebase dev` auf die Rückmeldung des Backends wartet, bevor gemeldet wird, dass es nicht gestartet wurde. `0` schaltet den Bericht ab. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einsetzt. | — |
| `DO_NOT_TRACK` | Die toolübergreifende Konvention. Auf einen beliebigen Wert außer `0` gesetzt, sendet die CLI keinerlei Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe, spezifisch für Rebase. Erfordert keine Datei und eignet sich daher ideal für CI und Container-Images. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Ziel-URL für Telemetriedaten bei Verwendung eines selbst gehosteten Collectors. | — |
| `REBASE_NO_UPDATE_CHECK` | `1` verhindert, dass die CLI einmal täglich in einem Hintergrundprozess die npm-Registry (oder `npm_config_registry`) nach den Dist-Tags von `@rebasepro/cli` abfragt, und blendet den Hinweis „Rebase X is out; this CLI is Y“ aus, der sonst bei jedem Befehl außer `rebase upgrade` auf stderr ausgegeben wird. Das Ergebnis wird in `~/.rebase/release-check.json` gespeichert; die Anfrage sendet keine weiteren Daten. In CI-Umgebungen standardmäßig aus; `NO_UPDATE_NOTIFIER` bewirkt dasselbe. | — |
| `REBASE_RELEASE_NOTICE_SHOWN` | Wird von der CLI für die von ihr gestarteten Prozesse gesetzt, damit ein Unterbefehl den Hinweis „Rebase X is out“ nur einmal ausgibt. Wenn Sie diesen Wert manuell setzen, wird der Hinweis für diesen Prozess unterdrückt, genau wie bei `REBASE_NO_UPDATE_CHECK`. | — |

## Secrets in der Entwicklung

`JWT_SECRET` ist in der Produktion erforderlich. Dieser Schlüssel und `REBASE_SERVICE_KEY` werden
außerhalb der Produktion automatisch für Sie generiert, sodass Sie direkt ohne Konfiguration starten können.

Diese generierten Werte werden in `.rebase-dev-secrets.json` neben `.rebase-dev-port` und
`.rebase-dev-url` zwischengespeichert und wie diese per Git ignoriert. Zuvor wurden sie bei jedem Start neu
generiert – was dazu führte, dass ein Neustart des Dev-Servers Sie aus Ihrer eigenen App ausloggte und
jeden soeben erstellten API-Schlüssel ungültig machte.

- Setzen Sie eine der beiden Variablen explizit, wird Ihr Wert verwendet; es wird nichts zwischengespeichert oder gelesen.
- Mit `REBASE_DEV_SECRETS_FILE` können Sie den Cache auf einen anderen Pfad umleiten – die einzige Variable in diesem Abschnitt, die Sie jemals bewusst konfigurieren würden.
- Löschen Sie die Datei, um beide Secrets zu rotieren. Beim nächsten Start wird eine neue Datei angelegt.
- Kann die Datei nicht geschrieben werden – etwa in einem schreibgeschützten Container –, startet der Server dennoch mit einem flüchtigen Secret, exakt wie zuvor.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion
wird zudem nichts automatisch generiert: Ein Start ohne `JWT_SECRET` schlägt unter Nennung der Variablen fehl:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Backend-Konfigurationsobjekt

Das `RebaseBackendConfig`-Objekt, das an `initializeRebaseBackend()` übergeben wird, ermöglicht die programmatische Konfiguration:

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

Dieselben Optionen – ohne `app`, `server` und `basePath`, aber mit einem erforderlichen `provision`-Parameter –
bauen ein Backend auf, das erst dann Anfragen bedient, wenn Sie es einbinden: `createRebaseBackend`. Siehe
[Benutzerdefinierte Serverintegration](/docs/backend/custom-server/).

### `basePath` ändern

`basePath` verschiebt jede API-Route, daher muss der Client entsprechend konfiguriert werden –
andernfalls fragt er weiterhin `/api/...` an und erhält für jeden Aufruf einen 404-Fehler:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Das Admin-Panel übernimmt diesen Pfad automatisch aus dem übergebenen Client; weitere Konfigurationsschritte sind
nicht erforderlich. Wenn Sie eine Anfrage-URL manuell zusammensetzen, leiten Sie diese vom Client ab,
anstatt `/api` manuell fest zu kodieren:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### SQL-Editor: Zugriff verweigert (`permission denied for table <name>`)

* **Symptome:** Benutzerdefinierte Abfragen, die im SQL-Editor von Rebase Studio ausgeführt werden, schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellenansicht (Spreadsheet CMS) Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, SQL-Editor-Abfragen auszuführen, indem temporär die Datenbankrolle gewechselt wird, um sie an die Anwendungsrolle des aktiven Benutzers anzupassen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung nutzen, bei der Rollen nur in Datenbanktabellen und nicht als echte PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankprivilegien. Die CMS-Tabellenansicht wird unter dem Standard-Verbindungseigentümer ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase dazu, Abfragen im SQL-Editor mit den Rechten des Verbindungseigentümers (in der Regel ein Superuser/Owner) auszuführen. Der SQL-Editor weist dann oberhalb der Ergebnisse darauf hin, dass diese als Verbindungseigentümer gelesen wurden, und deaktiviert die Rollenauswahl.

### Schema-Abruf im SQL-Editor fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden, oder der SQL-Editor gibt den Fehler `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.` aus.
* **Ursache:** Rebase benötigt administrative Berechtigungen, um Systemkataloge der Datenbank abzufragen und administrative Befehle auszuführen. Wenn dem Bootstrapper kein `adminConnectionString` übergeben wird oder `getAdmin()` so überschrieben ist, dass es `undefined` zurückgibt, schlagen diese Vorgänge fehl.
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

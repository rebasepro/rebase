---
sourceHash: 69431837d4a9e199
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projektstammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Wenn
> etwas Erforderliches fehlt oder fehlerhaft formatiert ist (eine URL, die keine URL ist, ein Port, der
> keine Zahl ist), verweigert der Server den Start und benennt die Variable.
>
> Wo das Schema liegt, hängt davon ab, wie Sie das Backend ausführen. Ein durch
> die Runtime gestartetes Projekt – `rebase dev`, `rebase start`, das veröffentlichte Image – verwendet
> das Schema, das der Runtime gehört (`loadBootEnv` in `@rebasepro/server`), welches die
> Vereinigung aller unten aufgeführten Tabellen darstellt. Ein Projekt, das [`rebase eject`](/docs/cli) ausgeführt hat,
> besitzt eine `backend/src/env.ts`, die `loadEnv({ extend })` aufruft, und kann dort eigene
> typisierte Variablen hinzufügen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge. **In der Entwicklung optional** – wenn nicht gesetzt, führt `rebase dev` ein verwaltetes PostgreSQL für das Projekt aus, dessen Daten unter `.rebase/` liegen. Überall sonst erforderlich. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimschlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). **In der Produktion erforderlich** (in der Entwicklung automatisch generiert). | `a1b2c3d4e5...` |

> **Bei einer Managed Database bedeutet `sslmode=require` möglicherweise nicht das, wonach es aussieht.**
>
> Für `psql` und jedes libpq-Tool bedeutet `require` „verschlüsselt, Zertifikat nicht
> überprüft“. Der Node-Treiber, auf dem Rebase läuft, interpretiert dies als `verify-full`. Eine
> Datenbank, deren Zertifikat von keiner öffentlichen Zertifizierungsstelle signiert wurde – was bei Managed
> Postgres häufig vorkommt –, verweigert der Runtime daher die Verbindung mit `self-signed certificate`, während `psql`
> sich mit derselben URL verbindet. Die Runtime und `rebase db`-Befehle brechen mit einer
> entsprechenden Meldung ab.
>
> Wählen Sie eine der Optionen:
>
> - **`sslmode=no-verify`** – verschlüsselt, nicht überprüft: was `require` für
>   libpq bedeutet. Dies ist eine Schreibweise von node-postgres, die libpq nicht kennt, daher lehnen `psql`, `pg_dump`
>   und Atlas dies mit `invalid sslmode value: "no-verify"` ab. Die Rebase-eigenen
>   Befehle (`rebase db push`, `rebase db backup`, `rebase db restore`) übergeben es
>   an diese als `sslmode=require`, sodass sie mit der konfigurierten URL funktionieren; für
>   manuelle Aufrufe mit `psql` ersetzen Sie es durch `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** – anhand des CA-Zertifikats
>   des Anbieters geprüft. Für jedes Tool gleich.
>
> `uselibpqcompat=true&sslmode=require`, was in der Warnung des Node-Treibers selbst
> vorgeschlagen wird, funktioniert auch für die Runtime; Rebase-Befehle entfernen `uselibpqcompat`,
> bevor sie die URL an libpq-Tools übergeben, die dies ablehnen würden.

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das typisierte SDK. **Nur in der Entwicklung setzen** – siehe unten. | Origin der Seite |
| `VITE_GOOGLE_CLIENT_ID` | Google-OAuth-Client-ID. Aktiviert „Mit Google anmelden“. | — |


> **Lassen Sie `VITE_API_URL` in Produktions-Builds ungesetzt.**
>
> In der Entwicklung sind Frontend und Backend getrennte Origins, daher injiziert der
> Dev-Server diesen Wert. In der Produktion liefert das Rebase-Backend die SPA aus, sodass die
> API der Origin der Seite selbst ist und der Client sie von selbst so auflöst.
>
> Das feste Einbetten einer absoluten URL in ein Produktions-Bundle funktioniert genau so lange,
> bis ein zweiter Hostname auf dieselbe App zeigt: Eine benutzerdefinierte Domain lädt die Seite dann von
> `example.com` und ruft die API unter `example.rebase.website` auf, was
> Cross-Origin ist, sodass jeder Request beim Preflight fehlschlägt. Den Origin in CORS zu erlauben,
> behebt dies ebenfalls **nicht** – das Refresh-Cookie ist `SameSite=Lax` und wird
> nicht Cross-Site gesendet. Sie würden also die Konsolenfehler beseitigen, hätten aber immer noch eine fehlerhafte
> Authentifizierung. Wenn die Variable nicht gesetzt ist, funktioniert jede Domain, die auf die App verweist,
> ganz ohne CORS-Konfiguration.

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server. Wird von `rebase start` gelesen. `rebase dev` liest ihn **nur aus der Shell-Umgebung** – ein `PORT` in `.env` wird dort nicht gelesen, da der Port aufgelöst wird, bevor diese Datei geladen wird – und bindet andernfalls einen vom Projektpfad abgeleiteten Port, sodass mehrere Projekte gleichzeitig ausgeführt werden können. `rebase dev --port` überschreibt beides, und das Startbanner gibt die verwendete Methode an. | `3001` |
| `LOG_LEVEL` | Logging-Ausführlichkeit: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Zeigt das SQL hinter einer `Failed query: [redacted]`-Zeile an. Jedes fehlschlagende Statement wird standardmäßig geschwärzt, da eine fehlgeschlagene Abfrage ihre gebundenen Parameter enthält – eine E-Mail, einen Passwort-Hash. Setzen Sie dies auf `true`, während Sie einen DDL-, RLS- oder Change-Capture-Fehler diagnostizieren. Wird ignoriert, wenn `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Umgebung: `development`, `production` oder `test` | `development` |
| `CORS_ORIGINS` | Kommagetrennte Liste der zulässigen Origins. **In der Produktion erforderlich**, es sei denn, `FRONTEND_URL` ist gesetzt: Ein Produktionsstart ohne beides verweigert den Dienst. In der Entwicklung wird dies zu localhost *hinzugefügt* – siehe unten. | — |
| `FRONTEND_URL` | URL der Frontend-App. Wird in beiden Umgebungen als Alternative zu CORS_ORIGINS verwendet. | — |
| `ADMIN_CONNECTION_STRING` | Datenbank-Verbindungszeichenfolge auf Admin-Ebene (wird für Schema-Introspektion und Admin-Operationen verwendet). Die darin angegebene Datenbank ist weder diejenige, die die SQL-Konsole als aktuell bezeichnet, noch das, was ein neuer Branch standardmäßig kopiert: Beides ist die Datenbank, auf der die Verbindung der App selbst liegt (siehe `REBASE_BRANCH_PARENT_DATABASE` für einen Server auf einem Branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deaktiviert den Wechsel von PostgreSQL-Rollen im SQL-Editor (nützlich für benutzerdefinierte Authentifizierung, bei der DB-Rollen nicht zugeordnet sind). Die SQL-Konsole von Studio zeigt dann an, dass die Zeilen als Verbindungsinhaber gelesen wurden, benennt diesen und graut dessen Rollenauswahl aus. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Die Datenbank, von der der Branch kopiert wurde, auf dem dieser Server läuft. `rebase dev` setzt dies bei einem Checkout, der [auf einen Branch gewechselt](/docs/backend/branching/#cli-integration) ist. Ein Server mit dieser Variable behält die Branch-Registry auf dieser Datenbank und kopiert neue Branches standardmäßig davon, sodass der Branches-Bereich von Studio die Branches der Hauptdatenbank anzeigt. | — |

#### CORS in der Entwicklung

In der Entwicklung ist **localhost sowie alles, was `CORS_ORIGINS` (oder `FRONTEND_URL`)
benennt**, erlaubt – dieselbe Liste, die die Produktion verwendet, wobei localhost hinzugefügt statt
ersetzt wird. Die Variable funktioniert also in beiden Umgebungen auf dieselbe Weise, und die
Fälle, in denen sie in der Entwicklung benötigt wird, sind die üblichen:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Ein Origin, der weder localhost noch aufgeführt ist, wird abgewiesen, und die Abweisung wird
**einmal pro Origin** mit der genauen Zeile protokolliert, die ihn zulassen würde. Die Abweisung ist
keine Vorsicht um ihrer selbst willen: Die API sendet Anmeldeinformationen (Credentials). Ein willkürliches Spiegeln eines
beliebigen `Origin` würde es also jeder Website, die der Entwickler zufällig besucht, ermöglichen, mit dessen
Session authentifizierte Anfragen an den Dev-Server zu stellen und die Antworten zu lesen.

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Geheimnis für die JWT-Signierung (in Produktion erforderlich, in Entwicklung automatisch generiert) | — |
| `JWT_PRIVATE_KEY` | Privater PEM-Schlüssel zum asymmetrischen Signieren von Zugriffstokens (RS256), sodass jede Entität mit dem JWKS eine Sitzung verifizieren kann, ohne selbst Tokens erstellen zu können. Akzeptiert ein PEM mit echten Zeilenumbrüchen, ein PEM mit `\n`-Escapes oder Base64 des gesamten PEMs. Ohne diesen Schlüssel bleiben Tokens HS256. | — |
| `JWT_KEY_ID` | Benennt `JWT_PRIVATE_KEY` im Token-Header und im JWKS. Ändern Sie dies immer, wenn sich der Schlüssel ändert – die Schlüsselrotation erfordert, dass alt und neu unterscheidbar sind. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Access-Tokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens. Gleitend – jede Rotation verlängert ihn, sodass dies steuert, wie lange eine Sitzung **Inaktivität** übersteht. Setzen Sie `400d` für Sitzungen, die eine lange Abwesenheit überdauern sollen; Browser deckeln das Refresh-Cookie bei diesem Wert. | `30d` |
| `ALLOW_REGISTRATION` | Erlaubt neuen Benutzern die Registrierung (`true`/`false`). Außerhalb der Produktion kann sich der **erste** Benutzer immer registrieren, unabhängig von dieser Einstellung – eine leere Benutzertabelle muss jemanden zulassen, und dieser wird zum Administrator. In der Produktion (`NODE_ENV=production`) ist dieses Fenster geschlossen: Eine leere Tabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein erster über die offene Registrierung erstellter Account ist ein normaler Account, und der Administrator wird unten mit `REBASE_ADMIN_EMAIL` benannt oder über den Service-Key zugewiesen. Die `.env.example` des Scaffolds setzt dies auf `true`; der Framework-Standard ist deaktiviert (`false`). | `false` |
| `DISABLE_SELF_REGISTRATION` | Notfallschalter (Kill Switch). Schließt das Erstbenutzer-Bootstrap-Fenster, das `ALLOW_REGISTRATION=false` außerhalb der Produktion bewusst offen lässt, sodass die Registrierung selbst bei einer leeren Datenbank geschlossen ist. Kombinieren Sie dies unten mit `REBASE_ADMIN_EMAIL`, da das Deployment sonst keine Möglichkeit hat, seinen ersten angemeldeten Aufrufer zu erzeugen. Jedes ausgelieferte Deployment-Artefakt setzt dies. | — |
| `REBASE_ADMIN_EMAIL` | E-Mail des ersten Admin-Kontos, das beim Start erstellt wird, **solange die Benutzertabelle noch leer ist**, und danach nie wieder. Auf diese Weise erhält ein Produktions-Deployment seinen Administrator: Der Betreiber benennt das erste Konto, anstatt mit dem Internet um die Wette zu laufen. Der Start warnt, wenn die Tabelle in der Produktion leer und diese Variable nicht gesetzt ist. | — |
| `REBASE_ADMIN_PASSWORD` | Passwort für dieses Konto. Mindestens 12 Zeichen, andernfalls wird es abgelehnt und das Konto nicht erstellt. Ändern Sie es nach der ersten Anmeldung. | — |
| `MFA_ENCRYPTION_KEY` | Verschlüsselt jedes gespeicherte TOTP-Geheimnis. Wenn nicht gesetzt, werden die Geheimnisse stattdessen mit `JWT_SECRET` verschlüsselt und der Start warnt einmal – eine Rotation von `JWT_SECRET` meldet somit alle ab *und* führt dazu, dass jeder registrierte Authentifikator nicht mehr entschlüsselt werden kann. Setzen Sie einen dedizierten Schlüssel (32+ Zufallszeichen), bevor sich jemand registriert. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | Der Schlüssel, von dem *weg* rotiert wird. Setzen Sie während einer Rotation beide: Neue Geheimnisse werden mit `MFA_ENCRYPTION_KEY` geschrieben und bestehende bleiben lesbar, sodass niemand während der Rotation aus seinem Konto ausgesperrt wird. Entfernen Sie ihn, sobald jedes Geheimnis neu verschlüsselt wurde. | — |
| `ALLOW_ANONYMOUS` | Aktiviert die anonyme Anmeldung (`POST /api/auth/anonymous`). Opt-in und bewusst nicht an `ALLOW_REGISTRATION` gekoppelt. | `false` |
| `AUTH_REQUIRE` | Authentifizierung für die Daten-API verlangen. Auf `false` setzen für eine vollständig öffentliche Leseoberfläche – RLS gilt weiterhin. | `true` |
| `AUTH_DEFAULT_ROLE` | Rolle, die einem neu registrierten Benutzer zugewiesen wird, wenn keine angegeben ist. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Hängt `POST /api/auth/find-user` ein, das eine E-Mail in ein minimales öffentliches Profil (`uid`, `displayName`, `photoURL`) für Einladungs-Flows per E-Mail auflöst. Nur für authentifizierte Aufrufer, und es gibt niemals die E-Mail, Rollen oder Metadaten des gefundenen Benutzers zurück. Standardmäßig deaktiviert: Es stellt eine Angriffsfläche für Aufzählungen (Enumeration) dar. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` für das Refresh-Cookie: `Strict`, `Lax` oder `None`. `None` erfordert HTTPS und ist nur für ein echtes Cross-Site-Frontend gedacht. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` für das Refresh-Cookie. Standardmäßig sicher; `AUTH_COOKIE_SECURE=false` für einfaches HTTP – ein Deployment auf einer LAN-Adresse, wo der Browser das Cookie andernfalls verwerfen würde und die Sitzung beim Ablauf des Access-Tokens ohne Fehlermeldung enden würde. Warnt beim Start. `http://localhost` benötigt dies nicht. | `true` |
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
| `APPLE_CLIENT_ID` | Apple Services ID für Web-Anmeldungen. Diese ist öffentlich und wird in `GET /auth/config` veröffentlicht. Apple hat kein statisches Client-Secret, da Rebase für jeden Token-Austausch ein kurzlebiges ES256-JWT signiert. Daher benötigt Apple `APPLE_TEAM_ID`, `APPLE_KEY_ID` und `APPLE_PRIVATE_KEY` sowie dies oder `APPLE_BUNDLE_IDS` und konfiguriert ohne diese Angaben nichts. | — |
| `APPLE_BUNDLE_IDS` | Kommagetrennte Bundle-IDs der nativen iOS/macOS-Apps, deren „Mit Apple anmelden“-Codes akzeptiert werden. | — |
| `APPLE_TEAM_ID` | Apple Developer Team-ID, der Aussteller des JWTs. | — |
| `APPLE_KEY_ID` | Schlüssel-ID des bei Apple registrierten privaten Schlüssels. | — |
| `APPLE_PRIVATE_KEY` | Inhalt der privaten `.p8`-Schlüsseldatei inklusive Zeilenumbrüchen (`\n`-Escapes werden akzeptiert). | — |
| `REBASE_SERVICE_KEY` | Statischer Admin-API-Schlüssel. Umgeht die normale JWT-Authentifizierung für Server-zu-Server-Aufrufe, wenn er als `Authorization: Bearer <key>` übergeben wird. (In der Entwicklung automatisch generiert). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Der öffentliche Schlüssel der Hosting-Plattform (PEM, EC P-256), gegen den `rpt_`-Plattform-Tokens verifiziert werden; mehrere PEM-Blöcke während einer Schlüsselrotation. Die Plattform setzt ihn beim Deployment und er enthält keine Geheimnisse. Zusammen mit `REBASE_PLATFORM_TOKEN_AUDIENCE` ermöglicht er dem Admin-Gate, ein Plattform-Token für `cron:read` zu akzeptieren, und für sonst nichts. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Die Projekt-ID, mit der die `aud` eines Plattform-Tokens übereinstimmen muss, damit ein für ein anderes Projekt erstelltes Token abgewiesen wird. Wenn nur eine der beiden Variablen gesetzt ist, startet der Server, protokolliert eine Warnung und beantwortet jedes `rpt_`-Token mit `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Wo Rate-Limit-Zähler gespeichert werden, für die Auth-Routen und für `rateLimit` in benutzerdefinierten Funktionen: `memory` (pro Prozess) oder `sql` (über Replikate hinweg geteilt). Ein Prozess kann seine eigene Replikatanzahl nicht sehen, daher muss ein Deployment mit Peers dies angeben – drei Replikate mit dem Standardwert erzwingen das Dreifache des Limits. Jeder andere Wert **verhindert den Start**, anstatt auf einen Fallback zurückzugreifen, einschließlich `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Mountet den passwortlosen Magic-Link-Anmelde-Flow. Erfordert einen konfigurierten E-Mail-Dienst, da der Link sonst nirgendwohin gesendet werden kann. | `false` |
| `AUTH_EMAIL_OTP` | Mountet die passwortlose Anmeldung mit einem sechsstelligen Code, der per E-Mail gesendet wird. Gleiche E-Mail-Anforderung wie oben. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Passwortlose Registrierung: Eine Magic-Link- oder E-Mail-Code-Anfrage für eine unbekannte Adresse erstellt das Konto, solange die Registrierung geöffnet ist. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Verhalten, wenn ein Refresh-Token nach Ablauf seines Wiederverwendungsfensters erneut eingereicht wird: `reject` (ablehnen, Sitzung beibehalten) oder `revoke-session` (Sitzung beenden). Jeder andere Wert lässt den Start fehlschlagen. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrierung mit vorheriger Bestätigung: Keine Passwortanmeldung möglich, bis die Adresse bestätigt wurde. Benötigt E-Mail; der Start wird ohne abgelehnt. | `false` |
| `CAPTCHA_PROVIDER` | Aktiviert die Captcha-Verifizierung auf den Auth-Routen: `turnstile` oder `hcaptcha`. Nicht gesetzt bedeutet kein Captcha. | — |
| `CAPTCHA_SECRET` | Das Secret des Anbieters, das serverseitig zur Überprüfung des vom Browser gesendeten Tokens verwendet wird. Erforderlich, sobald `CAPTCHA_PROVIDER` gesetzt ist. | — |
| `CAPTCHA_ROUTES` | Kommagetrennte Liste der zu schützenden Auth-Routen (z. B. `register,login`). Nicht gesetzt schützt die Standardauswahl des Anbieters. | — |

### Speicher

:::caution[Speicher verfügt über keine Row-Level Security und benötigt daher ein Zugriffsmodell]
Tabellen werden durch Postgres RLS geschützt. Objektspeicher hat kein Äquivalent –
Schlüssel teilen sich einen einzigen flachen Namensraum. Wenn ein Bucket konfiguriert ist und kein Zugriffsmodell
existiert, **verweigert der Server in der Produktion den Start**. Erfüllen Sie dies mit genau einer der folgenden Optionen:
einem aus `backend/storage.ts` exportierten `storageAuthorize`-Hook (wird mit dem Scaffold
ausgeliefert), `STORAGE_PUBLIC_READ` oder `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Storage-Backend: `local`, `s3` oder `gcs`. In der Produktion deaktiviert `local` den Speicher, es sei denn, `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher. Ein relativer Pfad wird von dem Verzeichnis aus gelesen, in dem der Server läuft: das Projektstammverzeichnis unter `rebase dev`, `backend/` in einem von `rebase eject` erstellten Server | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Lokalen Speicher in der Produktion zulassen – nur mit einem persistenten Volume, das `STORAGE_PATH` und die daneben liegenden Verzeichnisse `<STORAGE_PATH>__<key>` benannter lokaler Buckets enthält | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Sekunden, die die Download-URL einer privaten Datei gültig ist – das Token, das `getSignedUrl()` darin einbettet. Maximal `604800` (eine Woche) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Größte Datei, die die Quelle akzeptiert, in Bytes, auf jedem Upload-Pfad – `__<KEY>` für eine benannte Quelle. Ein Wert, der keine ganze Zahl an Bytes ist, verweigert den Start | `52428800` (50 MB) |
| `S3_BUCKET` | Name des S3-Buckets (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS-Zugriffsschlüssel | — |
| `S3_SECRET_ACCESS_KEY` | Geheimer AWS-Schlüssel | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2 usw.) | — |
| `S3_FORCE_PATH_STYLE` | Pfadbasierte URLs für S3-Buckets erzwingen (`true`/`false`) | `false` |
| `GCS_BUCKET` | Name des GCS-Buckets (wenn `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP-Projekt. Wird normalerweise aus den Anmeldedaten abgeleitet. | — |
| `GCS_KEY_FILENAME` | Pfad zu einer Dienstkonto-Schlüsseldatei (Service Account Key). Auf GCP weglassen, wo Workload Identity die Anmeldedaten bereitstellt. | — |
| `STORAGE_PUBLIC_READ` | Liefert jedes Objekt für jeden ohne Token aus. Nur für einen Bucket gedacht, der tatsächlich ein öffentliches CDN ist. Eine der drei Möglichkeiten, die Startprüfung unten zu erfüllen. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Erlaubt jedem angemeldeten Aufrufer, jedes Objekt zu lesen, zu schreiben, aufzulisten und zu löschen. Im Konfigurationsobjekt aus gutem Grund als `INSECURE` bezeichnet: Dies ist nur in einer Single-Tenant-Anwendung vertretbar, in der jedem Konto jede Datei anvertraut werden kann. | `false` |
| `STORAGE_RENDITION_CACHE` | Generierte Bildvarianten (Größenänderungen, Formatkonvertierungen) zwischenspeichern, anstatt sie pro Anfrage neu zu erstellen. | `false` |

### E-Mail (Optional)
<span class="since-badge" data-since="0.34">Seit 0.34</span> `MAGIC_LINK_URL`.

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
| `EMAIL_LOGO_URL` | Logo, das über den Standard-E-Mail-Vorlagen angezeigt wird. Absolute `http(s)`-PNG- oder JPG-Datei – Clients entfernen SVG und blockieren `data:`-URIs. Wenn nicht gesetzt, erhält eine noch `Rebase` genannte App das Rebase-Zeichen und eine umbenannte App keines |
| `MAGIC_LINK_URL` | Wohin ein per E-Mail gesendeter Magic Link zeigt. An eine Basis wird `/auth/magic-link?token=…` angehängt; eine URL, die `{token}` enthält, stellt den gesamten Link dar, für ein Frontend, das `/auth/magic-link` nicht bedient. In `.env` in Anführungszeichen setzen, wo ein `#` ohne Anführungszeichen einen Kommentar beginnt: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Bei einem Wert mit einem Hash oder einem Dateipfad ohne `{token}` wird beim Start gewarnt. Wenn nicht gesetzt, ist die Basis `FRONTEND_URL` |

### Datenbank-Verbindungspool

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximale Anzahl gepoolter Verbindungen | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisekunden, die eine ungenutzte Verbindung aufrechterhalten wird | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisekunden, die auf eine Verbindung gewartet wird | `10000` |
| `DATABASE_DIRECT_URL` | Direkte (nicht gepoolte) Verbindung. [Realtime](/docs/backend/realtime) benötigt eine solche: `LISTEN`/`NOTIFY` funktioniert nicht über einen Transaktions-Pooler wie PgBouncer, und ohne sie werden Änderungsbenachrichtigungen mit einer Warnung deaktiviert, statt unbemerkt verloren zu gehen. Der [Job-Worker](/docs/backend/jobs) hält sein Aufwach-`LISTEN` ebenfalls darüber. Füllt `directConnectionString` des Postgres-Adapters, wenn dieser nicht gesetzt ist. | — |
| `DATABASE_READ_URL` | Read-Replikat, z. B. ein Hot-Standby. Wenn dies einen anderen Server benennt, werden authentifizierte Lesezugriffe (Listen, Einzelzeilen, Zählungen, Aggregate) dort unter derselben Row-Level Security bedient; Schreibzugriffe, Anmeldung, Realtime, Cronjobs, Jobs, die SQL-Konsole und `rebase.sql` verbleiben auf der primären Datenbank. Ein lesender Benutzer, der gerade geschrieben hat, liest für `REBASE_READ_STICKY_MS` von der primären Datenbank, und alle tun dies, während das Replikat mehr als `REBASE_READ_MAX_LAG_MS` hinterherhinkt oder fehlschlägt. Füllt `readConnectionString` des Postgres-Adapters, wenn dieser nicht gesetzt ist; bis einschließlich 0.28 wurde der Pool des Replikats geöffnet, aber nie daraus gelesen. | — |
| `REBASE_READ_STICKY_MS` | Wie lange Leseanfragen desselben Benutzers nach einem Schreibvorgang an die primäre Datenbank gehen, damit ein Speichern gefolgt von einer Listenansicht die gespeicherten Daten anzeigt. Pro Server-Instanz. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Replikat-Verzögerung (Lag), ab der jeder Lesevorgang an die primäre Datenbank geht. | `1000` |
| `DATABASE_POOLED` | `true`, wenn `DATABASE_URL` über einen Pooler im Transaktionsmodus wie PgBouncer läuft. Der Pool sendet dann beim Verbindungsaufbau kein `search_path` oder `statement_timeout` (der Pooler würde diese ablehnen oder verwerfen) und setzt beides in jeder Transaktion; der Start weist der Datenbankrolle einen Standard-`search_path` von `public` für Anweisungen außerhalb einer Transaktion zu. `DATABASE_DIRECT_URL` wird dadurch erforderlich, und Realtime, das Aufwecken des Job-Workers, Indexerstellungen, Branching und die SQL-Konsole verwenden diese. Die URL des Replikats wird ebenfalls als gepoolt angenommen. `DATABASE_POOLED__<KEY>` für eine weitere Datenquelle. | — |
| `REBASE_DB_POOL_MAX` | Eine Obergrenze für jeden Pool im Prozess, unabhängig davon, was der jeweilige Pool angefordert hat. Nur reine Ziffern: Ein fehlerhafter Wert wird ignoriert, anstatt den Server stillschweigend zu serialisieren. | — |

### Laufzeitverhalten

Wird von der Runtime gelesen – `rebase dev`, `rebase start` und dem veröffentlichten
Server-Image. Ein Projekt, das `eject` ausgeführt hat, steuert diese Entscheidungen stattdessen im eigenen Code.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` führt das geplante [Row-Level-Security-Audit](/docs/rls-check#running-it-on-a-schedule) aus, das Tabellen meldet, die ohne Richtlinien bereitgestellt werden. Das Projekt muss `@rebasepro/rls-check` in seinen Abhängigkeiten deklarieren: Die Runtime liefert keine Kopie mit, und ohne das Paket bricht der Start unter Nennung des Pakets ab. `false` hält den Scan auf diesem Prozess deaktiviert. | — |
| `REBASE_RLS_REQUEST_ROLE` | Die Postgres-Rolle, unter der authentifizierte und anonyme Anfragen ausgeführt werden. Weisen Sie jedem Projekt auf einem gemeinsam genutzten Cluster eine eigene zu. Eine Datenbank speichert die Rolle, unter der sie ausgeführt wird, und ein Start, der für eine andere Rolle konfiguriert ist, verweigert den Start, bis `rebase db request-role migrate` sie verschiebt. Siehe [Ausführen auf einer bestehenden oder gemeinsam genutzten Datenbank](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` erstellt die Request-Rolle und ermöglicht es der Verbindung, zu dieser zu wechseln; `never` überlässt beides Ihnen und überprüft sie nur. | `auto` |
| `REBASE_RLS_GRANTS` | Was Rebase der Request-Rolle gewährt: `schema` (jede Tabelle in den bereitgestellten Schemas plus Standardprivilegien), `managed` (nur die Tabellen, die es bereitstellt) oder `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` beschränkt die permissiven Richtlinien von Rebase auf die Request-Rolle(n), sodass andere Rollen, die dieselben Tabellen lesen, nichts davon erhalten. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` schreibt die Richtlinien, die nur der Serverkontext oder ein Admin erfüllen kann, `TO public` und führt Admins als Request-Rolle aus. Standardmäßig lauten sie `TO rebase_admin`, sodass eigentümergeführte Lesezugriffe angemeldeter Benutzer den Eigentümerindex nutzen können. Siehe [Admin-Anfragen und `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` entfernt die Server-oder-Admin-Basisrichtlinie von jeder Tabelle. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` setzt zusätzlich `request.jwt.claims` und `request.jwt.claim.*`, sodass mit `auth.uid()` geschriebene Richtlinien den Aufrufer sehen. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Was beim Start geschieht, wenn ein anderes Login in die Request-Rolle wechseln kann: `warn`, `refuse` oder `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Basispfad für jede API-Route. Dem Client muss dasselbe mitgeteilt werden – siehe [Ändern von `basePath`](#ändern-von-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Liefert die statischen/Admin-Assets des Bundles von diesem Prozess aus. Deaktivieren Sie dies, wenn ein CDN davor geschaltet ist. | `true` |
| `REBASE_HISTORY` | Zeichnet den [Änderungsverlauf von Entitäten](/docs/backend/history) auf. | `true` |
| `REBASE_COMPRESSION` | gzip/brotli-Antworten. | `true` |
| `REBASE_PUSH` | `true` aktiviert [Push-Benachrichtigungen](/docs/backend/push-notifications/): die `/api/push`-Routen, die Tabelle `rebase.push_subscriptions` und `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Das VAPID-Schlüsselpaar, mit dem Push-Nachrichten signiert werden. Außerhalb der Produktion wird ein Paar generiert und in `.rebase-dev-secrets.json` gespeichert, wenn es nicht gesetzt ist; in der Produktion bleibt Push ohne diese Angaben deaktiviert. | — |
| `REBASE_VAPID_SUBJECT` | Eine `mailto:`-Adresse oder `https://`-URL, die die Push-Dienste kontaktieren können. Standardmäßig der Origin einer `https`-`REBASE_PUBLIC_URL`. | — |
| `REBASE_MAX_BODY_SIZE` | Maximaler Request-Body **in Bytes** (`10485760`, nicht `10MB` – ein Wert, der keine Zahl ist, verweigert den Start, anstatt das Limit stillschweigend aufzuheben). `0` schaltet das Limit aus. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Die OpenAPI-Oberfläche. Drei Zustände. Nicht gesetzt, in jeder Umgebung: `/api/docs` wird den Aufrufern bereitgestellt, für die `GET /api/schema/tables` Tabellen beschreibt (jeweils das Dokument der Tabellen, die ihnen beschrieben werden), und es gibt kein Swagger-UI. `true` veröffentlicht das gesamte Dokument für jeden, mit der Swagger-**UI** unter `/api/swagger` außerhalb der Produktion (niemals in der Produktion). `false` hält das Dokument hinter der Admin-Schranke. | — |
| `REBASE_METRICS` | Prometheus-Metriken unter `/metrics` bereitstellen. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Fügt `includeSubDomains` zum `Strict-Transport-Security`-Header hinzu, sodass Browser reines HTTP auf jeder Subdomain des Hosts für sechs Monate verweigern – einschließlich Hosts, die dieser Prozess nicht bedient. Nur aktivieren, wenn jede Subdomain der Domain ausschließlich HTTPS verwendet. Alles außer `true`/`false` verweigert den Start. Siehe [Sicherheits-Header](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer-Token zum Schutz von `/metrics`. Wenn nicht gesetzt, bleibt der Endpunkt für jeden offen, der den Port erreichen kann – in einem privaten Netzwerk in Ordnung, in einem öffentlichen nicht, worauf die Startprotokolle hinweisen. | — |
| `REBASE_MIGRATE_ON_BOOT` | Was die Runtime beim Start mit dem Schema der Tabellen tun darf. `ensure` (der Standardwert, überall – einschließlich Produktion) führt den **additiven** Durchlauf aus: Erstellt fehlende Tabellen, Spalten und Enum-Typen, löscht oder schreibt jedoch niemals etwas um. `none` lässt das Schema der deklarierten Tabellen unangetastet, die eigenen Tabellen des Frameworks (Auth, API-Keys, Jobs, Cron) werden jedoch weiterhin erstellt und aktuell gehalten; `REBASE_PROVISION=false` schaltet auch diese ab. Das veröffentlichte Image akzeptiert nur diese beiden und **verweigert den Start bei `push`**. Bei einem [Split-Deployment](/docs/deployment/split-processes) darf genau ein Prozess provisionieren, sodass jede andere Rolle `none` setzen muss oder den Start verweigert. | `ensure` |
| `REBASE_PROVISION` | `false` veranlasst die Runtime, nichts in ihrer Datenbank zu ändern: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Richtlinie, Rolle oder Berechtigung, weder beim Start noch später, einschließlich der framework-eigenen. Stattdessen wird namentlich gemeldet, was fehlt. Für eine Datenbank, die nur Ihr eigener Änderungsprozess modifizieren darf. Siehe [Wenn nur Ihr Änderungsprozess die Datenbank ändern darf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Es werden nur `true` und `false` akzeptiert. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Start verweigern, wenn die Datenbank zuletzt aus einem anderen Tabellensatz provisioniert wurde als dem, aus dem dieser Prozess gebaut wurde. Nicht gesetzt (oder etwas anderes als `true`/`1`) warnt stattdessen. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Start verweigern, wenn eine Funktions- oder Cron-Datei beim Importieren einen Fehler wirft oder nicht geparst werden kann, wobei jede Datei und der Grund genannt werden, sodass bei einem Rolling Deploy die alte Version weiterläuft. Ein Neustart wird ebenfalls daran gemessen. Nicht gesetzt (oder etwas anderes als `true`) überspringt die Datei und bedient den Rest. Eine Datei, die fehlerfrei importiert wird und keine Funktion oder keinen Job exportiert, wird immer übersprungen und nicht abgelehnt. | skip |
| `REALTIME_CDC` | Change-Capture auf Datenbankebene: `auto` (Änderungen aus dem WAL lesen, wo die Datenbank dies zulässt, andernfalls Trigger verwenden, andernfalls Fallback auf Anwendungsebene, wobei jeder Fallback als Info protokolliert wird), `trigger` (erzwingen, warnen falls unmöglich), `wal` (Änderungen aus dem Write-Ahead-Log statt aus Triggern lesen; erfordert `wal_level=logical` und eine Rolle mit Replikationsrechten, andernfalls Fallback auf `trigger`), `off`. Siehe [Realtime](/docs/backend/realtime-cdc/). Hat Vorrang vor `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Instanzübergreifender Transport für Broadcast-Channels und Presence: `memory` oder `postgres`. Wird ignoriert, wenn `realtime.bus` ein konstruierter Transport übergeben wurde. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Wie viele Abonnements ein Realtime-Socket halten darf; das nächste wird mit `TOO_MANY_SUBSCRIPTIONS` abgelehnt. Eine positive ganze Zahl – alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSubscriptionsPerSocket`. Siehe [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Wie viele Realtime-Sockets ein Benutzer oder ein API-Schlüssel auf einer Serverinstanz offen halten darf. Identitätswechsel-Sockets (Impersonation) eines Administrators zählen für den Administrator. Die Anmeldung des nächsten wird mit `TOO_MANY_SOCKETS` abgelehnt und der Socket geschlossen (4002); das SDK versucht es weiter, sodass er hineinkommt, wenn ein anderer schließt. Eine positive ganze Zahl – alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.maxSocketsPerUser`. | Kein Limit |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Die maximale Wartezeit für ein Refetch, das Änderungen an Live-Abonnenten übermittelt, in ms. Ein Refetch wartet 300 ms ohne Änderung und bei einem kontinuierlichen Strom von Schreibvorgängen maximal diese Zeitspanne. Eine positive ganze Zahl – alles andere stoppt den Server beim Start. Hat Vorrang vor `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Wie lange die Gesamtzahl eines großen Listen-Abonnements wiederverwendet werden darf, bevor sie erneut gezählt wird, in ms; Frames, die sie wiederverwenden, tragen `meta.totalAsOf`. Nicht gesetzt zählt jeder Frame. Hat Vorrang vor `realtime.recountIntervalMs`. | Nicht gesetzt |
| `REALTIME_RECOUNT_MIN_ROWS` | Die kleinste letzte Gesamtzahl, für die `REALTIME_RECOUNT_INTERVAL_MS` gilt; kleinere Listen werden bei jedem Frame gezählt. Hat Vorrang vor `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | `localhost`/Loopback-Werte unter `NODE_ENV=production` erlauben. Standardmäßig deaktiviert, damit ein Produktionsstart deutlich fehlschlägt, anstatt sich mit einer nicht vorhandenen Datenbank zu verbinden. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` führt den Schemadurchlauf aus und beendet sich, ohne einen Socket zu öffnen – genau das Verhalten, das ein Migrations-Job benötigt, aus demselben Image und demselben Bundle wie der nachfolgende Server. Erstellt auch die Tabellen, die ein bereitstellender Prozess sonst bei der ersten Verwendung anlegen würde, und startet weder Cron- noch Job-Warteschlangen. Ein leerer Wert gilt als *nicht gesetzt*, sodass ein nicht ersetztes `${SOMETHING}` in einer Compose-Datei ein reguläres Deployment nicht versehentlich in eines verwandeln kann, das migriert und den Dienst verweigert. In Kombination mit `REBASE_PROVISION=false` abgelehnt. | — |
| `REBASE_PROVISION_SQL_OUT` | Ein Dateipfad. Ein Provisionierungslauf (`REBASE_PROVISION_ONLY=true`) schreibt jede vorgenommene Schemaänderung der Reihe nach als SQL-Skript dorthin, um sie mit `psql` zu überprüfen und anzuwenden. Geschriebene Datenzeilen sind nicht enthalten. Wird bei einem bereitstellenden Prozess abgelehnt. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` erlaubt es einer Maschine – einem Agenten, einem CI-Job –, eine Schemaänderung über `/api/admin/schema` tatsächlich *anzuwenden* und nicht nur zu planen. Deaktiviert, sofern nicht angefordert: Die Anmeldedaten, die eine solche Änderung vornehmen könnten, befinden sich am ehesten in einer CI-Variable. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Wie lange eine benutzerdefinierte Funktion laufen darf, bevor ihre Anfrage abgebrochen wird. Derselbe Parameter wie die Option `functionsTimeoutMs`. `0` deaktiviert das Limit. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` bewirkt, dass eine unbehandelte Promise-Rejection den Prozess beendet, anstatt ihn nur zu protokollieren. Aktiviert unter einem Orchestrator, der den Prozess neu startet; deaktiviert, wo ein Neustart schlimmer wäre als ein Ressourcenleck. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Unterdrückt die Startwarnung auf Plattformen, die von der Runtime als Scale-to-Zero erkannt werden, auf denen ein Timer in einer inaktiven Instanz in keiner Instanz ausgelöst wird. Ändert sonst nichts: Setzen Sie dies, wenn Sie mindestens eine Instanz dauerhaft am Laufen halten. | — |
| `TRUSTED_PROXY_HOPS` | Wie viele Proxies vor diesem Server liegen, damit der Rate-Limiter die echte Client-Adresse aus `X-Forwarded-For` lesen kann. Ausfallsicherer Standardwert `0`: Ohne Proxy würde das Vertrauen in den Header jedem Aufrufer erlauben, eine Identität vorzutäuschen. | `0` |

:::note[Boot-Provisionierung ist additiv und kein Migrationswerkzeug]
Der Startdurchlauf läuft unbeaufsichtigt ab, ohne dass jemand ein Diff prüft. Daher wird niemals
eine Spalte gelöscht, ein Typ eingeschränkt oder eine Tabelle umgeschrieben. Aus diesem Grund verweigert
das Image auch `REBASE_MIGRATE_ON_BOOT=push`: Ein vollständiger Push berechnet ein Diff und führt bereitwillig
`DROP COLUMN` aus, und ein Container-Neustart darf niemals als Nebeneffekt eines Neuansetzens (Rescheduling)
eine Produktionsspalte zerstören können.

Destruktive oder umstrukturierende Änderungen bleiben dort, wo sie überprüft werden können: `rebase db
generate` + `rebase db migrate` oder `rebase db push` von einem Checkout oder CI aus,
was die Änderung im Trockenlauf testet, destruktive Änderungen ohne Bestätigung verweigert und
zuvor ein Backup erstellen kann.
:::

### Split-Deployments

Ein einziges Image und ein einziges Bundle können mehrfach gestartet werden, wobei jede Instanz einen
anderen Teil des Projekts bedient. Hier jeweils eine Zeile, da diese Seite den Anspruch erhebt,
jede Variable aufzulisten; was jede Kombination *einhängt und besitzt* – und welche
Kombinationen den Start verweigern –, finden Sie unter
**[Split-Prozesse](/docs/deployment/split-processes)**.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_ROLE` | Welchen Teil dieser Prozess bedient: `all`, `api`, `functions` oder `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Überschreiben, ob *dieser* Prozess die Cron-Timer ausführt. Wenn nicht gesetzt, folgt er der Rolle. | — |
| `REBASE_JOB_WORKERS` | Überschreiben, ob dieser Prozess Job-Queue-Worker ausführt. Wenn nicht gesetzt, folgt er der Rolle. | — |
| `REBASE_FUNCTIONS_ONLY` | Nur die benannten benutzerdefinierten Funktionen in diesem Prozess bereitstellen. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Alle benutzerdefinierten Funktionen außer den benannten bereitstellen. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Wohin der API-Prozess eine Funktionsanfrage weiterleitet, die er nicht selbst bedient. Auf einem `worker`, wohin dessen eigene `rebase.functions`-Aufrufe gehen. Eine `http(s)`-URL. | — |

### MCP-Oberfläche

Ein optionaler Model Context Protocol-Endpunkt unter `/mcp`, damit ein KI-Client dieses
Projekt **als angemeldeter Benutzer** lesen und schreiben kann. Standardmäßig deaktiviert, und – anders als bei
jeder anderen Oberfläche – schaltet keine `REBASE_ROLE` ihn ein: Die anderen beschreiben die
Prozessform, während dies eine Entscheidung ist, Zugangsdaten an Software von Drittanbietern
zu übergeben. Sie sollte von einer Person getroffen werden, anstatt von der Aufgabenbezeichnung eines
Containers geerbt zu werden.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Hängt die MCP-Oberfläche ein. Erfordert `REBASE_PUBLIC_URL`; ohne diese wird das Einhängen der Oberfläche verweigert und dies im Startprotokoll vermerkt. | `false` |
| `REBASE_PUBLIC_URL` | Der extern erreichbare Origin dieses Deployments, z. B. `https://app.example.com`. Die MCP-Oberfläche kann ihn nicht ableiten – die Übernahme des Origins aus dem `Host`-Header würde die Identität des Ausstellers und die Zielgruppe (Audience), gegen die eigene Tokens geprüft werden, zu einem vom Aufrufer übergebenen Wert machen. | — |
| `REBASE_MCP_VIEW` | Pfad zur projekteigenen MCP-App-Ansicht (`rebase-view.html`, geschrieben von `rebaseMcpViewPlugin()`), die Claude anstelle der generischen Ansicht bereitgestellt wird, damit Ihre benutzerdefinierten Ansichten, Felder und Aktionen dargestellt werden. Ohne diese Angabe sucht das Backend neben dem bereitgestellten Frontend. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Erlaubt die dynamische OAuth-Client-Registrierung (RFC 7591), sodass sich ein Client selbst registrieren kann. Auf `false` setzen, um eine vorherige Registrierung der Clients zu verlangen. | `true` |

### Live-Schema-Bearbeitung aus einem Bundle

Deaktiviert, es sei denn, `REBASE_LIVE_SCHEMA_REPOSITORY` ist gesetzt. Ein gebautes Bundle enthält keine
`backend/schema`-Quelldateien zum Bearbeiten. Wenn diese Optionen gesetzt sind, liest
der Schema-Editor die Quellen aus dem Repository, committet jede Änderung zurück und führt deren DDL auf
dieser Datenbank aus. Nur für Administratoren und von einer Person angewendet, es sei denn,
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` bestimmt etwas anderes. Ein angegebenes Repository
ohne verwendbare Anmeldedaten verweigert den Start. Siehe
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Das GitHub-Repository, in das Schema-Änderungen committet werden sollen, als `owner/name`. Das Setzen dieser Variablen aktiviert die Funktion. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Der Branch, auf dem der Commit landet. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Wo `backend/schema` in diesem Repository liegt, relativ zum Repository. Ein Pfad, der das Repository verlässt, verweigert den Start, ebenso wie das entfernte `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Ein Fine-Grained-Token mit Lese- und Schreibzugriff auf die Inhalte des Repositorys. Setzen Sie entweder dies oder die drei `_GITHUB_APP_*`-Variablen, nicht beides. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Die ID einer GitHub-App, um als App statt mit einem Token zu committen. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Die Installation der App auf dem Repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Der private Schlüssel der App: PEM, PEM mit escaped Zeilenumbrüchen oder Base64. | — |

### Backups

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron-Ausdruck für geplante Backups. Nicht gesetzt bedeutet, dass geplante Backups deaktiviert sind. | — |
| `BACKUP_DESTINATION` | Lokaler Pfad oder eine `s3://bucket/prefix`- bzw. `gs://bucket/prefix`-URL. Erforderlich zusammen mit `BACKUP_SCHEDULE`, das ohne diese Angabe die Ausführung verweigert. `rebase db backup` greift auf `./backups` an dem Ort zurück, an dem es ausgeführt wurde. | — |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als N Tage sind. Nicht gesetzt oder `0` behält alles. | — |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens N der neuesten Backups behalten, unabhängig von der Aufbewahrungsrichtlinie. | — |
| `PG_DUMP_PATH` | Die `pg_dump`-Binärdatei überschreiben – sie muss der Hauptversion des Servers entsprechen oder neuer sein. | — |
| `PG_RESTORE_PATH` | Die `pg_restore`-Binärdatei überschreiben. | — |
| `PSQL_PATH` | Die `psql`-Binärdatei überschreiben, die `rebase db restore --clean` ausführt, um die Wiederherstellung in einer einzigen Transaktion durchzuführen. | — |
| `PG_DUMPALL_PATH` | Wo sich `pg_dumpall` befindet, wenn es nicht im `PATH` liegt. Ohne diese Angabe – und ohne installierte PostgreSQL-Client-Tools – schlägt ein globales Backup mit einem Fehler fehl, der diese Variable nennt. | — |

Das offizielle Runtime-Image (`rebasepro/server`) enthält die PostgreSQL 18-Client-Tools,
sodass ein geplantes Backup darin gegen jeden Server bis Postgres 18 läuft.
Installieren Sie diese außerhalb des Images selbst (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups enthalten Geheimnisse und personenbezogene Daten (PII). Verwenden Sie ein privates Ziel mit
Verschlüsselung im Ruhezustand (Encryption-at-Rest).

### Bundle-Bereitstellung

Ein verwaltetes Deployment enthält seinen Code nicht im Image: Die Runtime ruft beim
Start ein Bundle ab. Diese Variablen bestimmen, welches und wie.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Pfad zu einem bereits entpackten Bundle-Verzeichnis. Was `rebase start` lokal setzt. | — |
| `REBASE_BUNDLE_URL` | Von wo das Bundle-Archiv abgerufen werden soll, wenn kein lokales vorhanden ist. | — |
| `REBASE_BUNDLE_TOKEN` | Der Bearer-Berechtigungsnachweis für diesen Abruf. Behandeln Sie ihn wie ein Geheimnis: Er autorisiert einen Mandanten zum Herunterladen seines eigenen Codes. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Wohin ein abgerufenes Bundle entpackt wird. Muss beschreibbar sein und die Zeitspanne zwischen Abruf und Start überstehen. | — |
| `REBASE_RUNTIME_MODULES` | Zusätzliche Module, die das Runtime-Image dem Bundle über die selbst deklarierten hinaus bereitstellt. | — |

### Ressourcen-Bindungen

Jede Datenbank, jeder Bucket und jedes Topic, das ein Projekt in `backend/resources.ts` deklariert, wird
über danach benannte Umgebungsvariablen gebunden. Die Basisnamen sind unten aufgeführt; eine
nicht standardmäßige Ressource hängt `__` und ihren Schlüssel in Großbuchstaben an, sodass ein Bucket namens
`media` die Variable `S3_BUCKET__MEDIA` liest. `rebase status`
 gibt pro Ressource
die genaue Variable aus, die gelesen wird, und ob sie gesetzt ist.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_DRIVER` | Das npm-Paket, das den Treiber einer Datenquelle implementiert, wenn es nicht der standardmäßige Postgres-Treiber ist. Mit Suffix pro Quelle: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Die Verbindungszeichenfolge für ein deklariertes Topic. Mit Suffix pro Topic. | — |

### Die eigene Umgebung der CLI

Wird von `rebase` gelesen, nicht vom Server. Nichts hier beeinflusst ein Deployment.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Wohin `rebase api-keys`, `rebase storage` und `rebase auth reset-password` den Service-Key senden, in der Shell oder in `.env`. Setzen Sie dies, wenn der Server auf andere Weise als mit `rebase dev` in diesem Projekt ausgeführt wird: `rebase start`, ein Container, ein anderer Host. Wenn nicht gesetzt, verwenden sie den von `rebase dev` erfassten Server, während dieser läuft, und senden nichts, wenn er nicht läuft. | — |
| `REBASE_SERVICE_KEY` | Der Service-Key, mit dem sich diese Befehle authentifizieren, gelesen aus `.env`: dieselbe Variable, die der Server liest (siehe oben). | — |
| `SERVICE_KEY` | Ein älterer Name für diesen Schlüssel. Wenn `.env` ihn setzt, lesen `rebase api-keys` und `rebase storage` ihn anstelle von `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Welche `.env`-Datei die CLI liest und schreibt, wenn es nicht die des Projekts ist. | — |
| `REBASE_ROOT_RULES` | `0` verhindert, dass `rebase init` und `rebase skills install` die Projektregeln in die Dateien `CLAUDE.md` und `AGENTS.md` im Repository-Stammverzeichnis schreiben, für ein Stammverzeichnis, dessen Agenten-Dateien Sie manuell pflegen. | aktiviert |
| `REBASE_CLOUD_URL` | Die Control Plane, mit der `rebase cloud` kommuniziert. | — |
| `REBASE_CLOUD_EMAIL` | Das Konto, als das sich `rebase cloud login` anmeldet, anstatt danach zu fragen. | — |
| `REBASE_CLOUD_PASSWORD` | Dessen Passwort, damit ein Secret-Store es übergeben kann, ohne dass es in der History der Shell landet. | — |
| `REBASE_TOKEN` | Ein Token aus `rebase cloud tokens create`. Wenn gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle der `rebase cloud login`-Sitzung und liest oder schreibt niemals die gespeicherte Sitzung. In einem Verzeichnis, das durch `rebase cloud init --claim` verknüpft wurde, wird es zugunsten des Tokens dieses Projekts zurückgestellt, wenn es keinen Scope für das Projekt besitzt. Der Weg, um `rebase cloud` in CI auszuführen – siehe [CI und Agenten](/docs/deployment/cloud/#ci-and-agents). Der [MCP-Server](/docs/ai/mcp/) übergibt es an die CLI, die seine Cloud-Tools starten, und sendet es niemals an die App: Setzen Sie dafür `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` gibt die zugrunde liegende Fehlermeldung und Anfragedetails anstelle der Kurznachricht aus. Das Erste, was gesetzt werden sollte, wenn ein `rebase cloud`-Befehl ohne hilfreiche Meldung fehlschlägt. | — |
| `REBASE_ATLAS_DEV_URL` | Die leere Datenbank, gegen die `rebase db push`, `db generate` und `db migrate` planen, anstelle von `<db>_dev_diff`, die sie neben `DATABASE_URL` erstellen. Rebase erstellt oder löscht hier benannte Datenbanken nicht und lehnt eine ab, die mit `DATABASE_URL` identisch ist. Bei der verwalteten Entwicklungsdatenbank setzt die CLI dies auf ein eigenes temporäres In-Memory-PGlite. Setzen Sie dies dort, wo `CREATE DATABASE` nicht gewährt wird. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` startet keine Datenbank und provisioniert nichts – Sie bringen Ihre eigene mit. Dasselbe wie `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Legt den Port des Frontend-Dev-Servers fest, den `rebase dev` andernfalls aus dem Pfad des Projekts ableitet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Wie lange `rebase dev` wartet, bis sich das Backend meldet, bevor gemeldet wird, dass es nicht gestartet ist. `0` deaktiviert die Meldung. | `30000` |
| `DATABASE_PASSWORD` | Das Passwort, das `rebase dev --docker` in die aus `docker-compose.yml` abgeleitete Verbindungszeichenfolge einfügt. | — |
| `DO_NOT_TRACK` | Die toolübergreifende Konvention. Auf alles außer `0` gesetzt, sendet die CLI keine Telemetriedaten. | — |
| `REBASE_TELEMETRY_DISABLED` | Dasselbe, speziell für Rebase. Benötigt keine Datei und ist daher die Wahl für CI und in Images. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Wohin Telemetriedaten gesendet werden, für einen selbst gehosteten Collector. | — |

## Secrets in der Entwicklung

`JWT_SECRET` ist in der Produktion erforderlich. Es und `REBASE_SERVICE_KEY` werden
außerhalb dieser automatisch für Sie generiert, sodass Sie starten können, ohne etwas einrichten zu müssen.

Diese generierten Werte werden in `.rebase-dev-secrets.json` zwischengespeichert, neben
`.rebase-dev-port` und `.rebase-dev-url` und zusammen mit diesen in `.gitignore` aufgeführt. Zuvor wurden
sie bei jedem Start neu generiert – ein Neustart des Dev-Servers meldete Sie daher von
Ihrer eigenen App ab und entwertete jeden soeben erstellten API-Schlüssel.

- Setzen Sie eine der Variablen explizit, wird Ihre verwendet; es wird nichts zwischengespeichert oder gelesen.
- Verweisen Sie den Cache mit `REBASE_DEV_SECRETS_FILE` auf einen anderen Ort – ein Pfad und
  die einzige Variable in diesem Abschnitt, die Sie jemals bewusst setzen würden.
- Löschen Sie die Datei, um beide Secrets zu rotieren. Der nächste Start schreibt eine neue Datei.
- Wenn die Datei nicht geschrieben werden kann – etwa in einem schreibgeschützten Container –, startet der Server
  trotzdem mit einem flüchtigen Secret, genau wie früher.

In der Produktion oder unter einem Test-Runner wird nichts zwischengespeichert. In der Produktion wird auch
nichts generiert: Ein Start ohne `JWT_SECRET` schlägt unter Nennung der Variable fehl, und
das bleibt unverändert:

```
The environment is not valid:
  JWT_SECRET: is required
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
Backend, das nichts bereitstellt, bis Sie es einhängen: `createRebaseBackend`. Siehe
[Benutzerdefinierte Server-Integration](/docs/backend/custom-server/).

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

Das Admin-Panel übernimmt dies von dem Client, den es übergeben bekommt; sonst muss nichts
konfiguriert werden. Wenn Sie eine Anfrage-URL manuell zusammenstellen, verknüpfen Sie diese über den Client,
anstatt `/api` selbst zu schreiben:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Fehlerbehebung

### SQL-Editor: Zugriff verweigert (`permission denied for table <name>`)

* **Symptome:** Im SQL-Editor von Rebase Studio ausgeführte benutzerdefinierte Abfragen schlagen mit `cause: error: permission denied for table <name>` fehl, obwohl die Tabellen-CMS-Ansicht Daten erfolgreich lädt.
* **Ursache:** Standardmäßig versucht Rebase, Abfragen im SQL-Editor auszuführen, indem die Datenbankrollen vorübergehend gewechselt werden, um der Anwendungsrolle des aktiven Benutzers zu entsprechen (z. B. `SET LOCAL ROLE "admin"`). Wenn Sie eine benutzerdefinierte Authentifizierung verwenden, bei der Rollen nur in Datenbanktabellen und nicht als echte PostgreSQL-Rollen existieren, schlägt der Rollenwechsel fehl oder es fehlen Datenbankberechtigungen. Die CMS-Tabellenansicht wird unter dem Standardbenutzer des Verbindungsinhabers ausgeführt und umgeht dies.
* **Lösung:** Fügen Sie `DISABLE_DB_ROLE_SWITCHING=true` zu Ihrer Backend-`.env`-Konfiguration hinzu. Dies zwingt Rebase dazu, Abfragen im SQL-Editor mit den Berechtigungen des Verbindungsinhabers (in der Regel ein Superuser/Owner) auszuführen. Der SQL-Editor zeigt dann über den Ergebnissen an, dass sie als Verbindungsinhaber gelesen wurden, und graut dessen Rollenauswahl aus.

### SQL-Editor: Schema-Abruf fehlgeschlagen (`Cross-database execution requires adminConnectionString`)

* **Symptome:** Studio kann den Schemabaum nicht laden, oder der SQL-Editor wirft den Fehler `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
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

- **[Bereitstellung](/docs/getting-started/deployment)** — Leitfaden für das Produktions-Deployment
- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration

---
sourceHash: 04770a63e776e31f
title: Self-Hosting
sidebar_label: Self-Hosting
description: Betreiben Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle – Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Self-Hosting von Rebase bedeutet, zwei Dinge auszuführen: eine Postgres-Datenbank und das offizielle `rebasepro/server`-Image mit dem gemounteten Bundle Ihres Projekts.

Es gibt **kein Anwendungs-Image zu bauen**. Ihr Projekt wird als Bundle bereitgestellt, die Runtime ist veröffentlicht und ein Upgrade von Rebase ist eine Tag-Änderung statt eines Rebuilds. Siehe [Runtime und Bundles](/docs/architecture/runtime-and-bundles/) für die Gründe dieser Aufteilung.

## Docker Compose

**Wenn Ihr Projekt aus `rebase init` stammt, verwenden Sie dessen eigene `docker-compose.yml`.**
Sie befindet sich in Ihrem Repository, `init` hat die Secrets, das erste Admin-Konto und die festgelegte Runtime-Version eingetragen, und es ist die Datei, die unter [Deployment](/docs/getting-started/deployment/#docker-compose-recommended) beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite behandelt dasselbe Deployment ohne ein Scaffold im Hintergrund – das Projekt von jemand anderem, ein in der CI erstelltes Bundle oder die beiden Dinge, die die generierte Datei bewusst auslässt: einen Connection-Pooler und die Split-Process-Architekturen. Diese Datei befindet sich im Repository unter [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Verwenden Sie diese Datei, anstatt ein Snippet von dieser Seite zu kopieren: Beide Dateien werden bei jedem Push vom projekteigenen Acceptance Gate gestartet, sodass keine von dem abweichen kann, was tatsächlich funktioniert.

Beide stimmen bei jeder Umgebungsvariablen bis auf das Datenbankpasswort überein, und zwar deshalb, weil jede für ihren eigenen Ersteller geschrieben wurde: Diese liest `POSTGRES_PASSWORD`, das von `quickstart.sh` generiert wird; die generierte liest `DATABASE_PASSWORD`, das `rebase init` auch in die `DATABASE_URL` einbettet, die es in Ihre `.env` schreibt.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` ist ein einziger Befehl, der zwei naheliegende Dinge tut und beide ausgibt. Die ausführliche Form, falls Sie jeden Schritt lieber selbst steuern möchten:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Sie müssen die Datenbank nicht separat starten – `api` wartet auf ihren Healthcheck.

### Die sechs benötigten Werte

`quickstart.sh` generiert diese für Sie. Um die `.env` selbst zu schreiben:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
```

Drei Secrets, eine Tatsache und das Konto, mit dem Sie sich anmelden:

- **`POSTGRES_PASSWORD`** — das Datenbankpasswort. Eine spätere Änderung erfordert auch eine Änderung im Volume, wählen Sie es also einmalig sorgfältig aus.
- **`JWT_SECRET`** — signiert jede Sitzung. Das Rotieren meldet alle Benutzer ab.
- **`REBASE_SERVICE_KEY`** — die Anmeldeinformation, die Row-Level-Security für Server-zu-Server-Aufrufe umgeht. Behandeln Sie ihn wie ein Root-Passwort: Alles, was ihn besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** — die Origins, von denen Ihr Frontend bereitgestellt wird, kommagetrennt. Kein Secret und nicht optional: Die Runtime verweigert den Start in der Produktion ohne diesen Wert, anstatt zu raten, denn eine API, die ihre erlaubten Origins errät, erlaubt letztendlich die falschen.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — der erste Administrator. Eine frische Datenbank hat keine Benutzer, und außerhalb der Produktion erlaubt die Registrierungsrichtlinie die erste Registrierung und stuft sie zum Admin herauf – andernfalls wäre eine leere Datenbank eine Sackgasse, da das Bootstrappen eines Admins einen Aufrufer erfordert, der bereits angemeldet ist. Sobald dieser Stack unter einem Hostnamen erreichbar ist, wird dieser Komfort zu einer Race Condition, die der Betreiber verlieren kann. Daher ist das Zeitfenster in der Produktion geschlossen und das Konto wird stattdessen hier definiert. Die Runtime erstellt es einmalig, solange die Benutzertabelle leer ist, und tut dies bei jedem weiteren Start nicht mehr.

`JWT_SECRET` und `REBASE_SERVICE_KEY` müssen jeweils mindestens 32 Zeichen lang sein und das Admin-Passwort mindestens 12 Zeichen. Verwenden Sie eine Adresse mit einem Punkt in der Domain: `POST /auth/login` parst den Body mit `z.string().email()`, daher verweigert die Runtime das Seeding von `admin@localhost` – einem Account, an dem sich niemand anmelden könnte – und protokolliert stattdessen den Grund. Die Compose-Datei deklariert alle sechs mit `${VAR:?…}`, sodass eine fehlende Variable den Stack mit einer Fehlermeldung stoppt, die sie benennt, anstatt etwas halb Konfiguriertes zu starten – und die Selbstregistrierung ist standardmäßig deaktiviert (`DISABLE_SELF_REGISTRATION`, Standardwert `true`), sodass nichts ungeschützt bleibt.

Melden Sie sich mit diesen Anmeldedaten an und ändern Sie das Passwort: Sie befinden sich in einer Datei auf dem Host.

## Dependencies

`rebase build` **installiert die Abhängigkeiten Ihres Projekts standardmäßig in das Bundle**, sodass `dist-bundle` mit `node_modules` und einer `package-lock.json` neben seiner `package.json` ausgeliefert wird. Ein Bundle mit integrierten Abhängigkeiten (vendored) startet in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt (read-only) einbinden – was sich lohnt, da ein kompromittierter Hook dann nicht den Code umschreiben kann, der nach dem nächsten Neustart ausgeführt wird:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` deaktiviert dies und erzeugt ein Bundle, das seine Abhängigkeiten stattdessen beim ersten Start installiert, was 40–60 Sekunden pro Start dauert und erfordert, dass der Mount beschreibbar ist.

Für ein echtes Deployment sollten Sie es vorziehen, beides in ein Image zu packen, wodurch auch exakt festgelegt wird, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.29.3
COPY dist-bundle /bundle
```

## Schema erstellen

**Die Runtime erstellt beim Booten fehlende Tabellen, einschließlich derer Ihrer Collections.**
`REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt: Es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level-Security an. Ein erster Start mit einer leeren Datenbank stellt Ihre Collections ohne separaten Schritt bereit.

Was `ensure` ganz bewusst niemals tut, ist das Ändern von Bestehendem. Es ändert weder Spaltentypen noch löscht es Tabellen oder Spalten oder bearbeitet Labels eines bestehenden Enums – denn ein Container-Neustart darf nicht in der Lage sein, ein Schema als Nebeneffekt eines Deploys umzustrukturieren.

Daher lohnt sich die Ausführung von `rebase db push` weiterhin für das, was der Boot-Vorgang unberührt lässt – jede Änderung, die nicht rein additiv ist: eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

```bash
rebase db push
```

Führen Sie es aus einem Checkout oder einem CI-Job aus, der auf die Datenbank des Deployments gerichtet ist. Es führt die Änderung zuerst als Testlauf durch, verweigert destruktive Änderungen ohne explizite Bestätigung und kann vor dem Anwenden ein Backup erstellen. Die Datenbank gibt in der Compose-Datei einen Port frei, damit dieser Befehl sie vom Host aus erreichen kann; entfernen Sie dieses Port-Mapping, sobald das Schema eingerichtet ist, falls die Datenbank nicht von außen erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert `ensure` und `none`, und sonst nichts – das Image **verweigert den Start** bei `push`, aus dem oben genannten Grund.

## Wenn nur Ihr Änderungsprozess die Datenbank ändern darf

`REBASE_MIGRATE_ON_BOOT=none` lässt Ihre Collections unberührt. Es lässt die Datenbank jedoch nicht vollständig unberührt: Die eigenen Tabellen des Frameworks (Auth, API-Keys, Jobs, Cron) werden weiterhin bei jedem Start erstellt und aktuell gehalten. Wenn sich die Datenbank nur durch einen überprüften Änderungsprozess ändern darf, setzen Sie `REBASE_PROVISION=false` für jeden Prozess, der Anfragen bedient:

| Einstellung | Collection-Tabellen und Policies | Framework-Tabellen |
|---|---|---|
| Standard (`REBASE_MIGRATE_ON_BOOT=ensure`) | beim Booten erstellt und aktuell gehalten | erstellt und aktuell gehalten |
| `REBASE_MIGRATE_ON_BOOT=none` | unberührt | erstellt und aktuell gehalten |
| `REBASE_PROVISION=false` | unberührt | unberührt; was fehlt, wird im Log genannt |

Bei deaktiviertem Provisioning erstellt und ändert die Runtime nichts: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Policy, Rolle oder Berechtigung (Grant). Das gilt beim Booten und später, einschließlich der Tabellen, die ein Serverprozess sonst bei der ersten Verwendung anlegt (Idempotenz-Schlüssel, Cron-Claims, die geteilten Rate-Limit-Zähler). Stattdessen liest er nur, was vorhanden ist:

- **Auth-Tabellen oder eine Spalte, die Auth liest, fehlt:** Der Start wird verweigert und jede einzelne aufgelistet.
- **Die Request-Rolle kann auf eine Framework-Tabelle zugreifen**, wie etwa `rebase.refresh_tokens` oder `rebase.api_keys`: Der Start wird verweigert und der auszuführende `REVOKE`-Befehl ausgegeben. Ein Provisioning-Start entzieht diese Berechtigungen selbstständig. Bei deaktiviertem Provisioning geschieht dies nicht.
- **Eine optionale Tabelle fehlt** (API-Keys, Idempotenz-Schlüssel, Cron-Claims, Rate-Limit-Zähler, Presence, Metrik-Historie): Diese Funktion ist deaktiviert, und das Log gibt an, welche Tabelle benötigt wird.

Zeilen ändern sich weiterhin wie in jeder Datenbank: Anmeldungen, Sitzungen, API-Key-Nutzung, Idempotenz-Schlüssel, Cron-Claims. Das erste Admin-Konto (`REBASE_ADMIN_EMAIL`) wird durch den Provisioning-Lauf geseedet, nicht durch die bedienenden Prozesse. [Live schema editing](/docs/backend/live-schema-editing) kann Änderungen weiterhin im Quellcode committen, verweigert jedoch deren Anwendung auf die Datenbank.

### Der Provisioning-Lauf

Das Schema stammt aus einem Lauf, den Ihr Änderungsprozess steuert. Verwenden Sie dasselbe Image und Bundle wie der Server mit `REBASE_PROVISION_ONLY=true`, verbunden als Rolle mit Erstellungsrechten in der Datenbank. `REBASE_PROVISION_SQL_OUT` speichert jede Schemaänderung, die der Lauf vorgenommen hat, als SQL-Skript:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e CORS_ORIGINS="https://app.example.com" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

Das Image wird mit `NODE_ENV=production` ausgeführt, sodass dieser Lauf denselben Umgebungsprüfungen unterliegt wie der Server – einschließlich `CORS_ORIGINS` oder `FRONTEND_URL`, obwohl er keine Anfragen bedient.

Das Skript ist ein Protokoll, kein Plan: Jedes Statement darin wurde der Reihe nach ausgeführt und war erfolgreich. Gegen eine leere Datenbank aufgezeichnet, enthält es das gesamte Schema, das das Release benötigt. Gegen eine wiederhergestellte Kopie der Produktionsdatenbank aufgezeichnet, stellt es exakt das Upgrade dar. Zeilen, die der Lauf geschrieben hat, sind nicht enthalten. Überprüfen Sie es und wenden Sie es dann auf die echte Datenbank an:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Wiederholen Sie dies für jedes Rebase-Upgrade, bevor die bedienenden Prozesse aktualisiert werden. Ein Release kann eine Tabelle oder Spalte hinzufügen, und ein Prozess, der keine erstellen darf, meldet sie als fehlend, anstatt sie anzulegen.

Ein selbst gebauter Server folgt derselben Regel: `initializeRebaseBackend` liest `REBASE_PROVISION`, und `createRebaseBackend` akzeptiert [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Dateispeicher

Der Speicher ist standardmäßig **deaktiviert**, es sei denn, ein Bucket ist konfiguriert, und das ist beabsichtigt: Der alternative Standardwert wäre das Container-Dateisystem, welches bei jedem Neustart stillschweigend jede hochgeladene Datei verlieren würde. Uploads werden mit `501 STORAGE_NOT_CONFIGURED` verweigert, bis Sie einen Bucket einrichten.

Setzen Sie für einen Bucket `STORAGE_TYPE=s3` (oder `gcs`) zusammen mit dessen Bucket-Namen und Zugangsdaten – die Compose-Datei listet die Variablen auskommentiert auf. `gcs` lädt `@google-cloud/storage`, welches im offiziellen Image nicht enthalten ist; greifen Sie bei diesem Image stattdessen über dessen S3-kompatiblen Endpunkt auf Google Cloud Storage zu (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, HMAC-Keys).

Für lokalen Festplattenspeicher, was nur dann angemessen ist, wenn der Pfad ein echtes Volume ist, das den Container überdauert:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` ist dort nicht optional: In der Produktion wird ein `local`-Backend verworfen statt registriert, da die Alternative erfolgreiche Uploads in ein Dateisystem wären, das kurz vor der Zerstörung steht. Über diese Variable bestätigen Sie, dass der Mount persistent ist.

Mounten Sie das Volume **über** `STORAGE_PATH`, nicht direkt darauf. `STORAGE_PATH` ist das Verzeichnis des Standard-Buckets, und jeder in `config/resources.ts` deklarierte Bucket erhält daneben ein eigenes: `<STORAGE_PATH>__<key>`. Ein Volume direkt unter `STORAGE_PATH` enthält nur den Standard-Bucket. Jeder andere Bucket schreibt in das Dateisystem des Containers und verliert seine Dateien, wenn der Container neu erstellt wird. `STORAGE_PATH__MEDIA` kann einen Bucket an eine andere Stelle auf dem Volume verschieben. Er kann ihn jedoch nicht in das Verzeichnis eines anderen Buckets verschieben, wie etwa `/storage/uploads/media`, da der Standard-Bucket sonst dessen Dateien auflisten, ausliefern und löschen würde.

Das Image erstellt `/storage` für den unprivilegierten Benutzer `node`, unter dem es läuft, weshalb das Volume dorthin gehört. Ein Volume, das dort gemountet wird, wo das Image kein Verzeichnis besitzt, gehört root, und jeder Upload schlägt mit `EACCES` fehl. Die von `rebase init` erstellte Compose-Datei bindet es auf diese Weise ein.

### Speicher benötigt ein Zugriffskontrollmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime in der Produktion den Start**, bis das Deployment definiert, wie Objekte geschützt sind. Der Speicher unterliegt nicht der Row-Level-Security und seine Schlüssel teilen sich einen einzigen flachen Namensraum. Ohne Regeln trennt die Dateien zweier Benutzer nur die Unerratbarkeit der Schlüssel – was durch `GET /storage/list?prefix=` zunichtegemacht wird. Jede der folgenden Optionen genügt:

- ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration Ihres Projekts, was die eigentliche Lösung ist und standardmäßig im Scaffold unter `config/storage.ts` ausgeliefert wird – keine Umgebungsvariable kann ausdrücken: „dieser Benutzer darf diesen Schlüssel lesen“;
- **`STORAGE_PUBLIC_READ=true`**, für einen Bucket, der tatsächlich ein öffentliches Read-only-CDN ist;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, für eine Single-Tenant-Anwendung, bei der jedem angemeldeten Benutzer jede Datei anvertraut wird.

Außerhalb der Produktion führt dieselbe Bedingung lediglich zu einer deutlichen Warnung anstelle einer Verweigerung. Dies ist also ein Boot-Fehler, der Ihnen beim Deployment und nicht auf dem Laptop begegnet. Das ist beabsichtigt: Der Fehler, den er verhindert, bliebe sonst unbemerkt.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, wenn Sie TOTP verwenden. Bleibt dies ungesetzt, werden gespeicherte Authenticator-Secrets mit `JWT_SECRET` verschlüsselt – eine Rotation meldet dann alle Benutzer ab *und* macht jedes registrierte Gerät unentschlüsselbar.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht, daher funktioniert alles, was Container ausführen kann. Zwei Dinge müssen überall stimmen:

1. Das Bundle muss unter `/bundle` (oder worauf `REBASE_BUNDLE` zeigt) vorhanden sein, mit den daneben installierten Abhängigkeiten – siehe [Dependencies](#dependencies).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime verweigert in der Produktion den Start ohne diese Werte, anstatt zu raten.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.29.3 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die oben gezeigte Form des abgeleiteten Images, damit das Bundle mit der App ausgeliefert wird, und führen Sie dann `fly deploy` aus.

### Railway / Render

Verweisen Sie den Dienst auf das abgeleitete Image, setzen Sie die Umgebungsvariablen und stellen Sie den Healthcheck-Pfad auf `/livez` ein.

### Ein gewöhnlicher VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` listet die Variablen auf, die gelesen werden. Unter systemd:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=ALLOW_LOCALHOST_IN_PRODUCTION=true
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` ist keine Zierde. Bleibt dies ungesetzt, läuft der Prozess im Entwicklungsmodus: Er reflektiert localhost-Origins, stellt die OpenAPI-Spezifikation bereit und **lässt das Erst-Admin-Fenster offen** – der erste Fremde, der das Registrierungsformular findet, wird somit zum Administrator. Die beiden `REBASE_ADMIN_*`-Zeilen ersetzen dieses Zeitfenster; siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` ist vorhanden, weil sich die Datenbank auf derselben Maschine befindet. In der Produktion weist die Runtime jede Variable zurück, die auf localhost zeigt – in einem Container ist Loopback der Container selbst, daher ist diese Adresse fast immer ein Fehler – und diese Zeile teilt ihr mit, dass die Adresse beabsichtigt ist. Entfernen Sie sie, wenn die Datenbank woanders läuft.

Ziehen Sie `EnvironmentFile=/etc/rebase.env` mit Dateirechten 0600 den `Environment=`-Zeilen für Secrets vor: Eine Unit-Datei ist für jedermann lesbar und `systemctl show` gibt jeden `Environment=`-Wert aus.

## Connection pooling

Die Runtime hält einen kleinen, langlebigen Pool und benötigt keinen Pooler. Was ihn jedoch benötigt, ist alles andere, was mit derselben Datenbank kommuniziert und keine Verbindung halten kann: eine serverlose Funktion, ein geplantes Skript, ein BI-Tool, ein Queue-Worker, der auf fünfzig Instanzen skaliert. `max_connections` von Postgres ist ein hartes Limit im unteren Hunderterbereich und jede Verbindung ist ein eigener *Prozess*, sodass ein Lambda-Fan-out dieses Limit erschöpft, lange bevor die Datenbank ausgelastet ist.

Die Compose-Datei liefert einen `pgbouncer`-Dienst für diesen Datenverkehr mit, hinter einem Profil, damit ein Deployment ohne solche Aufrufer keinen unnötigen Prozess ausführt:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert, sodass das Passwort nicht doppelt geschrieben werden muss. Der Pooler authentifiziert sich bei Postgres mit `scram-sha-256`, was Postgres 18 speichert – der `md5`-Standardwert des Images lässt den *Server*-Login mit `FATAL: server login failed: wrong password type` fehlschlagen, was wie ein falsches Passwort aussieht, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich unter dem `max_connections`-Wert der Datenbank – die Runtime schöpft aus demselben Kontingent.

### Was Transaction-Pooling ändert

Ein gepoolter Client hält eine Serververbindung für die Dauer einer Transaktion und gibt sie danach wieder frei. Dadurch können sich 500 Clients 20 Verbindungen teilen. Drei Dinge funktionieren über diesen Port nicht mehr, und jedes davon wird von Rebase selbst genutzt – was genau der Grund ist, warum sich die Runtime direkt verbindet und dieser Port für andere Aufrufer gedacht ist:

- **`LISTEN`/`NOTIFY`.** Realtime basiert darauf, und ein Listener benötigt eine Verbindung, die eine Transaktion überdauert. `LISTEN` wird über den Pooler zwar *akzeptiert* – er antwortet mit `LISTEN`, aber danach trifft nie eine Benachrichtigung ein.
- **Session-Status**: `SET` (im Gegensatz zu `SET LOCAL`), anweisungsübergreifend gehaltene Advisory Locks, `WITH HOLD`-Cursor, temporäre Tabellen. Die nächste Transaktion landet möglicherweise auf einer anderen Serververbindung, die nichts davon sieht. Beides schlägt auf dieselbe tückische Weise fehl: Bei einem einzelnen untätigen Client ist der Status meist noch vorhanden, sodass es beim Testen funktioniert, aber unter der Last/Nebenläufigkeit fehlschlägt, für die der Pooler überhaupt erst eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Den meisten Treibern kann mitgeteilt werden, diese nicht zu verwenden – node-postgres tut dies standardmäßig nicht; asyncpg benötigt `statement_cache_size=0`.

`SET LOCAL` ist transaktionsgebunden und funktioniert; damit wird auch Row-Level-Security gesetzt – RLS verhält sich über den gepoolten Port also identisch.

Lassen Sie das Profil deaktiviert, wenn sich nichts außerhalb der Runtime mit Ihrer Datenbank verbindet. Ein ungenutzter Port bedeutet Angriffsfläche.

## Healthchecks

| Pfad | Verwendung |
| --- | --- |
| `/livez` | Liveness. Beantwortet die Frage „Lebt dieser Prozess?“, ohne die Datenbank zu berühren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez`. Eine Liveness-Probe auf `/health` startet einen vollkommen gesunden Prozess bei einem kurzen Datenbank-Schluckauf neu – das Gegenteil dessen, wofür sie da ist.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Anfragezahlen und Latenz-Histogramme, aufgeschlüsselt nach API-Bereich (data, auth, storage, functions) und Collection, sowie Prozess-Gauges. Ohne Token ist der Endpunkt für jeden lesbar, der den Port erreichen kann; setzen Sie daher ein Token, sofern er sich nicht in einem privaten Netzwerk befindet.

`rebase_db_pool_wait_ms` ist ein Histogramm darüber, wie lange jede Abfrage auf eine Verbindung aus dem Datenbank-Pool gewartet hat (einschließlich des Öffnens einer neuen), gelabelt nach Datenquellen-Schlüssel (`source="(default)"` in einem Projekt, das keine Datenquellen deklariert). Ein gesunder Pool hält diesen Wert nahe null. Ein mit dem Traffic wachsender Tail bedeutet, dass Anfragen in einer Warteschlange auf Verbindungen warten – meist blockiert durch Schreib-Callbacks, die auf etwas Langsames warten; siehe [Ein Callback belegt eine Verbindung](/docs/collections/context-data-api/#a-callback-holds-a-connection).

Die Datenbank selbst, pro Datenquelle:

| Metrik | Aussage |
|--------|---------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Verbindungen jedes Pools, gelabelt als `pool="primary"`, `"read"` (das Replikat) oder `"session"` (der direkte Pool der SQL-Konsole hinter einem Pooler). Ein dauerhaftes `waiting` über null weist auf einen für seine Last zu kleinen Pool hin. |
| `rebase_db_connection_errors_total` | Anfragen, die mangels Verbindung mit 503 beantwortet wurden, nach `code`: `53300` / `53400` (dem Server sind die Verbindungen ausgegangen), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Client-Verbindungen auf dem Server, nach `state`, im Vergleich zu `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Die Größe der Datenbank. |
| `rebase_db_replica_lag_seconds` | Wie weit `DATABASE_READ_URL` hinter der primären Datenbank hinterherhinkt. |

Die letzten vier werden alle 30 Sekunden über die instanzeigene Verbindung abgefragt, sodass ein Scrape niemals zu einer Abfrage wird.

`rebase_realtime_*` meldet die offenen Sockets, Channels und die Frames jeder Instanz, die an den Channel-Bus gesendet oder zurückgehalten wurden: siehe [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Sicherheits-Header

Jede Antwort enthält `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` und `Strict-Transport-Security: max-age=15552000` (180 Tage). Der HSTS-Header lässt `includeSubDomains` aus: Dies würde Browser anweisen, reines HTTP auf jeder Subdomain Ihrer Domain zu verweigern, einschließlich solcher, mit denen dieser Server nichts zu tun hat, und ein Browser speichert dies so lange, wie der Header vorgibt.
Setzen Sie `REBASE_HSTS_INCLUDE_SUBDOMAINS=true`, wenn jede Subdomain ausschließlich HTTPS verwendet.

`strict-origin-when-cross-origin` ist der Standard der Browser selbst: Eine Anfrage an eine andere Website übermittelt Ihren Origin und niemals den Pfad oder Query-Parameter der Seite. Es ist nicht `no-referrer`, da Origin-Prüfungen den Origin benötigen – die Google-Anmeldeschaltfläche vergleicht ihn mit den autorisierten JavaScript-Origins des OAuth-Clients, und unter `no-referrer` antwortete sie bei jeder App mit „The given origin is not allowed for the given client ID“, unabhängig davon, was der Client erlaubte. Eine Antwort, die ihre eigene Richtlinie festlegt, behält diese bei (die MCP-Zustimmungsseite sendet `no-referrer`); eine Seite, die eine strengere Richtlinie wünscht, kann dies über `<meta name="referrer" content="no-referrer">` angeben. `X-Frame-Options` funktioniert genauso: `SAMEORIGIN`, es sei denn, die Antwort setzt einen eigenen Wert, wie es die MCP-Zustimmungsseite mit `DENY` tut.

Die statischen Apps – die CMS-Administration und jedes Frontend, das das Bundle ausliefert – enthalten außerdem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Dies bestimmt, wer die App in Frames einbinden darf, schließt Plugins aus, bindet `<base>` an Ihren Origin und schränkt sonst nichts weiter ein, sodass Inline-Skripte, Worker und Anmeldungen von Drittanbietern weiterhin funktionieren. Eine Antwort, die eine eigene Richtlinie definiert, behält diese bei. Wenn Sie strengere Regeln benötigen, konfigurieren Sie die Policy auf dem vorgeschalteten Reverse-Proxy.

## Mehrere Instanzen

Ein einzelner Container ist der Standard und benötigt nichts weiter. Bevor ein zweites Replikat Traffic übernimmt – oder ein Rolling Deploy zwei Instanzen parallel ausführt –, lesen Sie [Running more than one instance](/docs/deployment/multiple-instances/): Rate-Limits, Broadcast-Channels, lokale Dateien, fortsetzbare Uploads und der Image-Cache gelten pro Prozess, bis eine Einstellung sie teilt.

## Claude verbinden

Ein einziger Befehl fügt diesen Server zum [Rebase-Connector](/docs/ai/rebase-connector/) hinzu, dem zentralen MCP-Connector, der aus Claude heraus all Ihre Projekte erreicht:

```bash
rebase cloud connect https://your-app.com
```

Setzen Sie die beiden Variablen, die ausgegeben werden, auf diesem Server und starten Sie ihn neu. Der Server muss Rebase 0.28.1 oder höher ausführen und über HTTPS unter einer öffentlichen Adresse erreichbar sein. Sonst ändert sich nichts: Er speichert keine Secrets und gewährt dem Connector dieselben Rechte wie Studio.

## Funktionen in einem eigenen Prozess ausführen

Alles oben Genannte beschreibt einen einzelnen Container, der das gesamte Projekt bedient, was für fast jedes Deployment die richtige Form ist. Wenn eine benutzerdefinierte Funktion nicht mehr mit der Daten-API um die Event-Loop konkurrieren soll – oder unabhängig skalieren, neu starten und fehlschlagen können soll –, können dasselbe Image und dasselbe Bundle als mehrere zusammenarbeitende Prozesse gestartet werden. Siehe [Split processes](/docs/deployment/split-processes/).

## Upgrades

```yaml
image: rebasepro/server:0.29.3
```

Starten Sie neu. Ihr Bundle bleibt unverändert. Innerhalb einer Major-Version des Runtime-Contracts funktioniert ein validiertes Bundle weiterhin – siehe [Kompatibilität](/docs/architecture/runtime-and-bundles/#compatibility).

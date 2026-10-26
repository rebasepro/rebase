---
sourceHash: c6f65640f646f804
title: Self-Hosting
sidebar_label: Self-Hosting
description: Führen Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle aus – Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Rebase selbst zu hosten bedeutet, zwei Dinge zu betreiben: eine Postgres-Datenbank und das offizielle Image `rebasepro/server`, in das das Bundle Ihres Projekts gemountet ist.

Es muss **kein Anwendungs-Image gebaut werden**. Ihr Projekt wird als Bundle bereitgestellt, die Runtime ist veröffentlicht, und ein Upgrade von Rebase ist lediglich eine Änderung des Tags statt eines Rebuilds. Siehe [Runtime and bundles](/docs/architecture/runtime-and-bundles/) für die Gründe dieser Aufteilung.

## Docker Compose

**Wenn Ihr Projekt über `rebase init` erstellt wurde, verwenden Sie dessen eigene `docker-compose.yml`.** Sie befindet sich in Ihrem Repository; `init` hat die Secrets, das erste Admin-Konto und die festgelegte Runtime-Version eingetragen, und es ist die Datei, die unter [Deployment](/docs/getting-started/deployment/#docker-compose-recommended) beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite behandelt dasselbe Deployment ohne ein Scaffold im Hintergrund – das Projekt einer anderen Person, ein in der CI erstelltes Bundle oder die beiden Dinge, die die generierte Datei bewusst auslässt: ein Connection-Pooler und Split-Process-Architekturen. Diese Datei befindet sich im Repository unter [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Verwenden Sie diese Datei, anstatt Code-Auszüge von dieser Seite zu kopieren: Beide Dateien werden bei jedem Push vom projekteigenen Acceptance Gate gestartet, sodass keine von dem abweichen kann, was tatsächlich funktioniert.

Beide stimmen bei allen Umgebungsvariablen überein, abgesehen vom Datenbank-Passwort. Das liegt daran, dass jede für ihren eigenen Ersteller geschrieben wurde: Diese Version liest `POSTGRES_PASSWORD`, das von `quickstart.sh` generiert wird; die generierte Version liest `DATABASE_PASSWORD`, das `rebase init` auch in die `DATABASE_URL` einbettet, die es in Ihre `.env` schreibt.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` ist ein einzelner Befehl, der zwei naheliegende Dinge tut und beide ausgibt. Die ausführliche Variante, falls Sie jeden Schritt selbst kontrollieren möchten:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Sie müssen die Datenbank nicht separat starten – `api` wartet auf deren Healthcheck.

### Die sechs benötigten Werte

`quickstart.sh` generiert diese für Sie. Um die `.env` selbst zu erstellen:

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

Drei Secrets, ein Parameter und das Konto, mit dem Sie sich anmelden:

- **`POSTGRES_PASSWORD`** — das Datenbank-Passwort. Eine spätere Änderung erfordert auch eine Änderung im Volume; wählen Sie es also einmalig mit Bedacht.
- **`JWT_SECRET`** — signiert jede Session. Eine Rotation meldet alle Benutzer ab.
- **`REBASE_SERVICE_KEY`** — die Anmeldeinformation, die Row-Level Security für Server-zu-Server-Aufrufe umgeht. Behandeln Sie diesen Schlüssel wie ein Root-Passwort: Alles, was ihn besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** — die Origins, von denen Ihr Frontend bereitgestellt wird, kommagetrennt. Kein Secret und nicht optional: Die Runtime verweigert den Start in der Produktion ohne diesen Wert, anstatt Vermutungen anzustellen – denn eine API, die ihre erlaubten Origins errät, erlaubt früher oder später die falsche.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — der erste Administrator. Eine neue Datenbank enthält keine Benutzer, und außerhalb der Produktion erlaubt die Registrierungsrichtlinie die erste Registrierung und ernennt diese zum Admin – andernfalls wäre eine leere Datenbank eine Sackgasse, da das Bootstrapping eines Admins einen bereits angemeldeten Aufrufer erfordert. Sobald dieser Stack jedoch unter einem Hostnamen erreichbar ist, wird diese Bequemlichkeit zu einer Race Condition, die der Operator verlieren kann. Daher ist das Zeitfenster in der Produktion geschlossen und das Konto wird stattdessen hier angegeben. Die Runtime erstellt es einmalig, solange die Benutzertabelle leer ist, und unternimmt bei jedem nachfolgenden Start nichts mehr.

`JWT_SECRET` und `REBASE_SERVICE_KEY` müssen jeweils mindestens 32 Zeichen lang sein, das Admin-Passwort mindestens 12. Verwenden Sie eine E-Mail-Adresse mit einem Punkt in der Domain: `POST /auth/login` parst den Body mit `z.string().email()`, sodass die Runtime `admin@localhost` – ein Konto, bei dem sich niemand anmelden könnte – nicht anlegt und stattdessen protokolliert, warum. Die Compose-Datei deklariert alle sechs mit `${VAR:?…}`, sodass eine fehlende Variable den Stack mit einer Fehlermeldung stoppt, die den Namen nennt, anstatt etwas halb Konfiguriertes zu starten – und die Selbstregistrierung ist standardmäßig deaktiviert (`DISABLE_SELF_REGISTRATION`, Standard `true`), sodass nichts herrenlos bleibt.

Melden Sie sich mit diesen Anmeldedaten an und ändern Sie das Passwort: Sie liegen im Klartext in einer Datei auf dem Host.

## Abhängigkeiten

`rebase build` **installiert die Abhängigkeiten Ihres Projekts standardmäßig in das Bundle**, sodass `dist-bundle` ein `node_modules`-Verzeichnis und eine `package-lock.json` neben seiner `package.json` enthält. Ein vorgebündeltes Bundle startet in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt (read-only) mounten – was sich empfiehlt, da ein kompromittierter Hook dann nicht den Code umschreiben kann, der nach dem nächsten Neustart ausgeführt wird:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` deaktiviert dies und erzeugt ein Bundle, das seine Abhängigkeiten stattdessen beim ersten Start installiert, was 40–60 Sekunden pro Start dauert und einen beschreibbaren Mount erfordert.

Für ein echtes Deployment empfiehlt es sich, beides in ein Image einzubetten, was auch exakt festlegt, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.25.1
COPY dist-bundle /bundle
```

## Schema erstellen

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich derer Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was additiv für das gesamte Schema wirkt: Fehlende Tabellen, Spalten und Enum-Typen werden erstellt und deren Row-Level Security angewendet. Ein erster Start gegen eine leere Datenbank stellt Ihre Collections sofort bereit, ohne zusätzlichen Schritt.

Was `ensure` ganz bewusst niemals tut, ist das Ändern bestehender Strukturen. Es ändert keinen Spaltentyp, löscht weder Tabellen noch Spalten und bearbeitet keine Werte bestehender Enums – denn ein Container-Neustart darf niemals in der Lage sein, ein Schema als Nebeneffekt eines Deploys umzustrukturieren.

Daher lohnt sich die Ausführung von `rebase db push` weiterhin für all das, was der Startvorgang unangetastet lässt – jede Änderung, die nicht rein additiv ist: eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

```bash
rebase db push
```

Führen Sie den Befehl aus einem Checkout oder einem CI-Job aus, der auf die Datenbank des Deployments verweist. Die Änderung wird zunächst als Testlauf (Dry-Run) geprüft, destruktive Änderungen werden ohne explizite Bestätigung verweigert, und vor der Anwendung kann ein Backup erstellt werden. Die Datenbank gibt in der Compose-Datei einen Port frei, damit dieser Befehl sie vom Host aus erreichen kann; entfernen Sie dieses Port-Mapping, sobald das Schema eingerichtet ist, falls die Datenbank von außen nicht erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert nur `ensure` und `none` – das Image **verweigert den Start** bei `push` aus dem oben genannten Grund.

## Wenn nur Ihr Änderungsprozess die Datenbank ändern darf

<span class="since-badge" data-since="0.26">Seit 0.26</span>

`REBASE_MIGRATE_ON_BOOT=none` lässt Ihre Collections in Ruhe. Die Datenbank lässt es nicht in Ruhe: Die eigenen Tabellen des Frameworks (Auth, API-Schlüssel, Jobs, Cron) werden bei jedem Start weiterhin angelegt und aktuell gehalten. Darf die Datenbank nur über einen geprüften Änderungsprozess geändert werden, setzen Sie `REBASE_PROVISION=false` auf jedem Prozess, der Anfragen bedient:

| Einstellung | Collection-Tabellen und Policies | Framework-Tabellen |
|---|---|---|
| Standard (`REBASE_MIGRATE_ON_BOOT=ensure`) | beim Start angelegt und aktuell gehalten | angelegt und aktuell gehalten |
| `REBASE_MIGRATE_ON_BOOT=none` | unangetastet | angelegt und aktuell gehalten |
| `REBASE_PROVISION=false` | unangetastet | unangetastet; was fehlt, wird im Log genannt |

Mit abgeschaltetem Provisioning legt die Runtime nichts an und ändert nichts: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Policy, Rolle oder Berechtigung. Das gilt beim Start und danach, auch für die Tabellen, die ein bedienender Prozess sonst bei der ersten Nutzung erstellt (Idempotenzschlüssel, Cron-Claims, die gemeinsamen Rate-Limit-Zähler). Stattdessen liest sie, was vorhanden ist:

- **Auth-Tabellen oder eine von Auth gelesene Spalte fehlen:** Der Start wird verweigert, und jede einzelne wird aufgeführt.
- **Die Request-Rolle erreicht eine Framework-Tabelle** wie `rebase.refresh_tokens` oder `rebase.api_keys`: Der Start wird verweigert und das auszuführende `REVOKE` ausgegeben. Ein Provisioning-Start entzieht diese Rechte von selbst. Mit abgeschaltetem Provisioning tut das niemand.
- **Eine optionale Tabelle fehlt** (API-Schlüssel, Idempotenzschlüssel, Cron-Claims, Rate-Limit-Zähler, Presence, Metrik-Verlauf): Diese Funktion ist aus, und das Log nennt die Tabelle, die sie braucht.

Zeilen ändern sich weiterhin, wie in jeder Datenbank: Anmeldungen, Sitzungen, Nutzung von API-Schlüsseln, Idempotenzschlüssel, Cron-Claims. Das erste Admin-Konto (`REBASE_ADMIN_EMAIL`) wird vom Provisioning-Lauf angelegt, nicht von den bedienenden Prozessen. [Live-Schemabearbeitung](/docs/backend/live-schema-editing) kann eine Änderung weiterhin als Quellcode committen, verweigert aber, sie auf die Datenbank anzuwenden.

### Der Provisioning-Lauf

<span class="since-badge" data-since="0.26">Seit 0.26</span>

Das Schema stammt aus einem Lauf, den Ihr Änderungsprozess steuert. Verwenden Sie dasselbe Image und Bundle wie der Server, mit `REBASE_PROVISION_ONLY=true`, verbunden als eine Rolle, die in der Datenbank anlegen darf. `REBASE_PROVISION_SQL_OUT` hält jede Schemaänderung des Laufs als SQL-Skript fest:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

Das Skript ist ein Protokoll, kein Plan: Jede Anweisung darin wurde der Reihe nach ausgeführt und war erfolgreich. Gegen eine leere Datenbank aufgezeichnet, ist es das gesamte Schema, das das Release braucht. Gegen eine wiederhergestellte Kopie der Produktion aufgezeichnet, ist es genau das Upgrade. Vom Lauf geschriebene Zeilen sind nicht enthalten. Prüfen Sie es und wenden Sie es dann auf die echte Datenbank an:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Wiederholen Sie das bei jedem Rebase-Upgrade, bevor die bedienenden Prozesse ausgerollt werden. Ein Release kann eine Tabelle oder Spalte hinzufügen, und ein Prozess, der nichts anlegen darf, meldet sie als fehlend, statt sie zu erstellen.

Ein selbst gebauter Server folgt derselben Regel: `initializeRebaseBackend` liest `REBASE_PROVISION`, und `createRebaseBackend` nimmt [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Dateispeicher

Der Speicher ist standardmäßig **deaktiviert**, sofern kein Bucket konfiguriert ist, und das ist beabsichtigt: Der alternative Standard wäre das Dateisystem des Containers, wodurch jede hochgeladene Datei beim nächsten Neustart stillschweigend verloren ginge. Uploads werden mit `501 STORAGE_NOT_CONFIGURED` abgewiesen, bis Sie einen Speicher einrichten.

Für einen Bucket setzen Sie `STORAGE_TYPE=s3` (oder `gcs`) zusammen mit dem Bucket-Namen und den Zugangsdaten – die Compose-Datei listet die Variablen auskommentiert auf. `gcs` lädt `@google-cloud/storage`, das das offizielle Image nicht mitliefert; greifen Sie mit diesem Image daher stattdessen über den S3-kompatiblen Endpunkt auf Google Cloud Storage zu (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, HMAC-Schlüssel).

Für lokalen Festplattenspeicher, der nur dann geeignet ist, wenn der Pfad ein echtes Volume ist, das über den Container hinaus fortbesteht:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` ist dort nicht optional: In der Produktion wird ein `local`-Backend verworfen statt registriert, da die Alternative Uploads wären, die in einem Dateisystem erfolgreich sind, das kurz vor der Zerstörung steht. Mit dieser Variable bestätigen Sie, dass der Mount persistent ist.

Mounten Sie das Volume **über** `STORAGE_PATH`, nicht direkt darauf. `STORAGE_PATH` ist das Verzeichnis des Standard-Buckets, und jeder in `config/resources.ts` deklarierte Bucket erhält daneben sein eigenes Verzeichnis, `<STORAGE_PATH>__<key>`. Ein Volume direkt auf `STORAGE_PATH` enthält nur den Standard-Bucket. Jeder andere Bucket schreibt in das Dateisystem des Containers und verliert seine Dateien, wenn der Container neu erstellt wird. `STORAGE_PATH__MEDIA` kann einen Bucket an eine andere Stelle auf dem Volume verschieben. Er kann ihn jedoch nicht in das Verzeichnis eines anderen Buckets verschieben, wie etwa `/storage/uploads/media`, da der Standard-Bucket dessen Dateien sonst auflisten, ausliefern und löschen würde.

Das Image erstellt `/storage` für den unprivilegierten `node`-Benutzer, unter dem es ausgeführt wird; deshalb gehört das Volume dorthin. Ein Volume, das an einer Stelle gemountet wird, an der das Image kein Verzeichnis hat, gehört root, und jeder Upload schlägt mit `EACCES` fehl. Die von `rebase init` erstellte Compose-Datei mountet es auf diese Weise.

### Speicher benötigt ein Zugriffssteuerungsmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime in der Produktion den Start**, bis das Deployment festlegt, wie Objekte geschützt werden. Der Speicher unterliegt nicht der Row-Level Security und seine Schlüssel teilen sich einen flachen Namensraum. Ohne Regeln ist das Einzige, was die Dateien zweier Benutzer trennt, die Unerratbarkeit der Schlüssel – was durch `GET /storage/list?prefix=` zunichtegemacht wird. Jede der folgenden Optionen erfüllt diese Anforderung:

- ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration Ihres Projekts, was die eigentliche Lösung ist und standardmäßig im Scaffold in `config/storage.ts` enthalten ist – keine Umgebungsvariable kann ausdrücken: „Dieser Benutzer darf diesen Schlüssel lesen“;
- **`STORAGE_PUBLIC_READ=true`** für einen Bucket, der tatsächlich ein öffentliches, schreibgeschütztes CDN ist;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`** für eine Single-Tenant-Anwendung, bei der jedem angemeldeten Konto für jede Datei vertraut wird.

Außerhalb der Produktion führt dieselbe Bedingung lediglich zu einer deutlichen Warnung statt zu einer Startverweigerung. Diesen Startfehler erleben Sie also beim Deploy und nicht auf Ihrem Entwicklungsrechner. Das ist beabsichtigt: Der Fehler, den dies ersetzt, wäre sonst ein stiller Fehler.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, wenn Sie TOTP verwenden. Bleibt dieser ungesetzt, werden gespeicherte Authenticator-Secrets mit `JWT_SECRET` verschlüsselt – eine Rotation dessen meldet also alle Benutzer ab *und* macht jedes registrierte Gerät unentschlüsselbar.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht, sodass alles funktioniert, was Container ausführen kann. Zwei Dinge müssen überall beachtet werden:

1. Das Bundle muss unter `/bundle` (oder dem Pfad, auf den `REBASE_BUNDLE` zeigt) vorhanden sein, mit den daneben installierten Abhängigkeiten – siehe [Abhängigkeiten](#abhängigkeiten).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime verweigert den Start in der Produktion ohne diese Variablen, anstatt Vermutungen anzustellen.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.25.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die oben beschriebene abgeleitete Image-Form, damit das Bundle mit der App ausgeliefert wird, und führen Sie dann `fly deploy` aus.

### Railway / Render

Verweisen Sie mit dem Dienst auf das abgeleitete Image, setzen Sie die Umgebungsvariablen und stellen Sie den Healthcheck-Pfad auf `/livez` ein.

### Ein einfacher VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` listet die Variablen auf, die gelesen werden. Unter systemd – die beiden `REBASE_ADMIN_*`-Zeilen erfordern 0.18 oder neuer; unter 0.17.3 wurde stattdessen das erste registrierte Konto zum Administrator:

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

`NODE_ENV=production` ist keine reine Formalität. Bleibt es ungesetzt, läuft der Prozess im Entwicklungsmodus: Er spiegelt Localhost-Origins wider, liefert die OpenAPI-Spezifikation aus und **lässt das Zeitfenster für den ersten Admin offen** – sodass die erste fremde Person, die das Registrierungsformular findet, zum Administrator wird. Die beiden `REBASE_ADMIN_*`-Zeilen ersetzen dieses Zeitfenster; siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` wird benötigt, weil sich die Datenbank auf derselben Maschine befindet. In der Produktion weist die Runtime jede Variable zurück, die auf localhost verweist – in einem Container ist Loopback der Container selbst, daher ist diese Adresse dort fast immer ein Fehler – und diese Zeile teilt ihr mit, dass die Adresse gewollt ist. Entfernen Sie sie, wenn die Datenbank an anderer Stelle läuft.

Bevorzugen Sie `EnvironmentFile=/etc/rebase.env` mit Dateirechten 0600 gegenüber `Environment=`-Zeilen für Secrets: Eine Unit-Datei ist für alle lesbar (world-readable), und `systemctl show` gibt jeden `Environment=`-Wert aus.

## Connection-Pooling

Die Runtime unterhält einen kleinen, langlebigen Pool und benötigt keinen Pooler. Was ihn jedoch benötigt, ist alles andere, was mit derselben Datenbank kommuniziert und keine dauerhafte Verbindung halten kann: eine Serverless-Funktion, ein zeitgesteuertes Skript, ein BI-Tool, ein Queue-Worker, der auf fünfzig Instanzen skaliert. `max_connections` in Postgres ist ein striktes Limit im unteren Hunderterbereich und jede Verbindung ist ein eigener *Prozess* – ein Lambda-Fan-Out erschöpft dieses Limit daher lange bevor die Datenbank ausgelastet ist.

Die Compose-Datei liefert einen `pgbouncer`-Dienst für diesen Datenverkehr mit, der hinter einem Profil liegt, damit ein Deployment ohne solche Aufrufer keinen unnötigen Prozess ausführt:

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

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert, sodass das Passwort nicht doppelt eingetragen werden muss. Der Pooler authentifiziert sich bei Postgres mittels `scram-sha-256`, was von Postgres 18 gespeichert wird – der Standardwert `md5` des Images lässt das *Server*-Login mit `FATAL: server login failed: wrong password type` fehlschlagen, was wie ein falsches Passwort aussieht, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich unter dem `max_connections`-Wert der Datenbank – die Runtime bedient sich aus demselben Kontingent.

### Was Transaction-Pooling ändert

Ein gepoolter Client hält eine Serververbindung für die Dauer einer Transaktion und gibt sie danach wieder frei; dadurch können sich 500 Clients 20 Verbindungen teilen. Drei Dinge funktionieren über diesen Port nicht mehr, und jede davon wird von Rebase selbst genutzt – weshalb sich die Runtime direkt verbindet und dieser Port für andere Aufrufer gedacht ist:

- **`LISTEN`/`NOTIFY`.** Realtime basiert darauf, und ein Listener benötigt eine Verbindung, die über eine Transaktion hinaus fortbesteht. `LISTEN` wird über den Pooler zwar *akzeptiert* – er antwortet auf `LISTEN`, aber es wird nie eine Benachrichtigung eintreffen.
- **Session-Status**: `SET` (im Gegensatz zu `SET LOCAL`), anweisungsübergreifend gehaltene Advisory Locks, `WITH HOLD`-Cursor, temporäre Tabellen. Die nächste Transaktion landet möglicherweise auf einer anderen Serververbindung, die davon nichts sieht. Beide scheitern auf dieselbe unpraktische Weise: Bei einem einzelnen untätigen Client ist der Status meist noch vorhanden, sodass es beim Testen funktioniert, aber genau unter der Nebenläufigkeit fehlschlägt, für die der Pooler eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Den meisten Treibern kann mitgeteilt werden, diese nicht zu verwenden – node-postgres tut dies standardmäßig nicht; asyncpg benötigt `statement_cache_size=0`.

`SET LOCAL` ist an die Transaktion gebunden und funktioniert; damit wird auch Row-Level Security gesetzt – RLS verhält sich über den gepoolten Port also identisch.

Lassen Sie das Profil deaktiviert, wenn sich außerhalb der Runtime nichts mit Ihrer Datenbank verbindet. Ein ungenutzter Port ist Angriffsfläche.

## Healthchecks

| Path | Verwendungszweck |
| --- | --- |
| `/livez` | Liveness. Beantwortet die Frage „Lebt dieser Prozess?“, ohne die Datenbank zu berühren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez` aus. Eine Liveness-Probe auf `/health` startet bei einem kurzen Datenbankproblem einen vollkommen gesunden Prozess neu – was genau das Gegenteil dessen ist, wofür sie gedacht ist.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Anzahl der Anfragen und Latenz-Histogramme aufgeschlüsselt nach API-Bereich (data, auth, storage, functions) und Collection, plus Prozess-Gauges. Ohne Token ist der Endpunkt für jeden lesbar, der den Port erreichen kann; setzen Sie also ein Token, es sei denn, er befindet sich in einem privaten Netzwerk.

`rebase_db_pool_wait_ms` ist ein Histogramm darüber, wie lange jede Abfrage auf eine Verbindung aus dem Datenbank-Pool gewartet hat (das Öffnen einer Verbindung inbegriffen), gelabelt nach Datenquellen-Schlüssel (`source="(default)"` in einem Projekt, das keine Datenquellen deklariert). Ein gesunder Pool hält diesen Wert nahe null. Ein Tail, der mit dem Datenverkehr wächst, bedeutet, dass sich Anfragen in einer Warteschlange für Verbindungen stauen – meist gehalten von Schreib-Callbacks, die auf etwas Langsames warten; siehe [A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

## Sicherheits-Header

Jede Antwort enthält `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` und `Strict-Transport-Security: max-age=15552000` (180 Tage). Der HSTS-Header lässt `includeSubDomains` aus: Dies würde Browser anweisen, unverschlüsseltes HTTP auf jeder Subdomain Ihrer Domain zu verweigern – einschließlich solcher, mit denen dieser Server nichts zu tun hat –, und ein Browser speichert dies so lange, wie der Header vorgibt.
Setzen Sie `REBASE_HSTS_INCLUDE_SUBDOMAINS=true`, wenn jede Subdomain ausschließlich HTTPS verwendet; bis einschließlich Version 0.23 enthielt der Header immer `includeSubDomains`.

`strict-origin-when-cross-origin` ist die Voreinstellung der Browser selbst: Eine Anfrage an eine andere Website enthält Ihren Origin, aber nie den Pfad oder die Query der Seite. Es ist nicht `no-referrer`, weil Origin-Prüfungen den Origin brauchen – der Google-Anmeldebutton vergleicht ihn mit den autorisierten JavaScript-Ursprüngen des OAuth-Clients und antwortete unter `no-referrer` bei jeder App mit „The given origin is not allowed for the given client ID“, unabhängig davon, was der Client erlaubte. Eine Antwort, die ihre eigene Richtlinie setzt, behält diese (die MCP-Zustimmungsseite sendet `no-referrer`); eine Seite, die eine strengere möchte, gibt das mit `<meta name="referrer" content="no-referrer">` an.

Die statischen Apps – die CMS-Admin-Oberfläche und jedes Frontend, das das Bundle ausliefert – enthalten außerdem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Dies bestimmt, wer die App in einem Frame einbetten darf, schließt Plugins aus und bindet `<base>` an Ihren Origin; darüber hinaus schränkt es nichts ein, sodass Inline-Skripte, Worker und Anmeldungen über Drittanbieter weiterhin funktionieren. Eine Antwort, die ihre eigene Richtlinie setzt, behält diese bei. Für strengere Regeln platzieren Sie die Richtlinie auf dem vorgeschalteten Reverse-Proxy.

## Mehrere Instanzen

Ein einzelner Container ist der Standard und benötigt nichts weiter. Bevor ein zweites Replikat Datenverkehr empfängt – oder ein Rolling Deploy zwei Instanzen nebeneinander ausführt –, lesen Sie [Mehrere Instanzen ausführen](/docs/deployment/multiple-instances/): Rate-Limits, Broadcast-Channels, lokale Dateien, fortsetzbare Uploads und der Image-Cache gelten pro Prozess, bis sie über eine Konfiguration geteilt werden.

## Funktionen in einem eigenen Prozess ausführen

Alles oben Beschriebene ist ein einzelner Container, der das gesamte Projekt bereitstellt – was für fast jedes Deployment die richtige Struktur ist. Wenn eine benutzerdefinierte Funktion nicht mehr mit der Daten-API um die Event-Loop konkurrieren soll – oder unabhängig skaliert, neu gestartet werden und fehlschlagen können soll –, können dasselbe Image und dasselbe Bundle als mehrere zusammenarbeitende Prozesse gestartet werden. Siehe [Getrennte Prozesse](/docs/deployment/split-processes/).

## Upgrade

```yaml
image: rebasepro/server:0.25.1
```

Neu starten. Ihr Bundle bleibt unverändert. Innerhalb einer Major-Version des Runtime-Contracts funktioniert ein zuvor validiertes Bundle weiterhin – siehe [Kompatibilität](/docs/architecture/runtime-and-bundles/#compatibility).

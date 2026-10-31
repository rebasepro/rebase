---
sourceHash: caa4e79614f7401e
title: Self-Hosting
sidebar_label: Self-Hosting
description: Führen Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle aus – Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Das Self-Hosting von Rebase bedeutet, zwei Dinge zu betreiben: eine Postgres-Datenbank und das offizielle `rebasepro/server`-Image, in das das Bundle Ihres Projekts gemountet ist.

Es muss **kein Anwendungs-Image gebaut werden**. Ihr Projekt wird als Bundle bereitgestellt, die Runtime ist veröffentlicht, und ein Upgrade von Rebase ist eine Änderung des Tags statt eines Neuerstellens (Rebuild). Siehe [Runtime and bundles](/docs/architecture/runtime-and-bundles/) für die Gründe für diese Aufteilung.

## Docker Compose

**Wenn Ihr Projekt aus `rebase init` stammt, verwenden Sie dessen eigene `docker-compose.yml`.** Sie befindet sich in Ihrem Repository, `init` hat die Secrets, das erste Administratorkonto und die festgelegte Runtime-Version eingetragen, und es ist die Datei, die unter [Deployment](/docs/getting-started/deployment/#docker-compose-recommended) beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite beschreibt dasselbe Deployment ohne ein Scaffold im Hintergrund – das Projekt einer anderen Person, ein in der CI erstelltes Bundle oder die beiden Dinge, die die generierte Datei bewusst auslässt: einen Connection-Pooler und die Formen getrennter Prozesse (Split-Process). Diese Version befindet sich im Repository unter [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Verwenden Sie diese Datei, anstatt ein Snippet von dieser Seite zu kopieren: Beide Dateien werden bei jedem Push vom projekteigenen Acceptance-Gate gestartet, sodass keine von dem abweichen kann, was tatsächlich funktioniert.

Beide stimmen bei jeder Umgebungsvariable überein, mit Ausnahme des Datenbankpassworts. Das liegt daran, dass jede für ihren eigenen Ersteller geschrieben wurde: Diese liest `POSTGRES_PASSWORD`, das von `quickstart.sh` generiert wird; die generierte Version liest `DATABASE_PASSWORD`, das `rebase init` auch in die `DATABASE_URL` einbettet, die es in Ihre `.env` schreibt.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` ist ein einziger Befehl, der zwei naheliegende Dinge tut und beide ausgibt. Die ausführliche Variante, falls Sie jeden Schritt selbst kontrollieren möchten:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Sie müssen die Datenbank nicht separat starten – `api` wartet auf deren Healthcheck.

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

Drei Secrets, ein Fakt und das Konto, mit dem Sie sich anmelden:

- **`POSTGRES_PASSWORD`** – das Datenbankpasswort. Wenn Sie es später ändern, müssen Sie es auch im Volume ändern, wählen Sie es also einmalig fest.
- **`JWT_SECRET`** – signiert jede Session. Eine Rotation meldet alle Benutzer ab.
- **`REBASE_SERVICE_KEY`** – die Zugangsdaten, die Row-Level Security für Server-zu-Server-Aufrufe umgehen. Behandeln Sie diesen wie ein Root-Passwort: Alles, was ihn besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** – die Origins, von denen Ihr Frontend bereitgestellt wird, kommagetrennt. Kein Secret und nicht optional: Die Runtime verweigert in der Produktion den Start ohne diesen Wert, anstatt zu raten, da eine API, die ihre erlaubten Origins errät, irgendwann die falsche zulässt.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** – der erste Administrator. Eine neue Datenbank enthält keine Benutzer, und außerhalb der Produktion lässt die Registrierungsrichtlinie die erste Registrierung zu und befördert sie zum Administrator – andernfalls wäre eine leere Datenbank eine Sackgasse, da das Bootstrappen eines Administrators einen Aufrufer erfordert, der bereits angemeldet ist. Sobald dieser Stack unter einem Hostnamen antwortet, wird dieser Komfort zu einer Race Condition, die der Operator verlieren kann; daher wird das Zeitfenster in der Produktion geschlossen und das Konto stattdessen hier angegeben. Die Runtime erstellt es einmalig, solange die Benutzertabelle leer ist, und tut dies bei jedem nachfolgenden Start nicht mehr.

`JWT_SECRET` und `REBASE_SERVICE_KEY` müssen jeweils mindestens 32 Zeichen lang sein, und das Administratorpasswort mindestens 12. Verwenden Sie eine Adresse mit einem Punkt in der Domain: `POST /auth/login` parst den Body mit `z.string().email()`, sodass die Runtime sich weigert, `admin@localhost` als Seed anzulegen – ein Konto, an dem sich niemand anmelden könnte – und stattdessen den Grund protokolliert. Die Compose-Datei deklariert alle sechs mit `${VAR:?…}`, sodass ein fehlender Wert den Stack mit einer Meldung stoppt, die ihn benennt, anstatt etwas halb Konfiguriertes zu starten – und die Selbstregistrierung ist standardmäßig deaktiviert (`DISABLE_SELF_REGISTRATION`, Standard `true`), sodass nichts unbeansprucht bleibt.

Melden Sie sich mit diesen Anmeldedaten an und ändern Sie das Passwort: Sie befinden sich in einer Datei auf dem Host.

## Abhängigkeiten

Standardmäßig **installiert `rebase build` die Abhängigkeiten Ihres Projekts in das Bundle**, sodass `dist-bundle` neben der `package.json` auch `node_modules` und eine `package-lock.json` enthält. Ein solches vorkonfektioniertes (vendored) Bundle startet in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt mounten – was sich empfiehlt, da ein kompromittierter Hook dann den Code, der nach dem nächsten Neustart ausgeführt wird, nicht überschreiben kann:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` schließt dies aus und erzeugt ein Bundle, das seine Abhängigkeiten stattdessen beim ersten Start installiert, was 40–60 Sekunden pro Start dauert und erfordert, dass der Mount beschreibbar ist.

Für ein echtes Deployment sollten Sie es vorziehen, beides in ein Image einzubetten (bake), wodurch auch exakt festgelegt wird, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.26.0
COPY dist-bundle /bundle
```

## Erstellen des Schemas

**Die Runtime erstellt fehlende Tabellen beim Booten, einschließlich der Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt: Es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an. Ein erster Start gegen eine leere Datenbank stellt Ihre Collections ohne separaten Schritt bereit.

Was `ensure` ganz bewusst niemals tut, ist das Ändern bestehender Elemente. Es ändert keinen Spaltentyp, löscht keine Tabelle oder Spalte und bearbeitet nicht die Labels eines bestehenden Enums – denn ein Container-Neustart darf niemals in der Lage sein, ein Schema als Nebeneffekt eines Deploys umzugestalten.

Daher lohnt sich die Ausführung von `rebase db push` weiterhin für alles, was beim Booten unberührt bleibt – jede Änderung, die nicht rein additiv ist: eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

```bash
rebase db push
```

Führen Sie es aus einem Checkout oder einem CI-Job aus, der auf die Datenbank des Deployments verweist. Es führt zunächst einen Probelauf (Dry-Run) der Änderung durch, verweigert destruktive Änderungen ohne ausdrückliche Bestätigung und kann vor der Anwendung ein Backup erstellen. Die Datenbank gibt in der Compose-Datei einen Port frei, damit dieser vom Host aus erreicht werden kann; entfernen Sie dieses Mapping, sobald das Schema eingerichtet ist, falls die Datenbank von außen nicht erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert `ensure` und `none`, und sonst nichts – das Image **verweigert den Start** bei `push`, aus dem oben genannten Grund.

## Wenn nur Ihr Change-Prozess die Datenbank ändern darf

`REBASE_MIGRATE_ON_BOOT=none` lässt Ihre Collections unberührt. Die Datenbank lässt es jedoch nicht unberührt: Die framework-eigenen Tabellen (Auth, API-Keys, Jobs, Cron) werden weiterhin bei jedem Start erstellt und aktuell gehalten. Wenn die Datenbank nur über einen geprüften Change-Prozess geändert werden darf, setzen Sie `REBASE_PROVISION=false` für jeden Prozess, der Anfragen bedient:

| Einstellung | Collection-Tabellen und -Policies | Framework-Tabellen |
|---|---|---|
| Standard (`REBASE_MIGRATE_ON_BOOT=ensure`) | beim Start erstellt und aktuell gehalten | erstellt und aktuell gehalten |
| `REBASE_MIGRATE_ON_BOOT=none` | unberührt gelassen | erstellt und aktuell gehalten |
| `REBASE_PROVISION=false` | unberührt gelassen | unberührt gelassen; alles Fehlende wird im Log benannt |

Wenn das Provisioning deaktiviert ist, erstellt und ändert die Runtime nichts: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Policy, keine Rolle oder Berechtigung (Grant). Das gilt beim Booten und danach, einschließlich der Tabellen, die ein Serverprozess sonst bei der ersten Verwendung anlegt (Idempotenz-Schlüssel, Cron-Claims, die gemeinsamen Rate-Limit-Zähler). Stattdessen liest sie, was vorhanden ist:

- **Auth-Tabellen oder eine Spalte, die Auth liest, fehlen:** Der Start wird verweigert und jede einzelne aufgelistet.
- **Die Request-Rolle kann eine Framework-Tabelle erreichen**, wie z. B. `rebase.refresh_tokens` oder `rebase.api_keys`: Der Start wird verweigert und der auszuführende `REVOKE`-Befehl ausgegeben. Ein Provisioning-Start entzieht diese Berechtigungen von selbst. Bei deaktiviertem Provisioning geschieht dies nicht.
- **Eine optionale Tabelle fehlt** (API-Keys, Idempotenz-Schlüssel, Cron-Claims, Rate-Limit-Zähler, Presence, Metrik-Historie): Dieses Feature ist deaktiviert, und das Log gibt an, welche Tabelle benötigt wird.

Zeilen ändern sich weiterhin wie in jeder Datenbank: Anmeldungen, Sessions, API-Key-Nutzung, Idempotenz-Schlüssel, Cron-Claims. Das erste Administratorkonto (`REBASE_ADMIN_EMAIL`) wird durch den Provisioning-Lauf geseedet, nicht durch die bedienenden Prozesse. [Live schema editing](/docs/backend/live-schema-editing) kann eine Änderung weiterhin als Quellcode committen, weigert sich jedoch, sie auf die Datenbank anzuwenden.

### Der Provisioning-Lauf

Das Schema stammt aus einem Durchlauf, den Ihr Change-Prozess steuert. Verwenden Sie dasselbe Image und Bundle wie der Server, mit `REBASE_PROVISION_ONLY=true`, verbunden als Rolle, die in der Datenbank erstellen darf. `REBASE_PROVISION_SQL_OUT` speichert jede Schemaänderung, die der Durchlauf vorgenommen hat, als SQL-Skript:

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

Das Skript ist ein Protokoll, kein Plan: Jede Anweisung darin wurde der Reihe nach ausgeführt und war erfolgreich. Gegen eine leere Datenbank aufgezeichnet, stellt es das gesamte Schema dar, das das Release benötigt. Gegen eine wiederhergestellte Kopie der Produktionsdatenbank aufgezeichnet, stellt es exakt das Upgrade dar. Zeilen, die der Durchlauf geschrieben hat, sind nicht darin enthalten. Überprüfen Sie es und wenden Sie es dann auf die echte Datenbank an:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Wiederholen Sie dies bei jedem Rebase-Upgrade, bevor die bedienenden Prozesse aktualisiert (rolling update) werden. Ein Release kann eine Tabelle oder eine Spalte hinzufügen, und ein Prozess, der keine erstellen darf, meldet sie als fehlend, anstatt sie zu erzeugen.

Ein Server, den Sie selbst bauen, folgt denselben Regeln: `initializeRebaseBackend` liest `REBASE_PROVISION`, und `createRebaseBackend` akzeptiert [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Dateispeicher

Speicher ist **deaktiviert**, es sei denn, ein Bucket ist konfiguriert, und das ist Absicht: Die alternative Standardeinstellung wäre das Dateisystem des Containers, wodurch jede hochgeladene Datei beim nächsten Neustart stillschweigend verloren ginge. Uploads werden mit `501 STORAGE_NOT_CONFIGURED` abgewiesen, bis Sie einen konfigurieren.

Setzen Sie für einen Bucket `STORAGE_TYPE=s3` (oder `gcs`) sowie den Bucket-Namen und die Anmeldedaten – die Compose-Datei listet die Variablen auskommentiert auf. `gcs` lädt `@google-cloud/storage`, das im offiziellen Image nicht enthalten ist; greifen Sie auf diesem Image stattdessen über den S3-kompatiblen Endpunkt auf Google Cloud Storage zu (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, HMAC-Keys).

Für lokalen Festplattenspeicher, der nur dann geeignet ist, wenn der Pfad ein echtes Volume ist, das den Container überdauert:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` ist dort nicht optional: In der Produktion wird ein `local`-Backend verworfen statt registriert, da die Alternative Uploads wären, die in einem Dateisystem erfolgreich sind, das kurz vor der Zerstörung steht. Über diese Variable bestätigen Sie, dass der Mount persistent ist.

Mounten Sie das Volume **oberhalb** von `STORAGE_PATH`, nicht direkt darauf. `STORAGE_PATH` ist das Verzeichnis des Standard-Buckets, und jeder in `config/resources.ts` deklarierte Bucket erhält ein eigenes daneben: `<STORAGE_PATH>__<key>`. Ein Volume direkt unter `STORAGE_PATH` enthält nur den Standard-Bucket. Jeder andere Bucket schreibt in das Dateisystem des Containers und verliert seine Dateien, wenn der Container neu erstellt wird. `STORAGE_PATH__MEDIA` kann einen Bucket an eine andere Stelle auf dem Volume verschieben. Es kann ihn jedoch nicht in das Verzeichnis eines anderen Buckets verschieben, wie etwa `/storage/uploads/media`, da der Standard-Bucket dann dessen Dateien auflisten, ausliefern und löschen würde.

Das Image erstellt `/storage` für den unprivilegierten `node`-Benutzer, unter dem es läuft, weshalb das Volume dorthin gehört. Ein Volume, das an einer Stelle gemountet wird, an der das Image kein Verzeichnis hat, gehört root, und jeder Upload schlägt mit `EACCES` fehl. Die von `rebase init` geschriebene Compose-Datei mountet es auf diese Weise.

### Storage erfordert ein Zugriffskontrollmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime in der Produktion den Start**, bis das Deployment angibt, wie Objekte geschützt sind. Storage unterliegt nicht der Row-Level Security und seine Schlüssel teilen sich einen einzigen flachen Namensraum. Ohne Regeln trennt die Dateien zweier Benutzer daher nur die Unvorhersehbarkeit der Schlüssel – was durch `GET /storage/list?prefix=` zunichtegemacht wird. Jede der folgenden Optionen erfüllt diese Anforderung:

- ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration Ihres Projekts, was die eigentliche Lösung darstellt und was das Scaffold in `config/storage.ts` mitliefert – keine Umgebungsvariable kann ausdrücken: „Dieser Benutzer darf diesen Schlüssel lesen“;
- **`STORAGE_PUBLIC_READ=true`** für einen Bucket, der tatsächlich ein öffentliches Read-only-CDN ist;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`** für eine Single-Tenant-App, bei der jedem angemeldeten Konto für jede Datei vertraut wird.

Außerhalb der Produktion führt dieselbe Bedingung zu einer deutlichen Warnung statt zu einer Verweigerung; dies ist also ein Startfehler, der Ihnen beim Deployment und nicht auf dem Laptop begegnet. Das ist beabsichtigt: Der Fehler, den er ersetzt, wäre lautlos.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, wenn Sie TOTP verwenden. Bleibt dies ungesetzt, werden gespeicherte Authenticator-Secrets mit `JWT_SECRET` verschlüsselt – eine Rotation meldet dann alle Benutzer ab *und* macht jedes registrierte Gerät unentschlüsselbar.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht, sodass alles funktioniert, was Container ausführen kann. Zwei Dinge müssen überall stimmen:

1. Das Bundle muss unter `/bundle` (oder dem Pfad, auf den `REBASE_BUNDLE` verweist) vorhanden sein, mit den daneben installierten Abhängigkeiten – siehe [Abhängigkeiten](#abhängigkeiten).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime weigert sich in der Produktion, ohne diese Werte zu starten, anstatt zu raten.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.26.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die obige Form mit abgeleitetem Image, damit das Bundle mit der App ausgeliefert wird, und führen Sie dann `fly deploy` aus.

### Railway / Render

Verweisen Sie mit dem Service auf das abgeleitete Image, setzen Sie die Umgebungsvariablen und legen Sie den Healthcheck-Pfad auf `/livez` fest.

### Ein einfacher VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` listet die Variablen auf, die es liest. Unter systemd – die beiden `REBASE_ADMIN_*`-Zeilen erfordern Version 0.18 oder neuer; unter 0.17.3 wird stattdessen das erste registrierte Konto zum Administrator:

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

`NODE_ENV=production` ist keine Dekoration. Bleibt dies ungesetzt, läuft der Prozess im Entwicklungsmodus: Er spiegelt localhost-Origins wider, liefert die OpenAPI-Spezifikation aus und **lässt das Zeitfenster für den ersten Administrator offen** – sodass der erste Fremde, der das Registrierungsformular findet, zum Administrator wird. Die beiden `REBASE_ADMIN_*`-Zeilen ersetzen dieses Zeitfenster; siehe [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` ist vorhanden, weil sich die Datenbank auf derselben Maschine befindet. In der Produktion lehnt die Runtime jede Variable ab, die auf localhost verweist – in einem Container ist Loopback der Container selbst, daher ist diese Adresse immer ein Fehler – und diese Zeile teilt ihr mit, dass die Adresse beabsichtigt ist. Entfernen Sie sie, wenn die Datenbank an anderer Stelle läuft.

Bevorzugen Sie `EnvironmentFile=/etc/rebase.env` mit Dateirechten 0600 gegenüber `Environment=`-Zeilen für die Secrets: Eine Unit-Datei ist für alle lesbar (world-readable), und `systemctl show` gibt jeden `Environment=`-Wert aus.

## Connection-Pooling

Die Runtime hält einen kleinen, langlebigen Pool und benötigt keinen Pooler. Was ihn jedoch benötigt, ist alles andere, was mit derselben Datenbank kommuniziert und keine Verbindung halten kann: eine serverlose Funktion, ein geplantes Skript, ein BI-Tool, ein Queue-Worker, der auf fünfzig Instanzen skaliert. `max_connections` von Postgres ist ein hartes Limit im unteren Hunderterbereich und jede Verbindung ist ein eigener *Prozess*, sodass ein Lambda-Fan-out dieses erschöpft, lange bevor die Datenbank ausgelastet ist.

Die Compose-Datei liefert einen `pgbouncer`-Service für diesen Datenverkehr mit, hinter einem Profil, damit ein Deployment ohne solche Aufrufer keinen Prozess ausführt, für den es keine Verwendung hat:

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

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert, sodass das Passwort nicht doppelt geschrieben werden muss. Der Pooler authentifiziert sich bei Postgres mit `scram-sha-256`, was Postgres 18 speichert – der Standard `md5` des Images lässt das *Server*-Login mit `FATAL: server login failed: wrong password type` fehlschlagen, was sich wie ein falsches Passwort liest, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich unter dem `max_connections`-Wert der Datenbank – die Runtime bedient sich aus demselben Budget.

### Was Transaction-Pooling ändert

Ein gepoolter Client hält eine Serververbindung für die Dauer einer Transaktion und gibt sie dann zurück; das ermöglicht es 500 Clients, sich 20 Verbindungen zu teilen. Drei Dinge funktionieren über diesen Port nicht mehr, und jedes davon wird von Rebase selbst verwendet – genau deshalb verbindet sich die Runtime direkt und dieser Port ist für andere Aufrufer gedacht:

- **`LISTEN`/`NOTIFY`.** Realtime basiert darauf, und ein Listener benötigt eine Verbindung, die eine Transaktion überdauert. `LISTEN` wird über den Pooler zwar *akzeptiert* – er antwortet auf `LISTEN`, doch es trifft danach nie eine Benachrichtigung ein.
- **Session-Status**: `SET` (im Gegensatz zu `SET LOCAL`), anweisungsübergreifende Advisory Locks, `WITH HOLD`-Cursor, temporäre Tabellen. Die nächste Transaktion landet möglicherweise auf einer anderen Serververbindung, die nichts davon sieht. Beides schlägt auf dieselbe unhilfreiche Art fehl: Bei einem einzelnen untätigen Client ist der Zustand meist noch da, sodass es beim Testen funktioniert und erst unter der Nebenläufigkeit ausfällt, für die der Pooler überhaupt eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Den meisten Treibern kann mitgeteilt werden, sie nicht zu verwenden – node-postgres tut dies standardmäßig nicht; asyncpg benötigt `statement_cache_size=0`.

`SET LOCAL` ist transaktionsbezogen und funktioniert, und genau damit wird Row-Level Security gesetzt – RLS verhält sich über den gepoolten Port also identisch.

Lassen Sie das Profil deaktiviert, wenn sich außerhalb der Runtime nichts mit Ihrer Datenbank verbindet. Ein ungenutzter Port ist Angriffsfläche.

## Healthchecks

| Pfad | Verwendung |
| --- | --- |
| `/livez` | Liveness. Beantwortet „Lebt dieser Prozess?“, ohne die Datenbank zu berühren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez`. Eine Liveness-Probe auf `/health` startet einen vollkommen gesunden Prozess während eines kurzen Datenbank-Schluckaufs neu, was genau das Gegenteil ihres Zwecks ist.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Request-Zahlen und Latenz-Histogramme, aufgeschlüsselt nach API-Bereich (data, auth, storage, functions) und Collection, sowie Prozess-Gauges. Ohne Token kann der Endpunkt von jedem gelesen werden, der den Port erreichen kann; setzen Sie also einen, es sei denn, er befindet sich in einem privaten Netzwerk.

`rebase_db_pool_wait_ms` ist ein Histogramm darüber, wie lange jede Abfrage auf eine Verbindung aus dem Datenbank-Pool gewartet hat, einschließlich des Öffnens einer Verbindung, gekennzeichnet mit dem Datenquellen-Schlüssel (`source="(default)"` in einem Projekt, das keine Datenquellen deklariert). Ein gesunder Pool hält diesen Wert nahe null. Ein Tail, der mit dem Datenverkehr wächst, bedeutet, dass Requests in einer Warteschlange auf Verbindungen warten – meist blockiert durch Write-Callbacks, die auf etwas Langsames warten; siehe [A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

`rebase_realtime_*` meldet die offenen Sockets, Channels und die an den Channel-Bus gesendeten oder zurückgehaltenen Frames jeder Instanz: siehe [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Sicherheits-Header

Jede Antwort enthält `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` und `Strict-Transport-Security: max-age=15552000` (180 Tage). Der HSTS-Header lässt `includeSubDomains` aus: Dies würde Browser anweisen, unverschlüsseltes HTTP auf jeder Subdomain Ihrer Domain zu verweigern, einschließlich solcher, mit denen dieser Server nichts zu tun hat, und ein Browser speichert dies so lange, wie der Header angibt. Setzen Sie `REBASE_HSTS_INCLUDE_SUBDOMAINS=true`, wenn jede Subdomain ausschließlich HTTPS verwendet; bis einschließlich Version 0.23 enthielt der Header immer `includeSubDomains`.

`strict-origin-when-cross-origin` ist der Standard der Browser selbst: Eine Anfrage an eine andere Website überträgt Ihren Origin und niemals den Pfad oder die Query der Seite. Es ist nicht `no-referrer`, da Origin-Prüfungen den Origin benötigen – der Google-Anmelde-Button vergleicht diesen mit den autorisierten JavaScript-Origins des OAuth-Clients, und unter `no-referrer` antwortete er bei jeder App mit „The given origin is not allowed for the given client ID“, unabhängig davon, was der Client erlaubte. Eine Antwort, die ihre eigene Richtlinie setzt, behält diese bei (die MCP-Zustimmungsseite sendet `no-referrer`); eine Seite, die eine strengere Richtlinie wünscht, kann dies über `<meta name="referrer" content="no-referrer">` deklarieren. `X-Frame-Options` funktioniert genauso: `SAMEORIGIN`, es sei denn, die Antwort setzt einen eigenen Wert, wie es die MCP-Zustimmungsseite mit `DENY` tut.

Die statischen Apps – die CMS-Verwaltung und jedes Frontend, das das Bundle bereitstellt – enthalten außerdem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Dies bestimmt, wer die App in einem Frame einbetten darf, schließt Plugins aus und bindet `<base>` an Ihren Origin, schränkt aber ansonsten nichts ein, sodass Inline-Skripte, Worker und Anmeldungen von Drittanbietern weiterhin funktionieren. Eine Antwort, die ihre eigene Richtlinie setzt, behält diese bei. Wenn Sie strengere Regeln benötigen, hinterlegen Sie die Richtlinie auf dem vorgeschalteten Reverse-Proxy.

## Mehrere Instanzen

Ein Container ist der Standard und benötigt nichts weiter. Bevor ein zweites Replikat Datenverkehr übernimmt – oder ein Rolling Deploy zwei nebeneinander ausführt –, lesen Sie [Running more than one instance](/docs/deployment/multiple-instances/): Rate-Limits, Broadcast-Channels, lokale Dateien, fortsetzbare Uploads (Resumable Uploads) und der Image-Cache gelten pro Prozess, bis eine Einstellung sie teilt.

## Funktionen in einem eigenen Prozess ausführen

Alles oben Beschriebene ist ein einziger Container, der das gesamte Projekt bedient, was für fast jedes Deployment die richtige Form ist. Wenn eine benutzerdefinierte Funktion nicht mehr mit der Daten-API um den Event-Loop konkurrieren soll – oder unabhängig skalieren, neu starten und fehlschlagen können soll –, können dasselbe Image und dasselbe Bundle als mehrere zusammenarbeitende Prozesse gestartet werden. Siehe [Split processes](/docs/deployment/split-processes/).

## Upgrade

```yaml
image: rebasepro/server:0.26.0
```

Neustarten. Ihr Bundle bleibt unverändert. Innerhalb einer Runtime-Contract-Hauptversion (Major) funktioniert ein validiertes Bundle weiterhin – siehe [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).

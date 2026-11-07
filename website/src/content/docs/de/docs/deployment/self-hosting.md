---
sourceHash: dd7f515c841c860b
title: Self-Hosting
sidebar_label: Self-Hosting
description: Führen Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle aus – Docker Compose, Fly, Railway oder ein einfacher VPS.
---

## Übersicht

Rebase selbst zu hosten bedeutet, zwei Dinge auszuführen: eine Postgres-Datenbank und das offizielle `rebasepro/server`-Image, in das das Bundle Ihres Projekts eingebunden ist.

Es muss **kein Anwendungs-Image gebaut werden**. Ihr Projekt wird als Bundle ausgeliefert, die Runtime wird veröffentlicht, und das Upgrade von Rebase ist lediglich eine Tag-Änderung statt eines Rebuilds. Siehe [Runtime and bundles](/docs/architecture/runtime-and-bundles/) für die Gründe dieser Aufteilung.

## Docker Compose

**Wenn Ihr Projekt mit `rebase init` erstellt wurde, verwenden Sie dessen eigene `docker-compose.yml`.**
Sie befindet sich in Ihrem Repository, `init` hat die Secrets, das erste Admin-Konto und die festgelegte Runtime-Version eingetragen, und es ist die Datei, die unter [Deployment](/docs/getting-started/deployment/#docker-compose-recommended) beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite beschreibt dasselbe Deployment ohne ein Scaffold dahinter – das Projekt einer anderen Person, ein in der CI erstelltes Bundle oder die beiden Dinge, die die generierte Datei bewusst auslässt: ein Connection-Pooler und die Split-Process-Architekturen. Diese Datei befindet sich im Repository unter [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Verwenden Sie diese Datei, anstatt einen Schnipsel von dieser Seite zu kopieren: Beide Dateien werden bei jedem Push vom projekteigenen Acceptance-Gate gebootet, sodass keine von dem abweichen kann, was tatsächlich funktioniert.

Beide stimmen bei jeder Umgebungsvariable überein, außer beim Datenbankpasswort – und zwar deshalb, weil jede für ihren eigenen Ersteller geschrieben wurde: Diese Datei liest `POSTGRES_PASSWORD`, welches von `quickstart.sh` generiert wird; die generierte Datei liest `DATABASE_PASSWORD`, welches `rebase init` auch in die `DATABASE_URL` einbettet, die es in Ihre `.env` schreibt.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` ist ein einzelner Befehl, der zwei naheliegende Dinge tut und beide ausgibt. Die ausführliche Variante, falls Sie jeden Schritt lieber selbst steuern möchten:

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

Drei Secrets, ein Fakt und das Konto, mit dem Sie sich anmelden:

- **`POSTGRES_PASSWORD`** – das Datenbankpasswort. Eine spätere Änderung bedeutet, dass es auch im Volume geändert werden muss; wählen Sie es also einmalig sorgfältig aus.
- **`JWT_SECRET`** – signiert jede Session. Eine Rotation meldet alle Benutzer ab.
- **`REBASE_SERVICE_KEY`** – die Anmeldedaten, die Row-Level Security für Server-zu-Server-Aufrufe umgehen. Behandeln Sie diesen wie ein Root-Passwort: Alles, was ihn besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** – die Origins, von denen Ihr Frontend bereitgestellt wird, kommagetrennt. Kein Secret und nicht optional: Die Runtime verweigert den Start in der Produktion ohne diese Angabe, anstatt zu raten, da eine API, die ihre erlaubten Origins errät, irgendwann die falsche zulässt.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** – der erste Administrator. Eine neue Datenbank enthält keine Benutzer, und außerhalb der Produktion erlaubt die Registrierungsrichtlinie die erste Registrierung und befördert sie zum Administrator – andernfalls wäre eine leere Datenbank eine Sackgasse, da das Bootstrapping eines Admins einen bereits angemeldeten Aufrufer erfordert. In dem Moment, in dem dieser Stack unter einem Hostnamen erreichbar ist, wird dieser Komfort zu einer Race Condition, die der Betreiber verlieren kann; in der Produktion ist dieses Fenster daher geschlossen und das Konto wird stattdessen hier angegeben. Die Runtime erstellt es einmalig, solange die Benutzertabelle leer ist, und unternimmt bei jedem weiteren Bootvorgang danach nichts mehr.

`JWT_SECRET` und `REBASE_SERVICE_KEY` müssen jeweils mindestens 32 Zeichen lang sein, das Admin-Passwort mindestens 12. Verwenden Sie eine Adresse mit einem Punkt in der Domain: `POST /auth/login` parst seinen Body mit `z.string().email()`, daher weigert sich die Runtime, `admin@localhost` anzulegen – ein Konto, an dem sich niemand anmelden könnte – und protokolliert stattdessen den Grund. Die Compose-Datei deklariert alle sechs Variablen mit `${VAR:?…}`, sodass eine fehlende Variable den Stack mit einer Fehlermeldung stoppt, die den Namen nennt, anstatt ein halbkonfiguriertes System zu starten – und die Selbstregistrierung ist standardmäßig deaktiviert (`DISABLE_SELF_REGISTRATION`, Standardwert `true`), sodass nichts ungeschützt bleibt.

Melden Sie sich mit diesen Anmeldedaten an und ändern Sie das Passwort: Sie befinden sich in einer Datei auf dem Host.

## Abhängigkeiten

`rebase build` **installiert die Abhängigkeiten Ihres Projekts standardmäßig in das Bundle**, sodass `dist-bundle` ein `node_modules` und eine `package-lock.json` neben der `package.json` enthält. Ein solches vorgebündeltes (vendored) Bundle startet in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt (read-only) einbinden – was empfehlenswert ist, da ein kompromittierter Hook dann den Code, der nach dem nächsten Neustart ausgeführt wird, nicht überschreiben kann:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` deaktiviert dies und erzeugt ein Bundle, das seine Abhängigkeiten stattdessen beim ersten Start installiert, was 40–60 Sekunden pro Start dauert und erfordert, dass der Mount beschreibbar ist.

Für ein produktives Deployment empfiehlt es sich, beides in ein Image einzubetten, was auch exakt festlegt, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.28.2
COPY dist-bundle /bundle
```

## Erstellen des Schemas

**Die Runtime erstellt fehlende Tabellen beim Booten, einschließlich der Tabellen Ihrer Collections.**
`REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was additiv auf das gesamte Schema wirkt: Fehlende Tabellen, Spalten und Enum-Typen werden erstellt und deren Row-Level Security angewendet. Ein erster Start gegen eine leere Datenbank stellt Ihre Collections ohne separaten Schritt sofort bereit.

Was `ensure` ganz bewusst niemals tut, ist bestehende Elemente zu ändern. Es ändert keinen Spaltentyp, löscht weder Tabellen noch Spalten und bearbeitet keine Labels vorhandener Enums – denn ein Container-Neustart darf niemals in der Lage sein, ein Schema als Nebeneffekt eines Deploys umzustrukturieren.

Daher lohnt es sich weiterhin, `rebase db push` auszuführen für all das, was beim Booten unberührt bleibt – jede Änderung, die nicht rein additiv ist: eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

```bash
rebase db push
```

Führen Sie dies aus einem Checkout oder einem CI-Job aus, gerichtet auf die Datenbank des Deployments. Änderungen werden zunächst im Testlauf (Dry-Run) geprüft, destruktive Änderungen ohne explizite Bestätigung verweigert und vor der Anwendung kann ein Backup erstellt werden. Die Datenbank gibt in der Compose-Datei einen Port frei, damit dieser Befehl sie vom Host aus erreichen kann; entfernen Sie dieses Port-Mapping, sobald das Schema eingerichtet ist, falls die Datenbank von außen nicht erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert `ensure` und `none`, und nichts anderes – das Image **verweigert den Start** bei `push`, aus dem oben genannten Grund.

## Wenn nur Ihr Change-Prozess die Datenbank ändern darf

`REBASE_MIGRATE_ON_BOOT=none` lässt Ihre Collections unberührt. Die Datenbank lässt es jedoch nicht unberührt: Die frameworkeigenen Tabellen (Auth, API-Keys, Jobs, Cron) werden weiterhin bei jedem Bootvorgang erstellt und aktuell gehalten. Wenn sich die Datenbank ausschließlich über einen geprüften Change-Prozess ändern darf, setzen Sie `REBASE_PROVISION=false` auf jedem Prozess, der Anfragen bedient:

| Einstellung | Collection-Tabellen und -Policies | Framework-Tabellen |
|---|---|---|
| Standard (`REBASE_MIGRATE_ON_BOOT=ensure`) | beim Booten erstellt und aktuell gehalten | erstellt und aktuell gehalten |
| `REBASE_MIGRATE_ON_BOOT=none` | unberührt gelassen | erstellt und aktuell gehalten |
| `REBASE_PROVISION=false` | unberührt gelassen | unberührt gelassen; alles Fehlende wird im Log aufgeführt |

Bei deaktiviertem Provisioning erstellt und ändert die Runtime nichts: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Policy, Rolle oder Berechtigung (Grant). Das gilt beim Booten und danach, einschließlich der Tabellen, die ein Serverprozess andernfalls bei der ersten Verwendung anlegt (Idempotenz-Schlüssel, Cron-Claims, die gemeinsamen Rate-Limit-Zähler). Stattdessen liest er das, was vorhanden ist:

- **Auth-Tabellen oder eine Spalte, die Auth liest, fehlen:** Der Bootvorgang wird verweigert und jedes fehlende Element aufgelistet.
- **Die Request-Rolle kann auf eine Framework-Tabelle zugreifen**, wie etwa `rebase.refresh_tokens` oder `rebase.api_keys`: Der Bootvorgang wird verweigert und der auszuführende `REVOKE`-Befehl ausgegeben. Ein Bootvorgang mit Provisioning entzieht diese Berechtigungen selbstständig. Bei deaktiviertem Provisioning geschieht dies nicht.
- **Eine optionale Tabelle fehlt** (API-Keys, Idempotenz-Schlüssel, Cron-Claims, Rate-Limit-Zähler, Presence, Metrik-Historie): Das jeweilige Feature ist deaktiviert und das Log gibt an, welche Tabelle benötigt wird.

Zeilen ändern sich weiterhin wie in jeder Datenbank: Anmeldungen, Sessions, API-Key-Nutzung, Idempotenz-Schlüssel, Cron-Claims. Das erste Admin-Konto (`REBASE_ADMIN_EMAIL`) wird durch den Provisioning-Lauf angelegt, nicht durch die bedienenden Prozesse. [Live schema editing](/docs/backend/live-schema-editing) kann eine Änderung weiterhin als Quellcode committen, weigert sich jedoch, sie auf die Datenbank anzuwenden.

### Der Provisioning-Lauf

Das Schema stammt aus einem Durchlauf, den Ihr Change-Prozess steuert. Verwenden Sie dasselbe Image und Bundle wie der Server, mit `REBASE_PROVISION_ONLY=true`, verbunden als Rolle, die in der Datenbank Objekte erstellen darf. `REBASE_PROVISION_SQL_OUT` speichert jede vom Lauf vorgenommene Schemaänderung als SQL-Skript:

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

Das Image läuft mit `NODE_ENV=production`, daher unterliegt dieser Lauf denselben Umgebungsprüfungen wie der Server, einschließlich `CORS_ORIGINS` oder `FRONTEND_URL`, auch wenn er keine Anfragen bedient.

Das Skript ist ein Protokoll, kein Ausführungsplan: Jede Anweisung darin wurde der Reihe nach ausgeführt und war erfolgreich. Bei der Aufzeichnung gegen eine leere Datenbank enthält es das gesamte Schema, das das Release benötigt. Bei der Aufzeichnung gegen eine wiederhergestellte Kopie der Produktionsdatenbank entspricht es exakt dem Upgrade. Zeilen, die der Lauf geschrieben hat, sind nicht enthalten. Prüfen Sie es und wenden Sie es dann auf die tatsächliche Datenbank an:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Wiederholen Sie dies bei jedem Rebase-Upgrade, bevor die bereitstellenden Prozesse aktualisiert werden. Ein Release kann eine Tabelle oder eine Spalte hinzufügen, und ein Prozess, der keine erstellen darf, meldet sie als fehlend, anstatt sie zu erzeugen.

Ein selbst gebauter Server folgt derselben Regel: `initializeRebaseBackend` liest `REBASE_PROVISION` aus, und `createRebaseBackend` akzeptiert [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Dateispeicher

Der Speicher ist standardmäßig **deaktiviert**, es sei denn, ein Bucket ist konfiguriert – und das ist beabsichtigt: Die alternative Standardeinstellung wäre das Dateisystem des Containers, das jede hochgeladene Datei beim nächsten Neustart stillschweigend verlieren würde. Uploads werden mit `501 STORAGE_NOT_CONFIGURED` abgewiesen, bis Sie einen Speicher einrichten.

Setzen Sie für einen Bucket `STORAGE_TYPE=s3` (oder `gcs`) zusammen mit dem Bucket-Namen und den Anmeldedaten – die Compose-Datei listet die Variablen auskommentiert auf. `gcs` lädt `@google-cloud/storage`, was im offiziellen Image nicht enthalten ist; greifen Sie bei diesem Image stattdessen über dessen S3-kompatiblen Endpunkt auf Google Cloud Storage zu (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, HMAC-Keys).

Für lokalen Speicherplatz, was nur dann angebracht ist, wenn der Pfad ein echtes Volume ist, das den Container überdauert:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` ist an dieser Stelle nicht optional: In der Produktion wird ein `local`-Backend verworfen statt registriert, da die Alternative Uploads wären, die in einem Dateisystem landen, das kurz vor der Zerstörung steht. Über diese Variable bestätigen Sie, dass der Mount persistent ist.

Binden Sie das Volume **über** `STORAGE_PATH` ein, nicht direkt darauf. `STORAGE_PATH` ist das Verzeichnis des Standard-Buckets, und jeder in `config/resources.ts` deklarierte Bucket erhält daneben ein eigenes Verzeichnis: `<STORAGE_PATH>__<key>`. Ein Volume direkt unter `STORAGE_PATH` enthält nur den Standard-Bucket. Jeder andere Bucket würde in das Dateisystem des Containers schreiben und seine Dateien verlieren, wenn der Container neu erstellt wird. `STORAGE_PATH__MEDIA` kann einen einzelnen Bucket an eine andere Stelle auf dem Volume verschieben. Er kann jedoch nicht in das Verzeichnis eines anderen Buckets verschoben werden (wie z. B. `/storage/uploads/media`), da der Standard-Bucket dessen Dateien sonst auflisten, ausliefern und löschen würde.

Das Image erstellt `/storage` für den unprivilegierten Benutzer `node`, unter dem es läuft, weshalb das Volume dorthin gehört. Ein Volume, das an einer Stelle eingebunden wird, an der das Image kein Verzeichnis besitzt, gehört root, wodurch jeder Upload mit `EACCES` fehlschlägt. Die von `rebase init` erstellte Compose-Datei bindet es auf diese Weise ein.

### Speicher erfordert ein Zugriffskontrollmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime in der Produktion den Start**, bis das Deployment definiert, wie Objekte geschützt werden. Der Speicher unterliegt nicht der Row-Level Security und seine Schlüssel teilen sich einen flachen Namensraum; ohne Regeln ist das Einzige, was die Dateien zweier Benutzer trennt, die Unvorhersehbarkeit der Schlüssel – was durch `GET /storage/list?prefix=` zunichtegemacht wird. Eine der folgenden Optionen erfüllt diese Anforderung:

- ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration Ihres Projekts, was die empfohlene Lösung ist und vom Scaffold in `config/storage.ts` bereitgestellt wird – keine Umgebungsvariable kann ausdrücken: „Dieser Benutzer darf diesen Schlüssel lesen“;
- **`STORAGE_PUBLIC_READ=true`**, für einen Bucket, der tatsächlich ein öffentliches Read-Only-CDN darstellt;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, für eine Single-Tenant-App, bei der jedem angemeldeten Benutzer jede Datei anvertraut werden kann.

Außerhalb der Produktion führt dieselbe Bedingung lediglich zu einer deutlichen Warnung statt zu einer Startverweigerung; dieser Boot-Fehler tritt daher eher beim Deployment als auf dem lokalen Entwicklungsrechner auf. Dies ist beabsichtigt: Der Fehler, den dies verhindert, bliebe sonst unbemerkt.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, wenn Sie TOTP verwenden. Bleibt dies unkonfiguriert, werden gespeicherte Authenticator-Secrets mit `JWT_SECRET` verschlüsselt – eine Rotation meldet dann alle Benutzer ab *und* sorgt dafür, dass kein registriertes Gerät mehr entschlüsselt werden kann.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht, sodass alles funktioniert, was Container ausführen kann. Zwei Dinge sollten Sie überall beachten:

1. Das Bundle muss unter `/bundle` liegen (oder dorthin, wohin `REBASE_BUNDLE` zeigt), mit den daneben installierten Abhängigkeiten – siehe [Abhängigkeiten](#abhängigkeiten).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime verweigert den Start in der Produktion ohne diese Variablen, anstatt Annahmen zu treffen.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.28.2 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die oben beschriebene Variante mit abgeleitetem Image, damit das Bundle mit der App ausgeliefert wird, und führen Sie dann `fly deploy` aus.

### Railway / Render

Richten Sie den Dienst auf das abgeleitete Image aus, setzen Sie die Umgebungsvariablen und legen Sie den Healthcheck-Pfad auf `/livez` fest.

### Ein einfacher VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` listet die Variablen auf, die gelesen werden. Unter systemd – die beiden `REBASE_ADMIN_*`-Zeilen erfordern Version 0.18 oder höher, und unter 0.17.3 wird stattdessen das erste registrierte Konto zum Administrator:

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

`NODE_ENV=production` ist keine reine Formalität. Bleibt dies ungesetzt, läuft der Prozess im Entwicklungsmodus: Er spiegelt Localhost-Origins wider, stellt die OpenAPI-Spezifikation bereit und **lässt das Fenster für den ersten Administrator offen** – sodass die erste fremde Person, die das Registrierungsformular findet, zum Administrator wird. Die beiden `REBASE_ADMIN_*`-Zeilen ersetzen dieses Fenster; siehe [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` wird benötigt, weil sich die Datenbank auf derselben Maschine befindet. In der Produktion lehnt die Runtime jede Variable ab, die auf localhost verweist – in einem Container ist Loopback der Container selbst, daher ist diese Adresse dort praktisch immer ein Fehler –, und diese Zeile teilt ihr mit, dass die Adresse beabsichtigt ist. Entfernen Sie sie, wenn die Datenbank an anderer Stelle ausgeführt wird.

Bevorzugen Sie für Secrets `EnvironmentFile=/etc/rebase.env` mit Dateirechten 0600 gegenüber `Environment=`-Zeilen: Eine Unit-Datei ist für alle lesbar, und `systemctl show` gibt jeden `Environment=`-Wert aus.

## Connection Pooling

Die Runtime unterhält einen kleinen, langlebigen Pool und benötigt keinen Pooler. Was ihn jedoch benötigt, ist alles andere, was mit derselben Datenbank kommuniziert und keine Verbindung halten kann: eine serverlose Funktion, ein geplantes Skript, ein BI-Tool, ein Queue-Worker, der auf fünfzig Instanzen skaliert. `max_connections` von Postgres ist ein hartes Limit im unteren Hunderterbereich und jede Verbindung ist ein eigener *Prozess*; ein Lambda-Fan-Out erschöpft dieses Limit daher lange bevor die Datenbank ausgelastet ist.

Die Compose-Datei enthält einen `pgbouncer`-Dienst für diesen Datenverkehr, gekoppelt an ein Profil, damit ein Deployment ohne solche Clients keinen Prozess ausführt, für den es keine Verwendung hat:

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

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert, sodass das Passwort nicht doppelt eingetragen werden muss. Der Pooler authentifiziert sich bei Postgres mit `scram-sha-256`, was von Postgres 18 gespeichert wird – der Standardwert `md5` des Images lässt den *Server*-Login mit `FATAL: server login failed: wrong password type` fehlschlagen, was wie ein falsches Passwort aussieht, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich unter dem `max_connections`-Wert der Datenbank – die Runtime bedient sich aus demselben Kontingent.

### Was sich durch Transaction Pooling ändert

Ein gepoolter Client belegt eine Serververbindung für die Dauer einer Transaktion und gibt sie danach wieder frei; dadurch können sich 500 Clients 20 Verbindungen teilen. Drei Dinge funktionieren über diesen Port nicht mehr, und jede davon wird von Rebase selbst verwendet – genau aus diesem Grund verbindet sich die Runtime direkt und dieser Port ist für andere Aufrufer gedacht:

- **`LISTEN`/`NOTIFY`.** Realtime baut darauf auf, und ein Listener benötigt eine Verbindung, die länger besteht als eine Transaktion. `LISTEN` wird über den Pooler zwar *akzeptiert* – er beantwortet `LISTEN`, aber es wird danach nie eine Benachrichtigung eintreffen.
- **Session-Status**: `SET` (im Gegensatz zu `SET LOCAL`), anweisungsübergreifende Advisory Locks, `WITH HOLD`-Cursor, temporäre Tabellen. Die nächste Transaktion landet möglicherweise auf einer anderen Serververbindung, die von alldem nichts sieht. Beides schlägt auf dieselbe trügerische Weise fehl: Bei einem einzelnen untätigen Client ist der Status meist noch vorhanden, sodass es beim Testen funktioniert, aber genau unter der Nebenläufigkeit ausfällt, für die der Pooler eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Den meisten Treibern kann mitgeteilt werden, diese nicht zu verwenden – node-postgres tut dies standardmäßig nicht; asyncpg benötigt `statement_cache_size=0`.

`SET LOCAL` ist auf die Transaktion beschränkt und funktioniert; damit wird auch Row-Level Security gesetzt – RLS verhält sich über den gepoolten Port also identisch.

Lassen Sie das Profil deaktiviert, wenn sich nichts außerhalb der Runtime mit Ihrer Datenbank verbindet. Ein ungenutzter Port ist Angriffsfläche.

## Healthchecks

| Pfad | Verwendungszweck |
| --- | --- |
| `/livez` | Liveness. Beantwortet die Frage „Lebt dieser Prozess?“, ohne die Datenbank zu kontaktieren. |
| `/health` | Readiness. Führt einen Roundtrip zur Datenbank durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez` aus. Eine Liveness-Probe auf `/health` startet bei einem kurzen Datenbankproblem einen vollkommen gesunden Prozess neu – genau das Gegenteil dessen, wozu sie da ist.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Anfragezahlen und Latenz-Histogramme aufgeschlüsselt nach API-Bereich (Data, Auth, Storage, Functions) und Collection, plus Prozess-Gauges. Ohne Token kann der Endpunkt von jedem gelesen werden, der den Port erreichen kann; setzen Sie daher ein Token, sofern er sich nicht in einem privaten Netzwerk befindet.

`rebase_db_pool_wait_ms` ist ein Histogramm darüber, wie lange jede Abfrage auf eine Verbindung aus dem Datenbank-Pool gewartet hat (einschließlich des Öffnens einer neuen), gelabelt nach Datenquellenschlüssel (`source="(default)"` in einem Projekt, das keine Datenquellen deklariert). Ein gesunder Pool hält diesen Wert nahe Null. Ein Tail, der mit dem Datenverkehr wächst, bedeutet, dass Anfragen in einer Warteschlange auf Verbindungen warten – meist blockiert durch Schreib-Callbacks, die auf langsame Operationen warten; siehe [A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

Die Datenbank selbst, pro Datenquelle:

| Metrik | Was sie sagt |
|--------|--------------|
| `rebase_db_pool_total`, `_idle`, `_waiting` | Die Verbindungen jedes Pools, mit `pool="primary"`, `"read"` (das Replikat) oder `"session"` (der direkte Pool der SQL-Konsole hinter einem Pooler). `waiting` lange über null heißt: Der Pool ist zu klein für seine Last. |
| `rebase_db_connection_errors_total` | Anfragen, die mangels Verbindung mit 503 beantwortet wurden, nach `code`: `53300` / `53400` (der Server hat keine Verbindungen mehr), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Client-Verbindungen auf dem Server, nach `state`, gegenüber `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Die Größe der Datenbank. |
| `rebase_db_replica_lag_seconds` | Wie weit `DATABASE_READ_URL` hinter dem Primary liegt. |

Die letzten vier werden alle 30 Sekunden über die eigene Verbindung der Instanz erhoben, sodass ein Scrape nie zu einer Abfrage wird.

`rebase_realtime_*` meldet die offenen Sockets, Channels und die Frames jeder Instanz, die an den Channel-Bus gesendet oder zurückgehalten wurden: siehe [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Sicherheits-Header

Jede Antwort enthält `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` und `Strict-Transport-Security: max-age=15552000` (180 Tage). Der HSTS-Header lässt `includeSubDomains` aus: Dies würde Browser anweisen, unverschlüsseltes HTTP auf jeder Subdomain Ihrer Domain zu verweigern, einschließlich solcher, mit denen dieser Server nichts zu tun hat, und ein Browser speichert dies so lange, wie der Header vorgibt. Setzen Sie `REBASE_HSTS_INCLUDE_SUBDOMAINS=true`, wenn ausnahmslos jede Subdomain nur über HTTPS erreichbar ist; bis einschließlich Version 0.23 enthielt der Header immer `includeSubDomains`.

`strict-origin-when-cross-origin` ist der Standard der Browser selbst: Eine Anfrage an eine andere Website überträgt Ihre Origin und niemals den Pfad oder die Query der Seite. Es ist nicht `no-referrer`, da Origin-Prüfungen die Origin benötigen – der Google-Sign-in-Button vergleicht diese mit den autorisierten JavaScript-Origins des OAuth-Clients, und unter `no-referrer` antwortete er bei jeder App mit „The given origin is not allowed for the given client ID“, unabhängig davon, was der Client erlaubte. Eine Antwort, die eine eigene Richtlinie setzt, behält diese (die MCP-Consent-Seite sendet `no-referrer`); eine Seite, die eine strengere Richtlinie wünscht, kann dies über `<meta name="referrer" content="no-referrer">` deklarieren. `X-Frame-Options` funktioniert genauso: `SAMEORIGIN`, es sei denn, die Antwort definiert eine eigene Richtlinie, wie es die MCP-Consent-Seite mit `DENY` tut.

Die statischen Apps – die CMS-Administration und jedes Frontend, das vom Bundle bereitgestellt wird – tragen außerdem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Dies bestimmt, wer die App in Frames einbinden darf, schließt Plugins aus, bindet `<base>` an Ihre Origin und schränkt sonst nichts weiter ein, sodass Inline-Skripte, Worker und Drittanbieter-Logins weiterhin funktionieren. Eine Antwort, die eine eigene Policy festlegt, behält diese bei. Für strengere Vorgaben hinterlegen Sie die Richtlinie auf dem vorgeschalteten Reverse Proxy.

## Mehrere Instanzen

Ein einzelner Container ist der Standard und erfordert nichts weiter. Bevor ein zweites Replikat Datenverkehr empfängt – oder ein Rolling Deploy zwei Instanzen nebeneinander ausführt –, lesen Sie [Running more than one instance](/docs/deployment/multiple-instances/): Rate-Limits, Broadcast-Channels, lokale Dateien, fortsetzbare Uploads und der Image-Cache gelten pro Prozess, bis eine entsprechende Einstellung sie teilt.

## Claude verbinden

Ein einziger Befehl fügt diesen Server zum [Rebase connector](/docs/ai/rebase-connector/) hinzu, dem zentralen MCP-Konnektor, der von Claude aus all Ihre Projekte erreicht:

```bash
rebase cloud connect https://your-app.com
```

Setzen Sie die beiden Variablen, die der Befehl ausgibt, auf diesem Server und starten Sie ihn neu. Der Server muss Rebase 0.28.1 oder neuer ausführen und über HTTPS unter einer öffentlichen Adresse erreichbar sein. Alles andere bleibt unverändert: Er enthält kein Secret und gewährt dem Konnektor dieselben Rechte wie Studio.

## Ausführen von Functions in einem eigenen Prozess

Alles oben Genannte bezieht sich auf einen einzelnen Container, der das gesamte Projekt bereitstellt – was für fast jedes Deployment die richtige Form ist. Wenn eine benutzerdefinierte Function nicht mehr mit der Data-API um die Event-Loop konkurrieren soll – oder eigenständig skalieren, neu starten und fehlschlagen können soll –, können dasselbe Image und dasselbe Bundle als mehrere zusammenarbeitende Prozesse gestartet werden. Siehe [Split processes](/docs/deployment/split-processes/).

## Upgrades

```yaml
image: rebasepro/server:0.28.2
```

Neu starten. Ihr Bundle bleibt unverändert. Innerhalb einer Major-Version des Runtime-Contracts funktioniert ein validiertes Bundle weiterhin – siehe [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).

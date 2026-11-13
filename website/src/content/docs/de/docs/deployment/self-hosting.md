---
sourceHash: d3a77712f89b7829
title: Self-Hosting
sidebar_label: Self-Hosting
description: Führen Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle aus – Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Das Self-Hosting von Rebase bedeutet, zwei Dinge auszuführen: eine Postgres-Datenbank und das offizielle `rebasepro/server`-Image, in das das Bundle Ihres Projekts eingebunden ist.

Es muss **kein Anwendungs-Image gebaut werden**. Ihr Projekt wird als Bundle bereitgestellt, die Runtime ist veröffentlicht, und ein Upgrade von Rebase ist lediglich eine Änderung des Tags statt eines erneuten Builds. Siehe [Runtime und Bundles](/docs/architecture/runtime-and-bundles/) für die Gründe dieser Aufteilung.

## Docker Compose

**Wenn Ihr Projekt mit `rebase init` erstellt wurde, verwenden Sie dessen eigene `docker-compose.yml`.**
Sie befindet sich in Ihrem Repository; `init` hat die Secrets, das erste Admin-Konto und die festgelegte Runtime-Version eingetragen. Es ist genau die Datei, die unter
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended)
beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite beschreibt dasselbe Deployment ohne Scaffold im Hintergrund – das Projekt von jemand anderem, ein in der CI gebautes Bundle oder die beiden Dinge, die die generierte Datei bewusst auslässt: einen Connection-Pooler und die Split-Process-Architekturen. Diese Datei befindet sich im Repository unter
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Verwenden Sie diese Datei, anstatt einen Schnipsel von dieser Seite zu kopieren: Beide Dateien werden bei jedem Push vom projekteigenen Acceptance-Gate gestartet, sodass keine von dem abweichen kann, was tatsächlich funktioniert.

Beide stimmen bei jeder Umgebungsvariable überein, außer beim Datenbankpasswort – und das liegt daran, dass jede für ihren eigenen Ersteller geschrieben wurde: Diese hier liest
`POSTGRES_PASSWORD`, das von `quickstart.sh` erzeugt wird; die generierte liest
`DATABASE_PASSWORD`, das `rebase init` auch in die `DATABASE_URL` einbettet, die es in Ihre `.env` schreibt.

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

- **`POSTGRES_PASSWORD`** – das Datenbankpasswort. Eine spätere Änderung erfordert auch die Änderung im Volume; wählen Sie es also einmalig sorgfältig aus.
- **`JWT_SECRET`** – signiert jede Session. Eine Rotation meldet alle Benutzer ab.
- **`REBASE_SERVICE_KEY`** – die Anmeldedaten, die Row-Level Security für Server-zu-Server-Aufrufe umgehen. Behandeln Sie diesen Schlüssel wie ein Root-Passwort: Jeder, der ihn besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** – die Origins, von denen Ihr Frontend ausgeliefert wird, kommagetrennt. Kein Secret und nicht optional: Die Runtime verweigert den Start in der Produktion ohne diese Angabe, anstatt zu raten, da eine API, die ihre erlaubten Origins errät, irgendwann die falsche zulässt.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** – der erste Administrator. Eine frische Datenbank enthält keine Benutzer, und außerhalb der Produktion lässt die Registrierungsrichtlinie die erste Registrierung zu und ernennt sie zum Administrator – andernfalls wäre eine leere Datenbank eine Sackgasse, da das Bootstrappen eines Administrators einen Aufrufer erfordert, der bereits angemeldet ist. Sobald dieser Stack unter einem Hostnamen erreichbar ist, wird dieser Komfort zu einer Race Condition, die der Betreiber verlieren kann. Daher ist das Zeitfenster in der Produktion geschlossen und das Konto wird stattdessen hier angegeben. Die Runtime erstellt es einmalig, solange die Benutzertabelle leer ist, und tut dies bei jedem weiteren Start danach nicht mehr.

`JWT_SECRET` und `REBASE_SERVICE_KEY` müssen jeweils mindestens 32 Zeichen lang sein, und das Admin-Passwort mindestens 12. Verwenden Sie eine E-Mail-Adresse mit einem Punkt in der Domain: `POST /auth/login` parst den Body mit `z.string().email()`, weshalb sich die Runtime weigert, `admin@localhost` anzulegen – ein Konto, an dem sich niemand anmelden könnte – und stattdessen protokolliert, warum. Die Compose-Datei deklariert alle sechs Variablen mit `${VAR:?…}`, sodass eine fehlende Variable den Stack mit einer Fehlermeldung stoppt, die den Namen nennt, anstatt etwas halb Konfiguriertes zu starten – und die Selbstregistrierung ist standardmäßig deaktiviert (`DISABLE_SELF_REGISTRATION`, Standard `true`), sodass nichts herrenlos bleibt.

Melden Sie sich mit diesen Zugangsdaten an und ändern Sie das Passwort: Sie befinden sich im Klartext in einer Datei auf dem Host.

## Abhängigkeiten

`rebase build` **installiert die Abhängigkeiten Ihres Projekts standardmäßig direkt in das Bundle**, sodass `dist-bundle` neben seiner `package.json` auch `node_modules` und eine `package-lock.json` enthält. Ein solches vorgebündeltes (vendored) Bundle startet in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt (read-only) einbinden – was empfehlenswert ist, da ein kompromittierter Hook dann nicht den Code überschreiben kann, der nach dem nächsten Neustart ausgeführt wird:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` deaktiviert dies und erzeugt ein Bundle, das seine Abhängigkeiten stattdessen beim ersten Start installiert, was 40–60 Sekunden pro Start dauert und einen beschreibbaren Mount erfordert.

Für ein echtes Deployment empfiehlt es sich, beides in ein Image zu packen, wodurch auch exakt festgelegt wird, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

## Erstellen des Schemas

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich derer, die in `backend/schema` deklariert sind.**
`REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv arbeitet: Fehlende Tabellen, Spalten und Enum-Typen werden erstellt und deren Row-Level Security angewendet. Ein erster Start gegen eine leere Datenbank stellt Ihre Tabellen ohne separaten Schritt direkt bereit.

Was `ensure` bewusst niemals tut, ist das Verändern bestehender Strukturen. Es ändert keinen Spaltentyp, löscht weder Tabellen noch Spalten und bearbeitet keine Werte eines bestehenden Enums – denn ein Container-Neustart darf niemals in der Lage sein, ein Schema als Nebeneffekt eines Deployments umzugestalten.

Daher lohnt es sich weiterhin, `rebase db push` für alles auszuführen, was der Boot-Vorgang unberührt lässt – jede Änderung, die nicht rein additiv ist: eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

```bash
rebase db push
```

Führen Sie den Befehl aus einem Checkout oder einem CI-Job aus, der auf die Datenbank des Deployments verweist. Er führt die Änderung zunächst als Testlauf (Dry-Run) aus, verweigert destruktive Änderungen ohne explizite Bestätigung und kann vor dem Anwenden ein Backup erstellen. Die Datenbank gibt in der Compose-Datei einen Port frei, damit dieser vom Host aus erreicht werden kann; entfernen Sie dieses Port-Mapping, sobald das Schema eingerichtet ist, falls die Datenbank von außen nicht erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert nur `ensure` und `none` – das Image **verweigert den Start** bei `push` aus dem oben genannten Grund.

## Wenn nur Ihr Change-Prozess die Datenbank verändern darf

`REBASE_MIGRATE_ON_BOOT=none` lässt Ihre Tabellen unberührt. Die Datenbank selbst bleibt jedoch nicht unberührt: Die eigenen Tabellen des Frameworks (Auth, API-Keys, Jobs, Cron) werden weiterhin bei jedem Start erstellt und aktuell gehalten. Wenn die Datenbank nur über einen geprüften Change-Prozess verändert werden darf, setzen Sie `REBASE_PROVISION=false` für jeden Prozess, der Anfragen bedient:

| Einstellung | Deklarierte Tabellen und Policies | Framework-Tabellen |
|---|---|---|
| Standard (`REBASE_MIGRATE_ON_BOOT=ensure`) | beim Start erstellt und aktuell gehalten | erstellt und aktuell gehalten |
| `REBASE_MIGRATE_ON_BOOT=none` | unberührt | erstellt und aktuell gehalten |
| `REBASE_PROVISION=false` | unberührt | unberührt; Fehlendes wird im Log aufgeführt |

Wenn das Provisioning deaktiviert ist, erstellt und verändert die Runtime nichts: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Policy, Rolle oder Berechtigung (Grant). Das gilt sowohl beim Start als auch später, einschließlich der Tabellen, die ein Server-Prozess andernfalls bei der ersten Verwendung anlegt (Idempotenzschlüssel, Cron-Claims, die gemeinsamen Rate-Limit-Zähler). Stattdessen liest er nur, was vorhanden ist:

- **Auth-Tabellen oder eine Spalte, die Auth liest, fehlen:** Der Start wird verweigert und jede fehlende Komponente aufgelistet.
- **Die Request-Rolle kann auf eine Framework-Tabelle zugreifen** wie
  `rebase.refresh_tokens` oder `rebase.api_keys`: Der Start wird verweigert und der auszuführende
  `REVOKE`-Befehl ausgegeben. Ein Boot mit aktivem Provisioning entzieht diese Rechte automatisch.
  Bei deaktiviertem Provisioning geschieht dies nicht.
- **Eine optionale Tabelle fehlt** (API-Keys, Idempotenzschlüssel, Cron-Claims,
  Rate-Limit-Zähler, Presence, Metrik-Historie): Das entsprechende Feature ist deaktiviert, und das
  Log gibt an, welche Tabelle benötigt wird.
- <span class="since-badge" data-since="0.31">Seit 0.31</span> **Eine deklarierte Tabelle wird von der Datenbank nicht geschützt** – Row-Level Security
  deaktiviert, keine der deklarierten Policies vorhanden oder eine deklarierte restriktive Policy
  fehlt: Diese Tabelle wird nicht bereitgestellt (bei einer fehlenden permissiven Policy
  wird sie ausgeliefert, mit einer entsprechenden Warnung im Boot-Log). Eine Anfrage darauf wird mit `503 TABLE_WITHHELD` beantwortet, und das Boot-Log
  nennt das SQL, das sie schützt (oder `rebase db push`). Die anderen Tabellen werden
  ausgeliefert und der Boot-Vorgang fortgesetzt. Eine Many-to-Many-Junction-Tabelle wird auf dieselbe
  Weise überprüft: Eine ungeschützte Junction-Tabelle hält die Tabellen zurück, deren Relationen
  sie nutzen, und `TABLE_WITHHELD` nennt die Junction-Tabelle. Dies gilt auch bei `REBASE_MIGRATE_ON_BOOT=none`
  sowie bei einem Live-Schema-Refresh.

Zeilen ändern sich weiterhin wie in jeder Datenbank: Anmeldungen, Sessions, API-Key-Nutzung, Idempotenzschlüssel, Cron-Claims. Das erste Admin-Konto
(`REBASE_ADMIN_EMAIL`) wird durch den Provisioning-Lauf angelegt, nicht durch die ausliefernden
Prozesse. [Live schema editing](/docs/backend/live-schema-editing) kann Änderungen weiterhin
als Quellcode committen, weigert sich jedoch, sie auf die Datenbank anzuwenden.

### Der Provisioning-Lauf

Das Schema stammt aus einem Durchlauf, den Ihr Change-Prozess kontrolliert. Verwenden Sie dasselbe Image und
Bundle wie der Server mit `REBASE_PROVISION_ONLY=true`, verbunden als eine Rolle, die Objekte in der Datenbank erstellen darf. `REBASE_PROVISION_SQL_OUT` speichert jede vom Lauf vorgenommene Schemaänderung als SQL-Skript:

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

Das Image läuft mit `NODE_ENV=production`, daher unterliegt dieser Lauf denselben
Umgebungsprüfungen wie der Server, einschließlich `CORS_ORIGINS` oder `FRONTEND_URL`,
obwohl er keine Anfragen bedient.

Das Skript ist ein Protokoll, kein Plan: Jede Anweisung darin wurde der Reihe nach erfolgreich ausgeführt. Aufgezeichnet gegen eine leere Datenbank, enthält es das gesamte Schema, das das Release
benötigt. Aufgezeichnet gegen eine wiederhergestellte Kopie der Produktionsdatenbank, entspricht es exakt dem Upgrade.
Zeilen, die der Lauf geschrieben hat, sind nicht darin enthalten. Überprüfen Sie es und wenden Sie es dann auf die eigentliche Datenbank an:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Wiederholen Sie dies bei jedem Rebase-Upgrade, bevor die ausliefernden Prozesse aktualisiert werden. Ein
Release kann eine Tabelle oder eine Spalte hinzufügen, und ein Prozess, der keine erstellen darf,
meldet sie als fehlend, anstatt sie anzulegen.

Ein selbst gebauter Server folgt derselben Regel: `initializeRebaseBackend` liest
`REBASE_PROVISION`, und `createRebaseBackend` akzeptiert
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Dateispeicher

Storage ist standardmäßig **deaktiviert**, sofern kein Bucket konfiguriert ist, und das ist beabsichtigt: Die
alternative Standardeinstellung wäre das Dateisystem des Containers, wodurch jede hochgeladene Datei beim nächsten Neustart stillschweigend verloren ginge. Uploads werden mit
`501 STORAGE_NOT_CONFIGURED` abgewiesen, bis Sie einen Speicher einrichten.

Für einen Bucket setzen Sie `STORAGE_TYPE=s3` (oder `gcs`) sowie den entsprechenden Bucket und die Anmeldedaten –
die Compose-Datei listet die Variablen auskommentiert auf. `gcs` lädt
`@google-cloud/storage`, was im offiziellen Image nicht enthalten ist; greifen Sie bei diesem Image
stattdessen über den S3-kompatiblen Endpunkt auf Google Cloud Storage zu
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, HMAC-Schlüssel).

Für lokalen Speicherplatz (Disk), was nur dann geeignet ist, wenn der Pfad ein echtes Volume ist, das den Container überdauert:

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

Mounten Sie das Volume **über** `STORAGE_PATH`, nicht direkt darauf. `STORAGE_PATH` ist das
Verzeichnis des Standard-Buckets, und jeder in `backend/resources.ts` deklarierte Bucket
erhält daneben ein eigenes Verzeichnis, `<STORAGE_PATH>__<key>`. Ein Volume direkt auf `STORAGE_PATH`
enthält nur den Standard-Bucket. Jeder andere Bucket schreibt in das Dateisystem des Containers und
verliert seine Dateien, wenn der Container neu erstellt wird.
Mit `STORAGE_PATH__MEDIA` kann ein einzelner Bucket an eine andere Stelle auf dem Volume verschoben werden. Er kann jedoch nicht in das Verzeichnis eines anderen Buckets verschoben werden, wie etwa `/storage/uploads/media`, da der Standard-Bucket dessen Dateien sonst auflisten, ausliefern und löschen würde.

Das Image erstellt
`/storage` für den unprivilegierten Benutzer `node`, unter dem es läuft, weshalb das Volume
dorthin gehört. Ein Volume, das an einer Stelle eingebunden wird, an der das Image kein Verzeichnis besitzt, gehört root,
und jeder Upload schlägt mit `EACCES` fehl. Die von `rebase init` erstellte Compose-Datei
mountet es auf diese Weise.

### Storage erfordert ein Zugriffskontrollmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime in der Produktion den Start**,
bis das Deployment definiert, wie Objekte geschützt werden. Storage unterliegt nicht der
Row-Level Security und seine Schlüssel teilen sich einen flachen Namensraum; ohne Regeln ist das
Einzige, was die Dateien zweier Benutzer trennt, die Unvorhersehbarkeit von Schlüsseln – was
durch `GET /storage/list?prefix=` ausgehebelt wird. Eine der folgenden Maßnahmen erfüllt diese Anforderung:

- ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration Ihres Projekts,
  was die empfohlene Lösung ist und vom Scaffold in `backend/storage.ts` bereitgestellt wird –
  keine Umgebungsvariable kann ausdrücken: „Dieser Benutzer darf diesen Schlüssel lesen“;
- **`STORAGE_PUBLIC_READ=true`** für einen Bucket, der tatsächlich ein öffentliches
  Read-Only-CDN darstellt;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`** für eine Single-Tenant-App, bei der
  jedem angemeldeten Konto Zugriff auf jede Datei vertraut wird.

Außerhalb der Produktion führt diese Bedingung lediglich zu einer deutlichen Warnung statt zu einer Verweigerung. Daher tritt dieser Startfehler erst beim Deployment und nicht auf dem lokalen Entwicklungsrechner auf. Dies ist beabsichtigt: Der Fehler, den es verhindert, wäre sonst unbemerkt geblieben.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, wenn Sie TOTP verwenden. Bleibt dies ungesetzt, werden gespeicherte Authenticator-Secrets mit `JWT_SECRET` verschlüsselt – eine Rotation meldet dann nicht nur alle Benutzer ab, *sondern* macht auch jedes registrierte Gerät unentschlüsselbar.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht, sodass alles funktioniert, was Container ausführen kann. Zwei Dinge müssen überall beachtet werden:

1. Das Bundle muss unter `/bundle` vorhanden sein (oder worauf `REBASE_BUNDLE` verweist),
   mit den daneben installierten Abhängigkeiten – siehe [Abhängigkeiten](#abhängigkeiten).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime verweigert in der
   Produktion den Start ohne diese Werte, anstatt zu raten.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.30.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die oben beschriebene Form mit dem abgeleiteten Image, damit das Bundle mit der App ausgeliefert wird, und führen Sie dann `fly deploy` aus.

### Railway / Render

Verweisen Sie den Dienst auf das abgeleitete Image, setzen Sie die Umgebungsvariablen und legen Sie den Healthcheck-Pfad auf `/livez` fest.

### Ein einfacher VPS

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

`NODE_ENV=production` ist keine reine Formsache. Bleibt dies ungesetzt, läuft der Prozess im Entwicklungsmodus: Er spiegelt Localhost-Origins wider, liefert die OpenAPI-Spezifikation aus und **lässt das Zeitfenster für den ersten Administrator offen** – sodass der erste Fremde, der das Registrierungsformular findet, zum Administrator wird. Die beiden `REBASE_ADMIN_*`-Zeilen ersetzen dieses Zeitfenster; siehe [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` ist vorhanden, weil die Datenbank auf derselben Maschine läuft. In der Produktion weist die Runtime jede Variable ab, die auf Localhost zeigt – in einem Container ist Loopback der Container selbst, daher ist diese Adresse dort immer ein Fehler – und diese Zeile teilt ihr mit, dass die Adresse beabsichtigt ist. Entfernen Sie sie, wenn die Datenbank an anderer Stelle läuft.

Bevorzugen Sie `EnvironmentFile=/etc/rebase.env` mit den Dateirechten 0600 gegenüber `Environment=`-Zeilen für Secrets: Eine Unit-Datei ist für alle lesbar, und `systemctl show` gibt jeden `Environment=`-Wert aus.

## Connection-Pooling

Die Runtime verwaltet einen kleinen, langlebigen Pool und benötigt keinen Pooler. Was ihn jedoch benötigt, ist alles andere, was mit derselben Datenbank kommuniziert und keine Verbindung halten kann: eine Serverless-Funktion, ein geplantes Skript, ein BI-Tool, ein Queue-Worker, der auf fünfzig Instanzen skaliert. `max_connections` von Postgres ist ein hartes Limit im unteren Hunderterbereich, und jede Verbindung ist ein eigener *Prozess* – ein Lambda-Fan-Out erschöpft dieses Limit also lange bevor die Datenbank ausgelastet ist.

Die Compose-Datei enthält einen `pgbouncer`-Dienst für diesen Datenverkehr, geschützt hinter einem Profil, damit ein Deployment ohne solche Clients keinen unnötigen Prozess ausführt:

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

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert, sodass das Passwort nicht doppelt geschrieben werden muss. Der Pooler authentifiziert sich bei Postgres mit `scram-sha-256`, was Postgres 18 speichert – die Standardeinstellung `md5` des Images lässt den *Server*-Login mit `FATAL: server login failed: wrong password type` fehlschlagen, was wie ein falsches Passwort aussieht, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich unter dem `max_connections`-Wert der Datenbank – die Runtime bedient sich aus demselben Budget.

### Was Transaction-Pooling verändert

Ein gepoolter Client hält eine Serververbindung für die Dauer einer Transaktion und gibt sie danach wieder frei; dadurch können sich 500 Clients 20 Verbindungen teilen. Drei Dinge funktionieren über diesen Port nicht mehr, und jedes davon wird von Rebase selbst verwendet – genau deshalb verbindet sich die Runtime direkt und dieser Port ist für andere Clients gedacht:

- **`LISTEN`/`NOTIFY`.** Realtime basiert darauf, und ein Listener benötigt eine
  Verbindung, die eine Transaktion überdauert. `LISTEN` wird vom Pooler zwar *akzeptiert* –
  er antwortet auf `LISTEN`, aber danach trifft nie eine Benachrichtigung ein.
- **Session-Status**: `SET` (im Gegensatz zu `SET LOCAL`), anweisungsübergreifende
  Advisory Locks, `WITH HOLD`-Cursor, temporäre Tabellen. Die nächste Transaktion
  landet möglicherweise auf einer anderen Serververbindung, die nichts davon sieht. Beides
  schlägt auf dieselbe tückische Weise fehl: Bei einem einzelnen untätigen Client ist der Status
  meist noch vorhanden, sodass es beim Testen funktioniert, aber unter der Last und Parallelität
  versagt, für die der Pooler eigentlich eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Den meisten Treibern kann mitgeteilt
  werden, diese nicht zu verwenden – node-postgres tut dies standardmäßig nicht;
  asyncpg benötigt `statement_cache_size=0`.

`SET LOCAL` ist an die Transaktion gebunden und funktioniert, womit auch die Row-Level Security gesetzt wird – RLS verhält sich über den gepoolten Port also identisch.

Lassen Sie das Profil deaktiviert, wenn nichts außerhalb der Runtime eine Verbindung zu Ihrer Datenbank herstellt. Ein ungenutzter Port bedeutet Angriffsfläche.

## Healthchecks

| Pfad | Verwendungszweck |
| --- | --- |
| `/livez` | Liveness. Beantwortet die Frage „Lebt dieser Prozess?“, ohne die Datenbank zu kontaktieren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez` aus. Eine Liveness-Probe auf `/health` startet bei einem kurzen Datenbankproblem einen völlig gesunden Prozess neu, was genau das Gegenteil des eigentlichen Zwecks ist.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Anfragezahlen und Latenz-Histogramme, aufgeschlüsselt nach API-Bereich (Data, Auth, Storage, Functions) und Tabelle, sowie Prozess-Gauges. Ohne Token ist der Endpunkt für jeden lesbar, der den Port erreichen kann; setzen Sie daher einen Token, es sei denn, er befindet sich in einem privaten Netzwerk.

`rebase_db_pool_wait_ms` ist ein Histogramm darüber, wie lange jede Abfrage auf eine Verbindung aus dem Datenbank-Pool gewartet hat (einschließlich des Öffnens einer neuen), gelabelt nach Datenquellenschlüssel (`source="(default)"` in einem Projekt, das keine Datenquellen deklariert). Ein gesunder Pool hält diesen Wert nahe null. Ein mit dem Datenverkehr anwachsender Tail bedeutet, dass Anfragen in einer Warteschlange auf Verbindungen warten – meist blockiert durch Write-Hooks, die auf langsame Operationen warten; siehe
[A hook holds a connection](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Die Datenbank selbst, pro Datenquelle:

| Metrik | Bedeutung |
|--------|-----------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Verbindungen jedes Pools, gelabelt als `pool="primary"`, `"read"` (das Replikat) oder `"session"` (der direkte Pool der SQL-Konsole hinter einem Pooler). Wenn `waiting` längere Zeit über null liegt, ist der Pool zu klein für die Last. |
| `rebase_db_connection_errors_total` | Anfragen, die mangels Verbindung mit 503 beantwortet wurden, nach `code`: `53300` / `53400` (dem Server sind die Verbindungen ausgegangen), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Client-Verbindungen auf dem Server nach `state`, im Vergleich zu `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Die Größe der Datenbank. |
| `rebase_db_replica_lag_seconds` | Wie weit `DATABASE_READ_URL` hinter dem Primary zurückliegt. |

Die letzten vier werden alle 30 Sekunden über die instanzeigene Verbindung abgefragt, sodass ein Scrape niemals zu einer Query wird.

`rebase_realtime_*` meldet die offenen Sockets und Channels jeder Instanz sowie die Frames, die an den Channel-Bus gesendet oder zurückgehalten wurden: siehe
[Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Sicherheits-Header

Jede Antwort enthält `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` und `Strict-Transport-Security: max-age=15552000`
(180 Tage). Der HSTS-Header verzichtet auf `includeSubDomains`: Dies würde
Browser anweisen, unverschlüsseltes HTTP auf jeder Subdomain Ihrer Domain zu verweigern – auch auf solchen,
mit denen dieser Server nichts zu tun hat –, und ein Browser speichert dies so lange, wie im
Header angegeben.
Setzen Sie `REBASE_HSTS_INCLUDE_SUBDOMAINS=true`, wenn ausnahmslos jede Subdomain ausschließlich über HTTPS läuft.

`strict-origin-when-cross-origin` ist der Standard der Browser selbst: Eine Anfrage an
eine andere Website übermittelt Ihre Origin und niemals den Pfad oder die Query der Seite. Es ist nicht
`no-referrer`, da Origin-Prüfungen die Origin benötigen – der Google-Anmeldebutton
vergleicht diese mit den autorisierten JavaScript-Origins des OAuth-Clients, und unter
`no-referrer` antwortete er bei jeder App mit „The given origin is not allowed for the given client
ID“, unabhängig davon, was der Client erlaubte. Eine Antwort, die ihre eigene
Richtlinie festlegt, behält diese bei (die MCP-Zustimmungsseite sendet `no-referrer`); eine Seite, die eine
strengere Richtlinie wünscht, kann dies über `<meta name="referrer" content="no-referrer">` deklarieren.
`X-Frame-Options` funktioniert genauso: `SAMEORIGIN`, es sei denn, die Antwort setzt einen
eigenen Wert, wie es die MCP-Zustimmungsseite mit `DENY` tut.

Die statischen Apps – die CMS-Admin-Oberfläche und jedes vom Bundle ausgelieferte Frontend – enthalten außerdem
`Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri
'self'`. Dies bestimmt, wer die App in einem Frame einbinden darf, schließt Plugins aus und fixiert `<base>`
auf Ihre Origin. Es schränkt darüber hinaus nichts weiter ein, sodass Inline-Skripte, Worker und
Drittanbieter-Logins weiterhin funktionieren. Eine Antwort, die ihre eigene Richtlinie setzt, behält diese bei.
Für alles Strengere konfigurieren Sie die Policy auf dem vorgeschalteten Reverse-Proxy.

## Mehr als eine Instanz

Ein einzelner Container ist der Standard und erfordert keine weiteren Einstellungen. Bevor ein zweites Replikat
Datenverkehr empfängt – oder ein Rolling-Deploy zwei Instanzen nebeneinander ausführt –, lesen Sie
[Running more than one instance](/docs/deployment/multiple-instances/): Rate-Limits,
Broadcast-Channels, lokale Dateien, fortsetzbare Uploads und der Image-Cache
gelten pro Prozess, bis sie über entsprechende Einstellungen geteilt werden.

## Claude verbinden

Ein einziger Befehl fügt diesen Server zum [Rebase connector](/docs/ai/rebase-connector/) hinzu,
dem zentralen MCP-Connector, der von Claude aus alle Ihre Projekte erreicht:

```bash
rebase cloud connect https://your-app.com
```

Setzen Sie die beiden ausgegebenen Variablen auf diesem Server und starten Sie ihn neu. Der Server muss
Rebase 0.28.1 oder neuer ausführen und über HTTPS unter einer öffentlichen Adresse erreichbar sein. Alles
andere bleibt unverändert: Er enthält kein Secret und gewährt dem Connector dieselben Rechte wie Studio.

## Funktionen in einem eigenen Prozess ausführen

Alles oben Beschriebene läuft in einem einzelnen Container, der das gesamte Projekt bedient – was für
fast jedes Deployment die richtige Struktur ist. Wenn eine benutzerdefinierte Funktion nicht länger mit
der Daten-API um den Event-Loop konkurrieren soll – oder unabhängig skalieren, neu starten und fehlschlagen
können soll –, können dasselbe Image und dasselbe Bundle als mehrere zusammenarbeitende
Prozesse gestartet werden. Siehe [Split processes](/docs/deployment/split-processes/).

## Upgrade durchführen

```yaml
image: rebasepro/server:0.30.1
```

Neu starten. Ihr Bundle bleibt unverändert. Innerhalb einer Major-Version des Runtime-Contracts
funktioniert ein validiertes Bundle weiterhin – siehe
[Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).

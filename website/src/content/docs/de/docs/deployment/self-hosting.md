---
sourceHash: cfc9a95285da2353
title: Self-Hosting
sidebar_label: Self-Hosting
description: Betreiben Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle – Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Rebase selbst zu hosten bedeutet, zwei Dinge zu betreiben: eine Postgres-Datenbank und das offizielle `rebasepro/server`-Image, in das das Bundle Ihres Projekts eingebunden ist.

Es muss **kein Anwendungs-Image gebaut werden**. Ihr Projekt wird als Bundle übertragen, die Runtime ist veröffentlicht, und ein Upgrade von Rebase ist lediglich eine Änderung des Tags statt eines erneuten Builds. Siehe [Runtime and bundles](/docs/architecture/runtime-and-bundles/) für die Gründe dieser Aufteilung.

## Docker Compose

**Wenn Ihr Projekt aus `rebase init` stammt, verwenden Sie dessen eigene `docker-compose.yml`.**
Sie befindet sich in Ihrem Repository; `init` hat die Secrets, das erste Admin-Konto und die festgelegte Runtime-Version eingetragen, und es ist die Datei, die unter
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended)
beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite behandelt dasselbe Deployment ohne Scaffold im Hintergrund –
das Projekt von jemand anderem, ein in CI erstelltes Bundle oder die beiden Dinge,
die die generierte Datei bewusst auslässt: einen Connection-Pooler und Architekturen
mit aufgeteilten Prozessen (Split-Process). Diese Konfiguration befindet sich im
Repository unter
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Verwenden Sie diese Datei, anstatt ein Snippet von dieser Seite zu kopieren:
Beide Dateien werden bei jedem Push vom projekteigenen Acceptance-Gate gestartet,
sodass keine von dem abweichen kann, was tatsächlich funktioniert.

Beide stimmen bei jeder Umgebungsvariable überein, außer beim Datenbankpasswort –
und das liegt daran, dass jede für ihren eigenen Ersteller geschrieben wurde: Diese liest
`POSTGRES_PASSWORD`, das von `quickstart.sh` generiert wird; die generierte Datei liest
`DATABASE_PASSWORD`, welches `rebase init` auch in die `DATABASE_URL` einbettet, die
es in Ihre `.env` schreibt.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` ist ein einziger Befehl, der zwei naheliegende Dinge tut und beide ausgibt.
Die ausführliche Variante, falls Sie jeden Schritt selbst kontrollieren möchten:

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

Drei Secrets, eine Tatsache und das Konto, mit dem Sie sich anmelden:

- **`POSTGRES_PASSWORD`** — das Datenbankpasswort. Eine spätere Änderung bedeutet,
  dass es auch im Volume geändert werden muss; wählen Sie es also einmalig sorgfältig aus.
- **`JWT_SECRET`** — signiert jede Session. Eine Rotation meldet alle Benutzer ab.
- **`REBASE_SERVICE_KEY`** — die Anmeldeinformation, die Row-Level Security für
  Server-zu-Server-Aufrufe umgeht. Behandeln Sie diesen Schlüssel wie ein Root-Passwort:
  Alles, was ihn besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** — die Origins, von denen Ihr Frontend bereitgestellt wird, durch
  Kommas getrennt. Kein Secret und nicht optional: Die Runtime verweigert den Start in
  der Produktion ohne diesen Wert, anstatt zu raten, denn eine API, die ihre erlaubten
  Origins errät, erlaubt letztlich die falschen.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — der erste
  Administrator. Eine frische Datenbank enthält keine Benutzer, und außerhalb der
  Produktion lässt die Registrierungsrichtlinie die erste Registrierung zu und
  befördert sie zum Administrator – andernfalls wäre eine leere Datenbank eine Sackgasse,
  da das Bootstrapping eines Admins einen Aufrufer erfordert, der bereits angemeldet ist.
  Sobald dieser Stack jedoch unter einem Hostnamen erreichbar ist, wird dieser Komfort zu
  einer Race Condition, die der Betreiber verlieren kann; daher ist dieses Zeitfenster
  in der Produktion geschlossen und das Konto wird stattdessen hier angegeben. Die
  Runtime erstellt es einmalig, solange die Benutzertabelle leer ist, und tut bei jedem
  nachfolgenden Start nichts mehr.

`JWT_SECRET` und `REBASE_SERVICE_KEY` müssen jeweils mindestens 32 Zeichen lang sein
und das Admin-Passwort mindestens 12. Verwenden Sie eine E-Mail-Adresse mit einem
Punkt in der Domain: `POST /auth/login` parst den Body mit `z.string().email()`,
sodass die Runtime sich weigert, `admin@localhost` anzulegen – ein Konto, an dem sich
niemand anmelden könnte – und stattdessen den Grund protokolliert. Die Compose-Datei
deklariert alle sechs Werte mit `${VAR:?…}`, sodass ein fehlender Wert den Stack
mit einer Meldung stoppt, die den Variablennamen nennt, anstatt ein halb konfiguriertes
System zu starten – und die Selbstregistrierung ist standardmäßig deaktiviert
(`DISABLE_SELF_REGISTRATION`, Standardwert `true`), sodass nichts zur freien Registrierung
offenbleibt.

Melden Sie sich mit diesen Anmeldedaten an und ändern Sie das Passwort: Sie liegen
im Klartext in einer Datei auf dem Host.

## Abhängigkeiten

`rebase build` **installiert standardmäßig die Abhängigkeiten Ihres Projekts in das Bundle**,
sodass `dist-bundle` mit einem `node_modules`-Ordner und einer `package-lock.json` neben
seiner `package.json` ausgeliefert wird. Ein vendoriertes Bundle startet in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt (read-only)
einbinden – was empfehlenswert ist, da ein kompromittierter Hook dann den Code nicht
überschreiben kann, der nach dem nächsten Neustart ausgeführt wird:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` deaktiviert dies und erzeugt ein Bundle, das seine
Abhängigkeiten stattdessen beim ersten Start installiert, was 40–60 Sekunden pro
Start dauert und erfordert, dass der Mount beschreibbar ist.

Für ein echtes Deployment sollten Sie es vorziehen, beides in ein Image einzubetten
(bake), wodurch auch exakt feststeht, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

## Erstellen des Schemas

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich derjenigen, die von `backend/schema` deklariert werden.**
`REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was additiv für
das gesamte Schema wirkt: Es erstellt fehlende Tabellen, Spalten und Enum-Typen
und wendet deren Row-Level Security an. Ein erster Start gegen eine leere Datenbank
stellt Ihre Tabellen ohne separaten Schritt bereit.

Was `ensure` ganz bewusst niemals tut, ist das Ändern von Bestehendem. Es ändert
weder Spaltentypen, noch löscht es eine Tabelle oder Spalte, noch bearbeitet es die
Labels eines bestehenden Enums – denn ein Container-Neustart darf nicht in der Lage sein,
ein Schema als Nebeneffekt eines Deployments umzustrukturieren.

Daher lohnt sich die Ausführung von `rebase db push` nach wie vor für alles, was der
Boot-Vorgang unberührt lässt – jede Änderung, die nicht rein additiv ist: eine
umbenannte Spalte, ein verengter Datentyp, ein entferntes Feld.

```bash
rebase db push
```

Führen Sie es aus einem Checkout oder einem CI-Job aus, gerichtet auf die Datenbank
des Deployments. Es führt die Änderung zunächst als Dry-Run aus, verweigert
destruktive Änderungen ohne explizite Bestätigung und kann vor dem Anwenden ein Backup
erstellen. Die Datenbank gibt in der Compose-Datei einen Port frei, damit dieser Befehl
sie vom Host aus erreichen kann; entfernen Sie dieses Port-Mapping, sobald das Schema
eingerichtet ist, falls die Datenbank nicht von außen erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert `ensure` und `none`, und sonst nichts – das
Image **verweigert den Start** bei `push`, aus dem oben genannten Grund.

## Wenn nur Ihr Change-Prozess die Datenbank ändern darf

`REBASE_MIGRATE_ON_BOOT=none` lässt Ihre Tabellen unberührt. Die Datenbank lässt es
jedoch nicht unberührt: Die frameworks-eigenen Tabellen (Auth, API-Keys, Jobs, Cron)
werden weiterhin bei jedem Start erstellt und aktuell gehalten. Wenn sich die Datenbank
ausschließlich über einen geprüften Change-Prozess ändern darf, setzen Sie
`REBASE_PROVISION=false` für jeden Prozess, der Anfragen bedient:

| Einstellung | Deklarierte Tabellen und Policies | Framework-Tabellen |
|---|---|---|
| Standard (`REBASE_MIGRATE_ON_BOOT=ensure`) | beim Start erstellt und aktuell gehalten | erstellt und aktuell gehalten |
| `REBASE_MIGRATE_ON_BOOT=none` | unberührt | erstellt und aktuell gehalten |
| `REBASE_PROVISION=false` | unberührt | unberührt; was fehlt, wird im Log genannt |

Wenn das Provisioning deaktiviert ist, erstellt und ändert die Runtime nichts: keine
Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Policy, Rolle
oder Berechtigung (Grant). Das gilt beim Start und danach, einschließlich der Tabellen,
die ein Server-Prozess andernfalls bei der ersten Verwendung anlegt (Idempotenzschlüssel,
Cron-Claims, die gemeinsamen Rate-Limit-Zähler). Stattdessen liest sie nur das aus,
was vorhanden ist:

- **Auth-Tabellen oder eine Spalte, die Auth liest, fehlen:** Der Start wird
  verweigert und jede fehlende Komponente aufgelistet.
- **Die Request-Rolle kann auf eine Framework-Tabelle zugreifen** wie
  `rebase.refresh_tokens` oder `rebase.api_keys`: Der Start wird verweigert und der
  auszuführende `REVOKE`-Befehl ausgegeben. Ein Boot mit Provisioning entzieht diese
  Rechte automatisch. Bei deaktiviertem Provisioning geschieht dies nicht.
- **Eine optionale Tabelle fehlt** (API-Keys, Idempotenzschlüssel, Cron-Claims,
  Rate-Limit-Zähler, Presence, Metriken-Historie): Dieses Feature ist deaktiviert
  und das Log gibt an, welche Tabelle benötigt wird.
- <span class="since-badge" data-since="0.31">Seit 0.31</span> **Eine deklarierte Tabelle, die die Datenbank nicht schützt** —
  Row-Level Security deaktiviert, keine der deklarierten Policies vorhanden oder
  eine restriktive deklarierte Policy fehlt: Diese Tabelle wird nicht bereitgestellt
  (bei einer fehlenden permissiven Policy wird sie bereitgestellt, begleitet von einer
  Boot-Warnung, die sie benennt). Eine Anfrage dafür antwortet mit `503 TABLE_WITHHELD`,
  und das Boot-Log nennt das SQL, das sie schützt (oder `rebase db push`). Die anderen
  Tabellen werden bereitgestellt und der Start wird fortgesetzt. Eine
  Many-to-Many-Junction-Tabelle wird auf dieselbe Weise überprüft: Ist sie nicht durch
  die Datenbank geschützt, werden die Tabellen zurückgehalten, deren Relationen sie
  verwenden, und `TABLE_WITHHELD` benennt die Junction-Tabelle. Eine Tabelle, deren
  `via`-Relation über eine zurückgehaltene Tabelle verläuft, wird ebenfalls
  zurückgehalten, und die Meldung nennt die Relation. Dies gilt auch bei
  `REBASE_MIGRATE_ON_BOOT=none` sowie bei einem Live-Schema-Refresh.

Zeilen ändern sich weiterhin wie in jeder Datenbank: Anmeldungen, Sessions,
API-Key-Nutzung, Idempotenzschlüssel, Cron-Claims. Das erste Admin-Konto
(`REBASE_ADMIN_EMAIL`) wird durch den Provisioning-Lauf angelegt (seeded), nicht
durch die Server-Prozesse. [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing)
kann Änderungen weiterhin als Quellcode committen, verweigert jedoch deren Anwendung
auf die Datenbank.

### Der Provisioning-Lauf

Das Schema stammt aus einem Lauf, den Ihr Change-Prozess steuert. Verwenden Sie
dasselbe Image und Bundle wie der Server mit `REBASE_PROVISION_ONLY=true`, verbunden
als Rolle, die in der Datenbank Objekte erstellen darf. `REBASE_PROVISION_SQL_OUT`
speichert jede Schemaänderung, die der Lauf vorgenommen hat, als SQL-Skript:

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

Das Skript ist ein Protokoll, kein Plan: Jede Anweisung darin wurde der Reihe nach
erfolgreich ausgeführt. Aufgezeichnet gegen eine leere Datenbank stellt es das gesamte
Schema dar, das das Release benötigt. Aufgezeichnet gegen eine wiederhergestellte
Kopie der Produktion ist es exakt das Upgrade. Zeilen, die der Lauf geschrieben hat,
sind nicht darin enthalten. Überprüfen Sie es und wenden Sie es dann auf die echte
Datenbank an:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Wiederholen Sie dies für jedes Rebase-Upgrade, bevor die Server-Prozesse aktualisiert
werden (Rolling Update). Ein Release kann eine Tabelle oder Spalte hinzufügen, und ein
Prozess, der keine erstellen darf, meldet sie als fehlend, anstatt sie anzulegen.

Ein Server, den Sie selbst bauen, folgt denselben Regeln: `initializeRebaseBackend`
liest `REBASE_PROVISION`, und `createRebaseBackend` akzeptiert
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Dateispeicher

Dateispeicher ist **deaktiviert**, sofern kein Bucket konfiguriert ist, und das ist
beabsichtigt: Der alternative Standard wäre das Dateisystem des Containers, wodurch
jede hochgeladene Datei beim nächsten Neustart stillschweigend verloren ginge. Uploads
werden mit `501 STORAGE_NOT_CONFIGURED` abgewiesen, bis Sie einen Bucket einrichten.

Für einen Bucket setzen Sie `STORAGE_TYPE=s3` (oder `gcs`) zusammen mit dem
Bucket-Namen und den Zugangsdaten – die Compose-Datei listet die Variablen
auskommentiert auf. `gcs` lädt `@google-cloud/storage`, was im offiziellen Image
nicht enthalten ist; greifen Sie auf diesem Image daher stattdessen über dessen
S3-kompatiblen Endpunkt auf Google Cloud Storage zu (`STORAGE_TYPE=s3`,
`S3_ENDPOINT=https://storage.googleapis.com`, HMAC-Keys).

Für lokalen Festplattenspeicher, was nur dann sinnvoll ist, wenn der Pfad ein
echtes Volume ist, das den Container überdauert:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` ist an dieser Stelle nicht optional: In der Produktion wird ein
`local`-Backend verworfen statt registriert, da die Alternative Uploads wären, die
in einem Dateisystem erfolgreich sind, das kurz vor der Löschung steht. Mit dieser
Variable bestätigen Sie, dass der Mount persistent ist.

Binden Sie das Volume **über** `STORAGE_PATH` ein, nicht direkt darauf. `STORAGE_PATH`
ist das Verzeichnis des Standard-Buckets, und jeder in `backend/resources.ts`
deklarierte Bucket erhält daneben ein eigenes Verzeichnis, `<STORAGE_PATH>__<key>`.
Ein Volume direkt auf `STORAGE_PATH` enthält nur den Standard-Bucket. Jeder andere
Bucket würde in das Dateisystem des Containers schreiben und seine Dateien verlieren,
wenn der Container neu erstellt wird. `STORAGE_PATH__MEDIA` kann einen Bucket an eine
andere Stelle auf dem Volume verschieben. Er kann jedoch nicht in das Verzeichnis eines
anderen Buckets verschoben werden, wie etwa `/storage/uploads/media`, da der
Standard-Bucket dessen Dateien sonst auflisten, ausliefern und löschen würde.

Das Image erstellt `/storage` für den unprivilegierten `node`-Benutzer, unter dem es
läuft, weshalb das Volume dorthin gehört. Ein Volume, das an einer Stelle gemountet
wird, an der das Image kein Verzeichnis besitzt, gehört root, und jeder Upload schlägt
mit `EACCES` fehl. Die Compose-Datei, die `rebase init` schreibt, bindet es auf diese
Weise ein.

### Storage benötigt ein Zugriffskontrollmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime in der Produktion
den Start**, bis das Deployment festlegt, wie Objekte geschützt werden. Dateispeicher
unterliegt nicht der Row-Level Security und seine Schlüssel teilen sich einen flachen
Namensraum; ohne Regel ist die Unerratbarkeit von Schlüsseln das Einzige, was die
Dateien zweier Benutzer trennt – was durch `GET /storage/list?prefix=` zunichtegemacht
wird. Eine der folgenden Optionen genügt:

- ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration
  Ihres Projekts, was die eigentliche Lösung ist und vom Scaffold in `backend/storage.ts`
  bereitgestellt wird – keine Umgebungsvariable kann ausdrücken: „Dieser Benutzer darf
  diesen Schlüssel lesen“;
- **`STORAGE_PUBLIC_READ=true`**, für einen Bucket, der tatsächlich ein öffentliches
  Read-Only-CDN darstellt;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, für eine Single-Tenant-App, bei der
  jedem angemeldeten Konto für jede Datei vertraut wird.

Außerhalb der Produktion führt diese Bedingung zu einer deutlichen Warnung statt einer
Verweigerung; dies ist also ein Startfehler, auf den man beim Deployment trifft und
nicht auf dem lokalen Rechner. Das ist beabsichtigt: Das Fehlverhalten, das dadurch
verhindert wird, wäre lautlos.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, wenn Sie TOTP verwenden. Bleibt dieser Wert
ungesetzt, werden gespeicherte Authenticator-Secrets mit `JWT_SECRET` verschlüsselt –
eine Rotation dessen meldet also alle Benutzer ab *und* macht jedes registrierte Gerät
unentschlüsselbar.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht, sodass alles
funktioniert, was Container ausführen kann. Zwei Dinge müssen überall stimmen:

1. Das Bundle muss unter `/bundle` (oder dem Pfad, auf den `REBASE_BUNDLE` verweist)
   vorhanden sein, mit installierten Abhängigkeiten daneben – siehe [Dependencies](#abhängigkeiten).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime weigert
   sich in der Produktion zu starten, wenn diese fehlen, anstatt zu raten.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.30.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die oben gezeigte abgeleitete Image-Variante, damit das Bundle mit der
App ausgeliefert wird, und führen Sie dann `fly deploy` aus.

### Railway / Render

Richten Sie den Dienst auf das abgeleitete Image aus, setzen Sie die Umgebungsvariablen
und legen Sie den Healthcheck-Pfad auf `/livez` fest.

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

`NODE_ENV=production` ist keine Dekoration. Bleibt dies ungesetzt, läuft der Prozess
im Entwicklungsmodus: Er spiegelt localhost-Origins wider, stellt die OpenAPI-Spezifikation
bereit und **lässt das Zeitfenster für den ersten Admin offen** – sodass der erste
Fremde, der das Registrierungsformular findet, zum Administrator wird. Die beiden
`REBASE_ADMIN_*`-Zeilen ersetzen dieses Zeitfenster; siehe [Your first
admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` wird benötigt, weil sich die Datenbank auf
derselben Maschine befindet. In der Produktion lehnt die Runtime jede Variable ab, die
auf localhost zeigt – in einem Container ist Loopback der Container selbst, weshalb
diese Adresse fast immer ein Fehler ist –, und diese Zeile teilt ihr mit, dass die
Adresse beabsichtigt ist. Entfernen Sie sie, wenn die Datenbank woanders läuft.

Bevorzugen Sie `EnvironmentFile=/etc/rebase.env` mit Dateirechten 0600 gegenüber
`Environment=`-Zeilen für Secrets: Eine Unit-Datei ist für alle lesbar (world-readable),
und `systemctl show` gibt jeden `Environment=`-Wert aus.

## Connection Pooling

Die Runtime unterhält einen kleinen, langlebigen Pool und benötigt keinen Pooler.
Was hingegen einen benötigt, ist alles andere, was mit derselben Datenbank kommuniziert
und keine dauerhafte Verbindung halten kann: eine Serverless-Funktion, ein geplantes
Skript, ein BI-Tool, ein Queue-Worker, der auf fünfzig Instanzen skaliert. `max_connections`
von Postgres ist ein hartes Limit im unteren Hunderterbereich und jede Verbindung ist ein
eigener *Prozess*; ein Lambda-Fan-Out erschöpft dieses Limit daher lange bevor die
Datenbank ausgelastet ist.

Die Compose-Datei liefert einen `pgbouncer`-Dienst für diesen Datenverkehr mit,
hinter einem Profil, sodass ein Deployment ohne solche Clients keinen Prozess ausführt,
für den es keine Verwendung hat:

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

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert, sodass
das Passwort nicht doppelt geschrieben werden muss. Der Pooler authentifiziert sich
bei Postgres über `scram-sha-256`, wie es Postgres 18 speichert – der `md5`-Standardwert
des Images lässt den *Server*-Login mit `FATAL: server login failed: wrong password type`
fehlschlagen, was wie ein falsches Passwort aussieht, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich unter
dem `max_connections`-Wert der Datenbank – die Runtime bedient sich aus demselben Budget.

### Was Transaction Pooling ändert

Ein gepoolter Client hält eine Serververbindung für die Dauer einer Transaktion und
gibt sie danach zurück, wodurch sich 500 Clients 20 Verbindungen teilen können.
Drei Dinge funktionieren über diesen Port nicht mehr, und jedes davon wird von Rebase
selbst genutzt – genau deshalb verbindet sich die Runtime direkt und dieser Port ist
für andere Aufrufer gedacht:

- **`LISTEN`/`NOTIFY`.** Realtime baut darauf auf, und ein Listener benötigt eine
  Verbindung, die eine Transaktion überdauert. `LISTEN` wird vom Pooler *akzeptiert* –
  er bestätigt `LISTEN`, doch es kommt danach nie eine Benachrichtigung an.
- **Session-State**: `SET` (im Gegensatz zu `SET LOCAL`), Advisory Locks, die über
  Statements hinweg gehalten werden, `WITH HOLD`-Cursor, temporäre Tabellen. Die
  nächste Transaktion kann auf einer anderen Serververbindung landen, die von alldem
  nichts sieht. Beides schlägt auf dieselbe unpraktische Weise fehl: Bei einem
  einzelnen untätigen Client ist der Status meist noch vorhanden, sodass es beim
  Testen funktioniert und genau unter der Nebenläufigkeit fehlschlägt, für die der
  Pooler eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Die meisten Treiber können so konfiguriert
  werden, dass sie diese nicht verwenden – node-postgres tut dies standardmäßig nicht;
  asyncpg benötigt `statement_cache_size=0`.

`SET LOCAL` ist auf Transaktionsebene begrenzt und funktioniert, womit auch
Row-Level Security gesetzt wird – RLS verhält sich über den gepoolten Port also identisch.

Lassen Sie das Profil deaktiviert, wenn nichts außerhalb der Runtime eine Verbindung
zu Ihrer Datenbank herstellt. Ein ungenutzter Port bedeutet Angriffsfläche.

## Healthchecks

| Pfad | Verwendung |
| --- | --- |
| `/livez` | Liveness. Beantwortet die Frage „Lebt dieser Prozess?“, ohne die Datenbank zu berühren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez` aus. Eine Liveness-Probe auf `/health` startet
einen vollkommen gesunden Prozess während eines kurzen Datenbankaussetzers neu – genau
das Gegenteil dessen, wofür sie gedacht ist.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Anfragezahlen und Latenz-Histogramme
aufgeschlüsselt nach API-Bereich (Data, Auth, Storage, Functions) und Tabelle sowie
Prozess-Gauges. Ohne Token kann der Endpunkt von jedem gelesen werden, der den Port
erreichen kann; setzen Sie also ein Token, es sei denn, er befindet sich in einem privaten
Netzwerk.

`rebase_db_pool_wait_ms` ist ein Histogramm darüber, wie lange jede Abfrage auf eine
Verbindung aus dem Datenbank-Pool gewartet hat (inklusive des Öffnens einer Verbindung),
gelabelt nach Datenquellenschlüssel (`source="(default)"` in einem Projekt, das keine
Datenquellen deklariert). Ein gesunder Pool hält diesen Wert nahe Null. Ein Tail, der
mit dem Datenverkehr wächst, bedeutet, dass Anfragen in einer Warteschlange auf
Verbindungen warten – meist blockiert durch Write-Hooks, die auf etwas Langsames warten;
siehe [A hook holds a connection](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Die Datenbank selbst, pro Datenquelle:

| Metrik | Bedeutung |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Verbindungen jedes Pools, gelabelt als `pool="primary"`, `"read"` (das Replikat) oder `"session"` (der direkte Pool der SQL-Konsole hinter einem Pooler). Wenn `waiting` längere Zeit über null liegt, ist der Pool für seine Last zu klein. |
| `rebase_db_connection_errors_total` | Anfragen, die mangels Verbindung mit 503 beantwortet wurden, nach `code`: `53300` / `53400` (dem Server sind die Verbindungen ausgegangen), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Client-Verbindungen auf dem Server, nach `state`, im Vergleich zu `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Die Größe der Datenbank. |
| `rebase_db_replica_lag_seconds` | Wie weit `DATABASE_READ_URL` hinter dem Primary zurückliegt. |

Die letzten vier Werte werden alle 30 Sekunden über die eigene Verbindung der Instanz
abgefragt, sodass ein Scrape niemals zu einer Datenbankabfrage wird.

`rebase_realtime_*` meldet die offenen Sockets, Channels und die Frames jeder Instanz,
die an den Channel-Bus gesendet oder zurückgehalten wurden: siehe
[Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Security-Header

Jede Antwort enthält `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` und `Strict-Transport-Security: max-age=15552000`
(180 Tage). Der HSTS-Header lässt `includeSubDomains` aus: Das würde Browsern anweisen,
einfaches HTTP auf jeder Subdomain Ihrer Domain zu verweigern, auch auf solchen, mit
denen dieser Server nichts zu tun hat, und ein Browser speichert dies so lange, wie der
Header angibt.
Setzen Sie `REBASE_HSTS_INCLUDE_SUBDOMAINS=true`, wenn jede Subdomain ausschließlich HTTPS verwendet.

`strict-origin-when-cross-origin` ist der Standard der Browser selbst: Eine Anfrage an
eine andere Seite überträgt Ihre Origin und niemals den Pfad oder die Query der Seite.
Es ist nicht `no-referrer`, da Origin-Prüfungen die Origin benötigen – der
Google-Anmelde-Button gleicht sie mit den autorisierten JavaScript-Origins des
OAuth-Clients ab, und unter `no-referrer` antwortete er bei jeder App mit „The given
origin is not allowed for the given client ID“, unabhängig davon, was der Client
erlaubte. Eine Antwort, die eine eigene Policy setzt, behält diese bei (die
MCP-Zustimmungsseite sendet `no-referrer`); eine Seite, die eine strengere Policy
wünscht, kann dies mit `<meta name="referrer" content="no-referrer">` deklarieren.
`X-Frame-Options` funktioniert genauso: `SAMEORIGIN`, es sei denn, die Antwort setzt
eine eigene, wie es die MCP-Zustimmungsseite mit `DENY` tut.

Die statischen Apps – die CMS-Verwaltung und jedes Frontend, das das Bundle
bereitstellt – tragen außerdem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`.
Dies bestimmt, wer die App in einem Frame einbinden darf, schließt Plugins aus und
bindet `<base>` an Ihre Origin, schränkt aber ansonsten nichts ein, sodass Inline-Skripte,
Worker und Anmeldungen von Drittanbietern weiterhin funktionieren. Eine Antwort, die
eine eigene Policy setzt, behält diese bei. Für strengere Richtlinien konfigurieren
Sie die Policy auf dem vorgeschalteten Reverse-Proxy.

## Mehrere Instanzen

Ein einzelner Container ist der Standard und benötigt nichts weiter. Bevor ein
zweites Replikat Traffic empfängt – oder ein Rolling Deploy zwei Instanzen
nebeneinander ausführt –, lesen Sie
[Running more than one instance](/docs/deployment/multiple-instances/): Rate-Limits,
Broadcast-Channels, lokale Dateien, fortsetzbare Uploads und der Image-Cache gelten
pro Prozess, bis eine entsprechende Einstellung sie gemeinsam nutzt.

## Claude anbinden

Ein einziger Befehl fügt diesen Server zum [Rebase connector](/docs/ai/rebase-connector/)
hinzu, dem zentralen MCP-Konnektor, der alle Ihre Projekte von Claude aus erreicht:

```bash
rebase cloud connect https://your-app.com
```

Setzen Sie die beiden Variablen, die der Befehl ausgibt, auf diesem Server und
starten Sie ihn neu. Der Server muss Rebase 0.28.1 oder neuer ausführen und über
HTTPS unter einer öffentlichen Adresse erreichbar sein. Sonst ändert sich nichts:
Er speichert kein Secret und gewährt dem Connector dieselben Rechte wie Studio.

## Ausführen von Functions in einem eigenen Prozess

Alles oben Beschriebene ist ein einzelner Container, der das gesamte Projekt
bereitstellt – was für fast jedes Deployment die richtige Struktur ist. Wenn eine
benutzerdefinierte Function nicht mehr mit der Daten-API um die Event-Loop
konkurrieren soll – oder unabhängig skaliert, neu gestartet und fehlschlagen können
soll –, können dasselbe Image und dasselbe Bundle als mehrere zusammenarbeitende
Prozesse gestartet werden. Siehe [Split processes](/docs/deployment/split-processes/).

## Upgrades

```yaml
image: rebasepro/server:0.30.1
```

Starten Sie neu. Ihr Bundle bleibt unverändert. Innerhalb einer Major-Version des
Runtime-Contracts funktioniert ein validiertes Bundle weiterhin – siehe
[Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).

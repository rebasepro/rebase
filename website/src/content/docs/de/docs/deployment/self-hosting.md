---
sourceHash: afff523ed2df1d76
title: Self-Hosting
sidebar_label: Self-Hosting
description: Führen Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle aus – Docker Compose, Fly, Railway oder ein einfacher VPS.
---

## Übersicht

Das Self-Hosting von Rebase bedeutet, zwei Dinge auszuführen: eine Postgres-Datenbank und das offizielle `rebasepro/server`-Image, in das das Bundle Ihres Projekts eingebunden (gemountet) ist.

Es muss **kein Anwendungs-Image gebaut werden**. Ihr Projekt wird als Bundle bereitgestellt, die Runtime wird veröffentlicht und ein Upgrade von Rebase ist lediglich eine Änderung des Tags statt eines erneuten Builds. Siehe [Runtime and bundles](/docs/architecture/runtime-and-bundles/) für die Gründe dieser Aufteilung.

## Docker Compose

**Wenn Ihr Projekt aus `rebase init` stammt, verwenden Sie dessen eigene `docker-compose.yml`.**
Sie befindet sich in Ihrem Repository; `init` hat die Secrets, das erste Administratorkonto und die festgelegte Runtime-Version eingetragen, und es ist genau die Datei, die unter [Deployment](/docs/getting-started/deployment/#docker-compose-recommended) beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite behandelt dasselbe Deployment ohne ein vorgefertigtes Gerüst (Scaffold) dahinter – das Projekt einer anderen Person, ein in CI erstelltes Bundle oder die beiden Dinge, die die generierte Datei bewusst auslässt: einen Connection Pooler und die Split-Process-Konfigurationen. Diese befindet sich im Repository unter [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Verwenden Sie diese Datei, anstatt Code-Ausschnitte von dieser Seite zu kopieren: Beide Dateien werden bei jedem Push durch das projekteigene Acceptance Gate gestartet, sodass keine von dem abweichen kann, was tatsächlich funktioniert.

Beide stimmen bei jeder Umgebungsvariablen bis auf das Datenbankpasswort überein. Das liegt daran, dass jede für ihren eigenen Ersteller geschrieben wurde: Diese liest `POSTGRES_PASSWORD`, das von `quickstart.sh` generiert wird; die generierte Datei liest `DATABASE_PASSWORD`, das `rebase init` auch in die `DATABASE_URL` einbettet, die es in Ihre `.env` schreibt.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` ist ein einziger Befehl, der zwei naheliegende Dinge erledigt und beide ausgibt. Die ausführliche Variante, falls Sie lieber jeden Schritt selbst kontrollieren möchten:

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

- **`POSTGRES_PASSWORD`** — das Datenbankpasswort. Eine spätere Änderung erfordert auch eine Änderung im Volume; wählen Sie es also von Anfang an sorgfältig aus.
- **`JWT_SECRET`** — signiert jede Session. Eine Rotation meldet alle Benutzer ab.
- **`REBASE_SERVICE_KEY`** — die Anmeldeinformation (Credential), die Row-Level Security für Server-to-Server-Aufrufe umgeht. Behandeln Sie diesen wie ein Root-Passwort: Alles, was ihn besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** — die Origins, von denen Ihr Frontend ausgeliefert wird, durch Kommas getrennt. Kein Secret und nicht optional: Die Runtime verweigert in der Produktion den Start ohne diesen Wert, statt Vermutungen anzustellen – denn eine API, die ihre erlaubten Origins errät, erlaubt letztlich die falsche.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — der erste Administrator. Eine frische Datenbank enthält keine Benutzer, und außerhalb der Produktion lässt die Registrierungsrichtlinie die erste Registrierung zu und stuft sie zum Admin hoch – andernfalls wäre eine leere Datenbank eine Sackgasse, da das Bootstrapping eines Admins einen bereits angemeldeten Aufrufer erfordert. Sobald dieser Stack unter einem Hostnamen erreichbar ist, stellt diese Bequemlichkeit eine Race Condition dar, die der Betreiber verlieren kann. Daher wird das Fenster in der Produktion geschlossen und das Konto stattdessen hier definiert. Die Runtime erstellt es einmalig, solange die Benutzertabelle leer ist, und unternimmt bei jedem weiteren Start nichts weiter.

`JWT_SECRET` und `REBASE_SERVICE_KEY` müssen jeweils mindestens 32 Zeichen lang sein, und das Admin-Passwort mindestens 12. Verwenden Sie eine Adresse mit einem Punkt in der Domain: `POST /auth/login` parst den Body mit `z.string().email()`, sodass die Runtime sich weigert, `admin@localhost` zu seeden – ein Konto, an dem sich niemand anmelden könnte – und stattdessen den Grund protokolliert. Die Compose-Datei deklariert alle sechs Variablen mit `${VAR:?…}`, sodass eine fehlende Variable den Stack mit einer Fehlermeldung stoppt, die den Namen nennt, anstatt etwas halb Konfiguriertes zu starten – und die Selbstregistrierung ist standardmäßig deaktiviert (`DISABLE_SELF_REGISTRATION`, Standardwert `true`), sodass nichts zur freien Übernahme offenbleibt.

Melden Sie sich mit diesen Anmeldedaten an und ändern Sie das Passwort: Sie liegen unverschlüsselt in einer Datei auf dem Host.

## Abhängigkeiten

`rebase build` **installiert die Abhängigkeiten Ihres Projekts standardmäßig in das Bundle**, sodass `dist-bundle` mit einem `node_modules`-Ordner und einer `package-lock.json` neben der `package.json` bereitgestellt wird. Ein gevendortes Bundle startet in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt (read-only) mounten – was ratsam ist, da ein kompromittierter Hook dann den Code nicht überschreiben kann, der nach dem nächsten Neustart ausgeführt wird:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` deaktiviert dies und erzeugt ein Bundle, das seine Abhängigkeiten stattdessen beim ersten Start installiert, was 40–60 Sekunden pro Start dauert und einen beschreibbaren Mount erfordert.

Für ein echtes Deployment empfiehlt es sich, beides fest in ein Image einzubinden („baken“), was zudem exakt festlegt, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.34.1
COPY dist-bundle /bundle
```

## Erstellen des Schemas

**Die Runtime erstellt fehlende Tabellen beim Booten, einschließlich der in `backend/schema` deklarierten.**
`REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt: Es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an. Ein erster Start gegen eine leere Datenbank liefert Ihre Tabellen ohne separaten Zwischenschritt aus.

Was `ensure` ganz bewusst niemals tut, ist das Ändern bereits existierender Elemente. Es ändert keinen Spaltentyp, löscht weder Tabellen noch Spalten und bearbeitet keine Labels vorhandener Enums – denn ein Container-Neustart darf niemals in der Lage sein, ein Schema als Nebeneffekt eines Deploys umzustrukturieren.

Daher lohnt es sich weiterhin, `rebase db push` auszuführen – für alles, was beim Booten unberührt bleibt: jede Änderung, die nicht rein additiv ist, wie etwa eine umbenannte Spalte, ein eingeschränkter Typ oder ein entferntes Feld.

```bash
rebase db push
```

Führen Sie es aus einem Checkout oder einem CI-Job aus, gerichtet auf die Datenbank des Deployments. Es führt zunächst einen Probelauf (Dry-Run) der Änderung durch, verweigert destruktive Änderungen ohne explizite Bestätigung und kann vor dem Anwenden ein Backup erstellen. Die Datenbank gibt in der Compose-Datei einen Port frei, damit dieser vom Host aus erreicht werden kann; entfernen Sie dieses Port-Mapping, sobald das Schema eingerichtet ist, falls die Datenbank von außen nicht erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert `ensure` und `none`, und sonst nichts – das Image **verweigert den Start** bei `push`, aus dem oben genannten Grund.

## Wenn ausschließlich Ihr Change-Prozess die Datenbank ändern darf

`REBASE_MIGRATE_ON_BOOT=none` lässt Ihre Tabellen unberührt. Es lässt die Datenbank jedoch nicht völlig unberührt: Die framework-eigenen Tabellen (Auth, API-Keys, Jobs, Cron) werden weiterhin bei jedem Bootvorgang erstellt und aktuell gehalten. Wenn die Datenbank nur über einen geprüften Change-Management-Prozess geändert werden darf, setzen Sie `REBASE_PROVISION=false` für jeden ausliefernden Prozess:

| Einstellung | Deklarierte Tabellen und Policies | Framework-Tabellen |
|---|---|---|
| Standard (`REBASE_MIGRATE_ON_BOOT=ensure`) | beim Booten erstellt und aktuell gehalten | erstellt und aktuell gehalten |
| `REBASE_MIGRATE_ON_BOOT=none` | unberührt | erstellt und aktuell gehalten |
| `REBASE_PROVISION=false` | unberührt | unberührt; Fehlendes wird im Log genannt |

Wenn das Provisioning deaktiviert ist, erstellt und ändert die Runtime nichts: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Policy, Rolle oder Berechtigung (Grant). Das gilt beim Booten und danach, einschließlich der Tabellen, die ein Serverprozess andernfalls bei der ersten Verwendung anlegt (Idempotenzschlüssel, Cron-Claims, die gemeinsamen Rate-Limit-Zähler). Stattdessen liest er nur das, was vorhanden ist:

- **Fehlende Auth-Tabellen oder Spalten, die Auth liest:** Der Start wird verweigert und jede einzelne aufgeführt.
- **Die Request-Rolle kann auf eine Framework-Tabelle zugreifen**, wie z. B. `rebase.refresh_tokens` oder `rebase.api_keys`: Der Start wird verweigert und das auszuführende `REVOKE` ausgegeben. Ein Provisioning-Boot entzieht diese Berechtigungen automatisch. Bei deaktiviertem Provisioning geschieht dies nicht.
- **Eine optionale Tabelle fehlt** (API-Keys, Idempotenzschlüssel, Cron-Claims, Rate-Limit-Zähler, Presence, Metriken-Historie): Dieses Feature ist deaktiviert und das Log gibt an, welche Tabelle benötigt wird.
- **Eine deklarierte Tabelle, die die Datenbank nicht schützt** – Row-Level Security deaktiviert, keine der deklarierten Policies vorhanden oder eine deklarierte restriktive Policy fehlt: Diese Tabelle wird nicht bedient (eine fehlende permissive Policy wird bedient, mit einer entsprechenden Warnung beim Booten). Eine Anfrage darauf antwortet mit `503 TABLE_WITHHELD`, und das Boot-Log nennt das SQL, das sie schützt (oder verweist auf `rebase db push`). Die anderen Tabellen werden ausgeliefert, und der Bootvorgang wird fortgesetzt. Eine Many-to-Many-Junction-Tabelle wird genauso überprüft: Ist eine Junction-Tabelle in der Datenbank ungeschützt, werden die Tabellen zurückgehalten, deren Relationen sie nutzen, und `TABLE_WITHHELD` nennt die Junction-Tabelle. Eine Tabelle, deren `via`-Relation über eine zurückgehaltene Tabelle führt, wird ebenfalls zurückgehalten, und die Meldung nennt die Relation. Dies gilt auch bei `REBASE_MIGRATE_ON_BOOT=none` sowie bei einem Live-Schema-Refresh. Eine Tabelle, deren Zugriff die Anwendung selbst durchsetzt, gibt `rlsRequired: false` an, um dennoch ausgeliefert zu werden ([Details hier](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access)).

Zeilen ändern sich weiterhin wie in jeder Datenbank: Anmeldungen, Sessions, API-Key-Nutzung, Idempotenzschlüssel, Cron-Claims. Das erste Administratorkonto (`REBASE_ADMIN_EMAIL`) wird durch den Provisioning-Lauf geseedet, nicht durch die ausliefernden Prozesse. [Live schema editing](/docs/backend/live-schema-editing) kann Änderungen weiterhin im Quellcode committen, verweigert jedoch deren Anwendung auf die Datenbank.

### Der Provisioning-Lauf

Das Schema stammt aus einem Lauf, den Ihr Change-Prozess steuert. Verwenden Sie dasselbe Image und Bundle wie der Server mit `REBASE_PROVISION_ONLY=true`, verbunden über eine Rolle, die Erstellungsrechte in der Datenbank besitzt. `REBASE_PROVISION_SQL_OUT` speichert jede Schemaänderung, die der Lauf vorgenommen hat, als SQL-Skript:

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

Das Image läuft mit `NODE_ENV=production`, sodass dieser Lauf denselben Umgebungsprüfungen unterliegt wie der Server – einschließlich `CORS_ORIGINS` oder `FRONTEND_URL`, obwohl er nichts ausliefert.

Das Skript ist ein Protokoll, kein Plan: Jedes Statement darin wurde der Reihe nach erfolgreich ausgeführt. Aufgezeichnet gegen eine leere Datenbank stellt es das gesamte Schema dar, das das Release benötigt. Aufgezeichnet gegen eine wiederhergestellte Kopie der Produktionsdatenbank entspricht es exakt dem Upgrade. Zeilen, die der Lauf geschrieben hat, sind nicht darin enthalten. Überprüfen Sie es und wenden Sie es dann auf die echte Datenbank an:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Wiederholen Sie dies bei jedem Rebase-Upgrade, bevor die ausliefernden Prozesse aktualisiert (gerollt) werden. Ein Release kann eine Tabelle oder Spalte hinzufügen, und ein Prozess, der keine erstellen darf, meldet diese als fehlend, anstatt sie anzulegen.

Ein Server, den Sie selbst bauen, folgt derselben Regel: `initializeRebaseBackend` liest `REBASE_PROVISION`, und `createRebaseBackend` akzeptiert [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Dateispeicher

Storage ist **deaktiviert**, sofern kein Bucket konfiguriert ist, und das ist beabsichtigt: Die alternative Standardeinstellung wäre das Dateisystem des Containers, wodurch jede hochgeladene Datei beim nächsten Neustart stillschweigend verloren ginge. Uploads werden mit `501 STORAGE_NOT_CONFIGURED` abgewiesen, bis Sie einen Speicher eingerichtet haben.

Für einen Bucket setzen Sie `STORAGE_TYPE=s3` (oder `gcs`) zusammen mit dem Bucket-Namen und den Zugangsdaten – die Compose-Datei führt die Variablen auskommentiert auf. `gcs` lädt `@google-cloud/storage`, was im offiziellen Image nicht enthalten ist; greifen Sie bei diesem Image daher stattdessen über den S3-kompatiblen Endpunkt auf Google Cloud Storage zu (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, HMAC-Keys).

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

`FORCE_LOCAL_STORAGE` ist dort nicht optional: In der Produktion wird ein `local`-Backend verworfen statt registriert, da die Alternative Uploads wären, die in einem Dateisystem landen, das kurz vor der Zerstörung steht. Über diese Variable bestätigen Sie, dass der Mount persistent ist.

Mounten Sie das Volume **übergeordnet** zu `STORAGE_PATH`, nicht direkt darauf. `STORAGE_PATH` ist das Verzeichnis des Standard-Buckets, und jeder in `backend/resources.ts` deklarierte Bucket erhält ein eigenes daneben: `<STORAGE_PATH>__<key>`. Ein Volume direkt auf `STORAGE_PATH` enthält nur den Standard-Bucket. Jeder andere Bucket schreibt in das Dateisystem des Containers und verliert seine Dateien, wenn der Container neu erstellt wird. `STORAGE_PATH__MEDIA` kann einen Bucket an eine andere Stelle auf dem Volume verschieben. Es kann ihn jedoch nicht in das Verzeichnis eines anderen Buckets verschieben (wie etwa `/storage/uploads/media`), da der Standard-Bucket dessen Dateien sonst auflisten, ausliefern und löschen würde.

Das Image erstellt `/storage` für den unprivilegierten `node`-Benutzer, unter dem es läuft, weshalb das Volume dorthin gehört. Ein Volume, das an einer Stelle gemountet wird, an der das Image kein Verzeichnis hat, gehört root, und jeder Upload schlägt mit `EACCES` fehl. Die von `rebase init` geschriebene Compose-Datei bindet es auf diese Weise ein.

### Storage benötigt ein Zugriffskontrollmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime in der Produktion den Start**, bis das Deployment definiert, wie Objekte geschützt sind. Storage unterliegt nicht der Row-Level Security und die Schlüssel teilen sich einen flachen Namespace. Ohne Regeln ist das Einzige, was die Dateien zweier Benutzer trennt, die Unvorhersehbarkeit der Schlüssel – was durch `GET /storage/list?prefix=` ausgehebelt wird. Eine der folgenden Optionen genügt dieser Anforderung:

- ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration Ihres Projekts, was die empfohlene Lösung ist und dem entspricht, was das Scaffold in `backend/storage.ts` bereitstellt – keine Umgebungsvariable kann „dieser Benutzer darf diesen Schlüssel lesen“ abbilden;
- **`STORAGE_PUBLIC_READ=true`** für einen Bucket, der tatsächlich ein öffentliches, schreibgeschütztes CDN darstellt;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`** für eine Single-Tenant-Anwendung, bei der jedem angemeldeten Konto bezüglich jeder Datei vertraut wird.

Außerhalb der Produktion führt diese Bedingung lediglich zu einer deutlichen Warnung statt zu einer Verweigerung; dies ist also ein Startfehler, dem man beim Deploy begegnet und nicht auf dem lokalen Entwicklungsrechner. Dies ist beabsichtigt: Der Fehler, den es verhindert, wäre sonst stillschweigend aufgetreten.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, wenn Sie TOTP verwenden. Bleibt dies ungesetzt, werden gespeicherte Authenticator-Secrets mit `JWT_SECRET` verschlüsselt – eine Rotation meldet dann alle Benutzer ab *und* macht jedes registrierte Gerät unentschlüsselbar.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht; alles, was Container ausführen kann, funktioniert also. Zwei Dinge müssen überall stimmen:

1. Das Bundle muss unter `/bundle` vorhanden sein (oder dort, worauf `REBASE_BUNDLE` verweist), mit installierten Abhängigkeiten daneben – siehe [Abhängigkeiten](#abhängigkeiten).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime verweigert in der Produktion den Start ohne diese Angaben, statt Vermutungen anzustellen.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.34.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die oben gezeigte Form mit abgeleitetem Image, damit das Bundle mit der App ausgeliefert wird, und führen Sie dann `fly deploy` aus.

### Railway / Render

Richten Sie den Dienst auf das abgeleitete Image aus, setzen Sie die Umgebungsvariablen und legen Sie den Healthcheck-Pfad auf `/livez` fest.

### Ein einfacher VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` listet die Variablen auf, die es liest. Unter systemd:

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

`NODE_ENV=production` ist keine reine Dekoration. Bleibt dies ungesetzt, läuft der Prozess im Entwicklungsmodus: Er spiegelt Localhost-Origins wider, liefert die OpenAPI-Spezifikation aus und **lässt das Erst-Admin-Fenster offen** – sodass die erste fremde Person, die das Registrierungsformular findet, zum Administrator wird. Die beiden `REBASE_ADMIN_*`-Zeilen ersetzen dieses Fenster; siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` wird benötigt, weil sich die Datenbank auf derselben Maschine befindet. In der Produktion weist die Runtime jede Variable zurück, die auf localhost verweist – in einem Container ist Loopback der Container selbst, weshalb diese Adresse fast immer ein Fehler ist –, und diese Zeile teilt ihr mit, dass die Adresse beabsichtigt ist. Entfernen Sie sie, wenn die Datenbank an anderer Stelle läuft.

Bevorzugen Sie `EnvironmentFile=/etc/rebase.env` mit Dateirechten 0600 gegenüber `Environment=`-Zeilen für Secrets: Eine Unit-Datei ist für jedermann lesbar, und `systemctl show` gibt jeden `Environment=`-Wert im Klartext aus.

## Connection Pooling

Die Runtime verwaltet einen kleinen, langlebigen Pool und benötigt keinen Pooler. Was hingegen einen benötigt, ist alles andere, was mit derselben Datenbank kommuniziert und keine Verbindung aufrechterhalten kann: eine Serverless-Funktion, ein zeitgesteuertes Skript, ein BI-Tool oder ein Queue-Worker, der auf fünfzig Instanzen skaliert. `max_connections` von Postgres ist ein hartes Limit im unteren Hunderterbereich und jede Verbindung ist ein eigener *Prozess* – ein Lambda-Fan-Out erschöpft dieses Limit daher lange bevor die Datenbank ausgelastet ist.

Die Compose-Datei liefert einen `pgbouncer`-Dienst für diesen Datenverkehr mit, hinter einem Profil, damit ein Deployment ohne solche Aufrufer keinen Prozess ausführt, für den es keine Verwendung hat:

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

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert, sodass das Passwort nicht doppelt eingetragen werden muss. Der Pooler authentifiziert sich gegenüber Postgres mit `scram-sha-256`, was von Postgres 18 gespeichert wird – der Standardwert `md5` des Images lässt das *Server*-Login mit `FATAL: server login failed: wrong password type` fehlschlagen, was wie ein falsches Passwort aussieht, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich unter dem `max_connections`-Wert der Datenbank – die Runtime bedient sich aus demselben Kontingent.

### Was Transaction Pooling ändert

Ein gepoolter Client hält eine Serververbindung nur für die Dauer einer Transaktion und gibt sie danach wieder frei; dadurch können sich 500 Clients 20 Verbindungen teilen. Drei Dinge funktionieren über diesen Port nicht mehr, und jede davon wird von Rebase selbst verwendet – genau deshalb verbindet sich die Runtime direkt und dieser Port ist für andere Aufrufer gedacht:

- **`LISTEN`/`NOTIFY`.** Realtime baut darauf auf, und ein Listener benötigt eine Verbindung, die über eine Transaktion hinaus besteht. `LISTEN` wird vom Pooler zwar *akzeptiert* – er antwortet mit `LISTEN`, aber es kommt niemals eine Benachrichtigung an.
- **Session-Status**: `SET` (im Gegensatz zu `SET LOCAL`), anweisungsübergreifende Advisory Locks, `WITH HOLD`-Cursor, temporäre Tabellen. Die nächste Transaktion landet möglicherweise auf einer anderen Serververbindung, die nichts davon sieht. Beides schlägt auf die gleiche tückische Weise fehl: Bei einem einzelnen untätigen Client ist der Status meist noch da, sodass es beim Testen funktioniert, aber genau unter der Last und Parallelität ausfällt, für die der Pooler eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Den meisten Treibern kann mitgeteilt werden, diese nicht zu verwenden – node-postgres tut dies standardmäßig nicht; asyncpg benötigt `statement_cache_size=0`.

`SET LOCAL` ist transaktionsgebunden und funktioniert; damit wird auch Row-Level Security gesetzt – RLS verhält sich über den gepoolten Port also identisch.

Lassen Sie das Profil deaktiviert, wenn nichts außerhalb der Runtime eine Verbindung zu Ihrer Datenbank herstellt. Ein ungenutzter Port bedeutet Angriffsfläche.

## Healthchecks

| Pfad | Verwendung |
| --- | --- |
| `/livez` | Liveness. Beantwortet „Lebt dieser Prozess?“, ohne die Datenbank zu berühren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez` aus. Eine Liveness-Probe auf `/health` startet einen vollkommen gesunden Prozess bei einem kurzen Datenbank-Schluckauf neu, was genau das Gegenteil ihres Zwecks ist.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Anfragezahlen und Latenz-Histogramme aufgeschlüsselt nach API-Bereich (Data, Auth, Storage, Functions) und Tabelle sowie Prozess-Gauges. Ohne ein Token kann jeder den Endpunkt lesen, der den Port erreicht; setzen Sie daher eines, es sei denn, der Dienst befindet sich in einem privaten Netzwerk.

`rebase_db_pool_wait_ms` ist ein Histogramm darüber, wie lange jede Abfrage auf eine Verbindung aus dem Datenbankpool gewartet hat (einschließlich des Öffnens einer neuen), gelabelt nach dem Datenschlüssel (`source="(default)"` in einem Projekt, das keine Datenquellen deklariert). Ein gesunder Pool hält diesen Wert nahe Null. Ein Tail, der mit dem Datenverkehr anwächst, bedeutet, dass Anfragen auf Verbindungen warten – meist blockiert durch Write-Hooks, die auf eine langsame Operation warten; siehe [A hook holds a connection](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Die Datenbank selbst, pro Datenquelle:

| Metrik | Bedeutung |
|--------|-----------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Verbindungen jedes Pools, gelabelt als `pool="primary"`, `"read"` (das Replikat) oder `"session"` (der direkte Pool der SQL-Konsole hinter einem Pooler). Wenn `waiting` längere Zeit über null liegt, ist der Pool zu klein für seine Last. |
| `rebase_db_connection_errors_total` | Anfragen, die mangels Verbindung mit 503 beantwortet wurden, nach `code`: `53300` / `53400` (dem Server sind die Verbindungen ausgegangen), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Client-Verbindungen auf dem Server nach `state`, im Vergleich zu `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Die Größe der Datenbank. |
| `rebase_db_replica_lag_seconds` | Wie weit `DATABASE_READ_URL` hinter dem Primary zurückliegt. |

Die letzten vier werden alle 30 Sekunden über die instanzeigene Verbindung abgefragt, sodass ein Scrape niemals zu einer Datenbankabfrage wird.

`rebase_realtime_*` meldet die offenen Sockets, Channels und die an den Channel-Bus gesendeten oder zurückgehaltenen Frames jeder Instanz: siehe [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Sicherheits-Header

Jede Antwort enthält `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` und `Strict-Transport-Security: max-age=15552000` (180 Tage). Der HSTS-Header lässt `includeSubDomains` bewusst aus: Dies würde Browser anweisen, einfaches HTTP auf jeder Subdomain Ihrer Domain zu verweigern – auch auf solchen, mit denen dieser Server nichts zu tun hat –, und ein Browser behält diese Anweisung so lange bei, wie der Header vorgibt.
Setzen Sie `REBASE_HSTS_INCLUDE_SUBDOMAINS=true`, wenn jede Subdomain ausschließlich HTTPS verwendet.

`strict-origin-when-cross-origin` ist der Standard der Browser selbst: Eine Anfrage an eine andere Website übermittelt Ihren Origin und niemals den Pfad oder die Query der Seite. Es wird nicht `no-referrer` verwendet, da Origin-Prüfungen den Origin benötigen – der Google-Sign-in-Button vergleicht diesen mit den autorisierten JavaScript-Origins des OAuth-Clients, und unter `no-referrer` antwortete er bei jeder App mit „The given origin is not allowed for the given client ID“, unabhängig davon, was der Client erlaubte. Eine Antwort, die eine eigene Policy festlegt, behält diese bei (die MCP-Zustimmungsseite sendet `no-referrer`); eine Seite, die eine strengere Richtlinie wünscht, kann dies über `<meta name="referrer" content="no-referrer">` angeben. `X-Frame-Options` funktioniert genauso: `SAMEORIGIN`, sofern die Antwort keine eigene Richtlinie setzt, wie es die MCP-Zustimmungsseite mit `DENY` tut.

Die statischen Apps – die CMS-Administration und jedes Frontend, das das Bundle ausliefert – enthalten außerdem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Dies bestimmt, wer die App in einen Frame einbetten darf, schließt Plugins aus und bindet `<base>` an Ihren Origin. Es schränkt darüber hinaus nichts weiter ein, sodass Inline-Skripte, Worker und Anmeldungen über Drittanbieter weiterhin funktionieren. Eine Antwort, die eine eigene Policy definiert, behält diese bei. Wenn Sie strengere Regeln benötigen, hinterlegen Sie die Policy auf dem vorgeschalteten Reverse Proxy.

### Einem anderen Origin das Einbetten per Frame erlauben

`frame-ancestors 'self'` bedeutet, dass nur eine Seite auf dem origin-eigenen Host der App diese in einen Iframe einbinden darf. Ein CMS auf `admin.example.com`, das eine Vorschau der Website auf `www.example.com` anzeigt, benötigt die Erlaubnis der Website mittels `frameAncestors` für die App der Website in `rebase.json`:

```jsonc
"site": {
  "type": "static", "root": "site", "output": "site/dist", "path": "https://www.example.com",
  "frameAncestors": ["https://admin.example.com"]
}
```

Die Website wird dann mit `frame-ancestors 'self' https://admin.example.com` ausgeliefert, ebenso wie jede [Route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) der Website, deren Funktion keine eigene Policy sendet. Die anderen Apps behalten `'self'` bei. `X-Frame-Options: SAMEORIGIN` wird weiterhin parallel gesendet; ein Browser, der `frame-ancestors` interpretiert, ignoriert `X-Frame-Options`, wie es die CSP-Spezifikation vorschreibt.

Jeder Eintrag ist ein einzelner Origin, exakt geschrieben: `https://` mit einem Hostnamen und einem optionalen Port oder `http://` für `localhost`, `127.0.0.1` und `[::1]` während der Entwicklung. Es gibt keine Wildcards, keine Pfade und keine Schlüsselwörter – `'self'` steht immer auf der Liste, und alles andere wird von der CLI und erneut von der Runtime abgelehnt, bevor es den Header erreicht. Nichts ist erlaubt, es sei denn, Sie benennen es explizit.

## Mehrere Instanzen

Ein einzelner Container ist der Standard und benötigt nichts weiter. Bevor ein zweites Replikat Datenverkehr empfängt – oder ein Rolling Deploy zwei Instanzen parallel ausführt –, lesen Sie [Running more than one instance](/docs/deployment/multiple-instances/): Rate-Limits, Broadcast-Channels, lokale Dateien, fortsetzbare Uploads (Resumable Uploads) und der Image-Cache gelten pro Prozess, bis sie über eine Konfiguration geteilt werden.

## Claude verbinden

Ein einziger Befehl fügt diesen Server zum [Rebase-Connector](/docs/ai/rebase-connector/) hinzu – dem zentralen MCP-Connector, der von Claude aus all Ihre Projekte erreicht:

```bash
rebase cloud connect https://your-app.com
```

Setzen Sie die beiden Variablen, die der Befehl ausgibt, auf diesem Server und starten Sie ihn neu. Der Server muss mit Rebase 0.28.1 oder neuer laufen und über HTTPS unter einer öffentlichen Adresse erreichbar sein. Alles andere bleibt unverändert: Er speichert kein Secret und gewährt dem Connector dieselben Rechte wie Studio.

## Funktionen in einem eigenen Prozess ausführen

Alles Vorherige bezieht sich auf einen einzelnen Container, der das gesamte Projekt ausliefert – was für fast jedes Deployment die richtige Struktur ist. Wenn eine benutzerdefinierte Funktion nicht länger mit der Data-API um die Event-Loop konkurrieren soll – oder unabhängig skalieren, neu starten und fehlschlagen können soll –, können dasselbe Image und dasselbe Bundle als mehrere zusammenarbeitende Prozesse gestartet werden. Siehe [Split processes](/docs/deployment/split-processes/).

## Upgrades

```yaml
image: rebasepro/server:0.34.1
```

Starten Sie neu. Ihr Bundle bleibt unverändert. Innerhalb derselben Major-Version des Runtime-Vertrags funktioniert ein validiertes Bundle weiterhin – siehe [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).

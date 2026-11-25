---
sourceHash: b0729cb59da388c7
title: Self-Hosting
sidebar_label: Self-Hosting
description: Führen Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle aus – Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Das Self-Hosting von Rebase bedeutet, dass zwei Dinge ausgeführt werden: eine Postgres-Datenbank und das offizielle `rebasepro/server`-Image, in das das Bundle Ihres Projekts eingebunden ist.

Es muss **kein Anwendungs-Image gebaut werden**. Ihr Projekt wird als Bundle übertragen, die Runtime ist veröffentlicht, und ein Upgrade von Rebase ist lediglich eine Änderung des Tags statt eines Rebuilds. Siehe [Runtime und Bundles](/docs/architecture/runtime-and-bundles/) für die Gründe dieser Aufteilung.

## Docker Compose

**Wenn Ihr Projekt aus `rebase init` stammt, verwenden Sie dessen eigene `docker-compose.yml`.**
Sie befindet sich in Ihrem Repository; `init` hat die Secrets, das erste Administratorkonto und die festgelegte Runtime-Version eingetragen. Es ist genau die Datei, die unter [Bereitstellung](/docs/getting-started/deployment/#docker-compose-recommended) beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite beschreibt dieselbe Bereitstellung ohne ein Scaffold im Hintergrund – das Projekt einer anderen Person, ein in der CI erstelltes Bundle oder die beiden Dinge, die in der generierten Datei bewusst weggelassen wurden: ein Connection Pooler und die Split-Process-Architekturen.
Diese Variante liegt im Repository unter [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Verwenden Sie diese Datei, anstatt einen Schnipsel von dieser Seite zu kopieren: Beide Dateien werden bei jedem Push vom projekteigenen Acceptance Gate gestartet, sodass keine der beiden von dem abweichen kann, was tatsächlich funktioniert.

Beide stimmen bei jeder Umgebungsvariable überein, mit Ausnahme des Datenbankpassworts. Das liegt daran, dass jede Datei für ihren jeweiligen Ersteller geschrieben wurde: Diese Datei liest `POSTGRES_PASSWORD`, das von `quickstart.sh` generiert wird; die generierte Datei liest `DATABASE_PASSWORD`, das `rebase init` auch in die `DATABASE_URL` einbettet, die es in Ihre `.env` schreibt.

```bash
rebase build                    # erzeugt ./dist-bundle
./infra/docker/quickstart.sh    # schreibt infra/docker/.env, falls nicht vorhanden, und startet den Stack
```

`quickstart.sh` ist ein einziger Befehl, der zwei naheliegende Dinge tut und beide ausgibt. Die ausführliche Variante, falls Sie jeden Schritt selbst kontrollieren möchten:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Sie müssen die Datenbank nicht separat starten – `api` wartet auf deren Healthcheck.

### Die sechs erforderlichen Werte

`quickstart.sh` generiert diese Werte für Sie. Um die `.env`-Datei selbst zu schreiben:

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

Drei Secrets, eine Konfigurationsangabe und das Konto, mit dem Sie sich anmelden:

- **`POSTGRES_PASSWORD`** – das Datenbankpasswort. Eine spätere Änderung bedeutet, dass es auch im Volume geändert werden muss; wählen Sie es also mit Bedacht.
- **`JWT_SECRET`** – signiert jede Sitzung. Bei einer Rotation werden alle Benutzer abgemeldet.
- **`REBASE_SERVICE_KEY`** – die Anmeldeinformationen, die Row-Level Security für Server-zu-Server-Aufrufe umgehen. Behandeln Sie diesen wie ein Root-Passwort: Jeder, der darüber verfügt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** – die Origins, von denen Ihr Frontend ausgeliefert wird, durch Kommas getrennt. Kein Secret und nicht optional: Die Runtime verweigert den Start in der Produktionsumgebung ohne diese Angabe, anstatt Vermutungen anzustellen. Eine API, die ihre erlaubten Origins errät, lässt letztlich die falschen zu.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** – der erste Administrator. Eine frische Datenbank hat keine Benutzer, und außerhalb der Produktionsumgebung lässt die Registrierungsrichtlinie die erste Registrierung zu und befördert sie zum Administrator – andernfalls wäre eine leere Datenbank eine Sackgasse, da für das Bootstrapping eines Administrators ein bereits angemeldeter Aufrufer erforderlich ist. Sobald dieser Stack unter einem Hostnamen erreichbar ist, stellt diese Bequemlichkeit eine Race Condition dar, die der Betreiber verlieren kann. Daher ist das Zeitfenster in der Produktionsumgebung geschlossen und das Konto wird stattdessen hier definiert. Die Runtime erstellt es einmalig, solange die Benutzertabelle leer ist, und führt bei jedem weiteren Start keine Aktionen mehr aus.

`JWT_SECRET` und `REBASE_SERVICE_KEY` müssen jeweils mindestens 32 Zeichen lang sein, das Admin-Passwort mindestens 12. Verwenden Sie eine E-Mail-Adresse mit einem Punkt in der Domain: `POST /auth/login` parst den Request-Body mit `z.string().email()`, sodass die Runtime die Initialisierung von `admin@localhost` verweigert – ein Konto, an dem sich niemand anmelden könnte – und stattdessen den Grund protokolliert. Die Compose-Datei deklariert alle sechs Variablen mit `${VAR:?…}`, sodass eine fehlende Variable den Stack mit einer entsprechenden Fehlermeldung stoppt, anstatt ein halb konfiguriertes System zu starten – und die Selbstregistrierung ist standardmäßig deaktiviert (`DISABLE_SELF_REGISTRATION`, Standardwert `true`), sodass keine Konten unbefugt beansprucht werden können.

Melden Sie sich mit diesen Zugangsdaten an und ändern Sie das Passwort: Sie befinden sich im Klartext in einer Datei auf dem Host.

## Abhängigkeiten

`rebase build` **installiert die Abhängigkeiten Ihres Projekts standardmäßig direkt in das Bundle**, sodass `dist-bundle` zusammen mit `node_modules` und einer `package-lock.json` neben seiner `package.json` ausgeliefert wird. Ein Bundle mit integrierten Abhängigkeiten (vendored) startet in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt (read-only) einbinden. Das ist empfehlenswert, da ein kompromittierter Hook dann den Code nicht überschreiben kann, der nach dem nächsten Neustart ausgeführt wird:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` deaktiviert dies und erzeugt ein Bundle, das seine Abhängigkeiten stattdessen beim ersten Start installiert. Dies dauert 40–60 Sekunden pro Start und erfordert, dass der Mount beschreibbar ist.

Für einen echten Produktiveinsatz empfiehlt es sich, beides in ein Image zu packen, was zudem exakt festlegt, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.37.1
COPY dist-bundle /bundle
```

## Schema erstellen

**Die Runtime erstellt fehlende Tabellen beim Start automatisch, einschließlich derer, die in `backend/schema` deklariert sind.**
`REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` eingestellt, was über das gesamte Schema hinweg additiv wirkt: Es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an. Ein erster Start mit einer leeren Datenbank führt dazu, dass Ihre Tabellen ohne separaten Schritt direkt bereitgestellt werden.

Was `ensure` ganz bewusst niemals tut, ist das Ändern von bereits Existierendem. Es ändert weder einen Spaltentyp, noch löscht es eine Tabelle oder Spalte, noch bearbeitet es die Bezeichner eines bestehenden Enums – denn ein Container-Neustart darf niemals in der Lage sein, ein Schema als Nebeneffekt eines Deployments umzustrukturieren.

Daher lohnt es sich weiterhin, `rebase db push` für alles auszuführen, was beim Booten unberührt bleibt – jede Änderung, die nicht rein additiv ist: eine umbenannte Spalte, ein eingeschränkterer Typ, ein entferntes Feld.

```bash
rebase db push
```

Führen Sie den Befehl aus einem Checkout oder einem CI-Job aus, der auf die Datenbank der Bereitstellung verweist. Der Befehl führt die Änderung zunächst als Trockenlauf (Dry-Run) aus, verweigert destruktive Änderungen ohne explizite Bestätigung und kann vor der Anwendung ein Backup erstellen. Die Datenbank gibt in der Compose-Datei einen Port frei, damit dieser Befehl sie vom Host aus erreichen kann. Entfernen Sie dieses Mapping, sobald das Schema eingerichtet ist, falls die Datenbank von außen nicht erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert ausschließlich `ensure` und `none` – das Image **verweigert den Start** bei `push` aus dem oben genannten Grund.

## Wenn nur Ihr Änderungsprozess die Datenbank verändern darf

`REBASE_MIGRATE_ON_BOOT=none` lässt Ihre Tabellen unberührt. Die Datenbank selbst bleibt jedoch nicht völlig unberührt: Die eigenen Tabellen des Frameworks (Authentifizierung, API-Keys, Jobs, Cron) werden weiterhin bei jedem Start erstellt und aktuell gehalten. Wenn die Datenbank nur über einen geprüften Change-Management-Prozess geändert werden darf, setzen Sie `REBASE_PROVISION=false` auf jedem Prozess, der Anfragen bedient:

| Einstellung | Deklarierte Tabellen und Policies | Framework-Tabellen |
|---|---|---|
| Standard (`REBASE_MIGRATE_ON_BOOT=ensure`) | beim Start erstellt und aktuell gehalten | erstellt und aktuell gehalten |
| `REBASE_MIGRATE_ON_BOOT=none` | unberührt gelassen | erstellt und aktuell gehalten |
| `REBASE_PROVISION=false` | unberührt gelassen | unberührt gelassen; was fehlt, wird im Log genannt |

Wenn das Provisioning deaktiviert ist, erstellt und ändert die Runtime nichts: keine Tabelle, Spalte, keinen Index, keine Funktion, keinen Trigger, keine Policy, Rolle oder Berechtigung. Das gilt sowohl beim Start als auch später, einschließlich der Tabellen, die ein Serverprozess ansonsten bei der ersten Verwendung anlegt (Idempotenzschlüssel, Cron-Claims, die gemeinsamen Rate-Limit-Zähler). Stattdessen liest er das aus, was vorhanden ist:

- **Auth-Tabellen oder eine Spalte, die die Authentifizierung liest, fehlen:** Der Start wird verweigert und die fehlenden Elemente werden einzeln aufgelistet.
- **Die Request-Rolle kann auf eine Framework-Tabelle zugreifen**, wie etwa `rebase.refresh_tokens` oder `rebase.api_keys`: Der Start wird verweigert und der auszuführende `REVOKE`-Befehl ausgegeben. Ein Start mit aktivem Provisioning entzieht diese Privilegien selbstständig. Bei deaktiviertem Provisioning geschieht dies nicht.
- **Eine optionale Tabelle fehlt** (API-Keys, Idempotenzschlüssel, Cron-Claims, Rate-Limit-Zähler, Presence, Metriken-Historie): Dieses Feature ist deaktiviert und das Log gibt an, welche Tabelle dafür benötigt wird.
- **Eine deklarierte Tabelle wird von der Datenbank nicht geschützt** – Row-Level Security ist deaktiviert, keine der von ihr deklarierten Policies ist vorhanden oder eine von ihr deklarierte restriktive Policy fehlt: Diese Tabelle wird nicht bedient (eine fehlende permissive Policy wird bedient, mit einer Boot-Warnung, die sie benennt). Eine Anfrage für diese Tabelle wird mit `503 TABLE_WITHHELD` beantwortet, und das Boot-Log nennt das SQL, das sie schützt (oder verweist auf `rebase db push`). Die anderen Tabellen werden ausgeliefert, und der Start wird fortgesetzt. Eine Many-to-Many-Junction wird auf die gleiche Weise geprüft: Ist sie von der Datenbank nicht geschützt, werden die Tabellen zurückgehalten, deren Relationen sie verwenden, und `TABLE_WITHHELD` nennt die Junction. Eine Tabelle, deren `via`-Relation über eine zurückgehaltene Tabelle verläuft, wird ebenfalls zurückgehalten, und die Meldung nennt die Relation. Dies gilt auch für `REBASE_MIGRATE_ON_BOOT=none` und bei einer Live-Schema-Aktualisierung. Eine Tabelle, deren Zugriff die Anwendung selbst durchsetzt, gibt `rlsRequired: false` an, um trotzdem bedient zu werden ([Anleitung](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access)).

Zeilen ändern sich weiterhin wie in jeder Datenbank: Anmeldungen, Sitzungen, API-Key-Nutzung, Idempotenzschlüssel, Cron-Claims. Das erste Administratorkonto (`REBASE_ADMIN_EMAIL`) wird durch den Provisioning-Lauf initialisiert, nicht durch die ausführenden Prozesse. Das [Live Schema Editing](/docs/backend/live-schema-editing) kann eine Änderung weiterhin als Quellcode committen, weigert sich jedoch, sie auf die Datenbank anzuwenden.

### Der Provisioning-Lauf

Das Schema stammt aus einem Durchlauf, der von Ihrem Änderungsprozess gesteuert wird. Verwenden Sie dasselbe Image und Bundle wie der Server, mit `REBASE_PROVISION_ONLY=true`, verbunden als Rolle, die Erstellungsrechte in der Datenbank besitzt. `REBASE_PROVISION_SQL_OUT` speichert jede vom Lauf vorgenommene Schemaänderung als SQL-Skript:

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

Das Image läuft mit `NODE_ENV=production`, sodass dieser Lauf denselben Umgebungsprüfungen unterliegt wie der Server – einschließlich `CORS_ORIGINS` oder `FRONTEND_URL` –, auch wenn er keine Anfragen bedient.

Das Skript ist ein Protokoll, kein Plan: Jedes darin enthaltene Statement wurde der Reihe nach ausgeführt und war erfolgreich. Aufgezeichnet gegen eine leere Datenbank stellt es das gesamte Schema dar, das das Release benötigt. Aufgezeichnet gegen eine wiederhergestellte Kopie der Produktionsdatenbank ist es exakt das Upgrade. Datenzeilen, die der Lauf geschrieben hat, sind nicht darin enthalten. Überprüfen Sie es und wenden Sie es dann auf die echte Datenbank an:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Wiederholen Sie dies bei jedem Rebase-Upgrade, bevor die produktiven Prozesse aktualisiert werden. Ein Release kann eine Tabelle oder eine Spalte hinzufügen, und ein Prozess, der keine erstellen darf, meldet sie als fehlend, anstatt sie selbst zu erzeugen.

Ein Server, den Sie selbst bauen, folgt derselben Regel: `initializeRebaseBackend` liest `REBASE_PROVISION`, und `createRebaseBackend` akzeptiert [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Dateispeicher

Der Speicher ist standardmäßig **deaktiviert**, es sei denn, ein Bucket ist konfiguriert. Das ist eine bewusste Entscheidung: Der alternative Standard wäre das Dateisystem des Containers, das jede hochgeladene Datei beim nächsten Neustart stillschweigend verliert. Uploads werden mit `501 STORAGE_NOT_CONFIGURED` abgelehnt, bis Sie einen Speicher eingerichtet haben.

Setzen Sie für einen Bucket `STORAGE_TYPE=s3` (oder `gcs`) sowie den Bucket-Namen und die Anmeldeinformationen – die Compose-Datei listet die Variablen auskommentiert auf. `gcs` lädt `@google-cloud/storage`, was im offiziellen Image nicht enthalten ist. Greifen Sie bei diesem Image auf Google Cloud Storage stattdessen über dessen S3-kompatiblen Endpunkt zu (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, HMAC-Schlüssel).

Für lokalen Speicherplatz auf der Festplatte, was nur dann sinnvoll ist, wenn der Pfad ein echtes Volume ist, das den Container überdauert:

```yaml
      STORAGE_TYPE: local
      # Jeder deklarierte Bucket erhält ein Verzeichnis neben diesem, bucket("media")
      # /storage/uploads__media, daher gehört das Volume auf das übergeordnete Verzeichnis.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` ist dort nicht optional: In der Produktionsumgebung wird ein `local`-Backend verworfen, anstatt registriert zu werden, da die Alternative darin bestünde, dass Uploads in ein Dateisystem erfolgen, das kurz vor der Zerstörung steht. Über diese Variable bestätigen Sie, dass der Mount persistent ist.

Hängen Sie das Volume **oberhalb** von `STORAGE_PATH` ein, nicht direkt darauf. `STORAGE_PATH` ist das Verzeichnis des Standard-Buckets, und jeder in `backend/resources.ts` deklarierte Bucket erhält sein eigenes Verzeichnis daneben: `<STORAGE_PATH>__<key>`. Ein Volume direkt unter `STORAGE_PATH` nimmt nur den Standard-Bucket auf. Jeder andere Bucket würde in das Dateisystem des Containers schreiben und seine Dateien verlieren, wenn der Container neu erstellt wird. `STORAGE_PATH__MEDIA` kann einen einzelnen Bucket an eine andere Stelle auf dem Volume verschieben. Er kann ihn jedoch nicht in das Verzeichnis eines anderen Buckets verschieben, wie etwa `/storage/uploads/media`, da der Standard-Bucket dann dessen Dateien auflisten, ausliefern und löschen würde.

Das Image erstellt `/storage` für den unprivilegierten Benutzer `node`, unter dem es läuft, weshalb das Volume dort platziert wird. Ein Volume, das an einer Stelle eingebunden wird, an der das Image kein Verzeichnis besitzt, gehört Root, und jeder Upload schlägt mit `EACCES` fehl. Die von `rebase init` generierte Compose-Datei bindet es auf diese Weise ein.

### Storage benötigt ein Zugriffskontrollmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime den Start in der Produktionsumgebung**, bis das Deployment definiert, wie Objekte geschützt werden. Der Speicher unterliegt nicht der Row-Level Security und seine Schlüssel teilen sich einen einzigen flachen Namensraum. Ohne Regeln ist das Einzige, was die Dateien zweier Benutzer trennt, die Unvorhersehbarkeit der Schlüssel – was durch `GET /storage/list?prefix=` zunichtegemacht wird. Jede der folgenden Optionen erfüllt diese Anforderung:

- ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration Ihres Projekts, was das Scaffold in `backend/storage.ts` standardmäßig bereitstellt;
- **`STORAGE_POLICIES`**, dieselben Regeln als JSON – "owner" für einen Ordner pro Benutzer, Rollen für Administratoren (siehe [Speicherautorisierung](/docs/backend/storage-authorization/#as-data-storage_policies));
- **`STORAGE_PUBLIC_READ=true`** für einen Bucket, der tatsächlich ein öffentliches Read-Only-CDN darstellt;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`** für eine Single-Tenant-Anwendung, bei der jedem angemeldeten Benutzer Zugriff auf jede Datei gewährt wird.

Außerhalb der Produktionsumgebung führt dieselbe Bedingung zu einer deutlichen Warnung anstelle einer Verweigerung. Diesen Startfehler erleben Sie daher erst beim Deployment und nicht auf dem Entwicklungsrechner. Dies ist beabsichtigt: Der Fehler, den es ersetzt, wäre sonst unbemerkt geblieben.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, falls Sie TOTP verwenden. Wenn dieser Wert nicht gesetzt ist, werden gespeicherte Authentifikator-Secrets mit `JWT_SECRET` verschlüsselt – eine Rotation dieses Schlüssels meldet somit alle Benutzer ab *und* führt dazu, dass jedes registrierte Gerät nicht mehr entschlüsselt werden kann.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht, sodass alles funktioniert, was Container ausführen kann. Zwei Dinge müssen überall beachtet werden:

1. Das Bundle muss unter `/bundle` vorhanden sein (oder dort, worauf `REBASE_BUNDLE` verweist), mit installierten Abhängigkeiten daneben – siehe [Abhängigkeiten](#abhängigkeiten).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime verweigert den Start in der Produktionsumgebung ohne diese Werte, anstatt Annahmen zu treffen.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.37.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die oben gezeigte abgeleitete Image-Form, damit das Bundle mit der Anwendung ausgeliefert wird, und führen Sie dann `fly deploy` aus.

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

`NODE_ENV=production` ist keine Dekoration. Bleibt dieser Wert ungesetzt, läuft der Prozess im Entwicklungsmodus: Er spiegelt Localhost-Origins, liefert die OpenAPI-Spezifikation aus und **lässt das Registrierungsfenster für den ersten Administrator offen** – die erste fremde Person, die das Registrierungsformular findet, wird somit zum Administrator. Die beiden `REBASE_ADMIN_*`-Zeilen ersetzen dieses Fenster; siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` ist erforderlich, da sich die Datenbank auf derselben Maschine befindet. In der Produktionsumgebung lehnt die Runtime jede Variable ab, die auf Localhost verweist – in einem Container ist Loopback der Container selbst, weshalb diese Adresse fast immer ein Versehen ist – und diese Zeile teilt ihr mit, dass die Adresse gewollt ist. Entfernen Sie sie, wenn die Datenbank an anderer Stelle läuft.

Bevorzugen Sie `EnvironmentFile=/etc/rebase.env` mit Dateirechten `0600` gegenüber `Environment=`-Zeilen für die Secrets: Eine Unit-Datei ist für alle lesbar, und `systemctl show` gibt jeden `Environment=`-Wert aus.

## Connection Pooling

Die Runtime verwaltet ihren eigenen kleinen Pool und benötigt keinen externen Pooler. Für alle anderen Dienste, die mit derselben Datenbank kommunizieren und keine permanente Verbindung halten können – Serverless Functions, geplante Skripte, ein horizontal skalierender Worker –, enthält die Compose-Datei einen `pgbouncer`-Dienst hinter dem `pooler`-Profil. Siehe [Connection Pooling](/docs/deployment/connection-pooling/).

## Healthchecks

| Pfad | Verwendung |
| --- | --- |
| `/livez` | Liveness. Beantwortet die Frage „Lebt dieser Prozess?“, ohne die Datenbank zu berühren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez`. Eine Liveness-Probe auf `/health` startet einen vollkommen gesunden Prozess während eines kurzen Datenbankaussetzers neu – genau das Gegenteil von dem, wofür sie gedacht ist.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Macht Prometheus-Metriken unter `/metrics` verfügbar: Request-Zahlen und Latenz-Histogramme aufgeschlüsselt nach API-Bereich (data, auth, storage, functions) und Tabelle, plus Prozess-Gauges. Ohne Token ist der Endpunkt für jeden lesbar, der den Port erreichen kann; setzen Sie daher eines, es sei denn, der Dienst befindet sich in einem privaten Netzwerk.

`rebase_db_pool_wait_ms` ist ein Histogramm darüber, wie lange jede Abfrage auf eine Verbindung aus dem Datenbank-Pool gewartet hat (einschließlich des Öffnens einer neuen), gekennzeichnet nach Datenquellenschlüssel (`source="(default)"` in einem Projekt, das keine Datenquellen deklariert). Ein gesunder Pool hält diesen Wert nahe Null. Ein Tail, der mit dem Datenverkehr wächst, bedeutet, dass Anfragen in der Warteschlange für Verbindungen stehen – meist gehalten von Schreib-Hooks, die auf langsame Operationen warten; siehe [Ein Hook blockiert eine Verbindung](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Die Datenbank selbst, pro Datenquelle:

| Metrik | Aussage |
|--------|---------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Verbindungen jedes Pools, gekennzeichnet als `pool="primary"`, `"read"` (das Replikat) oder `"session"` (der direkte Pool der SQL-Konsole hinter einem Pooler). Ein `waiting`-Wert, der längere Zeit über Null liegt, weist auf einen für die Last zu kleinen Pool hin. |
| `rebase_db_connection_errors_total` | Anfragen, die mangels Verbindung mit 503 beantwortet wurden, nach `code`: `53300` / `53400` (dem Server sind die Verbindungen ausgegangen), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Client-Verbindungen auf dem Server nach `state`, gemessen an `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Die Größe der Datenbank. |
| `rebase_db_replica_lag_seconds` | Wie weit `DATABASE_READ_URL` hinter dem Primary liegt. |

Die letzten vier Metriken werden alle 30 Sekunden über die instanzeigene Verbindung abgefragt, sodass ein Scrape niemals zu einer separaten Datenbankabfrage führt.

`rebase_realtime_*` meldet die offenen Sockets und Channels jeder Instanz sowie die Frames, die sie an den Channel-Bus gesendet oder zurückgehalten hat: siehe [Das Verhalten des Busses beobachten](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Sicherheits-Header

Jede Antwort enthält standardmäßig `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` und `Strict-Transport-Security: max-age=15552000` (180 Tage). Der HSTS-Header lässt `includeSubDomains` aus: Dies würde Browser anweisen, einfaches HTTP auf jeder Subdomain Ihrer Domain zu verweigern – auch auf solchen, mit denen dieser Server nichts zu tun hat –, und ein Browser speichert diese Anweisung so lange, wie der Header vorgibt.
Setzen Sie `REBASE_HSTS_INCLUDE_SUBDOMAINS=true`, wenn ausnahmslos jede Subdomain ausschließlich über HTTPS erreichbar ist.

`strict-origin-when-cross-origin` ist der Standard der Browser selbst: Eine Anfrage an eine andere Website überträgt Ihren Origin, jedoch niemals den Pfad oder die Query-Parameter der Seite. Es wird bewusst nicht `no-referrer` gewählt, da Origin-Prüfungen den Origin zwingend benötigen – der Google-Anmeldebutton vergleicht ihn beispielsweise mit den autorisierten JavaScript-Origins des OAuth-Clients; unter `no-referrer` antwortete er bei jeder App mit "The given origin is not allowed for the given client ID", unabhängig davon, was der Client erlaubte. Eine Antwort, die eine eigene Policy definiert, behält diese bei (die MCP-Zustimmungsseite sendet `no-referrer`); eine Seite, die eine striktere Policy benötigt, kann dies über `<meta name="referrer" content="no-referrer">` steuern. `X-Frame-Options` verhält sich genauso: `SAMEORIGIN`, es sei denn, die Antwort definiert eine eigene, wie es die MCP-Zustimmungsseite mit `DENY` tut.

Die statischen Anwendungen – der CMS-Adminbereich und jedes vom Bundle ausgelieferte Frontend – senden außerdem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Dies legt fest, wer die App in einem Frame einbinden darf, schließt Plugins aus und bindet `<base>` an Ihren Origin. Es schränkt nichts weiter ein, sodass Inline-Skripte, Worker und Anmeldungen über Drittanbieter weiterhin funktionieren. Eine Antwort, die eine eigene Richtlinie setzt, behält diese. Für strengere Vorgaben hinterlegen Sie die Richtlinie auf dem vorgeschalteten Reverse-Proxy.

### Einem anderen Origin erlauben, eine App einzubetten

`frame-ancestors 'self'` bedeutet, dass nur eine Seite auf dem Origin der App selbst diese in einem iframe einbetten darf. Ein CMS auf `admin.example.com`, das eine Vorschau der Website auf `www.example.com` anzeigt, erfordert, dass die Website dies erlaubt. Dies geschieht über `frameAncestors` bei der App der Website in `rebase.json`:

```jsonc
"site": {
  "type": "static", "root": "site", "output": "site/dist", "path": "https://www.example.com",
  "frameAncestors": ["https://admin.example.com"]
}
```

Die Website wird daraufhin mit `frame-ancestors 'self' https://admin.example.com` ausgeliefert, ebenso wie jede [Route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) der Website, deren Funktion keine eigene Richtlinie sendet. Die übrigen Apps behalten `'self'`. `X-Frame-Options: SAMEORIGIN` wird weiterhin mitgesendet; ein Browser, der `frame-ancestors` unterstützt, ignoriert `X-Frame-Options`, wie es die CSP-Spezifikation vorschreibt.

Jeder Eintrag entspricht genau einem Origin: `https://` mit einem Hostnamen und einem optionalen Port oder `http://` für `localhost`, `127.0.0.1` und `[::1]` während der Entwicklung. Platzhalter, Pfade oder Schlüsselwörter sind nicht zulässig – `'self'` ist immer in der Liste enthalten, und alles andere wird von der CLI und erneut von der Runtime zurückgewiesen, bevor es den Header erreicht. Es ist nichts erlaubt, was nicht explizit benannt wurde.

## Mehrere Instanzen

Ein einzelner Container ist der Standard und benötigt keine weitere Konfiguration. Bevor ein zweites Replikat Traffic übernimmt – oder ein Rolling Deploy zwei Instanzen nebeneinander ausführt –, lesen Sie [Mehrere Instanzen betreiben](/docs/deployment/multiple-instances/): Rate-Limits, Broadcast-Channels, lokale Dateien, fortsetzbare Uploads und der Image-Cache gelten pro Prozess, bis sie über entsprechende Einstellungen geteilt werden.

## Claude anbinden

Ein einziger Befehl verbindet diesen Server mit dem [Rebase-Connector](/docs/ai/rebase-connector/), dem zentralen MCP-Connector, der von Claude aus auf alle Ihre Projekte zugreift:

```bash
rebase cloud connect https://your-app.com
```

Setzen Sie die beiden ausgegebenen Variablen auf diesem Server und starten Sie ihn neu. Der Server muss Rebase 0.28.1 oder neuer ausführen und über HTTPS unter einer öffentlichen Adresse erreichbar sein. Alles andere bleibt unverändert: Er speichert kein Secret und gewährt dem Connector dieselben Rechte wie Studio.

## Funktionen in einem eigenen Prozess ausführen

Alles oben Beschriebene läuft in einem einzigen Container, der das gesamte Projekt bedient – was für fast jedes Deployment die richtige Wahl darstellt. Wenn eine benutzerdefinierte Funktion nicht länger mit der Daten-API um die Event-Loop konkurrieren soll – oder unabhängig skaliert, neu gestartet werden und isoliert fehlschlagen können soll –, können dasselbe Image und dasselbe Bundle als mehrere zusammenarbeitende Prozesse gestartet werden. Siehe [Getrennte Prozesse (Split Processes)](/docs/deployment/split-processes/).

## Upgrade durchführen

```yaml
image: rebasepro/server:0.37.1
```

Starten Sie den Container neu. Ihr Bundle bleibt unverändert. Innerhalb einer Major-Version des Runtime-Contracts funktioniert ein zuvor validiertes Bundle weiterhin – siehe [Kompatibilität](/docs/architecture/runtime-and-bundles/#compatibility).

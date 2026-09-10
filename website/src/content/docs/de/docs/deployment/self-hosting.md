---
sourceHash: aa153f3ab4c80526
title: Self-Hosting
sidebar_label: Self-Hosting
description: Betreiben Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle – Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Das Self-Hosting von Rebase erfordert zwei Komponenten: eine Postgres-Datenbank und das offizielle Image `rebasepro/server`, in das das Bundle Ihres Projekts gemountet ist.

Es muss **kein Anwendungs-Image gebaut werden**. Ihr Projekt wird als Bundle bereitgestellt, die Runtime ist veröffentlicht, und ein Upgrade von Rebase ist lediglich eine Tag-Änderung statt eines Rebuilds. Siehe [Runtime and bundles](/docs/architecture/runtime-and-bundles/) für Details, warum dies so aufgeteilt ist.

## Docker Compose

**Wenn Ihr Projekt aus `rebase init` stammt, verwenden Sie dessen eigene `docker-compose.yml`.**
Sie befindet sich in Ihrem Repository, `init` hat die Secrets, das erste Admin-Konto und die festgelegte Runtime-Version eingetragen, und es ist genau die Datei, die unter
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended)
beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite behandelt dasselbe Deployment ohne ein Scaffold dahinter – das Projekt von jemand anderem, ein in CI gebautes Bundle oder die beiden Dinge, die die generierte Datei bewusst weglässt: ein Connection-Pooler und die Formen mit aufgeteilten Prozessen (Split-Processes). Diese Version befindet sich im Repository unter
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Verwenden Sie diese Datei, anstatt ein Snippet von dieser Seite zu kopieren: Beide Dateien werden bei jedem Push vom projekteigenen Acceptance Gate gestartet, sodass keine von dem abweichen kann, was tatsächlich funktioniert.

Die beiden stimmen bei jeder Umgebungsvariable überein, mit Ausnahme des Datenbankpassworts, und das liegt daran, dass jede für ihren eigenen Ersteller geschrieben wurde: Diese Version liest `POSTGRES_PASSWORD`, das von `quickstart.sh` generiert wird; die generierte Version liest `DATABASE_PASSWORD`, das `rebase init` auch in die `DATABASE_URL` einbettet, die es in Ihre `.env` schreibt.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` ist ein einziger Befehl, der zwei offensichtliche Dinge tut und beide ausgibt. Die ausführliche Form, falls Sie lieber jeden Schritt selbst kontrollieren möchten:

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

- **`POSTGRES_PASSWORD`** — das Datenbankpasswort. Eine spätere Änderung erfordert auch eine Änderung im Volume, wählen Sie es also einmalig fest.
- **`JWT_SECRET`** — signiert jede Session. Eine Rotation meldet alle Benutzer ab.
- **`REBASE_SERVICE_KEY`** — die Anmeldedaten, die Row-Level Security für Server-zu-Server-Aufrufe umgehen. Behandeln Sie es wie ein Root-Passwort: Alles, was diesen Schlüssel besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** — die Origins, von denen Ihr Frontend ausgeliefert wird, kommagetrennt. Kein Secret und nicht optional: Die Runtime verweigert in der Produktion den Start ohne diese Angabe, anstatt zu raten, denn eine API, die ihre erlaubten Origins errät, erlaubt früher oder später die falsche.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — der erste Administrator. Eine frische Datenbank hat keine Benutzer, und außerhalb der Produktion erlaubt die Registrierungsrichtlinie die erste Registrierung und stuft sie zum Admin hoch – andernfalls ist eine leere Datenbank eine Sackgasse, da das Bootstrappen eines Admins einen Aufrufer erfordert, der bereits angemeldet ist. Sobald dieser Stack unter einem Hostnamen erreichbar ist, wird diese Bequemlichkeit zu einem Wettlauf, den der Betreiber verlieren kann. In der Produktion ist dieses Zeitfenster daher geschlossen und das Konto wird stattdessen hier angegeben. Die Runtime erstellt es einmalig, solange die Benutzertabelle leer ist, und unternimmt bei jedem weiteren Start nichts mehr.

Jedes der drei Secrets muss mindestens 32 Zeichen lang sein und das Admin-Passwort mindestens 12 Zeichen. Verwenden Sie eine Adresse mit einem Punkt in der Domain: `POST /auth/login` parst den Body mit `z.string().email()`, sodass `admin@localhost` zwar ein Konto erstellen würde, dann aber jeden Versuch, es zu nutzen, verweigern würde. Die Compose-Datei deklariert alle sechs mit `${VAR:?…}`, sodass ein fehlender Wert den Stack mit einer Fehlermeldung stoppt, die ihn benennt, anstatt etwas halb Konfiguriertes zu starten – und die Selbstregistrierung ist standardmäßig deaktiviert (`DISABLE_SELF_REGISTRATION`, Standard `true`), sodass nichts herrenlos bleibt.

Melden Sie sich mit diesen Anmeldedaten an und ändern Sie das Passwort: Sie befinden sich in einer Datei auf dem Host.

## Abhängigkeiten

`rebase build` **installiert standardmäßig die Abhängigkeiten Ihres Projekts in das Bundle**, sodass `dist-bundle` zusammen mit einer `node_modules` und einer `package-lock.json` neben seiner `package.json` bereitgestellt wird. Ein gevendortes Bundle startet in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt (read-only) mounten – was sich empfiehlt, da ein kompromittierter Hook dann den Code nicht überschreiben kann, der nach dem nächsten Neustart ausgeführt wird:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` deaktiviert dies und erzeugt ein Bundle, das seine Abhängigkeiten stattdessen beim ersten Start installiert, was 40–60 Sekunden pro Start dauert und erfordert, dass der Mount beschreibbar ist.

Für ein echtes Deployment empfiehlt es sich, beides fest in ein Image einzubauen, wodurch auch exakt festgelegt wird, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

## Schema erstellen

**Die Runtime erstellt beim Booten fehlende Tabellen, einschließlich derjenigen Ihrer Collections.**
`REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg rein additiv wirkt: Es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an. Ein erster Start auf einer leeren Datenbank stellt Ihre Collections ohne separaten Zwischenschritt sofort bereit.

Was `ensure` ganz bewusst niemals tut, ist bestehende Strukturen zu verändern. Es ändert weder einen Spaltentyp, noch löscht es eine Tabelle oder Spalte, noch bearbeitet es die Labels eines bestehenden Enums – denn ein Container-Neustart darf nicht in der Lage sein, ein Schema als Nebeneffekt eines Deployments umzugestalten.

Daher lohnt sich die Ausführung von `rebase db push` weiterhin für die zwei Dinge, die beim Booten unangetastet bleiben:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** — eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Führen Sie dies aus einem Checkout oder einem CI-Job aus, gerichtet an die Datenbank des Deployments. Es führt zunächst einen Probelauf (Dry-Run) der Änderungen durch, verweigert destruktive Änderungen ohne explizite Bestätigung und kann vor der Anwendung ein Backup erstellen. Die Datenbank gibt in der Compose-Datei einen Port frei, damit dieser Befehl sie vom Host aus erreichen kann; entfernen Sie dieses Mapping, sobald das Schema eingerichtet ist, falls die Datenbank nicht von außen erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert nur `ensure` und `none`, und sonst nichts – das Image **verweigert den Start** bei `push` aus dem oben genannten Grund.

## Dateispeicher

Storage ist **deaktiviert**, es sei denn, ein Bucket ist konfiguriert, und das ist beabsichtigt: Der alternative Standard wäre das Dateisystem des Containers, das beim nächsten Neustart stillschweigend jede hochgeladene Datei verlieren würde. Uploads werden mit `501 STORAGE_NOT_CONFIGURED` abgewiesen, bis Sie einen Speicher eingerichtet haben.

Für einen Bucket setzen Sie `STORAGE_TYPE=s3` (oder `gcs`) sowie den Bucket-Namen und die Zugangsdaten – die Compose-Datei listet diese Variablen auskommentiert auf.

Für lokalen Speicher, was nur dann sinnvoll ist, wenn der Pfad ein echtes Volume ist, das den Container überdauert:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` ist an dieser Stelle nicht optional: In der Produktion wird ein `local`-Backend verworfen statt registriert, da die Alternative Uploads wären, die erfolgreich in einem Dateisystem landen, das kurz vor der Zerstörung steht. Über diese Variable bestätigen Sie, dass der Mount persistent ist.

### Storage benötigt ein Zugriffskontrollmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime in der Produktion den Start**, bis das Deployment festlegt, wie Objekte geschützt sind. Storage unterliegt nicht der Row-Level Security und seine Schlüssel teilen sich einen flachen Namensraum. Ohne eine Regel wäre das Einzige, was die Dateien zweier Benutzer trennt, die Unvorhersehbarkeit der Schlüssel – was durch `GET /storage/list?prefix=` zunichtegemacht wird. Jede der folgenden Optionen erfüllt diese Anforderung:

- ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration Ihres Projekts, was die eigentliche Lösung darstellt und standardmäßig im Scaffold unter `config/storage.ts` mitgeliefert wird – keine Umgebungsvariable kann ausdrücken: „Dieser Benutzer darf diesen Schlüssel lesen“;
- **`STORAGE_PUBLIC_READ=true`** für einen Bucket, der tatsächlich ein öffentliches Read-only-CDN ist;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`** für eine Single-Tenant-App, bei der jedem angemeldeten Konto für jede Datei vertraut wird.

Außerhalb der Produktion führt diese Bedingung zu einer deutlichen Warnung statt zu einer Verweigerung; dies ist also ein Startfehler, dem man beim Deployment und nicht auf dem lokalen Entwicklungsrechner begegnet. Dies ist beabsichtigt: Der Fehler, den es verhindert, wäre sonst stillschweigend aufgetreten.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, wenn Sie TOTP verwenden. Bleibt dieser Wert ungesetzt, werden gespeicherte Authenticator-Secrets mit `JWT_SECRET` verschlüsselt – eine Rotation dieses Schlüssels meldet somit nicht nur alle Benutzer ab, *sondern* macht auch jedes registrierte Gerät unentschlüsselbar.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht, sodass alles funktioniert, was Container ausführen kann. Zwei Dinge müssen überall stimmen:

1. Das Bundle muss unter `/bundle` (oder dem Pfad, auf den `REBASE_BUNDLE` zeigt) liegen, mit den installierten Abhängigkeiten daneben – siehe [Abhängigkeiten](#dependencies).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime verweigert in der Produktion den Start ohne diese Werte, anstatt zu raten.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.20.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die oben gezeigte Form des abgeleiteten Images, damit das Bundle mit der App ausgeliefert wird, und führen Sie dann `fly deploy` aus.

### Railway / Render

Verweisen Sie den Dienst auf das abgeleitete Image, setzen Sie die Umgebungsvariablen und stellen Sie den Healthcheck-Pfad auf `/livez` ein.

### Ein einfacher VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` listet die Variablen auf, die gelesen werden. Unter systemd – die drei Admin-Zeilen sind neu, und unter 0.17.3 wird stattdessen das erste registrierte Konto zum Administrator:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` ist keine Dekoration. Bleibt dieser Wert ungesetzt, läuft der Prozess im Entwicklungsmodus: Er spiegelt localhost-Origins wider, stellt die OpenAPI-Spezifikation bereit und **lässt das Zeitfenster für den ersten Admin offen** – sodass der erste Fremde, der das Registrierungsformular findet, zum Administrator wird. Die beiden `REBASE_ADMIN_*`-Zeilen ersetzen dieses Zeitfenster; siehe [Your first admin](/docs/getting-started/deployment/#your-first-admin).

Bevorzugen Sie `EnvironmentFile=/etc/rebase.env` mit den Dateiberechtigungen 0600 gegenüber `Environment=`-Zeilen für die Secrets: Eine Unit-Datei ist für alle Benutzer lesbar, und `systemctl show` gibt jeden `Environment=`-Wert aus.

## Connection Pooling

Die Runtime unterhält einen kleinen, langlebigen Pool und benötigt keinen Pooler. Was hingegen einen benötigt, ist alles andere, was mit derselben Datenbank kommuniziert und keine dauerhafte Verbindung halten kann: eine Serverless-Funktion, ein geplantes Skript, ein BI-Tool, ein Queue-Worker, der auf fünfzig Instanzen skaliert. `max_connections` von Postgres ist ein hartes Limit im unteren Hunderterbereich und jede Verbindung ist ein *Prozess*, sodass ein Fan-Out von Lambda-Funktionen dieses Limit erschöpft, lange bevor die Datenbank ausgelastet ist.

Die Compose-Datei liefert einen `pgbouncer`-Dienst für diesen Datenverkehr mit, hinter einem Profil, sodass ein Deployment ohne solche Aufrufer keinen Prozess ausführt, für den es keine Verwendung hat:

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

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert, sodass das Passwort nicht doppelt eingetragen werden muss. Der Pooler authentifiziert sich bei Postgres mit `scram-sha-256`, was von Postgres 18 gespeichert wird – der Standardwert `md5` des Images schlägt beim *Server*-Login mit `FATAL: server login failed: wrong password type` fehl, was sich wie ein falsches Passwort liest, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich unter dem `max_connections`-Wert der Datenbank – die Runtime bedient sich aus demselben Kontingent.

### Was Transaction Pooling ändert

Ein gepoolter Client hält eine Serververbindung für die Dauer einer Transaktion und gibt sie anschließend wieder frei; genau dadurch können 500 Clients 20 Verbindungen teilen. Drei Dinge funktionieren über diesen Port nicht mehr, und jedes davon wird von Rebase selbst verwendet – was genau der Grund ist, warum sich die Runtime direkt verbindet und dieser Port für andere Aufrufer gedacht ist:

- **`LISTEN`/`NOTIFY`.** Realtime basiert darauf, und ein Listener benötigt eine Verbindung, die eine Transaktion überdauert. `LISTEN` wird vom Pooler *akzeptiert* – er antwortet auf `LISTEN`, aber danach trifft nie eine Benachrichtigung ein.
- **Session-Status**: `SET` (im Gegensatz zu `SET LOCAL`), Advisory Locks, die über Statements hinweg gehalten werden, `WITH HOLD`-Cursoren, temporäre Tabellen. Die nächste Transaktion landet möglicherweise auf einer anderen Serververbindung, die nichts davon sieht. Beides schlägt auf dieselbe tückische Weise fehl: Bei einem einzelnen untätigen Client ist der Status meist noch vorhanden, sodass es beim Testen funktioniert und erst unter der Nebenläufigkeit fehlschlägt, für die der Pooler überhaupt eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Den meisten Treibern kann mitgeteilt werden, diese nicht zu verwenden – node-postgres tut dies standardmäßig nicht; asyncpg benötigt `statement_cache_size=0`.

`SET LOCAL` ist transaktionsbezogen und funktioniert, und genau damit wird Row-Level Security gesetzt – RLS verhält sich über den gepoolten Port also identisch.

Lassen Sie das Profil deaktiviert, wenn sich nichts außerhalb der Runtime mit Ihrer Datenbank verbindet. Ein ungenutzter Port bedeutet Angriffsfläche.

## Healthchecks

| Pfad | Verwendung |
| --- | --- |
| `/livez` | Liveness. Beantwortet „Lebt dieser Prozess?“, ohne die Datenbank zu berühren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez`. Eine Liveness-Probe auf `/health` startet bei einem kurzen Datenbankproblem einen vollkommen gesunden Prozess neu, was genau das Gegenteil dessen ist, wofür sie gedacht ist.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Anzahl der Anfragen und Latenz-Histogramme, aufgeschlüsselt nach API-Bereich (Data, Auth, Storage, Functions) und Collection, plus Prozess-Gauges. Ohne Token ist der Endpunkt für jeden lesbar, der den Port erreichen kann; setzen Sie daher einen Token, es sei denn, er befindet sich in einem privaten Netzwerk.

## Funktionen in einem eigenen Prozess ausführen

Alles oben Genannte ist ein einzelner Container, der das gesamte Projekt bedient, was für fast jedes Deployment die richtige Form ist. Wenn eine benutzerdefinierte Funktion nicht mehr mit der Daten-API um die Event-Loop konkurrieren soll – oder unabhängig skalieren, neu starten und fehlschlagen können soll –, können dasselbe Image und dasselbe Bundle als mehrere zusammenarbeitende Prozesse gestartet werden. Siehe [Split processes](/docs/deployment/split-processes/).

## Upgrades

```yaml
image: rebasepro/server:0.20.0
```

Neu starten. Ihr Bundle bleibt unverändert. Innerhalb einer Major-Version des Runtime-Contracts funktioniert ein validiertes Bundle weiterhin – siehe [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).

---

---
sourceHash: c5827fa03f8801fd
title: Self-Hosting
sidebar_label: Self-Hosting
description: Führen Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle aus – Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Rebase selbst zu hosten bedeutet, zwei Dinge auszuführen: eine Postgres-Datenbank und das
offizielle `rebasepro/server`-Image, in das das Bundle Ihres Projekts gemountet wird.

Es muss **kein Anwendungs-Image gebaut werden**. Ihr Projekt wird als Bundle bereitgestellt,
die Runtime ist bereits veröffentlicht, und ein Upgrade von Rebase besteht aus einer Tag-Änderung
statt eines Rebuilds. Siehe [Runtime und Bundles](/docs/architecture/runtime-and-bundles/) für
die Gründe dieser Aufteilung.

## Docker Compose

**Wenn Ihr Projekt aus `rebase init` stammt, verwenden Sie dessen eigene `docker-compose.yml`.**
Sie befindet sich in Ihrem Repository, `init` hat die Secrets, das erste Admin-Konto
und die festgelegte Runtime-Version eingetragen, und es ist genau die Datei, die unter
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended)
beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite beschreibt dasselbe Deployment ohne ein vorgefertigtes Gerüst dahinter –
das Projekt einer anderen Person, ein in der CI erstelltes Bundle oder die beiden Dinge, die in der
generierten Datei bewusst weggelassen wurden: ein Connection-Pooler und getrennte Prozessstrukturen.
Diese Konfiguration liegt im Repository unter
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Verwenden Sie diese Datei, anstatt einen Ausschnitt von dieser Seite zu kopieren: Beide Dateien werden
bei jedem Push über das projekteigene Acceptance-Gate gestartet, sodass keine der beiden von dem abweichen
kann, was tatsächlich funktioniert.

Beide stimmen bei jeder Umgebungsvariable überein, außer beim Datenbank-Passwort – und
das liegt daran, dass jede für ihren eigenen Generator geschrieben wurde: Diese liest
`POSTGRES_PASSWORD`, das von `quickstart.sh` erzeugt wird; die generierte liest
`DATABASE_PASSWORD`, das `rebase init` auch in die `DATABASE_URL` einbettet, die
in Ihre `.env` geschrieben wird.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` ist ein einzelner Befehl, der zwei naheliegende Schritte ausführt und beide ausgibt.
Die ausführliche Variante, falls Sie jeden Schritt selbst kontrollieren möchten:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Sie müssen die Datenbank nicht separat starten – `api` wartet auf ihren
Healthcheck.

### Die sechs benötigten Werte

`quickstart.sh` erzeugt diese Werte für Sie. Um die `.env` manuell zu schreiben:

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

- **`POSTGRES_PASSWORD`** – das Datenbankpasswort. Eine spätere Änderung erfordert
  auch die Änderung im Volume; wählen Sie es also sorgfältig.
- **`JWT_SECRET`** – signiert jede Session. Eine Rotation meldet alle Benutzer ab.
- **`REBASE_SERVICE_KEY`** – die Anmeldeinformation, die Row-Level Security für
  Server-zu-Server-Aufrufe umgeht. Behandeln Sie diesen Schlüssel wie ein Root-Passwort:
  Jeder Dienst, der ihn besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** – die Origins, von denen Ihr Frontend bereitgestellt wird, durch Kommas getrennt.
  Kein Secret und nicht optional: Die Runtime verweigert den Start in der Produktion
  ohne diesen Wert, anstatt Mutmaßungen anzustellen. Denn eine API, die erlaubte Origins
  errät, erlaubt letztlich die falschen.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** – der erste
  Administrator. Eine neue Datenbank enthält keine Benutzer. Außerhalb der Produktion
  lässt die Registrierungsrichtlinie die erste Registrierung zu und befördert sie zum Admin –
  andernfalls wäre eine leere Datenbank eine Sackgasse, da das Einrichten eines Admins
  einen bereits angemeldeten Aufrufer erfordert. Sobald dieser Stack unter einem
  Hostnamen erreichbar ist, wird dieser Komfort zu einer Race Condition, die der Betreiber
  verlieren kann. In der Produktion ist dieses Fenster daher geschlossen und das Konto
  wird stattdessen hier definiert. Die Runtime erstellt es einmalig, solange die Benutzertabelle
  leer ist, und unternimmt bei jedem nachfolgenden Start nichts weiter.

Jedes der drei Secrets muss mindestens 32 Zeichen lang sein, das Admin-Passwort
mindestens 12 Zeichen. Verwenden Sie eine Adresse mit einem Punkt in der Domain: `POST /auth/login`
validiert den Body mit `z.string().email()`, daher würde `admin@localhost` ein Konto
erstellen und danach jeden Anmeldeversuch verweigern. Die Compose-Datei deklariert alle sechs Variablen mit
`${VAR:?…}`, sodass ein fehlender Wert den Stack mit einer entsprechenden Fehlermeldung stoppt,
anstatt ein halb konfiguriertes System zu starten – und die Selbstregistrierung ist standardmäßig deaktiviert
(`DISABLE_SELF_REGISTRATION`, Standard: `true`), sodass keine Konten unbefugt beansprucht werden können.

Melden Sie sich mit diesen Zugangsdaten an und ändern Sie das Passwort: Die Daten liegen im
Klartext in einer Datei auf dem Host.

## Abhängigkeiten

`rebase build` **installiert die Abhängigkeiten Ihres Projekts standardmäßig direkt in das Bundle**,
sodass `dist-bundle` mit `node_modules` und einer `package-lock.json`
neben der `package.json` ausgeliefert wird. Ein so vorbereitetes (vendored) Bundle startet in etwa fünf Sekunden.

Da die Abhängigkeiten bereits enthalten sind, können Sie das Bundle schreibgeschützt (read-only) mounten –
das ist empfehlenswert, da ein kompromittierter Hook dann den Code nicht umschreiben kann,
der nach dem nächsten Neustart ausgeführt wird:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

Mit `rebase build --no-vendor` deaktivieren Sie dieses Verhalten und erstellen ein Bundle, das seine
Abhängigkeiten stattdessen beim ersten Start installiert. Dies dauert 40–60 Sekunden pro Start
und erfordert, dass der Mount beschreibbar ist.

Für ein echtes Deployment empfiehlt es sich, beides in ein Image zu packen, wodurch auch
exakt festgelegt wird, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

## Erstellen des Schemas

**Die Runtime erstellt fehlende Tabellen beim Start automatisch, einschließlich derer Ihrer Collections.**
`REBASE_MIGRATE_ON_BOOT` steht standardmäßig auf `ensure`, was sich über das gesamte
Schema rein additiv verhält: Es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren
Row-Level Security an. Ein erster Start mit einer leeren Datenbank stellt Ihre Collections
sofort und ohne separaten Zwischenschritt bereit.

Was `ensure` ganz bewusst niemals tut, ist das Ändern bereits vorhandener Strukturen. Es
ändert keinen Spaltentyp, löscht weder Tabellen noch Spalten und bearbeitet keine bestehenden
Enum-Werte – denn ein Container-Neustart darf nicht in der Lage sein, ein Schema als
Nebeneffekt eines Deployments umzustrukturieren.

Daher ist die Ausführung von `rebase db push` für die beiden Dinge, die der Startvorgang
unberührt lässt, weiterhin sinnvoll:

```bash
rebase db push
```

- **RLS für Verknüpfungstabellen (Junction-Tables)** bei Many-to-Many-Beziehungen.
- **Alle Änderungen, die nicht rein additiv sind** – eine umbenannte Spalte, ein eingeschränkter
  Typ, ein entferntes Feld.

Führen Sie dies aus einem Repository-Checkout oder einem CI-Job aus, der auf die Datenbank
des Deployments verweist. Der Befehl führt zunächst einen Probelauf (Dry-Run) der Änderung durch,
verweigert destruktive Änderungen ohne explizite Bestätigung und kann vor der Anwendung
ein Backup erstellen. Die Datenbank gibt in der Compose-Datei einen Port frei, damit
dieser Befehl sie vom Host aus erreichen kann. Entfernen Sie dieses Port-Mapping,
sobald das Schema eingerichtet ist, falls die Datenbank von außen nicht erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert ausschließlich `ensure` und `none` – das Image
**verweigert den Start** bei `push`, aus dem oben genannten Grund.

## Dateispeicher

Der Speicher ist **deaktiviert**, sofern kein Bucket konfiguriert ist, und das ist beabsichtigt: Die
alternative Standardeinstellung wäre das Dateisystem des Containers, wodurch jede hochgeladene Datei
beim nächsten Neustart stillschweigend verloren ginge. Uploads werden mit
`501 STORAGE_NOT_CONFIGURED` abgelehnt, bis Sie einen Speicher einrichten.

Setzen Sie für einen Bucket `STORAGE_TYPE=s3` (oder `gcs`) sowie den entsprechenden Bucket-Namen und die Zugangsdaten –
die Compose-Datei listet die Variablen auskommentiert auf.

Für lokalen Festplattenspeicher, der nur dann geeignet ist, wenn der Pfad ein echtes Volume ist,
das den Container überdauert:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` ist an dieser Stelle zwingend erforderlich: In der Produktion wird ein
`local`-Backend standardmäßig verworfen statt registriert, da die Alternative Uploads wären, die
in einem Dateisystem landen, das kurz vor der Zerstörung steht. Über diese Variable bestätigen Sie,
dass der Mount persistent ist.

### Speicher erfordert ein Zugriffskontrollmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime in der Produktion den Start**,
bis das Deployment festlegt, wie Objekte geschützt werden. Speicher unterliegt nicht
der Row-Level Security und seine Keys teilen sich einen einzigen flachen Namespace. Ohne eine Regel
ist das Einzige, was die Dateien zweier Benutzer trennt, die Unvorhersehbarkeit der Keys – was durch
`GET /storage/list?prefix=` zunichtegemacht wird. Jede der folgenden Optionen erfüllt diese Anforderung:

- Ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration Ihres Projekts,
  was die reguläre Lösung ist und standardmäßig in `config/storage.ts` ausgeliefert wird –
  keine Umgebungsvariable kann die Logik „dieser Benutzer darf diesen Key lesen“ abbilden;
- **`STORAGE_PUBLIC_READ=true`** für einen Bucket, der tatsächlich ein öffentliches,
  schreibgeschütztes CDN darstellt;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`** für eine Single-Tenant-Anwendung, bei der
  jedem angemeldeten Konto bezüglich jeder Datei vertraut wird.

Außerhalb der Produktion führt dieselbe Bedingung lediglich zu einer deutlichen Warnung statt zu einer Verweigerung.
Es handelt sich hierbei also um einen Startfehler, der Ihnen erst beim Deployment und nicht auf dem Entwicklungsrechner
begegnet. Das ist Absicht: Der Fehler, den dies verhindert, bliebe sonst unbemerkt.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, wenn Sie TOTP verwenden. Bleibt dieser Wert ungesetzt,
werden gespeicherte Authentifikator-Secrets mit `JWT_SECRET` verschlüsselt – eine Rotation dieses
Schlüssels meldet somit nicht nur alle Benutzer ab, *sondern* macht auch jedes registrierte Gerät unentschlüsselbar.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht. Alles, was Container
ausführen kann, ist somit geeignet. Zwei Dinge müssen überall beachtet werden:

1. Das Bundle muss unter `/bundle` liegen (oder an dem Pfad, auf den `REBASE_BUNDLE` verweist),
   wobei die Abhängigkeiten daneben installiert sein müssen – siehe [Abhängigkeiten](#abhängigkeiten).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime verweigert den
   Start in der Produktion ohne diese Variablen, anstatt Annahmen zu treffen.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.22.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die oben beschriebene abgeleitete Image-Variante, damit das Bundle mit der App ausgeliefert wird,
und führen Sie dann `fly deploy` aus.

### Railway / Render

Verweisen Sie den Dienst auf das abgeleitete Image, setzen Sie die Umgebungsvariablen und legen Sie
den Healthcheck-Pfad auf `/livez` fest.

### Ein einfacher VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` listet die Variablen auf, die eingelesen werden. Unter systemd – die
drei Admin-Zeilen sind neu; unter 0.17.3 wurde stattdessen das erste registrierte Konto
zum Administrator:

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

`NODE_ENV=production` ist keine reine Formalität. Bleibt der Wert ungesetzt, läuft der Prozess
im Entwicklungsmodus: Er spiegelt localhost-Origins wider, stellt die OpenAPI-Spezifikation bereit und
**lässt das First-Admin-Fenster offen** – sodass der erste Fremde, der das
Registrierungsformular findet, Administrator wird. Die beiden `REBASE_ADMIN_*`-Zeilen ersetzen
dieses Fenster; siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin).

Bevorzugen Sie `EnvironmentFile=/etc/rebase.env` mit Dateirechten 0600 gegenüber
`Environment=`-Zeilen für Secrets: Eine Unit-Datei ist für alle lesbar, und
`systemctl show` gibt jeden `Environment=`-Wert aus.

## Connection-Pooling

Die Runtime unterhält einen kleinen, langlebigen Pool und benötigt keinen externen Pooler. Was
einen benötigt, ist alles andere, was mit derselben Datenbank kommuniziert und Verbindungen
nicht dauerhaft halten kann: Serverless-Funktionen, zeitgesteuerte Skripte, BI-Tools oder Queue-Worker,
die auf fünfzig Instanzen skalieren. Der `max_connections`-Wert von Postgres ist ein hartes Limit
im unteren Hunderterbereich und jede Verbindung ist ein eigener *Prozess*. Ein Lambda-Fan-out
schöpft dieses Limit daher lange aus, bevor die Datenbank ausgelastet ist.

Die Compose-Datei enthält einen `pgbouncer`-Dienst für diesen Datenverkehr hinter einem Profil,
damit ein Deployment ohne solche Clients keinen Prozess ausführt, für den es keine Verwendung hat:

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

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert, sodass das
Passwort nicht doppelt hinterlegt werden muss. Der Pooler authentifiziert sich bei Postgres mit
`scram-sha-256`, was von Postgres 18 gespeichert wird – der Standardwert `md5` des Images schlägt beim
*Server*-Login mit `FATAL: server login failed: wrong password type` fehl, was
wie ein falsches Passwort aussieht, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich unter dem
`max_connections`-Wert der Datenbank – die Runtime bedient sich aus demselben Budget.

### Was sich durch Transaction-Pooling ändert

Ein gepoolter Client hält eine Server-Verbindung nur für die Dauer einer Transaktion und
gibt sie danach wieder frei. Das ermöglicht es 500 Clients, sich 20 Verbindungen zu teilen. Drei
Dinge funktionieren über diesen Port nicht mehr, und jedes davon wird von Rebase selbst genutzt –
was genau der Grund ist, warum sich die Runtime direkt verbindet und dieser Port für andere
Aufrufer gedacht ist:

- **`LISTEN`/`NOTIFY`.** Realtime basiert darauf, und ein Listener benötigt eine
  Verbindung, die länger als eine Transaktion besteht. `LISTEN` wird über den Pooler
  zwar *akzeptiert* – er antwortet mit `LISTEN`, aber es wird nie eine Benachrichtigung zugestellt.
- **Session-Status**: `SET` (im Gegensatz zu `SET LOCAL`), anweisungsübergreifende Advisory Locks,
  `WITH HOLD`-Cursor, temporäre Tabellen. Die nächste Transaktion kann auf einer anderen
  Server-Verbindung landen, die von alldem nichts sieht. Beides schlägt auf dieselbe
  tückische Weise fehl: Bei einem einzelnen inaktiven Client ist der Status meist noch vorhanden,
  sodass es beim Testen funktioniert, aber unter der Last zusammenbricht, für die der Pooler
  eigentlich eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Die meisten Treiber können so konfiguriert werden,
  dass sie diese nicht verwenden – `node-postgres` tut dies standardmäßig nicht; `asyncpg` benötigt
  `statement_cache_size=0`.

`SET LOCAL` ist auf die Transaktion beschränkt und funktioniert. Damit wird auch Row-Level Security
konfiguriert – RLS verhält sich über den gepoolten Port also identisch.

Lassen Sie das Profil deaktiviert, wenn nichts außerhalb der Runtime eine Verbindung zu Ihrer Datenbank herstellt.
Ein ungenutzter Port stellt unnötige Angriffsfläche dar.

## Healthchecks

| Pfad | Verwendung |
| --- | --- |
| `/livez` | Liveness. Beantwortet die Frage „Lebt dieser Prozess?“, ohne die Datenbank zu kontaktieren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez` aus. Eine Liveness-Probe auf `/health` startet einen
völlig gesunden Prozess bei einem kurzen Schluckauf der Datenbank neu, was genau dem Zweck
dieser Prüfung widerspricht.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Anfragezähler und Latenz-Histogramme,
aufgeschlüsselt nach API-Bereich (data, auth, storage, functions) und Collection, sowie
Prozess-Gauges. Ohne Token ist der Endpunkt für jeden lesbar, der den Port erreichen kann.
Setzen Sie daher einen Token, sofern sich der Dienst nicht in einem privaten Netzwerk befindet.

## Funktionen in einem eigenen Prozess ausführen

Alles oben Beschriebene läuft in einem einzigen Container, der das gesamte Projekt bedient –
dies ist die passende Struktur für fast jedes Deployment. Wenn eine benutzerdefinierte Funktion
jedoch nicht mehr mit der Daten-API um die Event-Loop konkurrieren soll – oder unabhängig
skalieren, neu starten und fehlschlagen können soll –, können dasselbe Image und dasselbe Bundle
als mehrere kooperierende Prozesse gestartet werden. Siehe [Getrennte Prozesse](/docs/deployment/split-processes/).

## Aktualisierung

```yaml
image: rebasepro/server:0.22.0
```

Starten Sie neu. Ihr Bundle bleibt unverändert. Innerhalb einer Hauptversion (Major) des Runtime-Vertrags
funktioniert ein einmal validiertes Bundle weiterhin – siehe
[Kompatibilität](/docs/architecture/runtime-and-bundles/#compatibility).

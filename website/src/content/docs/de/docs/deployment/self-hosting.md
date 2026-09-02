---
title: Self-Hosting
sidebar_label: Self-Hosting
description: Führen Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle aus — Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Self-Hosting von Rebase bedeutet, zwei Dinge auszuführen: eine Postgres-Datenbank und das offizielle Image `rebasepro/server`, in das das Bundle Ihres Projekts gemountet ist.

Es gibt **kein Anwendungs-Image zu erstellen**. Ihr Projekt wird als Bundle bereitgestellt, die Runtime ist veröffentlicht, und ein Upgrade von Rebase ist lediglich eine Tag-Änderung statt eines Rebuilds. Siehe [Runtime und Bundles](/docs/architecture/runtime-and-bundles/) für die Gründe dieser Aufteilung.

## Docker Compose

Die Compose-Datei liegt im Repository, unter
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Verwenden Sie diese, statt einen Ausschnitt aus dieser Seite zu kopieren: Sie ist
die Datei, die die Acceptance-Gate des Projekts bei jedem Push startet, und kann
deshalb nicht von dem abweichen, was tatsächlich funktioniert.

```bash
rebase build                    # erzeugt ./dist-bundle
./infra/docker/quickstart.sh    # schreibt infra/docker/.env, falls nicht vorhanden, und startet
```

`quickstart.sh` ist ein Befehl, der zwei naheliegende Dinge tut und beide
ausgibt. Die Langform, wenn Sie jeden Schritt selbst kontrollieren möchten:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Die Datenbank muss nicht separat gestartet werden — `api` wartet auf deren
Healthcheck.

### Die vier benötigten Werte

`quickstart.sh` erzeugt sie für Sie. Um die `.env` selbst zu schreiben:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
EOF
```

Drei Geheimnisse und eine Tatsache:

- **`POSTGRES_PASSWORD`** — das Datenbankpasswort. Es später zu ändern bedeutet,
  es auch im Volume zu ändern; wählen Sie es einmal.
- **`JWT_SECRET`** — signiert jede Sitzung. Eine Rotation meldet alle ab.
- **`REBASE_SERVICE_KEY`** — die Zugangsdaten, die Row-Level Security für
  Server-zu-Server-Aufrufe umgehen. Behandeln Sie sie wie ein Root-Passwort: wer
  sie besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** — die Origins, von denen Ihr Frontend ausgeliefert wird,
  kommagetrennt. Kein Geheimnis, aber auch nicht optional: die Runtime startet in
  Produktion lieber gar nicht, als zu raten — eine API, die ihre erlaubten
  Origins errät, erlaubt irgendwann den falschen.

Jedes der drei Geheimnisse muss mindestens 32 Zeichen lang sein. Die
Compose-Datei deklariert sie mit `${VAR:?…}`, sodass ein fehlender Wert den Stack
mit einer Meldung stoppt, die ihn benennt, statt etwas halb Konfiguriertes zu
starten.

## Abhängigkeiten

`rebase build` **installiert die Abhängigkeiten Ihres Projekts standardmäßig in
das Bundle**, sodass `dist-bundle` bereits mit einem `node_modules` und einer
`package-lock.json` neben der `package.json` ankommt. Ein solches Bundle startet
in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt einbinden —
was sich lohnt, denn ein kompromittierter Hook kann dann nicht den Code
überschreiben, der nach dem nächsten Neustart läuft:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` verzichtet darauf und erzeugt ein Bundle, das seine
Abhängigkeiten beim ersten Start installiert — das dauert 40–60 Sekunden pro
Start und erfordert ein beschreibbares Mount.

Für ein echtes Deployment ist es besser, beides in ein Image zu backen; das
fixiert zugleich genau das, was läuft:

```dockerfile
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

## Erstellen des Schemas

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich der Ihrer
Collections.** `REBASE_MIGRATE_ON_BOOT` steht standardmäßig auf `ensure`, was
über das gesamte Schema hinweg additiv ist: fehlende Tabellen, Spalten und
Enum-Typen werden angelegt und deren Row-Level Security angewendet. Ein erster
Start gegen eine leere Datenbank liefert Ihre Collections aus, ohne separaten
Schritt.

Was `ensure` bewusst niemals tut, ist Bestehendes zu ändern. Es ändert keinen
Spaltentyp, löscht keine Tabelle und keine Spalte und bearbeitet keine
vorhandenen Enum-Labels — denn ein Container-Neustart darf ein Schema nicht als
Nebenwirkung eines Deployments umformen.

`rebase db push` lohnt sich daher weiterhin, für die zwei Dinge, die der Start
auslässt:

```bash
rebase db push
```

- **RLS auf Junction-Tabellen** für Many-to-Many-Relationen.
- **Jede nicht rein additive Änderung** — eine umbenannte Spalte, ein verengter
  Typ, ein entferntes Feld.

Führen Sie es aus einem Checkout oder einem CI-Job aus, gerichtet auf die
Datenbank des Deployments. Es macht zuerst einen Dry-Run, verweigert destruktive
Änderungen ohne ausdrückliche Bestätigung und kann vorher ein Backup anlegen. Die
Datenbank veröffentlicht in der Compose-Datei einen Port, damit dies vom Host
erreichbar ist; entfernen Sie dieses Mapping, sobald das Schema steht, falls die
Datenbank von außen nicht erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert `ensure` und `none` und sonst nichts — das
Image **verweigert den Start** bei `push`, aus dem oben genannten Grund.

## Dateispeicher

Speicher ist **aus**, solange kein Bucket konfiguriert ist, und das ist Absicht:
die Alternative wäre das Container-Dateisystem, das jede hochgeladene Datei beim
nächsten Neustart stillschweigend verliert. Uploads werden mit
`501 STORAGE_NOT_CONFIGURED` abgelehnt, bis Sie einen einrichten.

Für einen Bucket setzen Sie `STORAGE_TYPE=s3` (oder `gcs`) plus Bucket und
Zugangsdaten — die Compose-Datei listet die Variablen auskommentiert auf.

Für lokalen Speicher, was nur angemessen ist, wenn der Pfad ein echtes Volume
ist, das den Container überdauert:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
    volumes:
      - uploads:/data/uploads
```

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht, sodass alles funktioniert, was Container ausführen kann. Zwei Dinge sollten überall beachtet werden:

1. Das Bundle muss unter `/bundle` (oder wohin `REBASE_BUNDLE` zeigt) vorhanden sein, mit den daneben installierten Abhängigkeiten — siehe [Abhängigkeiten](#abhängigkeiten).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime verweigert den Start in der Produktion ohne diese Variablen, anstatt Mutmaßungen anzustellen.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.13.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die Form des abgeleiteten Images oben, damit das Bundle mit der App ausgeliefert wird, und führen Sie dann `fly deploy` aus.

### Railway / Render

Richten Sie den Dienst auf das abgeleitete Image aus, setzen Sie die Umgebungsvariablen und legen Sie den Pfad für den Health Check auf `/livez` fest.

### Ein einfacher VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

Führen Sie es unter systemd aus, mit `Environment=`-Zeilen für die oben genannten Variablen.

## Health Checks

| Pfad | Verwendungszweck |
| --- | --- |
| `/livez` | Liveness. Beantwortet "ist dieser Prozess aktiv", ohne die Datenbank zu berühren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez` aus. Eine Liveness-Probe auf `/health` startet einen vollkommen gesunden Prozess während eines kurzen Datenbank-Hickups neu, was genau das Gegenteil von ihrem Zweck ist.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Anzahl der Anfragen und Latenz-Histogramme, aufgeschlüsselt nach API-Oberfläche (Data, Auth, Storage, Functions) und Collection, sowie Prozess-Gauges. Ohne Token ist der Endpunkt für jeden lesbar, der den Port erreichen kann. Setzen Sie daher ein Token, es sei denn, er befindet sich in einem privaten Netzwerk.

## Functions in einem eigenen Prozess ausführen

Alles oben ist ein Container, der das ganze Projekt bedient — die richtige Form
für fast jedes Deployment. Wenn eine Custom Function aufhören soll, mit der
Daten-API um den Event-Loop zu konkurrieren, oder eigenständig skalieren, neu
starten und ausfallen soll, lassen sich dasselbe Image und dasselbe Bundle als
mehrere zusammenarbeitende Prozesse starten. Siehe
[Getrennte Prozesse](/docs/deployment/split-processes/).

## Aktualisieren

```yaml
image: rebasepro/server:0.13.0
```

Starten Sie neu. Ihr Bundle bleibt unverändert. Innerhalb einer Hauptversion (Major) des Runtime-Vertrags funktioniert ein validiertes Bundle weiterhin — siehe [Kompatibilität](/docs/architecture/runtime-and-bundles/#compatibility).

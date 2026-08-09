---
title: Self-Hosting
sidebar_label: Self-Hosting
description: Führen Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle aus — Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Self-Hosting von Rebase bedeutet, zwei Dinge auszuführen: eine Postgres-Datenbank und das offizielle Image `rebasepro/server`, in das das Bundle Ihres Projekts gemountet ist.

Es gibt **kein Anwendungs-Image zu erstellen**. Ihr Projekt wird als Bundle bereitgestellt, die Runtime ist veröffentlicht, und ein Upgrade von Rebase ist lediglich eine Tag-Änderung statt eines Rebuilds. Siehe [Runtime und Bundles](/docs/architecture/runtime-and-bundles/) für die Gründe dieser Aufteilung.

## Docker Compose

```bash
rebase build                     # produces ./dist-bundle
docker compose up -d db          # start Postgres
rebase db push                   # create the collection tables, once
docker compose up                # start the runtime
```

Ein minimales `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: rebase
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase -d rebase"]
      interval: 5s
      retries: 12

  api:
    image: rebasepro/server:latest
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      # Writable: the container installs the bundle's declared dependencies into
      # it on first start. See "Dependencies" below for the read-only variant.
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

volumes:
  db-data:
```

## Abhängigkeiten

`rebase build` schreibt eine `package.json` neben Ihr Bundle, die die von Ihrem Projekt deklarierten Abhängigkeiten auflistet. Der Container installiert diese beim ersten Start, weshalb der obige Mount beschreibbar ist.

Um stattdessen schreibgeschützt (read-only) zu mounten — was sich lohnt, da ein kompromittierter Hook dann den Code, der nach dem nächsten Neustart ausgeführt wird, nicht überschreiben kann —, installieren Sie diese zuerst:

```bash
npm install --omit=dev --prefix dist-bundle
```

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

Für ein echtes Deployment sollten Sie es vorziehen, beides in ein Image einzubetten, was auch genau festlegt, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.13.0
COPY dist-bundle /bundle
```

## Erstellen des Schemas

Die Runtime erstellt beim Booten ihre eigenen **Auth**-Tabellen. **Collection-Tabellen sind ein separater, bewusster Schritt**, und das Runtime-Image führt diesen nicht aus — ein Container-Neustart darf nicht in der Lage sein, als Nebeneffekt eines Deployments ein Schema zu ändern.

```bash
rebase db push
```

Führen Sie dies aus einem Checkout oder einem CI-Job aus, der auf die Datenbank des Deployments gerichtet ist. Es führt die Änderung zuerst als Testlauf (Dry-Run) aus, verweigert destruktive Änderungen ohne explizite Bestätigung und kann vor dem Anwenden ein Backup erstellen.

`REBASE_MIGRATE_ON_BOOT` akzeptiert `ensure` (der Standardwert — nur Auth-Tabellen) und `none`.

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

## Aktualisieren

```yaml
image: rebasepro/server:0.13.0
```

Starten Sie neu. Ihr Bundle bleibt unverändert. Innerhalb einer Hauptversion (Major) des Runtime-Vertrags funktioniert ein validiertes Bundle weiterhin — siehe [Kompatibilität](/docs/architecture/runtime-and-bundles/#compatibility).

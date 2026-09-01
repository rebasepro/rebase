---
title: Kubernetes
sidebar_label: Kubernetes
description: Stellen Sie Rebase mit dem offiziellen Helm-Chart auf einem Kubernetes-Cluster bereit – ein Deployment oder mehrere, ein Migrations-Job für das Schema und statische Apps auf demselben Host.
---

## Übersicht

Das offizielle Chart ist das Kubernetes-Pendant zum Docker-Compose-Self-Hosting-Setup. Dieselbe Idee, dasselbe Image, dasselbe Bundle: **Die Runtime ist das Image, Ihr Projekt ist das Bundle und ein Upgrade von Rebase ist eine Änderung des Tags.**

Es wird als OCI-Artefakt neben dem Runtime-Image veröffentlicht, und beide tragen dieselbe Version – das Chart, das die Runtime `0.17.3` bereitstellt, *ist* das Chart `0.17.3`, sodass es nur eine Versionsnummer zu verfolgen gilt. Ohne `--version` erhalten Sie die neueste Version; fixieren Sie sie für ein echtes Deployment, genau wie Sie `image.tag` fixieren würden:

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

Das Chart stellt **nur die Runtime** bereit. Es stellt kein Postgres bereit – verwenden Sie CloudNativePG, eine verwaltete Datenbank oder Ihr eigenes StatefulSet und verweisen Sie mit `config.databaseUrl` darauf. Ein Chart, das auch Ihre Datenbank verwalten würde, wäre auch für Ihre Backups und Ihr Failover verantwortlich, was ein viel größeres Versprechen ist als „die App ausführen“.

> **Reifegrad.** Das Chart wird in der CI gegen Helm v4.2.4 gelintet und gerendert – jede dokumentierte Topologie und ein Fall für jede unten aufgeführte Verweigerung. Es wurde **noch nicht an einem Live-Cluster getestet**. Betrachten Sie es als gut getesteten Ausgangspunkt und nicht als praxiserprobten Standard, und lesen Sie [Self-Hosting](/docs/deployment/self-hosting) für den Pfad, der es ist.

Um stattdessen aus einem Checkout zu arbeiten – einem modifizierten Chart oder einer Air-Gapped-Installation – akzeptiert `helm install rebase ./charts/rebase` dieselben Werte.

## Ihr Projekt in den Pod bringen

| `bundle.mode` | Wie | Wann |
|---|---|---|
| `image` (Standard) | Bauen Sie `FROM rebasepro/server` mit `COPY dist-bundle /bundle` und setzen Sie dann `image.repository` | Fast immer. Ein Artefakt, unveränderlich, keine Runtime-Abhängigkeit von der Erreichbarkeit einer URL |
| `url` | Standard-Image; die Runtime lädt bei jedem Pod-Start einen Tarball herunter | Eine Control Plane, die Bundles Out-of-Band ausliefert |

## Ein Prozess oder mehrere

Der Standard ist ein einzelnes Deployment, das alles bedient – dieselbe Struktur, die auch die Compose-Datei ausführt. Das Aufteilen erfordert nur einen Wert:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Das ergibt eine `api`-Ebene, eine `functions`-Ebene und einen `worker`, alle aus demselben Image und demselben Bundle. Siehe [Split Processes](/docs/deployment/split-processes) für Details dazu, was jede Rolle tut und warum Sie sie trennen sollten.

Was das Chart gegenüber der manuellen Konfiguration hinzufügt, ist, dass es **die Einstellungen ableitet, deren Fehlerfall Stille ist**, basierend auf den Werten, die Sie bereits angegeben haben:

- `REBASE_ROLE` pro Einheit
- `REBASE_MIGRATE_ON_BOOT=none` überall, da der Migrations-Job das Schema besitzt
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` auf der API, sobald ein Worker existiert
- `TRUSTED_PROXY_HOPS` auf der Functions-Einheit
- `REBASE_RATE_LIMIT_STORE=sql`, sobald ein zweiter Prozess HTTP bedient

Ein falsches `REBASE_ROLE` bedient kein HTTP, während `/health` weiterhin antwortet, sodass Readiness-Checks erfolgreich sind und jede Anfrage mit einem 404 fehlschlägt. Ein fehlendes `REBASE_MIGRATE_ON_BOOT` führt zu einem CrashLoop, dessen Ursache in einem Protokoll steht, das niemand beobachtet. Das Chart setzt alle diese Werte, und `config.env` kann sie nicht überschreiben.

### Trennung von Cron und Job-Ausführung

Zwei Worker mit entgegengesetzter Zuständigkeit – keine neue Rolle und kein Code:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## Das Admin-Panel und jedes andere Frontend

Eine statische App ist dasselbe Runtime-Image, das ein `kind: static`-Bundle startet. Dieser Pfad bricht ab, bevor die Runtime `DATABASE_URL` oder `JWT_SECRET` liest, sodass diese Pods **überhaupt keine Secrets** enthalten.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

Der Ingress leitet `/admin` dorthin und `/` an die API weiter, und zwar auf **demselben Host**. Das ist Absicht: Derselbe Origin bedeutet, dass Cookie-Authentifizierung und CORS genau so bleiben, wie sie waren, und die Trennung eine interne Topologie-Entscheidung bleibt, anstatt die öffentliche Oberfläche Ihres Produkts zu verändern. Der Preis dafür ist, dass die Assets für diesen Pfad *gebaut* werden müssen, was die Runtime beim Start überprüft.

Das Deployment des Admin-Panels ist dann lediglich die Aktualisierung eines Image-Tags in einem Deployment. Das Backend startet dabei nicht neu.

## Schema

`migrationJob.enabled` (der Standard) führt einen `pre-install,pre-upgrade`-Job aus, der die Bereitstellung vornimmt und sich beendet, und jeder Pod startet mit `REBASE_MIGRATE_ON_BOOT=none`. Nichts auf dem Request-Pfad besitzt DDL, was die sauberste Lösung für „genau ein Prozess provisioniert das Schema“ ist – es ist keine Regel mehr, an die man sich erinnern muss.

`mode: ensure` erstellt, was fehlt. `mode: push` wendet auch Schema-Änderungen an Collections an und **ist destruktiv**; es ist nicht der Standard.

## Was das Chart verweigert zu rendern

Jede dieser Konfigurationen erzeugt zur Laufzeit keinen Fehler – das Deployment startet und irgendetwas hört stillschweigend auf zu funktionieren. Stattdessen schlägt `helm install` fehl und benennt den zu ändernden Wert:

- mehr als ein HTTP-Prozess mit `sharedState.rateLimitStore=memory`
- `functions.enabled` oder `worker.enabled`, während `split=false` ist
- zwei statische Apps, die denselben Pfad beanspruchen, oder eine, die einen Pfad unter `/api` beansprucht
- `bundle.mode=image`, während `image.repository` noch das Standard-Runtime-Image ist
- `ingress.enabled` ohne Host oder `bundle.mode=url` ohne URL
- ein unbekannter `migrationJob.mode` oder `sharedState.rateLimitStore`

## Was das Chart nicht für Sie tun kann

**Realtime-Broadcast und Presence über mehrere Replikate hinweg.** Der Standard-Channel-Bus der Runtime liegt im Arbeitsspeicher (in-memory). Bei mehr als einem API-Replikat sieht ein Abonnent auf einem Pod also keine Broadcasts, die auf einem anderen veröffentlicht werden. Die Lösung liegt in der Konfiguration Ihres Projekts, nicht im Chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Setzen Sie `sharedState.channelBusConfigured: true`, um zu bestätigen, dass Sie dies getan haben – das Chart nutzt dies nur, um zu entscheiden, ob eine Warnung ausgegeben werden soll. Reguläre Collection-Abonnements sind davon nicht betroffen; diese laufen über Postgres CDC.

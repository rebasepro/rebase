---
sourceHash: 51abd249a5639803
title: Kubernetes
sidebar_label: Kubernetes
description: Bereitstellung von Rebase auf einem Kubernetes-Cluster mit dem offiziellen Helm-Chart – ein Deployment oder mehrere, ein Migrations-Job, der das Schema verwaltet, und statische Apps auf demselben Host.
---

## Übersicht

Das offizielle Chart ist das Kubernetes-Pendant zum Docker-Compose-Self-Hosting-Setup. Dieselbe Idee, dasselbe Image, dasselbe Bundle: **Die Runtime ist das Image, Ihr Projekt ist das Bundle und ein Upgrade von Rebase ist eine Tag-Änderung.**

Es wird als OCI-Artefakt neben dem Runtime-Image veröffentlicht, und beide tragen dieselbe Version – das Chart, das die Runtime `0.17.3` bereitstellt, *ist* Chart `0.17.3`, sodass es nur eine Versionsnummer gibt, die Sie im Blick behalten müssen. Ohne `--version` erhalten Sie die neueste Version; pinnen Sie sie für ein echtes Deployment fest, genauso wie Sie `image.tag` festlegen würden:

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set config.adminEmail=you@example.com \
  --set config.adminPassword="$(openssl rand -hex 16)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

Das Chart wird standardmäßig mit deaktivierter Selbstregistrierung ausgeliefert. Daher muss bei einem Release das Konto angegeben werden, mit dem sich der Operator anmeldet – andernfalls startet es mit einer leeren Benutzertabelle und ohne Möglichkeit, den ersten authentifizierten Aufrufer zu erstellen. `config.adminPassword` muss mindestens 12 Zeichen lang sein, und `config.adminEmail` erfordert einen Punkt in der Domain: Die Login-Route parst ihren Body mit `z.string().email()`, sodass `admin@localhost` ein Konto wäre, an dem sich niemand anmelden könnte, und die Runtime sich weigert, dieses zu seeden. Beides sind Verweigerungen zur Render-Zeit statt böser Überraschungen zur Laufzeit – siehe [Was das Chart verweigert zu rendern](#was-das-chart-verweigert-zu-rendern). Melden Sie sich an und ändern Sie das Passwort; diese Werte landen in einem Secret.

Verwalten Sie diese stattdessen Out-of-Band, indem Sie mit `existingSecret` auf ein Secret verweisen, das `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` zusammen mit `DATABASE_URL` und dem Rest enthält.

Das Chart stellt **ausschließlich die Runtime** bereit. Es stellt kein Postgres bereit – verwenden Sie CloudNativePG, eine Managed Database oder Ihr eigenes StatefulSet und verweisen Sie mit `config.databaseUrl` darauf. Ein Chart, das auch Ihre Datenbank verwalten würde, wäre auch für Ihre Backups und Ihr Failover verantwortlich – was ein weitaus größeres Versprechen ist als „die App auszuführen“.

> **Reifegrad.** Zwei separate Aspekte werden in der CI geprüft, ein dritter nicht. Das Chart wird mit Helm v4.2.4 gelintet und gerendert – jede auf dieser Seite dokumentierte Topologie, einschließlich des obigen Installationsbefehls sowie Tests für alle unten aufgeführten Ablehnungsfälle. Das vom Chart bereitgestellte Runtime-Image wird gebaut und gegen ein echtes Postgres gestartet, und zwar für beide Arten, wie ein Bundle bereitgestellt werden kann. Was **nie ausgeführt wurde, ist das Chart gegen einen Live-Cluster**: Nichts hat diese Manifeste bisher geschedult, daher sind die Probes, die Reihenfolge des Pre-Install-Migrations-Jobs und das Ingress als YAML syntaktisch korrekt, aber als echtes Deployment unerprobt. Betrachten Sie es als gut getesteten Ausgangspunkt und nicht als praxiserprobten Standard, und lesen Sie [Self-Hosting](/docs/deployment/self-hosting) für den bewährten Weg.

Um stattdessen aus einem Checkout heraus zu arbeiten – für ein modifiziertes Chart oder eine Air-Gapped-Installation – akzeptiert `helm install rebase ./infra/charts/rebase` dieselben Values.

## Das Projekt in den Pod bringen

| `bundle.mode` | Wie | Wann |
|---|---|---|
| `image` (Standard) | Bauen Sie `FROM rebasepro/server` mit `COPY dist-bundle /bundle` und setzen Sie dann `image.repository` | Fast immer. Ein Artefakt, unveränderlich, keine Laufzeitabhängigkeit von der ständigen Erreichbarkeit einer URL |
| `url` | Standard-Image; die Runtime lädt bei jedem Pod-Start einen Tarball herunter | Eine Control-Plane, die Bundles Out-of-Band ausliefert |

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

Das liefert Ihnen ein `api`-Tier, ein `functions`-Tier und einen `worker`, alle aus demselben Image und demselben Bundle. Siehe [Split Processes](/docs/deployment/split-processes) für Details dazu, was jede Rolle tut und warum man sie trennen sollte.

Der Vorteil des Charts gegenüber einer manuellen Konfiguration ist, dass es **die Einstellungen, deren Fehlermodus stilles Versagen ist, automatisch aus den bereits übergebenen Werten ableitet**:

- `REBASE_ROLE` pro Einheit – `all` auf der API, wenn es keine Functions-Einheit gibt, damit sie Ihre Functions weiterhin ausführt
- `REBASE_MIGRATE_ON_BOOT=none` überall, da der Migrations-Job das Schema verwaltet
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` auf der API, sobald ein Worker existiert
- `TRUSTED_PROXY_HOPS` auf der Functions-Einheit
- `REBASE_RATE_LIMIT_STORE=sql`, sobald ein zweiter Prozess HTTP bedient

Ein falsches `REBASE_ROLE` liefert kein HTTP aus, während `/health` weiterhin antwortet – der Readiness-Check ist also erfolgreich, aber jede Anfrage schlägt mit 404 fehl. Ein fehlendes `REBASE_MIGRATE_ON_BOOT` führt zu einem CrashLoop, dessen Ursache in einem Logfile steht, das niemand beobachtet. Das Chart setzt all diese Werte automatisch, und `config.env` kann sie nicht überschreiben.

### Trennung von Cron und Job-Ausführung

Zwei Worker mit gegensätzlicher Zuständigkeit – keine neue Rolle und kein zusätzlicher Code:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## Das Admin-Panel und jedes andere Frontend

Eine statische App ist dasselbe Runtime-Image, das ein `kind: static`-Bundle bootet. Dieser Pfad bricht vorzeitig ab, bevor die Runtime `DATABASE_URL` oder `JWT_SECRET` liest, sodass diese Pods **überhaupt keine Secrets** enthalten.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

Das Ingress leitet `/admin` dorthin und `/` an die API weiter, auf **demselben Host**. Das ist beabsichtigt: Same-Origin bedeutet, dass Cookie-Authentifizierung und CORS exakt wie gewohnt funktionieren und die Aufteilung eine interne Topologie-Entscheidung bleibt, statt die öffentliche Oberfläche Ihres Produkts zu verändern. Der Preis dafür ist, dass die Assets für diesen Pfad *gebaut* werden müssen, was die Runtime beim Booten prüft.

Die Bereitstellung des Admins ist dann lediglich eine Erhöhung des Image-Tags auf einem einzigen Deployment. Das Backend startet dabei nicht neu.

## Schema

`migrationJob.enabled` (Standard) führt einen `pre-install,pre-upgrade`-Job aus, der die Bereitstellung vornimmt und sich beendet; jeder Pod startet mit `REBASE_MIGRATE_ON_BOOT=none`. Nichts im Request-Pfad besitzt das Tabellenschema, was die sauberste Lösung für „genau ein Prozess provisioniert das Schema“ darstellt – es ist keine Regel mehr, an die man aktiv denken muss. Die Pods halten beim Booten weiterhin die Framework-eigenen Tabellen (Auth, API-Keys, Jobs, Cron) aktuell; `provision: false` unterbindet auch das, rendert keinen Job und überlässt das Schema einem [Bereitstellungslauf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database) im Rahmen Ihres eigenen Change-Prozesses.

`mode: ensure` erstellt additiv, was fehlt, und ist der einzige Modus, den das Runtime-Image akzeptiert. `push` wird beim Booten verweigert: Das Anwenden von Änderungen am Tabellenschema ist destruktiv, und ein `rebase db push` aus einem Checkout oder der CI simuliert die Änderung vorab (Dry-Run), verweigert destruktive Änderungen ohne Bestätigung und kann vorher ein Backup erstellen – all das kann ein unbeaufsichtigt startender Pod nicht leisten.

## Was das Chart verweigert zu rendern

Jeder dieser Fälle ist eine Konfiguration, die zur Laufzeit keinen Fehler erzeugt – das Deployment startet, aber im Stillen funktioniert etwas nicht wie vorgesehen. Stattdessen schlägt `helm install` fehl und nennt den anzupassenden Wert:

- mehr als ein HTTP-Prozess mit `sharedState.rateLimitStore=memory`
- `functions.enabled` oder `worker.enabled`, während `split=false` gesetzt ist
- zwei statische Apps, die denselben Pfad beanspruchen, oder eine, die einen Pfad unter `/api` beansprucht
- `bundle.mode=image`, während `image.repository` noch das Standard-Runtime-Image ist
- `ingress.enabled` ohne Host oder `bundle.mode=url` ohne URL
- ein nicht erkannter Wert für `migrationJob.mode` oder `sharedState.rateLimitStore`
- kein `config.adminEmail` bei deaktivierter Selbstregistrierung – ein Release, an dem sich niemand anmelden kann. Setzen Sie die beiden Admin-Werte oder `config.allowSelfRegistration=true` mit dem Wissen, dass die erste Person, die das Registrierungsformular aufruft, Administrator wird
- ein `config.adminPassword` mit weniger als 12 Zeichen oder ein `config.adminEmail`, dessen Domain keinen Punkt enthält. Die Runtime weigert sich beim Booten, eines von beiden zu seeden, was zum selben ausgesperrten Release führt

## Was das Chart nicht für Sie tun kann

**Echtzeit-Broadcast und Presence über mehrere Replikate hinweg.** Der Standard-Channel-Bus der Runtime liegt im Arbeitsspeicher (In-Memory). Bei mehr als einem API-Replikat sieht ein Abonnent auf einem Pod daher keinen Broadcast, der auf einem anderen veröffentlicht wurde. Die Lösung liegt in der Konfiguration Ihres Projekts, nicht im Chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Setzen Sie `sharedState.channelBusConfigured: true`, um zu bestätigen, dass Sie dies konfiguriert haben – das Chart verwendet diesen Wert nur, um zu entscheiden, ob eine Warnung ausgegeben werden soll. Normale Tabellen-Abonnements sind davon unberührt; diese laufen über Postgres CDC.

Alles Weitere, was ein Prozess lokal für sich behält – lokale Dateien, fortsetzbare Uploads (Resumable Uploads), der Cache für Bildtransformationen, die Log-Ansicht von Studio –, ist zusammen mit der jeweiligen Einstellung zur gemeinsamen Nutzung unter [Ausführen mehrerer Instanzen](/docs/deployment/multiple-instances/) aufgeführt.

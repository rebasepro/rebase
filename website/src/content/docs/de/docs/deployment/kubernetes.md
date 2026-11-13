---
sourceHash: 00bc3369d6f3db69
title: Kubernetes
sidebar_label: Kubernetes
description: Deployen Sie Rebase auf einem Kubernetes-Cluster mit dem offiziellen Helm-Chart – ein Deployment oder mehrere, ein Migrations-Job, der das Schema verwaltet, und statische Apps auf demselben Host.
---

## Übersicht

Das offizielle Chart ist das Kubernetes-Pendant zum Docker-Compose-Setup für
Self-Hosting. Gleiche Idee, gleiches Image, gleiches Bundle: **Die Runtime ist
das Image, Ihr Projekt ist das Bundle und ein Upgrade von Rebase ist lediglich
eine Änderung des Tags.**

Es wird als OCI-Artefakt neben dem Runtime-Image veröffentlicht, und beide
tragen dieselbe Version – das Chart, das die Runtime `0.17.3` deployt, *ist*
Chart `0.17.3`, sodass es nur eine Versionsnummer zu verfolgen gibt. Ohne
`--version` erhalten Sie die neueste Version; pinnen Sie diese für ein
produktives Deployment genauso fest, wie Sie `image.tag` pinnen würden:

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

Das Chart wird mit deaktivierter Selbstregistrierung ausgeliefert, sodass ein
Release das Konto benennen muss, mit dem sich der Betreiber anmeldet – andernfalls
startet es mit einer leeren Benutzertabelle und ohne Möglichkeit, den ersten
authentifizierten Aufrufer zu erzeugen. `config.adminPassword` muss mindestens
12 Zeichen lang sein, und `config.adminEmail` benötigt einen Punkt in der
Domain: Die Login-Route parst ihren Body mit `z.string().email()`, sodass
`admin@localhost` ein Konto wäre, an dem sich niemand anmelden kann, und die
Runtime die Initialisierung verweigert. Beides sind Verweigerungen zur
Render-Zeit statt böser Überraschungen zur Laufzeit – siehe [was das Chart nicht
rendert](#was-das-chart-nicht-rendert). Melden Sie sich an und ändern Sie
das Passwort; diese Werte landen in einem Secret.

Verwalten Sie diese stattdessen Out-of-Band, indem Sie `existingSecret` auf ein
Secret verweisen lassen, das `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD`
neben `DATABASE_URL` und den übrigen Werten enthält.

Das Chart deployt **ausschließlich die Runtime**. Es deployt kein Postgres –
verwenden Sie CloudNativePG, eine Managed Database oder Ihr eigenes StatefulSet
und lassen Sie `config.databaseUrl` darauf verweisen. Ein Chart, das auch Ihre
Datenbank verwalten würde, wäre auch für Ihre Backups und Ihr Failover zuständig,
was ein weitaus größeres Versprechen ist als „die App ausführen“.

> **Reifegrad.** Zwei separate Dinge werden in der CI geprüft, ein drittes nicht.
> Das Chart wird gegen Helm v4.2.4 gelintet und gerendert – jede auf dieser Seite
> dokumentierte Topologie, einschließlich des obigen Installationsbefehls, sowie
> Testfälle für jede unten aufgeführte Verweigerung. Das Runtime-Image, das das
> Chart deployt, wird gebaut und gegen ein echtes Postgres gestartet, und zwar
> für beide Arten, wie ein Bundle bereitgestellt werden kann. Was **noch nie
> ausgeführt wurde, ist das Chart auf einem Live-Cluster**: Nichts hat diese
> Manifeste bisher gescheduled, daher sind die Probes, die Reihenfolge des
> Pre-Install-Migrations-Jobs und das Ingress als YAML korrekt, aber als
> tatsächliches Deployment unerprobt. Betrachten Sie es als gut getesteten
> Ausgangspunkt und nicht als praxiserprobten Produktionsstandard, und lesen Sie
> [Self-Hosting](/docs/deployment/self-hosting) für den bewährten Weg.

Um stattdessen aus einem lokalen Checkout zu arbeiten – für ein modifiziertes
Chart oder eine Air-Gapped-Installation – akzeptiert `helm install rebase
./infra/charts/rebase` dieselben Werte.

## Ihr Projekt in den Pod bringen

| `bundle.mode` | Wie | Wann |
|---|---|---|
| `image` (Standard) | `FROM rebasepro/server` mit `COPY dist-bundle /bundle` bauen, dann `image.repository` festlegen | Fast immer. Ein einziges Artefakt, unveränderlich (immutable), keine Laufzeitabhängigkeit von der Erreichbarkeit einer URL |
| `url` | Standard-Image; die Runtime lädt bei jedem Pod-Start einen Tarball herunter | Eine Control Plane, die Bundles Out-of-Band bereitstellt |

## Ein Prozess oder mehrere

Der Standard ist ein einzelnes Deployment, das alles bereitstellt – dieselbe
Struktur, die auch die Compose-Datei ausführt. Das Aufteilen erfordert nur einen
Wert:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Das ergibt eine `api`-Ebene, eine `functions`-Ebene und einen `worker`, alle aus
demselben Image und demselben Bundle. Siehe [Split Processes](/docs/deployment/split-processes)
für Details dazu, was jede Rolle tut und warum man sie trennen sollte.

Der Vorteil des Charts gegenüber einer manuellen Konfiguration ist, dass es **die
Einstellungen, deren Fehlermodus stilles Versagen ist**, automatisch aus den
Werten ableitet, die Sie bereits angegeben haben:

- `REBASE_ROLE` pro Einheit – `all` bei der API, wenn keine Functions-Einheit vorhanden ist, damit sie weiterhin Ihre Funktionen bedient
- `REBASE_MIGRATE_ON_BOOT=none` überall, da der Migrations-Job das Schema verwaltet
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` bei der API, sobald ein Worker existiert
- `TRUSTED_PROXY_HOPS` auf der Functions-Einheit
- `REBASE_RATE_LIMIT_STORE=sql`, sobald ein zweiter Prozess HTTP-Anfragen bedient

Ein falsches `REBASE_ROLE` liefert kein HTTP aus, während `/health` weiterhin
antwortet, sodass der Readiness-Check erfolgreich ist und jede Anfrage einen
404-Fehler erzeugt. Ein fehlendes `REBASE_MIGRATE_ON_BOOT` führt zu einem
CrashLoop, dessen Ursache in einem Log steht, das niemand beobachtet. Das Chart
setzt alle diese Einstellungen automatisch, und `config.env` kann sie nicht
überschreiben.

### Cron-Scheduling von der Job-Ausführung trennen

Zwei Worker mit gegensätzlichen Zuständigkeiten – keine neue Rolle und kein
Code:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## Das Admin-Panel und jedes andere Frontend

Eine statische App verwendet dasselbe Runtime-Image, das ein `kind: static`-Bundle
bootet. Dieser Pfad bricht die Initialisierung ab, bevor die Runtime
`DATABASE_URL` oder `JWT_SECRET` liest, sodass diese Pods **überhaupt keine
Secrets** enthalten.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

Das Ingress leitet `/admin` dorthin und `/` an die API weiter, auf **demselben
Host**. Das ist Absicht: Same-Origin bedeutet, dass Cookie-Authentifizierung und
CORS exakt unverändert bleiben und die Aufteilung eine interne
Topologie-Entscheidung bleibt, anstatt die öffentliche Schnittstelle Ihres
Produkts zu verändern. Der Preis dafür ist, dass die Assets für diesen Pfad
*gebaut* werden müssen, was die Runtime beim Booten prüft.

Das Deployment des Admin-Panels ist dann lediglich ein Image-Tag-Bump in einem
einzigen Deployment. Das Backend startet nicht neu.

## Schema

`migrationJob.enabled` (der Standard) führt einen `pre-install,pre-upgrade`-Job
aus, der das Provisioning vornimmt und sich beendet, und jeder Pod startet mit
`REBASE_MIGRATE_ON_BOOT=none`. Nichts im Request-Pfad ist für das Tabellenschema
verantwortlich, was die sauberste Lösung für das Prinzip „genau ein Prozess
provisioniert das Schema“ darstellt – es ist keine Regel mehr, an die jemand
aktiv denken muss. Die Pods halten beim Booten weiterhin die Framework-eigenen
Tabellen (Auth, API-Schlüssel, Jobs, Cron) aktuell; `provision: false`
unterbindet auch dies, rendert keinen Job und überlässt das Schema einem
[Bereitstellungslauf](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database)
im Rahmen Ihres eigenen Change-Management-Prozesses.

`mode: ensure` erstellt fehlende Elemente additiv und ist der einzige Modus, den
das Runtime-Image akzeptiert. `push` wird beim Booten verweigert: Das Anwenden
von Tabellenschema-Änderungen ist destruktiv, und `rebase db push` aus einem
Checkout oder der CI testet die Änderung vorab (Dry-Run), verweigert destruktive
Änderungen ohne Bestätigung und kann zuvor ein Backup erstellen – all das kann ein
unbeaufsichtigt startender Pod nicht leisten.

## Was das Chart nicht rendert

Jede dieser Konfigurationen erzeugt zur Laufzeit keinen Fehler – das Deployment
startet, aber im Hintergrund funktioniert etwas stillschweigend nicht wie
erwartet. `helm install` bricht stattdessen mit einem Fehler ab und nennt den
anzupassenden Wert:

- mehr als ein HTTP-Prozess mit `sharedState.rateLimitStore=memory`
- `functions.enabled` oder `worker.enabled`, während `split=false` gesetzt ist
- zwei statische Apps, die denselben Pfad beanspruchen, oder eine, die einen Pfad unter `/api` beansprucht
- `bundle.mode=image`, während `image.repository` noch auf das Standard-Runtime-Image verweist
- `ingress.enabled` ohne Host oder `bundle.mode=url` ohne URL
- ein nicht erkannter Wert für `migrationJob.mode` oder `sharedState.rateLimitStore`
- kein `config.adminEmail` bei deaktivierter Selbstregistrierung – ein Release,
  an dem sich niemand anmelden kann. Setzen Sie die beiden Admin-Werte oder
  `config.allowSelfRegistration=true`, wobei zu beachten ist, dass die erste
  Person, die das Registrierungsformular aufruft, Administrator wird
- ein `config.adminPassword` mit weniger als 12 Zeichen oder ein
  `config.adminEmail`, dessen Domain keinen Punkt enthält. Die Runtime weigert
  sich beim Booten, eines von beiden zu initialisieren, was zum selben
  ausgesperrten Release führt

## Was das Chart nicht für Sie übernehmen kann

**Echtzeit-Broadcast und Presence über mehrere Replikate hinweg.** Der
standardmäßige Channel-Bus der Runtime liegt im Arbeitsspeicher (in-memory). Bei
mehr als einem API-Replikat sieht ein Abonnent auf einem Pod daher keinen
Broadcast, der auf einem anderen veröffentlicht wurde. Die Lösung liegt in der
Konfiguration Ihres Projekts, nicht im Chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Setzen Sie `sharedState.channelBusConfigured: true`, um zu bestätigen, dass Sie
dies konfiguriert haben – das Chart verwendet diesen Wert nur, um zu entscheiden,
ob eine Warnung ausgegeben werden soll. Normale Tabellen-Abonnements sind davon
nicht betroffen; diese laufen über Postgres CDC.

Alles Übrige, was ein Prozess isoliert für sich behält – lokale Dateien,
fortsetzbare Uploads, der Cache für Bildtransformationen, der Logs Explorer – ist
zusammen mit der jeweiligen Einstellung zur gemeinsamen Nutzung in [Mehrere
Instanzen ausführen](/docs/deployment/multiple-instances/) aufgeführt.

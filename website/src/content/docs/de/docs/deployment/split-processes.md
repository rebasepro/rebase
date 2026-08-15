---
title: Auf mehrere Prozesse aufteilen
sidebar_label: Getrennte Prozesse
description: "Führe ein Bundle als mehrere zusammenarbeitende Prozesse aus — eine API, eine Functions-Schicht, einen Worker — aus demselben veröffentlichten Runtime-Image, damit eine rechenintensive Custom Function nicht mehr mit der Daten-API konkurriert."
---

## Überblick

Ein Rebase-Deployment ist normalerweise ein einzelner Prozess, der alles
bedient: die Daten-API, Authentifizierung, Storage, deine Custom Functions, Cron
und die Job-Queue. Das ist für fast jedes Deployment die richtige Form, und es
bleibt die Voreinstellung.

Wenn das nicht mehr passt — eine Custom Function, die den Event-Loop blockiert,
oder eine Functions-Schicht, die unabhängig von der API skalieren oder neu
starten soll — kannst du **dasselbe Image und dasselbe Bundle** mehrfach starten
und jeden Prozess einen anderen Teil des Projekts bedienen lassen. Es gibt nichts
Neues zu bauen und nichts, was ein Client wissen müsste: die URLs ändern sich
nicht.

Eine Umgebungsvariable entscheidet, was ein Prozess ist:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Was jede Rolle bedient

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, der Schema-Editor | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | leitet weiter (siehe unten) | ✅ | — |
| `/api/cron` (die Admin-Oberfläche) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Legt beim Start das Schema an | ✅ | ✅ | — | — |
| Führt den Cron-Scheduler aus | ✅ | ✅ | — | ✅ |
| Führt die Job-Queue-Worker aus | ✅ | ✅ | — | ✅ |

Health und Metriken gibt es ausnahmslos auf jeder Rolle. Ein Prozess, den ein
Orchestrator nicht prüfen kann, ist ein Prozess, den er nicht ausrollen kann.

## Docker Compose

Zwei Services aus einem Image, einem Bundle und einer Datenbank:

```yaml
services:
  api:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: api
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

  functions:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: functions
      REBASE_MIGRATE_ON_BOOT: none
      TRUSTED_PROXY_HOPS: 1
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
```

```bash
docker compose up --scale functions=3
```

Beide Prozesse brauchen dieselbe `DATABASE_URL`, dasselbe `JWT_SECRET` und
denselben `REBASE_SERVICE_KEY`: sie sind ein Deployment, und ein von einem
ausgestelltes Token muss vom anderen akzeptiert werden.

## Die URLs bleiben gleich

`REBASE_FUNCTIONS_UPSTREAM` weist den `api`-Prozess an, `/api/functions/*` an den
Functions-Prozess weiterzuleiten, statt es selbst zu bedienen. Clients,
generierte SDKs und API-Keys sehen exakt dieselbe Oberfläche wie vor der
Aufteilung — kein Anwendungscode ändert sich, und du musst keinen Reverse Proxy
aufsetzen, um es auszuprobieren.

Ein Produktions-Deployment kann den Pfad stattdessen am Ingress routen; dann
lässt du `REBASE_FUNCTIONS_UPSTREAM` ungesetzt — der `api`-Prozess antwortet auf
diesen Pfaden mit 404, und der davorliegende Proxy entscheidet, wohin sie gehen.

### Proxy-Hops

Beim Weiterleiten hängt die API die Adresse des Aufrufers an `X-Forwarded-For`
an. Damit steht der Functions-Prozess hinter **einem Proxy-Hop mehr** als die
API, und das muss ihm gesagt werden:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` ist die Anzahl der Reverse Proxies, die tatsächlich vor
einem Prozess stehen. Jeder hängt die von ihm gesehene Adresse an
`X-Forwarded-For` an, sodass der echte Client der N-te Eintrag von rechts ist;
alles weiter links stammt vom Client und wird ignoriert — genau das verhindert,
dass jemand den Header fälscht, um Rate-Limit-Schlüssel zu rotieren. Der
Standardwert ist `0`: keinem Proxy wird vertraut.

Wenn das falsch gesetzt ist, geht nichts sichtbar kaputt: die Rate Limiter des
Functions-Prozesses ordnen jede Anfrage der Adresse des API-Containers zu, alle
Aufrufer teilen sich also einen Bucket, und die bei jedem Auth-Ereignis
protokollierte IP ist immer dieselbe.

## Ein Prozess besitzt das Schema

Genau ein Prozess eines aufgeteilten Deployments legt beim Start die Tabellen an
und wendet die RLS-Policies an: der `api`-Prozess (oder `all`). Jeder andere
Prozess muss setzen:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Das ist **verpflichtend**, kein Ratschlag: ein `functions`- oder `worker`-Prozess
auf dem Standardwert verweigert den Start und sagt das auch. `CREATE … IF NOT
EXISTS` liest den Katalog und schreibt danach hinein — zwei getrennte Schritte —,
also kollidieren gleichzeitig startende Prozesse tatsächlich. Und ein Deployment,
in dem mehrere um das Anlegen desselben Schemas konkurrieren, hat niemand so
entworfen.

## Eine Function pro Prozess bedienen

Ein Prozess kann eine benannte Teilmenge bedienen — so bekommt eine teure
Function ihre eigene Replikatzahl, ohne dass ihr Code irgendwohin umzieht:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Die Namen sind Dateinamen ohne Endung — derselbe Name, unter dem die Function
gemountet wird. Ein Name, den das Bundle nicht enthält, **lässt den Start
fehlschlagen**, und der Fehler listet die enthaltenen Namen auf. Ein Prozess, der
für eine Function konfiguriert ist, existiert für diese Function; ein Tippfehler,
der stillschweigend nichts bedient, wäre das schlechtestmögliche Ergebnis.

## Cron und Hintergrundjobs

Beide sind über mehrere Prozesse hinweg bereits sicher: der Cron-Scheduler
beansprucht jedes `(job, slot)`-Paar in der Datenbank, und die Job-Queue
beansprucht Zeilen mit `FOR UPDATE SKIP LOCKED`. Deshalb führt `api` beide
weiterhin standardmäßig aus, und eine Aufteilung in zwei Services ist ohne
dritten Container vollständig.

Füge einen `worker`-Prozess hinzu, wenn geplante Arbeit aus dem Anfragepfad
heraus soll, und schalte sie auf der API ab:

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
```

Ein `functions`-Prozess führt nie eines von beiden aus. Er skaliert nach
Anfragelast und wird jederzeit ersetzt; ihm geplante Arbeit zu geben würde seiner
Replikatzahl eine Bedeutung geben, die sie nicht haben soll.

Beachte: `rebase.jobs.enqueue` funktioniert überall weiter, auch in einem
Prozess, der keine Worker ausführt — Einreihen ist ein Schreibvorgang, Ausführen
ist eine Polling-Schleife, und nur Letzteres schaltet eine Rolle ab.

## Was die Aufteilung nicht bringt

**Geteilte Rate Limits.** Der Speicher des Rate Limiters ist standardmäßig
prozesslokal, N Prozesse vervielfachen das Kontingent jedes Aufrufers also um N.
Übergib einen gemeinsamen `rateLimit.store` in der Backend-Konfiguration, wenn
das Limit für das gesamte Deployment gelten soll.

**Instanzübergreifende Channels.** Broadcast und Presence nutzen standardmäßig
einen In-Memory-Bus, der Prozessgrenzen nicht überschreitet. Das ist eher eine
Frage der *Replikatzahl* als der Aufteilung — für ein auf drei skaliertes
Ein-Rollen-Deployment gilt es genauso. Setze also
`REALTIME_CHANNEL_BUS=postgres` (oder `realtime.bus` in der Konfiguration),
sobald mehr als ein Prozess WebSockets bedient.

**Scale-to-Zero.** Nichts davon fährt einen Prozess auf null herunter oder
startet einen bei Bedarf. Das ist eine Fähigkeit der Plattform, nicht der
Runtime.

## Aktualisieren

Unverändert: jeder Prozess führt dasselbe veröffentlichte Image aus, ein Upgrade
ist also derselbe Tag-Wechsel auf jedem von ihnen. Rolle `api` zuletzt aus, wenn
das Schema-Provisioning zuerst gegen die neue Version laufen soll — in der Praxis
spielt die Reihenfolge allerdings keine Rolle, weil der Schema-Schritt additiv
und idempotent ist.

---
sourceHash: 4497d118312ff8ce
title: Aufteilen in mehrere Prozesse
sidebar_label: Prozesse aufteilen
description: Führen Sie ein Bundle als mehrere zusammenarbeitende Prozesse aus – eine API, eine Functions-Ebene, ein Worker – aus demselben veröffentlichten Runtime-Image, damit eine rechenintensive benutzerdefinierte Funktion nicht mehr mit der Daten-API konkurriert.
---

## Übersicht

Ein Rebase-Deployment ist normalerweise ein einzelner Prozess, der alles bereitstellt: die Daten-API,
Auth, Storage, Ihre benutzerdefinierten Funktionen, Cron und die Job-Queue. Das ist für fast jedes
Deployment die richtige Form und bleibt der Standard.

Wenn es nicht mehr die richtige Form ist – etwa bei einer benutzerdefinierten Funktion, die den Event-Loop blockiert,
oder einer Functions-Ebene, die unabhängig von der API skaliert oder neu gestartet werden soll –, können Sie
**dasselbe Image und dasselbe Bundle** mehrfach starten und jeden Prozess einen anderen Teil des Projekts
bereitstellen lassen. Es muss nichts neu gebaut werden und für Clients ändert sich nichts: Die URLs bleiben gleich.

Eine einzige Umgebungsvariable bestimmt die Rolle eines Prozesses:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Was jede Rolle bereitstellt

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, der Schema-Editor | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | leitet weiter (siehe unten) | ✅ | — |
| `/api/cron` (die Admin-Oberfläche) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Stellt WebSockets bereit, konsumiert Änderungsereignisse | ✅ | ✅ | — | — |
| Erstellt das Schema beim Start | ✅ | ✅ | — | — |
| Führt den Cron-Scheduler aus | ✅ | ✅ | — | ✅ |
| Führt Job-Queue-Worker aus | ✅ | ✅ | — | ✅ |

Health und Metriken sind ausnahmslos in jeder Rolle enthalten. Ein Prozess, den ein
Orchestrator nicht abfragen kann, ist ein Prozess, den er nicht rollierend aktualisieren kann.

Echtzeit steht auf der Liste, weil sie Ressourcen kostet, unabhängig davon, ob jemand sie nutzt:
Ein Prozess, der Änderungsereignisse konsumiert, hält während seiner gesamten Laufzeit eine `LISTEN`-Verbindung
außerhalb des Pools aufrecht und installiert beim Start die Erfassungstrigger. Nur ein Prozess, der
WebSockets bereitstellt, hat Abnehmer, an die er liefern kann, weshalb die beiden Rollen, die keine bereitstellen,
beides nicht tun. **Schreibvorgänge dieser Prozesse werden dennoch erfasst** – die Erfassung erfolgt über
Datenbanktrigger, sodass eine Änderung von der Datenbank veröffentlicht wird und nicht von dem Prozess,
der sie vorgenommen hat. Eine Funktion, die eine Zeile schreibt, weckt weiterhin jeden Abonnenten auf der `api` auf.

## Docker Compose

Zwei Dienste aus einem Image, einem Bundle und einer Datenbank:

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

Beide Prozesse benötigen dieselbe `DATABASE_URL`, dasselbe `JWT_SECRET` und denselben
`REBASE_SERVICE_KEY` – sie bilden ein gemeinsames Deployment, und ein von einem Prozess erstelltes
Token muss vom anderen akzeptiert werden.

## URLs unverändert lassen

`REBASE_FUNCTIONS_UPSTREAM` weist den `api`-Prozess an, `/api/functions/*` an den Functions-Prozess
weiterzuleiten, anstatt die Anfragen selbst zu bedienen. Clients, generierte SDKs und API-Schlüssel
sehen exakt dieselbe Schnittstelle wie vor dem Split. Daher ändert sich kein Anwendungscode, und Sie
müssen keinen Reverse Proxy einrichten, um dies auszuprobieren.

Ein Produktions-Deployment zieht es möglicherweise vor, den Pfad stattdessen an seinem Ingress zu
routen. Lassen Sie in diesem Fall `REBASE_FUNCTIONS_UPSTREAM` ungesetzt – der `api`-Prozess antwortet
für diese Pfade dann mit 404, und der vorgelagerte Proxy entscheidet, wohin sie geleitet werden.

### Proxy-Hops

Wenn die API weiterleitet, hängt sie die Adresse des Aufrufers an `X-Forwarded-For` an. Dadurch befindet
sich der Functions-Prozess hinter **einem Proxy-Hop mehr** als die API, worüber er informiert werden muss:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` ist die Anzahl der Reverse Proxies, die Sie tatsächlich vor einem Prozess betreiben.
Jeder davon hängt die gesehene Adresse an `X-Forwarded-For` an, sodass der tatsächliche Client der N-te Eintrag
von rechts ist; alles weiter links wurde vom Client bereitgestellt und wird ignoriert. Dies verhindert,
dass ein Aufrufer den Header fälscht, um Rate-Limit-Schlüssel zu rotieren. Der Standardwert ist `0` – kein
Proxy wird als vertrauenswürdig eingestuft.

Wenn Sie dies falsch konfigurieren, bricht nichts sichtbar ab: Rate-Limiter auf dem Functions-Prozess
ordnen jede Anfrage der Adresse des API-Containers zu, sodass sich alle Aufrufer ein einziges Bucket
teilen, und die bei jedem Auth-Ereignis erfasste IP ist dieselbe.

## Ein Prozess besitzt das Schema

Genau ein Prozess in einem aufgeteilten Deployment erstellt beim Booten Tabellen und wendet RLS-Richtlinien
an, und zwar der `api`- (oder `all`-)Prozess. Jeder andere Prozess muss Folgendes setzen:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Dies ist **zwingend erforderlich**, keine Empfehlung: Ein `functions`- oder `worker`-Prozess mit den
Standardeinstellungen verweigert den Start und meldet dies entsprechend. `CREATE … IF NOT EXISTS` liest den
Katalog und schreibt in zwei separaten Schritten darauf, sodass gleichzeitig startende Prozesse kollidieren –
und ein Deployment, bei dem mehrere Prozesse um die Bereitstellung desselben Schemas konkurrieren, ist von
niemandem so vorgesehen.

## Eine Funktion pro Prozess bereitstellen

Ein Prozess kann eine benannte Teilmenge bereitstellen. So erhält eine ressourcenintensive Funktion
eine eigene Replika-Anzahl, ohne dass ihr Code verschoben werden muss:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Namen sind Dateinamen ohne Erweiterung – derselbe Name, unter dem die Funktion eingebunden ist. Ein Name,
der nicht im Bundle enthalten ist, **führt zum Abbruch beim Booten**, und der Fehler listet die tatsächlich
vorhandenen Namen auf. Ein für eine bestimmte Funktion konfigurierter Prozess existiert für genau diese
Funktion; ein Tippfehler, der dazu führt, dass stillschweigend gar nichts bereitgestellt wird, wäre das
denkbar schlechteste Ergebnis.

## Cron und Hintergrund-Jobs

Beide können bereits sicher in mehr als einem Prozess ausgeführt werden: Der Cron-Scheduler beansprucht jedes
`(job, slot)`-Paar in der Datenbank, und die Job-Queue beansprucht Zeilen mit `FOR UPDATE SKIP LOCKED`.
Daher führt `api` standardmäßig weiterhin beides aus, und ein Split in zwei Dienste ist ohne einen
dritten Container vollständig.

Fügen Sie einen `worker`-Prozess hinzu, wenn Sie geplante Aufgaben außerhalb des Request-Pfads ausführen
möchten, und deaktivieren Sie dies auf der API:

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

Ein `functions`-Prozess führt keines von beiden aus. Er wird anhand der Anfragelast skaliert und nach
Belieben ersetzt; würde man ihm geplante Aufgaben zuweisen, bekäme seine Replika-Anzahl eine Bedeutung,
die sie nicht haben sollte.

Beachten Sie, dass `rebase.jobs.enqueue` überall weiterhin funktioniert, auch auf einem Prozess, der
keine Worker ausführt – das Einreihen in die Warteschlange ist ein Schreibvorgang, das Ausführen eine
Polling-Schleife, und nur Letzteres wird durch eine Rolle deaktiviert.

## Was die Aufteilung nicht bietet

**Geteilte Rate-Limits, sofern nicht explizit konfiguriert.** Der Standardspeicher ist pro Prozess ausgelegt,
sodass N Prozesse das Kontingent jedes Aufrufers mit N multiplizieren, ohne dass ein Log-Eintrag darauf
hinweist. Setzen Sie `REBASE_RATE_LIMIT_STORE=sql` auf jedem Prozess, der HTTP bereitstellt – die Zählung
erfolgt in Postgres, sodass das Limit unabhängig von der Anzahl der Replikate gilt. (Das Helm-Chart setzt
dies automatisch und verweigert das Rendern einer Multi-Prozess-Topologie, die dies auf `memory` belässt.)

**Instanzübergreifende Channels.** Broadcast und Presence nutzen standardmäßig einen In-Memory-Bus,
der nicht prozessübergreifend funktioniert. Dies ist eher eine Frage der *Replika-Anzahl* als des Splittings –
es gilt gleichermaßen für ein Einzelrollen-Deployment, das auf drei Replikate skaliert ist. Setzen Sie daher
`REALTIME_CHANNEL_BUS=postgres` (oder `realtime.bus` in der Konfiguration), wann immer mehr als ein Prozess
WebSockets bereitstellt.

**Scale-to-Zero.** Nichts davon skaliert einen Prozess auf null herunter oder startet bei Bedarf einen
neuen. Das ist eine Plattformfunktion und keine Eigenschaft der Runtime.

## Eine einzelne Einheit separat veröffentlichen

Alles oben Genannte teilt auf, *wo die Arbeit ausgeführt wird*. Das Gesamtsystem wird weiterhin als ein
Build ausgeliefert: ein Image, ein Bundle, gemeinsam ausgerollt. Das ist der richtige Standard, und die
meisten Deployments sollten dabei bleiben.

Eine Einheit kann auch auf einem eigenen Build gehalten werden – etwa ein Fix für eine Funktion, der
keinen Neustart der API erfordert:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.22.0"     # this unit only; the rest stay on the release-wide tag
```

Meist lohnt es sich nur, das Tag festzupinnen: Das Repository wird übernommen, es handelt sich also um
ein Projekt und ein Image, bei dem nur eine Einheit geändert wurde. `bundleUrl` erfüllt denselben Zweck,
wenn `bundle.mode: url` konfiguriert ist.

### Die Regel

Zwei Einheiten auf unterschiedlichen Builds entsprechen zwei Mengen von Collections gegen **eine**
Datenbank, und nur eine Einheit stellt diese bereit. Daher gilt:

> **Die Einheit, die das Schema besitzt, wird zuerst ausgerollt. Eine Einheit darf hinterherhinken; sie darf niemals vorauseilen.**

Das ist der Migrations-Job oder die `api`, wenn der Job deaktiviert ist. Eine Einheit, die dem Schema
*voraus* ist, fragt Spalten ab, die noch nicht existieren, und verlässt sich auf RLS-Richtlinien, die noch
niemand angewendet hat – Ersteres ist ein SQL-Fehler auf einer Route, Letzteres ein leeres Ergebnis mit
Status 200. Eine Einheit, die *hinterherhinkt*, ist der normale Zustand bei jedem laufenden Rollout.

### Was dies überprüft

Der bereitstellende Prozess speichert die von ihm angewendete Schemaversion in der Datenbank. Jeder andere
Prozess berechnet seine eigene Version aus den geladenen Collections und vergleicht diese. Bei einer
Abweichung meldet er dies und benennt beide:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Er gibt eine Warnung aus und bedient weiterhin Anfragen, da diese Abweichung während eines Rollouts
*korrekt* ist – die Einheiten, die noch nicht aktualisiert wurden, sollen hinterherhinken. Setzen Sie
`REBASE_REQUIRE_SCHEMA_MATCH=true` (oder `sharedState.requireSchemaMatch` im Chart), um stattdessen den Start
zu verweigern, falls ein Deployment lieber gar keine Antworten als fehlerhafte Antworten liefern soll.

Beide Seiten dieses Vergleichs werden **berechnet** und niemals aus einem Manifest ausgelesen. Eine Version,
die ein Build über sich selbst deklariert, ist kein Beweis dafür, dass die Datenbank damit übereinstimmt.

Nichts überprüft die *Richtung* – eine Schemaversion ist ein Hash, sodass nur festgestellt werden kann,
dass beide abweichen, aber nie, welche Version neuer ist. Aus diesem Grund ist die Rollout-Reihenfolge eine
Regel, die Sie befolgen müssen, und keine, die von der Runtime erzwungen werden kann.

## Upgrades

Unverändert: Jeder Prozess führt dasselbe veröffentlichte Image aus, daher besteht ein Upgrade aus
derselben Tag-Änderung bei jedem von ihnen. Rollen Sie die `api` zuletzt aus, wenn die Schemabereitstellung
zuerst mit der neuen Version erfolgen soll – in der Praxis spielt die Reihenfolge jedoch keine Rolle,
da der Schemaschritt additiv und idempotent ist.

## Verwandte Themen

- [Deployment Guide](/docs/getting-started/deployment/) — das Ein-Prozess-Deployment, das hier aufgeteilt wird
- [Environment & Configuration](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` und `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — ein Deployment pro Rolle

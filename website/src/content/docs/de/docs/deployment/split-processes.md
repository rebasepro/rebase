---
sourceHash: 1268d4bf9843a74b
title: In mehrere Prozesse aufteilen
sidebar_label: Prozesse aufteilen
description: Führen Sie ein Bundle als mehrere kooperierende Prozesse aus – eine API, eine Functions-Ebene, einen Worker – aus demselben veröffentlichten Runtime-Image, damit eine rechenintensive benutzerdefinierte Funktion nicht mehr mit der Daten-API konkurriert.
---

## Übersicht

Ein Rebase-Deployment besteht normalerweise aus einem einzigen Prozess, der alles bereitstellt: die Daten-API, Authentifizierung, Storage, Ihre benutzerdefinierten Funktionen, Cron und die Job-Queue. Das ist für fast jedes Deployment die richtige Form und bleibt der Standard.

Wenn dies nicht mehr die richtige Form ist – etwa bei einer benutzerdefinierten Funktion, die den Event Loop blockiert, oder einer Functions-Ebene, die unabhängig von der API skaliert oder neu gestartet werden soll –, können Sie **dasselbe Image und dasselbe Bundle** mehrfach starten und jeden Prozess einen anderen Teil des Projekts bedienen lassen. Es muss nichts Neues gebaut werden und für Clients ändert sich nichts: Die URLs bleiben unverändert.

Eine einzige Umgebungsvariable bestimmt die Rolle eines Prozesses:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Was die einzelnen Rollen bereitstellen

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, der Schema-Editor | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | leitet weiter (siehe unten) | ✅ | — |
| `/api/cron` (die Admin-Oberfläche) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Bedient WebSockets, verarbeitet Änderungs-Events | ✅ | ✅ | — | — |
| Erstellt das Schema beim Start | ✅ | ✅ | — | — |
| Führt den Cron-Scheduler aus | ✅ | ✅ | — | ✅ |
| Führt Job-Queue-Worker aus | ✅ | ✅ | — | ✅ |

Health und Metrics sind ausnahmslos in jeder Rolle vorhanden. Ein Prozess, den ein Orchestrator nicht prüfen (probe) kann, ist ein Prozess, den er nicht rollierend aktualisieren kann.

Realtime steht auf der Liste, weil es Ressourcen verbraucht, unabhängig davon, ob es genutzt wird: Ein Prozess, der Change-Events verarbeitet, hält während seiner gesamten Laufzeit eine `LISTEN`-Verbindung außerhalb des Pools offen und richtet beim Start die Erfassungs-Trigger ein. Nur ein Prozess, der WebSockets bedient, hat Empfänger, an die er ausliefern kann; daher tun die beiden Rollen, die keine bedienen, keines von beidem. **Schreibvorgänge dieser Prozesse werden dennoch registriert** – die Erfassung erfolgt über Datenbank-Trigger, sodass eine Änderung von der Datenbank veröffentlicht wird und nicht von dem Prozess, der sie ausgeführt hat. Eine Funktion, die eine Zeile schreibt, weckt weiterhin jeden Abonnenten auf der `api` auf.

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

Beide Prozesse benötigen dieselbe `DATABASE_URL`, dasselbe `JWT_SECRET` und denselben `REBASE_SERVICE_KEY` – sie bilden ein gemeinsames Deployment, und ein von einem Prozess erstelltes Token muss vom anderen akzeptiert werden.

## URLs unverändert beibehalten

`REBASE_FUNCTIONS_UPSTREAM` weist den `api`-Prozess an, `/api/functions/*` an den Functions-Prozess weiterzuleiten, anstatt die Anfragen selbst zu bedienen. Clients, generierte SDKs und API-Schlüssel sehen exakt dieselbe Oberfläche wie vor der Aufteilung, sodass kein Anwendungscode geändert werden muss und Sie keinen Reverse Proxy aufsetzen müssen, um dies auszuprobieren.

In einem Produktions-Deployment kann es sinnvoller sein, den Pfad stattdessen auf Ingress-Ebene zu routen. In diesem Fall lassen Sie `REBASE_FUNCTIONS_UPSTREAM` ungesetzt – der `api`-Prozess antwortet für diese Pfade dann mit 404, und der vorgeschaltete Proxy entscheidet über die Weiterleitung.

### Proxy-Hops

Wenn die API Anfragen weiterleitet, hängt sie die Adresse des Aufrufers an `X-Forwarded-For` an. Dadurch befindet sich der Functions-Prozess hinter **einem weiteren Proxy-Hop** als die API, worüber er informiert werden muss:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` ist die Anzahl der Reverse Proxies, die Sie tatsächlich vor einem Prozess betreiben. Jeder von ihnen hängt die erkannte Adresse an `X-Forwarded-For` an, sodass der tatsächliche Client der n-te Eintrag von rechts ist; alles weiter links stammt vom Client und wird ignoriert – das verhindert, dass ein Aufrufer den Header fälscht, um Rate-Limit-Schlüssel zu rotieren. Der Standardwert ist `0` – keinem Proxy wird vertraut.

Ist dieser Wert falsch konfiguriert, schlägt nichts sichtbar fehl: Rate Limiter auf dem Functions-Prozess beziehen jede Anfrage auf die Adresse des API-Containers, sodass sich alle Aufrufer denselben Bucket teilen, und die bei jedem Authentifizierungs-Event erfasste IP ist dieselbe.

## Ein Prozess besitzt das Schema

Genau ein Prozess in einem aufgeteilten Deployment erstellt beim Start Tabellen und wendet RLS-Policies an – und das ist der `api`- (oder `all`-)Prozess. Jeder andere Prozess muss Folgendes setzen:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Dies ist **zwingend erforderlich**, keine bloße Empfehlung: Ein `functions`- oder `worker`-Prozess mit der Standardeinstellung verweigert den Start und weist darauf hin. `CREATE … IF NOT EXISTS` liest den Katalog und schreibt dann in zwei getrennten Schritten hinein, sodass gleichzeitig startende Prozesse kollidieren – und ein Deployment, bei dem mehrere Prozesse um die Bereitstellung desselben Schemas konkurrieren, ist von niemandem so vorgesehen.

## Eine Funktion pro Prozess bereitstellen

Ein Prozess kann eine benannte Teilmenge bereitstellen. Auf diese Weise erhält eine rechenintensive Funktion eine eigene Replika-Anzahl, ohne dass ihr Code verschoben werden muss:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Namen sind Dateinamen ohne Dateiendung – derselbe Name, unter dem die Funktion gemountet ist. Ein Name, der nicht im Bundle enthalten ist, **bringt den Start zum Scheitern**, und die Fehlermeldung listet die tatsächlich vorhandenen Namen auf. Ein für eine bestimmte Funktion konfigurierter Prozess existiert genau für diese Funktion; ein Tippfehler, der dazu führen würde, dass stillschweigend nichts bereitgestellt wird, wäre das denkbar schlechteste Ergebnis.

## Cron und Hintergrund-Jobs

Beide können bereits sicher in mehr als einem Prozess ausgeführt werden: Der Cron-Scheduler beansprucht jedes `(job, slot)`-Paar in der Datenbank, und die Job-Queue beansprucht Zeilen mit `FOR UPDATE SKIP LOCKED`. Daher führt `api` standardmäßig weiterhin beides aus, und eine Aufteilung auf zwei Services ist ohne einen dritten Container vollständig.

Fügen Sie einen `worker`-Prozess hinzu, wenn Sie geplante Aufgaben außerhalb des Request-Pfads ausführen möchten, und deaktivieren Sie diese auf der API:

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

Ein `functions`-Prozess führt keines von beidem aus. Er wird anhand der Anfragelast skaliert und nach Belieben ausgetauscht; würde man ihm geplante Aufgaben zuweisen, bekäme seine Replika-Anzahl eine unpassende Bedeutung.

Beachten Sie, dass `rebase.jobs.enqueue` weiterhin überall funktioniert, auch auf einem Prozess, der keine Worker ausführt – das Einreihen in die Queue ist ein Schreibvorgang, die Ausführung ist eine Abfrageschleife (Poll Loop), und nur Letztere wird durch eine Rolle deaktiviert.

## Was die Aufteilung nicht bietet

**Geteilte Rate-Limits, es sei denn, Sie konfigurieren es.** Der Standard-Store arbeitet pro Prozess, sodass N Prozesse das Limit jedes Aufrufers mit N multiplizieren, ohne dass ein Log darauf hinweist. Setzen Sie `REBASE_RATE_LIMIT_STORE=sql` auf jedem Prozess, der HTTP bedient – die Zählung erfolgt in Postgres, sodass das Limit unabhängig von der Anzahl der Replikate strikt eingehalten wird. (Das Helm-Chart setzt dies automatisch und verweigert das Rendern einer Multi-Prozess-Topologie, die auf `memory` belassen wurde.)

**Instanzübergreifende Channels.** Broadcast und Presence verwenden standardmäßig einen In-Memory-Bus, der nicht prozessübergreifend arbeitet. Dies ist eher eine Frage der *Replika-Anzahl* als der Aufteilung – dasselbe gilt für ein Single-Role-Deployment, das auf drei Instanzen skaliert wurde. Setzen Sie daher `REALTIME_CHANNEL_BUS=postgres` (oder `realtime.bus` in der Konfiguration), sobald mehr als ein Prozess WebSockets bedient.

**Scale to Zero.** Nichts hier skaliert einen Prozess auf null herunter oder startet einen bei Bedarf neu. Das ist eine Plattformfunktion, keine Eigenschaft der Runtime.

## Eine einzelne Einheit separat releasen

Alles oben Genannte teilt auf, *wo die Arbeit ausgeführt wird*. Dennoch wird alles weiterhin als ein Build ausgeliefert: ein Image, ein Bundle, gemeinsam ausgerollt. Das ist der richtige Standard, und die meisten Deployments sollten dabei bleiben.

Eine Einheit kann jedoch auch auf einem eigenen Build gehalten werden – etwa ein Fix für eine Funktion, der keinen Neustart der API erfordert:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.20.0"     # this unit only; the rest stay on the release-wide tag
```

Normalerweise lohnt es sich nur, das Tag festzulegen: Das Repository wird übernommen, es handelt sich also um ein Projekt und ein Image, bei dem eine Einheit verschoben wurde. `bundleUrl` übernimmt dieselbe Aufgabe, wenn `bundle.mode: url` konfiguriert ist.

### Die Regel

Zwei Einheiten auf unterschiedlichen Builds bedeuten zwei Gruppen von Collections gegen **eine** Datenbank, und nur eine Einheit stellt diese bereit. Daher gilt:

> **Die Einheit, die das Schema besitzt, wird zuerst ausgerollt. Eine Einheit darf hinterherhinken; sie darf niemals vorauseilen.**

Das ist der Migrations-Job oder die `api`, wenn der Job deaktiviert ist. Eine Einheit, die dem Schema *voraus* ist, fragt Spalten ab, die noch nicht existieren, und verlässt sich auf RLS-Policies, die niemand angewendet hat – Ersteres führt zu einem SQL-Fehler auf einer Route, Letzteres zu einem leeren Ergebnis mit Status 200. Eine Einheit, die *hinterherhinkt*, ist der normale Zustand jedes laufenden Rollouts.

### Wer dies überprüft

Der Prozess, der die Bereitstellung durchführt, speichert die von ihm angewendete Schemaversion in der Datenbank. Jeder andere Prozess berechnet seine eigene Version aus den geladenen Collections und vergleicht sie. Bei einer Abweichung meldet er dies und benennt beide:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Er warnt und bedient weiterhin Anfragen, da diese Abweichung während eines Rollouts *korrekt* ist – die noch nicht aktualisierten Einheiten sollen hinterherhinken. Setzen Sie `REBASE_REQUIRE_SCHEMA_MATCH=true` (oder `sharedState.requireSchemaMatch` im Chart), um stattdessen den Start zu verweigern, falls ein Deployment lieber gar keine Anfragen als fehlerhafte Anfragen bedienen soll.

Beide Seiten dieses Vergleichs werden **berechnet**, niemals aus einem Manifest ausgelesen. Eine Version, die ein Build über sich selbst deklariert, ist kein Beweis dafür, dass die Datenbank damit übereinstimmt.

Nichts überprüft die *Richtung* – eine Schemaversion ist ein Hash; das System kann also feststellen, dass beide voneinander abweichen, aber nicht, welche Version weiter fortgeschritten ist. Aus diesem Grund ist die Rollout-Reihenfolge eine Regel, die Sie selbst befolgen müssen, und keine, die die Runtime erzwingen kann.

## Upgrades

Unverändert: Jeder Prozess führt dasselbe veröffentlichte Image aus, sodass ein Upgrade bei allen Prozessen derselben Tag-Änderung entspricht. Aktualisieren Sie die `api` zuletzt, wenn die Schema-Bereitstellung zuerst für die neue Version erfolgen soll – in der Praxis spielt die Reihenfolge jedoch keine Rolle, da der Schema-Schritt additiv und idempotent ist.

## Weiterführende Themen

- [Deployment-Leitfaden](/docs/getting-started/deployment/) — das Single-Process-Deployment, das hier aufgeteilt wird
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` und `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — ein Deployment pro Rolle

---

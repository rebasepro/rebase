---
sourceHash: ce7486bb141920aa
title: Aufteilung in mehrere Prozesse
sidebar_label: Aufgeteilte Prozesse
description: Führen Sie ein Bundle als mehrere kooperierende Prozesse aus – eine API, eine Functions-Ebene, einen Worker – basierend auf demselben veröffentlichten Laufzeit-Image, damit eine rechenintensive benutzerdefinierte Funktion nicht mehr mit der Daten-API konkurriert.
---

## Übersicht

Ein Rebase-Deployment besteht normalerweise aus einem einzigen Prozess, der alles bedient: die Daten-API, Auth, Storage, Ihre benutzerdefinierten Funktionen, Cron und die Job-Warteschlange (Job Queue). Das ist für fast jedes Deployment die richtige Form und bleibt der Standard.

Wenn dies nicht mehr die passende Form ist – eine benutzerdefinierte Funktion, die die Event-Loop blockiert, eine Functions-Ebene, die unabhängig von der API skaliert oder neu gestartet werden soll –, können Sie **dasselbe Image und dasselbe Bundle** mehrfach starten und jeden Prozess einen anderen Teil des Projekts bedienen lassen. Es muss nichts neu gebaut werden und Clients müssen davon nichts wissen: Die URLs ändern sich nicht.

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
| `/api/admin`, `/api/logs`, the schema editor | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | leitet weiter (siehe unten) | ✅ | — |
| `/api/cron` (die Admin-Oberfläche) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Bedient WebSockets, verarbeitet Änderungsereignisse | ✅ | ✅ | — | — |
| Erstellt das Schema beim Start | ✅ | ✅ | — | — |
| Führt den Cron-Scheduler aus | ✅ | ✅ | — | ✅ |
| Führt Job-Queue-Worker aus | ✅ | ✅ | — | ✅ |

Health und Metrics sind ausnahmslos in jeder Rolle enthalten. Ein Prozess, den ein Orchestrator nicht überprüfen kann, ist ein Prozess, den er nicht im Rolling-Verfahren aktualisieren kann.

Realtime steht auf der Liste, weil es Ressourcen verbraucht, unabhängig davon, ob es jemand nutzt oder nicht: Ein Prozess, der Änderungsereignisse verarbeitet, hält für seine gesamte Laufzeit eine `LISTEN`-Verbindung außerhalb des Pools und richtet beim Start die Erfassungs-Trigger ein. Nur ein Prozess, der WebSockets bedient, hat Empfänger, an die geliefert werden kann – daher tun die beiden Rollen, die keine bedienen, weder das eine noch das andere. **Schreibvorgänge dieser Prozesse werden dennoch erfasst** – die Erfassung erfolgt über Datenbank-Trigger, sodass Änderungen von der Datenbank und nicht von dem ausführenden Prozess veröffentlicht werden. Eine Funktion, die eine Zeile schreibt, weckt weiterhin jeden Abonnenten auf der `api` auf.

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

## Beibehaltung der URLs

`REBASE_FUNCTIONS_UPSTREAM` weist den `api`-Prozess an, `/api/functions/*` an den Functions-Prozess weiterzuleiten, anstatt die Anfragen selbst zu bedienen. Clients, generierte SDKs und API-Schlüssel sehen exakt dieselbe Schnittstelle wie vor der Aufteilung; es muss also kein Anwendungscode geändert werden und Sie müssen keinen Reverse-Proxy einrichten, um dies auszuprobieren.

In einer Produktionsumgebung wird der Pfad möglicherweise bevorzugt bereits am Ingress geroutet. In diesem Fall lassen Sie `REBASE_FUNCTIONS_UPSTREAM` ungesetzt – der `api`-Prozess antwortet für diese Pfade dann mit 404, und der vorgeschaltete Proxy entscheidet, wohin sie geleitet werden.

### Proxy-Hops

Wenn die API Anfragen weiterleitet, hängt sie die Adresse des Aufrufers an `X-Forwarded-For` an. Dadurch befindet sich der Functions-Prozess hinter **einem weiteren Proxy-Hop** als die API, was ihm mitgeteilt werden muss:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` ist die Anzahl der Reverse-Proxies, die Sie tatsächlich vor einem Prozess betreiben. Jeder Proxy hängt die von ihm gesehene Adresse an `X-Forwarded-For` an, sodass der tatsächliche Client der N-te Eintrag von rechts ist; alles weiter links stammt vom Client und wird ignoriert. Dies verhindert, dass ein Aufrufer den Header fälscht, um Rate-Limit-Schlüssel zu rotieren. Der Standardwert ist `0` – kein Proxy wird als vertrauenswürdig eingestuft.

Wird dies falsch konfiguriert, bricht nichts sichtbar ab: Rate-Limiter auf dem Functions-Prozess ordnen jede Anfrage der Adresse des API-Containers zu, sodass sich alle Aufrufer ein einziges Bucket teilen, und die bei jedem Auth-Ereignis erfasste IP-Adresse ist immer dieselbe.

## Ein Prozess besitzt das Schema

In einem aufgeteilten Deployment erstellt genau ein Prozess beim Start Tabellen und wendet RLS-Richtlinien an, und zwar der `api`- (oder `all`-)Prozess. Jeder andere Prozess muss Folgendes setzen:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Dies ist **zwingend erforderlich** und keine bloße Empfehlung: Ein `functions`- oder `worker`-Prozess, der auf dem Standardwert belassen wird, verweigert den Start und meldet dies entsprechend. `CREATE … IF NOT EXISTS` liest den Katalog und schreibt anschließend in zwei separaten Schritten hinein, sodass gleichzeitig startende Prozesse kollidieren – und ein Deployment, bei dem mehrere Prozesse um die Bereitstellung desselben Schemas konkurrieren, ist von niemandem so vorgesehen.

## Eine Funktion pro Prozess bereitstellen

Ein Prozess kann eine benannte Teilmenge bedienen. So erhält eine ressourcenintensive Funktion ihre eigene Replika-Anzahl, ohne dass ihr Code verschoben werden muss:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Namen entsprechen Dateinamen ohne Erweiterung – derselbe Name, unter dem die Funktion bereitgestellt wird. Ein Name, der nicht im Bundle enthalten ist, **führt zum Abbruch beim Start**, und die Fehlermeldung listet die tatsächlich vorhandenen Namen auf. Ein für eine bestimmte Funktion konfigurierter Prozess existiert eigens für diese Funktion; ein Tippfehler, der stillschweigend gar nichts ausliefert, wäre das denkbar schlechteste Ergebnis.

## Cron und Hintergrund-Jobs

Beide können bereits sicher in mehr als einem Prozess ausgeführt werden: Der Cron-Scheduler reserviert jedes `(job, slot)`-Paar in der Datenbank, und die Job-Warteschlange reserviert Zeilen mit `FOR UPDATE SKIP LOCKED`. Daher führt `api` standardmäßig weiterhin beides aus, und eine Aufteilung auf zwei Services ist ohne einen dritten Container vollständig.

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

Ein `functions`-Prozess führt niemals eines von beiden aus. Er wird anhand der Anfragelast skaliert und nach Belieben ersetzt; würde man ihm geplante Aufgaben zuweisen, erhielte seine Replika-Anzahl eine Bedeutung, die sie nicht haben sollte.

Beachten Sie, dass `rebase.jobs.enqueue` überall weiterhin funktioniert, auch auf einem Prozess, der keine Worker ausführt – das Einreihen in die Warteschlange ist ein Schreibvorgang, die Ausführung eine Abfrageschleife (Poll Loop), und nur Letztere wird von einer Rolle deaktiviert.

## Was eine Aufteilung nicht bietet

**Gemeinsame Rate-Limits, sofern nicht explizit konfiguriert.** Der standardmäßige Speicher arbeitet pro Prozess. N Prozesse multiplizieren das Kontingent jedes Aufrufers mit N, ohne dass dies irgendwo im Log protokolliert wird. Setzen Sie `REBASE_RATE_LIMIT_STORE=sql` auf jedem Prozess, der HTTP bedient – die Zählung erfolgt dann in Postgres, sodass das Limit unabhängig von der Anzahl der Replikate gilt. (Das Helm-Chart setzt dies automatisch und verweigert das Rendern einer Multi-Prozess-Topologie, wenn der Wert auf `memory` belassen wird.)

**Instanzübergreifende Kanäle.** Broadcast und Presence verwenden standardmäßig einen In-Memory-Bus, der nicht prozessübergreifend funktioniert. Dies ist eher eine Frage der *Replika-Anzahl* als der Aufteilung – dasselbe gilt für ein Einzelrollen-Deployment, das auf drei Instanzen skaliert ist. Setzen Sie daher `REALTIME_CHANNEL_BUS=postgres` (oder `realtime.bus` in der Konfiguration), wann immer mehr als ein Prozess WebSockets bedient.

**Scale to Zero.** Nichts hier skaliert einen Prozess auf null herunter oder startet ihn bei Bedarf. Das ist eine Plattformfunktion, keine Eigenschaft der Laufzeitumgebung.

## Eine Einheit separat veröffentlichen

Alles bisher Beschriebene teilt auf, *wo die Arbeit ausgeführt wird*. Dennoch wird weiterhin alles als ein Build ausgeliefert: ein Image, ein Bundle, gemeinsam aktualisiert. Das ist der richtige Standard, und die meisten Deployments sollten dabei bleiben.

Eine Einheit kann jedoch auch auf einem eigenen Build gehalten werden – etwa ein Bugfix für eine Funktion, der die API nicht neu startet:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.20.0"     # this unit only; the rest stay on the release-wide tag
```

In der Regel lohnt es sich nur, das Tag festzulegen: Das Repository wird übernommen, es handelt sich also um ein Projekt und ein Image, bei dem eine Einheit verschoben wurde. `bundleUrl` übernimmt dieselbe Aufgabe, wenn `bundle.mode: url` gesetzt ist.

### Die Regel

Zwei Einheiten auf unterschiedlichen Builds bedeuten zwei Gruppen von Collections für **eine** Datenbank, und nur eine Einheit stellt diese bereit. Daher gilt:

> **Die Einheit, die das Schema besitzt, wird zuerst aktualisiert. Eine Einheit darf hinterherhinken; sie darf niemals vorauseilen.**

Das ist der Migrations-Job oder die `api`, wenn der Job deaktiviert ist. Eine Einheit, die dem Schema *voraus* ist, fragt Spalten ab, die noch nicht existieren, und verlässt sich auf RLS-Richtlinien, die niemand angewendet hat – Ersteres führt zu einem SQL-Fehler auf einer Route, Letzteres zu einem leeren Ergebnis mit Status 200. Eine Einheit, die *hinterherhinkt*, ist der normale Zustand während eines laufenden Rollouts.

### Wie dies überprüft wird

Der bereitstellende Prozess zeichnet die von ihm angewendete Schema-Version in der Datenbank auf. Jeder andere Prozess berechnet seine eigene Version aus den geladenen Collections und vergleicht sie. Bei einer Abweichung weist er darauf hin und nennt beide:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Er gibt eine Warnung aus und bedient weiterhin Anfragen, da diese Abweichung während eines Rollouts *korrekt* ist – Einheiten, die noch nicht aktualisiert wurden, sollen hinterherhinken. Setzen Sie `REBASE_REQUIRE_SCHEMA_MATCH=true` (oder `sharedState.requireSchemaMatch` im Chart), um stattdessen den Start zu verweigern, falls ein Deployment lieber gar keine Anfragen als fehlerhafte bedienen soll.

Beide Seiten dieses Vergleichs werden **berechnet** und niemals aus einem Manifest ausgelesen. Eine Version, die ein Build über sich selbst deklariert, ist kein Beweis dafür, dass die Datenbank damit übereinstimmt.

Nichts überprüft die *Richtung* – eine Schema-Version ist ein Hash, daher kann nur festgestellt werden, dass beide nicht übereinstimmen, aber nie, welche Version neuer ist. Aus diesem Grund ist die Rollout-Reihenfolge eine Regel, die Sie selbst befolgen müssen, und keine, die die Laufzeitumgebung erzwingen kann.

## Upgrades

Unverändert: Jeder Prozess verwendet dasselbe veröffentlichte Image, daher besteht ein Upgrade aus derselben Tag-Änderung für jeden Prozess. Führen Sie das Rollout der `api` zuletzt durch, wenn die Schema-Bereitstellung zuerst auf die neue Version erfolgen soll – in der Praxis spielt die Reihenfolge jedoch keine Rolle, da der Schema-Schritt additiv und idempotent ist.

## Weiterführende Links

- [Deployment Guide](/docs/getting-started/deployment/) — das Single-Process-Deployment, das hier aufgeteilt wird
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` und `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — ein Deployment pro Rolle

---

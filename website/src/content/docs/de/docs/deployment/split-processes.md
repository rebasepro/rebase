---
sourceHash: f09c52453f45b58d
title: Aufteilung in mehrere Prozesse
sidebar_label: Aufgeteilte Prozesse
description: Führen Sie ein Bundle als mehrere kooperierende Prozesse aus – eine API, eine Functions-Ebene, ein Worker – aus demselben veröffentlichten Runtime-Image, sodass eine ressourcenintensive benutzerdefinierte Funktion nicht mehr mit der Daten-API konkurriert.
---

## Übersicht

Ein Rebase-Deployment besteht normalerweise aus einem einzigen Prozess, der alles bedient: die Daten-API,
Authentifizierung (Auth), Storage, Ihre benutzerdefinierten Funktionen (Functions), Cron-Jobs und die Job-Queue. Dies ist die
passende Struktur für nahezu jedes Deployment und bleibt der Standard.

Wenn diese Struktur nicht mehr ausreicht – etwa durch eine benutzerdefinierte Funktion, die den Event-Loop blockiert,
oder eine Functions-Ebene, die unabhängig von der API skaliert oder neu gestartet werden soll –, können Sie
**dasselbe Image und dasselbe Bundle** mehrfach starten, sodass jeder Prozess
einen anderen Teil des Projekts bedient. Es muss nichts neu gebaut werden und
ein Client muss nichts davon wissen: Die URLs ändern sich nicht.

Eine einzige Umgebungsvariable bestimmt, welche Rolle ein Prozess übernimmt:

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
| `/api/admin` (darunter Logs und der Schema-Editor) | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | leitet weiter (siehe unten) | ✅ | — |
| `/api/admin/cron` (die Admin-Oberfläche) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Bedient WebSockets, verarbeitet Change-Events | ✅ | ✅ | — | — |
| Erstellt das Schema beim Start | ✅ | ✅ | — | — |
| Führt den Cron-Scheduler aus | ✅ | ✅ | — | ✅ |
| Führt Job-Queue-Worker aus | ✅ | ✅ | — | ✅ |

Health- und Metrics-Endpunkte sind ausnahmslos auf jeder Rolle vorhanden; `/metrics` antwortet nur bei `REBASE_METRICS=true`. Ein Prozess, den
ein Orchestrator nicht überprüfen kann, kann auch nicht im Rolling-Update ersetzt werden.

`GET /api/auth/config`,
was der Anmeldebildschirm abfragt, folgt dem Rest von `/api/auth`: Nur `api` und
`all` stellen diesen Endpunkt bereit.

Realtime steht auf der Liste, da es Ressourcen bindet – unabhängig davon, ob jemand
es nutzt: Ein Prozess, der Change-Events verarbeitet, hält eine `LISTEN`-Verbindung
außerhalb des Pools aufrecht, solange er läuft, und richtet die Capture-Trigger beim Start ein. Nur
ein Prozess, der WebSockets bedient, hat Empfänger zu beliefern; daher tun die beiden Rollen,
die keine WebSockets bedienen, keines von beidem. **Schreibvorgänge dieser Prozesse werden dennoch registriert.** Bei
aktivem Change Capture erfolgt die Erfassung über Datenbank-Trigger, sodass eine Änderung
von der Datenbank und nicht vom jeweiligen Schreibprozess veröffentlicht wird. Bei deaktiviertem Capture
(`REALTIME_CDC=off` oder ein Fallback von `auto`, weil die Datenbankrolle keine
Trigger erstellen darf), gibt ein `worker`- oder `functions`-Prozess stattdessen jeden seiner eigenen
Schreibvorgänge über den instanzübergreifenden Kanal bekannt, ohne eine `LISTEN`-Verbindung
zu halten. In beiden Fällen weckt eine Funktion, die eine Zeile schreibt,
jeden Abonnenten auf der `api` auf.

Geben Sie jedem Prozess denselben Wert für `REALTIME_CDC`. Ein Prozess, der das Schema verwaltet
und `REALTIME_CDC=off` verwendet, entfernt die Capture-Trigger beim Start. Eine `api`,
die weiterhin auf `auto` steht, würde dann auf Änderungen lauschen, die niemand meldet.

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

Beide Prozesse benötigen dieselbe `DATABASE_URL`, dasselbe `JWT_SECRET` und denselben
`REBASE_SERVICE_KEY` – sie bilden ein gemeinsames Deployment, und ein von einem Prozess erstelltes
Token muss vom anderen akzeptiert werden. Ein Prozess mit `REBASE_FUNCTIONS_UPSTREAM` und ohne
`REBASE_SERVICE_KEY` verweigert den Start: Seine eigenen `rebase.functions.invoke(...)`-Aufrufe
aus einem Hook oder einem Cron-Job erreichen den Functions-Prozess mit diesem Schlüssel.

## Beibehaltung der URLs

`REBASE_FUNCTIONS_UPSTREAM` weist den `api`-Prozess an, `/api/functions/*`
an den Functions-Prozess weiterzuleiten, anstatt die Anfragen selbst zu verarbeiten. Es muss eine `http://`- oder
`https://`-URL sein; jeder andere Wert bricht den Start ab. Nur `api` und `worker` lesen diese Variable
(siehe [Cron- und Hintergrund-Jobs](#cron--und-hintergrund-jobs) für den Worker). Clients, generierte SDKs und API-Keys
sehen exakt dieselbe Oberfläche wie vor dem Split. Daher muss kein Anwendungscode
angepasst werden, und Sie müssen keinen separaten Reverse Proxy einrichten, um dies zu testen.

In einem Produktiv-Deployment kann es bevorzugt sein, den Pfad stattdessen auf Ingress-Ebene zu routen.
In diesem Fall lassen Sie `REBASE_FUNCTIONS_UPSTREAM` ungesetzt – der `api`-Prozess
antwortet auf diese Pfade dann mit 404, und der vorgeschaltete Proxy entscheidet über das Ziel.

### Proxy Hops

Wenn die API weiterleitet, hängt sie die Adresse des Aufrufers an `X-Forwarded-For` an. Dadurch
befindet sich der Functions-Prozess hinter **einem Proxy-Hop mehr** als die API,
was konfiguriert werden muss:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` ist die Anzahl der Reverse Proxys, die Sie tatsächlich vor
einem Prozess betreiben. Jeder Proxy hängt die von ihm gesehene Adresse an `X-Forwarded-For` an. Der
tatsächliche Client ist somit der N-te Eintrag von rechts; alles weiter links
wurde vom Client übermittelt und wird ignoriert. Dadurch wird verhindert, dass ein Aufrufer den Header fälscht,
um Rate-Limit-Keys zu umgehen. Der Standardwert ist `0` – keinem Proxy wird vertraut.

Wird dies falsch konfiguriert, führt das zu keinen sichtbaren Fehlern: Rate Limiter auf dem Functions-Prozess
ordnen jede Anfrage der Adresse des API-Containers zu, sodass alle Aufrufer dasselbe
Budget teilen, und die bei Authentifizierungsereignissen protokollierte IP ist stets dieselbe.

## Ein einzelner Prozess verwaltet das Schema

Genau ein Prozess in einem aufgeteilten Deployment erstellt beim Booten Tabellen und wendet
RLS-Policies an: der `api`- (oder `all`-)Prozess. Jeder andere Prozess muss Folgendes
setzen:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Dies ist **erforderlich** und keine bloße Empfehlung: Ein `functions`- oder `worker`-Prozess, bei dem der
Standardwert belassen wird, verweigert den Start mit einer entsprechenden Meldung. `CREATE … IF NOT EXISTS` liest den Katalog
und schreibt anschließend in zwei getrennten Schritten hinein. Gleichzeitig startende Prozesse
geraten daher in Konflikt – und ein Deployment, bei dem mehrere Instanzen um die Bereitstellung desselben
Schemas konkurrieren, ist nicht vorgesehen.

In einem
[Custom Server](/docs/backend/custom-server/) entspricht diese Konfiguration der
Option `provision` von `createRebaseBackend`: `true` in dem Prozess, der das
Schema verwaltet, und `{ tables: false, realtime: false }` in allen anderen,
wodurch die framework-eigenen Tabellen erhalten bleiben. `REBASE_MIGRATE_ON_BOOT=none` deaktiviert
das Tabellenschema auch dort. Hintergrundaufgaben werden nach demselben Prinzip geregelt:
Ein Prozess, der `start()` niemals aufruft, führt weder Cron-Scheduler noch Job-Worker aus. Ein
Prozess, der es aufruft, führt jene aus, die ihm über die Option `ownership` zugewiesen wurden.

## Eine Funktion pro Prozess bereitstellen

Ein Prozess kann eine benannte Teilmenge von Funktionen bedienen. So erhält eine ressourcenintensive
Funktion ihre eigene Replika-Anzahl, ohne dass ihr Code verschoben werden muss:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Namen entsprechen den Dateinamen ohne Dateiendung – derselbe Name, unter dem die Funktion bereitgestellt
wird. Ein Name, der nicht im Bundle enthalten ist, **führt zum Startabbruch**, und die Fehlermeldung
listet die verfügbaren Namen auf. Ein Prozess, der für eine bestimmte Funktion konfiguriert ist, existiert für genau
diese Funktion; ein Tippfehler, der dazu führt, dass stillschweigend nichts bereitgestellt wird, wäre der denkbar schlechteste Ausgang.

## Cron- und Hintergrund-Jobs

Beide können standardmäßig sicher in mehreren Prozessen ausgeführt werden: Der Cron-Scheduler beansprucht
jedes `(job, slot)`-Paar in der Datenbank für sich, und die Job-Queue reserviert Zeilen mit
`FOR UPDATE SKIP LOCKED`. Die `api` führt daher standardmäßig beides weiterhin aus, und eine
Aufteilung auf zwei Services ist ohne einen dritten Container vollständig.

Fügen Sie einen `worker`-Prozess hinzu, wenn Sie geplante Aufgaben aus dem Anfragepfad auslagern möchten,
und deaktivieren Sie diese auf der API:

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      # Only if a job calls rebase.functions:
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
```

Ein Job, der auf einen Worker verschoben wird, behält den Zugriff auf `rebase.dataAsAdmin`, `rebase.sql`,
`rebase.storage` und `rebase.email`, die direkt mit der Datenbank, den Buckets und
dem Mailserver kommunizieren. Er behält außerdem:

- **`rebase.admin`** (Benutzer, Rollen, Passwort-Resets) **und `rebase.cron`.** Ein
  Worker stellt auf seinem Port keine Admin-Oberfläche bereit, bindet diese beiden jedoch in-process ein –
  ausschließlich für seine eigenen Jobs.
- **`rebase.functions` mit `REBASE_FUNCTIONS_UPSTREAM`.** Ein Worker stellt selbst keine
  Functions bereit. Ist der Upstream konfiguriert, werden seine eigenen `rebase.functions.invoke(...)`-Aufrufe
  an den Functions-Prozess weitergeleitet, wo die Funktion den Aufruf
  als vom Service ausgehend sieht. Der Worker liefert auf seinem Port weiterhin nichts unter `/api/functions` aus.
  Hierfür benötigt der Worker, genau wie die `api`, den `REBASE_SERVICE_KEY` des Deployments.

Der Zugriff auf `rebase.auth` entfällt: Dies sind Anmelde-Flows für Benutzer, und ein Worker
stellt keine solchen bereit. Für Account-Verwaltung innerhalb eines Jobs verwenden Sie stattdessen `rebase.admin`. Zudem entfällt der
Zugriff auf die übrige Admin-API (Backups, Logs, der Schema-Editor usw.) sowie auf
`rebase.functions`, sofern kein Upstream gesetzt ist. Ein Aufruf an einen dieser Bereiche antwortet mit
`404 NOT_FOUND` unter Angabe der deaktivierten Schnittstelle und möglicher Alternativen.

Ein `functions`-Prozess führt niemals Hintergrundaufgaben aus. Er wird anhand der Anfragelast skaliert und
beliebig ersetzt. Würde man ihm geplante Aufgaben zuweisen, bekäme seine Replika-Anzahl
eine unerwünschte Bedeutung.

Beachten Sie, dass das Einreihen in Queues – `jobQueue.enqueue`, das `enqueue` einer deklarierten Queue,
das `publish` eines Topics – überall weiterhin funktioniert, auch auf einem Prozess, der
keine Worker ausführt. Das Einreihen ist ein Schreibvorgang; das Ausführen ist eine Abfrageschleife (Poll Loop),
und nur letztere wird durch eine Rolle deaktiviert.

## Was die Aufteilung nicht bietet

**Gemeinsame Rate Limits, sofern nicht explizit konfiguriert.** Der standardmäßige Speicher arbeitet pro Prozess. N
Prozesse vervielfachen daher das Kontingent jedes Aufrufers um den Faktor N, ohne dass ein Log-Eintrag
darauf hinweist. Setzen Sie `REBASE_RATE_LIMIT_STORE=sql` auf jedem Prozess, der HTTP bedient – die
Zählung erfolgt dann in Postgres, sodass das Limit unabhängig von der Anzahl der Replikas gilt.
(Das Helm-Chart setzt dies automatisch und verweigert das Rendern einer Multi-Prozess-Topologie,
wenn der Wert auf `memory` belassen wird.)

**Instanzübergreifende Kanäle.** Broadcast und Presence nutzen standardmäßig einen In-Memory-Bus,
der nicht über Prozessgrenzen hinweg reicht. Dies ist eine Frage der *Replika-Anzahl*
und nicht der Aufteilung – dies gilt für ein Single-Role-Deployment mit drei Replikas
gleichermaßen. Setzen Sie daher `REALTIME_CHANNEL_BUS=postgres` (oder `realtime.bus` in der
Konfiguration), sobald mehr als ein Prozess WebSockets bedient.

**Scale-to-Zero.** Keine der hier beschriebenen Funktionen skaliert einen Prozess auf null herunter oder startet
einen Prozess bei Bedarf. Dies ist eine Plattform-Eigenschaft und keine der Runtime.

Alles Weitere, was ein Prozess isoliert für sich behält, ist hier aufgeführt:
[Ausführen mehrerer Instanzen](/docs/deployment/multiple-instances/).

## Eine einzelne Einheit separat releasen

Alle obigen Punkte teilen auf, *wo die Arbeit ausgeführt wird*. Das gesamte System wird weiterhin als ein
Build ausgeliefert: ein Image, ein Bundle, gemeinsam ausgerollt. Dies ist der empfohlene Standard,
und die meisten Deployments sollten dabei bleiben.

Eine Einheit kann jedoch auch auf einem eigenen Build-Stand gehalten werden – beispielsweise für einen Function-Fix,
der keinen Neustart der API erfordert:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.30.1"     # this unit only; the rest stay on the release-wide tag
```

In der Regel lohnt es sich nur, das Tag festzulegen: Das Repository wird übernommen, es handelt sich also um
ein Projekt und ein Image, bei dem eine Einheit verschoben wurde. `bundleUrl` erfüllt denselben Zweck
bei Verwendung von `bundle.mode: url`.

### Die Grundregel

Zwei Einheiten auf unterschiedlichen Builds bedeuten zwei Tabellendefinitionen für **eine**
Datenbank, und nur eine Einheit stellt diese bereit. Daher gilt:

> **Die Einheit, die das Schema verwaltet, wird zuerst aktualisiert. Eine Einheit darf hinterherhinken;
> sie darf niemals vorauslaufen.**

Dies übernimmt der Migrations-Job oder die `api`, falls der Job deaktiviert ist. Eine Einheit, die dem
Schema *voraus* ist, fragt Spalten ab, die noch nicht existieren, und verlässt sich auf RLS-Policies,
die noch niemand angewendet hat – Ersteres führt zu einem SQL-Fehler auf einer Route, Letzteres zu einem
leeren Ergebnis mit Status 200. Eine Einheit, die *hinterherhinkt*, entspricht dem Normalzustand jedes
laufenden Rollouts.

### Wie dies überprüft wird

Der Prozess, der das Schema bereitstellt, speichert die angewendete Schemaversion in der
Datenbank. Jeder andere Prozess berechnet seine eigene Version anhand der von ihm geladenen Tabellen und
vergleicht diese. Bei einer Abweichung wird eine Warnung mit beiden Versionen ausgegeben:

```
⚠️ [schema] The database was last provisioned from a different set of tables
   than this process was built from (database v2:6f2a…, this process v2:91cd…).
```

Es wird gewarnt, die Anfragen werden jedoch weiterhin verarbeitet, da eine solche Abweichung während eines Rollouts
*vorgesehen* ist – Einheiten, die noch nicht aktualisiert wurden, sollen hinterherhinken. Setzen Sie
`REBASE_REQUIRE_SCHEMA_MATCH=true` (oder `sharedState.requireSchemaMatch` im
Chart), um den Start stattdessen abzubrechen, falls Ihr Deployment im Zweifel lieber
gar keine Anfragen als fehlerhafte Anfragen bedienen soll.

Beide Seiten dieses Vergleichs werden **berechnet** und niemals aus einem Manifest ausgelesen. Eine
Version, die ein Build über sich selbst deklariert, ist kein Beweis dafür, dass die Datenbank damit übereinstimmt.

Es gibt keine Überprüfung der *Richtung* – eine Schemaversion ist ein Hash. Daher kann nur festgestellt werden,
dass beide Seiten abweichen, nicht aber, welche weiter fortgeschritten ist. Aus diesem Grund ist die Rollout-Reihenfolge
eine Regel, die Sie einhalten müssen, und keine, die von der Runtime erzwungen werden kann.

## Upgrades

Unverändert: Jeder Prozess führt dasselbe veröffentlichte Image aus, sodass ein Upgrade bei allen
aus derselben Tag-Änderung besteht. Aktualisieren Sie den Prozess, der das Schema verwaltet – die `api`
oder den Migrations-Job – zuerst, damit das Schema der neuen Version aktiv ist, bevor
die anderen Prozesse darauf zugreifen: Eine Einheit darf hinterherhinken, niemals vorauslaufen (siehe
[Die Grundregel](#die-grundregel)).

## Verwandte Themen

- [Deployment-Leitfaden](/docs/getting-started/deployment/) – das Single-Process-Deployment, das hier aufgeteilt wird
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` und `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) – ein Deployment pro Rolle

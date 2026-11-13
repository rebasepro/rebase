---
sourceHash: f1296ae912e0725e
title: Aufteilen in mehrere Prozesse
sidebar_label: Prozesse aufteilen
description: Führen Sie ein Bundle als mehrere kooperierende Prozesse aus – eine API, eine Functions-Ebene, ein Worker – aus demselben veröffentlichten Runtime-Image, damit eine rechenintensive benutzerdefinierte Funktion nicht mehr mit der Daten-API konkurriert.
---

## Übersicht

Ein Rebase-Deployment besteht normalerweise aus einem einzigen Prozess, der alles bereitstellt: die Daten-API,
Authentifizierung (Auth), Speicher (Storage), Ihre benutzerdefinierten Funktionen, Cron und die Job-Queue. Das ist für fast jedes Deployment
die richtige Struktur und bleibt der Standard.

Wenn es nicht mehr die richtige Struktur ist – etwa durch eine benutzerdefinierte Funktion, die die Event-Loop blockiert,
oder eine Functions-Ebene, die unabhängig von der API skaliert oder neu gestartet werden soll –, können Sie
**dasselbe Image und dasselbe Bundle** mehrfach starten und jeden Prozess
einen anderen Teil des Projekts bedienen lassen. Es muss nichts neu gebaut werden
und für Clients ändert sich nichts: Die URLs bleiben dieselben.

Eine einzige Umgebungsvariable bestimmt, welche Rolle ein Prozess übernimmt:

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
| `/api/admin` (u. a. Logs und der Schema-Editor) | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | leitet weiter (siehe unten) | ✅ | — |
| `/api/admin/cron` (die Admin-Oberfläche) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Bedient WebSockets, verarbeitet Change-Events | ✅ | ✅ | — | — |
| Erstellt das Schema beim Start | ✅ | ✅ | — | — |
| Führt den Cron-Scheduler aus | ✅ | ✅ | — | ✅ |
| Führt Job-Queue-Worker aus | ✅ | ✅ | — | ✅ |

Health- und Metrics-Endpunkte sind ausnahmslos bei jeder Rolle vorhanden; `/metrics` antwortet nur mit `REBASE_METRICS=true`. Ein Prozess, den
ein Orchestrator nicht prüfen (probe) kann, ist ein Prozess, den er nicht rollierend aktualisieren kann.

`GET /api/auth/config`,
was der Anmeldebildschirm abruft, folgt dem Rest von `/api/auth`: Nur `api` und
`all` stellen diesen Endpunkt bereit.

Realtime steht auf der Liste, weil es Ressourcen beansprucht, unabhängig davon, ob jemand
es nutzt: Ein Prozess, der Change-Events verarbeitet, hält während seiner gesamten Laufzeit eine `LISTEN`-Verbindung
außerhalb des Pools offen und richtet beim Booten die Capture-Trigger ein. Nur
ein Prozess, der WebSockets bedient, hat Empfänger für diese Events; die beiden Rollen,
die keine WebSockets bedienen, tun daher keines von beidem. **Schreibvorgänge dieser Prozesse werden dennoch registriert.** Bei
aktiviertem Change-Capture erfolgt die Erfassung über Datenbank-Trigger, sodass eine Änderung
von der Datenbank und nicht von dem Prozess veröffentlicht wird, der sie vorgenommen hat. Bei deaktiviertem Capture
(`REALTIME_CDC=off` oder `auto` mit Fallback, weil die Datenbankrolle keine
Trigger erstellen kann), kündigt ein `worker`- oder `functions`-Prozess jeden seiner eigenen
Schreibvorgänge stattdessen über den instanzübergreifenden Kanal an, ohne eine `LISTEN`-Verbindung
zu halten. In beiden Fällen weckt eine Funktion, die eine Zeile schreibt,
jeden Abonnenten auf der `api` auf.

Geben Sie jedem Prozess denselben Wert für `REALTIME_CDC`. Ein Prozess, der das Schema
mit `REALTIME_CDC=off` verwaltet, entfernt die Capture-Trigger beim Start, und eine `api`,
die weiterhin auf `auto` steht, würde dann auf Änderungen lauschen, die niemand ankündigt.

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
`REBASE_SERVICE_KEY` – sie bilden ein gemeinsames Deployment, und ein von einem Prozess erstelltes Token muss
vom anderen akzeptiert werden. Ein Prozess mit `REBASE_FUNCTIONS_UPSTREAM` und ohne
`REBASE_SERVICE_KEY` verweigert den Start: Seine eigenen `rebase.functions.invoke(...)`-Aufrufe,
aus einem Hook oder einem Cron-Job, erreichen den Functions-Prozess mit diesem Schlüssel.

## Beibehalten identischer URLs

`REBASE_FUNCTIONS_UPSTREAM` weist den `api`-Prozess an, Anfragen an `/api/functions/*`
an den Functions-Prozess weiterzuleiten, anstatt sie selbst zu verarbeiten. Es muss eine `http://`- oder
`https://`-URL sein; jeder andere Wert bricht den Start ab. Nur `api` und `worker` lesen diese Variable
(siehe [Cron- und Hintergrund-Jobs](#cron--und-hintergrund-jobs) für den Worker). Clients, generierte SDKs und API-Schlüssel
sehen genau dieselbe Oberfläche wie vor dem Split; Anwendungscode muss
also nicht geändert werden, und Sie müssen keinen Reverse-Proxy aufsetzen, um dies auszuprobieren.

Ein Produktions-Deployment zieht es möglicherweise vor, den Pfad stattdessen auf Ingress-Ebene zu routen.
In diesem Fall lassen Sie `REBASE_FUNCTIONS_UPSTREAM` ungesetzt – der `api`-Prozess
antwortet für diese Pfade dann mit 404 und der vorgeschaltete Proxy entscheidet, wohin sie geleitet werden.

### Proxy-Hops

Wenn die API Anfragen weiterleitet, hängt sie die Adresse des Aufrufers an `X-Forwarded-For` an. Dadurch
befindet sich der Functions-Prozess hinter **einem Proxy-Hop mehr** als die API,
was ihm mitgeteilt werden muss:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` ist die Anzahl der Reverse-Proxies, die Sie tatsächlich vor
einem Prozess betreiben. Jeder Proxy hängt die von ihm gesehene Adresse an `X-Forwarded-For` an, sodass
der echte Client der N-te Eintrag von rechts ist; alles weiter links stammt vom
Client und wird ignoriert, was verhindert, dass ein Aufrufer den Header fälscht,
um Rate-Limit-Schlüssel zu umgehen. Der Standardwert ist `0` – keinem Proxy wird vertraut.

Wenn Sie dies falsch konfigurieren, schlägt nichts sichtbar fehl: Rate-Limiter auf dem Functions-Prozess
beziehen jede Anfrage auf die Adresse des API-Containers, sodass alle Ihre Aufrufer sich denselben
Bucket teilen, und die bei jedem Auth-Event protokollierte IP-Adresse ist immer dieselbe.

## Ein einzelner Prozess verwaltet das Schema

Genau ein Prozess in einem aufgeteilten Deployment erstellt Tabellen und wendet RLS-Richtlinien
beim Start an – und das ist der `api`- (oder `all`-)Prozess. Jeder andere Prozess muss
Folgendes setzen:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Dies ist **zwingend erforderlich**, keine bloße Empfehlung: Ein `functions`- oder `worker`-Prozess, der auf dem
Standardwert belassen wird, verweigert den Start und weist per Fehlermeldung darauf hin. `CREATE … IF NOT EXISTS` liest den Katalog
und schreibt anschließend in zwei getrennten Schritten hinein, sodass gleichzeitig startende Prozesse
kollidieren – und ein Deployment, bei dem mehrere Prozesse darum konkurrieren, dasselbe Schema
bereitzustellen, ist von niemandem gewollt.

In einem
[benutzerdefinierten Server](/docs/backend/custom-server/) entspricht dieselbe Entscheidung der
Option `provision` von `createRebaseBackend`: `true` im Prozess, der das
Schema verwaltet, und `{ collections: false, realtime: false }` in allen anderen, wodurch
die internen Tabellen des Frameworks erhalten bleiben. `REBASE_MIGRATE_ON_BOOT=none` deaktiviert das
Tabellenschema auch dort. Hintergrundaufgaben werden auf dieselbe Weise gesteuert:
Ein Prozess, der `start()` niemals aufruft, führt weder Cron-Scheduler noch Job-Worker aus,
und ein Prozess, der dies tut, führt diejenigen aus, die ihm seine `ownership`-Option zuweist.

## Eine Funktion pro Prozess bereitstellen

Ein Prozess kann eine benannte Teilmenge bereitstellen. Auf diese Weise erhält eine rechenintensive Funktion
ihre eigene Replika-Anzahl, ohne dass ihr Code verschoben werden muss:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Namen entsprechen den Dateinamen ohne Erweiterung – derselbe Name, unter dem die Funktion bereitgestellt
wird. Ein Name, der im Bundle nicht enthalten ist, **führt zum Abbruch des Starts**, und der Fehler listet
die tatsächlich enthaltenen Namen auf. Ein Prozess, der für eine bestimmte Funktion konfiguriert ist, existiert genau für diese
Funktion; ein Tippfehler, der dazu führt, dass stillschweigend nichts bereitgestellt wird, wäre das denkbar schlechteste Verhalten.

## Cron- und Hintergrund-Jobs

Beide können bereits sicher in mehr als einem Prozess ausgeführt werden: Der Cron-Scheduler beansprucht
jedes `(job, slot)`-Paar in der Datenbank für sich, und die Job-Queue beansprucht Zeilen mit
`FOR UPDATE SKIP LOCKED`. Daher führt `api` standardmäßig weiterhin beides aus, und eine Aufteilung
auf zwei Services ist ohne einen dritten Container vollständig.

Fügen Sie einen `worker`-Prozess hinzu, wenn Sie geplante Aufgaben aus dem Request-Pfad auslagern möchten, und
deaktivieren Sie diese auf der API:

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

Ein Job, der auf einen Worker verschoben wird, behält `rebase.dataAsAdmin`, `rebase.sql`,
`rebase.storage` und `rebase.email`, die direkt mit der Datenbank, den Buckets und
dem Mailserver kommunizieren. Er behält außerdem:

- **`rebase.admin`** (Benutzer, Rollen, Passwort-Resets) **und `rebase.cron`.** Ein
  Worker stellt auf seinem Port keine Admin-Oberfläche bereit, führt diese beiden jedoch prozessintern aus,
  ausschließlich für seine eigenen Jobs.
- **`rebase.functions`, mit `REBASE_FUNCTIONS_UPSTREAM`.** Ein Worker stellt keine
  Funktionen bereit. Wenn der Upstream konfiguriert ist, werden seine eigenen `rebase.functions.invoke(...)`-Aufrufe
  an den Functions-Prozess weitergeleitet, wo die Funktion den Aufruf
  als vom Service stammend erkennt. Der Worker beantwortet auf seinem Port weiterhin keine Anfragen unter `/api/functions`.
  Dafür benötigt der Worker, genau wie die `api`, den `REBASE_SERVICE_KEY` des Deployments.

Der Worker verliert `rebase.auth`: Dies sind Anmelde-Flows für Benutzer, und ein Worker
stellt keine solchen bereit. Für Account-Verwaltung aus einem Job heraus verwenden Sie `rebase.admin`. Er verliert auch den
Rest der Admin-API (Backups, Logs, den Schema-Editor usw.) sowie
`rebase.functions`, wenn kein Upstream konfiguriert ist. Ein Aufruf an eine dieser Schnittstellen antwortet mit
`404 NOT_FOUND` und nennt den deaktivierten Bereich sowie Handlungsalternativen.

Ein `functions`-Prozess führt keines von beidem aus. Er wird anhand der Request-Last skaliert und
nach Belieben ersetzt; ihm geplante Aufgaben zu übertragen, würde seiner Replika-Anzahl eine
Bedeutung geben, die sie nicht haben sollte.

Beachten Sie, dass das Einreihen in Queues – `jobQueue.enqueue`, das `enqueue` einer deklarierten Queue,
das `publish` eines Topics – überall weiterhin funktioniert, auch auf Prozessen, die
keine Worker ausführen. Das Einreihen ist ein Schreibvorgang, das Ausführen eine Abfrageschleife (Poll-Loop), und nur
Letzteres wird durch eine Rolle deaktiviert.

## Was eine Aufteilung nicht bietet

**Gemeinsame Rate-Limits, sofern nicht explizit konfiguriert.** Der Standardspeicher ist pro Prozess getrennt. N
Prozesse vervielfachen das Kontingent jedes Aufrufers daher um den Faktor N, ohne dass ein Log-Eintrag
darauf hinweist. Setzen Sie `REBASE_RATE_LIMIT_STORE=sql` auf jedem Prozess, der HTTP bereitstellt – dieser
zählt in Postgres, sodass das Limit unabhängig von der Anzahl der Replikas eingehalten wird.
(Das Helm-Chart konfiguriert dies automatisch und verweigert das Rendern einer Multi-Prozess-Topologie,
die auf `memory` belassen wurde.)

**Instanzübergreifende Kanäle.** Broadcast und Presence nutzen standardmäßig einen In-Memory-Bus,
der nicht prozessübergreifend arbeitet. Dies ist eine Frage der *Replika-Anzahl* und nicht
der Prozessaufteilung – es gilt gleichermaßen für ein Deployment mit nur einer Rolle,
das auf drei Instanzen skaliert ist. Setzen Sie daher `REALTIME_CHANNEL_BUS=postgres` (oder `realtime.bus` in
der Konfiguration), wann immer mehr als ein Prozess WebSockets bedient.

**Scale-to-Zero.** Keine der hier beschriebenen Funktionen skaliert einen Prozess auf null herunter oder startet einen
bei Bedarf. Das ist eine Eigenschaft der Hosting-Plattform, nicht der Runtime.

Alles Weitere, was ein Prozess für sich behält, ist in dieser Übersicht aufgeführt:
[Mehrere Instanzen ausführen](/docs/deployment/multiple-instances/).

## Eine einzelne Einheit separat releasen

Alles oben Beschriebene teilt auf, *wo die Arbeit ausgeführt wird*. Das gesamte System wird weiterhin als ein
Build ausgeliefert: ein Image, ein Bundle, gemeinsam ausgerollt. Das ist der richtige Standardwert, und die
meisten Deployments sollten dabei bleiben.

Eine Einheit kann jedoch auch auf einem eigenen Build gehalten werden – etwa ein Bugfix in einer Funktion, der
keinen Neustart der API erfordert:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.30.1"     # this unit only; the rest stay on the release-wide tag
```

Normalerweise lohnt es sich nur, das Tag festzupinnen: Das Repository wird übernommen, es handelt sich also um
ein Projekt und ein Image, bei dem lediglich eine Einheit geändert wurde. `bundleUrl` erfüllt denselben Zweck,
wenn `bundle.mode: url` verwendet wird.

### Die Regel

Zwei Einheiten auf unterschiedlichen Builds bedeuten zwei Tabellenmengen gegenüber **einer**
Datenbank, und nur eine Einheit migriert diese. Daher gilt:

> **Die Einheit, die das Schema verwaltet, wird zuerst aktualisiert. Eine Einheit darf hinterherhinken; sie darf niemals
> vorauseilen.**

Das ist der Migrations-Job oder die `api`, wenn der Job deaktiviert ist. Eine Einheit, die dem
Schema *voraus* ist, fragt Spalten ab, die noch nicht existieren, und verlässt sich auf RLS-Richtlinien,
die noch niemand angewendet hat – Ersteres führt zu einem SQL-Fehler auf einer Route, Letzteres zu einem
leeren Ergebnis mit Status 200. Eine Einheit, die *hinterherhinkt*, entspricht dem normalen Zustand jedes
laufenden Rollouts.

### Wie dies überprüft wird

Der Prozess, der die Migration durchführt, speichert die angewendete Schemaversion in der
Datenbank. Jeder andere Prozess berechnet seine eigene Version anhand der geladenen Tabellen und
vergleicht sie. Bei einer Abweichung weist er darauf hin und nennt beide:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v2:6f2a…, this process v2:91cd…).
```

Er warnt und setzt den Betrieb fort, denn während eines Rollouts ist diese Abweichung *vorgesehen* –
die Einheiten, die noch nicht aktualisiert wurden, sollen hinterherhinken. Setzen Sie
`REBASE_REQUIRE_SCHEMA_MATCH=true` (oder `sharedState.requireSchemaMatch` im
Chart), um den Start stattdessen zu verweigern, falls ein Deployment im Zweifelsfall lieber
gar nicht als fehlerhaft arbeiten soll.

Beide Seiten dieses Vergleichs werden **berechnet** und niemals aus einem Manifest ausgelesen. Eine
Version, die ein Build über sich selbst deklariert, ist kein Beweis dafür, dass die Datenbank damit übereinstimmt.

Es gibt keine Prüfung der *Richtung* – eine Schemaversion ist ein Hash; sie kann also anzeigen, dass
zwei Versionen voneinander abweichen, aber niemals, welche davon neuer ist. Aus diesem Grund ist die Rollout-Reihenfolge eine
Regel, die Sie einhalten müssen, und keine, die die Runtime erzwingen kann.

## Upgrades

Unverändert: Jeder Prozess führt dasselbe veröffentlichte Image aus, daher entspricht ein Upgrade derselben
Tag-Änderung bei jedem von ihnen. Aktualisieren Sie den Prozess, der das Schema verwaltet – die `api`
oder den Migrations-Job – zuerst, damit das Schema der neuen Version vorhanden ist, bevor
die anderen Prozesse darauf zugreifen: Eine Einheit darf hinterherhinken, niemals vorauseilen (siehe
[Die Regel](#die-regel)).

## Verwandte Themen

- [Deployment-Leitfaden](/docs/getting-started/deployment/) – das Single-Process-Deployment, das hier aufgeteilt wird
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` und `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) – ein Deployment pro Rolle

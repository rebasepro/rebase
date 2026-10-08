---
sourceHash: d7e22a508527032c
title: Mehr als eine Instanz ausführen
sidebar_label: Mehr als eine Instanz
description: Jedes Stück Zustand, das ein Rebase-Prozess für sich behält, und die Einstellung, die es teilt — was zu setzen ist, bevor eine zweite Replik, ein Rolling Deployment oder ein aufgeteiltes Deployment Traffic übernimmt.
---

## Übersicht

Der Großteil eines Rebase-Deployments lebt bereits in der Datenbank: Zeilen, Benutzer und Sessions,
API-Schlüssel, die Job-Warteschlange, Cron-Claims, Idempotency-Keys, die Entitätshistorie, die
Tokens des MCP-OAuth-Servers. Ein zweiter Prozess, der auf dieselbe Datenbank zeigt, sieht all das.

Ein paar Dinge tun das nicht. Jedes davon ist standardmäßig pro Prozess, weil ein einzelner Prozess
das Standard-Deployment ist und Teilen etwas kostet — eine Tabelle, einen Bucket-Schreibvorgang, eine
Datenbankverbindung. Zwei Prozesse hinter einem Load Balancer zu betreiben, über einen hinaus zu
autoskalieren, oder ein Rolling Deployment, das kurzzeitig die alte und die neue Version nebeneinander
laufen lässt, bringen Sie alle auf diese Seite. Ebenso ein
[aufgeteiltes Deployment](/docs/deployment/split-processes/), das per Definition aus mehreren
Prozessen besteht.

Gehen Sie die folgende Liste durch, bevor die zweite Instanz Traffic übernimmt. Nichts darauf
schlägt laut fehl: Jeder Punkt äußert sich als ein Limit, das dreifach durchgesetzt wird, als ein
Ereignis, das manche Clients nie sehen, oder als eine Seite, die bei jedem Neuladen andere Logs zeigt.

## Die Checkliste

| Was | Standardmäßig pro Prozess | Was es teilt |
| --- | --- | --- |
| Signierungs-Secrets | In der Entwicklung pro Prozess generiert | `JWT_SECRET` und `REBASE_SERVICE_KEY`, explizit gesetzt und **überall identisch** |
| Rate-Limit-Zähler | Im Arbeitsspeicher | `REBASE_RATE_LIMIT_STORE=sql` |
| Client-Adresse hinter einem Proxy | `TRUSTED_PROXY_HOPS=0` | Die Anzahl der vorgeschalteten Proxys, überall gleich |
| Collection-Abonnements | Über die Datenbank geteilt, wenn CDC aktiv ist | `REALTIME_CDC=auto` (Standard) |
| Broadcast-Kanäle und Presence | Im Arbeitsspeicher | `REALTIME_CHANNEL_BUS=postgres` |
| Hochgeladene Dateien, `STORAGE_TYPE=local` | Die eigene Festplatte der Instanz | S3 oder GCS, oder ein gemeinsames Volume unter `STORAGE_PATH` |
| Laufende fortsetzbare (TUS) Uploads | Arbeitsspeicher und Festplatte der Instanz | Sticky Sessions; ein Neustart verliert sie trotzdem |
| Bild-Transformationen | Ein prozessinterner Cache | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Ein Ring der letzten 10.000 Zeilen | Nichts — leiten Sie stdout an einen Log-Aggregator weiter |
| Cron-Timer | Jeder Prozess, der den Scheduler ausführt | In der Datenbank beansprucht: ein Lauf pro Slot. `REBASE_CRON_SCHEDULER` legt fest, wo Timer leben |
| Geplanter RLS-Audit | Jeder Prozess, der ihn besitzt | `REBASE_RLS_AUDIT=false` auf allen außer einem |
| Das `index.html` einer statischen App | Pro Prozess einmal gelesen | Jede Instanz neu starten, wenn sich der Build ändert |
| `/metrics` | Jeder Prozess zählt sich selbst | Jede Instanz abfragen (scrapen) |

Die folgenden Abschnitte beschreiben, was jeweils passiert, wenn etwas auf „pro Prozess“ belassen wird.

## Signierungs-Secrets

`JWT_SECRET` signiert jede Session, und `REBASE_SERVICE_KEY` authentifiziert Server-zu-Server-Aufrufe.
In der Entwicklung generiert jeder Prozess seinen eigenen Wert, wenn sie nicht gesetzt sind, sodass ein
Token, das ein Prozess ausgestellt hat, vom nächsten abgelehnt wird. Die Produktion verweigert ohnehin
den Start ohne sie; bei mehreren Prozessen kommt es darauf an, dass jeder die **gleichen** Werte
erhält — aus einem Secret, nicht aus einem pro Replik.

## Rate-Limits und die Client-Adresse

Die Rate-Limiter — das Budget pro Aufrufer auf den Daten-, Storage- und Functions-APIs sowie die
Auth-Limiter bei Anmeldung, Passwort-Reset, Einmalcodes und MFA-Versuchen — zählen standardmäßig im
Arbeitsspeicher. Ein Prozess kann nicht sehen, wie viele Peers er hat, daher setzen drei Repliken auf
dem Standardwert jedes Limit dreifach durch. Setzen Sie `REBASE_RATE_LIMIT_STORE=sql`, damit die
Zähler stattdessen in der Datenbank leben.

Hinter einem Load Balancer braucht der Limiter außerdem die echte Client-Adresse, die in
`X-Forwarded-For` ankommt. `TRUSTED_PROXY_HOPS` gibt an, wie viele Proxys zu überspringen sind; beim
Standardwert `0` scheint jede Anfrage vom Load Balancer zu kommen, und alle Clients teilen sich einen
Bucket. Siehe [Konfiguration](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

**Collection-Abonnements** funktionieren instanzübergreifend, wenn die Change Capture auf
Datenbankebene aktiv ist, was standardmäßig der Fall ist (`REALTIME_CDC=auto`): Ein Trigger kündigt
jeden committeten Schreibvorgang an, und der Listener jeder Instanz führt für ihre eigenen Abonnenten
ein Refetch durch. Ist CDC aus, oder konnte `auto` es nicht bereitstellen (das Boot-Log nennt den
Grund), sieht ein Abonnement nur die Schreibvorgänge, die über die Instanz erfolgt sind, mit der sein
Socket verbunden ist. Siehe [Realtime](/docs/backend/realtime/#database-level-change-capture-cdc).

**Broadcast-Kanäle und Presence** laufen prozessintern, sofern kein Bus sie trägt: Zwei Clients auf
unterschiedlichen Instanzen im selben Channel hören sich nicht, und jede Instanz beantwortet „Wer ist
da?“ nur mit ihrer eigenen Hälfte. Setzen Sie `REALTIME_CHANNEL_BUS=postgres`. Der Bus lauscht auf der
Datenbank, was eine direkte Verbindung statt eines Transaktions-Poolers erfordert — setzen Sie
`DATABASE_DIRECT_URL`, wenn `DATABASE_URL` über pgBouncer läuft. Siehe
[Channels und Presence über Instanzen hinweg](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Dateien

Mit `STORAGE_TYPE=local` sind Uploads Dateien auf der Festplatte der Instanz, die sie empfangen hat,
und eine andere Instanz beantwortet sie mit 404. Verwenden Sie S3 oder GCS, oder mounten Sie ein
gemeinsames Volume unter `STORAGE_PATH` auf jeder Instanz. Siehe
[Self-Hosting: Dateispeicher](/docs/deployment/self-hosting/#file-storage).

**Fortsetzbare Uploads** (der TUS-Endpunkt) halten die Teildatei jedes Uploads und ihren Zustand auf
der lokalen Festplatte der Instanz, die ihn angelegt hat, unter `STORAGE_PATH/.tus-uploads` — selbst
wenn fertige Dateien nach S3 oder GCS gehen. Ein Chunk, der auf einer anderen Instanz landet, wird mit
404 beantwortet, und der Client startet erneut. Leiten Sie die Upload-Anfragen eines Clients an eine
Instanz weiter (Sticky Sessions auf dem Load Balancer). Ein gemeinsames Volume unter `STORAGE_PATH`
teilt die Teildateien, aber noch nicht den Upload-Zustand, der im Arbeitsspeicher des Prozesses liegt
— ein Neustart oder ein Rolling Deployment schickt einen laufenden Upload daher ebenfalls zurück auf
Byte 0. Gewöhnliche Uploads über `POST /upload` sind eine einzelne Anfrage und davon nicht betroffen.

**Bild-Transformationen** (`?width=400&format=webp`) werden im Arbeitsspeicher zwischengespeichert,
sodass jede Instanz jede Variante einmal berechnet und eine neue Instanz kalt startet. Setzen Sie
`STORAGE_RENDITION_CACHE=true`, damit jede Rendition zurück in den Bucket geschrieben wird, aus dem
sie kam, wo jede Instanz sie findet. Das lässt ein `GET` in Ihren Bucket schreiben, weshalb dies
standardmäßig aus ist, sofern nicht angefordert. Siehe [Storage](/docs/backend/storage/).

## Logs Explorer

Studios Logs Explorer liest einen Ring der letzten 10.000 Log-Zeilen, die der Prozess hält, der die
Anfrage bedient. Hinter einem Load Balancer kann jedes Neuladen die Zeilen einer anderen Instanz
zeigen, und keine davon zeigt das gesamte Deployment.
Der Explorer nennt die Instanz, die er anzeigt.
Es gibt keine Einstellung, die den Ring teilt: Die
Runtime schreibt in der Produktion eine JSON-Zeile pro Ereignis nach stdout, und das ist es, was Sie
sammeln sollten — der Log-Dienst Ihrer Plattform, Loki, oder alles, was Container-Output liest.

## Cron und die Job-Warteschlange

Jeder Prozess, der den Cron-Scheduler ausführt, stellt seine eigenen Timer, und der Lauf wird zuerst
in der Datenbank beansprucht, sodass ein Slot **genau einmal** läuft, egal wie viele Prozesse dafür
feuern. Das Pausieren eines Jobs und die Lease, die einen manuellen Trigger von einem laufenden
Durchlauf abhält, werden auf dieselbe Weise geteilt. Nichts zu setzen, solange die Datenbank Postgres
ist. `REBASE_CRON_SCHEDULER` und `REBASE_JOB_WORKERS` entscheiden, welche Prozesse überhaupt Timer und
Worker ausführen — siehe [Split Processes](/docs/deployment/split-processes/).

Der geplante RLS-Audit ist die Ausnahme: Er wird nicht beansprucht, daher scannt jeder Prozess, der
ihn besitzt, auf seinem eigenen Timer. Das ist redundant, aber nicht unsicher; setzen Sie
`REBASE_RLS_AUDIT=false` überall außer auf einem.

## Statische Apps

Ein Prozess, der das Frontend oder das CMS ausliefert (`REBASE_SERVE_STATIC`, standardmäßig an),
liest das `index.html` jeder App einmal und behält es. Den Build auf einem gemeinsamen Volume zu
ersetzen, erreicht einen laufenden Prozess nicht: Er liefert weiterhin das alte Dokument aus, das
Chunks benennt, die möglicherweise nicht mehr existieren. Verteilen Sie einen neuen Build, indem Sie
jede Instanz neu starten oder rollen — was ein neues Image oder Bundle ohnehin tut. Mit einem CDN
davor und `REBASE_SERVE_STATIC=false` gilt dies nicht.

## Metriken

`/metrics` berichtet über den Prozess, der antwortet. Fragen Sie jede Instanz einzeln ab (scrapen) —
ein Prometheus-Service-Discovery-Job pro Pod, nicht ein einzelnes Ziel hinter dem Load Balancer — und
summieren Sie in der Abfrage.

## Boot-Provisionierung

Jede Instanz führt beim Start den additiven Schema-Durchlauf aus (`REBASE_MIGRATE_ON_BOOT=ensure`).
Instanzen derselben Rolle dürfen dies gleichzeitig tun: Der Code ist darauf ausgelegt, zu tolerieren,
dass ein Peer dieselbe Tabelle einen Moment zuvor erstellt hat. Bei einem aufgeteilten Deployment
stellt genau eine Rolle bereit, und jede andere setzt `none` — siehe
[Split Processes](/docs/deployment/split-processes/).

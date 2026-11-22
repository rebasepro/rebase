---
sourceHash: 079933126e9be226
title: Mehrere Instanzen ausführen
sidebar_label: Mehrere Instanzen
description: Jeder Status, den ein Rebase-Prozess für sich behält, und die Einstellung, die ihn teilt – was konfiguriert werden muss, bevor ein zweites Replikat, ein Rolling Deployment oder ein Split Deployment Traffic übernimmt.
---

## Übersicht

Der Großteil eines Rebase-Deployments befindet sich bereits in der Datenbank: Zeilen, Benutzer und Sitzungen, API-Schlüssel, die Job-Warteschlange (Job Queue), Cron-Claims, Idempotenz-Schlüssel, die Datensatz-Historie sowie die Tokens des MCP-OAuth-Servers. Ein zweiter Prozess, der auf dieselbe Datenbank verweist, sieht all dies.

Einige Dinge tun das nicht. Diese sind standardmäßig pro Prozess isoliert, da ein einzelner Prozess das Standard-Deployment darstellt und das Teilen Ressourcen kostet – eine Tabelle, ein Bucket-Schreibvorgang, eine Datenbankverbindung. Wenn Sie zwei Prozesse hinter einem Load Balancer betreiben, auf mehr als eine Instanz hochskalieren (Autoscaling) oder ein Rolling Deployment durchführen, bei dem alte und neue Versionen kurzzeitig nebeneinander laufen, betrifft Sie diese Seite. Dasselbe gilt für ein [Split Deployment](/docs/deployment/split-processes/), das per Definition aus mehreren Prozessen besteht.

Gehen Sie die folgende Liste durch, bevor die zweite Instanz Traffic übernimmt. Keiner dieser Punkte führt zu offensichtlichen Fehlern: Jeder Punkt äußert sich eher darin, dass ein Limit dreifach angewendet wird, ein Event von manchen Clients nie empfangen wird oder eine Seite bei jedem Aktualisieren andere Logs anzeigt.

## Die Checkliste

| Was | Standardmäßig pro Prozess | Wie es geteilt wird |
| --- | --- | --- |
| Signatur-Secrets | In der Entwicklung pro Prozess generiert | `JWT_SECRET` und `REBASE_SERVICE_KEY`, explizit gesetzt und überall **identisch** |
| Rate-Limit-Zähler | Im Speicher (In-Memory) | `REBASE_RATE_LIMIT_STORE=sql` |
| Client-Adresse hinter einem Proxy | `TRUSTED_PROXY_HOPS=0` | Die Anzahl der vorgeschalteten Proxys, überall identisch |
| Tabellen-Abonnements (Subscriptions) | Über die Datenbank geteilt, wenn CDC aktiv ist | `REALTIME_CDC=auto` (Standard) |
| Broadcast-Kanäle und Presence | Im Speicher (In-Memory) | `REALTIME_CHANNEL_BUS=postgres` |
| Hochgeladene Dateien, `STORAGE_TYPE=local` | Die eigene Festplatte der Instanz | S3 oder GCS oder ein geteiltes Volume auf dem übergeordneten Verzeichnis von `STORAGE_PATH` |
| Laufende fortsetzbare (TUS) Uploads | Die Festplatte der Instanz unter `STORAGE_PATH/.tus-uploads` | Ein geteiltes Volume unter `STORAGE_PATH` oder Sticky Sessions |
| Bildtransformationen | Ein In-Process-Cache | `STORAGE_RENDITION_CACHE=true` |
| Log-Ansicht im Studio | Ein Ringpuffer der letzten 10.000 Zeilen | Nichts – leiten Sie stdout an einen Log-Aggregator weiter |
| Cron-Timer | Jeder Prozess, der den Scheduler ausführt | In der Datenbank beansprucht: eine Ausführung pro Slot. `REBASE_CRON_SCHEDULER` bestimmt, wo die Timer laufen |
| Geplantes RLS-Audit | Jeder Prozess, dem es zugewiesen ist | `REBASE_RLS_AUDIT=false` auf allen außer einem |
| `index.html` einer statischen App | Einmal pro Prozess eingelesen | Jede Instanz neu starten, wenn sich der Build ändert |
| `/metrics` | Jeder Prozess zählt seine eigenen | Jede Instanz scrapen |

Die folgenden Abschnitte beschreiben, was passiert, wenn ein Punkt pro Prozess belassen wird.

## Signatur-Secrets

`JWT_SECRET` signiert jede Sitzung und `REBASE_SERVICE_KEY` authentifiziert Server-zu-Server-Aufrufe. In der Entwicklung generiert jeder Prozess seine eigenen Schlüssel, wenn sie nicht gesetzt sind, sodass ein von einem Prozess ausgestelltes Token vom nächsten abgelehnt wird. Im Produktivbetrieb wird der Start ohne `JWT_SECRET` bereits verweigert (ohne `REBASE_SERVICE_KEY` startet das System komplett ohne Service-Key). Bei mehreren Prozessen kommt es darauf an, dass jeder die **gleichen** Werte erhält – aus einem einzigen Secret, nicht einem pro Replikat.

## Rate-Limits und die Client-Adresse

Die Rate-Limiter – das Budget pro Aufrufer für die Data-, Storage- und Functions-APIs sowie die Auth-Limiter für Anmeldung, Passwort-Reset, Einmalcodes und MFA-Versuche – zählen standardmäßig im Arbeitsspeicher. Ein Prozess kann nicht sehen, wie viele Peers er hat, sodass drei Replikate bei den Standardeinstellungen jedes Limit dreimal durchsetzen. Setzen Sie `REBASE_RATE_LIMIT_STORE=sql`, damit die Zähler stattdessen in der Datenbank gespeichert werden.

Hinter einem Load Balancer benötigt der Limiter außerdem die echte Client-Adresse, die im Header `X-Forwarded-For` ankommt. `TRUSTED_PROXY_HOPS` gibt an, an wie vielen Proxys vorbeigeschaut werden soll; beim Standardwert `0` scheint jede Anfrage vom Load Balancer zu stammen, und alle Clients teilen sich ein einziges Kontingent. Siehe [Konfiguration](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

**Tabellen-Abonnements (Table Subscriptions)** funktionieren über Instanzen hinweg, wenn Change Data Capture auf Datenbankebene aktiviert ist, was standardmäßig der Fall ist (`REALTIME_CDC=auto`): Das Write-Ahead-Log (sofern die Datenbank logisches Decodieren erlaubt) oder ein Trigger kündigt jeden committeten Schreibvorgang an, und der Listener jeder Instanz ruft die Daten für seine eigenen Abonnenten erneut ab. Instanzen mit WAL-Erfassung belassen die Trigger, solange noch irgendeine Instanz auf sie lauscht, sodass ein Replikat, das auf Trigger zurückgegriffen hat, nie taub bleibt. Wenn CDC deaktiviert ist oder `auto` es nicht bereitstellen konnte (das Boot-Log gibt darüber Auskunft), sieht ein Abonnement nur die Schreibvorgänge, die über die Instanz getätigt wurden, mit der sein Socket verbunden ist. Siehe [Realtime](/docs/backend/realtime-cdc/).

**Broadcast-Kanäle und Presence** verbleiben prozessintern, es sei denn, ein Bus überträgt sie: Zwei Clients auf verschiedenen Instanzen im selben Kanal hören sich gegenseitig nicht, und jede Instanz beantwortet die Frage „Wer ist hier?“ nur mit ihrer eigenen Hälfte. Setzen Sie `REALTIME_CHANNEL_BUS=postgres`. Der Bus lauscht auf der Datenbank, was eine direkte Verbindung anstelle eines Transaction-Poolers erfordert – setzen Sie `DATABASE_DIRECT_URL`, wenn `DATABASE_URL` über pgBouncer läuft. Siehe [Kanäle und Presence über Instanzen hinweg](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Dateien

Mit `STORAGE_TYPE=local` sind Uploads Dateien auf der Festplatte der Instanz, die sie empfangen hat, und eine andere Instanz gibt für diese einen 404-Fehler zurück. Verwenden Sie S3 oder GCS oder mounten Sie ein gemeinsames Volume auf jeder Instanz über dem übergeordneten Verzeichnis von `STORAGE_PATH`, sodass es auch das Verzeichnis `<STORAGE_PATH>__<key>` jedes benannten lokalen Buckets enthält. Siehe [Self-Hosting: Dateispeicher](/docs/deployment/self-hosting/#file-storage).

**Fortsetzbare Uploads** (der TUS-Endpunkt) speichern die Teildatei jedes Uploads und einen Datensatz des Uploads daneben auf der Festplatte der Instanz, die ihn erstellt hat, unter `STORAGE_PATH/.tus-uploads` – selbst wenn fertige Dateien an S3 oder GCS gesendet werden. Mounten Sie ein gemeinsames Volume unter `STORAGE_PATH` auf jeder Instanz, damit jede Instanz jeden Upload bedienen kann; ein Neustart oder ein Rolling Deploy setzt einen Upload dort fort, wo er unterbrochen wurde. Ohne ein gemeinsam genutztes Volume wird ein Chunk, der auf einer anderen Instanz landet, mit 404 beantwortet: Leiten Sie die Upload-Anfragen eines Clients an dieselbe Instanz weiter (Sticky Sessions auf dem Load Balancer). Das SDK und das Admin-Panel, die diesen Endpunkt für Dateien über 8 MiB nutzen, senden die Datei stattdessen per `POST /upload` und behalten dies für den Rest der Sitzung bei. Reguläre Uploads über `POST /upload` bestehen aus einer einzelnen Anfrage und sind nicht betroffen.

**Bildtransformationen** (`?width=400&format=webp`) werden im Arbeitsspeicher zwischengespeichert, sodass jede Instanz jede Variante einmal berechnet und eine neue Instanz ohne Cache startet. Setzen Sie `STORAGE_RENDITION_CACHE=true`, um jedes generierte Bild (Rendition) zurück in das ursprüngliche Bucket zu schreiben, wo jede Instanz darauf zugreifen kann. Dadurch führt ein `GET` zu einem Schreibvorgang in Ihrem Bucket, weshalb dies standardmäßig deaktiviert ist, sofern es nicht explizit aktiviert wird. Siehe [Storage](/docs/backend/storage/).

## Log-Ansicht im Studio

Die Log-Ansicht im Studio liest einen Ringpuffer der letzten 10.000 Logzeilen aus, die von dem Prozess vorgehalten werden, der die Anfrage verarbeitet. Hinter einem Load Balancer kann bei jeder Aktualisierung die Ausgabe einer anderen Instanz angezeigt werden, und keine davon zeigt das gesamte Deployment. Der Explorer nennt die Instanz, die er gerade anzeigt. Es gibt keine Einstellung, um diesen Ringpuffer zu teilen: Die Runtime schreibt im Produktivbetrieb eine JSON-Zeile pro Ereignis nach stdout, und genau das sollte gesammelt werden – über den Protokolldienst Ihrer Plattform, Loki oder jedes andere Tool, das Container-Ausgaben erfasst.

## Cron und die Job-Warteschlange

Jeder Prozess, der den Cron-Scheduler ausführt, aktiviert seine eigenen Timer. Der Lauf wird jedoch zuerst in der Datenbank beansprucht (claimed), sodass ein Slot genau **einmal** ausgeführt wird – unabhängig davon, wie viele Prozesse dafür auslösen. Das Pausieren eines Jobs und der Lease, der verhindert, dass ein manueller Trigger einen laufenden Job stört, werden auf die gleiche Weise geteilt. Hier muss nichts konfiguriert werden, solange die Datenbank Postgres ist. `REBASE_CRON_SCHEDULER` und `REBASE_JOB_WORKERS` entscheiden, welche Prozesse überhaupt Timer und Worker ausführen – siehe [Split-Prozesse](/docs/deployment/split-processes/).

Das geplante RLS-Audit ist die Ausnahme: Es wird nicht in der Datenbank beansprucht, sodass jeder zuständige Prozess nach seinem eigenen Timer scannt. Das ist eher redundant als unsicher; setzen Sie `REBASE_RLS_AUDIT=false` auf allen Instanzen außer einer.

## Statische Apps

Ein Prozess, der das Frontend oder das CMS ausliefert (`REBASE_SERVE_STATIC`, standardmäßig aktiviert), liest die `index.html` jeder App einmal ein und behält sie im Speicher. Das Ersetzen des Builds auf einem gemeinsamen Volume erreicht keinen laufenden Prozess: Er liefert weiterhin das alte Dokument aus, das Chunks referenziert, die möglicherweise nicht mehr existieren. Veröffentlichen Sie einen neuen Build, indem Sie jede Instanz neu starten oder rollierend aktualisieren – was bei einem neuen Image oder Bundle ohnehin geschieht. Mit einem vorgeschalteten CDN und `REBASE_SERVE_STATIC=false` gilt dies nicht.

## Metriken

`/metrics` liefert die Daten des Prozesses, der die Anfrage beantwortet. Scrapen Sie jede Instanz – über einen Prometheus-Service-Discovery-Job pro Pod, nicht als einzelnes Ziel hinter dem Load Balancer – und aggregieren Sie die Summe in der Abfrage.

## Boot-Provisionierung

Jede Instanz führt beim Start den additiven Schemadurchlauf aus (`REBASE_MIGRATE_ON_BOOT=ensure`). Instanzen mit derselben Rolle können diesen gleichzeitig ausführen: Er ist so konzipiert, dass er toleriert, wenn ein Peer dieselbe Tabelle einen Moment zuvor erstellt hat. In einem Split Deployment führt genau eine Rolle die Provisionierung durch und alle anderen setzen den Wert auf `none` – siehe [Split-Prozesse](/docs/deployment/split-processes/).

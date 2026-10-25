---
sourceHash: 88050e5f44c6457a
title: Mehrere Instanzen ausführen
sidebar_label: Mehrere Instanzen
description: Jeder Zustand, den ein Rebase-Prozess für sich behält, und die Einstellung, die ihn teilt – was konfiguriert werden muss, bevor ein zweites Replikat, ein Rolling Deploy oder ein Split-Deployment Traffic übernimmt.
---

## Übersicht

Der Großteil eines Rebase-Deployments befindet sich bereits in der Datenbank: Zeilen, Benutzer und Sitzungen, API-Schlüssel, die Job-Queue, Cron-Claims, Idempotenzschlüssel, der Datensatzverlauf, die Tokens des MCP-OAuth-Servers. Ein zweiter Prozess, der auf dieselbe Datenbank verweist, sieht all dies.

Einige Dinge tun dies nicht. Jedes davon ist standardmäßig pro Prozess isoliert, da ein einzelner Prozess das Standard-Deployment darstellt und das Teilen Ressourcen kostet – eine Tabelle, einen Bucket-Schreibvorgang, eine Datenbankverbindung. Wenn Sie zwei Prozesse hinter einem Load Balancer ausführen, über eine Instanz hinaus autoskalieren oder ein Rolling Deploy durchführen, bei dem die alte und neue Version kurzzeitig nebeneinander laufen, führt Sie all das auf diese Seite. Dasselbe gilt für ein [Split-Deployment](/docs/deployment/split-processes/), das per Definition aus mehreren Prozessen besteht.

Gehen Sie die folgende Liste durch, bevor die zweite Instanz Traffic übernimmt. Keiner dieser Punkte führt zu einem lauten Fehler: Jeder Punkt äußert sich stattdessen als dreifach durchgesetztes Limit, ein Event, das manche Clients nie sehen, oder eine Seite, die bei jedem Neuladen andere Logs anzeigt.

## Die Checkliste

| Was | Standardmäßig pro Prozess | Wodurch geteilt |
| --- | --- | --- |
| Signaturschlüssel | In der Entwicklung pro Prozess generiert | `JWT_SECRET` und `REBASE_SERVICE_KEY`, explizit gesetzt und überall **identisch** |
| Rate-Limit-Zähler | Im Speicher | `REBASE_RATE_LIMIT_STORE=sql` |
| Client-Adresse hinter einem Proxy | `TRUSTED_PROXY_HOPS=0` | Die Anzahl der vorgeschalteten Proxys, überall gleich |
| Collection-Abonnements | Über die Datenbank geteilt, wenn CDC aktiviert ist | `REALTIME_CDC=auto` (Standard) |
| Broadcast-Kanäle und Presence | Im Speicher | `REALTIME_CHANNEL_BUS=postgres` |
| Hochgeladene Dateien, `STORAGE_TYPE=local` | Die eigene Festplatte der Instanz | S3 oder GCS oder ein geteiltes Volume auf dem übergeordneten Verzeichnis von `STORAGE_PATH` |
| Laufende fortsetzbare (TUS-)Uploads | Festplatte der Instanz unter `STORAGE_PATH/.tus-uploads` | Ein geteiltes Volume unter `STORAGE_PATH` oder Sticky Sessions |
| Bildtransformationen | Ein prozessinterner Cache | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Ein Ringpuffer der letzten 10.000 Zeilen | Nichts – leiten Sie stdout an einen Log-Aggregator weiter |
| Cron-Timer | Jeder Prozess, der den Scheduler ausführt | In der Datenbank beansprucht: ein Lauf pro Slot. `REBASE_CRON_SCHEDULER` bestimmt, wo Timer laufen |
| Geplantes RLS-Audit | Jeder Prozess, der dafür zuständig ist | `REBASE_RLS_AUDIT=false` auf allen außer einer Instanz |
| Die `index.html` einer statischen App | Einmal pro Prozess gelesen | Starten Sie jede Instanz neu, wenn sich der Build ändert |
| `/metrics` | Jeder Prozess zählt seine eigenen | Scrapen Sie jede Instanz |

Die folgenden Abschnitte beschreiben, was die einzelnen Punkte bewirken, wenn sie pro Prozess belassen werden.

## Signaturschlüssel

`JWT_SECRET` signiert jede Sitzung und `REBASE_SERVICE_KEY` authentifiziert Server-zu-Server-Aufrufe. In der Entwicklung generiert jeder Prozess seine eigenen, wenn sie nicht gesetzt sind, sodass ein von einem Prozess ausgestelltes Token vom nächsten abgelehnt wird. In der Produktion verweigert das System den Start bereits ohne `JWT_SECRET` (ohne `REBASE_SERVICE_KEY` startet es ganz ohne Service-Key); bei mehreren Prozessen kommt es darauf an, dass jeder die **gleichen** Werte erhält – aus einem Secret, nicht einem pro Replikat.

## Rate-Limits und die Client-Adresse

Die Rate-Limiter – das Budget pro Aufrufer für die Daten-, Speicher- und Funktions-APIs sowie die Auth-Limiter für Anmeldung, Passwort-Reset, Einmalcodes und MFA-Versuche – zählen standardmäßig im Arbeitsspeicher. Ein Prozess kann nicht erkennen, wie viele Peers er hat, sodass drei Replikate bei Standardeinstellungen jedes Limit dreimal durchsetzen. Setzen Sie `REBASE_RATE_LIMIT_STORE=sql`, damit die Zähler stattdessen in der Datenbank verwaltet werden.

Hinter einem Load Balancer benötigt der Limiter außerdem die echte Client-Adresse, die im Header `X-Forwarded-For` übermittelt wird. `TRUSTED_PROXY_HOPS` gibt an, wie viele Proxys übersprungen werden sollen; beim Standardwert `0` scheint jede Anfrage vom Load Balancer zu stammen, und alle Clients teilen sich ein einziges Bucket. Siehe [Konfiguration](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

**Collection-Abonnements** funktionieren instanzübergreifend, wenn Change Data Capture auf Datenbankebene aktiviert ist, was standardmäßig der Fall ist (`REALTIME_CDC=auto`): Ein Trigger kündigt jeden committeten Schreibvorgang an, und der Listener jeder Instanz ruft die Daten für seine eigenen Abonnenten erneut ab. Wenn CDC deaktiviert ist oder `auto` es nicht bereitstellen konnte (das Boot-Log gibt darüber Aufschluss), sieht ein Abonnement nur die Schreibvorgänge, die über die Instanz erfolgten, mit der sein Socket verbunden ist. Siehe [Realtime](/docs/backend/realtime-cdc/).

**Broadcast-Kanäle und Presence** sind prozessintern, sofern kein Bus sie überträgt: Zwei Clients auf verschiedenen Instanzen im selben Kanal hören einander nicht, und jede Instanz beantwortet die Frage „Wer ist hier?“ nur mit ihrer eigenen Hälfte. Setzen Sie `REALTIME_CHANNEL_BUS=postgres`. Der Bus lauscht auf der Datenbank, was eine direkte Verbindung anstelle eines Transaction-Poolers erfordert – setzen Sie `DATABASE_DIRECT_URL`, wenn `DATABASE_URL` über pgBouncer läuft. Siehe [Kanäle und Presence über mehrere Instanzen hinweg](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Dateien

Mit `STORAGE_TYPE=local` sind Uploads Dateien auf der Festplatte der Instanz, die sie empfangen hat, und eine andere Instanz antwortet mit 404 darauf. Verwenden Sie S3 oder GCS oder mounten Sie auf jeder Instanz ein Volume auf dem übergeordneten Verzeichnis von `STORAGE_PATH`, sodass es auch das Verzeichnis `<STORAGE_PATH>__<key>` jedes benannten lokalen Buckets enthält. Siehe [Self-Hosting: Dateispeicher](/docs/deployment/self-hosting/#file-storage).

**Fortsetzbare Uploads** (der TUS-Endpunkt) speichern die partielle Datei jedes Uploads und einen Datensatz des Uploads daneben auf der Festplatte der Instanz, die ihn erstellt hat, unter `STORAGE_PATH/.tus-uploads` – selbst wenn fertige Dateien nach S3 oder GCS übertragen werden. Mounten Sie ein Volume unter `STORAGE_PATH` auf jeder Instanz, und jede Instanz kann jeden Upload bedienen; ein Neustart oder ein Rolling Deploy setzt einen Upload dort fort, wo er unterbrochen wurde. Ohne ein geteiltes Volume wird ein Chunk, der auf einer anderen Instanz landet, mit 404 beantwortet: Leiten Sie die Upload-Anfragen eines Clients an dieselbe Instanz weiter (Sticky Sessions auf dem Load Balancer). Das SDK und das Admin-Panel, die diesen Endpunkt für Dateien über 8 MiB verwenden, senden die Datei dann stattdessen über `POST /upload` und behalten dies für den Rest der Sitzung bei. Reguläre Uploads über `POST /upload` umfassen nur eine Anfrage und sind nicht betroffen. Unter 0.23 befand sich der Upload-Zustand im Speicher des Prozesses, sodass ein geteiltes Volume nicht half und ein Neustart einen Upload wieder auf Byte 0 zurücksetzte.

**Bildtransformationen** (`?width=400&format=webp`) werden im Arbeitsspeicher zwischengespeichert, sodass jede Instanz jede Variante einmal berechnet und eine neue Instanz kalt startet. Setzen Sie `STORAGE_RENDITION_CACHE=true`, um jede Variante (Rendition) zurück in das Ursprungs-Bucket zu schreiben, wo jede Instanz darauf zugreifen kann. Dadurch führt ein `GET` zu einem Schreibvorgang in Ihr Bucket, weshalb dies standardmäßig deaktiviert ist, sofern es nicht explizit aktiviert wird. Siehe [Storage](/docs/backend/storage/).

## Logs Explorer

Der Logs Explorer von Studio liest einen Ringpuffer der letzten 10.000 Logzeilen, die von dem Prozess vorgehalten werden, der die Anfrage bedient. Hinter einem Load Balancer kann bei jedem Neuladen die Ausgabe einer anderen Instanz angezeigt werden, und keine davon zeigt das gesamte Deployment. Der Explorer nennt den Namen der Instanz, die er gerade anzeigt. Es gibt keine Einstellung, um diesen Ringpuffer zu teilen: Die Runtime schreibt in der Produktion eine JSON-Zeile pro Ereignis nach stdout, und genau das sollte erfasst werden – über den Protokolldienst Ihrer Plattform, Loki oder jedes andere Tool, das Container-Ausgaben liest.

## Cron und die Job-Queue

Jeder Prozess, der den Cron-Scheduler ausführt, aktiviert seine eigenen Timer, und der Durchlauf wird zuerst in der Datenbank beansprucht, sodass ein Slot genau **einmal** ausgeführt wird, egal wie viele Prozesse dafür auslösen. Das Pausieren eines Jobs und die Lease, die verhindert, dass ein manueller Trigger einen bereits laufenden Durchlauf stört, werden auf die gleiche Weise geteilt. Hier ist nichts weiter zu konfigurieren, solange die Datenbank Postgres ist. `REBASE_CRON_SCHEDULER` und `REBASE_JOB_WORKERS` entscheiden darüber, welche Prozesse überhaupt Timer und Worker ausführen – siehe [Split-Prozesse](/docs/deployment/split-processes/).

Das geplante RLS-Audit ist die Ausnahme: Es wird nicht vorab beansprucht, sodass jeder Prozess, der dafür zuständig ist, nach seinem eigenen Timer scannt. Das ist eher redundant als unsicher; setzen Sie `REBASE_RLS_AUDIT=false` auf allen Instanzen außer einer.

## Statische Apps

Ein Prozess, der das Frontend oder das CMS ausliefert (`REBASE_SERVE_STATIC`, standardmäßig aktiviert), liest die `index.html` jeder App einmal ein und behält sie im Speicher. Das Ersetzen des Builds auf einem geteilten Volume erreicht einen laufenden Prozess nicht: Er liefert weiterhin das alte Dokument aus, das Chunks referenziert, die möglicherweise nicht mehr existieren. Veröffentlichen Sie einen neuen Build, indem Sie jede Instanz neu starten oder ein Rolling Update durchführen – was bei einem neuen Image oder Bundle ohnehin geschieht. Mit einem vorgeschalteten CDN und `REBASE_SERVE_STATIC=false` trifft dies nicht zu.

## Metriken

Der Endpunkt `/metrics` gibt den Status des Prozesses zurück, der die Anfrage beantwortet. Scrapen Sie jede Instanz einzeln – ein Prometheus-Service-Discovery-Job pro Pod statt eines einzelnen Ziels hinter dem Load Balancer – und aggregieren Sie die Werte in der Abfrage.

## Boot-Provisionierung

Jede Instanz führt beim Start den additiven Schemalauf durch (`REBASE_MIGRATE_ON_BOOT=ensure`). Instanzen mit derselben Rolle können diesen gleichzeitig ausführen: Er ist so konzipiert, dass er toleriert, wenn ein Peer dieselbe Tabelle einen Moment zuvor erstellt hat. Bei einem Split-Deployment provisioniert genau eine Rolle und jede andere setzt `none` – siehe [Split-Prozesse](/docs/deployment/split-processes/).

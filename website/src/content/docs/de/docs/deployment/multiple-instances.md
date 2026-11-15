---
sourceHash: d156ac95aebe2dab
title: Ausführen mehrerer Instanzen
sidebar_label: Mehr als eine Instanz
description: Jeder Zustand, den ein Rebase-Prozess für sich behält, und die Einstellung, die ihn teilt – was konfiguriert werden muss, bevor ein zweites Replikat, ein Rolling Deploy oder ein Split-Deployment Traffic übernimmt.
---

## Übersicht

Der Großteil eines Rebase-Deployments befindet sich bereits in der Datenbank: Zeilen, Benutzer und Sitzungen, API-Schlüssel, die Job-Queue, Cron-Claims, Idempotenzschlüssel, die Datensatz-Historie, die Tokens des MCP-OAuth-Servers. Ein zweiter Prozess, der auf dieselbe Datenbank zeigt, sieht all dies.

Einige Dinge tun dies nicht. Jedes davon gilt standardmäßig pro Prozess, da ein einzelner Prozess das Standard-Deployment ist und das Teilen Kosten verursacht – eine Tabelle, ein Bucket-Schreibvorgang, eine Datenbankverbindung. Wenn Sie zwei Prozesse hinter einem Load Balancer ausführen, über eine Instanz hinaus autoskalieren oder ein Rolling Deploy durchführen, bei dem die alte und neue Version kurzzeitig nebeneinander laufen, führt Sie all das auf diese Seite. Dasselbe gilt für ein [Split-Deployment](/docs/deployment/split-processes/), welches per Definition aus mehreren Prozessen besteht.

Gehen Sie die folgende Liste durch, bevor die zweite Instanz Traffic übernimmt. Nichts davon schlägt lautstark fehl: Jeder Punkt äußert sich als dreifach durchgesetztes Limit, ein Ereignis, das manche Clients nie sehen, oder eine Seite, die bei jedem Neuladen andere Logs anzeigt.

## Die Checkliste

| Was | Standardmäßig pro Prozess | Wodurch geteilt |
| --- | --- | --- |
| Signing Secrets | In der Entwicklung pro Prozess generiert | `JWT_SECRET` und `REBASE_SERVICE_KEY`, explizit gesetzt und überall **identisch** |
| Rate-Limit-Zähler | Im Arbeitsspeicher | `REBASE_RATE_LIMIT_STORE=sql` |
| Client-Adresse hinter einem Proxy | `TRUSTED_PROXY_HOPS=0` | Die Anzahl der vorgeschalteten Proxies, überall gleich |
| Tabellen-Abonnements | Über die Datenbank geteilt, wenn CDC aktiv ist | `REALTIME_CDC=auto` (Standard) |
| Broadcast-Kanäle und Presence | Im Arbeitsspeicher | `REALTIME_CHANNEL_BUS=postgres` |
| Hochgeladene Dateien, `STORAGE_TYPE=local` | Eigene Festplatte der Instanz | S3 oder GCS oder ein geteiltes Volume im übergeordneten Verzeichnis von `STORAGE_PATH` |
| Laufende fortsetzbare (TUS-)Uploads | Festplatte der Instanz unter `STORAGE_PATH/.tus-uploads` | Ein geteiltes Volume unter `STORAGE_PATH` oder Sticky Sessions |
| Bildtransformationen | Ein prozessinterner Cache | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Ein Ringpuffer der letzten 10.000 Zeilen | Nichts – stdout an einen Log-Aggregator weiterleiten |
| Cron-Timer | Jeder Prozess, der den Scheduler ausführt | In der Datenbank beansprucht: ein Lauf pro Slot. `REBASE_CRON_SCHEDULER` bestimmt, wo Timer liegen |
| Geplantes RLS-Audit | Jeder Prozess, der es besitzt | `REBASE_RLS_AUDIT=false` auf allen bis auf einer |
| `index.html` einer statischen App | Einmal pro Prozess gelesen | Jede Instanz neu starten, wenn sich der Build ändert |
| `/metrics` | Jeder Prozess zählt seine eigenen | Jede Instanz scrapen |

Die folgenden Abschnitte erläutern, was geschieht, wenn die Einstellungen jeweils pro Prozess belassen werden.

## Signing Secrets

`JWT_SECRET` signiert jede Session und `REBASE_SERVICE_KEY` authentifiziert Server-zu-Server-Aufrufe. In der Entwicklungsumgebung generiert jeder Prozess seine eigenen, wenn sie nicht gesetzt sind, sodass ein von einem Prozess ausgestelltes Token vom nächsten abgelehnt wird. Die Produktionsumgebung verweigert den Start ohne `JWT_SECRET` bereits (ohne `REBASE_SERVICE_KEY` startet sie ganz ohne Service-Key); bei mehreren Prozessen kommt es darauf an, dass jeder die **gleichen** Werte erhält – aus einem gemeinsamen Secret, nicht einem pro Replikat.

## Rate-Limits und die Client-Adresse

Die Rate-Limiter – das Budget pro Aufrufer für die Data-, Storage- und Functions-APIs sowie die Auth-Limiter bei Anmeldung, Passwort-Reset, Einmal-Codes und MFA-Versuchen – zählen standardmäßig im Arbeitsspeicher. Ein Prozess kann nicht sehen, wie viele Peers er hat, sodass drei Replikate bei den Standardeinstellungen jedes Limit dreifach durchsetzen. Setzen Sie `REBASE_RATE_LIMIT_STORE=sql`, damit die Zähler stattdessen in der Datenbank gespeichert werden.

Hinter einem Load Balancer benötigt der Limiter außerdem die echte Client-Adresse, die im Header `X-Forwarded-For` ankommt. `TRUSTED_PROXY_HOPS` gibt an, an wie vielen Proxies vorbeigeschaut werden soll; beim Standardwert `0` scheint jede Anfrage vom Load Balancer zu stammen und alle Clients teilen sich ein einziges Bucket. Siehe [Konfiguration](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

**Tabellen-Abonnements** funktionieren über Instanzen hinweg, wenn Change Data Capture auf Datenbankebene aktiviert ist, was standardmäßig der Fall ist (`REALTIME_CDC=auto`): Das Write-Ahead-Log (wo die Datenbank logisches Dekodieren erlaubt) oder ein Trigger kündigt jeden committeten Schreibvorgang an, und der Listener jeder Instanz ruft die Daten für seine eigenen Abonnenten erneut ab. Instanzen mit WAL-Capture belassen die Trigger so lange, wie irgendeine Instanz noch auf sie lauscht, sodass ein Replikat, das auf Trigger zurückgefallen ist, nie ungehört bleibt. Wenn CDC deaktiviert ist oder `auto` es nicht bereitstellen konnte (das Boot-Log gibt darüber Auskunft), sieht ein Abonnement nur die Schreibvorgänge, die über die Instanz getätigt wurden, mit der sein Socket verbunden ist. Siehe [Realtime](/docs/backend/realtime-cdc/).

**Broadcast-Kanäle und Presence** verbleiben prozessintern, sofern kein Bus sie überträgt: Zwei Clients auf unterschiedlichen Instanzen im selben Kanal hören einander nicht, und jede Instanz beantwortet die Frage „Wer ist hier?“ mit ihrer eigenen Hälfte. Setzen Sie `REALTIME_CHANNEL_BUS=postgres`. Der Bus lauscht auf der Datenbank, was eine direkte Verbindung statt eines Transaction-Poolers erfordert – setzen Sie `DATABASE_DIRECT_URL`, wenn `DATABASE_URL` über pgBouncer läuft. Siehe [Kanäle und Presence über Instanzen hinweg](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Dateien

Mit `STORAGE_TYPE=local` sind Uploads Dateien auf der Festplatte der Instanz, die sie empfangen hat, und eine andere Instanz antwortet für diese mit 404. Verwenden Sie S3 oder GCS oder mounten Sie auf jeder Instanz ein Volume auf dem übergeordneten Verzeichnis von `STORAGE_PATH`, damit es auch das Verzeichnis `<STORAGE_PATH>__<key>` jedes benannten lokalen Buckets enthält. Siehe [Self-Hosting: Dateispeicher](/docs/deployment/self-hosting/#file-storage).

**Fortsetzbare Uploads** (der TUS-Endpunkt) speichern die Teildatei jedes Uploads und einen Datensatz des Uploads daneben auf der Festplatte der Instanz, die ihn erstellt hat, unter `STORAGE_PATH/.tus-uploads` – selbst wenn fertige Dateien an S3 oder GCS gesendet werden. Mounten Sie ein Volume unter `STORAGE_PATH` auf jeder Instanz, und jede Instanz kann jeden Upload bedienen; ein Neustart oder ein Rolling Deploy setzt einen Upload an der Stelle fort, an der er gestoppt wurde. Ohne ein geteiltes Volume wird ein Chunk, der auf einer anderen Instanz landet, mit 404 beantwortet: Leiten Sie die Upload-Anfragen eines Clients an eine feste Instanz weiter (Sticky Sessions auf dem Load Balancer). Das SDK und das Admin-Panel, die diesen Endpunkt für Dateien über 8 MiB verwenden, senden die Datei stattdessen über `POST /upload` und behalten dies für den Rest der Session bei. Reguläre Uploads über `POST /upload` bestehen aus einer einzigen Anfrage und sind nicht betroffen.

**Bildtransformationen** (`?width=400&format=webp`) werden im Arbeitsspeicher zwischengespeichert, sodass jede Instanz jede Variante einmal berechnet und eine neue Instanz kalt startet. Setzen Sie `STORAGE_RENDITION_CACHE=true`, um jedes Rendition-Ergebnis zurück in das Bucket zu schreiben, aus dem es stammt, wo jede Instanz es finden kann. Dadurch führt ein `GET` zu einem Schreibvorgang in Ihr Bucket, weshalb dies standardmäßig deaktiviert ist, sofern es nicht explizit aktiviert wird. Siehe [Storage](/docs/backend/storage/).

## Logs Explorer

Der Logs Explorer von Studio liest einen Ringpuffer der letzten 10.000 Protokollzeilen, die von dem Prozess vorgehalten werden, der die Anfrage bedient. Hinter einem Load Balancer zeigt jedes Neuladen möglicherweise die Zeilen einer anderen Instanz, und keine davon zeigt das gesamte Deployment. Der Explorer nennt den Namen der Instanz, die er gerade anzeigt. Es gibt keine Einstellung, um diesen Ringpuffer zu teilen: Die Runtime schreibt in der Produktionsumgebung pro Ereignis eine JSON-Zeile nach stdout, und genau das sollte gesammelt werden – der Protokolldienst Ihrer Plattform, Loki oder jedes andere Tool, das Container-Ausgaben liest.

## Cron und die Job-Queue

Jeder Prozess, der den Cron-Scheduler ausführt, stellt seine eigenen Timer scharf, und der Lauf wird zuerst in der Datenbank beansprucht, sodass ein Slot genau **einmal** ausgeführt wird, egal wie viele Prozesse dafür auslösen. Das Pausieren eines Jobs und der Lease, der verhindert, dass ein manueller Trigger einen laufenden Prozess stört, werden auf dieselbe Weise geteilt. Hier muss nichts konfiguriert werden, solange die Datenbank Postgres ist. `REBASE_CRON_SCHEDULER` und `REBASE_JOB_WORKERS` legen fest, welche Prozesse überhaupt Timer und Worker ausführen – siehe [Split-Prozesse](/docs/deployment/split-processes/).

Das geplante RLS-Audit ist die Ausnahme: Es wird nicht beansprucht, sodass jeder Prozess, der dafür zuständig ist, nach seinem eigenen Timer scannt. Das ist eher redundant als unsicher; setzen Sie `REBASE_RLS_AUDIT=false` auf allen Instanzen außer einer.

## Statische Apps

Ein Prozess, der das Frontend oder das CMS ausliefert (`REBASE_SERVE_STATIC`, standardmäßig aktiviert), liest die `index.html` jeder App einmal ein und behält sie im Speicher. Das Ersetzen des Builds auf einem geteilten Volume erreicht einen laufenden Prozess nicht: Er liefert weiterhin das alte Dokument aus, das Chunks referenziert, die möglicherweise nicht mehr existieren. Veröffentlichen Sie einen neuen Build, indem Sie jede Instanz neu starten oder rollierend aktualisieren – was ein neues Image oder Bundle ohnehin tut. Mit einem vorgeschalteten CDN und `REBASE_SERVE_STATIC=false` trifft dies nicht zu.

## Metriken

`/metrics` meldet den Prozess, der die Anfrage beantwortet. Scrapen Sie jede Instanz – ein Prometheus-Service-Discovery-Job pro Pod, nicht ein einzelnes Ziel hinter dem Load Balancer – und bilden Sie die Summe in der Abfrage.

## Boot-Provisioning

Jede Instanz führt beim Start den additiven Schema-Durchlauf aus (`REBASE_MIGRATE_ON_BOOT=ensure`). Instanzen mit derselben Rolle können diesen gleichzeitig ausführen: Er ist so konzipiert, dass er toleriert, wenn ein Peer dieselbe Tabelle einen Moment zuvor erstellt hat. In einem Split-Deployment provisioniert genau eine Rolle und alle anderen setzen `none` – siehe [Split-Prozesse](/docs/deployment/split-processes/).

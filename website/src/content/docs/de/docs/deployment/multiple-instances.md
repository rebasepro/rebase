---
sourceHash: d2e9fbce6bf304f5
title: Betrieb mehrerer Instanzen
sidebar_label: Mehrere Instanzen
description: Jeder Status, den ein Rebase-Prozess für sich behält, und die Einstellung, um ihn zu teilen – was konfiguriert werden muss, bevor ein zweites Replikat, ein Rolling Deployment oder ein Split Deployment Traffic empfängt.
---

## Übersicht

Der Großteil eines Rebase-Deployments befindet sich bereits in der Datenbank: Zeilen, Benutzer und Sessions, API-Schlüssel, die Job-Queue, Cron-Claims, Idempotenzschlüssel, der Datensatzverlauf und die Tokens des MCP-OAuth-Servers. Ein zweiter Prozess, der auf dieselbe Datenbank verweist, sieht all dies.

Einige Dinge tun das nicht. Jedes davon ist standardmäßig prozessbezogen, da ein einzelner Prozess das Standard-Deployment darstellt und das Teilen Ressourcen erfordert – eine Tabelle, einen Bucket-Schreibvorgang, eine Datenbankverbindung. Wenn Sie zwei Prozesse hinter einem Load Balancer betreiben, auf mehr als eine Instanz autoskalieren oder ein Rolling Deployment durchführen, bei dem die alte und neue Version kurzzeitig nebeneinander laufen, führt Sie das auf diese Seite. Dasselbe gilt für ein [Split Deployment](/docs/deployment/split-processes/), das per Definition aus mehreren Prozessen besteht.

Gehen Sie die folgende Liste durch, bevor die zweite Instanz Traffic übernimmt. Keiner dieser Punkte führt zu einem lauten Fehler: Jeder Punkt äußert sich stattdessen als ein Limit, das dreifach durchgesetzt wird, ein Ereignis, das manche Clients nie sehen, oder eine Seite, die bei jedem Neuladen andere Logs anzeigt.

## Die Checkliste

| Was | Standardmäßig pro Prozess | Wodurch geteilt |
| --- | --- | --- |
| Signaturgeheimnisse | In der Entwicklung pro Prozess generiert | `JWT_SECRET` und `REBASE_SERVICE_KEY`, explizit gesetzt und überall **identisch** |
| Rate-Limit-Zähler | Im Speicher (In-Memory) | `REBASE_RATE_LIMIT_STORE=sql` |
| Client-Adresse hinter einem Proxy | `TRUSTED_PROXY_HOPS=0` | Die Anzahl der vorgeschalteten Proxys, überall gleich |
| Tabellen-Abonnements | Über die Datenbank geteilt, wenn CDC aktiv ist | `REALTIME_CDC=auto` (Standard) |
| Broadcast-Channels und Presence | Im Speicher (In-Memory) | `REALTIME_CHANNEL_BUS=postgres` |
| Hochgeladene Dateien, `STORAGE_TYPE=local` | Lokaler Datenträger der Instanz | S3 oder GCS oder ein geteiltes Volume auf dem übergeordneten Verzeichnis von `STORAGE_PATH` |
| Laufende fortsetzbare (TUS) Uploads | Lokaler Datenträger der Instanz unter `STORAGE_PATH/.tus-uploads` | Ein geteiltes Volume unter `STORAGE_PATH` oder Sticky Sessions |
| Bildtransformationen | Ein In-Process-Cache | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Ein Ringpuffer der letzten 10.000 Zeilen | Nichts – leiten Sie stdout an einen Log-Aggregator weiter |
| Cron-Timer | Jeder Prozess, der den Scheduler ausführt | In der Datenbank beansprucht: eine Ausführung pro Slot. `REBASE_CRON_SCHEDULER` bestimmt, wo Timer laufen |
| Geplantes RLS-Audit | Jeder Prozess, der dafür zuständig ist | `REBASE_RLS_AUDIT=false` auf allen bis auf einem |
| `index.html` einer statischen App | Einmal pro Prozess gelesen | Starten Sie jede Instanz neu, wenn sich der Build ändert |
| `/metrics` | Jeder Prozess zählt seine eigenen | Scrapen Sie jede Instanz |

Die folgenden Abschnitte beschreiben, was die einzelnen Punkte bewirken, wenn sie prozessbezogen belassen werden.

## Signaturgeheimnisse

`JWT_SECRET` signiert jede Session und `REBASE_SERVICE_KEY` authentifiziert Server-zu-Server-Aufrufe. In der Entwicklungsumgebung generiert jeder Prozess seine eigenen, wenn sie nicht gesetzt sind, sodass ein von einem Prozess ausgestelltes Token vom nächsten abgelehnt wird. Die Produktionsumgebung verweigert den Start ohne `JWT_SECRET` bereits (ohne `REBASE_SERVICE_KEY` startet sie ganz ohne Service-Schlüssel); bei mehreren Prozessen kommt es darauf an, dass jeder die **gleichen** Werte erhält – aus einem einzigen Secret, nicht einem pro Replikat.

## Rate-Limits und die Client-Adresse

Die Rate-Limiter – das Budget pro Aufrufer für die Data-, Storage- und Functions-APIs sowie die Auth-Limiter für Anmeldung, Passwort-Zurücksetzung, Einmalcodes und MFA-Versuche – zählen standardmäßig im Speicher. Ein Prozess kann nicht sehen, wie viele Peers er hat, sodass drei Replikate bei der Standardkonfiguration jedes Limit dreifach durchsetzen. Setzen Sie `REBASE_RATE_LIMIT_STORE=sql`, und die Zähler werden stattdessen in der Datenbank verwaltet.

Hinter einem Load Balancer benötigt der Limiter zudem die echte Client-Adresse, die im Header `X-Forwarded-For` übertragen wird. `TRUSTED_PROXY_HOPS` gibt an, wie viele Proxys übersprungen werden sollen; beim Standardwert `0` scheint jede Anfrage vom Load Balancer zu stammen, und alle Clients teilen sich ein einziges Kontingent. Siehe [Konfiguration](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

**Tabellen-Abonnements** funktionieren über Instanzen hinweg, wenn Change Data Capture auf Datenbankebene aktiv ist, was standardmäßig der Fall ist (`REALTIME_CDC=auto`): Ein Trigger kündigt jeden committeten Schreibvorgang an, und der Listener jeder Instanz ruft die Daten für seine eigenen Abonnenten erneut ab. Wenn CDC deaktiviert ist oder `auto` es nicht bereitstellen konnte (das Boot-Log gibt darüber Aufschluss), sieht ein Abonnement nur die Schreibvorgänge, die über die Instanz erfolgten, mit der sein Socket verbunden ist. Siehe [Realtime](/docs/backend/realtime-cdc/).

**Broadcast-Channels und Presence** sind prozessintern, sofern kein Bus sie überträgt: Zwei Clients auf verschiedenen Instanzen im selben Channel hören einander nicht, und jede Instanz beantwortet die Frage „Wer ist anwesend?“ nur mit der eigenen Hälfte. Setzen Sie `REALTIME_CHANNEL_BUS=postgres`. Der Bus lauscht auf der Datenbank, was eine direkte Verbindung anstelle eines Transaction-Poolers erfordert – setzen Sie `DATABASE_DIRECT_URL`, wenn `DATABASE_URL` über pgBouncer läuft. Siehe [Channels und Presence über Instanzen hinweg](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Dateien

Mit `STORAGE_TYPE=local` sind Uploads Dateien auf dem Datenträger der Instanz, die sie empfangen hat, und eine andere Instanz antwortet für diese mit 404. Verwenden Sie S3 oder GCS oder binden Sie auf jeder Instanz ein gemeinsames Volume auf dem übergeordneten Verzeichnis von `STORAGE_PATH` ein, sodass es auch das Verzeichnis `<STORAGE_PATH>__<key>` jedes benannten lokalen Buckets enthält. Siehe [Self-Hosting: Dateispeicher](/docs/deployment/self-hosting/#file-storage).

**Fortsetzbare Uploads** (der TUS-Endpunkt) speichern die Teildatei jedes Uploads und einen zugehörigen Upload-Datensatz auf dem Datenträger der Instanz, die ihn erstellt hat, unter `STORAGE_PATH/.tus-uploads` – selbst wenn fertige Dateien an S3 oder GCS gehen. Binden Sie auf jeder Instanz ein gemeinsames Volume unter `STORAGE_PATH` ein, und jede Instanz kann jeden Upload bedienen; ein Neustart oder ein Rolling Deployment setzt einen Upload dort fort, wo er unterbrochen wurde. Ohne ein geteiltes Volume wird ein Chunk, der auf einer anderen Instanz landet, mit 404 beantwortet: Leiten Sie die Upload-Anfragen eines Clients an eine bestimmte Instanz weiter (Sticky Sessions auf dem Load Balancer). Das SDK und das Admin-Panel, die diesen Endpunkt für Dateien über 8 MiB verwenden, senden die Datei andernfalls stattdessen per `POST /upload` und behalten dies für den Rest der Session bei. Reguläre Uploads über `POST /upload` bestehen aus einer einzigen Anfrage und sind nicht betroffen.

**Bildtransformationen** (`?width=400&format=webp`) werden im Speicher zwischengespeichert, sodass jede Instanz jede Variante einmal berechnet und eine neue Instanz kalt startet. Setzen Sie `STORAGE_RENDITION_CACHE=true`, um jedes Rendition-Ergebnis in den Ursprungs-Bucket zurückzuschreiben, wo jede Instanz es vorfindet. Dadurch führt ein `GET` zu einem Schreibvorgang in Ihren Bucket, weshalb dies standardmäßig deaktiviert ist. Siehe [Storage](/docs/backend/storage/).

## Logs Explorer

Der Logs Explorer von Studio liest einen Ringpuffer der letzten 10.000 Log-Zeilen, die von dem Prozess vorgehalten werden, der die Anfrage bedient. Hinter einem Load Balancer zeigt jedes Neuladen möglicherweise die Zeilen einer anderen Instanz, und keine davon zeigt das gesamte Deployment. Der Explorer nennt die Instanz, die er gerade anzeigt. Es gibt keine Einstellung, um diesen Ringpuffer zu teilen: Die Laufzeitumgebung schreibt in der Produktion eine JSON-Zeile pro Ereignis nach stdout, und genau das sollte gesammelt werden – über den Protokolldienst Ihrer Plattform, Loki oder jedes andere Tool, das Container-Ausgaben liest.

## Cron und die Job-Queue

Jeder Prozess, der den Cron-Scheduler ausführt, stellt seine eigenen Timer scharf, und die Ausführung wird zuerst in der Datenbank reserviert (claimed), sodass ein Slot genau **einmal** ausgeführt wird – egal, wie viele Prozesse dafür auslösen. Das Pausieren eines Jobs und der Lease, der verhindert, dass ein manueller Trigger eine bereits laufende Ausführung stört, werden auf dieselbe Weise geteilt. Hier muss nichts konfiguriert werden, solange die Datenbank Postgres ist. `REBASE_CRON_SCHEDULER` und `REBASE_JOB_WORKERS` bestimmen, welche Prozesse überhaupt Timer und Worker ausführen – siehe [Split-Prozesse](/docs/deployment/split-processes/).

Das geplante RLS-Audit ist die Ausnahme: Es wird nicht in der Datenbank beansprucht, sodass jeder dafür zuständige Prozess nach seinem eigenen Timer scannt. Das ist eher redundant als unsicher; setzen Sie `REBASE_RLS_AUDIT=false` auf allen Instanzen außer einer.

## Statische Apps

Ein Prozess, der das Frontend oder das CMS bereitstellt (`REBASE_SERVE_STATIC`, standardmäßig aktiviert), liest die `index.html` jeder App einmal ein und behält sie im Speicher. Das Ersetzen des Builds auf einem gemeinsamen Volume erreicht einen laufenden Prozess nicht: Er liefert weiterhin das alte Dokument aus, das auf Chunks verweist, die möglicherweise nicht mehr existieren. Veröffentlichen Sie einen neuen Build, indem Sie jede Instanz neu starten oder rollierend aktualisieren – was ein neues Image oder Bundle ohnehin tut. Mit einem vorgeschalteten CDN und `REBASE_SERVE_STATIC=false` trifft dies nicht zu.

## Metriken

`/metrics` liefert die Daten des Prozesses zurück, der die Anfrage beantwortet. Scrapen Sie jede Instanz – über einen Prometheus-Service-Discovery-Job pro Pod, nicht über ein einzelnes Ziel hinter dem Load Balancer – und aggregieren Sie die Summen in der Abfrage.

## Boot-Provisionierung

Jede Instanz führt beim Start den additiven Schemadurchlauf aus (`REBASE_MIGRATE_ON_BOOT=ensure`). Instanzen mit derselben Rolle können diesen gleichzeitig ausführen: Er ist so konzipiert, dass er toleriert, wenn ein Peer dieselbe Tabelle einen Augenblick zuvor erstellt hat. In einem Split Deployment führt genau eine Rolle die Provisionierung durch, während alle anderen `none` setzen – siehe [Split-Prozesse](/docs/deployment/split-processes/).

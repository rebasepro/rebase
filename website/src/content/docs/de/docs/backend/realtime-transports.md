---
sourceHash: 1b7c64b3c001f57d
title: Realtime über mehrere Instanzen
sidebar_label: Realtime über mehrere Instanzen
description: "Wie Broadcast-Channels und Presence über mehr als einen Server-Prozess hinweg funktionieren: der LISTEN/NOTIFY-Bus, was jede Instanz besitzt und wie Sie Ihren eigenen Transport schreiben."
---

## Instanzübergreifendes Broadcasting & LISTEN/NOTIFY-Architektur

Für Cluster-Umgebungen mit mehreren Instanzen (z. B. beim Betrieb in Kubernetes oder Docker-Containern hinter einem Load Balancer) setzt Rebase auf PostgreSQL `LISTEN/NOTIFY`, um **Zeilenänderungen (Row Changes)** über Instanzen hinweg zu synchronisieren. Tabellen- und Entity-Abonnements (Subscriptions) funktionieren daher ohne Konfiguration instanzübergreifend — genau das wird in diesem Abschnitt beschrieben.

**Broadcast-Channels und Presence sind getrennt** und arbeiten pro Instanz, bis Sie einen Channel-Bus aktivieren. Siehe [Channels und Presence über Instanzen hinweg](#channels-und-presence-über-instanzen-hinweg) weiter unten.

### Umgehung von pgBouncer-Pools

Da Connection-Pooler wie **pgBouncer** das persistente Verbindungsmodell, das für langlebige SQL-`LISTEN`-Sitzungen erforderlich ist, nicht unterstützen, öffnet der Realtime-Supervisor einen dedizierten, ungepoolten Postgres-Client (`PgClient`) direkt zur Datenbank. Diese direkte Verbindung nutzt die Umgebungsvariable `DATABASE_DIRECT_URL`, sofern konfiguriert, was Stabilität gewährleistet und eine Pool-Erschöpfung oder abrupte Verbindungsabbrüche verhindert.

### Benachrichtigungsmechanik & Payload-Layout

Wenn [Database Change Capture](/docs/backend/realtime-cdc/) aktiv ist — der Standard, sofern die Datenbankrolle Trigger erstellen kann —, empfängt jede Instanz jeden Commit auf dem `rebase_cdc`-Kanal, und nichts von dem Nachfolgenden wird gesendet. Ohne dies sendet eine Instanz A beim Modifizieren eines Datensatzes eine Benachrichtigung auf dem Kanal `rebase_entity_changes`. Um den Datenbank-Overhead und die Netzwerkbandbreite zu minimieren, wird der Benachrichtigungs-Payload extrem kompakt gehalten:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Hinweis: `sid` steht für die eindeutige, zufällige Instanz-ID des Servers, die beim Start erzeugt wird, `p` ist der Tabellen-Slug (Pfad) und `eid` ist die Ziel-Entity-ID.*

Änderungen, die im selben Moment vorgenommen werden — ein Massenspeichervorgang kündigt jede geschriebene Zeile an —, werden gebündelt übertragen, und zwar in so wenigen Benachrichtigungen, wie unter das 8000-Byte-NOTIFY-Limit von Postgres passen. Jede listet ihre Änderungen als `[p, eid, db]`-Tripel auf:

```json
{
  "sid": "inst_7a9c1b",
  "c": [["posts", "45", null], ["posts", "46", null]]
}
```

Eine einzelne Änderung behält die obige Struktur bei, sodass eine ältere Instanz sie während eines Rolling Deployments weiterhin lesen kann.

- **Selbstfilterung (Self-Filtering)**: Beim Empfang einer Nachricht liest jede Instanz die `sid`. Entspricht sie der eigenen Instanz-ID, verwirft der Server die Benachrichtigung, um Endlosschleifen beim Routing zu verhindern.
- **Weiterleitung und Fan-out**: Stammt die Benachrichtigung von einer anderen Instanz, plant der Server ein entprelltes (debounced) erneutes Abrufen für seine lokal verbundenen Abonnenten jeder Änderung. Beim Empfang liest er nichts: Jeder Frame ist ein erneutes Abrufen im eigenen Gültigkeitsbereich (Scope) des jeweiligen Abonnenten.
- **Supervisor-Wiederverbindungsschleife**: Bricht die Datenbankverbindung ab, überwacht ein Hintergrund-Verbindungs-Supervisor den Status und löst nach einer festen Verzögerung von **3 Sekunden** eine automatische Wiederverbindungssequenz aus. Dadurch wird die `LISTEN`-Schleife wiederhergestellt, ohne den Lebenszyklus der Hono-Hauptanwendung zu beeinträchtigen. Jedes aktive Abonnement auf der Instanz wird anschließend neu abgerufen, da alles, was während des Ausfalls veröffentlicht wurde, niemanden erreicht hat. Kann die Datenbank beim Start nicht erreicht werden, wird der Verbindungsaufbau auf dieselbe Weise wiederholt.
- **Heartbeat**: Eine `LISTEN`-Verbindung ist naturgemäß inaktiv (idle). Ein Idle-Flow-Timeout auf einem Load Balancer oder einem NAT kann sie ohne Fehlermeldung auf beiden Seiten trennen (eine halb offene Verbindung). Daher läuft sie mit TCP-Keepalive und muss alle 30 Sekunden innerhalb von 10 Sekunden ein `SELECT 1` beantworten. Eine Verbindung, die dies verfehlt, wird wie oben beschrieben ersetzt. Während die Verbindung unterbrochen ist, führt `/health` sie als `cross-instance` auf; ist sie seit 60 Sekunden getrennt, schlägt der Check fehl.

## Channels und Presence über Instanzen hinweg

Zeilenänderungen übertragen sich automatisch über Instanzen hinweg (siehe oben). Broadcast-Channels und Presence tun dies **nicht**: Standardmäßig werden sie nur an die Clients weitergeleitet (Fan-out), die mit der Instanz verbunden sind, die sie empfangen hat.

Auf einer einzelnen Instanz ist das genau richtig und verursacht keinerlei Overhead. Hinter einem Load Balancer führt dies jedoch zu einem Problem, das Sie in der Entwicklung nicht bemerken: Zwei zusammenarbeitende Benutzer landen auf unterschiedlichen Replikaten, treten demselben Channel bei, sehen einen leeren Raum und können dennoch einwandfrei Nachrichten aneinander senden. Es tritt kein Fehler auf.

Die Lösung ist ein **Channel-Bus** — ein Opt-in-Transport, der Channel-Frames und Presence zwischen Instanzen überträgt:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres" }
    }
})
```

| Bus          | Wann er verwendet werden sollte                                                                      |
|--------------|--------------------------------------------------------------------------------------------------------|
| `memory`     | **Standard.** Einzelne Instanz. Keine instanzübergreifende Zustellung, kein Overhead.                  |
| `postgres`   | Zwei oder mehr Instanzen. Nutzt `LISTEN/NOTIFY` auf der bereits vorhandenen Datenbank — kein neuer Dienst erforderlich. |

Der Transport kann auch pro Bereitstellung über `REALTIME_CHANNEL_BUS=memory|postgres` festgelegt werden, sodass er ohne Rebuild geändert werden kann.
Er überschreibt einen **benannten** Built-in (`bus: { type: "memory" }`) und wird bewusst **ignoriert**, wenn `realtime.bus` eine bereits konstruierte `ChannelBus`-**Instanz** übergeben wurde — die Variable kann nur Transporte benennen, die dieses Paket selbst instanziieren kann. Sie dort zu berücksichtigen, würde bedeuten, das von der Anwendung übergebene Objekt stillschweigend zu verwerfen. In diesem Fall wird eine Warnung protokolliert, die beides benennt, und ein nicht erkannter Wert fällt auf die konfigurierte Einstellung zurück statt auf Memory.

### Warum es keine integrierte Redis-Option gibt

Rebase wird als Postgres + Backend + Frontend bereitgestellt. Ein Bus, der einen Message Broker benötigt, würde einen zweiten zustandsbehafteten Dienst in jedes von der CLI generierte `docker-compose.yml` einfügen – und das für ein Feature, das die meisten Anwendungen nie benötigen. Die Hürde für das Hinzufügen eines solchen Dienstes ist daher, dass die Datenbank die Last nachweislich nicht bewältigen kann.

Aber sie kann es. Gemessen über zwei Backend-Instanzen gegen einen einzelnen Postgres-Container lieferte der Postgres-Bus **~10.000 instanzübergreifende Nachrichten pro Sekunde ohne Verluste** und blieb bis hin zu **acht Instanzen** konstant stabil (14.000 Zustellungen, keine Verluste). Zwanzig Personen, die Cursor mit 60 fps bewegen, erzeugen etwa 1.200 Nachrichten pro Sekunde — ungefähr ein Achtel davon.

Das Limit, das man im Auge behalten sollte, ist nicht die Kapazität, sondern dass jede Benachrichtigung eine Abfrage an Ihre primäre Datenbank darstellt, die mit den echten Abfragen Ihrer Anwendung konkurriert. Der Postgres-Bus **fasst ausgehende Frames daher zusammen** (Coalescing, siehe unten), wodurch diese Kosten proportional zur verstrichenen Zeit und nicht zur Nachrichtenanzahl bleiben.

Pro Client akzeptiert der Socket bis zu **7.200 Channel-Frames pro Minute** (120/s — 60 fps Cursor-Broadcasts plus das jeweilige Presence-Update, das jeder davon trägt), separat gezählt vom gemeinsamen Kontingent für Abfragen und Abonnements. Darüber hinausgehende Frames werden mit einem `RATE_LIMITED`-Fehler abgelehnt, anstatt in eine Warteschlange gestellt zu werden.

Die Ablehnung erfolgt über `channel.onError()`, nicht als abgewiesenes `broadcast()` — siehe [Wenn ein Channel-Frame abgelehnt wird](/docs/backend/realtime#when-a-channel-frame-is-refused).

Wenn Sie danach immer noch an Limits stoßen, drosseln Sie Cursor-Events auf dem Client (ein Last-Write-Wins-Status benötigt keine 60 Updates pro Sekunde) und erwägen Sie, Bearbeiter desselben Dokuments über [`affinity`](/docs/sdk/realtime#keeping-a-group-on-one-instance) auf dieselbe Instanz zu leiten — Sticky Routing reduziert den instanzübergreifenden Datenverkehr unabhängig von der Benutzerzahl auf ein Minimum. Erst darüber hinaus lohnt sich ein anderer Transport, und die Lösung dafür ist ein eigenes Transport-Paket, kein Fork. Siehe [Einen eigenen Transport schreiben](#einen-eigenen-transport-schreiben).

### Das Verhalten des Busses überwachen

Mit `REBASE_METRICS=true` meldet jede Instanz unter `/metrics`, was sie überträgt:

| Metrik | Typ | Bedeutung |
|--------|------|---------|
| `rebase_realtime_sockets` | Gauge | Offene Sockets auf dieser Instanz |
| `rebase_realtime_channels` | Gauge | Channels mit mindestens einem Mitglied auf dieser Instanz |
| `rebase_realtime_bus_frames_published_total` | Counter | Frames, die diese Instanz an den Bus gesendet hat, nach `kind`: `broadcast`, `broadcast_ref`, `presence_diff` und `channels` (worüber Instanzen einander mitteilen, was sie bedienen) |
| `rebase_realtime_bus_frames_skipped_total` | Counter | Broadcasts und Presence-Änderungen, die nicht gesendet wurden, weil keine andere Instanz Mitglieder im Channel hatte |

Zähler beginnen bei null, wenn eine Instanz startet, und zählen Frames, von denen der Bus mehrere zu einer Benachrichtigung zusammenfassen kann. Retained Messages werden immer übertragen und daher nie übersprungen. Beim standardmäßigen `memory`-Bus bleiben beide Werte bei null.

Scrapen Sie jede Instanz einzeln und nicht über einen vorgeschalteten Load Balancer: Die Zahlen gelten pro Prozess. Eine Gruppe, die auf einer Instanz verbleibt, zeigt sich dadurch, dass `skipped` steigt, während `broadcast` und `presence_diff` unverändert bleiben und sich Sockets über die Instanzen verteilen. Broadcasts, die auf jeder Instanz steigen, bedeuten, dass die Channels instanzübergreifend sind. Auf Rebase Cloud zeigt `rebase cloud metrics` dieselben Zahlen pro Instanz an.

### Zusammenfassung von Frames (Coalescing)

Frames, die veröffentlicht werden, während ein kurzes Zeitfenster offen ist, werden gemeinsam in einer einzigen Benachrichtigung versendet. Das Fenster arbeitet nach dem **Leading-Edge-Prinzip**: Ein Frame, der eintrifft, wenn kein Fenster offen ist, wird sofort gesendet. Somit entsteht für einen inaktiven Channel keine zusätzliche Latenz, und nur ein kontinuierlicher Stream wird gebündelt.

Gemessen über zwei Instanzen bei 3.000 Broadcasts, die in jedem Fall vollständig zugestellt wurden:

| Traffic-Muster | Coalescing aus | Coalescing an | Reduzierung |
|---|---|---|---|
| Burst (so schnell wie möglich) | 3.000 Queries | 68 Queries | **44×** |
| Gleichmäßig (~500 Msg/s, verteilt) | 3.000 Queries | 240 Queries | **12,5×** |

Der Burst-Fall war bezogen auf die tatsächliche Laufzeit (Wall-Clock) zudem rund 11-mal schneller abgeschlossen, da die Datenbank-Roundtrips der Engpass waren und nicht die eigentliche Verarbeitung.

Das Zeitfenster ist standardmäßig auf 10 ms eingestellt und kein kritischer Parameter — 5 ms, 10 ms und 20 ms führten bei beiden Mustern zu identischen Abfragezahlen, da ein Batch lange vor Ablauf des Timers durch die 8-KB-Payload-Grenze oder das natürliche Muster des Datenverkehrs begrenzt wird. Ändern Sie diesen Wert nur mit triftigem Grund:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 deaktiviert Coalescing
}
```

Ein Hinweis für Deployments: Ein Batch nutzt ein anderes Übertragungsformat als ein einzelner Frame, und eine Instanz mit einem älteren Build versteht dieses nicht. Einzelne Frames werden immer unverpackt gesendet. Daher besteht bei einem Rolling Deployment nur dann die Gefahr verworfener Frames, wenn der Cluster *während* des Neustarts unter anhaltender Last steht — und Retained Channels reparieren sich ohnehin selbst über das History-Replay.

## Einen eigenen Transport schreiben

`realtime.bus` akzeptiert jedes Objekt, das die Schnittstelle `ChannelBus` implementiert. Ein Transport kann somit als eigenes Paket bereitgestellt werden — `@rebasepro/types` deklariert den Vertrag, und mehr ist für die Implementierung nicht erforderlich:

```typescript
import type { ChannelBus, ChannelBusFrame, ChannelBusHandler } from "@rebasepro/types";

export class MyChannelBus implements ChannelBus {
    readonly kind = "my-transport";
    readonly maxFrameBytes = Infinity;

    async start(handler: ChannelBusHandler): Promise<void> {
        // Connect. Reject if you cannot — the caller falls back to in-process
        // delivery, which is far better than a cluster that believes it is
        // connected and silently is not.
    }

    async publish(frame: ChannelBusFrame): Promise<void> {
        // Reach every other instance, or reject.
    }

    async stop(): Promise<void> {
        // Idempotent; release anything holding the event loop open.
    }
}
```

Übergeben Sie die Instanz an der Stelle, an der sonst ein Built-in-Name stehen würde:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**Was Ihre Implementierung garantieren muss:** `start()` schlägt fehl (reject), wenn der Transport unbrauchbar ist; `publish()` erreicht jede andere Instanz oder schlägt fehl; `stop()` ist idempotent; und eine fehlerhafte Nachricht wird verworfen und protokolliert, anstatt einen Fehler auszulösen, damit ein einzelner fehlerhafter Frame nicht den gesamten Listener zum Absturz bringt.

**Was sie nicht garantieren muss:** Reihenfolge (Retained Channels enthalten `seq`, und das SDK sortiert danach), Persistenz/Durability (ein verlorener Frame ist ein verpasstes Live-Update, das durch das History-Replay des Clients behoben wird) oder Exactly-Once-Delivery (Retained Frames werden anhand von `seq` dedupliziert; Presence-Diffs sind idempotent).

Über `maxFrameBytes` erkennt das Framework, ob eine große Retained Message inline oder als Pointer gesendet werden soll. Geben Sie `Infinity` zurück, wenn Ihr Transport keine relevante Obergrenze hat, damit der Pointer-Pfad nicht unnötig genutzt wird.

Die Zustellung an lokale Clients liegt nicht in Ihrer Verantwortung — der Realtime-Dienst bestimmt, welche Abonnenten einen Frame erhalten. Ein Transport transportiert Frames ausschließlich zwischen Instanzen.

### Das 8-KB-Limit beim Postgres-Bus

`pg_notify` lehnt Payloads von 8000 Bytes oder mehr ab. Cursor und Presence passen problemlos hinein; ein Dokument-Snapshot hingegen nicht. Rebase handhabt dies genauso wie große Entity-Änderungen — indem eine Adresse statt des Inhalts gesendet wird:

- **Auf einem Retained Channel** (siehe [Channel Retention](/docs/backend/realtime#channel-retention)) ist die Nachricht bereits mit einer Sequenznummer gespeichert, sodass die Benachrichtigung lediglich `(channel, seq)` transportiert und jede empfangende Instanz den Inhalt selbst nachliest. Es gibt keinerlei Größenbeschränkung. Dies gilt für jede Retained Message, ob klein oder groß: Jeder Datenbank-Login kann `LISTEN` ausführen, weshalb der Body niemals in der Benachrichtigung übertragen wird. Dies kostet einen Primary-Key-Read pro Nachricht auf jeder Instanz, die ein Mitglied in diesem Channel hat.
- **Flüchtige (ephemerale) Broadcasts und Presence** werden weiterhin direkt in der Benachrichtigung übertragen, sodass jeder Datenbank-Login sie mitlesen kann. Übertragen Sie Daten, die auf diese Weise nicht lesbar sein dürfen, ausschließlich über einen Retained Channel.
- **Auf einem ephemeren Channel** gibt es keinen gespeicherten Datensatz, auf den verwiesen werden könnte. Der Broadcast wird lokal zugestellt, der Sender erhält einen `CHANNEL_BUS_PAYLOAD_TOO_LARGE`-Fehler über `channel.onError()`, und eine Warnung nennt den betroffenen Channel — anstatt dass die Nachricht stillschweigend nur die Hälfte des Clusters erreicht.

Wenn Sie große Nachrichten übertragen, weisen Sie diesem Channel eine Retention-Regel zu. Das ist die vollständige Lösung.

### Presence ist geteilter Status, nicht nur Fan-out

`presence_state` muss die Frage „Wer befindet sich in diesem Channel?“ für den gesamten Cluster beantworten können, was über den speicherbasierten Status einzelner Instanzen nicht möglich ist. Wenn ein Bus aktiv ist, speichert Rebase die Liste der Mitglieder in `rebase.channel_presence` (wird automatisch erstellt) und beantwortet Roster-Anfragen daraus.

| Spalte        | Inhalt                                         |
|---------------|------------------------------------------------|
| `channel`     | Name des Channels                              |
| `client_id`   | Der überwachte Client                          |
| `instance_id` | Mit welcher Backend-Instanz er verbunden ist   |
| `state`       | Der Presence-Status des Clients                |
| `last_seen`   | Wird durch den Presence-Heartbeat des SDKs aktualisiert |

Das SDK sendet Presence-Heartbeats ca. alle 20 Sekunden bei einem Timeout von 30 Sekunden. Zeilen, die nicht mehr aktualisiert werden, werden bereinigt und die Abgänge an jede Instanz gemeldet — was gleichzeitig als Crash-Recovery dient: Ein abstürzender Pod hinterlässt Zeilen, die nach Ablauf eines Timeout-Fensters genau wie jeder andere inaktiv gewordene Client aussehen. Ein reguläres Herunterfahren (Graceful Shutdown) löscht die eigenen Zeilen sofort, sodass bei einem Rolling Deployment keine Phantom-Benutzer sichtbar werden.

:::caution[Die LISTEN-Verbindung muss Ihren Pooler umgehen]
`LISTEN` ist ein Sitzungsstatus, daher benötigt der Postgres-Bus eine direkte Verbindung — kein pgBouncer oder sonstige Pooler im Transaction-Modus. Rebase verwendet `DATABASE_DIRECT_URL`, sofern gesetzt; hinter einem Pooler verweisen Sie damit direkt auf den Datenbankdienst selbst. Ohne eine nutzbare direkte URL protokolliert der Bus eine Warnung und verbleibt im In-Memory-Modus.
:::

## Nächste Schritte

- [Realtime & WebSocket](/docs/backend/realtime/) — Abonnements, Channels und Presence auf einer Instanz
- [Geteilte Prozesse (Split Processes)](/docs/deployment/split-processes/) — das Bereitstellungsmodell, für das dies relevant ist
- [Self-Hosting](/docs/deployment/self-hosting/) — die Runtime selbst betreiben

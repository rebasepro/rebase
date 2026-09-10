---
sourceHash: 8b0308f7ee06d77a
title: Echtzeit über mehrere Instanzen
sidebar_label: Echtzeit über mehrere Instanzen
description:"\"Wie Broadcast-Channels und Presence mehr als einen Server-Prozess überstehen: der LISTEN/NOTIFY-Bus, was jede Instanz besitzt, und das Schreiben eines eigenen Transports.\""
---

## Instanzübergreifendes Broadcasting & LISTEN/NOTIFY-Architektur

Für Cluster-Umgebungen mit mehreren Instanzen (z. B. beim Betrieb in Kubernetes oder Docker-Containern hinter einem Load Balancer) stützt sich Rebase auf PostgreSQL `LISTEN/NOTIFY`, um **Zeilenänderungen** über Instanzen hinweg zu synchronisieren. Abonnements von Collections und Entitäten erstrecken sich daher ohne Konfiguration über mehrere Instanzen – genau das wird in diesem Abschnitt beschrieben.

**Broadcast-Channels und Presence sind getrennt** und arbeiten instanzbezogen, bis Sie einen Channel-Bus aktivieren. Siehe [Channels und Presence über Instanzen hinweg](#channels-and-presence-across-instances) weiter unten.

### Umgehung von pgBouncer-Pools

Da Connection-Pooler wie **pgBouncer** das persistente Verbindungsmodell nicht unterstützen, das für langlebige SQL-`LISTEN`-Sitzungen erforderlich ist, öffnet der Realtime-Supervisor einen dedizierten, ungepoolten Postgres-Client (`PgClient`) direkt zur Datenbank. Diese Direktverbindung nutzt die Umgebungsvariable `DATABASE_DIRECT_URL`, falls konfiguriert, was die Stabilität gewährleistet und eine Erschöpfung des Pools oder abrupte Verbindungsabbrüche verhindert.

### Benachrichtigungsmechanik & Payload-Layout

Wenn ein Datensatz auf Instanz A geändert wird, sendet sie eine Benachrichtigung auf dem Channel `rebase_entity_changes`. Um den Datenbank-Overhead und die Netzwerkbandbreite zu minimieren, wird der Benachrichtigungs-Payload extrem kompakt gehalten:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Hinweis: `sid` steht für die eindeutige, zufällige Instanz-ID des Servers, die beim Start generiert wird, `p` ist der Collection-Slug (Pfad) und `eid` ist die Ziel-Entitäts-ID.*

- **Selbstfilterung**: Beim Empfang einer Nachricht liest jede Instanz die `sid`. Entspricht diese der eigenen Instanz-ID, verwirft der Server die Benachrichtigung, um Endlosschleifen beim Routing zu verhindern.
- **Relay und Fan-out**: Stammt die Benachrichtigung von einer anderen Instanz, plant der Server ein debounctes Refetch und leitet das Update an seine lokal verbundenen WebSocket-Abonnenten weiter.
- **Supervisor-Wiederverbindungsschleife**: Bricht die Datenbankverbindung ab, überwacht ein Hintergrund-Verbindungs-Supervisor den Status und löst nach einer festen Verzögerung von **3 Sekunden** eine automatische Wiederverbindungssequenz aus. Dadurch wird die `LISTEN`-Schleife wiederhergestellt, ohne den Lebenszyklus der Hono-Hauptanwendung zu beeinträchtigen.

## Channels und Presence über Instanzen hinweg

Zeilenänderungen werden standardmäßig über Instanzen hinweg übertragen (siehe oben). Broadcast-Channels und Presence tun dies **nicht**: Standardmäßig werden sie nur an die Clients verteilt, die mit der Instanz verbunden sind, die sie empfangen hat.

Auf einer einzelnen Instanz ist das genau richtig und verursacht keine Kosten. Hinter einem Load Balancer ist dies jedoch ein Bug, den Sie in der Entwicklung nicht bemerken: Zwei Beteiligte landen auf unterschiedlichen Replikaten, treten demselben Channel bei und sehen einen leeren Raum, während sie fehlerfrei Nachrichten aneinander senden. Es tritt kein Fehler auf.

Die Lösung ist ein **Channel-Bus** – ein optionaler Transport, der Channel-Frames und Presence zwischen den Instanzen überträgt:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres" }
    }
})
```

| Bus          | Wann er verwendet werden sollte                                                                          |
|--------------|----------------------------------------------------------------------------------------------------------|
| `memory`     | **Standard.** Einzelne Instanz. Keine instanzübergreifende Zustellung, kein Overhead.                   |
| `postgres`   | Zwei oder mehr Instanzen. Verwendet `LISTEN/NOTIFY` auf Ihrer bestehenden Datenbank – kein neuer Dienst. |

Der Transport kann auch pro Deployment über `REALTIME_CHANNEL_BUS=memory|postgres` festgelegt werden, sodass er ohne Rebuild geändert werden kann. Er überschreibt eine **benannte** integrierte Option (`bus: { type: "memory" }`) und wird bewusst **ignoriert**, wenn `realtime.bus` eine instanziierte `ChannelBus`-Instanz übergeben wurde – die Variable kann nur Transporte benennen, die dieses Paket zu erstellen weiß; sie an dieser Stelle zu berücksichtigen, würde bedeuten, das von der Anwendung bereitgestellte Objekt stillschweigend zu verwerfen. In diesem Fall wird eine Warnung protokolliert, die beides nennt, und ein nicht erkannter Wert fällt auf den konfigurierten Wert zurück statt auf Memory.

### Warum es out-of-the-box keine Redis-Option gibt

Rebase wird als Postgres + Backend + Frontend bereitgestellt. Ein Bus, der einen Message-Broker benötigt, würde einen zweiten zustandsbehafteten Dienst in jedes von der CLI generierte `docker-compose.yml` einfügen – für ein Feature, das die meisten Anwendungen nie nutzen. Die Hürde für das Hinzufügen eines solchen Dienstes ist daher, dass die Datenbank die Last wirklich nicht bewältigen kann.

Aber sie kann es. Gemessen über zwei Backend-Instanzen hinweg gegen einen einzelnen Postgres-Container lieferte der Postgres-Bus **~10.000 instanzübergreifende Nachrichten pro Sekunde ohne Verluste** und blieb bis hin zu **acht Instanzen** stabil (14.000 Zustellungen, keine Verluste). Zwanzig Personen, die Cursor mit 60 fps bewegen, erzeugen etwa 1.200 Nachrichten pro Sekunde – etwa ein Achtel davon.

Die Grenze, die man im Auge behalten sollte, ist nicht die Kapazität, sondern dass jede Benachrichtigung eine Abfrage an Ihre primäre Datenbank darstellt, die mit den eigentlichen Abfragen Ihrer Anwendung konkurriert. Der Postgres-Bus fasst ausgehende Frames daher zusammen (**Coalescing**, siehe unten), wodurch diese Kosten proportional zur verstrichenen Zeit und nicht zur Nachrichtenanzahl gehalten werden.

Pro Client akzeptiert der Socket bis zu **7.200 Channel-Frames pro Minute** (120/s – 60 fps an Cursor-Broadcasts plus das Presence-Update, das jeder Frame enthält), separat gezählt vom Budget, das sich Abfragen und Abonnements teilen. Frames, die darüber hinausgehen, werden mit einem `RATE_LIMITED`-Fehler abgelehnt und nicht in eine Warteschlange gestellt.

Die Ablehnung erfolgt über `channel.onError()`, nicht als abgelehnter `broadcast()`-Aufruf – siehe [Wenn ein Channel-Frame abgelehnt wird](#when-a-channel-frame-is-refused).

Wenn Sie danach immer noch an Grenzen stoßen, drosseln Sie Cursor-Ereignisse auf dem Client (ein Last-Write-Wins-Status benötigt keine 60 Updates pro Sekunde) und erwägen Sie, Beteiligte desselben Dokuments an dieselbe Instanz weiterzuleiten – Sticky Routing reduziert den instanzübergreifenden Datenverkehr unabhängig von der Benutzeranzahl auf nahezu null. Erst darüber hinaus lohnt sich ein anderer Transport, und die Antwort darauf ist ein Transport-Paket, kein Fork. Siehe [Einen eigenen Transport schreiben](#writing-your-own-transport).

### Coalescing

Frames, die veröffentlicht werden, während ein kurzes Zeitfenster offen ist, werden zusammen in einer einzigen Benachrichtigung versendet. Das Zeitfenster ist **flankengesteuert (leading-edge)**: Ein Frame, der eintrifft, wenn kein Fenster offen ist, wird sofort gesendet. Ein inaktiver Channel zahlt also keine zusätzliche Latenz, und nur ein anhaltender Datenstrom wird gebatcht.

Gemessen über zwei Instanzen bei 3.000 Broadcasts, die in jedem Fall vollständig zugestellt wurden:

| Traffic-Muster | Coalescing aus | Coalescing an | Reduktion |
|---|---|---|---|
| Burst (so schnell wie möglich) | 3.000 Queries | 68 Queries | **44×** |
| Gleichmäßig (~500 Msg/s, verteilt) | 3.000 Queries | 240 Queries | **12,5×** |

Der Burst-Fall war in realer Laufzeit zudem ~11× schneller abgeschlossen, da die Datenbank-Roundtrips den Engpass darstellten und nicht die eigentliche Arbeit.

Das Zeitfenster ist standardmäßig auf 10 ms eingestellt und keine sensible Einstellung – 5 ms, 10 ms und 20 ms führten bei beiden Mustern zu identischen Abfragezahlen, da ein Batch durch die Obergrenze von 8 KB Payload oder durch die natürliche Struktur des Datenverkehrs begrenzt wird, lange bevor der Timer eine Rolle spielt. Ändern Sie dies nur, wenn Sie einen Grund dafür haben:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 deaktiviert Coalescing
}
```

Ein Hinweis zum Deployment: Ein Batch wird in einem anderen Übertragungsformat (Wire Shape) übertragen als ein einzelner Frame, und eine Instanz, auf der ein älterer Build läuft, versteht dieses Format nicht. Einzelne Frames werden immer unverpackt gesendet, sodass bei einem Rolling Deployment nur dann die Gefahr von verworfenen Frames besteht, wenn der Cluster *während* des Neustarts unter anhaltender Last steht – und persistierte Channels reparieren sich ohnehin durch das Wiederholen der Historie.

## Einen eigenen Transport schreiben

`realtime.bus` akzeptiert jedes Objekt, das die Schnittstelle `ChannelBus` implementiert, sodass ein Transport als eigenes Paket bereitgestellt werden kann – `@rebasepro/types` deklariert den Vertrag, und für die Implementierung ist nichts weiter erforderlich:

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

Übergeben Sie die Instanz dort, wo sonst der Name eines integrierten Busses stehen würde:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**Was Ihre Implementierung garantieren muss:** `start()` schlägt fehl (reject), wenn der Transport unbrauchbar ist; `publish()` erreicht jede andere Instanz oder schlägt fehl; `stop()` ist idempotent; und eine fehlerhafte Nachricht wird verworfen und protokolliert, anstatt eine Exception auszulösen, damit ein einzelner fehlerhafter Frame nicht den Listener zum Absturz bringt.

**Was sie nicht garantieren muss:** Reihenfolge (persistierte Channels tragen eine `seq` und das SDK sortiert danach), Beständigkeit (ein verlorener Frame ist ein verpasstes Live-Update, das durch das History-Replay des Clients repariert wird) oder Exactly-Once-Zustellung (persistierte Frames werden per `seq` dedupliziert; Presence-Diffs sind idempotent).

Über `maxFrameBytes` weiß das Framework, ob eine große persistierte Nachricht inline oder als Pointer gesendet werden soll. Geben Sie `Infinity` zurück, wenn Ihr Transport keine relevante Obergrenze hat, damit der Pointer-Pfad nie unnötig gewählt wird.

Die Zustellung an lokale Clients ist nicht Aufgabe des Transports – der Realtime-Service verwaltet, welche Abonnenten einen Frame erhalten. Ein Transport transportiert Frames lediglich zwischen Instanzen.

### Das 8-KB-Limit auf dem Postgres-Bus

`pg_notify` lehnt Payloads ab 8000 Bytes ab. Cursors und Presence passen problemlos hinein; ein Dokument-Snapshot nicht. Rebase handhabt dies genauso wie große Entitätsänderungen – indem eine Adresse anstelle eines Bodys gesendet wird:

- **Auf einem persistierten Channel** (siehe [Channel-Retention](#channel-retention)) ist die Nachricht bereits mit einer Sequenznummer gespeichert, sodass die Benachrichtigung nur `(channel, seq)` überträgt und jede empfangende Instanz den Body nachliest. Es gibt keinerlei Größenbeschränkung.
- **Auf einem ephemeren Channel** gibt es nichts, worauf verwiesen werden könnte. Der Broadcast wird lokal zugestellt, der Absender erhält einen `CHANNEL_BUS_PAYLOAD_TOO_LARGE`-Fehler auf `channel.onError()`, und eine Warnung benennt den Channel – anstatt dass die Nachricht stillschweigend nur die Hälfte des Clusters erreicht.

Wenn Sie große Nachrichten übertragen, versehen Sie diesen Channel mit einer Retention-Regel. Das ist bereits die gesamte Lösung.

### Presence ist geteilter Zustand, nicht nur Fan-out

`presence_state` muss die Frage „Wer befindet sich in diesem Channel?“ für den gesamten Cluster beantworten können, was ein instanzbezogener Speicher nicht leisten kann. Wenn ein Bus aktiv ist, speichert Rebase die Liste in `rebase.channel_presence` (wird automatisch erstellt) und beantwortet Teilnehmerabfragen daraus.

| Spalte        | Inhalt                                              |
|---------------|-----------------------------------------------------|
| `channel`     | Channel-Name                                        |
| `client_id`   | Der getrackte Client                                |
| `instance_id` | Mit welcher Backend-Instanz er verbunden ist        |
| `state`       | Der Presence-Status des Clients                     |
| `last_seen`   | Aktualisiert durch den Presence-Heartbeat des SDKs  |

Das SDK sendet alle ~20 Sekunden einen Presence-Heartbeat bei einem Timeout von 30 Sekunden. Zeilen, die nicht mehr aktualisiert werden, werden bereinigt und das Verlassen des Channels an jede Instanz gemeldet – was gleichzeitig als Crash-Recovery dient: Ein Pod, der abstürzt, hinterlässt Zeilen, die nach Ablauf eines Timeout-Fensters genau wie jeder andere Client aussehen, der inaktiv wurde. Ein reguläres Herunterfahren (Graceful Shutdown) bereinigt die eigenen Zeilen sofort, sodass bei einem Rolling Deployment keine Geister-Teilnehmer sichtbar werden.

:::caution[Die LISTEN-Verbindung muss Ihren Pooler umgehen]
`LISTEN` ist Sitzungsstatus (Session State), daher benötigt der Postgres-Bus eine direkte Verbindung – nicht pgBouncer oder einen anderen Pooler im Transaktionsmodus. Rebase verwendet `DATABASE_DIRECT_URL`, falls gesetzt; hinter einem Pooler verweisen Sie diese direkt auf den Datenbankdienst selbst. Ohne eine nutzbare direkte URL protokolliert der Bus eine Warnung und bleibt im In-Memory-Modus.
:::

## Nächste Schritte

- [Realtime & WebSocket](/docs/backend/realtime/) — Abonnements, Channels und Presence auf einer einzelnen Instanz
- [Split Processes](/docs/deployment/split-processes/) — Die Deployment-Form, für die dies relevant ist
- [Self-hosting](/docs/deployment/self-hosting/) — Die Runtime selbst betreiben

---

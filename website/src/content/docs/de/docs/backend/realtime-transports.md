---
sourceHash: 18c4ff1205a910b2
title: Realtime über mehrere Instanzen hinweg
sidebar_label: Realtime über mehrere Instanzen hinweg
description:"\"Wie Broadcast-Channels und Presence über mehr als einen Serverprozess hinweg funktionieren: Der LISTEN/NOTIFY-Bus, was jede Instanz besitzt und wie Sie Ihren eigenen Transport schreiben.\""
---

## Instanzübergreifendes Broadcasting & LISTEN/NOTIFY-Architektur

Für Cluster-Umgebungen mit mehreren Instanzen (z. B. beim Betrieb in Kubernetes oder Docker-Containern hinter einem Load Balancer) setzt Rebase auf PostgreSQL `LISTEN/NOTIFY`, um **Zeilenänderungen** über Instanzen hinweg zu synchronisieren. Subscriptions für Collections und Entitäten funktionieren daher ohne zusätzliche Konfiguration über Instanzen hinweg – genau das wird in diesem Abschnitt beschrieben.

**Broadcast-Channels und Presence sind getrennt** und arbeiten pro Instanz, bis Sie einen Channel-Bus aktivieren. Siehe [Channels und Presence über mehrere Instanzen hinweg](#channels-und-presence-über-mehrere-instanzen-hinweg) weiter unten.

### Umgehung von pgBouncer-Pools

Da Connection-Pooler wie **pgBouncer** das persistente Verbindungsmodell nicht unterstützen, das für langlebige SQL-`LISTEN`-Sitzungen erforderlich ist, öffnet der Realtime-Supervisor einen dedizierten, ungepoolten Postgres-Client (`PgClient`) direkt zur Datenbank. Diese direkte Verbindung nutzt die Umgebungsvariable `DATABASE_DIRECT_URL`, sofern konfiguriert. Dies gewährleistet Stabilität und verhindert die Erschöpfung des Pools oder plötzliche Verbindungsabbrüche.

### Benachrichtigungsmechanismen & Payload-Layout

Wenn [Database Change Capture](/docs/backend/realtime-cdc/) aktiv ist – standardmäßig überall dort, wo die Datenbankrolle Trigger erstellen kann –, hört jede Instanz jeden Commit auf dem Kanal `rebase_cdc`, und nichts von dem Folgenden wird gesendet. Ohne Change Capture sendet eine Instanz A bei der Änderung eines Datensatzes eine Benachrichtigung auf dem Kanal `rebase_entity_changes`. Um den Datenbank-Overhead und die Netzwerkbandbreite zu minimieren, wird die Benachrichtigungs-Payload extrem kompakt gehalten:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Hinweis: `sid` steht für die eindeutige, zufällige Instanz-ID des Servers, die beim Start generiert wird, `p` ist der Collection-Slug (Pfad) und `eid` ist die Ziel-Entitäts-ID.*

Änderungen, die im selben Moment vorgenommen werden – ein Bulk-Save kündigt jede geschriebene Zeile an –, werden zusammengefasst versendet; und zwar in so wenigen Benachrichtigungen, wie unter das 8000-Byte-NOTIFY-Limit von Postgres passen, wobei jede ihre Änderungen als `[p, eid, db]`-Tripel auflistet:

```json
{
  "sid": "inst_7a9c1b",
  "c": [["posts", "45", null], ["posts", "46", null]]
}
```

Eine einzelne Änderung behält die obige Struktur bei, sodass eine ältere Instanz sie während eines Rolling Deployments weiterhin lesen kann.

- **Eigenfilterung (Self-Filtering)**: Beim Empfang einer Nachricht liest jede Instanz die `sid`. Stimmt diese mit der eigenen Instanz-ID überein, verwirft der Server die Benachrichtigung, um Endlosschleifen beim Routing zu verhindern.
- **Weiterleitung und Fan-out**: Stammt die Benachrichtigung von einer anderen Instanz, plant der Server ein entprelltes (debounced) erneutes Abrufen (Refetch) für seine lokal verbundenen Abonnenten jeder Änderung. Beim Empfang liest er nichts: Jeder Frame führt zu einem Refetch unter dem Scope des jeweiligen Abonnenten.
- **Supervisor-Wiederverbindungsschleife**: Wenn die Datenbankverbindung abbricht, überwacht ein Hintergrund-Verbindungs-Supervisor den Status und löst nach einer festen Verzögerung von **3 Sekunden** eine automatische Wiederverbindungssequenz aus. Dadurch wird die `LISTEN`-Schleife wiederhergestellt, ohne den Hauptlebenszyklus der Hono-Anwendung zu beeinträchtigen. Jede aktive Subscription auf der Instanz wird anschließend erneut abgerufen, da alles, was während des Ausfalls veröffentlicht wurde, niemanden erreicht hat. Kann die Datenbank beim Start nicht erreicht werden, wird der Verbindungsaufbau auf dieselbe Weise wiederholt.
- **Heartbeat**: Eine `LISTEN`-Verbindung ist naturgemäß inaktiv (idle). Ein Idle-Flow-Timeout auf einem Load Balancer oder einem NAT kann sie ohne Fehlermeldung auf beiden Seiten trennen (halb-offene Verbindung). Daher läuft sie mit TCP-Keepalive und muss alle 30 Sekunden innerhalb von 10 Sekunden ein `SELECT 1` beantworten. Schlägt dies fehl, wird sie wie oben beschrieben ersetzt. Während die Verbindung unterbrochen ist, führt `/health` sie als `cross-instance` auf; sobald sie für 60 Sekunden unterbrochen war, schlägt der Health-Check fehl.

## Channels und Presence über mehrere Instanzen hinweg

Zeilenänderungen werden von selbst über Instanzen hinweg übertragen (siehe oben). Broadcast-Channels und Presence tun dies standardmäßig **nicht**: Sie werden standardmäßig nur an die Clients verteilt, die mit der Instanz verbunden sind, die sie empfangen hat.

Auf einer einzelnen Instanz ist das genau richtig und verursacht keinen Overhead. Hinter einem Load Balancer ist dies jedoch ein Fehler, den Sie bei der Entwicklung nicht bemerken werden: Zwei kollaborierende Benutzer landen auf unterschiedlichen Replikaten, treten demselben Channel bei und sehen einen leeren Raum, obwohl sie perfekt aneinander senden. Es tritt kein Fehler auf.

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

| Bus          | Wann er verwendet werden sollte                                                                      |
|--------------|------------------------------------------------------------------------------------------------------|
| `memory`     | **Standard.** Einzelne Instanz. Keine instanzübergreifende Übertragung, kein Overhead.              |
| `postgres`   | Zwei oder mehr Instanzen. Nutzt `LISTEN/NOTIFY` auf Ihrer bestehenden Datenbank – kein neuer Dienst erforderlich. |

Der Transport kann auch pro Deployment über `REALTIME_CHANNEL_BUS=memory|postgres` festgelegt werden, sodass er ohne Rebuild geändert werden kann.
Er überschreibt ein **benanntes** Built-in (`bus: { type: "memory" }`) und wird
bewusst **ignoriert**, wenn `realtime.bus` eine bereits instanziierte
`ChannelBus`-Instanz übergeben wurde – die Variable kann nur Transporte benennen,
die dieses Paket selbst erstellen kann; sie dort zu berücksichtigen, würde bedeuten,
das von der Anwendung übergebene Objekt stillschweigend zu verwerfen. In diesem
Fall wird eine Warnung protokolliert, die beides benennt, und ein nicht
erkannter Wert fällt auf die zuvor konfigurierte Option zurück anstatt auf Memory.

### Warum es standardmäßig keine Redis-Option gibt

Rebase wird als Postgres + Backend + Frontend bereitgestellt. Ein Bus, der einen Message-Broker benötigt, würde einen zweiten zustandsbehafteten Dienst in jedes von der CLI erstellte `docker-compose.yml` einfügen – für eine Funktion, die die meisten Anwendungen nie benötigen. Die Hürde für das Hinzufügen eines solchen Dienstes ist daher, dass die Datenbank die Last nachweislich nicht mehr tragen kann.

Sie kann es. Gemessen über zwei Backend-Instanzen hinweg gegen einen einzelnen Postgres-Container lieferte der Postgres-Bus **~10.000 instanzübergreifende Nachrichten pro Sekunde ohne Verluste** und blieb bis hin zu **acht Instanzen** stabil (14.000 Übertragungen, keine Verluste). Zwanzig Benutzer, die Cursor mit 60 fps bewegen, erzeugen etwa 1.200 Nachrichten pro Sekunde – rund ein Achtel davon.

Das Limit, auf das man achten sollte, ist nicht die Kapazität, sondern dass jede Benachrichtigung eine Abfrage an Ihre primäre Datenbank darstellt, die mit den eigentlichen Abfragen Ihrer Anwendung konkurriert. Der Postgres-Bus fasst ausgehende Frames daher zusammen (**Coalescing**, siehe unten), was dafür sorgt, dass diese Kosten proportional zur verstrichenen Zeit und nicht zur Nachrichtenanzahl bleiben.

Pro Client akzeptiert der Socket bis zu **7.200 Channel-Frames pro Minute** (120/s – 60 fps für Cursor-Broadcasts plus das Presence-Update, das jeder davon trägt), separat gezählt vom Budget, das sich Queries und Subscriptions teilen. Frames, die darüber hinausgehen, werden mit einem `RATE_LIMITED`-Fehler abgewiesen, statt in eine Warteschlange gestellt zu werden.

Die Abweisung erfolgt über `channel.onError()`, nicht als abgelehnter `broadcast()`-Aufruf – siehe [Wenn ein Channel-Frame abgewiesen wird](/docs/backend/realtime#when-a-channel-frame-is-refused).

Wenn Sie danach immer noch an Grenzen stoßen, drosseln Sie cursorbezogene Ereignisse auf dem Client (Last-Write-Wins-Status benötigt keine 60 Updates pro Sekunde) und erwägen Sie, Bearbeiter desselben Dokuments mit [`affinity`](/docs/sdk/realtime#keeping-a-group-on-one-instance) auf dieselbe Instanz zu leiten – Sticky-Routing reduziert den instanzübergreifenden Datenverkehr unabhängig von der Benutzeranzahl auf nahezu null. Erst darüber hinaus lohnt sich ein anderer Transport, und dann lautet die Lösung ein separates Transport-Paket, kein Fork. Siehe [Einen eigenen Transport schreiben](#einen-eigenen-transport-schreiben).

### Das Verhalten des Busses überwachen

Wenn `REBASE_METRICS=true` gesetzt ist, meldet jede Instanz unter `/metrics`, was sie überträgt:

| Metrik | Typ | Bedeutung |
|--------|-----|-----------|
| `rebase_realtime_sockets` | Gauge | Offene Sockets auf dieser Instanz |
| `rebase_realtime_channels` | Gauge | Channels mit mindestens einem Mitglied auf dieser Instanz |
| `rebase_realtime_bus_frames_published_total` | Counter | Frames, die diese Instanz an den Bus gesendet hat, nach `kind`: `broadcast`, `broadcast_ref`, `presence_diff` und `channels` (Instanzen teilen sich gegenseitig mit, was sie bedienen) |
| `rebase_realtime_bus_frames_skipped_total` | Counter | Broadcasts und Presence-Änderungen, die nicht gesendet wurden, weil keine andere Instanz Mitglieder im Channel hatte |

Counter starten bei null, wenn eine Instanz startet, und zählen Frames, von denen der Bus mehrere zu einer einzigen Benachrichtigung zusammenfassen kann. Retained Messages werden immer übertragen und daher nie übersprungen. Beim standardmäßigen `memory`-Bus bleiben beide bei null.

Scrapen Sie jede Instanz einzeln und nicht über einen vorgeschalteten Load Balancer: Die Zahlen gelten pro Prozess. Eine Gruppe, die auf einer Instanz verbleibt, zeigt sich daran, dass `skipped` steigt, während `broadcast` und `presence_diff` flach bleiben und die Sockets über die Instanzen verteilt sind. Broadcasts, die auf jeder Instanz ansteigen, bedeuten, dass die Channels instanzübergreifend sind. In Rebase Cloud zeigt `rebase cloud metrics` dieselben Zahlen pro Instanz an.

### Coalescing (Zusammenfassen von Nachrichten)

Frames, die veröffentlicht werden, während ein kurzes Zeitfenster offen ist, werden zusammen in einer einzigen Benachrichtigung versendet. Das Zeitfenster ist **Leading-Edge**: Ein Frame, der eintrifft, wenn kein Zeitfenster offen ist, wird sofort gesendet. So entsteht bei einem inaktiven Kanal keine zusätzliche Latenz, und nur ein kontinuierlicher Stream wird gebatcht.

Gemessen über zwei Instanzen mit 3.000 Broadcasts, die in jedem Fall vollständig zugestellt wurden:

| Traffic-Muster | Coalescing aus | Coalescing an | Reduktion |
|---|---|---|---|
| Burst (so schnell wie möglich) | 3.000 Queries | 68 Queries | **44×** |
| Gleichmäßig (~500 Msg/s, verteilt) | 3.000 Queries | 240 Queries | **12,5×** |

Der Burst-Fall war zudem in der reinen Laufzeit (Wall-Clock) etwa 11-mal schneller beendet, da die Datenbank-Roundtrips der Engpass waren und nicht die eigentliche Arbeit.

Das Zeitfenster ist standardmäßig auf 10 ms eingestellt und keine sensible Einstellung – 5 ms, 10 ms und 20 ms führten bei beiden Mustern zu identischen Abfragezahlen, da ein Batch lange vor Ablauf des Timers durch die 8-KB-Payload-Grenze oder die natürliche Struktur des Traffics begrenzt wird. Ändern Sie dies nur, wenn Sie einen konkreten Grund haben:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 deaktiviert Coalescing
}
```

Ein Hinweis zum Deployment: Ein Batch wird über das Netzwerk in einer anderen Struktur übertragen als ein einzelner Frame, und eine Instanz, auf der ein älterer Build läuft, versteht diesen nicht. Einzelne Frames werden immer unverpackt gesendet, sodass bei einem Rolling Deployment nur dann die Gefahr verworfener Frames besteht, wenn der Cluster *während* des Neustarts unter anhaltender Last steht – und persistierte Channels reparieren sich ohnehin über den History-Replay selbst.

## Einen eigenen Transport schreiben

`realtime.bus` akzeptiert jedes Objekt, das die `ChannelBus`-Schnittstelle implementiert, sodass ein Transport als eigenes Paket bereitgestellt werden kann – `@rebasepro/types` deklariert den Vertrag, und zur Implementierung ist nichts weiter erforderlich:

```typescript
import type { ChannelBus, ChannelBusFrame, ChannelBusHandler } from "@rebasepro/types";

export class MyChannelBus implements ChannelBus {
    readonly kind = "my-transport";
    readonly maxFrameBytes = Infinity;

    async start(handler: ChannelBusHandler): Promise<void> {
        // Verbinden. Rejecten, wenn dies fehlschlägt – der Aufrufer fällt auf
        // In-Process-Delivery zurück, was weitaus besser ist als ein Cluster,
        // der glaubt verbunden zu sein, es aber stillschweigend nicht ist.
    }

    async publish(frame: ChannelBusFrame): Promise<void> {
        // Jede andere Instanz erreichen, oder rejecten.
    }

    async stop(): Promise<void> {
        // Idempotent; alles freigeben, was die Event-Loop offen hält.
    }
}
```

Übergeben Sie die Instanz dort, wo sonst der Name eines Built-ins stehen würde:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**Was Ihre Implementierung garantieren muss:** `start()` schlägt fehl (reject), wenn der Transport unbrauchbar ist; `publish()` erreicht jede andere Instanz oder schlägt fehl; `stop()` ist idempotent; und eine fehlerhafte Nachricht wird verworfen und protokolliert, anstatt eine Exception auszulösen, damit ein einzelner fehlerhafter Frame nicht den Listener zum Absturz bringt.

**Was sie nicht garantieren muss:** Reihenfolge (persistierte Channels enthalten `seq` und das SDK sortiert danach), Beständigkeit (ein verlorener Frame ist ein verpasstes Live-Update, das durch das History-Replay des Clients behoben wird) oder Exactly-Once-Delivery (persistierte Frames werden per `seq` dedupliziert; Presence-Diffs sind idempotent).

Über `maxFrameBytes` erkennt das Framework, ob eine große persistierte Nachricht inline oder als Pointer gesendet werden soll. Geben Sie `Infinity` zurück, wenn Ihr Transport keine relevante Obergrenze hat, damit der Pointer-Pfad nicht unnötig gewählt wird.

Die Zustellung an lokale Clients liegt nicht in Ihrer Verantwortung – der Realtime-Dienst bestimmt, welche Abonnenten einen Frame erhalten. Ein Transport bewegt Frames lediglich zwischen Instanzen.

### Das 8-KB-Limit beim Postgres-Bus

`pg_notify` lehnt Payloads von 8000 Bytes oder mehr ab. Cursors und Presence passen problemlos hinein; ein Dokument-Snapshot hingegen nicht. Rebase geht damit genauso um wie mit großen Entitätsänderungen – indem anstelle des Inhalts eine Adresse gesendet wird:

- **Auf einem Retained Channel** (siehe [Channel Retention](/docs/backend/realtime#channel-retention)) ist die Nachricht bereits mit einer Sequenznummer gespeichert, sodass die Benachrichtigung lediglich `(channel, seq)` enthält und jede empfangende Instanz den Inhalt selbst nachliest. Es gibt keinerlei Größenbeschränkung. Dies gilt für jede persistierte Nachricht, ob klein oder groß: Da sich jeder Datenbankbenutzer mit `LISTEN` verbinden kann, wird der Inhalt niemals in der Benachrichtigung übertragen. Dies kostet einen Primary-Key-Read pro Nachricht auf jeder Instanz, die ein Mitglied im Channel hat.
- **Flüchtige (ephemere) Broadcasts und Presence** werden weiterhin in der Benachrichtigung selbst übertragen, sodass jeder Datenbankbenutzer sie lesen kann. Übertragen Sie sensible Daten, die auf diese Weise nicht lesbar sein dürfen, ausschließlich über einen Retained Channel.
- **Auf einem ephemeren Channel** gibt es keinen Bezugspunkt, auf den verwiesen werden könnte. Der Broadcast wird lokal zugestellt, der Sender erhält einen `CHANNEL_BUS_PAYLOAD_TOO_LARGE`-Fehler über `channel.onError()`, und eine Warnung benennt den Channel – anstatt dass die Nachricht stillschweigend nur die Hälfte des Clusters erreicht.

Wenn Sie große Nachrichten übertragen, versehen Sie diesen Channel mit einer Retention-Regel. Das ist bereits die gesamte Lösung.

### Presence ist geteilter Zustand, nicht nur Fan-out

`presence_state` muss die Frage „Wer befindet sich in diesem Channel?“ für den gesamten Cluster beantworten können, was über den speicherbasierten Zustand einzelner Instanzen nicht möglich ist. Wenn ein Bus aktiv ist, speichert Rebase die Liste in `rebase.channel_presence` (wird automatisch angelegt) und beantwortet Roster-Anfragen daraus.

| Spalte        | Inhalt                                         |
|---------------|------------------------------------------------|
| `channel`     | Name des Channels                              |
| `client_id`   | Der getrackte Client                           |
| `instance_id` | Mit welcher Backend-Instanz er verbunden ist   |
| `state`       | Der Presence-Status des Clients                |
| `last_seen`   | Aktualisiert durch den Presence-Heartbeat des SDK |

Das SDK sendet ca. alle 20 Sekunden einen Presence-Heartbeat bei einem Timeout von 30 Sekunden. Zeilen, die nicht mehr aktualisiert werden, werden bereinigt und die Abgänge an alle Instanzen gemeldet – was gleichzeitig als Crash-Recovery dient: Ein Pod, der abstürzt, hinterlässt Zeilen, die nach Ablauf eines Timeout-Fensters genau wie jeder andere inaktiv gewordene Client aussehen. Ein reguläres Herunterfahren löscht die eigenen Zeilen sofort, sodass bei einem Rolling Deployment keine Phantom-Benutzer sichtbar werden.

:::caution[Die LISTEN-Verbindung muss Ihren Pooler umgehen]
`LISTEN` ist ein Sitzungszustand, daher benötigt der Postgres-Bus eine direkte Verbindung – keinen pgBouncer oder einen anderen Pooler im Transaktionsmodus. Rebase verwendet `DATABASE_DIRECT_URL`, sofern gesetzt; hinter einem Pooler verweisen Sie damit direkt auf den Datenbankdienst selbst. Ohne eine nutzbare direkte URL protokolliert der Bus eine Warnung und verbleibt im Memory-Modus.
:::

## Nächste Schritte

- [Realtime & WebSocket](/docs/backend/realtime/) – Subscriptions, Channels und Presence auf einer einzelnen Instanz
- [Getrennte Prozesse](/docs/deployment/split-processes/) – Die Deployment-Architektur, für die dies relevant ist
- [Self-Hosting](/docs/deployment/self-hosting/) – Die Runtime selbst betreiben

---
sourceHash: 05f7e05823faa1cf
title: Realtime & WebSocket
sidebar_label: Realtime
description: Echtzeit-Datensynchronisierung, Broadcast-Kanäle und Presence-Tracking über WebSocket.
---

Rebase enthält eine integrierte Realtime-Engine, die Datenänderungen über WebSocket an verbundene Clients pusht.
Wenn ein Datensatz erstellt, aktualisiert oder gelöscht wird, erhält jeder Abonnent, der diese Collection oder Entity beobachtet, das Update sofort – kein Polling erforderlich.

## Funktionsweise

Die Realtime-Pipeline besteht aus drei Phasen:

1. **Datenbank-Trigger** — Eine Mutation trifft die PostgreSQL-Datenbank (über REST-API, SDK oder Studio).
2. **Server-Fan-Out** — Der Rebase-Server erkennt die Änderung und verteilt sie an jedes aktive WebSocket-Abonnement, das der betroffenen Collection oder Entity entspricht.
3. **Client-Callback** — Das Client-SDK führt Ihren `onUpdate`-Callback mit den aktuellen Daten aus.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Für Multi-Instance-Deployments nutzt Rebase das `LISTEN/NOTIFY` von PostgreSQL, um Änderungen über Server-Instanzen hinweg zu übertragen. Dies wird automatisch gehandhabt – eine dedizierte PostgreSQL-Verbindung lauscht auf dem Kanal `rebase_entity_changes` und leitet Updates an lokale Abonnenten weiter.

### Zero-Konfiguration

Realtime ist standardmäßig aktiviert. Es muss kein Flag gesetzt oder Dienst gestartet werden – wenn Ihr Rebase-Server läuft, ist der WebSocket-Endpunkt verfügbar.

> Standardmäßig gibt Rebase auch Realtime-Events für Schreibvorgänge aus, die **außerhalb** der API durchgeführt werden (über `psql`, einen anderen Dienst oder den SQL-Editor von Studio), sofern die Datenbankverbindung dies unterstützt – siehe [Change Capture auf Datenbankebene (CDC)](#database-level-change-capture-cdc).

## Client-SDK-Abonnements

Das Rebase-Client-SDK stellt zwei Abonnement-Methoden auf jedem Collection-Accessor bereit:

- **`listen()`** — Abonnieren einer gesamten Collection (mit optionalen Filtern).
- **`listenById()`** — Abonnieren einer einzelnen Entity anhand ihrer ID.

Beide Methoden geben eine **Unsubscribe-Funktion** zurück, die Sie aufrufen, um den Empfang von Updates zu beenden.

### Eine Collection abonnieren

Verwenden Sie `listen()`, um Updates zu erhalten, sobald sich Datensätze in einer Collection ändern:

```typescript
const unsubscribe = client.data.products.listen(
  undefined, // FindParams — pass undefined for all records
  (response) => {
    console.log("Products updated:", response.data);
    console.log("Total:", response.meta.total);
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

Der Callback erhält ein `FindResponse<M>`, das Folgendes enthält:
- `data` — Array von `Entity<M>`-Objekten.
- `meta` — Paginierungs-Informationen (`total`, `limit`, `offset`, `hasMore`).

### Eine Collection mit Filtern abonnieren

Übergeben Sie `FindParams` als erstes Argument, um das Abonnement zu filtern:

```typescript
const unsubscribe = client.data.products.listen(
  {
    where: { status: ["==", "published"] },
    orderBy: ["createdAt", "desc"],
    limit: 50,
  },
  (response) => {
    console.log("Published products:", response.data);
  }
);
```

Der Server berücksichtigt diese Filter – nur übereinstimmende Datensätze sind in den Updates enthalten.

### Eine einzelne Entity abonnieren

Verwenden Sie `listenById()`, um einen bestimmten Datensatz zu beobachten:

```typescript
const unsubscribe = client.data.products.listenById(
  "product-123",
  (entity) => {
    if (entity) {
      console.log("Product updated:", entity.values);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

Der Callback empfängt `Entity<M> | undefined`. Ein Wert von `undefined` bedeutet, dass die Entity gelöscht wurde.

### Abbestellen (Unsubscribe)

Sowohl `listen()` als auch `listenById()` geben eine Unsubscribe-Funktion zurück. Rufen Sie diese auf, um den Empfang von Updates zu stoppen und serverseitige Ressourcen freizugeben:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Rufen Sie die Unsubscribe-Funktion immer auf, wenn eine Komponente unmountet oder zu einer anderen Seite navigiert wird. Dies verhindert Speicherlecks und unnötigen serverseitigen Verarbeitungsaufwand.
:::

## Query Builder `.listen()`

Der Fluent Query Builder unterstützt ebenfalls Realtime-Abonnements. Verketten Sie Ihre Filter und rufen Sie dann `.listen()` anstelle von `.find()` auf:

```typescript
const unsubscribe = client.data.orders
  .where("status", "==", "pending")
  .orderBy("createdAt", "desc")
  .limit(20)
  .listen(
    (response) => {
      console.log("Pending orders:", response.data);
    },
    (error) => {
      console.error("Error:", error);
    }
  );
```

:::note
Die Methode `.listen()` im Query Builder ist nur verfügbar, wenn der `RebaseClient` mit einer `websocketUrl` konfiguriert ist. Wenn die WebSocket-Verbindung nicht konfiguriert ist, wirft der Aufruf von `.listen()` einen Fehler.
:::

## Update-Bereitstellung: Sofortiger Patch + Korrektheits-Refetch

Eine Änderung wird niemals direkt als Daten an einen Abonnenten übertragen. Sie wird als die Tatsache übertragen, dass sich etwas geändert hat, und jedem Abonnenten wird anschließend über eine in seinem Kontext ausgeführte Abfrage mitgeteilt, was *er* sehen darf:

1. **Invalidierung.** Wenn sich eine Entity ändert (erstellt, aktualisiert, gelöscht), markiert der Server die betroffenen Pfade. Die geschriebene Zeile wird nicht weitergeleitet – sie wurde unter der Autorisierung des Schreibenden gelesen, was nichts darüber aussagt, was ein Abonnent sehen darf.

2. **Debounced RLS-Refetch.** Nach **300 ms** (`REFETCH_DEBOUNCE_MS`) ruft der Server die Collection mit Ihren ursprünglichen Filtern und der Sortierreihenfolge erneut ab. Die Abfrage wird innerhalb einer Transaktion ausgeführt, die die transaktionslokalen Variablen `app.user_id` und `app.user_roles` aus dem `SubscriptionAuthContext` des Abonnenten setzt, sodass Postgres Row-Level Security unter der Identität dieses Clients auswertet und nur die Zeilen gesendet werden, für die er autorisiert ist, in `collection_update`. Das Debouncing fasst zudem eine Reihe schneller Schreibvorgänge in einer einzigen Abfrage zusammen.

Frühere Versionen sendeten vor diesem Refetch ein sofortiges `collection_patch`, das die geschriebene Zeile enthielt, um Feedback über Tabs hinweg im Sub-Millisekundenbereich zu liefern. Diese Zeile war jedoch im Scope des Schreibenden gelesen worden, sodass sie Abonnenten erreichen konnte – und erreichte –, deren eigene Policies dies verweigert hätten, und auch der `where`-Filter des Abonnements wurde nicht darauf angewendet. Das Patch wurde entfernt: Die wahrgenommene Latenz für ein Update entspricht nun dem Debounce-Fenster.

### Der Refetch entspricht dem REST-Lesevorgang

Der Refetch führt dieselbe Pipeline aus wie `GET /api/data/<collection>`, mit der gleichen `include`-Handhabung. Dadurch geben `find({ q })` und `listen({ q })` Zeilen zurück, die Feld für Feld identisch sind.

Früher war dies eine andere Methode – eine, die jede Relation in einen `{ "__type": "relation" }`-Umschlag einbettete und, da ein Abonnement kein `include` enthalten konnte, **jede** von der Collection deklarierte Relation eager lud. So antwortete dieselbe Abfrage über HTTP in einer Struktur und über den Socket in einer anderen, und ein Client, der beides renderte, sah, wie sich die Struktur seiner Zeilen in dem Moment änderte, in dem ein Schreibvorgang eintraf.

Ein Subscribe-Frame akzeptiert daher dieselben Parameter wie ein Listen-Request: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` und `fields`. `vectorSearch` ist die Ausnahme und wird mit `VECTOR_SEARCH_NOT_LIVE` **abgelehnt** – ein Abonnement wird bei jedem passenden Schreibvorgang erneut ausgeführt und dort werden keine Distanzen berechnet.

### `collection_update` enthält eigene Metadaten

Der Frame hat das Format `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` wird innerhalb derselben RLS-gebundenen Transaktion gezählt, die die Zeilen gelesen hat, sodass es genau die danebenstehenden Zeilen beschreibt. Ohne dies musste ein Client, der eine Gesamtzahl benötigte, **pro Push** ein `GET /count` ausführen – ein zusätzlicher Roundtrip pro Schreibvorgang und Abonnent sowie ein Zeitfenster, in dem der Count und die Zeilen unterschiedliche Zustände der Collection beschrieben.

Wenn die Zählung selbst fehlschlägt, enthält der Frame `partial: true` und kein `total`; dies ist kein Abonnementfehler, und ein Client sollte den letzten echten Gesamtwert beibehalten, anstatt die Seitenlänge einzusetzen.

## Broadcast-Kanäle

Broadcast-Kanäle ermöglichen es Clients, beliebige Nachrichten in Echtzeit untereinander zu versenden – nützlich für Funktionen wie Tippindikatoren, Cursor-Positionen oder benutzerdefinierte Benachrichtigungen.

Broadcasts werden auf WebSocket-Protokollebene verwaltet. Der Server unterstützt die folgenden Nachrichtentypen:

| Message Type     | Direction       | Description                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Einem benannten Kanal beitreten          |
| `leave_channel`   | Client → Server | Einen Kanal verlassen                   |
| `broadcast`       | Client → Server | Eine Nachricht an alle Kanalmitglieder senden |
| `broadcast`       | Server → Client | Eine Nachricht von einem anderen Mitglied empfangen |
| `channel_history` | Client → Server | Beibehaltene Nachrichten nach einer Sequenz anfordern |
| `channel_history` | Server → Client | Die beibehaltenen Nachrichten, die ein Client verpasst hat |

Wenn ein Client eine `broadcast`-Nachricht sendet, leitet der Server diese an **alle anderen Mitglieder** dieses Kanals weiter (der Absender erhält seine eigene Nachricht nicht).

```typescript
// Broadcast message structure (sent by client)
{
  type: "broadcast",
  payload: {
    channel: "room-42",
    event: "typing",
    payload: { userId: "user-1", isTyping: true }
  }
}

// Received by other clients in the channel
{
  type: "broadcast",
  channel: "room-42",
  event: "typing",
  payload: { userId: "user-1", isTyping: true }
}
```

## Kanal-Retention (Aufbewahrung)

Standardmäßig erreicht ein Broadcast die aktuell verbundenen Mitglieder und ist danach verworfen. Das ist der richtige Kompromiss für Benachrichtigungen und Cursor und verursacht keine Kosten.

Für einen Operations-Stream – kollaboratives Bearbeiten oder alles, wo eine unbemerkte Lücke zu Abweichungen führt – kann ein Kanal so konfiguriert werden, dass er seine Nachrichten **beibehält** (retain). Beibehaltene Broadcasts erhalten eine kanalspezifische Sequenznummer und werden gespeichert, sodass ein Client bei einer erneuten Verbindung alles nach der zuletzt gesehenen Nachricht anfordern kann.

:::caution[Wo dies konfiguriert wird]
**Managed Runtime: nirgends.** Kanal-Retention und `realtime.bus` sind Teil des Datenbank-Adapters, den die Managed Runtime selbst erstellt, und keines von beiden hat ein Umgebungsformular. Führen Sie einen Eject durch, um sie zu konfigurieren.
**Nach Eject:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
:::

Retention ist optional (Opt-in) und wird hier auf dem Server konfiguriert:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";

await initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations },
        realtime: {
            channels: [
                // Most specific first — the first match wins.
                { match: "doc:draft:*", limit: 100 },
                { match: "doc:*", limit: 500, ttl: "24h" }
            ]
        }
    })
});
```

| Field   | Description                                                                 |
|---------|-----------------------------------------------------------------------------|
| `match` | Exakter Kanalname (`"doc:42"`) oder ein Präfix mit abschließendem `*` (`"doc:*"`) |
| `limit` | Maximal so viele der neuesten Nachrichten pro Kanal behalten                |
| `ttl`   | Nachrichten maximal so lange aufbewahren – `"30s"`, `"15m"`, `"24h"`, `"7d"` oder Millisekunden |

Eine Regel benötigt mindestens `limit` oder `ttl`. Eine Regel ohne beides wird ignoriert und protokolliert, da unbegrenzte Aufbewahrung fast nie beabsichtigt ist und nicht mehr rückgängig gemacht werden kann, sobald die Tabelle angewachsen ist.

:::note[Warum lässt man Clients nicht nach dem Verlauf fragen?]
Ein Kanal wird von demjenigen erstellt, der ihn benennt. Wenn ein Client seine eigene Verlaufstiefe wählen könnte, könnte jeder Besucher Ihren Backend-Speicher unbegrenzt belasten. Die Konfiguration hier bedeutet auch, dass Presence- und Benachrichtigungskanäle – die überwiegende Mehrheit – nichts kosten: Ohne konfigurierte Regeln wird keine Tabelle erstellt und der Broadcast läuft über denselben synchronen Pfad wie bisher.
:::

### Speicherung

Beibehaltene Kanäle verwenden zwei Tabellen im `rebase`-Schema, die beim Start automatisch erstellt werden, wenn mindestens eine Regel konfiguriert ist:

| Table                     | Contents                                                        |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | Die beibehaltenen Nachrichten, indiziert nach `(channel, seq)`  |
| `rebase.channel_cursors`  | Die höchste pro Kanal ausgegebene Sequenz                       |

Das Bereinigen (Pruning) erfolgt beim Eintreffen von Nachrichten und ist pro Kanal gedrosselt, sodass die Kosten von der verstrichenen Zeit und nicht vom Schreibvolumen abhängen. Es werden immer nur Zeilen aus `channel_messages` entfernt – Cursor werden unbegrenzt aufbewahrt (sie bestehen aus einer kleinen Zeile pro Kanal), da ein Neustart der Sequenz eines Kanals die Bedeutung des gespeicherten Wiederaufnahmepunkts eines Clients verändern würde.

### Zustellgarantien

- **Geordnet (Ordered).** Sequenznummern werden pro Kanal vergeben, und die Zustellreihenfolge entspricht der Sequenzreihenfolge.
- **Dauerhaft vor der Zustellung (Durable before delivered).** Eine Nachricht, die nicht gespeichert werden kann, wird an niemanden zugestellt, und der Absender wird benachrichtigt. Die Zustellung würde sie Live-Abonnenten präsentieren, sie aber aus jedem zukünftigen Replay ausschließen, und keine spätere Nachricht könnte diese Lücke schließen.
- **At-least-once beim Nachholen.** Ein Replay-Bereich kann sich mit Nachrichten überschneiden, die ein Client bereits empfangen hat; das SDK verwirft Nachrichten, die es bereits zugestellt hat.

:::caution[Der Verlauf hat dasselbe Zugriffsmodell wie der Kanal]
Ein Client, der einem Kanal beigetreten ist, kann dessen gespeicherte Nachrichten wiedergeben, einschließlich derjenigen, die vor seinem Beitritt gesendet wurden – die Mitgliedschaft ist die einzige Prüfung, und der Beitritt steht jedem Client offen, der den Kanalnamen kennt. Die Aufbewahrung ist per Kanalmuster optional, sodass ihre Aktivierung die Vergangenheit dieses Kanals für jeden Besucher lesbar macht, der den Namen errät. Bei beibehaltenen Kanälen wird dies dauerhaft statt nur flüchtig. Behandeln Sie den Inhalt eines retainierten Kanals daher als öffentlich für Ihre Benutzer.
:::

## Presence-Tracking

Presence verfolgt, welche Benutzer aktuell in einem Kanal online sind, und ermöglicht es jedem Benutzer, einen benutzerdefinierten Status zu teilen (z. B. Cursor-Position, Status).

| Message Type       | Direction       | Description                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Presence-Tracking mit benutzerdefiniertem Status starten |
| `presence_untrack`| Client → Server | Presence-Tracking beenden                            |
| `presence_state`  | Client → Server | Vollständigen Presence-Status für einen Kanal anfordern |
| `presence_state`  | Server → Client | Vollständiger Zustand aller Presences in einem Kanal |
| `presence_diff`   | Server → Client | Inkrementelles Update (Beitritte und Austritte)      |

Wenn ein Client `presence_track` sendet, tritt der Server dem Kanal automatisch bei (kein separates `join_channel` erforderlich) und überträgt ein `presence_diff` an alle Kanalmitglieder.

```typescript
// Track presence
{
  type: "presence_track",
  payload: {
    channel: "document-edit-42",
    state: { name: "Alice", cursor: { line: 10, col: 5 } }
  }
}

// Presence diff received by other clients
{
  type: "presence_diff",
  channel: "document-edit-42",
  joins: { "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } } },
  leaves: {}
}

// Full presence state response
{
  type: "presence_state",
  channel: "document-edit-42",
  presences: {
    "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } },
    "client-def": { name: "Bob", cursor: { line: 22, col: 0 } }
  }
}
```

Veraltete Presences werden nach 30 Sekunden Inaktivität automatisch bereinigt.

## Automatische Wiederverbindung (Auto-Reconnect)

Das Client-SDK stellt die Verbindung automatisch wieder her, wenn die WebSocket-Verbindung abbricht:

- **Exponentieller Backoff** — Wiederverbindungsverzögerungen beginnen bei 1 Sekunde und verdoppeln sich bei jedem Versuch, gedeckelt auf maximal 30 Sekunden.
- **Maximal 5 Versuche** — Nach 5 fehlgeschlagenen Wiederverbindungsversuchen bricht der Client die Versuche ab.
- **Automatische erneute Abonnierung (Resubscription)** — Bei erfolgreicher Wiederverbindung werden alle aktiven Abonnements erneut beim Server registriert. Kein manueller Eingriff erforderlich.
- **Message Queuing** — Nachrichten, die während der Trennung gesendet werden, werden in eine Warteschlange eingereiht und nach der Wiederverbindung zugestellt.

Sie können auf Lebenszyklus-Ereignisse der Verbindung lauschen:

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
const ws = client.ws;
if (ws) {
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

## Authentifizierung & RLS

WebSocket-Abonnements berücksichtigen automatisch die Row-Level Security (RLS)-Policies. Wenn der Client authentifiziert ist:

1. Die WebSocket-Verbindung authentifiziert sich mit demselben JWT-Token wie die REST-API.
2. Jeder Subscription-Refetch wird innerhalb einer PostgreSQL-Transaktion mit `set_config('app.user_id', ...)` und `set_config('app.user_roles', ...)` ausgeführt – wodurch sichergestellt wird, dass RLS-Policies erzwungen werden.
3. Läuft ein Token während einer aktiven Sitzung ab, authentifiziert sich der Client automatisch neu und abonniert erneut.

Das bedeutet, dass jeder Benutzer nur Updates für Datensätze erhält, für deren Anzeige er berechtigt ist.

Der Betrieb von mehr als einer Instanz – der LISTEN/NOTIFY-Bus, das Verhalten von Presence über Prozesse hinweg und das Schreiben eines eigenen Transports – wird auf einer eigenen Seite beschrieben:
[Realtime über mehrere Instanzen](/docs/backend/realtime-transports/).

## Change Data Capture auf Datenbankebene (CDC)

**Change Data Capture ist standardmäßig aktiviert.** Rebase erfasst Änderungen direkt an der Datenbank und gibt Realtime-Events für **jeden committeten Schreibvorgang aus, unabhängig davon, wie er durchgeführt wurde** – REST, SDK, Studio, `psql`, ein Cron-Job in einem anderen Dienst, reines Drizzle/SQL oder der **SQL-Editor** von Studio. Dies entspricht demselben Modell wie bei Supabase Realtime, das das Write-Ahead-Log überwacht.

Es ist keine Konfiguration erforderlich. Bei einer Datenbankverbindung, die dies unterstützt, richtet sich CDC beim Start selbst ein; bei einer Verbindung, bei der dies nicht der Fall ist (z. B. bei einer eingeschränkten Rolle, die keine Trigger erstellen kann), verwendet Rebase stattdessen geräuschlos Realtime auf Anwendungsebene – nichts muss aktiviert werden, nichts geht kaputt.

### Konfiguration

CDC wird über die Umgebungsvariable `REALTIME_CDC` gesteuert:

| Value | Behavior |
| --- | --- |
| `auto` *(Standard)* | Aktiviert Erfassung auf Datenbankebene, wo die Verbindung dies unterstützt; fällt andernfalls **geräuschlos** auf Realtime auf Anwendungsebene zurück. Zero-Config. |
| `trigger` | Erzwingt Trigger-basierte Erfassung. Funktioniert auf jedem PostgreSQL, einschließlich Managed Instances ohne logische Replikation. Warnt (statt geräuschlos zurückzufallen), wenn die Bereitstellung fehlschlägt. |
| `wal` | Bevorzugt logische WAL-Replikation. Noch nicht integriert – fällt auf `trigger` zurück und protokolliert den aktiven Modus. |
| `off` | Nur Realtime auf Anwendungsebene. Verwenden Sie dies, um den Trigger-Overhead pro Schreibvorgang bei schreibintensiven Workloads zu vermeiden. |

Beim Start sehen Sie eine Protokollzeile, die den aktiven Modus angibt, z. B.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Wenn die Verbindung dies nicht unterstützt, gibt `auto` stattdessen eine Informationszeile aus und fährt mit Realtime auf Anwendungsebene fort:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Funktionsweise

1. **Selbst-Bereitstellung (Self-provisioning)** — Beim Start (Server-/Owner-Kontext) installiert Rebase einen idempotenten `AFTER INSERT/UPDATE/DELETE`-Trigger auf jeder verwalteten Tabelle. Der Trigger gibt eine kompakte Änderungsbenachrichtigung auf dem Kanal `rebase_cdc` aus. Eine Nutzlast, die das 8&nbsp;KB `NOTIFY`-Limit von PostgreSQL überschreiten würde, fällt auf eine reine Identitätsnachricht zurück, sodass CDC den auslösenden Schreibvorgang niemals abbrechen kann.
2. **Erfassung (Capture)** — Ein dedizierter, ungepoolter `LISTEN`-Client pro Instanz konsumiert `rebase_cdc`, ordnet die geänderte Tabelle wieder ihrer Collection zu und speist die Änderung in dieselbe `RealtimeService`-Pipeline ein, die von API-Mutationen verwendet wird. Wie der instanzübergreifende Listener bevorzugt er `DATABASE_DIRECT_URL` und verbindet sich automatisch wieder.
3. **RLS-sichere Zustellung** — Die rohe Zeile aus dem Änderungsstream wird **niemals** an Abonnenten weitergeleitet. Die Änderung wird als invalidiert markiert, und jedes Abonnement liest die Zeile unter seinem **eigenen** Authentifizierungskontext erneut. Die Filterung erfolgt daher pro Abonnent, niemals pro Publisher: Ein Client empfängt immer nur Zeilen, die seine RLS-Policies zulassen.
4. **Instanzübergreifend** — Da jede Instanz jeden Commit über den Änderungsstream beobachtet, *ist* CDC gleichzeitig der instanzübergreifende Kanal; der veraltete mutationsbasierte `rebase_entity_changes`-Broadcast wird nicht verwendet, solange CDC aktiv ist.
5. **Deduplizierung** — Eine über die Rebase-API durchgeführte Mutation wird lokal in dem Moment zugestellt, in dem sie committet wird, und wird zusätzlich über den Änderungsstream zurückgespiegelt. Die ursprüngliche Instanz unterdrückt dieses Echo (ein kurzlebiger Datensatz ihrer eigenen Ausgaben), sodass Abonnenten einen API-Schreibvorgang niemals doppelt sehen.

### Anforderungen & Hinweise

- CDC erfordert einen direkten Connection-String (`DATABASE_DIRECT_URL` oder die primäre Verbindung) für den `LISTEN`-Client – Connection-Pooler im Transaktionsmodus unterstützen keine langlebigen `LISTEN`-Sitzungen.
- Trigger werden nur auf Tabellen installiert, die einer registrierten Collection zugrunde liegen. Schreibvorgänge auf nicht zugeordnete Tabellen werden ignoriert.
- Eine Collection, deren Tabelle noch nicht migriert wurde, wird mit einer Warnung übersprungen, anstatt CDC für die restlichen zu blockieren.
- Natives WAL-Streaming mit logischer Replikation (`wal2json`/`pgoutput`) ist geplant; derzeit fällt `REALTIME_CDC=wal` auf den Trigger-basierten Pfad zurück, der eine gleichwertige Abdeckung auf Datenbankebene bietet.

## Timeout für ausstehende Anfragen (Pending Request Timeout)

Um zu verhindern, dass Client-Anfragen unbegrenzt hängen bleiben, gilt für alle ausstehenden WebSocket-Operationen, die eine Serverantwort erwarten (z. B. einmalige Collection-Abfragen `FETCH_COLLECTION`, Abfragen einzelner Entities `FETCH_ONE`, Erstellen/Aktualisieren `SAVE`, Löschen `DELETE`, Zählen `COUNT` und Eindeutigkeitsprüfungen `CHECK_UNIQUE_FIELD`), ein Standard-Timeout von 30 Sekunden.

Wenn der Server nicht innerhalb dieses 30-Sekunden-Fensters antwortet, löscht der Client die ausstehende Anfrage automatisch und weist das Promise mit einem `ApiError` und der Meldung `"Request timed out"` ab.

Einwegnachrichten, die keine Antwort erwarten (wie `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` und `presence_state`), werden sofort nach dem Senden aufgelöst und lösen keine Timeouts aus.

### Wenn ein Channel-Frame abgelehnt wird

Ein Channel-Frame ist Fire-and-Forget: `await channel.broadcast(...)` wird aufgelöst, sobald der Frame in den Socket geschrieben wird, **nicht** erst, wenn der Server ihn akzeptiert hat. Das ist beabsichtigt – eine kollaborative App sendet eine Cursor-Position sechzig Mal pro Sekunde, und das Warten auf eine Bestätigung für jede einzelne würde jede zu einem Roundtrip machen.

Eine Ablehnung kann daher kein abgewiesenes Promise sein. Sie trifft stattdessen bei `onError` ein:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Means |
|------|-------|
| `CHANNEL_FORBIDDEN` | Sie sind kein Mitglied des Kanals – treten Sie ihm bei, bevor Sie senden oder seinen Verlauf lesen |
| `RATE_LIMITED` | Das oben genannte Channel-Frame-Budget wurde überschritten |
| `CHANNEL_HISTORY_WRITE_FAILED` | Ein beizubehaltender Broadcast konnte nicht persistent gespeichert werden und wurde daher verworfen |
| `CHANNEL_HISTORY_READ_FAILED` | Eine Catch-up-Anfrage konnte nicht bedient werden |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Der Broadcast hat nur diese Instanz erreicht – siehe [Das 8-KB-Limit auf dem Postgres-Bus](#the-8-kb-limit-on-the-postgres-bus) |

Ohne zugewiesenen Handler werden diese als Warnung protokolliert. Früher wurden sie vollständig verworfen: Es gab kein Promise zum Abweisen und keinen Kanal zum Zustellen, sodass ein verbotener Broadcast nicht von einem zugestellten zu unterscheiden war.

## Nächste Schritte

- [Client-SDK](/docs/sdk) — Vollständige SDK-Referenz einschließlich typisierter Collection-Accessoren.
- [Authentifizierung](/docs/backend/authentication) — JWT-Authentifizierung und RLS-Policies einrichten.
- [Backend-Architektur](/docs/backend) — Übersicht über die Rebase-Serverarchitektur.

---

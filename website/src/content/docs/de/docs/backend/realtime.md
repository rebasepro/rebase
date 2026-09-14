---
sourceHash: da709fdddc946e75
title: Realtime & WebSocket
sidebar_label: Realtime
description: Echtzeit-Datensynchronisierung, Broadcast-Kanäle und Presence-Tracking über WebSocket.
---

Rebase enthält eine integrierte Realtime-Engine, die Datenänderungen über WebSocket an verbundene Clients pusht.
Wenn ein Datensatz erstellt, aktualisiert oder gelöscht wird, erhält jeder Abonnent, der diese Collection oder Entität beobachtet, das Update sofort – kein Polling erforderlich.

## Funktionsweise

Die Realtime-Pipeline besteht aus drei Stufen:

1. **Datenbank-Trigger** – Eine Mutation trifft auf die PostgreSQL-Datenbank (über REST-API, SDK oder Studio).
2. **Server-Fan-out** – Der Rebase-Server erkennt die Änderung und verteilt sie (Fan-out) an jedes aktive WebSocket-Abonnement, das der betroffenen Collection oder Entität entspricht.
3. **Client-Callback** – Das Client-SDK ruft Ihren `onUpdate`-Callback mit den aktuellen Daten auf.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Bei Bereitstellungen mit mehreren Instanzen verwendet Rebase PostgreSQLs `LISTEN/NOTIFY`, um Änderungen über Server-Instanzen hinweg zu übertragen (Broadcast). Dies geschieht automatisch – eine dedizierte PostgreSQL-Verbindung lauscht auf dem Kanal `rebase_entity_changes` und leitet Aktualisierungen an lokale Abonnenten weiter.

### Null-Konfiguration

Realtime ist standardmäßig aktiviert. Es muss kein Flag gesetzt oder ein Dienst gestartet werden – wenn Ihr Rebase-Server läuft, ist der WebSocket-Endpunkt verfügbar.

> Standardmäßig gibt Rebase auch Realtime-Events für Schreibvorgänge aus, die **außerhalb** der API getätigt werden (über `psql`, einen anderen Dienst oder den SQL-Editor von Studio), sofern die Datenbankverbindung dies unterstützt – siehe [Change Capture auf Datenbankebene (CDC)](#change-capture-auf-datenbankebene-cdc).

## Client-SDK-Abonnements

Das Rebase-Client-SDK stellt für jeden Collection-Accessor zwei Abonnement-Methoden bereit:

- **`listen()`** — Eine gesamte Collection abonnieren (mit optionalen Filtern).
- **`listenById()`** — Eine einzelne Entität anhand ihrer ID abonnieren.

Beide Methoden geben eine **Unsubscribe-Funktion** zurück, die Sie aufrufen können, um den Empfang von Updates zu beenden.

### Eine Collection abonnieren

Verwenden Sie `listen()`, um Updates zu erhalten, wann immer sich Datensätze in einer Collection ändern:

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

Der Callback erhält eine `FindResponse<M>`, die Folgendes enthält:
- `data` — Array von `Entity<M>`-Objekten.
- `meta` — Paginierungsinformationen (`total`, `limit`, `offset`, `hasMore`).

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

### Eine einzelne Entität abonnieren

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

Der Callback empfängt `Entity<M> | undefined`. Ein Wert von `undefined` bedeutet, dass die Entität gelöscht wurde.

### Abonnements beenden

Sowohl `listen()` als auch `listenById()` geben eine Unsubscribe-Funktion zurück. Rufen Sie diese auf, um den Empfang von Updates zu stoppen und serverseitige Ressourcen freizugeben:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Rufen Sie die Unsubscribe-Funktion immer auf, wenn eine Komponente unmounted wird oder die Seite gewechselt wird. Dies verhindert Speicherlecks und unnötige serverseitige Last.
:::

## Query-Builder `.listen()`

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
Die Methode `.listen()` im Query-Builder ist nur verfügbar, wenn der `RebaseClient` mit einer `websocketUrl` konfiguriert ist. Wenn die WebSocket-Verbindung nicht konfiguriert ist, löst der Aufruf von `.listen()` einen Fehler aus.
:::

## Update-Bereitstellung: Sofortiger Patch + Refetch zur Korrektheit

Eine Änderung wird niemals als direkte Daten an einen Abonnenten übertragen. Sie wird als die Tatsache übertragen, dass sich etwas geändert hat, und jedem Abonnenten wird dann durch eine in seinem Kontext ausgeführte Abfrage mitgeteilt, was *er* sehen darf:

1. **Invalidierung.** Wenn sich eine Entität ändert (erstellt, aktualisiert, gelöscht), markiert der Server die betroffenen Pfade. Die geschriebene Zeile wird nicht weitergeleitet – sie wurde unter der Autorisierung des Schreibers gelesen, was nichts darüber aussagt, was ein Abonnent sehen darf.

2. **Gedebouncter RLS-Refetch.** Nach **300 ms** (`REFETCH_DEBOUNCE_MS`) ruft der Server die Collection mit Ihren ursprünglichen Filtern und der Sortierreihenfolge erneut ab. Die Abfrage wird innerhalb einer Transaktion ausgeführt, die die transaktionslokalen Variablen `app.user_id` und `app.user_roles` aus dem `SubscriptionAuthContext` des Abonnenten setzt. Dadurch wertet Postgres Row-Level Security unter der Identität dieses Clients aus, und nur die Zeilen, zu deren Ansicht er berechtigt ist, werden im `collection_update` gesendet. Das Debouncing fasst zudem eine Serie rascher Schreibvorgänge zu einer einzigen Abfrage zusammen.

Frühere Versionen sendeten vor diesem Refetch ein sofortiges `collection_patch` mit der geschriebenen Zeile, um ein sub-millisekundenschnelles Feedback über Tabs hinweg zu ermöglichen. Diese Zeile war jedoch im Gültigkeitsbereich des Autors gelesen worden, sodass sie Abonnenten erreichen konnte – und erreichte –, deren eigene Richtlinien dies verwehrt hätten, und auch der `where`-Filter des Abonnements wurde nicht darauf angewendet. Der Patch wurde entfernt: Die wahrgenommene Latenz für ein Update entspricht nun dem Debounce-Fenster.

### Der Refetch entspricht dem REST-Read

Der Refetch durchläuft dieselbe Pipeline wie `GET /api/data/<collection>`, mit derselben `include`-Behandlung. Dadurch geben `find({ q })` und `listen({ q })` Zeilen zurück, die Feld für Feld identisch sind.

Früher handelte es sich um eine andere Methode – eine, die jede Relation in einer `{ "__type": "relation" }`-Hülle verschachtelte und, da ein Abonnement kein `include` enthalten konnte, **jede** von der Collection deklarierte Relation eager lud. Dieselbe Abfrage antwortete also über HTTP in einer Struktur und über den Socket in einer anderen, und ein Client, der beides renderte, sah, wie seine Zeilen ihre Struktur änderten, sobald ein Schreibvorgang eintraf.

Ein Subscribe-Frame akzeptiert daher dieselben Parameter wie eine Listen-Anfrage: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` und `fields`. Eine Ausnahme bildet `vectorSearch`, was mit `VECTOR_SEARCH_NOT_LIVE` **abgelehnt** wird – ein Abonnement wird bei jedem passenden Schreibvorgang erneut ausgeführt, und dort werden keine Distanzen berechnet.

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

`meta` wird innerhalb derselben RLS-gebundenen Transaktion gezählt, die auch die Zeilen gelesen hat, sodass es exakt die danebenstehenden Zeilen beschreibt. Ohne dies müsste ein Client, der eine Gesamtzahl benötigt, **pro Push** ein `GET /count` ausführen – ein zusätzlicher Roundtrip pro Schreibvorgang und Abonnent sowie ein Zeitfenster, in dem die Anzahl und die Zeilen unterschiedliche Zustände der Collection widerspiegelten.

Wenn die Zählung selbst fehlschlägt, enthält der Frame `partial: true` und kein `total`; dies ist kein Abonnement-Fehler, und ein Client sollte den letzten echten Gesamtwert beibehalten, anstatt die Seitenlänge einzusetzen.

## Broadcast-Kanäle

Broadcast-Kanäle ermöglichen es Clients, beliebige Nachrichten in Echtzeit untereinander auszutauschen – nützlich für Funktionen wie Tipp-Indikatoren, Cursor-Positionen oder benutzerdefinierte Benachrichtigungen.

Broadcasts werden auf WebSocket-Protokollebene verwaltet. Der Server unterstützt die folgenden Nachrichtentypen:

| Message Type     | Direction       | Description                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Einem benannten Kanal beitreten          |
| `leave_channel`   | Client → Server | Einen Kanal verlassen                   |
| `broadcast`       | Client → Server | Eine Nachricht an alle Kanalmitglieder senden |
| `broadcast`       | Server → Client | Eine Nachricht von einem anderen Mitglied empfangen |
| `channel_history` | Client → Server | Gespeicherte Nachrichten nach einer Sequenz anfordern |
| `channel_history` | Server → Client | Die gespeicherten Nachrichten, die ein Client verpasst hat |

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

## Kanal-Retention

Standardmäßig erreicht ein Broadcast die aktuell verbundenen Mitglieder und ist danach verloren. Das ist für Benachrichtigungen und Cursor der richtige Kompromiss und verursacht keine Kosten.

Für einen Operations-Stream – kollaboratives Bearbeiten oder alles, bei dem eine unbemerkte Lücke zu Inkonsistenzen führt – kann ein Kanal so konfiguriert werden, dass er seine Nachrichten **beibehält (retain)**. Gespeicherte Broadcasts erhalten eine kanalspezifische Sequenznummer und werden gespeichert, sodass ein sich erneut verbindender Client alle Nachrichten nach der zuletzt gesehenen abfragen kann.

:::caution[Wo dies konfiguriert wird]
**Managed Runtime: Nirgends.** Kanal-Retention und `realtime.bus` sind Teil des Datenbankadapters, den die Managed Runtime selbst erstellt, und keines von beiden existiert als Umgebungsvariable. Führen Sie ein Eject durch, um sie zu konfigurieren.
**Nach Eject:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
:::

Retention ist opt-in und wird hier auf dem Server konfiguriert:

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
| `match` | Exakter Kanalname (`"doc:42"`) oder ein Präfix mit nachgestelltem `*` (`"doc:*"`) |
| `limit` | Höchstens so viele der neuesten Nachrichten pro Kanal behalten               |
| `ttl`   | Nachrichten höchstens so lange behalten – `"30s"`, `"15m"`, `"24h"`, `"7d"` oder Millisekunden |

Eine Regel benötigt mindestens `limit` oder `ttl`. Eine Regel ohne beides wird ignoriert und protokolliert, da eine unbegrenzte Aufbewahrung fast nie beabsichtigt ist und nicht einfach rückgängig gemacht werden kann, sobald die Tabelle angewachsen ist.

:::note[Warum lässt man Clients den Verlauf nicht anfordern?]
Ein Kanal wird von demjenigen erstellt, der ihn benennt. Wenn ein Client seine eigene Verlaufstiefe wählen könnte, könnte jeder Besucher Ihr Backend zu unbegrenztem Speicherbedarf zwingen. Die Konfiguration hier bedeutet auch, dass Presence- und Benachrichtigungskanäle – die überwiegende Mehrheit – keinen Overhead verursachen: Ohne konfigurierte Regeln wird keine Tabelle erstellt und Broadcasts laufen über denselben synchronen Pfad wie zuvor.
:::

### Speicherung

Zurückbehaltene Kanäle verwenden zwei Tabellen im `rebase`-Schema, die beim Start automatisch erstellt werden, wenn mindestens eine Regel konfiguriert ist:

| Table                     | Contents                                                        |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | Die gespeicherten Nachrichten, indexiert über `(channel, seq)`                 |
| `rebase.channel_cursors`  | Die höchste pro Kanal vergebene Sequenznummer                          |

Das Bereinigen (Pruning) erfolgt beim Eintreffen von Nachrichten und ist pro Kanal gedrosselt, sodass die Kosten eher der verstrichenen Zeit als dem Schreibvolumen folgen. Es entfernt ausschließlich Zeilen aus `channel_messages` – Cursors werden unbegrenzt aufbewahrt (sie bestehen aus einer einzigen kleinen Zeile pro Kanal), da ein Neustart der Kanal-Sequenz die Bedeutung des gespeicherten Fortsetzungspunkts eines Clients verändern würde.

### Zustellgarantien

- **Geordnet.** Sequenznummern werden pro Kanal vergeben, und die Zustellungsreihenfolge entspricht der Sequenzreihenfolge.
- **Dauerhaft gespeichert vor Zustellung.** Eine Nachricht, die nicht gespeichert werden kann, wird an niemanden zugestellt, und der Absender wird darüber informiert. Eine Zustellung würde sie Live-Abonnenten präsentieren, sie jedoch bei künftigen Replays auslassen – eine Lücke, die keine spätere Nachricht schließen könnte.
- **At-Least-Once beim Nachholen.** Ein Replay-Bereich kann sich mit Nachrichten überschneiden, die ein Client bereits empfangen hat; das SDK verwirft bereits zugestellte Nachrichten.

:::caution[Der Verlauf hat dasselbe Zugriffsmodell wie der Kanal]
Ein Client, der einem Kanal beigetreten ist, kann dessen gespeicherte Nachrichten erneut abspielen, einschließlich derjenigen, die vor seinem Beitritt gesendet wurden – die Mitgliedschaft ist die einzige Prüfung, und der Beitritt steht jedem Client offen, der den Kanalnamen kennt. Retention ist ein Opt-in pro Kanalmuster; die Aktivierung macht die Historie dieses Kanals daher für jeden Besucher lesbar, der den Namen errät. Bei Kanälen mit Retention wird dies dauerhaft statt nur flüchtig – betrachten Sie die Inhalte eines aufbewahrten Kanals daher als öffentlich für Ihre Benutzer.
:::

## Presence-Tracking

Presence verfolgt, welche Benutzer aktuell in einem Kanal online sind, und ermöglicht es jedem Benutzer, einen benutzerdefinierten Status zu teilen (z. B. Cursor-Position, Status).

| Message Type       | Direction       | Description                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Presence-Tracking mit benutzerdefiniertem Status starten            |
| `presence_untrack`| Client → Server | Presence-Tracking beenden                               |
| `presence_state`  | Client → Server | Den vollständigen Presence-Status für einen Kanal anfordern        |
| `presence_state`  | Server → Client | Vollständige Entität aller Presences in einem Kanal          |
| `presence_diff`   | Server → Client | Inkrementelles Update (Beitritte und Austritte)                |

Wenn ein Client `presence_track` sendet, lässt der Server ihn dem Kanal automatisch beitreten (kein separater Aufruf von `join_channel` erforderlich) und sendet ein `presence_diff` als Broadcast an alle Kanalmitglieder.

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

Das Client-SDK verbindet sich automatisch wieder, wenn die WebSocket-Verbindung unterbrochen wird:

- **Exponentieller Backoff** – Wiederverbindungsverzögerungen beginnen bei 1 Sekunde und verdoppeln sich bei jedem Versuch bis zu einem Maximum von 30 Sekunden.
- **Maximal 5 Versuche** – Nach 5 fehlgeschlagenen Wiederverbindungsversuchen stellt der Client die Versuche ein.
- **Automatische Wiederanmeldung (Resubscription)** – Nach erfolgreicher Wiederverbindung werden alle aktiven Abonnements erneut beim Server registriert. Kein manuelles Eingreifen erforderlich.
- **Nachrichten-Warteschlange (Queuing)** – Nachrichten, die während der Trennung gesendet wurden, werden in eine Warteschlange eingereiht und nach der Wiederverbindung zugestellt.

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

WebSocket-Abonnements berücksichtigen automatisch Richtlinien für Row-Level Security (RLS). Wenn der Client authentifiziert ist:

1. Die WebSocket-Verbindung authentifiziert sich mit demselben JWT-Token wie die REST-API.
2. Jeder Refetch eines Abonnements wird innerhalb einer PostgreSQL-Transaktion mit `set_config('app.user_id', ...)` und `set_config('app.user_roles', ...)` ausgeführt – wodurch sichergestellt wird, dass RLS-Richtlinien durchgesetzt werden.
3. Das Token wird einmalig bei der Authentifizierung des Sockets verifiziert, und der Server überprüft es während der Lebensdauer der Verbindung nicht erneut. Ein ablaufendes Zugriffstoken, eine widerrufene Sitzung oder eine entzogene Rolle ändert nichts daran, was ein offener Socket lesen darf, bis er sich erneut authentifiziert oder wiederverbindet. Das SDK authentifiziert seinen Socket jedes Mal neu, wenn es sein Token aktualisiert, und trennt die Verbindung beim Abmelden; ein Client, der direkt mit dem Protokoll kommuniziert, behält die Identität, mit der er die Verbindung geöffnet hat, bis er sich neu verbindet.

Dies bedeutet, dass jeder Socket nur Updates für Datensätze erhält, die seine authentifizierte Identität einsehen darf.

Der Betrieb mehrerer Instanzen – der LISTEN/NOTIFY-Bus, wie Presence über Prozesse hinweg funktioniert und das Schreiben eines eigenen Transports – wird auf einer eigenen Seite beschrieben:
[Realtime über Instanzen hinweg](/docs/backend/realtime-transports/).

## Change Capture auf Datenbankebene (CDC)

**Change Data Capture ist standardmäßig aktiviert.** Rebase erfasst Änderungen direkt an der Datenbank und gibt Realtime-Events für **jeden bestätigten (committed) Schreibvorgang aus, unabhängig davon, wie er getätigt wurde** – REST, SDK, Studio, `psql`, ein Cron-Job in einem anderen Dienst, rohes Drizzle/SQL oder der **SQL-Editor** von Studio. Dies entspricht demselben Modell wie bei Supabase Realtime, das das Write-Ahead-Log überwacht.

Es ist keine Konfiguration erforderlich. Bei einer Datenbankverbindung, die dies unterstützt, richtet sich CDC beim Start automatisch ein (Self-Provisioning); bei einer, die dies nicht unterstützt (z. B. eine eingeschränkte Rolle, die keine Trigger erstellen kann), wechselt Rebase stillschweigend zu Realtime auf Anwendungsebene – nichts muss aktiviert werden, nichts bricht ab.

### Konfiguration

CDC wird über die Umgebungsvariable `REALTIME_CDC` gesteuert:

| Value | Behavior |
| --- | --- |
| `auto` *(Standard)* | Erfassung auf Datenbankebene aktivieren, sofern die Verbindung dies unterstützt; andernfalls **stillschweigender Fallback** auf Realtime auf Anwendungsebene. Keine Konfiguration erforderlich. |
| `trigger` | Trigger-basierte Erfassung erzwingen. Funktioniert auf jedem PostgreSQL, einschließlich Managed Instances ohne logische Replikation. Gibt eine Warnung aus (statt stillschweigend zurückzufallen), wenn die Bereitstellung fehlschlägt. |
| `wal` | Bevorzugt logische WAL-Replikation. Noch nicht integriert – fällt auf `trigger` zurück und protokolliert den aktiven Modus. |
| `off` | Nur Realtime auf Anwendungsebene. Verwenden Sie dies, um den Trigger-Overhead pro Schreibvorgang bei schreibintensiven Workloads zu vermeiden. |

Beim Start wird eine Protokollzeile mit dem aktiven Modus ausgegeben, z. B.:

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

1. **Automatische Bereitstellung (Self-Provisioning)** – Beim Start (im Server-/Owner-Kontext) installiert Rebase einen idempotenten `AFTER INSERT/UPDATE/DELETE`-Trigger auf jeder verwalteten Tabelle. Der Trigger gibt eine kompakte Änderungsbenachrichtigung auf dem Kanal `rebase_cdc` aus. Eine Nutzlast, die das 8&nbsp;KB-`NOTIFY`-Limit von PostgreSQL überschreiten würde, fällt auf eine Nachricht zurück, die nur Identitätsdaten enthält, sodass CDC den auslösenden Schreibvorgang niemals abbrechen kann.
2. **Erfassung** – Ein dedizierter, ungepoolter `LISTEN`-Client pro Instanz verarbeitet `rebase_cdc`, ordnet die geänderte Tabelle wieder ihrer Collection zu und speist die Änderung in dieselbe `RealtimeService`-Pipeline ein, die von API-Mutationen verwendet wird. Wie der instanzübergreifende Listener bevorzugt er `DATABASE_DIRECT_URL` und verbindet sich automatisch wieder.
3. **RLS-sichere Zustellung** – Die rohe Zeile aus dem Änderungs-Stream wird **niemals** an Abonnenten weitergeleitet. Die Änderung wird als ungültig markiert und jedes Abonnement liest die Zeile unter seinem **eigenen** Authentifizierungskontext erneut aus. Die Filterung erfolgt daher pro Abonnent, niemals pro Publisher: Ein Client empfängt immer nur Zeilen, die seine RLS-Richtlinien zulassen.
4. **Instanzübergreifend** – Da jede Instanz jeden Commit über den Change-Stream beobachtet, *ist* CDC gleichzeitig der instanzübergreifende Kanal; der frühere mutationsbasierte `rebase_entity_changes`-Broadcast wird nicht verwendet, solange CDC aktiv ist.
5. **Deduplizierung** – Eine über die Rebase-API durchgeführte Mutation wird lokal in dem Moment zugestellt, in dem sie committet wird, und wird zudem über den Change-Stream als Echo zurückgesendet. Die Ursprungsinstanz unterdrückt dieses Echo (über eine kurzlebige Aufzeichnung ihrer eigenen Ausgaben), sodass Abonnenten einen API-Schreibvorgang niemals doppelt sehen.

### Anforderungen & Hinweise

- CDC erfordert einen direkten Connection-String (`DATABASE_DIRECT_URL` oder die primäre Verbindung) für den `LISTEN`-Client – Connection-Pooler im Transaktionsmodus unterstützen keine langlebigen `LISTEN`-Sitzungen.
- Trigger werden nur auf Tabellen installiert, die einer registrierten Collection zugeordnet sind. Schreibvorgänge in nicht zugeordnete Tabellen werden ignoriert.
- Eine Collection, deren Tabelle noch nicht migriert wurde, wird mit einer Warnung übersprungen, anstatt CDC für die übrigen zu blockieren.
- Natives WAL-Logical-Replication-Streaming (`wal2json`/`pgoutput`) ist geplant; derzeit fällt `REALTIME_CDC=wal` auf den triggerbasierten Pfad zurück, der eine gleichwertige Abdeckung auf Datenbankebene bietet.

## Timeout für ausstehende Anfragen

Um zu verhindern, dass Client-Anfragen unbegrenzt hängen bleiben, haben alle ausstehenden WebSocket-Operationen, die eine Serverantwort erwarten (z. B. einmalige Collection-Abfragen `FETCH_COLLECTION`, Einzelentitäts-Abfragen `FETCH_ONE`, Erstellen/Aktualisieren `SAVE`, Löschvorgänge `DELETE`, Zählungen `COUNT` und Eindeutigkeitsprüfungen `CHECK_UNIQUE_FIELD`), ein standardmäßiges Timeout von 30 Sekunden.

Wenn der Server nicht innerhalb dieses 30-Sekunden-Fensters antwortet, löscht der Client die ausstehende Anfrage automatisch und weist das Promise mit einem `ApiError` und der Meldung `"Request timed out"` ab.

Einweg-Nachrichten, die keine Antwort erwarten (wie `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` und `presence_state`), werden unmittelbar nach dem Senden aufgelöst (resolve) und lösen keine Timeouts aus.

### Wenn ein Kanal-Frame abgelehnt wird

Ein Kanal-Frame ist Fire-and-Forget: `await channel.broadcast(...)` wird aufgelöst, sobald der Frame in den Socket geschrieben wird, **nicht** erst, wenn der Server ihn akzeptiert hat. Das ist beabsichtigt – eine kollaborative App überträgt eine Cursorposition sechzigmal pro Sekunde, und das Warten auf eine Bestätigung für jede einzelne würde jede zu einem Roundtrip machen.

Eine Ablehnung kann daher kein abgewiesenes Promise (rejected promise) sein. Sie wird über `onError` gemeldet:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Means |
|------|-------|
| `CHANNEL_FORBIDDEN` | Sie sind kein Mitglied des Kanals – treten Sie ihm bei, bevor Sie Nachrichten senden oder seinen Verlauf lesen |
| `RATE_LIMITED` | Das oben genannte Kanal-Frame-Budget wurde überschritten |
| `CHANNEL_HISTORY_WRITE_FAILED` | Ein gespeicherter Broadcast konnte nicht persistent gesichert werden und wurde daher verworfen |
| `CHANNEL_HISTORY_READ_FAILED` | Eine Catch-up-Anfrage konnte nicht bedient werden |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Der Broadcast hat nur diese Instanz erreicht – siehe [Das 8-KB-Limit auf dem Postgres-Bus](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Wenn kein Handler zugewiesen ist, werden diese als Warnung protokolliert. Früher wurden sie gänzlich verworfen: Es gab kein Promise, das abgewiesen werden konnte, und keinen Kanal für die Zustellung, sodass ein verbotener Broadcast nicht von einem zugestellten zu unterscheiden war.

## Nächste Schritte

- [Client-SDK](/docs/sdk) — Vollständige SDK-Referenz einschließlich typisierter Collection-Accessors.
- [Authentifizierung](/docs/backend/authentication) — JWT-Authentifizierung und RLS-Richtlinien einrichten.
- [Backend-Architektur](/docs/backend) — Überblick über die Rebase-Serverarchitektur.

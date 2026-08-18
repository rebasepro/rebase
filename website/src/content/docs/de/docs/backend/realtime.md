---
title: Echtzeit & WebSocket
sidebar_label: Echtzeit
description: Echtzeit-Datensynchronisation, Broadcast-Kanäle und Präsenz-Tracking über WebSocket.
---

Rebase enthält eine integrierte Echtzeit-Engine, die Datenänderungen über WebSocket an verbundene Clients pusht.
Wenn ein Datensatz erstellt, aktualisiert oder gelöscht wird, erhält jeder Abonnent, der diese Collection oder Entität beobachtet, das Update sofort — kein Polling erforderlich.

## Funktionsweise

Die Echtzeit-Pipeline hat drei Stufen:

1. **Datenbank-Trigger** — Eine Mutation trifft die PostgreSQL-Datenbank (über REST-API, SDK oder Studio).
2. **Server-Fan-out** — Der Rebase-Server erkennt die Änderung und verteilt sie an jedes aktive WebSocket-Abonnement, das zur betroffenen Collection oder Entität passt.
3. **Client-Callback** — Das Client-SDK löst Ihren `onUpdate`-Callback mit den frischen Daten aus.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Für Bereitstellungen mit mehreren Instanzen verwendet Rebase `LISTEN/NOTIFY` von PostgreSQL, um Änderungen über die Serverinstanzen hinweg zu verbreiten. Dies wird automatisch gehandhabt — eine dedizierte PostgreSQL-Verbindung lauscht auf dem Kanal `rebase_entity_changes` und leitet Updates an lokale Abonnenten weiter.

### Null Konfiguration

Echtzeit ist standardmäßig aktiviert. Es gibt kein Flag umzulegen und keinen Dienst zu starten — wenn Ihr Rebase-Server läuft, ist der WebSocket-Endpunkt verfügbar.

> Standardmäßig gibt Rebase auch Echtzeit-Ereignisse für Schreibvorgänge aus, die **außerhalb** der API erfolgen (über `psql`, einen anderen Dienst oder den SQL-Editor von Studio), sofern die Datenbankverbindung dies unterstützt — siehe [Änderungserfassung auf Datenbankebene](#änderungserfassung-auf-datenbankebene-cdc).

## Abonnements im Client-SDK

Das Rebase-Client-SDK stellt zwei Abonnementmethoden auf jedem Collection-Accessor bereit:

- **`listen()`** — Eine gesamte Collection abonnieren (mit optionalen Filtern).
- **`listenById()`** — Eine einzelne Entität anhand ihrer ID abonnieren.

Beide Methoden geben eine **Unsubscribe-Funktion** zurück, die Sie aufrufen, um keine Updates mehr zu erhalten.

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
- `meta` — Paginierungsinfo (`total`, `limit`, `offset`, `hasMore`).

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

Der Server respektiert diese Filter — nur passende Datensätze werden in Updates aufgenommen.

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

Der Callback erhält `Entity<M> | undefined`. Ein Wert von `undefined` bedeutet, dass die Entität gelöscht wurde.

### Abbestellen

Sowohl `listen()` als auch `listenById()` geben eine Unsubscribe-Funktion zurück. Rufen Sie sie auf, um keine Updates mehr zu erhalten und serverseitige Ressourcen aufzuräumen:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Rufen Sie die Unsubscribe-Funktion immer auf, wenn eine Komponente ausgehängt wird oder eine Seite weg navigiert. Dies verhindert Speicherlecks und unnötige serverseitige Arbeit.
:::

## `.listen()` des Query-Builders

Der Fluent-Query-Builder unterstützt ebenfalls Echtzeit-Abonnements. Verketten Sie Ihre Filter und rufen Sie dann `.listen()` statt `.find()` auf:

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
Die Methode `.listen()` des Query-Builders ist nur verfügbar, wenn der `RebaseClient` mit einer `websocketUrl` konfiguriert ist. Wenn die WebSocket-Verbindung nicht konfiguriert ist, wirft der Aufruf von `.listen()` einen Fehler.
:::

## Update-Zustellung: Sofort-Patch + Korrektheits-Refetch

Rebase verwendet für Collection-Abonnements eine zweiphasige Update-Strategie, um extreme Geschwindigkeit mit absoluter Korrektheit zu verbinden:

1. **Phase 1 — Sofortiger Entity-Patch:** Wenn sich eine einzelne Entität ändert (erstellt, aktualisiert, gelöscht), pusht der Server sofort eine leichtgewichtige `collection_patch`-Nachricht mit den geänderten Entitätswerten direkt an die Abonnenten. Der Client führt dies in seine zwischengespeicherten Collection-Daten zusammen, um nahezu sofortiges tabübergreifendes Feedback zu erzielen — und umgeht dabei die Datenbank vollständig für Sub-Millisekunden-wahrgenommene Updates.

2. **Phase 2 — Entprellter RLS-Refetch:** Nach einer kurzen Verzögerung von **300 ms** (`REFETCH_DEBOUNCE_MS`) führt der Server einen autoritativen Datenbank-Refetch der Collection durch, der Ihren ursprünglichen Filtern und der Sortierreihenfolge entspricht. Dies ist entscheidend, da Feldmutationen die Sichtbarkeit der Entität ändern könnten (z. B. wenn sich ihr Status geändert hat und nicht mehr zu einem `where`-Filter passt).

   Um strenge Sicherheitsgrenzen aufrechtzuerhalten, wird diese Refetch-Abfrage innerhalb einer Transaktion ausgeführt, die die transaktionslokalen Variablen `app.userId` und `app.user_roles` setzt, die aus dem `SubscriptionAuthContext` des Abonnenten abgeleitet sind. Dies stellt sicher, dass die Row-Level-Security-Einschränkungen (RLS) von PostgreSQL unter der Auth-Sitzung des Clients korrekt ausgewertet werden und nur die Datensätze, die der Benutzer sehen darf, im finalen `collection_update` gesendet werden.

Dieser Ansatz garantiert, dass Listenfilter und Zugriffsrichtlinien perfekt konsistent bleiben, während gleichzeitig eine hohe UI-Reaktionsfähigkeit erhalten bleibt.

## Broadcast-Kanäle

Broadcast-Kanäle ermöglichen es Clients, sich in Echtzeit beliebige Nachrichten zuzusenden — nützlich für Funktionen wie Tippindikatoren, Cursorpositionen oder benutzerdefinierte Benachrichtigungen.

Broadcast wird auf der Ebene des WebSocket-Protokolls verwaltet. Der Server unterstützt diese Nachrichtentypen:

| Nachrichtentyp   | Richtung        | Beschreibung                             |
|-----------------|-----------------|------------------------------------------|
| `join_channel`  | Client → Server | Einem benannten Kanal beitreten          |
| `leave_channel` | Client → Server | Einen Kanal verlassen                    |
| `broadcast`     | Client → Server | Eine Nachricht an alle Kanalmitglieder senden |
| `broadcast`     | Server → Client | Eine Nachricht von einem anderen Mitglied empfangen |
| `channel_history` | Client → Server | Aufbewahrte Nachrichten nach einer Sequenz anfordern |
| `channel_history` | Server → Client | Die aufbewahrten Nachrichten, die ein Client verpasst hat |

Wenn ein Client eine `broadcast`-Nachricht sendet, leitet der Server sie an **alle anderen Mitglieder** dieses Kanals weiter (der Absender erhält seine eigene Nachricht nicht).

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

## Kanal-Aufbewahrung

Standardmäßig erreicht ein Broadcast die aktuell verbundenen Mitglieder und ist danach fort. Das ist der richtige Kompromiss für Benachrichtigungen und Cursor, und er kostet nichts.

Für einen Operationsstrom — kollaboratives Bearbeiten, alles, wo eine stille Lücke zu Divergenz führt — kann ein Kanal so konfiguriert werden, dass er seine Nachrichten **aufbewahrt**. Aufbewahrte Broadcasts erhalten eine kanalweise Sequenznummer und werden gespeichert, sodass ein Client nach einer Wiederverbindung alles ab der zuletzt gesehenen Nachricht anfordern kann.

Die Aufbewahrung ist optional und wird hier, auf dem Server, konfiguriert:

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

| Feld | Beschreibung |
|-------|-------------|
| `match` | Exakter Kanalname (`"doc:42"`) oder ein Präfix mit abschließendem `*` (`"doc:*"`) |
| `limit` | Höchstens so viele der neuesten Nachrichten pro Kanal behalten |
| `ttl` | Nachrichten höchstens so lange behalten — `"30s"`, `"15m"`, `"24h"`, `"7d"` oder Millisekunden |

Eine Regel braucht mindestens `limit` oder `ttl`. Eine ohne beides wird ignoriert und protokolliert, denn unbegrenzte Aufbewahrung ist fast nie beabsichtigt und lässt sich nicht mehr rückgängig machen, sobald die Tabelle gewachsen ist.

:::note[Warum dürfen Clients keinen Verlauf anfordern?]
Ein Kanal entsteht dadurch, dass jemand ihn benennt. Könnte ein Client seine eigene Verlaufstiefe wählen, könnte jeder Besucher Ihr Backend auf unbegrenzten Speicher festlegen. Die Konfiguration an dieser Stelle bedeutet außerdem, dass Präsenz- und Benachrichtigungskanäle — die überwiegende Mehrheit — nichts zahlen: Ohne konfigurierte Regeln wird keine Tabelle angelegt, und Broadcast läuft denselben synchronen Weg wie zuvor.
:::

### Speicherung

Kanäle mit Aufbewahrung nutzen zwei Tabellen im `rebase`-Schema, die beim Start automatisch angelegt werden, sobald mindestens eine Regel konfiguriert ist:

| Tabelle | Inhalt |
|-------|-----------|
| `rebase.channel_messages` | Die aufbewahrten Nachrichten, indiziert nach `(channel, seq)` |
| `rebase.channel_cursors` | Die höchste je Kanal vergebene Sequenz |

Bereinigt wird, während Nachrichten eintreffen, pro Kanal gedrosselt, sodass die Kosten mit der verstrichenen Zeit statt mit dem Schreibvolumen wachsen. Entfernt werden ausschließlich Zeilen aus `channel_messages` — Cursor bleiben dauerhaft erhalten (eine kleine Zeile pro Kanal), denn ein Neustart der Kanalsequenz würde die Bedeutung des von einem Client gespeicherten Wiederaufsetzpunkts verändern.

### Zustellgarantien

- **Geordnet.** Sequenznummern werden pro Kanal vergeben, und die Zustellreihenfolge entspricht der Sequenzreihenfolge.
- **Erst dauerhaft, dann zugestellt.** Eine Nachricht, die nicht gespeichert werden kann, wird niemandem zugestellt, und der Absender wird benachrichtigt. Sie zuzustellen würde sie den Live-Abonnenten zeigen und zugleich aus jeder künftigen Wiederholung auslassen — eine Lücke, die keine spätere Nachricht heilen könnte.
- **Mindestens einmal beim Aufholen.** Ein Wiederholungsbereich kann Nachrichten enthalten, die ein Client bereits erhalten hat; das SDK verwirft die bereits zugestellten.

:::caution[Der Verlauf hat dasselbe Zugriffsmodell wie der Kanal]
Wer einem Kanal beitreten darf, darf auch dessen aufbewahrte Nachrichten wiederholen — einschließlich derer, die vor seiner Ankunft gesendet wurden. Die Aufbewahrung ist pro Kanalmuster optional. Sie auf einem öffentlich beitretbaren Kanal zu aktivieren macht dessen Vergangenheit daher für jeden Besucher lesbar.
:::
## Präsenz-Tracking

Präsenz verfolgt, welche Benutzer aktuell in einem Kanal online sind, und erlaubt jedem Benutzer, benutzerdefinierten Zustand zu teilen (z. B. Cursorposition, Status).

| Nachrichtentyp     | Richtung        | Beschreibung                                         |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Präsenz-Tracking mit benutzerdefiniertem Zustand starten |
| `presence_untrack`| Client → Server | Präsenz-Tracking beenden                             |
| `presence_state`  | Client → Server | Den vollständigen Präsenzzustand eines Kanals anfordern |
| `presence_state`  | Server → Client | Vollständiger Zustand aller Präsenzen in einem Kanal |
| `presence_diff`   | Server → Client | Inkrementelles Update (Beitritte und Austritte)      |

Wenn ein Client `presence_track` sendet, fügt der Server ihn automatisch dem Kanal hinzu (kein separates `join_channel` nötig) und sendet einen `presence_diff` an alle Kanalmitglieder.

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

Veraltete Präsenzen werden nach 30 Sekunden Inaktivität automatisch bereinigt.

## Automatische Wiederverbindung

Das Client-SDK verbindet sich automatisch neu, wenn die WebSocket-Verbindung abbricht:

- **Exponentielles Backoff** — Die Wiederverbindungsverzögerungen beginnen bei 1 Sekunde und verdoppeln sich bei jedem Versuch, mit einer Obergrenze von 30 Sekunden.
- **Maximal 5 Versuche** — Nach 5 fehlgeschlagenen Wiederverbindungsversuchen hört der Client auf, es zu versuchen.
- **Automatisches erneutes Abonnieren** — Bei erfolgreicher Wiederverbindung werden alle aktiven Abonnements erneut beim Server registriert. Kein manuelles Eingreifen erforderlich.
- **Nachrichten-Queuing** — Nachrichten, die während der Trennung gesendet werden, werden in eine Warteschlange gestellt und nach der Wiederverbindung zugestellt.

Sie können auf Ereignisse des Verbindungslebenszyklus lauschen:

```typescript
const ws = client.ws; // Access the WebSocket client

ws.on("connect", () => console.log("Connected"));
ws.on("disconnect", () => console.log("Disconnected"));
ws.on("reconnect", () => console.log("Reconnected"));
ws.on("error", (error) => console.error("Error:", error));
```

## Authentifizierung & RLS

WebSocket-Abonnements respektieren automatisch Row-Level-Security-Richtlinien (RLS). Wenn der Client authentifiziert ist:

1. Die WebSocket-Verbindung authentifiziert sich mit demselben JWT-Token wie die REST-API.
2. Jeder Abonnement-Refetch läuft innerhalb einer PostgreSQL-Transaktion mit `set_config('app.userId', ...)` und `set_config('app.user_roles', ...)` — wodurch die RLS-Richtlinien durchgesetzt werden.
3. Wenn ein Token während einer aktiven Sitzung abläuft, authentifiziert sich der Client automatisch neu und abonniert erneut.

Das bedeutet, dass jeder Benutzer nur Updates für Datensätze erhält, die er sehen darf.

## Instanzübergreifendes Broadcasting & LISTEN/NOTIFY-Architektur

Für Cluster-Umgebungen mit mehreren Instanzen (z. B. laufend in Kubernetes- oder Docker-Containern hinter einem Load Balancer) stützt sich Rebase auf `LISTEN/NOTIFY` von PostgreSQL, um mutierende Operationen und den Echtzeit-Zustand über Instanzen hinweg zu synchronisieren.

### Umgehen von pgBouncer-Pools

Da Connection-Pooler wie **pgBouncer** das persistente Verbindungsmodell, das für langlebige SQL-`LISTEN`-Sitzungen erforderlich ist, nicht unterstützen, öffnet der Echtzeit-Supervisor einen dedizierten, ungepoolten Postgres-Client (`PgClient`) direkt zur Datenbank. Diese direkte Verbindung nutzt die Umgebungsvariable `DATABASE_DIRECT_URL`, sofern konfiguriert, was Stabilität gewährleistet und Pool-Erschöpfung oder abrupte Abbrüche verhindert.

### Benachrichtigungsmechanik & Payload-Layout

Wenn eine Entität auf Instanz A geändert wird, sendet diese eine Benachrichtigung auf dem Kanal `rebase_entity_changes`. Um den Datenbank-Overhead und die Netzwerkbandbreite zu minimieren, wird das Benachrichtigungs-Payload extrem kompakt gehalten:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Hinweis: `sid` steht für die eindeutige zufällige Instanz-ID des Servers, die beim Start generiert wird, `p` ist der Collection-Slug (Pfad) und `eid` ist die Ziel-Entitäts-ID.*

- **Selbstfilterung**: Beim Empfang einer Nachricht liest jede Instanz die `sid`. Stimmt sie mit ihrer eigenen Instanz-ID überein, verwirft der Server die Benachrichtigung, um unendliche Routing-Schleifen zu verhindern.
- **Relay und Fan-out**: Stammt die Benachrichtigung von einer anderen Instanz, plant der Server einen entprellten Refetch und leitet das Update an seine lokal verbundenen WebSocket-Abonnenten weiter.
- **Supervisor-Wiederverbindungsschleife**: Bricht die Datenbankverbindung ab, überwacht ein Hintergrund-Verbindungssupervisor den Zustand und löst nach einer festen Verzögerung von **3 Sekunden** eine automatische Wiederverbindungssequenz aus, wodurch die `LISTEN`-Schleife wiederhergestellt wird, ohne den Hauptlebenszyklus der Hono-Anwendung zu beeinträchtigen.

## Änderungserfassung auf Datenbankebene (CDC)

**Change Data Capture ist standardmäßig aktiviert.** Rebase erfasst Änderungen an der Datenbank und gibt Echtzeit-Ereignisse für **jeden committeten Schreibvorgang aus, unabhängig davon, wie er erfolgt ist** — REST, SDK, Studio, `psql`, ein Cron-Job in einem anderen Dienst, rohes Drizzle/SQL oder der **SQL-Editor** von Studio. Dies ist dasselbe Modell wie Supabase Realtime, das das Write-Ahead-Log ausliest.

Es ist keine Konfiguration erforderlich. Auf einer Datenbankverbindung, die dies unterstützt, provisioniert sich CDC beim Start selbst; auf einer, die dies nicht tut (z. B. eine eingeschränkte Rolle, die keine Trigger erstellen kann), verwendet Rebase stillschweigend Echtzeit auf Anwendungsebene stattdessen — nichts zu aktivieren, nichts, das kaputt geht.

### Konfiguration

CDC wird über die Umgebungsvariable `REALTIME_CDC` gesteuert:

| Wert | Verhalten |
| --- | --- |
| `auto` *(Standard)* | Aktiviert die Erfassung auf Datenbankebene, wo die Verbindung dies unterstützt; **fällt stillschweigend zurück** auf Echtzeit auf Anwendungsebene andernfalls. Ohne Konfiguration. |
| `trigger` | Erzwingt triggerbasierte Erfassung. Funktioniert auf jedem PostgreSQL, einschließlich verwalteter Instanzen ohne logische Replikation. Warnt (statt stillschweigend zurückzufallen), wenn keine Provisionierung möglich ist. |
| `wal` | Bevorzugt WAL-logische Replikation. Noch nicht gebündelt — degradiert zu `trigger` und protokolliert den aktiven Modus. |
| `off` | Nur Echtzeit auf Anwendungsebene. Verwenden Sie dies, um den Trigger-Overhead pro Schreibvorgang bei schreibintensiven Workloads zu vermeiden. |

Beim Start sehen Sie eine Log-Zeile, die den aktiven Modus angibt, z. B.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Wenn die Verbindung dies nicht unterstützen kann, protokolliert `auto` stattdessen eine Informationszeile und fährt mit Echtzeit auf Anwendungsebene fort:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Funktionsweise

1. **Selbstprovisionierung** — Beim Start (Server-/Owner-Kontext) installiert Rebase einen idempotenten `AFTER INSERT/UPDATE/DELETE`-Trigger auf jeder verwalteten Tabelle. Der Trigger gibt eine kompakte Änderungsbenachrichtigung auf dem Kanal `rebase_cdc` aus. Ein Payload, das das 8&nbsp;KB-`NOTIFY`-Limit von PostgreSQL überschreiten würde, fällt auf eine reine Identitätsnachricht zurück, sodass CDC niemals den auslösenden Schreibvorgang abbrechen kann.
2. **Erfassung** — Ein dedizierter, ungepoolter `LISTEN`-Client pro Instanz konsumiert `rebase_cdc`, ordnet die geänderte Tabelle wieder ihrer Collection zu und speist die Änderung in dieselbe `RealtimeService`-Pipeline ein, die auch von API-Mutationen verwendet wird. Wie der instanzübergreifende Listener bevorzugt er `DATABASE_DIRECT_URL` und verbindet sich automatisch neu.
3. **RLS-sichere Zustellung** — Die rohe Zeile aus dem Änderungsstrom wird **niemals** an Abonnenten weitergeleitet. Die Änderung wird als invalidiert markiert, und jedes Abonnement liest die Zeile unter seinem **eigenen** Auth-Kontext erneut. Die Filterung erfolgt daher pro Abonnent, niemals pro Publisher: Ein Client erhält nur Zeilen, die seine RLS-Richtlinien erlauben.
4. **Instanzübergreifend** — Da jede Instanz jeden Commit über den Änderungsstrom beobachtet, *ist* CDC auch der instanzübergreifende Kanal; der veraltete Broadcast `rebase_entity_changes` pro Mutation wird nicht verwendet, während CDC aktiv ist.
5. **De-Duplizierung** — Eine über die Rebase-API vorgenommene Mutation wird lokal in dem Moment zugestellt, in dem sie committet, und wird auch über den Änderungsstrom zurückgespiegelt. Die ursprüngliche Instanz unterdrückt dieses Echo (ein kurzlebiger Datensatz ihrer eigenen Emissionen), sodass Abonnenten einen API-Schreibvorgang nie zweimal sehen.

### Voraussetzungen & Hinweise

- CDC erfordert eine direkte Verbindungszeichenfolge (`DATABASE_DIRECT_URL` oder die primäre Verbindung) für den `LISTEN`-Client — Connection-Pooler im Transaktionsmodus unterstützen keine langlebigen `LISTEN`-Sitzungen.
- Trigger werden nur auf Tabellen installiert, die durch eine registrierte Collection gestützt werden. Schreibvorgänge auf nicht zugeordnete Tabellen werden ignoriert.
- Eine Collection, deren Tabelle noch nicht migriert wurde, wird mit einer Warnung übersprungen, anstatt CDC für den Rest zu blockieren.
- Natives WAL-Logical-Replication-Streaming (`wal2json`/`pgoutput`) ist geplant; heute degradiert `REALTIME_CDC=wal` zum triggerbasierten Pfad, der eine gleichwertige Abdeckung auf Datenbankebene bietet.

## Timeout ausstehender Anfragen

Um zu verhindern, dass Client-Anfragen unbegrenzt hängen bleiben, haben alle ausstehenden WebSocket-Operationen, die eine Serverantwort erwarten (wie einmalige Collection-Abrufe `FETCH_COLLECTION`, Abrufe einzelner Entitäten `FETCH_ONE`, Erstellen/Aktualisieren `SAVE`, Löschungen `DELETE`, Zählungen `COUNT` und Eindeutigkeitsprüfungen `CHECK_UNIQUE_FIELD`), ein Standard-Timeout von 30 Sekunden.

Antwortet der Server nicht innerhalb dieses 30-Sekunden-Fensters, löscht der Client automatisch die ausstehende Anfrage und lehnt das Promise mit einem `ApiError` mit der Nachricht `"Request timed out"` ab.

Einwegnachrichten, die keine Antwort erwarten (wie `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` und `presence_state`), werden sofort bei der Übertragung aufgelöst und lösen keine Timeouts aus.

## Nächste Schritte

- [Client-SDK](/docs/sdk) — Vollständige SDK-Referenz einschließlich typisierter Collection-Accessoren.
- [Authentifizierung](/docs/backend/authentication) — JWT-Authentifizierung und RLS-Richtlinien einrichten.
- [Backend-Architektur](/docs/backend) — Überblick über die Architektur des Rebase-Servers.

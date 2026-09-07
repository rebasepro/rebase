---
sourceHash: 4f7a93fd3a8e67c8
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

Eine Änderung erreicht einen Abonnenten nie als Daten. Sie erreicht ihn als die
Tatsache, dass sich etwas geändert hat, und jedem Abonnenten wird anschließend
durch eine als er ausgeführte Abfrage mitgeteilt, was *er* sehen darf:

1. **Invalidierung.** Wenn sich eine Entität ändert (erstellt, aktualisiert,
   gelöscht), markiert der Server die betroffenen Pfade. Die geschriebene Zeile
   wird nicht weitergeleitet — sie wurde unter der Autorisierung des Schreibenden
   gelesen, und die sagt nichts darüber aus, was ein Abonnent sehen darf.

2. **Entprellter RLS-Refetch.** Nach **300 ms** (`REFETCH_DEBOUNCE_MS`) holt der
   Server die Collection mit Ihren ursprünglichen Filtern und Ihrer
   Sortierreihenfolge erneut. Die Abfrage läuft in einer Transaktion, die die
   transaktionslokalen Werte `app.user_id` und `app.user_roles` aus dem
   `SubscriptionAuthContext` des Abonnenten setzt, sodass Postgres Row-Level
   Security unter der Identität dieses Clients auswertet und nur die Zeilen, die
   er sehen darf, im `collection_update` gesendet werden. Die Entprellung fasst
   außerdem einen Schwall von Schreibvorgängen zu einer einzigen Abfrage zusammen.

Frühere Versionen sendeten vor diesem Refetch sofort einen `collection_patch`
mit der geschriebenen Zeile, für tabübergreifendes Feedback im
Sub-Millisekundenbereich. Diese Zeile war im Geltungsbereich des Schreibenden
gelesen worden, konnte also Abonnenten erreichen — und tat es —, deren eigene
Richtlinien sie verweigert hätten, und auch der `where`-Filter des Abonnements
wurde nicht auf sie angewendet. Der Patch wurde entfernt: Die wahrgenommene
Latenz eines Updates ist jetzt das Entprellfenster.

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

:::caution[Wo das hingehört]
**Managed Runtime: nirgendwo.** Kanal-Aufbewahrung und `realtime.bus` sind Teil
des Datenbankadapters, den die Managed Runtime selbst konstruiert, und keines von
beiden hat eine Form als Umgebungsvariable. Ejecten Sie, um sie zu konfigurieren.
**Ejected:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
:::

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
Ein Client, der einem Kanal beigetreten ist, darf dessen aufbewahrte Nachrichten wiederholen, einschließlich derer, die vor seiner Ankunft gesendet wurden — die Mitgliedschaft ist die einzige Prüfung, und beitreten kann jeder Client, der den Kanal benennen kann. Die Aufbewahrung ist pro Kanalmuster optional, sie zu aktivieren macht die Vergangenheit dieses Kanals also für jeden Besucher lesbar, der den Namen errät. Kanäle mit Aufbewahrung sind der Fall, in dem daraus etwas Dauerhaftes statt etwas Flüchtiges wird — behandeln Sie den Inhalt eines aufbewahrten Kanals deshalb als für Ihre Nutzer öffentlich.
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

WebSocket-Abonnements respektieren automatisch Row-Level-Security-Richtlinien (RLS). Wenn der Client authentifiziert ist:

1. Die WebSocket-Verbindung authentifiziert sich mit demselben JWT-Token wie die REST-API.
2. Jeder Abonnement-Refetch läuft innerhalb einer PostgreSQL-Transaktion mit `set_config('app.user_id', ...)` und `set_config('app.user_roles', ...)` — wodurch die RLS-Richtlinien durchgesetzt werden.
3. Wenn ein Token während einer aktiven Sitzung abläuft, authentifiziert sich der Client automatisch neu und abonniert erneut.

Das bedeutet, dass jeder Benutzer nur Updates für Datensätze erhält, die er sehen darf.

Mehr als eine Instanz zu betreiben — der LISTEN/NOTIFY-Bus, was Präsenz
prozessübergreifend tut, und das Schreiben eines eigenen Transports — hat eine
eigene Seite: [Echtzeit über Instanzen hinweg](/docs/backend/realtime-transports/).

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

### Wenn ein Kanal-Frame abgelehnt wird

Ein Kanal-Frame ist Fire-and-Forget: `await channel.broadcast(...)` wird
aufgelöst, sobald der Frame in den Socket geschrieben ist, **nicht**, wenn der
Server ihn angenommen hat. Das ist Absicht — eine kollaborative Anwendung sendet
sechzigmal pro Sekunde eine Cursorposition, und auf jede Bestätigung zu warten
würde aus jeder einzelnen einen Roundtrip machen.

Eine Ablehnung kann daher kein abgelehntes Promise sein. Sie kommt über
`onError` an:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Bedeutung |
|------|-------|
| `CHANNEL_FORBIDDEN` | Sie sind kein Mitglied des Kanals — treten Sie ihm bei, bevor Sie senden oder seinen Verlauf lesen |
| `RATE_LIMITED` | Über dem oben genannten Budget für Kanal-Frames |
| `CHANNEL_HISTORY_WRITE_FAILED` | Ein aufbewahrter Broadcast konnte nicht persistiert werden und wurde daher verworfen |
| `CHANNEL_HISTORY_READ_FAILED` | Eine Aufhol-Anfrage konnte nicht bedient werden |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Der Broadcast hat nur diese Instanz erreicht — siehe [Das 8&nbsp;KB-Limit des Postgres-Bus](#the-8-kb-limit-on-the-postgres-bus) |

Ohne angehängten Handler werden diese als Warnung protokolliert. Früher wurden
sie vollständig verworfen: Es gab kein Promise, das abgelehnt werden konnte, und
keinen Kanal, an den zugestellt werden konnte, sodass ein verbotener Broadcast
nicht von einem zugestellten zu unterscheiden war.

## Nächste Schritte

- [Client-SDK](/docs/sdk) — Vollständige SDK-Referenz einschließlich typisierter Collection-Accessoren.
- [Authentifizierung](/docs/backend/authentication) — JWT-Authentifizierung und RLS-Richtlinien einrichten.
- [Backend-Architektur](/docs/backend) — Überblick über die Architektur des Rebase-Servers.

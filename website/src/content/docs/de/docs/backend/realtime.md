---
sourceHash: 0804be5779f90bbb
title: Realtime & WebSocket
sidebar_label: Realtime
description: Echtzeit-Datensynchronisierung, Broadcast-Kanäle und Presence-Tracking über WebSocket.
---

Rebase enthält eine integrierte Realtime-Engine, die Datenänderungen über WebSocket per Push an verbundene Clients überträgt.
Sobald ein Datensatz erstellt, aktualisiert oder gelöscht wird, erhält jeder Abonnent, der diese Tabelle oder Entität beobachtet, das Update sofort – ganz ohne Polling.

## Wie es funktioniert

Die Realtime-Pipeline besteht aus drei Stufen:

1. **Datenbank-Trigger** — Eine Mutation trifft die PostgreSQL-Datenbank (über die REST-API, das SDK oder Studio).
2. **Server-Fan-out** — Der Rebase-Server erkennt die Änderung und verteilt sie per Fan-out an jedes aktive WebSocket-Abonnement, das zur betroffenen Tabelle oder Entität passt.
3. **Client-Callback** — Das typisierte SDK löst Ihren `onUpdate`-Callback mit den aktuellen Daten aus.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Bei Multi-Instanz-Deployments nutzt Rebase das `LISTEN/NOTIFY` von PostgreSQL, um Änderungen über Serverinstanzen hinweg zu übertragen. Dies geschieht automatisch. Bei aktivierter [Change Capture auf Datenbankebene](/docs/backend/realtime-cdc/) (Standardeinstellung überall dort, wo die Datenbankrolle Trigger erstellen kann) lauscht jede Instanz auf dem `rebase_cdc`-Kanal, auf dem die Capture-Trigger veröffentlichen. So wird jeder Schreibvorgang registriert, unabhängig davon, welcher Prozess oder welches Tool ihn ausgeführt hat. Ohne Capture kündigt jede Instanz ihre eigenen Schreibvorgänge auf dem Kanal `rebase_entity_changes` an, und eine dedizierte Verbindung auf jeder anderen Instanz leitet sie an ihre lokalen Abonnenten weiter.

### Zero-Configuration

Realtime ist standardmäßig aktiviert. Es muss kein Flag gesetzt und kein Dienst gestartet werden – wenn Ihr Rebase-Server läuft, ist der WebSocket-Endpunkt verfügbar.

### Auf welchem Pfad der Socket antwortet

Der Socket antwortet auf Upgrades auf genau einem Pfad: dem Basispfad der API ohne das abschließende `/api`, also `/` für eine API unter `/api`. Genau dorthin verbindet sich das SDK: Es verbindet sich mit seiner `baseUrl`, während seine HTTP-Anfragen an `${baseUrl}/api` gehen. Ein Upgrade auf jeden anderen Pfad wird den übrigen `upgrade`-Listenern des Servers überlassen, sodass Ihre Anwendung ihren eigenen WebSocket-Server auf demselben `http.Server` betreiben kann. Gibt es keinen weiteren Listener, wird ein solches Upgrade mit `404` beantwortet.

In einem [benutzerdefinierten Server](/docs/backend/custom-server/) legt `backend.attachRealtime(server, { path })` den Pfad fest, und `realtime.path` des Postgres-Adapters überschreibt den vom Server abgeleiteten Wert.

> Standardmäßig gibt Rebase auch Realtime-Events für Schreibvorgänge aus, die **außerhalb** der API getätigt wurden (über `psql`, einen anderen Dienst oder den SQL-Editor von Studio), wann immer die Datenbankverbindung dies unterstützt – siehe [Change Capture auf Datenbankebene](/docs/backend/realtime-cdc/).

## Typisierte SDK-Abonnements

Das typisierte SDK von Rebase stellt zwei Abonnement-Methoden auf jedem Tabellen-Accessor bereit:

- **`listen()`** — Eine gesamte Tabelle abonnieren (mit optionalen Filtern).
- **`listenById()`** — Eine einzelne Entität anhand ihrer ID abonnieren.

Beide Methoden geben eine **Unsubscribe-Funktion** zurück, die Sie aufrufen, um den Empfang von Updates zu beenden.

### Eine Tabelle abonnieren

Verwenden Sie `listen()`, um Updates zu erhalten, wann immer sich Datensätze in einer Tabelle ändern:

```typescript
const unsubscribe = client.data.products.listen(
  undefined, // FindParams — übergeben Sie undefined für alle Datensätze
  (response) => {
    console.log("Products updated:", response.data);
    console.log("Total:", response.meta.total);
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

Der Callback empfängt ein `FindResult<M>`, das Folgendes enthält:
- `data` — Die Zeilen in flacher Form, wie `find()` sie zurückgibt (`row.name`, nicht `row.values.name`).
- `meta` — Paginierungsinformationen (`total`, `limit`, `offset`, `hasMore`).

### Eine Tabelle mit Filtern abonnieren

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

Verwenden Sie `listenById()`, um einen bestimmten Datensatz zu überwachen:

```typescript
const unsubscribe = client.data.products.listenById(
  "product-123",
  (row) => {
    if (row) {
      console.log("Product updated:", row.name);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

Der Callback empfängt die Zeile flach, wie `findById()` sie zurückgibt (`row.name`, nicht `row.values.name`), oder `undefined`, sobald die Zeile gelöscht wurde.

**Jeder Frame enthält die Version der Zeile.** `etagOf(row)` entspricht dem `ETag`, den ein `GET`-Aufruf der Zeile zurückgibt. So kann eine Bearbeitung, die auf Basis der Daten eines Frames durchgeführt wurde, mit `ifMatch: etagOf(row)` gespeichert werden und wird mit `412` abgelehnt, falls die Zeile in der Zwischenzeit geändert wurde (siehe [Bedingte Schreibvorgänge](/docs/backend/writes/)). Auf Netzwerkebene fordert `subscribe_one` des SDKs mit `etag: true` an, und jeder `single_update`-Frame für eine existierende Zeile enthält `"etag"` neben `"row"`. Ein älterer Server ignoriert diese Anforderung und sendet kein Tag; ein Client, der nicht danach fragt, erhält Frames ohne Tag.

### Abonnements beenden

Sowohl `listen()` als auch `listenById()` geben eine Unsubscribe-Funktion zurück. Rufen Sie diese auf, um den Empfang von Updates zu beenden und serverseitige Ressourcen freizugeben:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // Updates verarbeiten
});

// Später, wenn keine Updates mehr benötigt werden:
unsubscribe();
```

:::tip
Rufen Sie die Unsubscribe-Funktion immer auf, wenn eine Komponente unmountet wird oder von einer Seite wegnavigiert wird. Dies verhindert Speicherlecks und unnötige serverseitige Arbeit.
:::

## Query Builder `.listen()`

Der Fluent Query Builder unterstützt ebenfalls Realtime-Abonnements. Verketten Sie Ihre Filter und rufen Sie anschließend `.listen()` statt `.find()` auf:

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
`.listen()` – sowohl auf dem Query Builder als auch auf dem Tabellen-Accessor – benötigt den WebSocket des Clients. Der Client leitet seine URL von `baseUrl` ab, es sei denn, `websocketUrl` wird angegeben. Bei einem Client, der mit `realtime: false` erstellt wurde oder keine URL ableiten konnte, löst der Aufruf von `.listen()` einen Fehler aus.
:::

## Auslieferung von Updates: Sofortiger Patch + Refetch für Korrektheit

Eine Änderung wird niemals direkt als Datenpaket an einen Abonnenten übertragen. Sie wird als die Tatsache übermittelt, dass sich etwas geändert hat. Jedem Abonnenten wird anschließend über eine Abfrage, die in seinem Kontext ausgeführt wird, mitgeteilt, was *er* sehen darf:

1. **Invalidierung.** Wenn sich eine Entität ändert (erstellt, aktualisiert, gelöscht), markiert der Server die betroffenen Pfade. Die geschriebene Zeile wird nicht weitergeleitet – sie wurde unter der Autorisierung des Schreibenden gelesen, was nichts darüber aussagt, was ein Abonnent sehen darf.

2. **Gedrosselter RLS-Refetch (Debounced).** Nach **300ms** (`REFETCH_DEBOUNCE_MS`) ruft der Server die Tabelle mit Ihren ursprünglichen Filtern und der Sortierreihenfolge erneut ab. Die Abfrage läuft innerhalb einer Transaktion, die die transaktionslokalen Variablen `app.user_id` und `app.user_roles` aus dem `SubscriptionAuthContext` des Abonnenten setzt. So wertet Postgres die Row-Level Security unter der Identität dieses Clients aus, und nur die Zeilen, zu deren Ansicht er berechtigt ist, werden im `collection_update` gesendet. Das Debouncing fasst zudem eine Reihe schneller Schreibvorgänge in einer einzigen Abfrage zusammen. Es wartet 300 ms lang auf das Ausbleiben weiterer Änderungen, jedoch nie länger als **1 s** (`REFETCH_MAX_WAIT_MS`) nach der ersten Änderung. So sendet eine Tabelle, in die mehrmals pro Sekunde geschrieben wird, ihren Abonnenten dennoch mindestens einmal pro Sekunde einen Frame. Setzen Sie diese Grenze mit `REALTIME_REFETCH_MAX_WAIT_MS` (oder `realtime.refetchMaxWaitMs`): Höhere Werte rufen eine stark frequentierte Tabelle seltener ab, niedrigere Werte senden aktuellere Frames.

   Ein Refetch, der exakt das liest, was einem Abonnenten zuletzt gesendet wurde, sendet diesem Abonnenten nichts: Ein Schreibvorgang auf Zeile 9.000 einer Liste, die nur die ersten 50 anzeigt, kostet lediglich den Lesevorgang, aber keinen Frame für jeden Betrachter. Nach einem Fehler-Frame werden die nächsten Zeilen erneut gesendet, selbst wenn sie identisch sind.

Frühere Versionen sendeten vor diesem Refetch ein sofortiges `collection_patch`, das die geschriebene Zeile enthielt, um ein Feedback im Sub-Millisekunden-Bereich über Tabs hinweg zu ermöglichen. Diese Zeile war jedoch im Scope des Schreibenden gelesen worden, sodass sie Abonnenten erreichen konnte – und erreichte –, deren eigene Richtlinien den Zugriff verweigert hätten; zudem wurde der `where`-Filter des Abonnements darauf nicht angewendet. Dieser Patch wurde entfernt: Die gefühlte Latenz für ein Update entspricht nun dem Debounce-Fenster.

### Der Refetch ist der REST-Lesevorgang

Der Refetch durchläuft dieselbe Pipeline wie `GET /api/data/<table>`, mit derselben `include`-Verarbeitung. Das ist der Grund, warum `find({ q })` und `listen({ q })` Zeilen zurückgeben, die Feld für Feld identisch sind.

Früher war dies eine andere Methode – eine, die jede Relation in eine `{ "__type": "relation" }`-Hülle packte und, da ein Abonnement kein `include` enthalten konnte, **jede** von der Tabelle deklarierte Relation eager nachlud. Dieselbe Abfrage wurde also über HTTP in einer Struktur und über den Socket in einer anderen beantwortet, und ein Client, der beides darstellte, sah, wie seine Zeilen in dem Moment ihre Form änderten, in dem ein Schreibvorgang eintraf.

Ein Subscribe-Frame akzeptiert daher dieselben Parameter wie eine Listenanfrage: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` und `fields`. `vectorSearch` ist die Ausnahme und wird mit `VECTOR_SEARCH_NOT_LIVE` **abgelehnt** – ein Abonnement wird bei jedem passenden Schreibvorgang erneut ausgeführt, und dort werden keine Distanzen berechnet.

### `collection_update` enthält eigene Metadaten

Der Frame ist strukturiert als `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` wird innerhalb derselben RLS-gebundenen Transaktion gezählt, die auch die Zeilen gelesen hat, und beschreibt daher exakt die beiliegenden Zeilen. Ohne diese Angabe musste ein Client, der eine Gesamtzahl benötigte, einen `GET /count` **pro Push** absetzen – ein zusätzlicher Roundtrip pro Schreibvorgang und Abonnent, verbunden mit einem Zeitfenster, in dem die Anzahl und die Zeilen unterschiedliche Zustände der Tabelle beschrieben.

Wenn die Zählung selbst fehlschlägt, enthält der Frame `partial: true` und kein `total`; dies ist kein Abonnementfehler, und ein Client sollte den letzten echten Gesamtwert beibehalten, anstatt die Seitenlänge einzusetzen. Bei einer großen Tabelle macht die Zählung den Großteil der Kosten eines Frames aus. Wenn `REALTIME_RECOUNT_INTERVAL_MS` gesetzt ist, verwendet eine Liste, deren letzte Gesamtzahl mindestens `REALTIME_RECOUNT_MIN_ROWS` betrug (standardmäßig 100.000), diesen Gesamtwert für die Dauer des Intervalls wieder, anstatt bei jedem Schreibvorgang neu zu zählen. Ein solcher Frame enthält `meta.totalAsOf`, den Zeitpunkt der Zählung. Nach Ablauf des Intervalls wird eine Liste, deren letzter Frame den Gesamtwert wiederverwendet hat, erneut gezählt und erhält den neuen Gesamtwert, unabhängig davon, ob seitdem etwas geschrieben wurde. Ist die Variable nicht gesetzt (Standard), zählt jeder Frame.

### Was ein Schreibvorgang kostet, und die Limits

Da jeder Frame eine Abfrage ist, die im Kontext seines Abonnenten ausgeführt wird, steigen die Kosten eines Schreibvorgangs mit der Anzahl der **verschiedenen Abfragen, die von unterschiedlichen Prinzipalen** auf der betroffenen Tabelle gestellt werden – nicht mit der Anzahl der offenen Sockets:

- Abonnements, die dieselbe Abfrage (gleicher Pfad, Filter, Sortierung, Seite, `include`, `fields`, Suche) als derselbe Prinzipal (gleiche Benutzer-ID, Rollen, Guest-Flag und Claims) stellen, teilen sich einen Refetch. Ein Schreibvorgang in eine Liste kostet **eine Transaktion pro solcher Gruppe** – den Lesevorgang und seine Zählung –, egal wie viele Sockets sie halten; jedes Mitglied erhält dennoch einen Frame aus Zeilen, die unter dieser Identität gelesen wurden. Eine erste Seite, die kürzer als ihr `limit` zurückkommt, umfasst die gesamte Menge und wird daher überhaupt nicht gezählt.
- Ein Einzeldatensatz-Abonnement wird nur abgefragt, wenn sich sein eigener Datensatz ändert.
- Unterschiedliche Prinzipale teilen sich niemals einen Lesevorgang – das verhindert, dass ein Frame eine Zeile enthält, die der Leser nicht sehen darf. Eine Liste, die von tausend verschiedenen angemeldeten Benutzern beobachtet wird, bedeutet tausend Lesevorgänge und tausend Zählungen bei jedem Schreibvorgang, in tausend Transaktionen.

Gemessen auf einem Laptop gegen ein lokales PostgreSQL mit einem 20-Verbindungen-Pool bei einem Schreibvorgang auf eine Liste:

| Abonnenten | Transaktionen für den Schreibvorgang | Letzter Frame nach dem Schreibvorgang |
|-------------|----------------------------|----------------------------|
| 1.000, ein Prinzipal | 2 | ~310 ms |
| 1.000, jeweils unterschiedliche Prinzipale | ~1.000 | ~600 ms |

Jeweils 300 ms entfallen auf das Debounce. Die zweite Zeile stellt die Obergrenze dar, für die geplant werden sollte. Die Refetches laufen über denselben Pool wie Ihr REST-Traffic, belegen jedoch höchstens ein Viertel seiner Verbindungen gleichzeitig (5 der standardmäßig 20, nie weniger als 2); der Rest wartet im Server, sodass das Fan-out eines Schreibvorgangs seine eigenen Frames verzögert und nicht Ihre Anfragen. Eine Tabelle, in die mehrmals pro Sekunde geschrieben wird, während **Hunderte verschiedene Benutzer** dieselbe Liste beobachten, bringt diese Frames an ihre Grenzen. Wählen Sie darüber hinaus engere Abonnements (eine Seite, ein Filter auf die eigenen Zeilen des Benutzers) oder einen [Broadcast-Kanal](#broadcast-kanäle), der die Änderung übermittelt, damit Clients sie nach eigenem Zeitplan erneut abrufen können.

**Ein Socket darf maximal 1.000 Abonnements halten.** Das nächste wird mit einem Fehler-Frame mit dem Code `TOO_MANY_SUBSCRIPTIONS` abgelehnt; ein erneutes Abonnieren unter einer ID, die der Socket bereits hält, ersetzt dieses Abonnement und zählt nicht erneut. Das SDK teilt identische Abonnements auf einem Socket, sodass hier die verschiedenen Listen und Datensätze gezählt werden, die eine Seite geöffnet hat. Ändern Sie dies mit `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` oder `realtime.maxSubscriptionsPerSocket` auf dem Postgres-Adapter (die Umgebungsvariable hat Vorrang); ein Wert, der keine positive ganze Zahl ist, stoppt den Server beim Start. **Die Sockets, die ein Benutzer hält, können ebenfalls limitiert werden**, pro Serverinstanz: Setzen Sie `REALTIME_MAX_SOCKETS_PER_USER` (oder `realtime.maxSocketsPerUser`), und eine Anmeldung darüber hinaus wird mit `TOO_MANY_SOCKETS` abgelehnt und der Socket mit 4002 geschlossen. Sockets, die mit einem API-Schlüssel angemeldet sind, zählen gegen diesen Schlüssel, jeder Schlüssel für sich, nicht gegen das Konto, das ihn erstellt hat; der Service-Key ist ein einzelnes Credential, sodass alle seine Sockets zusammen zählen. Die Sockets eines Administrators, die sich als Benutzer ausgeben, zählen gegen den Administrator und seine eigenen Sockets, nicht gegen den imitierten Benutzer. Das SDK informiert jedes aktive Abonnement und `onConnectionLost` gleichzeitig mit einem `CONNECTION_LOST`-Fehler, dessen `details.reason` `TOO_MANY_SOCKETS` ist, und versucht es weiter mit längeren Wartezeiten bis zu 30 s, sodass der Tab hineinkommt, sobald ein anderer Socket schließt. Ist der Wert nicht gesetzt (Standard), gibt es keine Obergrenze.

Eine Abonnement-ID gehört dem jeweiligen Socket: Zwei Clients, die ein Abonnement beide `"sub-1"` nennen, behalten jeweils ihres, und ein `unsubscribe` beendet nur das des Senders.

**Abonnieren zählt gegen das Daten-Ratenlimit.** Der erste Frame eines Abonnements ist ein Lesevorgang, der im Namen des Abonnenten ausgeführt wird, ebenso wie die Verlaufsanfrage eines Kanals. Daher zählen `subscribe_collection`, `subscribe_one` und `channel_history` als Datenanfragen im Rate-Limit-Bucket des Aufrufers (denselben, den sich seine HTTP-Anfragen und seine anderen Sockets teilen), sobald das socket-eigene Kontingent aufgebraucht ist. Jeder Socket darf 1.000 davon senden, ohne dass sie angerechnet werden, oder so viele wie seine Abonnement-Obergrenze, wenn diese höher ist; das Kontingent regeneriert sich über 15 Minuten. Das entspricht allem, was ein Socket halten kann, sodass das erneute Abonnieren nach einem Reconnect niemals verweigert wird und nicht das Budget des Nutzers belastet. Wird das Kontingent überschritten, wird ein Frame über dem Limit mit einem Fehler-Frame mit dem Code `RATE_LIMITED` abgelehnt, den das SDK an das `onError` dieses Abonnements oder des Kanals weiterleitet.

### Sockets, die nicht mehr antworten

Ein Client kann verschwinden, ohne seinen Socket ordnungsgemäß zu schließen: Ein Smartphone verliert den Empfang, ein Laptop geht in den Ruhezustand, ein NAT vergisst die Verbindung. Da kein Close-Frame eintrifft, erfährt der Server nichts davon. Der Server pingt daher jeden Socket alle 30 Sekunden an und beendet Verbindungen, die bis zum nächsten Ping nicht geantwortet haben, sodass ein nicht mehr erreichbarer Client innerhalb einer Minute freigegeben wird. Browser und das SDK beantworten Pings automatisch; ein Client, der das Protokoll direkt spricht, muss sie ebenfalls beantworten, wie es die meisten WebSocket-Bibliotheken tun.

**Die Browser-Seite.** Ein Browser kann weder Pings senden noch empfangen, sodass ein halb offener Socket für ihn dauerhaft verbunden erscheint. Das SDK öffnet den Socket mit `?rebase_caps=heartbeat,channel_seq,cancel_sql`; ein Server, der diese unterstützt, antwortet mit `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listet die unterstützten Fähigkeiten auf (`cancel_sql`: er akzeptiert den `CANCEL_SQL`-Frame der SQL-Konsole) und sendet alle 30 Sekunden `{"type":"heartbeat"}`. Das SDK trennt den Socket und [verbindet sich neu](#automatisches-wiederverbinden-auto-reconnect), wenn zwei Heartbeats verpasst wurden. Ein Client, der nichts angibt, erhält keines von beiden, und ein älterer Server ignoriert den Parameter, sodass sich ein SDK im Zusammenspiel mit einem solchen wie bisher verhält.

Ein Socket wird auch dann beendet, wenn mehr als 16&nbsp;MiB an gesendeten Frames noch ungelesen sind. Dies betrifft Clients, die Empfangenes nicht lesen, oder solche, die so weit zurückliegen, dass das Gelesene veraltet wäre. Und wenn die Sockets eines Servers zusammen mehr als 256&nbsp;MiB ungelesene Daten halten (oder ein Viertel des Speicherlimits, unter dem der Server läuft, falls dieser kleiner ist), werden diejenigen mit den meisten ungelesenen Daten zuerst beendet, bis der Rest wieder passt.

Ein beendeter Socket wird wie ein regulär geschlossener aufgeräumt. Seine Abonnements enden, er verlässt seine Kanäle und seine Presence wird entfernt, wobei der Weggang den anderen Mitgliedern mitgeteilt wird. Ein Client, der noch existiert, bemerkt den Verbindungsabbruch, woraufhin das SDK [die Verbindung wiederherstellt](#automatisches-wiederverbinden-auto-reconnect) und die Abonnements erneut anmeldet.

## Broadcast-Kanäle

Broadcast-Kanäle ermöglichen es Clients, beliebige Nachrichten in Echtzeit untereinander auszutauschen – nützlich für Funktionen wie Tippindikatoren, Cursor-Positionen oder benutzerdefinierte Benachrichtigungen.

Broadcast wird auf der Ebene des WebSocket-Protokolls verwaltet. Der Server unterstützt die folgenden Nachrichtentypen:

| Nachrichtentyp   | Richtung        | Beschreibung                             |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Einem benannten Kanal beitreten          |
| `leave_channel`   | Client → Server | Einen Kanal verlassen                    |
| `broadcast`       | Client → Server | Eine Nachricht an alle Kanalmitglieder senden |
| `broadcast`       | Server → Client | Eine Nachricht von einem anderen Mitglied empfangen |
| `channel_history` | Client → Server | Gespeicherte Nachrichten nach einer Sequenz abrufen |
| `channel_history` | Server → Client | Die gespeicherten Nachrichten, die ein Client verpasst hat |

Wenn ein Client eine `broadcast`-Nachricht sendet, leitet der Server sie an **alle anderen Mitglieder** dieses Kanals weiter (der Sender erhält seine eigene Nachricht nicht).

```typescript
// Broadcast-Nachrichtenstruktur (vom Client gesendet)
{
  type: "broadcast",
  payload: {
    channel: "room-42",
    event: "typing",
    payload: { userId: "user-1", isTyping: true }
  }
}

// Von anderen Clients im Kanal empfangen
{
  type: "broadcast",
  channel: "room-42",
  event: "typing",
  payload: { userId: "user-1", isTyping: true }
}
```

## Kanal-Retention (Aufbewahrung)

Standardmäßig erreicht ein Broadcast aktuell verbundene Mitglieder und ist danach verworfen. Das ist der passende Ansatz für Benachrichtigungen und Cursor und verursacht keine zusätzlichen Kosten.

Für einen Operations-Stream – kollaboratives Bearbeiten oder alles, wo eine unbemerkte Lücke zu Inkonsistenzen führt – kann ein Kanal so konfiguriert werden, dass er seine Nachrichten **beibehält (retains)**. Gespeicherte Broadcasts erhalten eine kanalspezifische Sequenznummer und werden persistiert, sodass ein wiederverbundener Client alles nach der letzten von ihm empfangenen Nummer anfordern kann.

:::caution[Wo dies konfiguriert wird]
**Managed Runtime: Nirgends.** Kanal-Retention und `realtime.bus` sind Teil des Datenbankadapters, den die Managed Runtime selbst konstruiert, und keines von beiden hat eine Form als Umgebungsvariable. Führen Sie ein Eject durch, um sie zu konfigurieren.
**Ejected:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
:::

Die Retention ist optional (Opt-in) und wird hier auf dem Server konfiguriert:

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
                // Das Spezifischste zuerst — der erste Treffer gewinnt.
                { match: "doc:draft:*", limit: 100 },
                { match: "doc:*", limit: 500, ttl: "24h" }
            ]
        }
    })
});
```

| Feld    | Beschreibung                                                                |
|---------|-----------------------------------------------------------------------------|
| `match` | Exakter Kanalname (`"doc:42"`) oder ein Präfix mit abschließendem `*` (`"doc:*"`) |
| `limit` | Behalte maximal so viele der neuesten Nachrichten pro Kanal                |
| `ttl`   | Behalte Nachrichten maximal für diese Dauer – `"30s"`, `"15m"`, `"24h"`, `"7d"` oder Millisekunden |

Eine Regel benötigt mindestens `limit` oder `ttl`. Eine Regel mit keinem von beiden wird ignoriert und protokolliert, da eine unbegrenzte Retention fast nie beabsichtigt ist und nach dem Anwachsen der Tabelle nicht einfach rückgängig gemacht werden kann.

:::note[Warum lässt man Clients nicht den Verlauf anfordern?]
Ein Kanal wird von demjenigen erstellt, der ihn benennt. Wenn ein Client seine eigene Verlaufstiefe bestimmen könnte, könnte jeder Besucher Ihr Backend zu unbegrenztem Speicherplatzverbrauch zwingen. Die Konfiguration an dieser Stelle stellt zudem sicher, dass Presence- und Benachrichtigungskanäle – die überwältigende Mehrheit – nichts kosten: Ohne konfigurierte Regeln wird keine Tabelle erstellt, und Broadcast läuft über denselben synchronen Pfad wie zuvor.
:::

### Speicherung

Gespeicherte Kanäle nutzen zwei Tabellen im `rebase`-Schema, die beim Start automatisch erstellt werden, sobald mindestens eine Regel konfiguriert ist:

| Tabelle                   | Inhalt                                                          |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | Die gespeicherten Nachrichten, indiziert nach `(channel, seq)`  |
| `rebase.channel_cursors`  | Die höchste pro Kanal vergebene Sequenznummer                   |

Das Bereinigen (Pruning) erfolgt beim Eintreffen von Nachrichten, gedrosselt pro Kanal, sodass die Kosten von der verstrichenen Zeit und nicht vom Schreibvolumen abhängen. Es werden ausschließlich Zeilen aus `channel_messages` entfernt – Cursor werden dauerhaft beibehalten (sie belegen eine kleine Zeile pro Kanal), da ein Neustart der Kanal-Sequenz die Bedeutung des gespeicherten Wiederaufsetzpunkts eines Clients verändern würde.

### Zustellungsgarantien

- **Geordnet (Ordered).** Sequenznummern werden pro Kanal vergeben, und die Zustellungsreihenfolge entspricht der Sequenzreihenfolge – auf einer einzelnen Instanz sowie instanzübergreifend auf dem `postgres`-Bus, wo der Befehl zur Nummerierung einer Nachricht diese gleichzeitig ankündigt, sodass jede Instanz (einschließlich der des Senders) die Ankündigungen in Sequenzreihenfolge erhält. Ein selbst bereitgestellter Bus überträgt Frames in der Reihenfolge, in der er sie zustellt.
- **Dauerhaft vor der Zustellung (Durable before delivered).** Eine Nachricht, die nicht gespeichert werden kann, wird an niemanden zugestellt, und der Absender wird darüber informiert. Eine Zustellung würde sie aktiven Abonnenten präsentieren, sie jedoch aus jedem künftigen Replay ausschließen – eine Lücke, die keine spätere Nachricht schließen könnte.
- **At-Least-Once beim Nachholen.** Ein Replay-Bereich kann sich mit Nachrichten überschneiden, die ein Client bereits erhalten hat; das SDK verwirft bereits zugestellte Nachrichten.
- **Keine Lücken (No holes).** Eine gespeicherte Nachricht erreicht jedes Mitglied: Dem Sender, der seine eigene Nachricht nie erhält, wird stattdessen `{"type":"broadcast_ack","channel","seq"}` gesendet, sofern er sich für `channel_seq` entschieden hat. Eine Nachricht jenseits von `lastSeq + 1` bedeutet folglich, dass eine Nachricht verpasst wurde. Das SDK hält sie zurück, fordert den Verlauf dazwischen an und liefert alle Nachrichten geordnet aus. Gegenüber einem Server ohne `channel_seq` wird ein Sprung so zugestellt, wie er eintrifft.

:::caution[Der Verlauf unterliegt demselben Zugriffsmodell wie der Kanal]
Ein Client, der einem Kanal beigetreten ist, kann dessen gespeicherte Nachrichten abspielen, einschließlich derjenigen, die vor seinem Beitritt gesendet wurden – die Mitgliedschaft ist die einzige Prüfung, und der Beitritt steht jedem Client offen, der den Kanalnamen kennt. Die Retention ist per Kanalmuster optional aktivierbar; ihre Aktivierung macht die Vergangenheit dieses Kanals für jeden Besucher lesbar, der den Namen errät. Bei gespeicherten Kanälen wird dies dauerhaft statt flüchtig – behandeln Sie die Inhalte eines persistenten Kanals daher als öffentlich für Ihre Benutzer.
:::

## Presence-Tracking

Presence erfasst, welche Benutzer in einem Kanal aktuell online sind, und ermöglicht es jedem Benutzer, einen benutzerdefinierten Status zu teilen (z. B. Cursor-Position, Status).

| Nachrichtentyp     | Richtung        | Beschreibung                                         |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Presence-Tracking mit benutzerdefiniertem Status starten |
| `presence_untrack`| Client → Server | Presence-Tracking beenden                            |
| `presence_state`  | Client → Server | Den vollständigen Presence-Status für einen Kanal anfordern |
| `presence_state`  | Server → Client | Alle Presences im Kanal, vollständig                 |
| `presence_diff`   | Server → Client | Inkrementelles Update (Beitritte und Abgänge)        |

Wenn ein Client `presence_track` sendet, lässt der Server ihn automatisch dem Kanal beitreten (kein separates `join_channel` erforderlich) und sendet ein `presence_diff` per Broadcast an alle Kanalmitglieder. Das SDK sendet seinen Status etwa alle 20 Sekunden als Heartbeat erneut; ein Heartbeat mit unverändertem Status aktualisiert lediglich das Timeout des Clients und sendet kein `presence_diff`.

```typescript
// Presence erfassen
{
  type: "presence_track",
  payload: {
    channel: "document-edit-42",
    state: { name: "Alice", cursor: { line: 10, col: 5 } }
  }
}

// Presence-Diff, das andere Clients empfangen
{
  type: "presence_diff",
  channel: "document-edit-42",
  joins: { "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } } },
  leaves: {}
}

// Antwort mit vollständigem Presence-Status
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

## Automatisches Wiederverbinden (Auto-Reconnect)

Das typisierte SDK verbindet sich automatisch wieder, wenn die WebSocket-Verbindung abbricht:

- **Exponentielles Backoff** — Jeder Wiederverbindungsversuch wartet ein Zeitintervall ab, das bei 2 Sekunden beginnt und sich jedes Mal verdoppelt, bis zu maximal 30 Sekunden. Die Verzögerung wird zufällig innerhalb dieses Intervalls gewählt (Jitter), beträgt jedoch nie weniger als eine Viertelsekunde. So verteilen sich Clients, die durch ein Deployment gleichzeitig getrennt wurden, über das gesamte Intervall, statt im selben Moment zurückzukehren.
- **Kein Aufgeben, solange etwas aktiv ist** — Solange ein Abonnement oder ein beigetretener Kanal existiert, versucht der Client bei der 30-Sekunden-Obergrenze für die Dauer des Ausfalls weiter, die Verbindung wiederherzustellen. Ist nichts registriert, stoppt er nach 5 fehlgeschlagenen Versuchen, und das nächste Abonnement startet den Verbindungsaufbau erneut. Im Browser lösen sowohl das `online`-Event als auch das Wieder-Sichtbarwerden des Tabs einen sofortigen Verbindungsversuch aus, anstatt das Backoff abzuwarten.
- **Ausfälle werden einmalig gemeldet** — Wenn die Verbindung 14 Sekunden lang unterbrochen war (unabhängig davon, wie viele Versuche unternommen wurden), erhält das `onError` jedes aktiven Abonnements und jedes beigetretenen Kanals genau einen `RebaseApiError` mit dem Code `CONNECTION_LOST`. Das Abonnement **bleibt bestehen**: Der Fehler signalisiert lediglich, dass die Daten nicht aktualisiert werden, nicht, dass das Abonnement beendet wurde.
- **Automatische Neuanmeldung (Resubscription)** — Bei erfolgreicher Wiederverbindung werden alle aktiven Abonnements erneut beim Server registriert, und das nächste `onUpdate` jedes Abonnements liefert alle Änderungen, die während der Abwesenheit des Clients geschrieben wurden. Dieses Update dient als Signal für die Wiederherstellung. Kein manuelles Eingreifen erforderlich.
- **Anfragen werden höchstens einmal ausgeführt (At-most-once)** — Eine Anfrage, die bei getrenntem Socket gestellt wird, wartet bis zu 30 Sekunden ab dem Aufruf auf die Verbindung und schlägt dann mit `REQUEST_TIMEOUT` fehl, ohne jemals gesendet worden zu sein. Eine Anfrage, die beim Verbindungsabbruch bereits gesendet war, schlägt mit `CONNECTION_LOST` fehl und wird **nicht** erneut gesendet: Der Server könnte sie bereits ausgeführt haben oder nicht, und nur der Aufrufer weiß, ob eine doppelte Ausführung sicher ist.

`client.ws.state` gibt Auskunft über den aktuellen Verbindungsstatus, und `onStateChange` wird über jede Änderung informiert:

| Status | Bedeutung |
|---|---|
| `idle` | Kein Socket vorhanden und bisher keiner angefordert (Verbindungsaufbau erfolgt lazy) oder durch Abmeldung getrennt. |
| `connecting` | Verbindungsaufbau läuft, kein Ausfall aktiv. |
| `connected` | Der Socket ist geöffnet. |
| `reconnecting` | Der Socket wurde getrennt und der Client wählt sich neu ein. Es wurde noch nichts gemeldet. |
| `disconnected` | Der Ausfall dauert 14 Sekunden oder länger an. `CONNECTION_LOST` wurde gemeldet, und der Client versucht weiterhin, sich zu verbinden. |
| `closed` | `client.close()` wurde aufgerufen. Endgültiger Zustand. |

```typescript
// `ws` ist auf einem Client ohne Realtime undefined – prüfen Sie es einmalig.
const ws = client.ws;
if (ws) {
    ws.onStateChange((state) => {
        showOfflineBanner(state === "disconnected");
    });
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

Das Rebase-Admin-Panel zeigt ein eigenes Banner an, solange der Status `disconnected` ist, und behält die bereits auf dem Bildschirm sichtbaren Zeilen und Datensätze bei, anstatt sie durch einen Fehler zu ersetzen.

## Authentifizierung & RLS

WebSocket-Abonnements beachten automatisch Row-Level Security (RLS)-Richtlinien. Wenn der Client authentifiziert ist:

1. Die WebSocket-Verbindung authentifiziert sich mit demselben JWT-Token wie die REST-API.
2. Jeder Abonnement-Refetch läuft innerhalb einer PostgreSQL-Transaktion mit `set_config('app.user_id', ...)` und `set_config('app.user_roles', ...)` – wodurch sichergestellt wird, dass RLS-Richtlinien durchgesetzt werden.
3. Die Identität wird während der gesamten Lebensdauer des Sockets fortlaufend überprüft, nicht nur beim Verbindungsaufbau. Vor jedem Frame prüft der Server, was auch eine HTTP-Anfrage prüfen würde: Ist das Token noch gültig, wurde die Sitzung abgemeldet oder widerrufen, existiert das Konto noch und welche Rollen besitzt es aktuell. Kanal-Frames werden maximal einmal pro Sekunde geprüft. Frames, die auf einem Socket eintreffen, während dessen Überprüfung noch läuft – etwa ein Client, der seine Abonnements nach einem Reconnect erneut sendet –, teilen sich diese Prüfung, anstatt sie jeweils neu anzustoßen; der nächste Frame nach Abschluss prüft erneut. Ein Socket, der nur lauscht, wird mindestens alle 30 Sekunden überprüft, und ein Token wird in dem Moment ungültig, in dem es abläuft. Der Entzug einer Rolle greift ab dem nächsten Frame (oder bei Frames, die eine laufende Prüfung geteilt haben, ab dem übernächsten) – gleichermaßen für Lese-, Schreibvorgänge und offene Abonnements. Ein Socket, dessen Identität erloschen ist, erhält einen `AUTH_ERROR`-Frame und wird mit dem Code `4001` geschlossen. Bei der integrierten Authentifizierung gibt der Code des Frames den Grund an, analog zu den HTTP-Routen: `SESSION_REVOKED` (abgemeldet, widerrufen oder Konto gelöscht), `ACCOUNT_DISABLED` oder `TOKEN_EXPIRED`; bei einem anderen Auth-Adapter lautet er `SESSION_ENDED`. Ein `AUTHENTICATE` für eine widerrufene Sitzung oder ein deaktiviertes Konto wird mit `SESSION_REVOKED` oder `ACCOUNT_DISABLED` abgelehnt (ein ungültiges oder abgelaufenes Token mit `INVALID_TOKEN`). Das SDK versucht es nicht erneut mit demselben Token und übergibt die Ablehnung samt Fehlercode an das `onError` der Komponente, die das Konto angefordert hat. Das SDK authentifiziert seinen Socket bei jeder Aktualisierung seines Tokens neu; ein neues Token für dieselbe Identität (gleiche Benutzer-ID, Rollen, Guest-Flag und Claims) belässt die offenen Abonnements unverändert, während ein Token für eine andere Identität jedes von ihnen in deren Kontext neu abruft. Nach einem `4001`-Fehler verbindet es sich mit der zu diesem Zeitpunkt gehaltenen Sitzung neu oder ohne Authentifizierung. Ein Client, der das Protokoll direkt anspricht, muss ein frisches Token per `AUTHENTICATE` senden, bevor das alte abläuft.

Dadurch empfängt jeder Socket nur Updates für Datensätze, die seine authentifizierte Identität einsehen darf.

Ein [API-Schlüssel](/docs/backend/api-keys/) authentifiziert den Socket ebenfalls: Senden Sie den `rk_…`-Schlüssel an der Stelle, an die sonst das Access-Token gehört. Der Socket prüft dann jeden Frame gegen die [Scopes](/docs/backend/roles-and-scopes/) des Schlüssels: Ein Abruf, ein Count oder ein Abonnement benötigt `data:read` auf der jeweiligen Tabelle, ein Speichervorgang `data:write`, ein Löschvorgang `data:delete`. Ein verschachtelter Pfad benötigt den einfachen Scope. Kanäle (Broadcast und Presence) werden für API-Schlüssel verweigert, da kein Scope sie abdeckt. Der SQL-Editor und Branch-Nachrichten erfordern `database:read` oder `database:write`, gleichermaßen für Schlüssel wie für Personen.

Der Betrieb von mehr als einer Instanz – der LISTEN/NOTIFY-Bus, das Verhalten von Presence über Prozesse hinweg und das Schreiben eines eigenen Transports – wird auf einer separaten Seite behandelt:
[Realtime über mehrere Instanzen](/docs/backend/realtime-transports/).

## Change Capture auf Datenbankebene (CDC)

Jeder committete Schreibvorgang löst Realtime-Events aus, unabhängig davon, wie er zustande kam: REST, das SDK, Studio, `psql` oder ein Cronjob in einem anderen Dienst. Wie das Change Capture funktioniert, die Einstellung `REALTIME_CDC` und die Voraussetzungen finden Sie unter: [Datenbank-Change-Capture](/docs/backend/realtime-cdc/).

## Timeout für ausstehende Anfragen (Pending Request Timeout)

Um zu verhindern, dass Client-Anfragen unbegrenzt hängen bleiben, besitzen alle ausstehenden WebSocket-Operationen, die eine Serverantwort erwarten (wie einmalige Tabellenabrufe `FETCH_COLLECTION`, Abrufe einzelner Entitäten `FETCH_ONE`, Erstellen/Aktualisieren `SAVE`, Löschungen `DELETE`, Zählungen `COUNT` und Eindeutigkeitsprüfungen `CHECK_UNIQUE_FIELD`), ein Standard-Timeout von 30 Sekunden.

Antwortet der Server nicht innerhalb dieses 30-Sekunden-Fensters, löscht der Client die ausstehende Anfrage automatisch und weist das Promise mit einem `RebaseApiError` zurück, dessen Code `REQUEST_TIMEOUT` lautet.

Einweg-Nachrichten, die keine Antwort erwarten (wie `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` und `channel_history`), werden unmittelbar nach dem Senden aufgelöst und lösen dieses Timeout nicht aus. Ein Abonnement, dessen erster Frame 30 Sekunden nach dem Absenden der Registrierung noch nicht eingetroffen ist, schlägt stattdessen mit `SUBSCRIPTION_TIMEOUT` an seinem `onError` fehl.

### Wenn ein Kanal-Frame abgelehnt wird

Ein Kanal-Frame folgt dem Fire-and-Forget-Prinzip: `await channel.broadcast(...)` wird aufgelöst, sobald der Frame auf den Socket geschrieben wurde, **nicht** erst, wenn der Server ihn akzeptiert hat. Das ist beabsichtigt – eine kollaborative Anwendung sendet eine Cursorposition sechzigmal pro Sekunde, und das Warten auf eine Bestätigung bei jedem Sendevorgang würde jeden einzelnen zu einem Roundtrip machen.

Eine Ablehnung kann daher kein abgewiesenes Promise sein. Sie trifft stattdessen über `onError` ein:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Bedeutung |
|------|-----------|
| `CHANNEL_FORBIDDEN` | Sie sind kein Mitglied des Kanals – treten Sie ihm bei, bevor Sie Nachrichten senden oder seinen Verlauf lesen |
| `RATE_LIMITED` | Das Kanal-Frame-Budget wurde überschritten (7.200 Kanal-Frames pro Minute pro Socket) oder bei einer Verlaufsanfrage das [Daten-Ratenlimit](#was-ein-schreibvorgang-kostet-und-die-limits) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Ein gespeicherter Broadcast konnte nicht persistiert werden und wurde daher verworfen |
| `CHANNEL_HISTORY_READ_FAILED` | Eine Aufhol-Anfrage (Catch-up) konnte nicht bedient werden |
| `CHANNEL_HISTORY_GAP` | Vom Client ausgelöst: Beim Aufholen wurde festgestellt, dass der Server Nachrichten nicht mehr vorhält, die dieser Client nie empfangen hat. `details` enthält `{ from, to }`, die verpassten Sequenznummern. Synchronisieren Sie den Kanalstatus anhand der primären Datenquelle neu |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Der Broadcast hat nur diese Instanz erreicht – siehe [Das 8-KB-Limit auf dem Postgres-Bus](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Ist kein Handler registriert, werden diese Fehler als Warnung protokolliert. Früher wurden sie gänzlich verworfen: Es gab weder ein abzulehnendes Promise noch einen Kanal zur Zustellung, sodass ein unzulässiger Broadcast nicht von einem zugestellten zu unterscheiden war.

## Nächste Schritte

- [Typisiertes SDK](/docs/sdk) — Vollständige SDK-Referenz einschließlich typisierter Tabellen-Accessoren.
- [Authentifizierung](/docs/backend/authentication) — JWT-Authentifizierung und RLS-Richtlinien einrichten.
- [Backend-Architektur](/docs/backend) — Überblick über die Architektur des Rebase-Servers.

---
sourceHash: 8cfa91fb2859caf0
title: Echtzeit & WebSocket
sidebar_label: Echtzeit
description: Echtzeit-Datensynchronisation, Broadcast-Kanäle und Presence-Tracking über WebSocket.
---

Rebase enthält eine integrierte Realtime-Engine, die Datenänderungen über WebSocket an verbundene Clients überträgt.
Wenn ein Datensatz erstellt, aktualisiert oder gelöscht wird, erhält jeder Subscriber, der diese Tabelle oder Entität beobachtet, das Update sofort – kein Polling erforderlich.

## Funktionsweise

Die Realtime-Pipeline besteht aus drei Phasen:

1. **Datenbank-Trigger** – Eine Mutation trifft auf die PostgreSQL-Datenbank (über REST-API, SDK oder Studio).
2. **Server-Fan-Out** – Der Rebase-Server erkennt die Änderung und verteilt sie per Fan-out an jedes aktive WebSocket-Abonnement, das mit der betroffenen Tabelle oder Entität übereinstimmt.
3. **Client-Callback** – Das typisierte SDK löst Ihren `onUpdate`-Callback mit den aktuellen Daten aus.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Für Multi-Instanz-Deployments nutzt Rebase das `LISTEN/NOTIFY` von PostgreSQL, um Änderungen über Server-Instanzen hinweg zu übertragen. Dies geschieht automatisch. Wenn [database-level change capture](/docs/backend/realtime-cdc/) aktiviert ist (die Standardeinstellung überall dort, wo die Datenbankrolle Trigger erstellen kann), lauscht jede Instanz auf dem `rebase_cdc`-Kanal, auf dem die Capture-Trigger veröffentlichen, sodass ein Schreibvorgang unabhängig vom verursachenden Prozess oder Werkzeug wahrgenommen wird. Ohne Change Capture kündigt jede Instanz ihre eigenen Schreibvorgänge auf dem Kanal `rebase_entity_changes` an, und eine dedizierte Verbindung auf jeder anderen Instanz leitet sie an ihre lokalen Subscriber weiter.

### Zero-Configuration

Realtime ist standardmäßig aktiviert. Es muss kein Flag gesetzt oder ein Dienst gestartet werden – wenn Ihr Rebase-Server läuft, ist der WebSocket-Endpunkt verfügbar.

### Auf welchem Pfad der Socket antwortet

Der Socket beantwortet Upgrades auf einem Pfad: dem Basispfad der API, bei dem ein nachgestelltes `/api` entfernt wurde, also `/` für eine API unter `/api`. Genau dorthin verbindet sich das SDK: Es verbindet sich mit seiner `baseUrl`, während seine HTTP-Anfragen an `${baseUrl}/api` gehen. Ein Upgrade auf einen beliebigen anderen Pfad wird den anderen `upgrade`-Listenern des Servers überlassen, sodass Ihre App ihren eigenen WebSocket-Server auf demselben `http.Server` betreiben kann. Ohne einen weiteren Listener wird ein solches Upgrade mit `404` beantwortet.

In einem [custom server](/docs/backend/custom-server/) legt `backend.attachRealtime(server, { path })` den Pfad fest, und `realtime.path` des Postgres-Adapters überschreibt das, was der Server abgeleitet hat.

> Standardmäßig gibt Rebase auch Realtime-Events für Schreibvorgänge aus, die **außerhalb** der API getätigt wurden (über `psql`, einen anderen Dienst oder den SQL-Editor von Studio), sofern die Datenbankverbindung dies unterstützt – siehe [database-level change capture](/docs/backend/realtime-cdc/).

## Typisierte SDK-Abonnements

Das typisierte SDK von Rebase stellt zwei Abonnement-Methoden für jeden Tabellen-Accessor bereit:

- **`listen()`** – Eine gesamte Tabelle abonnieren (mit optionalen Filtern).
- **`listenById()`** – Eine einzelne Entität anhand ihrer ID abonnieren.

Beide Methoden geben eine **Unsubscribe-Funktion** zurück, die Sie aufrufen können, um den Empfang von Updates zu beenden.

### Eine Tabelle abonnieren

Verwenden Sie `listen()`, um Updates zu erhalten, sobald sich Datensätze in einer Tabelle ändern:

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

Der Callback erhält ein `FindResult<M>`, das Folgendes enthält:
- `data` – Die Zeilen, flach, wie `find()` sie zurückgibt (`row.name`, nicht `row.values.name`).
- `meta` – Paginierungsinformationen (`total`, `limit`, `offset`, `hasMore`).

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

Verwenden Sie `listenById()`, um einen bestimmten Datensatz zu beobachten:

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

Der Callback erhält die Zeile, flach, wie `findById()` sie zurückgibt (`row.name`, nicht `row.values.name`), oder `undefined`, sobald die Zeile gelöscht wird.

**Jeder Frame enthält die Version der Zeile.** `etagOf(row)` ist das `ETag`, das ein `GET` der Zeile zurückgibt, sodass eine Bearbeitung auf Basis des in einem Frame angezeigten Stands mit `ifMatch: etagOf(row)` gespeichert werden kann und mit `412` abgelehnt wird, falls sich die Zeile inzwischen geändert hat (siehe [Conditional writes](/docs/backend/writes/)). Über das Netzwerk fordert das SDK mit `subscribe_one` per `etag: true` an, und jeder `single_update`-Frame für eine existierende Zeile enthält `"etag"` neben `"row"`. Ein älterer Server ignoriert diese Anfrage und sendet kein Tag, und ein Client, der nicht danach fragt, erhält Frames ohne Tag.

### Abonnements beenden

Sowohl `listen()` als auch `listenById()` geben eine Unsubscribe-Funktion zurück. Rufen Sie diese auf, um keine Updates mehr zu erhalten und serverseitige Ressourcen freizugeben:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Rufen Sie die Unsubscribe-Funktion immer auf, wenn eine Komponente ungemountet wird oder die Seite navigiert wird. Dies verhindert Speicherlecks und unnötige serverseitige Berechnungen.
:::

## Query Builder `.listen()`

Der flüssige (fluent) Query Builder unterstützt ebenfalls Realtime-Abonnements. Verketten Sie Ihre Filter und rufen Sie anschließend `.listen()` anstelle von `.find()` auf:

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
`.listen()` – sowohl auf dem Query Builder als auch auf dem Tabellen-Accessor – benötigt den WebSocket des Clients. Der Client leitet seine URL von `baseUrl` ab, sofern keine `websocketUrl` angegeben ist. Bei einem Client, der mit `realtime: false` erstellt wurde, oder bei einem, der keine URL ableiten konnte, löst der Aufruf von `.listen()` einen Fehler aus.
:::

## Update-Zustellung: Instant-Patch + Korrektheits-Refetch

Eine Änderung wird niemals direkt als Datensatz an einen Subscriber übertragen. Sie wird als die Tatsache übertragen, dass sich etwas geändert hat, und jedem Subscriber wird anschließend über eine in seinem Namen ausgeführte Abfrage mitgeteilt, was *er* sehen darf:

1. **Invalidierung.** Wenn sich eine Entität ändert (erstellt, aktualisiert, gelöscht), markiert der Server die betroffenen Pfade. Die geschriebene Zeile wird nicht weitergeleitet – sie wurde unter der Autorisierung des Schreibers gelesen, was nichts darüber aussagt, was ein Subscriber sehen darf.

2. **Debounced RLS-Refetch.** Nach **300ms** (`REFETCH_DEBOUNCE_MS`) ruft der Server die Tabelle mit Ihren ursprünglichen Filtern und der Sortierreihenfolge erneut ab. Die Abfrage wird innerhalb einer Transaktion ausgeführt, die die transaktionslokalen Variablen `app.user_id` und `app.user_roles` aus dem `SubscriptionAuthContext` des Subscribers setzt. So wertet Postgres die Row-Level Security unter der Identität dieses Clients aus, und nur die Zeilen, zu deren Ansicht er berechtigt ist, werden im `collection_update` gesendet. Das Debouncing fasst zudem eine Serie rascher Schreibvorgänge in einer einzigen Abfrage zusammen. Es wartet 300 ms lang auf das Ausbleiben weiterer Änderungen, jedoch nie länger als **1 s** (`REFETCH_MAX_WAIT_MS`) nach der ersten Änderung. So sendet eine Tabelle, in die mehrmals pro Sekunde geschrieben wird, ihren Subscribern dennoch mindestens einmal pro Sekunde einen Frame. Legen Sie diesen Grenzwert mit `REALTIME_REFETCH_MAX_WAIT_MS` (oder `realtime.refetchMaxWaitMs`) fest: Ein höherer Wert führt seltener zu Refetches einer stark ausgelasteten Tabelle, ein niedrigerer Wert sendet aktuellere Frames.

   Ein Refetch, der genau das liest, was einem Subscriber zuletzt gesendet wurde, sendet diesem Subscriber nichts: Ein Schreibvorgang in Zeile 9.000 einer Liste, die die ersten 50 anzeigt, kostet lediglich den Lesevorgang, aber keinen Frame an jeden Betrachter. Nach einem Fehler-Frame werden die nächsten Zeilen erneut gesendet, selbst wenn sie identisch sind.

Frühere Versionen sendeten vor diesem Refetch einen sofortigen `collection_patch`, der die geschriebene Zeile enthielt, um ein seitenübergreifendes Feedback im Sub-Millisekunden-Bereich zu ermöglichen. Diese Zeile war jedoch unter dem Berechtigungsumfang des Schreibers gelesen worden, sodass sie Subscriber erreichen konnte – und erreichte –, deren eigene Richtlinien dies verwehrt hätten; auch der eigene `where`-Filter des Abonnements wurde darauf nicht angewendet. Dieser Patch wurde entfernt: Die gefühlte Latenz für ein Update entspricht nun dem Debounce-Zeitfenster.

### Der Refetch entspricht dem REST-Lesevorgang

Der Refetch durchläuft dieselbe Pipeline wie `GET /api/data/<collection>`, mit derselben Handhabung von `include`. Dadurch geben `find({ q })` und `listen({ q })` Zeilen zurück, die Feld für Feld identisch sind.

Früher war dies eine andere Methode – eine, die jede Relation in eine `{ "__type": "relation" }`-Hülle verschachtelte und, da ein Abonnement kein `include` enthalten konnte, **jede** von der Tabelle deklarierte Relation per Eager Loading lud. Dadurch antwortete dieselbe Abfrage über HTTP in einer Struktur und über den Socket in einer anderen, und ein Client, der beides renderte, sah, wie sich die Struktur der Zeilen in dem Moment änderte, in dem ein Schreibvorgang eintraf.

Ein Subscribe-Frame akzeptiert daher dieselben Parameter wie eine Listenanfrage: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` und `fields`. `vectorSearch` ist die Ausnahme und wird mit `VECTOR_SEARCH_NOT_LIVE` **abgelehnt** – ein Abonnement wird bei jedem passenden Schreibvorgang erneut ausgeführt, und dort werden keine Distanzen berechnet.

### `collection_update` enthält eigene Metadaten

Der Frame hat die Struktur `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` wird innerhalb derselben RLS-gebundenen Transaktion gezählt, die auch die Zeilen gelesen hat, sodass es exakt die danebenliegenden Zeilen beschreibt. Ohne diese Angabe musste ein Client, der eine Gesamtzahl benötigte, einen `GET /count` **pro Push** ausführen – ein zusätzlicher Roundtrip pro Schreibvorgang und Subscriber sowie ein Zeitfenster, in dem die Anzahl und die Zeilen unterschiedliche Zustände der Tabelle beschrieben.

Wenn die Zählung selbst fehlschlägt, enthält der Frame `partial: true` und kein `total`; dies ist kein Abonnementfehler, und ein Client sollte den letzten echten Gesamtwert beibehalten, anstatt die Seitenlänge einzusetzen. Bei einer großen Tabelle macht die Zählung den Großteil der Kosten eines Frames aus. Wenn `REALTIME_RECOUNT_INTERVAL_MS` gesetzt ist, verwendet eine Liste, deren letzte Gesamtzahl mindestens `REALTIME_RECOUNT_MIN_ROWS` (standardmäßig 100.000) betrug, diesen Gesamtwert für das Intervall wieder, anstatt bei jedem Schreibvorgang neu zu zählen; ein solcher Frame enthält dann `meta.totalAsOf` mit dem Zeitpunkt der Zählung. Nach Ablauf des Intervalls wird eine Liste, deren letzter Frame die Gesamtzahl wiederverwendet hat, erneut gezählt und erhält die neue Gesamtzahl, unabhängig davon, ob seitdem etwas geschrieben wurde. Ist der Wert nicht gesetzt (Standardeinstellung), zählt jeder Frame.

### Was ein Schreibvorgang kostet, und die Limits

Da jeder Frame eine Abfrage ist, die als der jeweilige Subscriber ausgeführt wird, steigen die Kosten eines Schreibvorgangs mit der Anzahl der **unterschiedlichen Fragen, die von unterschiedlichen Prinzipalen** an die betroffene Tabelle gestellt werden – nicht mit der Anzahl der offenen Sockets:

- Abonnements, die dieselbe Frage (gleicher Pfad, Filter, Sortierung, Seite, `include`, `fields`, Suche) als derselbe Prinzipal (gleiche Benutzer-ID, Rollen, Gast-Flag und Claims) stellen, teilen sich einen Refetch. Ein Schreibvorgang in eine Liste kostet **eine Transaktion pro solcher Gruppe** – den Lesevorgang und seine Zählung –, egal wie viele Sockets sie halten; jedes Mitglied erhält dennoch einen Frame, der aus den unter dieser Identität gelesenen Zeilen erstellt wurde. Eine erste Seite, die kürzer als ihr `limit` zurückkommt, umfasst die gesamte Menge und wird daher überhaupt nicht gezählt.
- Ein Einzeldatensatz-Abonnement wird nur abgefragt, wenn sich sein eigener Datensatz ändert.
- Unterschiedliche Prinzipale teilen sich niemals einen Lesevorgang – das verhindert, dass ein Frame eine Zeile enthält, die sein Leser nicht sehen darf. Eine Liste, die von tausend verschiedenen angemeldeten Benutzern beobachtet wird, bedeutet tausend Lesevorgänge und tausend Zählungen bei jedem Schreibvorgang darauf, in tausend Transaktionen.

Gemessen auf einem Laptop gegen ein lokales PostgreSQL mit einem Pool von 20 Verbindungen, ein Schreibvorgang in eine Liste:

| Subscriber | Transaktionen für den Schreibvorgang | Letzter Frame nach dem Schreibvorgang |
|-------------|----------------------------|----------------------------|
| 1.000, ein Prinzipal | 2 | ~310 ms |
| 1.000, jeweils ein anderer Prinzipal | ~1.000 | ~600 ms |

Jeweils 300 ms davon entfallen auf das Debouncing. Die zweite Zeile ist die Obergrenze, mit der geplant werden sollte. Die Refetches laufen über denselben Pool wie Ihr REST-Traffic, belegen jedoch jeweils höchstens ein Viertel seiner Verbindungen (5 der standardmäßigen 20, nie weniger als 2); der Rest wartet im Server, bis er an der Reihe ist, sodass das Fan-out eines Schreibvorgangs eher seine eigenen Frames verzögert als Ihre Anfragen. Eine Tabelle, in die mehrmals pro Sekunde geschrieben wird, während **Hunderte verschiedener Benutzer** dieselbe Liste beobachten, ist der Punkt, an dem diese Frames anfangen zu verzögern. Darüber hinaus sollten engere Abonnements (eine Seite, ein Filter auf die eigenen Zeilen des Benutzers) oder ein [Broadcast-Kanal](#broadcast-kanäle) bevorzugt werden, der die Änderung überträgt, damit Clients den Abruf nach ihrem eigenen Zeitplan durchführen können.

**Ein Socket darf höchstens 1.000 Abonnements halten.** Das nächste wird mit einem Fehler-Frame mit dem Code `TOO_MANY_SUBSCRIPTIONS` abgelehnt; ein erneutes Abonnieren unter einer ID, die der Socket bereits hält, ersetzt dieses Abonnement und zählt nicht erneut. Das SDK teilt identische Abonnements auf einem Socket, sodass dies die unterschiedlichen Listen und Datensätze zählt, die eine Seite geöffnet hat. Ändern Sie dies mit `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` oder `realtime.maxSubscriptionsPerSocket` am Postgres-Adapter (die Umgebungsvariable hat Vorrang); ein Wert, der keine positive ganze Zahl ist, stoppt den Server beim Start. **Die Sockets, die ein Benutzer hält, können ebenfalls begrenzt werden**, pro Server-Instanz: Setzen Sie `REALTIME_MAX_SOCKETS_PER_USER` (oder `realtime.maxSocketsPerUser`), und eine Anmeldung darüber hinaus wird mit `TOO_MANY_SOCKETS` abgelehnt und der Socket mit 4002 geschlossen. Sockets, die mit einem API-Schlüssel angemeldet sind, zählen für diesen Schlüssel – jeder Schlüssel für sich –, nicht für das Konto, das ihn erstellt hat; der Service-Schlüssel ist ein einzelnes Credential, sodass alle seine Sockets zusammengezählt werden. Die Sockets eines Administrators, der die Identität eines Benutzers annimmt (Impersonation), zählen für den Administrator mit dessen eigenen Sockets, nicht für den Benutzer, als der er agiert. Das SDK benachrichtigt jedes aktive Abonnement und `onConnectionLost` sofort mit einem `CONNECTION_LOST`-Fehler, dessen `details.reason` `TOO_MANY_SOCKETS` ist, und unternimmt wiederholte Versuche mit jeweils längeren Wartezeiten von bis zu 30 s, sodass der Tab eine Verbindung erhält, sobald ein anderer Socket schließt. Wenn nicht gesetzt (Standardeinstellung), gibt es keine Obergrenze.

Eine Abonnement-ID gehört ausschließlich dem jeweiligen Socket: Zwei Clients, die beide ein Abonnement `"sub-1"` nennen, behalten jeweils ihres, und ein `unsubscribe` beendet nur das des Senders.

**Das Abonnieren zählt gegen das Daten-Ratenlimit.** Der erste Frame eines Abonnements ist ein Lesevorgang, der als der Subscriber ausgeführt wird, ebenso wie die Verlaufsanfrage eines Kanals. Daher zählen `subscribe_collection`, `subscribe_one` und `channel_history` als Datenanfragen im Rate-Limit-Bucket des Aufrufers (den sich seine HTTP-Anfragen und seine anderen Sockets teilen), sobald das eigene Kontingent des Sockets aufgebraucht ist. Jeder Socket darf 1.000 davon senden, ohne dass sie gezählt werden, oder so viele wie seine Abonnement-Obergrenze, wenn diese höher ist, und das Kontingent regeneriert sich über einen Zeitraum von 15 Minuten. Das entspricht allem, was ein Socket halten kann, sodass das erneute Abonnieren nach einem Reconnect niemals abgelehnt wird und niemals das Kontingent des Nutzers beansprucht. Nach Überschreiten des Kontingents wird ein Frame über dem Limit mit einem Fehler-Frame mit dem Code `RATE_LIMITED` abgelehnt, den das SDK an das `onError` dieses Abonnements oder an das des Kanals weiterleitet.

### Sockets, die nicht mehr antworten

Ein Client kann verschwinden, ohne seinen Socket ordnungsgemäß zu schließen: Ein Smartphone verliert das Signal, ein Laptop wechselt in den Ruhezustand, ein NAT vergisst die Verbindung. Es trifft kein Close-Frame ein, sodass der Server nicht benachrichtigt wird. Der Server pingt daher jeden Socket alle 30 Sekunden an und beendet Sockets, die bis zum nächsten Ping nicht geantwortet haben, sodass ein verschwundener Client innerhalb einer Minute freigegeben wird. Browser und das SDK beantworten Pings automatisch; ein Client, der direkt über das Protokoll kommuniziert, muss sie ebenfalls beantworten, wie es die meisten WebSocket-Bibliotheken tun.

**Die Browser-Seite.** Ein Browser kann keinen Ping senden oder sehen, sodass ein halboffener Socket für ihn dauerhaft verbunden erscheint. Das SDK öffnet den Socket mit `?rebase_caps=heartbeat,channel_seq,cancel_sql`; ein Server, der diese unterstützt, antwortet mit `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listet die von ihm unterstützten Fähigkeiten auf (`cancel_sql`: er akzeptiert den `CANCEL_SQL`-Frame der SQL-Konsole) und sendet alle 30 Sekunden `{"type":"heartbeat"}`. Das SDK trennt den Socket und führt nach zwei verpassten Heartbeats einen [Re-Connect](#automatische-wiederverbindung-auto-reconnect) durch. Einem Client, der keine Capabilities angibt, wird keines von beidem gesendet, und ein älterer Server ignoriert den Parameter, sodass sich ein SDK bei der Kommunikation mit einem solchen wie bisher verhält.

Ein Socket wird ebenfalls beendet, wenn mehr als 16&nbsp;MiB an an ihn gesendeten Frames noch ungelesen sind. Das betrifft Clients, die die empfangenen Daten nicht lesen, oder solche, die so weit zurückliegen, dass das Gelesene veraltet wäre. Und wenn die Sockets eines Servers zusammen mehr als 256&nbsp;MiB ungelesene Daten halten (oder ein Viertel des Speicherlimits, unter dem der Server läuft, falls dieser Wert kleiner ist), werden die Sockets mit den meisten ungelesenen Daten zuerst beendet, bis der Rest wieder hineinpasst.

Ein beendeter Socket wird wie ein regulär geschlossener aufgeräumt. Seine Abonnements enden, er verlässt seine Kanäle und seine Presence wird entfernt, wobei das Verlassen den anderen Mitgliedern mitgeteilt wird. Ein Client, der noch da ist, registriert den Verbindungsabbruch, woraufhin das SDK die [Verbindung wiederherstellt](#automatische-wiederverbindung-auto-reconnect) und die Abonnements erneut anmeldet.

## Broadcast-Kanäle

Broadcast-Kanäle ermöglichen es Clients, beliebige Nachrichten in Echtzeit untereinander auszutauschen – nützlich für Funktionen wie Tipp-Indikatoren, Cursor-Positionen oder benutzerdefinierte Benachrichtigungen.

Broadcast wird auf der WebSocket-Protokollebene verwaltet. Der Server unterstützt folgende Nachrichtentypen:

| Nachrichtentyp     | Richtung       | Beschreibung                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Einem benannten Kanal beitreten                     |
| `leave_channel`   | Client → Server | Einen Kanal verlassen                          |
| `broadcast`       | Client → Server | Eine Nachricht an alle Kanalmitglieder senden    |
| `broadcast`       | Server → Client | Eine Nachricht von einem anderen Mitglied empfangen    |
| `channel_history` | Client → Server | Gespeicherte Nachrichten nach einer Sequenz anfordern |
| `channel_history` | Server → Client | Die gespeicherten Nachrichten, die ein Client verpasst hat    |

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

## Channel Retention

Standardmäßig erreicht ein Broadcast die aktuell verbundenen Mitglieder und verfällt danach. Das ist der richtige Kompromiss für Benachrichtigungen und Cursor und verursacht keine Kosten.

Für einen Operations-Stream – kollaboratives Bearbeiten oder alles, bei dem eine unbemerkte Lücke zu Divergenzen führt – kann ein Kanal so konfiguriert werden, dass er seine Nachrichten **beibehält (retain)**. Gespeicherte Broadcasts erhalten eine kanalspezifische Sequenznummer und werden persistiert, sodass ein wiederverbundener Client alles anfordern kann, was nach der letzten von ihm gesehenen Nachricht eingegangen ist.

:::caution[Wo dies konfiguriert wird]
**Managed Runtime: Nirgends.** Kanal-Retention und `realtime.bus` sind Teil des
Datenbankadapters, den die Managed Runtime selbst erstellt, und keines von beiden hat
eine Form als Umgebungsvariable. Führen Sie einen Eject durch, um sie zu konfigurieren.
**Ejected:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
:::

Retention ist optional (opt-in) und wird hier auf dem Server konfiguriert:

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

| Feld   | Beschreibung                                                                 |
|---------|-----------------------------------------------------------------------------|
| `match` | Exakter Kanalname (`"doc:42"`) oder ein Präfix mit abschließendem `*` (`"doc:*"`)        |
| `limit` | Maximal so viele der neuesten Nachrichten pro Kanal behalten               |
| `ttl`   | Nachrichten maximal so lange aufbewahren – `"30s"`, `"15m"`, `"24h"`, `"7d"` oder Millisekunden |

Eine Regel benötigt mindestens `limit` oder `ttl`. Eine Regel mit keinem von beiden wird ignoriert und protokolliert, da eine unbegrenzte Aufbewahrung fast nie beabsichtigt ist und nach dem Anwachsen der Tabelle nicht mehr rückgängig gemacht werden kann.

:::note[Warum können Clients den Verlauf nicht selbst anfordern?]
Ein Kanal wird von demjenigen erstellt, der ihn benennt. Wenn ein Client seine eigene Verlaufstiefe bestimmen könnte, könnte jeder Besucher Ihr Backend zu unbegrenztem Speicherplatz zwingen. Die Konfiguration an dieser Stelle sorgt zudem dafür, dass Presence- und Benachrichtigungskanäle – die überwältigende Mehrheit – nichts kosten: Ohne konfigurierte Regeln wird keine Tabelle erstellt, und Broadcast läuft über denselben synchronen Pfad wie zuvor.
:::

### Speicherung

Gespeicherte Kanäle verwenden zwei Tabellen im Schema `rebase`, die beim Start automatisch angelegt werden, wenn mindestens eine Regel konfiguriert ist:

| Tabelle                     | Inhalt                                                        |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | Die gespeicherten Nachrichten, indexiert über `(channel, seq)`                 |
| `rebase.channel_cursors`  | Die höchste pro Kanal vergebene Sequenznummer                          |

Das Bereinigen (Pruning) erfolgt beim Eintreffen von Nachrichten, gedrosselt pro Kanal, sodass die Kosten eher mit der verstrichenen Zeit als mit dem Schreibvolumen skalieren. Dabei werden stets nur Zeilen aus `channel_messages` entfernt – Cursor werden unbegrenzt aufbewahrt (sie bestehen aus einer kleinen Zeile pro Kanal), da ein Neustart der Sequenz eines Kanals die Bedeutung des gespeicherten Wiederaufnahmepunkts eines Clients verändern würde.

### Zustellgarantien

- **Geordnet.** Sequenznummern werden pro Kanal vergeben, und die Zustellreihenfolge entspricht der Sequenzreihenfolge – auf einer einzelnen Instanz sowie über Instanzen hinweg auf dem `postgres`-Bus, bei dem die Anweisung, die eine Nachricht nummeriert, diese auch ankündigt, sodass jede Instanz (einschließlich der des Senders) die Ankündigungen in Sequenzreihenfolge empfängt. Ein selbst bereitgestellter Bus überträgt Frames in der Reihenfolge, in der er sie zustellt.
- **Dauerhaft vor der Zustellung (Durable before delivered).** Eine Nachricht, die nicht gespeichert werden kann, wird an niemanden zugestellt, und der Absender wird darüber informiert. Eine Zustellung würde sie aktiven Subscribern anzeigen, sie jedoch von jedem zukünftigen Replay ausschließen, und keine spätere Nachricht könnte diese Lücke schließen.
- **At-least-once beim Aufholen.** Ein Replay-Bereich kann sich mit Nachrichten überschneiden, die ein Client bereits empfangen hat; das SDK verwirft bereits zugestellte Nachrichten.
- **Keine Lücken.** Eine gespeicherte Nachricht erreicht jedes Mitglied: Dem Absender, dem seine eigene Nachricht nie zugestellt wird, wird stattdessen `{"type":"broadcast_ack","channel","seq"}` gesendet, wenn er `channel_seq` aktiviert hat. Eine Nachricht nach `lastSeq + 1` bedeutet daher, dass eine Nachricht verpasst wurde; das SDK hält sie zurück, fragt den dazwischenliegenden Verlauf an und stellt alle der Reihe nach zu. Bei einem Server ohne `channel_seq` wird ein Sprung so zugestellt, wie er eintrifft.

:::caution[Der Verlauf hat dasselbe Zugriffsmodell wie der Kanal]
Ein Client, der einem Kanal beigetreten ist, kann dessen gespeicherte Nachrichten erneut abspielen, einschließlich jener, die vor seinem Beitritt gesendet wurden – die Mitgliedschaft ist die einzige Prüfung, und der Beitritt steht jedem Client offen, der den Namen des Kanals kennt. Da die Aufbewahrung optional pro Kanalmuster aktiviert wird, macht ihre Aktivierung die Historie dieses Kanals für jeden Besucher lesbar, der den Namen errät. Bei gespeicherten Kanälen wird dies von einem flüchtigen zu einem dauerhaften Zustand; behandeln Sie die Inhalte eines aufbewahrten Kanals daher als öffentlich für Ihre Benutzer.
:::

## Presence Tracking

Presence verfolgt, welche Benutzer aktuell in einem Kanal online sind, und ermöglicht es jedem Benutzer, einen benutzerdefinierten Zustand (z. B. Cursor-Position, Status) zu teilen.

| Nachrichtentyp       | Richtung       | Beschreibung                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Presence-Tracking mit benutzerdefiniertem Zustand starten            |
| `presence_untrack`| Client → Server | Presence-Tracking beenden                               |
| `presence_state`  | Client → Server | Den vollständigen Presence-Status für einen Kanal anfordern        |
| `presence_state`  | Server → Client | Alle Presences im Kanal, vollständig               |
| `presence_diff`   | Server → Client | Inkrementelles Update (Beitritte und Austritte)                |

Wenn ein Client `presence_track` sendet, lässt der Server ihn dem Kanal automatisch beitreten (kein separates `join_channel` erforderlich) und sendet ein `presence_diff` an alle Kanalmitglieder. Das SDK sendet seinen Zustand etwa alle 20 Sekunden als Heartbeat erneut; ein Heartbeat mit unverändertem Zustand aktualisiert lediglich den Timeout des Clients und sendet kein `presence_diff`.

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

Das typisierte SDK stellt die Verbindung automatisch wieder her, wenn die WebSocket-Verbindung abbricht:

- **Exponentieller Backoff** – Jeder Neuverbindungsversuch wartet ein Intervall ab, das bei 2 Sekunden beginnt und sich jedes Mal verdoppelt, bis zu maximal 30 Sekunden. Die Verzögerung wird zufällig aus dem jeweiligen Intervall gewählt, beträgt jedoch nie weniger als eine Viertelsekunde, sodass Clients, die durch ein Deployment gleichzeitig getrennt wurden, über das gesamte Intervall verteilt zurückkehren und nicht im selben Moment.
- **Kein Aufgeben, solange Ressourcen aktiv sind** – Solange ein Abonnement oder ein beigetretener Kanal existiert, versucht der Client für die Dauer des Ausfalls weiterhin im 30-Sekunden-Intervall eine Verbindung aufzubauen. Wenn nichts registriert ist, bricht er nach 5 fehlgeschlagenen Versuchen ab, und das nächste Abonnement stößt die Verbindung erneut an. In einem Browser lösen sowohl das `online`-Event als auch das Wieder-Sichtbarwerden des Tabs sofort einen erneuten Verbindungsversuch aus, anstatt den Backoff abzuwarten.
- **Ausfälle werden einmalig gemeldet** – Wenn die Verbindung 14 Sekunden lang unterbrochen war – unabhängig davon, wie viele Versuche unternommen wurden –, erhält das `onError` jedes aktiven Abonnements und jedes beigetretenen Kanals genau einen `RebaseApiError` mit dem Code `CONNECTION_LOST`. Das Abonnement **bleibt bestehen**: Der Fehler besagt, dass seine Daten nicht aktualisiert werden, nicht, dass es beendet wurde.
- **Automatische Neuanmeldung (Resubscription)** – Nach erfolgreicher Wiederverbindung werden alle aktiven Abonnements erneut beim Server registriert, und das nächste `onUpdate` jedes Abonnements liefert den Stand aller Änderungen, die während der Abwesenheit des Clients geschrieben wurden. Dieses Update dient als Signal für die Wiederherstellung. Kein manuelles Eingreifen erforderlich.
- **Anfragen werden höchstens einmal ausgeführt (At-most-once)** – Eine Anfrage, die gestellt wird, während der Socket getrennt ist, wartet darauf – bis zu 30 Sekunden ab dem Aufruf – und schlägt dann mit `REQUEST_TIMEOUT` fehl, ohne jemals gesendet worden zu sein. Eine Anfrage, die bereits gesendet wurde, als die Verbindung abbrach, schlägt mit `CONNECTION_LOST` fehl und wird **nicht** erneut gesendet: Der Server könnte sie bereits ausgeführt haben oder auch nicht, und nur der Aufrufer weiß, ob eine doppelte Ausführung sicher ist.

`client.ws.state` gibt den aktuellen Status der Verbindung an, und `onStateChange` wird über jede Änderung informiert:

| Status | Bedeutung |
|---|---|
| `idle` | Kein Socket vorhanden und bisher keiner benötigt (die Verbindung wird verzögert/lazy aufgebaut) oder durch Abmeldung geschlossen. |
| `connecting` | Verbindungsaufbau läuft, kein anhaltender Ausfall. |
| `connected` | Der Socket ist geöffnet. |
| `reconnecting` | Die Socket-Verbindung ist abgebrochen und der Client versucht erneut zu verbinden. Es wurde bisher nichts gemeldet. |
| `disconnected` | Der Ausfall dauert 14 Sekunden oder länger an. `CONNECTION_LOST` wurde gemeldet, und der Client versucht weiterhin, die Verbindung wiederherzustellen. |
| `closed` | `client.close()` wurde aufgerufen. Endgültig. |

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
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

Die Rebase-Adminoberfläche zeigt ein eigenes Banner an, solange der Status `disconnected` ist, und behält die bereits auf dem Bildschirm sichtbaren Zeilen und Datensätze bei, anstatt sie durch eine Fehlermeldung zu ersetzen.

## Authentifizierung & RLS

WebSocket-Abonnements berücksichtigen automatisch die Richtlinien der Row-Level Security (RLS). Wenn der Client authentifiziert ist:

1. Die WebSocket-Verbindung authentifiziert sich mit demselben JWT-Token wie die REST-API.
2. Jeder Refetch eines Abonnements läuft innerhalb einer PostgreSQL-Transaktion mit `set_config('app.user_id', ...)` und `set_config('app.user_roles', ...)`, wodurch die Durchsetzung der RLS-Richtlinien gewährleistet ist.
3. Die Identität wird für die gesamte Dauer der Socket-Öffnung kontinuierlich überprüft, nicht nur beim anfänglichen Authentifizieren. Vor jedem Frame prüft der Server analog zu einer HTTP-Anfrage: Ist das Token noch gültig, wurde die Sitzung abgemeldet oder widerrufen, existiert das Konto noch und welche Rollen besitzt es aktuell? Kanal-Frames werden maximal einmal pro Sekunde geprüft. Frames, die auf einem Socket eintreffen, während dessen Überprüfung noch läuft – etwa ein Client, der seine Abonnements nach einem Reconnect erneut sendet –, teilen sich diese Prüfung, anstatt sie jeweils neu anzustoßen; der nächste Frame nach Abschluss der Prüfung stößt eine neue an. Ein Socket, der nur lauscht, wird mindestens alle 30 Sekunden überprüft, und ein Token wird in dem Moment nicht mehr akzeptiert, in dem es abläuft. Eine entzogene Rolle greift ab dem nächsten Frame (oder bei einem Frame, der eine bereits laufende Prüfung geteilt hat, ab dem übernächsten) – gleichermaßen für Lese-, Schreib- und offene Abonnement-Operationen. Ein Socket, dessen Identität beendet wurde, empfängt einen `AUTH_ERROR`-Frame und wird mit dem Code `4001` geschlossen. Bei der integrierten Authentifizierung gibt der Code des Frames den Grund an, genau wie bei den HTTP-Routen: `SESSION_REVOKED` (abgemeldet, widerrufen oder Konto gelöscht), `ACCOUNT_DISABLED` oder `TOKEN_EXPIRED`; bei einem anderen Auth-Adapter lautet er `SESSION_ENDED`. Ein `AUTHENTICATE` für eine widerrufene Sitzung oder ein deaktiviertes Konto wird mit `SESSION_REVOKED` oder `ACCOUNT_DISABLED` abgelehnt (ein Token, das sich nicht verifizieren lässt oder abgelaufen ist, mit `INVALID_TOKEN`). Das SDK versucht es nicht erneut mit demselben Token und leitet die Ablehnung samt Fehlercode an das `onError` der jeweiligen Komponente weiter, die das Konto benötigte. Das SDK authentifiziert seinen Socket bei jeder Token-Aktualisierung erneut; ein neues Token für dieselbe Identität (gleiche Benutzer-ID, Rollen, Gast-Flag und Claims) belässt die offenen Abonnements unverändert, während ein Token für eine andere Identität für jedes Abonnement einen Refetch unter dieser neuen Identität auslöst. Nach einem `4001`-Fehler verbindet es sich mit der zu diesem Zeitpunkt vorliegenden Sitzung erneut oder ganz ohne Sitzung. Ein Client, der direkt über das Protokoll kommuniziert, muss vor Ablauf des alten Tokens ein neues Token mittels `AUTHENTICATE` übermitteln.

Das bedeutet, dass jeder Socket nur Updates für Datensätze erhält, die seine authentifizierte Identität sehen darf.

Ein [API-Schlüssel](/docs/backend/api-keys/) authentifiziert den Socket ebenfalls: Senden Sie den `rk_…`-Schlüssel anstelle des Access-Tokens. Der Socket prüft dann jeden Frame gegen die [Bereiche (Scopes)](/docs/backend/roles-and-scopes/) des Schlüssels: Ein Abruf (Fetch), eine Zählung (Count) oder ein Abonnement erfordert `data:read` auf der jeweiligen Tabelle, ein Speichervorgang `data:write`, ein Löschvorgang `data:delete`. Ein verschachtelter Pfad benötigt den einfachen Scope. Kanäle (Broadcast und Presence) werden für einen API-Schlüssel abgelehnt, da kein Scope diese abdeckt. Der SQL-Editor und Branch-Nachrichten erfordern `database:read` oder `database:write`, gleichermaßen für Schlüssel wie für Personen.

Der Betrieb mehrerer Instanzen – der LISTEN/NOTIFY-Bus, wie sich Presence über Prozesse hinweg verhält und das Erstellen eines eigenen Transports – wird auf einer separaten Seite beschrieben: [Realtime across instances](/docs/backend/realtime-transports/).

## Change Capture auf Datenbankebene (CDC)

Jeder committete Schreibvorgang löst Realtime-Events aus, unabhängig davon, wie er ausgeführt wurde: per REST, über das SDK, in Studio, via `psql` oder durch einen Cron-Job in einem anderen Dienst. Wie das Change Capture funktioniert, welche Einstellung `REALTIME_CDC` bietet und was dafür benötigt wird: [Database change capture](/docs/backend/realtime-cdc/).

## Timeout für ausstehende Anfragen (Pending Request Timeout)

Um zu verhindern, dass Client-Anfragen unbegrenzt hängen bleiben, gilt für alle ausstehenden WebSocket-Operationen, die eine Antwort des Servers erwarten (wie einmalige Tabellenabrufe `FETCH_COLLECTION`, Abrufe einzelner Entitäten `FETCH_ONE`, Erstellen/Aktualisieren per `SAVE`, Löschvorgänge `DELETE`, Zählungen `COUNT` und Eindeutigkeitsprüfungen `CHECK_UNIQUE_FIELD`), ein Standard-Timeout von 30 Sekunden.

Wenn der Server nicht innerhalb dieses 30-Sekunden-Fensters antwortet, verwirft der Client die ausstehende Anfrage automatisch und weist das Promise mit einem `RebaseApiError` zurück, dessen Code `REQUEST_TIMEOUT` lautet.

Einweg-Nachrichten, die keine Antwort erwarten (wie `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` und `channel_history`), werden unmittelbar nach dem Senden aufgelöst (resolve) und lösen diesen Timeout nicht aus. Ein Abonnement, dessen erster Frame 30 Sekunden nach dem Senden des Subscribe-Befehls noch nicht eingetroffen ist, schlägt stattdessen mit `SUBSCRIPTION_TIMEOUT` an seinem `onError` fehl.

### Wenn ein Kanal-Frame abgelehnt wird

Ein Kanal-Frame arbeitet nach dem Fire-and-Forget-Prinzip: `await channel.broadcast(...)` wird aufgelöst, sobald der Frame in den Socket geschrieben wurde, **nicht** erst, wenn der Server ihn akzeptiert hat. Das ist beabsichtigt – eine kollaborative Anwendung sendet eine Cursor-Position sechzig Mal pro Sekunde, und das Warten auf eine Bestätigung bei jedem einzelnen Sendevorgang würde jeden davon zu einem vollständigen Roundtrip machen.

Eine Ablehnung kann daher kein abgewiesenes Promise sein. Sie wird an `onError` übermittelt:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Bedeutung |
|------|-------|
| `CHANNEL_FORBIDDEN` | Sie sind kein Mitglied des Kanals – treten Sie ihm bei, bevor Sie broadcasten oder seinen Verlauf lesen |
| `RATE_LIMITED` | Über dem Kanal-Frame-Budget (7.200 Kanal-Frames pro Minute pro Socket) oder, bei einer Verlaufsanfrage, über dem [data rate limit](#was-ein-schreibvorgang-kostet-und-die-limits) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Ein gespeicherter Broadcast konnte nicht persistiert werden und wurde daher verworfen |
| `CHANNEL_HISTORY_READ_FAILED` | Eine Catch-up-Anfrage konnte nicht bedient werden |
| `CHANNEL_HISTORY_GAP` | Vom Client ausgelöst: Beim Aufholen wurde festgestellt, dass der Server Nachrichten nicht mehr vorhält, die dieser Client nie empfangen hat. `details` ist `{ from, to }` mit den verpassten Sequenznummern. Synchronisieren Sie den Zustand des Kanals erneut von seiner primären Datenquelle |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Der Broadcast hat nur diese Instanz erreicht – siehe [The 8 KB limit on the Postgres bus](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Ohne registrierten Handler werden diese als Warnung protokolliert. Früher wurden sie gänzlich verworfen: Es gab kein Promise, das abgewiesen werden konnte, und keinen Kanal, an den zugestellt werden konnte, sodass ein unzulässiger Broadcast nicht von einem zugestellten zu unterscheiden war.

## Nächste Schritte

- [Typed SDK](/docs/sdk) – Vollständige SDK-Referenz einschließlich typisierter Tabellen-Accessoren.
- [Authentication](/docs/backend/authentication) – JWT-Authentifizierung und RLS-Richtlinien einrichten.
- [Backend Architecture](/docs/backend) – Übersicht über die Rebase-Server-Architektur.

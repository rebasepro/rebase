---
sourceHash: cb80897157f6b539
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
3. **Client-Callback** – Das typisierte SDK ruft Ihren `onUpdate`-Callback mit den aktuellen Daten auf.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Bei Bereitstellungen mit mehreren Instanzen verwendet Rebase PostgreSQLs `LISTEN/NOTIFY`, um Änderungen über Server-Instanzen hinweg zu übertragen. Dies geschieht automatisch. Ist die [Change Capture auf Datenbankebene](/docs/backend/realtime-cdc/) eingeschaltet (der Standard überall dort, wo die Datenbankrolle Trigger anlegen darf), lauscht jede Instanz auf dem Kanal `rebase_cdc`, in den die Capture-Trigger veröffentlichen, sodass ein Schreibvorgang gehört wird, gleich welcher Prozess oder welches Tool ihn ausgeführt hat. Ohne Capture meldet jede Instanz ihre eigenen Schreibvorgänge auf dem Kanal `rebase_entity_changes`, und eine dedizierte Verbindung auf jeder anderen Instanz leitet sie an deren lokale Abonnenten weiter.

### Null-Konfiguration

Realtime ist standardmäßig aktiviert. Es muss kein Flag gesetzt oder ein Dienst gestartet werden – wenn Ihr Rebase-Server läuft, ist der WebSocket-Endpunkt verfügbar.

### Welchen Pfad der Socket beantwortet

Unter 0.24 nimmt der Socket jedes WebSocket-Upgrade auf dem Server an, gleich welchen Pfad es hat.

Der Socket beantwortet Upgrades auf einem Pfad: dem Basispfad der API ohne ein abschließendes `/api`, also `/` für eine API unter `/api`. Dorthin wählt sich das SDK ein: Es verbindet sich mit seiner `baseUrl`, während seine HTTP-Anfragen an `${baseUrl}/api` gehen. Ein Upgrade auf jeden anderen Pfad bleibt den anderen `upgrade`-Listenern des Servers überlassen, sodass Ihre App auf demselben `http.Server` einen eigenen WebSocket-Server betreiben kann. Ohne einen weiteren Listener wird ein solches Upgrade mit `404` beantwortet.

In einem [eigenen Server](/docs/backend/custom-server/) legt `backend.attachRealtime(server, { path })` den Pfad fest, und `realtime.path` des Postgres-Adapters überschreibt, was der Server abgeleitet hat.

> Standardmäßig gibt Rebase auch Realtime-Events für Schreibvorgänge aus, die **außerhalb** der API getätigt werden (über `psql`, einen anderen Dienst oder den SQL-Editor von Studio), sofern die Datenbankverbindung dies unterstützt – siehe [Change Capture auf Datenbankebene (CDC)](/docs/backend/realtime-cdc/).

## Abonnements im typisierten SDK

Das typisierte SDK von Rebase stellt für jeden Collection-Accessor zwei Abonnement-Methoden bereit:

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

Der Callback erhält eine `FindResult<M>`, die Folgendes enthält:
- `data` — Die Zeilen, flach, so wie `find()` sie zurückgibt (`row.name`, nicht `row.values.name`).
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

Der Callback empfängt die Zeile flach, so wie `findById()` sie zurückgibt (`row.name`, nicht `row.values.name`), oder `undefined`, sobald die Zeile gelöscht ist.

**Jeder Frame trägt die Version der Zeile.** `etagOf(row)` ist das `ETag`, das ein `GET` der Zeile beantwortet, sodass eine Bearbeitung gegen das, was ein Frame zeigte, mit `ifMatch: etagOf(row)` gespeichert werden kann und mit `412` abgelehnt wird, wenn die Zeile sich weiterentwickelt hat (siehe [Bedingte Schreibvorgänge](/docs/backend/writes/)). Auf der Leitung fragt das `subscribe_one` des SDK mit `etag: true`, und jeder `single_update`-Frame für eine existierende Zeile trägt `"etag"` neben `"row"`. Ein Server, der älter ist, ignoriert die Anfrage und sendet kein Tag, und ein Client, der nicht fragt, erhält Frames ohne eines.

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
`.listen()` — sowohl im Query-Builder als auch im Collection-Accessor — braucht den WebSocket des Clients. Der Client leitet seine URL aus `baseUrl` ab, sofern keine `websocketUrl` angegeben ist. Bei einem Client, der mit `realtime: false` erstellt wurde, oder einem, der keine URL ableiten konnte, löst der Aufruf von `.listen()` einen Fehler aus.
:::

## Update-Bereitstellung: Sofortiger Patch + Refetch zur Korrektheit

Eine Änderung wird niemals als direkte Daten an einen Abonnenten übertragen. Sie wird als die Tatsache übertragen, dass sich etwas geändert hat, und jedem Abonnenten wird dann durch eine in seinem Kontext ausgeführte Abfrage mitgeteilt, was *er* sehen darf:

1. **Invalidierung.** Wenn sich eine Entität ändert (erstellt, aktualisiert, gelöscht), markiert der Server die betroffenen Pfade. Die geschriebene Zeile wird nicht weitergeleitet – sie wurde unter der Autorisierung des Schreibers gelesen, was nichts darüber aussagt, was ein Abonnent sehen darf.

2. **Gedebouncter RLS-Refetch.** Nach **300 ms** (`REFETCH_DEBOUNCE_MS`) ruft der Server die Collection mit Ihren ursprünglichen Filtern und der Sortierreihenfolge erneut ab. Die Abfrage wird innerhalb einer Transaktion ausgeführt, die die transaktionslokalen Variablen `app.user_id` und `app.user_roles` aus dem `SubscriptionAuthContext` des Abonnenten setzt. Dadurch wertet Postgres Row-Level Security unter der Identität dieses Clients aus, und nur die Zeilen, zu deren Ansicht er berechtigt ist, werden im `collection_update` gesendet. Das Debouncing fasst zudem eine Serie rascher Schreibvorgänge zu einer einzigen Abfrage zusammen. Es wartet 300 ms ohne eine weitere Änderung, aber nie länger als **1 s** (`REFETCH_MAX_WAIT_MS`) nach der ersten, sodass eine Collection, die mehrmals pro Sekunde geschrieben wird, ihren Abonnenten trotzdem mindestens einmal pro Sekunde einen Frame sendet. Setzen Sie diese Grenze mit `REALTIME_REFETCH_MAX_WAIT_MS` (oder `realtime.refetchMaxWaitMs`): Höher ruft eine stark beschriebene Tabelle seltener erneut ab, niedriger sendet frischere Frames.

   Ein Refetch, der genau das liest, was einem Abonnenten zuletzt gesendet wurde, sendet diesem Abonnenten nichts: Ein Schreibvorgang auf Zeile 9.000 einer Liste, die die ersten 50 zeigt, kostet den Read, nicht einen Frame an jeden Betrachter. Nach einem Fehler-Frame werden die nächsten Zeilen erneut gesendet, auch wenn sie dieselben sind.

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

Wenn die Zählung selbst fehlschlägt, enthält der Frame `partial: true` und kein `total`; dies ist kein Abonnement-Fehler, und ein Client sollte den letzten echten Gesamtwert beibehalten, anstatt die Seitenlänge einzusetzen. Bei einer großen Tabelle macht die Zählung den Großteil der Kosten eines Frames aus. Ist `REALTIME_RECOUNT_INTERVAL_MS` gesetzt, verwendet eine Liste, deren letzte Gesamtzahl mindestens `REALTIME_RECOUNT_MIN_ROWS` betrug (standardmäßig 100.000), diese Gesamtzahl für das Intervall weiter, statt bei jedem Schreibvorgang zu zählen, und ein solcher Frame trägt `meta.totalAsOf`, den Zeitpunkt, zu dem die Gesamtzahl ermittelt wurde. Ist das Intervall abgelaufen, wird eine Liste, deren letzter Frame die Gesamtzahl weiterverwendet hat, erneut gezählt und erhält die neue Gesamtzahl, ob seither etwas geschrieben wurde oder nicht. Ungesetzt, wie standardmäßig, zählt jeder Frame.

### Was ein Schreibvorgang kostet, und die Grenzen

Da jeder Frame eine Abfrage ist, die als sein Abonnent ausgeführt wird, wächst die Kosten eines Schreibvorgangs mit der Anzahl der **unterschiedlichen Fragen unterschiedlicher Prinzipale** auf der betroffenen Collection – nicht mit der Anzahl offener Sockets:

- Abonnements, die dieselbe Frage stellen (derselbe Pfad, dieselben Filter, Sortierung, Seite, `include`, `fields`, Suche) als derselbe Prinzipal (dieselbe Benutzer-ID, Rollen, Guest-Flag und Claims), teilen sich einen Refetch. Ein Schreibvorgang auf eine Liste kostet **eine Transaktion pro solcher Gruppe** — den Read und seinen Count —, egal wie viele Sockets sie halten; jedes Mitglied erhält weiterhin einen Frame, der aus unter dieser Identität gelesenen Zeilen aufgebaut ist. Eine erste Seite, die kürzer ausfällt als ihr `limit`, ist die gesamte Menge und wird daher gar nicht gezählt.
- Ein Einzeldatensatz-Abonnement wird nur abgefragt, wenn sich sein eigener Datensatz ändert.
- Unterschiedliche Prinzipale teilen sich niemals einen Read – das verhindert, dass ein Frame eine Zeile trägt, die sein Leser nicht sehen darf. Eine Liste, die von tausend unterschiedlichen angemeldeten Benutzern beobachtet wird, bedeutet tausend Reads und tausend Counts bei jedem Schreibvorgang darauf, in tausend Transaktionen.

Auf einem Laptop gegen ein lokales PostgreSQL mit einem Verbindungspool von 20 Verbindungen gemessen, ein Schreibvorgang auf eine Liste:

| Abonnenten | Transaktionen für den Schreibvorgang | Letzter Frame nach dem Schreibvorgang |
|-------------|----------------------------|----------------------------|
| 1.000, ein Prinzipal | 2 | ~310 ms |
| 1.000, jeweils ein anderer Prinzipal | ~1.000 | ~600 ms |

300 ms davon sind das Debounce. Die zweite Zeile ist die Obergrenze, mit der Sie planen sollten. Die Refetches laufen im selben Pool wie Ihr REST-Traffic, aber höchstens auf einem Viertel seiner Verbindungen gleichzeitig (5 der standardmäßigen 20, nie weniger als 2); die übrigen warten im Server auf ihren Zug, sodass der Fan-out eines Schreibvorgangs seine eigenen Frames verzögert statt Ihrer Anfragen. Eine Collection, die mehrmals pro Sekunde geschrieben wird, während **Hunderte unterschiedlicher Benutzer** dieselbe Liste beobachten, ist der Punkt, an dem diese Frames zu verzögern beginnen. Bevorzugen Sie darüber hinaus engere Abonnements (eine Seite, ein Filter auf die eigenen Zeilen des Benutzers) oder einen [Broadcast-Kanal](#broadcast-kanäle), der die Änderung trägt, damit Clients nach ihrem eigenen Zeitplan erneut abrufen können.

**Ein Socket darf höchstens 1.000 Abonnements halten.** Das nächste wird mit einem Fehler-Frame mit dem Code `TOO_MANY_SUBSCRIPTIONS` abgelehnt; das erneute Abonnieren unter einer ID, die der Socket bereits hält, ersetzt dieses Abonnement und zählt nicht erneut. Das SDK teilt sich identische Abonnements auf einem Socket, sodass dies die unterschiedlichen Listen und Datensätze zählt, die eine Seite offen hat. Ändern Sie dies mit `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` oder `realtime.maxSubscriptionsPerSocket` auf dem Postgres-Adapter (die Umgebungsvariable gewinnt); ein Wert, der keine positive ganze Zahl ist, stoppt den Server beim Start. Auf 0.23 sind die Abonnements eines Sockets nicht begrenzt. **Auch die Sockets, die ein Benutzer hält, lassen sich begrenzen**, pro Server-Instanz: Setzen Sie `REALTIME_MAX_SOCKETS_PER_USER` (oder `realtime.maxSocketsPerUser`), und eine Anmeldung darüber hinaus wird mit `TOO_MANY_SOCKETS` abgelehnt und der Socket mit 4002 geschlossen. Mit einem API-Schlüssel angemeldete Sockets zählen gegen diesen Schlüssel, jeder Schlüssel für sich, nicht gegen das Konto, das ihn erstellt hat; der Service-Schlüssel ist ein einziges Credential, sodass alle seine Sockets zusammen zählen. Die Sockets eines Administrators, die einen Benutzer impersonieren, zählen gegen den Administrator, zusammen mit seinen eigenen Sockets, nicht gegen den Benutzer, als der er handelt. Das SDK benachrichtigt jedes aktive Abonnement und `onConnectionLost` auf einmal mit einem `CONNECTION_LOST`-Fehler, dessen `details.reason` `TOO_MANY_SOCKETS` ist, und versucht es weiter, wobei es jedes Mal länger wartet, bis zu 30 s, sodass der Tab hineinkommt, sobald ein anderer Socket schließt. Ungesetzt, wie standardmäßig, gibt es keine Obergrenze.

Eine Abonnement-ID gehört dem jeweiligen Socket: Zwei Clients, die beide ein Abonnement `"sub-1"` nennen, behalten jeweils ihr eigenes, und ein `unsubscribe` beendet nur das des Absenders.

**Abonnieren zählt gegen das Datenratenlimit.** Der erste Frame eines Abonnements ist ein Read, der als Abonnent ausgeführt wird, und eine History-Anfrage eines Kanals ebenso. Daher zählen `subscribe_collection`, `subscribe_one` und `channel_history` als Datenanfragen im Rate-Limit-Bucket des Aufrufers (dem, den seine HTTP-Anfragen und seine anderen Sockets teilen), sobald das eigene Kontingent des Sockets aufgebraucht ist. Jeder Socket darf 1.000 davon senden, ohne sie zu zählen, oder so viele, wie seine Abonnement-Obergrenze beträgt, wenn diese höher ist, und das Kontingent kommt über 15 Minuten zurück. Das ist alles, was ein Socket halten kann, sodass das erneute Abonnieren nach einem Reconnect nie abgelehnt wird und nie das Budget der Person verbraucht. Über das Kontingent hinaus wird ein Frame über dem Limit mit einem Fehler-Frame mit dem Code `RATE_LIMITED` abgelehnt, den das SDK an das `onError` dieses Abonnements oder des Kanals ausliefert. Auf 0.23 zählen diese Frames nur gegen das eigene Budget des Sockets von 2.000 Frames pro Minute.

### Sockets, die nicht mehr antworten

Ein Client kann verschwinden, ohne seinen Socket zu schließen: Ein Handy verliert den Empfang, ein Laptop geht in den Ruhezustand, ein NAT vergisst die Verbindung. Es kommt kein Close-Frame an, also sagt dem Server niemand etwas. Deshalb sendet der Server jedem Socket alle 30 Sekunden einen Ping und beendet einen Socket, der bis zum nächsten Ping nicht geantwortet hat. Ein verschwundener Client wird so innerhalb einer Minute freigegeben. Browser und das SDK beantworten Pings von selbst; ein Client, der das Protokoll direkt spricht, muss sie ebenfalls beantworten, wie es die meisten WebSocket-Bibliotheken tun.

**Die Browser-Seite.** Ein Browser kann weder einen Ping senden noch einen sehen, sodass ihm ein halb offener Socket ewig verbunden erscheint. Das SDK öffnet den Socket mit `?rebase_caps=heartbeat,channel_seq,cancel_sql`; ein Server, der sie kennt, antwortet mit `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listet darin die auf, die er einhält (`cancel_sql`: er nimmt den `CANCEL_SQL`-Frame der SQL-Konsole an), und sendet alle 30 Sekunden `{"type":"heartbeat"}`; das SDK verwirft den Socket und [verbindet sich neu](#automatische-wiederverbindung-auto-reconnect), nachdem zwei ausgeblieben sind. Einem Client, der nichts nennt, wird keines von beiden gesendet, und ein älterer Server ignoriert den Parameter, sodass sich ein SDK, das mit einem solchen spricht, wie zuvor verhält.

Ein Socket wird außerdem beendet, wenn mehr als 16&nbsp;MiB an Frames, die an ihn gesendet wurden, noch ungelesen sind. Das ist ein Client, der nicht liest, was ihm gesendet wird, oder einer, der so weit zurückliegt, dass das, was er lesen würde, veraltet ist. Und wenn die Sockets eines Servers zusammen mehr als 256&nbsp;MiB ungelesen halten (oder ein Viertel des Speicherlimits, unter dem der Server läuft, wenn dieses kleiner ist), werden diejenigen mit dem meisten Ungelesenen zuerst beendet, bis der Rest passt.

Ein beendeter Socket wird wie ein geschlossener aufgeräumt. Seine Abonnements enden, er verlässt seine Kanäle, und seine Presence wird entfernt, wobei der Abgang den anderen Mitgliedern angekündigt wird. Ein Client, der noch da ist, sieht die Verbindung abbrechen, und das SDK [verbindet sich neu](#automatische-wiederverbindung-auto-reconnect) und abonniert erneut. Auf 0.23 bleibt ein solcher Socket offen, bis das Betriebssystem die Verbindung aufgibt (unter Linux etwa zwei Stunden), und jeder Schreibvorgang in eine Collection, die er abonniert hat, kostet für ihn weiterhin einen Refetch.

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

- **Geordnet.** Sequenznummern werden pro Kanal vergeben, und die Zustellungsreihenfolge entspricht der Sequenzreihenfolge – auf einer einzelnen Instanz, und über Instanzen hinweg auf dem `postgres`-Bus, wo dieselbe Anweisung, die eine Nachricht nummeriert, sie auch ankündigt, sodass jede Instanz (einschließlich der des Absenders) die Ankündigungen in Sequenzreihenfolge empfängt. Ein selbst bereitgestellter Bus transportiert Frames in der Reihenfolge, in der er sie zustellt.
- **Dauerhaft gespeichert vor Zustellung.** Eine Nachricht, die nicht gespeichert werden kann, wird an niemanden zugestellt, und der Absender wird darüber informiert. Eine Zustellung würde sie Live-Abonnenten präsentieren, sie jedoch bei künftigen Replays auslassen – eine Lücke, die keine spätere Nachricht schließen könnte.
- **At-Least-Once beim Nachholen.** Ein Replay-Bereich kann sich mit Nachrichten überschneiden, die ein Client bereits empfangen hat; das SDK verwirft bereits zugestellte Nachrichten.
- **Keine Lücken.** Eine aufbewahrte Nachricht erreicht jedes Mitglied: Der Absender, dem seine eigene Nachricht nie gesendet wird, erhält stattdessen `{"type":"broadcast_ack","channel","seq"}`, wenn er sich für `channel_seq` entschieden hat. Eine Nachricht jenseits von `lastSeq + 1` bedeutet also, dass eine verpasst wurde, und das SDK hält sie zurück, fragt den Verlauf dazwischen an und stellt alle der Reihe nach zu. Gegenüber einem Server ohne `channel_seq` wird ein Sprung so zugestellt, wie er eintrifft.

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
| `presence_state`  | Server → Client | Jede Presence im Kanal, vollständig               |
| `presence_diff`   | Server → Client | Inkrementelles Update (Beitritte und Austritte)                |

Wenn ein Client `presence_track` sendet, lässt der Server ihn dem Kanal automatisch beitreten (kein separater Aufruf von `join_channel` erforderlich) und sendet ein `presence_diff` als Broadcast an alle Kanalmitglieder. Das SDK sendet seinen Status alle ~20 Sekunden erneut als Heartbeat; ein Heartbeat mit unverändertem Status aktualisiert nur den Timeout des Clients und sendet kein `presence_diff`.

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

Das typisierte SDK verbindet sich automatisch wieder, wenn die WebSocket-Verbindung unterbrochen wird:

- **Exponentieller Backoff** – Jeder Wiederverbindungsversuch wartet auf eine Stufe, die bei 2 Sekunden beginnt und sich jedes Mal verdoppelt, bis zu 30 Sekunden. Die Verzögerung wird zufällig irgendwo innerhalb ihrer Stufe gezogen, aber nie unter einer Viertelsekunde, sodass Clients, die durch ein Deployment gemeinsam getrennt wurden, über die gesamte Stufe verteilt zurückkommen statt im selben Moment.
- **Kein Aufgeben, solange etwas aktiv ist** – Solange ein Abonnement oder ein beigetretener Kanal existiert, verbindet sich der Client an der 30-Sekunden-Obergrenze weiter, solange die Störung andauert. Ohne registrierte Abonnements stellt er nach 5 fehlgeschlagenen Versuchen die Versuche ein, und das nächste Abonnement verbindet erneut. In einem Browser lösen sowohl das `online`-Ereignis als auch das erneute Sichtbarwerden des Tabs sofort eine Wiederverbindung aus, statt den Backoff abzuwarten.
- **Ausfälle werden einmalig gemeldet** – Wenn die Verbindung 14 Sekunden lang unterbrochen war, gleichgültig wie viele Wiederverbindungsversuche das waren, erhält das `onError` jedes aktiven Abonnements und das `onError` jedes beigetretenen Kanals einmal einen `RebaseApiError` mit dem Code `CONNECTION_LOST`. Das Abonnement bleibt **bestehen**: Der Fehler besagt, dass seine Daten nicht aktualisiert werden, nicht dass es beendet wurde.
- **Automatische Wiederanmeldung (Resubscription)** – Nach erfolgreicher Wiederverbindung werden alle aktiven Abonnements erneut beim Server registriert, und das nächste `onUpdate` jedes einzelnen trägt alles, was geschrieben wurde, während der Client weg war. Dieses Update ist das Erholungssignal. Kein manuelles Eingreifen erforderlich.
- **Anfragen sind at-most-once** – Eine Anfrage, die gestellt wird, während der Socket unten ist, wartet auf ihn, bis zu 30 Sekunden ab dem Aufruf, und scheitert danach mit `REQUEST_TIMEOUT`, ohne je gesendet worden zu sein. Eine Anfrage, die bereits gesendet war, als die Verbindung abbrach, scheitert mit `CONNECTION_LOST` und wird **nicht** erneut gesendet: Der Server hat sie möglicherweise bereits ausgeführt oder nicht, und nur der Aufrufer weiß, ob eine zweifache Ausführung sicher ist.

`client.ws.state` gibt an, wo sich die Verbindung befindet, und `onStateChange` wird über
jede Änderung informiert. Auf 0.23 existiert keins von beiden, der Client stellt
nach 5 fehlgeschlagenen Versuchen die Versuche ein, und während der Trennung
gesendete Nachrichten werden in eine Warteschlange eingereiht und nach der
Wiederverbindung gesendet:

| Zustand | Bedeutung |
|---|---|
| `idle` | Kein Socket, und noch keiner gewünscht (die Verbindung ist lazy), oder eine Abmeldung hat ihn beendet. |
| `connecting` | Es wird gewählt, ohne dass eine Störung vorliegt. |
| `connected` | Der Socket ist offen. |
| `reconnecting` | Der Socket ist abgebrochen, und der Client verbindet sich erneut. Es wurde noch nichts gemeldet. |
| `disconnected` | Die Störung dauert bereits 14 Sekunden oder länger. `CONNECTION_LOST` wurde gemeldet, und der Client verbindet sich weiterhin erneut. |
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

Das Rebase-Admin-Panel zeigt ein eigenes Banner an, solange der Zustand `disconnected` ist, und behält die bereits angezeigten Zeilen und Datensätze bei, anstatt sie durch einen Fehler zu ersetzen.

## Authentifizierung & RLS

WebSocket-Abonnements berücksichtigen automatisch Richtlinien für Row-Level Security (RLS). Wenn der Client authentifiziert ist:

1. Die WebSocket-Verbindung authentifiziert sich mit demselben JWT-Token wie die REST-API.
2. Jeder Refetch eines Abonnements wird innerhalb einer PostgreSQL-Transaktion mit `set_config('app.user_id', ...)` und `set_config('app.user_roles', ...)` ausgeführt – wodurch sichergestellt wird, dass RLS-Richtlinien durchgesetzt werden.
3. Die Identität wird erneut geprüft, solange der Socket offen ist, nicht nur bei der Authentifizierung. Vor jedem Frame stellt der Server dieselben Fragen, die auch eine HTTP-Anfrage stellen würde: Ist das Token noch gültig, wurde seine Sitzung abgemeldet oder widerrufen, existiert das Konto noch, und welche Rollen hält es jetzt. Channel-Frames werden höchstens einmal pro Sekunde geprüft. Frames, die auf einem Socket eintreffen, während seine Prüfung noch läuft – etwa ein Client, der nach einem Reconnect seine Subscriptions erneut sendet –, teilen sich diese Prüfung, statt jeweils neu zu fragen; der nächste Frame nach ihrem Abschluss fragt wieder neu. Ein Socket, der nur zuhört, wird mindestens alle 30 Sekunden geprüft, und ein Token wird ab dem Moment seines Ablaufs nicht mehr akzeptiert. Eine entzogene Rolle gilt ab dem nächsten Frame (bei einem Frame, der sich eine bereits laufende Prüfung geteilt hat, ab dem darauffolgenden), für Reads, Writes und offene Abonnements gleichermaßen. Ein Socket, dessen Identität beendet wurde, erhält einen `AUTH_ERROR`-Frame und wird mit dem Code `4001` geschlossen. Mit der integrierten Auth sagt der Code des Frames den Grund, so wie die HTTP-Routen ihn sagen: `SESSION_REVOKED` (abgemeldet, widerrufen oder das Konto gelöscht), `ACCOUNT_DISABLED` oder `TOKEN_EXPIRED`; bei einem anderen Auth-Adapter ist er `SESSION_ENDED`. Ein `AUTHENTICATE` für eine widerrufene Sitzung oder ein deaktiviertes Konto wird mit `SESSION_REVOKED` oder `ACCOUNT_DISABLED` verweigert (ein Token, das sich nicht verifizieren lässt oder abgelaufen ist, mit `INVALID_TOKEN`). Das SDK fragt nicht erneut mit demselben Token und reicht die Verweigerung samt Code an das `onError` dessen weiter, was das Konto brauchte. Das SDK authentifiziert seinen Socket jedes Mal neu, wenn es sein Token aktualisiert; ein neues Token für dieselbe Identität (dieselbe Benutzer-ID, Rollen, Guest-Flag und Claims) lässt die offenen Abonnements unverändert, und eines für eine andere Identität lädt jedes von ihnen als diese neu. Nach einem `4001` verbindet es sich mit der Sitzung neu, die es dann hält, oder ganz ohne. Ein Client, der direkt mit dem Protokoll kommuniziert, muss ein frisches Token in `AUTHENTICATE` senden, bevor das alte abläuft.

Dies bedeutet, dass jeder Socket nur Updates für Datensätze erhält, die seine authentifizierte Identität einsehen darf.

Auch ein [API-Schlüssel](/docs/backend/api-keys/) authentifiziert den Socket: Senden Sie den
`rk_…`-Schlüssel dort, wo das Zugriffstoken stehen würde. Der Socket prüft dann jeden Frame
gegen die [Scopes](/docs/backend/roles-and-scopes/) des Schlüssels: Ein Abruf, eine Zählung oder eine
Subscription braucht `data:read` auf ihrer Collection, ein Speichern `data:write`, ein Löschen
`data:delete`. Ein verschachtelter Pfad braucht den einfachen Scope. Channels (Broadcast und
Presence) werden für einen Schlüssel abgelehnt, weil kein Scope sie abdeckt. Der SQL-Editor und
Branch-Nachrichten brauchen `database:read` oder `database:write`, für einen Schlüssel wie für eine
Person.

Der Betrieb mehrerer Instanzen – der LISTEN/NOTIFY-Bus, wie Presence über Prozesse hinweg funktioniert und das Schreiben eines eigenen Transports – wird auf einer eigenen Seite beschrieben:
[Realtime über Instanzen hinweg](/docs/backend/realtime-transports/).

## Change Capture auf Datenbankebene (CDC)

Jeder committete Schreibvorgang löst Realtime-Events aus, gleich wie er erfolgt ist: REST, das SDK, Studio, `psql`, ein Cron-Job in einem anderen Dienst. Wie die Erfassung funktioniert, die Einstellung `REALTIME_CDC` und was sie braucht: [Change Capture auf Datenbankebene](/docs/backend/realtime-cdc/).

## Timeout für ausstehende Anfragen

Um zu verhindern, dass Client-Anfragen unbegrenzt hängen bleiben, haben alle ausstehenden WebSocket-Operationen, die eine Serverantwort erwarten (z. B. einmalige Collection-Abfragen `FETCH_COLLECTION`, Einzelentitäts-Abfragen `FETCH_ONE`, Erstellen/Aktualisieren `SAVE`, Löschvorgänge `DELETE`, Zählungen `COUNT` und Eindeutigkeitsprüfungen `CHECK_UNIQUE_FIELD`), ein standardmäßiges Timeout von 30 Sekunden.

Wenn der Server nicht innerhalb dieses 30-Sekunden-Fensters antwortet, löscht der Client die ausstehende Anfrage automatisch und weist das Promise mit einem `RebaseApiError` ab, dessen Code `REQUEST_TIMEOUT` ist.

Einweg-Nachrichten, die keine Antwort erwarten (wie `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` und `channel_history`), werden unmittelbar nach dem Senden aufgelöst (resolve) und lösen diesen Timeout nicht aus. Ein Abonnement, dessen erster Frame 30 Sekunden nach dem Senden seines Subscribe nicht eingetroffen ist, schlägt stattdessen fehl, und zwar mit `SUBSCRIPTION_TIMEOUT` auf seinem `onError`.

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
| `RATE_LIMITED` | Das Kanal-Frame-Budget (7.200 Kanal-Frames pro Minute und Socket) wurde überschritten, oder, bei einer History-Anfrage, das [Datenratenlimit](#was-ein-schreibvorgang-kostet-und-die-grenzen) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Ein gespeicherter Broadcast konnte nicht persistent gesichert werden und wurde daher verworfen |
| `CHANNEL_HISTORY_READ_FAILED` | Eine Catch-up-Anfrage konnte nicht bedient werden |
| `CHANNEL_HISTORY_GAP` | Vom Client ausgelöst: Ein Catch-up hat festgestellt, dass der Server Nachrichten, die dieser Client nie erhalten hat, nicht mehr vorhält. `details` ist `{ from, to }`, die verpassten Sequenznummern. Synchronisieren Sie den Zustand des Kanals erneut aus seiner maßgeblichen Quelle |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Der Broadcast hat nur diese Instanz erreicht – siehe [Das 8-KB-Limit auf dem Postgres-Bus](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Wenn kein Handler zugewiesen ist, werden diese als Warnung protokolliert. Früher wurden sie gänzlich verworfen: Es gab kein Promise, das abgewiesen werden konnte, und keinen Kanal für die Zustellung, sodass ein verbotener Broadcast nicht von einem zugestellten zu unterscheiden war.

## Nächste Schritte

- [Typisiertes SDK](/docs/sdk) — Vollständige SDK-Referenz einschließlich typisierter Collection-Accessors.
- [Authentifizierung](/docs/backend/authentication) — JWT-Authentifizierung und RLS-Richtlinien einrichten.
- [Backend-Architektur](/docs/backend) — Überblick über die Rebase-Serverarchitektur.

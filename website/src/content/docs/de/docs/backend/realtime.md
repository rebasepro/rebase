---
sourceHash: 512b1a9970d23a5b
title: Realtime & WebSocket
sidebar_label: Realtime
description: Echtzeit-Datensynchronisierung, Broadcast-Kanäle und Presence-Tracking über WebSocket.
---

Rebase enthält eine integrierte Realtime-Engine, die Datenänderungen über WebSocket an verbundene Clients per Push überträgt.
Sobald ein Datensatz erstellt, aktualisiert oder gelöscht wird, erhält jeder Abonnent, der diese Tabelle oder Entität beobachtet, das Update sofort – kein Polling erforderlich.

## Funktionsweise

Die Realtime-Pipeline besteht aus drei Phasen:

1. **Datenbank-Trigger** – Eine Mutation erreicht die PostgreSQL-Datenbank (über REST-API, SDK oder Studio).
2. **Server-Fan-out** – Der Rebase-Server erkennt die Änderung und verteilt sie (Fan-out) an jedes aktive WebSocket-Abonnement, das zur betroffenen Tabelle oder Entität passt.
3. **Client-Callback** – Das typisierte SDK löst Ihren `onUpdate`-Callback mit den aktuellen Daten aus.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Für Multi-Instanz-Deployments verwendet Rebase das `LISTEN/NOTIFY` von PostgreSQL, um Änderungen über Server-Instanzen hinweg zu übertragen. Dies geschieht automatisch. Bei aktivierter [Änderungserfassung auf Datenbankebene (CDC)](/docs/backend/realtime-cdc/) (Standard, sofern die Datenbankrolle Trigger erstellen darf) lauscht jede Instanz auf dem Kanal `rebase_cdc`, auf dem die Erfassungs-Trigger veröffentlichen. So wird jeder Schreibvorgang erfasst, unabhängig davon, welcher Prozess oder welches Tool ihn vorgenommen hat. Ohne Erfassung kündigt jede Instanz ihre eigenen Schreibvorgänge auf dem Kanal `rebase_entity_changes` an, und eine dedizierte Verbindung auf jeder anderen Instanz leitet sie an ihre lokalen Abonnenten weiter.

### Zero Configuration

Realtime ist standardmäßig aktiviert. Es muss kein Flag gesetzt oder ein Dienst gestartet werden – wenn Ihr Rebase-Server läuft, ist der WebSocket-Endpunkt verfügbar.

### Auf welchem Pfad der Socket antwortet

Der Socket nimmt Upgrades auf einem Pfad entgegen: dem Basispfad der API ohne das abschließende `/api`, also `/` für eine API unter `/api`. Genau dorthin verbindet sich das SDK: Es verbindet sich mit seiner `baseUrl`, während seine HTTP-Anfragen an `${baseUrl}/api` gehen. Ein Upgrade auf jeden anderen Pfad wird anderen `upgrade`-Listenern des Servers überlassen, sodass Ihre Anwendung einen eigenen WebSocket-Server auf demselben `http.Server` betreiben kann. Ohne einen weiteren Listener wird ein solches Upgrade mit `404` beantwortet.

In einem [benutzerdefinierten Server](/docs/backend/custom-server/) legt `backend.attachRealtime(server, { path })` den Pfad fest, und `realtime.path` des Postgres-Adapters überschreibt den vom Server abgeleiteten Pfad.

> Standardmäßig gibt Rebase auch Echtzeit-Events für Schreibvorgänge aus, die **außerhalb** der API vorgenommen wurden (über `psql`, einen anderen Dienst oder den SQL-Editor von Studio), sofern die Datenbankverbindung dies unterstützt – siehe [Änderungserfassung auf Datenbankebene (CDC)](/docs/backend/realtime-cdc/).

## Typisierte SDK-Abonnements

Das typisierte Rebase-SDK stellt auf jedem Tabellenzugriff zwei Abonnement-Methoden bereit:

- **`listen()`** – Eine gesamte Tabelle abonnieren (mit optionalen Filtern).
- **`listenById()`** – Eine einzelne Entität über ihre ID abonnieren.

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

Der Callback erhält ein `FindResult<M>` mit:
- `data` – Die Zeilen, flach, so wie `find()` sie zurückgibt (`row.name`, nicht `row.values.name`).
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

Der Callback erhält die Zeile, flach, so wie `findById()` sie zurückgibt (`row.name`, nicht `row.values.name`), oder `undefined`, sobald die Zeile gelöscht wird.

**Jeder Frame enthält die Version der Zeile.** `etagOf(row)` ist das `ETag`, das ein `GET` der Zeile zurückgibt. So kann eine Bearbeitung auf Basis dessen, was ein Frame angezeigt hat, mit `ifMatch: etagOf(row)` gespeichert werden und wird mit `412` abgelehnt, wenn sich die Zeile zwischenzeitlich geändert hat (siehe [Bedingte Schreibvorgänge](/docs/backend/writes/)). Auf Netzwerkebene fragt das SDK via `subscribe_one` mit `etag: true` an, und jeder `single_update`-Frame für eine existierende Zeile enthält `"etag"` neben `"row"`. Ein älterer Server ignoriert diese Abfrage und sendet kein Tag; ein Client, der nicht danach fragt, erhält Frames ohne Tag.

### Abbestellen (Unsubscribe)

Sowohl `listen()` als auch `listenById()` geben eine Unsubscribe-Funktion zurück. Rufen Sie diese auf, um keine weiteren Updates mehr zu erhalten und serverseitige Ressourcen freizugeben:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Rufen Sie die Unsubscribe-Funktion immer auf, wenn eine Komponente unmountet wird oder von einer Seite wegnavigiert wird. Dies verhindert Speicherlecks und unnötige serverseitige Arbeit.
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
`.listen()` – sowohl auf dem Query Builder als auch auf dem Tabellenzugriff – benötigt den WebSocket des Clients. Der Client leitet seine URL von `baseUrl` ab, es sei denn, `websocketUrl` wird angegeben. Bei einem Client, der mit `realtime: false` erstellt wurde oder keine URL ableiten konnte, löst der Aufruf von `.listen()` einen Fehler aus.
:::

## Auslieferung von Updates: Instant Patch + Correctness Refetch

Eine Änderung wird niemals als Datenpaket an einen Abonnenten übertragen. Sie wird als Tatsache übertragen, dass
sich etwas geändert hat, und jedem Abonnenten wird anschließend über eine
in dessen Kontext ausgeführte Abfrage mitgeteilt, was *er* sehen darf:

1. **Invalidierung.** Wenn sich eine Entität ändert (erstellt, aktualisiert, gelöscht), markiert der
   Server die betroffenen Pfade. Die geschriebene Zeile wird nicht direkt weitergeleitet –
   sie wurde unter der Autorisierung des Schreibers gelesen, was nichts darüber aussagt, was
   ein Abonnent sehen darf.

2. **Gedrosseltes RLS-Refetch (Debounce).** Nach **300ms** (`REFETCH_DEBOUNCE_MS`) ruft der Server
   die Tabelle mit Ihren ursprünglichen Filtern und Ihrer Sortierreihenfolge erneut ab. Die Abfrage
   läuft innerhalb einer Transaktion, die transaktionslokal `app.user_id` und
   `app.user_roles` aus dem `SubscriptionAuthContext` des Abonnenten setzt. So wertet Postgres
   die Row-Level Security unter der Identität dieses Clients aus, und nur die Zeilen,
   für die er autorisiert ist, werden im `collection_update` gesendet. Das Debouncing
   fasst zudem eine Serie von Schreibvorgängen in einer einzigen Abfrage zusammen. Es wartet 300 ms ohne
   weitere Änderung ab, jedoch nie länger als **1 s** (`REFETCH_MAX_WAIT_MS`) nach
   der ersten Änderung. So sendet eine Tabelle, in die mehrmals pro Sekunde geschrieben wird,
   ihren Abonnenten mindestens einmal pro Sekunde einen Frame. Legen Sie diesen Grenzwert mit `REALTIME_REFETCH_MAX_WAIT_MS` (oder `realtime.refetchMaxWaitMs`) fest: Ein höherer Wert ruft eine stark ausgelastete Tabelle seltener ab, ein niedrigerer liefert frischere Frames.

   Ein Refetch, das exakt das liest, was einem Abonnenten zuletzt gesendet wurde, sendet diesem
   Abonnenten nichts: Ein Schreibvorgang auf Zeile 9.000 einer Liste, die die ersten 50 anzeigt, kostet
   nur den Lesevorgang, keinen Frame an jeden Betrachter. Nach einem Fehler-Frame werden die nächsten Zeilen
   erneut gesendet, selbst wenn sie unverändert sind.

Frühere Versionen sendeten vor diesem Refetch einen sofortigen `collection_patch` mit der geschriebenen Zeile,
für ein tab-übergreifendes Feedback im Sub-Millisekundenbereich. Diese Zeile war jedoch
unter dem Scope des Schreibers gelesen worden, sodass sie Abonnenten erreichen konnte – und erreichte –, deren
eigene Policies dies verweigert hätten; zudem wurde der `where`-Filter des Abonnements
nicht darauf angewendet. Der Patch wurde entfernt: Die wahrgenommene Latenz für ein
Update entspricht nun dem Debounce-Fenster.

### Das Refetch entspricht dem REST-Lesevorgang

Das Refetch durchläuft dieselbe Pipeline wie `GET /api/data/<table>`, mit derselben
Behandlung von `include`. Dadurch geben `find({ q })` und `listen({ q })`
Zeilen zurück, die Feld für Feld identisch sind.

Früher handelte es sich um eine andere Methode – eine, die jede Relation in einen
`{ "__type": "relation" }`-Umschlag kapselte und, da ein Abonnement kein `include`
tragen konnte, **jede** von der Tabelle deklarierte Relation eager nachlud. Dadurch beantwortete dieselbe
Abfrage Anfragen über HTTP in einer Form und über den Socket in einer anderen, und ein Client,
der beides darstellte, erlebte eine Änderung der Zeilenstruktur in dem Moment, in dem ein Schreibvorgang eintraf.

Ein Subscribe-Frame akzeptiert daher dieselben Parameter wie ein List-Request: `filter`,
`logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` und
`fields`. Eine Ausnahme bildet `vectorSearch`, das mit
`VECTOR_SEARCH_NOT_LIVE` **abgelehnt** wird – ein Abonnement wird bei jedem passenden Schreibvorgang erneut ausgeführt,
und dabei werden keine Distanzen berechnet.

### `collection_update` liefert eigene Metadaten mit

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

`meta` wird innerhalb derselben RLS-gebundenen Transaktion gezählt, die die Zeilen gelesen hat,
sodass es exakt die Zeilen neben sich beschreibt. Ohne dies musste ein Client, der eine Gesamtzahl benötigte,
**pro Push** ein `GET /count` absetzen – ein zusätzlicher Roundtrip pro Schreibvorgang und
Abonnent sowie ein Zeitfenster, in dem der Zähler und die Zeilen unterschiedliche
Zustände der Tabelle abbildeten.

Wenn die Zählung fehlschlägt, trägt der Frame `partial: true` und kein `total`;
dies ist kein Abonnementfehler, und ein Client sollte die letzte reale Gesamtzahl beibehalten,
anstatt die Seitenlänge einzusetzen. Bei einer großen Tabelle macht die Zählung den Großteil der Frame-Kosten aus. Wenn `REALTIME_RECOUNT_INTERVAL_MS` gesetzt ist, verwendet eine Liste, deren letzte Gesamtzahl mindestens `REALTIME_RECOUNT_MIN_ROWS` (standardmäßig 100.000) betrug, diese Gesamtzahl für die Dauer des Intervalls wieder, anstatt bei jedem Schreibvorgang neu zu zählen. Ein solcher Frame trägt `meta.totalAsOf` mit dem Erfassungszeitpunkt. Ist das Intervall abgelaufen, wird eine Liste, deren letzter Frame die Gesamtzahl wiederverwendet hat, erneut gezählt und erhält den neuen Wert, unabhängig davon, ob zwischenzeitlich geschrieben wurde. Ist dies nicht gesetzt (Standard), zählt jeder Frame.

### Kosten eines Schreibvorgangs und Limits

Da jeder Frame eine Abfrage ist, die als der jeweilige Abonnent ausgeführt wird, steigen die Kosten eines Schreibvorgangs
mit der Anzahl der **unterschiedlichen Abfragen, die von unterschiedlichen Principals** auf der
betroffenen Tabelle gestellt werden – nicht mit der Anzahl der offenen Sockets:

- Abonnements, die dieselbe Frage (gleicher Pfad, Filter, Sortierung, Seite,
  `include`, `fields`, Suche) als derselbe Principal (gleiche Benutzer-ID, Rollen,
  Gast-Flag und Claims) stellen, teilen sich ein Refetch. Ein Schreibvorgang in eine Liste kostet
  **eine Transaktion pro solcher Gruppe** – den Lesevorgang und seine Zählung –, unabhängig davon, wie viele Sockets
  sie halten; jedes Mitglied erhält dennoch einen Frame, der aus den unter dieser
  Identität gelesenen Zeilen erstellt wurde. Eine erste Seite, die kürzer als ihr `limit` zurückkehrt, stellt den
  gesamten Datensatz dar und wird daher gar nicht erst gezählt.
- Ein Einzeldatensatz-Abonnement wird nur abgefragt, wenn sich sein eigener Datensatz ändert.
- Eine Liste, die mit `==` oder `in` auf eine Spalte der Tabelle gefiltert ist, wird nur abgefragt,
  wenn der Schreibvorgang sie betreffen kann: wenn die Zeile vor dem
  Schreibvorgang dem Filter entsprach oder ihm danach entspricht. Ein von fünftausend Benutzern gehaltenes
  `listen({ where: { owner: ["==", me] } })` kostet einen Lesevorgang, wenn einer von ihnen eine eigene
  Zeile schreibt, nicht fünftausend. Dies bestimmt nur, *wer* neu abruft, niemals, was
  jemand erhält: Jede abgefragte Liste liest weiterhin unter dem Scope ihres eigenen
  Abonnenten, sodass eine Liste, die nach den Zeilen eines anderen fragt, nichts findet, was ihre Policy verbirgt.
- Unterschiedliche Principals teilen sich niemals einen Lesevorgang – dadurch wird verhindert, dass
  ein Frame eine Zeile enthält, die sein Leser nicht sehen darf. Eine Liste, die allein durch RLS eingegrenzt wird
  (dieselbe ungefilterte Liste, beobachtet von tausend verschiedenen angemeldeten Benutzern), bedeutet
  bei jedem Schreibvorgang tausend Lesevorgänge in tausend Transaktionen.

Der Vorfilter fragt wie bisher jede Liste auf der Tabelle an, sobald nicht sicher
ausgeschlossen werden kann, dass eine Liste unberührt bleibt:

- Er wertet `==` und `in` auf Text-, `varchar`-, UUID-, Enum-, Integer- und Boolean-Spalten
  aus. Andere Bedingungen (Bereiche, Muster, JSON-Pfade, Relationen, `or(...)`-Gruppen,
  Suche) bleiben außen vor, was die Treffermenge lediglich erweitert. Eine Liste,
  die Relationen lädt (`include`), eine Tabelle mit einem `afterRead`-Hook und eine Spalte
  mit einem Hook auf Feldebene werden niemals vorgefiltert.
- Er benötigt die Werte der Zeile vor und nach dem Schreibvorgang. Ein Schreibvorgang über die
  API liefert diese bei einem Create sowie bei einem Update, das die Zeile zuvor gelesen hat
  (jedes REST-Update tut dies). Eine aus dem WAL gelesene Änderung (`REALTIME_CDC=wal` oder
  `auto`, sofern das WAL verfügbar ist) liefert die gesamte neue Zeile, die alte
  jedoch nur als Schlüssel, es sei denn, die Tabelle hat `REPLICA IDENTITY FULL` – ein
  externes `UPDATE` oder `DELETE` einer Nicht-Schlüsselspalte fragt daher jede Liste an. Der
  Erfassungs-Trigger (`REALTIME_CDC=trigger`) sendet ausschließlich den Schlüssel; er kann daher nur
  Listen ausschließen, die nach dem Schlüssel gefiltert sind. Ein Löschvorgang über die API sowie ein Schlüssel,
  der zu groß für eine Notification ist, fragen jede Liste an.

Gemessen auf einem Laptop gegen PostgreSQL 18 in Docker mit einem Verbindungspool von 20 Verbindungen
(`tooling/scripts/bench-realtime-fanout.mts`) bei einem Schreibvorgang auf eine Tabelle, deren
Policy jedem Benutzer nur die eigenen Zeilen anzeigt:

| Abonnenten auf der Tabelle | Transaktionen für den Schreibvorgang | Fan-out nach dem Schreibvorgang abgeschlossen |
|----------------------------|--------------------------------------|-----------------------------------------------|
| 5.000 Benutzer, jeweils `where owner == me`, Schreibvorgang über API | 1 | ~305 ms |
| 5.000 Benutzer, jeweils `where owner == me`, Raw-SQL aus WAL gelesen | 1 | ~307 ms |
| 5.000 Sockets eines Benutzers, eine Liste | 1 | ~311 ms |
| 1.000 Benutzer, dieselbe ungefilterte Liste | 1.000 | ~780 ms |
| 5.000 Benutzer, dieselbe ungefilterte Liste | 5.000 | ~2,6 s |

300 ms entfallen jeweils auf das Debounce. Die letzten beiden Zeilen stellen das Limit dar, das einzuplanen ist:
Eine Liste, die ausschließlich durch RLS eingeschränkt wird, kostet einen Lesevorgang pro eindeutigem Benutzer und Schreibvorgang. Die
Refetches laufen über denselben Pool wie Ihr REST-Traffic, belegen jedoch maximal ein Viertel
seiner Verbindungen gleichzeitig (5 der standardmäßigen 20, niemals weniger als 2); der Rest
wartet im Server, sodass der Fan-out eines Schreibvorgangs eher seine eigenen Frames verzögert
als Ihre Anfragen. Bei einer Tabelle, in die mehrmals pro Sekunde geschrieben wird, während
**Tausende verschiedener Benutzer** dieselbe ungefilterte Liste beobachten, geraten diese
Frames ins Hintertreffen. Filtern Sie das Abonnement auf die Spalte, die Ihre Policy prüft
(`where owner == me` neben `owner = app.uid`), und es kostet wieder nur einen Lesevorgang; oder
nutzen Sie einen [Broadcast-Kanal](#broadcast-channels), der die Änderung übermittelt, damit Clients
sie nach eigenem Zeitplan neu abrufen können.

**Ein Socket darf maximal 1.000 Abonnements halten.** Das nächste wird mit einem Fehler-Frame mit dem Code `TOO_MANY_SUBSCRIPTIONS` abgelehnt; ein erneutes Abonnieren unter einer ID, die der Socket bereits hält, ersetzt dieses Abonnement und wird nicht erneut gezählt. Das SDK fasst identische Abonnements auf einem Socket zusammen, sodass hier die verschiedenen Listen und Datensätze gezählt werden, die eine Seite geöffnet hat. Ändern Sie dies mit `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` oder `realtime.maxSubscriptionsPerSocket` auf dem Postgres-Adapter (die Umgebungsvariable hat Vorrang); ein Wert, der keine positive ganze Zahl ist, stoppt den Server beim Start. **Die Anzahl der Sockets, die ein Benutzer hält, kann ebenfalls begrenzt werden**, und zwar pro Server-Instanz: Setzen Sie `REALTIME_MAX_SOCKETS_PER_USER` (oder `realtime.maxSocketsPerUser`). Ein darüber hinausgehender Anmeldeversuch wird mit `TOO_MANY_SOCKETS` abgewiesen und der Socket mit 4002 geschlossen. Sockets, die mit einem API-Schlüssel angemeldet sind, zählen für diesen Schlüssel – jeder Schlüssel separat – und nicht für das Konto, das ihn erstellt hat; der Service-Key ist eine einzelne Anmeldeinformation, daher zählen alle seine Sockets zusammen. Die Sockets eines Administrators, die einen Benutzer imitieren (Impersonation), zählen für den Administrator mit seinen eigenen Sockets, nicht für den imitierten Benutzer. Das SDK benachrichtigt jedes aktive Abonnement und `onConnectionLost` sofort mit einem `CONNECTION_LOST`-Fehler, dessen `details.reason` auf `TOO_MANY_SOCKETS` gesetzt ist, und versucht es weiter mit längeren Wartezeiten bis zu 30 s, sodass der Tab verbunden wird, sobald ein anderer Socket schließt. Ist dies nicht gesetzt (Standard), gibt es keine Obergrenze.

Eine Abonnement-ID gehört dem Socket selbst: Zwei Clients, die ein Abonnement beide `"sub-1"` nennen, behalten jeweils ihres, und ein `unsubscribe` beendet nur das des Absenders.

**Abonnieren wird auf das Daten-Ratenlimit angerechnet.** Der erste Frame eines Abonnements ist ein Lesevorgang, der im Namen des Abonnenten ausgeführt wird, ebenso wie die Historienabfrage eines Kanals. Daher zählen `subscribe_collection`, `subscribe_one` und `channel_history` als Datenanfragen im Rate-Limit-Bucket des Aufrufers (den sich seine HTTP-Anfragen und seine anderen Sockets teilen), sobald das socket-eigene Kontingent aufgebraucht ist. Jeder Socket darf 1.000 davon senden, ohne dass sie angerechnet werden, oder so viele wie sein Abonnement-Limit, sofern dieses höher ist; das Kontingent regeneriert sich über 15 Minuten. Dies deckt alles ab, was ein Socket halten kann, sodass das erneute Abonnieren nach einem Reconnect niemals verweigert wird und das Budget der Person nicht belastet. Bei Überschreitung des Kontingents wird ein Frame über dem Limit mit dem Fehlercode `RATE_LIMITED` abgelehnt, den das SDK an das `onError` dieses Abonnements oder an das des Kanals weiterleitet.

### Sockets, die nicht mehr antworten

Ein Client kann verschwinden, ohne seinen Socket ordnungsgemäß zu schließen: Ein Smartphone verliert
den Empfang, ein Laptop wechselt in den Ruhezustand, ein NAT vergisst die Verbindung. Es trifft kein Close-Frame
ein, sodass der Server nicht benachrichtigt wird. Der Server pingt daher jeden Socket
alle 30 Sekunden an und beendet Verbindungen, die bis zum nächsten Ping nicht geantwortet haben, sodass
ein verschwundener Client innerhalb einer Minute freigegeben wird. Browser und das SDK antworten
selbstständig auf Pings; ein Client, der das Protokoll direkt spricht, muss ebenfalls darauf
antworten, wie es die meisten WebSocket-Bibliotheken handhaben.

**Die Browser-Seite.** Ein Browser kann weder einen Ping senden noch einen sehen; ein halb offener Socket wirkt für ihn daher dauerhaft verbunden. Das SDK öffnet den Socket mit `?rebase_caps=heartbeat,channel_seq,cancel_sql`. Ein Server, der diese Parameter kennt, antwortet mit `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listet die unterstützten Fähigkeiten auf (`cancel_sql`: er verarbeitet den `CANCEL_SQL`-Frame der SQL-Konsole) und sendet alle 30 Sekunden `{"type":"heartbeat"}`. Das SDK schließt den Socket und [verbindet sich neu](#auto-reconnect), wenn zwei Heartbeats verpasst wurden. Ein Client, der keine Fähigkeiten angibt, erhält keines von beiden, und ein älterer Server ignoriert den Parameter, sodass sich ein SDK im Zusammenspiel mit ihm wie gewohnt verhält.

Ein Socket wird auch dann beendet, wenn mehr als 16&nbsp;MiB an an ihn gesendeten Frames noch
ungelesen sind. Dies betrifft Clients, die empfangene Daten nicht verarbeiten oder so weit
hinterherhinken, dass die zu lesenden Daten veraltet sind. Und wenn alle Sockets eines Servers zusammen
mehr als 256&nbsp;MiB ungelesene Daten halten (oder ein Viertel des Speicherlimits, unter dem der Server
läuft, falls dieser Wert geringer ist), werden diejenigen mit den meisten ungelesenen Daten zuerst
beendet, bis der Rest wieder passt.

Ein beendeter Socket wird wie ein regulär geschlossener Socket bereinigt. Seine Abonnements enden, er
verlässt seine Kanäle und seine Presence wird entfernt, wobei das Verlassen den
anderen Mitgliedern mitgeteilt wird. Ein Client, der noch erreichbar ist, stellt den Verbindungsabbruch fest,
woraufhin sich das SDK [automatisch neu verbindet](#auto-reconnect) und die Abonnements erneuert.

## Broadcast Channels

Broadcast Channels ermöglichen es Clients, beliebige Nachrichten in Echtzeit untereinander auszutauschen – nützlich für Funktionen wie Tipp-Indikatoren, Cursor-Positionen oder benutzerdefinierte Benachrichtigungen.

Das Broadcasting wird auf WebSocket-Protokollebene verwaltet. Der Server unterstützt folgende Nachrichtentypen:

| Nachrichtentyp   | Richtung        | Beschreibung                             |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Einem benannten Kanal beitreten          |
| `leave_channel`   | Client → Server | Einen Kanal verlassen                    |
| `broadcast`       | Client → Server | Nachricht an alle Kanalmitglieder senden |
| `broadcast`       | Server → Client | Nachricht von einem anderen Mitglied empfangen |
| `channel_history` | Client → Server | Gespeicherte Nachrichten nach einer Sequenz abrufen |
| `channel_history` | Server → Client | Die gespeicherten Nachrichten, die ein Client verpasst hat |

Sendet ein Client eine `broadcast`-Nachricht, leitet der Server diese an **alle anderen Mitglieder** dieses Kanals weiter (der Absender erhält seine eigene Nachricht nicht).

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

## Channel Retention (Nachrichtenaufbewahrung)

Standardmäßig erreicht ein Broadcast die aktuell verbundenen Mitglieder und verfällt danach. Dies ist der richtige Kompromiss für Benachrichtigungen und Cursor und verursacht keine Kosten.

Für einen Operations-Stream – kollaboratives Bearbeiten, oder überall dort, wo eine unbemerkte Lücke zu Inkonsistenzen führt – kann ein Kanal so konfiguriert werden, dass er seine Nachrichten **aufbewahrt (retains)**. Aufbewahrte Broadcasts erhalten eine kanalspezifische Sequenznummer und werden gespeichert, sodass ein Client bei einem Reconnect alles abrufen kann, was nach der zuletzt gesehenen Nachricht lag.

:::caution[Wo dies konfiguriert wird]
**Managed Runtime: Nirgends.** Channel Retention und `realtime.bus` sind Teil
des Datenbankadapters, den die Managed Runtime selbst erstellt; für keines von beiden gibt es
eine Umgebungsvariable. Ejecten Sie, um sie zu konfigurieren.
**Ejected:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
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

| Feld    | Beschreibung                                                                |
|---------|-----------------------------------------------------------------------------|
| `match` | Exakter Kanalname (`"doc:42"`) oder Präfix mit abschließendem `*` (`"doc:*"`) |
| `limit` | Maximal so viele der neuesten Nachrichten pro Kanal behalten                |
| `ttl`   | Nachrichten maximal so lange behalten – `"30s"`, `"15m"`, `"24h"`, `"7d"` oder Millisekunden |

Eine Regel benötigt mindestens `limit` oder `ttl`. Eine Regel ohne beides wird ignoriert und geloggt, da eine unbegrenzte Speicherung fast nie beabsichtigt ist und nach dem Anwachsen der Tabelle nicht mehr rückgängig gemacht werden kann.

:::note[Warum fragen Clients die Historie nicht selbst an?]
Ein Kanal wird von demjenigen erstellt, der ihn benennt. Wenn ein Client seine eigene Historientiefe bestimmen könnte, könnte jeder Besucher Ihr Backend zu unbegrenztem Speicherplatz zwingen. Die Konfiguration an dieser Stelle sorgt zudem dafür, dass Presence- und Benachrichtigungskanäle – die überwiegende Mehrheit – keine Ressourcen kosten: Ohne konfigurierte Regeln wird keine Tabelle erstellt und das Broadcasting läuft über denselben synchronen Pfad wie gewohnt.
:::

### Speicherung

Aufbewahrte Kanäle verwenden zwei Tabellen im Schema `rebase`, die beim Start automatisch angelegt werden, sobald mindestens eine Regel konfiguriert ist:

| Tabelle                   | Inhalt                                                          |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | Die aufbewahrten Nachrichten, indiziert nach `(channel, seq)`   |
| `rebase.channel_cursors`  | Die höchste pro Kanal vergebene Sequenznummer                   |

Das Bereinigen (Pruning) erfolgt beim Eintreffen von Nachrichten, gedrosselt pro Kanal, sodass die Kosten eher der verstrichenen Zeit als dem Schreibvolumen folgen. Es werden ausschließlich Zeilen aus `channel_messages` entfernt – Cursor werden unbegrenzt aufbewahrt (sie belegen eine kleine Zeile pro Kanal), da ein Neustart der Kanal-Sequenz die Bedeutung des gespeicherten Wiederaufsetzpunkts eines Clients verändern würde.

### Zustellungsgarantien

- **Geordnet (Ordered).** Sequenznummern werden pro Kanal vergeben, und die Zustellreihenfolge entspricht der Sequenzreihenfolge – auf einer Instanz sowie instanzübergreifend auf dem `postgres`-Bus, wo der Befehl zur Nummerierung einer Nachricht diese auch ankündigt. Somit erhalten alle Instanzen (inklusive der des Absenders) die Ankündigungen in Sequenzreihenfolge. Ein selbst bereitgestellter Bus liefert Frames in der Reihenfolge aus, in der er sie empfängt.
- **Dauerhaft vor Zustellung (Durable before delivered).** Eine Nachricht, die nicht gespeichert werden kann, wird an niemanden zugestellt, und der Absender wird benachrichtigt. Eine Zustellung würde sie aktiven Abonnenten präsentieren, sie jedoch bei künftigen Replays auslassen, und keine spätere Nachricht könnte diese Lücke schließen.
- **At-least-once beim Aufholen (Catch-up).** Ein Replay-Bereich kann sich mit Nachrichten überschneiden, die ein Client bereits empfangen hat; das SDK verwirft bereits zugestellte Nachrichten.
- **Keine Lücken (No holes).** Eine aufbewahrte Nachricht erreicht jedes Mitglied: Dem Absender, der seine eigene Nachricht nie erhält, wird stattdessen `{"type":"broadcast_ack","channel","seq"}` zugestellt, sofern er `channel_seq` aktiviert hat. Eine Nachricht nach `lastSeq + 1` bedeutet folglich, dass eine Nachricht verpasst wurde; das SDK hält diese zurück, fordert die dazwischenliegende Historie an und stellt alle lückenlos in der richtigen Reihenfolge zu. Bei einem Server ohne `channel_seq` wird ein Sprung so zugestellt, wie er eintrifft.

:::caution[Die Historie hat dasselbe Zugriffsmodell wie der Kanal]
Ein Client, der einem Kanal beigetreten ist, kann dessen gespeicherte Nachrichten erneut abspielen – auch solche, die vor seinem Beitritt gesendet wurden. Die Mitgliedschaft ist die einzige Überprüfung, und der Beitritt steht jedem Client offen, der den Kanalnamen kennt. Da die Aufbewahrung pro Kanalmuster aktiviert wird, macht ihre Aktivierung die Historie des Kanals für jeden Besucher lesbar, der den Namen errät. Bei aufbewahrten Kanälen wird dies dauerhaft statt flüchtig; behandeln Sie die Inhalte eines aufbewahrten Kanals daher als öffentlich für Ihre Benutzer.
:::

## Presence Tracking

Presence verfolgt, welche Benutzer in einem Kanal aktuell online sind, und ermöglicht es jedem Benutzer, einen benutzerdefinierten Status zu teilen (z. B. Cursorposition, Online-Status).

| Nachrichtentyp     | Richtung        | Beschreibung                                         |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Presence-Tracking mit individuellem Status starten   |
| `presence_untrack`| Client → Server | Presence-Tracking beenden                            |
| `presence_state`  | Client → Server | Vollständigen Presence-Status für einen Kanal anfordern |
| `presence_state`  | Server → Client | Vollständige Presence-Daten aller Mitglieder im Kanal |
| `presence_diff`   | Server → Client | Inkrementelles Update (Beitritte und Austritte)      |

Sendet ein Client `presence_track`, fügt der Server ihn automatisch dem Kanal hinzu (kein separates `join_channel` erforderlich) und sendet ein `presence_diff` per Broadcast an alle Kanalmitglieder. Das SDK sendet seinen Zustand etwa alle 20 Sekunden als Heartbeat erneut; ein Heartbeat mit unverändertem Status erneuert lediglich das Timeout des Clients und sendet kein `presence_diff`.

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

## Auto-Reconnect

Das typisierte SDK stellt die Verbindung automatisch wieder her, wenn die WebSocket-Verbindung abbricht:

- **Exponentielles Backoff** – Jeder Neuverbindungsversuch wartet ein Intervall ab, das bei 2 Sekunden beginnt und sich jedes Mal bis auf maximal 30 Sekunden verdoppelt. Die Verzögerung wird zufällig innerhalb dieses Intervalls gewählt (Jitter), beträgt jedoch nie weniger als eine Viertelsekunde. Dadurch bauen Clients, die durch ein Deployment gleichzeitig getrennt wurden, ihre Verbindungen zeitlich versetzt über das gesamte Intervall verteilt auf anstatt exakt im selben Moment.
- **Kein Aufgeben bei aktiven Abonnements** – Solange ein Abonnement oder ein beigetretener Kanal existiert, versucht der Client für die gesamte Dauer des Ausfalls im 30-Sekunden-Takt weiter, die Verbindung wiederherzustellen. Ist nichts registriert, bricht er nach 5 fehlgeschlagenen Versuchen ab; das nächste Abonnement stößt den Verbindungsaufbau erneut an. Im Browser führen das `online`-Event sowie das Wieder-Sichtbarwerden des Tabs zu einem sofortigen Wiederverbindungsversuch, anstatt das Backoff abzuwarten.
- **Ausfälle werden einmalig gemeldet** – Sobald die Verbindung für 14 Sekunden unterbrochen war (unabhängig von der Anzahl der Versuche), erhält das `onError` jedes aktiven Abonnements und jedes beigetretenen Kanals genau einen `RebaseApiError` mit dem Code `CONNECTION_LOST`. Das Abonnement bleibt **erhalten**: Der Fehler signalisiert lediglich, dass Daten aktuell nicht aktualisiert werden, nicht, dass das Abonnement beendet wurde.
- **Automatische erneute Abonnements** – Nach erfolgreicher Wiederverbindung werden alle aktiven Abonnements erneut beim Server registriert, und das nächste `onUpdate` jedes Abonnements liefert alle Änderungen nach, die während der Abwesenheit des Clients geschrieben wurden. Dieses Update dient als Signal für die Wiederherstellung. Kein manuelles Eingreifen erforderlich.
- **Anfragen sind At-most-once** – Eine Anfrage, die bei unterbrochenem Socket gestellt wird, wartet bis zu 30 Sekunden ab dem Aufruf auf die Wiederherstellung und schlägt dann mit `REQUEST_TIMEOUT` fehl, ohne jemals gesendet worden zu sein. Eine Anfrage, die beim Verbindungsabbruch bereits gesendet war, schlägt mit `CONNECTION_LOST` fehl und wird **nicht** erneut gesendet: Der Server könnte sie bereits ausgeführt haben oder nicht, und nur der Aufrufer weiß, ob eine wiederholte Ausführung sicher ist.

`client.ws.state` spiegelt den aktuellen Zustand der Verbindung wider, und `onStateChange` informiert über jede
Änderung:

| Zustand | Bedeutung |
|---|---|
| `idle` | Kein Socket vorhanden und noch keiner angefordert (Verbindungsaufbau erfolgt lazy) oder durch Abmeldung beendet. |
| `connecting` | Verbindungsaufbau läuft, kein Ausfall aktiv. |
| `connected` | Der Socket ist geöffnet. |
| `reconnecting` | Die Verbindung ist abgebrochen und der Client wählt sich neu ein. Es wurde noch kein Ausfall gemeldet. |
| `disconnected` | Der Ausfall dauert 14 Sekunden oder länger. `CONNECTION_LOST` wurde gemeldet, und der Client versucht weiterhin, sich zu verbinden. |
| `closed` | `client.close()` wurde aufgerufen. Endgültiger Zustand. |

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

Das Rebase-Admin-Interface blendet ein eigenes Banner ein, während der Zustand `disconnected` ist, und behält die bereits angezeigten Zeilen und Datensätze auf dem Bildschirm bei, anstatt sie durch eine Fehlermeldung zu ersetzen.

## Authentifizierung & RLS

WebSocket-Abonnements beachten automatisch Row-Level Security (RLS) Policies. Sobald der Client authentifiziert ist:

1. Die WebSocket-Verbindung authentifiziert sich mit demselben JWT-Token wie die REST-API.
2. Jedes Refetch eines Abonnements läuft innerhalb einer PostgreSQL-Transaktion mit `set_config('app.user_id', ...)` und `set_config('app.user_roles', ...)` ab – wodurch sichergestellt ist, dass RLS-Policies greifen.
3. Die Identität wird während der gesamten Laufzeit des Sockets kontinuierlich überprüft, nicht nur beim Verbindungsaufbau. Vor jedem Frame prüft der Server analog zu einer HTTP-Anfrage: Ist das Token noch gültig, wurde die Sitzung abgemeldet oder widerrufen, existiert das Konto noch und welche Rollen hält es aktuell. Kanalframes werden maximal einmal pro Sekunde geprüft. Frames, die auf einem Socket eintreffen, während dessen Überprüfung noch läuft – etwa wenn ein Client nach einem Reconnect seine Abonnements gebündelt sendet –, teilen sich diese Prüfung, anstatt sie jeweils neu auszuführen; der nächste Frame nach Abschluss stößt eine frische Prüfung an. Ein Socket, der nur lauscht, wird mindestens alle 30 Sekunden geprüft, und ein Token wird ab dem Moment seines Ablaufs nicht mehr akzeptiert. Eine entzogene Rolle greift ab dem nächsten Frame (oder bei einem Frame, der eine bereits laufende Prüfung mitgenutzt hat, ab dem übernächsten) gleichermaßen für Lese-, Schreibvorgänge und offene Abonnements. Ein Socket, dessen Identität abgelaufen ist, erhält einen `AUTH_ERROR`-Frame und wird mit dem Code `4001` geschlossen. Bei der integrierten Authentifizierung gibt der Code des Frames den Grund analog zu den HTTP-Routen an: `SESSION_REVOKED` (abgemeldet, widerrufen oder Konto gelöscht), `ACCOUNT_DISABLED` oder `TOKEN_EXPIRED`; bei anderen Auth-Adaptern lautet er `SESSION_ENDED`. Ein `AUTHENTICATE` für eine widerrufene Sitzung oder ein deaktiviertes Konto wird mit `SESSION_REVOKED` oder `ACCOUNT_DISABLED` abgewiesen (ein ungültiges oder abgelaufenes Token mit `INVALID_TOKEN`). Das SDK sendet keine erneute Anfrage mit demselben Token und übergibt die Ablehnung samt Fehlercode an das `onError` der jeweiligen Operation. Das SDK authentifiziert seinen Socket bei jedem Token-Refresh neu; ein neues Token für dieselbe Identität (gleiche Benutzer-ID, Rollen, Gast-Flag und Claims) belässt die offenen Abonnements wie sie sind, während ein Token für eine andere Identität jedes davon in dessen Kontext neu abruft. Nach einem Fehler `4001` verbindet sich das SDK mit der dann vorliegenden Sitzung neu oder ohne Sitzung. Ein Client, der das Protokoll direkt anspricht, muss vor Ablauf des alten Tokens ein frisches Token via `AUTHENTICATE` senden.

Dies stellt sicher, dass jeder Socket nur Aktualisierungen für Datensätze erhält, die seine authentifizierte Identität sehen darf.

Ein [API-Schlüssel](/docs/backend/api-keys/) authentifiziert den Socket ebenfalls: Senden Sie
den `rk_…`-Schlüssel an der Stelle, an der sonst das Access Token übergeben wird. Der Socket gleicht daraufhin jeden Frame
mit den [Scopes](/docs/backend/roles-and-scopes/) des Schlüssels ab: Ein Fetch, ein Count oder ein
Abonnement erfordert `data:read` auf der jeweiligen Tabelle, ein Speichervorgang `data:write`, ein Löschvorgang
`data:delete`. Ein verschachtelter Pfad erfordert den Basisscope. Kanäle (Broadcast und
Presence) werden bei Verwendung eines Schlüssels abgewiesen, da kein Scope sie abdeckt. Der SQL-Editor und
Branch-Nachrichten erfordern sowohl für Schlüssel als auch für Personen `database:read` bzw. `database:write`.

Der Betrieb mehrerer Instanzen – der LISTEN/NOTIFY-Bus, das Verhalten von Presence
über Prozesse hinweg und das Schreiben eigener Transports – wird auf einer separaten Seite beschrieben:
[Realtime über mehrere Instanzen](/docs/backend/realtime-transports/).

## Änderungserfassung auf Datenbankebene (CDC)

Jeder committete Schreibvorgang löst Realtime-Events aus, unabhängig davon, wie er vorgenommen wurde: REST,
SDK, Studio, `psql` oder ein Cron-Job in einem anderen Dienst. Details zur Funktionsweise der Erfassung, der
Einstellung `REALTIME_CDC` und den Voraussetzungen finden Sie unter: [Datenbank-Änderungserfassung (CDC)](/docs/backend/realtime-cdc/).

## Timeout für ausstehende Anfragen (Pending Request Timeout)

Um zu verhindern, dass Client-Anfragen unbegrenzt hängen bleiben, besitzen alle ausstehenden WebSocket-Operationen, die eine Server-Antwort erwarten (wie einmalige Tabellenabfragen `FETCH_COLLECTION`, Abfragen einzelner Entitäten `FETCH_ONE`, Erstellen/Aktualisieren `SAVE`, Löschungen `DELETE`, Zählungen `COUNT` und Eindeutigkeitsprüfungen `CHECK_UNIQUE_FIELD`), ein Standard-Timeout von 30 Sekunden.

Antwortet der Server nicht innerhalb dieses 30-Sekunden-Fensters, verwirft der Client die ausstehende Anfrage automatisch und weist das Promise mit einem `RebaseApiError` und dem Fehlercode `REQUEST_TIMEOUT` ab.

Unidirektionale Nachrichten, die keine Antwort erwarten (wie `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` und `channel_history`), resolven sofort nach dem Senden und lösen dieses Timeout nicht aus. Ein Abonnement, dessen erster Frame 30 Sekunden nach dem Absenden des Abonnements noch nicht eingetroffen ist, schlägt stattdessen mit `SUBSCRIPTION_TIMEOUT` in seinem `onError` fehl.

### Wann ein Channel-Frame abgewiesen wird

Ein Channel-Frame folgt dem Fire-and-Forget-Prinzip: `await channel.broadcast(...)` resolved, sobald
der Frame in den Socket geschrieben wurde, **nicht** erst, wenn der Server ihn akzeptiert hat. Das
ist beabsichtigt – eine kollaborative App sendet sechzig Mal pro Sekunde eine Cursorposition per Broadcast,
und das Warten auf eine Bestätigung würde jede einzelne Aktion zu einem Roundtrip machen.

Eine Ablehnung kann daher nicht als abgewiesenes Promise (rejected Promise) erfolgen. Sie wird über `onError` zugestellt:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Bedeutung |
|------|-----------|
| `CHANNEL_FORBIDDEN` | Sie sind kein Mitglied des Kanals – treten Sie ihm bei, bevor Sie Nachrichten senden oder dessen Historie lesen |
| `RATE_LIMITED` | Das Frame-Budget des Kanals wurde überschritten (7.200 Channel-Frames pro Minute pro Socket) oder, bei einer Historienabfrage, das [Daten-Ratenlimit](#kosten-eines-schreibvorgangs-und-limits) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Ein aufzubewahrender Broadcast konnte nicht persistent gespeichert werden und wurde verworfen |
| `CHANNEL_HISTORY_READ_FAILED` | Eine Catch-up-Anfrage konnte nicht bedient werden |
| `CHANNEL_HISTORY_GAP` | Vom Client ausgelöst: Beim Catch-up wurde festgestellt, dass der Server Nachrichten nicht mehr vorhält, die dieser Client nie empfangen hat. `details` liefert `{ from, to }` mit den verpassten Sequenznummern. Synchronisieren Sie den Status des Kanals anhand seiner Single Source of Truth neu |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Der Broadcast hat nur diese Instanz erreicht – siehe [Das 8-KB-Limit auf dem Postgres-Bus](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Ist kein Handler registriert, werden diese Ereignisse als Warnung geloggt. Früher wurden
sie vollständig verworfen: Da es kein abzuweisendes Promise und keinen Zielkanal gab,
war ein unzulässiger Broadcast nicht von einem erfolgreich zugestellten zu unterscheiden.

## Nächste Schritte

- [Typisiertes SDK](/docs/sdk) – Vollständige SDK-Referenz inklusive typisierter Tabellenzugriffe.
- [Authentifizierung](/docs/backend/authentication) – JWT-Authentifizierung und RLS-Policies einrichten.
- [Backend-Architektur](/docs/backend) – Übersicht über die Architektur des Rebase-Servers.

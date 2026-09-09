---
sourceHash: f49369700dcdc098
title: Realtime-Abonnements
sidebar_label: Realtime
description: Abonnieren Sie Live-Datenänderungen mit dem Rebase Client SDK über WebSocket-basierte Realtime-Listener.
---

## Übersicht

Das Rebase Client SDK bietet Echtzeit-Datenabonnements über WebSocket. Wenn sich Datensätze auf dem Server ändern, werden Ihre abonnierten Callbacks sofort mit den aktualisierten Daten ausgelöst.

Die WebSocket-Verbindung wird automatisch aufgebaut, sobald eine `websocketUrl` verfügbar ist (standardmäßig von `baseUrl` abgeleitet). Die Wiederverbindung und die Token-Aktualisierung werden transparent gehandhabt.

## Abonnieren einer Collection

Verwenden Sie `listen()`, um eine Collection-Abfrage zu abonnieren. Der Callback wird ausgelöst, sobald sich die übereinstimmende Datenmenge ändert:

```typescript
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        console.log("Products updated:", response.data);
        console.log("Total:", response.meta.total);
    }
);

// Stop listening when done
unsubscribe();
```

Die Methode `listen()` akzeptiert dieselben `FindParams` wie `find()` – Sie können Ihr Abonnement filtern, sortieren und paginieren:

```typescript
const unsubscribe = client.data.orders.listen(
    {
        where: { status: ["==", "pending"] },
        orderBy: ["createdAt", "desc"],
        limit: 20
    },
    (response) => {
        renderOrders(response.data);
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### Signatur

```typescript no-verify
listen(
    params: FindParams<M> | undefined,
    onUpdate: (result: FindResult<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

`FindResult<M>` hat dieselbe Struktur, die auch `find()` zurückgibt: flache Zeilen in `data` und `{ total, limit, offset, hasMore, nextCursor }` in `meta`.

### `listen()` akzeptiert das Gleiche wie `find()`

`params` ist ein vollständiges `FindParams`-Objekt. Ein Abonnement ist dieselbe Abfrage wie das dazugehörige `find()`, daher akzeptiert es dieselben Einschränkungen – `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** und **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Das ist wichtiger, als es klingt. Früher wurden `include` und `fields` hier stillschweigend verworfen, sodass dieselbe Abfrage über `find()` in einer Struktur und über `listen()` in einer anderen beantwortet wurde – und eine Komponente, die beides renderte, sah, wie sich die Form ihrer Zeilen in dem Moment änderte, in dem ein Schreibvorgang eintraf. Nun durchlaufen sie die identische Lese-Pipeline, sodass `find({ q })` und `listen({ q })` Zeilen zurückgeben, die Feld für Feld übereinstimmen.

Die Ausnahme ist `vectorSearch`, was **abgelehnt** statt verworfen wird: Ein Abonnement wird bei jedem passenden Schreibvorgang erneut ausgeführt, und dabei werden keine Distanzen berechnet. Verwenden Sie `.vectorSearch(…).find()` für die Abfrage und abonnieren Sie ohne diese Option.

### Eine Auslieferung pro Änderung

Jeder Server-Push ruft Ihren Callback **einmal** auf, mit Metadaten, die die dazugehörigen Zeilen beschreiben. Es gibt keine separate First-Paint-Auslieferung und kein Flag, das geprüft werden müsste.

Die Metadaten treffen **im selben Frame wie die Zeilen** ein: Der Server zählt die Abfrage innerhalb derselben Row-Level-Security-gebundenen Transaktion, die sie gelesen hat, sodass `meta.total`, `meta.hasMore` und `meta.nextCursor` exakt die Zeilen daneben beschreiben. (Früher folgte auf jeden Push ein `GET /count` vom Client – ein zusätzlicher Roundtrip pro Schreibvorgang und Abonnent, und ein Zeitfenster, in dem die Anzahl und die Zeilen unterschiedliche Zustände der Collection beschrieben.)

Zwei Fallbacks, von denen keiner ein Abonnementfehler ist und keiner `onError` aufruft:

- Wenn das **Zählen auf dem Server fehlgeschlagen ist**, enthält der Frame keine Gesamtzahl und der zuletzt eingetroffene Wert wird wiederverwendet. Ein fehlgeschlagener Zählvorgang sagt nichts darüber aus, wie groß die Collection ist, daher darf er keine echte Antwort überschreiben.
- Wenn für dieses Abonnement noch nie eine Gesamtzahl eingetroffen ist – etwa bei einem älteren Server, der überhaupt keine Metadaten sendet –, fragt der Client einmalig beim ersten Push nach. Wenn auch das fehlschlägt, ist `meta.total` eine **untere Grenze**: die Zeilen auf dieser Seite plus die Zeilen, an denen vorbeigeblättert wurde, um sie zu erreichen.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Abonnieren einer einzelnen Entität

Verwenden Sie `listenById()`, um einen bestimmten Datensatz anhand seiner ID zu beobachten:

```typescript
// The SDK hands back a flat row, not an `Entity` — there is no `.values`.
const unsubscribe = client.data
    .collection<{ id: number; name: string }>("products")
    .listenById(
    42,
    (product) => {
        if (product) {
            console.log("Product changed:", product.name);
        } else {
            console.log("Product was deleted");
        }
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### Signatur

```typescript no-verify
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

Der Callback empfängt eine flache Zeile – keine `Entity`, es gibt also kein `.values` – und `undefined`, wenn der Datensatz gelöscht wird.

## Fluent Query Builder

Sie können ein Abonnement auch über den Fluent Query Builder erstellen. Dies entspricht dem Aufruf von `listen()` mit Parametern, ermöglicht es Ihnen jedoch, Methoden wie `.where()`, `.orderBy()` usw. zu verketten:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(20)
    .listen(
        (response) => console.log("Updated:", response.data),
        (error) => console.error("Error:", error)
    );
```

Ein Abonnement unterstützt wie jede andere Abfrage eine Sortierung über mehrere Spalten – entweder `orderBy: [["category", "asc"], ["createdAt", "desc"]]` in den Parametern oder einen zweiten `.orderBy()`-Aufruf, der ein weiteres Sortierkriterium (Tie-Breaker) hinzufügt, statt das erste zu ersetzen. Siehe [Sortierung](/docs/sdk/querying#sorting).

Der Server prüft die *Struktur* des `orderBy` eines Abonnements beim Eintreffen und lehnt ein fehlerhaftes Format mit einem Fehler-Frame ab, anstatt das Abonnement einzurichten. Eine Sortierung, die er nicht lesen konnte, würde sonst Zeilen völlig ungeordnet streamen, ohne einen Fehler zu melden – und ein `collection_update`-Frame überträgt lediglich Zeilen und nichts weiter, sodass ein Abonnent keine Möglichkeit hätte, dies zu bemerken.

## Abonnements beenden

Jedes Abonnement gibt eine `unsubscribe`-Funktion zurück. Rufen Sie diese auf, um keine Aktualisierungen mehr zu erhalten und den WebSocket-Listener zu bereinigen:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

Verwenden Sie in React die Bereinigungsfunktion von `useEffect`:

```tsx
useEffect(() => {
    const unsubscribe = client.data.products.listen(
        { where: { active: ["==", true] } },
        (response) => setProducts(response.data)
    );
    return () => unsubscribe();
}, []);
```

## Authentifizierung und Wiederverbindung

Der WebSocket-Client übernimmt die Authentifizierung automatisch:

- Bei der **Anmeldung** oder beim **Token-Refresh** wird das neue Token über eine `authenticate`-Nachricht an einen bereits geöffneten Socket gesendet. Ist keiner geöffnet, geschieht nichts – das Anmelden ist keine Anforderung für Realtime, und ein später geöffneter Socket authentifiziert sich selbst.
- Bei der **Abmeldung** wird die WebSocket-Verbindung getrennt. Der Client bleibt nutzbar; ein späteres Abonnement stellt die Verbindung anonym wieder her.
- Wenn die Verbindung abbricht, **verbindet sich der Client automatisch wieder** und richtet alle aktiven Abonnements neu ein.

Es ist keine manuelle Token-Verwaltung erforderlich – die Integration zwischen `client.auth` und der WebSocket-Schicht wird intern gehandhabt.

### Verbindungsaufbau nach Bedarf (Lazy)

Beim Erstellen eines Clients wird **kein** WebSocket geöffnet. Die Verbindung wird erst bei der ersten Operation aufgebaut, die tatsächlich eine benötigt – ein `listen()`- / `listenById()`-Abonnement oder eine Channel-Operation wie `join()`, `track()` oder `broadcast()`. Das Anfordern einer Channel-Instanz bedeutet noch keine Nutzung.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Dies ist wichtig für Anwendungen mit nennenswertem Traffic von abgemeldeten Benutzern – Marketing-Seiten, öffentliche schreibgeschützte Ansichten, Anonymous-First-Tools –, die zuvor bei jedem Seitenaufruf eine Verbindung aufbauen mussten, nur um Realtime zur Verfügung zu haben.

Zwei damit verbundene Verhaltensweisen:

- `realtime: false` bleibt ein striktes Opt-out: es wird niemals ein Socket geöffnet, und `client.realtime.channel()` wirft einen Fehler. Dasselbe gilt für `listen()` und `listenById()` – sie stehen stets als Aufruf bereit und werfen bei einem Client ohne Socket einen `RebaseClientError`, der die Option nennt, mit der sie aktiviert werden können. `observe()` tut dies nicht: Es fällt auf einen einzelnen Fetch-Aufruf zurück.
- `client.close()` ist endgültig. Es gibt den Socket und seinen Reconnect-Timer frei, und keine danach eingereihte Operation wird die Verbindung erneut aufbauen. Unter Node hält ein offener Socket die Event-Loop aktiv, sodass ein Skript, das diese Methode nie aufruft, sich nicht von selbst beendet.

## Broadcast-Channels

Broadcast-Channels ermöglichen es Ihnen, beliebige Nachrichten zwischen verbundenen Clients zu senden – ideal für Chats, Benachrichtigungen oder kollaborative Funktionen:

```typescript
// Obtain a channel. This alone opens no connection.
const channel = client.realtime.channel("chat-room");

// Listen for broadcasts. Pass an event name to filter, or omit it for all.
channel.onBroadcast("message", (payload) => {
    console.log("New message:", payload);
});

// Send to every other member — the sender never receives its own message.
await channel.broadcast("message", {
    text: "Hello, world!",
    userId: currentUser.id
});

// Leave, releasing handlers and timers.
await channel.leave();
```

Channels sind leichtgewichtig und flüchtig (ephemer) – sie existieren so lange, wie mindestens ein Client abonniert ist. Wiederholte `channel()`-Aufrufe mit demselben Namen geben dasselbe (**same**) Objekt zurück, sodass zwei Komponenten Handler unabhängig voneinander registrieren können, ohne dass eine die andere durch das Verlassen des Channels abschneidet.

Channel- und Presence-Frames erfordern kein Konto: Anonyme Besucher können öffentlichen Channels beitreten.

:::caution[Channels haben noch keine Zugriffsregeln]
Die einzige Überprüfung, die der Server vornimmt, ist die **Mitgliedschaft**: Um in einen Channel zu broadcasten, dessen Presence-Liste zu lesen oder dessen Historie abzuspielen, muss ein Client diesem Channel zuerst beigetreten sein. Der Beitritt selbst steht jedem offen – jeder Client, der den Namen eines Channels kennt, kann ihm beitreten, unabhängig davon, ob er angemeldet ist oder nicht.

Ein Channel-Name ist daher weder ein Geheimnis noch eine Berechtigung. Hinterlegen Sie nichts in einem Channel (einschließlich gespeicherter Historie und Presence-Status), das nicht jeder Benutzer Ihrer Anwendung sehen darf, und leiten Sie Channel-Namen nicht aus Daten ab, die Sie nicht preisgeben würden. Autorisierungsregeln pro Channel sind noch nicht implementiert; wenn Sie diese derzeit benötigen, wickeln Sie den sensiblen Teil der Kommunikation über `client.data` ab, wo Row-Level Security greift.
:::

> **Standardmäßig werden Broadcasts nicht erneut abgespielt (Replay).** Sie erreichen nur aktuell verbundene Mitglieder. Dies ist das gewünschte Verhalten für Benachrichtigungen, die sich selbst korrigieren – ein Hinweis wie „jemand hat gespeichert“ wird durch den nächsten Speichervorgang abgelöst – und verursacht keinen Mehraufwand. Für einen Operations-Stream, bei dem eine unbemerkte Lücke zu Abweichungen führt, aktivieren Sie die [Nachrichtenhistorie](#message-history-and-catch-up) für den Channel.

## Nachrichtenhistorie und Catch-up

Ein Channel kann so konfiguriert werden, dass er seine Broadcasts speichert, sodass ein Client bei einer Wiederverbindung verpasste Nachrichten nachholen kann (Catch-up), anstatt sich von Grund auf neu synchronisieren zu müssen. Dadurch lassen sich Channels als Transportschicht für kollaboratives Bearbeiten nutzen.

Die Aufbewahrungsdauer (Retention) wird **auf dem Server** pro Channel-Muster konfiguriert – siehe [Realtime-Backend](/docs/backend/realtime#channel-retention). Ein Client kann dies nicht für sich selbst aktivieren, da ein Channel von jedem erstellt werden kann, der ihn benennt, und eine vom Client gewählte Historientiefe es jedem Besucher ermöglichen würde, Ihr Backend mit unbegrenztem Speicherbedarf zu belasten.

Übergeben Sie bei einem Channel mit Historie `{ history: true }`, und das SDK kümmert sich um den Rest:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Beim `join()` und nach jeder Wiederverbindung fragt das SDK beim Server alles ab, was nach der zuletzt gesehenen Sequenznummer liegt, und liefert das Ergebnis über dieselben Handler aus. Es muss kein zweiter Codepfad geschrieben werden: Ein Handler, der eine Operation live korrekt anwendet, wendet sie auch beim Catch-up korrekt an.

### Sequenznummern

Jeder Broadcast in einem Channel mit Historie enthält eine `seq` – channelspezifisch, lückenlos und fortlaufend aufsteigend. Sie dient als Wiederaufsetzpunkt für den Client.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Speichern Sie `channel.sequence` persistent, wenn das Catch-up sowohl einen Seiten-Reload als auch eine Wiederverbindung überstehen soll, und übergeben Sie den Wert über `history({ sinceSeq })` zurück.

### Historie explizit abrufen

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` bedeutet, dass der Channel keine Historie speichert und dies auch nie tun wird – eine explizite Antwort, damit Sie „Sie haben nichts verpasst“ von „dieser Channel hat keine Aufbewahrungsregel“ unterscheiden können. Im zweiten Fall muss ein Client, der einen konsistenten Zustand benötigt, auf eine vollständige Neusynchronisation zurückgreifen.

`latestSeq` ist die höchste Sequenznummer, die der Server vorhält, unabhängig davon, ob dieser Batch sie erreicht hat. Liegt sie weit über Ihrer zuletzt ausgelieferten `seq`, sind Sie mehr als eine Seite im Rückstand, und eine Neusynchronisation ist möglicherweise ressourcenschonender als das seitenweise Abrufen (Paging).

:::note[Replays können sich überschneiden, und das ist in Ordnung]
Der Server kann nicht genau wissen, welche Nachrichten Sie erreicht haben, bevor die Socket-Verbindung abbrach. Daher kann ein Catch-up-Bereich Nachrichten enthalten, die Sie bereits angewendet haben. Das SDK verwirft alles, was auf oder unter der Sequenz liegt, die es bereits ausgeliefert hat, sodass Handler eine Nachricht niemals doppelt empfangen.

Ihre eigenen Nachrichten werden bei einem Replay **nicht** herausgefiltert: Eine Wiederverbindung weist eine neue Client-ID zu, sodass genau in dem Fall, für den Catch-up existiert, dieser Filter fehlschlagen würde. Gestalten Sie Operationen idempotent, falls das erneute Anwenden eigener Operationen problematisch wäre.
:::

## Presence-Tracking

Mit Presence können Sie nachverfolgen, welche Benutzer online sind, und geteilte Zustände über alle Teilnehmer hinweg synchronisieren:

```typescript
const channel = client.realtime.channel("editors");

// Publish your presence. This is also what opens the connection.
await channel.track({
    userId: currentUser.id,
    status: "editing",
    cursor: { x: 100, y: 200 }
});

// One handler for every change. `presences` is always the full roster;
// `diff` is what changed, when you only care about the delta.
channel.onPresence((presences, diff) => {
    console.log("Online users:", Object.keys(presences));
    if (diff) {
        console.log("joined:", Object.keys(diff.joins));
        console.log("left:", Object.keys(diff.leaves));
    }
});

// Calling track() again replaces your state — this is how you publish a
// moving cursor.
await channel.track({ userId: currentUser.id, status: "idle" });

// Stop publishing without leaving the channel.
await channel.untrack();
```

Das SDK verwaltet die Teilnehmerliste (Roster) für Sie, sodass `presences` immer vollständig ist und Sie sie niemals aus Diffs neu zusammensetzen müssen.

Es kümmert sich außerdem um zwei Protokolldetails, bei denen bei der direkten Arbeit mit dem reinen WebSocket leicht Fehler passieren:

- **Die Teilnehmerliste wird beim Beitritt nicht automatisch gepusht.** Das erste `presence_diff` eines beitretenden Clients enthält nur ihn selbst; die bestehende Teilnehmerliste muss explizit angefordert werden. `join()` übernimmt das für Sie.
- **Presence läuft nach 30 Sekunden ab.** `track()` ist keine dauerhafte Registrierung – ohne periodisches erneutes Senden verschwinden Sie stillschweigend aus der Liste aller anderen, obwohl Sie noch verbunden und auf der Seite sind. Das SDK sendet alle 20 Sekunden einen Heartbeat und stoppt diesen bei `untrack()` / `leave()`.

Eine Wiederverbindung verwirft zudem die serverseitige Channel-Mitgliedschaft und Presence; das SDK tritt automatisch wieder bei, fordert die Teilnehmerliste erneut an und aktiviert das Tracking wieder.

## Wann Realtime verwendet werden sollte

| Anwendungsfall | Methode |
|---|---|
| Dashboard mit Live-Daten | `listen()` mit Filtern |
| Chat oder Messaging | `channel.broadcast()` |
| Kollaboratives Bearbeiten / Operations-Streams | `channel(name, { history: true })` |
| Tipp-Indikatoren / Online-Status | `channel.track()` + `channel.onPresence()` |
| Detailseite mit Live-Updates | `listenById()` |
| Monitoring im Admin-Panel | `listen()` mit `orderBy` und `limit` |
| Eine Liste, die einen Verbindungsabbruch überstehen muss | `observe()` mit aktiviertem [Offline](/docs/sdk/offline) |

> **Tipp:** Verwenden Sie für einmalige Datenabrufe stattdessen `find()` oder `findById()`. Abonnements eignen sich am besten für Daten, die sich häufig ändern und sofort in der Benutzeroberfläche widergespiegelt werden müssen.

## `listen()` vs. `observe()`

Beide halten eine Abfrage aktuell und beide geben eine Unsubscribe-Funktion zurück – aber sie beantworten unterschiedliche Anforderungen.

`listen()` ist der Socket: Es liefert, was der Server pusht, und liefert nichts, wenn der Socket getrennt ist.

`observe()` ist die Abfrage: Bei aktiviertem [Offline](/docs/sdk/offline)-Modus liefert es Daten zuerst aus der lokalen Datenbank aus – noch vor jeder Netzwerkanfrage – und emittiert erneut bei lokalen Schreibvorgängen, wenn eingereihte Schreibvorgänge den Server erreichen, bei Rollbacks sowie bei Realtime-Events, die es selbst abonniert, sofern Sie nicht `{ realtime: false }` übergeben. Jedes Ergebnis gibt Auskunft darüber, ob es aus dem Cache stammt und ob es Schreibvorgänge enthält, die der Server noch nicht bestätigt hat.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Ohne aktivierten Offline-Modus ist `observe()` eine Kombination aus `find()` und `listen()` in einem einzigen Aufruf, wobei diese Flags immer `false` sind.

## Nächste Schritte

- **[Daten abfragen](/docs/sdk/querying)** — CRUD-Operationen und Query Builder
- **[Offline- & Local-First-Synchronisation](/docs/sdk/offline)** — Live-Abfragen, die einen Verbindungsabbruch überstehen
- **[Authentifizierung](/docs/sdk/authentication)** — Anmeldung und Sitzungsverwaltung
- **[Realtime-Backend](/docs/backend/realtime)** — Serverseitige WebSocket-Konfiguration

---

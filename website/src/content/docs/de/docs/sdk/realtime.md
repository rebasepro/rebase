---
sourceHash: 40fb3fc8ab6a79a5
title: Realtime-Abonnements
sidebar_label: Realtime
description: Abonnieren Sie Live-Datenänderungen mit dem typsicheren Rebase-SDK über WebSocket-basierte Realtime-Listener.
---

## Übersicht

Das typsichere Rebase-SDK bietet Echtzeit-Datenabonnements über WebSocket. Wenn sich Datensätze auf dem Server ändern, werden Ihre abonnierten Callbacks sofort mit den aktualisierten Daten ausgelöst.

Die WebSocket-Verbindung wird automatisch hergestellt, sobald eine `websocketUrl` verfügbar ist (standardmäßig abgeleitet von `baseUrl`). Wiederverbindungsversuche und Token-Aktualisierungen werden automatisch für Sie verwaltet. Ein Ausfall, der länger als etwa 15 Sekunden dauert, wird einmalig an das `onError` jedes Abonnements als `CONNECTION_LOST` gemeldet – siehe [Authentifizierung und Wiederverbindung](#authentifizierung-und-wiederverbindung).

## Eine Collection abonnieren

Verwenden Sie `listen()`, um eine Collection-Abfrage zu abonnieren. Der Callback wird ausgelöst, sobald sich der übereinstimmende Datensatz ändert:

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

`FindResult<M>` hat dieselbe Struktur, die `find()` zurückgibt: flache Zeilen in `data` und `{ total, limit, offset, hasMore, nextCursor }` in `meta`.

### `listen()` akzeptiert das Gleiche wie `find()`

`params` ist ein vollständiges `FindParams`. Ein Abonnement entspricht derselben Abfrage wie das zugehörige `find()`, akzeptiert also dieselben Einschränkungen – `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** und **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Das ist wichtiger, als es klingt. `include` und `fields` wurden hier früher stillschweigend verworfen, sodass dieselbe Abfrage über `find()` in einer anderen Struktur beantwortet wurde als über `listen()` – und eine Komponente, die beides renderte, sah ihre Zeilenstruktur in dem Moment wechseln, in dem ein Schreibvorgang eintraf. Sie durchlaufen nun die identische Read-Pipeline, sodass `find({ q })` und `listen({ q })` Zeilen zurückgeben, die Feld für Feld identisch sind.

Die Ausnahme ist `vectorSearch`, was **abgelehnt** statt verworfen wird: Ein Abonnement wird bei jedem passenden Schreibvorgang erneut ausgeführt und dort berechnet nichts Distanzen. Verwenden Sie `.vectorSearch(…).find()` für die Abfrage und abonnieren Sie ohne diese Angabe.

### Eine Emission pro Änderung

Jeder Server-Push ruft Ihren Callback **einmal** auf, zusammen mit Metadaten, die die dazugehörigen Zeilen beschreiben. Es gibt keine separate First-Paint-Emission und kein Flag, das geprüft werden muss.

Die Metadaten treffen **im selben Frame wie die Zeilen** ein: Der Server zählt die Abfrage innerhalb derselben Transaktion mit Row-Level Security, die sie gelesen hat, sodass `meta.total`, `meta.hasMore` und `meta.nextCursor` exakt die Zeilen neben ihnen beschreiben. (Früher folgte auf jeden Push ein `GET /count` vom Client – ein zusätzlicher Roundtrip pro Schreibvorgang und Abonnent sowie ein Zeitfenster, in dem die Anzahl und die Zeilen unterschiedliche Zustände der Collection beschrieben.)

Zwei Fallbacks, von denen keiner ein Abonnement-Fehler ist und keiner `onError` aufruft:

- Wenn der **Count des Servers fehlgeschlagen ist**, enthält der Frame keine Gesamtzahl und die zuletzt empfangene wird wiederverwendet. Eine fehlgeschlagene Zählung sagt nichts darüber aus, wie groß die Collection ist, daher darf sie keine echte Antwort überschreiben.
- Wenn für dieses Abonnement noch nie eine Gesamtzahl empfangen wurde – etwa bei einem älteren Server, der überhaupt keine Metadaten sendet –, fragt der Client beim ersten Push einmal nach. Schlägt auch dies fehl, ist `meta.total` eine **untere Grenze**: die Zeilen auf dieser Seite plus jene, die zuvor durchblättert wurden, um sie zu erreichen.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Eine einzelne Entität abonnieren

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
    onError?: (error: Error) => void,
    options?: { include?: IncludeSpec }
): () => void   // returns unsubscribe function
```

Der Callback empfängt eine flache Zeile – keine `Entity`, es gibt also kein `.values` – und `undefined`, wenn der Datensatz gelöscht wird.

Jeder Frame enthält die Relationen, die in `options.include` benannt sind, so wie `find({ include })` sie in jede Zeile einer Liste lädt. Eine To-many-Relation, die dort nicht aufgeführt ist, fehlt in der Zeile (ist also nicht leer vorhanden):

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Einschränkungen.** Ein Frame wird gesendet, wenn sich die Zeile selbst ändert, und jeder Frame lädt seine inkludierten Relationen neu. Eine Änderung an einer verknüpften Zeile allein sendet keinen Frame: Die Bearbeitung des Namens eines Tags aktualisiert einen mit `include: ["tags"]` abonnierten Beitrag erst, wenn sich auch der Beitrag ändert. Um verknüpfte Zeilen zu verfolgen, abonnieren Sie auch deren Collection.

## Eine Anzahl beobachten

`listenCount()` hält eine Anzahl aktuell: die Gesamtzahl dessen, worauf der Filter einer Liste zutrifft, beispielsweise für eine Toolbar oder eine „Alle N auswählen“-Option, die nicht veralten soll, während andere Personen Zeilen hinzufügen und entfernen. Der Callback wird mit der Gesamtzahl ausgeführt, sobald diese bekannt ist, und erneut, wann immer ein Schreibvorgang sie ändert.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Nur der Filter zählt – `where`, `logical` und `searchString`; ein `limit`, ein `offset` oder eine Sortierung werden ignoriert. Der Server liest dafür keine Zeilen, sondern nur die Anzahl, unter der Identität des Abonnenten wie bei jedem anderen Frame. Ein Server älter als 0.25 kennt diese Anfrage nicht; sie wird mit einer Zeile und derselben Gesamtzahl beantwortet, und das SDK liest die Gesamtzahl daraus aus. Bei einem Client ohne Socket ist `listenCount()` ein Stub, der wie `listen()` einen Fehler auslöst. Bei aktivierter [Offline-Unterstützung](/docs/sdk/offline/) stammt die Anzahl vom Server: Schreibvorgänge in der Warteschlange sind darin nicht enthalten, bis sie erneut wiedergegeben (replayed) wurden.

## Fluent Query Builder

Sie können auch über den Fluent Query Builder abonnieren. Dies entspricht dem Aufruf von `listen()` mit Parametern, ermöglicht Ihnen jedoch das Verketten von `.where()`, `.orderBy()` usw.:

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

Ein Abonnement akzeptiert wie jede andere Abfrage eine mehrspaltige Sortierung – entweder `orderBy: [["category", "asc"], ["createdAt", "desc"]]` in den Parametern oder einen zweiten `.orderBy()`-Aufruf, der ein Tie-Breaker-Kriterium hinzufügt, anstatt das erste zu ersetzen. Siehe [Sortierung](/docs/sdk/querying#sorting).

Der Server überprüft beim Eintreffen die *Struktur* des `orderBy` eines Abonnements und lehnt ein fehlerhaftes mit einem Error-Frame ab, anstatt das Abonnement einzurichten. Eine Sortierung, die er nicht lesen konnte, würde andernfalls Zeilen völlig ungeordnet streamen, ohne einen Fehler zu melden – und ein `collection_update`-Frame überträgt Zeilen und sonst nichts, sodass ein Abonnent dies nicht bemerken könnte.

## Abonnement beenden

Jedes Abonnement gibt eine `unsubscribe`-Funktion zurück. Rufen Sie diese auf, um den Empfang von Updates zu beenden und den WebSocket-Listener zu bereinigen:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

Verwenden Sie in React das Cleanup von `useEffect`:

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

- Bei **Anmeldung** oder **Token-Aktualisierung** übernimmt ein bereits geöffneter Socket die neuen Anmeldedaten. Ein Refresh oder eine Anmeldung unter demselben Account, den er bereits hält, sendet das Token in einer `authenticate`-Nachricht; eine Anmeldung unter einem anderen Account – einschließlich eines Besuchers, der sich anmeldet – baut den Socket neu auf, der sich als dieser Account authentifiziert und jedes aktive Abonnement sowie jeden Kanal erneut sendet. Ist keiner geöffnet, geschieht nichts – eine Anmeldung ist keine Anforderung für Echtzeit, und ein später geöffneter Socket authentifiziert sich selbst.
- Bei **Abmeldung** wird die WebSocket-Verbindung getrennt. Der Client bleibt nutzbar; ein späteres Abonnement stellt die Verbindung anonym wieder her.
- Wenn die Verbindung abbricht, **verbindet sich der Client automatisch wieder** und stellt alle aktiven Abonnements wieder her. Er bricht die Versuche nie ab, solange ein Abonnement oder ein beigetretener Kanal existiert; die Verzögerung zwischen den Versuchen steigt auf maximal 30 Sekunden an.
- Wenn der Server die Sitzung des Sockets beendet – der Benutzer hat sich überall abgemeldet, diese Sitzung wurde widerrufen, das Konto wurde gelöscht oder das Token ist abgelaufen, bevor ein Refresh den Socket erreichte –, schließt er den Socket mit dem Code `4001`. Der Client verbindet sich wie nach jedem Verbindungsabbruch wieder und authentifiziert sich mit der Sitzung, die er zu diesem Zeitpunkt hält (aktualisiert, falls möglich), oder anonym, wenn keine vorhanden ist. Der Entzug einer Rolle schließt den Socket nicht: Er greift ab dem nächsten Frame. Siehe [Authentifizierung & RLS](/docs/backend/realtime/#authentication--rls).
- Bleibt die Verbindung länger als etwa 15 Sekunden unterbrochen, wird `onError` jedes Abonnements (und `onError` jedes beigetretenen Kanals) **einmal** mit einem `RebaseApiError` aufgerufen, dessen `code` `CONNECTION_LOST` lautet. Das Abonnement wird nicht beendet: Zeigen Sie weiterhin die vorhandenen Daten an, markieren Sie sie möglicherweise als veraltet (stale) und warten Sie ab. Sobald der Socket wieder verbunden ist, überträgt das nächste `onUpdate` des Abonnements alle in der Zwischenzeit geschriebenen Daten.
- `client.ws.state` ist der Status der Verbindung – `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` oder `closed` – und `client.ws.onStateChange(listener)` wird über jede Änderung benachrichtigt. `disconnected` ist der Zustand, in dem `CONNECTION_LOST` gemeldet wurde.
- Über den Socket gesendete Anfragen erfolgen nach dem **At-most-once**-Prinzip. Eine Anfrage, die gesendet wurde, als die Verbindung abbrach, schlägt mit `CONNECTION_LOST` fehl und wird nie erneut gesendet, da der Server sie möglicherweise bereits ausgeführt hat. Eine Anfrage, die nach 30 Sekunden immer noch auf einen Socket wartet, schlägt mit `REQUEST_TIMEOUT` fehl, ohne gesendet worden zu sein.

Alles in der Liste nach dem Punkt zur Abmeldung wurde in Version 0.24 eingeführt.

```typescript
import { RebaseApiError } from "@rebasepro/client";

const unsubscribe = client.data.orders.listen(
    { where: { status: ["==", "open"] } },
    (response) => {
        setOrders(response.data);
        setStale(false);
    },
    (error) => {
        if (error instanceof RebaseApiError && error.code === "CONNECTION_LOST") {
            setStale(true); // keep the rows; the next update clears it
            return;
        }
        setError(error);
    }
);
```

### Welches Token der Socket sendet

Der Socket authentifiziert sich mit demselben Token, das auch ein HTTP-Request tragen würde. Dies ist in erster Linie der über `client.setAuthTokenGetter()` installierte Getter; wenn keiner vorhanden ist, er `null` zurückgibt oder einen Fehler auslöst, ist es das Token, das der Client hält: das seiner Sitzung, ein über `client.setToken()` festgelegtes oder die Option `token`. Mit dem integrierten `client.auth` muss nichts zusätzlich verdrahtet werden.

Für einen externen Auth-Provider (Clerk, Firebase Auth, eine eigene Session) installieren Sie den Getter einmalig. Er deckt sowohl HTTP als auch den Socket ab:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` reagiert auf ein abgewiesenes Token auf beiden Wegen: ein 401 über HTTP und ein Auth-Fehler auf dem Socket. Geben Sie `true` zurück, um den Versuch mit erneut aufgelöstem Token zu wiederholen. Dies ersetzt den client-eigenen Session-Refresh.
- Das Installieren eines Getters oder der Aufruf von `client.setToken()` baut einen geöffneten Socket neu auf: Der neue Socket authentifiziert sich mit den neuen Anmeldedaten und sendet jedes aktive Abonnement und jeden Kanal unter dieser Identität erneut, wobei nichts von der vorherigen Identität übernommen wird. Wenn kein Socket geöffnet ist, authentifiziert sich der nächste von selbst.
- `client.ws.setAuthTokenGetter()` ist veraltet (deprecated). Es funktioniert weiterhin, ersetzt aber nur den Getter des Sockets und gibt eine einmalige Warnung aus. Verwenden Sie `client.setAuthTokenGetter()`.

Siehe [Eigener Auth-Provider](/docs/sdk/your-own-auth-provider/).

### Die Verbindung wird verzögert aufgebaut (Lazy)

Das Erstellen eines Clients öffnet **keinen** WebSocket. Die Verbindung wird erst bei der ersten Operation aufgebaut, die tatsächlich einen benötigt – ein `listen()`- / `listenById()`-Abonnement oder eine Kanal-Operation wie `join()`, `track()` oder `broadcast()`. Das Anfordern einer Kanal-Instanz gilt noch nicht als Nutzung.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Dies ist wichtig für Anwendungen mit beträchtlichem Datenverkehr von nicht angemeldeten Nutzern – Marketingseiten, öffentliche schreibgeschützte Ansichten, anonym nutzbare Tools –, die zuvor bei jedem Seitenaufruf eine Verbindung aufbauen mussten, nur um Realtime bereitzuhalten.

Zwei zusammenhängende Verhaltensweisen:

- `realtime: false` bleibt ein striktes Deaktivieren: Es wird niemals ein Socket geöffnet, und `client.realtime.channel()` löst einen Fehler aus. Dasselbe gilt für `listen()` und `listenById()` – sie stehen stets als Aufruf bereit, lösen jedoch bei einem Client ohne Socket einen `RebaseClientError` aus, der die Option benennt, die sie aktivieren würde. `observe()` tut dies nicht: Es fällt auf einen einzelnen Fetch zurück.
- `client.close()` ist endgültig. Es gibt den Socket sowie dessen Reconnect-Timer frei, und nichts, was danach in die Warteschlange gestellt wird, wählt sich erneut ein. In Node hält ein offener Socket die Event-Loop aktiv, sodass ein Skript, das dies nie aufruft, sich nicht von selbst beendet.

### Eine Gruppe auf einer Instanz halten

Bei mehr als einer Server-Instanz können Mitglieder eines Kanals auf verschiedenen Instanzen landen, und jede Nachricht zwischen ihnen durchläuft dann den [Channel-Bus](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` benennt die Gruppe, zu der ein Socket gehört, wie etwa einen Raum oder ein Dokument, sodass eine Plattform die gesamte Gruppe an dieselbe Instanz leiten kann:

```typescript
const client = createRebaseClient({
    baseUrl,
    realtime: { affinity: roomCode }
});
```

Wenn der Schlüssel erst später bekannt ist, setzen Sie ihn, bevor der Socket geöffnet wird:

```typescript
const client = createRebaseClient({ baseUrl });

client.realtime.setAffinity(roomCode);          // no socket yet
await client.realtime.channel(roomCode).join(); // opens with the key
```

Der Schlüssel wird der Socket-Adresse als `?affinity=` angehängt und ersetzt einen bereits vorhandenen Wert in einer gesetzten `websocketUrl`. `setAffinity(null)` löscht ihn.

- **Es ist eine Optimierung.** Rebase Cloud nutzt dies für das Routing, wenn ein Projekt auf mehr als einer Instanz läuft. Self-hosted oder hinter einem Proxy, der nicht darauf hasht, bewirkt dies nichts und Kanäle funktionieren identisch: Der Bus überträgt weiterhin alles instanzübergreifend, einschließlich einer Gruppe, die durch ein Scale-up aufgeteilt wurde.
- **Es wird wirksam, wenn der Socket eine Verbindung herstellt.** Ein bereits geöffneter Socket bleibt dort, wo er ist, und verwendet den neuen Schlüssel bei der nächsten Verbindung. Um einen bereits verbundenen Client zu verschieben, erstellen Sie einen neuen oder setzen Sie den Schlüssel vor dessen erstem `join()` oder `listen()`.
- **Es bestimmt, wo ein Socket landet, nicht, worauf er zugreifen darf.** Der Zugriff auf einen Kanal hängt nicht davon ab, und die Adresse landet in den Zugriffsprotokollen (Access Logs). Verwenden Sie daher einen Code statt eines Secrets oder persönlicher Daten.

Um zu überprüfen, ob es funktioniert, vergleichen Sie, was jede Instanz veröffentlicht und überspringt: siehe [Prüfen, was der Bus tut](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Broadcast-Kanäle

Über Broadcast-Kanäle können Sie beliebige Nachrichten zwischen verbundenen Clients senden – ideal für Chats, Benachrichtigungen oder kollaborative Funktionen:

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

Kanäle sind leichtgewichtig und flüchtig (ephemeral) – sie existieren, solange mindestens ein Client abonniert ist. Wiederholte `channel()`-Aufrufe mit demselben Namen geben **dasselbe** Objekt zurück, sodass zwei Komponenten Handler unabhängig voneinander anhängen können, ohne dass eine Komponente die andere durch ein `leave()` trennt.

Kanal- und Präsenz-Frames erfordern kein Konto: Anonyme Besucher können öffentlichen Kanälen beitreten.

:::caution[Kanäle haben noch keine Zugriffsregeln]
Die einzige Prüfung, die der Server durchführt, ist die **Mitgliedschaft**: Um in einen Kanal zu senden (broadcast), seine Anwesenheitsliste (Presence Roster) zu lesen oder seinen Verlauf abzuspielen, muss ein Client diesem Kanal zuvor beigetreten sein. Der Beitritt selbst steht jedem offen – jeder Client, der den Namen eines Kanals kennt, kann ihm beitreten, unabhängig davon, ob er angemeldet ist oder nicht.

Ein Kanalname ist daher weder ein Geheimnis noch eine Berechtigung. Hinterlegen Sie nichts in einem Kanal (einschließlich gespeicherter Historie und Präsenzstatus), das nicht jeder Nutzer Ihrer App sehen darf, und leiten Sie Kanalnamen nicht von Daten ab, die Sie nicht preisgeben würden. Autorisierungsregeln pro Kanal sind derzeit nicht implementiert; wenn Sie diese heute benötigen, wickeln Sie den sensiblen Teil des Austauschs über `client.data` ab, wo Row-Level Security greift.
:::

> **Standardmäßig werden Broadcasts nicht erneut abgespielt.** Sie erreichen nur aktuell verbundene Mitglieder. Dies ist das gewünschte Verhalten für Benachrichtigungen, die sich selbst korrigieren – ein Hinweis „Jemand hat gespeichert“ wird durch den nächsten Speichervorgang abgelöst – und verursacht keine Kosten. Aktivieren Sie für einen Operations-Stream, bei dem eine unbemerkte Lücke zu Divergenzen führt, den [Nachrichtenverlauf](#nachrichtenverlauf-und-aufholen-catch-up) auf dem Kanal.

## Nachrichtenverlauf und Aufholen (Catch-Up)

Ein Kanal kann so konfiguriert werden, dass er seine Broadcasts behält, sodass ein Client bei einer Wiederverbindung verpasste Nachrichten aufholt, anstatt sich von Grund auf neu zu synchronisieren. Dadurch eignen sich Kanäle als Transportschicht für kollaboratives Editieren.

Die Aufbewahrung (Retention) wird **auf dem Server** pro Kanalmuster konfiguriert – siehe [Realtime-Backend](/docs/backend/realtime#channel-retention). Ein Client kann dies nicht für sich selbst aktivieren, da ein Kanal von jedem erstellt wird, der ihn benennt, und eine vom Client gewählte Verlaufstiefe es jedem Besucher ermöglichen würde, Ihr Backend mit unbegrenztem Speicherbedarf zu belasten.

Übergeben Sie bei einem gespeicherten Kanal `{ history: true }`, und das SDK erledigt den Rest:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Beim `join()` und nach jedem Reconnect fordert das SDK vom Server alle Einträge nach der letzten gesehenen Sequenznummer an und übermittelt das Ergebnis über dieselben Handler. Es muss kein zweiter Codepfad geschrieben werden: Ein Handler, der eine Operation im Live-Betrieb korrekt anwendet, tut dies auch beim Aufholen (Catch-Up).

### Sequenznummern

Jeder Broadcast auf einem persistenten Kanal trägt ein `seq` – pro Kanal, lückenlos und fortlaufend ansteigend. Dies ist der Wiederaufsetzpunkt des Clients.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Speichern Sie `channel.sequence` persistent, wenn das Aufholen sowohl ein Neuladen der Seite als auch einen Reconnect überstehen soll, und übergeben Sie es über `history({ sinceSeq })` zurück.

### Verlauf explizit abrufen

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` bedeutet, dass der Kanal keinen Verlauf behält und dies auch nie tun wird – eine explizite Antwort, damit Sie „Sie haben nichts verpasst“ von „dieser Kanal hat keine Aufbewahrungsregel“ unterscheiden können. Im zweiten Fall muss ein Client, der konvergieren muss, auf eine vollständige Neusynchronisation zurückgreifen.

`latestSeq` ist die höchste Sequenz, die der Server vorhält, unabhängig davon, ob dieser Batch sie erreicht hat. Liegt sie weit über Ihrem zuletzt empfangenen `seq`, hinken Sie mehr als eine Seite hinterher, und eine Neusynchronisation ist möglicherweise effizienter als das seitenweise Abrufen (Paging).

:::note[Wiedergaben können sich überschneiden, und das ist in Ordnung]
Der Server kann nicht genau wissen, welche Nachrichten Sie erreicht haben, bevor der Socket abbrach; daher kann ein Catch-Up-Bereich Nachrichten enthalten, die Sie bereits angewendet haben. Das SDK verwirft alles, was auf oder unter der bereits gelieferten Sequenz liegt, sodass Handler eine Nachricht nie doppelt sehen.

Ihre eigenen Nachrichten werden bei einer Wiedergabe wie im Live-Betrieb herausgefiltert, einschließlich jener, die gesendet wurden, bevor ein Reconnect dem Socket eine neue Client-ID zugewiesen hat: Der Kanal merkt sich die IDs, von denen aus er gesendet hat. Ein neues Kanalobjekt – beispielsweise nach einem Neuladen der Seite – hat keine dieser IDs gespeichert, sodass ein Catch-Up dort Ihre früheren Nachrichten wie die aller anderen liefert, was für den Wiederaufbau des Zustands aus der Historie erforderlich ist.
:::

## Präsenz-Tracking

Über die Präsenzfunktion können Sie nachverfolgen, welche Benutzer online sind, und den gemeinsamen Zustand über alle Teilnehmer hinweg synchronisieren:

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

Das SDK verwaltet die Teilnehmerliste (Roster) für Sie, sodass `presences` immer vollständig ist und Sie sie nie manuell aus Diffs zusammenbauen müssen.

Es übernimmt zudem zwei Protokolldetails, bei denen bei der direkten Arbeit mit dem Raw-WebSocket leicht Fehler passieren:

- **Die Teilnehmerliste wird beim Beitritt nicht automatisch gepusht.** Das erste `presence_diff` eines beitretenden Clients enthält nur ihn selbst; die bestehende Liste muss explizit angefordert werden. `join()` übernimmt das für Sie.
- **Die Präsenz läuft nach 30 Sekunden ab.** `track()` ist keine dauerhafte Registrierung – ohne regelmäßiges erneutes Senden verschwinden Sie unbemerkt aus der Liste aller anderen, obwohl Sie weiterhin verbunden und auf der Seite sind. Das SDK sendet alle 20 Sekunden einen Heartbeat und stoppt bei `untrack()` / `leave()`.

Ein Reconnect setzt auch die serverseitige Kanalmitgliedschaft und Präsenz zurück; das SDK tritt automatisch erneut bei, fordert die Liste neu an und startet das Tracking wieder.

## Wann Realtime verwendet werden sollte

| Anwendungsfall | Methode |
|----------------|---------|
| Dashboard mit Live-Daten | `listen()` mit Filtern |
| Chat oder Messaging | `channel.broadcast()` |
| Kollaboratives Editieren / Operations-Streams | `channel(name, { history: true })` |
| Tipp-Indikatoren / Online-Status | `channel.track()` + `channel.onPresence()` |
| Detailseite mit Live-Updates | `listenById()` |
| Admin-Panel-Überwachung | `listen()` mit `orderBy` und `limit` |
| Eine Liste, die Verbindungsabbrüche überstehen muss | `observe()` mit aktiviertem [Offline-Modus](/docs/sdk/offline) |

> **Tipp:** Verwenden Sie für einmalige Datenabrufe stattdessen `find()` oder `findById()`. Abonnements eignen sich am besten für Daten, die sich häufig ändern und sofort in der Benutzeroberfläche widergespiegelt werden müssen.

## `listen()` vs `observe()`

Beide halten eine Abfrage aktuell und beide geben eine Unsubscribe-Funktion zurück – sie beantworten jedoch unterschiedliche Anforderungen.

`listen()` ist der Socket: Es liefert, was der Server pusht, und liefert nichts, wenn der Socket getrennt ist.

`observe()` ist die Abfrage: Bei aktivierter [Offline-Unterstützung](/docs/sdk/offline) liest es zuerst aus der lokalen Datenbank – noch vor jeder Anfrage – und emittiert erneut bei lokalen Schreibvorgängen, wenn Schreibvorgänge aus der Warteschlange den Server erreichen, bei Rollbacks sowie bei Realtime-Events, die es selbst abonniert, sofern Sie nicht `{ realtime: false }` übergeben. Jedes Ergebnis gibt an, ob es aus dem Cache stammt und ob es Schreibvorgänge enthält, die der Server noch nicht bestätigt hat.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Ohne aktivierte Offline-Unterstützung ist `observe()` die Kombination aus `find()` und `listen()` in einem einzigen Aufruf, wobei diese Flags immer `false` sind.

## Nächste Schritte

- **[Daten abfragen](/docs/sdk/querying)** — CRUD-Operationen und Query Builder
- **[Offline & Local-First Sync](/docs/sdk/offline)** — Live-Abfragen, die Verbindungsabbrüche überstehen
- **[Authentifizierung](/docs/sdk/authentication)** — Anmeldung und Sitzungsverwaltung
- **[Realtime-Backend](/docs/backend/realtime)** — Serverseitige WebSocket-Konfiguration

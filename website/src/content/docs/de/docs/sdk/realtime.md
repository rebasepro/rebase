---
sourceHash: eb117d132ea516de
title: Realtime-Abonnements
sidebar_label: Realtime
description: Abonnieren Sie Live-Datenänderungen mit dem typisierten Rebase-SDK über WebSocket-basierte Realtime-Listener.
---

## Übersicht

Das typisierte Rebase-SDK bietet Echtzeit-Datenabonnements über WebSocket. Wenn sich Datensätze auf dem Server ändern, werden Ihre abonnierten Callbacks sofort mit den aktualisierten Daten ausgelöst.

Die WebSocket-Verbindung wird automatisch aufgebaut, sobald eine `websocketUrl` verfügbar ist (standardmäßig von `baseUrl` abgeleitet). Die Wiederverbindung und die Token-Aktualisierung werden automatisch für Sie verwaltet. Ein Ausfall, der länger als etwa 15 Sekunden dauert, wird jedem Abonnement einmalig über `onError` als `CONNECTION_LOST` gemeldet – siehe [Authentifizierung und Wiederverbindung](#authentifizierung-und-wiederverbindung).

## Eine Tabelle abonnieren

Verwenden Sie `listen()`, um eine Tabellenabfrage zu abonnieren. Der Callback wird ausgelöst, sobald sich der übereinstimmende Datensatz ändert:

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

### `listen()` akzeptiert dieselben Parameter wie `find()`

`params` ist ein vollständiges `FindParams`-Objekt. Ein Abonnement ist dieselbe Abfrage wie das dazugehörige `find()`, daher akzeptiert es dieselben Einschränkungen – `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** und **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Das ist wichtiger, als es zunächst klingt. Früher wurden `include` und `fields` an dieser Stelle stillschweigend verworfen. Dadurch antwortete dieselbe Abfrage über `find()` in einer Struktur und über `listen()` in einer anderen – und eine Komponente, die beides renderte, erlebte, wie sich die Form ihrer Zeilen in dem Moment änderte, in dem ein Schreibvorgang eintraf. Sie durchlaufen nun die identische Lese-Pipeline, sodass `find({ q })` und `listen({ q })` Zeilen zurückgeben, die Feld für Feld übereinstimmen.

Die Ausnahme ist `vectorSearch`, was **abgewiesen** statt verworfen wird: Ein Abonnement wird bei jedem passenden Schreibvorgang erneut ausgeführt, und dort berechnet nichts Distanzen. Verwenden Sie `.vectorSearch(…).find()` für die Abfrage und abonnieren Sie ohne diese Option.

### Eine Emission pro Änderung

Jeder Server-Push ruft Ihren Callback **einmal** auf, mit Metadaten, die die dazugehörigen Zeilen beschreiben. Es gibt keine separate Erst-Render-Emission und kein Flag, das überprüft werden müsste.

Die Metadaten treffen **im selben Frame wie die Zeilen** ein: Der Server zählt die Abfrage innerhalb derselben Transaktion mit Row-Level-Security, die sie gelesen hat, sodass `meta.total`, `meta.hasMore` und `meta.nextCursor` exakt die nebenstehenden Zeilen beschreiben. (Früher folgte auf jeden Push ein `GET /count` des Clients – ein zusätzlicher Roundtrip pro Schreibvorgang und Abonnent sowie ein Zeitfenster, in dem die Anzahl und die Zeilen unterschiedliche Zustände der Tabelle beschrieben.)

Es gibt zwei Fallbacks, von denen keiner ein Abonnementfehler ist und keiner `onError` aufruft:

- Wenn die **Zählung des Servers fehlgeschlagen** ist, enthält der Frame keine Gesamtzahl, und die zuletzt empfangene wird wiederverwendet. Eine fehlgeschlagene Zählung sagt nichts darüber aus, wie groß die Tabelle ist, daher darf sie ein reales Ergebnis nicht überschreiben.
- Wenn für dieses Abonnement noch nie eine Gesamtzahl eingetroffen ist – etwa bei einem älteren Server, der überhaupt keine Metadaten sendet –, fragt der Client einmalig beim ersten Push nach. Schlägt auch dies fehl, ist `meta.total` eine **untere Schranke**: die Zeilen auf dieser Seite plus die Zeilen, die übersprungen wurden, um sie zu erreichen.

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
    .table<{ id: number; name: string }>("products")
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

Der Callback erhält eine flache Zeile – keine `Entity`, es gibt also kein `.values` – und `undefined`, wenn der Datensatz gelöscht wird.

Jeder Frame enthält die in `options.include` angegebenen Relationen, geladen genau so, wie `find({ include })` sie in jede Zeile einer Liste lädt. Eine To-Many-Relation, die dort nicht aufgeführt ist, fehlt in der Zeile (sie ist nicht einfach leer):

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Einschränkungen.** Ein Frame wird gesendet, wenn sich die Zeile selbst ändert, und jeder Frame lädt seine eingebundenen Relationen neu. Eine Änderung ausschließlich an einer verknüpften Zeile sendet keinen Frame: Das Bearbeiten des Namens eines Tags aktualisiert einen mit `include: ["tags"]` abonnierten Beitrag erst, wenn sich auch der Beitrag selbst ändert. Um den verknüpften Zeilen zu folgen, abonnieren Sie zusätzlich deren Tabelle.

## Eine Anzahl überwachen

`listenCount()` hält eine Anzahl aktuell: die Gesamtzahl dessen, worauf der Filter einer Liste zutrifft – nützlich für eine Symbolleiste oder eine "Alle N auswählen"-Option, die nicht veralten soll, während andere Benutzer Zeilen hinzufügen oder entfernen. Der Callback wird ausgeführt, sobald die Gesamtzahl bekannt ist, und erneut, sobald ein Schreibvorgang sie ändert.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Es zählt nur der Filter – `where`, `logical` und `searchString`; ein `limit`, ein `offset` oder eine Sortierung wird ignoriert. Der Server liest dafür keine Zeilen, sondern nur die Anzahl, unter der Identität des Abonnenten wie bei jedem anderen Frame. Ein Server, der älter als Version 0.25 ist, kennt diese Anfrage nicht; er antwortet mit einer Zeile und derselben Gesamtzahl, aus der das SDK die Summe liest. Auf einem Client ohne Socket ist `listenCount()` ein Stub, der wie `listen()` einen Fehler auslöst. Bei aktivierter [Offline-Unterstützung](/docs/sdk/offline/) stammt die Anzahl vom Server: Schreibvorgänge in der Warteschlange sind erst enthalten, wenn sie übertragen wurden.

## Fluent Query Builder

Sie können Abonnements auch über den Fluent Query Builder erstellen. Dies entspricht dem Aufruf von `listen()` mit Parametern, ermöglicht Ihnen jedoch das Verketten von `.where()`, `.orderBy()` usw.:

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

Ein Abonnement akzeptiert wie jede andere Abfrage eine Sortierung über mehrere Spalten – entweder über `orderBy: [["category", "asc"], ["createdAt", "desc"]]` in den Parametern oder über einen zweiten `.orderBy()`-Aufruf, der ein weiteres Kriterium hinzufügt, anstatt das erste zu ersetzen. Siehe [Sortierung](/docs/sdk/querying#sorting).

Der Server prüft die *Form* des `orderBy` eines Abonnements beim Eintreffen und weist eine fehlerhafte Struktur mit einem Fehler-Frame ab, anstatt das Abonnement einzurichten. Eine Sortierung, die er nicht lesen kann, würde andernfalls Zeilen völlig ungeordnet streamen, ohne einen Fehler zu melden – und ein `collection_update`-Frame überträgt Zeilen und sonst nichts, sodass ein Abonnent keine Möglichkeit hätte, dies zu bemerken.

## Abonnements kündigen

Jedes Abonnement gibt eine `unsubscribe`-Funktion zurück. Rufen Sie diese auf, um keine weiteren Updates mehr zu erhalten und den WebSocket-Listener zu bereinigen:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

In React verwenden Sie das Cleanup von `useEffect`:

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

- Bei der **Anmeldung** oder **Token-Aktualisierung** übernimmt ein bereits geöffneter Socket die neuen Anmeldedaten. Bei einer Aktualisierung oder einer erneuten Anmeldung mit demselben Konto wird das Token in einer `authenticate`-Nachricht gesendet; bei einer Anmeldung als ein anderes Konto – einschließlich eines Besuchers, der sich anmeldet – wird der Socket neu aufgebaut, authentifiziert sich als dieses Konto und sendet jedes aktive Abonnement sowie jeden Channel erneut. Wenn kein Socket geöffnet ist, passiert nichts – die Anmeldung ist keine Realtime-Anforderung, und ein später geöffneter Socket authentifiziert sich selbst.
- Bei der **Abmeldung** wird die WebSocket-Verbindung getrennt. Der Client bleibt nutzbar; ein späteres Abonnement verbindet sich anonym wieder.
- Wenn die Verbindung abbricht, verbindet sich der Client **automatisch wieder** und stellt alle aktiven Abonnements wieder her. Er bricht die Versuche nie ab, solange ein Abonnement oder ein beigetretener Channel existiert; die Verzögerung zwischen den Versuchen wächst auf maximal 30 Sekunden an.
- Wenn der Server die Sitzung des Sockets beendet – der Benutzer hat sich überall abgemeldet, diese Sitzung wurde widerrufen, das Konto wurde gelöscht oder das Token ist abgelaufen, bevor eine Aktualisierung den Socket erreichte –, schließt er den Socket mit dem Code `4001`. Der Client verbindet sich wie nach jedem Verbindungsabbruch wieder und authentifiziert sich mit der Sitzung, die er zu diesem Zeitpunkt hält (aktualisiert, falls möglich), oder anonym, wenn keine vorhanden ist. Der Entzug einer Rolle schließt den Socket nicht: Er greift ab dem nächsten Frame. Siehe [Authentifizierung & RLS](/docs/backend/realtime/#authentication--rls).
- Wenn die Verbindung länger als etwa 15 Sekunden unterbrochen bleibt, wird die `onError`-Funktion jedes Abonnements (und jedes beigetretenen Channels) **einmal** mit einem `RebaseApiError` aufgerufen, dessen `code` `CONNECTION_LOST` lautet. Das Abonnement wird nicht beendet: Zeigen Sie weiterhin die vorhandenen Daten an, markieren Sie sie als möglicherweise veraltet und warten Sie. Sobald der Socket wieder da ist, enthält das nächste `onUpdate` des Abonnements alle in der Zwischenzeit geschriebenen Daten.
- `client.ws.state` spiegelt den Zustand der Verbindung wider – `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` oder `closed` – und `client.ws.onStateChange(listener)` wird über jede Änderung informiert. `disconnected` ist der Zustand, in dem `CONNECTION_LOST` gemeldet wurde.
- Über den Socket gesendete Anfragen erfolgen nach dem Prinzip **At-Most-Once** (höchstens einmal). Eine Anfrage, die beim Verbindungsabbruch gesendet wurde, schlägt mit `CONNECTION_LOST` fehl und wird nie erneut gesendet, da der Server sie möglicherweise bereits ausgeführt hat. Eine Anfrage, die nach 30 Sekunden immer noch auf einen Socket wartet, schlägt mit `REQUEST_TIMEOUT` fehl, ohne gesendet worden zu sein.

Alle Punkte in der Liste nach der Abmeldung wurden in Version 0.24 eingeführt.

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

Der Socket authentifiziert sich mit demselben Token, das auch eine HTTP-Anfrage tragen würde. Dies ist in erster Linie der Getter, der mit `client.setAuthTokenGetter()` eingerichtet wurde; wenn keiner vorhanden ist, er `null` zurückgibt oder einen Fehler wirft, ist es das Token, das der Client hält: das seiner Sitzung, ein über `client.setToken()` festgelegtes Token oder die Option `token`. Mit dem integrierten `client.auth` muss nichts manuell konfiguriert werden.

Für einen externen Auth-Provider (Clerk, Firebase Auth, eine eigene Sitzung) richten Sie den Getter einmalig ein. Er deckt HTTP und den Socket ab:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` reagiert auf ein abgewiesenes Token bei beiden: einem 401 über HTTP und einem Authentifizierungsfehler auf dem Socket. Geben Sie `true` zurück, um den Versuch mit dem erneut aufgelösten Token zu wiederholen. Dies ersetzt die client-eigene Sitzungsaktualisierung.
- Das Einrichten eines Getters oder der Aufruf von `client.setToken()` baut einen offenen Socket neu auf: Der neue Socket authentifiziert sich mit den neuen Anmeldedaten und sendet jedes aktive Abonnement und jeden Channel unter dieser Identität erneut; nichts von der vorherigen Identität bleibt erhalten. Ist kein Socket geöffnet, authentifiziert sich der nächste von selbst.
- `client.ws.setAuthTokenGetter()` ist veraltet. Es funktioniert weiterhin, ersetzt aber nur den Getter des Sockets und gibt eine einmalige Warnung aus. Verwenden Sie stattdessen `client.setAuthTokenGetter()`.

Siehe [Eigener Auth-Provider](/docs/sdk/your-own-auth-provider/).

### Die Verbindung erfolgt lazy

Das Erstellen eines Clients öffnet **keinen** WebSocket. Er wird erst bei der ersten Operation angewählt, die tatsächlich einen benötigt – ein `listen()`- / `listenById()`-Abonnement oder eine Channel-Operation wie `join()`, `track()` oder `broadcast()`. Das reine Abrufen einer Channel-Instanz gilt nicht als Verwendung.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Dies ist wichtig für Anwendungen mit nennenswertem Traffic von abgemeldeten Benutzern – Marketing-Seiten, öffentliche Nur-Lese-Ansichten, anonyme Tools –, die zuvor bei jedem Seitenaufruf eine Verbindung aufbauen mussten, nur um Realtime zur Verfügung zu haben.

Zwei verwandte Verhaltensweisen:

- `realtime: false` bleibt ein striktes Deaktivieren: Es wird niemals ein Socket geöffnet, und `client.realtime.channel()` wirft einen Fehler. Das gilt auch für `listen()` und `listenById()` – sie stehen im Code immer zum Aufruf bereit, werfen jedoch bei einem Client ohne Socket einen `RebaseClientError`, der die Option nennt, mit der sie aktiviert werden können. `observe()` verhält sich anders: Es fällt auf einen einfachen Datenabruf zurück.
- `client.close()` ist endgültig. Es trennt den Socket samt Wiederverbindungstimer, und nachfolgend eingereihte Aktionen wählen sich nicht erneut ein. In Node hält ein offener Socket die Event-Loop aktiv, sodass ein Skript, das ihn nie schließt, sich nicht von selbst beendet.

### Eine Gruppe auf einer Instanz halten

Bei mehr als einer Server-Instanz können Mitglieder eines Channels auf unterschiedlichen Instanzen landen, und jede Nachricht zwischen ihnen [überquert dann den Channel-Bus](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` benennt die Gruppe, zu der ein Socket gehört (z. B. einen Raum oder ein Dokument), sodass eine Plattform die gesamte Gruppe an dieselbe Instanz leiten kann:

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

Der Schlüssel wird an die Adresse des Sockets als `?affinity=` angehängt und ersetzt einen bereits in der konfigurierten `websocketUrl` vorhandenen Parameter. `setAffinity(null)` entfernt ihn wieder.

- **Es ist eine Optimierung.** Rebase Cloud nutzt diesen Parameter für das Routing, wenn ein Projekt auf mehreren Instanzen läuft. Bei Self-Hosting oder hinter einem Proxy, der diesen Hash nicht auswertet, bleibt er wirkungslos, und Channels funktionieren wie gewohnt: Der Bus überträgt weiterhin alles, was instanzübergreifend ist – einschließlich einer Gruppe, die durch ein Scale-up getrennt wurde.
- **Er wird wirksam, wenn sich der Socket verbindet.** Ein bereits offener Socket bleibt dort, wo er ist, und verwendet den neuen Schlüssel bei der nächsten Verbindung. Um einen bereits verbundenen Client umzuleiten, erstellen Sie einen neuen oder setzen Sie den Schlüssel vor dessen erstem `join()` oder `listen()`.
- **Er bestimmt, wo ein Socket landet, nicht, worauf er zugreifen darf.** Der Zugriff auf einen Channel hängt nicht davon ab, und die Adresse landet in den Zugriffsprotokollen; verwenden Sie daher einen Identifikationscode anstelle eines Secrets oder personenbezogener Daten.

Um zu prüfen, ob es funktioniert, vergleichen Sie, was jede Instanz veröffentlicht und verwirft: siehe [Das Verhalten des Busses nachvollziehen](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Broadcast-Channels

Broadcast-Channels ermöglichen das Senden beliebiger Nachrichten zwischen verbundenen Clients – ideal für Chats, Benachrichtigungen oder kollaborative Funktionen:

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

Channels sind leichtgewichtig und flüchtig – sie existieren, solange mindestens ein Client abonniert ist. Wiederholte `channel()`-Aufrufe mit demselben Namen geben **dasselbe** Objekt zurück, sodass zwei Komponenten unabhängig voneinander Handler registrieren können, ohne dass eine die andere durch das Verlassen des Channels abschneidet.

Channel- und Presence-Frames erfordern kein Konto: Anonyme Besucher können öffentlichen Channels beitreten.

:::caution[Channels haben noch keine Zugriffsregeln]
Die einzige Überprüfung, die der Server durchführt, ist die **Mitgliedschaft**: Um in einen Channel zu senden, seine Anwesenheitsliste zu lesen oder seinen Verlauf abzuspielen, muss ein Client diesem Channel zuerst beigetreten sein. Der Beitritt selbst steht jedem offen – jeder Client, der den Namen eines Channels kennt, kann ihm beitreten, unabhängig davon, ob er angemeldet ist.

Daher ist ein Channel-Name weder ein Geheimnis noch eine Berechtigung. Übertragen Sie nichts in einem Channel (einschließlich des gespeicherten Verlaufs und des Presence-Status), was nicht jeder Benutzer Ihrer Anwendung sehen darf, und leiten Sie Channel-Namen nicht aus Daten ab, die Sie nicht preisgeben würden. Autorisierungsregeln auf Channel-Ebene sind derzeit nicht implementiert; falls Sie diese heute benötigen, halten Sie den sensiblen Teil des Austauschs auf `client.data`, wo Row-Level-Security greift.
:::

> **Standardmäßig werden Broadcasts nicht wiederholt.** Sie erreichen nur aktuell verbundene Mitglieder. Das ist ideal für Benachrichtigungen, die sich selbst korrigieren – ein Hinweis "jemand hat gespeichert" wird durch das nächste Speichern abgelöst – und verursacht keine Speicherkosten. Für einen Operations-Stream, bei dem eine unbemerkte Lücke zu Inkonsistenzen führt, aktivieren Sie den [Nachrichtenverlauf](#nachrichtenverlauf-und-nachholen) auf dem Channel.

## Nachrichtenverlauf und Nachholen

Ein Channel kann so konfiguriert werden, dass er seine Broadcasts speichert. So kann ein Client, der sich wiederverbindet, verpasste Nachrichten nachholen, anstatt den Zustand komplett neu synchronisieren zu müssen. Dies macht Channels als Transportmittel für kollaborative Bearbeitung einsetzbar.

Die Aufbewahrungsdauer (Retention) wird **auf dem Server** pro Channel-Muster konfiguriert – siehe [Realtime-Backend](/docs/backend/realtime#channel-retention). Ein Client kann diese Option nicht selbst aktivieren, da Channels von jedem erstellt werden können, der ihnen einen Namen gibt; eine vom Client wählbare Verlaufstiefe würde es jedem Besucher ermöglichen, Ihren Backend-Speicher unbegrenzt zu belasten.

Übergeben Sie bei einem Channel mit aktiviertem Verlauf `{ history: true }`, und das SDK kümmert sich um den Rest:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Beim Aufruf von `join()` und nach jeder Wiederverbindung fragt das SDK den Server nach allen Ereignissen nach der zuletzt gesehenen Sequenznummer ab und leitet das Ergebnis an dieselben Handler weiter. Es muss kein zweiter Codepfad geschrieben werden: Ein Handler, der eine Operation im Live-Betrieb korrekt anwendet, wendet sie auch beim Nachholen korrekt an.

### Sequenznummern

Jeder Broadcast auf einem Channel mit Historie enthält eine `seq` – pro Channel, lückenlos und aufsteigend. Sie dient dem Client als Wiederaufsetzpunkt.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Speichern Sie `channel.sequence` persistent, wenn das Nachholen nicht nur Wiederverbindungen, sondern auch das Neuladen von Seiten überstehen soll, und übergeben Sie den Wert über `history({ sinceSeq })` zurück.

### Verlauf explizit abrufen

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` bedeutet, dass der Channel keinen Verlauf speichert und dies auch nie tun wird – eine explizite Antwort, damit Sie "Sie haben nichts verpasst" von "dieser Channel hat keine Aufbewahrungsregel" unterscheiden können. Im zweiten Fall muss ein Client, der den Zustand abgleichen muss, auf eine vollständige Neusynchronisierung zurückgreifen.

`latestSeq` ist die höchste Sequenznummer, die der Server vorhält, unabhängig davon, ob dieser Abruf sie erreicht hat. Liegt sie weit hinter Ihrer zuletzt empfangenen `seq`, sind Sie mehr als eine Seite im Rückstand, und eine vollständige Neusynchronisierung ist möglicherweise ressourcenschonender als das Paginieren.

:::note[Wiederholungen können sich überschneiden – und das ist in Ordnung]
Der Server kann nicht genau wissen, welche Nachrichten Sie erreicht haben, bevor der Socket getrennt wurde. Daher kann ein Nachholbereich Nachrichten enthalten, die Sie bereits angewendet haben. Das SDK verwirft alles, was kleiner oder gleich der bereits zugestellten Sequenznummer ist, sodass Handler keine Nachricht doppelt erhalten.

Ihre eigenen Nachrichten werden bei einer Wiederholung herausgefiltert – genau wie im Live-Betrieb –, einschließlich derer, die gesendet wurden, bevor eine Wiederverbindung dem Socket eine neue Client-ID zugewiesen hat: Der Channel merkt sich die IDs, von denen aus er gesendet hat. Ein neues Channel-Objekt – etwa nach dem Neuladen einer Seite – merkt sich keine IDs. Daher liefert ein Nachholvorgang dort Ihre früheren Nachrichten wie die aller anderen aus, was für den Wiederaufbau des Zustands aus dem Verlauf erforderlich ist.
:::

## Presence-Tracking

Mit Presence können Sie verfolgen, welche Benutzer online sind, und den gemeinsamen Zustand über alle Teilnehmer hinweg synchronisieren:

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

Das SDK verwaltet die Anwesenheitsliste für Sie, sodass `presences` immer vollständig ist und Sie sie nie aus Diffs zusammensetzen müssen.

Es übernimmt außerdem zwei Protokolldetails, bei denen bei der direkten Arbeit mit dem reinen WebSocket leicht Fehler entstehen:

- **Die Liste wird beim Beitreten nicht automatisch übertragen.** Das erste `presence_diff` eines beitretenden Clients enthält nur ihn selbst; die bestehende Liste muss explizit angefordert werden. `join()` erledigt das für Sie.
- **Presence läuft nach 30 Sekunden ab.** `track()` ist keine dauerhafte Registrierung – ohne regelmäßiges erneutes Senden verschwinden Sie stillschweigend aus den Listen aller anderen, obwohl Sie noch verbunden und auf der Seite sind. Das SDK sendet alle 20 Sekunden einen Heartbeat und stoppt diesen bei `untrack()` / `leave()`.

Bei einer Wiederverbindung gehen serverseitige Channel-Mitgliedschaften und Presence-Einträge verloren; das SDK tritt Channels automatisch wieder bei, fordert die Liste erneut an und sendet die Presence-Daten neu.

## Wann Realtime eingesetzt werden sollte

| Anwendungsfall | Methode |
|----------------|---------|
| Dashboard mit Live-Daten | `listen()` mit Filtern |
| Chat oder Messaging | `channel.broadcast()` |
| Kollaborative Bearbeitung / Operations-Streams | `channel(name, { history: true })` |
| Tipp-Indikatoren / Online-Status | `channel.track()` + `channel.onPresence()` |
| Detailseite mit Live-Updates | `listenById()` |
| Monitoring im Admin-Panel | `listen()` mit `orderBy` und `limit` |
| Eine Liste, die Verbindungsabbrüche überstehen muss | `observe()` mit aktiviertem [Offline-Modus](/docs/sdk/offline) |

> **Tipp:** Für einmalige Datenabrufe verwenden Sie stattdessen `find()` oder `findById()`. Abonnements eignen sich am besten für Daten, die sich häufig ändern und sofort in der Benutzeroberfläche widergespiegelt werden müssen.

## `listen()` vs. `observe()`

Beide halten eine Abfrage aktuell und beide geben eine Unsubscribe-Funktion zurück – sie beantworten jedoch unterschiedliche Anforderungen.

`listen()` basiert auf dem Socket: Es liefert, was der Server pusht, und liefert nichts, wenn der Socket getrennt ist.

`observe()` basiert auf der Abfrage: Bei aktiviertem [Offline-Modus](/docs/sdk/offline) liefert es Daten zuerst aus der lokalen Datenbank – noch vor jeder Netzwerkanfrage – und emittiert erneut bei lokalen Schreibvorgängen, beim Eintreffen eingereihter Schreibvorgänge auf dem Server, bei Rollbacks und bei Realtime-Ereignissen, die es selbst abonniert (sofern Sie nicht `{ realtime: false }` übergeben). Jedes Ergebnis gibt an, ob es aus dem Cache stammt und ob es Schreibvorgänge enthält, die der Server noch nicht bestätigt hat.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Ohne aktivierte Offline-Unterstützung entspricht `observe()` einer Kombination aus `find()` und `listen()` in einem einzigen Aufruf, wobei diese Flags immer auf `false` gesetzt sind.

## Nächste Schritte

- **[Daten abfragen](/docs/sdk/querying)** – CRUD-Operationen und der Query Builder
- **[Offline & Local-First Sync](/docs/sdk/offline)** – Live-Queries, die Verbindungsabbrüche überstehen
- **[Authentifizierung](/docs/sdk/authentication)** – Anmeldung und Sitzungsverwaltung
- **[Realtime-Backend](/docs/backend/realtime)** – Serverseitige WebSocket-Konfiguration

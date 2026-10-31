---
sourceHash: b9f712f58936dac9
title: Realtime-Abonnements
sidebar_label: Realtime
description: Abonnieren Sie Live-Datenänderungen mit dem typisierten Rebase SDK über WebSocket-basierte Echtzeit-Listener.
---

## Übersicht

Das typisierte Rebase SDK bietet Echtzeit-Datenabonnements über WebSocket. Wenn sich Datensätze auf dem Server ändern, werden Ihre abonnierten Callbacks sofort mit den aktualisierten Daten ausgelöst.

Die WebSocket-Verbindung wird automatisch aufgebaut, sobald eine `websocketUrl` verfügbar ist (standardmäßig abgeleitet von `baseUrl`). Wiederverbindung und Token-Aktualisierung werden automatisch für Sie abgewickelt. Ein Ausfall, der länger als etwa 15 Sekunden dauert, wird einmalig an das `onError` jedes Abonnements als `CONNECTION_LOST` gemeldet – siehe [Authentifizierung und Wiederverbindung](#authentifizierung-und-wiederverbindung).

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

`FindResult<M>` hat dieselbe Struktur, die auch `find()` zurückgibt: flache Zeilen in `data` und `{ total, limit, offset, hasMore, nextCursor }` in `meta`.

### `listen()` akzeptiert das Gleiche wie `find()`

`params` ist ein vollständiges `FindParams`. Ein Abonnement ist dieselbe Abfrage wie das zugehörige `find()`, daher akzeptiert es dieselben Eingrenzungen – `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** und **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Das ist wichtiger, als es klingt. Früher wurden `include` und `fields` hier stillschweigend verworfen, sodass dieselbe Abfrage über `find()` in einer anderen Struktur antwortete als über `listen()` – und eine Komponente, die beides renderte, sah, wie sich die Form ihrer Zeilen in dem Moment änderte, in dem ein Schreibvorgang stattfand. Sie durchlaufen nun die identische Read-Pipeline, sodass `find({ q })` und `listen({ q })` Zeilen zurückgeben, die Feld für Feld identisch sind.

Die Ausnahme ist `vectorSearch`, was **abgelehnt** statt verworfen wird: Ein Abonnement wird bei jedem passenden Schreibvorgang erneut ausgeführt, und dort werden keine Distanzen berechnet. Verwenden Sie `.vectorSearch(…).find()` für die Abfrage und abonnieren Sie ohne diese Option.

### Eine Aussendung pro Änderung

Jeder Server-Push ruft Ihren Callback **einmal** auf, mit Metadaten, die die dazugehörigen Zeilen beschreiben. Es gibt keine separate Erstausgabe (First-Paint-Emission) und kein Flag, das überprüft werden muss.

Die Metadaten treffen **im selben Frame wie die Zeilen** ein: Der Server zählt die Abfrage innerhalb derselben durch Row-Level-Security gebundenen Transaktion, die sie gelesen hat, sodass `meta.total`, `meta.hasMore` und `meta.nextCursor` genau die Zeilen daneben beschreiben. (Früher folgte auf jeden Push ein `GET /count` vom Client – ein zusätzlicher Roundtrip pro Schreibvorgang und Subscriber sowie ein Zeitfenster, in dem die Anzahl und die Zeilen unterschiedliche Zustände der Collection beschrieben.)

Zwei Fallbacks, von denen keiner ein Abonnementfehler ist und keiner `onError` aufruft:

- Wenn die Zählung des Servers **fehlgeschlagen ist**, enthält der Frame keine Gesamtzahl und die zuletzt empfangene wird wiederverwendet. Eine fehlgeschlagene Zählung sagt nichts darüber aus, wie groß die Collection ist, daher darf sie eine echte Antwort nicht überschreiben.
- Wenn für dieses Abonnement noch nie eine Gesamtzahl eingetroffen ist – ein älterer Server, der überhaupt keine Metadaten sendet –, fragt der Client beim ersten Push einmal nach. Schlägt auch dies fehl, ist `meta.total` eine **untere Grenze**: die Zeilen auf dieser Seite plus diejenigen, an denen vorbeigeblättert wurde, um sie zu erreichen.

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

Jeder Frame enthält die in `options.include` benannten Relationen, geladen so, wie `find({ include })` sie in jede Zeile einer Liste lädt. Eine To-Many-Relation, die dort nicht aufgeführt ist, fehlt in der Zeile und ist nicht einfach leer:

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Einschränkungen.** Ein Frame wird gesendet, wenn sich die Zeile selbst ändert, und jeder Frame lädt seine eingebundenen Relationen neu. Eine Änderung an einer verknüpften Zeile allein sendet keinen Frame: Das Bearbeiten des Namens eines Tags aktualisiert einen Post, der mit `include: ["tags"]` abgehört wird, erst dann, wenn sich auch der Post ändert. Um den verknüpften Zeilen zu folgen, hören Sie auch deren Collection ab.

## Eine Anzahl beobachten

`listenCount()` hält eine Zählung aktuell: die Gesamtzahl dessen, worauf der Filter einer Liste zutrifft, etwa für eine Toolbar oder eine „Alle N auswählen“-Option, die nicht veralten soll, während andere Benutzer Zeilen hinzufügen und entfernen. Der Callback wird mit der Gesamtzahl ausgeführt, sobald diese bekannt ist, und erneut, wann immer ein Schreibvorgang sie ändert.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Nur der Filter zählt – `where`, `logical` und `searchString`; ein `limit`, ein `offset` oder eine Sortierung wird ignoriert. Der Server liest dafür keine Zeilen, sondern nur die Anzahl, unter der Identität des Abonnenten wie bei jedem anderen Frame. Ein Server älter als 0.25 kennt diese Anfrage nicht; sie wird mit einer Zeile und derselben Gesamtzahl beantwortet, und das SDK liest die Gesamtzahl daraus ab. Auf einem Client ohne Socket ist `listenCount()` ein Stub, der einen Fehler wirft, genau wie `listen()`. Bei aktivierter [Offline-Unterstützung](/docs/sdk/offline/) entspricht die Anzahl der des Servers: In der Warteschlange befindliche Schreibvorgänge sind darin nicht enthalten, bis sie erneut abgespielt werden.

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

Ein Abonnement akzeptiert wie jede andere Abfrage eine mehrspaltige Sortierung – entweder über `orderBy: [["category", "asc"], ["createdAt", "desc"]]` in den Parametern oder durch einen zweiten `.orderBy()`-Aufruf, der ein Kriterium zur Rangentscheidung hinzufügt, anstatt das erste zu ersetzen. Siehe [Sortierung](/docs/sdk/querying#sorting).

Der Server überprüft beim Eintreffen die *Struktur* des `orderBy` eines Abonnements und lehnt ein fehlerhaft formatiertes mit einem Fehler-Frame ab, anstatt das Abonnement einzurichten. Eine Sortierung, die er nicht lesen könnte, würde andernfalls Zeilen in völlig beliebiger Reihenfolge streamen, ohne einen Fehler zu melden – und ein `collection_update`-Frame überträgt Zeilen und sonst nichts, sodass ein Abonnent keine Möglichkeit hätte, dies zu bemerken.

## Abonnement beenden

Jedes Abonnement gibt eine `unsubscribe`-Funktion zurück. Rufen Sie diese auf, um keine Aktualisierungen mehr zu erhalten und den WebSocket-Listener zu bereinigen:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

Verwenden Sie in React die `useEffect`-Bereinigung:

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

- Bei **Anmeldung** oder **Token-Aktualisierung** übernimmt ein bereits geöffneter Socket die neuen Anmeldedaten. Ein Refresh oder eine Anmeldung mit dem bereits vorhandenen Account sendet das Token in einer `authenticate`-Nachricht; eine Anmeldung mit einem anderen Account – einschließlich eines Besuchers, der sich anmeldet – baut den Socket neu auf, der sich als dieser Account authentifiziert und jedes aktive Abonnement und jeden Kanal erneut sendet. Ist keiner geöffnet, passiert nichts – das Anmelden ist keine Anforderung für Realtime, und ein später geöffneter Socket authentifiziert sich selbst.
- Bei **Abmeldung** wird die WebSocket-Verbindung getrennt. Der Client bleibt nutzbar; ein späteres Abonnement verbindet sich anonym wieder.
- Wenn die Verbindung abbricht, verbindet sich der Client **automatisch wieder** und stellt alle aktiven Abonnements wieder her. Er hört nie auf, es zu versuchen, solange ein Abonnement oder ein beigetretener Kanal existiert; die Verzögerung zwischen den Versuchen wächst auf maximal 30 Sekunden an.
- Wenn der Server die Sitzung des Sockets beendet – der Benutzer hat sich überall abgemeldet, diese Sitzung wurde widerrufen, das Konto wurde gelöscht oder das Token ist abgelaufen, bevor eine Aktualisierung den Socket erreichte –, schließt er den Socket mit dem Code `4001`. Der Client verbindet sich wie nach jedem Verbindungsabbruch wieder und authentifiziert sich mit der Sitzung, die er dann hält (sofern möglich aktualisiert), oder anonym, wenn keine vorhanden ist. Der Entzug einer Rolle schließt den Socket nicht: Er gilt ab dem nächsten Frame. Siehe [Authentication & RLS](/docs/backend/realtime/#authentication--rls).
- Wenn die Verbindung länger als etwa 15 Sekunden unterbrochen bleibt, wird das `onError` jedes Abonnements (und das `onError` jedes beigetretenen Kanals) **einmal** mit einem `RebaseApiError` aufgerufen, dessen `code` `CONNECTION_LOST` lautet. Das Abonnement wird nicht beendet: Zeigen Sie weiterhin an, was Sie haben, markieren Sie es als möglicherweise veraltet (stale) und warten Sie ab. Sobald der Socket wieder da ist, enthält das nächste `onUpdate` des Abonnements alles, was in der Zwischenzeit geschrieben wurde.
- `client.ws.state` ist der Zustand der Verbindung – `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` oder `closed` – und `client.ws.onStateChange(listener)` wird über jede Änderung informiert. `disconnected` ist der Zustand, in dem `CONNECTION_LOST` gemeldet wurde.
- Über den Socket gesendete Anfragen sind **At-most-once** (höchstens einmal). Eine Anfrage, die gesendet wurde, als die Verbindung abbrach, schlägt mit `CONNECTION_LOST` fehl und wird nie wieder gesendet, da der Server sie möglicherweise bereits ausgeführt hat. Eine Anfrage, die nach 30 Sekunden immer noch auf einen Socket wartet, schlägt mit `REQUEST_TIMEOUT` fehl, ohne gesendet worden zu sein.

Alles in der Liste nach der Abmeldung wurde in 0.24 eingeführt. In 0.23 gibt der Client nach fünf fehlgeschlagenen Wiederverbindungsversuchen auf, stellt Anfragen, die während der Trennung gestellt wurden, in eine Warteschlange und sendet sie bei Wiederverbindung, besitzt kein `client.ws.state`, und der Server schließt niemals einen Socket, dessen Sitzung beendet ist.

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

In Version 0.24 verwendet der Socket nur die eigene Sitzung des Clients und die Option `token`: Ein mit `client.setAuthTokenGetter()` eingerichteter Getter erreicht ihn nie, sodass ein Host, der seinen eigenen Auth-Provider verwendet, einen anonymen Socket erhält.

Der Socket authentifiziert sich mit demselben Token, das auch eine HTTP-Anfrage übertragen würde. Dies ist primär der mit `client.setAuthTokenGetter()` eingerichtete Getter; wenn keiner vorhanden ist oder dieser `null` zurückgibt oder einen Fehler wirft, ist es das vom Client gehaltene Token: das seiner Sitzung, ein mit `client.setToken()` festgelegtes Token oder die Option `token`. Bei integriertem `client.auth` muss nichts weiter konfiguriert werden.

Für einen externen Auth-Provider (Clerk, Firebase Auth, eine eigene Sitzung) richten Sie den Getter einmalig ein. Er deckt sowohl HTTP als auch den Socket ab:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` reagiert bei beiden auf ein abgelehntes Token: einen 401 über HTTP und einen Auth-Fehler auf dem Socket. Geben Sie `true` zurück, um den Vorgang mit dem erneut aufgelösten Token zu wiederholen. Es ersetzt den client-eigenen Session-Refresh.
- Das Installieren eines Getters oder der Aufruf von `client.setToken()` baut einen geöffneten Socket neu auf: Der neue authentifiziert sich mit den neuen Anmeldedaten und sendet jedes aktive Abonnement und jeden Kanal als diese Identität erneut; nichts, was die vorherige Identität besaß, wird übernommen. Wenn kein Socket geöffnet ist, authentifiziert sich der nächste von selbst.
- `client.ws.setAuthTokenGetter()` ist veraltet (deprecated). Es funktioniert weiterhin, ersetzt aber nur den Getter des Sockets und gibt eine einmalige Warnung aus. Verwenden Sie `client.setAuthTokenGetter()`.

Siehe [Verwendung eines eigenen Auth-Providers](/docs/sdk/authentication#using-your-own-auth-provider).

### Die Verbindung wird verzögert aufgebaut (lazy)

Das Erstellen eines Clients öffnet **keinen** WebSocket. Er wird erst bei der ersten Operation angewählt, die tatsächlich einen benötigt – ein `listen()`- / `listenById()`-Abonnement oder eine Kanal-Operation wie `join()`, `track()` oder `broadcast()`. Das bloße Abrufen eines Kanals gilt nicht als dessen Nutzung.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Dies ist wichtig für Anwendungen mit nennenswertem Traffic von nicht angemeldeten Benutzern – Marketing-Seiten, öffentliche schreibgeschützte Ansichten, anonym-first Werkzeuge –, die zuvor bei jedem Seitenaufruf eine Verbindung bezahlt haben, nur um Realtime bereitzustellen.

Zwei damit verbundene Verhaltensweisen:

- `realtime: false` bleibt ein striktes Opt-out: niemals ein Socket, und `client.realtime.channel()` wirft einen Fehler. Dasselbe gilt für `listen()` und `listenById()` – sie stehen immer zum Aufruf bereit, werfen jedoch auf einem Client ohne Socket einen `RebaseClientError`, der die Option benennt, die sie aktivieren würde. `observe()` tut dies nicht: Es stuft sich auf einen einfachen Fetch herab.
- `client.close()` ist endgültig. Es gibt den Socket und seinen Wiederverbindungs-Timer frei, und nichts, was danach in die Warteschlange gestellt wird, wählt sich erneut ein. In Node hält ein geöffneter Socket den Event-Loop am Leben, sodass ein Skript, das dies nie aufruft, sich nicht von selbst beendet.

### Eine Gruppe auf einer Instanz halten

Bei mehr als einer Server-Instanz können Mitglieder eines Kanals auf verschiedenen Instanzen landen, und jede Nachricht zwischen ihnen [überquert dann den Channel-Bus](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` benennt die Gruppe, zu der ein Socket gehört, z. B. einen Raum oder ein Dokument, sodass eine Plattform die gesamte Gruppe an dieselbe Instanz leiten kann:

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

Der Schlüssel wird an die Adresse des Sockets als `?affinity=` angehängt und ersetzt einen bereits vorhandenen Schlüssel in einer von Ihnen gesetzten `websocketUrl`. `setAffinity(null)` setzt ihn zurück.

- **Es ist eine Optimierung.** Rebase Cloud routet anhand dieses Schlüssels, wenn ein Projekt mehr als eine Instanz betreibt. Bei Self-Hosting oder hinter einem Proxy, der nicht darauf hasht, hat dies keine Auswirkungen, und Kanäle funktionieren wie gewohnt: Der Bus überträgt weiterhin alles instanzübergreifend, einschließlich einer Gruppe, die durch ein Scale-up aufgeteilt wurde.
- **Es wird wirksam, wenn der Socket eine Verbindung aufbaut.** Ein bereits geöffneter Socket bleibt dort, wo er ist, und verwendet den neuen Schlüssel bei der nächsten Verbindung. Um einen verbundenen Client zu verschieben, erstellen Sie einen neuen oder setzen Sie den Schlüssel vor dessen erstem `join()` oder `listen()`.
- **Es bestimmt, wo ein Socket landet, nicht, worauf er zugreifen darf.** Der Zugriff auf einen Kanal hängt nicht davon ab, und die Adresse landet in den Zugriffsprotokollen; verwenden Sie daher eher einen Code als ein Secret oder persönliche Daten.

Um zu sehen, ob es funktioniert, vergleichen Sie, was jede Instanz veröffentlicht und überspringt: siehe [Den Channel-Bus beobachten](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Broadcast-Kanäle

Broadcast-Kanäle ermöglichen das Senden beliebiger Nachrichten zwischen verbundenen Clients – ideal für Chats, Benachrichtigungen oder kollaborative Funktionen:

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

Kanäle sind leichtgewichtig und flüchtig – sie existieren so lange, wie mindestens ein Client abonniert ist. Wiederholte `channel()`-Aufrufe mit demselben Namen geben das **gleiche** Objekt zurück, sodass zwei Komponenten Handler unabhängig voneinander anhängen können, ohne dass eine Komponente die andere durch Verlassen abschneidet.

Kanal- und Presence-Frames erfordern kein Konto: Anonyme Besucher können öffentlichen Kanälen beitreten.

:::caution[Kanäle haben noch keine Zugriffsregeln]
Die einzige Prüfung, die der Server anwendet, ist die **Mitgliedschaft**: Um in einen Kanal zu senden (Broadcast), dessen Presence-Roster zu lesen oder dessen Historie abzuspielen, muss ein Client diesem Kanal zuvor beigetreten sein. Der Beitritt selbst ist offen – jeder Client, der einen Kanal benennen kann, kann ihm beitreten, unabhängig davon, ob er angemeldet ist oder nicht.

Ein Kanalname ist daher weder ein Geheimnis noch eine Berechtigung. Stellen Sie nichts in einen Kanal (einschließlich gespeicherter Historie und Presence-Status), was nicht jeder Benutzer Ihrer Anwendung sehen darf, und leiten Sie einen Kanalnamen nicht von Daten ab, die Sie nicht preisgeben würden. Autorisierungsregeln pro Kanal sind nicht implementiert; wenn Sie diese heute benötigen, belassen Sie den sensiblen Teil des Austauschs auf `client.data`, wo Row-Level-Security gilt.
:::

> **Standardmäßig werden Broadcasts nicht erneut abgespielt.** Sie erreichen nur aktuell verbundene Mitglieder. Das ist genau das, was Sie für Benachrichtigungen wollen, die sich selbst korrigieren – ein Hinweis wie „Jemand hat gespeichert“ wird durch das nächste Speichern abgelöst – und es verursacht keine Kosten. Für einen Operations-Stream, bei dem eine unbemerkte Lücke zu Abweichungen führt, aktivieren Sie den [Nachrichtenverlauf](#nachrichtenverlauf-und-aufholen-catch-up) für den Kanal.

## Nachrichtenverlauf und Aufholen (Catch-Up)

Ein Kanal kann so konfiguriert werden, dass er seine Broadcasts speichert, sodass ein Client, der sich wiederverbindet, verpasste Nachrichten nachholt, anstatt sich von Grund auf neu zu synchronisieren. Das macht Kanäle als Transportmittel für kollaboratives Bearbeiten nutzbar.

Die Aufbewahrung (Retention) wird **auf dem Server** pro Kanalmuster konfiguriert – siehe [Realtime-Backend](/docs/backend/realtime#channel-retention). Ein Client kann sie nicht selbst aktivieren, da ein Kanal von jedem erstellt wird, der ihn benennt, und eine vom Client gewählte Historientiefe es jedem Besucher erlauben würde, Ihr Backend mit unbegrenztem Speicherbedarf zu belasten.

Übergeben Sie bei einem gespeicherten Kanal `{ history: true }`, und das SDK kümmert sich um den Rest:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Bei `join()` und nach jeder Wiederverbindung fragt das SDK beim Server alles ab, was nach der zuletzt gesehenen Sequenznummer liegt, und liefert das Ergebnis über dieselben Handler aus. Es muss kein zweiter Codepfad geschrieben werden: Ein Handler, der eine Operation im Live-Betrieb korrekt anwendet, wendet sie auch beim Aufholen (Catch-Up) korrekt an.

### Sequenznummern

Jeder Broadcast auf einem gespeicherten Kanal trägt eine `seq` – kanalspezifisch, lückenlos und fortlaufend ansteigend. Sie dient als Wiederaufsetzpunkt für den Client.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Speichern Sie `channel.sequence` persistent, wenn das Nachholen nicht nur eine Wiederverbindung, sondern auch ein Neuladen der Seite überstehen soll, und übergeben Sie sie über `history({ sinceSeq })` zurück.

### Verlauf explizit abrufen

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` bedeutet, dass der Kanal keinen Verlauf behält und dies auch nie tun wird – eine explizite Antwort, damit Sie „Sie haben nichts verpasst“ von „Dieser Kanal hat keine Retention-Regel“ unterscheiden können. Im zweiten Fall muss ein Client, der synchronisiert werden muss, auf eine vollständige Neusynchronisierung zurückgreifen.

`latestSeq` ist die höchste Sequenz, die der Server vorhält, unabhängig davon, ob dieser Batch sie erreicht hat. Liegt sie weit hinter Ihrer zuletzt ausgelieferten `seq`, hinken Sie mehr als eine Seite hinterher, und eine Neusynchronisierung ist möglicherweise günstiger als das Paginieren.

:::note[Wiederholungen können sich überschneiden, und das ist in Ordnung]
Der Server kann nicht genau wissen, welche Nachrichten Sie erreicht haben, bevor der Socket abbrach; daher kann ein Aufholbereich einige Nachrichten enthalten, die Sie bereits angewendet haben. Das SDK verwirft alles, was auf oder unter der Sequenz liegt, die es bereits ausgeliefert hat, sodass Handler niemals eine Nachricht doppelt sehen.

Ihre eigenen Nachrichten werden bei einer Wiederholung ebenso herausgefiltert wie live, einschließlich derjenigen, die gesendet wurden, bevor eine Wiederverbindung dem Socket eine neue Client-ID zugewiesen hat: Der Kanal merkt sich die IDs, von denen aus er gesendet hat. Ein neues Kanalobjekt – beispielsweise nach einem Neuladen der Seite – merkt sich keine davon, sodass ein Catch-Up dort Ihre früheren Nachrichten wie die aller anderen liefert; genau das ist für den Wiederaufbau des Zustands aus der Historie erforderlich.
:::

## Presence-Tracking

Presence ermöglicht es Ihnen nachzuverfolgen, welche Benutzer online sind, und den gemeinsamen Zustand über alle Teilnehmer hinweg zu synchronisieren:

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

Das SDK verwaltet die Teilnehmerliste (Roster) für Sie, sodass `presences` immer vollständig ist und Sie sie niemals aus Diffs zusammensetzen müssen.

Es kümmert sich auch um zwei Protokolldetails, bei denen man bei der direkten Arbeit mit dem reinen WebSocket leicht Fehler macht:

- **Die Teilnehmerliste wird beim Beitritt nicht automatisch übertragen.** Das erste `presence_diff` eines beitretenden Clients enthält nur ihn selbst; die bestehende Teilnehmerliste muss explizit angefordert werden. `join()` erledigt das für Sie.
- **Presence läuft nach 30 Sekunden ab.** `track()` ist keine dauerhafte Registrierung – ohne regelmäßiges erneutes Senden verschwinden Sie stillschweigend aus der Liste aller anderen, obwohl Sie noch verbunden und noch auf der Seite sind. Das SDK sendet alle 20 Sekunden einen Heartbeat und stoppt bei `untrack()` / `leave()`.

Eine Wiederverbindung hebt serverseitig auch die Kanalmitgliedschaft und Presence auf; das SDK tritt automatisch wieder bei, fordert die Liste erneut an und sendet die Presence-Daten neu.

## Wann Realtime verwendet werden sollte

| Anwendungsfall | Methode |
|---|---|
| Dashboard mit Live-Daten | `listen()` mit Filtern |
| Chat oder Messaging | `channel.broadcast()` |
| Kollaborative Bearbeitung / Operations-Streams | `channel(name, { history: true })` |
| Tippanzeigen / Online-Status | `channel.track()` + `channel.onPresence()` |
| Detailseite mit Live-Updates | `listenById()` |
| Admin-Panel-Überwachung | `listen()` mit `orderBy` und `limit` |
| Eine Liste, die einen Verbindungsabbruch überstehen muss | `observe()` mit aktiviertem [Offline-Modus](/docs/sdk/offline) |

> **Tipp:** Verwenden Sie für einmalige Datenabfragen stattdessen `find()` oder `findById()`. Abonnements eignen sich am besten für Daten, die sich häufig ändern und sofort in der Benutzeroberfläche widergespiegelt werden müssen.

## `listen()` im Vergleich zu `observe()`

Beide halten eine Abfrage aktuell und beide geben eine Unsubscribe-Funktion zurück – aber sie beantworten unterschiedliche Anforderungen.

`listen()` ist der Socket: Es liefert, was der Server pusht, und liefert nichts, wenn der Socket getrennt ist.

`observe()` ist die Abfrage: Bei aktiviertem [Offline-Modus](/docs/sdk/offline) sendet es zuerst Daten aus der lokalen Datenbank – noch vor jeder Netzwerkanfrage – und sendet erneut bei lokalen Schreibvorgängen, wenn Schreibvorgänge in der Warteschlange den Server erreichen, bei Rollbacks sowie bei Realtime-Ereignissen, die es selbst abonniert, sofern Sie nicht `{ realtime: false }` übergeben. Jedes Ergebnis gibt an, ob es aus dem Cache stammt und ob es Schreibvorgänge enthält, die der Server noch nicht akzeptiert hat.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Ohne aktivierten Offline-Modus ist `observe()` die Kombination aus `find()` und `listen()` in einem einzigen Aufruf, wobei diese Flags immer `false` sind.

## Nächste Schritte

- **[Daten abfragen](/docs/sdk/querying)** — CRUD-Operationen und Query Builder
- **[Offline- & Local-First-Synchronisierung](/docs/sdk/offline)** — Live-Abfragen, die einen Verbindungsabbruch überstehen
- **[Authentifizierung](/docs/sdk/authentication)** — Anmeldung und Sitzungsverwaltung
- **[Realtime-Backend](/docs/backend/realtime)** — Serverseitige WebSocket-Konfiguration

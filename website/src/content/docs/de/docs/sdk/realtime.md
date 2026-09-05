---
title: Echtzeit-Abonnements
sidebar_label: Echtzeit
description: Abonnieren Sie Live-Datenänderungen mit dem Rebase Client SDK über WebSocket-basierte Echtzeit-Listener.
---

## Überblick

Das Rebase Client SDK bietet Echtzeit-Datenabonnements über WebSocket. Wenn sich Datensätze auf dem Server ändern, werden Ihre abonnierten Callbacks sofort mit den aktualisierten Daten ausgelöst.

Die WebSocket-Verbindung wird automatisch aufgebaut, sobald eine `websocketUrl` verfügbar ist (standardmäßig aus `baseUrl` abgeleitet). Wiederverbindung und Token-Aktualisierung werden transparent gehandhabt.

## Eine Collection abonnieren

Verwenden Sie `listen()`, um eine Collection-Abfrage zu abonnieren. Der Callback wird ausgelöst, sobald sich der passende Datensatz ändert:

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

Die Methode `listen()` akzeptiert dieselben `FindParams` wie `find()` — Sie können Ihr Abonnement filtern, sortieren und paginieren:

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

`FindResult<M>` ist dieselbe Form, die `find()` zurückgibt: flache Zeilen in `data` und
`{ total, limit, offset, hasMore }` in `meta`.

### Eine Emission pro Änderung

Jeder Server-Push ruft Ihren Callback **einmal** auf, mit Metadaten, die die
nebenstehenden Zeilen beschreiben. Es gibt keine separate erste Emission und kein Flag,
das geprüft werden müsste:

- Vor der Emission läuft ein `count()` für die Abfrage, daher sind `meta.total` und
  `meta.hasMore` autoritativ.
- Trifft ein Push ein, während diese Zählung noch läuft, wird die ältere Emission
  verworfen — Sie erhalten nie einen Callback mit einem Gesamtwert einer früheren Seite.
- **Schlägt** die Zählung fehl, wird der letzte tatsächlich zurückgegebene Gesamtwert
  weiterverwendet. Eine fehlgeschlagene Zählung sagt nichts über die Größe der Sammlung
  aus und darf eine echte Antwort daher nicht überschreiben. Das ist kein
  Abonnementfehler, und `onError` wird nicht aufgerufen.
- Ist für dieses Abonnement noch nie eine Zählung gelungen, ist `meta.total` eine
  **untere Schranke** — die Zeilen dieser Seite plus die übersprungenen — und
  `meta.hasMore` ist `true`, wenn die Seite voll zurückkam.

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
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        if (entity) {
            console.log("Product changed:", entity.values.name);
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

```typescript
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

Der Callback erhält eine flache Zeile — keine `Entity`, also ohne `.values` — und
`undefined`, wenn der Datensatz gelöscht wurde.

## Fluent-Query-Builder

Sie können auch über den Fluent-Query-Builder abonnieren. Dies entspricht dem Aufruf von `listen()` mit Parametern, erlaubt aber das Verketten von `.where()`, `.orderBy()` usw.:

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

## Abbestellen

Jedes Abonnement gibt eine `unsubscribe`-Funktion zurück. Rufen Sie sie auf, um keine Updates mehr zu erhalten und den WebSocket-Listener aufzuräumen:

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

- Bei der **Anmeldung** oder **Token-Aktualisierung** wird das neue Token über eine `authenticate`-Nachricht an den WebSocket-Server gesendet.
- Bei der **Abmeldung** wird die WebSocket-Verbindung getrennt.
- Wenn die Verbindung abbricht, **verbindet sich der Client automatisch neu** und stellt alle aktiven Abonnements wieder her.

Es ist keine manuelle Token-Verwaltung erforderlich — die Integration zwischen `client.auth` und der WebSocket-Schicht wird intern gehandhabt.

## Broadcast-Kanäle

Broadcast-Kanäle ermöglichen das Senden beliebiger Nachrichten zwischen verbundenen Clients — ideal für Chat, Benachrichtigungen oder kollaborative Funktionen:

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

Kanäle sind leichtgewichtig und ephemer — sie existieren, solange mindestens ein Client abonniert ist.

> **Standardmäßig werden Broadcasts nicht wiederholt.** Sie erreichen nur die aktuell verbundenen Mitglieder. Genau das will man für Benachrichtigungen, die sich selbst korrigieren — ein «jemand hat gespeichert»-Hinweis wird vom nächsten Speichern abgelöst — und es kostet nichts. Für einen Operationsstrom, bei dem eine stille Lücke zu Divergenz führt, aktivieren Sie den [Nachrichtenverlauf](#nachrichtenverlauf-und-aufholen) für den Kanal.

## Nachrichtenverlauf und Aufholen

Ein Kanal kann so konfiguriert werden, dass er seine Broadcasts aufbewahrt. Ein Client, der sich neu verbindet, holt dann das Verpasste nach, statt von vorn zu synchronisieren. Das macht Kanäle als Transport für kollaboratives Bearbeiten überhaupt erst brauchbar.

Die Aufbewahrung wird **auf dem Server** konfiguriert, pro Kanalmuster — siehe [Realtime-Backend](/docs/backend/realtime#kanal-aufbewahrung). Ein Client kann sie nicht selbst einschalten: Ein Kanal entsteht dadurch, dass jemand ihn benennt, und eine vom Client gewählte Verlaufstiefe würde jedem Besucher erlauben, Ihr Backend auf unbegrenzten Speicher festzulegen.

Übergeben Sie bei einem Kanal mit Aufbewahrung `{ history: true }` — den Rest erledigt das SDK:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Bei `join()` und nach jeder Wiederverbindung fragt das SDK den Server nach allem seit der zuletzt gesehenen Sequenznummer und liefert das Ergebnis über dieselben Handler aus. Es gibt keinen zweiten Codepfad zu schreiben: Ein Handler, der eine Operation live korrekt anwendet, wendet sie auch beim Aufholen korrekt an.

### Sequenznummern

Jeder Broadcast auf einem Kanal mit Aufbewahrung trägt ein `seq` — pro Kanal, lückenlos und aufsteigend. Es ist der Wiederaufsetzpunkt des Clients.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Speichern Sie `channel.sequence` dauerhaft, wenn das Aufholen auch ein Neuladen der Seite überstehen soll, und geben Sie es über `history({ sinceSeq })` zurück.

### Verlauf explizit abrufen

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` bedeutet, dass der Kanal keinen Verlauf führt und nie führen wird — eine ausdrückliche Antwort, damit Sie «Sie haben nichts verpasst» von «dieser Kanal hat keine Aufbewahrungsregel» unterscheiden können. Im zweiten Fall muss ein Client, der konvergieren muss, auf eine vollständige Neusynchronisation zurückfallen.

`latestSeq` ist die höchste Sequenz, die der Server vorhält — unabhängig davon, ob dieser Stapel sie erreicht hat. Liegt sie weit über Ihrem zuletzt ausgelieferten `seq`, sind Sie weiter zurück als eine Seite, und eine Neusynchronisation kann günstiger sein als seitenweises Nachladen.

:::note[Wiederholungen dürfen sich überschneiden]
Der Server kann nicht wissen, welche Nachrichten Sie vor dem Verbindungsabbruch noch erreicht haben. Ein Aufholbereich kann daher Nachrichten enthalten, die Sie bereits angewendet haben. Das SDK verwirft alles bis einschließlich der bereits ausgelieferten Sequenz, sodass Handler eine Nachricht nie zweimal sehen.

Ihre eigenen Nachrichten werden **nicht** aus einer Wiederholung herausgefiltert: Eine Wiederverbindung vergibt eine neue Client-ID, sodass ausgerechnet der Fall, für den das Aufholen existiert, derjenige wäre, in dem dieser Filter versagt. Machen Sie Operationen idempotent, falls das erneute Anwenden eigener Operationen ein Problem wäre.
:::
## Präsenz-Tracking

Präsenz ermöglicht es Ihnen, zu verfolgen, welche Benutzer online sind, und den gemeinsamen Zustand über alle Teilnehmer hinweg zu synchronisieren:

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

Die Präsenz baut auf Broadcast-Kanälen mit automatischem Zustandsvergleich auf — nur Änderungen werden übertragen.

## Wann Echtzeit verwenden

| Anwendungsfall | Methode |
|----------|--------|
| Dashboard mit Live-Daten | `listen()` mit Filtern |
| Chat oder Messaging | `channel.broadcast()` |
| Kollaboratives Bearbeiten / Operationsströme | `channel(name, { history: true })` |
| Tippindikatoren / Online-Status | `channel.track()` + `channel.onPresence()` |
| Detailseite mit Live-Updates | `listenById()` |
| Überwachung im Admin-Panel | `listen()` mit `orderBy` und `limit` |

> **Tipp:** Für einmalige Datenabrufe verwenden Sie stattdessen `find()` oder `findById()`. Abonnements eignen sich am besten für Daten, die sich häufig ändern und sofort in der UI wiedergegeben werden müssen.

## Nächste Schritte

- **[Daten abfragen](/docs/sdk/querying)** — CRUD-Operationen und Query-Builder
- **[Authentifizierung](/docs/sdk/authentication)** — Anmeldung und Sitzungsverwaltung
- **[Echtzeit im Backend](/docs/backend/realtime)** — Serverseitige WebSocket-Konfiguration

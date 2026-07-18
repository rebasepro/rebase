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
        where: { status: "pending" },
        orderBy: ["created_at", "desc"],
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

```typescript
listen(
    params: FindParams | undefined,
    onUpdate: (response: FindResponse<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

### Zweiphasige Metadaten

Wenn `listen()` ausgelöst wird, gibt es Updates in bis zu zwei Phasen aus:

1. **Sofort (geschätzt):** Der erste Callback wird sofort mit den Entitäten und heuristischen Paginierungs-Metadaten ausgelöst (`total` = Anzahl der zurückgegebenen Entitäten, `hasMore` = ob die Anzahl dem angeforderten Limit entspricht). Diese Emission trägt `meta.estimated: true`.

2. **Autoritativ (optional):** Eine asynchrone Zählabfrage läuft im Hintergrund. Wenn der autoritative `total`- oder `hasMore`-Wert von der Schätzung abweicht, wird ein zweiter Callback mit korrigierten Metadaten und **ohne** `estimated`-Flag ausgelöst. Stimmen die Werte überein, wird die zweite Emission vollständig übersprungen — Ihr Callback wird nur einmal ausgelöst.

Wenn die Zählabfrage **fehlschlägt**, erfolgt keine zweite Emission. Das `estimated: true`-Flag der ersten Emission bleibt als Signal dafür bestehen, dass die Metadaten heuristisch sind. Dies wird nicht als Abonnementfehler behandelt.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        if (response.meta.estimated) {
            // First-paint: render immediately, total/hasMore may change
            renderProducts(response.data, { loading: true });
        } else {
            // Authoritative: safe to render final pagination controls
            renderProducts(response.data, { loading: false });
        }
    }
);
```

> **Tipp:** Wenn Sie nicht zwischen geschätzten und autoritativen Metadaten unterscheiden müssen, können Sie das `estimated`-Flag ignorieren — beide Emissionen tragen dasselbe `data`-Array.

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
    onUpdate: (entity: Entity<M> | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

Der Callback erhält `undefined`, wenn die Entität gelöscht wird.

## Fluent-Query-Builder

Sie können auch über den Fluent-Query-Builder abonnieren. Dies entspricht dem Aufruf von `listen()` mit Parametern, erlaubt aber das Verketten von `.where()`, `.orderBy()` usw.:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("created_at", "desc")
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
// Join a channel
const channel = client.realtime.channel("chat-room");

// Listen for messages
channel.on("message", (payload) => {
    console.log("New message:", payload);
});

// Send a message to all subscribers
channel.send("message", {
    text: "Hello, world!",
    userId: currentUser.id
});

// Leave the channel
channel.unsubscribe();
```

Kanäle sind leichtgewichtig und ephemer — sie existieren, solange mindestens ein Client abonniert ist.

## Präsenz-Tracking

Präsenz ermöglicht es Ihnen, zu verfolgen, welche Benutzer online sind, und den gemeinsamen Zustand über alle Teilnehmer hinweg zu synchronisieren:

```typescript
const channel = client.realtime.channel("editors");

// Track your presence
channel.presence.track({
    userId: currentUser.id,
    status: "editing",
    cursor: { x: 100, y: 200 }
});

// Listen for presence changes
channel.presence.on("sync", (state) => {
    console.log("Online users:", Object.keys(state));
});

channel.presence.on("join", (key, newPresence) => {
    console.log(`${key} came online:`, newPresence);
});

channel.presence.on("leave", (key) => {
    console.log(`${key} went offline`);
});

// Update your state
channel.presence.track({
    userId: currentUser.id,
    status: "idle"
});
```

Die Präsenz baut auf Broadcast-Kanälen mit automatischem Zustandsvergleich auf — nur Änderungen werden übertragen.

## Wann Echtzeit verwenden

| Anwendungsfall | Methode |
|----------|--------|
| Dashboard mit Live-Daten | `listen()` mit Filtern |
| Chat oder Messaging | `channel.send()` per Broadcast |
| Tippindikatoren / Online-Status | `channel.presence.track()` |
| Detailseite mit Live-Updates | `listenById()` |
| Überwachung im Admin-Panel | `listen()` mit `orderBy` und `limit` |

> **Tipp:** Für einmalige Datenabrufe verwenden Sie stattdessen `find()` oder `findById()`. Abonnements eignen sich am besten für Daten, die sich häufig ändern und sofort in der UI wiedergegeben werden müssen.

## Nächste Schritte

- **[Daten abfragen](/docs/sdk/querying)** — CRUD-Operationen und Query-Builder
- **[Authentifizierung](/docs/sdk/authentication)** — Anmeldung und Sitzungsverwaltung
- **[Echtzeit im Backend](/docs/backend/realtime)** — Serverseitige WebSocket-Konfiguration

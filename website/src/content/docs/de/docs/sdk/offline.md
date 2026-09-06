---
sourceHash: f3023e081dcc3e4a
title: Offline & Local-First-Sync
sidebar_label: Offline
description: Aktivieren Sie die Local-First-Sync-Engine des Rebase Client SDK — eine lokale Zeilendatenbank, sofortige Offline-Schreibvorgänge mit Rollback und reaktive Live-Abfragen.
---

## Überblick

Die Offline-Unterstützung macht aus der Datenschicht des SDK eine **Local-First-Sync-Engine**. Statt eines Caches, der sich Antworten merkt, hält der Client eine kleine lokale Datenbank aus Zeilen vor, beantwortet Abfragen daraus und behandelt das Netzwerk als etwas, das sie befüllt und Ihre Schreibvorgänge irgendwann annimmt.

Daraus ergeben sich drei Dinge:

- **Lesevorgänge überstehen den Ausfall des Netzwerks.** Eine Abfrage, die der Client lokal auswerten kann, wird lokal ausgewertet — samt Filtern, Sortierung und Paginierung —, sodass eine Liste auch bei toter Verbindung weiter gerendert wird.
- **Über Schreibvorgänge wird lokal entschieden.** Ein offline getätigter Schreibvorgang wird sofort angewendet, in die Warteschlange gestellt und der Reihe nach wiederholt, sobald die Verbindung zurückkehrt. Lehnt der Server ihn ab, wird die lokale Änderung zurückgerollt.
- **Lesevorgänge sind reaktiv.** `observe()` gibt zuerst aus der lokalen Datenbank aus und gibt erneut aus, sobald irgendetwas die abgedeckten Zeilen ändert — Ihre eigenen Schreibvorgänge, ein eintreffender Schreibvorgang aus der Warteschlange, ein Rollback, ein anderer Browser-Tab oder ein Echtzeit-Ereignis.

Standardmäßig ist sie deaktiviert. Schalten Sie sie mit einer einzigen Option ein:

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

Im Browser wird alles in IndexedDB persistiert, sodass ein Neuladen sowohl die lokalen Zeilen als auch die nicht gesendeten Schreibvorgänge behält. Anderswo (Node, Tests) wird auf den Arbeitsspeicher zurückgegriffen; andere Laufzeitumgebungen können ihren eigenen Store bereitstellen.

## Was sich ändert

An der API, die Sie bereits verwenden, ändert sich nichts an der Form. `find()`, `findById()`, `create()`, `update()`, `delete()` und der Fluent-Builder behalten ihre Signaturen und ihre Rückgabetypen — sie scheitern nur nicht mehr, wenn das Netzwerk es tut.

### Lesevorgänge

Ein erfolgreicher Lesevorgang führt seine Zeilen in die lokale Datenbank zusammen und merkt sich, welche IDs der Server für diese Abfrage zurückgegeben hat. Wenn ein Lesevorgang den Server nicht erreichen kann, wird er lokal beantwortet:

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

Offline filtert und sortiert dies die Zeilen, die der Client vorhält. Dazu gehören Zeilen, die von *anderen* Abfragen geholt wurden — die Datenbank ist normalisiert, eine Zeile wird also nur einmal gespeichert, in wie vielen Listen sie auch immer auftauchte — sowie Zeilen, die Sie offline erstellt haben.

Wenn es wirklich nichts gibt, womit sich antworten ließe (eine Collection, die die App nie gelesen hat), wirft der Lesevorgang einen erkennbaren Fehler statt eines nackten `TypeError`:

```typescript
import { isOfflineError } from "@rebasepro/client";

try {
    await client.data.posts.find();
} catch (error) {
    if (isOfflineError(error)) showOfflinePlaceholder();
    else throw error;
}
```

### Schreibvorgänge

Solange bekannt ist, dass die Verbindung unterbrochen ist, wird ein Schreibvorgang gar nicht erst versucht — er wird lokal angewendet und eingereiht und kostet damit nichts statt eines Timeouts:

```typescript
// Returns immediately, offline or not.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Offline erstellte Zeilen erhalten eine vom Client generierte ID. Vergibt der Server beim Wiederholen seine eigene, werden die lokale Zeile und alle eingereihten Schreibvorgänge, die noch auf die temporäre ID zeigen, auf die echte umgezogen.

Schreibvorgänge werden in der Reihenfolge wiederholt, in der Sie sie getätigt haben, collection-übergreifend — ein Create in einer Collection landet also weiterhin vor der Zeile in einer anderen, die darauf verweist.

## Live-Abfragen

`observe()` ist der reaktive Lesevorgang und derjenige, zu dem man in einer UI greifen sollte:

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

Die erste Emission kommt ohne dazwischenliegende Anfrage aus der lokalen Datenbank; eine Revalidierung folgt im Hintergrund. Danach wird bei jeder Änderung an den abgedeckten Zeilen erneut ausgegeben. Emissionen werden dedupliziert — eine Aktualisierung, die nichts ändert, ruft den Callback nicht auf —, sodass Sie gefahrlos direkt daraus rendern können.

Jedes Ergebnis trägt, was eine UI braucht, um sich selbst zu beschreiben:

| Feld | Bedeutung |
|-------|---------|
| `data`, `meta` | Dieselbe Form, die `find()` zurückgibt |
| `fromCache` | Die Zeilen stammen aus der lokalen Datenbank, nicht aus einer abgeschlossenen Anfrage |
| `hasPendingWrites` | Mindestens eine Zeile hier trägt einen Schreibvorgang, den der Server noch nicht angenommen hat |
| `partial` | Die lokale Datenbank hält möglicherweise nicht jede passende Zeile — als bestmögliche Näherung behandeln |
| `error` | Die letzte Revalidierung ist fehlgeschlagen |

`observeById()` tut dasselbe für eine einzelne Zeile und übergibt `undefined`, wenn sie gelöscht wird.

Beide binden das Echtzeit-Abonnement ein, wenn der Client eines hat, sodass auch Änderungen anderer Benutzer hereinströmen. Übergeben Sie `{ realtime: false }` für ein Abonnement, das nur den lokalen Zustand und explizite Aktualisierungen widerspiegelt.

Ohne aktiviertes `offline` gibt es `observe()` weiterhin: Es lädt einmal und bleibt über Echtzeit live, wobei alle drei Flags `false` sind.

## Sync-Status

`client.offline` legt die Engine offen — daraus wird eine Sync-Anzeige gebaut:

```typescript
const unsubscribe = client.offline!.onStatusChange((status) => {
    setOnline(status.online);
    setPending(status.pending);
    setSyncing(status.syncing);
});

// Or read it once
const { online, pending, syncing, lastSyncedAt, lastError } = client.offline!.status();
```

| Methode | Zweck |
|--------|---------|
| `status()` | Aktuelle Verbindung, Warteschlangentiefe, Sync-Aktivität, letzter Fehler |
| `onStatusChange(fn)` | Das Obige abonnieren |
| `onQueueChange(fn)` | Nur die Anzahl der nicht gesendeten Schreibvorgänge, für ein Badge |
| `pending()` | Die eingereihten Mutationen selbst, älteste zuerst |
| `sync()` | Jetzt wiederholen — löst mit `{ flushed, remaining }` auf |
| `clear()` | Die eingereihten Schreibvorgänge **und** lokalen Zeilen des aktuellen Benutzers verwerfen |

Das Wiederholen geschieht von selbst: wenn der Browser `online` auslöst, wenn sich der Benutzer anmeldet, und mit exponentiellem Backoff (eine Sekunde, verdoppelnd bis zu einer Minute), solange etwas in der Warteschlange steht. `sync()` ist für einen «Jetzt erneut versuchen»-Button gedacht.

## Wenn der Server ablehnt

Ein eingereihter Schreibvorgang kann abgelehnt werden — Validierung, Row-Level Security, eine Zeile, die jemand anders gelöscht hat. Solche Fälle lösen sich nie von selbst auf, deshalb rollt die Engine die lokalen Zeilen auf den Stand vor dem Schreibvorgang zurück, verwirft die eingereihten Änderungen, die darauf aufbauten, und teilt es Ihnen mit:

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onSyncError: (error, mutation) => {
            toast(`Couldn't save your change to ${mutation.collection}: ${error.message}`);
        }
    }
});
```

Die Kaskade ist eng gefasst: Ein `update` wird zusammen mit dem Schreibvorgang verworfen, den es bearbeitet hat, weil es nur auf dieselbe Weise scheitern kann. Ein späteres `create` oder `delete` für dieselbe Zeile steht für sich und bleibt erhalten.

Ein Fehlschlag, der lediglich vorübergehend ist — ein 429, ein 503, eine abgebrochene Verbindung —, ist keine Ablehnung. Solche bleiben in der Warteschlange und werden erneut versucht; erst nach `maxRetries` Zurückstellungen wird ein Schreibvorgang zurückgerollt.

## Mehrere Tabs

Tabs derselben App teilen sich eine IndexedDB-Datenbank und damit die lokalen Zeilen und die Outbox. Ein Schreibvorgang in einem Tab erscheint in den anderen, und immer nur ein Tab zugleich wiederholt die Warteschlange. Es gibt nichts zu konfigurieren.

## Benutzer

Die lokale Datenbank und die Outbox sind pro angemeldetem Benutzer partitioniert. Zwischengespeicherte Zeilen sind das, was Row-Level Security diesen Benutzer sehen ließ, und ein eingereihter Schreibvorgang muss als sein Urheber wiederholt werden — sich abzumelden und als jemand anders wieder anzumelden vermischt die beiden also nie. Beim Abmelden muss nichts geleert werden.

## Konfiguration

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // default: IndexedDB in the browser, memory elsewhere
        maxCachedRowsPerCollection: 5000,     // rows with unsent writes are never evicted
        maxCachedQueriesPerCollection: 50,    // remembered server page compositions
        syncIntervalMs: 60_000,               // ceiling for the retry backoff; 0 disables auto-retry
        maxRetries: 5,                        // deferrals before a write is given up on
        crossTab: true,                       // default: on for IndexedDB, off for memory
        onSyncError: (error, mutation) => {}
    }
});
```

### Ein eigener Store

Jede Umgebung kann die lokale Datenbank persistieren, indem sie `OfflineStore` implementiert — eine namensraumgetrennte Key/Value-Oberfläche mit einem Bereich für den Lese-Cache und einem für die Warteschlange. So hinterlegen Sie sie in React Native mit AsyncStorage oder in Electron mit dem Dateisystem:

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

Der einzige Vertrag über das Offensichtliche hinaus ist, dass Präfix-Auflistungen in lexikographischer Schlüsselreihenfolge zurückkommen — genau das macht die Outbox zu einer FIFO-Warteschlange.

## Grenzen

Der Client ist kein Replikat Ihrer Datenbank und gibt auch nicht vor, eines zu sein:

- **Nur Zeilen, die die App gelesen oder geschrieben hat, liegen lokal vor.** Eine Abfrage, die der Client nie gesendet hat, kann trotzdem aus dem Vorhandenen beantwortet werden, aber der Antwort können Zeilen fehlen, die der Server zurückgegeben hätte. Live-Ergebnisse sagen das über `partial`.
- **`searchString` wird angenähert** als Teilstringsuche über zwischengespeicherte String-Felder ohne Beachtung der Groß-/Kleinschreibung. Der Server führt eine echte Volltextsuche über die konfigurierten Spalten der Collection aus.
- **Mit `include` eingebundene Relationen lassen sich lokal nicht auswerten** — die verwandten Zeilen liegen in Collections, die die Abfrage nie geladen hat. Eine solche Abfrage wird immer als `partial` markiert, wenn sie aus dem Cache beantwortet wird.
- **Das Wiederholen erfolgt mindestens einmal.** Ein Schreibvorgang, der den Server erreicht, dessen Antwort aber verloren geht, kann erneut gesendet werden. Bevorzugen Sie idempotente Schreibvorgänge (`createMany` mit `upsert`), wo Duplikate eine Rolle spielen würden.
- **Lokale Lesevorgänge wenden Postgres-Semantik an, nicht die Daten der Datenbank.** Filter werden so ausgewertet, wie SQL es täte — Vergleiche mit `NULL` sind unbekannt, `ORDER BY` stellt Nullwerte bei aufsteigender Sortierung ans Ende —, aber gegen die Kopie der Zeilen im Client, die veraltet sein kann.

## Rezept: eine Offline-Anzeige

```tsx
import React from "react";
import type { CreateRebaseClientResult } from "@rebasepro/client";

export function SyncIndicator({ client }: { client: CreateRebaseClientResult }) {
    const offline = client.offline!;
    const [status, setStatus] = React.useState(offline.status());
    React.useEffect(() => offline.onStatusChange(setStatus), [offline]);

    if (!status.online) {
        return <span className="badge warning">
            Offline{status.pending ? ` · ${status.pending} unsaved` : ""}
        </span>;
    }
    if (status.syncing) return <span className="badge">Syncing…</span>;
    if (status.pending) return <span className="badge">{status.pending} unsaved</span>;
    return null;
}
```

## Siehe auch

- [Daten abfragen](/docs/sdk/querying) — die Abfrageoberfläche, die `observe()` mit `find()` teilt
- [Echtzeit-Abonnements](/docs/sdk/realtime) — servergesteuerte Updates, auf denen Live-Abfragen aufbauen

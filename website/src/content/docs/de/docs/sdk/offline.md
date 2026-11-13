---
sourceHash: 1b875d11f8a07037
title: Offline- & Local-First-Synchronisation
sidebar_label: Offline
description: Aktivieren Sie die Local-First-Sync-Engine des typisierten Rebase SDKs – eine lokale Zeilen-Datenbank, sofortige Offline-Schreibvorgänge mit Rollback und reaktive Live-Queries.
---

## Übersicht

Die Offline-Unterstützung verwandelt die Datenschicht des SDKs in eine **Local-First-Sync-Engine**. Anstelle eines Caches, der sich Antworten merkt, verwaltet der Client eine kleine lokale Zeilen-Datenbank, beantwortet Abfragen direkt daraus und betrachtet das Netzwerk als etwas, das Daten nachliefert und Schreibvorgänge schließlich entgegennimmt.

Daraus folgt dreierlei:

- **Lesezugriffe überstehen den Verbindungsabbruch.** Eine Abfrage, die der Client lokal auswerten kann, wird lokal ausgewertet – einschließlich Filtern, Sortierung und Paginierung –, sodass eine Liste auch ohne Verbindung weiterhin gerendert wird.
- **Schreibvorgänge werden lokal entschieden.** Ein offline durchgeführter Schreibvorgang wird sofort angewendet, in eine Warteschlange eingereiht und der Reihe nach erneut abgespielt (Replay), sobald die Verbindung wiederhergestellt ist. Wenn der Server ihn ablehnt, wird die lokale Änderung zurückgesetzt (Rollback).
- **Lesezugriffe sind reaktiv.** `observe()` liefert zunächst Ergebnisse aus der lokalen Datenbank und emittiert erneut, wann immer sich die abgedeckten Zeilen ändern – durch eigene Schreibvorgänge, das Eintreffen eines eingereihten Schreibvorgangs, ein Rollback, einen anderen Browser-Tab oder ein Echtzeit-Ereignis.

Standardmäßig ist dies deaktiviert. Aktivieren Sie es mit einer einzigen Option:

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

Im Browser wird alles in IndexedDB persistent gespeichert, sodass beim Neuladen sowohl die lokalen Zeilen als auch die nicht gesendeten Schreibvorgänge erhalten bleiben. Anderswo (Node, Tests) greift ein Fallback auf den Arbeitsspeicher; andere Runtimes können ihren eigenen Speicher bereitstellen.

## Was sich ändert

An der bestehenden API ändert sich an der Struktur nichts. `find()`, `findById()`, `create()`, `update()`, `delete()` und der Fluent-Builder behalten ihre Signaturen und Rückgabetypen – sie schlagen lediglich nicht mehr fehl, wenn das Netzwerk ausfällt.

### Lesezugriffe

Ein erfolgreicher Lesezugriff führt seine Zeilen mit der lokalen Datenbank zusammen und merkt sich, welche IDs der Server für diese Abfrage zurückgegeben hat. Wenn ein Lesezugriff den Server nicht erreichen kann, wird er lokal beantwortet:

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

Im Offline-Modus filtert und sortiert dies die Zeilen, die der Client vorhält. Dazu gehören Zeilen, die von *anderen* Abfragen abgerufen wurden – die Datenbank ist normalisiert, sodass eine Zeile nur einmal gespeichert wird, egal in wie vielen Listen sie aufgetaucht ist – sowie Zeilen, die Sie offline erstellt haben.

Wenn es tatsächlich keinerlei Daten zur Beantwortung gibt (eine Tabelle, die die Anwendung noch nie gelesen hat), wirft der Lesezugriff einen erkennbaren Fehler anstelle eines einfachen `TypeError`:

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

Solange bekannt ist, dass keine Verbindung besteht, wird ein Schreibvorgang gar nicht erst versucht – er wird lokal angewendet und eingereiht, wodurch statt eines Timeouts keine Wartezeit anfällt:

```typescript
// While offline, returns at once with the locally applied row.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Offline erstellte Zeilen erhalten eine clientseitig generierte ID in dem Typ, den die IDs der Tabelle bereits verwenden: eine **negative Ganzzahl**, wenn es sich um Zahlen handelt, ein UUID-String, wenn es Strings sind. Das Vorzeichen ist das Erkennungsmerkmal – ein echter Primärschlüssel ist niemals negativ –, sodass eine Zeile, die den Server noch nicht erreicht hat, ohne zusätzliche Suche erkennbar ist und `id` bei der Typprüfung weiterhin dem Typ entspricht, den das generierte `Row` vorgibt. Bei einer Tabelle, die dieses Gerät noch nie gelesen hat, gibt es lokal keinen Typ zum Auslesen, und die ID ist eine UUID.

Weist der Server beim Replay eine eigene ID zu, werden die lokale Zeile und alle noch in der Warteschlange befindlichen Schreibvorgänge, die auf die temporäre ID verweisen, in jeder Tabelle auf die echte ID umgestellt: Ein Beitrag, der mit einer auf einen offline erstellten Autor gesetzten `author_id` eingereiht wurde, wird mit der ID gesendet, die der Server dem Autor zugewiesen hat. Lehnt der Server den Autor hingegen ab, werden Schreibvorgänge, die auf ihn verweisen, zusammen mit ihm verworfen und als `DEPENDENCY_REJECTED` gemeldet (siehe [Wenn der Server ablehnt](#wenn-der-server-ablehnt)). Bis dahin sollten Sie eine temporäre ID nirgendwo außerhalb der Offline-Datenbank persistieren – ein Fremdschlüssel oder eine mit einem Lesezeichen versehene URL, die eine solche ID enthält, verweist auf eine Zeile, die demnächst neu nummeriert wird.

Schreibvorgänge werden tabellenübergreifend in der Reihenfolge erneut abgespielt, in der Sie sie vorgenommen haben – eine Erstellung in einer Tabelle wird also immer noch vor der Zeile in einer anderen Tabelle verarbeitet, die darauf verweist.

Jeder eingereihte Schreibvorgang entspricht standardmäßig einer Anfrage, sodass 500 offline erfasste Zeilen 500 Roundtrips zum Abarbeiten benötigen. Wenn `replayBatchSize` festgelegt ist (bis zu 1 000), wird eine Folge aufeinanderfolgender Offline-Erstellungen in einer Tabelle stattdessen als ein einzelnes `createMany` erneut abgespielt. Es werden nur Erstellungen zusammengefasst, deren ID vom SDK als String generiert wurde, und niemals solche, die auf eine andere Zeile desselben Durchlaufs verweisen. Wenn der Server den Durchlauf aus einem anderen Grund als einer verlorenen Verbindung ablehnt oder aufschiebt, wird nichts geschrieben (ein Bulk-Schreibvorgang ist eine Transaktion), und der Durchlauf wird Schreibvorgang für Schreibvorgang erneut abgespielt, wie es standardmäßig der Fall wäre.

### Von einer früheren Version eingereihte Schreibvorgänge

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Warteschlange speichert einen Schreibvorgang in Form der Werte, die er sendet – Schlüssel für Relationen, Zahlenlisten für Vektoren, `{ latitude, longitude }` für Punkte, ISO-Text für Daten – und zwischengespeicherte Zeilen als die Zeilen des Servers. Ein Schreibvorgang, der von der vorherigen Version des SDKs offline eingereiht wurde und diese als Klassen (`EntityRelation`, `GeoPoint`, `Vector`) gespeichert hat, wird beim Zurücklesen in diese Werte umgewandelt und wie gewohnt erneut abgespielt: Nichts, was vor dem Upgrade eingereiht wurde, geht verloren. Ein älteres SDK, das auf einen von dieser Version eingereihten Schreibvorgang trifft, belässt ihn in der Warteschlange.

## Live-Abfragen

`observe()` ist der reaktive Lesezugriff und die bevorzugte Wahl für Benutzeroberflächen:

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

Die erste Ausgabe stammt ohne zwischengeschaltete Netzwerkanfrage direkt aus der lokalen Datenbank; eine Revalidierung folgt im Hintergrund. Danach wird bei jeder Änderung an den abgedeckten Zeilen erneut emittiert. Emissionen werden dedupliziert – eine Aktualisierung, die nichts ändert, löst keinen erneuten Callback aus –, sodass direkt daraus gerendert werden kann.

Jedes Ergebnis enthält alles, was eine Benutzeroberfläche zur Selbstdarstellung benötigt:

| Feld | Bedeutung |
|-------|---------|
| `data`, `meta` | Dieselbe Struktur, die `find()` zurückgibt |
| `fromCache` | Die Zeilen stammen aus der lokalen Datenbank, nicht aus einer abgeschlossenen Anfrage |
| `hasPendingWrites` | Mindestens eine Zeile hier enthält einen Schreibvorgang, den der Server noch nicht akzeptiert hat |
| `partial` | Die lokale Datenbank enthält möglicherweise nicht jede passende Zeile – als Best-Effort behandeln |
| `error` | Die letzte Revalidierung ist fehlgeschlagen |

`observeById()` tut dasselbe für eine einzelne Zeile und übergibt `undefined`, wenn diese gelöscht wird. Es akzeptiert `include` wie `findById()`, und jede Emission enthält diese Relationen:

```typescript
const stop = client.data.posts.observeById(postId, (post) => render(post), undefined, {
    include: ["tags"]
});
```

Beide binden das Realtime-Abonnement ein, wenn der Client über eines verfügt, sodass auch von anderen Benutzern vorgenommene Änderungen einfließen. Übergeben Sie `{ realtime: false }` für ein Abonnement, das ausschließlich den lokalen Zustand und explizite Aktualisierungen widerspiegelt.

Auch ohne aktiviertes `offline` existiert `observe()`: Es ruft Daten einmalig ab und bleibt über Realtime auf dem neuesten Stand, wobei alle drei Flags `false` sind.

## Synchronisationsstatus

`client.offline` legt die Engine offen, auf deren Basis eine Synchronisationsanzeige aufgebaut werden kann:

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
| `status()` | Aktuelle Konnektivität, Warteschlangentiefe, Synchronisationsaktivität, letzter Fehler und `persisted`: ob der Browser zugestimmt hat, die Offline-Datenbank beizubehalten (wird abgefragt, sobald der erste Schreibvorgang eingereiht wird; `false` bedeutet, dass sie bei Speicherengpässen gelöscht werden kann, einschließlich nicht gesendeter Schreibvorgänge). `unverifiedUser` ist `true`, solange ein Offline-Neuladen die Daten des letzten Benutzers ohne bestätigte Sitzung anzeigt (siehe [`keepLastUser`](#offline-neuladen-im-cookie-modus)) |
| `onStatusChange(fn)` | Vorstehendes abonnieren |
| `onQueueChange(fn)` | Nur die Anzahl der nicht gesendeten Schreibvorgänge, etwa für ein Badge |
| `pending()` | Die eingereihten Mutationen selbst, älteste zuerst. `pending({ orphaned: true })`: diejenigen, die im abgemeldeten Zustand eingereiht wurden – siehe [Benutzer](#benutzer) |
| `sync()` | Jetzt erneut abspielen – löst mit `{ flushed, remaining }` auf |
| `clear()` | Die eingereihten Schreibvorgänge **und** lokalen Zeilen des aktuellen Benutzers verwerfen. `clear({ orphaned: true })`: stattdessen diejenigen, die im abgemeldeten Zustand eingereiht wurden |

Das erneute Abspielen geschieht automatisch: wenn der Browser das `online`-Ereignis auslöst, wenn sich der Benutzer anmeldet, und über einen exponentiellen Backoff (eine Sekunde, verdoppelnd bis zu einer Minute), solange sich etwas in der Warteschlange befindet. `sync()` ist für eine Schaltfläche „Jetzt wiederholen“ gedacht.

## Wenn der Server ablehnt

Ein eingereihter Schreibvorgang kann abgelehnt werden – Validierung, Row-Level Security, eine von jemand anderem gelöschte Zeile. Solche Fälle lösen sich nie von selbst, daher setzt die Engine die lokalen Zeilen auf den Stand vor dem Schreibvorgang zurück, verwirft die darauf aufbauenden eingereihten Bearbeitungen und benachrichtigt Sie:

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

Eine von jemand anderem gelöschte Zeile ist der einzige Fall, der nicht zurückgesetzt wird. Ein eingereihtes `delete` darauf hat seinen Zweck erfüllt, gilt daher als synchronisiert und wird nicht gemeldet. Eine eingereihte Bearbeitung darauf wird gemeldet, und die Zeile wird aus der lokalen Datenbank entfernt, anstatt wiederhergestellt zu werden, da der Server sie nicht mehr besitzt.

Die Kaskade ist eng begrenzt: Ein `update` wird zusammen mit dem Schreibvorgang verworfen, den es bearbeitet hat, da es nur auf dieselbe Weise fehlschlagen kann. Ein späteres `create` oder `delete` für dieselbe Zeile steht für sich allein und bleibt erhalten. Ein abgelehntes `create` einer offline erstellten Zeile zieht außerdem jeden eingereihten Schreibvorgang in beliebigen Tabellen mit sich, dessen Werte auf die temporäre ID der Zeile verweisen. Ein verworfener Schreibvorgang wurde nie gesendet. Er wird mit einem `RebaseApiError` gemeldet, dessen `code` `DEPENDENCY_REJECTED` ist und dessen `cause` die Ablehnung ist, die ihn zum Scheitern brachte, sodass Sie ihn von dem Schreibvorgang unterscheiden können, den der Server tatsächlich abgelehnt hat.

Aufeinanderfolgende Bearbeitungen an einer Zeile im Offline-Modus werden zu einem einzigen eingereihten Schreibvorgang zusammengeführt, sodass ein Formular, in das getippt wird, die Warteschlange nicht anwachsen lässt. Ein Schreibvorgang, dessen Senden die Warteschlange bereits begonnen hat, wird nicht zusammengeführt: Eine Bearbeitung nach einem Replay-Versuch, dessen Antwort verloren ging, wird als eigenes Update eingereiht, und das Löschen einer offline erstellten Zeile wird gesendet, anstatt gegen deren Erstellung aufgehoben zu werden, da der Server die Zeile möglicherweise bereits enthält. Wenn der Server den zusammengeführten Schreibvorgang aufgrund seines Inhalts ablehnt (ein 400, 403 oder 422 – etwa ein Feld, das durch eine Schemaänderung entfernt wurde, während der Benutzer offline war), teilt die Engine ihn wieder in die separaten Bearbeitungen auf und spielt jede einzeln erneut ab. Nur die Bearbeitung, die der Server ablehnt, wird zurückgesetzt und gemeldet; die anderen bleiben erhalten.

### Konflikte

Standardmäßig überschreibt eine offline eingereihte Bearbeitung den Stand des Servers für die geänderten Felder, selbst wenn jemand anderes sie in der Zwischenzeit geändert hat. Um stattdessen darüber informiert zu werden, übergeben Sie `onConflict`. Ein eingereihtes `update` wird dann mit `If-Match` und der Version der Zeile, auf deren Basis die Änderung erfolgte, erneut abgespielt. Wenn sich die Zeile seitdem geändert hat, lehnt der Server sie mit dem Statuscode 412 ab, und `onConflict` entscheidet:

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onConflict: async (error, mutation) =>
            (await askUser(`${mutation.collection} changed while you were offline. Keep your edit?`))
                ? "overwrite"
                : "discard"
    }
});
```

- `"overwrite"` sendet die Bearbeitung erneut ohne die Vorbedingung: Der letzte Schreibvorgang gewinnt, wie auch ohne `onConflict`.
- `"discard"` verwirft die Bearbeitung. Die Zeile wird auf den Zustand davor zurückgesetzt (wie bei einer Ablehnung) und erneut vom Server gelesen. Dies wird nicht an `onSyncError` gemeldet; darauf aufbauende eingereihte Schreibvorgänge hingegen schon, und zwar als `DEPENDENCY_REJECTED`.

Die Warteschlange wartet, während `onConflict` ausgeführt wird, sodass eine Rückfrage an den Benutzer möglich ist. Wenn ein Fehler geworfen wird, wird die Bearbeitung überschrieben.

Die Version, auf deren Basis eine Bearbeitung erfolgt, ist diejenige, die beim letzten Lesezugriff auf die Zeile gemeldet wurde: `findById()`, ein `listenById()`-Frame oder die Antwort auf ein früheres `update()`. Eine Zeile, die zuletzt in einer `find()`- oder `listen()`-Liste gelesen wurde, besitzt keine Version – ebenso wenig wie eine Bearbeitung, die auf einem anderen eingereihten Schreibvorgang für dieselbe Zeile aufbaut. Diese werden ohne Vorbedingung erneut abgespielt. Ein `ifMatch`, das Sie selbst an `update()` oder `delete()` übergeben, bleibt beim Einreihen des Schreibvorgangs erhalten (mit oder ohne `onConflict`), und `findById()` auf einem offlinefähigen Client gibt die Zeile mit ihrer Version zurück, sodass `etagOf(row)` wie im Online-Betrieb funktioniert. Ohne `onConflict` wird ein eingereihter Schreibvorgang, der aufgrund Ihres eigenen `ifMatch` abgelehnt wurde, zurückgesetzt und an `onSyncError` mit einem 412 `PRECONDITION_FAILED` gemeldet.

Ein Fehler, der lediglich vorübergehender Natur ist – ein 429, ein 503, eine unterbrochene Verbindung –, ist keine Ablehnung. Diese Schreibvorgänge verbleiben in der Warteschlange und werden wiederholt; erst nach `maxRetries` Aufschüben wird ein Schreibvorgang zurückgesetzt.

## Mehrere Tabs

Tabs derselben Anwendung teilen sich eine IndexedDB-Datenbank und damit auch die lokalen Zeilen und das Postausgangsfach (Outbox). Ein Schreibvorgang in einem Tab erscheint in den anderen, und immer nur ein Tab zur gleichen Zeit spielt die Warteschlange erneut ab. Es ist keine Konfiguration erforderlich.

Diese letzte Garantie basiert auf der [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) des Browsers, die nur in einem sicheren Kontext (HTTPS oder `localhost`) existiert und in Safari vor Version 15.4 oder in manchen eingebetteten Webviews nicht verfügbar ist. Ohne diese API spielt jeder geöffnete Tab die Warteschlange erneut ab, wenn er synchronisiert. Erstellungen, Bulk-Schreibvorgänge, Aktualisierungen und Löschungen werden alle unter einem Idempotenzschlüssel erneut abgespielt, sodass ein Server, der Schlüssel speichert, jeden davon nur einmal anwendet; sichtbar werden kann dabei lediglich derselbe Schreibvorgang, der aus zwei Tabs gesendet wird.

## Benutzer

Die lokale Datenbank und die Outbox sind pro angemeldetem Benutzer partitioniert. Zwischengespeicherte Zeilen entsprechen dem, was die Row-Level Security diesem Benutzer zu sehen erlaubt hat, und ein eingereihter Schreibvorgang muss unter der Identität seines Autors erneut abgespielt werden – das Abmelden und Neuanmelden als eine andere Person vermischt die beiden Bereiche daher nie. Beim Abmelden muss nichts gelöscht werden.

### Während die Sitzung wiederhergestellt wird

Bevor der Client weiß, wer angemeldet ist, weiß er nicht, wessen lokale Datenbank und Outbox verwendet werden soll, weshalb Offline-Lese- und Schreibvorgänge warten. Das entspricht der Zeit, die `auth.isInitialized()` benötigt: keine bei einer gespeicherten Sitzung, die noch gültig ist, und eine Refresh-Anfrage, wenn die Sitzung vom Server abgerufen werden muss – im Cookie-Modus, in dem nichts auf dem Gerät gespeichert wird, ist dies bei jedem Seitenaufruf der Fall. Ein in diesem Zeitfenster getätigter Schreibvorgang wird für diejenige Identität eingereiht, die sich aus der Sitzung ergibt, und ein Lesezugriff wird aus deren lokaler Datenbank beantwortet. Ein Realtime-Frame, der in der Zwischenzeit eintrifft, wird an Ihren Callback so übergeben, wie der Server ihn gesendet hat, und nirgendwo gespeichert.

Wenn die Sitzung nicht wiederhergestellt werden kann – der Refresh wird abgelehnt oder kann im Cookie-Modus den Server nicht erreichen –, gilt der Client als abgemeldet, und Offline-Lese- und Schreibvorgänge werden dem abgemeldeten Benutzer zugeordnet.

### Im abgemeldeten Zustand getätigte Schreibvorgänge

Schreibvorgänge, die eingereiht wurden, während niemand angemeldet war, werden bei der Anmeldung eines Benutzers nicht erneut abgespielt. Dieser Benutzer hat sie nicht vorgenommen, und ein erneutes Abspielen mit dessen Anmeldedaten würde die Änderungen einer Person im Namen einer anderen vornehmen – auf einem gemeinsam genutzten Gerät die Schreibvorgänge eines Besuchers im Konto des nächsten Benutzers. Sie werden auch nicht in die Outbox des angemeldeten Benutzers verschoben. Sie werden separat aufbewahrt und aufgelistet, sodass die Anwendung entscheiden kann, was damit geschehen soll:

```typescript
client.auth.onAuthStateChange(async (event) => {
    if (event !== "SIGNED_IN") return;
    const orphaned = await client.offline!.pending({ orphaned: true });
    if (orphaned.length === 0) return;
    if (await askToKeep(orphaned.length)) {
        // Re-issue each one yourself, now as the signed-in user.
        for (const write of orphaned) await reissue(write);
    }
    await client.offline!.clear({ orphaned: true });
});
```

`clear({ orphaned: true })` verwirft sie zusammen mit den lokalen Zeilen, auf die sie angewendet wurden; die eigene Outbox des angemeldeten Benutzers bleibt unberührt. Wenn die Anwendung nichts damit unternimmt, werden sie das nächste Mal erneut abgespielt, wenn niemand angemeldet ist. Solange niemand angemeldet ist, bilden sie einfach die aktuelle Outbox, und `pending({ orphaned: true })` gibt eine leere Liste zurück.

### Offline-Neuladen im Cookie-Modus

Im Cookie-Modus wird nichts über die Sitzung auf dem Gerät gespeichert, sodass ein Neuladen ohne Verbindung zum Server keinen Benutzer hat. Standardmäßig wird dies wie abgemeldet behandelt: Die lokalen Zeilen des Benutzers werden ausgeblendet, und Schreibvorgänge, die dann getätigt werden, werden für den abgemeldeten Benutzer eingereiht.

`keepLastUser: true` ändert dies. Der Client merkt sich den letzten Benutzer, der sich auf dem Gerät angemeldet hat (nur dessen ID), und ein Offline-Neuladen öffnet stattdessen die lokale Datenbank dieses Benutzers. Schreibvorgänge, die dann getätigt werden, werden diesem Benutzer zugeordnet, aber keiner wird erneut abgespielt, bevor die Sitzung bestätigt ist: Sobald die Verbindung wiederhergestellt ist, aktualisiert der Client die Sitzung, und auch eine Anmeldung bestätigt sie. Lehnt der Server die Sitzung ab oder meldet sich jemand anderes an, wechselt das Gerät den Benutzer, und die eingereihten Schreibvorgänge verbleiben bei ihrem Autor, bis sich dieser erneut anmeldet. In der Zwischenzeit ist `status().unverifiedUser` auf `true` gesetzt, und das gilt auch online: Bis die Antwort auf den Refresh vorliegt, werden Schreibvorgänge eingereiht, anstatt ohne Anmeldedaten gesendet zu werden, und Lesezugriffe werden aus den lokalen Zeilen des Benutzers beantwortet. Was der Server auf eine Anfrage ohne Sitzung antwortet, entspricht dem, was ein abgemeldeter Aufrufer sehen darf, und wird daher nicht behalten.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" },
    offline: { keepLastUser: true }
});
```

Standardmäßig ist dies deaktiviert, da es auf einem gemeinsam genutzten Gerät ermöglichen würde, die zwischengespeicherten Zeilen des vorherigen Benutzers offline ohne Sitzung einzusehen. Aktivieren Sie es bei Installationen, die einer einzelnen Person gehören. Die ID wird beim Abmelden und bei Ablehnung der Sitzung durch den Server vergessen. Sie wird niemals verwendet, wenn der Server zurückmeldet, dass keine Sitzung vorliegt.

## Konfiguration

<span class="since-badge" data-since="0.31">Seit 0.31</span> `maxCachedRowsPerTable` und `maxCachedQueriesPerTable` hießen zuvor `…PerCollection`.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // default: IndexedDB in the browser, memory elsewhere
        maxCachedRowsPerTable: 5000,          // rows with unsent writes are never evicted
        maxCachedQueriesPerTable: 50,         // remembered server page compositions
        syncIntervalMs: 60_000,               // ceiling for the retry backoff; 0 disables auto-retry
        maxRetries: 5,                        // deferrals before a write is given up on
        crossTab: true,                       // default: on for IndexedDB, off for memory
        keepLastUser: false,                  // open the last user's data on an offline reload (cookie mode)
        replayBatchSize: 1,                   // queued creates sent per request on replay (max 1000)
        onConflict: (error, mutation) => "overwrite", // or "discard"; default: no conflict check
        onSyncError: (error, mutation) => {}
    }
});
```

### Ein benutzerdefinierter Speicher

Jede Umgebung kann die lokale Datenbank persistieren, indem sie `OfflineStore` implementiert – eine Key-Value-Schnittstelle mit Namespaces, die einen Lesecache-Bereich und einen Warteschlangenbereich bereitstellt. So können Sie sie in React Native mit AsyncStorage oder in Electron mit dem Dateisystem unterlegen:

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

Die einzige Anforderung über das Naheliegende hinaus besteht darin, dass Präfix-Auflistungen in lexikografischer Schlüsselreihenfolge zurückgegeben werden – dies macht die Outbox zu einer FIFO-Warteschlange.

## Einschränkungen

Der Client ist kein vollständiges Replikat Ihrer Datenbank und gibt dies auch nicht vor:

- **Nur Zeilen, die die App gelesen oder geschrieben hat, sind lokal vorhanden.** Eine Abfrage, die der Client noch nie gesendet hat, kann dennoch aus dem vorhandenen Bestand beantwortet werden, doch der Antwort fehlen möglicherweise Zeilen, die der Server zurückgegeben hätte. Live-Ergebnisse weisen über `partial` darauf hin.
- **`findAll()` und `iterate()` lesen nur Seiten, die der Server auf diesem Gerät beantwortet hat.** Ein Durchlauf wird so lange fortgesetzt, wie jede Seite angibt, dass weitere Daten vorhanden sind, und nur der Server kann dies mitteilen. Offline schlägt ein Durchlauf, der eine von diesem Gerät noch nie abgerufene Seite benötigt, mit dem Fehler `OFFLINE` (`isOfflineError`) fehl, anstatt nur einen Teil der Tabelle so zurückzugeben, als wäre es die gesamte.
- **`count()` benötigt offline eine Anzahl, die der Server diesem Gerät für dieselbe Abfrage geliefert hat.** Seitdem eingereihte Schreibvorgänge verändern diesen Wert: Erstellungen, Bearbeitungen, die eine Zeile in den Filter hinein- oder herausbewegen, sowie Löschungen. Liegt kein solcher Wert vor, schlägt der Aufruf mit dem Fehler `OFFLINE` fehl, anstatt einfach die Zeilen zu zählen, die dieses Gerät zufällig vorhält.
- **`searchString` wird angenähert** als Substring-Suche ohne Berücksichtigung der Groß-/Kleinschreibung über zwischengespeicherte String-Felder. Der Server führt eine echte Volltextsuche über die konfigurierten Spalten der Tabelle durch.
- **Eingebundene Relationen (`include`) können lokal nicht ausgewertet werden** – die zugehörigen Zeilen befinden sich in Tabellen, die die Abfrage nie geladen hat. Eine solche Abfrage wird immer als `partial` markiert, wenn sie aus dem Cache beantwortet wird.
- **Konflikte werden feldweise nach dem Prinzip „Last Writer Wins“ aufgelöst, sofern Sie nicht `onConflict` übergeben.** Ein erneut abgespieltes `update` sendet nur die vom Benutzer geänderten Felder und nichts weiter; nicht berührte Felder behalten also den Zustand auf dem Server. Wurde ein Feld jedoch geändert, wird eine Änderung, die jemand anderes während der Offline-Zeit auf dem Server vorgenommen hat, beim Replay der Warteschlange überschrieben, ohne dass einer der Benutzer benachrichtigt wird. Mit [`onConflict`](#konflikte) wird eine Bearbeitung, deren Zeilenversion bekannt ist, mit der Version des Servers abgeglichen, und die Anwendung entscheidet. Erstellungen, Löschungen und Bulk-Schreibvorgänge werden nie geprüft.
- **Das erneute Abspielen erfolgt nach dem At-least-once-Prinzip.** Ein Schreibvorgang, der den Server erreicht, dessen Antwort jedoch verloren geht, wird möglicherweise erneut gesendet. Bevorzugen Sie idempotente Schreibvorgänge (`createMany` mit `upsert`), wo Duplikate problematisch wären.
- **Der Papierkorb benötigt den Server.** Die lokale Datenbank enthält nur aktive Zeilen, daher werden `trash.find()`, `trash.count()`, `trash.restore()` und `trash.purge()` (siehe [Soft Delete](/docs/collections/soft-delete#from-the-sdk)) niemals lokal beantwortet oder eingereiht: Offline schlagen sie mit dem Fehler `OFFLINE` fehl. Das Wiederherstellen oder endgültige Löschen einer Zeile, für die noch ein Schreibvorgang eingereiht ist, synchronisiert zunächst die Warteschlange und wird mit `TRASH_PENDING_WRITE` abgelehnt, wenn der Schreibvorgang noch nicht gesendet werden kann.
- **Ein Upsert auf einem natürlichen Schlüssel benötigt den Server.** Welche Zeile ein `onConflict`-Ziel benennt, kann nur der Server ermitteln; daher werden `upsert()` auf einem natürlichen Schlüssel (oder ohne die ID der Zeile) sowie ein noch nie gesendetes `createMany()` mit `onConflict` im Offline-Modus mit `OFFLINE_UPSERT_UNSUPPORTED` abgelehnt. Ein Upsert auf dem Primärschlüssel, bei dem der Schlüssel in jeder Zeile vorhanden ist, wird eingereiht.
- **Lokale Lesezugriffe wenden Postgres-Semantik an, nicht die Daten der Datenbank.** Filter werden so ausgewertet, wie es SQL tun würde – Vergleiche mit `NULL` sind unbestimmt, `ORDER BY` platziert Nullwerte aufsteigend zuletzt und bricht verbleibende Gleichstände anhand der Zeilen-ID absteigend auf, genau wie der Server –, jedoch bezogen auf die Kopie der Zeilen des Clients, die veraltet sein kann.
- **Eine Sortierung, die der Client nicht reproduzieren kann, wird nicht angewendet.** Das Sortieren von Text obliegt dem Server: PostgreSQL sortiert ihn anhand der Collation der *Datenbank*, die diesem Prozess nicht bekannt ist, und unter der C-Collation wird `Banana` vor `apple` sortiert, während ein JavaScript-Collator etwas anderes vorgibt. Wenn eine Sortierspalte nicht numerisch verglichen werden kann, behalten die Zeilen die vom Server übermittelte Reihenfolge bei, und das Ergebnis wird als `partial` markiert, anstatt als die angeforderte sortierte Seite dargestellt zu werden. Jeder Schlüssel einer mehrspaltigen Sortierung muss reproduzierbar sein, nicht nur der erste – eine Sortierung, bei der die lokale Seite nur bis zur zweiten Spalte übereinstimmt, gilt als nicht übereinstimmend.

## Rezept: Eine Offline-Anzeige

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

- [Daten abfragen](/docs/sdk/querying) — die Abfrageschnittstelle, die `observe()` mit `find()` teilt
- [Realtime-Abonnements](/docs/sdk/realtime) — Server-Push-Aktualisierungen, auf denen Live-Abfragen aufbauen

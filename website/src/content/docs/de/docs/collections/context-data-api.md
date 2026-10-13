---
sourceHash: 00c369539f8269ad
title: Die context.data-API
sidebar_label: context.data-API
description: Andere Collections aus einem Callback heraus mit context.data lesen und schreiben – Methoden, die Rechte, mit denen es läuft, Transaktionssemantik und die Verbindung, die ein Callback belegt.
---

Jeder Callback erhält ein `context`-Objekt, das `context.data` enthält — eine einheitliche Datenzugriffsschicht zur Durchführung von **kollektionsübergreifenden Operationen** innerhalb von Lifecycle-Hooks.

## Zugriff auf Kollektionen

`context.data` verwendet einen JavaScript-Proxy, sodass Sie über den Slug als Eigenschaft auf jede Kollektion zugreifen können:

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

Eine Eigenschaft ist der Accessor der Collection, der Name, den das generierte SDK ihr gibt:
`context.data.myNotes` ist die Collection `my-notes`, in welcher Tabelle sie auch gespeichert ist.
Ein Name, der kein Accessor einer Collection ist, wird als sein snake_case gelesen, sodass
`context.data.auditLog` die Collection `audit_log` ist.

Zeilen sind untypisiert (`Record<string, unknown>`), bis das Projekt seine generierte `Database`
registriert; dann ist jeder Accessor daraus typisiert. Siehe
[Typisierte serverseitige Daten](/docs/backend/typed-server-data).

## Verfügbare Methoden

Jeder Kollektions-Accessor (`context.data.<slug>`) stellt die folgenden Methoden bereit:

| Methode | Signatur | Beschreibung |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Entitäten mit Filtern, Sortierung und Paginierung abfragen |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Eine einzelne Entität anhand der ID abrufen |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Eine neue Entität erstellen |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Eine bestehende Entität aktualisieren |
| `.delete()` | `delete(id: string \| number) → void` | Einen Datensatz löschen |
| `.count()` | `count(params?: FindParams) → number` | Übereinstimmende Entitäten zählen |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Echtzeit-Abonnement (sofern unterstützt) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Eine einzelne Entität überwachen |
| `.trash` | `trash.find()`, `.count()`, `.restore(id)`, `.restoreMany(ids)`, `.purge(id)`, `.purgeMany(ids)` | Die Zeilen, die ein [Soft Delete](/docs/collections/soft-delete#from-the-sdk) markiert hat |

## Abfragen mit `.find()`

Die `find()`-Methode filtert mit `[operator, value]`-Tupeln — der typisierten Form des Query-Strings `?status=eq.published`, den die REST-API liest:

```typescript
afterSave: async ({ values, context }) => {
    // Equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: ["==", "published"] },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // Several conditions, AND-ed
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

## Entitäten erstellen

`.create()` und `.update()` erwarten die zu schreibenden Werte, mit den oben genannten Signaturen. [Daten zwischen Kollektionen synchronisieren](/docs/collections/callbacks#syncing-data-between-collections) verwendet beide: Eine genehmigte Einreichung erstellt einen veröffentlichten Job und wird mit ihm verknüpft.

## Sicherheit: Mit welchen Berechtigungen `context.data` ausgeführt wird

:::important
**`context.data` erbt die Berechtigungen dessen, was den Callback ausgelöst hat.** Es handelt sich nicht um eine feste Vertrauensstufe.

- Ausgelöst durch eine **Benutzeranfrage** (REST, Realtime, eine Bearbeitung im Admin-Panel) → **User-Scoped**. Der Callback wird innerhalb der RLS-gebundenen Transaktion ausgeführt, die für diese Anfrage geöffnet wurde, sodass Richtlinien für Lese- *und* Schreibvorgänge gelten. Ein Callback kann keine Zeile sehen, die sein Aufrufer nicht sehen konnte.
- Ausgelöst durch **`rebase.dataAsAdmin` oder einen Cron-Job** (dasselbe Singleton) → **Admin-Scoped**, nicht unbeschränkt (unscoped). Dieser Treiber ist als `{ uid: "service", roles: ["admin"] }` definiert, sodass der Callback dennoch in einer RLS-gebundenen Transaktion ausgeführt wird — Ihre Richtlinien werden anhand dieser Identität ausgewertet.
- Ausgelöst durch **den Basistreiber** (integrierte Authentifizierungs-Flows, Migrationen) → **Unscoped**. Er wird über die Owner-Verbindung ausgeführt und umgeht RLS.
:::

Dies ist besonders in jenen Fällen von Bedeutung, die stillschweigend fehlschlagen. RLS *filtert*, es wirft keine Fehler — ein Callback, der eine benachbarte Zeile liest, findet diese also, wenn eine Admin-Aufgabe speichert, findet jedoch möglicherweise nichts, wenn ein Endbenutzer speichert, jeweils ohne Fehlermeldung. Schreiben Sie Callbacks so, dass sie ein leeres Ergebnis tolerieren, oder greifen Sie bewusst auf die Admin-Ebene zu:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` ist eine zweite Verbindung, nicht Teil dieses Schreibvorgangs]
Unter Postgres läuft `context.client.dataAsAdmin` im Callback eines Requests in einer eigenen Transaktion, auf einer anderen Verbindung aus dem Pool, während die Transaktion des auslösenden Schreibvorgangs noch offen ist. Es committet also für sich allein und bleibt bestehen, wenn der Schreibvorgang zurückgerollt wird. Es kann außerdem die gerade gespeicherte Zeile nicht sehen, da sie noch nicht committet ist, und darf sie nicht schreiben:

- Ein Admin-Schreibvorgang mit einem Fremdschlüssel zurück auf diese Zeile (eine `audit_logs.article_id`, die auf `articles` verweist) scheitert an seiner Schlüsselprüfung, und der Schreibvorgang des Aufrufers scheitert mit ihm.
- Ein Admin-Schreibvorgang auf die gerade gespeicherte Zeile oder auf eine beliebige Zeile, die dieser Schreibvorgang gesperrt hat, wartet auf die Sperre des Schreibvorgangs, während der Schreibvorgang auf den Callback wartet. Postgres kann das nicht als Deadlock erkennen, sodass der Request bis zum `statement_timeout` (standardmäßig 30 Sekunden) hängt und dann fehlschlägt.

Für einen Datensatz, der auf die Zeile verweisen muss, schreiben Sie ihn mit `context.data`, das auf der Transaktion des Schreibvorgangs mitläuft, oder reihen Sie einen [Job](/docs/backend/jobs) ein: Ein aus dem Callback eingereihter Job wird mit dem Schreibvorgang committet, und sein Handler läuft nach dem Commit.
:::

:::caution[Diese Seite besagte früher das Gegenteil]
Frühere Versionen dieser Seite gaben an, dass Callbacks RLS immer umgehen und „vollen Datenbankzugriff unabhängig von den Berechtigungen des auslösenden Benutzers“ haben. Das war falsch, und zwar in die unsichere Richtung — es verleitete dazu, Callbacks in der Annahme zu schreiben, dass sie immer alles sehen könnten.

Das obige Verhalten wird durch den Testfall `"scopes context.data to the caller when a callback runs on a user request"` in der RLS-Enforcement-Suite von `@rebasepro/server-postgres` End-to-End gegen Postgres verifiziert.
:::

## Transaktionssemantik

:::important
**`context.data`-Schreibvorgänge eines Callbacks sind Teil des Schreibvorgangs, der ihn ausgelöst hat.** Unter Postgres laufen `beforeSave`, das Speichern und `afterSave` — bzw. `beforeDelete`, das Löschen und `afterDelete` — innerhalb einer einzigen Transaktion. Jeder Callback wird vor dem Commit abgewartet, und `context.data` schreibt über dieselbe Transaktion.
:::

Der auslösende Schreibvorgang und alles, was seine Callbacks geschrieben haben, werden also entweder gemeinsam oder gar nicht committet:

- Ein Fehler (Throw) in `afterSave` oder `afterDelete` rollt den auslösenden Schreibvorgang sowie jeden `context.data`-Schreibvorgang der Callbacks zurück. Der Aufrufer erhält **400 `CALLBACK_REJECTED`** mit `details.stage`, das den jeweiligen Hook benennt — oder den spezifischen Fehlerstatus, falls vorhanden: ein von Ihnen geworfener `RebaseApiError`, der 409-Fehler einer Eindeutigkeitsverletzung.
- Realtime-Abonnenten erfahren erst nach dem Commit von der Zeile; ein zurückgerollter Schreibvorgang wird also niemals angekündigt.
- Ein Callback hält die Transaktion während seiner Ausführung offen. Ein langsamer Callback bedeutet daher eine gehaltene Sperre und eine blockierte Verbindung im Connection-Pool — `beforeSave` und `beforeDelete` ebenso wie die `after`-Hooks. Siehe [Ein Callback hält eine Verbindung](#ein-callback-hält-eine-verbindung).
- Ein `context.data`-Schreibvorgang führt auch die Callbacks der Zielkollektion aus, sodass ein `afterSave`, das seine eigene Zeile aktualisiert, sich selbst erneut ausführt. Schreibvorgänge, die mehr als 16 Ebenen tief verschachtelt sind, werden mit **500 `CALLBACK_RECURSION`** abgelehnt, unter Angabe des Hooks und der Collection, und der gesamte Schreibvorgang wird zurückgerollt. Machen Sie einen solchen Schreibvorgang bedingt, wie es das Beispiel unten tut.

Lassen Sie einen Fehler werfen, wenn der auslösende Schreibvorgang diesen nicht überstehen soll. Fangen Sie ihn ab, wenn er überstehen soll, aber nur um einen `context.data`-**Schreibvorgang** herum: Ein Create, Update oder Delete, das die Datenbank ablehnt (eine Unique- oder Foreign-Key-Verletzung, ein Trigger), wird isoliert rückgängig gemacht, und der Rest wird committet.

Jede andere Anweisung, die auf der Transaktion des Schreibvorgangs fehlschlägt — eine Abfrage, der Lesevorgang, den ein Update oder Delete zum Auffinden seiner Zeile durchführt (eine ID, die die Schlüsselspalte nicht aufnehmen kann), ein von der Datenbank abgelehntes Einreihen eines Jobs —, bricht diese Transaktion in Postgres ab, und das Abfangen des Fehlers in JavaScript macht das nicht rückgängig. Der Schreibvorgang wird mit **500 `TRANSACTION_ABORTED`** abgelehnt und nichts wird gespeichert, statt Erfolg für einen Schreibvorgang zu melden, der zurückgerollt wurde. Lassen Sie einen solchen Fehler werfen, oder prüfen Sie die Bedingung, bevor Sie die Anweisung ausführen.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this collection again, which runs this callback
    // again: act on creates only, or it never stops.
    if (status !== "new") return;
    try {
        await context.data.jobs.create({ title: values.title, status: "published" });
    } catch (error) {
        // Only the failed create is undone. The submission and this marker commit.
        await context.data.job_submissions.update(id, {
            promotion_status: "failed",
            promotion_error: String(error)
        });
    }
}
```

Arbeiten, die die Datenbank verlassen müssen — eine E-Mail, ein Webhook, ein Aufruf einer Drittanbieter-API —, gehören nicht in den Callback-Body. Sie würden die Transaktion für einen Netzwerk-Roundtrip offenhalten, und nichts kann sie zurücknehmen, wenn der Schreibvorgang zurückgerollt wird. Stellen Sie dafür einen [Job](/docs/backend/jobs) in die Warteschlange oder führen Sie die Aktion aus, nachdem der Schreibvorgang zurückgekehrt ist: Veröffentlichen Sie auf einem [Realtime-Kanal](/docs/backend/realtime) oder verwenden Sie `waitUntil` in einer [benutzerdefinierten Funktion](/docs/backend/custom-functions). Unter [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) erfahren Sie, was sich am besten eignet.

Bei MongoDB trifft nichts davon zu. Dieser Treiber führt dieselben Callbacks ohne Transaktion aus, sodass der Schreibvorgang bereits gespeichert ist, wenn `afterSave` ausgeführt wird, und ein dortiger Fehler lediglich das Scheitern meldet, ohne es rückgängig zu machen.

## Ein Callback hält eine Verbindung

Unter Postgres läuft ein Schreibvorgang auf einer einzigen Verbindung, die aus dem Datenbank-Pool entnommen wird,
und jeder Callback läuft darauf: `beforeSave` und `beforeDelete`, nachdem die
Transaktion begonnen hat, `afterSave` und `afterDelete`, bevor sie committet. Solange ein Callback läuft —
beim Abwarten einer Abfrage, einer Berechnung, irgendetwas —, bedient diese
Verbindung nichts anderes, und die Sperren, die der Schreibvorgang genommen hat, bleiben genommen:
in `afterSave` die gerade geschriebene Zeile; bei einem Bulk- oder [`_batch`](/docs/backend/writes/#cross-collection-batches)-Schreibvorgang
jede Zeile, die die Transaktion zuvor geschrieben hat.

Die Kosten sind die eigene Dauer des Callbacks, und gleichzeitige Schreibvorgänge summieren sie:

- Der Pool hält standardmäßig 20 Verbindungen (`DB_POOL_MAX`). 25 gleichzeitige Speichervorgänge,
  deren `beforeSave` 300 ms abwartete, ließen einen unbeteiligten Ein-Zeilen-Read 290 ms dauern,
  fast alles davon Warten auf eine Verbindung.
- Ein Bulk-Create von 100 Zeilen, dessen `beforeSave` 50 ms abwartet, ist eine Transaktion,
  die 5,3 s offen ist und dabei ihre Verbindung und die Sperren jeder bisher geschriebenen Zeile
  die ganze Zeit hält.

Daher:

- Halten Sie alles Langsame aus Callbacks heraus. Ein Aufruf eines anderen Dienstes gehört in einen
  [Job](/docs/backend/jobs) oder nach der Rückkehr des Schreibvorgangs.
- Schlagen Sie nach, was ein Hook braucht, bevor Sie schreiben, wenn möglich — im Client oder
  in einer [benutzerdefinierten Funktion](/docs/backend/custom-functions), die dann schreibt.
- Senden Sie Zeilen, deren Hooks langsam sind, in kleineren Bulks.
- Laufen viele langsame Hooks absichtlich gleichzeitig, erhöhen Sie `DB_POOL_MAX`, im Rahmen dessen,
  was `max_connections` der Datenbank für jede Instanz erlaubt.
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Mit
  `REBASE_METRICS=true` meldet `/metrics` `rebase_db_pool_wait_ms`: wie lange
  jede Abfrage auf eine Verbindung wartete. Ein gesunder Pool hält ihn nahe null; ein Tail,
  der mit dem Traffic wächst, sind Anfragen, die auf Verbindungen warten, die Callbacks
  halten. Siehe [Metriken](/docs/deployment/self-hosting/#metrics).

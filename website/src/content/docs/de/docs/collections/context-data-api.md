---
sourceHash: aaaaecaefd6bb6c4
title: Die context.data-API
sidebar_label: context.data-API
description: Lesen und schreiben Sie andere Tabellen aus einem Tabellen-Hook heraus mit context.data – seine Methoden, die Berechtigungen, mit denen er ausgeführt wird, Transaktionssemantiken und die Verbindung, die ein Hook hält.
---

Jeder [Tabellen-Hook](/docs/collections/callbacks/) erhält ein `context`-Objekt, das `context.data` enthält: die Datenschicht zum Lesen und Schreiben **anderer Tabellen** aus dem Hook heraus.

## Zugriff auf Tabellen

`context.data` verwendet einen JavaScript-Proxy, sodass Sie über den Slug einer Tabelle als Eigenschaft auf jede Tabelle zugreifen können:

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any table slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .table() method for dynamic slugs
    const slug = "jobs";
    const accessor = context.data.table(slug);
}
```

Eine Eigenschaft ist der Accessor der Tabelle, der Name, den das generierte SDK ihr zuweist: `context.data.myNotes` ist die Tabelle mit dem Slug `my-notes`, unabhängig davon, in welcher SQL-Tabelle sie gespeichert ist. Ein Name, der kein Tabellen-Accessor ist, wird als dessen snake_case interpretiert, sodass `context.data.auditLog` zu `audit_log` wird.

Zeilen sind nicht typisiert (`Record<string, unknown>`), bis das Projekt seine generierte `Database` registriert; danach ist jeder Accessor daraus typisiert. Siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data).

## Verfügbare Methoden

Jeder Tabellen-Accessor (`context.data.<slug>`) stellt die folgenden Methoden bereit:

| Methode | Signatur | Beschreibung |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResult` | Zeilen mit Filtern, Sortierung und Paginierung abfragen |
| `.findById()` | `findById(id: string \| number) → Row \| undefined` | Eine einzelne Zeile anhand der ID abrufen |
| `.create()` | `create(data: Insert, id?: string \| number) → Row` | Eine neue Zeile erstellen und wie gespeichert zurückgeben |
| `.update()` | `update(id: string \| number, data: Update) → Row` | Eine bestehende Zeile aktualisieren und wie gespeichert zurückgeben |
| `.delete()` | `delete(id: string \| number) → void` | Einen Datensatz löschen |
| `.count()` | `count(params?: FindParams) → number` | Passende Zeilen zählen |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Echtzeit-Abonnement (sofern unterstützt) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Eine einzelne Zeile abonnieren |
| `.trash` | `trash.find()`, `.count()`, `.restore(id)`, `.restoreMany(ids)`, `.purge(id)`, `.purgeMany(ids)` | Die Zeilen, die ein [Soft Delete](/docs/collections/soft-delete#from-the-sdk) markiert hat |

### Bekannte Einschränkungen im In-Process-Betrieb

Dieselbe Schnittstelle über HTTP (`@rebasepro/client`) bietet einige Dinge, die die In-Process-Variante (`context.data`, `rebase.data`, `rebase.dataAsAdmin`) nicht unterstützt. Nichts davon ist neu in 0.31:

- Eine In-Process-Zeile enthält keine Such-`_matches` und keine Version: `etagOf(row)` ist `undefined`, übergeben Sie also `ifMatch` aus einer Zeile, die Sie über HTTP gelesen haben.
- `listenCount()` ist in-process nicht verfügbar: Es wirft „Realtime is not available“.
- Das Tabellen-Kürzel `.search(text)` akzeptiert kein `{ explain }` (das `.search` des Query Builders tut dies, aber in-process gibt es keine `_matches` zurückzugeben).

## Abfragen mit `.find()`

Die Methode `find()` filtert mit `[operator, value]`-Tupeln – der typisierten Form des `?status=eq.published`-Query-Strings, den die REST-API liest:

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

## Zeilen erstellen

`.create()` und `.update()` nehmen die zu schreibenden Werte mit den oben genannten Signaturen entgegen. [Schreiben in andere Tabellen](/docs/collections/callbacks/#writing-to-other-tables) verwendet beides: Eine genehmigte Einreichung erstellt einen veröffentlichten Job und wird mit diesem verknüpft.

## Sicherheit: Mit welchen Berechtigungen `context.data` ausgeführt wird

:::important
**`context.data` erbt die Berechtigungen von dem, was den Hook ausgelöst hat.** Es handelt sich nicht um eine feste Vertrauensstufe.

- Ausgelöst durch eine **Benutzeranfrage** (REST, Realtime, eine Bearbeitung im CMS) → **benutzerbezogen (user-scoped)**. Der Hook wird innerhalb der für diese Anfrage geöffneten, RLS-gebundenen Transaktion ausgeführt, sodass Richtlinien für Lese- *und* Schreibvorgänge gelten. Ein Hook kann keine Zeile sehen, die sein Aufrufer nicht sehen konnte.
- Ausgelöst durch **`rebase.dataAsAdmin` oder einen Cron-Job** (dasselbe Singleton) → **admin-bezogen (admin-scoped)**, nicht unbeschränkt. Dieser Treiber ist auf `{ uid: "service", roles: ["admin"] }` beschränkt, sodass der Hook weiterhin in einer RLS-gebundenen Transaktion ausgeführt wird – Ihre Richtlinien werden für diese Identität ausgewertet.
- Ausgelöst durch **den Basis-Treiber** (integrierte Auth-Flows, Migrationen) → **unbeschränkt (unscoped)**. Er läuft auf der Owner-Verbindung und umgeht RLS.
:::

Dies ist vor allem in der Richtung von Bedeutung, die stillschweigend fehlschlägt. RLS *filtert*, es wirft keine Fehler – ein Hook, der eine Geschwisterzeile liest, findet diese also, wenn eine Admin-Aufgabe speichert, und findet möglicherweise nichts, wenn ein Endbenutzer speichert, in beiden Fällen ohne Fehler. Schreiben Sie Hooks so, dass sie ein leeres Ergebnis tolerieren, oder greifen Sie bewusst auf die Admin-Ebene zu:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a table whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` ist eine zweite Verbindung, kein Teil dieses Schreibvorgangs]
`context.client.dataAsAdmin` innerhalb des Hooks einer Anfrage wird in einer eigenen Transaktion auf einer anderen gepoolten Verbindung ausgeführt, während die Transaktion des auslösenden Schreibvorgangs noch offen ist. Sie committet daher eigenständig und bleibt bestehen, selbst wenn der Schreibvorgang zurückgerollt wird. Sie kann auch die gerade gespeicherte Zeile nicht sehen, da diese noch nicht committet ist, und darf nicht darauf schreiben:

- Ein Admin-Schreibvorgang mit einem Fremdschlüssel zurück zu dieser Zeile (ein `audit_logs.article_id`, das auf `articles` verweist) schlägt bei der Schlüsselprüfung fehl, und der Schreibvorgang des Aufrufers schlägt mit fehl.
- Ein Admin-Schreibvorgang auf die gerade gespeicherte Zeile oder auf eine andere Zeile, die dieser Schreibvorgang gesperrt hat, wartet auf die Sperre des Schreibvorgangs, während der Schreibvorgang auf den Hook wartet. Postgres kann dies nicht als Deadlock erkennen, sodass die Anfrage bis zum `statement_timeout` (standardmäßig 30 Sekunden) hängt und dann fehlschlägt.

Schreiben Sie einen Datensatz, der auf diese Zeile verweisen muss, mit `context.data`, das die Transaktion des Schreibvorgangs nutzt, oder reihen Sie einen [Job](/docs/backend/jobs) in die Warteschlange ein: Ein aus dem Hook eingereihter Job wird zusammen mit dem Schreibvorgang committet, und sein Handler wird nach dem Commit ausgeführt.
:::

:::caution[Auf dieser Seite stand früher das Gegenteil]
Frühere Versionen dieser Seite gaben an, dass Hooks (damals Callbacks genannt) RLS immer umgehen und „vollen Datenbankzugriff unabhängig von den Berechtigungen des auslösenden Benutzers“ haben. Das war falsch, und zwar in unsicherer Weise – es verleitete dazu, Hooks unter der Annahme zu schreiben, dass sie immer alles sehen könnten.

Das obige Verhalten wird durch den Testfall `"scopes context.data to the caller when a callback runs on a user request"` in der RLS-Enforcement-Suite von `@rebasepro/server-postgres` Ende-zu-Ende gegen Postgres verifiziert.
:::

## Transaktionssemantik

:::important
**Die `context.data`-Schreibvorgänge eines Hooks sind Teil des Schreibvorgangs, der ihn ausgelöst hat.** `beforeSave`, das Speichern und `afterSave` – oder `beforeDelete`, das Löschen und `afterDelete` – laufen innerhalb einer einzigen Transaktion, wobei jeder Hook vor dem Commit abgewartet wird und `context.data` über dieselbe Transaktion schreibt.
:::

Der auslösende Schreibvorgang und alles, was seine Hooks geschrieben haben, werden also gemeinsam committet oder überhaupt nicht:

- Ein `throw` aus `afterSave` oder `afterDelete` rollt den auslösenden Schreibvorgang zurück, zusammen mit jedem `context.data`-Schreibvorgang, den die Hooks durchgeführt haben. Der Aufrufer erhält als Antwort **400 `CALLBACK_REJECTED`**, wobei `details.stage` den Hook benennt – oder mit dem eigenen Status des Fehlers, falls vorhanden: ein von Ihnen geworfener `RebaseApiError`, der 409-Status einer Unique-Constraint-Verletzung.
- Realtime-Abonnenten erfahren erst nach dem Commit von der Zeile, sodass ein zurückgerollter Schreibvorgang niemals angekündigt wird.
- Ein Hook hält die Transaktion während seiner Ausführung offen; ein langsamer Hook bedeutet also eine gehaltene Sperre und eine gebundene gepoolte Verbindung – `beforeSave` und `beforeDelete` ebenso wie die `after`-Hooks. Siehe [Ein Hook hält eine Verbindung](#ein-hook-hält-eine-verbindung).
- Ein `context.data`-Schreibvorgang führt auch die Hooks der Zieltabelle aus; ein `afterSave`, das seine eigene Zeile aktualisiert, führt sich also selbst erneut aus. Schreibvorgänge, die tiefer als 16 Ebenen verschachtelt sind, werden mit **500 `CALLBACK_RECURSION`** unter Nennung des Hooks und der Tabelle abgewiesen, und der gesamte Schreibvorgang wird zurückgerollt. Machen Sie solche Schreibvorgänge von Bedingungen abhängig, wie im folgenden Beispiel gezeigt.

Lassen Sie einen Fehler werfen (throw), wenn der auslösende Schreibvorgang ihn nicht überstehen soll. Fangen Sie ihn ab (catch), wenn er es soll, aber nur um einen `context.data`-**Schreibvorgang** herum: Ein Erstellen, Aktualisieren oder Löschen, das die Datenbank verweigert (eine Unique- oder Foreign-Key-Verletzung, ein Trigger), wird isoliert rückgängig gemacht, und der Rest wird committet.

Jede andere Anweisung, die in der Transaktion des Schreibvorgangs fehlschlägt – ein Nachschlagen (Lookup), das Lesen, das ein Update oder Delete durchführt, um seine Zeile zu finden (eine ID, die die Schlüsselspalte nicht aufnehmen kann), das Einreihen eines Jobs, das die Datenbank verweigert hat –, bricht diese Transaktion in Postgres ab, und das Abfangen des Fehlers in JavaScript macht dies nicht rückgängig. Der Schreibvorgang wird mit **500 `TRANSACTION_ABORTED`** abgewiesen und nichts wird gespeichert, anstatt einen Erfolg für einen Schreibvorgang zu melden, der zurückgerollt wurde. Lassen Sie einen solchen Fehler werfen oder prüfen Sie die Bedingung vor dem Ausführen der Anweisung.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this table again, which runs this hook
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

Arbeiten, die die Datenbank verlassen müssen – eine E-Mail, ein Webhook, ein Aufruf einer Drittanbieter-API –, gehören nicht in den Hook-Body. Sie würden die Transaktion für einen Netzwerk-Roundtrip offenhalten, und nichts kann sie rückgängig machen, wenn der Schreibvorgang zurückgerollt wird. Reihen Sie dafür einen [Job](/docs/backend/jobs) in die Warteschlange ein oder führen Sie dies aus, nachdem der Schreibvorgang zurückgekehrt ist: Veröffentlichen Sie auf einem [Realtime-Kanal](/docs/backend/realtime) oder verwenden Sie `waitUntil` in einer [Custom Function](/docs/backend/custom-functions). Unter [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) erfahren Sie, was jeweils geeignet ist.

## Ein Hook hält eine Verbindung

Ein Schreibvorgang läuft auf einer Verbindung, die aus dem Datenbank-Pool bezogen wird, und jeder Hook läuft auf dieser Verbindung: `beforeSave` und `beforeDelete`, nachdem die Transaktion begonnen hat, `afterSave` und `afterDelete`, bevor sie committet. Solange ein Hook ausgeführt wird – beim Warten auf ein Nachschlagen, eine Berechnung oder irgendetwas anderes –, bedient diese Verbindung nichts anderes, und die Sperren, die der Schreibvorgang gesetzt hat, bleiben bestehen: in `afterSave` die gerade geschriebene Zeile; bei einem Bulk- oder [`_batch`](/docs/backend/writes/#cross-table-batches)-Schreibvorgang jede Zeile, die die Transaktion davor geschrieben hat.

Die Kosten entsprechen der eigenen Laufzeit des Hooks, und gleichzeitige Schreibvorgänge summieren dies auf:

- Der Pool fasst standardmäßig 20 Verbindungen (`DB_POOL_MAX`). 25 gleichzeitige Speichervorgänge, deren `beforeSave` 300 ms wartete, führten dazu, dass ein nicht damit zusammenhängender Lesezugriff auf eine einzelne Zeile 290 ms dauerte – fast die gesamte Zeit verging mit dem Warten auf eine Verbindung.
- Eine Massenerstellung (Bulk Create) von 100 Zeilen, deren `beforeSave` 50 ms wartet, ist eine Transaktion, die für 5,3 s geöffnet ist und während der gesamten Dauer ihre Verbindung sowie die Sperren aller bisher geschriebenen Zeilen hält.

Daher:

- Halten Sie alles Langsame aus Hooks fern. Ein Aufruf eines anderen Dienstes gehört in einen [Job](/docs/backend/jobs) oder nach der Rückkehr des Schreibvorgangs ausgeführt.
- Schlagen Sie vor dem Schreiben nach, was ein Hook benötigt, wenn möglich – im Client oder in einer [Custom Function](/docs/backend/custom-functions), die anschließend schreibt.
- Senden Sie Zeilen, deren Hooks langsam sind, in kleineren Batches/Mengen.
- Wenn konstruktionsbedingt viele langsame Hooks gleichzeitig ausgeführt werden, erhöhen Sie `DB_POOL_MAX` im Rahmen dessen, was `max_connections` der Datenbank für jede Instanz zulässt.
- Mit `REBASE_METRICS=true` meldet `/metrics` den Wert `rebase_db_pool_wait_ms`: wie lange jede Abfrage auf eine Verbindung gewartet hat. Ein gesunder Pool hält diesen Wert nahe Null; ein Ausreißerwert (Tail), der mit dem Traffic wächst, bedeutet, dass sich Anfragen in einer Warteschlange für Verbindungen stauen, die von Hooks gehalten werden. Siehe [Metriken](/docs/deployment/self-hosting/#metrics).

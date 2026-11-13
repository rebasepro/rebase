---
sourceHash: 81fb68b88d544514
title: Globale Backend-Hooks
sidebar_label: Globale Hooks
description: "Wenden Sie übergreifende Lifecycle-Hooks auf Serverebene auf jede Tabelle an: Exportieren Sie Hooks aus backend/hooks.ts in derselben TableHooks-Struktur, die auch die tabelleneigenen Hooks verwenden."
---

## Übersicht

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Rebase führt Tabellen-Hooks auf zwei Ebenen aus, beide vom Typ `TableHooks` aus
`@rebasepro/server/schema`:

- **[Tabellen-Hooks](/docs/collections/callbacks)**: Der `hooks`-Schlüssel eines `defineTable`. Sie werden nur für diese Tabelle ausgeführt.
- **Globale Hooks**: Exportiert als `hooks` aus `backend/hooks.ts`. Sie werden bei **jeder** Tabelle auf jedem Datenpfad ausgelöst (REST-API, WebSocket / Realtime, MCP, serverseitiges `rebase.dataAsAdmin`). Der einzige Writer, den sie nicht erfassen, ist das Auth-System: Registrierung (Sign-up), OAuth-Anmeldung und die Benutzerverwaltung des Admins schreiben Benutzerzeilen direkt und führen stattdessen die [Auth-Hooks](/docs/backend/authentication/) (`afterUserCreate`, …) aus.

Verwenden Sie globale Hooks für:
- **Row-Scoping** — `beforeQuery` auf jeder Tabelle, sodass Lesezugriffe eines Mandanten zentral an einer Stelle statt pro Tabelle eingegrenzt werden. Siehe [`beforeQuery`](/docs/collections/callbacks#beforequery).
- **PII-Maskierung** — Unkenntlichmachen sensibler Felder für Nicht-Admin-Aufrufer über alle Tabellen hinweg.
- **Einheitliches Audit-Logging** — Protokollieren jeder Erstellung, Aktualisierung oder Löschung an einem zentralen Ort. Neue Konten aus Registrierung und OAuth gehören nicht dazu; protokollieren Sie diese über `afterUserCreate`.
- **Übergreifende Validierung** — Durchsetzen von Invarianten, die mehrere Tabellen umfassen.

:::note
**Ausführungsreihenfolge**: globale Hooks → tabelleneigene Hooks → das `.transform()` der Spalten.
:::

Jeder Hook erhält den Deskriptor der Tabelle, für die er ausgeführt wird, als `table`. Globale Hooks erfordern daher deklarierte Tabellen: Ein Backend, das die Datenbank introspektiert (kein `backend/schema`), verweigert diese beim Booten.

---

## Konfiguration

:::note[Wo dies platziert wird]
**Managed Runtime** — `export const hooks = { … }` aus `backend/hooks.ts`. Die Runtime liest diesen Export beim Booten; sonst muss nichts geändert werden. Jeder andere Export aus der Datei wird beim Booten gemeldet und ignoriert.

**Ejected** — Der `hooks`-Schlüssel bei `initializeRebaseBackend({ … })`.

Die vollständige Zuordnung finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
:::

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    afterRead({ values }) {
        // Runs after every row read, across all tables
        return values;
    },
    beforeSave({ values }) {
        // Runs before every save
        return values;
    }
};
```

`hooks` akzeptiert ein einzelnes Set. Um verschiedene Anliegen voneinander zu trennen, schreiben Sie jedes als eigenes Set und übergeben Sie `composeTableHooks(tenantScope, auditTrail)` aus `@rebasepro/common`: Sie kombinieren sich genau wie die oben genannten Schichten. Siehe [Kombinieren von Hook-Sets](/docs/collections/callbacks/#combining-hook-sets).
Dasselbe gilt für `backend.setTableHooks(slug, hooks)`, welches die von einer Tabelle deklarierten Hooks ersetzt: Übergeben Sie `composeTableHooks(declared, yours)`, um sie beizubehalten.

---

## `TableHooks`-Typ

```typescript
type TableHooks = {
    beforeQuery?(props): QueryNarrowing | void;     // Conditions to AND into a read before it is compiled
    afterRead?(props):   Record<string, unknown>;  // Transform the row before returning it to the caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

`beforeQuery` grenzt einen Lesevorgang ein, bevor er kompiliert wird; siehe
[`beforeQuery`](/docs/collections/callbacks#beforequery).

Alle Hooks können ein `Promise` (asynchron) oder einen einfachen Wert (synchron) zurückgeben.

---

## Hook-Props

Jeder Hook empfängt ein einzelnes Props-Objekt. Gemeinsame Felder:

| Feld | Typ | Vorhanden in |
|-------|------|------------|
| `table` | `TableDescriptor` | Allen Hooks |
| `path` | `string` | Allen Hooks |
| `values` | `Record<string, unknown>` | Allen außer `beforeQuery`: die gelesene Zeile (`afterRead`), die gelöscht werdende Zeile (`beforeDelete`, `afterDelete`) oder die geschriebenen Werte (die Save-Hooks) |
| `id` | `string \| number` | `beforeSave` (optional), `afterSave`, `afterSaveError` (optional), `beforeDelete`, `afterDelete` |
| `previousValues` | row (optional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing" \| "copy"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `error` | `unknown` | `afterSaveError` |
| `operation`, `query` | Art des Lesevorgangs, Abfrage des Aufrufers | `beforeQuery` |
| `context` | `RebaseCallContext` | Allen Hooks |

`context.user` enthält den authentifizierten Benutzer (`uid`, `roles` usw.). Eine Anfrage ohne Token trägt, sofern die API sie zulässt, die anonyme Identität `{ uid: "anonymous", roles: ["anon"] }` anstelle von `undefined`.

`context.credential` benennt den API-Schlüssel, mit dem ein Schreibvorgang durchgeführt wurde: `{ kind, id, name }`, wobei `kind` entweder `"personal"` oder `"service"` ist. Ein persönlicher Schlüssel agiert im Namen seines Besitzers, daher ist `context.user` der Besitzer – unabhängig davon, ob er manuell gespeichert hat oder ein CI-Job mit seinem Schlüssel geschrieben hat; `context.credential` unterscheidet die beiden Fälle. Es ist bei der Daten-API, dem Realtime-Socket und `/mcp` gesetzt und fehlt bei einer Session, dem Service-Schlüssel, Arbeiten im Server-Kontext (`rebase.dataAsAdmin`, Cronjobs) sowie im Browser. Es enthält niemals das Secret.

`table` ist immer vorhanden. Ein globaler Hook wird für jede Tabelle ausgelöst, ist also die einzige Ebene, die unabhängig von einer bestimmten Tabelle registriert wird – dennoch wird ihm niemals eine fehlende Tabelle übergeben. Eine Anfrage, die einen Pfad angibt, den der Server nicht auflösen kann, wird mit `404 NOT_FOUND` abgelehnt, bevor irgendeine Ebene ausgeführt wird – was dieselbe Antwort ist, die Lese- und Schreibpfade für einen solchen Pfad ohnehin liefern. Die Alternative – das Überspringen der Ebene für solche Pfade – würde `afterRead` zu einem Redaktionsschritt mit einer stillschweigenden Ausnahme machen, weshalb dies nicht angeboten wird.

---

## Ausführungspipeline

```
[Client Request]
       │
       ▼
 [Hono Router]
       │
 [Database Driver]
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 1. Start PostgreSQL Transaction                             │
 │ 2. Set Config: app.user_id = '<uid>', app.user_roles = ...  │
 │                                                             │
 │ 3. Global hook: beforeSave         ─┐                       │
 │ 4. Table hook: beforeSave          ─┘ awaited               │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Global hook: afterSave          ─┐                       │
 │ 7. Table hook: afterSave           ─┘ awaited               │
 │                                                             │
 │ 8. Commit  ← a throw anywhere in 3–7 rolls the write back   │
 └─────┬───────────────────────────────────────────────────────┘
       │
 [Realtime notifications flushed — after the commit, never before]
       │
       ▼
[Client Response]
```

---

## Blockierende vs. Asynchrone Semantik

**Jeder Hook in der folgenden Liste wird mit `await` abgewartet, und alle außer `afterSaveError` laufen innerhalb der Transaktion, die den Schreibvorgang ausführt.** Es gibt keine "Fire-and-Forget"-Ebene: Die Zeile und alles, was ihre Hooks getan haben, werden gemeinsam committet oder gar nicht.

- **`beforeSave`, `beforeDelete`** — Wenn der Hook einen Fehler wirft, wird die Operation mit einem HTTP 400 abgelehnt, der Ihre Nachricht und den Code `CALLBACK_REJECTED` enthält, und der Schreibvorgang in der Datenbank findet niemals statt. Werfen Sie einen `RebaseApiError` aus `@rebasepro/types`, um den Status selbst zu wählen — siehe [Tabellen-Hooks](/docs/collections/callbacks#beforesave). Ein `beforeDelete`, das `false` *zurückgibt*, ist dieselbe Ablehnung ohne Nachricht und antwortet mit **403** und diesem Code.
- **`afterRead`** — Die zurückgegebene (oder transformierte) Zeile ist das, was der Aufrufer erhält, und zwar ausschließlich der Aufrufer: Bei einem Schreibvorgang formt sie die Antwort, während `afterSave`, `beforeDelete`, `afterDelete` und der Verlauf die Zeile so erhalten, wie sie gespeichert ist — ein maskierter Wert wird niemals in der Spalte erfasst oder dorthin zurückgesetzt. Seine Transaktion ist `READ ONLY` — siehe [unten](#afterread-kann-nicht-schreiben).
- **`afterSave`, `afterDelete`** — Werden *vor* dem Commit ausgeführt und abgewartet. Ein Fehler hier rollt die Zeile zurück und liefert denselben Fehler **400 `CALLBACK_REJECTED`**, wobei `details.stage` den Hook benennt. Sie halten die Transaktion während ihrer Ausführung offen, ein langsamer Hook blockiert also mit einem Lock.
- **`afterSaveError`** — Wird ausgeführt, wenn das Speichern fehlgeschlagen ist, auf dem Rückweg. Bei einer Anfrage läuft er, nachdem die Transaktion des fehlgeschlagenen Schreibvorgangs zurückgerollt wurde, mit einem `context`, bei dem jeder Aufruf eine eigene Transaktion darstellt, sodass ein Job, den er zur Meldung des Fehlers einreiht, erhalten bleibt. Ein von ihm geworfener Fehler wird protokolliert; der Aufrufer erhält den eigentlichen Fehler des Speichervorgangs.

:::caution[Auf dieser Seite stand früher das Gegenteil]
In früheren Versionen hieß es, dass `afterSave` und `afterDelete` "nach dem Commit der Transaktion ausgeführt werden" und "die HTTP-Antwort nicht blockieren". Beides war nie der Fall. Code, der basierend auf diesem Satz geschrieben wurde – beispielsweise ein Webhook-Aufruf in `afterSave` –, hielt eine Datenbanktransaktion für die Dauer eines HTTP-Roundtrips offen und rollte die Zeile jedes Mal zurück, wenn die Gegenseite nicht erreichbar war.
:::

### Wann `afterSaveError` ausgeführt wird

Er meldet ein Speichern, das **an der Datenbank oder danach** fehlgeschlagen ist – ab dem INSERT- oder UPDATE-Statement. Ein Speichervorgang, der vor diesem Punkt abgelehnt wurde, hat die Datenbank nie erreicht, sodass der Hook nicht darüber informiert wird.

| Wird ausgeführt | Wird nicht ausgeführt |
|---|---|
| Die Datenbank lehnt das Statement ab: Verletzung eines Unique- oder Foreign-Keys, ein Check-Constraint oder Trigger, eine Row-Level-Security-Richtlinie (`WRITE_DENIED`) | Eine Ablehnung durch `beforeSave` — der Hook, der abgelehnt hat, weiß bereits Bescheid |
| `afterRead` oder `afterSave` wirft einen Fehler (der Aufrufer erhält `CALLBACK_REJECTED`) | Eine vor dem Treiber abgelehnte Anfrage: Validierung (`VALIDATION_*`), ein Feld, das der Aufrufer nicht schreiben darf, fehlende Berechtigung |
| Der Verlaufseintrag kann nicht erfasst werden | Eine Zeile, die der Aufrufer nicht adressieren kann (`404`), ein Mandanten-Stempel, den er nicht setzen darf |
| | Der Commit wird abgelehnt, nachdem das Speichern zurückgekehrt ist: `TRANSACTION_ABORTED` (ein fehlgeschlagenes Statement, das ein Hook abgefangen hat) oder ein bei `COMMIT` geprüfter Deferred Constraint |
| | Ein Löschvorgang — es gibt kein Gegenstück für Deletes |

Bei einem Bulk- oder `_batch`-Schreibvorgang wird er für die Zeile ausgeführt, die fehlgeschlagen ist; die Zeilen davor werden mit dem Batch zurückgerollt und nicht gemeldet.

### Seiteneffekte, die die Transaktion nicht aufhalten dürfen

Alles, was langsam ist oder nicht rückgängig gemacht werden kann, wenn die Transaktion zurückrollt, gehört nicht in den Hook-Body:

| Anwendungsfall | Stattdessen tun |
|---|---|
| Drittanbieter aufrufen, E-Mails senden, Dateien generieren | [Einen Job in die Warteschlange einreihen](/docs/backend/jobs). Ein Job, der in einer zurückgerollten Transaktion eingereiht wurde, wurde nie eingereiht — genau das gewünschte Verhalten. |
| Andere Prozesse über ein Ereignis informieren | Nach Rückkehr des Schreibvorgangs auf einem [Realtime-Kanal](/docs/backend/realtime) veröffentlichen, nicht innerhalb des Hooks. |
| Arbeiten in einer [Custom Function](/docs/backend/custom-functions), auf die der Aufrufer nicht warten muss | `waitUntil(c, promise)` aus `@rebasepro/server/functions` — läuft nach der Antwort, und der Host wartet darauf, bevor er herunterfährt. |

Die Faustregel: Wenn die Arbeit auch dann stattfinden soll, wenn der Schreibvorgang rückgängig gemacht wird, ist sie nicht Teil des Schreibvorgangs und gehört daher nicht in den Hook.

### `afterRead` kann nicht schreiben

Ein anfragebezogener Lesevorgang öffnet seine Transaktion als `READ ONLY`, ebenso wie das erneute Abrufen (Refetch) einer Realtime-Subscription. `afterRead` läuft darin, sodass **kein Schreibvorgang aus diesem Hook erfolgreich sein kann** — kein Erstellen über `context.data`, kein Aktualisieren und auch kein Schreibvorgang, der in einer aufgerufenen Hilfsfunktion verborgen ist. Postgres lehnt das Statement mit dem SQLSTATE `25006` ab, und der Aufrufer erhält als Antwort:

```json
{ "error": { "message": "An `afterRead` hook tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Dies ist ein 409, kein 500: Ihr Code wird abgelehnt, es handelt sich nicht um ein Serverversagen. Der Read-Only-Modus ist beabsichtigt — ein Lesevorgang, der heimlich schreibt, ist ein Lesevorgang, dessen Kosten, Sperren und RLS-Oberfläche von niemandem einkalkuliert wurden.

Daher gehört **Audit-Logging von Lesezugriffen nicht in `afterRead`**. Protokollieren Sie den Lesevorgang stattdessen außerhalb der Anfrage — über einen Hintergrundjob, der von bereits vorhandenen Ereignissen gespeist wird, oder über eine Custom Function, die das Lesen *und* das Schreiben in zwei getrennten Aufrufen durchführt:

```typescript no-verify
// ✗ Fails with READ_ONLY_TRANSACTION on every read.
export const hooks: TableHooks = {
    afterRead: async ({ path, values, context }) => {
        await context.data.read_log.create({ path, uid: context.user?.uid });
        return values;
    }
};
```

```typescript
// backend/functions/read-article.ts — served at /api/functions/read-article/:id
// ✓ The read and the audit row are two operations, and only the second writes.
import { defineFunction, getUserId, requireAuth, requireDriver } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/:id", requireAuth, async (c) => {
        const article = await requireDriver(c).fetchOne({ path: "articles", id: c.req.param("id") });
        await rebase.dataAsAdmin.read_log.create({ path: "articles", uid: getUserId(c) });
        return c.json(article);
    });
});
```

Beim schreibseitigen Auditing gibt es dieses Problem nicht: `afterSave` und `afterDelete` laufen in einer Lese-/Schreib-Transaktion, und der Audit-Eintrag wird zusammen mit der protokollierten Änderung committet.

---

## Beispiele

### PII-Maskierung

E-Mail-Adressen für Nicht-Admin-Aufrufer über alle Tabellen hinweg unkenntlich machen:

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    afterRead({ values, context }) {
        const isAdmin = context.user?.roles?.includes("admin");
        if (!isAdmin && values.email) {
            return { ...values, email: "********" };
        }
        return values;
    }
};
```

### Globales Audit-Logging

Jeden Löschvorgang über alle Tabellen hinweg in einer `audit_log`-Tabelle erfassen. Da `afterDelete` in der Transaktion des Löschvorgangs selbst ausgeführt wird, werden der Audit-Eintrag und der Löschvorgang gemeinsam committet – es gibt kein Zeitfenster, in dem das eine ohne das andere existiert:

```typescript no-verify
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    async afterDelete({ table, id, values, context }) {
        if (table.slug === "audit_log") return;   // don't audit the audit
        await context.data.audit_log.create({
            action: "delete",
            table: table.slug,
            entity_id: String(id),
            actor: context.user?.uid ?? "anonymous",
            // The API key, when the delete was made with one.
            via_key: context.credential?.name ?? null,
            snapshot: values
        });
    }
};
```

Beachten Sie die Vor- und Nachteile: Kann der Audit-Eintrag nicht geschrieben werden, findet auch der Löschvorgang nicht statt. Für einen Audit-Trail ist dies normalerweise das gewünschte Verhalten. Sollte dies nicht der Fall sein, fangen Sie den Fehler im Hook ab und vermerken Sie dies in einem Kommentar.

### Tabellenspezifische Logik

Globale Hooks werden für alle Tabellen ausgelöst. Um Logik auf eine einzelne Tabelle zu beschränken, prüfen Sie `table.slug` oder `path`:

```typescript
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    beforeSave({ table, values }) {
        if (table.slug === "orders") {
            const total = values.total;
            if (typeof total !== "number" || total <= 0) {
                throw new Error("Order total must be positive");
            }
        }
        return values;
    }
};
```

Für Hooks, die nur für eine einzelne Tabelle gelten, sollten Sie stattdessen [die tabelleneigenen Hooks](/docs/collections/callbacks) bevorzugen.

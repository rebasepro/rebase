---
sourceHash: 81fb68b88d544514
title: Hook di backend globali
sidebar_label: Hook globali
description: "Applica hook del ciclo di vita trasversali a ogni tabella a livello di server: esporta gli hook da backend/hooks.ts, con la stessa struttura TableHooks utilizzata dagli hook della tabella stessa."
---

## Panoramica

<span class="since-badge" data-since="0.31">Da 0.31</span>

Rebase esegue gli hook di tabella a due livelli, entrambi di tipo `TableHooks` da
`@rebasepro/server/schema`:

- **[Hook di tabella](/docs/collections/callbacks)**: la chiave `hooks` di un `defineTable`. Vengono eseguiti solo per quella tabella.
- **Hook globali**: esportati come `hooks` da `backend/hooks.ts`. Vengono attivati su **ogni** tabella, su ogni percorso dati (API REST, WebSocket / realtime, MCP, `rebase.dataAsAdmin` lato server). L'unico scrittore che non intercettano è il sistema di autenticazione: registrazione, accesso OAuth e la gestione utenti dell'amministratore scrivono direttamente le righe degli utenti ed eseguono invece gli [hook di autenticazione](/docs/backend/authentication/) (`afterUserCreate`, …).

Usa gli hook globali per:
- **Scoping delle righe** — `beforeQuery` su ogni tabella, in modo che le letture di un tenant vengano ristrette in un unico punto invece che per ciascuna tabella. Consulta [`beforeQuery`](/docs/collections/callbacks#beforequery).
- **Mascheramento PII** — oscura i campi sensibili per i chiamanti non amministratori su tutte le tabelle.
- **Audit logging unificato** — registra ogni creazione, aggiornamento o eliminazione in un unico punto. I nuovi account provenienti da registrazione e OAuth non sono inclusi tra questi; registrali tramite `afterUserCreate`.
- **Validazione trasversale** — applica invarianti che si estendono su più tabelle.

:::note
**Ordine di esecuzione**: hook globali → hook specifici della tabella → `.transform()` delle sue colonne.
:::

Ogni hook riceve il descrittore della tabella per cui viene eseguito come `table`, quindi
gli hook globali richiedono tabelle dichiarate: un backend che esegue l'introspezione del database
(senza `backend/schema`) li rifiuta all'avvio.

---

## Configurazione

:::note[Dove va posizionato]
**Managed runtime** — `export const hooks = { … }` da `backend/hooks.ts`. Il runtime legge tale esportazione all'avvio; non è necessario modificare nient'altro. Qualsiasi altra esportazione dal file viene segnalata all'avvio e ignorata.

**Ejected** — la chiave `hooks` in `initializeRebaseBackend({ … })`.

La mappatura completa si trova nella [Panoramica del Backend](/docs/backend/#where-each-option-lives).
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

`hooks` accetta un singolo set. Per mantenere separate le diverse responsabilità,
scrivi ciascuna come set autonomo e passa `composeTableHooks(tenantScope, auditTrail)` da
`@rebasepro/common`: si combinano esattamente come i livelli sopra descritti. Consulta
[Combinare set di hook](/docs/collections/callbacks/#combining-hook-sets).
Lo stesso vale per `backend.setTableHooks(slug, hooks)`, che sostituisce gli
hook dichiarati da una tabella: passa `composeTableHooks(declared, yours)` per mantenerli.

---

## Tipo `TableHooks`

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

`beforeQuery` restringe una lettura prima che venga compilata; vedi
[`beforeQuery`](/docs/collections/callbacks#beforequery).

Tutti gli hook possono restituire una `Promise` (asincrono) o un valore semplice (sincrono).

---

## Props degli hook

Ogni hook riceve un singolo oggetto props. Campi comuni:

| Campo | Tipo | Presente in |
|-------|------|-------------|
| `table` | `TableDescriptor` | Tutti gli hook |
| `path` | `string` | Tutti gli hook |
| `values` | `Record<string, unknown>` | Tutti tranne `beforeQuery`: la riga letta (`afterRead`), in corso di eliminazione (`beforeDelete`, `afterDelete`), o i valori scritti (gli hook di salvataggio) |
| `id` | `string \| number` | `beforeSave` (opzionale), `afterSave`, `afterSaveError` (opzionale), `beforeDelete`, `afterDelete` |
| `previousValues` | riga (opzionale) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing" \| "copy"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `error` | `unknown` | `afterSaveError` |
| `operation`, `query` | tipo di lettura, la query del chiamante | `beforeQuery` |
| `context` | `RebaseCallContext` | Tutti gli hook |

`context.user` contiene l'utente autenticato (`uid`, `roles`, ecc.). Una richiesta senza token, dove l'API ne consente l'accesso, trasmette l'identità anonima `{ uid: "anonymous", roles: ["anon"] }` invece di `undefined`.

`context.credential` indica la chiave API con cui è stata effettuata una scrittura: `{ kind, id, name }`, dove `kind` è `"personal"` o `"service"`. Una chiave personale agisce come il suo proprietario, quindi `context.user` è il proprietario sia se ha salvato manualmente sia se un job CI ha scritto con la sua chiave; `context.credential` distingue i due casi. È impostato sulle API dati, sul socket realtime e su `/mcp`, ed è assente per una sessione, per la chiave di servizio, per le operazioni nel contesto del server (`rebase.dataAsAdmin`, cron) e nel browser. Non contiene mai il segreto.

`table` è sempre presente. Un hook globale viene eseguito per ogni tabella, quindi è l'unico
livello registrato indipendentemente da ciascuna di esse, ma non riceve comunque mai
una tabella inesistente. Una richiesta che specifica un percorso che il server non riesce a risolvere viene
rifiutata con `404 NOT_FOUND` prima dell'esecuzione di qualsiasi livello, che è comunque la stessa risposta che i
percorsi di lettura e scrittura forniscono per un percorso del genere. L'alternativa — saltare il
livello per tali percorsi — renderebbe `afterRead` una fase di oscuramento con
un'eccezione silente, pertanto non è prevista.

---

## Pipeline di esecuzione

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

## Semantica bloccante vs. asincrona

**Ogni hook nell'elenco seguente viene atteso tramite await, e tutti tranne
`afterSaveError` vengono eseguiti all'interno della transazione che esegue la scrittura.** Non esiste
un livello "fire and forget": la riga e tutto ciò che i suoi hook hanno eseguito vengono
confermati (commit) insieme oppure per nulla.

- **`beforeSave`, `beforeDelete`** — se l'hook genera un'eccezione (throw), l'operazione viene rifiutata con un HTTP 400 contenente il tuo messaggio e il codice `CALLBACK_REJECTED`, e la scrittura sul database non avviene mai. Genera un `RebaseApiError` da `@rebasepro/types` per scegliere autonomamente lo stato — consulta gli [Hook di tabella](/docs/collections/callbacks#beforesave). Un `beforeDelete` che *restituisce* `false` rappresenta lo stesso rifiuto ma senza messaggio, e risponde con **403** con quel codice.
- **`afterRead`** — la riga restituita (o trasformata) è ciò che il chiamante riceve, e solo il chiamante: in una scrittura modella la risposta, mentre `afterSave`, `beforeDelete`, `afterDelete` e la cronologia ricevono la riga così com'è memorizzata — un valore mascherato non viene mai registrato o ripristinato nella colonna. La sua transazione è `READ ONLY` — vedi [sotto](#afterread-non-può-scrivere).
- **`afterSave`, `afterDelete`** — vengono eseguiti *prima* del commit, attesi con await. Un'eccezione qui esegue il rollback della riga e risponde con lo stesso **400 `CALLBACK_REJECTED`**, con `details.stage` che indica il nome dell'hook. Mantengono la transazione aperta durante la loro esecuzione, quindi un hook lento trattiene un blocco (lock).
- **`afterSaveError`** — viene eseguito quando il salvataggio non è andato a buon fine, in fase di uscita. In una richiesta viene eseguito dopo il rollback della transazione della scrittura fallita, con un `context` le cui chiamate costituiscono ciascuna una transazione a sé stante, in modo tale che un job accodato per segnalare l'errore venga mantenuto. Un'eventuale eccezione generata al suo interno viene registrata nei log; il chiamante riceve l'errore originario del salvataggio.

:::caution[Questa pagina in precedenza indicava il contrario]
Le versioni precedenti affermavano che `afterSave` e `afterDelete` "vengono eseguiti dopo il commit della transazione"
e "non bloccano la risposta HTTP". Non hanno mai fatto nessuna delle due cose. Il codice
scritto basandosi su tale affermazione — ad esempio una chiamata a un webhook in `afterSave` — ha
mantenuto aperta una transazione di database per l'intera durata di un round trip HTTP,
eseguendo il rollback della riga ogni volta che l'endpoint remoto non era raggiungibile.
:::

### Quando viene eseguito `afterSaveError`

Segnala un salvataggio fallito **a livello di database o successivamente** — dall'istruzione
INSERT o UPDATE in poi. Un salvataggio rifiutato prima di quel momento non ha mai raggiunto
il database, quindi l'hook non ne viene informato.

| Viene eseguito | Non viene eseguito |
|---|---|
| Il database rifiuta l'istruzione: una violazione di chiave univoca o esterna, un vincolo CHECK o un trigger, una policy di sicurezza a livello di riga (`WRITE_DENIED`) | Un rifiuto in `beforeSave` — l'hook che ha rifiutato è quello a conoscenza dell'evento |
| `afterRead` o `afterSave` genera un'eccezione (il chiamante riceve `CALLBACK_REJECTED`) | Una richiesta rifiutata prima del driver: validazione (`VALIDATION_*`), un campo che il chiamante non può scrivere, un permesso mancante |
| Impossibile registrare la voce nella cronologia | Una riga a cui il chiamante non può fare riferimento (`404`), un contrassegno tenant che non può impostare |
| | Il commit viene rifiutato dopo che il salvataggio è ritornato: `TRANSACTION_ABORTED` (un'istruzione fallita intercettata da un hook), o un vincolo differito verificato al `COMMIT` |
| | Un'eliminazione — non esiste una controparte per la cancellazione |

In una scrittura massiva (bulk) o `_batch` viene eseguito per la riga che ha fallito; le righe precedenti
subiscono il rollback con il batch e non vengono segnalate.

### Effetti collaterali che non devono trattenere la transazione

Tutto ciò che è lento, o tutto ciò che non può essere annullato se la transazione effettua il rollback,
non appartiene al corpo dell'hook:

| Obiettivo | Fai invece questo |
|---|---|
| Chiamare una terza parte, inviare email, generare un file | [Accoda un job](/docs/backend/jobs). Un job accodato in una transazione che subisce il rollback è come se non fosse mai stato accodato — ed è esattamente il comportamento desiderato. |
| Notificare ad altri processi che è successo qualcosa | Pubblica su un [canale realtime](/docs/backend/realtime) dopo il ritorno della scrittura, non dall'interno dell'hook. |
| Operare in una [funzione personalizzata](/docs/backend/custom-functions) per cui il chiamante non deve attendere | `waitUntil(c, promise)` da `@rebasepro/server/functions` — viene eseguito dopo la risposta, e l'host ne attende il completamento prima di arrestarsi. |

La regola empirica: se l'operazione deve comunque essere eseguita anche quando la scrittura viene annullata,
allora non fa parte della scrittura e non deve andare nell'hook.

### `afterRead` non può scrivere

Una lettura limitata alla richiesta apre la sua transazione in modalità `READ ONLY`, così come il refetch di una
sottoscrizione realtime. `afterRead` viene eseguito al suo
interno, quindi **nessuna scrittura proveniente da tale hook può avere successo** — né una create
con `context.data`, né un update, né una nascosta in una funzione helper che esso chiama. Postgres rifiuta
l'istruzione con SQLSTATE `25006`, e il chiamante riceve:

```json
{ "error": { "message": "An `afterRead` hook tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Si tratta di un 409, non di un 500: è il tuo codice che viene rifiutato, non un guasto del server.
La modalità di sola lettura è intenzionale — una lettura che scrive silenziosamente è una lettura il cui
costo, i lock e la superficie RLS non sono stati preventivati.

Pertanto **l'auditing delle letture non appartiene ad `afterRead`**. Registra invece la lettura all'esterno della
richiesta — da un job in background alimentato da qualunque evento già emesso, o
da una funzione personalizzata che esegue la lettura *e* la scrittura con due chiamate distinte:

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

L'auditing sul lato scrittura non presenta questo problema: `afterSave` e `afterDelete` vengono eseguiti in una
transazione di lettura-scrittura, e la riga di audit viene confermata (commit) insieme alla modifica registrata.

---

## Esempi

### Mascheramento PII

Oscura gli indirizzi email per i chiamanti non amministratori su ogni tabella:

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

### Audit logging globale

Registra ogni eliminazione, su ogni tabella, in una tabella `audit_log`. Poiché
`afterDelete` viene eseguito nella transazione stessa dell'eliminazione, la riga di audit e la
cancellazione subiscono il commit insieme — non esiste alcun intervallo in cui una possa esistere senza
l'altra:

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

Nota i vantaggi e gli svantaggi di questo approccio: se la riga di audit non può essere scritta, non
viene eseguita nemmeno l'eliminazione. Per una traccia di audit, questo è solitamente ciò che si desidera.
Se non è così, intercetta l'errore nell'hook e indicalo in un commento.

### Logica specifica per tabella

Gli hook globali si attivano per tutte le tabelle. Per limitare la logica a una singola tabella, controlla `table.slug` o `path`:

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

Per gli hook che si applicano a una sola tabella, è preferibile utilizzare invece [gli hook specifici della tabella](/docs/collections/callbacks).

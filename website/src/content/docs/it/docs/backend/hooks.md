---
sourceHash: 97a20df64eaeffc7
title: Hook di backend globali
sidebar_label: Hook globali
description: Applica callback di ciclo di vita trasversali a ogni collection a livello server utilizzando CollectionCallbacks.
---

## Panoramica

Rebase fornisce due livelli di callback per il ciclo di vita delle entità — entrambi utilizzano lo stesso tipo `CollectionCallbacks` di `@rebasepro/types`:

- **[Callback per collection](/docs/collections/callbacks)**: definiti nelle configurazioni delle singole collection. Vengono eseguiti solo per quella specifica collection.
- **Callback globali**: definiti su `initializeRebaseBackend({ callbacks })`. Vengono eseguiti su **ogni** collection, su qualsiasi percorso dati (API REST, WebSocket / realtime, `rebase.dataAsAdmin` lato server).

Usa i callback globali per:
- **Row scoping** — <span class="since-badge" data-since="0.22">Dalla 0.22</span> `beforeQuery` su ogni collection, in modo che le letture di un tenant vengano limitate in un unico punto anziché per ciascuna collection. Solo per Postgres: affiancato a una sorgente dati MongoDB o Firestore, un `beforeQuery` globale rifiuta l'avvio anziché lasciare le letture di quella sorgente non limitate. Vedi [`beforeQuery`](/docs/collections/callbacks#beforequery).
- **Mascheramento PII** — oscura i campi sensibili per i chiamanti non amministratori in tutte le collection.
- **Audit logging unificato** — registra ogni creazione, aggiornamento o eliminazione in un unico punto.
- **Validazione trasversale** — applica invarianti che interessano più collection.

:::note
**Ordine di esecuzione**: callback globali → callback di collection → callback delle proprietà.
:::

---

## Configurazione

:::note[Dove va posizionato]
**Runtime gestito** — `export const callbacks = { … }` da `config/index.ts`. Il runtime legge tale export all'avvio; non occorre modificare altro.

**Ejected** — la chiave `callbacks` su `initializeRebaseBackend({ … })`.

La mappa completa è disponibile in [Panoramica backend](/docs/backend/#where-each-option-lives).
:::

Passa la chiave `callbacks` a `initializeRebaseBackend`:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ row, context }) {
            // Runs after every entity read, across all collections
            return row;
        },
        beforeSave({ values, context }) {
            // Runs before every entity save
            return values;
        }
    }
});
```

---

## Tipo `CollectionCallbacks`

```typescript
type CollectionCallbacks = {
    beforeQuery?(props): QueryNarrowing | void;     // Conditions to AND into a read before it is compiled
    afterRead?(props):   Record<string, unknown>;  // Transform row before returning to caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

<span class="since-badge" data-since="0.22">Dalla 0.22</span> `beforeQuery` restringe una lettura prima che venga compilata; vedi
[`beforeQuery`](/docs/collections/callbacks#beforequery).

Tutti i callback possono restituire una `Promise` (asincroni) o un valore diretto (sincroni).

---

## Proprietà dei callback

Ogni callback riceve un singolo oggetto props. Campi comuni:

| Campo | Tipo | Presente in |
|-------|------|-------------|
| `collection` | `CollectionConfig` | Tutti i callback |
| `path` | `string` | Tutti i callback |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (opzionale), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (opzionale) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Tutti i callback |

`context.user` contiene l'utente autenticato (`uid`, `roles`, ecc.), oppure è `undefined` per le richieste pubbliche.

`collection` è sempre presente. Un callback globale scatta per ogni collection, quindi
è l'unico livello registrato indipendentemente da ciascuna di esse — ma non
riceve mai una collection mancante. Una richiesta che specifica un percorso che il
registro delle collection non può risolvere viene rifiutata con `404 NOT_FOUND` prima dell'esecuzione di qualsiasi livello,
che è la stessa risposta che i percorsi di lettura e scrittura darebbero comunque a tale percorso.
L'alternativa — saltare il livello per questi percorsi — renderebbe `afterRead` un
passaggio di redazione con un'eccezione silenziosa, pertanto non è prevista.

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
 │ 3. Global Callback: beforeSave     ─┐                       │
 │ 4. Collection Callback: beforeSave ─┘ awaited               │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Global Callback: afterSave      ─┐                       │
 │ 7. Collection Callback: afterSave  ─┘ awaited               │
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

**Ogni callback nell'elenco seguente viene atteso con await, e tutti vengono eseguiti all'interno della
transazione che esegue la scrittura.** Non esiste un livello "fire and forget": la
riga e tutto ciò che i suoi callback hanno fatto eseguono il commit insieme oppure non lo eseguono affatto.

- **`beforeSave`, `beforeDelete`** — se il callback lancia un errore, l'operazione viene rifiutata con un HTTP 400 contenente il tuo messaggio e il codice `CALLBACK_REJECTED`, e la scrittura sul database non viene mai eseguita. Lancia un `RebaseApiError` da `@rebasepro/types` per scegliere autonomamente lo stato — vedi [Callback di entità](/docs/collections/callbacks#beforesave). Un `beforeDelete` che *restituisce* `false` equivale allo stesso rifiuto senza messaggio, e risponde con **403** e tale codice.
- **`afterRead`** — la riga restituita (o la riga trasformata) è ciò che riceve il chiamante. La sua transazione è `READ ONLY` — vedi [sotto](#afterread-cannot-write).
- **`afterSave`, `afterDelete`** — vengono eseguiti *prima* del commit, attesi con await. Un errore lanciato qui annulla la riga con un rollback e risponde con lo stesso **400 `CALLBACK_REJECTED`**, con `details.stage` che indica l'hook. Mantengono aperta la transazione durante la loro esecuzione, quindi un callback lento equivale a un lock trattenuto.
- **`afterSaveError`** — viene eseguito quando il salvataggio è fallito, durante la fase di uscita.

:::caution[Questa pagina in precedenza indicava il contrario]
Le versioni precedenti affermavano che `afterSave` e `afterDelete` "vengono eseguiti dopo il commit della transazione"
e "non bloccano la risposta HTTP". Non hanno mai fatto nessuna delle due cose. Il codice
scritto in base a tale indicazione — ad esempio una chiamata webhook in `afterSave` — ha
tenuto aperta una transazione di database per l'intera durata di un round trip HTTP,
eseguendo il rollback della riga ogni volta che l'endpoint remoto era irraggiungibile.
:::

### Effetti collaterali che non devono trattenere la transazione

Qualsiasi operazione lenta, o qualsiasi operazione che non possa essere annullata in caso di rollback della transazione,
non deve risiedere nel corpo del callback:

| Obiettivo | Fai invece questo |
|---|---|
| Chiamare una terza parte, inviare email, generare un file | [Accoda un job](/docs/backend/jobs). Un job accodato in una transazione su cui viene eseguito il rollback non è mai stato accodato — che è esattamente il comportamento desiderato. |
| Comunicare ad altri processi che è successo qualcosa | Pubblica su un [canale realtime](/docs/backend/realtime) dopo che la scrittura ha restituito un valore, non dall'interno dell'hook. |
| Operare in una [funzione personalizzata](/docs/backend/custom-functions) senza che il chiamante debba attendere | `waitUntil(c, promise)` da `@rebasepro/server/functions` — viene eseguito dopo la risposta, e l'host ne attende il completamento prima di arrestarsi. |

La regola empirica: se il lavoro deve comunque essere eseguito anche quando la scrittura viene annullata,
non fa parte della scrittura, e quindi non va inserito nell'hook.

### `afterRead` non può scrivere

Una lettura nell'ambito di una richiesta apre la propria transazione in modalità `READ ONLY`. `afterRead` viene eseguito al suo
interno, pertanto **nessuna scrittura proveniente da tale callback può andare a buon fine** — né una create
con `context.data`, né un aggiornamento, né una scrittura inclusa in una funzione helper richiamata. Postgres rifiuta
l'istruzione con SQLSTATE `25006`, e al chiamante viene risposto:

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Si tratta di un 409, non di un 500: è il tuo codice a venire rifiutato, non il server a fallire.
La modalità di sola lettura è intenzionale — una lettura che scrive silenziosamente è una lettura i cui
costi, lock e superficie RLS non sono stati preventivati da nessuno.

Di conseguenza, **l'auditing delle letture non appartiene ad `afterRead`**. Registra la lettura all'esterno della
richiesta — da un job in background alimentato da ciò che già emetti, oppure
da una funzione personalizzata che esegue la lettura *e* la scrittura con due
chiamate distinte:

```typescript no-verify
// ✗ Fails with READ_ONLY_TRANSACTION on every read.
callbacks: {
    afterRead: async ({ path, row, context }) => {
        await context.data.read_log.create({ path, uid: context.user?.uid });
        return row;
    }
}
```

```typescript no-verify
// ✓ The read and the audit row are two operations, and only the second writes.
import { rebase } from "@rebasepro/server";

export default defineFunction("read-article", (app) => {
    app.get("/:id", async (c) => {
        const article = await c.var.driver.fetchOne({ path: "articles", id: c.req.param("id") });
        await rebase.dataAsAdmin.read_log.create({ path: "articles", uid: c.var.user?.uid });
        return c.json(article);
    });
});
```

L'auditing lato scrittura non presenta questo problema: `afterSave` e `afterDelete` vengono eseguiti in una
transazione di lettura-scrittura, e la riga di audit esegue il commit insieme alla modifica che registra.

---

## Esempi

### Mascheramento PII

Oscura gli indirizzi email per i chiamanti non amministratori in tutte le collection:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ row, context }) {
            const isAdmin = context.user?.roles?.includes("admin");
            if (!isAdmin && row.email) {
                return { ...row, email: "********" };
            }
            return row;
        }
    }
});
```

### Audit logging globale

Registra ogni eliminazione, in ogni collection, in una tabella `audit_log`. Poiché
`afterDelete` viene eseguito nella transazione stessa dell'eliminazione, la riga di audit e
l'eliminazione eseguono il commit insieme — non esiste una finestra temporale in cui una esista senza
l'altra:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        async afterDelete({ collection, id, row, context }) {
            if (collection.slug === "audit_log") return;   // don't audit the audit
            await context.data.audit_log.create({
                action: "delete",
                collection: collection.slug,
                entity_id: String(id),
                actor: context.user?.uid ?? "anonymous",
                snapshot: row
            });
        }
    }
});
```

Nota i pro e i contro di questo approccio: se la riga di audit non può essere scritta, non avviene nemmeno
l'eliminazione. Per un audit trail questo è solitamente ciò che si desidera.
In caso contrario, intercetta l'errore nel callback e indicalo in un commento.

### Logica specifica per collection

I callback globali si attivano per tutte le collection. Per limitare la logica a una singola collection, controlla `collection.slug` o `path`:

```typescript
callbacks: {
    beforeSave({ collection, values, context }) {
        if (collection.slug === "orders") {
            if (!values.total || values.total <= 0) {
                throw new Error("Order total must be positive");
            }
        }
        return values;
    }
}
```

Per i callback che devono essere applicati a una sola collection, preferisci invece i [callback per collection](/docs/collections/callbacks).

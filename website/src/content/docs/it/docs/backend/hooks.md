---
sourceHash: e7b16241ef98f0de
title: Hook Globali di Backend
sidebar_label: Hook Globali
description: Applica callback del ciclo di vita trasversali a ogni collection a livello di server usando CollectionCallbacks.
---

## Panoramica

Rebase fornisce due livelli di callback del ciclo di vita delle entità — entrambi utilizzano lo stesso tipo `CollectionCallbacks` da `@rebasepro/types`:

- **[Callback per-collection](/docs/collections/callbacks)**: Definiti sulle configurazioni delle singole collection. Vengono eseguiti solo per quella specifica collection.
- **Callback globali**: Definiti su `initializeRebaseBackend({ callbacks })`. Vengono eseguiti su **ogni** collection, su qualsiasi percorso dati (API REST, WebSocket / realtime, `rebase.dataAsAdmin` lato server).

Usa i callback globali per:
- **Mascheramento PII** — oscurare campi sensibili per i chiamanti non amministratori su tutte le collection.
- **Audit logging unificato** — registrare ogni creazione, modifica o eliminazione in un unico punto.
- **Validazione trasversale** — applicare invarianti che coinvolgono più collection.

:::note
**Ordine di esecuzione**: callback globali → callback di collection → callback di proprietà.
:::

---

## Configurazione

:::note[Dove va posizionato]
**Runtime gestito** — `export const callbacks = { … }` da `config/index.ts`. Il runtime legge quell'esportazione all'avvio; non serve modificare altro.

**Ejected** — la chiave `callbacks` su `initializeRebaseBackend({ … })`.

La mappatura completa si trova in [Panoramica Backend](/docs/backend/#where-each-option-lives).
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

## Il Tipo `CollectionCallbacks`

```typescript
type CollectionCallbacks = {
    afterRead?(props):   Record<string, unknown>;  // Transform row before returning to caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

Tutti i callback possono restituire una `Promise` (asincroni) o un valore diretto (sincroni).

---

## Proprietà dei Callback (Callback Props)

Ciascun callback riceve un singolo oggetto di proprietà. Campi comuni:

| Campo | Tipo | Presente in |
|-------|------|------------|
| `collection` | `CollectionConfig` | Tutti i callback |
| `path` | `string` | Tutti i callback |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (opzionale), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (opzionale) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Tutti i callback |

`context.user` contiene l'utente autenticato (`uid`, `roles`, ecc.), oppure è `undefined` per le richieste pubbliche.

`collection` è sempre presente. Un callback globale viene eseguito per ogni collection, quindi
è l'unico livello registrato indipendentemente da ciascuna di esse — ma non gli viene
mai passata una collection mancante. Una richiesta che specifica un path che il registro
delle collection non riesce a risolvere viene rifiutata con `404 NOT_FOUND` prima dell'esecuzione di qualsiasi livello,
la stessa risposta che i percorsi di lettura e scrittura darebbero comunque a un tale path.
L'alternativa — saltare il livello per quei path — trasformerebbe `afterRead` in un
passaggio di redazione con un'eccezione silenziosa, motivo per cui non è prevista.

---

## Pipeline di Esecuzione

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

## Semantica Bloccante vs. Asincrona

**Ogni callback nell'elenco seguente viene atteso tramite `await`, e tutti vengono eseguiti all'interno
della transazione che gestisce la scrittura.** Non esiste un livello "fire and forget": la
riga e tutto ciò che i suoi callback hanno eseguito eseguono il commit insieme o non lo eseguono affatto.

- **`beforeSave`, `beforeDelete`** — se il callback lancia un errore, l'operazione viene rifiutata con un HTTP 400 contenente il tuo messaggio e il codice `CALLBACK_REJECTED`, e la scrittura nel database non avviene mai. Lancia un `RebaseApiError` da `@rebasepro/types` per scegliere autonomamente lo status — vedi [Callback di Entità](/docs/collections/callbacks#beforesave). Un `beforeDelete` che *restituisce* `false` rappresenta lo stesso rifiuto senza messaggio, e risponde con **403** e tale codice.
- **`afterRead`** — la riga restituita (o la riga trasformata) è ciò che riceve il chiamante. La sua transazione è `READ ONLY` — vedi [sotto](#afterread-cannot-write).
- **`afterSave`, `afterDelete`** — vengono eseguiti *prima* del commit, attesi con `await`. Un errore lanciato qui esegue il rollback della riga e risponde con lo stesso **400 `CALLBACK_REJECTED`**, con `details.stage` che specifica il nome dell'hook. Tengono aperta la transazione durante la loro esecuzione, quindi un'operazione lenta comporta un lock mantenuto.
- **`afterSaveError`** — viene eseguito quando il salvataggio è fallito, in fase di uscita.

:::caution[Questa pagina in precedenza riportava il contrario]
Le versioni precedenti indicavano che `afterSave` e `afterDelete` "vengono eseguiti dopo il commit della
transazione" e "non bloccano la risposta HTTP". Non hanno mai fatto nessuna delle due cose. Il codice
scritto basandosi su tale affermazione — ad esempio, una chiamata webhook in `afterSave` — ha
mantenuto aperta una transazione di database per la durata di un round-trip HTTP,
eseguendo il rollback della riga ogni volta che l'endpoint remoto non era raggiungibile.
:::

### Effetti collaterali che non devono bloccare la transazione

Qualsiasi operazione lenta, o qualsiasi azione che non può essere annullata in caso di rollback della transazione,
non deve risiedere nel corpo del callback:

| Obiettivo | Fai questo invece |
|---|---|
| Chiamare una terza parte, inviare email, generare un file | [Accoda un job](/docs/backend/jobs). Un job accodato all'interno di una transazione che subisce un rollback non è mai stato accodato — ed è esattamente il comportamento desiderato. |
| Notificare ad altri processi che qualcosa è accaduto | Pubblica su un [canale realtime](/docs/backend/realtime) dopo il completamento della scrittura, non dall'interno dell'hook. |
| Operazioni in una [funzione personalizzata](/docs/backend/custom-functions) che il chiamante non deve attendere | `waitUntil(c, promise)` da `@rebasepro/server/functions` — viene eseguito dopo la risposta, e l'host ne attende il completamento prima di arrestarsi. |

La regola generale: se l'operazione deve comunque avere luogo anche quando la scrittura viene annullata,
non fa parte della scrittura, quindi non va inserita nell'hook.

### `afterRead` non può effettuare scritture

Una lettura con scope di richiesta apre la propria transazione in modalità `READ ONLY`. `afterRead` viene eseguito al suo
interno, quindi **nessuna scrittura da tale callback può andare a buon fine** — né una creazione
con `context.data`, né un aggiornamento, né una scrittura nascosta in un helper da esso chiamato. Postgres rifiuta
l'istruzione con SQLSTATE `25006`, e al chiamante viene risposto:

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Si tratta di un errore 409, non di un 500: è il tuo codice che viene rifiutato, non un malfunzionamento del server.
La modalità di sola lettura è intenzionale — una lettura che scrive silenziosamente è una lettura i cui
costi, lock e superficie RLS non sono stati preventivati.

Di conseguenza, **l'auditing delle letture non appartiene ad `afterRead`**. Registra la lettura al di fuori della
richiesta — tramite un background job alimentato da qualsiasi evento già emesso, o
da una funzione personalizzata che esegue sia la lettura *che* la scrittura con due chiamate
separate:

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
transazione di lettura-scrittura, e la riga di audit esegue il commit contestualmente alla modifica che registra.

---

## Esempi

### Mascheramento PII

Oscura gli indirizzi email per i chiamanti non amministratori in ogni collection:

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

### Audit Logging Globale

Registra ogni eliminazione, in qualsiasi collection, in una tabella `audit_log`. Poiché
`afterDelete` viene eseguito nella transazione dell'eliminazione stessa, la riga di audit e la
cancellazione eseguono il commit insieme — non esiste un intervallo in cui una esista senza
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

Nota cosa comporta e cosa costa: se la riga di audit non può essere scritta, anche l'eliminazione
non viene eseguita. Per un audit trail, di solito è ciò che si desidera.
In caso contrario, intercetta l'errore nel callback e indicalo in un commento.

### Logica Specifica per Collection

I callback globali vengono eseguiti per tutte le collection. Per limitare la logica a una singola collection, verifica `collection.slug` o `path`:

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

Per i callback che si applicano solo a una singola collection, è preferibile utilizzare i [callback per-collection](/docs/collections/callbacks).

---

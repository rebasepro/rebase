---
sourceHash: a289b69be61220df
title: Soft delete
sidebar_label: Soft delete
description: "softDelete su una tabella trasforma l'eliminazione in un timestamp, nasconde le righe contrassegnate da ogni lettura e le ripristina con un normale aggiornamento."
---

## Cosa cambia

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Con `softDelete` abilitato, un'eliminazione **appone un timestamp su una colonna invece di rimuovere la riga**, e ogni lettura esclude le righe contrassegnate. Nient'altro dell'operazione cambia: è richiesta la stessa autorizzazione, `beforeDelete` può ancora porre il veto e `afterDelete` viene comunque eseguito. Dal punto di vista del chiamante la riga è stata eliminata; il modo in cui la tabella registra l'operazione riguarda esclusivamente questo flag.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        reference: col.text().notNull(),
        deletedAt: col.timestamp({ withTimezone: true }),
    },
    softDelete: true,
    rls: "admin-only",
});
```

`true` utilizza la colonna `deletedAt` (in SQL `deleted_at`). La forma ad oggetto ne specifica un'altra: `softDelete: { field: "archivedAt" }`. Il campo viene verificato rispetto alle colonne della tabella tramite i tipi.

:::caution[Spetta a te dichiarare la colonna]
Il flag definisce il *significato* di una colonna; non ne aggiunge una. Una tabella che attiva `softDelete` senza dichiarare tale colonna, o con una colonna che non è di tipo `timestamptz`, `date` o `time`, viene rifiutata durante la compilazione dello schema — prima ancora che qualcuno tenti di rimuovere una riga.
:::

## Cosa vede una lettura

Le righe contrassegnate sono nascoste per impostazione predefinita da `find`, `findById`, `count`, dalle aggregazioni, dal refetch in tempo reale e quando questa tabella viene caricata tramite una relazione. Questo comportamento predefinito è il punto chiave: il codice scritto prima dell'esistenza del flag continua a funzionare e nessuno deve ricordarsi di applicare un filtro.

Due parametri di query consentono di visualizzarle:

| Parametro | Restituisce |
|-----------|---------|
| `?deleted=include` | Righe attive **e** contrassegnate |
| `?deleted=only` | Solo le righe contrassegnate — la vista cestino |

Qualsiasi altro valore restituisce un errore 400 anziché un fallback silenzioso. Se `?deleted=true` nascondesse silenziosamente ogni riga eliminata, sembrerebbe funzionare ma risponderebbe alla domanda opposta.

## Ripristinare ed eliminare definitivamente

Un **ripristino** è un normale aggiornamento che reimposta il campo su `null`. Non esiste un verbo speciale, perché non esiste uno stato speciale — la riga non è mai andata via. Tramite REST è una `PATCH` — singola, `/bulk` o `_batch` — il cui corpo imposta il campo su `null`:

```bash
curl -X PATCH /api/data/invoices/7 -d '{"deletedAt": null}'
```

Questo aggiornamento è l'unico che può raggiungere una riga contrassegnata. Qualsiasi altra modifica a essa restituisce `404`, così come fa la riga per ogni lettura predefinita; occorre prima ripristinarla.

Il contrario non è un aggiornamento. L'impostazione del campo su un valore viene rifiutata con `400` `FIELD_NOT_WRITABLE` — elimina invece la riga — in modo che il permesso di `delete`, `beforeDelete` e `afterDelete` le si applichino sempre. Un upsert può creare una riga già contrassegnata, ma non ne contrassegna mai una già memorizzata.

Inoltre, un upsert non scrive in una riga presente nel cestino: quando la sua chiave appartiene a una riga contrassegnata, l'operazione viene rifiutata con `409` `ROW_IN_TRASH` e non viene scritto nulla. Ripristina prima la riga, oppure eliminala definitivamente con `?hard=true` ed esegui nuovamente l'upsert.

Un'eliminazione tramite un percorso molti-a-molti, come `DELETE /api/data/posts/1/tags/5`, rimuove il collegamento del post 1 al tag. Non esegue il soft delete del tag, che altri post continuano a utilizzare.

Una **vera** `DELETE` corrisponde a `?hard=true` nella chiamata di eliminazione. Richiede esattamente la stessa autorizzazione di un'eliminazione ordinaria: si tratta dello stesso verbo, e limitarlo separatamente creerebbe una seconda superficie di controllo degli accessi per una sola operazione. Ciò che cambia è se la riga possa o meno essere recuperata. Solo il valore letterale `true` o `1` indica un'affermazione; un errore di battitura restituisce un 400, perché un chiamante che ha chiesto un'eliminazione definitiva e ha ottenuto un soft delete crederebbe che i dati siano stati cancellati.

## Dall'SDK

Il client tipizzato accede al cestino tramite `trash` su ciascuna tabella. Invia le richieste sopra indicate: `?deleted=only` sulle letture, l'aggiornamento a `null` per il ripristino e `?hard=true` per l'eliminazione definitiva.

```typescript
const trashed = await client.data.invoices.trash.find({ limit: 20 });
const howMany = await client.data.invoices.trash.count();

await client.data.invoices.trash.restore(7);       // PATCH { deletedAt: null }
await client.data.invoices.trash.restoreMany([8, 9]);

await client.data.invoices.trash.purge(7);         // DELETE ?hard=true
await client.data.invoices.trash.purgeMany([8, 9]);
```

`trash.find` e `trash.count` accettano gli stessi parametri di `find` e `count`. Un ripristino imposta `deletedAt` a meno che non si specifichi il campo: una tabella dichiarata con `softDelete: { field: "archivedAt" }` si ripristina con `trash.restore(7, { field: "archivedAt" })`. Il client non può leggere il nome del campo dal server.

Usa `trash` su una tabella che dichiara `softDelete`. Su una tabella che non lo dichiara, il server ignora `?deleted=`, quindi `trash.find` restituisce le righe attive e `trash.purge` equivale a un'eliminazione ordinaria.

Il codice lato server dispone dello stesso `trash`: `context.data.invoices.trash` in un hook e `rebase.data.invoices.trash` in una funzione o in un cron job. Esegue letture ed eliminazioni definitive tramite il driver, con i privilegi del chiamante, esattamente come il resto di [`context.data`](/docs/collections/context-data-api).

Con la modalità [offline](/docs/sdk/offline) abilitata, il cestino non viene mai memorizzato nella cache e nulla al suo interno viene accodato. Ciascuna chiamata richiede il server e fallisce con l'errore `OFFLINE` se questo non è disponibile. Una riga ripristinata si aggiunge al database locale, mentre una eliminata definitivamente ne viene rimossa.

## Prossimi passi

- **[Tabelle](/docs/schema/)** — dove viene dichiarato `softDelete`
- **[API REST](/docs/backend/api)** — gli endpoint di eliminazione e interrogazione a cui appartengono questi parametri
- **[Sicurezza a livello di riga](/docs/collections/security-rules/)** — chi ha i permessi per eliminare una riga

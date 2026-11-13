---
sourceHash: 37c268f3d4b76c7f
title: Cronologia entità
sidebar_label: Cronologia entità
description: "Traccia ogni modifica apportata alle tue entità con un audit trail completo: chi ha modificato cosa, quando e l'entità completa prima e dopo."
---

## Panoramica

La cronologia delle entità registra uno snapshot dei valori dell'entità a ogni operazione di creazione, aggiornamento ed eliminazione. In questo modo si ottiene un audit trail completo con i relativi diff.

## Abilitare la cronologia

:::note[Dove va inserito]
**Runtime gestito** — attivo per impostazione predefinita. `REBASE_HISTORY=false` nel file `.env` lo disattiva.

**Ejected** — `history: true` in `initializeRebaseBackend({ … })`. La forma a oggetto qui sotto — `{ retention }` — è disponibile solo in modalità ejected; la variabile d'ambiente è un booleano.

La mappa completa si trova in [Panoramica del backend](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Dove va inserito]
**Runtime gestito:** `REBASE_HISTORY` (`true` per impostazione predefinita; impostare su `false` per disattivarlo). Le impostazioni di retention non hanno una controparte come variabile d'ambiente: è necessario eseguire l'eject per modificarle.
**Ejected:** `initializeRebaseBackend({ history })` in `backend/src/index.ts`.
:::

Abilita la cronologia in `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Oppure con un periodo di retention personalizzato:

```typescript
history: {
    retention: 30        // Days. Entries older than this are pruned (default: 90)
}
```

### Per tabella

<span class="since-badge" data-since="0.31">Da 0.31</span>

Indica quali tabelle devono tracciare la cronologia con `history: true`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["open", "paid", "shipped"]).notNull().default("open"),
        total:  col.numeric({ precision: 10, scale: 2 }).notNull(),
    },
    history: true,
    rls: "admin-only",
});
```

Una vista non può tracciare la cronologia: non viene mai scritta.

## Come funziona

1. Il backend crea automaticamente una tabella `rebase.entity_history`.
2. A ogni creazione, aggiornamento o eliminazione (create, update, delete), viene registrata una voce contenente:
   - L'ID dell'entità e lo slug della tabella (in `table_name`)
   - I valori dell'entità successivi alla modifica (`values`; per una delete, l'entità
     che è stata eliminata)
   - In caso di update, ciò che contenevano i campi modificati prima di esso (`previous_values`)
   - Timestamp e ID utente
   - L'azione (`create`, `update`, `delete`)
   - Un array di `changed_fields` che mostra quali colonne sono state modificate

I valori corrispondono alla riga così come viene fornita dall'API REST: le sue colonne, le date come
timestamp, una relazione `belongsTo` come chiave esterna. Questo è ciò che un ripristino (revert) riscrive.

Una voce non contiene mai i valori di una riga correlata. La lettura della cronologia di una riga richiede
solo l'accesso in lettura a quella riga, non alle righe a cui fa riferimento; di conseguenza, un `belongsTo`
viene conservato come chiave esterna e nulla più.

Le voci registrate dalle versioni precedenti attraverso la vista della riga del pannello di amministrazione
(un'eliminazione era solita memorizzarla in questo modo) vengono fornite e ripristinate come la riga che
rappresentano: un wrapper `{ "__type": "date", "value" }` come valore, un riferimento
`{ "__type": "relation" }` di una relazione di appartenenza (owning relation) come chiave esterna con il nome
stesso della chiave, il riferimento a qualsiasi altra relazione come chiave della riga correlata, e una riga
correlata incorporata dal riferimento non viene mai fornita. Il ripristino di tale voce scrive questi valori
semplici; un elenco to-many contenuto al suo interno non viene scritto e viene indicato in
`dropped_fields`.

Su una tabella con [soft delete](/docs/collections/soft-delete/), un'eliminazione viene
registrata come `delete` e un ripristino (l'aggiornamento che reimposta il campo di soft delete
su `null`) come `update`. La cronologia di una riga rimane leggibile mentre la riga si trova
nel cestino, e ripristinarla a una versione precedente all'eliminazione la ripristina.

### Cosa contiene `previous_values`

Una voce di update
conserva, in `previous_values`, soltanto i campi elencati in `changed_fields`. Tutti gli altri
campi avevano lo stesso valore prima e dopo la modifica, quindi sono già presenti in
`values`; salvare l'intera riga due volte costava 1.269 byte per la modifica di un singolo
campo su una riga di 20 campi, mentre ora ne costa 794.

Le voci registrate prima della versione 0.25 conservano l'intera riga precedente. Il campo `format`
della voce specifica il formato utilizzato:

| `format` | `previous_values` in un update |
|---|---|
| `1` (voci antecedenti alla 0.25) | L'intera riga prima della modifica |
| `2` | Solo i `changed_fields`, ciascuno con il valore presente nell'intera riga |

La vista della cronologia dell'admin e un'operazione di revert le interpretano entrambe allo stesso modo: la
vista mostra il valore precedente di ogni campo modificato e il revert scrive i `values` della voce scelta,
che sono completi in entrambi i formati. Per ricostruire la riga così com'era prima di una modifica con
`format: 2`, prendi `values` e ripristina ciascun campo presente in `previous_values`.

### Tracciamento dei diff e uguaglianza strutturale profonda

Per evitare di registrare log ridondanti in cui i campi vengono salvati ma nessun valore cambia, `HistoryService` esegue un confronto di uguaglianza strutturale profonda (structural deep equality) sulle chiavi di primo livello dei vecchi e dei nuovi valori:
- Ignora i campi dei metadati di sistema che iniziano con `__`.
- Se vengono rilevate differenze, i nomi dei campi modificati vengono salvati nella colonna `changed_fields` (`text[]`).
- Se il controllo di uguaglianza profonda rileva zero modifiche, l'inserimento nella cronologia viene completamente ignorato.

### Pruning

La retention viene applicata in due punti:
- **Dopo ogni scrittura**, per l'entità scritta: subito dopo che è stata salvata o
  eliminata, il server rimuove le voci di quell'entità oltre le 200 più recenti o
  più vecchie del periodo di retention. Questa operazione non blocca la scrittura.
- **Una volta all'ora**,
  per ogni entità: le voci più vecchie del periodo di retention vengono eliminate
  indipendentemente dall'entità a cui appartengono, comprese le entità che non vengono mai
  più riscritte, come quelle eliminate. Consulta [Meccanismi del ciclo di vita del pruning](#meccanismi-del-ciclo-di-vita-del-pruning).

## Endpoint REST

```
GET /api/data/:slug/:entityId/history
```

Restituisce un elenco di voci della cronologia per un'entità specifica, ordinate a partire dalla più recente. <span class="since-badge" data-since="0.31">Da 0.31</span> Le voci registrate da un'unica transazione — una create e l'update successivo in un unico `_batch`, un revert e il relativo revert — vengono restituite nell'ordine in cui sono state scritte: il timestamp `updated_at` di ciascuna voce è successivo a quello della voce precedente della riga. Un database esistente riceve questo comportamento al successivo avvio di provisioning, o con un'esecuzione di `REBASE_PROVISION_ONLY=true`, che sostituisce la funzione `rebase.record_history`; una distribuzione che non esegue mai il provisioning mantiene il vecchio ordinamento fino a quel momento. Le voci registrate prima di allora mantengono il loro ordine.

```json
{
    "data": [
        {
            "id": "5b0e7c2e-…",
            "table_name": "orders",
            "entity_id": "123",
            "action": "update",
            "changed_fields": ["status"],
            "values": { "status": "shipped", "total": 99.99 },
            "previous_values": { "status": "pending" },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z",
            "format": 2
        }
    ],
    "meta": { "total": 1, "limit": 20, "offset": 0, "hasMore": false }
}
```

### Le voci vengono fornite come letture

<span class="since-badge" data-since="0.31">Da 0.31</span>

Le voci della cronologia vengono fornite esattamente come la riga: prima l'accesso ai campi,
poi `afterRead` (globale, di tabella, di colonna), all'interno della transazione in sola lettura
del chiamante. Una colonna mascherata da un hook o da un `.transform({ afterRead })` risulta
mascherata in `values` e in `previous_values`; una colonna che i ruoli del chiamante non possono
leggere viene trattenuta ed esclusa da `changed_fields`; le chiavi delle colonne che la tabella
non possiede più vengono omesse. Chiunque sia autorizzato a leggere la riga adesso può visualizzarne
la cronologia, e `updated_by` viene mantenuto. Un hook che genera un'eccezione su un vecchio snapshot
fa fallire la richiesta anziché fornirla non mascherata, e la cronologia di una riga eliminata
in modo permanente (hard delete) risponde con 404 ("No row with id '…' in table '…'").

Il driver Postgres implementa questo comportamento; un driver personalizzato serve la cronologia implementando
`DataDriver.serveStoredRows(path, rows)`, e in sua assenza le route della cronologia
rispondono con 501. Prima della versione 0.31, le voci venivano restituite così come memorizzate.

```
POST /api/data/:slug/:entityId/history/:historyId/revert
```

Riscrive i `values` della voce nella riga attraverso il normale percorso di salvataggio, quindi il
revert stesso viene registrato come `update`. Restituisce la riga salvata sotto `data`
e `meta.reverted_from`, l'id della voce. Un'operazione di revert non scrive mai una colonna che il
chiamante non è autorizzato a leggere: queste mantengono il loro valore attuale.

Le voci scritte da versioni precedenti possono contenere chiavi per cui la riga non ha una colonna: un
campo calcolato da un `afterRead` (prima della versione 0.24, un salvataggio registrava la riga così come
la mostrava `afterRead`) o una relazione memorizzata come vista del pannello di amministrazione.
Un revert scrive le colonne della riga ed esclude tali chiavi, ripristinando una relazione di
appartenenza come relativa chiave esterna, ed elenca ciò che è stato escluso in
`meta.dropped_fields`. Un valore mascherato da un vecchio `afterRead` (`********`) dispone di
una colonna, pertanto viene riscritto esattamente come era stato registrato.

## Configurazione della retention

| Impostazione | Predefinito | Descrizione |
|---------|---------|-------------|
| `retention` | 90 | Le voci più vecchie di questo numero di giorni vengono eliminate. |

Ciascuna entità conserva inoltre al massimo le sue **200** voci più recenti. Questo limite è fisso
e non dispone di un'impostazione configurabile.

### Meccanismi del ciclo di vita del pruning

Dopo ogni modifica registrata dal server, viene eseguito il pruning dell'entità modificata: le sue
voci più vecchie del periodo di retention vengono rimosse, seguite da qualsiasi elemento oltre le
200 più recenti. Questa operazione viene eseguita in modo asincrono e non blocca la scrittura.

Una scrittura eseguita tramite [`openRebase` o `rebase console`](/docs/backend/scripts/)
registra la voce nella cronologia ma non esegue alcun pruning, poiché uno script non può conoscere la
retention con cui è configurato il server. Il server eseguirà il pruning di quell'entità alla
scrittura successiva su di essa e durante la scansione oraria descritta di seguito.

Una volta all'ora, il
backend elimina inoltre qualsiasi voce più vecchia del periodo di retention per ciascuna
entità. Prima di questo meccanismo, la cronologia di un'entità che non veniva mai più riscritta —
come tutte quelle eliminate — non veniva sottoposta ad alcun pruning. La scansione (sweep):

- viene eseguita su un'istanza della flotta ogni ora, sui processi che gestiscono i
  job pianificati (reclama la propria ora in `rebase.cron_claims`, come fa un'esecuzione cron),
  la prima volta all'avvio del backend;
- elimina in batch da 5.000 voci, una query per batch, fino a quando un batch non restituisce
  meno voci del limite, ignorando le voci occupate da un'altra scansione — in questo modo una prima scansione
  su un consistente arretrato consiste in molte brevi eliminazioni anziché in una sola prolungata;
- legge un indice su `updated_at`, `idx_history_updated_at`. Su un database
  creato prima della 0.25 viene creato in background dopo il primo avvio,
  tramite `CREATE INDEX CONCURRENTLY`, senza bloccare letture o scritture — circa un
  secondo ogni 2 milioni di voci.

Lo stesso avvio rimuove `idx_history_entity` laddove presente: `idx_history_time`
inizia con le stesse colonne e serve ogni lettura gestita dal primo, quindi rallentava solo
ogni modifica registrata. La rimozione attende al massimo un secondo alla volta per ottenere il lock della tabella,
e una tabella bloccata da un'altra operazione per tutta la durata mantiene l'indice fino al successivo avvio.

Il limite di 200 voci per entità viene applicato solo dopo un'operazione di scrittura su tale entità.

## Passaggi successivi

- **[Hook di tabella](/docs/collections/callbacks/)** — Hook del ciclo di vita
- **[Panoramica del backend](/docs/backend)** — Configurazione completa del backend

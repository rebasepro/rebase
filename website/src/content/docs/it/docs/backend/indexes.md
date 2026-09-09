---
sourceHash: 17ca6f6a285eea43
title: Indici
sidebar_label: Indici
description: Dichiara normali indici Postgres su una collection — btree, GIN e BRIN, parziali, compositi, covering e univoci — e perché quelli scritti a mano tendevano a scomparire.
---

Una collection dichiara gli indici necessari alle sue query nello stesso file delle
proprietà che coprono:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const posts: PostgresCollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Blog posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string", enum: { draft: "Draft", published: "Published" } },
        publish_date: { name: "Publish date", type: "date" }
    },
    indexes: [
        {
            on: ["status", { prop: "publish_date", direction: "desc" }],
            reason: "admin list: filter by status, newest first"
        }
    ]
};
```

Solo per Postgres. Su un altro engine la chiave viene rifiutata all'avvio invece di
essere ignorata silenziosamente.

## Perché esiste

Il generatore DDL ha sempre emesso istruzioni di indice esattamente per due cose,
ed entrambe sono strutture appartenenti a una *funzionalità* anziché a query scritte da te: l'indice
GIN dietro a un [blocco `search`](/docs/backend/search) e l'indice ANN dietro a
una [proprietà `vector`](/docs/sdk/aggregates-and-search#the-index). Il caso comune — il btree
dietro a una clausola `where` — non aveva alcuno spazio di dichiarazione.

Quindi l'unico modo per averne uno era scriverlo a mano. E:

:::caution[Se hai indici scritti a mano su una tabella gestita da Rebase]
`rebase db push` è dichiarativo. Un indice su una tabella gestita che risultava assente
da `schema.sql` veniva considerato drift, e Atlas pianificava per esso un `DROP INDEX` —
che non si trova nell'elenco delle istruzioni distruttive, quindi l'applicazione approvata
automaticamente lo eseguiva senza chiedere. Ogni indice scritto a mano su una tabella
gestita viveva con i giorni contati.

Questo problema è risolto dalla regola di ownership riportata di seguito: un indice non creato
da Rebase viene ora escluso dal diff per nome e mai toccato. Dichiarare gli indici
scritti a mano rimane comunque lo stato finale migliore — un indice dichiarato viene creato su un
database pulito e su ogni tenant, mentre uno scritto a mano no — ma nel frattempo nulla
li eliminerà.
:::

## La struttura

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `on` | `(string \| IndexKey)[]` | **Obbligatorio.** Le colonne chiave, in ordine. Da 1 a 5 voci. |
| `reason` | `string` | **Obbligatorio.** Il motivo per cui questo indice esiste, in una sola riga. |
| `using` | `"btree" \| "gin" \| "brin"` | Metodo di accesso. Predefinito a `btree`. |
| `where` | `IndexPredicate` | Rende l'indice parziale — copre solo le righe che soddisfano questa condizione. |
| `unique` | `boolean` | Solo btree. Una garanzia di univocità composita. |
| `include` | `string[]` | Solo btree. Colonne payload incluse per scansioni index-only. |

### `on` accetta chiavi di proprietà, mai nomi di colonna

Questo è il punto in cui è facile sbagliare. Una relazione `belongsTo` viene compilata nella sua
`localKey` risolta, quindi la proprietà `author` corrisponde alla colonna `author_id`:

```typescript
// Correct — `author` is the relation property.
{ on: ["author"], reason: "an author's posts, and the ON DELETE cascade" }
```

Scrivere `author_id` qui funzionerebbe per la maggior parte delle proprietà e non
indicizzerebbe silenziosamente nulla per una chiave esterna, che è proprio quella a cui si
ricorre più spesso. Postgres non indicizza automaticamente le colonne delle chiavi esterne —
senza questo indice, sia "elenca i post di questo autore" che la cascata di `ON DELETE`
eseguono sequential scan.

Una relazione `hasMany` o molti-a-molti non ha alcuna colonna su questa tabella e
viene rifiutata, rimandando alla collection che possiede effettivamente la chiave esterna.

### L'ordine è importante, e solo un sottoinsieme iniziale è utilizzabile

Postgres può utilizzare un sottoinsieme iniziale delle colonne chiave, perciò
`["ownerId", "createdAt"]` serve una query che filtra su `ownerId`, una
che filtra su entrambi, e **mai** una che filtra unicamente su `createdAt`.

`direction` e `nulls` sono utili solo quando l'`ORDER BY` di una query
mescola le direzioni. Un indice solo `DESC` è ridondante rispetto al suo equivalente `ASC` —
Postgres scansiona un btree all'indietro con la stessa velocità — quindi un singolo indice
serve sia il filtro *che* l'ordinamento nell'esempio in cima a questa pagina.

```typescript
{ on: [{ prop: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }
```

Specificare esplicitamente il default di Postgres non costa nulla: il nome derivato calcola l'hash
dell'ordine *effettivo*, quindi aggiungere `direction: "asc"` a una colonna che era già
ascendente non costituisce una ridefinizione e non ricostruisce nulla.

Il limite massimo è di cinque chiavi. Postgres ne consente trentadue; oltre le quattro,
le colonne finali sono un peso morto a ogni operazione di scrittura, e la dichiarazione è di solito
il tentativo di rendere una query più veloce per semplice accumulo. Le colonne di payload che non
vengono cercate appartengono a `include`, che non viene conteggiato ai fini del limite.

### `where` è strutturato, non SQL

```typescript
{
    on: ["publish_date"],
    where: { prop: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date"
}
```

L'indice conterrà quindi solo le righe pubblicate, rimanendo leggero man mano che le bozze si accumulano.

Gli operatori sono `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` e
`is not null`, combinati con `and`:

```typescript
{
    on: ["assignee"],
    where: {
        and: [
            { prop: "status", op: "in", value: ["open", "in_progress"] },
            { prop: "archived_at", op: "is null" }
        ]
    },
    reason: "the open-work queue, which is a fraction of the table"
}
```

L'operatore `or` è deliberatamente assente. Un predicato OR significa quasi sempre che l'indice
non dovrebbe affatto essere parziale; se ne hai realmente bisogno, dichiara due indici distinti.

Un predicato è una struttura anziché una stringa perché una stringa non potrebbe essere
verificata rispetto alle proprietà della collection, non potrebbe essere sottoposta a fingerprint senza
inserire il proprio testo nel nome dell'indice — quindi una riformattazione rinominerebbe
un indice in produzione — e sarebbe l'unico punto in cui un chiamante cercherebbe di usare una
classe operatore di un'estensione che il planner non può riprodurre.

### `unique` è solo per indici compositi

L'univocità su singola colonna si gestisce tramite `validation.unique` sulla proprietà, e
dichiararla anche qui viene rifiutato anziché accettato come sinonimo.
`validation.unique` viene compilato in un vincolo `UNIQUE` inline il cui indice sottostante
viene denominato da Postgres — non da Rebase — come `<table>_<column>_key`.

```typescript
{ on: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }
```

### `include` consente un index-only scan

Le colonne payload risiedono nelle pagine foglia: non sono ricercabili, non sono ordinate e
consentono di risparmiare un recupero dall'heap (heap fetch) al costo di un indice più pesante. Non possono sovrapporsi a quelle di `on`.

```typescript
{ on: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }
```

### `using`

`btree` (il valore predefinito) gestisce uguaglianza, intervalli, `ORDER BY` e univocità.

`gin` serve per il contenimento su una proprietà `array` o su una `map` JSONB. `brin` è pensato per
una colonna con ordinamento naturale su una tabella append-only — minuscolo e inutile nel momento in cui
le righe iniziano ad arrivare fuori ordine. Nessuno dei due supporta un ordinamento, per cui `direction` e
`nulls` non sono rappresentabili su di essi, anziché essere rifiutati in un secondo momento da Postgres.

`gist` e `hash` non sono supportati: ogni classe operatore gist interessante risiede in
un'estensione, e gli indici hash non possono essere univoci, compositi né ordinati. Questa
restrizione è ciò che mantiene l'intero modello conforme al percorso di Atlas — `rebase db push`
materializza lo stato desiderato in un database temporaneo vuoto (scratch database) rispetto al quale pianificare le modifiche, e
`CREATE EXTENSION` non può essere inserito in quel file. **La ricerca con trigrammi è gestita da
[`search:`](/docs/backend/search); ANN è una
[proprietà `vector`](/docs/sdk/aggregates-and-search#the-index).** Un indice che richiede
`gin_trgm_ops` o `vector_cosine_ops` viene rifiutato in fase di build anziché
emesso per poi fallire successivamente su un database sconosciuto.

### `reason` è obbligatorio

È l'unico campo obbligatorio a non avere un corrispettivo in SQL.

Un indice è l'unica cosa che una configurazione di Rebase può dichiarare che comporta un costo continuo nel tempo
e il cui beneficio è invisibile dalla configurazione stessa. La reason è ciò che viene mostrato
accanto a "0 scans in 34 days, 412 MB", ovvero l'unico momento in cui chiunque si trova
nella posizione di decidere se eliminarlo. Senza di essa nessuno può prendere una decisione, quindi nessuno
lo fa, e la tabella accumula indici per l'intera durata del prodotto.

Deliberatamente **non** fa parte dell'identità dell'indice: riformulare una
giustificazione non ricostruisce mai un indice.

## Come viene nominata una dichiarazione

`<table>_<columns>_ix_<7 hex>`, oppure `_ux_` se univoco. Ad esempio
`posts_status_publish_date_ix_a91c3f4`.

L'hash viene calcolato sulla *semantica* dell'indice — metodo, colonne, ordine, univocità,
colonne incluse, predicato — e non sul suo SQL renderizzato; pertanto, una modifica al modo in cui
Rebase formatta il DDL non rinominerà mai nulla nel tuo database.

L'hash è fondamentale (load-bearing). `CREATE INDEX IF NOT EXISTS` verifica la corrispondenza sul **nome**,
non sulla definizione: con un nome descrittivo fisso, modificare una dichiarazione manterrebbe il
vecchio indice riportando sempre successo. Con l'hash nel nome, una ridefinizione
costituisce un oggetto diverso, che viene quindi creato mentre quello vecchio viene eliminato.

Due conseguenze degne di nota:

- **Modificare una dichiarazione comporta una DROP e una CREATE**, emesse senza fronzoli — senza
  `CONCURRENTLY` e con un intervallo privo di indice nel mezzo. Ciò va bene su un database
  di sviluppo; su una tabella di produzione di grandi dimensioni, applica la modifica in una finestra temporale opportuna.
- Il nome è [un nome derivato congelato](/docs/architecture/schema-as-code). È presente
  in `contracts/derived-names.txt` e non può cambiare tra una release e l'altra.

## Di chi è la proprietà di un indice

`_ix_`/`_ux_` seguito da sette caratteri esadecimali non può entrare in conflitto con nessun altro generatore di nomi qui utilizzato — `_fkey`,
`_gin`, `_trgm`, `_pkey`, `_key`, le distanze vettoriali, il prefisso `idx_` di auth. Di
conseguenza, il solo nome determina l'ownership:

| L'indice | Nel piano? | Nominato da Rebase? | Cosa succede |
|---|---|---|---|
| dichiarato | sì | sì | creato, poi mantenuto |
| dichiarazione eliminata | no | sì | **eliminato (dropped)**, come previsto |
| scritto a mano, o da introspezione | no | no | **escluso — mai toccato** |

In nessuno dei due casi è richiesta una conferma interattiva. Eliminare una dichiarazione *dovrebbe* rimuovere l'indice
in silenzio; ciò che non deve mai essere eliminato è un indice che Rebase non ha creato. È anche
questo che rende sicuro il round trip di introspezione: gli indici esistenti di un database
verso cui hai puntato Rebase rimangono esterni finché qualcuno non li dichiara.

## Quando vengono creati

Entrambi i produttori li emettono, il che è importante perché non tutti i deployment
eseguono `db push`:

- **`rebase db push` / `rebase db generate`** li inseriscono in `schema.sql`, seguendo il
  normale flusso di Atlas — ottenendo così migrazioni, rilevamento del drift e rollback
  come qualsiasi altro oggetto.
- **`rebase schema generate`** li scrive anche in `schema.generated.ts`, in modo che
  lo schema di Drizzle descriva la stessa tabella presente nel database. Le colonne `INCLUDE`
  di un covering index sono l'unica eccezione: Drizzle non può esprimerle,
  e la riga generata include un commento che lo specifica e rimanda a
  `schema.sql`, che invece le supporta.
- **L'operazione di verifica dello schema all'avvio (boot-time schema ensure)** li crea con
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, alle stesse condizioni degli
  indici ANN adiacenti. Un tenant di un managed runtime viene provisionato all'avvio e non esegue mai
  `db push`; senza questo meccanismo si avvierebbe senza nessuno dei suoi indici dichiarati e
  nulla lo segnalerebbe.

## Cosa viene rifiutato, e quando

Ognuno di questi casi genera un errore in fase di build, indicando la collection e la posizione
nell'array — un indice che silenziosamente non esiste è proprio l'anomalia che questa funzionalità
si propone di eliminare:

- una proprietà che non appartiene alla collection, oppure una relazione la cui foreign key
  si trova sull'altra tabella
- più di cinque chiavi in `on`, oppure la stessa colonna ripetuta due volte
- esattamente le colonne della chiave primaria — `<table>_pkey` le indicizza già
- una colonna presente sia in `on` che in `include`
- `unique` su una singola colonna la cui proprietà dichiara già `validation.unique`
- `direction` o `nulls` con `gin` o `brin`
- un elenco `in` contenente valori duplicati
- due dichiarazioni che generano lo stesso nome — rappresentano lo stesso indice, due volte
- un `reason` vuoto o mancante

## Correlati

- [Search](/docs/backend/search) — ricerca full-text con ranking, che crea il proprio
  indice GIN su un `tsvector` generato
- [Vector search](/docs/sdk/aggregates-and-search#vector-search) — l'indice ANN su una
  colonna embedding, configurato sulla proprietà
- [Schema as code](/docs/architecture/schema-as-code) — come le dichiarazioni raggiungono
  il database e cos'è un nome derivato

---

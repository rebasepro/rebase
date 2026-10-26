---
sourceHash: 0c021da7af2a852e
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

Scrivere `author_id` qui viene rifiutato in fase di build: è una colonna, non una
proprietà della collection, e `on` nomina proprietà. Postgres non indicizza automaticamente le colonne delle chiavi esterne —
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
- **L'operazione di verifica dello schema all'avvio (boot-time schema ensure)** li crea
  anch'essa, alle stesse condizioni degli indici di ricerca e ANN adiacenti. Un tenant di un
  managed runtime viene provisionato all'avvio e non esegue mai
  `db push`; senza questo meccanismo si avvierebbe senza nessuno dei suoi indici dichiarati e
  nulla lo segnalerebbe. Una tabella che l'avvio crea riceve i suoi indici insieme alla
  tabella. Su una tabella già esistente, l'avvio costruisce un indice mancante dopo che il
  server è già in servizio, in background, come fa con gli
  [indici delle chiavi esterne](#cosa-fa-laggiornamento-a-un-database-esistente).
  Usa `CREATE INDEX CONCURRENTLY` su una connessione propria, così lo
  `statement_timeout` di 30 s del pool non può annullare una build lunga. Un indice che
  una build interrotta ha lasciato `INVALID` con il suo nome viene eliminato e ricostruito.
  `IF NOT EXISTS` confronta il nome, quindi non ne ripara mai uno. Un indice `unique`
  viene costruito allo stesso modo ma prima che il server entri in servizio, e l'avvio
  fallisce se non può essere costruito. Servire senza di esso lascerebbe entrare righe duplicate.

## Le chiavi esterne sono indicizzate per te

Postgres crea
l'indice a cui una chiave esterna *punta* — la chiave primaria della destinazione — e
mai uno sulla colonna che la *contiene*. Ogni lettura dall'altro lato di un collegamento
filtra su quella colonna: un include `hasMany` o `hasOne`, un elenco annidato come
`/authors/5/posts` (la sua pagina e il suo conteggio), il lato inverso di un
`manyToMany`, e il controllo `ON DELETE` quando una riga genitore viene eliminata. Senza
un indice, ognuna di queste letture scorre ogni riga della tabella figlia.

Per questo Rebase deriva un semplice btree per:

- il `localKey` di ogni [`belongsTo`](/docs/collections/relations#belongsto--the-key-is-on-this-table)
  — che è anche la colonna letta da `hasOne` / `hasMany` sul lato opposto;
- la colonna di destinazione di ogni tabella di giunzione `manyToMany`. La chiave primaria
  `(source, target)` della giunzione serve già le ricerche per la colonna di origine;
  il lato inverso del collegamento ha bisogno di questo. Una giunzione è una tabella di
  Rebase, quindi questo indice non ha alcuna possibilità di esclusione.

Misurato su Postgres 18 con cache calda, 1M commenti su 50k post:

| La lettura | Senza l'indice | Con l'indice |
|---|---|---|
| `include=comments` su una pagina di 25 post (`post_id IN (…)`) | 38 ms | 0,3 ms |
| `GET /posts/77/comments?limit=25` — la pagina | 28 ms | 0,3 ms |
| …e il suo `count(*)` | 29 ms | 0,2 ms |
| eliminare un post (controllo `ON DELETE SET NULL`) | 129 ms | 1,7 ms |

Nulla viene indicizzato due volte. L'indice derivato viene saltato quando la colonna
guida già la chiave primaria, ha un `UNIQUE` (`validation.unique` sulla relazione
o sulla proprietà che possiede la colonna), oppure guida un indice in `indexes:` —
semplice o composto, purché sia un btree senza `where`. Un indice parziale
non può servire una ricerca che deve raggiungere ogni riga, e un indice GIN o BRIN
risponde a una domanda diversa, quindi nessuno dei due conta.

Il nome è quello che deriva [una dichiarazione](#come-viene-nominata-una-dichiarazione) di un indice
semplice su quella colonna — `posts_author_id_ix_00ad191` — quindi l'indice derivato e
`indexes: [{ on: ["author"], … }]` sono un solo oggetto, non due. È un
[nome derivato congelato](/docs/architecture/schema-as-code) come ogni altro.

Per mantenere il vincolo ed eliminare l'indice — una tabella con così tante scritture che
l'indice costa più delle ricerche che serve, o una in cui tieni un indice
tuo al di fuori di `indexes:` — dillo sulla relazione:

```typescript
author: {
    name: "Author",
    type: "relation",
    relation: { kind: "belongsTo", target: () => authors, index: false }
}
```

`index` è accettato solo su un `belongsTo`; sugli altri tipi il validatore della
configurazione lo rifiuta, perché la loro chiave esterna è una colonna sulla destinazione
(imposta `index` sul `belongsTo` della destinazione) o in una giunzione.

Rebase legge solo le tue collection per decidere questo, mai il database: `db
push` e l'avvio devono arrivare allo stesso insieme di indici con gli stessi nomi, altrimenti
il push successivo eliminerebbe ciò che l'avvio ha costruito. Un indice che hai scritto a mano
sulla stessa colonna, al di fuori di `indexes:`, quindi non viene visto — dichiaralo in
`indexes:`, oppure imposta `index: false`, per mantenere un solo indice invece di due.

### Cosa fa l'aggiornamento a un database esistente

<span class="since-badge" data-since="0.26">Da 0.26</span>

Gli indici sono oggetti nuovi su tabelle che contengono già dati, e le due porte li
costruiscono in modo diverso:

- **L'avvio non li aspetta.** Su una tabella già esistente, la verifica dello schema
  lascia fuori dall'avvio gli indici di chiave esterna mancanti e li costruisce
  dopo che il server è in servizio, uno alla volta, con
  `CREATE INDEX CONCURRENTLY` su una connessione propria (lo `statement_timeout` di 30 s
  del pool non si applica). Questo non prende alcun lock su cui letture o scritture
  debbano attendere. Una tabella che un'altra sessione tiene occupata — la build di
  un'altra istanza, un `ALTER TABLE` — viene abbandonata entro il budget di lock dell'avvio
  e ritentata all'avvio successivo. Un indice che una build interrotta ha lasciato `INVALID`
  (un deploy che ha sostituito il processo a metà build, due istanze in corsa sullo stesso
  nome) viene eliminato e ricostruito. Ognuno viene registrato nel log all'inizio e alla fine;
  un fallimento è un avviso, mai un avvio fallito. Una tabella che questo avvio crea riceve
  i suoi indici insieme alla tabella, prima che qualcosa possa scriverci. Con
  `REBASE_PROVISION_ONLY` le build vengono eseguite prima che il processo termini, dato
  che nulla dopo di esso le eseguirebbe.
- **`rebase db push` li costruisce prima di pianificare**, con lo stesso costruttore e
  alle stesse condizioni dell'avvio: `CREATE INDEX CONCURRENTLY`, uno alla volta,
  così letture e scritture proseguono mentre viene eseguito (circa 0,4 s con 1M di righe e 6 s
  con 10M come build semplice su un SSD di laptop, `maintenance_work_mem` 64 MB; una
  concorrente impiega di più e non blocca nulla). Atlas trova poi ogni indice
  già presente e non pianifica nulla per esso. Un indice che non è riuscito a costruire
  prima — una tabella che un'altra sessione ha tenuto per tutto il budget di lock — viene
  lasciato ad Atlas, che lo costruisce dentro la transazione del push e quindi blocca le
  scritture su quella tabella per la durata della build; il push dice quale. Una colonna di
  chiave esterna che il push stesso aggiunge riceve il suo indice da Atlas insieme alla
  colonna, prima che contenga qualsiasi cosa. `--dry-run` non costruisce nulla: nomina
  gli indici che un push reale costruirebbe per primi, e il piano che stampa li elenca,
  dato che non esistono ancora.

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

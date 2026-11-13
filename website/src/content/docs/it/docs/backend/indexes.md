---
sourceHash: e086faac3624de8d
title: Indici
sidebar_label: Indici
description: Dichiara i normali indici Postgres su una tabella — btree, GIN e BRIN, parziali, compositi, covering e univoci — e perché quelli scritti a mano tendevano a scomparire.
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una tabella dichiara gli indici di cui le sue query hanno bisogno, accanto alle colonne che coprono:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull(),
        status:      col.enum(["draft", "published"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
    },
    indexes: [
        {
            columns: ["status", { column: "publishDate", direction: "desc" }],
            reason: "admin list: filter by status, newest first",
        },
    ],
    rls: "admin-only",
});
```

## Perché esiste

Il generatore DDL ha sempre emesso istruzioni di creazione degli indici esattamente per due cose,
ed entrambe sono strutture appartenenti a una *funzionalità* piuttosto che a query scritte da te: l'indice
GIN dietro un [blocco `search`](/docs/backend/search), e l'indice ANN dietro
una [colonna `col.vector()`](/docs/sdk/aggregates-and-search#the-index). Il caso base — il btree
dietro una clausola `where` — non aveva affatto una sede di dichiarazione.

Quindi l'unico modo per averne uno era scriverlo a mano. E inoltre:

:::caution[Se hai indici scritti a mano su una tabella gestita da Rebase]
`rebase db push` è dichiarativo. Un indice su una tabella gestita che risultava assente
da `schema.sql` veniva conteggiato come deriva (drift), e Atlas pianificava un `DROP INDEX` per esso —
che non è nella lista delle istruzioni distruttive, quindi l'applicazione approvata automaticamente lo
eseguiva senza chiedere conferma. Ogni indice scritto a mano su una tabella gestita viveva con
il tempo contato.

Questo problema è stato risolto dalla regola di proprietà sottostante: un indice non creato da Rebase ora
è escluso dal diff in base al nome e non viene mai toccato. Dichiarare gli indici scritti a mano
è comunque lo stato finale migliore — un indice dichiarato viene creato su un database pulito
e su ogni tenant, mentre uno scritto a mano no — ma nel frattempo nulla andrà a eliminarli.
:::

## La struttura

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `columns` | `(string \| { column, direction?, nulls? })[]` | **Obbligatorio.** Le colonne chiave, in ordine. Da 1 a 5 elementi. |
| `reason` | `string` | Il motivo per cui questo indice esiste, in una riga. Fortemente raccomandato. |
| `using` | `"btree" \| "gin" \| "brin"` | Metodo di accesso. Predefinito a `btree`. |
| `where` | `IndexPredicate` | Rende l'indice parziale — copre solo le righe che corrispondono a questo predicato. |
| `unique` | `boolean` | Solo btree. Una garanzia di unicità composita. |
| `include` | `string[]` | Solo btree. Colonne di payload trasportate per scansioni index-only. |

### `columns` accetta chiavi di colonna, mai nomi SQL

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il nome di una relazione `belongsTo` rappresenta la sua colonna foreign-key, quindi la relazione
`author` corrisponde alla colonna `author_id`:

```ts
indexes: [
    // `author` is the relation; its key is the column author_id.
    { columns: ["author"], reason: "an author's posts, and the ON DELETE cascade" },
]
```

Scrivere `author_id` qui viene rifiutato: è un nome di colonna SQL, non una chiave della
tabella, e `columns` richiede i nomi delle chiavi. Postgres non
indicizza automaticamente una colonna foreign key — senza questo indice, sia "elenca i post
di questo autore" che la sequenza a catena di `ON DELETE` si traducono in sequential scan.

Una relazione `hasMany` o molti-a-molti non ha alcuna colonna su questa tabella e viene
rifiutata: dichiara l'indice sulla tabella che possiede la foreign key.

### L'ordine è importante e solo un sottoinsieme iniziale è utilizzabile

Postgres può utilizzare un sottoinsieme iniziale delle colonne chiave, perciò
`["ownerId", "createdAt"]` serve una query che filtra su `ownerId`, e una che
filtra su entrambi, ma **mai** una che filtra unicamente su `createdAt`.

`direction` e `nulls` hanno senso solo quando l'`ORDER BY` di una query mescola
direzioni diverse. Un indice con solo `DESC` è ridondante rispetto al suo gemello `ASC` — Postgres
esegue la scansione di un btree all'indietro con la stessa rapidità — quindi un singolo indice soddisfa sia il filtro
*che* l'ordinamento nell'esempio in cima a questa pagina.

```ts
indexes: [{ columns: [{ column: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }]
```

Scrivere esplicitamente il default di Postgres non ha costi: il nome derivato calcola l'hash
sull'ordinamento *effettivo*, quindi aggiungere `direction: "asc"` a una colonna che era già
ascendente non costituisce una ridefinizione e non ricostruisce nulla.

Il limite massimo è di cinque chiavi. Postgres ne ammette trentadue; oltre le quattro, le colonne
finali sono zavorra a ogni scrittura, e la dichiarazione riflette di solito il desiderio che
una query diventi più veloce per accumulo. Le colonne di payload che non vengono ricercate devono andare in
`include`, che non conta ai fini del limite.

### `where` è strutturato, non SQL

```ts
indexes: [{
    columns: ["publishDate"],
    where: { column: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date",
}]
```

L'indice conterrà quindi solo le righe pubblicate, rimanendo di dimensioni ridotte man mano che le bozze si accumulano.

Gli operatori sono `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` e
`is not null`, combinati con `and`:

```ts
indexes: [{
    columns: ["assignee"],
    where: {
        and: [
            { column: "status", op: "in", value: ["open", "in_progress"] },
            { column: "archivedAt", op: "is null" },
        ],
    },
    reason: "the open-work queue, which is a fraction of the table",
}]
```

Non è presente intenzionalmente alcun operatore `or`. Un predicato OR significa quasi sempre che l'indice
non dovrebbe essere affatto parziale; se ne hai realmente bisogno, dichiara due indici distinti.

Un predicato è un oggetto strutturato anziché una stringa perché una stringa non potrebbe essere
validata rispetto alle colonne della tabella, non se ne potrebbe ricavare un'impronta (fingerprint) senza
incorporarne il testo nel nome dell'indice — quindi riformattarla rinominerebbe un
indice in produzione — e sarebbe l'unico punto in cui un chiamante potrebbe richiedere una classe
di operatori di un'estensione che il planner non è in grado di replicare.

### `unique` è solo per indici compositi

L'unicità su singola colonna si ottiene con `.unique()` sulla colonna stessa, e dichiararla anche
qui viene rifiutato invece di essere accettato come sinonimo. `.unique()` compila in un vincolo
`UNIQUE` inline il cui indice di supporto viene denominato da Postgres — non da Rebase — come
`<table>_<column>_key`.

```ts
indexes: [{ columns: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }]
```

### `include` consente un'index-only scan

Le colonne di payload risiedono nelle pagine foglia: non sono ricercabili, non sono ordinate e
risparmiano un fetch sull'heap al prezzo di un indice più pesante. Non possono sovrapporsi a `columns`.

```ts
indexes: [{ columns: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }]
```

### `using`

`btree` (il default) supporta uguaglianza, intervalli (range), `ORDER BY` e unicità.

`gin` serve per il contenimento su una colonna array o su una colonna `jsonb`. `brin` è indicato per una
colonna con ordinamento naturale su una tabella append-only — minuscolo, e inutile nel momento
in cui le righe cominciano ad arrivare fuori ordine. Nessuno dei due ha un ordinamento, per cui `direction` e
`nulls` non sono proprio rappresentabili su di essi, anziché venire rifiutati successivamente da Postgres.

Non ci sono `gist` né `hash`: ogni classe di operatori gist interessante fa parte di
un'estensione, e gli indici hash non possono essere univoci, compositi o ordinati. Questa
restrizione è ciò che mantiene l'intero modello compatibile con Atlas — `rebase db push`
materializza lo stato desiderato in un database di scratch minimale su cui pianificare, e
`CREATE EXTENSION` non può rientrare in quel file. **La ricerca con trigrammi è
[`search:`](/docs/backend/search); l'ANN è una
[colonna `col.vector()`](/docs/sdk/aggregates-and-search#the-index).** Un indice che necessita di
`gin_trgm_ops` o `vector_cosine_ops` viene rifiutato in fase di build anziché
essere generato per poi fallire in seguito su un database mai visto prima.

### `reason`

<span class="since-badge" data-since="0.31">Da 0.31</span>

È l'unico campo che non ha una controparte SQL ed è facoltativo — ma ti raccomandiamo di scriverlo.

Un indice è l'unica cosa che uno schema può dichiarare che ha un costo continuo e perenne
e il cui beneficio non è visibile dalla configurazione. Il motivo indicato è ciò che viene stampato
accanto a "0 scans in 34 days, 412 MB", che è l'unico momento in cui qualcuno si trova nella
posizione di decidere se eliminarlo. Senza di esso nessuno può prendere una decisione, perciò nessuno
lo fa, e la tabella accumula indici per tutta la durata del prodotto.

È intenzionalmente **escluso** dall'identità dell'indice — riformulare la
motivazione non comporta mai la ricostruzione di un indice.

## Come viene denominata una dichiarazione

`<table>_<columns>_ix_<7 hex>`, oppure `_ux_` quando è univoco. Per esempio
`posts_status_publish_date_ix_a91c3f4`.

L'hash è calcolato sulla *semantica* dell'indice — metodo, colonne, ordine, unicità,
colonne incluse, predicato — e non sul relativo codice SQL formattato, pertanto una modifica al modo in cui
Rebase formatta il DDL non rinominerà mai alcunché nel tuo database.

L'hash è fondamentale per il funzionamento. `CREATE INDEX IF NOT EXISTS` opera una corrispondenza sul **nome**,
non sulla definizione: con un nome puramente leggibile, la modifica di una dichiarazione manterrebbe
il vecchio indice riportando comunque successo. Avendo l'hash all'interno del nome, una ridefinizione
diventa un oggetto differente, per cui viene creato il nuovo indice e rimosso quello vecchio.

Due conseguenze che vale la pena sottolineare:

- **Modificare una dichiarazione equivale a una DROP seguita da una CREATE**, eseguite direttamente — senza
  `CONCURRENTLY`, e con una finestra temporale priva di indice nel mezzo. Operazione trascurabile su un database
  di sviluppo; su una tabella grande in produzione, applicala in un momento concordato.
- Il nome è [un nome derivato bloccato (frozen derived name)](/docs/architecture/schema-as-code). Si trova
  in `contracts/derived-names.txt` e non può cambiare da una release all'altra.

## A chi appartiene un indice

La sequenza `_ix_`/`_ux_` seguita da sette caratteri esadecimali non è accessibile a nessun altro generatore di nomi — `_fkey`,
`_gin`, `_trgm`, `_pkey`, `_key`, le distanze vettoriali, il prefisso `idx_` di auth. Di conseguenza,
il nome da solo determina la proprietà:

| L'indice | Nel piano? | Denominato da Rebase? | Cosa succede |
|---|---|---|---|
| dichiarato | sì | sì | creato, poi mantenuto |
| dichiarazione rimossa | no | sì | **eliminato (dropped)**, come previsto |
| scritto a mano, o da introspezione | no | no | **escluso — non viene mai toccato** |

In nessuno dei casi serve una conferma manuale. Rimuovere una dichiarazione *dovrebbe* eliminare l'indice
in modo silenzioso; ciò che non deve mai essere eliminato è ciò che Rebase non ha creato. Questo è anche
ciò che rende sicuro il ciclo di introspezione: gli indici preesistenti di un database
su cui hai puntato Rebase rimangono esterni finché qualcuno non li dichiara.

### Dichiarare un indice già esistente

Quando dichiari un indice che il database possiede già con un altro nome, Rebase
ne assume la gestione anziché crearne un duplicato. Prima di creare un
indice dichiarato mancante, `rebase db push`, `rebase db migrate` e il processo
di boot cercano un indice preesistente sulla stessa tabella che corrisponda ad esso in ogni
sua parte. Se viene trovata una corrispondenza, questa viene rinominata con il nome dichiarato mediante
`ALTER INDEX … RENAME TO …`, operazione che aggiorna il catalogo e non ricostruisce nulla.
Da quel momento in poi diventa l'indice dichiarato: individuato tramite nome, conservato ed eliminato se la
dichiarazione viene rimossa.

Tutte queste parti devono coincidere:

- il metodo di accesso;
- l'unicità;
- le colonne chiave, in ordine, ciascuna con la sua direzione e il posizionamento dei `NULLS`
  (la direzione conta solo per `btree`);
- le colonne `INCLUDE`;
- il predicato. I caratteri di quoting, i cast letterali e le parentesi di Postgres vengono ignorati;
  qualsiasi altra discrepanza impedisce la corrispondenza.

Rebase non tocca un indice preesistente, e compila quello dichiarato al suo fianco,
quando tale indice differisce in una qualsiasi di queste parti. Lo ignora anche quando una
chiave è un'espressione, una chiave usa una classe di operatori o una collation non predefinita, l'indice
è a supporto di un vincolo, l'indice risulta `INVALID`, oppure ha già un
nome Rebase.

`rebase db generate` scrive ciascun indice dichiarato nella migrazione come
`CREATE INDEX IF NOT EXISTS`, in modo tale che l'istruzione abbia successo nel caso in cui `rebase db migrate`
abbia appena rinominato un indice preesistente con quel nome.

## Quando vengono creati

Entrambi i generatori li emettono, aspetto importante dato che non tutti i deployment eseguono
`db push`:

- **`rebase db push` / `rebase db generate`** li inseriscono in `schema.sql`, nel consueto
  flusso di Atlas — beneficiando così di migrazioni, drift detection e rollback
  come qualsiasi altro oggetto.
- **`rebase schema generate`** li scrive anche all'interno di `schema.generated.ts`, in modo che
  lo schema Drizzle descriva la medesima tabella presente nel database. Le colonne `INCLUDE` di un
  indice covering costituiscono l'unica eccezione: Drizzle non è in grado di esprimerle,
  e la riga generata include un commento esplicativo che rimanda a
  `schema.sql`, il quale invece le supporta.
- **L'ensure dello schema al boot** provvede anch'esso a crearli, alle medesime condizioni degli
  indici di ricerca e ANN adiacenti. Un tenant su runtime gestito si predispone
  all'avvio e non esegue mai `db push`; senza questo meccanismo partirebbe senza alcuno dei suoi
  indici dichiarati e nulla lo segnalerebbe. Una tabella creata dal boot riceve i suoi
  indici insieme alla tabella stessa. Su una tabella già esistente, il boot crea l'eventuale
  indice mancante dopo che il server è attivo, in background, nello stesso modo in cui
  crea gli [indici delle foreign-key](#cosa-comporta-un-aggiornamento-su-un-database-esistente).
  Utilizza `CREATE INDEX CONCURRENTLY` su una propria connessione dedicata, cosicché il
  `statement_timeout` di 30 s del pool non possa interrompere una compilazione lunga. Un indice lasciato
  in stato `INVALID` col proprio nome a causa di una compilazione interrotta viene rimosso e ricostruito.
  `IF NOT EXISTS` esegue il confronto sul nome, per cui non effettua mai una riparazione. Un indice
  `unique` viene compilato nello stesso modo ma prima che il server inizi a gestire le richieste, e l'avvio fallisce
  se non è possibile crearlo. Entrare in servizio senza di esso permetterebbe l'inserimento di righe duplicate.

## Le foreign key vengono indicizzate automaticamente

Postgres crea l'indice
verso cui la foreign key *punta* — la chiave primaria della tabella di destinazione — e mai uno sulla
colonna che *la contiene*. Ogni lettura dal lato opposto della relazione filtra su
quella colonna: un include `hasMany` o `hasOne`, una lista nidificata come
`/authors/5/posts` (la relativa pagina e il conteggio), il lato inverso di una
relazione `manyToMany`, e il controllo di `ON DELETE` quando una riga genitore viene rimossa. Senza
un indice, ciascuna di queste operazioni esegue una scansione completa di ogni riga della tabella figlia.

Per questo motivo Rebase ricava un btree standard per:

- il `localKey` di ogni [`belongsTo`](/docs/collections/relations/#belongsto--the-key-is-on-this-table)
  — che è anche la colonna letta dalla controparte `hasOne` / `hasMany`;
- la colonna di destinazione di ogni tabella di giunzione `manyToMany`. La chiave primaria della giunzione
  `(source, target)` gestisce già le ricerche tramite la colonna di origine; il lato inverso
  del collegamento necessita di questa. Essendo la giunzione una tabella gestita da Rebase, per questo caso
  non è prevista disattivazione.

Misurazioni effettuate su Postgres 18 con cache calda, 1M di commenti distribuiti su 50k post:

| La lettura | Senza l'indice | Con l'indice |
|---|---|---|
| `include=comments` su una pagina da 25 post (`post_id IN (…)`) | 38 ms | 0.3 ms |
| `GET /posts/77/comments?limit=25` — la pagina | 28 ms | 0.3 ms |
| …e il relativo `count(*)` | 29 ms | 0.2 ms |
| eliminazione di un post (controllo `ON DELETE SET NULL`) | 129 ms | 1.7 ms |

Nulla viene indicizzato due volte. L'indice derivato viene ignorato se la colonna è già
a capo della chiave primaria, presenta un vincolo `UNIQUE` (`.unique()` su una colonna associata, o
`unique: true` sulla relazione), oppure è la colonna principale di un indice in `indexes:` —
sia esso semplice o composito, purché si tratti di un btree senza clausola `where`. Un indice parziale
non può soddisfare una ricerca che deve coprire ogni riga, e un indice GIN o BRIN
risponde a un tipo di interrogazione differente, quindi nessuno dei due viene preso in considerazione.

Il nome corrisponde a quello generato da [una dichiarazione](#come-viene-denominata-una-dichiarazione) di un indice
semplice su tale colonna — `posts_author_id_ix_00ad191` — quindi l'indice derivato
e `indexes: [{ columns: ["author"], … }]` costituiscono lo stesso oggetto, non due separati. Si tratta di un
[nome derivato bloccato](/docs/architecture/schema-as-code) come tutti gli altri.

Per preservare il vincolo ed eliminare l'indice — nel caso di una tabella così soggetta a scritture
da rendere l'indice più costoso dei vantaggi offerti nelle letture, oppure dove mantieni un indice
personale al di fuori di `indexes:` — specificalo sulla relazione:

```ts
relations: {
    author: rel.belongsTo(() => authors, { index: false }),
}
```

`index` esiste unicamente su `belongsTo`: per le altre tipologie la foreign key è una
colonna sulla tabella di destinazione (imposta `index` sulla relazione `belongsTo` della destinazione) o in una tabella di giunzione.

Rebase esamina solo le tue tabelle per decidere questo aspetto, mai il database: sia `db
push` che il boot devono ottenere il medesimo insieme di indici con gli stessi identici nomi, altrimenti
il push successivo eliminerebbe ciò che il boot ha costruito. Un indice creato manualmente sulla
stessa colonna, al di fuori di `indexes:`, non viene pertanto rilevato — dichiaralo in
`indexes:`, o imposta `index: false`, per mantenere un solo indice invece di due.

### Cosa comporta un aggiornamento su un database esistente

Gli indici sono nuovi oggetti su tabelle che contengono già dati, e i due meccanismi
li costruiscono con modalità differenti:

- **Il boot non attende il loro completamento.** Su una tabella preesistente, la procedura di
  schema ensure esclude dal boot gli indici di foreign-key mancanti e
  li crea una volta che il server è già in esecuzione, uno alla volta, con
  `CREATE INDEX CONCURRENTLY` su una connessione a parte (il valore di 30 s per
  `statement_timeout` del pool non si applica ad essa). Ciò non impone alcun blocco (lock) su cui letture o scritture
  debbano restare in attesa. Una tabella occupata da un'altra sessione — il build di un'altra istanza, un
  `ALTER TABLE` — viene tralasciata non appena esaurito il tempo limite di lock del boot e ritentata
  all'avvio successivo. Un indice lasciato in stato `INVALID` da una build interrotta (un deploy che
  ha rimpiazzato il processo a metà operazione, o due istanze in conflitto sullo stesso nome) viene rimosso
  e ricreato. Ciascuno di essi viene registrato nei log all'inizio e al termine; un eventuale fallimento rappresenta
  un avviso (warning), mai un mancato avvio. Una tabella creata durante questo boot riceve i suoi indici insieme
  alla tabella stessa, prima che qualsiasi operazione possa scrivervi. Con `REBASE_PROVISION_ONLY`, le
  creazioni vengono eseguite prima della terminazione del processo, poiché nessun task successivo le avvierebbe.
- **`rebase db push` li crea prima di elaborare il piano**, con lo stesso meccanismo e
  alle medesime condizioni del boot: `CREATE INDEX CONCURRENTLY`, uno per volta,
  in modo che letture e scritture proseguano durante l'esecuzione (circa 0.4 s per 1M di righe e 6 s per
  10M con una compilazione normale su SSD per laptop, `maintenance_work_mem` a 64 MB; una
  creazione concorrente richiede più tempo ma non blocca nulla). Atlas trova quindi ciascun indice
  già presente e non pianifica alcuna operazione per esso. Un indice che non è stato possibile costruire prima — per
  via di una tabella rimasta occupata da un'altra sessione per l'intera durata del lock — viene delegato ad Atlas,
  che lo costruirà all'interno della transazione del push bloccando di conseguenza le scritture su quella
  tabella per tutta la durata del build; il comando push specificherà di quale indice si tratta. Una colonna foreign-key
  aggiunta direttamente dal push riceve il suo indice da Atlas assieme alla colonna, prima che vi sia
  inserito alcun dato. L'opzione `--dry-run` non compila nulla: elenca i nomi degli indici che un vero push
  costruirebbe per primi, e il piano stampato li mostra, non essendo ancora presenti.

## Cosa viene rifiutato, e quando

<span class="since-badge" data-since="0.31">Da 0.31</span>

Tutti i seguenti casi vengono rifiutati in fase di compilazione dello schema, indicando la tabella e la
posizione nell'array — un indice che silenziosamente non esiste è proprio il problema
che questa funzionalità elimina:

- una chiave che non è una colonna né una relazione `belongsTo` della tabella, o una relazione
  la cui foreign key si trova sull'altra tabella
- più di cinque chiavi in `columns`, o la medesima colonna ripetuta due volte
- esattamente le colonne della chiave primaria — `<table>_pkey` le indicizza già
- una colonna presente sia in `columns` che in `include`
- `unique` su una singola colonna che dichiara già `.unique()`
- `direction` o `nulls` in combinazione con `gin` o `brin`
- una lista `in` che ripete lo stesso valore
- due dichiarazioni che generano il medesimo nome — si tratterebbe del medesimo indice duplicato
- un valore `reason` vuoto

## Risorse correlate

<span class="since-badge" data-since="0.31">Da 0.31</span>

- [Search](/docs/backend/search) — full-text indicizzato con ranking, che costruisce il proprio indice GIN
  su un `tsvector` generato
- [Ricerca vettoriale](/docs/sdk/aggregates-and-search#vector-search) — l'indice ANN su una
  colonna di embedding, configurato su `col.vector()`
- [Schema as code](/docs/architecture/schema-as-code) — come le dichiarazioni raggiungono
  il database, e cos'è un nome derivato
- [Tabelle](/docs/schema/) — tutte le chiavi di `defineTable`

---
sourceHash: 72daf47d8a15bafe
title: Ricerca
sidebar_label: Ricerca
description: Come si comporta .search() per impostazione predefinita e come una tabella può abilitare la ricerca full-text con ranking sulle colonne specificate — inclusi contenuti JSONB e array.
---

`.search("termine")` funziona su ogni tabella senza alcuna configurazione. Il modo in cui
viene compilato dipende dal fatto che la tabella abbia richiesto o meno funzionalità aggiuntive.

## Il comportamento predefinito

Senza alcuna configurazione, `.search()` è una **ricerca per sottostringa senza distinzione tra maiuscole e minuscole (case-insensitive)**,
in `OR` tra le colonne di testo della tabella. La stringa di ricerca
viene suddivisa sugli spazi bianchi e ogni termine deve corrispondere — ma i termini possono corrispondere
a colonne diverse, quindi un nome memorizzato in due colonne viene comunque trovato:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Racchiudi una sequenza tra virgolette doppie — `.search('"ada lovelace"')` — per cercare invece
l'intera frase esatta, allo stesso modo in cui la interpreta il percorso full-text descritto di seguito.

Questo approccio è sufficiente per una tabella di piccole dimensioni con testo memorizzato in colonne semplici. Presenta
tre limitazioni che nessuna impostazione al suo interno può risolvere:

- **Non può guardare all'interno di colonne JSON o array.** Una tabella che conserva
  il proprio contenuto ricercabile in JSONB — tag, certificazioni, un questionario — avrà
  una casella di ricerca che silenziosamente non troverà nulla.
- **Non ha rilevanza.** Le righe vengono restituite nell'ordine specificato da `orderBy`, quindi la corrispondenza
  migliore potrebbe trovarsi a pagina sette.
- **Non può utilizzare un indice.** Un carattere `%` iniziale rende inutilizzabile un B-tree, quindi ogni ricerca si trasforma in
  una scansione sequenziale. Va bene per mille righe; diventa proibitivo con un milione.
  `rebase doctor` segnala le tabelle in cui questo problema comincia a farsi sentire: nessun
  blocco `search` e più di circa 10.000 righe.

La corrispondenza del termine è **letterale**: `%` e `_` sono metacaratteri LIKE e vengono
sottoposti a escape prima che il pattern venga costruito; pertanto, la ricerca di `50%` cerca proprio
`50%` anziché restituire ogni riga. Se desideri usare caratteri jolly, l'operatore di filtro
`like` accetta un pattern (`.where("title", "like", "post-%")`); `.search()` non
lo fa.

Una ricerca con una sola parola compila esattamente nello stesso SQL di sempre.

## Abilitare la ricerca avanzata (Opting in)

<span class="since-badge" data-since="0.31">Da 0.31</span>

Dichiara `search` su una tabella, specificando le colonne che desideri indicizzare:

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const talents = defineTable("talents", {
    columns: {
        id:            col.uuid().primaryKey().defaultRandom(),
        fullName:      col.text().notNull(),
        bio:           col.text(),
        interests:     col.text().array(),
        questionnaire: col.jsonb(json.object({ certifications: json.array(json.string()) }, { additional: true })),
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "fullName", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications",
        ],
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

Nulla viene dedotto automaticamente. Un campo viene cercato se e solo se viene indicato esplicitamente, e un percorso
che non si risolve viene rifiutato durante la compilazione dello schema anziché essere
ignorato silenziosamente — un campo di ricerca che ritieni attivo ma non lo è rappresenta esattamente
il tipo di errore che questo blocco si propone di prevenire. Lo stesso vale per una colonna limitata da `.private()` o
`.access({ read })`: l'indice è condiviso da tutti i chiamanti.

`.search()` compila quindi in una corrispondenza full-text con ranking, e le righe vengono restituite con un punteggio
`_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Cosa viene creato con la dichiarazione

Una colonna `tsvector`, `GENERATED ALWAYS AS … STORED`, e un indice GIN su di essa.
Postgres ricalcola la colonna a ogni scrittura di un campo di origine e rifiuta qualsiasi
tentativo di scriverla direttamente, evitando così disallineamenti tra l'indice e la riga. La colonna
non viene mai restituita dall'API.

Questi elementi vengono generati in `.rebase/sql/search.sql`, accanto a `schema.sql` e
`policies.sql`, e `rebase db push` li applica automaticamente — senza dover eseguire
nulla di aggiuntivo. Hanno un file dedicato perché una colonna `tsvector` generata necessita dell'esistenza
preventiva di una funzione helper `IMMUTABLE` (`unaccent` è solo `STABLE`, e
l'appiattimento di un documento `jsonb` richiede una funzione che restituisce un set di righe), e Atlas — il
motore alla base di `db push` — non supporta la gestione delle funzioni nel proprio piano gratuito.

Una conseguenza importante da tenere presente se rilasci tramite migrazioni anziché tramite push:
l'aggiunta di un blocco `search` da sola non produce alcuna migrazione, poiché lo schema
confrontato da Atlas non risulta modificato. `rebase db generate` lo segnala quando accade.
Il blocco viene comunque applicato da `rebase db push` e dalla verifica dello schema in fase
di avvio; per includerlo esplicitamente in una migrazione, accoda ad essa il file `.rebase/sql/search.sql`,
appena scritto da `rebase db generate`.

### Modificare il blocco in seguito

Una colonna generata porta con sé la propria espressione e Postgres non può modificare tale
espressione sul posto — perciò aggiungere un campo, cambiare un peso, modificare la lingua
o abilitare `unaccent` **non** è un'operazione che `ADD COLUMN IF NOT EXISTS` può
applicare a una colonna già esistente.

Rebase memorizza un'impronta (fingerprint) dell'espressione sulla colonna al momento della creazione
e la confronta a ogni avvio e a ogni `db push`. Una modifica viene esplicitamente rifiutata,
fornendo le due istruzioni necessarie per applicarla — un `DROP COLUMN` e un `ADD COLUMN`,
che riscrivono la tabella e ricostruiscono l'indice GIN. Puoi eseguirle nel momento che
preferisci; nulla riscriverà una tabella in produzione al tuo posto.

Due modifiche fanno eccezione. Abilitare `fuzzy` è un'operazione additiva — comporta una seconda colonna — e
si applica senza richiedere questa procedura. L'impostazione di [`mode`](#mode) modifica la query anziché
la colonna, quindi viene applicata semplicemente tramite un deploy.

L'avvio si blocca con un errore anziché servire le richieste, perché l'alternativa coinciderebbe con la situazione che questo controllo
vuole evitare: una colonna che continua a indicizzare il vecchio insieme di campi e una ricerca che
non restituisce nulla per contenuti chiaramente presenti nella riga.

## Cosa è possibile indicare in `fields`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un percorso inizia con la chiave di una colonna.

| Percorso | Si risolve in | Esempio |
|---|---|---|
| Una colonna di testo | la colonna stessa | `"fullName"` |
| Una colonna `col.text().array()` | ciascun elemento | `"interests"` |
| Una colonna `col.jsonb()` | ogni valore stringa all'interno del documento | `"questionnaire"` |
| Un percorso all'interno di una colonna `col.jsonb()` | ogni valore stringa pari o sottostante a quel punto | `"questionnaire.certifications"` |

Un percorso all'interno di una mappa indicizza i **valori stringa a qualsiasi livello di nidificazione** sottostante — array di
stringhe, oggetti annidati, array di oggetti. Le *chiavi* JSON non vengono mai indicizzate, solo
i valori, evitando così che un nome di campo comune a ogni riga diventi un termine che corrisponde a
tutte le righe.

Specificare un enum, un UUID, una colonna `json` (anziché `jsonb`) o un array di
numeri viene rifiutato con relativa motivazione. Gli enum, in particolare, rappresentano un vocabolario
fisso: applica un filtro su di essi tramite `where`, che è esatto e sfrutta un indice.

## Opzioni

### `language`

La configurazione di ricerca del testo di Postgres, che determina stemming e stopwords.
`"spanish"` esegue lo stemming di `auditores` in `auditor` ed elimina `de`; l'opzione predefinita,
`"simple"`, non applica nessuna delle due cose.

`"simple"` è il valore predefinito perché è l'unica scelta che non genera mai errori — uno
stemmer applicato alla lingua sbagliata altera silenziosamente i lessemi. Impostalo sulla lingua
dei tuoi contenuti per ottenere lo stemming.

### `mode`

Definisce il modo in cui una stringa di ricerca viene confrontata con i campi specificati.

| `mode` | Corrispondenze | Trova `Muñoz` da `munoz` | Trova `sebastian` da `seb` |
|---|---|---|---|
| `"fts"` (predefinito) | lessemi interi, tramite il `tsvector` e il relativo indice GIN | con `unaccent` | no |
| `"hybrid"` | quanto sopra, `OR` una corrispondenza per sottostringa sugli stessi campi | **sempre** | **sì** |

```typescript
search: {
    language: "spanish",
    mode: "hybrid",
    fields: ["fullName", "questionnaire.certifications"]
}
```

La modalità predefinita e l'assenza del blocco presentano lacune speculari, ed è proprio questo
il divario che questa modalità colma. Testata su un'istanza reale di Postgres con cinque righe
(`search-mode-matrix.test.ts` in `@rebasepro/server-postgres`):

| query | senza blocco (ILIKE) | `"fts"` + `unaccent` | `"hybrid"` |
|---|---|---|---|
| `munoz` | `Ana Munoz` | `Ana Munoz`, `Sebastian Muñoz` | `Ana Munoz`, `Sebastian Muñoz` |
| `seb` | entrambi i Sebastian | — | entrambi i Sebastian |
| `audit` | il `Lead Auditor` | — | il `Lead Auditor` |
| `iso 14001` | la riga `ISO 14001` | la riga `ISO 14001` | la riga `ISO 14001` |

`fuzzy` raggiunge le stesse righe, ma solo dopo aver calibrato la soglia minima di somiglianza: con
il valore predefinito di 0.3, `iso 14001` restituisce anche una riga con `ISO 9001`. `"hybrid"` non ha alcuna
soglia da regolare — una sottostringa è presente oppure non lo è.

**Cosa comporta a livello di prestazioni.** La parte basata su sottostringa non può usare l'indice GIN; un carattere `%`
iniziale non può mai farlo. La parte con `@@` viene comunque eseguita per prima e continua a usare l'indice, quindi ciò che
questa modalità aggiunge è una scansione sulle righe scartate dall'indice. Su una tabella di grandi dimensioni questo
fa la differenza tra una scansione dell'indice e una scansione sequenziale, motivo per cui si tratta di
una modalità opzionale e non del comportamento predefinito.

**Modificarlo su una tabella in produzione è sicuro** — è l'unica opzione di questo blocco
a esserlo. `mode` interviene sul lato query: non modifica alcuna colonna generata, nessuna espressione
di generazione e nessun indice, quindi non innesca il blocco descritto in
[Modificare il blocco in seguito](#modificare-il-blocco-in-seguito). L'attivazione richiede
semplicemente un deploy e nient'altro.

Rimuove gli accenti nella componente basata su sottostringa **indipendentemente dal fatto che `unaccent` sia configurato o meno**,
poiché tale normalizzazione avviene anch'essa a livello di query. Questa scelta è intenzionale: `unaccent` è
l'impostazione che non può essere abilitata in seguito senza riscrivere la tabella, quindi una tabella
costretta a farne a meno può comunque evitare di ignorare `Muñoz`. Il vantaggio offerto da `unaccent` rimane
la rimozione degli accenti nella componente `@@`, dove i lessemi sono effettivamente memorizzati.

Aggiunge l'estensione `unaccent` e una funzione helper `IMMUTABLE` al
database, se non già presenti. Entrambe le istruzioni sono
`IF NOT EXISTS` / `CREATE OR REPLACE` e nessuna delle due tocca alcuna tabella.

### `unaccent`

Rimuove gli accenti prima dell'indicizzazione, consentendo a `auditoria` di corrispondere a `auditoría`.

Non si tratta di una questione meramente estetica nelle lingue con accenti. Postgres riduce le due grafie
a **lessemi diversi** — `to_tsvector('spanish', 'auditoría')` genera
`auditor`, mentre `'auditoria'` genera `auditori` — pertanto, in sua assenza, una query digitata
senza accenti ignorerà qualsiasi riga che li contiene, ovvero la stragrande maggioranza delle ricerche
degli utenti.

Richiede l'estensione `unaccent`.

### `fuzzy`

Esegue il matching anche in base alla somiglianza tra trigrammi, consentendo di posizionare nel ranking anche corrispondenze parziali o refusi: `iso14000` troverà
`ISO 14001`, cosa che nessuna procedura di stemming potrebbe fare, trattandosi semplicemente
di lessemi distinti.

```typescript
search: {
    fields: ["fullName", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // predefinito
}
```

Aggiunge una seconda colonna generata e un indice basato su trigrammi, e richiede `pg_trgm`.
Comporta un costo in termini di tempi di scrittura e spazio su disco; risolve la casistica più comune di ricerche infruttuose.

### `weight`

A ciascun campo viene assegnata una delle quattro classi di peso di Postgres, da `A` (massimo)
a `D`. `ts_rank` assegna a una corrispondenza di tipo `A` un punteggio nettamente superiore rispetto a una di tipo `D`, ed è così che un
nome ottiene una rilevanza maggiore rispetto a una citazione marginale all'interno di una lunga descrizione. Il valore predefinito per i campi è `B`.

### `column`

La colonna generata viene denominata `search_vector`. Modificala solo se entra in conflitto
con una colonna già esistente — una volta creata entra a far parte dello schema e
rinominarla successivamente comporterà un drop e una ricreazione, con conseguente riscrittura della tabella.

## Calcolo del ranking

`_score` corrisponde a `ts_rank` calcolato sulla medesima query con cui sono state confrontate le righe, ed è
presente solo nel caso in cui la tabella abbia abilitato la ricerca avanzata *e* la richiesta
abbia incluso una stringa di ricerca.

Con `mode: "hybrid"`, una riga individuata unicamente tramite la corrispondenza per sottostringa riceve un punteggio
costante minimo (0.001) anziché zero — inferiore al più piccolo `ts_rank` producibile da una corrispondenza reale
tra lessemi, così che una parola intera preceda sempre una sottostringa, e le righe trovate solo per sottostringa
ricorrano al criterio di spareggio definito dalla query anziché essere restituite nell'ordine casuale della tabella.

Con `fuzzy` abilitato, la somiglianza dei trigrammi viene **sommata** a tale rank. Non si tratta di un
semplice perfezionamento: è l'elemento che rende `fuzzy` un vero e proprio criterio di ordinamento. Un refuso non trova alcuna corrispondenza
nel percorso esatto, quindi ogni riga individuata avrebbe un `ts_rank` pari a zero; l'ordinamento
basato solo sul rank restituirebbe la corrispondenza migliore nell'ordine casuale della tabella.
I due termini vengono sommati anziché ponderati, quindi una riga che corrisponde esattamente
contribuisce a entrambi e supera una riga semplicemente somigliante, senza bisogno di un coefficiente
dedicato. Al di fuori di queste due condizioni, `orderBy: "_score"` viene considerato un campo sconosciuto e
restituisce un errore 400 anziché restituire in modo silente righe non ordinate.

`_score` non può essere combinato con la paginazione basata su cursore (`startAfter`). La rilevanza viene
calcolata per ciascuna query anziché essere memorizzata, pertanto non è presente alcun valore sulla riga cursore da
confrontare con la pagina successiva, e due richieste con stringhe di ricerca differenti
generano punteggi che non condividono la stessa scala. Utilizza `limit`/`offset` per
le pagine ordinate per rilevanza.

## Perché questa riga corrisponde?

Un elenco ordinato per ranking indica *quali* righe corrispondono, mai il *motivo* per cui si trovino lì. È possibile richiedere a ciascuna riga di
motivare la propria presenza:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` rappresenta il percorso esattamente come dichiarato in `fields`, consentendoti di mapparlo su una
label per la visualizzazione. I campi vengono restituiti nell'ordine in cui sono stati dichiarati.

Il calcolo è per singola query, non per tabella, poiché il costo si riflette sulla singola query: un'istruzione `ts_headline`
per ogni campo dichiarato per ciascuna riga restituita; inoltre, `ts_headline` analizza nuovamente il documento
anziché leggere l'indice. È la scelta ottimale per una pagina di risultati, ma non è adatta per un'esportazione di dati.

**Lo snippet contiene markup per definizione** — ogni corrispondenza è racchiusa in tag
`<mark>`. Puoi renderizzarlo come HTML o rimuovere i tag, ma non trattarlo come testo semplice
e non fidarti del testo circostante: coincide esattamente con quanto digitato dall'utente.
Suddividere la stringa sul tag `<mark>` e renderizzarne le parti risulta più sicuro rispetto all'uso di
`dangerouslySetInnerHTML`.

Con `mode: "hybrid"`, viene riportato anche un campo che corrisponde unicamente per sottostringa — si tratta
infatti del campo che ha generato il risultato. Il relativo snippet viene restituito senza evidenziazioni:
`ts_headline` evidenzia i lessemi, e una porzione di parola non costituisce un lessema.

Con `unaccent` attivo, gli snippet vengono visualizzati con gli accenti normalizzati — `Auditoria`, non
`Auditoría`. L'esecuzione di `ts_headline` sul testo originale non è in grado di rilevare una corrispondenza prodotta da
una query senza accenti, e restituirebbe pertanto il testo privo di qualsiasi evidenziazione; uno snippet leggibile
con evidenziazione è preferibile a uno formalmente più elegante ma privo di evidenziazioni.

## Aggiungere il blocco a una tabella in produzione

La colonna generata viene aggiunta dalla procedura di verifica dello schema all'avvio, come qualsiasi altra
colonna. Il relativo indice viene creato in background, dopo che il server ha iniziato a servire il traffico, mediante
`CREATE INDEX CONCURRENTLY` in modo da non bloccare le operazioni di scrittura (consulta
[Indici](/docs/backend/indexes#when-they-are-created)). Fino al completamento della creazione dell'indice,
la ricerca funziona ma richiede la lettura dell'intera tabella. L'aggiunta di una colonna generata di tipo *stored*
comporta la riscrittura della tabella; pertanto, in presenza di un volume elevato di dati, pianifica l'operazione come faresti per qualsiasi altra
riscrittura.

## Correlati

- [REST API](/docs/backend/api/) — i parametri di query con cui una ricerca giunge al server
- [Indici](/docs/backend/indexes/) — cosa crea il blocco di ricerca e il relativo impatto sulle prestazioni
- [Interrogare i dati](/docs/sdk/querying/) — eseguire ricerche utilizzando l'SDK tipizzato

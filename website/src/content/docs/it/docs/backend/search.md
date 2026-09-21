---
sourceHash: 96b96a778ac5c3a6
title: Ricerca
sidebar_label: Ricerca
description: Come si comporta .search() per impostazione predefinita e come abilitare la ricerca full-text con ranking per una collection Postgres sui campi specificati — inclusi contenuti JSONB e array.
---

`.search("term")` funziona su ogni collection senza alcuna configurazione. Ciò in cui viene compilato dipende dal fatto che la collection abbia richiesto o meno funzionalità aggiuntive.

## Il comportamento predefinito

Senza alcuna configurazione, `.search()` esegue una **corrispondenza di sottostringa senza distinzione tra maiuscole e minuscole (case-insensitive)**, combinata con `OR` tra le proprietà `string` di primo livello della collection. La stringa di ricerca viene suddivisa sugli spazi bianchi e ogni termine deve corrispondere — ma i termini possono corrispondere a proprietà diverse, quindi un nome memorizzato in due colonne viene comunque trovato:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Racchiudi una sequenza tra virgolette doppie — `.search('"ada lovelace"')` — per cercare la frase esatta, allo stesso modo in cui la interpreta il percorso full-text descritto di seguito.

Questo approccio è sufficiente per una collection di piccole dimensioni con il testo memorizzato in colonne standard. Presenta tuttavia tre limitazioni che nessuna impostazione interna può risolvere:

- **Non può esaminare le proprietà `map` o `array`.** Una collection che conserva i propri contenuti ricercabili in JSONB — tag, certificazioni, un questionario — ha una casella di ricerca che non restituisce nulla senza segnalare errori.
- **Non ha un concetto di rilevanza.** Le righe vengono restituite secondo l'ordinamento specificato in `orderBy`, quindi la corrispondenza migliore potrebbe trovarsi a pagina sette.
- **Non può utilizzare un indice.** Un carattere `%` iniziale rende inutilizzabile un indice B-tree, quindi ogni ricerca si traduce in una scansione sequenziale. Va bene con mille righe; diventa ingestibile con un milione.

La corrispondenza del termine è **letterale**: `%` e `_` sono metacaratteri LIKE e vengono sottoposti a escape prima che il pattern venga generato, quindi la ricerca di `50%` cercherà esattamente `50%` invece di restituire ogni riga. Se desideri usare caratteri jolly, l'operatore di filtro `like` accetta un pattern (`.where("title", "like", "post-%")`); `.search()` non lo fa.

Una ricerca a parola singola viene compilata esattamente nell'istruzione SQL di sempre.

## Abilitazione (Opt-in)

Dichiara un blocco `search` su una collection Postgres, indicando i campi che desideri indicizzare:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const talents: PostgresCollectionConfig = {
    slug: "talents",
    table: "talents",
    name: "Candidates",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        full_name: { name: "Full name", type: "string" },
        bio: { name: "Bio", type: "string" },
        interests: { name: "Interests", type: "array", of: { name: "Interest", type: "string" } },
        questionnaire: { name: "Questionnaire", type: "map", properties: {} }
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "full_name", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications"
        ]
    }
};
```

Nulla viene dedotto implicitamente. Un campo viene cercato solo e soltanto se lo indichi esplicitamente, e un percorso che non viene risolto genera un errore all'avvio anziché essere ignorato silenziosamente — un campo di ricerca che ritieni attivo ma non lo è rappresenta esattamente il tipo di errore che questo blocco si prefigge di prevenire.

`.search()` viene quindi compilato in una corrispondenza full-text con ranking e le righe vengono restituite con un `_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Cosa comporta la sua dichiarazione

Una colonna `tsvector`, `GENERATED ALWAYS AS … STORED`, e un indice GIN su di essa. Postgres ricalcola la colonna a ogni scrittura di un campo sorgente e rifiuta qualsiasi tentativo di scriverla direttamente, impedendo che l'indice si disallinei dalla riga. La colonna non viene mai restituita dalle API.

Queste definizioni vengono generate in `drizzle/search.sql`, accanto a `schema.sql` e `policies.sql`, e `rebase db push` le applica automaticamente — non è necessario eseguire nulla in più. Si trovano in un file dedicato perché una colonna generata `tsvector` richiede prima l'esistenza di una funzione helper `IMMUTABLE` (`unaccent` è solo `STABLE` e l'appiattimento di un documento `jsonb` necessita di una funzione che restituisce un set di righe), e Atlas — il motore alla base di `db push` — non può gestire le funzioni nel suo piano gratuito.

Una conseguenza importante da sapere se effettui il deploy tramite migrazioni anziché tramite push: l'aggiunta isolata di un blocco `search` non produce alcuna migrazione, poiché lo schema confrontato da Atlas non è cambiato. `rebase db generate` lo notifica quando ciò accade. Il blocco viene comunque applicato da `rebase db push` e dal controllo dello schema all'avvio; per inserirlo esplicitamente in una migrazione, accoda `drizzle/search.sql` a quest'ultima.

### Modificare il blocco in un secondo momento

Una colonna generata memorizza la propria espressione e Postgres non può modificare tale espressione sul posto — di conseguenza, aggiungere un campo, modificare un peso, cambiare la lingua o attivare `unaccent` **non** è un'operazione che `ADD COLUMN IF NOT EXISTS` può applicare a una colonna già esistente.

Rebase registra un'impronta (fingerprint) dell'espressione sulla colonna quando la crea e la confronta a ogni avvio e a ogni `db push`. Qualsiasi modifica viene rifiutata esplicitamente, fornendo le due istruzioni necessarie per applicarla — un `DROP COLUMN` e un `ADD COLUMN`, che riscrivono la tabella e ricostruiscono l'indice GIN. Puoi eseguirle nel momento che preferisci; nulla riscriverà una tabella di produzione al posto tuo.

Due modifiche fanno eccezione. L'attivazione di `fuzzy` è additiva — comporta una seconda colonna — e viene applicata senza richiedere questo processo. L'impostazione di [`mode`](#mode) modifica la query anziché la colonna, quindi si applica con un semplice deploy.

L'avvio viene bloccato anziché servire le richieste, perché l'alternativa è ciò che questo controllo ha sostituito: una colonna che continua a indicizzare l'insieme di campi precedente e una ricerca che non restituisce nulla per contenuti chiaramente presenti nella riga.

## Cosa puoi indicare in `fields`

| Percorso | Risoluzione | Esempio |
|---|---|---|
| Una proprietà `string` | la colonna | `"full_name"` |
| Una proprietà `string[]` | ogni elemento | `"interests"` |
| Una proprietà `map` | ogni valore stringa nel documento | `"questionnaire"` |
| Un percorso all'interno di una `map` | ogni valore stringa pari o inferiore a quel punto | `"questionnaire.certifications"` |

Un percorso all'interno di una mappa indicizza i **valori stringa a qualsiasi livello di profondità** sottostante — array di stringhe, oggetti annidati, array di oggetti. Le *chiavi* JSON non vengono mai indicizzate, solo i valori, in modo che un nome di campo comune a ogni riga non diventi un termine che corrisponde a tutte le righe.

Specificare un enum, un UUID, una colonna `json` (anziché `jsonb`) o un array di numeri provoca un errore all'avvio che ne spiega il motivo. Gli enum in particolare rappresentano un vocabolario fisso: filtrali con `where`, che è esatto e sfrutta un indice.

## Opzioni

### `language`

La configurazione della ricerca testuale di Postgres, che determina lo stemming e le stopwords. `"spanish"` riconduce la radice di `auditores` ad `auditor` ed elimina `de`; l'impostazione predefinita, `"simple"`, non fa nessuna delle due cose.

`"simple"` è il valore predefinito perché è l'unica scelta a non essere mai errata: uno stemmer applicato alla lingua sbagliata altera silenziosamente i lessemi. Impostalo sulla lingua dei tuoi contenuti per abilitare lo stemming.

### `mode`

<span class="since-badge" data-since="0.22">Since 0.22</span> Come una stringa di ricerca viene confrontata con i campi specificati.

| `mode` | Corrispondenze | Trova `Muñoz` da `munoz` | Trova `sebastian` da `seb` |
|---|---|---|---|
| `"fts"` (predefinito) | lessemi interi, tramite il `tsvector` e il relativo indice GIN | con `unaccent` | no |
| `"hybrid"` | quanto sopra, `OR` una corrispondenza per sottostringa sugli stessi campi | **sempre** | **sì** |

```typescript
search: {
    language: "spanish",
    mode: "hybrid",
    fields: ["full_name", "questionnaire.certifications"]
}
```

La modalità predefinita e l'impostazione predefinita senza blocco presentano lacune opposte, ed è proprio questo ciò che questa modalità risolve. Dati misurati su un'istanza reale di Postgres su cinque righe (`search-mode-matrix.test.ts` in `@rebasepro/server-postgres`):

| query | nessun blocco (ILIKE) | `"fts"` + `unaccent` | `"hybrid"` |
|---|---|---|---|
| `munoz` | `Ana Munoz` | `Ana Munoz`, `Sebastian Muñoz` | `Ana Munoz`, `Sebastian Muñoz` |
| `seb` | entrambi i Sebastian | — | entrambi i Sebastian |
| `audit` | il `Lead Auditor` | — | il `Lead Auditor` |
| `iso 14001` | la riga `ISO 14001` | la riga `ISO 14001` | la riga `ISO 14001` |

`fuzzy` raggiunge le stesse righe, ma solo dopo aver calibrato la soglia minima di somiglianza: con il valore predefinito di 0.3, `iso 14001` restituisce anche una riga contenente `ISO 9001`. `"hybrid"` non ha alcuna soglia da calibrare: una sottostringa è presente oppure non lo è.

**Quanto costa.** La parte basata su sottostringa non può utilizzare l'indice GIN; un carattere iniziale `%` non può mai farlo. La parte `@@` viene comunque eseguita per prima e continua a utilizzare l'indice, pertanto ciò che la modalità aggiunge è una scansione sulle righe rifiutate dall'indice. Su una tabella di grandi dimensioni questa è la differenza tra una scansione d'indice e una scansione sequenziale, motivo per cui questa è una modalità opzionale e non il comportamento predefinito.

**Modificarlo su una collection in produzione è sicuro** — è l'unica opzione di questo blocco per cui vale. `mode` agisce a livello di query: non modifica alcuna colonna generata, alcuna espressione di generazione e alcun indice, quindi non innesca il rifiuto descritto in [Modificare il blocco in un secondo momento](#modificare-il-blocco-in-un-secondo-momento). L'attivazione richiede solo un deploy e nient'altro.

Rimuove gli accenti nella parte di corrispondenza per sottostringa **indipendentemente dal fatto che `unaccent` sia impostato o meno**, perché anche tale rimozione avviene a livello di query. Questo comportamento è intenzionale: `unaccent` è l'impostazione che non può essere attivata in seguito senza riscrivere la tabella, quindi una collection rimasta senza di essa può comunque evitare di perdere corrispondenze come `Muñoz`. Ciò che `unaccent` continua a garantire è la rimozione degli accenti sulla parte `@@`, dove i lessemi sono memorizzati.

Aggiunge l'estensione `unaccent` e una funzione helper `IMMUTABLE` al database nel caso in cui non siano già presenti. Entrambe le istruzioni sono `IF NOT EXISTS` / `CREATE OR REPLACE`, e nessuna delle due modifica alcuna tabella.

### `unaccent`

Rimuove gli accenti prima dell'indicizzazione, in modo che `auditoria` corrisponda ad `auditoría`.

Questa operazione non è puramente estetica nelle lingue accentate. Postgres riconduce le due grafie a **lessemi diversi** — `to_tsvector('spanish', 'auditoría')` produce `auditor` mentre `'auditoria'` produce `auditori` — pertanto, senza questa opzione, una query digitata senza accenti non troverà alcuna riga che li contiene, che corrisponde alla maggior parte delle query digitate dalla maggior parte degli utenti.

Richiede l'estensione `unaccent`.

### `fuzzy`

Verifica anche la somiglianza basata su trigrammi, in modo che corrispondenze approssimative ricevano comunque un ranking: `iso14000` troverà `ISO 14001`, cosa che nessuna operazione di stemming potrebbe fare trattandosi semplicemente di lessemi differenti.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Aggiunge una seconda colonna generata e un indice basato su trigrammi, e richiede `pg_trgm`. Comporta un costo sui tempi di scrittura e su disco, ma risolve la tipologia più comune di ricerche fallite.

### `weight`

Ogni campo supporta una delle quattro classi di peso di Postgres, da `A` (la più rilevante) a `D`. `ts_rank` assegna a una corrispondenza `A` un punteggio nettamente superiore rispetto a una corrispondenza `D`, consentendo a un nome di superare per rilevanza una menzione occasionale in una lunga descrizione. Il valore predefinito per i campi è `B`.

### `column`

La colonna generata si chiama `search_vector`. Modificala solo in caso di collisione con una colonna già esistente — una volta creata fa parte del tuo schema, e rinominarla successivamente richiede un'eliminazione e una ricreazione, con conseguente riscrittura della tabella.

## Ranking

`_score` corrisponde a `ts_rank` calcolato sulla stessa query usata per trovare le righe, ed è presente solo quando la collection ha abilitato la ricerca full-text *e* la richiesta contiene una stringa di ricerca.

<span class="since-badge" data-since="0.22">Since 0.22</span> Con `mode: "hybrid"`, una riga trovata solo dalla parte della sottostringa riceve un punteggio costante ridotto (0.001) anziché zero — inferiore al più piccolo `ts_rank` che una corrispondenza reale di lessema possa produrre, di conseguenza una corrispondenza di parola intera supererà sempre una corrispondenza per sottostringa, e le righe trovate solo per sottostringa utilizzeranno il criterio di spareggio definito dalla query anziché essere restituite nell'ordine casuale della tabella.

Con `fuzzy` attivo, la somiglianza dei trigrammi viene **sommata** a tale rank. Non si tratta di un semplice affinamento — è ciò che rende `fuzzy` un vero e proprio sistema di ranking. Un errore di battitura non trova alcuna corrispondenza sul percorso esatto, quindi ogni riga trovata avrebbe un `ts_rank` pari esattamente a zero; ordinare solo per rank restituirebbe la corrispondenza migliore nell'ordine casuale della tabella. I due termini vengono sommati anziché ponderati, in modo che una riga che ha avuto una corrispondenza esatta contribuisca con entrambi e superi una riga semplicemente simile senza la necessità di specificare un coefficiente. Al di fuori di queste due condizioni, `orderBy: "_score"` viene considerato un campo sconosciuto e restituisce 400 anziché restituire silenziosamente righe non ordinate.

`_score` non può essere combinato con la paginazione basata su cursore (`startAfter`). La rilevanza viene calcolata per ciascuna query anziché essere memorizzata, quindi non esiste alcun valore sulla riga cursore da confrontare con la pagina successiva, e due richieste con stringhe di ricerca diverse producono punteggi non comparabili sulla stessa scala. Utilizza `limit`/`offset` per le pagine ordinate per rilevanza.

## Perché questa riga ha prodotto una corrispondenza?

Un elenco ordinato per rilevanza ti dice *quali* righe corrispondono, mai *perché* una determinata riga è presente. Richiedi a ciascuna riga di spiegare la corrispondenza:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` è il percorso esattamente come dichiarato in `fields`, consentendoti di associarlo a un'etichetta per la visualizzazione. I campi vengono restituiti nell'ordine in cui sono stati dichiarati.

Il costo è applicato per singola query e non per collection: viene eseguito un `ts_headline` per ciascun campo dichiarato per ogni riga restituita, e `ts_headline` esegue nuovamente il parsing del documento anziché leggere l'indice. Questo approccio è ideale per una pagina di risultati, ma sconsigliato per un'esportazione.

**Lo snippet contiene markup per definizione** — ogni corrispondenza è racchiusa in `<mark>`. Esegui il rendering come HTML o rimuovi i tag, ma non trattarlo come testo normale e non fidarti ciecamente del testo circostante: si tratta del contenuto digitato dall'utente. Suddividere la stringa su `<mark>` e renderizzare le parti è più sicuro rispetto all'uso di `dangerouslySetInnerHTML`.

<span class="since-badge" data-since="0.22">Since 0.22</span> In `mode: "hybrid"`, viene segnalato anche un campo che ha prodotto una corrispondenza solo per sottostringa — si tratta del campo che ha generato il risultato. Il suo snippet viene restituito senza evidenziazioni: `ts_headline` evidenzia i lessemi e una parola parziale non lo è.

Con `unaccent` attivo, gli snippet vengono letti con gli accenti rimossi — `Auditoria`, non `Auditoría`. `ts_headline` sul testo originale non può trovare una corrispondenza prodotta da una query senza accenti, quindi restituirebbe il testo privo di qualsiasi evidenziazione; uno snippet leggibile che evidenzia le corrispondenze è preferibile a uno esteticamente migliore che non evidenzia nulla.

## Aggiungere il blocco a una collection attiva

La colonna generata viene aggiunta dal controllo dello schema all'avvio, come qualsiasi altra colonna, e il relativo indice viene creato con `CREATE INDEX CONCURRENTLY` in modo da non bloccare le scritture. L'aggiunta di una colonna generata di tipo *stored* comporta la riscrittura della tabella, pertanto su una tabella di grandi dimensioni è opportuno pianificarla come qualsiasi altra operazione di riscrittura.

## Quali motori sono supportati

Il blocco `search` è disponibile esclusivamente per Postgres e viene rifiutato all'avvio su altri motori anziché essere ignorato silenziosamente. Le collection MongoDB continuano a utilizzare la corrispondenza basata su regex; le collection Firestore utilizzano il controller di ricerca testuale esterno.

## Risorse correlate

- [REST API](/docs/backend/api/) — i parametri di query con cui una ricerca raggiunge il server
- [Indici](/docs/backend/indexes/) — cosa crea il blocco di ricerca e quanto costa
- [Interrogazione dei dati](/docs/sdk/querying/) — come eseguire ricerche dall'SDK client

---
sourceHash: a6c102be4bcc017e
title: Ricerca
sidebar_label: Ricerca
description: Come si comporta .search() per impostazione predefinita e come abilitare una collection Postgres alla ricerca full-text con ranking sui campi specificati — inclusi contenuti JSONB e array.
---

`.search("term")` funziona su ogni collection senza alcuna configurazione. In cosa viene compilato dipende dal fatto che la collection abbia richiesto o meno funzionalità aggiuntive.

## Comportamento predefinito

Senza alcuna configurazione, `.search()` è una **corrispondenza di sottostringhe senza distinzione tra maiuscole e minuscole (case-insensitive)**, combinata con OR tra le proprietà `string` di primo livello della collection. La stringa di ricerca viene suddivisa sugli spazi bianchi e ogni termine deve corrispondere — ma i termini possono corrispondere a proprietà diverse, quindi un nome suddiviso in due colonne viene comunque trovato:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Racchiudi una sequenza tra virgolette doppie — `.search('"ada lovelace"')` — per cercare invece la frase esatta, allo stesso modo in cui la interpreta il percorso full-text descritto di seguito.

Questo è sufficiente per una collection di piccole dimensioni con testo in colonne semplici. Presenta tuttavia tre limitazioni che nessuna impostazione al suo interno può risolvere:

- **Non può vedere all'interno delle proprietà `map` o `array`.** Una collection che conserva i propri contenuti ricercabili in JSONB — tag, certificazioni, un questionario — avrà una casella di ricerca che non troverà silenziosamente alcuna corrispondenza.
- **Non ha pertinenza (rilevanza).** Le righe vengono restituite nell'ordine specificato da `orderBy`, quindi la corrispondenza migliore potrebbe trovarsi a pagina sette.
- **Non può utilizzare un indice.** Un `%` iniziale rende inutile un B-tree, quindi ogni ricerca diventa una scansione sequenziale. Funziona con mille righe; diventa un collo di bottiglia insostenibile con un milione.

Il termine viene confrontato **letteralmente**: `%` e `_` sono metacaratteri di LIKE e vengono sottoposti a escape prima che il pattern venga costruito; pertanto, cercare `50%` cerca effettivamente `50%` invece di restituire ogni riga. Se desideri utilizzare caratteri jolly, l'operatore di filtro `like` accetta un pattern (`.where("title", "like", "post-%")`); `.search()` non lo fa.

Una ricerca a parola singola viene compilata esattamente nell'SQL di sempre.

## Abilitare la ricerca full-text

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

Nulla viene dedotto implicitamente. Un campo viene cercato se e solo se viene specificato, e un percorso che non può essere risolto genera un errore all'avvio anziché essere ignorato silenziosamente — un campo di ricerca che credi sia attivo mentre non lo è rappresenta esattamente il tipo di errore che questo blocco è pensato per prevenire.

`.search()` viene quindi compilato in una corrispondenza full-text con ranking e le righe vengono restituite con uno `_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Cosa crea la dichiarazione

Una colonna `tsvector`, `GENERATED ALWAYS AS … STORED`, e un indice GIN su di essa. Postgres ricalcola la colonna a ogni scrittura di un campo sorgente e rifiuta qualsiasi tentativo di scriverla direttamente, impedendo all'indice di disallinearsi dalla riga. La colonna non viene mai restituita dall'API.

Vengono generati in `drizzle/search.sql`, accanto a `schema.sql` e `policies.sql`, e `rebase db push` li applica automaticamente — non è necessario eseguire nulla in più. Hanno un file dedicato perché una colonna `tsvector` generata richiede l'esistenza preliminare di una funzione helper `IMMUTABLE` (`unaccent` è solo `STABLE` e l'appiattimento di un documento `jsonb` richiede una set-returning function), e Atlas — il motore alla base di `db push` — non può gestire funzioni nel suo tier gratuito.

Una conseguenza utile da sapere se esegui il deploy tramite migrazioni anziché tramite push: l'aggiunta isolata di un blocco `search` non produce alcuna migrazione, poiché lo schema confrontato da Atlas non è cambiato. `rebase db generate` lo segnala quando si verifica. Il blocco viene comunque applicato da `rebase db push` e dalla procedura di verifica dello schema all'avvio (boot-time schema ensure); per includerlo esplicitamente in una migrazione, aggiungi `drizzle/search.sql` in coda a una di esse.

### Modificare il blocco in seguito

Una colonna generata porta con sé la propria espressione e Postgres non può modificare tale espressione sul posto — pertanto aggiungere un campo, cambiare un peso, modificare la lingua o abilitare `unaccent` **non** è un'operazione che `ADD COLUMN IF NOT EXISTS` possa applicare a una colonna già esistente.

Rebase registra un'impronta digitale (fingerprint) dell'espressione sulla colonna al momento della sua creazione e la confronta a ogni avvio e a ogni `db push`. Una modifica viene rifiutata esplicitamente, fornendo le due istruzioni necessarie per applicarla — una `DROP COLUMN` e una `ADD COLUMN`, che riscrivono la tabella e ricostruiscono l'indice GIN. Eseguile nel momento che ritieni più opportuno; nulla riscrive una tabella in produzione al posto tuo. (L'abilitazione di `fuzzy` è additiva — una seconda colonna — e si applica senza dover fare nulla di tutto questo.)

L'avvio viene bloccato invece di erogare il servizio, perché l'alternativa è ciò che questo controllo ha sostituito: una colonna che continua a indicizzare il set di campi precedente e una ricerca che non restituisce nulla per contenuti chiaramente presenti nella riga.

## Cosa puoi specificare in `fields`

| Percorso | Si risolve in | Esempio |
|----------|---------------|---------|
| Una proprietà `string` | la colonna | `"full_name"` |
| Una proprietà `string[]` | ogni elemento | `"interests"` |
| Una proprietà `map` | ogni valore stringa nel documento | `"questionnaire"` |
| Un percorso all'interno di una `map` | ogni valore stringa in quel punto o nei livelli sottostanti | `"questionnaire.certifications"` |

Un percorso all'interno di una mappa indicizza i **valori stringa a qualsiasi livello di profondità** al di sotto di esso — array di stringhe, oggetti annidati, array di oggetti. Le *chiavi* JSON non vengono mai indicizzate, solo i valori, in modo che il nome di un campo comune a ogni riga non diventi un termine che produce corrispondenze su ogni riga.

Specificare un enum, un UUID, una colonna `json` (anziché `jsonb`) o un array di numeri genera un errore all'avvio che ne spiega il motivo. Gli enum in particolare costituiscono un vocabolario fisso: filtrali con `where`, che è esatto e utilizza un indice.

## Opzioni

### `language`

La configurazione di ricerca del testo di Postgres, che determina stemming e stopwords. `"spanish"` riconduce tramite stemming `auditores` ad `auditor` ed esclude `de`; il valore predefinito, `"simple"`, non fa nessuna delle due cose.

`"simple"` è il valore predefinito perché è l'unica scelta che non è mai errata — uno stemmer applicato alla lingua sbagliata altera silenziosamente i lessemi. Impostalo sulla lingua dei tuoi contenuti per abilitare lo stemming.

### `unaccent`

Rimuove gli accenti prima dell'indicizzazione, in modo che `auditoria` corrisponda ad `auditoría`.

Non si tratta di una questione meramente estetica in una lingua con accenti. Postgres riconduce le due grafie a **lessemi diversi** — `to_tsvector('spanish', 'auditoría')` produce `auditor` mentre `'auditoria'` produce `auditori` — quindi, senza questa opzione, una query digitata senza accenti non troverà alcuna riga che li contiene, che corrisponde alla maggior parte delle query digitate dalla maggior parte degli utenti.

Richiede l'estensione `unaccent`.

### `fuzzy`

Esegue la corrispondenza anche sulla similarità tra trigrammi, consentendo di classificare nel ranking anche le corrispondenze approssimative: ad esempio `iso14000` che individua `ISO 14001`, cosa che nessuna operazione di stemming potrebbe fare trattandosi semplicemente di lessemi differenti.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Aggiunge una seconda colonna generata e un indice basato su trigrammi, e richiede `pg_trgm`. Comporta un costo in termini di tempo di scrittura e spazio su disco, ma risolve la tipologia più comune di ricerche non riuscite.

### `weight`

Ciascun campo appartiene a una delle quattro classi di peso di Postgres, da `A` (la più rilevante) a `D`. `ts_rank` attribuisce a una corrispondenza `A` un punteggio molto superiore rispetto a una `D`, ed è così che un nome ottiene una priorità maggiore rispetto a una menzione fugace all'interno di una lunga descrizione. I campi hanno `B` come valore predefinito.

### `column`

La colonna generata viene denominata `search_vector`. Modificala solo se entra in conflitto con una colonna già esistente — una volta creata fa parte del tuo schema e rinominarla successivamente richiede una cancellazione e ricreazione (drop and recreate), operazione che riscrive la tabella.

## Ranking

`_score` corrisponde a `ts_rank` calcolato rispetto alla stessa query con cui sono state abbinate le righe, ed è presente solo quando la collection ha abilitato la funzionalità *e* la richiesta includeva una stringa di ricerca.

Con `fuzzy` abilitato, la similarità per trigrammi viene **sommata** a tale punteggio. Non si tratta di un semplice perfezionamento: è ciò che rende `fuzzy` un vero e proprio criterio di ranking. Un errore di battitura non produce alcuna corrispondenza sul percorso esatto, per cui ogni riga individuata ha un `ts_rank` pari esattamente a zero; ordinare solo per rank restituirebbe la migliore corrispondenza nell'ordine casuale determinato dalla tabella. I due termini vengono sommati anziché ponderati, di conseguenza una riga che corrisponde esattamente contribuisce a entrambi e supera una riga semplicemente simile senza la necessità di specificare un coefficiente. Al di fuori di queste due condizioni, `orderBy: "_score"` risulta essere un campo sconosciuto e restituisce l'errore 400 anziché restituire silenziosamente righe non ordinate.

`_score` non può essere combinato con la paginazione basata su cursore (`startAfter`). La rilevanza viene calcolata per ogni query anziché essere memorizzata, quindi non esiste alcun valore sulla riga cursore con cui confrontare la pagina successiva, e due richieste con stringhe di ricerca diverse generano punteggi che non condividono la stessa scala. Utilizza `limit`/`offset` per le pagine ordinate per rilevanza.

## Perché questa riga ha prodotto una corrispondenza?

Un elenco ordinato per rilevanza mostra *quali* righe corrispondono, ma non *perché* una determinata riga sia presente. Chiedi a ciascuna riga di spiegare la propria corrispondenza:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` è il percorso esattamente come dichiarato in `fields`, consentendoti di mapparlo a un'etichetta per la visualizzazione. I campi vengono restituiti nell'ordine in cui sono stati dichiarati.

Si applica a livello di singola query, non di collection, perché il costo è legato alla query: una chiamata a `ts_headline` per ogni campo dichiarato per ciascuna riga restituita, e `ts_headline` analizza nuovamente il documento anziché leggere dall'indice. È la scelta adatta per una pagina di risultati, non per un'esportazione di dati.

**Lo snippet contiene markup per definizione** — ogni corrispondenza è racchiusa in `<mark>`. Esegui il rendering come HTML oppure rimuovi i tag, ma non trattarlo come testo normale e non fidarti del testo circostante: corrisponde esattamente a ciò che l'utente ha digitato. Suddividere il testo sui tag `<mark>` e renderizzarne le parti è più sicuro rispetto all'uso di `dangerouslySetInnerHTML`.

Con `unaccent` abilitato, gli snippet vengono letti senza accenti — `Auditoria`, non `Auditoría`. Eseguire `ts_headline` sul testo originale non consente di individuare una corrispondenza prodotta da una query priva di accenti, restituendo di conseguenza il testo senza alcuna evidenziazione; uno snippet leggibile con le evidenziazioni è preferibile a uno esteticamente più gradevole che non evidenzia nulla.

## Aggiungere il blocco a una collection attiva

La colonna generata viene aggiunta dalla procedura di verifica dello schema all'avvio (boot-time schema ensure), come qualsiasi altra colonna, e il relativo indice viene creato con `CREATE INDEX CONCURRENTLY` in modo da non bloccare le scritture. L'aggiunta di una colonna generata di tipo *stored* comporta tuttavia la riscrittura della tabella; pertanto, su tabelle di grandi dimensioni, pianifica l'intervento come qualsiasi altra riscrittura.

## Motori di database supportati

Il blocco `search` è disponibile esclusivamente per Postgres e viene rifiutato all'avvio sugli altri motori anziché essere ignorato silenziosamente. Le collection MongoDB mantengono la corrispondenza basata su regex; le collection Firestore utilizzano il controller esterno di ricerca del testo.

## Correlati

- [REST API](/docs/backend/api/) — i parametri di query con cui una ricerca raggiunge il server
- [Indici](/docs/backend/indexes/) — cosa crea il blocco search e quali risorse richiede
- [Interrogare i dati](/docs/sdk/querying/) — eseguire ricerche dall'SDK client

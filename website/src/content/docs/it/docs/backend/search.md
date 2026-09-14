---
sourceHash: 04421ade309db1ce
title: Ricerca
sidebar_label: Ricerca
description: Come si comporta .search() per impostazione predefinita e come abilitare la ricerca full-text con classificazione (ranking) per una collezione Postgres sui campi specificati — inclusi i contenuti JSONB e array.
---

`.search("term")` funziona su ogni collezione senza alcuna configurazione. La query in cui viene compilato dipende dal fatto che la collezione abbia richiesto o meno funzionalità aggiuntive.

## Il comportamento predefinito

Senza alcuna configurazione, `.search()` è una **ricerca di sottostringhe senza distinzione tra maiuscole e minuscole (case-insensitive)**, combinata in `OR` tra le proprietà `string` di primo livello della collezione:

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

Questo è sufficiente per una collezione di piccole dimensioni con testo in colonne standard. Presenta però tre limitazioni che nessuna impostazione al suo interno può risolvere:

- **Non può cercare all'interno delle proprietà `map` o `array`.** Una collezione che memorizza i propri contenuti ricercabili in JSONB — tag, certificazioni, un questionario — avrà una casella di ricerca che silenziosamente non restituirà alcun risultato.
- **Non prevede rilevanza.** Le righe vengono restituite nell'ordine specificato da `orderBy`, quindi la corrispondenza migliore potrebbe trovarsi a pagina sette.
- **Non può utilizzare un indice.** Un `%` iniziale rende inefficace un B-tree, trasformando ogni ricerca in una scansione sequenziale (sequential scan). Va bene con mille righe; diventa un collo di bottiglia insostenibile con un milione.

Il termine viene cercato in modo **letterale**: `%` e `_` sono metacaratteri LIKE e vengono sottoposti a escape prima della creazione del pattern, quindi la ricerca di `50%` cerca effettivamente `50%` anziché restituire tutte le righe. Se desideri utilizzare caratteri jolly, l'operatore di filtro `like` accetta un pattern (`.where("title", "like", "post-%")`); `.search()` non lo fa.

Il comportamento predefinito non cambia e una collezione che non ha effettuato l'opt-in compila esattamente nello stesso SQL di sempre.

## Attivazione

Dichiara un blocco `search` su una collezione Postgres, indicando i campi che desideri indicizzare:

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

Nulla viene dedotto implicitamente. Un campo viene cercato solo e soltanto se lo indichi esplicitamente, e un percorso che non può essere risolto genera un errore all'avvio anziché essere ignorato silenziosamente — un campo di ricerca che ritieni attivo quando in realtà non lo è rappresenta esattamente il problema che questo blocco si prefigge di prevenire.

`.search()` viene quindi compilato in una ricerca full-text con classificazione (ranking), e le righe vengono restituite con un `_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Cosa viene creato con la dichiarazione

Una colonna `tsvector`, `GENERATED ALWAYS AS … STORED`, e un indice GIN su di essa. Postgres ricalcola la colonna a ogni scrittura di un campo di origine e rifiuta qualsiasi tentativo di scriverla direttamente, impedendo così che l'indice si disallinei dalla riga. La colonna non viene mai restituita dall'API.

Vengono generati in `drizzle/search.sql`, accanto a `schema.sql` e `policies.sql`, e `rebase db push` li applica automaticamente — senza dover eseguire nient'altro. Hanno un file dedicato perché una colonna generata `tsvector` richiede prima l'esistenza di una funzione helper `IMMUTABLE` (`unaccent` è solo `STABLE`, e appiattire un documento `jsonb` richiede una funzione che restituisce set), e Atlas — il motore dietro `db push` — non supporta la gestione delle funzioni nel suo piano gratuito.

Una conseguenza utile da sapere se si esegue il deployment tramite migrazioni anziché tramite push: l'aggiunta di un blocco `search` da sola non produce alcuna migrazione, poiché lo schema confrontato da Atlas non è cambiato. `rebase db generate` lo segnala quando accade. Il blocco viene comunque applicato da `rebase db push` e dal controllo di verifica dello schema all'avvio; per inserirlo esplicitamente in una migrazione, aggiungi in coda il contenuto di `drizzle/search.sql` a una di esse.

### Modificare il blocco in seguito

Una colonna generata contiene la propria espressione e Postgres non può modificare tale espressione sul posto — quindi aggiungere un campo, cambiare un peso, modificare la lingua o attivare `unaccent` **non** sono operazioni che `ADD COLUMN IF NOT EXISTS` può applicare a una colonna già esistente.

Rebase registra un fingerprint dell'espressione sulla colonna al momento della creazione e lo confronta a ogni avvio e a ogni `db push`. Una modifica viene rifiutata esplicitamente, fornendo le due istruzioni necessarie per applicarla — una `DROP COLUMN` e una `ADD COLUMN`, che riscrivono la tabella e ricostruiscono l'indice GIN. Eseguile quando preferisci; nulla riscriverà una tabella in produzione al posto tuo. (L'attivazione di `fuzzy` è additiva — una seconda colonna — e si applica senza tutto questo.)

L'avvio viene bloccato anziché iniziare a servire richieste, perché l'alternativa è ciò che questo controllo ha sostituito: una colonna che continua a indicizzare il set di campi precedente e una ricerca che non restituisce nulla per contenuti chiaramente presenti nella riga.

## Cosa è possibile specificare in `fields`

| Percorso | Risolve in | Esempio |
|------|-------------|---------|
| Una proprietà `string` | la colonna | `"full_name"` |
| Una proprietà `string[]` | ogni elemento | `"interests"` |
| Una proprietà `map` | ogni valore stringa nel documento | `"questionnaire"` |
| Un percorso all'interno di una `map` | ogni valore stringa a quel livello o al di sotto | `"questionnaire.certifications"` |

Un percorso all'interno di una map indicizza i **valori stringa a qualsiasi livello di profondità** sottostante — array di stringhe, oggetti annidati, array di oggetti. Le *chiavi* JSON non vengono mai indicizzate, solo i valori, in modo che il nome di un campo comune a ogni riga non diventi un termine che corrisponde a tutte le righe.

Specificare un enum, un UUID, una colonna `json` (anziché `jsonb`) o un array di numeri genera un errore all'avvio che ne spiega il motivo. Gli enum in particolare rappresentano un vocabolario fisso: filtrali con `where`, che è esatto e utilizza un indice.

## Opzioni

### `language`

La configurazione di ricerca del testo di Postgres, che determina stemming e stopword. `"spanish"` riduce `auditores` ad `auditor` e scarta `de`; il valore predefinito, `"simple"`, non fa nessuna delle due cose.

`"simple"` è il valore predefinito perché è l'unica scelta che non è mai errata — uno stemmer applicato alla lingua sbagliata altera silenziosamente i lessemi. Impostalo sulla lingua dei tuoi contenuti per abilitare lo stemming.

### `unaccent`

Rimuove gli accenti prima dell'indicizzazione, in modo che `auditoria` corrisponda ad `auditoría`.

Questo non è un dettaglio puramente estetico nelle lingue con accenti. Postgres riduce le due grafie a **lessemi diversi** — `to_tsvector('spanish', 'auditoría')` restituisce `auditor` mentre `'auditoria'` restituisce `auditori` — pertanto, senza questa opzione, una query digitata senza accenti non troverà alcuna riga che li contiene, ovvero la maggior parte delle query digitate dalla maggior parte degli utenti.

Richiede l'estensione `unaccent`.

### `fuzzy`

Trova corrispondenze anche in base alla somiglianza tra trigrammi, consentendo di classificare anche corrispondenze quasi esatte: ad esempio `iso14000` che individua `ISO 14001`, cosa che nessun livello di stemming farebbe poiché si tratta semplicemente di lessemi differenti.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Aggiunge una seconda colonna generata e un indice trigram, e richiede `pg_trgm`. Comporta un costo in termini di tempo di scrittura e spazio su disco, ma risolve la causa più comune di ricerche fallite.

### `weight`

Ciascun campo appartiene a una delle quattro classi di peso di Postgres, da `A` (più rilevante) a `D`. `ts_rank` attribuisce a una corrispondenza in `A` un punteggio molto superiore rispetto a una in `D`, ed è così che un nome supera in classifica una menzione fugace all'interno di una lunga descrizione. Il valore predefinito per i campi è `B`.

### `column`

La colonna generata è denominata `search_vector`. Modificala solo in caso di conflitto con una colonna già esistente — una volta creata fa parte dello schema e rinominarla in seguito richiede un drop e recreate, che comporta la riscrittura della tabella.

## Classificazione (Ranking)

`_score` è il valore restituito da `ts_rank` rispetto alla stessa query con cui le righe hanno trovato corrispondenza, ed è presente solo quando la collezione ha attivato la funzionalità *e* la richiesta contiene una stringa di ricerca.

Con `fuzzy` abilitato, la somiglianza dei trigrammi viene **sommata** a tale punteggio. Non si tratta di un semplice perfezionamento: è ciò che rende `fuzzy` una vera classificazione. Un errore di battitura non trova corrispondenze sul percorso esatto, quindi ogni riga individuata ha un `ts_rank` pari esattamente a zero; ordinare solo per rank restituirebbe la corrispondenza migliore in un ordine casuale. I due termini vengono sommati anziché ponderati, per cui una riga con corrispondenza esatta contribuisce con entrambi e supera una riga semplicemente simile senza bisogno di specificare un coefficiente. Al di fuori di queste due condizioni, `orderBy: "_score"` viene trattato come un campo sconosciuto e restituisce un errore 400 anziché restituire silenziosamente righe non ordinate.

`_score` non può essere combinato con la paginazione basata su cursore (`startAfter`). La rilevanza viene calcolata per ogni singola query anziché essere persistita, quindi non esiste alcun valore sulla riga cursore da confrontare con la pagina successiva, e due richieste con stringhe di ricerca differenti producono punteggi non confrontabili sulla stessa scala. Utilizza `limit`/`offset` per le pagine ordinate per rilevanza.

## Perché questa riga ha prodotto una corrispondenza?

Un elenco classificato indica *quali* righe corrispondono, ma mai *perché* una determinata riga è presente. Chiedi a ciascuna riga di spiegare la corrispondenza:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` corrisponde esattamente al percorso dichiarato in `fields`, consentendoti di mapparlo su un'etichetta per la visualizzazione. I campi vengono restituiti nell'ordine in cui sono stati dichiarati.

Funziona per query e non a livello di collezione, poiché il costo computazionale è per query: un'esecuzione di `ts_headline` per ciascun campo dichiarato per ogni riga restituita; inoltre `ts_headline` rianalizza il documento anziché leggere dall'indice. È la scelta ideale per una pagina di risultati, ma sconsigliata per un'esportazione di dati.

**Lo snippet contiene markup per definizione** — ogni corrispondenza è racchiusa tra tag `<mark>`. Esegui il rendering come HTML o rimuovi i tag, ma non trattarlo come testo normale e non considerare attendibile il testo circostante: si tratta esattamente di ciò che l'utente ha inserito. Suddividere la stringa sui tag `<mark>` ed eseguire il rendering delle singole parti è più sicuro rispetto a `dangerouslySetInnerHTML`.

Con `unaccent` attivo, gli snippet vengono letti con gli accenti rimossi — `Auditoria`, non `Auditoría`. L'esecuzione di `ts_headline` sul testo originale non riuscirebbe a individuare la corrispondenza prodotta da una query senza accenti, restituendo quindi il testo privo di qualsiasi evidenziazione; uno snippet leggibile con evidenziazioni è preferibile a uno formalmente corretto che non evidenzia nulla.

## Aggiungere il blocco a una collezione esistente

La colonna generata viene aggiunta dal controllo di verifica dello schema all'avvio, come qualsiasi altra colonna, e il relativo indice viene creato con `CREATE INDEX CONCURRENTLY` in modo da non bloccare le operazioni di scrittura. L'aggiunta di una colonna generata di tipo *stored* comporta la riscrittura della tabella, pertanto, su una tabella di grandi dimensioni, pianificala come qualsiasi altra operazione di riscrittura.

## Motori supportati

Il blocco `search` è supportato esclusivamente su Postgres e viene rifiutato all'avvio sugli altri motori anziché essere ignorato silenziosamente. Le collezioni MongoDB mantengono la corrispondenza basata su regex; le collezioni Firestore utilizzano il controller esterno di ricerca del testo.

## Risorse correlate

- [REST API](/docs/backend/api/) — i parametri di query con cui una ricerca raggiunge il server
- [Indici](/docs/backend/indexes/) — cosa crea il blocco search e qual è il suo impatto
- [Interrogazione dei dati](/docs/sdk/querying/) — eseguire ricerche tramite l'SDK client

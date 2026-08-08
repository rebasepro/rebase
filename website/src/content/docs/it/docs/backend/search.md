---
title: Ricerca
sidebar_label: Search
description: Come si comporta .search() per impostazione predefinita e come attivare la ricerca full-text con rilevanza in una collection Postgres sui campi specificati, inclusi i contenuti JSONB e array.
---

`.search("term")` funziona su ogni collection senza alcuna configurazione. Ciò in cui viene compilato dipende dal fatto che la collection abbia richiesto o meno impostazioni aggiuntive.

## Comportamento predefinito

Senza alcuna configurazione, `.search()` effettua un **matching di sottostringhe non sensibile alle maiuscole/minuscole** (case-insensitive), in OR tra le proprietà `string` di primo livello della collection:

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

Questo è sufficiente per una piccola collection con il testo in colonne semplici. Presenta tre limiti che nessuna impostazione interna può risolvere:

- **Non può vedere all'interno delle proprietà `map` o `array`.** Una collection che conserva il suo contenuto ricercabile in JSONB (tag, certificazioni, un modulo/questionario) ha una casella di ricerca che silenziosamente non trova nulla.
- **Non ha rilevanza.** Le righe vengono restituite nell'ordine di `orderBy`, quindi la corrispondenza migliore potrebbe trovarsi a pagina sette.
- **Non può utilizzare un indice.** Un `%` iniziale rende inefficace un B-tree, quindi ogni ricerca è una scansione sequenziale. Va bene con mille righe; diventa un ostacolo insormontabile con un milione.

Il comportamento predefinito non cambia e una collection che non ha attivato la funzionalità si compila esattamente nello stesso SQL di prima.

## Attivazione (Opting in)

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

Nulla viene dedotto automaticamente. Un campo viene cercato se e solo se viene specificato, e un percorso che non si risolve genera un errore all'avvio invece di essere ignorato silenziosamente; un campo di ricerca che credi sia attivo ma non lo è, è esattamente il problema che questo blocco intende prevenire.

In tal caso, `.search()` si compila in un matching full-text con rilevanza (ranked) e le righe vengono restituite con uno `_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Cosa crea la dichiarazione

Una colonna `tsvector`, `GENERATED ALWAYS AS … STORED`, e un indice GIN su di essa. Postgres ricalcola la colonna ad ogni scrittura di un campo sorgente e rifiuta qualsiasi tentativo di scriverla direttamente, impedendo all'indice di disallinearsi dalla riga. La colonna non viene mai restituita dall'API.

Vengono generati in `drizzle/search.sql`, accanto a `schema.sql` e `policies.sql`, e `rebase db push` li applica per te — niente di ulteriore da eseguire. Hanno un file dedicato perché una colonna `tsvector` generata necessita prima di una funzione ausiliaria `IMMUTABLE` (`unaccent` è solo `STABLE` e l'appiattimento di un documento `jsonb` richiede una funzione che restituisce un set), e Atlas — il motore dietro `db push` — non può gestire le funzioni nel suo piano gratuito.

Una conseguenza importante da sapere se si esegue il deploy tramite migrazioni anziché tramite push: l'aggiunta di un blocco `search` da solo non produce alcuna migrazione, poiché lo schema confrontato da Atlas non è cambiato. `rebase db generate` lo segnala quando accade. Il blocco viene comunque applicato da `rebase db push` e dalla verifica dello schema all'avvio; per inserirlo esplicitamente in una migrazione, aggiungi `drizzle/search.sql` a una di esse.

## Cosa si può indicare in `fields`

| Percorso | Si risolve in | Esempio |
|----------|---------------|---------|
| Una proprietà `string` | la colonna | `"full_name"` |
| Una proprietà `string[]` | ogni elemento | `"interests"` |
| Una proprietà `map` | ogni valore stringa nel documento | `"questionnaire"` |
| Un percorso all'interno di una `map` | ogni valore stringa a quel livello o sottostante | `"questionnaire.certifications"` |

Un percorso all'interno di una mappa indicizza i **valori stringa a qualsiasi profondità** sottostante: array di stringhe, oggetti annidati, array di oggetti. Le *chiavi* JSON non vengono mai indicizzate, solo i valori, in modo che il nome di un campo comune a tutte le righe non diventi un termine che corrisponde a ogni riga.

Specificare un enum, un UUID, una colonna `json` (anziché `jsonb`) o un array di numeri genera un errore all'avvio che ne spiega il motivo. Gli enum in particolare costituiscono un vocabolario fisso: filtrali con `where`, che è esatto e utilizza un indice.

## Opzioni

### `language`

La configurazione di ricerca testo di Postgres, che determina stemming e stopwords. `"spanish"` riduce (stemma) `auditores` a `auditor` e rimuove `de`; l'opzione predefinita, `"simple"`, non fa nessuna delle due cose.

`"simple"` è l'opzione predefinita perché è l'unica scelta che non è mai errata: uno stemmer applicato alla lingua sbagliata altera silenziosamente i lessemi. Impostala sulla lingua dei tuoi contenuti per abilitare lo stemming.

### `unaccent`

Rimuove gli accenti prima dell'indicizzazione, in modo che `auditoria` corrisponda ad `auditoría`.

Questo non è un dettaglio estetico nelle lingue con accenti. Postgres riduce le due grafie a **lessemi diversi**: `to_tsvector('spanish', 'auditoría')` produce `auditor` mentre `'auditoria'` produce `auditori`. Senza questa opzione, una query digitata senza accenti non troverà le righe che li contengono, ovvero la maggior parte delle query digitate dagli utenti.

Richiede l'estensione `unaccent`.

### `fuzzy`

Esegue il matching anche sulla similarità dei trigrammi, permettendo di posizionare anche le corrispondenze approssimative: ad esempio `iso14000` trova `ISO 14001`, cosa che lo stemming non potrebbe fare essendo lessemi semplicemente diversi.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Aggiunge una seconda colonna generata e un indice trigramma, e richiede `pg_trgm`. Comporta un costo in termini di tempo di scrittura e disco, ma risolve la classe più comune di ricerche fallite.

### `weight`

Ogni campo possiede una delle quattro classi di peso di Postgres, da `A` (più forte) a `D`. `ts_rank` assegna a una corrispondenza `A` un punteggio molto più alto rispetto a una `D`; è così che un nome ha la precedenza rispetto a una menzione marginale in una descrizione lunga. I campi hanno `B` come valore predefinito.

### `column`

La colonna generata si chiama `search_vector`. Modificala solo se entra in collisione con una colonna già esistente; fa parte del tuo schema una volta creata e rinominarla in seguito richiede un drop e recreate, con conseguente riscrittura della tabella.

## Ranking (Ordinamento per rilevanza)

`_score` è il risultato di `ts_rank` rispetto alla stessa query con cui le righe sono state individuate, ed è presente solo se la collection ha attivato la funzionalità *e* la richiesta conteneva una stringa di ricerca.

Con `fuzzy` attivo, la similarità per trigrammi viene **aggiunta** a tale rank. Non si tratta di una rifinitura, ma di ciò che rende `fuzzy` a tutti gli effetti una classifica. Un errore di battitura non corrisponde a nulla sul percorso esatto, quindi ogni riga trovata ha un `ts_rank` pari a zero; ordinare solo per rank restituirebbe la corrispondenza migliore in un ordine casuale gestito dalla tabella. I due termini vengono sommati anziché pesati, in modo che una riga con corrispondenza esatta contribuisca con entrambi e superi una riga solo simile senza bisogno di un coefficiente esplicito. Al di fuori di queste due condizioni, `orderBy: "_score"` è considerato un campo sconosciuto e restituisce un errore 400 invece di restituire silenziosamente righe non ordinate.

`_score` non può essere combinato con la paginazione tramite cursore (`startAfter`). La rilevanza viene calcolata per ogni query anziché essere memorizzata, quindi non c'è alcun valore sulla riga del cursore con cui confrontare la pagina successiva, e due richieste con stringhe di ricerca diverse producono punteggi che non sono sulla stessa scala. Utilizza `limit`/`offset` per pagine ordinate per rilevanza.

## Perché questa riga ha fornito una corrispondenza?

Un elenco ordinato per rilevanza ti dice *quali* righe corrispondono, mai *perché* una di esse sia presente. Chiedi a ciascuna riga di spiegarsi:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` è il percorso esattamente come dichiarato in `fields`, in modo da poterlo mappare su un'etichetta per la visualizzazione. I campi vengono restituiti nell'ordine in cui sono stati dichiarati.

Il calcolo viene fatto per singola query, non per collection, poiché il costo è legato alla query: una `ts_headline` per ogni campo dichiarato per ogni riga restituita, e `ts_headline` rianalizza il documento anziché leggere l'indice. Appropriato per una pagina di risultati, errato per un'esportazione.

**Lo snippet contiene markup per struttura** — ogni corrispondenza è avvolta in `<mark>`. Renderizzalo come HTML o rimuovi i tag, ma non trattarlo come testo semplice e non fidarti del testo circostante: è esattamente ciò che l'utente ha digitato. Suddividere la stringa su `<mark>` e renderizzare le parti è più sicuro rispetto all'uso di `dangerouslySetInnerHTML`.

Con `unaccent` attivo, gli snippet vengono letti senza accenti — `Auditoria`, non `Auditoría`. `ts_headline` sul testo originale non riesce a trovare la corrispondenza prodotta da una query priva di accenti, quindi restituirebbe il testo senza evidenziare nulla; uno snippet leggibile che evidenzia le corrispondenze è preferibile a uno più bello che silenziosamente non evidenzia nulla.

## Aggiungere il blocco a una collection attiva

La colonna generata viene aggiunta dalla verifica dello schema all'avvio, come qualsiasi altra colonna, e il suo indice viene creato con `CREATE INDEX CONCURRENTLY` in modo da non bloccare le scritture. L'aggiunta di una colonna generata *stored* riscrive la tabella, quindi su tabelle di grandi dimensioni pianificala come qualsiasi altra operazione di riscrittura.

## Motori supportati

Il blocco `search` è un'esclusiva di Postgres e viene rifiutato all'avvio sugli altri motori anziché essere ignorato silenziosamente. Le collection MongoDB mantengono il matching basato su regex; le collection Firestore utilizzano il controller esterno per la ricerca testo.

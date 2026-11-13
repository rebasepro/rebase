---
sourceHash: d75d6ec231ad3911
title: Filtraggio API REST
sidebar_label: Filtraggio
description: Filtra le richieste di elenco REST con operatori in stile PostgREST, gruppi or/and e il dialetto JSON where, e scopri come si combinano i filtri.
---

Usa i parametri di query in stile PostgREST per filtrare i risultati. Il formato è `?field=operator.value`:

```bash
# Exact match
GET /api/data/products?active=eq.true

# Comparison operators
GET /api/data/products?price=gt.100
GET /api/data/products?price=lte.50

# Multiple filters (AND)
GET /api/data/products?active=eq.true&price=gt.10

# IN operator — match any value in a set
GET /api/data/products?status=in.(draft,published)

# NOT IN
GET /api/data/products?status=nin.(archived,deleted)

# Array contains
GET /api/data/products?tags=cs.electronics

# Array contains any
GET /api/data/products?tags=csa.(electronics,books)

# Array contains all
GET /api/data/products?tags=csall.(electronics,refurbished)

# Array holds nothing outside the list
GET /api/data/products?tags=cd.(electronics,books,toys)
```

## Operatori di filtro

| Operatore | Significato | Esempio |
|----------|---------|---------|
| `eq` | Uguale a (`==`) | `?active=eq.true` |
| `neq` | Diverso da (`!=`) | `?status=neq.draft` |
| `gt` | Maggiore di (`>`) | `?price=gt.100` |
| `gte` | Maggiore o uguale a (`>=`) | `?price=gte.100` |
| `lt` | Minore di (`<`) | `?price=lt.50` |
| `lte` | Minore o uguale a (`<=`) | `?price=lte.50` |
| `in` | Presente nell'array | `?status=in.(a,b,c)` |
| `nin` | Non presente nell'array | `?status=nin.(a,b)` |
| `cs` | L'array contiene | `?tags=cs.value` |
| `csa` | L'array contiene almeno uno | `?tags=csa.(a,b)` |
| `csall` | L'array contiene tutti | `?tags=csall.(a,b)` |
| `cd` | Array contenuto da: nessun elemento al di fuori dell'elenco | `?tags=cd.(a,b)` |
| `like` | Corrispondenza di pattern, con distinzione tra maiuscole e minuscole (`like`) | `?sku=like.AB-%` |
| `ilike` | Corrispondenza di pattern, senza distinzione tra maiuscole e minuscole (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Non corrisponde al pattern (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Non corrisponde al pattern, senza distinzione tra maiuscole e minuscole (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La colonna è `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La colonna non è `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

I quattro operatori di pattern confrontano il testo. Una colonna enum viene confrontata in base al suo valore
(`?status=like.draft%25`); su un numero, una data o qualsiasi altra colonna che non sia
testo restituiscono un errore 400 `INVALID_FILTER_OPERATOR`.

`isnull` e `notnull` non accettano operandi: l'operatore costituisce l'intera condizione, e
`.null`, `.true`, `.false` o niente dopo il punto hanno tutti lo stesso significato. L'SDK
scrive `.null`, quindi questa è la dicitura che vedrai transitare in rete. Qualsiasi altra cosa
dopo il punto non viene considerata come un loro operando, quindi l'intera stringa viene letta come
valore: `?reason=notnull.reason` corrisponde al testo `notnull.reason`.

:::caution[`eq.null` è la stringa di quattro caratteri, non `IS NULL`]
`?deleted_at=eq.null` cerca il testo letterale `null`. In SQL `= NULL` non è
mai vero, quindi non esiste alcuna interpretazione di `eq.null` che possa equivalere a una verifica di nullità:
usa `isnull` a tale scopo. L'SDK serializza `.where("deleted_at", "==", null)` come
`isnull.null` esattamente per questo motivo.
:::

## Operatori logici

Usa `or`, `and` e `not` per condizioni complesse:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)

# NOT: everything that is not a discontinued in-stock item
GET /api/data/products?not=(discontinued.eq.true,stock.gt.0)
```

`not` nega la **congiunzione** delle sue condizioni: `not(a)` equivale a `NOT a`, e
`not(a,b)` a `NOT (a AND b)`. Viene compilato in un vero `NOT (...)` SQL anziché
in operatori invertiti: la logica SQL è a tre valori, quindi `NOT (a AND b)` e
`(NOT a) OR (NOT b)` cessano di coincidere non appena è coinvolto un NULL. Una negazione
quindi **include le righe la cui colonna è NULL**, che è ciò che significa `NOT`; aggiungi
un `notnull` in AND insieme a esso se non è questo il comportamento desiderato.

**Un gruppo per richiesta: `or` ha la precedenza su `and`, ed entrambi su `not`.** Sono
tre modalità di scrittura per lo stesso slot, non tre filtri distinti. Utilizza invece l'annidamento:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

I gruppi possono essere annidati fino a 32 livelli di profondità; oltre tale limite la richiesta viene rifiutata con
`INVALID_LOGICAL_GROUP`.

Una condizione all'interno di un gruppo con un operatore non supportato dal dialetto —
`?not=(title.contains.x)` — genera un errore 400 `UNKNOWN_FILTER_OPERATOR`, esattamente come avviene in un
`where` JSON. Non viene letta come un'uguaglianza su `contains.x`, che all'interno di `not`
avrebbe trovato corrispondenza con ogni riga.

Un gruppo applica un **ulteriore filtro di restringimento** insieme ai filtri di campo anziché sostituirli: vedi
[Come si combinano i filtri](#come-si-combinano-i-filtri).

## Il dialetto JSON `where`

I filtri sui campi descritti sopra rappresentano uno dei due modi per inviare un filtro. L'altro consiste in un
singolo oggetto JSON, che è quanto documentato dalla specifica OpenAPI per ogni
`GET /api/data/{slug}` e quanto accettato dalle route annidate:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Ciascuna chiave è un campo, ciascun valore una tupla canonica `[operator, value]` — le stesse
tuple scritte dall'SDK. Un valore può anche essere una stringa con punto pre-serializzata
(`{"status":"eq.active"}`) o un semplice valore scalare (`{"status":"active"}`); tutte e tre
compilano nella medesima condizione. Un array di valori semplici equivale a un `in` implicito: `{"category":["electronics","gadgets"]}` viene interpretato come
`["in", ["electronics","gadgets"]]`, mentre un primo elemento con la forma di operatore che
non sia un operatore reale (`["!!","x"]`) restituisce un errore 400 `UNKNOWN_FILTER_OPERATOR`.

Lo stesso oggetto viene interpretato allo stesso modo ovunque venga ricevuto: qui, nel
`where` dell'SDK, in una query MCP e nel `filter` del socket realtime — nelle sue richieste list e
count e nelle sue sottoscrizioni live.

La differenza importante da considerare: **il JSON mantiene i tipi.** `?price=gte.100` invia la
stringa `"100"` e il driver ne esegue il cast in base al tipo di colonna, mentre
`?where={"price":[">=",100]}` invia un numero. Per una colonna la cui interpretazione testuale e
numerica differiscono — una stringa di versione, un codice con zeri iniziali — questo è il
parametro ideale da utilizzare.

Un `where` malformato genera un errore 400 `INVALID_WHERE`, non un filtro ignorato silenziosamente:
ignorarlo eseguirebbe la lettura senza filtri restituendo tutto ciò che la row-level
security consente di visualizzare.

## Come si combinano i filtri

`?field=op.value`, `?where=`, `?or=`/`?and=`/`?not=` e `?searchString=` sono
indipendenti, e ciascuno di essi presente deve trovare corrispondenza:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

L'unica eccezione è un campo specificato sia in `?field=op.value` che in `where`: in questo caso
il parametro di query **sostituisce** la condizione `where` su quel campo, trattandosi della
richiesta più specifica, invece di essere combinato in AND con essa.

Non è possibile applicare un OR tra di essi. Tutto ciò che non è un semplice AND di
questi gruppi deve essere inserito all'interno di un unico albero `or=`/`and=`.

## Passaggi successivi

- **[REST API](/docs/backend/api)** — Endpoint, ordinamento, paginazione e inclusione delle relazioni
- **[Interrogazione dei dati](/docs/sdk/querying)** — Gli stessi filtri dall'SDK tipizzato

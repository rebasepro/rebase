---
sourceHash: ebc75b9bd33595a6
title: Filtraggio nell'API REST
sidebar_label: Filtraggio
description: Filtra le liste dell'API REST con operatori in stile PostgREST, gruppi or/and e il dialetto JSON where, e scopri come si combinano i filtri.
---

Utilizza i parametri di query in stile PostgREST per filtrare i risultati. Il formato è `?field=operator.value`:

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
```

## Operatori di filtro

| Operatore | Significato | Esempio |
|-----------|-------------|---------|
| `eq` | Uguale a (`==`) | `?active=eq.true` |
| `neq` | Diverso da (`!=`) | `?status=neq.draft` |
| `gt` | Maggiore di (`>`) | `?price=gt.100` |
| `gte` | Maggiore o uguale a (`>=`) | `?price=gte.100` |
| `lt` | Minore di (`<`) | `?price=lt.50` |
| `lte` | Minore o uguale a (`<=`) | `?price=lte.50` |
| `in` | Nell'array | `?status=in.(a,b,c)` |
| `nin` | Non nell'array | `?status=nin.(a,b)` |
| `cs` | L'array contiene | `?tags=cs.value` |
| `csa` | L'array contiene almeno uno | `?tags=csa.(a,b)` |
| `like` | Corrispondenza di pattern, con distinzione tra maiuscole e minuscole (`like`) | `?sku=like.AB-%` |
| `ilike` | Corrispondenza di pattern, senza distinzione tra maiuscole e minuscole (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Non corrisponde al pattern (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Non corrisponde, senza distinzione tra maiuscole e minuscole (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La colonna è `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La colonna non è `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

I quattro operatori di pattern confrontano testo. Una colonna enum viene confrontata
per valore (`?status=like.draft%25`); su un numero, una data o qualsiasi altra colonna
che non sia testo sono un 400 `INVALID_FILTER_OPERATOR`.

`isnull` e `notnull` ignorano il rispettivo valore — l'operatore costituisce l'intera condizione e qualsiasi cosa dopo il punto viene scartata. L'SDK scrive `.null`, quindi è questa la dicitura che vedrai transitare in rete.

:::caution[`eq.null` è la stringa di quattro caratteri, non `IS NULL`]
`?deleted_at=eq.null` cerca il testo letterale `null`. In SQL `= NULL` non è mai vero, quindi nessuna interpretazione di `eq.null` può indicare il test di nullità — usa `isnull` per quello scopo. L'SDK serializza `.where("deleted_at", "==", null)` come `isnull.null` esattamente per questo motivo.
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

`not` nega la **congiunzione** delle sue condizioni: `not(a)` equivale a `NOT a`, e `not(a,b)` a `NOT (a AND b)`. Viene compilato in un vero `NOT (...)` SQL anziché in operatori invertiti — la logica SQL è a tre valori, quindi `NOT (a AND b)` e `(NOT a) OR (NOT b)` smettono di coincidere non appena entra in gioco un NULL. Una negazione quindi **include le righe la cui colonna è NULL**, che è ciò che significa `NOT`; aggiungi un `notnull` in AND se non è questo il comportamento desiderato.

**Un solo gruppo per richiesta: `or` prevale su `and`, ed entrambi prevalgono su `not`.** Sono tre formulazioni dello stesso slot, non tre filtri separati. Usa invece l'annidamento:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

I gruppi possono essere annidati fino a 32 livelli di profondità; oltre questo limite la richiesta viene rifiutata con `INVALID_LOGICAL_GROUP`.

Una condizione dentro un gruppo il cui operatore il dialetto non conosce —
`?not=(title.contains.x)` — è un 400 `UNKNOWN_FILTER_OPERATOR`, come in un `where`
JSON. Non viene letta come uguaglianza su `contains.x`, che dentro `not` avrebbe
corrisposto a ogni riga.

Un gruppo **restringe** i risultati insieme ai filtri di campo anziché sostituirli — vedi [Come si combinano i filtri](#come-si-combinano-i-filtri).

## Il dialetto JSON `where`

I filtri di campo sopra descritti sono uno dei due modi per inviare un filtro. L'altro consiste in un singolo oggetto JSON, che è ciò che il documento OpenAPI pubblica su ogni `GET /api/data/{slug}` e ciò che accettano le route di subcollection annidate:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Ogni chiave è un campo, ogni valore è una tupla canonica `[operator, value]` — le stesse tuple scritte dall'SDK. Un valore può anche essere una stringa con notazione a punto pre-serializzata (`{"status":"eq.active"}`) o uno scalare semplice (`{"status":"active"}`); tutte e tre le varianti compilano nella stessa condizione. Un array di valori semplici è un `in` implicito: `{"category":["electronics","gadgets"]}` si legge come
`["in", ["electronics","gadgets"]]`, mentre un primo elemento che ha la forma di un operatore ma non è un operatore reale
(`["!!","x"]`) è un 400 `UNKNOWN_FILTER_OPERATOR`.

Lo stesso oggetto viene letto allo stesso modo ovunque arrivi: qui, nel `where` dell'SDK, in una query MCP e nel
`filter` del socket realtime — nelle sue richieste di elenco e di conteggio e nelle sue sottoscrizioni live.

La differenza fondamentale da conoscere: **JSON trasporta i tipi.** `?price=gte.100` invia la stringa `"100"` e il driver ne effettua il cast in base al tipo di colonna, mentre `?where={"price":[">=",100]}` invia un numero. Per una colonna la cui interpretazione testuale e numerica differisce — una stringa di versione, un codice con padding di zeri — questo è il parametro a cui affidarsi.

Un `where` malformato restituisce un errore 400 `INVALID_WHERE`, e non un filtro ignorato silenziosamente: scartarlo significherebbe eseguire la lettura senza filtri e restituire tutto ciò che la row-level security consente di leggere.

## Come si combinano i filtri

`?field=op.value`, `?where=`, `?or=`/`?and=` e `?searchString=` sono indipendenti, e ciascuno di essi presente deve corrispondere:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Non c'è modo di applicare l'operatore OR tra questi gruppi. Qualsiasi condizione che non sia un semplice AND di questi gruppi deve essere inserita all'interno di un unico albero `or=`/`and=`.

## Passaggi successivi

- **[API REST](/docs/backend/api)** — Endpoint, ordinamento, paginazione e inclusione delle relazioni
- **[Interrogare i dati](/docs/sdk/querying)** — Gli stessi filtri dall'SDK tipizzato

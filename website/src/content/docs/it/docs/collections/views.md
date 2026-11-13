---
sourceHash: 8a72cff37e30800b
title: Viste
sidebar_label: Viste
description: "Fornisci una vista SQL o una vista materializzata in sola lettura con defineView: viste security_invoker regolate dalle tabelle da cui leggono, viste materializzate limitate dai ruoli, aggiornate su richiesta, create da db push."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

`defineView` espone una query SQL come tabella in sola lettura. Dichiara la query, le
colonne che restituisce e la colonna o le colonne che identificano una riga:

```ts
// backend/schema/artist-stats.ts
import { defineView, col } from "@rebasepro/server/schema";

export const artistStats = defineView("artist_stats", {
    query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
            FROM songs GROUP BY 1`,
    columns: {
        artist: col.text().primaryKey(),
        songs:  col.integer().notNull(),
        fame:   col.integer(),
    },
});
```

Esportala da `backend/schema/index.ts` come una tabella. Si legge come qualsiasi
tabella — `find`, `findById`, `count`, [`aggregate`](/docs/sdk/aggregates-and-search/),
`listen`, le route REST, MCP e il CMS — e non viene mai modificata in scrittura: ogni
scrittura restituisce un `405 TABLE_READ_ONLY`. Scrivi nelle tabelle da cui la vista legge.

`rebase db push` crea la vista dopo le tabelle, `rebase db generate`
la accoda alla migrazione e un avvio gestito la crea nel relativo passaggio dello schema.
Una vista la cui query non è cambiata non viene toccata; una la cui query è cambiata viene
eliminata e ricreata, insieme a qualsiasi altra vista che la legge.
Rebase rifiuta di sostituire una tabella, o una vista che non ha creato, avente già
lo stesso nome.

## Opzioni

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Chiave | Descrizione |
|---|---|
| `query` | **Obbligatorio.** Il `SELECT` di definizione. |
| `columns` | **Obbligatorio.** Le colonne restituite dalla query, come builder `col.*`. `.primaryKey()` contrassegna quelle che identificano una riga. |
| `materialized` | `true` memorizza le righe. Consulta [Viste materializzate](#viste-materializzate). |
| `roles` | Chi può leggere una vista materializzata. `["admin"]` se omesso. Rifiutato su una vista semplice. |
| `table` | Il nome della vista SQL, quando differisce dal nome. |
| `slug` | Il nome nell'API. Il nome della vista se omesso. |
| `schema` | Lo schema Postgres. `public` se omesso. |
| `database` | Un database Postgres non predefinito. |
| `description` | Ciò che contiene la vista, per OpenAPI e MCP. |
| `relations` | Relazioni da consultare, come su una tabella. Nessun vincolo viene creato per una vista. |
| `indexes` | Indici sulle righe memorizzate di una vista materializzata. |
| `hooks` | Solo `beforeQuery` e `afterRead`. Consulta [Hook di tabella](/docs/collections/callbacks/). |
| `metadata` | Qualsiasi dato che desideri fornire con il descrittore della vista. |

Una vista ha almeno una colonna `.primaryKey()`: una vista non ha una chiave propria
e una riga ha bisogno di un indirizzo.

## Chi vede quali righe

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una vista semplice viene creata `WITH (security_invoker = true)`, quindi viene eseguita **come il
chiamante**: la row-level security delle tabelle da cui legge decide cosa vede ciascun
chiamante. Un utente i cui criteri mostrano solo le proprie canzoni vedrà la vista delle
proprie canzoni. Questo è il motivo per cui una vista non ha `rls`: non c'è nulla a cui associare
criteri e nulla che essi possano aggiungere. Consulta
[Row-level security](/docs/collections/security-rules/) per i criteri sulle
tabelle sottostanti.

## Viste materializzate

<span class="since-badge" data-since="0.31">Da 0.31</span>

`materialized: true` memorizza le righe, quindi una lettura non esegue la query:

```ts
import { defineView, col } from "@rebasepro/server/schema";

export const langs = defineView("langs", {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"],
    columns: {
        lang:  col.text().primaryKey(),
        songs: col.integer().notNull(),
    },
    indexes: [{ columns: ["songs"], reason: "the most-used languages first" }],
});
```

Postgres non applica la row-level security a una vista materializzata: chiunque abbia il permesso
di leggerla la legge per intero. Pertanto, Rebase la serve solo ai chiamanti che possiedono uno dei `roles`
(`["admin"]` se omesso, che `dataAsAdmin` possiede) e rifiuta chiunque altro
con `403 VIEW_NOT_READABLE`. Non inserire al suo interno nulla che i relativi lettori non debbano vedere.

La regola viene applicata anche nel database, quindi anche il [SQL eseguito come chiamante](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller)
la rispetta. Le righe sono memorizzate in `<view>_rebase_rows`, che solo il
proprietario del database può leggere, e il nome stesso della vista è una vista su di esse che
restituisce righe solo a un chiamante che possiede uno dei `roles`, e al server stesso
(`rebase.sql()`, cron). Interroga il nome della vista, mai le righe memorizzate.

Le righe corrispondono all'ultimo aggiornamento. Esegui l'aggiornamento con `refresh()` — sul server
come `rebase.dataAsAdmin.langs.refresh()`, oppure da un client autenticato con uno
dei ruoli — o tramite HTTP:

```typescript
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` continua a servire le vecchie righe mentre quelle nuove vengono calcolate. Richiede
l'indice univoco creato da Rebase sulle colonne `.primaryKey()`, quindi queste
devono essere univoche nel risultato della query. Per eseguire l'aggiornamento secondo una pianificazione, chiama
`refresh()` da un [cron job](/docs/backend/cron-jobs/). Una vista materializzata può
avere propri `indexes` (consulta [Indici](/docs/backend/indexes/)), creati sulle sue
righe memorizzate; una vista semplice legge gli indici delle sue tabelle.

## Cosa non può avere una vista

<span class="since-badge" data-since="0.31">Da 0.31</span>

`rls`, `history`, `softDelete`, `tenant` e `search` vengono rifiutati durante la
compilazione dello schema: ciascuno richiede una tabella in cui scrivere o a cui associare criteri.
L'uso di `roles` su una vista semplice viene rifiutato al caricamento del modulo, così come una
`query` vuota. `indexes` su una vista semplice viene rifiutato durante la compilazione dello schema.

Un `listen` su una vista riceve notifica di un `refresh()`. Una scrittura sulle tabelle sottostanti a una vista
non raggiunge i sottoscrittori della vista: sottoscriviti alle tabelle o rileggi la
vista.

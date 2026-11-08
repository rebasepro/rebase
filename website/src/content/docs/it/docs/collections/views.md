---
sourceHash: 040afb7b119d3d2a
title: Viste
sidebar_label: Viste
description: Servi una vista SQL o una vista materializzata come collection in sola lettura, dichiarata nella configurazione e creata da db push.
---

## Una collection su una query

Una collection può servire una vista SQL invece di una tabella. Dichiara la query sotto
`view`, descrivi le sue colonne come proprietà e contrassegna con `isId` quella che
identifica una riga — una vista non ha una chiave primaria propria:

```ts
import { defineCollection } from "@rebasepro/cms-types";

export default defineCollection({
    slug: "artists",
    name: "Artists",
    table: "artist_stats",
    view: {
        query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
                FROM songs GROUP BY 1`
    },
    properties: {
        artist: { name: "Artist", type: "string", isId: true },
        songs: { name: "Songs", type: "number" },
        fame: { name: "Fame", type: "number" }
    }
});
```

Si legge come qualsiasi altra collection — `find`, `findById`, `count`,
[`aggregate`](/docs/sdk/aggregates-and-search/),
`listen`, le route REST, MCP e il pannello di amministrazione — ed è in sola lettura: ogni
scrittura è un `405 COLLECTION_READ_ONLY`, e il pannello non offre creazione, modifica né
eliminazione. Scrivi nelle tabelle lette dalla vista.

`rebase db push` crea la vista dopo le tabelle (la applica Rebase, non Atlas),
`rebase db generate` la aggiunge alla migrazione, e un avvio gestito la crea nel
proprio passaggio di schema. Una vista la cui query non è cambiata viene lasciata
com'è; una la cui query è cambiata viene eliminata e creata di nuovo, insieme a
tutte le tue viste che la leggono. Rebase si rifiuta di sostituire una tabella, o una vista che
non ha creato, che porta già quel nome.

## Chi vede quali righe

Una vista semplice viene eseguita **come il chiamante** (`security_invoker`), quindi le policy
delle tabelle che legge decidono cosa vede ciascun chiamante: un utente le cui policy gli
mostrano le proprie canzoni vede la vista delle proprie canzoni. Per questo
`securityRules` non può essere dichiarato su una vista — non c'è nulla a cui
associarle, e nulla che potrebbero aggiungere. Consulta [Regole di sicurezza](/docs/collections/security-rules/) per
le policy sulle tabelle sottostanti.

## Viste materializzate

`materialized: true` memorizza le righe, quindi una lettura non esegue la query:

```ts
view: {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"]
}
```

Postgres non applica alcuna row-level security a una vista materializzata: chi può leggerla
la legge tutta. Per questo Rebase la serve solo ai chiamanti che possiedono uno dei `roles`
(`["admin"]` se omesso, ruolo che `dataAsAdmin` possiede) e rifiuta tutti gli altri
con `403 VIEW_NOT_READABLE`. Non metterci nulla che i suoi lettori non possano vedere.

Le righe sono quelle dell'ultimo aggiornamento. Aggiorna con `refresh()` — sul server
come `rebase.dataAsAdmin.langs.refresh()`, oppure da un client autenticato con uno dei
ruoli — oppure via HTTP:

```ts
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` continua a servire le vecchie righe mentre vengono calcolate le nuove; richiede
l'indice univoco che Rebase crea sulle colonne `isId`, quindi queste devono essere
univoche nel risultato della query. Per aggiornare a intervalli regolari, chiama `refresh()` da un
[cron job](/docs/backend/cron-jobs/). Una vista materializzata può avere `indexes`
propri (vedi [Indici](/docs/backend/indexes/)); una vista semplice legge gli
indici delle sue tabelle.

## Cosa non può avere una vista

`securityRules`, `history`, `softDelete`, `tenant` e `search` vengono rifiutati
all'avvio, perché ciascuno richiede una tabella su cui scrivere o a cui associarsi.

Un `listen` su una vista viene a conoscenza di un `refresh()`. Una scrittura sulle tabelle sotto
una vista non raggiunge i sottoscrittori della vista: sottoscrivi le tabelle, oppure
rileggi la vista.

---
sourceHash: 239a291d53ade1fd
title: MongoDB
sidebar_label: MongoDB
description:"\"@rebasepro/server-mongo esegue Rebase su MongoDB: un data driver completo, realtime basato su change stream e cronologia snapshot — e nessuna sicurezza a livello di riga.\""
---

`@rebasepro/server-mongo` implementa il `BackendBootstrapper` di Rebase per
MongoDB. L'API REST, l'SDK generato, il pannello di amministrazione e la superficie
di autenticazione funzionano tutti su di esso.

:::caution[Sperimentale, e non dispone di sicurezza a livello di riga]
Leggi questa sezione prima di sceglierlo. MongoDB non ha un equivalente della
sicurezza a livello di riga (row-level security) di PostgreSQL, quindi **il modello
di isolamento su cui poggia il resto di Rebase non si applica qui**. Le `securityRules`
su una collezione non sono applicate dal database; l'autorizzazione corrisponde
esclusivamente ai controlli effettuati dal tuo codice.

Questa non è una lacuna in attesa di essere colmata: è una caratteristica del
motore. Se l'autorizzazione per riga applicata al di sotto dell'applicazione è il
motivo per cui stai valutando Rebase, usa il driver PostgreSQL — [Backend Setup](/docs/backend/)
è la sezione in cui viene configurato, e [Security Rules](/docs/collections/security-rules/)
è ciò che ti offre.
:::

## Installazione

```bash
pnpm add @rebasepro/server-mongo
```

```ts title="backend/src/index.ts" no-verify
import { rebase } from "@rebasepro/server";
import { createMongoBootstrapper } from "@rebasepro/server-mongo";

rebase({
    backend: createMongoBootstrapper({ url: process.env.DATABASE_URL! })
});
```

Imposta `DATABASE_URL` su una stringa di connessione MongoDB
(`mongodb://…` o `mongodb+srv://…`).

## Cosa funziona

| | |
|---|---|
| **Data API** | L'intera superficie REST: list, get, create, update, delete, filtri, ordinamento, paginazione |
| **Generated SDK** | Lo stesso client tipizzato disponibile su Postgres |
| **Realtime** | Change stream. Richiede un replica set — un `mongod` standalone non ha un oplog da seguire, quindi il realtime è silenziosamente non disponibile |
| **History** | Basata su snapshot, con la stessa struttura presente su Postgres |
| **Auth** | L'intera superficie di autenticazione, con i repository archiviati in MongoDB |
| **Admin panel** | Collezioni, moduli, relazioni nella UI, campi storage |

## Cosa c'è di diverso

- **Nessuna sicurezza a livello di riga.** Vedi l'avviso sopra. Questo è l'aspetto più importante.
- **Nessuna interfaccia SQL.** L'editor SQL di Studio, l'editor delle policy RLS e
  `pnpm rls:check` sono funzionalità esclusive di Postgres e non sono disponibili.
- **Nessuna integrità relazionale.** Una relazione è un riferimento memorizzato
  che l'applicazione risolve; non ci sono chiavi esterne (foreign key), quindi a
  livello di database nulla impedisce un riferimento orfano.
- **Nessun comando `rebase db push` / `generate` / `migrate`.** MongoDB non ha uno
  schema da migrare. Le collezioni vengono create man mano che i documenti vengono scritti.

## Scegliere tra i due

Scegli MongoDB quando i dati hanno intrinsecamente una struttura a documenti e il
modello di autorizzazione risiede comunque nella tua applicazione. Scegli PostgreSQL
quando vuoi che sia il database stesso ad applicare chi può vedere quale riga — che
è la tesi sostenuta da Rebase in qualsiasi altra parte di questo sito.

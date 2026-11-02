---
sourceHash: a43be9786395a654
title: Solo backend (headless)
sidebar_label: Solo backend
description: Esegui Rebase come Backend-as-a-Service headless sul tuo database PostgreSQL esistente — API REST, autenticazione, storage e realtime, senza pannello di amministrazione e senza file di collezioni.
---

Rebase ha due forme, e questa pagina è quella che non apre mai un browser:
un'API REST, autenticazione, storage, realtime e backup su un database PostgreSQL
già esistente. Nessun pannello di amministrazione, nessun file di collezione. Se stavi
valutando Supabase o PostgREST, questa è la soluzione equivalente.

Tutto ciò che si trova in questa pagina funziona anche nel progetto completo — il server
è lo stesso. Ciò che `--headless` rimuove è il pacchetto frontend e i file delle
collezioni, non una funzionalità.

## Genera lo scaffolding

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Due workspace, nessun `frontend/`:

| Cartella | Contenuto |
|----------|-----------|
| `backend/` | Le tue funzioni personalizzate e i cron job. Non c'è alcun file server — il runtime pubblicato avvia il progetto |
| `config/` | `storageAuthorize` ed eventuali collezioni generate da `--introspect` |

`--template` non ha alcun effetto qui: un preset genera file di collezione di partenza,
e questa variante non ne ha. Node 22.22+, lo stesso requisito minimo del progetto completo —
il `package.json` dell'overlay headless dichiara `"node": ">=22.22.0"` e sostituisce quello
sottostante.

## Collegalo al tuo database

`init` genera un file `.env` pronto all'uso. Per utilizzare un database che hai già in
esecuzione, passa il suo URL durante lo scaffolding:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Oppure imposta `DATABASE_URL` in `.env` successivamente — è la stessa cosa. Senza
`DATABASE_URL`, `rebase dev` avvia un PostgreSQL gestito (PGlite) nella directory
del progetto, utile per provare l'API ma non per lo scopo di questa variante.

Poi:

```bash
pnpm install
pnpm run dev
```

**Leggi l'URL dall'output.** `rebase dev` ricava una porta libera dal percorso del
progetto anziché usarne una fissa, quindi varia da un progetto all'altro e tra
macchine diverse.

## Da dove provengono le collezioni

Non ce n'è nessuna nel codice. Il server legge lo schema del tuo database all'avvio
ed espone le tabelle che trova, quindi l'API segue le tue migrazioni: modifica lo
schema e gli endpoint cambieranno di conseguenza.

Una tabella viene esposta una volta abilitata la Row-Level Security (RLS) su di essa.
Senza alcuna policy viene esposta ma non restituisce alcuna riga, e l'avvio mostrerà
un avviso; una policy ne consente l'accesso:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` e `rebase.jwt()` sono installati da Rebase e
leggono l'identità della richiesta autenticata. Consulta le
[Regole di sicurezza](/docs/collections/security-rules/) per il vocabolario delle policy
e [rls-check](/docs/rls-check/) per un controllo di ciò che le tue policy consentono
effettivamente.

Una tabella senza RLS viene **ignorata**, deliberatamente: ogni richiesta autenticata
viene eseguita come `rebase_user`, quindi esporre una tabella non protetta dalla
row-level security consegnerebbe ogni riga a qualsiasi chiamante autenticato. Ogni
tabella ignorata viene indicata all'avvio insieme all'SQL necessario per proteggerla.

Una tabella di join non viene comunque esposta, poiché non diventa mai una collezione.
Anche quelle con RLS disabilitata vengono indicate all'avvio.

Il controllo viene eseguito all'avvio. Se la RLS viene disabilitata successivamente
su una tabella esposta, questa rimarrà esposta finché il riavvio successivo non la
ignorerà. L'[audit programmato](/docs/rls-check/) la segnala prima, ed è disabilitato
per impostazione predefinita.

:::note
`baas: { unprotectedTables: "serve" }` le espone comunque. È un'opzione di
`initializeRebaseBackend`, quindi accessibile solo dopo aver eseguito `rebase eject` —
il runtime gestito non la legge da `config/index.ts` o dall'ambiente. Ha senso
solo quando ogni chiamante è già fidato.
:::

### Generare invece i file di collezione

Se preferisci avere le tabelle definite in TypeScript — per i tipi, i callback
o la revisione del codice — eseguine l'introspezione:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implica `--template blank` e richiede `--install`, poiché viene
eseguito tramite la CLI installata. In un progetto esistente il comando equivalente è:

```bash
pnpm rebase schema introspect
```

I file vengono salvati in `config/collections/`. Da quel momento in poi, il progetto
ha collezioni definite nel codice e l'introspezione all'avvio smette di essere ciò
che definisce l'API.

Lo scaffolding headless installa Atlas in `backend/`, quindi `rebase db push`,
`rebase db generate` e `pnpm run db:migrate` funzionano su quelle collezioni come in
qualsiasi progetto. Nella versione 0.24 ciascuno di essi si interrompe con
"The atlas binary is missing"; aggiungilo al backend con
`pnpm --dir backend add @ariga/atlas`.

## Utilizzo

Tramite HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Oppure con il client type-safe, che è già una dipendenza dello scaffolding headless:

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.collection("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [API REST](/docs/backend/api/) — la struttura degli endpoint, filtri ed errori
- [SDK tipizzato](/docs/sdk/) — query, autenticazione, realtime, storage
- `/api/docs` e `/api/swagger` — il documento OpenAPI e il relativo viewer,
  serviti dal backend in esecuzione una volta presente una collezione. Un progetto
  che non ne ha non espone nessuno dei due: il documento viene generato dalle collezioni,
  quindi non c'è nulla da descrivere finché la sezione precedente non è stata eseguita

## `404 NO_COLLECTIONS`

Se ogni richiesta di dati risponde con questo:

```json
{
  "error": {
    "message": "This project serves no collections yet. …",
    "code": "NO_COLLECTIONS"
  }
}
```

significa che il progetto non dichiara alcuna collezione nel codice *e* il database
non ha fornito nulla da cui ricavarle. È la normale prima risposta di un progetto
headless collegato a un database vuoto, ed è un errore 404 anziché un 500 perché
non c'è nulla di rotto — semplicemente non c'è ancora nulla da servire.

Tre passaggi per risolverlo, nell'ordine consigliato di verifica:

1. **Il database non ha tabelle.** Creale — tramite una migrazione, semplice SQL
   o un file di collezione insieme a `rebase db push` — e riavvia.
2. **Le tabelle non hanno la Row-Level Security abilitata**, quindi l'avvio le ha
   ignorate. Il log di avvio ne indica ciascuna, insieme all'SQL. Abilitala e aggiungi
   una policy, come mostrato sopra. Anche la risposta lo segnala: il messaggio indica
   le tabelle e fornisce per esse l'`ALTER TABLE … ENABLE ROW LEVEL SECURITY`, e
   `details.unprotectedTables` le elenca. Nella versione 0.24 indica semplicemente
   che il database non ha tabelle.
3. **`DATABASE_URL` punta altrove** rispetto a quanto pensi. `rebase status`
   stampa i tre file che determinano ciò a cui il backend si collega.

## Aggiungere un pannello di amministrazione in seguito

Nulla qui ti impedisce di farlo. Aggiungi una directory `config/collections/` —
manualmente o con `rebase schema introspect` — e un frontend che le visualizzi;
il backend non cambia. La guida [Configurazione Frontend](/docs/frontend/) è il
punto di partenza.

## Prossimi passi

- [Autenticazione](/docs/backend/authentication/) — provider, token, chiavi API
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/) — il modello di accesso
- [Funzioni personalizzate](/docs/backend/custom-functions/) — le tue route
- [Distribuzione](/docs/getting-started/deployment/) — portare il progetto in produzione

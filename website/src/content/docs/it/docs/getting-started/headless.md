---
sourceHash: 9cda7971a27b0475
title: Solo backend (headless)
sidebar_label: Solo backend
description: Esegui Rebase come Backend-as-a-Service headless sul tuo PostgreSQL — API REST, autenticazione, storage e realtime, senza pannello di amministrazione e senza backend/schema.
---

Rebase ha due forme, e questa pagina riguarda quella che non apre mai un browser: un'API
REST, autenticazione, storage, realtime e backup su un database PostgreSQL che
già possiedi. Nessun pannello di amministrazione, nessun `backend/schema/`. Se stavi
pensando a Supabase o PostgREST, questa è l'opzione analoga.

Tutto ciò che si trova in questa pagina funziona anche nel progetto completo — si tratta dello stesso server.
Ciò che `--headless` rimuove sono il pacchetto frontend e i file delle tabelle, non
una funzionalità.

## Crea lo scaffold

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Un unico workspace, nessun `frontend/`:

| Cartella | Cosa contiene |
|----------|---------------|
| `backend/` | `storage.ts` (`storageAuthorize`), le tue funzioni personalizzate e i cron, e la cartella `backend/schema/` scritta da `--introspect`, quando richiesto. Non è presente alcun file server — il runtime pubblicato avvia il progetto |

`--template` non ha alcun effetto qui: un preset precompila le tabelle, e questa variante non ne ha.
Richiede Node 22.22+, lo stesso requisito minimo del progetto completo — il `package.json`
dell'overlay headless dichiara `"node": ">=22.22.0"` e sostituisce quello
sottostante.

## Collegalo al tuo database

`init` genera un `.env` pronto all'uso. Per utilizzare un database già esistente, passa
il suo URL durante lo scaffold:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Oppure imposta `DATABASE_URL` in `.env` successivamente — è la stessa cosa. Senza
`DATABASE_URL`, `rebase dev` avvia un PostgreSQL gestito (PGlite) nella directory
del progetto, utile per testare l'API ma non è lo scopo principale di questa
variante.

Poi:

```bash
pnpm install
pnpm run dev
```

**Controlla l'URL dall'output.** `rebase dev` ricava una porta libera dal
percorso del progetto invece di usarne una fissa, quindi differisce tra progetti diversi e
tra macchine diverse.

## Da dove provengono le tabelle

<span class="since-badge" data-since="0.31">Da 0.31</span>

Non ce n'è alcuna nel codice: senza `backend/schema/index.ts`, il backend non dichiara alcuna tabella. Il server legge lo schema del tuo database all'avvio e serve
le tabelle che trova, quindi l'API segue le tue migrazioni: modifica lo schema e
gli endpoint cambieranno di conseguenza.

Una tabella viene servita quando su di essa è abilitata la row-level security. Senza alcuna policy
viene servita ma non restituisce alcuna riga, e l'avvio genera un avviso al riguardo; una policy consente di aprirla:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` e `rebase.jwt()` vengono installati da Rebase e
leggono l'identità della richiesta autenticata. Consulta
[Row-level security](/docs/collections/security-rules/) per il vocabolario delle policy,
e [rls-check](/docs/rls-check/) per un audit di ciò che le tue policy consentono
effettivamente.

Una tabella senza RLS viene **ignorata**, deliberatamente: ogni richiesta autenticata
viene eseguita come `rebase_user`, quindi servire una tabella non protetta dalla row-level security
esporrebbe ogni riga a qualsiasi chiamante autenticato. Ogni tabella ignorata viene indicata all'avvio insieme al codice SQL
necessario per proteggerla.

Una tabella di join non viene servita in ogni caso: viene letta come collegamento tra le due
tabelle che unisce. Se ha la RLS disattivata, viene comunque segnalata all'avvio.

Il controllo viene eseguito all'avvio. Se la RLS viene disabilitata successivamente su una tabella servita, questa rimane
servita finché il riavvio successivo non la ignora. L'[audit programmato](/docs/rls-check/)
la segnala prima, ed è disattivato per impostazione predefinita.

:::note
`baas: { unprotectedTables: "serve" }` le serve comunque. Si tratta di un'opzione di
`initializeRebaseBackend`, quindi è accessibile solo dopo aver eseguito `rebase eject` —
il runtime gestito non la legge da alcun file o dall'ambiente. Ha senso solo quando ogni chiamante è già ritenuto affidabile.
:::

### Generare invece i file delle tabelle

<span class="since-badge" data-since="0.31">Da 0.31</span>

Se preferisci avere le tabelle definite in TypeScript — per i tipi, per
gli hook, per la revisione del codice — esegui l'introspezione:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implica `--template blank` e richiede `--install`, poiché viene eseguito
tramite la CLI installata. In un progetto esistente il comando equivalente è:

```bash
pnpm rebase schema introspect
```

I file vengono inseriti in `backend/schema/`: un `defineTable` per ciascuna tabella, con le relative colonne,
relazioni e policy come `rls`, insieme a un file `index.ts` che le esporta. Da
quel momento il progetto contiene le tabelle nel codice e l'introspezione all'avvio cessa di
essere ciò che definisce l'API.

Lo scaffold headless
installa Atlas in `backend/`, quindi `rebase db push`, `rebase db generate`
e `pnpm run db:migrate` funzionano su tali tabelle esattamente come in qualsiasi altro progetto.

## Utilizzo

Tramite HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Oppure con il client type-safe, che è già una dipendenza dello scaffold
headless:

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.table("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [REST API](/docs/backend/api/) — la struttura degli endpoint, filtri ed errori
- [Typed SDK](/docs/sdk/) — query, autenticazione, realtime, storage
- `/api/docs` — il documento OpenAPI, servito dal backend in esecuzione una volta che
  serve almeno una tabella, a un chiamante autenticato (le tabelle che è autorizzato a visualizzare). Imposta
  `REBASE_ENABLE_SWAGGER=true` per pubblicarlo a tutti, con la Swagger UI
  su `/api/swagger` al di fuori dell'ambiente di produzione. Un progetto senza tabelle non serve
  nessuno dei due: il documento viene generato a partire dalle tabelle

## `404 NO_TABLES`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Se ogni richiesta di dati risponde in questo modo:

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

significa che il progetto non dichiara tabelle nel codice *e* il database non ha fornito
nulla da servire. Prima della 0.31 il codice era `NO_COLLECTIONS`. È la prima risposta prevista da un progetto
headless puntato verso un database vuoto, ed è un 404 invece di un 500 perché
non c'è alcun errore — semplicemente non c'è ancora nulla da servire.

Tre passaggi per risolverlo, nell'ordine consigliato di verifica:

1. **Il database non ha tabelle.** Creale — tramite una migrazione, SQL standard o un
   file `defineTable` con `rebase db push` — e riavvia.
2. **Le tabelle non hanno la row-level security abilitata**, quindi l'avvio le ha
   ignorate. Il log di avvio elenca ciascuna tabella con il relativo SQL. Abilitala e aggiungi una policy,
   come mostrato sopra. Anche la
   risposta lo indica: il messaggio cita i nomi delle tabelle e fornisce per esse il comando
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, mentre
   `details.unprotectedTables` le elenca.
3. **`DATABASE_URL` punta altrove** rispetto a quanto pensi. `rebase status`
   stampa i tre file che determinano a cosa si collega il backend.

## Aggiungere un pannello di amministrazione in seguito

Nulla qui ti impedisce di farlo. Aggiungi una cartella `frontend/` che monta `<RebaseCMS />`:
eseguirà il rendering di ogni tabella servita dal backend, a partire da `GET /api/schema/tables`, senza
bisogno di un file per tabella. Scrivi `backend/schema/` — a mano o con
`rebase schema introspect` — quando desideri avere le tabelle nel codice; le personalizzazioni del
pannello vanno inserite in `frontend/src/cms/`. Per iniziare, consulta [Frontend Setup](/docs/frontend/).

## Prossimi passi

- [Autenticazione](/docs/backend/authentication/) — provider, token, chiavi API
- [Row-level security](/docs/collections/security-rules/) — il modello di accesso
- [Custom Functions](/docs/backend/custom-functions/) — le tue route personalizzate
- [Deployment](/docs/getting-started/deployment/) — passaggio in produzione

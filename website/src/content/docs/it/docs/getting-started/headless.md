---
sourceHash: 213cc853c469bd0c
title: Solo backend (headless)
sidebar_label: Solo backend
description: Esegui Rebase come Backend-as-a-Service headless sul tuo database PostgreSQL — un'API REST, autenticazione, storage e realtime, senza pannello di amministrazione né file di collezione.
---

Rebase ha due forme, e questa pagina riguarda quella che non apre mai un browser:
un'API REST, autenticazione, storage, realtime e backup su un database PostgreSQL
già esistente. Nessun pannello di amministrazione, nessun file di collezione. Se stavi
pensando di usare Supabase o PostgREST, questa è l'alternativa equivalente.

Tutto ciò che si trova in questa pagina funziona anche nel progetto completo: il
server è lo stesso. Ciò che `--headless` rimuove è il pacchetto frontend e i file
delle collezioni, non una funzionalità.

## Esegui lo scaffold

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Due workspace, nessun `frontend/`:

| Cartella | Cosa contiene |
|----------|---------------|
| `backend/` | Le tue funzioni personalizzate e i cron. Non c'è alcun file server: il runtime pubblicato avvia il progetto |
| `config/` | `storageAuthorize` e qualsiasi collezione generata da `--introspect` |

`--template` non ha effetto qui: un preset genera file di collezione, mentre questa
variante non ne ha alcuno. Node 22.22+, lo stesso requisito minimo del progetto
completo: il `package.json` dell'overlay headless dichiara `"node": ">=22.22.0"`
e sostituisce quello sottostante.

## Collegalo al tuo database

`init` genera un file `.env` pronto all'uso. Per usare un database già attivo, passa
il suo URL durante lo scaffold:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Oppure imposta `DATABASE_URL` nel file `.env` in seguito: è la stessa cosa. Senza
`DATABASE_URL`, `rebase dev` avvia un'istanza PostgreSQL gestita (PGlite) nella directory
del progetto, utile per provare l'API ma non pensata per lo scopo di questa variante.

Quindi:

```bash
pnpm install
pnpm run dev
```

**Leggi l'URL dall'output.** `rebase dev` ricava una porta libera dal percorso del
progetto invece di usarne una fissa, quindi differisce da un progetto all'altro e
tra macchine diverse.

## Da dove provengono le collezioni

Nel codice non ce n'è nessuna. Il server legge lo schema del database all'avvio
ed espone le tabelle che trova, quindi l'API segue le tue migrazioni: modificando
lo schema, cambieranno anche gli endpoint.

Una tabella viene esposta solo dopo aver definito un modello di autorizzazione:
row-level security abilitata, più almeno una policy:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` e `rebase.jwt()` vengono installate da Rebase e
leggono l'identità della richiesta autenticata. Consulta
[Regole di sicurezza](/docs/collections/security-rules/) per il vocabolario delle policy
e [rls-check](/docs/rls-check/) per un audit su cosa permettono effettivamente le tue policy.

Una tabella senza RLS viene **ignorata**, deliberatamente: ogni richiesta autenticata
viene eseguita come `rebase_user`, quindi esporre una tabella priva di policy
consegnerebbe ogni riga a qualsiasi utente autenticato. Ogni tabella ignorata viene
indicata all'avvio insieme al codice SQL necessario per proteggerla.

:::note
`baas: { unprotectedTables: "serve" }` le espone comunque. Si tratta di un'opzione di
`initializeRebaseBackend`, quindi è accessibile solo dopo `rebase eject`: il runtime
gestito non la legge da `config/index.ts` né dall'ambiente. Ha senso solo se ogni
chiamante è già fidato.
:::

### Generare invece i file di collezione

Se preferisci avere le tabelle scritte in TypeScript — per i tipi, per i callback,
per la revisione — esegui l'introspezione:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implica `--template blank` e richiede `--install`, poiché viene
eseguito tramite la CLI installata. In un progetto esistente il comando equivalente è:

```bash
pnpm rebase schema introspect
```

I file vengono salvati in `config/collections/`. Da quel momento il progetto include le
collezioni nel codice e l'introspezione all'avvio smette di definire l'API.

## Utilizzo

Tramite HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Oppure tramite il client type-safe, che fa già parte delle dipendenze dello scaffold
headless:

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

- [API REST](/docs/backend/api/) — struttura degli endpoint, filtri ed errori
- [SDK Client](/docs/sdk/) — query, autenticazione, realtime, storage
- `/api/docs` e `/api/swagger` — il documento OpenAPI e il rispettivo visualizzatore,
  serviti dal backend in esecuzione una volta presente una collezione. Un progetto
  che non ne ha non fornisce nessuno dei due: il documento viene generato dalle collezioni,
  quindi non c'è nulla da descrivere finché la sezione precedente non è stata eseguita

## `404 NO_COLLECTIONS`

Se ogni richiesta di dati risponde in questo modo:

```json
{
  "error": {
    "message": "This project serves no collections yet. …",
    "code": "NO_COLLECTIONS"
  }
}
```

significa che il progetto non dichiara alcuna collezione nel codice *e* il database
non ha fornito elementi da cui ricavarle. È la prima risposta attesa da un progetto
headless puntato a un database vuoto, ed è un 404 anziché un 500 perché non c'è nulla
di rotto: semplicemente non c'è ancora nulla da esporre.

Tre fattori possono risolverlo, nell'ordine in cui vale la pena verificarli:

1. **Il database non ha tabelle.** Creale — tramite una migrazione, SQL puro, o un file
   di collezione insieme a `rebase db push` — e riavvia.
2. **Le tabelle non hanno alcuna policy RLS**, quindi l'avvio le ha ignorate. Il log di
   avvio elenca ciascuna di esse. Aggiungi una policy, come mostrato sopra.
3. **`DATABASE_URL` punta a una destinazione diversa** da quella prevista. `rebase status`
   stampa i tre file che determinano a cosa si connette il backend.

## Aggiungere un pannello di amministrazione in seguito

Nulla qui ti impedisce di farlo. Aggiungi una directory `config/collections/` —
manualmente o con `rebase schema introspect` — e un frontend che le visualizzi; il
backend non cambia. Si comincia da [Configurazione del frontend](/docs/frontend/).

## Prossimi passi

- [Autenticazione](/docs/backend/authentication/) — provider, token, chiavi API
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/) — il modello di accesso
- [Funzioni personalizzate](/docs/backend/custom-functions/) — le tue route
- [Deployment](/docs/getting-started/deployment/) — portare l'applicazione in produzione

---

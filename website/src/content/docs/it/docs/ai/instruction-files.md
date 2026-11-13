---
sourceHash: 80e40ea5912a48c8
title: File di istruzioni per l'IA
sidebar_label: File di istruzioni per l'IA
description: Ogni progetto Rebase creato include ai-instructions.md più file puntatore per Claude, Cursor, Windsurf, Copilot e AGENTS.md che contengono le cinque regole violate più spesso dagli assistenti — un'unica fonte di verità, molteplici nomi di file.
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Ogni assistente richiede le proprie regole in un file diverso. Claude Code legge
`CLAUDE.md`, Cursor legge `.cursorrules`, Windsurf legge `.windsurfrules`,
Copilot legge `.github/copilot-instructions.md` e la convenzione comune tra i vari vendor
è `AGENTS.md`. Mantenere le stesse direttive in cinque file diversi è il modo migliore per
ritrovarsene quattro non aggiornati.

`rebase init` scrive tutti e cinque — come **puntatori a un unico file che modifichi
effettivamente**:

```text
your-project/
├── ai-instructions.md            ← the real content
├── CLAUDE.md                     ← pointer
├── AGENTS.md                     ← pointer
├── .cursorrules                  ← pointer
├── .windsurfrules                ← pointer
└── .github/
    └── copilot-instructions.md   ← pointer
```

Ogni file puntatore indica il file reale, specifica dove si trovano le skill e contiene le cinque regole che un assistente non deve violare anche se non apre mai nient'altro:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a file in `backend/schema/`.** Declare it with `defineTable` from `@rebasepro/server/schema` — columns, relations and a required `rls` — export it from `backend/schema/index.ts`, and `pnpm dev` creates it. How it looks in the admin panel is a separate, optional file: `frontend/src/cms/<table>.tsx` with `customizeTable`, which imports the table as a type only. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and hooks, so keep it for server work that needs every row and for reading a column marked `.private()`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its file from `pnpm schema:introspect`. With no `backend/schema/` (a headless project) the database is the schema instead: ai-instructions.md says how to serve a table.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<table>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit `.env`, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`).
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Gli altri differiscono solo per la directory delle skill dell'agente e per il relativo valore di `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — e per
il percorso relativo, che è `../ai-instructions.md` in
`.github/copilot-instructions.md` e `ai-instructions.md` in `AGENTS.md`. La
terza riga è condizionale perché `rebase init --agent` potrebbe aver già
installato le skill prima ancora che l'assistente le legga.

Questo avviene a ogni `rebase init`, per qualsiasi preset compreso `--headless`.
Non ci sono flag né prompt interattivi.

`rebase init` genera inoltre `.mcp.json`, che indirizza Claude Code, Cursor e
qualsiasi altro client MCP verso il [server MCP di Rebase](/docs/ai/mcp) — la copia specifica
del progetto, una devDependency vincolata con la CLI (`npx --no rebase-mcp` in un progetto npm):

```json title=".mcp.json"
{
    "mcpServers": {
        "rebase": {
            "command": "pnpm",
            "args": ["exec", "rebase-mcp"],
            "env": {
                "REBASE_PROJECT_DIR": "."
            }
        }
    }
}
```

`REBASE_PROJECT_DIR` è `"."`, non un percorso assoluto: il client avvia il server
nella root del progetto, e un percorso assoluto è l'unica riga di quel file che
non può essere sottoposta a commit. Si trova lì perché `~/.rebase/projects.json` è
condiviso a livello di macchina — un progetto che non specifica una propria directory ricade su
qualunque cosa sia stata salvata dall'ultimo progetto utilizzato su quella macchina. Consulta
[l'ordine di precedenza](/docs/ai/mcp#which-directory-it-acts-on).

## Perché un puntatore invece di una copia

<span class="since-badge" data-since="0.31">Da 0.31</span>

I file puntatore non contengono quasi nulla. Un file che fa riferimento a quello reale mantiene le
convenzioni in un unico posto e presenta proprietà che una copia non ha:

- **Un solo file da modificare.** Le regole non possono divergere tra gli assistenti, perché esiste
  un unico insieme di regole.
- **Un solo diff da revisionare.** Una modifica alle convenzioni del progetto corrisponde alla modifica di un solo
  file, anziché di cinque file identici che un revisore dovrebbe confrontare.
- **Aggiungere un assistente richiede solo un piccolo file.** Un nuovo strumento con un nuovo nome file riceve
  un puntatore, non una sesta copia delle tue convenzioni.

L'unica eccezione è il blocco **Before you write any code**. Un assistente non
segue i link in modo affidabile: se è impegnato in un task scriverà prima il codice,
mentre uno avviato alla root di un repository in cui il progetto Rebase si trova in una
sottocartella non caricherà affatto questi file. Di conseguenza, le cinque regole la cui violazione crea
maggiori danni (una tabella creata in SQL invece che in `backend/schema`, dati letti e
scritti aggirando l'SDK, una route non protetta, un deploy, un file generato modificato manualmente)
vengono scritte identiche in ogni puntatore. Un controllo nella CI garantisce che le cinque
copie rimangano allineate.

Questo pattern merita di essere mantenuto se fai un fork dello scaffold, e vale la pena adottarlo anche in
repository che non sono affatto progetti Rebase.

## Cosa contiene inizialmente `ai-instructions.md`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il file generato dallo scaffold è volutamente breve — rimanda a
[`rebase skills install`](/docs/ai/skills) per approfondire, e poi elenca le regole che
gli assistenti sbagliano abbastanza spesso da meritare di essere ripetute all'inizio di ogni
sessione:

1. **Schema come codice.** Una tabella è una `defineTable` in `backend/schema/<table>.ts`,
   esportata da `backend/schema/index.ts` — solo ciò che l'indice esporta viene
   esposto — con un `rls` obbligatorio. Non modificare mai a mano lo schema Drizzle generato
   o le tabelle Postgres — vedi [Schema come codice](/docs/architecture/schema-as-code).
2. **L'applicazione delle modifiche allo schema** dipende dal database. Mentre `pnpm dev`
   è in esecuzione, salvare un file in `backend/schema/` è l'unico passaggio necessario:
   rigenera lo schema Drizzle e i tipi dell'SDK, e all'avvio vengono create le
   tabelle e le colonne mancanti. `pnpm db:push` serve solo per ciò che l'avvio tralascia
   deliberatamente — una colonna rinominata, un tipo ristretto, una colonna rimossa — sia
   sul database di sviluppo gestito che sul tuo PostgreSQL personale. Per la produzione si usano
   `pnpm db:generate` e poi `pnpm db:migrate`.
3. **Usa l'SDK.** Utilizza `rebase.dataAsAdmin.<table>` per le operazioni eseguite con l'identità
   di servizio, oppure `getDriver(c)` all'interno di una funzione quando la lettura deve essere eseguita
   come chiamante. Il client server non ha un semplice accessor `data`. L'SQL non elaborato e le chiamate dirette
   a Drizzle aggirano la validazione, gli hook e l'RLS.
4. **Proteggi ogni route personalizzata.** Le route in `backend/functions/` vengono montate
   *senza* autenticazione. Usa `requireAuth` / `requireAdmin` da
   `@rebasepro/server/functions` nello slot middleware della route stessa — leggere
   `c.get("user")` non costituisce una protezione, e nemmeno `app.use()` posizionato dopo la route.

Quest'ultima regola è fondamentale. Fa la differenza tra un middleware che viene eseguito
e uno che non lo è, e un assistente a cui non è stato detto scriverà
immancabilmente la versione che non lo fa — vedi
[Funzioni personalizzate](/docs/backend/custom-functions).

`requireAdmin` consente l'accesso solo al ruolo `admin`. Quando un ruolo più restrittivo o una chiave API
deve poter chiamare una route, la protezione da aggiungere è `requireScope`, con uno scope
dichiarato dall'applicazione — vedi [Ruoli e scope](/docs/backend/roles-and-scopes/#app-scopes).

Dopo le regole sono presenti due sezioni applicabili solo ad alcuni progetti. **Backend
runtime** elenca ciò che il runtime gestito su Rebase Cloud consente: pacchetti,
memoria e stato a livello di modulo, timeout, porte in uscita, configurazione e
storage per i file generati. Contiene un link a
[Runtime di backend gestito](/docs/deployment/managed-runtime/), in modo che l'assistente
pianifichi le funzionalità di backend tenendo conto dei limiti reali anziché tirare a indovinare. **Admin UI**
contiene le regole per `@rebasepro/ui`. Si applicano alle viste all'interno del pannello di amministrazione, non
a un sito pubblico o a un'applicazione statica servita dal progetto.

## Personalizzazione

`ai-instructions.md` è il tuo file. Nulla lo rigenera o lo sovrascrive — a differenza delle
[skill installate](/docs/ai/skills), che vengono sostituite a ogni
`rebase skills install`. Le convenzioni specifiche del progetto vanno inserite qui.

Ciò che merita di essere incluso è ciò che un assistente non può dedurre dal codice: quali
tabelle sono legacy, quale servizio possiede quale tabella, la convenzione di denominazione
che non viene applicata automaticamente da nessuna parte, la migrazione che non deve essere rieseguita. Mantienilo
breve — le istruzioni caricate a ogni richiesta competono con l'effettivo task per
l'attenzione del modello, e un file lungo finisce per essere solo scorso superficialmente.

E tieni a mente la distinzione: questo file definisce ciò che un assistente *scrive*. Non
ha alcuna influenza su ciò che un agente connesso al tuo database può *fare* — questo è
determinato dalle credenziali di cui dispone, e nulla scritto in Markdown può cambiarlo. Consulta
[il modello di credenziali del server MCP](/docs/ai/mcp#what-the-server-can-reach).

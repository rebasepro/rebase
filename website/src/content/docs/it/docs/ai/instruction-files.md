---
sourceHash: eaad69efe348f395
title: File di istruzioni per l'IA
sidebar_label: File di istruzioni per l'IA
description: Ogni progetto Rebase creato include ai-instructions.md oltre a file puntatore per Claude, Cursor, Windsurf, Copilot e AGENTS.md che contengono le cinque regole violate più spesso dagli assistenti — un'unica fonte di verità, molteplici nomi di file.
---

Ogni assistente vuole le proprie regole in un file diverso. Claude Code legge
`CLAUDE.md`, Cursor legge `.cursorrules`, Windsurf legge `.windsurfrules`,
Copilot legge `.github/copilot-instructions.md` e la convenzione comune
tra i vari fornitori è `AGENTS.md`. Mantenere le stesse indicazioni in cinque file diversi
è il modo migliore per far sì che quattro di essi diventino obsoleti.

`rebase init` scrive tutti e cinque — come **puntatori a un singolo file che andrai effettivamente
a modificare**:

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

Ciascun file puntatore specifica quello reale, indica dove si trovano le skill e riporta le cinque regole che un assistente non deve violare anche se non apre nient'altro:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a file in `backend/schema/`.** Declare it with `defineTable` from `@rebasepro/server/schema` — columns, relations and a required `rls` — export it from `backend/schema/index.ts`, and `pnpm dev` creates it. How it looks in the admin panel is a separate, optional file: `frontend/src/cms/<table>.tsx` with `customizeTable`, which imports the table as a type only. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and hooks, so keep it for server work that needs every row and for reading a column marked `.private()`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its file from `pnpm schema:introspect`. With no `backend/schema/` (a headless project) the database is the schema instead: ai-instructions.md says how to serve a table.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<table>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`). In `.env`, change only a local setting the task needs (`AUTH_MAGIC_LINK`, `FRONTEND_URL`, `REBASE_FUNCTIONS_TIMEOUT_MS` and the like), one line at a time, and say which; never rewrite, print or rotate its secrets (`DATABASE_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`).
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see.
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Gli altri differiscono solo per la directory delle skill dell'agente e per il relativo valore `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — e per
il percorso relativo, che è `../ai-instructions.md` in
`.github/copilot-instructions.md` e `ai-instructions.md` in `AGENTS.md`. La
terza riga è condizionale perché `rebase init --agent` potrebbe aver già
installato le skill prima ancora che l'assistente le legga.

Questo avviene a ogni `rebase init`, per qualsiasi preset, incluso `--headless`.
Non ci sono flag né richieste di conferma.

`rebase init` scrive anche `.mcp.json`, che indirizza Claude Code, Cursor e
qualsiasi altro client MCP verso il [server MCP di Rebase](/docs/ai/mcp) — la copia specifica
del progetto, una devDependency fissata con la CLI (`npx --no rebase-mcp` in un
progetto npm):

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
alla radice del progetto, e un percorso assoluto rappresenta l'unica riga di quel file che
non può essere sottoposta a commit. È presente perché `~/.rebase/projects.json` è valido
a livello di intera macchina — un progetto che non indica una propria directory ricade su
qualunque cosa sia stata salvata dall'ultimo progetto su quella macchina. Consulta
[l'ordine di precedenza](/docs/ai/mcp#which-directory-it-acts-on).

## Perché un puntatore anziché una copia

I file puntatore non contengono quasi nulla. Un file che fa riferimento a quello reale mantiene le
convenzioni in un unico posto e presenta proprietà che una copia non ha:

- **Un solo file da modificare.** Le regole non possono divergere tra gli assistenti, perché
  esiste un unico insieme di regole.
- **Un solo diff da revisionare.** Una modifica alle convenzioni del progetto è una modifica a un unico
  file, non a cinque file identici che un revisore deve confrontare.
- **Aggiungere un assistente richiede un solo piccolo file.** Un nuovo strumento con un nuovo nome file riceve
  un puntatore, non una sesta copia delle tue convenzioni.

L'unica eccezione è il blocco **Before you write any code**. Un assistente non
segue i collegamenti in modo affidabile: uno impegnato in un'attività scrive prima il codice,
e uno avviato alla radice di un repository il cui progetto Rebase si trova in una
sottocartella non carica affatto questi file. Pertanto, le cinque regole la cui violazione fa
più danni (una tabella creata in SQL invece che in `backend/schema`, dati letti e
scritti aggirando l'SDK, una route non protetta, un deploy, un file generato modificato)
sono riportate in ciascun puntatore in modo identico. Un controllo in CI mantiene le cinque
copie sincronizzate.

Vale la pena mantenere questo pattern se si esegue il fork dello scaffold, ed è consigliabile adottarlo
anche in repository che non sono affatto progetti Rebase.

## Cosa contiene inizialmente `ai-instructions.md`

Il file generato dallo scaffold è volutamente breve — rimanda a
[`rebase skills install`](/docs/ai/skills) per approfondire, quindi enuncia le regole che gli
assistenti sbagliano abbastanza spesso da meritare di essere ripetute all'inizio di ogni
sessione:

1. **Schema as code.** Una tabella è una `defineTable` in `backend/schema/<table>.ts`,
   esportata da `backend/schema/index.ts` — viene gestito solo ciò che l'index esporta —
   con una `rls` obbligatoria. Non modificare mai manualmente lo schema Drizzle generato
   o le tabelle Postgres — vedi [Schema as Code](/docs/architecture/schema-as-code).
2. **L'applicazione delle modifiche allo schema** dipende dal database. Mentre `pnpm dev`
   è in esecuzione, salvare un file in `backend/schema/` è tutto ciò che serve:
   rigenera lo schema Drizzle e i tipi dell'SDK, e l'avvio crea le
   tabelle e le colonne mancanti. `pnpm db:push` serve solo per ciò che l'avvio lascia
   deliberatamente invariato — una colonna rinominata, un tipo ristretto, una colonna rimossa — sul
   database di sviluppo gestito così come sul proprio PostgreSQL. In produzione si usa
   `pnpm db:generate` seguito da `pnpm db:migrate`.
3. **Usa l'SDK.** Utilizza `rebase.dataAsAdmin.<table>` per le operazioni eseguite come
   identità di servizio, oppure `getDriver(c)` all'interno di una funzione quando la lettura deve essere eseguita
   come chiamante. Il client server non dispone di un semplice accessor `data`. L'SQL non elaborato (raw) e le chiamate
   dirette a Drizzle aggirano la validazione, gli hook e l'RLS.
4. **Proteggi ogni route personalizzata.** Le route in `backend/functions/` sono montate
   *senza* autenticazione. Usa `requireAuth` / `requireAdmin` da
   `@rebasepro/server/functions` nello slot middleware della route stessa — leggere
   `c.get("user")` non è una protezione, e non lo è nemmeno `app.use()` dopo la route.

Quest'ultima è quella fondamentale da ricordare. È la differenza tra un middleware che
viene eseguito e uno che non lo viene, e un assistente a cui non è stato specificato
scriverà puntualmente la versione che non viene eseguita — vedi
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` ammette esclusivamente il ruolo `admin`. Quando una route deve poter essere
chiamata da un ruolo più specifico o da una chiave API, la protezione da aggiungere è `requireScope`,
con uno scope dichiarato dall'applicazione — vedi [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Dopo le regole seguono due sezioni che si applicano solo ad alcuni progetti. **Backend
runtime** elenca cosa consente il runtime gestito su Rebase Cloud: pacchetti,
memoria e stato a livello di modulo, timeout, porte in uscita, configurazione e
archiviazione per i file generati. Rimanda a
[Managed backend runtime](/docs/deployment/managed-runtime/), in modo che l'assistente
pianifichi una funzionalità di backend basandosi su limiti reali anziché tirare a indovinare. **Admin UI**
contiene le regole per `@rebasepro/ui`. Si applicano alle viste all'interno del pannello di amministrazione, non
a un sito pubblico o a un'applicazione statica servita dal progetto.

## Personalizzazione

`ai-instructions.md` è il tuo file. Niente lo rigenera o lo sovrascrive — a differenza delle
[skill installate](/docs/ai/skills), che vengono sostituite a ogni
`rebase skills install`. Le convenzioni specifiche del progetto vanno inserite qui.

Ciò che merita di essere inserito qui è ciò che un assistente non può dedurre dal codice: quali
tabelle sono legacy, quale servizio gestisce una determinata tabella, la convenzione di denominazione
che non è imposta a livello di codice, la migrazione che non deve essere rieseguita. Mantienilo
breve — le istruzioni caricate in ogni richiesta competono con l'attività effettiva per
l'attenzione dell'assistente, e un file troppo lungo finisce per essere letto solo superficialmente.

E tieni a mente i limiti: questo file definisce ciò che un assistente *scrive*. Non ha
alcun impatto su ciò che un agente connesso al tuo database può *fare* — questo viene
stabilito dalle credenziali di cui dispone, e niente all'interno di un file Markdown può cambiarlo. Consulta
[il modello delle credenziali del server MCP](/docs/ai/mcp#what-the-server-can-reach).

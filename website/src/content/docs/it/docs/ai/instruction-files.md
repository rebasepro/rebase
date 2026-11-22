---
sourceHash: 4a5c6ecfb9f66fd3
title: File di istruzioni AI
sidebar_label: File di istruzioni AI
description: "Ogni progetto Rebase creato include ai-instructions.md oltre ai file puntatore per Claude, Cursor, Windsurf, Copilot e AGENTS.md che contengono le cinque regole che gli assistenti violano più spesso: un'unica fonte di verità, molti nomi di file."
---

Ogni assistente vuole le proprie regole in un file diverso. Claude Code legge
`CLAUDE.md`, Cursor legge `.cursorrules`, Windsurf legge `.windsurfrules`,
Copilot legge `.github/copilot-instructions.md` e la convenzione trasversale
è `AGENTS.md`. Mantenere le stesse indicazioni in cinque file diversi è il motivo per cui
quattro di essi finiscono per diventare obsoleti.

`rebase init` li scrive tutti e cinque — come **puntatori a un unico file che andrai
effettivamente a modificare**:

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

Ciascun file puntatore fa riferimento a quello reale, indica dove si trovano le skill e contiene le cinque regole che un assistente non deve violare anche se non apre mai nient'altro:

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
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see. The admin derived from the tables is a draft: before calling an admin done, give every table it shows a `customizeTable` pass (a title, its columns, ids and raw JSON hidden, labels; ai-instructions.md, "Admin UI", has the checklist).
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Gli altri differiscono solo per la directory delle skill dell'agente e per il relativo valore di `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — e per
il percorso relativo, che è `../ai-instructions.md` in
`.github/copilot-instructions.md` e `ai-instructions.md` in `AGENTS.md`. La
terza riga è condizionale perché `rebase init --agent` potrebbe aver già
installato le skill prima ancora che l'assistente le legga.

Questo avviene a ogni `rebase init`, per ogni preset, incluso `--headless`.
Non ci sono flag né prompt.

`rebase init` scrive anche `.mcp.json`, che punta Claude Code, Cursor e
qualsiasi altro client MCP al [server MCP di Rebase](/docs/ai/mcp) — la copia
interna del progetto, una devDependency bloccata con la CLI (`npx --no rebase-mcp` in un
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
nella root del progetto, e un percorso assoluto è l'unica riga di quel file che
non può essere sottoposta a commit. Si trova lì perché `~/.rebase/projects.json` è
valido a livello di sistema — un progetto che non specifica una propria directory ricade su
qualunque cosa sia stata memorizzata dall'ultimo progetto su quella macchina. Consulta
[la precedenza](/docs/ai/mcp#which-directory-it-acts-on).

## Perché un puntatore anziché una copia

I file puntatore non contengono quasi nulla. Un file che fa riferimento a quello reale mantiene le
convenzioni in un unico posto e offre proprietà che una copia non ha:

- **Un solo file da modificare.** Le regole non possono divergere tra gli assistenti, perché esiste
  un unico insieme di regole.
- **Un solo diff da revisionare.** Una modifica alle convenzioni del progetto è una modifica a un
  singolo file, non a cinque file identici che un revisore deve confrontare.
- **Aggiungere un assistente richiede solo un piccolo file.** Un nuovo strumento con un nuovo nome di file riceve
  un puntatore, non una sesta copia delle tue convenzioni.

L'unica eccezione è il blocco **Before you write any code**. Un assistente non
segue i link in modo affidabile: se è impegnato in un'attività scriverà prima il codice,
e uno avviato nella root di un repository in cui il progetto Rebase si trova in una
sottocartella non caricherà affatto questi file. Pertanto, le cinque regole la cui violazione
causa i danni maggiori (una tabella creata in SQL anziché in `backend/schema`, dati letti e
scritti aggirando l'SDK, una route non protetta, un deploy, la modifica di un file generato)
sono scritte in modo identico in ogni puntatore. Un controllo nella CI garantisce che le cinque
copie rimangano uguali.

Vale la pena mantenere questo pattern se fai il fork dello scaffold, ed è utile adottarlo anche in
repository che non sono affatto progetti Rebase.

## Cosa contiene inizialmente `ai-instructions.md`

Il file generato dallo scaffold è volutamente breve: rimanda a
[`rebase skills install`](/docs/ai/skills) per approfondire, quindi enuncia le regole che gli
assistenti sbagliano abbastanza spesso da meritare di essere ripetute all'inizio di ogni
sessione:

1. **Schema come codice.** Una tabella è un `defineTable` in `backend/schema/<table>.ts`,
   esportata da `backend/schema/index.ts` — viene servito solo ciò che l'index esporta —
   con una direttiva `rls` obbligatoria. Non modificare mai a mano lo schema Drizzle generato
   o le tabelle Postgres — consulta [Schema as Code](/docs/architecture/schema-as-code).
2. **L'applicazione di una modifica allo schema** dipende dal database. Mentre `pnpm dev`
   è in esecuzione, salvare un file in `backend/schema/` è l'unico passaggio necessario:
   rigenera lo schema Drizzle e i tipi dell'SDK, e l'avvio crea le tabelle e le colonne
   mancanti. `pnpm db:push` serve solo per ciò che l'avvio tralascia deliberatamente —
   una colonna rinominata, un tipo ristretto, una colonna rimossa — sia sul database di sviluppo
   gestito che sul proprio PostgreSQL. In produzione si usa `pnpm db:generate` seguito da
   `pnpm db:migrate`.
3. **Usa l'SDK.** Utilizza `rebase.dataAsAdmin.<table>` per le operazioni eseguite come
   identità di servizio, oppure `getDriver(c)` all'interno di una funzione quando la lettura deve
   essere eseguita come chiamante. Il client server non ha un semplice accessor `data`. L'SQL non
   elaborato (raw SQL) e le chiamate dirette a Drizzle aggirano la validazione, gli hook e l'RLS.
4. **Proteggi ogni route personalizzata.** Le route in `backend/functions/` vengono montate
   *senza* autenticazione. Usa `requireAuth` / `requireAdmin` da
   `@rebasepro/server/functions` nello slot middleware della route stessa — leggere
   `c.get("user")` non costituisce una protezione, e non lo è nemmeno `app.use()` inserito dopo la route.

Quest'ultima regola è fondamentale. Fa la differenza tra un middleware che viene eseguito
e uno che non lo è, e un assistente a cui non è stato spiegato scriverà sistematicamente la versione
che non viene eseguita — consulta [Custom Functions](/docs/backend/custom-functions).

`requireAdmin` ammette solo il ruolo `admin`. Quando un ruolo più restrittivo o una chiave API
deve poter chiamare una route, la guardia da aggiungere è `requireScope`, con uno scope
dichiarato dall'applicazione — consulta [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Dopo le regole seguono due sezioni applicabili solo ad alcuni progetti. **Backend
runtime** elenca ciò che il runtime gestito su Rebase Cloud consente: pacchetti,
memoria e stato a livello di modulo, timeout, porte in uscita, configurazione e
storage per i file generati. Si collega a
[Managed backend runtime](/docs/deployment/managed-runtime/), così che un assistente
pianifichi le funzionalità di backend basandosi su limiti reali anziché tirare a indovinare. **Admin UI**
contiene le regole per `@rebasepro/ui` e la checklist per il passaggio di `customizeTable`
necessario per ogni tabella prima di considerare completato un pannello admin: un titolo, le colonne elencate, ID,
foreign key e JSON non elaborato nascosti, etichette, un riepilogo per le colonne JSON e una verifica
dell'interfaccia di amministrazione in esecuzione. Le regole si applicano alle viste all'interno del pannello admin, non a un
sito pubblico o a un'applicazione statica servita dal progetto.

## Rendilo tuo

`ai-instructions.md` è il tuo file. Nulla lo rigenera o lo sovrascrive — a differenza delle
[skill installate](/docs/ai/skills), che vengono sostituite a ogni
`rebase skills install`. Le convenzioni specifiche del progetto vanno inserite qui.

Un'eccezione, per un file che nessuno ha ancora toccato: il file `ai-instructions.md` di un
progetto headless indica che il database è lo schema e che non esiste `backend/schema/`, e
`rebase schema introspect` crea esattamente quella directory. Se il file è ancora identico
byte per byte a quello generato dallo scaffold, l'introspezione lo sostituisce con le regole
dello schema come codice solo backend; una volta modificato, viene lasciato così com'è e il comando
indicherà quali delle sue regole non sono più valide.

Ciò che merita spazio qui è ciò che un assistente non può dedurre dal codice: quali
tabelle sono legacy, quale servizio possiede una determinata tabella, convenzioni di
denominazione non imposte a livello di codice, migrazioni che non devono essere rieseguite.
Mantienilo breve: le istruzioni caricate a ogni richiesta competono con l'attività effettiva
per l'attenzione dell'assistente, e un file troppo lungo viene letto solo superficialmente.

E tieni a mente la linea di demarcazione: questo file definisce ciò che un assistente *scrive*. Non
ha alcuna influenza su ciò che un agente connesso al database può *fare* — questo è
determinato dalle credenziali di cui dispone, e nulla all'interno del Markdown può cambiarlo. Consulta
[il modello delle credenziali del server MCP](/docs/ai/mcp#what-the-server-can-reach).

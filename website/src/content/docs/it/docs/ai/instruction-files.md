---
sourceHash: 5dd46da9d88b962e
title: File di istruzioni IA
sidebar_label: File di istruzioni IA
description: Ogni progetto Rebase creato da scaffold include ai-instructions.md oltre a file puntatore di tre righe per Claude, Cursor, Windsurf, Copilot e AGENTS.md — un'unica fonte di verità, molteplici nomi di file.
---

Ogni assistente vuole le proprie regole in un file diverso. Claude Code legge
`CLAUDE.md`, Cursor legge `.cursorrules`, Windsurf legge `.windsurfrules`,
Copilot legge `.github/copilot-instructions.md` e la convenzione comune tra i diversi
vendor è `AGENTS.md`. Mantenere le stesse indicazioni in cinque file diversi è il
modo migliore per ritrovarsene quattro non aggiornati.

`rebase init` li scrive tutti e cinque — come **puntatori a un singolo file che andrai
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

Ciascun file puntatore è composto da tre righe:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.
```

Nella versione 0.23, la terza riga indica semplicemente all'assistente di eseguire
`rebase skills install --agent claude`, e il file `.mcp.json` riportato di seguito
avvia il server con `npx -y @rebasepro/mcp` dal registry.

Gli altri differiscono solo per la directory delle skill dell'agent e per il valore di `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — nonché per
il percorso relativo, che è `../ai-instructions.md` in
`.github/copilot-instructions.md` e `ai-instructions.md` in `AGENTS.md`. La
terza riga è condizionale perché `rebase init --agent` potrebbe aver già
installato le skill prima ancora che l'assistente legga il file.

Questo avviene a ogni `rebase init`, per qualsiasi preset incluso `--headless`.
Non ci sono flag né richieste di conferma.

`rebase init` scrive anche `.mcp.json`, che punta Claude Code, Cursor e
qualsiasi altro client MCP al [server MCP di Rebase](/docs/ai/mcp) — la copia interna
del progetto, una devDependency bloccata con la CLI (`npx --no rebase-mcp` in un
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
non può essere committata. È presente perché `~/.rebase/projects.json` è valido
a livello di intera macchina — un progetto che non specifica una propria directory
ricade su qualunque cosa l'ultimo progetto su quella macchina abbia salvato. Consulta
[l'ordine di precedenza](/docs/ai/mcp#which-directory-it-acts-on).

## Perché un puntatore invece di una copia

I file puntatore sono deliberatamente privi di contenuti. Gli assistenti seguono
i link relativi Markdown, quindi un file di tre righe che punta a quello reale
ottiene lo stesso risultato di una copia — e presenta vantaggi che una copia non ha:

- **Un solo file da modificare.** Le regole non possono divergere tra gli assistenti,
  perché esiste un solo set di regole.
- **Un solo diff da revisionare.** Una modifica alle convenzioni del progetto è una
  modifica a un singolo file, non a cinque file identici che un revisore deve confrontare.
- **Aggiungere un assistente richiede tre righe.** Un nuovo strumento con un nuovo
  nome di file riceve un puntatore, non una sesta copia delle tue convenzioni.

Questo pattern vale la pena di essere mantenuto se fai un fork dello scaffold,
e vale la pena di essere adottato anche in repository che non sono affatto progetti Rebase.

## Cosa contiene inizialmente `ai-instructions.md`

Il file generato dallo scaffold è deliberatamente breve — rimanda a
[`rebase skills install`](/docs/ai/skills) per i dettagli, per poi enunciare le regole
che gli assistenti sbagliano abbastanza spesso da meritare di essere ripetute all'inizio
di ogni sessione:

1. **Schema as code.** Le collection sono definite in `config/collections/`. Non
   modificare mai a mano lo schema Drizzle generato o le tabelle Postgres — vedi
   [Schema as Code](/docs/architecture/schema-as-code).
2. **L'applicazione delle modifiche a una collection** dipende dal database. Mentre `pnpm dev`
   è in esecuzione, salvare il file della collection è l'unico passaggio necessario: l'avvio
   rigenera lo schema Drizzle e crea le tabelle e le colonne mancanti. `pnpm db:push` serve
   solo per ciò che la fase di avvio tralascia deliberatamente — una colonna rinominata, un
   tipo ristretto, un campo rimosso — sia sul database di sviluppo gestito sia sulla tua
   istanza PostgreSQL. La produzione richiede `pnpm db:generate` seguito da `pnpm db:migrate`.
   Nella versione 0.24, `pnpm db:push` richiede una propria istanza PostgreSQL, e il file
   lo specifica chiaramente.
3. **Usa l'SDK.** Usa `rebase.dataAsAdmin.<slug>` per le operazioni eseguite con
   l'identità di servizio, oppure `getDriver(c)` all'interno di una funzione quando la lettura
   deve essere eseguita come il chiamante. Il client server non dispone di un semplice accessor
   `data`. Le query SQL raw e le chiamate dirette a Drizzle aggirano la validazione, i callback
   e le RLS.
4. **Proteggi ogni route personalizzata.** Le route in `backend/functions/` vengono montate
   *senza* autenticazione. Usa `requireAuth` / `requireAdmin` da
   `@rebasepro/server/functions` nello slot middleware della route stessa — leggere
   `c.get("user")` non costituisce una protezione, e nemmeno un `app.use()` posizionato dopo la route.

Quest'ultima regola è fondamentale. Fa la differenza tra un middleware che
viene eseguito e uno che non lo è, e un assistente non informato scriverà
immancabilmente la versione che non viene eseguita — vedi
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` ammette esclusivamente il ruolo `admin`. Quando un ruolo più specifico
o una chiave API deve poter chiamare una route, la protezione da aggiungere è
`requireScope`, con uno scope dichiarato dall'applicazione — vedi [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Dopo le regole seguono due sezioni che si applicano solo ad alcuni progetti. **Backend
runtime** elenca ciò che il runtime gestito su Rebase Cloud consente: pacchetti,
memoria e stato a livello di modulo, timeout, porte in uscita, configurazione e
storage per i file generati. Rimanda a
[Managed backend runtime](/docs/deployment/managed-runtime/), in modo che l'assistente
pianifichi una funzionalità backend considerando i limiti reali invece di tirare a indovinare.
**Admin UI** contiene le regole per `@rebasepro/ui`. Si applicano alle viste all'interno
del pannello di amministrazione, non a un sito pubblico o a un'applicazione statica
servita dal progetto.

## Personalizzarlo

`ai-instructions.md` è il tuo file. Nulla lo rigenera o lo sovrascrive — a differenza
delle [skill installate](/docs/ai/skills), che vengono sostituite a ogni
`rebase skills install`. Le convenzioni specifiche del progetto vanno inserite qui.

Ciò che merita di essere inserito è ciò che un assistente non può dedurre dal
codice: quali collection sono legacy, quale servizio possiede quale tabella, la
convenzione di denominazione che non è imposta altrove, la migrazione che non
deve essere rieseguita. Mantienilo breve — le istruzioni caricate in ogni richiesta
competono con l'attività effettiva per l'attenzione dell'assistente, e un file
troppo lungo è un file che l'assistente leggerà solo superficialmente.

E tieni a mente i limiti: questo file definisce ciò che un assistente *scrive*.
Non ha alcuna influenza su ciò che un agent connesso al tuo database può *fare* —
questo è determinato dalle credenziali di cui dispone, e nulla nel Markdown può
cambiarlo. Consulta [il modello di credenziali del server MCP](/docs/ai/mcp#what-the-server-can-reach).

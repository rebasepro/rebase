---
title: File di Istruzioni AI
sidebar_label: File di Istruzioni AI
description: Ogni progetto Rebase scaffoldato include ai-instructions.md più file puntatore di una riga per Claude, Cursor, Windsurf, Copilot e AGENTS.md — un'unica fonte di verità, molti nomi di file.
---

Ogni assistente vuole le proprie regole in un file diverso. Claude Code legge
`CLAUDE.md`, Cursor legge `.cursorrules`, Windsurf legge `.windsurfrules`,
Copilot legge `.github/copilot-instructions.md`, e la convenzione comune tra i
vendor è `AGENTS.md`. Mantenere le stesse istruzioni in cinque file diversi è il
modo perfetto per far sì che quattro di essi diventino obsoleti.

`rebase init` scrive tutti e cinque — come **puntatori a un singolo file che andrai effettivamente a modificare**:

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

Ogni file puntatore è composto da due righe:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
```

`.github/copilot-instructions.md` è identico ad eccezione del percorso relativo
(`../ai-instructions.md`).

Questo avviene a ogni `rebase init`, per ogni preset incluso `--headless`.
Non ci sono flag né richieste di conferma.

## Perché un puntatore invece di una copia

I file puntatore sono deliberatamente privi di contenuti. Gli assistenti seguono i
link Markdown relativi, quindi un file di due righe che fa riferimento a quello reale ottiene lo stesso risultato
di una copia — offrendo al contempo vantaggi che una copia non ha:

- **Un solo file da modificare.** Le regole non possono divergere tra gli assistenti, perché esiste
  un solo set di regole.
- **Un solo diff da revisionare.** Una modifica alle convenzioni del progetto è una modifica a un
  solo file, non a cinque file identici che un revisore deve confrontare.
- **Aggiungere un assistente richiede due righe.** Un nuovo strumento con un nuovo nome di file ottiene
  un puntatore, non una sesta copia delle tue convenzioni.

È un pattern che vale la pena mantenere se fai un fork dello scaffold, e che vale la pena adottare
anche in repository che non sono affatto progetti Rebase.

## Con cosa inizia `ai-instructions.md`

Il file scaffoldato è deliberatamente breve — rimanda a
[`rebase skills install`](/docs/ai/skills) per approfondire, poi definisce le regole che
gli assistenti sbagliano abbastanza spesso da meritare di essere ripetute all'inizio di ogni
sessione:

1. **Schema come codice.** Le collezioni sono definite in `config/collections/`. Non
   modificare mai a mano lo schema Drizzle generato o le tabelle Postgres — vedi
   [Schema as Code](/docs/architecture/schema-as-code).
2. **Le migrazioni sono in due passaggi.** `rebase schema generate`, poi `rebase db push`
   in fase di sviluppo, oppure `rebase db generate && rebase db migrate` per la produzione.
3. **Usa l'SDK.** Passa attraverso `rebase.dataAsAdmin.<slug>` per il lavoro svolto
   con l'identità del servizio, oppure `getDriver(c)` dentro una function quando la
   lettura deve avvenire come chiamante. Sul server il client non espone un accessore `data` semplice.
   L'SDK va sempre usato: l'SQL grezzo e le chiamate dirette a Drizzle
   bypassan la validazione, le callback e la RLS.
4. **Proteggi ogni route personalizzata.** Le route in `backend/functions/` sono montate
   *senza* autenticazione. Usa `requireAuth` / `requireAdmin` da
   `@rebasepro/server/functions` nello slot middleware dedicato della route — leggere
   `c.get("user")` non costituisce una protezione, e non lo è nemmeno `app.use()` dopo la route.

Quest'ultima è quella fondamentale da ricordare. Fa la differenza tra un middleware che
viene eseguito e uno che non lo è, e un assistente a cui non è stato detto
scriverà puntualmente la versione che non lo fa — vedi
[Funzioni personalizzate](/docs/backend/custom-functions).

## Personalizzarlo

`ai-instructions.md` è il tuo file. Niente lo rigenera o lo sovrascrive — a differenza delle
[skill installate](/docs/ai/skills), che vengono sostituite a ogni
`rebase skills install`. Le convenzioni specifiche del progetto vanno inserite qui.

Ciò che merita spazio è ciò che un assistente non può dedurre dal codice: quali
collezioni sono legacy, quale servizio possiede quale tabella, la convenzione di denominazione
che non è imposta da nessuna parte, la migrazione che non deve essere rieseguita. Mantienilo
breve — le istruzioni caricate in ogni richiesta competono con il task effettivo per
l'attenzione dell'assistente, e un file lungo viene solo scorso superficialmente.

E tieni a mente il limite: questo file determina ciò che un assistente *scrive*. Non
ha alcuna influenza su ciò che un agente connesso al tuo database può *fare* — questo è
determinato dalle credenziali in suo possesso, e nulla nel Markdown può cambiarlo. Vedi
[il modello di credenziali del server MCP](/docs/ai/mcp#what-the-server-can-reach).

---

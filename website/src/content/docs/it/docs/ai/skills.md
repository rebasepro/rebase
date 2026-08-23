---
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install scrive 20 skill di riferimento di Rebase nel tuo repository, nel formato previsto dal tuo assistente IA — Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity.
---

Un assistente IA che ha letto la documentazione di Rebase scrive codice Rebase migliore rispetto a uno che cerca di indovinare dalla struttura dell'API. `rebase skills install` copia 20 file di skill Markdown nel tuo repository, nel formato previsto dal tuo assistente:

```bash
rebase skills install
```

Le skill sono **materiale di riferimento, non strumenti**. Spiegano all'assistente come vengono definite le collection, perché le migrazioni avvengono in due passaggi e quali errori il framework non intercetterà per lui. Per gli strumenti che operano sui tuoi dati, consulta il [server MCP](/docs/ai/mcp).

## Quale assistente

Il comando accetta l'opzione `--agent` (o `-a`), ripetibile e separata da virgole:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sono supportate quattro destinazioni:

| `--agent` | Assistente | Scritto in |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/<skill>.mdc` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/<skill>.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |

`gemini` copre **sia** Gemini CLI che Antigravity — leggono la stessa directory `.agents/`, quindi non esiste un valore separato `antigravity`.

Senza `--agent`, il comando rileva quali assistenti vengono già utilizzati da un progetto cercando `.cursor/`, `.claude/`, `.windsurf/` e `.agents/`. Se non ne trova alcuno, ti chiederà di sceglierne uno.

:::note[Un progetto appena inizializzato richiede sempre una scelta]
`rebase init` scrive `CLAUDE.md`, `.cursorrules` e simili, ma nessuna delle *directory* cercate dal rilevamento. Di conseguenza, la prima esecuzione in un nuovo progetto ricadrà nella richiesta interattiva — e in ambiente CI, dove non c'è un TTY, terminerà invece con un errore. Passa `--agent` esplicitamente in qualsiasi contesto non interattivo.
:::

## A livello di progetto e pensato per essere versionato

Le skill vengono scritte **in modo relativo alla radice del tuo progetto** — la cartella genitrice più vicina contenente `rebase.json` — non nella tua home directory né nella directory di lavoro corrente. Nulla viene installato globalmente.

Esegui il commit di questi file. Fanno parte del repository allo stesso modo di una configurazione di linting: l'assistente di ogni collaboratore lavorerà così con la stessa comprensione del codebase, compresi i collaboratori che non hanno mai eseguito il comando.

**Esegui nuovamente il comando per aggiornare.** I file vengono sovrascritti incondizionatamente, quindi dopo un aggiornamento di Rebase:

```bash
rebase skills install --agent all
```

Due conseguenze dell'avverbio "incondizionatamente": le modifiche locali apportate a una skill installata andranno perse alla successiva esecuzione — mantieni invece le istruzioni specifiche del progetto in [`ai-instructions.md`](/docs/ai/instruction-files), che è tuo e non viene mai sovrascritto. Inoltre, le skill rimosse in una versione più recente non vengono eliminate dal tuo repository; vengono riscritti solo i file ancora esistenti.

Il comando funziona anche all'esterno di un progetto Rebase, ricorrendo alla directory di lavoro corrente — utile per un repository frontend separato che comunica con un backend Rebase.

## Le 20 skill

| Skill | Argomenti trattati |
|---|---|
| `rebase-basics` | Principi fondamentali, flusso di lavoro e manutenzione — il punto di ingresso presupposto dalle altre skill |
| `rebase-collections` | Definizione delle collection, tipi di proprietà, validazione, ricercabilità |
| `rebase-backend-postgres` | Il backend Postgres: configurazione, generazione dello schema, migrazioni, connection pooling, repliche di lettura |
| `rebase-api` | L'API REST generata — endpoint, filtri, ordinamento, paginazione |
| `rebase-sdk` | L'SDK TypeScript generato: CRUD, filtri, ricerca, autenticazione, realtime, offline, storage |
| `rebase-auth` | Autenticazione, ruoli, policy RLS, MFA, chiavi API, OAuth, adapter personalizzati |
| `rebase-security` | Controllo degli accessi, intercettazione, progettazione fail-closed, mascheramento PII, isolamento dei tenant |
| `rebase-realtime` | Il motore WebSocket: sincronizzazione, canali di broadcast, presence, broadcast delle modifiche alle tabelle |
| `rebase-storage` | Storage locale/S3/GCS, caricamenti, upload riprendibili TUS, trasformazioni di immagini |
| `rebase-custom-functions` | Endpoint API personalizzati tramite rilevamento delle funzioni basato su file |
| `rebase-cron-jobs` | Pianificazione di attività ricorrenti in background |
| `rebase-webhooks` | Webhook HTTP in uscita, firme HMAC, tentativi di re-invio e backoff |
| `rebase-email` | SMTP, template, provider personalizzati, il singleton `rebase.email` |
| `rebase-entity-history` | Versionamento delle entità, tracciamento delle modifiche, log di audit, ripristino |
| `rebase-admin` | Navigazione nel pannello di amministrazione, drawer laterali, URL, incorporamento di pannelli di collection |
| `rebase-ui-components` | La libreria di componenti `@rebasepro/ui` |
| `rebase-design-language` | Il design language della UI: token, colori, tipografia, spaziatura, anti-pattern |
| `rebase-studio` | Il layer degli strumenti per sviluppatori di Studio — SQL, RLS, storage, cron, visualizzatore di schemi, log |
| `rebase-deployment` | Rebase Cloud, Docker e self-hosting su AWS, GCP, Hetzner, Railway e Render |
| `rebase-local-env-setup` | Configurazione iniziale dell'ambiente: Node.js, pnpm, PostgreSQL, Docker |

Due di queste richiedono di essere lette spontaneamente. `rebase-basics` specifica di dover essere utilizzata ogni volta che un assistente interagisce con Rebase, mentre `rebase-design-language` richiede che un agent la legga prima di creare o modificare qualsiasi interfaccia visiva — quest'ultima esiste perché le UI generate tendono ad allontanarsi da un design system più rapidamente di qualunque altra cosa in un codebase.

## Esempio di esecuzione

```text
  Found 20 Rebase skills

  ✓ Claude Code — 20 skills installed (+ 1 reference file) to .claude/skills
```

Le skill vengono distribuite tramite il pacchetto `@rebasepro/agent-skills`, dal quale dipende la CLI, quindi il set ottenuto corrisponde alla versione della CLI installata.

---

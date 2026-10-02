---
sourceHash: 8fee7de68fa81701
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install scrive 21 skill di riferimento di Rebase nel tuo repository, nel layout previsto dal tuo assistente IA — Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity.
---

Un assistente IA che ha letto la documentazione di Rebase scrive codice Rebase migliore rispetto a uno che cerca di indovinare dalla struttura delle API. `rebase skills install` copia 21 file di skill Markdown nel tuo repository, nel layout previsto dal tuo assistente:

```bash
rebase skills install
```

Le skill sono **materiale di consultazione, non strumenti**. Spiegano all'assistente come vengono definite le collection, perché le migrazioni prevedono due passaggi e quali errori il framework non intercetterà per lui. Per gli strumenti che operano sui tuoi dati, consulta il [server MCP](/docs/ai/mcp).

## Configurazione tramite `rebase init`

<span class="since-badge" data-since="0.24">Dalla 0.24</span> Un nuovo progetto non necessita di questo comando. `rebase init` chiede se configurare i tuoi agent di coding IA, quindi elenca quelli rilevati sulla macchina:

```text
? Set up Rebase skills and the Rebase MCP server for your AI coding agent(s)? Yes

Detecting installed AI coding agents...
  ✓ Claude Code — ~/.claude
  ✓ Gemini CLI / Antigravity — ~/.gemini
  ✗ Cursor — ~/.cursor (not found)
  ✗ Windsurf — ~/.codeium/windsurf (not found)
  ✗ Codex CLI — ~/.codex (not found)
  ✗ Kiro — ~/.kiro (not found)
  · GitHub Copilot — can't be detected; tick it below if you use it
```

Gli agent rilevati sono già selezionati. Per ciascuno di quelli mantenuti, scrive le skill e registra il [server MCP](/docs/ai/mcp) nella configurazione di progetto di quell'agent, il tutto prima del primo commit del progetto. In CI, o con `--yes`, è possibile specificarli per nome:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Un progetto esistente

<span class="since-badge" data-since="0.24">Dalla 0.24</span> `rebase init` si rifiuta su una cartella che contiene già un progetto, quindi un
progetto creato prima che esistesse la configurazione degli agent — o uno il
cui autore ha rifiutato la richiesta — ottiene la stessa configurazione con
`rebase skills install --mcp`: le skill, e il [server MCP](/docs/ai/mcp)
registrato nella configurazione di progetto di ciascun agent. I server già
presenti nel file vengono mantenuti, e una nuova esecuzione lascia inalterata
la voce di Rebase.

```bash
rebase skills install --agent cursor --mcp
```

Senza `--mcp` il comando scrive solo le skill, ed elenca gli agent la cui
configurazione non ha ancora il server.

## Quale assistente

Il comando accetta `--agent` (o `-a`), ripetibile e separato da virgole:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sono supportati sette target — uno per ogni file puntatore scritto da `rebase init`:

| `--agent` | Assistente | Scritto in |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/rebase.mdc` + `.cursor/rules/<skill>/SKILL.md` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/rebase.md` + `.windsurf/rules/<skill>/SKILL.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |
| `codex` | Codex CLI | `.agents/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/rebase.md` + `.kiro/steering/<skill>/SKILL.md` |
| `copilot` | GitHub Copilot | `.github/instructions/rebase.instructions.md` + `<skill>/SKILL.md` |

:::note[Cursor, Windsurf, Kiro e Copilot ricevono un singolo file sempre attivo]
Questi quattro caricano l'intera directory delle regole in ogni richiesta. Un file di regole per ogni skill avrebbe comportato circa **84.000 caratteri** di documentazione di riferimento di Rebase inclusi in ogni domanda posta dall'utente, a prescindere dal fatto che riguardasse o meno Rebase — e un'istruzione letta superficialmente da un assistente è un'istruzione che non verrà seguita.

Ricevono invece `rebase.mdc` (o `rebase.md`): un indice di ~3 KB con `alwaysApply: true`, che elenca gli argomenti trattati da ciascuna skill e il file da consultare. I contenuti veri e propri risiedono in sottodirectory dedicate per ciascuna skill e vengono aperti su richiesta.
:::

`gemini` copre **sia** Gemini CLI che Antigravity — leggono entrambi la stessa directory `.agents/`, pertanto non esiste un valore separato `antigravity`. Anche Codex la legge; specificare sia `gemini` che `codex` scriverà la directory una sola volta.

Senza l'opzione `--agent`, il comando rileva quali assistenti sono già utilizzati nel progetto cercando `.cursor/`, `.claude/`, `.windsurf/`, `.agents/`, `.codex/` e `.kiro/`. Se non ne trova alcuno, richiede di effettuare una scelta, con gli assistenti installati sulla macchina già selezionati.

**GitHub Copilot non viene mai rilevato automaticamente.** La sua directory sarebbe `.github/`, e la presenza di `.github/` non prova che qualcuno stia usando Copilot: `rebase init` scrive `.github/copilot-instructions.md` in ogni scaffolding e la maggior parte dei repository ha già una cartella `.github/` per i workflow. Installalo con `--agent copilot`.

:::note[Un progetto appena creato mostra sempre il prompt]
`rebase init` scrive `CLAUDE.md`, `.cursorrules` e simili, ma nessuna delle *directory* cercate dal rilevamento. Di conseguenza, la prima esecuzione in un nuovo progetto ricade sul prompt — e in ambiente CI, dove non c'è un TTY, termina restituendo un errore. Passa `--agent` esplicitamente in qualsiasi contesto non interattivo.
:::

## Locali al progetto e destinate al commit

Le skill vengono scritte **relativamente alla radice del tuo progetto** — il percorso antenato più vicino contenente `rebase.json` — e non nella tua home directory né nella directory di lavoro corrente. Non viene installato nulla a livello globale.

Effettua il commit di questi file. Fanno parte del repository esattamente come una configurazione di linting: in questo modo l'assistente di ogni collaboratore opera con la stessa comprensione del codebase, compresi i collaboratori che non hanno mai eseguito il comando.

**Esegui nuovamente il comando per aggiornare.** I file vengono sovrascritti incondizionatamente, quindi dopo un aggiornamento di Rebase:

```bash
rebase skills install --agent all
```

Due conseguenze del termine «incondizionatamente»: le modifiche locali apportate a una skill installata andranno perse all'esecuzione successiva — mantieni invece le istruzioni specifiche del progetto in [`ai-instructions.md`](/docs/ai/instruction-files), che ti appartiene e non viene mai sovrascritto. Inoltre, le skill rimosse in una versione più recente non vengono eliminate dal tuo repository; solo i file tuttora esistenti vengono riscritti.

Il comando funziona anche al di fuori di un progetto Rebase, ripiegando sulla directory di lavoro corrente — utile per un repository frontend separato che comunica con un backend Rebase.

## Le 21 skill

| Skill | Argomenti trattati |
|---|---|
| `rebase-basics` | Principi fondamentali, workflow e manutenzione — il punto di ingresso presupposto da tutte le altre |
| `rebase-collections` | Definizione delle collection, tipi di proprietà, validazione, ricercabilità |
| `rebase-backend-postgres` | Il backend Postgres: configurazione, generazione dello schema, migrazioni, connection pooling, repliche di lettura |
| `rebase-api` | L'API REST generata — endpoint, filtri, ordinamento, paginazione |
| `rebase-sdk` | L'SDK TypeScript generato: CRUD, filtri, ricerca, autenticazione, realtime, offline, storage |
| `rebase-auth` | Autenticazione, ruoli, policy RLS, MFA, chiavi API, OAuth, adapter personalizzati |
| `rebase-security` | Controllo degli accessi, intercettazione, design fail-closed, mascheramento PII, isolamento dei tenant |
| `rebase-realtime` | Il motore WebSocket: sincronizzazione, canali di broadcast, presenza, notifiche broadcast di modifiche alle tabelle |
| `rebase-storage` | Archiviazione su S3/GCS/locale, caricamenti, upload ripristinabili TUS, trasformazioni di immagini |
| `rebase-custom-functions` | Endpoint API personalizzati tramite function discovery basata su file |
| `rebase-cron-jobs` | Pianificazione di attività in background ricorrenti |
| `rebase-webhooks` | Webhook HTTP in uscita, firme HMAC, tentativi e backoff |
| `rebase-email` | SMTP, template, provider personalizzati, il singleton `rebase.email` |
| `rebase-entity-history` | Controllo delle versioni delle entità, tracciamento delle modifiche, log di audit, ripristino |
| `rebase-admin` | Navigazione nel pannello di amministrazione, drawer laterali, URL, incorporamento di pannelli di collection |
| `rebase-ui-components` | La libreria di componenti `@rebasepro/ui` |
| `rebase-design-language` | Il design system dell'interfaccia utente: token, colori, tipografia, spaziatura, anti-pattern |
| `rebase-studio` | Il livello degli strumenti di sviluppo Studio — SQL, RLS, storage, cron, visualizzatore di schemi, log |
| `rebase-cloud` | Deploy e gestione operativa su Rebase Cloud — progetti, database gestiti, variabili d'ambiente, domini, log, rollback |
| `rebase-deployment` | Self-hosting: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway e Render |
| `rebase-local-env-setup` | Configurazione iniziale dell'ambiente: Node.js, pnpm, PostgreSQL, Docker |

Due di queste richiedono di essere lette spontaneamente. `rebase-basics` specifica che deve essere consultata ogni volta che l'assistente interagisce con Rebase, mentre `rebase-design-language` impone all'agent di leggerla prima di creare o modificare qualsiasi interfaccia visiva — quest'ultima esiste perché le UI generate tendono a discostarsi dal design system più velocemente di qualunque altra parte del codice.

## Esempio di esecuzione

```text
  Found 21 Rebase skills

  ✓ Claude Code — 21 skills installed (+ 8 reference files) to .claude/skills
```

Le skill sono distribuite dal pacchetto `@rebasepro/agent-skills`, da cui dipende la CLI, quindi il set ottenuto corrisponde alla versione della CLI installata.

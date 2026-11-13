---
sourceHash: dd9c77451521c040
title: Skill dell'agente
sidebar_label: Agent Skills
description: rebase skills install scrive 24 skill di riferimento di Rebase nel tuo repository, nel layout previsto dal tuo assistente AI — Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity.
---

Un assistente AI che ha letto la documentazione di Rebase scrive codice Rebase migliore
rispetto a uno che cerca di indovinare dalla forma delle API. `rebase skills install` copia 24
file Markdown di skill nel tuo repository, nel layout previsto dal tuo assistente:

```bash
rebase skills install
```

Le skill sono **materiale di riferimento, non strumenti**. Spiegano all'assistente come
vengono dichiarate le tabelle, perché le migrazioni sono a due passaggi e quali errori il
framework non intercetterà al posto suo. Per gli strumenti che agiscono sui tuoi dati, consulta il
[server MCP](/docs/ai/mcp).

## Configurazione tramite `rebase init`

Un nuovo progetto non ha bisogno del comando. `rebase init` chiede
se configurare i tuoi agenti di programmazione AI, quindi elenca quelli che trova sulla
macchina:

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

Gli agenti rilevati sono preselezionati. Per ciascuno di quelli che mantieni, scrive le skill
e registra il [server MCP](/docs/ai/mcp) nella configurazione di progetto di quell'agente, tutto
prima del primo commit del progetto. In CI, o con `--yes`, specificali:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Un progetto esistente

`rebase init` rifiuta una directory che contiene già un progetto, quindi un progetto
creato prima che esistesse la configurazione dell'agente — o uno in cui l'autore ha rifiutato il prompt —
ottiene la stessa configurazione tramite `rebase skills install --mcp`: le skill e il
[server MCP](/docs/ai/mcp) registrato nella configurazione di progetto di ciascun agente. I server
già presenti nel file vengono mantenuti e una nuova esecuzione lascia la voce di Rebase inalterata.

```bash
rebase skills install --agent cursor --mcp
```

Senza `--mcp` il comando scrive solo le skill ed elenca gli agenti la cui
configurazione non include ancora il server.

## Quale assistente

Il comando accetta `--agent` (o `-a`), ripetibile e separato da virgole:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sono supportate sette destinazioni — una per ogni file puntatore scritto da `rebase init`:

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
Questi quattro caricano l'intera directory delle regole in ogni richiesta. Un file di regole per
ogni skill avrebbe significato circa **84.000 caratteri** di documentazione di riferimento di Rebase inseriti prima di
qualsiasi domanda posta da un utente, che riguardasse Rebase o meno — e
un'istruzione che un assistente legge superficialmente è un'istruzione che non seguirà.

Ricevono invece `rebase.mdc` (o `rebase.md`): un indice di circa 3 KB con
`alwaysApply: true`, che elenca gli argomenti trattati da ciascuna skill e il file da leggere. I
contenuti effettivi si trovano nelle sottodirectory dedicate a ciascuna skill e vengono aperti su richiesta.
:::

`gemini` copre **sia** Gemini CLI che Antigravity — leggono la stessa
directory `.agents/`, quindi non esiste un valore separato per `antigravity`. Anche Codex la
legge; specificando sia `gemini` che `codex`, la directory verrà scritta una sola volta.

Senza `--agent`, il comando rileva quali assistenti sono già utilizzati nel progetto
cercando `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` e
`.kiro/`. Se non ne trova alcuno, ti invita a scegliere, con gli assistenti installati
sulla macchina già preselezionati.

**GitHub Copilot non viene mai rilevato.** La sua directory sarebbe `.github/`, e
`.github/` non è una prova dell'uso effettivo di Copilot: `rebase init` inserisce
`.github/copilot-instructions.md` in ogni scaffolding iniziale, e la maggior parte dei repository ha
una cartella `.github/` per i workflow. Installalo con `--agent copilot`.

:::note[Un progetto appena generato mostra sempre un prompt]
`rebase init` scrive `CLAUDE.md`, `.cursorrules` e simili, ma nessuna delle
*directory* cercate dal rilevamento. Pertanto, la prima esecuzione in un nuovo progetto ricade
nella richiesta interattiva — e in ambiente CI, dove non è presente una TTY, termina invece con un errore.
Passa `--agent` esplicitamente in qualsiasi contesto non interattivo.
:::

## Locali al progetto e destinate a essere committate

Le skill vengono scritte **rispetto alla directory radice del progetto** — l'antenato più vicino
contenente `rebase.json` — non nella tua home directory e non nella directory di lavoro
corrente. Nulla viene installato a livello globale.

Esegui il commit di questi file. Fanno parte del repository esattamente come una configurazione di linter: in questo modo,
l'assistente di ogni collaboratore opera con la stessa conoscenza del codebase,
compresi i collaboratori che non hanno mai eseguito il comando.

**Esegui nuovamente il comando per aggiornare** dopo un upgrade di Rebase:

```bash
rebase skills install --agent all
```

Ogni directory di destinazione contiene un manifest `.rebase-skills.json` con quanto
scritto dal comando, consentendo a una successiva esecuzione di distinguere una modifica manuale rispetto alla copia di una versione precedente. Esegui il commit
di questo file insieme alle skill.

- Un file non modificato da nessuno viene sostituito con la copia della nuova versione.
- Un file che hai modificato viene mantenuto e il comando lo segnala nell'elenco. `--force` lo sostituisce.
- Una skill non più inclusa in una versione più recente viene rimossa, a meno che tu non l'abbia modificata.
  In tal caso, viene mantenuta ed elencata.
- I file non scritti dal comando non vengono toccati.

Le indicazioni specifiche per il progetto devono comunque risiedere in
[`ai-instructions.md`](/docs/ai/instruction-files), che è gestito da te. Una skill
modificata smette di ricevere aggiornamenti finché non usi l'opzione `--force`.

Il comando funziona anche all'esterno di un progetto Rebase, ricorrendo alla directory di lavoro
corrente — utile per un repository frontend separato che comunica con un backend Rebase.

## Le 24 skill

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

| Skill | Argomenti trattati |
|---|---|
| `rebase-basics` | Principi fondamentali, workflow e manutenzione — il punto di ingresso presupposto da tutte le altre |
| `rebase-tables` | Creazione delle tabelle: colonne, relazioni, `rls`, hook e il livello CMS sovrastante (`customizeTable`) |
| `rebase-backend-postgres` | Il backend Postgres: configurazione, generazione dello schema, migrazioni, pooling, repliche di lettura |
| `rebase-api` | Le API REST generate — endpoint, filtri, ordinamento, paginazione |
| `rebase-sdk` | L'SDK TypeScript generato: CRUD, filtri, ricerca, autenticazione, realtime, offline, storage |
| `rebase-auth` | Autenticazione, ruoli, policy RLS, MFA, chiavi API, OAuth, adapter personalizzati |
| `rebase-security` | Controllo degli accessi, intercettazione, design fail-closed, mascheramento di PII, isolamento dei tenant |
| `rebase-realtime` | Il motore WebSocket: sincronizzazione, canali broadcast, presenza, notifiche broadcast di modifiche alle tabelle |
| `rebase-storage` | Archiviazione su S3/GCS/locale, caricamenti, caricamenti riprendibili con TUS, trasformazioni di immagini |
| `rebase-custom-functions` | Endpoint API personalizzati tramite rilevamento di funzioni basato su file |
| `rebase-cron-jobs` | Pianificazione di task in background ricorrenti |
| `rebase-webhooks` | Webhook HTTP in uscita, firme HMAC, tentativi e backoff |
| `rebase-email` | SMTP, template, provider personalizzati, il singleton `rebase.email` |
| `rebase-entity-history` | Versionamento delle entità, tracciamento delle modifiche, audit log, ripristino |
| `rebase-admin` | Navigazione del pannello di amministrazione, drawer laterali, URL, integrazione di pannelli per le collezioni |
| `rebase-customize-admin` | Personalizzazione del pannello di amministrazione con componenti React — singleton, pagine di impostazioni, azioni di massa, modalità di visualizzazione, campi personalizzati, sostituzione di parti predefinite |
| `rebase-custom-views` | Schermate personalizzate all'interno dell'admin — `rebase generate view`, visualizzazioni di primo livello, tab per i record, widget per i campi |
| `rebase-dashboards` | KPI, grafici e dashboard — valori calcolati in SQL, renderizzati con `@rebasepro/ui`, collocati in slot o in una pagina |
| `rebase-ui-components` | La libreria di componenti `@rebasepro/ui` |
| `rebase-design-language` | Il design system dell'interfaccia: token, colori, tipografia, spaziatura, anti-pattern |
| `rebase-studio` | Il livello degli strumenti di sviluppo di Studio — SQL, RLS, storage, cron, visualizzatore dello schema, log |
| `rebase-cloud` | Deploy e gestione operativa su Rebase Cloud — progetti, database gestiti, variabili d'ambiente, domini, log, rollback |
| `rebase-deployment` | Self-hosting: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway e Render |
| `rebase-local-env-setup` | Configurazione iniziale dell'ambiente: Node.js, pnpm, PostgreSQL, Docker |

Due di queste richiedono di essere lette spontaneamente. `rebase-basics` dichiara di dover
essere utilizzata ogni volta che un assistente interagisce con Rebase, mentre `rebase-design-language` stabilisce
che un agente deve leggerla prima di creare o modificare qualsiasi interfaccia grafica — quest'ultima
esiste perché le UI generate tendono ad allontanarsi dal design system più velocemente di qualsiasi
altra parte del codebase.

## Esempio di esecuzione

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

Le skill provengono dal pacchetto `@rebasepro/agent-skills`, da cui dipende la CLI;
pertanto, il set ottenuto corrisponde alla versione della CLI installata.

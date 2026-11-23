---
sourceHash: df522ef7c8309826
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install scrive 24 skill di riferimento di Rebase nel tuo repository, nel layout previsto dal tuo assistente AI — Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity.
---

Un assistente AI che ha letto la documentazione di Rebase scrive codice Rebase
migliore rispetto a uno che cerca di indovinare dalla struttura delle API. `rebase skills install`
copia 24 file Markdown di skill nel tuo repository, in qualunque layout il tuo assistente
si aspetti:

```bash
rebase skills install
```

Le skill sono **materiale di consultazione, non strumenti**. Spiegano all'assistente
come vengono dichiarate le tabelle, perché le migrazioni sono a due passaggi e quali errori
il framework non rileverà al suo posto. Per gli strumenti che operano sui tuoi dati, consulta il
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

Gli agenti rilevati sono preselezionati. Per ognuno di quelli che mantieni, scrive le skill
e registra il [server MCP](/docs/ai/mcp) nella configurazione di progetto di quell'agente, il tutto
prima del primo commit del progetto. In CI, o con `--yes`, specificali per nome:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Un progetto esistente

`rebase init` rifiuta una directory che contiene già un progetto, quindi un progetto
creato prima dell'introduzione della configurazione degli agenti — o uno il cui autore ha rifiutato
il prompt — ottiene la stessa configurazione da `rebase skills install --mcp`: le skill e il
[server MCP](/docs/ai/mcp) registrato nella configurazione di progetto di ciascun agente. I server
già presenti nel file vengono mantenuti e una nuova esecuzione lascia la voce di Rebase inalterata.

```bash
rebase skills install --agent cursor --mcp
```

Senza `--mcp` il comando scrive solo le skill e segnala i nomi degli agenti la cui
configurazione non dispone ancora del server.

## Quale assistente

Il comando accetta `--agent` (o `-a`), ripetibile e separato da virgole:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sono supportati sette target — uno per ciascun file puntatore scritto da `rebase init`:

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
Questi quattro caricano l'intera directory delle loro regole in ogni richiesta. Avere un file di regole
per ogni skill significava circa **84.000 caratteri** di riferimenti a Rebase inseriti prima di qualsiasi
domanda posta dall'utente, che riguardasse Rebase o meno — e un'istruzione
letta superficialmente da un assistente è un'istruzione non seguita.

Ricevono invece `rebase.mdc` (o `rebase.md`): un indice di ~3 KB con
`alwaysApply: true`, che elenca ciò che ogni skill copre e il file da consultare.
I contenuti risiedono in sottodirectory dedicate per ogni skill e vengono aperti su richiesta.
:::

`gemini` copre **sia** Gemini CLI che Antigravity — leggono la stessa
directory `.agents/`, quindi non esiste un valore separato per `antigravity`. Anche Codex la
legge; specificare sia `gemini` che `codex` scrive la directory una sola volta.

Senza `--agent`, il comando rileva quali assistenti vengono già usati da un progetto
cercando `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` e
`.kiro/`. Se non ne trova alcuno, ti chiede di scegliere, con gli assistenti installati
sulla macchina già selezionati.

**GitHub Copilot non viene mai rilevato.** La sua directory corrisponderebbe a `.github/`, e
`.github/` non è una prova del fatto che qualcuno utilizzi Copilot: `rebase init` scrive
`.github/copilot-instructions.md` in ogni scaffolding e la maggior parte dei repository include
`.github/` per i flussi di lavoro. Installalo con `--agent copilot`.

:::note[Un progetto appena inizializzato richiede sempre una scelta interattiva]
`rebase init` scrive `CLAUDE.md`, `.cursorrules` e simili, ma nessuna delle
*directory* ricercate dal rilevamento. Di conseguenza, la prima esecuzione in un nuovo progetto
passa per il prompt interattivo — e in CI, in assenza di TTY, termina invece con
un errore. Passa `--agent` esplicitamente in qualsiasi contesto non interattivo.
:::

## Specifico del progetto e pensato per essere committato

Le skill vengono scritte **rispetto alla root del tuo progetto** — il percorso antenato più
vicino che contiene `rebase.json` — non nella tua home directory e non nella directory
di lavoro corrente. Nulla viene installato globalmente.

Esegui il commit di questi file. Fanno parte del repository esattamente come la configurazione di un linter: in questo
modo l'assistente di ogni collaboratore opera partendo dalla stessa comprensione della base di codice,
inclusi i collaboratori che non hanno mai eseguito il comando.

## Aggiornamento delle skill

**`rebase upgrade` le aggiorna.** Le skill sono incluse all'interno di `@rebasepro/cli`, quindi
dopo aver installato la nuova release, [`rebase upgrade`](/docs/cli/#rebase-upgrade)
esegue il comando `rebase skills install` della nuova CLI per ogni assistente la cui directory
di skill è stata scritta da un'installazione, mantenendo i file che hai modificato. Anche un progetto
già aggiornato alla release viene aggiornato. Un aggiornamento che fallisce non causa mai il fallimento dell'upgrade. Con
`--json` il campo `skills` del documento descrive quanto accaduto: `{ agents, refreshed }`, con
una `reason` nei casi in cui non sia andato a buon fine (`dry_run`, `not_installed` dopo `--no-install`,
`no_project_cli` quando il progetto non installa `@rebasepro/cli` autonomamente,
`failed`), oppure `null` se nessuna skill è installata.

Se hai aggiornato le versioni bloccate in altro modo (un bot per le dipendenze, una modifica manuale), esegui
comunque `rebase upgrade` oppure avvia tu stesso l'installazione:

```bash
rebase skills install
```

Senza `--agent`, il comando aggiorna gli assistenti le cui directory sono già presenti
nel progetto. I comandi terminano inoltre con un messaggio informativo se è disponibile una versione più recente di Rebase, così
un assistente al lavoro sul progetto viene a conoscenza della nuova release in modo autonomo.

Ogni directory di destinazione contiene un manifest `.rebase-skills.json` relativo a quanto
scritto dal comando, in modo che una riesecuzione possa distinguere una modifica manuale dalla copia di una release precedente. Committalo
insieme alle skill.

- Un file che nessuno ha modificato viene sostituito con la copia della nuova release.
- Un file modificato dall'utente viene conservato e il comando lo segnala. `--force` lo sovrascrive.
- Una skill non più inclusa in una versione più recente viene rimossa, a meno che tu non l'abbia modificata.
  In tal caso, viene mantenuta ed elencata.
- I file che il comando non ha mai generato non vengono toccati.

Le istruzioni specifiche per il progetto devono comunque risiedere in
[`ai-instructions.md`](/docs/ai/instruction-files), che è di tua proprietà. Una skill
modificata cessa di ricevere aggiornamenti finché non usi l'opzione `--force`.

Il comando funziona anche all'esterno di un progetto Rebase, facendo fallback sulla directory
di lavoro — utile nel caso di un repository frontend separato che comunica con un backend Rebase.

## Le 24 skill

| Skill | Cosa copre |
|---|---|
| `rebase-basics` | Principi fondamentali, workflow e manutenzione — il punto di ingresso presupposto da tutte le altre |
| `rebase-tables` | Creazione delle tabelle: colonne, relazioni, `rls`, hook e il livello CMS superiore (`customizeTable`) |
| `rebase-backend-postgres` | Il backend Postgres: configurazione, generazione dello schema, migrazioni, pooling, repliche di lettura |
| `rebase-api` | L'API REST generata — endpoint, filtri, ordinamento, paginazione |
| `rebase-sdk` | L'SDK TypeScript generato: CRUD, filtri, ricerca, autenticazione, realtime, offline, storage |
| `rebase-auth` | Autenticazione, ruoli, policy RLS, MFA, chiavi API, OAuth, adapter personalizzati |
| `rebase-security` | Controllo degli accessi, intercettazione, progettazione fail-closed, mascheramento PII, isolamento dei tenant |
| `rebase-realtime` | Il motore WebSocket: sincronizzazione, canali di broadcast, presence, broadcast delle modifiche alle tabelle |
| `rebase-storage` | Storage S3/GCS/locale, caricamenti, caricamenti ripristinabili TUS, trasformazioni di immagini |
| `rebase-custom-functions` | Endpoint API personalizzati tramite rilevamento delle funzioni basato su file |
| `rebase-cron-jobs` | Pianificazione di task in background ricorrenti |
| `rebase-webhooks` | Webhook HTTP in uscita, firme HMAC, tentativi e backoff |
| `rebase-email` | SMTP, template, provider personalizzati, il singleton `rebase.email` |
| `rebase-entity-history` | Versionamento delle entità, tracciamento delle modifiche, log di audit, ripristino |
| `rebase-admin` | Navigazione nel pannello di amministrazione, cassetti laterali, URL, incorporamento di pannelli di collezione |
| `rebase-customize-admin` | Personalizzazione dell'admin con componenti React — singleton, pagine di impostazioni, azioni di massa, modalità di visualizzazione, campi personalizzati, sostituzione di elementi integrati |
| `rebase-custom-views` | Schermate personalizzate all'interno dell'admin — `rebase generate view`, visualizzazioni di primo livello, schede dei record, widget di campo |
| `rebase-dashboards` | KPI, grafici e dashboard — numeri calcolati in SQL, disegnati con `@rebasepro/ui`, posizionati in slot o su una pagina |
| `rebase-ui-components` | La libreria di componenti `@rebasepro/ui` |
| `rebase-design-language` | Il design language dell'interfaccia: token, colori, tipografia, spaziatura, anti-pattern |
| `rebase-studio` | Il layer di strumenti per sviluppatori Studio — SQL, RLS, storage, cron, visualizzatore di schemi, log |
| `rebase-cloud` | Deploy e gestione su Rebase Cloud — progetti, database gestiti, variabili d'ambiente, domini, log, rollback |
| `rebase-deployment` | Self-hosting: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway e Render |
| `rebase-local-env-setup` | Configurazione iniziale: Node.js, pnpm, PostgreSQL, Docker |

Due di queste richiedono di essere lette spontaneamente. `rebase-basics` specifica di dover essere
utilizzata ogni volta che un assistente interagisce con Rebase, mentre `rebase-design-language` indica che
un agente deve leggerla prima di creare o modificare qualsiasi interfaccia visiva — quest'ultima esiste
perché le interfacce generate tendono a divergere da un design system più velocemente di qualunque altra cosa
in una base di codice.

## Come si presenta un'esecuzione

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

Le skill sono distribuite dal pacchetto `@rebasepro/agent-skills`, da cui dipende la CLI,
quindi il set ottenuto corrisponde alla versione della CLI installata.

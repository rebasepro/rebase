---
sourceHash: 62b7632c6d62c832
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install scrive 24 skill di riferimento di Rebase nel tuo repository, nel layout previsto dal tuo assistente IA — Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity.
---

Un assistente IA che ha letto la documentazione di Rebase scrive codice Rebase migliore
rispetto a uno che cerca di indovinare basandosi sulla struttura dell'API. `rebase skills install` copia 24
file di skill in formato Markdown nel tuo repository, nel layout previsto
dal tuo assistente:

```bash
rebase skills install
```

Le skill sono **materiale di consultazione, non strumenti**. Spiegano a un assistente come
vengono dichiarate le tabelle, perché le migrazioni avvengono in due passaggi e quali errori
il framework non intercetterà al suo posto. Per gli strumenti che operano sui tuoi dati, consulta il
[server MCP](/docs/ai/mcp).

## Tramite MCP, senza installare nulla

Le stesse skill possono raggiungere Claude tramite MCP. Sia il [connettore Rebase](/docs/ai/rebase-connector/#skills)
che il [server MCP locale](/docs/ai/mcp/#skills) forniscono tutte e 24 le skill, e un
client con revisione del protocollo 2026-07-28 o successiva ne carica una quando ne ha bisogno.
Claude Code le denomina `<server>:rebase-tables` e così via. Installarle nel
repository, come mostrato di seguito, rimane comunque il modo per renderle disponibili a ogni assistente, bloccate
alla release specifica utilizzata dal progetto.

Anche la tua applicazione può fornire skill agli utenti che la utilizzano: consulta
[l'endpoint MCP remoto](/docs/ai/remote-mcp/#skills).

## Configurazione tramite `rebase init`

Un nuovo progetto non ha bisogno del comando. `rebase init` chiede
se configurare i tuoi agenti di codifica IA, quindi elenca quelli che trova
sul computer:

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

Gli agenti rilevati sono già selezionati. Per ciascuno di quelli che mantieni, scrive le skill
e registra il [server MCP](/docs/ai/mcp) nella configurazione di progetto di quell'agente, il tutto
prima del primo commit del progetto. In ambienti CI, o con `--yes`, è possibile specificarli:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Un progetto esistente

`rebase init` rifiuta una directory che contiene già un progetto, quindi un progetto
creato prima dell'introduzione della configurazione degli agenti — o uno il cui autore ha rifiutato la richiesta iniziale —
ottiene la stessa configurazione tramite `rebase skills install --mcp`: le skill e il
[server MCP](/docs/ai/mcp) registrato nella configurazione di progetto di ciascun agente. I server
già presenti nel file vengono mantenuti e una nuova esecuzione lascia la voce di Rebase inalterata.

```bash
rebase skills install --agent cursor --mcp
```

Senza `--mcp` il comando scrive solo le skill ed elenca gli agenti nella cui
configurazione non è ancora presente il server.

## Quale assistente

Il comando accetta l'opzione `--agent` (o `-a`), ripetibile e separabile da virgole:

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

:::note[Cursor, Windsurf, Kiro e Copilot ottengono un unico file sempre attivo]
Questi quattro caricano l'intera directory delle regole in ogni richiesta. Avere un file di regole per
ogni skill avrebbe significato circa **84.000 caratteri** di documentazione Rebase inclusi prima di ogni
domanda posta dall'utente, a prescindere dal fatto che riguardasse Rebase o meno — e
un'istruzione letta superficialmente da un assistente è un'istruzione che non verrà seguita.

Ricevono invece `rebase.mdc` (o `rebase.md`): un indice di ~3 KB con
`alwaysApply: true`, che elenca gli argomenti trattati da ogni skill e il relativo file da leggere. I
contenuti risiedono in sottodirectory per singola skill e vengono aperti su richiesta.
:::

`gemini` copre **sia** Gemini CLI che Antigravity — entrambi leggono la stessa
directory `.agents/`, quindi non esiste un valore separato per `antigravity`. Anche Codex la
legge; specificare sia `gemini` che `codex` scrive la directory una sola volta.

Se non viene specificato `--agent`, il comando rileva quali assistenti sono già utilizzati nel progetto
cercando `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` e
`.kiro/`. Se non ne trova nessuno, ti chiede di scegliere, lasciando già selezionati
gli assistenti installati sul computer.

**GitHub Copilot non viene mai rilevato automaticamente.** La sua directory corrisponderebbe a `.github/`, e
`.github/` non prova che qualcuno utilizzi Copilot: `rebase init` scrive
`.github/copilot-instructions.md` in ogni scaffolding e la maggior parte dei repository contiene già
una cartella `.github/` per i workflow. Installalo esplicitamente con `--agent copilot`.

:::note[Un progetto appena creato tramite scaffolding richiede sempre una scelta]
`rebase init` scrive `CLAUDE.md`, `.cursorrules` e file simili, ma nessuna delle
*directory* cercate dal processo di rilevamento. Di conseguenza, la prima esecuzione in un nuovo progetto
mostra il prompt interattivo — e in CI, in assenza di TTY, termina invece con
un errore. Passa `--agent` esplicitamente in qualsiasi contesto non interattivo.
:::

## Nel perimetro del progetto e pensato per essere committato

Le skill vengono scritte **relativamente alla radice del tuo progetto** — la cartella superiore
più vicina contenente `rebase.json` — non nella tua home directory né nella directory di
lavoro corrente. Nulla viene installato a livello globale.

Esegui il commit di questi file. Fanno parte del repository esattamente come la configurazione del linter: in questo modo
l'assistente di ogni collaboratore opera partendo dalla medesima comprensione del codebase,
compresi i collaboratori che non hanno mai eseguito il comando.

## Aggiornamento delle skill

**`rebase upgrade` le aggiorna.** Le skill sono incluse all'interno di `@rebasepro/cli`, quindi
dopo aver installato la nuova release, [`rebase upgrade`](/docs/cli/#rebase-upgrade)
esegue il comando `rebase skills install` della nuova CLI per ogni assistente la cui directory delle skill
è stata scritta da un'installazione, mantenendo i file che hai modificato. Anche un progetto già aggiornato
alla release viene sincronizzato. Un aggiornamento fallito non blocca mai l'intero processo di upgrade. Utilizzando
`--json`, il campo `skills` del documento descrive l'esito: `{ agents, refreshed }`, con una proprietà `reason`
in caso di mancata esecuzione (`dry_run`, `not_installed` dopo `--no-install`,
`no_project_cli` quando il progetto non installa autonomamente `@rebasepro/cli`,
`failed`), oppure `null` in assenza di skill installate.

Se hai aggiornato le versioni in altro modo (un bot per le dipendenze, una modifica manuale), esegui
comunque `rebase upgrade`, oppure avvia l'installazione manualmente:

```bash
rebase skills install
```

Senza `--agent`, il comando aggiorna gli assistenti le cui directory sono già
presenti nel progetto. I comandi mostrano inoltre una riga conclusiva quando è disponibile una nuova versione di Rebase, così un
assistente al lavoro sul progetto viene informato della nuova release senza dover ricevere indicazioni esplicite.

Ogni directory di destinazione contiene un manifest `.rebase-skills.json` di ciò che il
comando ha scritto, consentendo a una successiva esecuzione di distinguere una modifica manuale dalla copia di una versione precedente.
Includilo nel commit insieme alle skill.

- Un file non modificato da nessuno viene sostituito con la copia della nuova release.
- Un file modificato dall'utente viene mantenuto e il comando lo segnala nell'elenco. L'opzione `--force` ne forza la sostituzione.
- Una skill non più distribuita in una nuova release viene rimossa, a meno che tu non l'abbia modificata.
  In tal caso viene mantenuta e inclusa nell'elenco.
- I file mai scritti dal comando non vengono modificati.

Le linee guida specifiche del progetto continuano a essere gestite in
[`ai-instructions.md`](/docs/ai/instruction-files), che resta a tua completa disposizione. Una skill modificata
smette di ricevere aggiornamenti fino all'utilizzo del flag `--force`.

Il comando funziona anche all'esterno di un progetto Rebase, eseguendo il fallback sulla
directory di lavoro — utile nel caso di un repository frontend separato che comunica con un backend Rebase.

## Le 24 skill

| Skill | Argomenti |
|---|---|
| `rebase-basics` | Principi fondamentali, workflow e manutenzione — il punto di ingresso presupposto da tutte le altre |
| `rebase-tables` | Creazione delle tabelle: colonne, relazioni, `rls`, hook e il livello CMS superiore (`customizeTable`) |
| `rebase-backend-postgres` | Il backend Postgres: configurazione, generazione dello schema, migrazioni, pooling, repliche di lettura |
| `rebase-api` | L'API REST generata — endpoint, filtri, ordinamento, paginazione |
| `rebase-sdk` | L'SDK TypeScript generato: CRUD, filtri, ricerca, autenticazione, realtime, offline, storage |
| `rebase-auth` | Autenticazione, ruoli, policy RLS, MFA, chiavi API, OAuth, adapter personalizzati |
| `rebase-security` | Controllo degli accessi, intercettazione, approccio fail-closed, mascheramento PII, isolamento dei tenant |
| `rebase-realtime` | Il motore WebSocket: sincronizzazione, canali broadcast, presenza, broadcast delle modifiche alle tabelle |
| `rebase-storage` | Storage S3/GCS/locale, caricamenti, upload ripristinabili TUS, trasformazioni delle immagini |
| `rebase-custom-functions` | Endpoint API personalizzati tramite rilevamento delle funzioni basato su file |
| `rebase-cron-jobs` | Pianificazione di task ricorrenti in background |
| `rebase-webhooks` | Webhook HTTP in uscita, firme HMAC, tentativi e backoff |
| `rebase-email` | SMTP, template, provider personalizzati, il singleton `rebase.email` |
| `rebase-entity-history` | Versionamento delle entità, tracciamento delle modifiche, log di audit, ripristino |
| `rebase-admin` | Navigazione nel pannello di amministrazione, cassetti laterali (drawer), URL, incorporamento dei pannelli di collezione |
| `rebase-customize-admin` | Personalizzazione dell'admin con componenti React — singleton, pagine di impostazioni, azioni di massa, modalità di visualizzazione, campi personalizzati, sostituzione delle sezioni predefinite |
| `rebase-custom-views` | Schermate personalizzate all'interno dell'admin — `rebase generate view`, visualizzazioni di primo livello, schede dei record, widget di campo |
| `rebase-dashboards` | KPI, grafici e dashboard — metriche calcolate in SQL, renderizzate con `@rebasepro/ui`, inserite in slot o in una pagina |
| `rebase-ui-components` | La libreria di componenti `@rebasepro/ui` |
| `rebase-design-language` | Il design language dell'interfaccia utente: token, colori, tipografia, spaziatura, anti-pattern |
| `rebase-studio` | La suite di strumenti di sviluppo Studio — SQL, RLS, storage, cron, visualizzatore di schemi, log |
| `rebase-cloud` | Distribuzione e gestione operativa su Rebase Cloud — progetti, database gestiti, variabili d'ambiente, domini, log, rollback |
| `rebase-deployment` | Self-hosting: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway e Render |
| `rebase-local-env-setup` | Configurazione iniziale: Node.js, pnpm, PostgreSQL, Docker |

Due di queste richiedono di essere lette spontaneamente. `rebase-basics` specifica di dover essere consultata
ogni volta che un assistente interagisce con Rebase, mentre `rebase-design-language` impone che
l'agente la legga prima di creare o modificare qualsiasi interfaccia visiva — quest'ultima esiste
perché le interfacce generate tendono a divergere da un design system più rapidamente di qualsiasi altro elemento in un codebase.

## Esempio di esecuzione

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

Le skill provengono dal pacchetto `@rebasepro/agent-skills`, dal quale dipende la CLI;
pertanto, il set ottenuto corrisponde esattamente alla versione della CLI installata.

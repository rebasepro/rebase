---
sourceHash: 4b515c5100c1fcb5
title: Server MCP
sidebar_label: MCP Server
description: Collega Claude Code, Cursor, Gemini CLI o qualsiasi client MCP a un progetto Rebase — i 53 tool che espone, le credenziali con cui si autentica e il gate di loopback che si interpone tra un agente e la produzione.
---

`@rebasepro/mcp` è un server [Model Context Protocol](https://modelcontextprotocol.io) che fornisce a un assistente IA strumenti reali su un progetto Rebase: leggere e scrivere righe, gestire utenti, eseguire migrazioni, invocare funzioni, pilotare il dev server.

Comunica tramite MCP **esclusivamente via stdio**. Non ci sono porte né listener: il processo ha esattamente lo stesso livello di attendibilità di chiunque lo abbia generato, e non c'è alcun chiamante remoto da autenticare. Questa è la parte sicura. Le questioni interessanti riguardano tutte ciò che fa *una volta* in esecuzione, e questa pagina risponde a tali domande prima di mostrare il blocco di configurazione.

Un backend distribuito può anche servire MCP direttamente, via HTTP, alle persone che usano la tua applicazione. Si tratta di una cosa diversa con un differente modello di credenziali: consulta [L'endpoint MCP remoto](/docs/ai/remote-mcp/).

:::tip[Usi Claude sul web, desktop o mobile?]
Aggiungi invece il [connettore Rebase](/docs/ai/rebase-connector/):
`https://app.rebase.pro/mcp`, una sola volta, per ogni progetto eseguito su Rebase Cloud o sui tuoi server. Questa pagina riguarda il server locale che un assistente di codifica avvia all'interno di un progetto.
:::

## Connessione di un client

Il server viene eseguito dal tuo progetto: `@rebasepro/mcp` è una devDependency che ogni scaffolding di `rebase init` fissa con la CLI, e ciascun blocco sottostante — l'intera integrazione — avvia quella copia (`pnpm exec rebase-mcp`, oppure `npx --no rebase-mcp` in un progetto npm), mai una più recente da npm. Un progetto più datato la aggiunge una sola volta, con `rebase skills install --mcp` o `pnpm add -D @rebasepro/mcp`.

`rebase init` scrive il blocco per ciascun agente selezionato quando [configura i tuoi agenti di codifica IA](/docs/ai/skills#set-up-by-rebase-init), mantenendo eventuali altri server già presenti nel file. `rebase init --agent cursor,codex` fa lo stesso senza chiedere conferma.

**Claude Code** — `.mcp.json` nella radice del progetto. `rebase init` scrive questo file per te:

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

**Cursor** — la stessa struttura, in `.cursor/mcp.json`. Cursor espande `${workspaceFolder}` nella radice del progetto:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Gemini CLI** — `.gemini/settings.json`, sotto la stessa chiave:

```json title=".gemini/settings.json"
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

**Codex CLI** — TOML invece di JSON, nel file `.codex/config.toml` del progetto. Codex legge la configurazione di un progetto solo dopo che hai indicato il progetto come attendibile:

```toml title=".codex/config.toml"
[mcp_servers.rebase]
command = "pnpm"
args = ["exec", "rebase-mcp"]

[mcp_servers.rebase.env]
REBASE_PROJECT_DIR = "."
```

**Kiro** — `.kiro/settings/mcp.json`:

```json title=".kiro/settings/mcp.json"
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

**GitHub Copilot in VS Code** — `.vscode/mcp.json`, sotto `servers` e con un transport esplicito:

```json title=".vscode/mcp.json"
{
  "servers": {
    "rebase": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Windsurf** legge i server MCP solo dalla sua configurazione a livello utente, quindi non c'è alcun file di progetto da scrivere. Aggiungi il server nelle sue impostazioni MCP come `"command": "pnpm"`, `"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, con quel percorso come `REBASE_PROJECT_DIR`.

Qualsiasi client MCP in grado di avviare un server stdio funziona; la struttura è la medesima.

### Su quale directory agisce

`REBASE_PROJECT_DIR` è la directory contenente `rebase.json`. Esiste **un unico** ordine di precedenza, ed è lo stesso in ogni client:

1. **Il blocco dell'ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`, `REBASE_API_TOKEN`. Se uno qualsiasi di essi è impostato, il progetto `default` viene ricostruito a partire da essi a ogni avvio.
2. **La working directory del server**, quando contiene un file `rebase.json`. Un progetto in cui ti trovi ha la precedenza rispetto a qualsiasi cosa memorizzata in `~/.rebase/projects.json`.
3. **Il `default` persistito** in `~/.rebase/projects.json`, quando nessuno dei primi due specifica nulla.

L'auto-discovery da `.rebase/state.json` colma le lacune in tutti e tre i casi e non sovrascrive mai un valore fornito da uno di essi.

I blocchi a livello di progetto specificano il progetto — `"."`, la working directory del client o `${workspaceFolder}` dell'editor — poiché la regola 3 legge un file condiviso da ogni progetto sulla macchina. Una configurazione a livello utente, come quella di Windsurf, indica invece un percorso assoluto.

## Cosa può raggiungere il server

Questa è la sezione da leggere prima di puntare un assistente verso un database a cui tieni.

Il server dispone di **un'unica credenziale di contesto per l'intero processo**. Non esiste un'identità per singolo tool né una modalità di sola lettura; ogni tool usa lo stesso token, e l'unico selettore presente nel pacchetto serve ad abilitare un raggio d'azione *maggiore* anziché minore.

Quale sia tale credenziale, in ordine di priorità:

1. `REBASE_API_TOKEN` dall'ambiente. `REBASE_TOKEN` non viene letto qui: è il token del control plane della CLI e non viene mai inviato all'applicazione (il server lo segnala una volta su stderr quando è l'unico impostato). I tool cloud continuano comunque a passarlo alla CLI generata, che lo invia al control plane.
2. `REBASE_SERVICE_KEY` letta dal file `.env` del progetto.
3. La service key rilevata automaticamente tramite auto-discovery da `.rebase/state.json` mentre `rebase dev` è in esecuzione.

I punti 2 e 3 rappresentano la chiave del backend di sviluppo di questa macchina, utilizzata solo quando la destinazione è su loopback. Quando `REBASE_BASE_URL` punta altrove — `rebase cloud init --claim` scrive l'indirizzo del progetto cloud, e nessun `REBASE_API_TOKEN` finché un deploy non ha successo — il server non invia alcun token e lo segnala una volta su stderr.

Un token registrato per un progetto **ha la precedenza sull'auto-discovery**. L'auto-discovery serve unicamente a colmare una mancanza.

:::danger[Il percorso zero-config è una credenziale di amministrazione]
Le opzioni 2 e 3 corrispondono alla **service key** — un segreto di amministrazione privo di restrizioni di ambito (unscoped). Il backend la risolve in `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Quell'identità possiede ogni [scope](/docs/backend/roles-and-scopes/) e soddisfa le policy `_default_admin_read` / `_default_admin_write` che Rebase inietta in ogni collection che non abbia impostato `disableDefaultPolicies`.

Quindi la risposta sincera a "la RLS la vincola ancora?" è: la RLS *viene eseguita* — il driver effettua il downgrade al ruolo `rebase_user` — e poi una policy scritta da Rebase stessa concede a quell'identità qualsiasi permesso. Leggere ogni riga di ogni collection è il **comportamento previsto dalla configurazione predefinita**, non un bypass.

Con la configurazione zero-config, un agente dotato di questi tool può leggere e scrivere ogni riga di ogni collection, elencare tutti gli utenti, reimpostare qualsiasi password, invocare qualsiasi funzione di backend ed eseguire istruzioni DDL su qualunque `DATABASE_URL` risolto dal progetto.
:::

### Assegnare invece una credenziale con permessi limitati

Registra una [chiave API](/docs/backend/api-keys) con scope e il modello a due gate verrà applicato realmente. Una chiave di servizio viene eseguita con i ruoli `["service"]`, che le policy di amministrazione iniettate **non** nominano: di conseguenza la RLS non le concede nulla a meno che una delle tue policy non stabilisca diversamente, e i suoi scope la limitano ulteriormente:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Passa quindi la chiave `rk_live_…` risultante al server anziché lasciare che rilevi una service key:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absolute/path/to/your/project",
        "REBASE_API_TOKEN": "rk_live_..."
      }
    }
  }
}
```

Due cose che questo **non** fa, entrambe importanti da sapere prima di farvi affidamento:

- **Non limita i tool della CLI.** `rebase_db_push`, `rebase_db_migrate`, `rebase_doctor` e i tool di gestione dei branch avviano la CLI di Rebase, la quale si connette con `DATABASE_URL` e non vede affatto il tuo token. Il gate di loopback descritto sotto è l'unica protezione posta davanti ad essi.
- **Una chiave può accedere a un tool di amministrazione solo con lo scope specifico di quel tool.** `list_users` e `list_roles` richiedono `users:read`; `create_user`, `update_user`, `delete_user` e `rebase_auth_reset_password` richiedono `users:write`; i tool di storage e cron richiedono il rispettivo scope `storage:*` o `cron:*`; `invoke_function` richiede `functions:invoke`. Senza di esso, la chiamata risponde `403 SCOPE_MISSING`. Anche con `users:write`, una chiave non può modificare l'account di un amministratore: un amministratore detiene `keys:read` e `keys:write`, che nessuna chiave può avere, e nessuno può gestire un account che possiede più privilegi dei propri.

Una chiave creata con `--roles admin` è un discorso differente: trasporta i ruoli `["service", "admin"]`, che soddisfano le stesse policy di amministrazione predefinite della service key. Assegnandole anche `--full-access`, il suo raggio d'azione diventa pari a quello della service key, a esclusione della gestione delle chiavi. Ciò che aggiunge è che risulta **revocabile, con scadenza e con rate limiting per singola chiave**, caratteristiche che non appartengono alla service key — ruotare quest'ultima richiede la modifica del file `.env` e il riavvio del server.

Consulta [Agenti e server MCP](/docs/backend/api-keys#agents-and-mcp-servers) per la guida completa alla definizione degli scope delle chiavi.

### Rendere una collection del tutto inaccessibile

Il motivo per cui una credenziale di amministrazione può leggere tutto è la policy di base che Rebase inietta in ciascuna collection, concedendo l'accesso al contesto server attendibile e al ruolo `admin`. Una collection può escludere questa baseline e assumere la piena responsabilità della propria RLS:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const medicalRecordsCollection = defineCollection({
    slug: "medical_records",
    name: "Medical records",
    table: "medical_records",
    properties: {
        patient_id: { name: "Patient", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    disableDefaultPolicies: true,
    securityRules: [
        { operations: ["select", "update"], ownerField: "patient_id" }
    ]
});
```

Ora l'unico modo per accedere è corrispondere a `patient_id`. L'uid della service key è la stringa letterale `service`, quindi una regola sull'owner non corrisponderà mai — le letture restituiscono zero righe e le scritture vengono rifiutate da Postgres. Questo è l'unico controllo che vincola la credenziale predefinita del server MCP anziché ignorarla.

Ricorda che questa è una vera modifica RLS, non una questione documentale: diventa effettiva solo dopo che `rebase schema generate` e una migrazione hanno applicato le policy. Consulta [Regole di sicurezza (RLS)](/docs/collections/security-rules).

## Il gate di loopback

`rebase_project_add` accetta qualsiasi `baseUrl`, e i tool della CLI si connettono con qualunque `DATABASE_URL` dichiarato dal progetto. Lo stesso elenco di tool che modifica un database di test sul tuo portatile potrebbe quindi eliminare righe di produzione, senza nient'altro in mezzo se non il giudizio dell'assistente su quale sia il progetto attivo.

**Ogni tool che modifica l'ambiente di destinazione viene rifiutato a meno che tale destinazione non si trovi sull'interfaccia di loopback.** Il gate è formulato come un elenco di ciò che *non* è soggetto a restrizioni, di modo che un tool aggiunto in seguito risulti protetto per impostazione predefinita.

- **Non soggetti a gate — letture:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, e le letture di Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Non soggetti a gate — scritture di Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Il provisioning crea un progetto; gli altri modificano un progetto di produzione. Nessuno
  di essi passa attraverso `baseUrl` o `DATABASE_URL`, che sono gli unici parametri controllabili
  dal gate. Consulta [Rebase Cloud](#rebase-cloud) per sapere cosa fa da scudo davanti ad essi.
- **Non soggetti a gate — solo locali:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, i tool del dev server e i tool del registry di progetto.
  Questi scrivono file locali o stato locale e non hanno una destinazione remota da controllare.
- **Soggetti a gate rispetto a `DATABASE_URL`:** i restanti tool della CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Soggetti a gate rispetto al `baseUrl` del progetto:** i restanti tool dell'SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

Le due destinazioni non sono intercambiabili. I tool della CLI non vedono mai `baseUrl`, per cui un backend su localhost affiancato a un `DATABASE_URL` di produzione viene verificato rispetto al database, non al backend.

Un rifiuto si presenta così:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se non è possibile risolvere alcuna stringa di connessione, i tool DB soggetti a gate vengono rifiutati.**
Senza un `DATABASE_URL`, la CLI utilizza il database di sviluppo gestito, che rappresenta l'impostazione predefinita per un nuovo progetto, e il gate vieta lì i suoi quattro tool di database. Il messaggio di rifiuto spiega il motivo e indica cosa funziona in alternativa. Non suggerisce l'opzione di esclusione (opt-out):

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Da terminale, `rebase db push` e `rebase db migrate` vengono effettivamente eseguiti su quel database; solo i tool MCP vengono rifiutati.

Solo il loopback viene considerato locale: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1` (e `0.0.0.0`).
I range privati come `10.x` e `192.168.x` **non** lo sono: è altrettanto probabile che si tratti di un cluster di staging condiviso quanto di un laptop, e trattarli come locali lascerebbe passare esattamente l'incidente che il gate è stato concepito per impedire.

Imposta `REBASE_MCP_ALLOW_REMOTE_WRITES=true` per disattivare il gate. Impostarlo a livello globale nella configurazione del client MCP rimuove la protezione per ogni progetto che il server può raggiungere, non solo per quello a cui stavi pensando.

## Marcatura dei dati non attendibili

Righe, record utente, elenchi dello storage, cron job, risposte di funzioni e output della CLI vengono restituiti racchiusi in un envelope esplicito:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualsiasi informazione memorizzata nel database è stata scritta da qualcuno, e arriva sullo stesso canale del contratto dei tool seguito dall'assistente. L'envelope istruisce il modello a trattarla come contenuto inerte anziché come istruzioni.

L'`id` viene generato ex novo per ogni risposta, dopo che i dati sono stati scritti, e solo il marcatore di chiusura che lo riporta chiude il blocco. Il testo all'interno dei dati che ha la forma di un marcatore viene interrotto con uno spazio a larghezza zero (zero-width space), in modo che una riga che stampa `<<<END_UNTRUSTED_DATA>>>` non possa chiudere prematuramente l'envelope e collocare all'esterno ciò che segue.

L'[endpoint remoto](/docs/ai/remote-mcp/) delimita i risultati dei propri tool nello stesso modo e lo dichiara al client; il suo `structuredContent` trasporta il risultato non elaborato. `list_collections` e `describe_collection` fanno eccezione: solo un modello li legge, quindi vengono inviati una sola volta, nel testo.

Si tratta di un marcatore, non di una sandbox. Un assistente provvisto di questi tool è sicuro solo quanto i contenuti di cui gli viene consentita la lettura.

## Più progetti

Le configurazioni dei progetti sono memorizzate in `~/.rebase/projects.json`, e il server può gestirne diverse contemporaneamente — utile quando si lavora su ambienti locali e remoti. Mentre `rebase dev` è in esecuzione, il server legge la porta attiva e la service key da `.rebase/state.json` nella directory del progetto, ed è ciò che rende il caso d'uso locale privo di configurazione manuale (zero-config).

:::note[Il registry ha l'ultima parola, non la prima]
L'ordine di precedenza è quello sopra indicato: il blocco dell'ambiente, poi la working directory se contiene un file `rebase.json`, infine il `default` persistito.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` ricostruiscono il progetto `default` **a ogni avvio**, non solo al primo. La ricostruzione avviene per intero: un token registrato rispetto alla vecchia `projectDir` viene rimosso anziché essere trasferito in una directory per la quale non è mai stato emesso. Un `default` derivato in questo modo — o dalla working directory — non viene mai riscritto in `~/.rebase/projects.json`, evitando così che la service key di sviluppo di un progetto diventi quella di un altro.

`activeProject` è persistente ("sticky"): se una sessione precedente ha chiamato `rebase_project_switch`, i tool prendono di mira quel progetto e il server lo segnala su stderr — a meno che tale progetto non sia registrato in una directory *diversa* da quella in cui viene eseguito questo server, nel qual caso torna automaticamente a `default` segnalandolo. Se un assistente sembra leggere il database sbagliato, invoca prima `rebase_project_current`.
:::

I token sono memorizzati in quel registry **in chiaro**. Si tratta di un file nella tua home directory contenente credenziali di amministrazione per ogni progetto registrato; trattalo con la dovuta cautela.

## Rebase Cloud

Otto tool consentono di portare un'app da questa directory a un backend attivo su [Rebase Cloud](/docs/deployment/cloud/) e mantenerla in esecuzione. Ognuno di essi genera `rebase cloud <command> --json` nella directory del progetto attivo: lo stesso comando eseguito da una persona, in modo da non avere una seconda implementazione che possa divergere.

| Tool | Esegue | Modifica il progetto |
|---|---|---|
| `rebase_cloud_provision` | `rebase cloud init --claim` | Ne crea uno, senza account |
| `rebase_cloud_status` | `rebase cloud status` | No |
| `rebase_cloud_deploy` | `rebase cloud deploy` | Sì |
| `rebase_cloud_logs` | `rebase cloud logs [--runtime]` | No |
| `rebase_cloud_env_list` | `rebase cloud env list` | No |
| `rebase_cloud_env_set` | `rebase cloud env set KEY --stdin` | Sì, a partire dal deploy successivo |
| `rebase_cloud_deployments_list` | `rebase cloud deployments list` | No |
| `rebase_cloud_rollback` | `rebase cloud rollback --yes` | Sì |
| `rebase_cloud_projects_list` | `rebase cloud projects list --all-orgs` | No |

Il percorso tipico dell'agente è: `rebase_cloud_provision`, quindi fornire all'utente l'URL di reclamo (claim URL); `rebase_cloud_status` per visualizzare il progetto (finché non è reclamato, `unclaimed` riporta l'URL di reclamo e la data di eliminazione prevista); `rebase_cloud_deploy` dopo una modifica; `rebase_cloud_logs` in caso di anomalie; e `rebase_cloud_rollback` quando la produzione è compromessa.

**Su cosa agiscono.** Il progetto a cui la directory attiva è collegata in `.rebase/cloud.json`. Nessuno di essi accetta un ID progetto o una directory, quindi un assistente non può puntarli verso un progetto diverso da quello a cui la directory è collegata. Cambiare il progetto attivo con `rebase_project_switch` cambia la directory in cui vengono eseguiti.

**Con quale autorità.** Qualsiasi elemento la CLI risolva in quella directory: `REBASE_TOKEN` quando impostato, poi il token memorizzato da `rebase cloud init --claim` per un progetto non reclamato, infine la sessione di `rebase cloud login`. Nella directory di quel progetto non reclamato, un `REBASE_TOKEN` che non possiede alcuno scope sul progetto viene accantonato a favore del token specifico del progetto. Il control plane controlla ciascuna chiamata esattamente come fa con la CLI: pertanto, con un token creato tramite `rebase cloud tokens create --can logs` un assistente può leggere i log, mentre il control plane rifiuterà i suoi deploy, variabili e rollback. L'assenza di credenziali o un rifiuto vengono restituiti sotto forma di errore che indica cosa deve fare l'utente (`rebase cloud login` o il reclamo del progetto).

**Perché il gate di loopback non si applica.** Il gate controlla il `baseUrl` dell'app e il `DATABASE_URL` della CLI; questi tool non usano nessuno dei due. Dopo `rebase_cloud_provision`, `REBASE_BASE_URL` punta al nuovo progetto cloud, quindi applicare il gate rifiuterebbe proprio il deploy di cui il percorso ha bisogno. Il provisioning stesso si limita a creare: non tocca alcuna app o database esistente, e la CLI lo rifiuta comunque in una directory già collegata. Un deploy, una variabile e un rollback modificano ciascuno la produzione. Ciò che fa da scudo davanti ad essi è la credenziale sopra indicata e l'approvazione dei tool da parte del tuo client MCP. Per impedire a un assistente di modificare un progetto cloud, imposta `REBASE_TOKEN` nell'ambiente del server con un token privo delle capability `deploy` ed `env`.

**Leggere uno qualsiasi dei tuoi progetti.** I tool sopra indicati agiscono sul progetto collegato. Per leggere i dati di un altro progetto — qualsiasi progetto in qualunque organizzazione a cui appartiene l'account che ha effettuato l'accesso, collegato qui o meno — `rebase_cloud_projects_list` li elenca e `rebase_project_use_cloud` (con un ID, slug o nome) vi indirizza i tool di dati e di amministrazione: `list_documents`, `get_document`, `list_users`, `list_roles`, `cron_list_jobs`, `storage_list_objects`. Tali chiamate passano attraverso il proxy Studio della console, trasportando le credenziali della CLI (`rebase cloud access-token`, letto per ciascuna chiamata e mai memorizzato); il control plane verifica l'accesso dell'utente e allega la service key del progetto dal proprio lato, evitando che la chiave raggiunga la macchina locale. Un progetto con Studio disattivato viene rifiutato, e il messaggio lo segnala. Si tratta di una destinazione remota come qualsiasi altra, per cui i tool che modificano i dati rimangono bloccati a meno che non sia impostato `REBASE_MCP_ALLOW_REMOTE_WRITES`; `rebase_project_switch` consente di tornare indietro.

Ciascun tool opera come uno snapshot:

- `rebase_cloud_logs` non effettua mai il follow (non resta in ascolto continuo). Il suo risultato include `nextSinceTime`; passalo di nuovo come `since` per leggere quanto avvenuto successivamente. Restituisce le ultime 200 righe a meno che `tail` non specifichi diversamente. `source: "build"` restituisce invece il log di build più recente.
- `rebase_cloud_deploy` segue il deployment fino al termine e verifica che la nuova versione risponda. `wait: false` ritorna non appena il deployment viene avviato. Non esegue mai l'eject di un progetto dal runtime gestito, non distribuisce una release precedente del framework né salta i controlli di build: queste sono decisioni riservate all'utente, e un rifiuto che ne richiede una lo specifica chiaramente.
- `rebase_cloud_rollback` passa `--yes`. La chiamata al tool funge da conferma, non essendoci un terminale in cui richiederla.

`rebase_cloud_env_set` scrive il valore sullo standard input della CLI, evitando che compaia sulla riga di comando dove `ps` lo mostrerebbe, e il valore viene escluso da qualsiasi output restituito dal tool. Il risultato indica cosa è stato salvato (la chiave, se è un segreto, se è in sospeso un nuovo deploy), mai il valore. `rebase_cloud_env_list` elenca solo le chiavi. Una CLI precedente a `env set --stdin` viene rifiutata con un messaggio che invita all'aggiornamento; il valore non viene inviato in alcun altro modo.

I risultati vengono restituiti nell'[envelope dei dati non attendibili](#marcatura-dei-dati-non-attendibili), preceduti da una riga del server su come procedere. Un rifiuto è un errore del tool che riporta il codice della CLI, come `no_project`, `token_rejected`, `managed_project` o `deploy_failed`. Quando il server riconosce il codice, aggiunge il passaggio successivo, seguito dal messaggio della CLI stessa. Ogni tool controlla i propri argomenti rispetto allo schema dichiarato prima che venga avviato qualsiasi processo, rifiutando qualsiasi argomento non dichiarato.

## Riferimento dei tool

53 tool, suddivisi in dieci gruppi: schema e database, pianificazione dello schema, documenti, utenti e ruoli, storage, cron, funzioni, dev server, registry dei progetti e Rebase Cloud.
Ognuno di essi, con i relativi requisiti e l'indicazione se il gate lo rifiuta a fronte di una destinazione non locale, è riportato nel [riferimento dei tool MCP](/docs/ai/mcp-tool-reference).

## Risorse

Oltre ai tool, il server espone risorse MCP in modo che un client possa ottenere il contesto del progetto senza dover consumare una chiamata a un tool:

| URI | Descrizione |
|---|---|
| `rebase://collections/{name}` | Sorgente TypeScript della definizione di una collection |
| `rebase://schema` | Lo schema Drizzle generato (`schema.generated.ts`) |

Le collection vengono rilevate da `app/config/collections/`, `config/collections/` o `collections/` all'interno della directory del progetto attivo — a seconda di quale esista.

`rebase://schema` viene elencato **solo se** lo schema generato esiste. `findBackendDir` cerca `backend/` e successivamente `app/backend/` nella directory del progetto attivo, e legge `src/schema.generated.ts` da quella che trova — quindi funzionano sia il layout generato tramite scaffolding sia quello di questo monorepo, mentre un progetto strutturato in un terzo modo, o che non ha ancora eseguito `rebase schema generate`, semplicemente non vedrà la risorsa tra quelle disponibili.

## L'endpoint remoto

Un backend distribuito può anche servire MCP direttamente, su `/mcp`, alle persone che usano la tua applicazione, ciascuna connettendosi con la propria identità sotto la propria row-level security. Questo argomento ha una pagina dedicata: [L'endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configurazione consigliata

- Punta il server a un progetto **locale** e lascia `REBASE_MCP_ALLOW_REMOTE_WRITES` non impostato. Il gate è la funzionalità di maggior valore dell'intero pacchetto.
- Per qualsiasi risorsa remota, registra una **chiave API `rk_` con scope** anziché lasciare che l'auto-discovery fornisca una service key.
- Controlla `rebase_project_current` quando l'output sembra errato. Il progetto attivo è persistente (sticky) e risiede al di fuori del tuo repository.
- Tratta `~/.rebase/projects.json` come un file contenente segreti.

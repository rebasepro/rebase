---
sourceHash: b20067fcabaf42ec
title: Server MCP
sidebar_label: Server MCP
description: Connetti Claude Code, Cursor, Gemini CLI o qualsiasi client MCP a un progetto Rebase — i 51 tool esposti, le credenziali con cui si autentica e il loopback gate che si interpone tra un agent e la produzione.
---

`@rebasepro/mcp` è un server [Model Context Protocol](https://modelcontextprotocol.io)
che fornisce a un assistente AI veri e propri tool su un progetto Rebase: leggere e
scrivere righe, gestire utenti, eseguire migrazioni, invocare funzioni, gestire il dev
server.

Comunica via MCP **esclusivamente tramite stdio**. Non ci sono porte né listener: il
processo gode dello stesso identico livello di affidabilità di ciò che lo ha generato,
e non c'è alcun chiamante remoto da autenticare. Questa è la parte sicura. Le questioni
interessanti riguardano tutte cosa fa *una volta* avviato, e questa pagina risponde a
tali domande prima di mostrare il blocco di configurazione.

Un backend distribuito può anche servire MCP direttamente, via HTTP, per gli utenti
della tua applicazione. Si tratta di un meccanismo diverso con un differente modello di
credenziali: vedi [L'endpoint MCP remoto](/docs/ai/remote-mcp/).

## Connettere un client

Il server viene eseguito dal tuo progetto: `@rebasepro/mcp` è una devDependency che ogni
scaffold di `rebase init` fissa insieme alla CLI, e ogni blocco seguente — l'intera
integrazione — avvia quella copia (`pnpm exec rebase-mcp`, oppure `npx --no rebase-mcp`
in un progetto npm), mai una più recente da npm. Un progetto più vecchio la aggiunge una
volta, con `rebase skills install --mcp` oppure `pnpm add -D @rebasepro/mcp`.

`rebase init` scrive il blocco per ciascun agent selezionato quando
[configura i tuoi agent di programmazione AI](/docs/ai/skills#set-up-by-rebase-init), mantenendo
eventuali altri server già presenti nel file. `rebase init --agent cursor,codex` esegue
la stessa operazione senza chiedere conferma.

**Claude Code** — `.mcp.json` nella root del progetto. `rebase init` scrive questo
file per te:

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

**Cursor** — la stessa struttura, in `.cursor/mcp.json`. Cursor espande
`${workspaceFolder}` nella root del progetto:

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

**Codex CLI** — TOML invece di JSON, nel file `.codex/config.toml` del progetto.
Codex legge la configurazione di un progetto solo dopo che hai confermato l'affidabilità del progetto:

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

**GitHub Copilot in VS Code** — `.vscode/mcp.json`, sotto `servers` e con
un trasporto esplicito:

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

**Windsurf** legge i server MCP esclusivamente dalla configurazione a livello utente, quindi non c'è
alcun file di progetto da scrivere. Aggiungi il server nelle sue impostazioni MCP come
`"command": "pnpm"`, `"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`,
con quel percorso come `REBASE_PROJECT_DIR`.

Qualsiasi client MCP in grado di avviare un server stdio funziona; la struttura è la medesima.

### Su quale directory opera

`REBASE_PROJECT_DIR` è la directory contenente `rebase.json`. Esiste **un solo**
ordine di precedenza, ed è lo stesso in ogni client:

1. **Il blocco delle variabili d'ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se uno qualsiasi di essi è impostato, il progetto `default` viene ricostruito
   da essi a ogni avvio.
2. **La directory di lavoro del server**, quando contiene un `rebase.json`. Un progetto
   in cui ci si trova ha la precedenza rispetto a qualsiasi elemento memorizzato in `~/.rebase/projects.json`.
3. **Il `default` persistito** in `~/.rebase/projects.json`, se nessuna delle prime
   due opzioni specifica alcunché.

L'auto-discovery da `.rebase/state.json` colma le lacune in tutti e tre i casi e non
sovrascrive mai un valore fornito da uno di essi.

I blocchi a livello di progetto indicano il progetto — `"."`, la directory di lavoro
del client, o `${workspaceFolder}` dell'editor — perché la regola 3 legge un file
condiviso da ogni progetto sulla macchina. Una configurazione a livello utente, come quella di Windsurf,
indica invece un percorso assoluto.

## Cosa può raggiungere il server

Questa è la sezione da leggere prima di puntare un assistente verso un database importante.

Il server gestisce **una sola credenziale d'ambiente per l'intero processo**. Non c'è
un'identità per singolo tool né una modalità di sola lettura; ogni tool usa lo stesso token, e
l'unico selettore nel pacchetto serve ad *ampliare* i permessi anziché ridurli.

Quale sia questa credenziale, in ordine di priorità:

1. `REBASE_API_TOKEN` dall'ambiente. `REBASE_TOKEN` non viene letto qui:
   è il token del control plane della CLI, e non viene mai inviato all'app (il
   server lo segnala una volta su stderr quando è l'unico impostato). I tool cloud
   lo passano comunque alla CLI che avviano, la quale lo invia al control plane.
2. `REBASE_SERVICE_KEY` letto dal file `.env` del progetto
3. La service key rilevata automaticamente da `.rebase/state.json` mentre `rebase dev`
   è in esecuzione

Le opzioni 2 e 3 sono la chiave del backend di sviluppo di questa macchina, usata solo quando la destinazione è
in loopback. Quando `REBASE_BASE_URL` punta altrove — `rebase cloud init --claim`
scrive l'indirizzo del progetto cloud, e nessun `REBASE_API_TOKEN` finché un deploy
non riesce — il server non invia alcun token e lo segnala una volta su stderr.

Un token registrato per un progetto **prevale sull'auto-discovery**. La rilevazione automatica
serve solo a colmare le lacune.

:::danger[Il percorso zero-config è una credenziale di amministrazione]
Le opzioni 2 e 3 sono la **service key** — un segreto di amministrazione senza restrizioni (unscoped). Il backend
lo risolve in `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Tale
identità possiede ogni [scope](/docs/backend/roles-and-scopes/) e soddisfa le
policy `_default_admin_read` / `_default_admin_write` che Rebase inietta in
ogni collection in cui non sia impostato `disableDefaultPolicies`.

Di conseguenza, la risposta onesta a "l'RLS pone comunque dei vincoli?" è: l'RLS *viene eseguito* — il
driver effettua il downgrade al ruolo `rebase_user` — e poi una policy scritta da Rebase
stesso concede tutto a quell'identità. La lettura di ogni riga di ogni
collection è il **comportamento previsto dalla configurazione predefinita**, non un
bypass.

Con la configurazione zero-config, un agent in possesso di questi tool può leggere e scrivere ogni
riga di ogni collection, elencare ogni utente, reimpostare qualsiasi password, invocare qualsiasi funzione
di backend ed eseguire DDL su qualsiasi `DATABASE_URL` risolto dal progetto.
:::

### Fornire una credenziale con permessi ristretti

Registra una [API key](/docs/backend/api-keys) con ambito limitato e il modello a
doppio controllo (two-gate) si applicherà realmente. Una service key viene eseguita con i ruoli `["service"]`, che le
policy di amministrazione iniettate **non** menzionano — pertanto l'RLS non le concede nulla a meno che una
delle tue policy non disponga diversamente, e i suoi scope la restringono ulteriormente:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Quindi fornisci la chiave `rk_live_…` risultante al server anziché lasciare che
rilevi una service key:

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

Due aspetti che questo **non** fa, entrambi utili da sapere prima di farvi affidamento:

- **Non restringe i tool della CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e i tool dei branch avviano la CLI di Rebase, che si connette tramite
  `DATABASE_URL` e non vede mai il tuo token. Il loopback gate descritto di seguito è l'unica
  protezione a monte di questi ultimi.
- **Una chiave raggiunge un tool di amministrazione solo con lo scope di quel tool.** `list_users` e
  `list_roles` richiedono `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` richiedono `users:write`; i tool dello storage e dei cron
  richiedono lo scope `storage:*` o `cron:*` corrispondente; `invoke_function` richiede
  `functions:invoke`. Senza
  di esso la chiamata risponde `403 SCOPE_MISSING`. Anche con `users:write`, una chiave non può
  modificare l'account di un admin: un admin possiede `keys:read` e `keys:write`, che nessuna
  chiave può avere, e nessuno può gestire un account che possiede più di quanto possieda lui.

Una chiave creata con `--roles admin` è un discorso differente: possiede i ruoli
`["service", "admin"]`, che superano le medesime policy di amministrazione predefinite superate dalla service
key. Aggiungi anche `--full-access` e il suo raggio d'azione coincide con quello della service key,
esclusa la gestione delle chiavi. Il vantaggio aggiuntivo è che
è **revocabile, con scadenza e soggetta a rate limit per chiave**, caratteristiche assenti
nella service key — per ruotare quest'ultima occorre modificare `.env` e riavviare il server.

Consulta [Agent e server MCP](/docs/backend/api-keys#agents-and-mcp-servers) per la
guida completa sulla definizione degli ambiti delle chiavi.

### Escludere del tutto una collection

Il motivo per cui una credenziale di amministrazione può leggere tutto risiede nella policy di base che Rebase
inietta in ciascuna collection, concedendo il contesto server fidato e il
ruolo `admin`. Una collection può disattivare tale baseline e assumere il pieno
controllo della propria RLS:

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

Ora l'unico modo per accedervi è corrispondere a `patient_id`. L'uid della service key è la
stringa letterale `service`, quindi una regola sull'owner non corrisponderà mai — le letture restituiscono zero
righe e le scritture vengono rifiutate da Postgres. Questo è l'unico controllo che vincola
realmente la credenziale predefinita del server MCP anziché darne per scontata la sicurezza.

Ricorda che questa è una modifica RLS effettiva, non solo documentale: diventa operativa
solo dopo che `rebase schema generate` e una migrazione hanno applicato le policy. Vedi
[Regole di sicurezza (RLS)](/docs/collections/security-rules).

## Il loopback gate

`rebase_project_add` accetta qualsiasi `baseUrl`, e i tool della CLI si connettono con
qualsiasi `DATABASE_URL` dichiarato dal progetto. L'elenco di tool utilizzato per modificare un
database di prova sul tuo computer portatile può quindi eliminare righe in produzione, senza nulla
nel mezzo se non il giudizio dell'assistente su quale progetto sia attivo.

**Ogni tool che modifica l'ambiente di destinazione viene rifiutato a meno che tale destinazione non sia
sull'interfaccia di loopback.** Il gate è definito come un elenco di ciò che *non* è
soggetto al gate, pertanto un tool aggiunto successivamente risulterà protetto per impostazione predefinita.

- **Non soggetti a gate — letture:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, e le letture di Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Non soggetti a gate — scritture su Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Il provisioning crea un progetto; gli altri modificano un progetto di produzione. Nessuno
  di essi passa da `baseUrl` o da `DATABASE_URL`, che sono tutto ciò che il gate può
  verificare. Vedi [Rebase Cloud](#rebase-cloud) per ciò che sta davanti a loro.
- **Non soggetti a gate — solo locali:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, i tool del dev-server e i tool del registro dei progetti.
  Questi scrivono file locali o stato locale e non hanno alcuna destinazione remota da verificare.
- **Soggetti a gate rispetto a `DATABASE_URL`:** i restanti tool della CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Soggetti a gate rispetto al `baseUrl` del progetto:** i restanti tool dell'SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  e `invoke_function`.

Le due destinazioni non sono intercambiabili. I tool della CLI non vedono mai `baseUrl`, quindi un
backend su localhost associato a un `DATABASE_URL` di produzione viene verificato rispetto
al database, non al backend.

Un rifiuto si presenta in questo modo:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se non è possibile risolvere alcuna stringa di connessione, i tool del DB soggetti a gate vengono rifiutati.**
Senza `DATABASE_URL`, la CLI usa il database di sviluppo gestito, che è
l'impostazione predefinita per un nuovo progetto, e il gate rifiuta lì i suoi
quattro tool per il database. Il rifiuto dice perché e indica cosa funziona
al suo posto. Non suggerisce la via d'uscita:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Da un terminale,
`rebase db push` e `rebase db migrate` girano su quel database; solo i tool MCP
vengono rifiutati. Su 0.24 la CLI li rifiuta lì anche lei.

Solo il loopback è considerato locale: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
Gli intervalli privati come `10.x` e `192.168.x` **non** lo sono — possono altrettanto facilmente essere
un cluster di staging condiviso quanto un laptop, e trattarli come locali lascerebbe
passare proprio l'incidente che il gate intende prevenire.

Imposta `REBASE_MCP_ALLOW_REMOTE_WRITES=true` per disattivare la protezione. Impostarlo a livello globale nella configurazione
del tuo client MCP rimuove il blocco per ogni progetto raggiungibile dal server, non
solo per quello a cui stavi pensando.

## Marcatura dei dati non attendibili (Untrusted-data)

Righe, record utente, elenchi dello storage, cron job, risposte di funzioni e output
della CLI vengono restituiti racchiusi in un involucro (envelope) esplicito:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualsiasi dato memorizzato nel database è stato scritto da qualcuno e arriva
sullo stesso canale del contratto del tool seguito dall'assistente. L'envelope indica
al modello di trattarlo come contenuto inerte anziché come istruzioni.

L'`id` viene generato nuovo per ogni risposta, dopo che i dati sono stati scritti, e
solo il marcatore di chiusura che lo riporta chiude il blocco. Il testo all'interno dei dati che ha
la forma di un marcatore viene spezzato con uno spazio a larghezza zero, in modo che una riga che stampa
`<<<END_UNTRUSTED_DATA>>>` non possa chiudere l'envelope in anticipo collocando ciò che segue
all'esterno.

L'[endpoint remoto](/docs/ai/remote-mcp/) racchiude allo stesso modo i risultati dei
suoi tool e lo comunica al client; il suo `structuredContent` trasporta il risultato puro.
`list_collections` e
`describe_collection` fanno eccezione: li legge solo un modello, quindi vengono
inviati una sola volta, nel testo. Prima della 0.24 l'elenco portava anche una
copia in `structuredContent`.

Si tratta di un marcatore, non di una sandbox. Un assistente provvisto di questi tool è sicuro
tanto quanto i contenuti che gli viene consentito di leggere.

## Progetti multipli

Le configurazioni di progetto sono memorizzate in `~/.rebase/projects.json`, e il server
può gestirne diverse contemporaneamente — utile quando si lavora tra ambienti locali
e remoti. Mentre `rebase dev` è in esecuzione, il server legge la porta attiva e
la service key da `.rebase/state.json` nella directory del progetto, ed è ciò che
rende il caso locale a configurazione zero.

:::note[Il registry ha l'ultima parola, non la prima]
La precedenza è quella indicata sopra: il blocco dell'ambiente, poi la directory di lavoro
quando contiene un `rebase.json`, infine il `default` persistito.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` ricostruiscono il
progetto `default` **a ogni avvio**, non solo al primo. La ricostruzione avviene
sull'intera voce: un token registrato per il vecchio `projectDir` viene eliminato anziché
essere trasferito in una directory per cui non è mai stato emesso. Un `default` derivato in
questo modo — o dalla directory di lavoro — non viene mai riscritto in
`~/.rebase/projects.json`, affinché la service key di sviluppo di un progetto non diventi
quella di un altro.

`activeProject` è persistente (sticky), quindi se una sessione precedente ha chiamato
`rebase_project_switch`, i tool avranno come target quel progetto e il server lo segnalerà su
stderr — a meno che tale progetto non sia registrato in una directory *diversa* da
quella in cui viene eseguito questo server, nel qual caso ripiega su `default` e lo
segnala. Se un assistente sembra leggere dal database errato, esegui prima
`rebase_project_current`.
:::

I token vengono memorizzati in tale registro **in chiaro**. È un file nella tua home
directory che contiene credenziali di amministrazione per ogni progetto registrato; trattalo
con la dovuta cautela.

## Rebase Cloud

Otto tool portano un'app da questa directory a un backend attivo su
[Rebase Cloud](/docs/deployment/cloud/) e lo mantengono in esecuzione. Ciascuno avvia
`rebase cloud <command> --json` nella directory del progetto attivo: lo stesso
comando che esegue una persona, quindi non esiste una seconda implementazione che possa divergere.

| Tool | Esegue | Modifica il progetto |
|---|---|---|
| `rebase_cloud_provision` | `rebase cloud init --claim` | Ne crea uno, senza account |
| `rebase_cloud_status` | `rebase cloud status` | No |
| `rebase_cloud_deploy` | `rebase cloud deploy` | Sì |
| `rebase_cloud_logs` | `rebase cloud logs [--runtime]` | No |
| `rebase_cloud_env_list` | `rebase cloud env list` | No |
| `rebase_cloud_env_set` | `rebase cloud env set KEY --stdin` | Sì, dal deploy successivo |
| `rebase_cloud_deployments_list` | `rebase cloud deployments list` | No |
| `rebase_cloud_rollback` | `rebase cloud rollback --yes` | Sì |

Il percorso abituale di un agent è: `rebase_cloud_provision`, poi consegnare all'utente l'URL
di rivendicazione; `rebase_cloud_status` per vedere il progetto (finché non è rivendicato,
`unclaimed` contiene l'URL di rivendicazione e quando verrà eliminato); `rebase_cloud_deploy`
dopo una modifica; `rebase_cloud_logs` quando qualcosa non va; e
`rebase_cloud_rollback` quando la produzione è rotta.

**Su cosa agiscono.** Il progetto a cui la directory attiva è collegata in
`.rebase/cloud.json`. Nessuno di essi accetta un id di progetto o una directory, quindi un
assistente non può puntarli a un progetto diverso da quello a cui la directory è
collegata. Cambiare il progetto attivo con `rebase_project_switch` cambia
la directory in cui vengono eseguiti.

**Con quale autorità.** Qualunque cosa la CLI risolva in quella directory: `REBASE_TOKEN`
quando è impostato, poi il token che `rebase cloud init --claim` ha memorizzato per un
progetto non rivendicato, poi la sessione di `rebase cloud login`. Nella directory di quel
progetto non rivendicato, un `REBASE_TOKEN` che non possiede alcuno scope sul progetto viene messo
da parte in favore del token del progetto stesso. Il control plane
verifica ogni chiamata come verifica quelle della CLI, quindi con un token creato con
`rebase cloud tokens create --can logs` un assistente può leggere i log, e il
control plane rifiuta i suoi deploy, le sue variabili e i suoi rollback. Nessuna credenziale, o una rifiutata, restituisce un errore che dice cosa deve
fare l'utente (`rebase cloud login`, oppure rivendicare il progetto).

**Perché il loopback gate non si applica.** Il gate verifica il `baseUrl` dell'app e
il `DATABASE_URL` della CLI; questi tool non usano né l'uno né l'altro. Dopo `rebase_cloud_provision`,
`REBASE_BASE_URL` punta al nuovo progetto cloud, quindi applicare il gate su di esso rifiuterebbe
proprio il deploy che il percorso richiede. Il provisioning in sé si limita a creare: non tocca
alcuna app o database esistente, e la CLI lo rifiuta comunque in una directory che
è già collegata. Un deploy, una variabile e un rollback modificano ciascuno
la produzione. Ciò che sta davanti a loro è la credenziale di cui sopra e
l'approvazione dei tool del tuo client MCP. Per impedire a un assistente di modificare un progetto
cloud, imposta `REBASE_TOKEN` nell'ambiente del server su un token privo delle
capacità `deploy` ed `env`.

Ogni tool è un'istantanea:

- `rebase_cloud_logs` non segue mai. Il suo risultato contiene `nextSinceTime`; passalo
  di nuovo come `since` per leggere ciò che è venuto dopo. Restituisce le ultime 200 righe, a meno che
  `tail` indichi altro. `source: "build"` restituisce invece l'ultimo log di build.
- `rebase_cloud_deploy` segue il deployment fino alla fine e verifica che la nuova
  versione risponda. `wait: false` restituisce non appena il deployment viene avviato.
  Non estrae mai un progetto dal runtime gestito, non distribuisce una release precedente del framework,
  né salta i controlli della build: sono decisioni dell'utente, e un
  rifiuto che ne richiede una lo dice.
- `rebase_cloud_rollback` passa `--yes`. La chiamata al tool è la conferma, dato che
  non c'è alcun terminale a cui chiedere.

`rebase_cloud_env_set` scrive il valore sullo standard input della CLI, quindi non
compare mai su una riga di comando dove `ps` lo mostrerebbe, e il valore viene rimosso da
tutto ciò che il tool restituisce. Il suo risultato dice cosa è stato memorizzato (la chiave, se
è un secret, se un redeploy è in attesa), mai il valore. `rebase_cloud_env_list`
elenca solo le chiavi. Una CLI precedente a `env set --stdin` viene rifiutata con un messaggio che invita ad
aggiornarla; il valore non viene inviato in un altro modo.

I risultati tornano nell'[envelope dei dati non attendibili](#marcatura-dei-dati-non-attendibili-untrusted-data),
dopo una riga del server su cosa fare dopo. Un rifiuto è un errore del tool
che porta il codice della CLI, come `no_project`, `token_rejected`,
`managed_project` o `deploy_failed`. Quando il server riconosce il codice,
aggiunge il passo successivo, poi il messaggio della CLI stesso. Ogni tool verifica i suoi argomenti
rispetto allo schema che dichiara prima che venga avviato qualsiasi processo, e rifiuta
un argomento che non dichiara.

## Riferimento dei tool

51 tool, suddivisi in dieci gruppi: schema e database, pianificazione dello schema,
documenti, utenti e ruoli, storage, cron, funzioni, il dev server, il registro
dei progetti e Rebase Cloud. Ognuno, con ciò che richiede e se il gate lo rifiuta rivolto a una
destinazione non locale, si trova nel [Riferimento dei tool MCP](/docs/ai/mcp-tool-reference).

## Risorse

Oltre ai tool, il server espone risorse MCP in modo che un client possa ottenere il contesto
del progetto senza consumare una chiamata a un tool:

| URI | Descrizione |
|---|---|
| `rebase://collections/{name}` | Codice sorgente TypeScript della definizione di una collection |
| `rebase://schema` | Lo schema Drizzle generato (`schema.generated.ts`) |

Le collection vengono rilevate da `app/config/collections/`,
`config/collections/` o `collections/` all'interno della directory del progetto attivo —
a seconda di quale esista.

`rebase://schema` viene elencato **solo se** lo schema generato esiste.
`findBackendDir` cerca `backend/` e successivamente `app/backend/` nella directory del
progetto attivo, e legge `src/schema.generated.ts` da quello che trova —
quindi sia la struttura iniziale sia quella di questo monorepo funzionano; un progetto strutturato in
un terzo modo, o che non ha ancora eseguito `rebase schema generate`, semplicemente non
vedrà la risorsa offerta.

## L'endpoint remoto

Un backend distribuito può anche servire MCP direttamente, all'indirizzo `/mcp`, agli utenti
della tua applicazione, ciascuno connesso come sé stesso con la propria sicurezza
a livello di riga. Ha una pagina a sé:
[L'endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configurazione consigliata

- Punta il server a un progetto **locale** e lascia `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non impostato. Il gate è l'elemento di maggior valore dell'intero pacchetto.
- Per qualsiasi elemento remoto, registra una **chiave API `rk_` con restrizioni** anziché lasciare che
  l'auto-discovery fornisca una service key.
- Esegui `rebase_project_current` se l'output sembra errato. Il progetto attivo è
  persistente e risiede al di fuori del tuo repository.
- Considera `~/.rebase/projects.json` come un file contenente segreti riservati.

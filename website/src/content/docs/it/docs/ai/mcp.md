---
sourceHash: 59966953b83890cf
title: Server MCP
sidebar_label: Server MCP
description: Collega Claude Code, Cursor, Gemini CLI o qualsiasi client MCP a un progetto Rebase — i 53 tool esposti, le credenziali con cui si autentica e il gate di loopback che si interpone tra un agent e la produzione.
---

`@rebasepro/mcp` è un server [Model Context Protocol](https://modelcontextprotocol.io)
che fornisce a un assistente IA tool reali su un progetto Rebase: leggere e
scrivere righe, gestire utenti, eseguire migrazioni, invocare funzioni, pilotare il dev
server.

Comunica via MCP **esclusivamente tramite stdio**. Non c'è alcuna porta né alcun listener — il
processo ha esattamente lo stesso livello di attendibilità di chiunque lo abbia generato, e non c'è alcun
chiamante remoto da autenticare. Questa è la parte sicura. Le questioni interessanti riguardano
tutte ciò che fa *una volta* avviato, e questa pagina risponde a tali domande prima di
mostrare il blocco di configurazione.

Un backend distribuito può anche servire direttamente MCP, via HTTP, alle persone che usano
la tua applicazione. Si tratta di una cosa diversa con un differente modello di credenziali:
vedi [L'endpoint MCP remoto](/docs/ai/remote-mcp/).

## Connettere un client

Il server viene eseguito dal tuo progetto: `@rebasepro/mcp` è una devDependency che ogni
scaffold di `rebase init` blocca con la CLI, e ciascun blocco sottostante — l'intera
integrazione — avvia quella copia (`pnpm exec rebase-mcp`, oppure `npx --no rebase-mcp`
in un progetto npm), mai una più recente da npm. Un progetto più vecchio la aggiunge una sola volta,
con `rebase skills install --mcp` o `pnpm add -D @rebasepro/mcp`.

`rebase init` scrive il blocco per ciascun agent scelto quando
[configura i tuoi agent di programmazione IA](/docs/ai/skills#set-up-by-rebase-init), mantenendo
gli eventuali altri server già presenti nel file. `rebase init --agent cursor,codex` esegue
la stessa operazione senza chiedere conferma.

**Claude Code** — `.mcp.json` nella root del tuo progetto. `rebase init` scrive questo
file al posto tuo:

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

**Codex CLI** — formato TOML anziché JSON, in `.codex/config.toml` all'interno del progetto.
Codex legge la configurazione di un progetto solo dopo che hai indicato il progetto come attendibile:

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

**Windsurf** legge i server MCP solo dalla configurazione a livello utente, quindi non c'è
alcun file di progetto da scrivere. Aggiungi il server nelle sue impostazioni MCP come `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, impostando tale percorso come `REBASE_PROJECT_DIR`.

Qualsiasi client MCP in grado di avviare un server via stdio funziona; la struttura è la medesima.

### Su quale directory opera

`REBASE_PROJECT_DIR` è la directory che contiene `rebase.json`. Esiste **un solo**
ordine di precedenza, ed è lo stesso in ogni client:

1. **Il blocco di ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se uno qualsiasi di essi è impostato, il progetto `default` viene ricostruito
   a partire da essi a ogni avvio.
2. **La working directory del server**, quando contiene un `rebase.json`. Un progetto
   in cui ti trovi ha la precedenza su qualsiasi valore memorizzato in `~/.rebase/projects.json`.
3. **Il valore persistito `default`** in `~/.rebase/projects.json`, quando nessuno dei
   primi due specifica qualcosa.

L'auto-rilevamento da `.rebase/state.json` colma le lacune in tutti e tre i casi e non
sovrascrive mai un valore fornito da uno di essi.

I blocchi a livello di progetto indicano il progetto — `"."`, la working
directory del client o il `${workspaceFolder}` dell'editor — perché la regola 3 legge un file
condiviso da ogni progetto presente sulla macchina. Una configurazione a livello utente, come quella di Windsurf,
indica invece un percorso assoluto.

## Cosa può raggiungere il server

Questa è la sezione da leggere prima di puntare un assistente verso un database a cui tieni.

Il server gestisce **una sola credenziale d'ambiente per l'intero processo**. Non esiste
un'identità per singolo tool né una modalità di sola lettura; ogni tool usa lo stesso token, e
l'unico selettore nel pacchetto serve ad *abilitare* una portata maggiore anziché minore.

Quale sia questa credenziale, in ordine di priorità:

1. `REBASE_API_TOKEN` dall'ambiente. `REBASE_TOKEN` non viene letto qui:
   è il token del control-plane della CLI e non viene mai inviato all'applicazione (il
   server lo segnala una volta su stderr quando è l'unico impostato). I tool cloud
   lo trasmettono comunque alla CLI che avviano, la quale lo invia al control-plane.
2. `REBASE_SERVICE_KEY` letto dal file `.env` del progetto
3. La service key rilevata automaticamente da `.rebase/state.json` mentre `rebase dev`
   è in esecuzione

2 e 3 corrispondono alla chiave del backend di sviluppo di questa macchina, utilizzata solo quando la destinazione è su
loopback. Quando `REBASE_BASE_URL` punta altrove — `rebase cloud init --claim`
scrive l'indirizzo del progetto cloud e nessun `REBASE_API_TOKEN` finché un deploy non
va a buon fine — il server non invia alcun token e lo segnala una volta su stderr.

Un token registrato per un progetto **vince sull'auto-rilevamento**. La discovery serve solo
a colmare un'assenza.

:::danger[Il percorso zero-config corrisponde a credenziali admin]
Le opzioni 2 e 3 rappresentano la **service key** — un segreto di amministrazione non limitato da scope. Il backend
lo risolve in `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Tale
identità possiede ogni [scope](/docs/backend/roles-and-scopes/) e soddisfa le
policy `_default_admin_read` / `_default_admin_write` che Rebase inserisce in
ogni collection in cui non sia stato impostato `disableDefaultPolicies`.

Quindi la risposta sincera a "la RLS lo vincola ancora?" è: la RLS *viene eseguita* — il
driver effettua il downgrade al ruolo `rebase_user` — e poi una policy scritta da Rebase
stesso concede tutto a quell'identità. Leggere ogni riga di ogni
collection è il **comportamento previsto della configurazione predefinita**, non un
bypass.

Con la configurazione zero-config, un agent in possesso di questi tool può leggere e scrivere ogni
riga di ogni collection, elencare tutti gli utenti, reimpostare qualsiasi password, invocare qualsiasi funzione
backend ed eseguire DDL su qualunque `DATABASE_URL` il progetto risolva.
:::

### Fornirgli invece credenziali limitate

Registra una [chiave API](/docs/backend/api-keys) con scope e il modello
a due livelli diventerà realmente efficace. Una service key viene eseguita con i ruoli `["service"]`, che le
policy admin inserite **non** indicano — pertanto la RLS non le concede nulla a meno che una
delle tue policy non specifichi diversamente, e i suoi scope la restringono ulteriormente:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Assegna quindi la risultante chiave `rk_live_…` al server anziché lasciare che
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

Due cose che questo **non** fa, entrambe utili da sapere prima di farvi affidamento:

- **Non restringe i tool della CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e i tool di branch avviano la CLI di Rebase, che si connette con
  `DATABASE_URL` e non vede affatto il tuo token. Il gate di loopback descritto sotto è l'unica
  cosa posta a loro protezione.
- **Una chiave accede a un tool di amministrazione solo con lo scope di quel tool.** `list_users` e
  `list_roles` richiedono `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` richiedono `users:write`; i tool di storage e cron
  richiedono il corrispondente scope `storage:*` o `cron:*`; `invoke_function` richiede
  `functions:invoke`. Senza
  di esso la chiamata risponde con `403 SCOPE_MISSING`. Anche con `users:write`, una chiave non può
  modificare l'account di un amministratore: un admin possiede `keys:read` e `keys:write`, cosa che nessuna
  chiave può avere, e nessuno può gestire un account che possiede più privilegi dei propri.

Una chiave creata con `--roles admin` è un discorso differente: possiede i ruoli
`["service", "admin"]`, superando le stesse policy admin predefinite valide per la service
key. Assegnandole anche `--full-access`, la sua portata equivale a quella della service key,
esclusa la gestione delle chiavi. Il vantaggio che introduce è che risulta **revocabile, con scadenza e
sottoposta a rate limiting per singola chiave**, caratteristiche che la service key non possiede — ruotare
quest'ultima richiede di modificare `.env` e riavviare il server.

Consulta [Agent e server MCP](/docs/backend/api-keys#agents-and-mcp-servers) per la
guida completa sulla definizione degli scope per le chiavi.

### Rendere una collection del tutto inaccessibile

Il motivo per cui una credenziale admin legge tutto risiede nella policy di base che Rebase
inserisce in ciascuna collection, concedendo il contesto server fidato e il
ruolo `admin`. Una collection può disattivare tale impostazione di base e assumersi la piena
responsabilità della propria RLS:

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

Ora l'unico modo per accedere è corrispondere a `patient_id`. L'uid della service key corrisponde alla
stringa letterale `service`, quindi una regola sull'owner non corrisponderà mai ad essa — le letture restituiscono zero
righe e le scritture vengono rifiutate da Postgres. Questo è l'unico controllo che vincola
la credenziale predefinita del server MCP anziché ignorarne i vincoli.

Ricorda che questa è una reale modifica RLS, non una questione documentale: diventa effettiva
solo dopo che `rebase schema generate` e una migrazione hanno applicato le policy. Consulta
[Regole di sicurezza (RLS)](/docs/collections/security-rules).

## Il gate di loopback

`rebase_project_add` accetta qualsiasi `baseUrl`, e i tool della CLI si connettono con
qualunque `DATABASE_URL` dichiarato dal progetto. Lo stesso elenco di tool che modifica un
database temporaneo sul tuo portatile può di conseguenza eliminare righe di produzione, senza alcunché
in mezzo se non il giudizio dell'assistente su quale sia il progetto attivo.

**Ogni tool che modifica l'ambiente di destinazione viene rifiutato a meno che tale destinazione non sia
sull'interfaccia di loopback.** Il gate è strutturato come una lista di ciò che *non* è
bloccato, quindi un tool aggiunto in seguito sarà protetto per impostazione predefinita.

- **Non bloccati — letture:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs` e le letture di Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Non bloccati — scritture su Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Il provisioning crea un progetto; gli altri modificano un progetto di produzione. Nessuno
  di essi passa tramite `baseUrl` o `DATABASE_URL`, che sono gli unici parametri verificabili dal
  gate. Consulta [Rebase Cloud](#rebase-cloud) per scoprire cosa ne regola l'accesso.
- **Non bloccati — solo locali:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, i tool del dev-server e i tool del registro progetti.
  Questi scrivono file locali o stato locale e non hanno una destinazione remota da verificare.
- **Bloccati in base a `DATABASE_URL`:** i restanti tool della CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloccati in base al `baseUrl` del progetto:** i restanti tool dell'SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

Le due destinazioni non sono intercambiabili. I tool della CLI non vedono mai `baseUrl`, quindi un
backend localhost affiancato a un `DATABASE_URL` di produzione viene verificato rispetto
al database, non al backend.

Un rifiuto si presenta così:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se non è possibile risolvere alcuna stringa di connessione, i tool DB protetti dal gate vengono rifiutati.**
Senza alcun `DATABASE_URL`, la CLI utilizza il database di sviluppo gestito, che rappresenta
l'impostazione predefinita per un nuovo progetto, e il gate rifiuta i suoi quattro tool per il database
in questo scenario. Il rifiuto ne spiega la ragione ed elenca cosa funziona al suo posto. Non suggerisce
l'opzione di esclusione:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Da un terminale,
`rebase db push` e `rebase db migrate` vengono eseguiti su quel database; solo i tool
MCP vengono rifiutati. Dalla versione 0.24, anche la CLI li rifiuta in tale contesto.

Solo il loopback è considerato locale: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
I range privati come `10.x` e `192.168.x` **non** lo sono — possono altrettanto facilmente essere
un cluster di staging condiviso quanto un laptop, e trattarli come locali lascerebbe
passare esattamente gli incidenti che il gate è preposto a impedire.

Imposta `REBASE_MCP_ALLOW_REMOTE_WRITES=true` per disattivare questa protezione. Impostarlo a livello globale nella configurazione
del tuo client MCP rimuove il gate per ogni progetto raggiungibile dal server, non
solo per quello a cui stavi pensando.

## Contrassegno dei dati non attendibili

Righe, record utente, elenchi dello storage, job cron, risposte di funzioni e output
della CLI vengono restituiti racchiusi in un involucro esplicito:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualsiasi dato archiviato nel tuo database è stato inserito da qualcuno e arriva
sullo stesso canale del contratto del tool che l'assistente sta seguendo. L'involucro indica
al modello di trattarlo come contenuto inerte anziché come istruzioni.

L'`id` viene generato ex novo per ciascuna risposta, dopo che i dati sono stati scritti, e
solo il marcatore di chiusura corrispondente chiude il blocco. Il testo all'interno dei dati che ha la
forma di un marcatore viene interrotto con uno spazio a larghezza zero, in modo che una riga contenente
`<<<END_UNTRUSTED_DATA>>>` non possa chiudere prematuramente l'involucro esponendo all'esterno
ciò che segue.

L'[endpoint remoto](/docs/ai/remote-mcp/) delimita i risultati dei suoi tool nello stesso
modo e lo segnala al client; il suo `structuredContent` trasporta il risultato non elaborato.
`list_collections` e
`describe_collection` rappresentano le eccezioni: vengono letti solo da un modello, quindi vengono
inviati una sola volta, nel testo. Prima della versione 0.24, l'elenco includeva anche una
copia in `structuredContent`.

Si tratta di un marcatore, non di una sandbox. Un assistente provvisto di questi tool è sicuro
solo quanto i contenuti di cui gli consenti la lettura.

## Progetti multipli

Le configurazioni dei progetti sono salvate in `~/.rebase/projects.json`, e il server
può gestirne diverse contemporaneamente — utile quando lavori su ambienti locali e
remoti. Mentre `rebase dev` è in esecuzione, il server legge la porta attiva e la
service key da `.rebase/state.json` nella directory del progetto, ed è questo
che rende il caso locale zero-config.

:::note[Il registro è l'ultima parola, non la prima]
L'ordine di precedenza è quello sopra indicato: blocco di ambiente, poi la working directory
quando contiene un `rebase.json`, quindi il `default` persistito.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` ricostruiscono il
progetto `default` **a ogni avvio**, non solo al primo. La ricostruzione avviene per l'intera
voce: un token registrato rispetto alla vecchia `projectDir` viene rimosso anziché
mantenuto all'interno di una directory per cui non era mai stato emesso. Un `default` derivato in
questo modo — o dalla working directory — non viene mai riscritto in
`~/.rebase/projects.json`, per cui la dev service key di un progetto non può diventare
quella di un altro.

`activeProject` è persistente (sticky), quindi se una sessione precedente ha invocato
`rebase_project_switch`, i tool prendono di mira quel progetto e il server lo segnala su
stderr — a meno che tale progetto non sia registrato in una directory *differente* rispetto
a quella in cui questo server è in esecuzione, nel qual caso ricade su `default` segnalando
l'evento. Se sembra che un assistente stia leggendo il database errato, invoca
prima `rebase_project_current`.
:::

I token vengono memorizzati in quel registro **in chiaro**. Si tratta di un file nella tua home
directory contenente credenziali admin per ogni progetto che hai registrato; trattalo
di conseguenza.

## Rebase Cloud

Otto tool consentono di portare un'app da questa directory a un backend attivo su
[Rebase Cloud](/docs/deployment/cloud/) e mantenerla operativa. Ciascuno di essi avvia
`rebase cloud <command> --json` nella directory del progetto attivo: lo stesso
comando eseguito da una persona, evitando così una seconda implementazione che potrebbe divergere da esso.

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

Il tipico percorso di un agent è: `rebase_cloud_provision`, quindi fornire all'utente l'URL
di claim; `rebase_cloud_status` per visualizzare il progetto (mentre non è riscattato,
`unclaimed` contiene l'URL di claim e la data in cui verrà eliminato); `rebase_cloud_deploy`
dopo una modifica; `rebase_cloud_logs` quando qualcosa non funziona; e
`rebase_cloud_rollback` quando la produzione è compromessa.

**Su cosa operano.** Sul progetto a cui la directory attiva è collegata in
`.rebase/cloud.json`. Nessuno di essi accetta un ID progetto o una directory, quindi un
assistente non può puntarli su un progetto diverso da quello a cui la directory è
collegata. Cambiare il progetto attivo con `rebase_project_switch` cambia
la directory in cui vengono eseguiti.

**Con quale autorità.** Con quella risolta dalla CLI in quella directory: `REBASE_TOKEN`
quando impostato, poi il token salvato da `rebase cloud init --claim` per un
progetto non riscattato, quindi la sessione di `rebase cloud login`. Nella directory di quel
progetto non riscattato, un `REBASE_TOKEN` privo di scope sul progetto viene accantonato
in favore del token del progetto stesso. Il control plane
verifica ciascuna chiamata come fa per la CLI, pertanto con un token creato tramite
`rebase cloud tokens create --can logs` un assistente può leggere i log, e il
control plane rifiuterà i suoi deploy, variabili ed esecuzioni di rollback. L'assenza di credenziali, o una credenziale rifiutata, viene restituita sotto forma di errore indicante le azioni richieste
all'utente (`rebase cloud login`, o riscattare il progetto).

**Perché il gate di loopback non si applica.** Il gate controlla il `baseUrl` dell'app e
il `DATABASE_URL` della CLI; questi tool non usano nessuno dei due. Dopo `rebase_cloud_provision`,
`REBASE_BASE_URL` punta al nuovo progetto cloud, quindi applicare il gate su di esso rifiuterebbe
proprio il deploy di cui il flusso ha bisogno. Il provisioning stesso si limita a creare: non tocca
alcuna app o database esistente, e la CLI lo rifiuta comunque in una directory che
risulta già collegata. Un deploy, una variabile e un rollback modificano
ciascuno la produzione. La protezione a loro presidio è data dalle credenziali sopra descritte e
dall'approvazione dei tool da parte del tuo client MCP. Per impedire a un assistente di modificare un cloud
project, imposta `REBASE_TOKEN` nell'ambiente del server con un token privo delle
funzionalità `deploy` ed `env`.

**Leggere uno qualsiasi dei tuoi progetti.** I tool sopra indicati operano sul progetto collegato.
Per leggere i dati di un altro progetto — qualsiasi progetto in qualunque organizzazione a cui appartiene
l'account autenticato, collegato qui o meno — `rebase_cloud_projects_list` li elenca
e `rebase_project_use_cloud` (con un ID, slug o nome) indirizza verso di esso i tool di gestione dati e
amministrazione: `list_documents`, `get_document`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Queste chiamate transitano attraverso il proxy di Studio della
console, portando la credenziale della CLI (`rebase cloud access-token`, letto
per ogni chiamata e mai memorizzato); il control plane verifica i permessi dell'utente e
vi allega la service key del progetto dal proprio lato, evitando l'invio di chiavi sulla macchina locale.
Un progetto con Studio disattivato viene rifiutato, e l'interruttore lo segnala. Si tratta di una
destinazione remota come qualsiasi altra, quindi i tool che modificano i dati rimangono bloccati lì
a meno che non sia impostato `REBASE_MCP_ALLOW_REMOTE_WRITES`; `rebase_project_switch` consente
di tornare indietro.

Ciascun tool fornisce uno snapshot:

- `rebase_cloud_logs` non segue mai l'output in tempo reale (follow). Il suo risultato include `nextSinceTime`; ripassalo
  come `since` per leggere ciò che è seguito. Restituisce le ultime 200 righe a meno che
  `tail` non specifichi diversamente. `source: "build"` restituisce invece il log di build più recente.
- `rebase_cloud_deploy` segue il deployment fino alla fine e verifica che la nuova
  versione risponda. `wait: false` ritorna non appena il deployment viene attivato.
  Non effettua mai l'espulsione (eject) di un progetto dal runtime gestito, non distribuisce una versione precedente del framework
  e non ignora i controlli di build: queste sono decisioni demandate all'utente, e un
  rifiuto che ne richiede una lo esplicita.
- `rebase_cloud_rollback` passa `--yes`. La chiamata al tool rappresenta la conferma, non
  essendoci un terminale su cui richiederla.

`rebase_cloud_env_set` scrive il valore sullo standard input della CLI, evitando che
compaia sulla riga di comando dove `ps` potrebbe mostrarlo, e il valore viene escluso da
qualsiasi output restituito dal tool. Il risultato riporta ciò che è stato memorizzato (la chiave, se
è un segreto, se è in sospeso un nuovo deploy), mai il valore. `rebase_cloud_env_list`
elenca unicamente le chiavi. Una versione della CLI precedente a `env set --stdin` viene rifiutata con un messaggio che richiede
di aggiornarla; il valore non viene inviato in altri modi.

I risultati vengono restituiti nell'[involucro per dati non attendibili](#contrassegno-dei-dati-non-attendibili),
preceduti da una riga del server sul passaggio successivo da compiere. Un rifiuto corrisponde a un errore del tool
che riporta il codice della CLI, come `no_project`, `token_rejected`,
`managed_project` o `deploy_failed`. Quando il server riconosce il codice,
aggiunge il passaggio successivo, seguito dal messaggio originario della CLI. Ogni tool verifica i propri argomenti
rispetto allo schema dichiarato prima che venga eseguito qualsiasi processo, rifiutando qualsiasi
argomento non dichiarato.

## Riferimento dei tool

53 tool suddivisi in dieci gruppi: schema e database, pianificazione dello schema, documenti, utenti
e ruoli, storage, cron, funzioni, dev server, registro dei progetti e
Rebase Cloud.
Ciascuno di essi, con i relativi requisiti e l'eventuale blocco da parte del gate in caso di
destinazione non locale, è riportato nel [Riferimento dei tool MCP](/docs/ai/mcp-tool-reference).

## Risorse

Oltre ai tool, il server espone risorse MCP in modo che un client possa ottenere il contesto
del progetto senza consumare una chiamata a un tool:

| URI | Descrizione |
|---|---|
| `rebase://collections/{name}` | Sorgente TypeScript della definizione di una collection |
| `rebase://schema` | Lo schema Drizzle generato (`schema.generated.ts`) |

Le collection vengono individuate a partire da `app/config/collections/`,
`config/collections/` o `collections/` all'interno della directory del progetto attivo —
a seconda di quale esista.

`rebase://schema` viene elencato **solo se** lo schema generato esiste.
`findBackendDir` cerca `backend/` e successivamente `app/backend/` nella directory del
progetto attivo, e legge `src/schema.generated.ts` da quello che trova —
funzionando sia con la struttura predefinita sia con quella di questo monorepo; un progetto organizzato in
un terzo modo, o che non ha ancora eseguito `rebase schema generate`, semplicemente non
vedrà la risorsa offerta.

## L'endpoint remoto

Un backend distribuito può anche servire MCP direttamente, su `/mcp`, per gli utenti che
usano la tua applicazione, ciascuno connettendosi con la propria identità e sottoposto alla propria row-level
security. Questo argomento ha una pagina dedicata:
[L'endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configurazione consigliata

- Punta il server a un progetto **locale** e lascia `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non impostato. Il gate è la funzionalità più preziosa dell'intero pacchetto.
- Per qualsiasi risorsa remota, registra una **chiave API `rk_` provvista di scope** anziché lasciare
  che la discovery fornisca una service key.
- Controlla `rebase_project_current` se l'output sembra errato. Il progetto attivo è
  persistente (sticky) e risiede al di fuori del tuo repository.
- Considera `~/.rebase/projects.json` alla stregua di un file di segreti.

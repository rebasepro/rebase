---
sourceHash: c4c752011dc403fc
title: MCP Server
sidebar_label: MCP Server
description: "Connetti Claude Code, Cursor, Gemini CLI o qualsiasi client MCP a un progetto Rebase: i 53 tool che espone, le credenziali con cui si autentica e il loopback gate posto tra un agente e la produzione."
---

`@rebasepro/mcp` è un server [Model Context Protocol](https://modelcontextprotocol.io)
che fornisce a un assistente IA veri strumenti operativi su un progetto Rebase: leggere e
scrivere righe, gestire utenti, eseguire migrazioni, invocare funzioni, controllare il dev
server.

Comunica tramite MCP **solo su stdio**. Non c'è alcuna porta né alcun listener: il
processo ha esattamente lo stesso livello di attendibilità di chiunque lo abbia generato e non c'è alcun
chiamante remoto da autenticare. Questa è la parte sicura. Le domande interessanti riguardano tutte
cosa fa *una volta* avviato, e questa pagina risponde ad esse prima di
mostrarti il blocco di configurazione.

Un backend distribuito può anche servire MCP direttamente, via HTTP, agli utenti che utilizzano
la tua applicazione. Si tratta di qualcosa di diverso, con un differente modello di credenziali:
consulta [L'endpoint MCP remoto](/docs/ai/remote-mcp/).

:::tip[Usi Claude sul web, desktop o mobile?]
Aggiungi invece il [connettore Rebase](/docs/ai/rebase-connector/):
`https://app.rebase.pro/mcp`, una sola volta, per ogni progetto eseguito su Rebase Cloud
o sui tuoi server. Questa pagina riguarda il server locale che un assistente di codifica avvia
all'interno di un progetto.
:::

## Connessione di un client

Il server viene eseguito dal tuo progetto: `@rebasepro/mcp` è una devDependency che ogni
scaffold di `rebase init` fissa con la CLI, e ciascun blocco sottostante — l'intera
integrazione — avvia quella copia (`pnpm exec rebase-mcp`, o `npx --no rebase-mcp`
in un progetto npm), mai una versione più recente da npm. Un progetto più datato la aggiunge una volta sola,
con `rebase skills install --mcp` o `pnpm add -D @rebasepro/mcp`.

`rebase init` scrive il blocco per ogni agente selezionato quando
[configura i tuoi agenti di codifica IA](/docs/ai/skills#set-up-by-rebase-init), mantenendo
qualsiasi altro server già presente nel file. `rebase init --agent cursor,codex` fa
lo stesso senza chiedere conferma.

**Claude Code** — `.mcp.json` alla radice del progetto. `rebase init` scrive questo
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
`${workspaceFolder}` alla radice del progetto:

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

**Codex CLI** — TOML anziché JSON, in `.codex/config.toml` del progetto.
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
un transport esplicito:

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

**Windsurf** legge i server MCP solo dalla configurazione a livello utente, quindi non c'è alcun
file di progetto da scrivere. Aggiungi il server nelle sue impostazioni MCP come `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, con tale percorso come `REBASE_PROJECT_DIR`.

Qualsiasi client MCP in grado di avviare un server stdio funziona; la struttura è la medesima.

### Su quale directory agisce

`REBASE_PROJECT_DIR` è la directory contenente `rebase.json`. C'è **un unico**
ordine di precedenza, ed è lo stesso in ogni client:

1. **Il blocco delle variabili d'ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se uno qualsiasi di essi è impostato, il progetto `default` viene ricostruito
   a partire da essi a ogni avvio.
2. **La directory di lavoro del server**, quando contiene un `rebase.json`. Un progetto
   in cui ti trovi ha la precedenza su qualsiasi cosa memorizzata in `~/.rebase/projects.json`.
3. **Il `default` persistito** in `~/.rebase/projects.json`, quando nessuno dei
   primi due specifica alcunché.

Il rilevamento automatico (auto-discovery) da `.rebase/state.json` colma le lacune in tutti e tre i casi e non
sovrascrive mai un valore fornito da uno di essi.

I blocchi a livello di progetto specificano il progetto — `"."`, la directory di lavoro
del client o `${workspaceFolder}` dell'editor — poiché la regola 3 legge un file
condiviso da ogni progetto sulla macchina. Una configurazione a livello utente, come quella di Windsurf,
indica invece un percorso assoluto.

## Cosa può raggiungere il server

Questa è la sezione da leggere prima di puntare un assistente verso un database a cui tieni.

Il server dispone di **una sola credenziale ambientale per l'intero processo**. Non esiste alcuna
identità per singolo tool né una modalità di sola lettura; ogni tool usa lo stesso token, e l'unica
opzione nel pacchetto consente di *estendere* l'accesso anziché ridurlo.

Di quale credenziale si tratta, in ordine di priorità:

1. `REBASE_API_TOKEN` dall'ambiente. `REBASE_TOKEN` non viene letto qui:
   è il token del control plane della CLI e non viene mai inviato all'app (il
   server lo segnala una volta su stderr se è l'unico impostato). I tool cloud
   lo passano comunque alla CLI che avviano, la quale lo invia al control plane.
2. `REBASE_SERVICE_KEY` letto dal file `.env` del progetto
3. La service key rilevata automaticamente da `.rebase/state.json` mentre `rebase dev`
   è in esecuzione

I punti 2 e 3 rappresentano la chiave del backend di sviluppo di questa macchina, utilizzata solo quando la destinazione è su
loopback. Quando `REBASE_BASE_URL` punta altrove — `rebase cloud init --claim`
scrive l'indirizzo del progetto cloud, e nessun `REBASE_API_TOKEN` finché un deploy non
ha successo — il server non invia alcun token e lo segnala una volta su stderr.

Un token registrato per un progetto **ha la precedenza sul rilevamento automatico**. L'auto-discovery colma
solo un'assenza di configurazione.

:::danger[Il percorso zero-config è una credenziale di amministratore]
Le opzioni 2 e 3 corrispondono alla **service key** — un segreto di amministrazione privo di restrizioni di ambito (unscoped). Il backend
la risolve in `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Tale
identità possiede ogni [scope](/docs/backend/roles-and-scopes/) e soddisfa le
policy `_default_admin_read` / `_default_admin_write` che Rebase inserisce in
ogni tabella che non ha impostato `defaultPolicies: false`.

Quindi la risposta sincera a "l'RLS impone ancora dei vincoli?" è: l'RLS *viene eseguito* — il
driver effettua il downgrade al ruolo `rebase_user` — e poi una policy scritta
da Rebase stesso concede a tale identità l'accesso a tutto. La lettura di ogni riga di ogni
tabella è il **comportamento previsto per progettazione nella configurazione predefinita**, non un
bypass.

Con la configurazione zero-config, un agente dotato di questi tool può leggere e scrivere ogni
riga di ogni tabella, elencare ogni utente, reimpostare qualsiasi password, invocare qualsiasi funzione
di backend ed eseguire DDL su qualsiasi `DATABASE_URL` risolta dal progetto.
:::

### Fornire invece una credenziale con permessi ristretti

Registra una [chiave API](/docs/backend/api-keys) con scope limitati e il modello a due gate
si applicherà realmente. Una service key viene eseguita con i ruoli `["service"]`, che le
policy di amministrazione inserite **non** menzionano — quindi l'RLS non le concede nulla a meno che una
delle tue policy non disponga diversamente, e i relativi scope ne restringono ulteriormente la portata:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Quindi passa la chiave `rk_live_…` risultante al server anziché lasciare che
rilevi automaticamente una service key:

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

- **Non restringe i tool della CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e i tool dei branch avviano la CLI di Rebase, che si connette con
  `DATABASE_URL` e non vede minimamente il tuo token. Il loopback gate descritto di seguito è
  l'unica protezione posta davanti a questi ultimi.
- **Una chiave può accedere a un tool di amministrazione solo con lo scope richiesto da quel tool.** `list_users` e
  `list_roles` richiedono `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` richiedono `users:write`; i tool di storage e cron
  richiedono il corrispondente scope `storage:*` o `cron:*`; `invoke_function` richiede
  `functions:invoke`. Senza
  di esso la chiamata risponde `403 SCOPE_MISSING`. Anche con `users:write`, una chiave non può
  modificare l'account di un amministratore: un amministratore possiede `keys:read` e `keys:write`, cosa che nessuna
  chiave può avere, e nessuno può gestire un account con privilegi superiori ai propri.

Una chiave creata con `--roles admin` è un discorso differente: include i ruoli
`["service", "admin"]`, che soddisfano le stesse policy di amministrazione predefinite della service
key. Aggiungendo anche `--full-access`, il suo raggio d'azione diventa pari a quello della service key,
ad eccezione della gestione delle chiavi. Ciò che offre in più è il fatto di essere **revocabile, con scadenza e
soggetta a rate limit per singola chiave**, nessuna delle quali si applica alla service key — per ruotare quest'ultima
è necessario modificare `.env` e riavviare il server.

Consulta [Agenti e server MCP](/docs/backend/api-keys#agents-and-mcp-servers) per la
guida completa sulla definizione degli scope delle chiavi.

### Rendere una tabella del tutto inaccessibile

Il motivo per cui una credenziale di amministrazione legge tutto risiede nella policy di base che Rebase
inserisce in ogni tabella, concedendo l'accesso al contesto server attendibile e al
ruolo `admin`. Una tabella può escludere tale comportamento di base e assumersi la piena
responsabilità del proprio RLS:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const medicalRecords = defineTable("medical_records", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        patientId: col.text(),
        notes:     col.text(),
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    defaultPolicies: false,
    rls: [
        { operations: ["select", "update"], ownerField: "patientId" },
    ],
});
```

Ora l'unico modo per accedere è corrispondere a `patientId`. L'uid della service key è la
stringa letterale `service`, quindi una regola di tipo owner non corrisponderà mai ad essa — le letture restituiscono zero
righe e le scritture vengono rifiutate da Postgres. Questo è l'unico controllo che vincola
la credenziale predefinita del server MCP anziché ignorarne i privilegi.

Ricorda che si tratta di una modifica RLS effettiva, non meramente concettuale: ha effetto
solo dopo che `rebase schema generate` e una migrazione hanno applicato le policy. Consulta
[Row-level security](/docs/collections/security-rules).

## Il loopback gate

`rebase_project_add` accetta qualsiasi `baseUrl`, e i tool della CLI si connettono con
qualsiasi `DATABASE_URL` dichiarata dal progetto. Lo stesso elenco di tool che modifica un
database temporaneo sul tuo portatile può quindi eliminare righe in produzione, senza nulla
in mezzo se non il giudizio dell'assistente su quale progetto sia attivo.

**Ogni tool che modifica l'ambiente di destinazione viene rifiutato a meno che tale destinazione non sia
sull'interfaccia di loopback.** Il gate è strutturato come un elenco di ciò che *non* è
soggetto al blocco, quindi un eventuale tool aggiunto in seguito risulterà protetto per impostazione predefinita.

- **Non soggetti a gate — letture:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, e le letture di Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Non soggetti a gate — scritture su Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Il provisioning crea un progetto; gli altri modificano un progetto di produzione. Nessuno
  di essi passa attraverso `baseUrl` o `DATABASE_URL`, che sono gli unici parametri che il gate può
  verificare. Consulta [Rebase Cloud](#rebase-cloud) per le protezioni poste davanti ad essi.
- **Non soggetti a gate — solo locali:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, i tool del dev-server e i tool del registro progetti.
  Questi scrivono file locali o stato locale e non hanno alcuna destinazione remota da controllare.
- **Soggetti a gate su `DATABASE_URL`:** i restanti tool della CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Soggetti a gate sulla `baseUrl` del progetto:** i restanti tool dell'SDK —
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

Le due destinazioni non sono intercambiabili. I tool della CLI non vedono mai `baseUrl`, quindi un
backend su localhost affiancato a una `DATABASE_URL` di produzione viene verificato a fronte
del database, non del backend.

Un rifiuto si presenta così:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se non è possibile risolvere alcuna stringa di connessione, i tool DB soggetti a gate vengono rifiutati.**
In assenza di `DATABASE_URL`, la CLI usa il database di sviluppo gestito, che è
il valore predefinito per un nuovo progetto, e il gate rifiuta i suoi quattro tool per database
in quel contesto. Il messaggio di rifiuto spiega il motivo e indica cosa funziona in alternativa. Non suggerisce
l'opzione di esclusione (opt-out):

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Da terminale,
`rebase db push` e `rebase db migrate` vengono effettivamente eseguiti su quel database; solo i tool
MCP vengono rifiutati.

Solo il loopback viene considerato locale: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
I range privati come `10.x` e `192.168.x` **non** lo sono — possono altrettanto facilmente essere
un cluster di staging condiviso quanto un laptop, e trattarli come locali lascerebbe
passare esattamente l'incidente che il gate è stato progettato per prevenire.

Imposta `REBASE_MCP_ALLOW_REMOTE_WRITES=true` per disattivare il gate. Impostarlo a livello globale nella configurazione
del tuo client MCP rimuove la protezione per ogni progetto che il server può raggiungere, non
solo per quello a cui stavi pensando.

## Untrusted-data marking

Righe, record utente, elenchi di storage, cron job, risposte di funzioni e output
della CLI vengono restituiti racchiusi in un envelope esplicito:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualsiasi cosa archiviata nel tuo database è stata scritta da qualcuno, e arriva sullo
stesso canale del contratto del tool che l'assistente sta seguendo. L'envelope indica
al modello di trattare tali dati come contenuto inerte anziché come istruzioni.

L'`id` viene generato nuovo per ogni risposta, dopo la scrittura dei dati, e
solo il marcatore di chiusura che lo riporta chiude il blocco. Il testo all'interno dei dati che
ha la forma di un marcatore viene spezzato con uno spazio a larghezza zero, così una riga che stampa
`<<<END_UNTRUSTED_DATA>>>` non può chiudere prematuramente l'envelope lasciando all'esterno
ciò che segue.

L'[endpoint remoto](/docs/ai/remote-mcp/) delimita i risultati dei propri tool nello stesso
modo e lo comunica al client; il suo `structuredContent` trasporta il risultato non elaborato.
`list_tables` e
`describe_table` costituiscono le eccezioni: solo un modello le legge, quindi vengono
inviate una sola volta, nel testo.

È un marcatore, non una sandbox. Un assistente che dispone di questi tool è sicuro solo quanto
lo sono i contenuti che gli permetti di leggere.

## Progetti multipli

Le configurazioni dei progetti sono salvate in `~/.rebase/projects.json`, e il server
può gestirne diverse contemporaneamente — utile quando si lavora tra ambienti locali
e remoti. Mentre `rebase dev` è in esecuzione, il server legge la porta attiva e la
service key da `.rebase/state.json` nella directory del progetto, ed è ciò che
rende il caso locale a configurazione zero.

:::note[Il registro è l'ultima parola, non la prima]
L'ordine di precedenza è quello sopra descritto: blocco di ambiente, poi la directory di lavoro
quando contiene un `rebase.json`, infine il `default` persistito.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` ricostruiscono il
progetto `default` **a ogni avvio**, non solo al primo. La ricostruzione avviene
per l'intera voce: un token registrato per il vecchio `projectDir` viene eliminato anziché
essere trasferito in una directory per cui non è mai stato emesso. Un `default` derivato in
questo modo — o dalla directory di lavoro — non viene mai riscritto in
`~/.rebase/projects.json`, evitando così che la dev service key di un progetto possa diventare
quella di un altro.

`activeProject` è persistente ("sticky"), quindi se una sessione precedente ha chiamato
`rebase_project_switch`, i tool avranno come target quel progetto e il server lo segnalerà su
stderr — a meno che tale progetto non sia registrato in una directory *diversa* da
quella in cui è in esecuzione questo server; in tal caso, ripiega su `default` e lo
notifica. Se sembra che un assistente stia leggendo il database sbagliato, chiama
prima `rebase_project_current`.
:::

### Su quale progetto agisce una chiamata

`activeProject` è a livello di intera macchina, e un server viene spesso installato una sola volta per l'intera macchina. Pertanto, ogni tool che agisce su un progetto (tutti tranne i tool di registro `rebase_project_*`, `rebase_cloud_projects_list`, `rebase_cloud_provision` e `rebase_dev_logs`) risolve il proprio progetto **per singola chiamata**, e accetta un parametro opzionale `project`: il nome di un progetto registrato, oppure uno slug o id di Rebase Cloud. La chiamata viene verificata a fronte del collegamento Cloud (`.rebase/cloud.json`) della directory in cui opera la sessione: la prima [root](https://modelcontextprotocol.io/specification/latest/client/roots) del client, altrimenti la directory di lavoro del server.

| La chiamata | La directory della sessione | Risultato |
|---|---|---|
| specifica un progetto | è collegata allo stesso progetto | viene eseguita su di esso |
| specifica un progetto | è collegata a un altro progetto | **rifiutata**, non viene eseguito nulla |
| non specifica alcun progetto | è collegata a un progetto diverso da quello attivo | **rifiutata**, non viene eseguito nulla |
| non specifica alcun progetto | è collegata; il progetto attivo è un progetto locale altrove | viene eseguita sul progetto collegato |
| non specifica alcun progetto | non è collegata | viene eseguita sul progetto attivo; una *scrittura* su un progetto Cloud selezionato da una sessione precedente richiede che il progetto sia specificato |

Un rifiuto menziona entrambi i progetti. `rebase_project_current` segnala la directory della sessione e il collegamento sotto `session`. `rebase_cloud_env_set` e `rebase_cloud_rollback` passano il progetto risolto alla CLI con `--project`; `rebase_cloud_deploy` invia la directory in cui è in esecuzione, pertanto viene rifiutato quando il collegamento di tale directory rimanda a un altro progetto.

I token sono memorizzati in tale registro **in chiaro**. Si tratta di un file nella tua home
directory contenente credenziali di amministratore per ogni progetto registrato; trattalo
con la dovuta cautela.

## Rebase Cloud

Otto tool portano un'app da questa directory a un backend attivo su
[Rebase Cloud](/docs/deployment/cloud/) e la mantengono in esecuzione. Ciascuno di essi avvia
`rebase cloud <command> --json` nella directory del progetto attivo: lo stesso
comando che eseguirebbe una persona, evitando così disallineamenti dovuti a implementazioni separate.

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

Il tipico flusso di lavoro dell'agente è: `rebase_cloud_provision`, quindi fornire all'utente l'URL
di claim; `rebase_cloud_status` per visualizzare il progetto (finché non è riscattato,
`unclaimed` contiene l'URL di claim e la data/ora di eliminazione); `rebase_cloud_deploy`
dopo una modifica; `rebase_cloud_logs` se qualcosa non funziona; e
`rebase_cloud_rollback` quando la produzione è compromessa.

**Su cosa agiscono.** Il progetto a cui la chiamata si risolve, come descritto in
[Su quale progetto agisce una chiamata](#su-quale-progetto-agisce-una-chiamata): l'argomento `project`,
verificato a fronte del collegamento della directory della sessione, oppure tale collegamento, oppure
il progetto attivo. Una chiamata che specifica un progetto a cui la directory della sessione non è
collegata viene rifiutata prima di avviare qualsiasi processo.

**Con quale autorità.** Qualsiasi valore la CLI risolva in tale directory: `REBASE_TOKEN`
quando impostato, poi il token memorizzato da `rebase cloud init --claim` per un
progetto non riscattato, quindi la sessione di `rebase cloud login`. Nella directory di quel progetto
non riscattato, un `REBASE_TOKEN` privo di scope sul progetto viene messo
da parte a favore del token specifico del progetto. Il control plane
verifica ogni chiamata esattamente come fa per la CLI: con un token creato tramite
`rebase cloud tokens create --can logs`, un assistente può leggere i log, mentre il
control plane ne rifiuta deploy, variabili e rollback. L'assenza di credenziali, o una credenziale rifiutata, restituisce un errore che indica cosa
l'utente deve fare (`rebase cloud login`, oppure riscattare il progetto).

**Perché il loopback gate non si applica.** Il gate controlla il `baseUrl` dell'app e
il `DATABASE_URL` della CLI; questi tool non usano nessuno dei due. Dopo `rebase_cloud_provision`,
`REBASE_BASE_URL` punta al nuovo progetto cloud, quindi applicare il gate rifiuterebbe
proprio il deploy necessario al flusso di lavoro. Il provisioning si limita a creare: non tocca
alcuna app o database esistente, e la CLI lo rifiuta comunque in una directory già
collegata. Un deploy, una variabile e un rollback modificano
ciascuno la produzione. Ciò che li protegge è la credenziale sopra menzionata, l'approvazione dei tool
da parte del tuo client MCP e `confirm: true`: `rebase_cloud_deploy` in
produzione, `rebase_cloud_env_set` in produzione, `rebase_cloud_rollback` e
`rebase_cloud_provision` comunicano cosa farebbero senza compiere alcuna azione finché una chiamata
non ripete gli stessi argomenti con `confirm: true`, che l'assistente invia solo
dopo l'assenso dell'utente. Un preview deploy e una variabile di preview non ne hanno bisogno. Per impedire a un assistente di modificare un progetto
cloud, imposta `REBASE_TOKEN` nell'ambiente del server su un token privo delle
funzionalità `deploy` ed `env`.

**Leggere uno qualsiasi dei tuoi progetti.** I tool sopra descritti agiscono sul progetto collegato.
Per leggere i dati di un altro — qualsiasi progetto in qualsiasi organizzazione a cui appartiene
l'account che ha effettuato l'accesso, collegato qui o meno — `rebase_cloud_projects_list` li elenca
e `rebase_project_use_cloud` (con un id, slug o nome) indirizza i tool di dati e di
amministrazione verso di esso: `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Tali chiamate passano attraverso il proxy
Studio della console, usando la credenziale della CLI (`rebase cloud access-token`, letta
a ogni chiamata e mai salvata); il control plane verifica l'accesso dell'utente e
allega la service key del progetto dal proprio lato, così nessuna chiave raggiunge la macchina.
Un progetto con Studio disattivato viene rifiutato, e l'interruttore lo specifica. È una
destinazione remota come qualsiasi altra, quindi i tool che modificano i dati rimangono bloccati
a meno che non sia impostato `REBASE_MCP_ALLOW_REMOTE_WRITES`; `rebase_project_switch` consente
di tornare indietro.

Ciascun tool rappresenta uno snapshot:

- `rebase_cloud_logs` non effettua mai il follow (streaming continuo). Il suo risultato include `nextSinceTime`; ripassalo
  come `since` per leggere gli eventi successivi. Restituisce le ultime 200 righe a meno che
  `tail` non specifichi diversamente. `source: "build"` restituisce invece il log dell'ultima build.
- `rebase_cloud_deploy` segue il deployment fino al completamento e verifica che la nuova
  versione risponda. `wait: false` ritorna non appena il deployment viene attivato.
  Non effettua mai l'eject di un progetto dal runtime gestito, non distribuisce una release
  più datata del framework né salta i controlli di compilazione: queste decisioni spettano all'utente, e un
  eventuale rifiuto che richiede una decisione di questo tipo lo segnala esplicitamente.
- `rebase_cloud_rollback` passa `--yes` non appena la chiamata include `confirm: true`
  (come spiegato sotto), non essendoci un terminale in cui richiedere conferma interattiva.

`rebase_cloud_env_set` scrive il valore nello standard input della CLI, evitando che compaia
nella riga di comando dove `ps` potrebbe mostrarlo, e il valore viene escluso da
qualsiasi output restituito dal tool. Il risultato descrive ciò che è stato memorizzato (la chiave, se
è segreta, se è in sospeso una ridistribuzione), mai il valore effettivo. `rebase_cloud_env_list`
elenca solo le chiavi. Una versione della CLI precedente a `env set --stdin` viene rifiutata con un messaggio che richiede
di aggiornarla; il valore non viene inviato in nessun altro modo.

I risultati vengono restituiti nell'[envelope dei dati non attendibili](#untrusted-data-marking),
preceduti da una riga del server su cosa fare successivamente. Un rifiuto è un errore del tool
che riporta il codice della CLI, come ad esempio `no_project`, `token_rejected`,
`managed_project` o `deploy_failed`. Quando il server riconosce il codice,
aggiunge il passaggio successivo, seguito dal messaggio della CLI stessa. Ogni tool controlla i propri argomenti
a fronte dello schema dichiarato prima che venga avviato qualsiasi processo, e rifiuta qualsiasi
argomento non dichiarato.

## Tool reference

53 tool, suddivisi in dieci gruppi: schema e database, pianificazione dello schema, documenti, utenti
e ruoli, storage, cron, funzioni, dev server, registro progetti e
Rebase Cloud.
Ognuno di essi, con i requisiti e l'eventuale blocco da parte del gate verso una destinazione
non locale, è documentato nel [riferimento dei tool MCP](/docs/ai/mcp-tool-reference).

## Resources

Oltre ai tool, il server espone risorse MCP per consentire a un client di recuperare il
contesto del progetto senza consumare una chiamata a un tool:

| URI | Description |
|---|---|
| `rebase://tables/{name}` | TypeScript source of a table definition (`defineTable`) |
| `rebase://schema` | The generated Drizzle schema (`schema.generated.ts`) |

I file delle tabelle sono i moduli della directory dello schema, escluso il suo `index.ts`: la
chiave `tables` dell'app di backend in `rebase.json`, `backend/schema` per impostazione predefinita,
nella directory del progetto attivo o nella sua cartella `app/`.

`rebase://schema` viene elencato **solo se** lo schema generato esiste.
`findBackendDir` cerca `backend/` e poi `app/backend/` nella directory del
progetto attivo, e legge `src/schema.generated.ts` da qualunque delle due trovi —
in questo modo funzionano sia il layout generato con scaffold sia quello di questo monorepo; un progetto organizzato in
un terzo modo, o uno che non ha ancora eseguito `rebase schema generate`, semplicemente non
vedrà la risorsa tra quelle disponibili.

## Skills

Il server fornisce inoltre le 24 [skill per agenti Rebase](/docs/ai/skills/) tramite
l'estensione MCP skills. Un client con revisione del protocollo 2026-07-28 o successiva
ne carica una quando necessario. In Claude Code sono ad esempio `/rebase:rebase-tables` e
simili. Senza `@rebasepro/agent-skills`, il server si avvia senza di esse e lo
notifica su stderr.

## The remote endpoint

Un backend distribuito può anche servire MCP direttamente, su `/mcp`, agli utenti che usano
la tua applicazione, con ciascuno connesso a proprio nome in base alla propria row-level
security. A questo è dedicata una pagina specifica:
[The Remote MCP Endpoint](/docs/ai/remote-mcp/).

## Recommended setup

- Punta il server a un progetto **locale** e lascia `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non impostata. Il gate è la funzionalità più preziosa dell'intero pacchetto.
- Per qualsiasi elemento remoto, registra una **chiave API `rk_` con scope limitato** anziché consentire
  all'auto-discovery di passare una service key.
- Verifica `rebase_project_current` quando l'output sembra errato. Il progetto attivo è
  persistente ("sticky") e risiede all'esterno del repository.
- Tratta `~/.rebase/projects.json` come un file di segreti.

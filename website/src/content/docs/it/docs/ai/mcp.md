---
sourceHash: a81f3289674f6e53
title: Server MCP
sidebar_label: Server MCP
description: Connetti Claude Code, Cursor, Gemini CLI o qualsiasi client MCP a un progetto Rebase — i 53 tool esposti, le credenziali con cui si autentica e il gate di loopback posto tra un agente e la produzione.
---

`@rebasepro/mcp` è un server [Model Context Protocol](https://modelcontextprotocol.io)
che fornisce a un assistente AI tool reali su un progetto Rebase: leggere e
scrivere righe, gestire utenti, eseguire migrazioni, invocare funzioni, controllare il dev
server.

Comunica tramite MCP **esclusivamente su stdio**. Non ci sono porte né listener: il
processo gode esattamente dello stesso livello di attendibilità di ciò che lo ha generato e non c'è
alcun chiamante remoto da autenticare. Questa è la parte sicura. Le domande interessanti
riguardano ciò che fa *una volta* in esecuzione, e questa pagina risponde a tali questioni prima di
mostrare il blocco di configurazione.

Un backend distribuito può anche servire direttamente MCP, via HTTP, alle persone che utilizzano
la tua applicazione. Si tratta di un meccanismo differente con un diverso modello di credenziali:
consulta [L'endpoint MCP remoto](/docs/ai/remote-mcp/).

:::tip[Usi Claude sul web, desktop o mobile?]
Aggiungi invece il [connettore Rebase](/docs/ai/rebase-connector/):
`https://app.rebase.pro/mcp`, una sola volta, per ogni progetto eseguito su Rebase Cloud
o sui tuoi server. Questa pagina riguarda il server locale avviato da un assistente di codifica
all'interno di un progetto.
:::

## Connettere un client

Il server viene eseguito dal tuo progetto: `@rebasepro/mcp` è una devDependency che ogni
scaffold di `rebase init` blocca tramite la CLI, e ogni blocco sottostante — l'intera
integrazione — avvia quella copia (`pnpm exec rebase-mcp`, o `npx --no rebase-mcp`
in un progetto npm), mai una versione più recente da npm. Un progetto precedente lo aggiunge una sola volta,
con `rebase skills install --mcp` o `pnpm add -D @rebasepro/mcp`.

`rebase init` scrive il blocco per ogni agente selezionato quando
[configura i tuoi agenti di codifica AI](/docs/ai/skills#set-up-by-rebase-init), mantenendo
qualsiasi altro server già presente nel file. `rebase init --agent cursor,codex` esegue
la stessa operazione senza chiedere conferma.

**Claude Code** — `.mcp.json` nella radice del progetto. `rebase init` crea questo
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
`${workspaceFolder}` nella radice del progetto:

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
Codex legge la configurazione di un progetto solo dopo aver contrassegnato il progetto come attendibile:

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

**Windsurf** legge i server MCP solo dalla sua configurazione a livello utente, quindi non c'è
alcun file di progetto da scrivere. Aggiungi il server nelle sue impostazioni MCP come `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, indicando quel percorso come `REBASE_PROJECT_DIR`.

Qualsiasi client MCP in grado di eseguire uno spawn di un server stdio funziona; la struttura è la medesima.

### Su quale directory opera

`REBASE_PROJECT_DIR` è la directory contenente `rebase.json`. C'è **un solo**
ordine di precedenza, ed è lo stesso in ogni client:

1. **Il blocco dell'ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se uno qualsiasi di essi è impostato, il progetto `default` viene ricostruito
   a partire da essi a ogni avvio.
2. **La directory di lavoro del server**, quando contiene un `rebase.json`. Un progetto
   in cui ti trovi ha la precedenza su qualsiasi elemento memorizzato in `~/.rebase/projects.json`.
3. **Il `default` persistito** in `~/.rebase/projects.json`, se nessuno dei
   primi due fornisce indicazioni.

L'auto-discovery da `.rebase/state.json` colma le lacune in tutti e tre i casi e non
sovrascrive mai un valore fornito da uno di essi.

I blocchi a livello di progetto specificano il progetto — `"."`, la directory di lavoro del client
o `${workspaceFolder}` dell'editor — perché la regola 3 legge un file
condiviso da ogni progetto presente sulla macchina. Una configurazione a livello utente, come quella di Windsurf,
indica invece un percorso assoluto.

## Cosa può raggiungere il server

Questa è la sezione da leggere prima di indirizzare un assistente verso un database importante.

Il server gestisce **un'unica credenziale globale per l'intero processo**. Non esiste
un'identità per singolo tool né una modalità di sola lettura; ogni tool usa lo stesso token, e l'unico
selettore nel pacchetto consente di *aumentare* l'ambito di accesso piuttosto che ridurlo.

Quale sia questa credenziale, in ordine di priorità:

1. `REBASE_API_TOKEN` dall'ambiente. `REBASE_TOKEN` non viene letto qui:
   è il token del piano di controllo della CLI e non viene mai inviato all'applicazione (il
   server lo segnala una sola volta su stderr quando è l'unico impostato). I tool cloud
   lo inoltrano comunque alla CLI che avviano, la quale lo trasmette al piano di controllo.
2. `REBASE_SERVICE_KEY` letto dal file `.env` del progetto
3. La chiave di servizio rilevata automaticamente da `.rebase/state.json` mentre `rebase dev`
   è in esecuzione

2 e 3 rappresentano la chiave del backend di sviluppo di questa macchina, utilizzata solo quando la destinazione è su
loopback. Quando `REBASE_BASE_URL` punta altrove — `rebase cloud init --claim`
scrive l'indirizzo del progetto cloud, e nessun `REBASE_API_TOKEN` finché un deploy non va a buon fine —
il server non invia alcun token e lo segnala una volta su stderr.

Un token registrato per un progetto **prevale sull'auto-discovery**. Il discovery
si limita a colmare le mancanze.

:::danger[Il percorso zero-config corrisponde a una credenziale di amministrazione]
Le opzioni 2 e 3 corrispondono alla **chiave di servizio** — un segreto di amministrazione senza restrizioni di ambito (unscoped). Il backend
la risolve in `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Tale
identità possiede ogni [scope](/docs/backend/roles-and-scopes/) e soddisfa le
policy `_default_admin_read` / `_default_admin_write` che Rebase inserisce in
ogni tabella che non ha impostato `defaultPolicies: false`.

Quindi la risposta sincera a "la RLS la vincola ancora?" è: la RLS *viene eseguita* — il
driver effettua il downgrade al ruolo `rebase_user` — e poi una policy scritta da Rebase
stesso concede tutto a quell'identità. La lettura di ogni riga di ogni
tabella è il **comportamento previsto dalla configurazione predefinita**, non un
bypass.

Con la configurazione zero-config, un agente dotato di questi tool può leggere e scrivere ogni
riga di ogni tabella, elencare ogni utente, reimpostare qualsiasi password, invocare qualsiasi funzione
di backend ed eseguire DDL su qualsiasi `DATABASE_URL` risolto dal progetto.
:::

### Assegnare una credenziale con permessi ristretti

Registra una [chiave API](/docs/backend/api-keys) con ambiti limitati e il modello a due barriere
verrà applicato realmente. Una chiave di servizio viene eseguita con i ruoli `["service"]`, che le
policy di amministrazione inserite **non** indicano — pertanto la RLS non concede nulla a meno che una
delle tue policy non stabilisca diversamente, e i suoi scope ne restringono ulteriormente la portata:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Quindi fornisci la chiave `rk_live_…` risultante al server invece di consentirgli di
individuare una chiave di servizio:

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

Due aspetti che questa procedura **non** copre, entrambi importanti da conoscere prima di farvi affidamento:

- **Non restringe i tool della CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e i tool di gestione dei branch avviano la CLI di Rebase, la quale si connette tramite
  `DATABASE_URL` e non vede affatto il tuo token. Il gate di loopback descritto sotto è l'unica
  protezione posta davanti a essi.
- **Una chiave può accedere a un tool di amministrazione solo con lo scope corrispondente a quel tool.** `list_users` e
  `list_roles` richiedono `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` richiedono `users:write`; i tool per storage e cron
  richiedono il rispettivo scope `storage:*` o `cron:*`; `invoke_function` richiede
  `functions:invoke`. Senza
  di esso la chiamata restituisce `403 SCOPE_MISSING`. Persino con `users:write`, una chiave non può
  modificare l'account di un amministratore: un amministratore detiene `keys:read` e `keys:write`, cosa che nessuna
  chiave può avere, e a nessuno è consentito gestire un account che possiede più privilegi dei propri.

Una chiave creata con `--roles admin` rappresenta un caso diverso: possiede i ruoli
`["service", "admin"]`, che soddisfano le stesse policy di amministrazione predefinite della chiave di
servizio. Assegnandole anche `--full-access`, il suo raggio d'azione diventa identico a quello della chiave di servizio,
eccetto la gestione delle chiavi. Il vantaggio introdotto è che risulta **revocabile, con scadenza e
soggetta a rate limit per chiave**, caratteristiche non valide per la chiave di servizio — per ruotare
quest'ultima occorre modificare `.env` e riavviare il server.

Consulta [Agenti e server MCP](/docs/backend/api-keys#agents-and-mcp-servers) per la
guida completa sulla definizione degli scope per le chiavi.

### Rendere una tabella del tutto inaccessibile

La ragione per cui una credenziale di amministrazione legge tutto risiede nella policy di base che Rebase
inserisce in ciascuna tabella, garantendo l'accesso al contesto fidato del server e al
ruolo `admin`. Una tabella può escludere tale comportamento di base e assumersi la piena
responsabilità della propria RLS:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const medicalRecords = defineTable("medical_records", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        patientId: col.text(),
        notes:     col.text(),
    },
    // Rimuove il baseline admin/server inserito — nulla è leggibile
    // se non quanto consentito dalle regole sottostanti.
    defaultPolicies: false,
    rls: [
        { operations: ["select", "update"], ownerField: "patientId" },
    ],
});
```

Ora l'unico modo per accedere è soddisfare la corrispondenza con `patientId`. Lo uid della chiave di servizio è la
stringa letterale `service`, quindi una regola basata sul proprietario non corrisponderà mai — le letture restituiranno zero
righe e le scritture verranno respinte da Postgres. Questo è l'unico controllo che vincola
la credenziale predefinita del server MCP anziché darne per scontata l'ammissibilità.

Ricorda che si tratta di una modifica RLS effettiva, non solo documentale: diventa operativa
solo dopo che `rebase schema generate` e una migrazione avranno applicato le policy. Consulta
[Sicurezza a livello di riga (RLS)](/docs/collections/security-rules).

## Il gate di loopback

`rebase_project_add` accetta qualsiasi `baseUrl`, e i tool CLI si connettono tramite
qualsiasi `DATABASE_URL` dichiarato dal progetto. Lo stesso elenco di tool che modifica un
database temporaneo sul tuo portatile può di conseguenza eliminare righe di produzione, senza nulla
nel mezzo se non la valutazione dell'assistente su quale sia il progetto attivo.

**Ogni tool che altera l'ambiente di destinazione viene rifiutato a meno che tale destinazione non si trovi
sull'interfaccia di loopback.** Il gate è definito come un elenco di ciò che *non* è
sottoposto a controllo, in modo che un tool aggiunto in seguito risulti protetto per impostazione predefinita.

- **Non soggetti a gate — letture:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs` e le letture di Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Non soggetti a gate — scritture su Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Il provisioning crea un progetto; gli altri modificano un progetto di produzione. Nessuno
  di essi passa attraverso `baseUrl` o `DATABASE_URL`, che rappresentano gli unici elementi verificabili
  dal gate. Consulta [Rebase Cloud](#rebase-cloud) per i meccanismi di protezione dedicati.
- **Non soggetti a gate — solo locali:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, i tool del dev-server e i tool del registry di progetto.
  Questi scrivono file locali o stato locale e non hanno una destinazione remota da verificare.
- **Soggetti a gate su `DATABASE_URL`:** i rimanenti tool CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Soggetti a gate sul `baseUrl` del progetto:** i rimanenti tool SDK —
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

Le due destinazioni non sono intercambiabili. I tool CLI non vedono mai `baseUrl`, perciò un
backend localhost affiancato a un `DATABASE_URL` di produzione viene verificato rispetto
al database, non al backend.

Un rifiuto si presenta in questo modo:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se non è possibile risolvere alcuna stringa di connessione, i tool DB soggetti a gate vengono rifiutati.**
In assenza di `DATABASE_URL`, la CLI usa il database di sviluppo gestito, che rappresenta
il default per un nuovo progetto, e il gate vieta i suoi quattro tool per database
in tale scenario. Il messaggio di rifiuto spiega la motivazione e indica le alternative funzionanti. Non suggerisce
l'opzione di esclusione:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Da un terminale,
`rebase db push` e `rebase db migrate` possono essere eseguiti su quel database; solo i
tool MCP vengono rifiutati.

Solo il loopback è considerato locale: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
I range privati come `10.x` e `192.168.x` **non** lo sono: è altrettanto probabile che si tratti di
un cluster di staging condiviso anziché di un laptop, e considerarli locali lascerebbe
passare esattamente l'errore accidentale che il gate è stato progettato per impedire.

Imposta `REBASE_MCP_ALLOW_REMOTE_WRITES=true` per disattivare questa protezione. Impostarlo a livello globale nella tua
configurazione client MCP rimuove il gate per ciascun progetto raggiungibile dal server, non
solo per quello a cui stavi pensando.

## Marcatura dei dati non attendibili

Righe, record utente, elenchi di storage, cron job, risposte di funzioni e output della
CLI vengono restituiti racchiusi all'interno di un involucro esplicito:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualsiasi dato archiviato nel database è stato scritto da qualcuno e perviene
sullo stesso canale del contratto del tool seguito dall'assistente. L'involucro indica
al modello di trattarlo come contenuto inerte e non come istruzioni operative.

L'`id` viene generato ex novo per ciascuna risposta, dopo la scrittura dei dati, e
soltanto il marcatore finale recante tale identificativo chiude il blocco. Il testo all'interno dei dati che ha
la forma di un marcatore viene interrotto tramite uno spazio a larghezza zero, in modo che una riga che stampa
`<<<END_UNTRUSTED_DATA>>>` non possa terminare l'involucro in anticipo lasciando all'esterno
ciò che segue.

L'[endpoint remoto](/docs/ai/remote-mcp/) delimita i risultati dei propri tool nello stesso
modo e lo dichiara al client; il relativo `structuredContent` trasmette il risultato in chiaro.
`list_tables` e
`describe_table` rappresentano l'eccezione: poiché vengono letti solo da un modello, vengono
inviati una sola volta, nel testo.

Si tratta di un marcatore, non di una sandbox. Un assistente provvisto di questi tool è sicuro tanto quanto
lo sono i contenuti che gli viene consentito di leggere.

## Progetti multipli

Le configurazioni dei progetti sono memorizzate in `~/.rebase/projects.json`, e il server
può gestirne diverse contemporaneamente — utile quando si lavora a cavallo tra ambienti
locali e remoti. Mentre `rebase dev` è in esecuzione, il server legge la porta attiva e
la chiave di servizio da `.rebase/state.json` nella directory di progetto, fattore che
rende lo scenario locale privo di configurazione manuale.

:::note[Il registro ha l'ultima parola, non la prima]
La precedenza è quella indicata in precedenza: blocco dell'ambiente, poi la directory di lavoro
quando include un `rebase.json`, infine il `default` persistito.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` ricostruiscono il
progetto `default` **a ogni avvio**, non solo al primo. La ricostruzione avviene
per l'intera voce: un token registrato rispetto alla vecchia `projectDir` viene rimosso anziché
essere trasferito in una directory per la quale non è mai stato emesso. Un `default` ricavato in
questo modo — o dalla directory di lavoro — non viene mai riscritto in
`~/.rebase/projects.json`, affinché la chiave di servizio dev di un progetto non possa diventare
quella di un altro.

`activeProject` è persistente (sticky), quindi se una sessione precedente ha chiamato
`rebase_project_switch`, i tool avranno come destinazione quel progetto e il server lo segnalerà su
stderr — a meno che quel progetto non sia registrato con una directory *diversa* da
quella in cui viene eseguito questo server, nel qual caso ripiegherà su `default` segnalandolo.
Se un assistente sembra leggere dal database errato, esegui prima
`rebase_project_current`.
:::

I token sono conservati in quel registro **in testo normale**. Si tratta di un file nella tua home
directory che custodisce credenziali amministrative per ogni progetto registrato; trattalo
con la dovuta cautela.

## Rebase Cloud

Otto tool permettono di portare un'app da questa directory a un backend live su
[Rebase Cloud](/docs/deployment/cloud/) mantenendola in funzione. Ciascuno di essi avvia
`rebase cloud <command> --json` nella directory del progetto attivo: lo stesso
comando eseguito da una persona, escludendo così implementazioni secondarie suscettibili di disallinearsi.

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

Il flusso tipico dell'agente è: `rebase_cloud_provision`, quindi fornire all'utente l'URL
di riscatto (claim URL); `rebase_cloud_status` per verificare lo stato del progetto (finché non è riscattato,
`unclaimed` contiene l'URL di riscatto e l'orario di eliminazione programmata); `rebase_cloud_deploy`
dopo una modifica; `rebase_cloud_logs` in caso di anomalie; e
`rebase_cloud_rollback` se la produzione è compromessa.

**Su cosa agiscono.** Sul progetto a cui la directory attiva è collegata in
`.rebase/cloud.json`. Nessuno di essi accetta un id progetto o una directory, quindi un
assistente non può indirizzarli verso un progetto diverso da quello a cui la directory è
collegata. Cambiare il progetto attivo con `rebase_project_switch` modifica
la directory in cui vengono eseguiti.

**Con quale autorità.** Con qualsiasi autorità la CLI risolva in quella directory: `REBASE_TOKEN`
quando impostato, altrimenti il token memorizzato da `rebase cloud init --claim` per un
progetto non riscattato, e infine la sessione di `rebase cloud login`. Nella directory di quel
progetto non riscattato, un `REBASE_TOKEN` privo di scope sul progetto viene accantonato
a favore del token proprietario del progetto. Il piano di controllo
esamina ciascuna chiamata esattamente come verifica quelle della CLI: pertanto, con un token creato tramite
`rebase cloud tokens create --can logs`, un assistente può leggere i log, mentre il
piano di controllo rifiuterà deploy, variabili e rollback. L'assenza di credenziali, o una credenziale respinta,
genera un errore che specifica quale azione l'utente debba compiere (`rebase cloud login` o il riscatto del progetto).

**Perché il gate di loopback non si applica.** Il gate controlla il `baseUrl` dell'app e
il `DATABASE_URL` della CLI; questi tool non usano nessuno dei due. Dopo `rebase_cloud_provision`,
`REBASE_BASE_URL` punta al nuovo progetto cloud, quindi applicarvi il gate rifiuterebbe
proprio il deploy richiesto dal flusso operativo. Il provisioning di per sé crea soltanto: non modifica
alcuna app o database esistente, e la CLI lo rifiuta comunque all'interno di una directory
già collegata. Un deploy, una variabile e un rollback comportano invece
modifiche alla produzione. La loro salvaguardia è garantita dalla credenziale sopra citata, dall'approvazione
dei tool da parte del client MCP e dal parametro `confirm: true`: `rebase_cloud_deploy` verso
la produzione, `rebase_cloud_env_set` in produzione, `rebase_cloud_rollback` e
`rebase_cloud_provision` indicano le operazioni che eseguirebbero senza applicarle finché una chiamata
non ripete gli stessi argomenti con `confirm: true`, inviato dall'assistente solo
dopo l'assenso dell'utente. I deploy e le variabili di preview non ne hanno bisogno. Per impedire a un assistente di modificare un progetto
cloud, imposta `REBASE_TOKEN` nell'ambiente del server con un token sprovvisto dei permessi
`deploy` ed `env`.

**Leggere qualsiasi tuo progetto.** I tool elencati sopra operano sul progetto collegato.
Per consultare i dati di un altro progetto — qualsiasi progetto appartenente a qualunque organizzazione a cui l'account
connesso ha accesso, collegato localmente o meno — `rebase_cloud_projects_list` li elenca
e `rebase_project_use_cloud` (con un id, slug o nome) vi indirizza i tool di dati e
amministrazione: `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Queste chiamate transitano attraverso il proxy Studio
della console, usando la credenziale propria della CLI (`rebase cloud access-token`, letto
per ogni chiamata e mai archiviato); il piano di controllo convalida l'accesso dell'utente e
vi associa la chiave di servizio del progetto dal proprio lato, evitando l'invio di chiavi alla macchina.
Un progetto con lo Studio disattivato viene rifiutato, e l'impostazione lo dichiara. Costituisce una
destinazione remota come qualsiasi altra, pertanto i tool che modificano i dati rimangono bloccati
a meno che `REBASE_MCP_ALLOW_REMOTE_WRITES` non sia impostato; `rebase_project_switch` consente
di tornare indietro.

Ogni tool opera tramite snapshot:

- `rebase_cloud_logs` non rimane mai in ascolto continuo (follow). Il suo output include `nextSinceTime`; inoltralo
  come parametro `since` per leggere le righe successive. Restituisce le ultime 200 righe a meno che
  `tail` non specifichi diversamente. `source: "build"` restituisce invece il log di build più recente.
- `rebase_cloud_deploy` segue il deployment fino al completamento e verifica che la nuova
  versione risponda. `wait: false` ritorna non appena il deployment viene avviato.
  Non effettua mai l'eject di un progetto dal runtime gestito, non distribuisce una versione
  precedente del framework né salta i controlli di build: queste decisioni spettano all'utente, e un
  eventuale rifiuto che richiede una di esse lo segnala esplicitamente.
- `rebase_cloud_rollback` passa `--yes` nel momento in cui la chiamata include `confirm: true`
  (vedi sotto), non essendoci un terminale interattivo per richiedere conferma.

`rebase_cloud_env_set` scrive il valore nello standard input della CLI, evitando che compaia
sulla riga di comando dove `ps` potrebbe renderlo visibile, e il valore viene escluso da
qualsiasi output restituito dal tool. Il risultato descrive quanto memorizzato (la chiave, se sia
segreta, se sia necessario un redeploy), mai il valore effettivo. `rebase_cloud_env_list`
elenca esclusivamente le chiavi. Una CLI priva del supporto a `env set --stdin` viene rifiutata con un messaggio che invita
all'aggiornamento; il valore non viene inviato in altri modi.

I risultati vengono restituiti nell'[involucro dei dati non attendibili](#marcatura-dei-dati-non-attendibili),
preceduti da una riga informativa fornita dal server sul passaggio successivo da compiere. Un rifiuto corrisponde a un errore del tool
che riporta il codice della CLI, come `no_project`, `token_rejected`,
`managed_project` o `deploy_failed`. Quando il server riconosce il codice,
indica il passaggio successivo, seguito dal messaggio originario della CLI. Ciascun tool valida i propri argomenti
in base allo schema dichiarato prima di eseguire qualsiasi processo, respingendo qualsiasi
parametro non previsto.

## Riferimento dei tool

53 tool, suddivisi in dieci gruppi: schema e database, pianificazione dello schema, documenti, utenti
e ruoli, storage, cron, funzioni, dev server, registry di progetto e
Rebase Cloud.
Ciascuno di essi, con i requisiti e l'eventuale blocco da parte del gate in caso di
destinazione non locale, è documentato nel [riferimento dei tool MCP](/docs/ai/mcp-tool-reference).

## Risorse

Oltre ai tool, il server espone risorse MCP affinché un client possa ricavare contesto
sul progetto senza dover consumare una chiamata a un tool:

| URI | Descrizione |
|---|---|
| `rebase://tables/{name}` | Sorgente TypeScript della definizione di una tabella (`defineTable`) |
| `rebase://schema` | Lo schema Drizzle generato (`schema.generated.ts`) |

I file delle tabelle corrispondono ai moduli della directory dello schema, escluso il suo `index.ts`: la
chiave `tables` dell'app di backend in `rebase.json`, per default `backend/schema`,
sotto la directory del progetto attivo o la sua sottodirectory `app/`.

`rebase://schema` viene elencato **solo se** lo schema generato esiste.
`findBackendDir` cerca `backend/` e successivamente `app/backend/` all'interno della directory del
progetto attivo, leggendo `src/schema.generated.ts` dalla cartella individuata —
in questo modo funzionano sia la struttura iniziale sia quella del monorepo; un progetto organizzato
in una modalità diversa, o che non ha ancora eseguito `rebase schema generate`, semplicemente non
vedrà la risorsa tra quelle disponibili.

## L'endpoint remoto

Un backend distribuito può anche offrire MCP autonomamente, su `/mcp`, per gli utenti finali
della tua applicazione, con ciascuno connesso a proprio nome in base alla propria sicurezza a livello
di riga (RLS). Questo scenario dispone di una documentazione specifica:
[L'endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configurazione consigliata

- Punta il server su un progetto **locale** e lascia `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non valorizzato. Il gate è la funzionalità più importante inclusa nel pacchetto.
- Per qualsiasi risorsa remota, registra una **chiave API `rk_` con scope ristretti** invece di permettere
  al discovery di esporre una chiave di servizio.
- Esegui `rebase_project_current` se l'output sembra scorretto. Il progetto attivo è
  persistente e risiede esternamente al tuo repository.
- Considera `~/.rebase/projects.json` a tutti gli effetti come un file di segreti.

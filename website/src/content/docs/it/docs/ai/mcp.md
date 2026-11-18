---
sourceHash: e0ed23817228dbd2
title: MCP Server
sidebar_label: MCP Server
description: "Connetti Claude Code, Cursor, Gemini CLI o qualsiasi client MCP a un progetto Rebase: i 53 tool esposti, le credenziali con cui si autentica e il gate di loopback interposto tra l'agente e la produzione."
---

`@rebasepro/mcp` è un server [Model Context Protocol](https://modelcontextprotocol.io) che fornisce a un assistente IA tool reali per interagire con un progetto Rebase: leggere e scrivere righe, gestire utenti, eseguire migrazioni, invocare funzioni, gestire il dev server.

Comunica via MCP **esclusivamente su stdio**. Non ci sono porte né listener: il processo è affidabile esattamente quanto il processo che lo ha generato e non c'è alcun chiamante remoto da autenticare. Questa è la parte sicura. Le domande interessanti riguardano tutte ciò che fa *una volta* avviato, e questa pagina risponde a tali domande prima di mostrare il blocco di configurazione.

Un backend distribuito può anche servire MCP direttamente, via HTTP, agli utenti della tua applicazione. Si tratta di un aspetto diverso, con un differente modello di credenziali: vedi [L'endpoint MCP remoto](/docs/ai/remote-mcp/).

:::tip[Usi Claude sul web, desktop o mobile?]
Aggiungi invece il [connettore Rebase](/docs/ai/rebase-connector/):
`https://app.rebase.pro/mcp`, una sola volta, per ogni progetto eseguito su Rebase Cloud
o sui tuoi server. Questa pagina riguarda il server locale che un assistente di codifica avvia
all'interno di un progetto.
:::

## Connettere un client

Il server viene eseguito dal tuo progetto: `@rebasepro/mcp` è una devDependency che ogni
scaffolding di `rebase init` vincola con la CLI, e ciascun blocco sottostante — l'intera
integrazione — avvia quella specifica copia (`pnpm exec rebase-mcp`, o `npx --no rebase-mcp`
in un progetto npm), mai una versione più recente da npm. Un progetto più vecchio può aggiungerla una tantum
con `rebase skills install --mcp` o `pnpm add -D @rebasepro/mcp`.

`rebase init` scrive il blocco per ogni agente selezionato quando
[configura i tuoi agenti di codifica IA](/docs/ai/skills#set-up-by-rebase-init), mantenendo
qualsiasi altro server già presente nel file. `rebase init --agent cursor,codex` fa
la stessa cosa senza chiedere conferma.

**Claude Code** — `.mcp.json` nella root del tuo progetto. `rebase init` crea questo
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
`${workspaceFolder}` alla root del progetto:

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

**Codex CLI** — in formato TOML anziché JSON, in `.codex/config.toml` del progetto.
Codex legge la configurazione di un progetto solo dopo che hai contrassegnato il progetto come attendibile:

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

**Windsurf** legge i server MCP solo dalla sua configurazione a livello utente, quindi non c'è
alcun file di progetto da scrivere. Aggiungi il server nelle sue impostazioni MCP come `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, impostando tale percorso come `REBASE_PROJECT_DIR`.

Qualsiasi client MCP in grado di avviare un server stdio funziona; la struttura è la medesima.

### Su quale directory opera

`REBASE_PROJECT_DIR` è la directory che contiene `rebase.json`. Esiste **un solo**
ordine di precedenza, ed è lo stesso in ogni client:

1. **Il blocco dell'ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se uno qualsiasi di essi è impostato, il progetto `default` viene ricostruito
   a partire da questi a ogni avvio.
2. **La working directory del server**, quando contiene un `rebase.json`. Il progetto
   in cui ti trovi ha la precedenza su qualsiasi cosa memorizzata in `~/.rebase/projects.json`.
3. **Il `default` persistito** in `~/.rebase/projects.json`, quando nessuno dei
   primi due specifica nulla.

L'auto-rilevamento da `.rebase/state.json` colma le lacune in tutti e tre i casi e non
sovrascrive mai un valore fornito da uno di essi.

I blocchi a livello di progetto indicano il progetto — `"."`, la working directory del client
o `${workspaceFolder}` dell'editor — perché la regola 3 legge un file condiviso da tutti i progetti sulla macchina.
Una configurazione a livello utente, come quella di Windsurf, specifica invece un percorso assoluto.

## Cosa può raggiungere il server

Questa è la sezione da leggere prima di puntare un assistente verso un database a cui tieni.

Il server gestisce **un'unica credenziale globale per l'intero processo**. Non esiste un'identità
per singolo tool né una modalità di sola lettura; ogni tool usa lo stesso token e l'unico flag
nel pacchetto serve per ottenere un raggio d'azione *maggiore*, non minore.

Quale credenziale viene utilizzata, in ordine di priorità:

1. `REBASE_API_TOKEN` dall'ambiente. `REBASE_TOKEN` non viene letto qui:
   è il token del control plane della CLI e non viene mai inviato all'applicazione (il
   server lo segnala una volta su stderr quando è l'unico impostato). I tool cloud continuano
   a passarlo alla CLI generata, che a sua volta lo invia al control plane.
2. `REBASE_SERVICE_KEY` letto dal file `.env` del progetto
3. La service key rilevata automaticamente da `.rebase/state.json` mentre `rebase dev`
   è in esecuzione

2 e 3 rappresentano la chiave del backend di sviluppo di questa macchina, utilizzata solo quando il target si trova su loopback. Quando `REBASE_BASE_URL` punta altrove — `rebase cloud init --claim` scrive l'indirizzo del progetto cloud e nessun `REBASE_API_TOKEN` finché un deploy non ha successo — il server non invia alcun token e lo segnala una volta su stderr.

Un token registrato per un progetto **ha la precedenza sull'auto-rilevamento**. Il rilevamento serve solo a colmare le mancanze.

:::danger[La configurazione zero-config utilizza credenziali da amministratore]
Le opzioni 2 e 3 corrispondono alla **service key** — un secret di amministrazione senza restrizioni di ambito (unscoped). Il backend la risolve come `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Tale identità possiede ogni [scope](/docs/backend/roles-and-scopes/) e soddisfa le policy `_default_admin_read` / `_default_admin_write` che Rebase inietta in ogni tabella che non abbia impostato `defaultPolicies: false`.

Quindi la risposta onesta alla domanda "l'RLS applica comunque dei vincoli?" è: l'RLS *viene eseguito* — il driver effettua il downgrade al ruolo `rebase_user` — e poi una policy scritta da Rebase stesso concede a quell'identità qualsiasi permesso. Leggere ogni riga di ogni tabella è il **comportamento previsto per progettazione nella configurazione predefinita**, non un bypass.

Con la configurazione zero-config, un agente che dispone di questi tool può leggere e scrivere ogni riga di ogni tabella, elencare ogni utente, reimpostare qualsiasi password, invocare qualsiasi funzione di backend ed eseguire istruzioni DDL su qualsiasi `DATABASE_URL` a cui il progetto si risolve.
:::

### Assegnare invece una credenziale ristretta

Registra una [API key](/docs/backend/api-keys) dotata di scope e il modello a due gate verrà applicato realmente. Una service key viene eseguita con i ruoli `["service"]`, che le policy di amministrazione iniettate **non** includono — di conseguenza l'RLS non le concede nulla a meno che una delle tue policy non disponga altrimenti, e i suoi scope la limitano ulteriormente:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Fornisci quindi la chiave `rk_live_…` risultante al server anziché lasciare che rilevi una service key:

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
  `rebase_doctor` e i tool di branch avviano la CLI di Rebase, che si connette con
  `DATABASE_URL` e non vede affatto il tuo token. Il loopback gate descritto di seguito è l'unica
  protezione posta davanti ad essi.
- **Una chiave può accedere a un tool di amministrazione solo con lo scope appropriato per quel tool.** `list_users` e
  `list_roles` richiedono `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` richiedono `users:write`; i tool di storage e cron
  richiedono il rispettivo scope `storage:*` o `cron:*`; `invoke_function` richiede
  `functions:invoke`. Senza di esso, la chiamata risponde con `403 SCOPE_MISSING`. Anche con `users:write`, una chiave non può
  modificare l'account di un amministratore: un amministratore detiene `keys:read` e `keys:write`, che nessuna
  chiave può avere, e nessuno può gestire un account che possiede più privilegi di quanti ne abbia egli stesso.

Una chiave creata con `--roles admin` è un discorso differente: possiede i ruoli
`["service", "admin"]`, il che soddisfa le stesse policy di amministrazione predefinite della service
key. Aggiungendo anche `--full-access`, il suo raggio d'azione diventa pari a quello della service key,
a esclusione della gestione delle chiavi. Ciò che offre in più è il fatto di essere **revocabile, con scadenza e soggetta a rate limit per chiave**,
caratteristiche che non si applicano alla service key — ruotare quest'ultima
richiede la modifica del file `.env` e il riavvio del server.

Vedi [Agenti e server MCP](/docs/backend/api-keys#agents-and-mcp-servers) per la guida completa sullo scoping delle chiavi.

### Rendere una tabella del tutto inaccessibile

Il motivo per cui una credenziale di amministrazione può leggere tutto è la policy di base Rebase
inietta in ciascuna tabella, concedendo l'accesso al contesto server attendibile e al
ruolo `admin`. Una tabella può escludere questa baseline e assumersi la piena
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

Ora l'unico modo per accedere è corrispondere a `patientId`. Lo uid della service key è la
stringa letterale `service`, quindi una regola di ownership non corrisponderà mai — le letture restituiscono zero
righe e le scritture vengono rifiutate da Postgres. Questo è l'unico controllo che vincola
le credenziali predefinite del server MCP anziché ignorarne i limiti.

Ricorda che si tratta di una modifica RLS effettiva, non solo documentale: ha effetto
solo dopo che `rebase schema generate` e una migrazione hanno applicato le policy. Vedi
[Sicurezza a livello di riga](/docs/collections/security-rules).

## Il gate di loopback

`rebase_project_add` accetta qualsiasi `baseUrl`, e i tool della CLI si connettono con
qualsiasi `DATABASE_URL` dichiarato dal progetto. Lo stesso elenco di tool che modifica un
database temporaneo sul tuo laptop può quindi eliminare righe in produzione, senza nulla
nel mezzo se non il giudizio dell'assistente su quale progetto sia attivo.

**Ogni tool che modifica l'ambiente di destinazione viene rifiutato a meno che tale destinazione non sia
sull'interfaccia di loopback.** Il gate è formulato come una lista di ciò che *non*
è bloccato dal gate, in modo che qualsiasi tool aggiunto in futuro risulti protetto per impostazione predefinita.

- **Non bloccati dal gate — letture:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, e le letture di Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Non bloccati dal gate — scritture su Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Il provisioning crea un progetto; gli altri modificano un progetto in produzione. Nessuno
  di essi passa attraverso `baseUrl` o `DATABASE_URL`, che sono gli unici parametri verificabili dal gate.
  Vedi [Rebase Cloud](#rebase-cloud) per le protezioni poste davanti ad essi.
- **Non bloccati dal gate — solo locali:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, i tool del dev-server e i tool del registro progetti.
  Questi scrivono file locali o stato locale e non hanno alcuna destinazione remota da verificare.
- **Bloccati dal gate su `DATABASE_URL`:** i restanti tool della CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloccati dal gate sul `baseUrl` del progetto:** i restanti tool dell'SDK —
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

I due target non sono intercambiabili. I tool della CLI non vedono mai `baseUrl`, quindi un
backend su localhost affiancato a un `DATABASE_URL` di produzione viene verificato rispetto al
database, non al backend.

Un rifiuto si presenta così:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se non è possibile risolvere alcuna stringa di connessione, i tool DB protetti dal gate vengono rifiutati.**
In assenza di `DATABASE_URL`, la CLI utilizza il database di sviluppo gestito, che è
il valore predefinito per un nuovo progetto, e il gate rifiuta i suoi quattro tool di database
in questo contesto. Il messaggio di rifiuto spiega il motivo e indica cosa usare in alternativa. Non suggerisce
l'opt-out:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Da terminale,
`rebase db push` e `rebase db migrate` vengono eseguiti regolarmente su quel database; solo i tool MCP
vengono rifiutati.

Solo il loopback è considerato locale: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
Gli intervalli privati come `10.x` e `192.168.x` **non** lo sono: è altrettanto probabile che si tratti di
un cluster di staging condiviso quanto di un laptop, e trattarli come locali lascerebbe passare
proprio l'incidente che il gate è stato creato per prevenire.

Imposta `REBASE_MCP_ALLOW_REMOTE_WRITES=true` per disattivare la protezione. Impostarlo a livello globale nella configurazione del client
MCP rimuove il gate per ogni progetto accessibile dal server, non
solo per quello a cui stavi pensando.

## Marcatura dei dati non attendibili

Righe, record utente, elenchi dello storage, cron job, risposte di funzioni e output
della CLI vengono restituiti racchiusi in un envelope esplicito:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualsiasi cosa memorizzata nel tuo database è stata scritta da qualcuno, e arriva
sullo stesso canale del contratto del tool seguito dall'assistente. L'envelope indica
al modello di trattarla come contenuto inerte anziché come istruzioni.

L'`id` viene generato ex novo per ogni risposta, dopo che i dati sono stati scritti, e
solo il marcatore finale che lo contiene può chiudere il blocco. Il testo all'interno dei dati che ha
la forma di un marcatore viene spezzato con uno spazio a larghezza zero (zero-width space), in modo che una riga contenente
`<<<END_UNTRUSTED_DATA>>>` non possa chiudere prematuramente l'envelope e lasciare all'esterno ciò che segue.

L'[endpoint remoto](/docs/ai/remote-mcp/) delimita i risultati dei suoi tool nello stesso
modo e lo comunica al client; il suo `structuredContent` contiene il risultato in chiaro.
`list_tables` e
`describe_table` fanno eccezione: solo un modello le legge, quindi vengono
inviate una sola volta, nel testo.

Si tratta di un marcatore, non di una sandbox. Un assistente dotato di questi tool è sicuro
solo quanto i contenuti che gli consenti di leggere.

## Progetti multipli

Le configurazioni dei progetti sono memorizzate in `~/.rebase/projects.json`, e il server
può gestirne diverse contemporaneamente — utile quando si lavora tra ambienti locali e remoti.
Mentre `rebase dev` è in esecuzione, il server legge la porta attiva e la
service key da `.rebase/state.json` nella directory del progetto, ed è questo che rende il caso locale zero-config.

:::note[Il registro ha l'ultima parola, non la prima]
L'ordine di precedenza è quello sopra descritto: il blocco delle variabili di ambiente, poi la working directory
quando contiene un `rebase.json`, infine il `default` persistito.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` ricostruiscono il
progetto `default` **a ogni avvio**, non solo al primo. La ricostruzione avviene
per l'intera voce: un token registrato per il vecchio `projectDir` viene eliminato anziché
essere trasferito in una directory per cui non è mai stato emesso. Un `default` derivato in questo modo —
o dalla working directory — non viene mai riscritto in
`~/.rebase/projects.json`, evitando così che la dev service key di un progetto possa diventare
quella di un altro.

`activeProject` è permanente (sticky), quindi se una sessione precedente ha chiamato
`rebase_project_switch`, i tool avranno come target quel progetto e il server lo segnalerà su
stderr — a meno che quel progetto non sia registrato in una directory *diversa* da
quella in cui questo server è in esecuzione; in tal caso ripiega su `default` e lo segnala.
Se un assistente sembra leggere il database sbagliato, chiama prima
`rebase_project_current`.
:::

### Su quale progetto agisce una chiamata

`activeProject` ha portata a livello di macchina, e spesso un server viene installato una sola volta per l'intera macchina. Pertanto, ogni tool che agisce su un progetto (tutti tranne i tool di registro `rebase_project_*`, `rebase_cloud_projects_list`, `rebase_cloud_provision` e `rebase_dev_logs`) risolve il proprio progetto **per singola chiamata** e accetta un parametro opzionale `project`: il nome di un progetto registrato, oppure lo slug o l'id di Rebase Cloud. La chiamata viene verificata rispetto al collegamento Cloud (`.rebase/cloud.json`) della directory in cui opera la sessione: la prima [root](https://modelcontextprotocol.io/specification/latest/client/roots) del client, altrimenti la working directory del server.

| La chiamata | La directory della sessione | Risultato |
|---|---|---|
| specifica un progetto | è collegata allo stesso progetto | viene eseguita su di esso |
| specifica un progetto | è collegata a un altro progetto | **rifiutata**, non viene eseguito nulla |
| non specifica alcun progetto | è collegata a un progetto diverso da quello attivo | **rifiutata**, non viene eseguito nulla |
| non specifica alcun progetto | è collegata; il progetto attivo è un progetto locale altrove | viene eseguita sul progetto collegato |
| non specifica alcun progetto | non è collegata | viene eseguita sul progetto attivo; una *scrittura* su un progetto Cloud selezionato da una sessione precedente richiede che il progetto sia specificato per nome |

Un rifiuto indica entrambi i progetti. `rebase_project_current` riporta la directory della sessione e il relativo link sotto `session`. `rebase_cloud_env_set` e `rebase_cloud_rollback` passano il progetto risolto alla CLI con `--project`; `rebase_cloud_deploy` distribuisce la directory in cui viene eseguito, quindi viene rifiutato se il collegamento di quella directory punta a un altro progetto.

I token sono memorizzati in quel registro **in testo normale**. Si tratta di un file nella tua home
directory contenente credenziali di amministratore per ogni progetto registrato; trattalo
con la dovuta cautela.

## Rebase Cloud

Otto tool consentono di portare un'app da questa directory a un backend attivo su
[Rebase Cloud](/docs/deployment/cloud/) e mantenerla in esecuzione. Ognuno di essi esegue
`rebase cloud <command> --json` nella directory del progetto attivo: lo stesso comando che
eseguirebbe una persona, evitando così una seconda implementazione che potrebbe divergere nel tempo.

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

Il percorso tipico di un agente è: `rebase_cloud_provision`, quindi fornire all'utente l'URL di
claim; `rebase_cloud_status` per visualizzare il progetto (finché non viene reclamato,
`unclaimed` include l'URL di claim e la data in cui verrà eliminato); `rebase_cloud_deploy`
dopo una modifica; `rebase_cloud_logs` in caso di anomalie; e
`rebase_cloud_rollback` se la produzione è compromessa.

**Su cosa operano.** Il progetto a cui la chiamata si risolve, come descritto in
[Su quale progetto agisce una chiamata](#su-quale-progetto-agisce-una-chiamata): l'argomento `project`,
verificato rispetto al collegamento della directory della sessione, o quel collegamento, o
il progetto attivo. Una chiamata che indica un progetto a cui la directory della sessione non è
collegata viene rifiutata prima ancora di avviare qualsiasi processo.

**Con quale autorità.** Qualsiasi valore la CLI risolva in quella directory: `REBASE_TOKEN`
quando impostato, poi il token memorizzato da `rebase cloud init --claim` per un
progetto non ancora reclamato, quindi la sessione di `rebase cloud login`. Nella directory di quel
progetto non reclamato, un `REBASE_TOKEN` che non possiede alcuno scope sul progetto viene messo da
parte in favore del token del progetto stesso. Il control plane
verifica ogni chiamata così come verifica quelle della CLI; pertanto, con un token creato tramite
`rebase cloud tokens create --can logs` un assistente può leggere i log, mentre il
control plane rifiuterà i suoi tentativi di deploy, impostazione di variabili e rollback. L'assenza di credenziali o una credenziale rifiutata viene restituita come un errore che indica cosa deve fare l'utente (`rebase cloud login` o reclamare il progetto).

**Perché il loopback gate non si applica.** Il gate controlla il `baseUrl` dell'app e
il `DATABASE_URL` della CLI; questi tool non usano nessuno dei due. Dopo `rebase_cloud_provision`,
`REBASE_BASE_URL` punta al nuovo progetto cloud, quindi applicare il gate su di esso rifiuterebbe
proprio il deploy di cui il flusso ha bisogno. Il provisioning stesso crea soltanto: non tocca
alcuna app o database esistente, e la CLI lo rifiuta comunque in una directory che
è già collegata. Un deploy, una variabile e un rollback modificano
ciascuno l'ambiente di produzione. Ciò che li protegge è la credenziale sopra menzionata, l'approvazione dei tool del tuo
client MCP e `confirm: true`: `rebase_cloud_deploy` in
produzione, `rebase_cloud_env_set` in produzione, `rebase_cloud_rollback` e
`rebase_cloud_provision` rispondono spiegando cosa farebbero senza eseguire nulla finché una chiamata
non ripete gli stessi argomenti con `confirm: true`, che l'assistente invia solo
dopo l'assenso dell'utente. Un deploy di preview e una variabile di preview non ne hanno bisogno. Per impedire a un assistente di modificare un progetto cloud, imposta `REBASE_TOKEN` nell'ambiente del server su un token privo delle
capability `deploy` ed `env`.

**Leggere uno qualsiasi dei tuoi progetti.** I tool sopra descritti agiscono sul progetto collegato.
Per leggere i dati di un altro progetto — qualsiasi progetto in qualsiasi organizzazione a cui appartiene
l'account che ha effettuato l'accesso, collegato qui o meno — `rebase_cloud_projects_list` li elenca
e `rebase_project_use_cloud` (con un id, slug o nome) indirizza i tool dati e
di amministrazione verso di esso: `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Tali chiamate passano attraverso il proxy Studio della console,
presentando la credenziale propria della CLI (`rebase cloud access-token`, letta a ogni chiamata
e mai memorizzata); il control plane verifica l'accesso dell'utente e
allega la service key del progetto dal proprio lato, in modo che nessuna chiave raggiunga la macchina.
Un progetto con Studio disattivato viene rifiutato e l'interruttore lo segnala. È una
destinazione remota come qualsiasi altra, quindi i tool che modificano i dati rimangono bloccati lì
a meno che non sia impostato `REBASE_MCP_ALLOW_REMOTE_WRITES`; `rebase_project_switch` consente di tornare
indietro.

Ciascun tool è uno snapshot:

- `rebase_cloud_logs` non segue mai in streaming (follow). Il suo risultato include `nextSinceTime`; ripassalo
  come `since` per leggere quanto avvenuto successivamente. Restituisce le ultime 200 righe a meno che
  `tail` non specifichi diversamente. `source: "build"` restituisce invece l'ultimo log di compilazione.
- `rebase_cloud_deploy` segue il deployment fino al completamento e verifica che la nuova
  versione risponda. `wait: false` ritorna non appena il deployment viene attivato.
  Non espelle mai un progetto dal runtime gestito, non distribuisce una release precedente del framework
  né salta i controlli di build: queste sono decisioni dell'utente, e un
  rifiuto che ne richiede una lo esplicita.
- `rebase_cloud_rollback` passa `--yes` non appena la chiamata include `confirm: true`
  (vedere di seguito), poiché non c'è un terminale su cui richiedere conferma.

`rebase_cloud_env_set` scrive il valore sullo standard input della CLI, così da non comparire
mai sulla riga di comando dove `ps` potrebbe mostrarlo, e il valore viene escluso da
qualsiasi output restituito dal tool. Il risultato indica ciò che è stato memorizzato (la chiave, se
è un secret, se è in sospeso un nuovo deploy), mai il valore effettivo. `rebase_cloud_env_list`
elenca solo le chiavi. Una CLI precedente a `env set --stdin` viene rifiutata con un messaggio che invita ad
aggiornarla; il valore non viene inviato in nessun altro modo.

I risultati vengono restituiti nell'[envelope dei dati non attendibili](#marcatura-dei-dati-non-attendibili),
preceduti da una riga del server su cosa fare successivamente. Un rifiuto è un errore del tool
che include il codice della CLI, come `no_project`, `token_rejected`,
`managed_project` o `deploy_failed`. Quando il server riconosce il codice,
aggiunge il passaggio successivo, seguito dal messaggio della CLI stessa. Ogni tool verifica i propri argomenti
rispetto allo schema dichiarato prima di avviare qualsiasi processo e rifiuta qualsiasi
argomento non dichiarato.

## Riferimento dei tool

53 tool, suddivisi in dieci gruppi: schema e database, pianificazione dello schema, documenti, utenti
e ruoli, storage, cron, funzioni, il dev server, il registro progetti e
Rebase Cloud.
Ciascuno di essi, con i requisiti e l'eventuale blocco del gate contro target non locali,
è descritto nel [riferimento dei tool MCP](/docs/ai/mcp-tool-reference).

## Risorse

Oltre ai tool, il server espone risorse MCP in modo che un client possa estrarre il
contesto del progetto senza dover consumare una chiamata a un tool:

| URI | Descrizione |
|---|---|
| `rebase://tables/{name}` | Codice sorgente TypeScript della definizione di una tabella (`defineTable`) |
| `rebase://schema` | Lo schema Drizzle generato (`schema.generated.ts`) |

I file delle tabelle sono i moduli della directory dello schema, a eccezione del suo `index.ts`: la
chiave `tables` dell'app di backend in `rebase.json`, per impostazione predefinita `backend/schema`,
all'interno della directory del progetto attivo o della sua sottodirectory `app/`.

`rebase://schema` viene elencato **solo se** lo schema generato esiste.
`findBackendDir` cerca `backend/` e successivamente `app/backend/` nella directory del progetto
attivo, e legge `src/schema.generated.ts` da quello che trova per primo —
consentendo il funzionamento sia con il layout generato da scaffolding sia con quello di questo monorepo; un progetto strutturato
in un terzo modo, o che non ha ancora eseguito `rebase schema generate`,
semplicemente non vedrà offerta la risorsa.

## L'endpoint remoto

Un backend distribuito può anche servire MCP direttamente, su `/mcp`, agli utenti della
tua applicazione, ciascuno connesso a proprio nome sotto la propria row-level
security. Questo argomento ha una pagina dedicata:
[L'endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configurazione consigliata

- Punta il server verso un progetto **locale** e lascia `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non impostato. Il gate è la funzionalità di maggior valore dell'intero pacchetto.
- Per qualsiasi risorsa remota, registra una **API key `rk_` con scope** invece di lasciare che
  il meccanismo di discovery fornisca una service key.
- Controlla `rebase_project_current` quando l'output non sembra corretto. Il progetto attivo è
  persistente e risiede all'esterno del tuo repository.
- Tratta `~/.rebase/projects.json` come un file di secret.

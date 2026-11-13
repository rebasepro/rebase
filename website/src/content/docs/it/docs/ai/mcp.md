---
sourceHash: 43fd981d241b2237
title: Server MCP
sidebar_label: Server MCP
description: "Connetti Claude Code, Cursor, Gemini CLI o qualsiasi client MCP a un progetto Rebase: i 53 tool esposti, le credenziali con cui si autentica e il gate di loopback che separa un agente dalla produzione."
---

`@rebasepro/mcp` è un server [Model Context Protocol](https://modelcontextprotocol.io)
che fornisce a un assistente IA strumenti reali su un progetto Rebase: lettura e
scrittura di righe, gestione degli utenti, esecuzione di migrazioni, invocazione di funzioni,
gestione del server di sviluppo.

Comunica via MCP **unicamente su stdio**. Non ci sono porte né listener: il
processo è affidabile esattamente quanto ciò che lo ha avviato, e non c'è alcun
chiamante remoto da autenticare. Questa è la parte sicura. Le domande interessanti
riguardano ciò che fa *una volta* avviato, e questa pagina risponde a tali questioni
prima di mostrarti il blocco di configurazione.

Un backend distribuito può anche esporre esso stesso MCP, via HTTP, agli utenti che
utilizzano la tua applicazione. Si tratta di qualcosa di diverso con un differente
modello di credenziali: vedi [L'endpoint MCP remoto](/docs/ai/remote-mcp/).

:::tip[Usi Claude sul web, desktop o mobile?]
Aggiungi invece il [connettore Rebase](/docs/ai/rebase-connector/):
`https://app.rebase.pro/mcp`, una sola volta, per ogni progetto eseguito su Rebase Cloud
o sui tuoi server. Questa pagina riguarda il server locale avviato da un assistente
di codifica all'interno di un progetto.
:::

## Connettere un client

Il server viene eseguito dal tuo progetto: `@rebasepro/mcp` è una devDependency che
ogni scaffolding di `rebase init` blocca con la CLI, e ciascun blocco qui sotto — l'intera
integrazione — avvia quella copia (`pnpm exec rebase-mcp`, o `npx --no rebase-mcp`
in un progetto npm), mai una versione più recente da npm. Un progetto più vecchio la
aggiunge una tantum con `rebase skills install --mcp` o `pnpm add -D @rebasepro/mcp`.

`rebase init` scrive il blocco per ogni agente selezionato durante la
[configurazione degli agenti di codifica IA](/docs/ai/skills#set-up-by-rebase-init),
mantenendo eventuali altri server già presenti nel file. `rebase init --agent cursor,codex`
fa lo stesso senza chiedere conferma.

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

**Codex CLI** — TOML anziché JSON, nel file `.codex/config.toml` del progetto.
Codex legge la configurazione di progetto solo dopo aver considerato attendibile il progetto:

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

**Windsurf** legge i server MCP solo dalla sua configurazione a livello utente, quindi
non c'è alcun file di progetto da scrivere. Aggiungi il server nelle impostazioni MCP
come `"command": "pnpm"`, `"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`,
con quel percorso come `REBASE_PROJECT_DIR`.

Qualsiasi client MCP in grado di avviare un server stdio funziona; la struttura è la medesima.

### Su quale directory agisce

`REBASE_PROJECT_DIR` è la directory contenente `rebase.json`. C'è **un solo**
ordine di precedenza, ed è lo stesso in ogni client:

1. **Il blocco di ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se uno qualsiasi di essi è impostato, il progetto `default` viene
   ricostruito a partire da questi a ogni avvio.
2. **La directory di lavoro del server**, se contiene un `rebase.json`. Un progetto
   in cui ti trovi ha la precedenza su qualsiasi elemento memorizzato in `~/.rebase/projects.json`.
3. **Il `default` persistito** in `~/.rebase/projects.json`, quando nessuno dei
   primi due specifica alcunché.

L'auto-discovery da `.rebase/state.json` colma le lacune in tutti e tre i casi e non
sovrascrive mai un valore fornito da uno di essi.

I blocchi a livello di progetto indicano il progetto — `"."`, la directory di lavoro
del client o `${workspaceFolder}` dell'editor — perché la regola 3 legge un file
condiviso da ogni progetto sulla macchina. Una configurazione a livello utente, come
quella di Windsurf, specifica invece un percorso assoluto.

## Cosa può raggiungere il server

Questa è la sezione da leggere prima di puntare un assistente verso un database
importante.

Il server include **un'unica credenziale globale per l'intero processo**. Non esiste
un'identità per singolo tool né una modalità di sola lettura; ogni tool usa lo stesso token,
e l'unico selettore nel pacchetto serve ad abilitare *un accesso maggiore* anziché minore.

Quale credenziale sia, in ordine di priorità:

1. `REBASE_API_TOKEN` dall'ambiente. `REBASE_TOKEN` non viene letto qui:
   è il token del piano di controllo della CLI e non viene mai inviato all'app (il
   server lo segnala una volta su stderr quando è l'unico impostato). I tool cloud
   continuano a passarlo alla CLI avviata, che lo invia al piano di controllo.
2. `REBASE_SERVICE_KEY` letta dal file `.env` del progetto
3. La chiave di servizio rilevata automaticamente da `.rebase/state.json` mentre
   `rebase dev` è in esecuzione

2 e 3 rappresentano la chiave del backend di sviluppo di questa macchina, utilizzata
solo quando la destinazione è su loopback. Quando `REBASE_BASE_URL` punta altrove —
`rebase cloud init --claim` scrive l'indirizzo del progetto cloud e nessun `REBASE_API_TOKEN`
finché il deploy non ha esito positivo — il server non invia alcun token e lo segnala una volta su stderr.

Un token registrato per un progetto **ha la precedenza sull'auto-discovery**. Il discovery
serve solo a colmare le lacune.

:::danger[Il percorso zero-config è una credenziale di amministrazione]
Le opzioni 2 e 3 rappresentano la **service key** — un segreto di amministrazione
privo di restrizioni di ambito (unscoped). Il backend la risolve in `uid: "service"`,
`roles: ["admin"]`, `isAdmin: true`. Tale identità detiene ogni [scope](/docs/backend/roles-and-scopes/)
e soddisfa i criteri `_default_admin_read` / `_default_admin_write` che Rebase inserisce
in ogni tabella che non ha impostato `defaultPolicies: false`.

Quindi la risposta sincera a "la RLS la vincola ancora?" è: la RLS viene *eseguita* — il
driver effettua il downgrade al ruolo `rebase_user` — e poi una policy scritta da Rebase
stesso concede a quell'identità qualsiasi cosa. Leggere ogni riga di ogni tabella è il
**comportamento previsto dalla configurazione predefinita**, non un bypass.

Con la configurazione zero-config, un agente in possesso di questi tool può leggere e
scrivere ogni riga di ogni tabella, elencare ogni utente, reimpostare qualsiasi password,
invocare qualsiasi funzione di backend ed eseguire DDL su qualsiasi `DATABASE_URL` risolta
dal progetto.
:::

### Assegnare invece credenziali con privilegi ridotti

Registra una [chiave API](/docs/backend/api-keys) con permessi limitati (scoped) e il
modello a due gate si applicherà realmente. Una service key viene eseguita con i ruoli
`["service"]`, che i criteri di amministrazione inseriti **non** menzionano — di conseguenza,
la RLS non le concede nulla a meno che una delle tue policy non disponga altrimenti, e i suoi
scope la limitano ulteriormente:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Quindi passa la chiave `rk_live_…` risultante al server anziché lasciare che rilevi
una service key:

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

Due cose che questo **non** fa, entrambe utili da sapere prima di affidarsi a tale approccio:

- **Non limita i tool della CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e i tool di branch avviano la CLI di Rebase, che si connette con
  `DATABASE_URL` e non vede affatto il tuo token. Il loopback gate descritto di seguito è
  l'unica protezione posta davanti ad essi.
- **Una chiave può accedere a un tool di amministrazione solo con lo scope specifico di quel tool.**
  `list_users` e `list_roles` richiedono `users:read`; `create_user`, `update_user`, `delete_user`
  e `rebase_auth_reset_password` richiedono `users:write`; i tool di archiviazione e cron
  richiedono i rispettivi scope `storage:*` o `cron:*`; `invoke_function` richiede
  `functions:invoke`. Senza di esso, la chiamata risponde `403 SCOPE_MISSING`. Anche con
  `users:write`, una chiave non può modificare l'account di un amministratore: un amministratore
  detiene `keys:read` e `keys:write`, che nessuna chiave può avere, e nessuno può gestire
  un account con privilegi superiori ai propri.

Una chiave creata con `--roles admin` è una situazione diversa: include i ruoli
`["service", "admin"]`, che soddisfano le stesse policy di amministrazione predefinite
della service key. Aggiungendo anche `--full-access`, il suo raggio d'azione diventa
pari a quello della service key, ad eccezione della gestione delle chiavi. Il vantaggio
consiste nel fatto che è **revocabile, con scadenza e soggetta a rate limit per singola chiave**,
caratteristiche assenti nella service key, la cui rotazione comporta la modifica del
file `.env` e il riavvio del server.

Vedi [Agenti e server MCP](/docs/backend/api-keys#agents-and-mcp-servers) per la guida
completa alla definizione degli scope delle chiavi.

### Rendere una tabella del tutto inaccessibile

<span class="since-badge" data-since="0.31">Since 0.31</span>

Il motivo per cui una credenziale di amministrazione legge tutto risiede nella policy
di base inserita da Rebase in ogni tabella, che concede l'accesso al contesto server
attendibile e al ruolo `admin`. Una tabella può disattivare tale configurazione di base
e assumersi la piena responsabilità della propria RLS:

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

Ora l'unico modo per accedere è soddisfare `patientId`. L'uid della service key è
la stringa letterale `service`, quindi una regola sull'owner non corrisponderà mai:
le letture restituiscono zero righe e le scritture vengono rifiutate da Postgres.
Questo è l'unico controllo che vincola le credenziali predefinite del server MCP
anziché ignorarle a priori.

Ricorda che si tratta di una modifica RLS effettiva, non meramente documentale:
diventa operativa solo dopo che `rebase schema generate` e una migrazione avranno
applicato le policy. Vedi [Sicurezza a livello di riga](/docs/collections/security-rules).

## Il gate di loopback

<span class="since-badge" data-since="0.31">Since 0.31</span>

`rebase_project_add` accetta qualsiasi `baseUrl`, e i tool della CLI si connettono con
qualsiasi `DATABASE_URL` dichiarata dal progetto. Lo stesso elenco di tool che modifica
un database temporaneo sul tuo portatile può quindi eliminare righe di produzione, senza
nient'altro in mezzo se non il giudizio dell'assistente su quale progetto sia attivo.

**Ogni tool che modifica l'ambiente di destinazione viene rifiutato a meno che tale
destinazione non si trovi sull'interfaccia di loopback.** Il gate è strutturato come
un elenco di ciò che *non* è soggetto a gate, in modo che un tool aggiunto in seguito
risulti protetto per impostazione predefinita.

- **Non soggetti a gate — letture:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, e le letture di Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Non soggetti a gate — scritture su Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Il provisioning crea un progetto; gli altri modificano un progetto di produzione.
  Nessuno di essi passa attraverso `baseUrl` o `DATABASE_URL`, che sono gli unici
  parametri verificabili dal gate. Vedi [Rebase Cloud](#rebase-cloud) per le protezioni applicate.
- **Non soggetti a gate — solo locali:** `rebase_schema_introspect`, `rebase_db_branch_switch`,
  `rebase_schema_generate`, `rebase_db_generate`, `rebase_generate_sdk`, i tool del
  server di sviluppo e i tool del registro dei progetti. Questi scrivono file locali o
  stato locale e non hanno alcuna destinazione remota da verificare.
- **Soggetti a gate rispetto a `DATABASE_URL`:** i restanti tool della CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Soggetti a gate rispetto al `baseUrl` del progetto:** i restanti tool dell'SDK —
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  e `invoke_function`.

I due target non sono intercambiabili. I tool della CLI non vedono mai `baseUrl`,
quindi un backend su localhost affiancato a un `DATABASE_URL` di produzione viene
verificato rispetto al database, non al backend.

Un rifiuto si presenta così:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se non è possibile risolvere alcuna stringa di connessione, i tool DB soggetti a gate vengono rifiutati.**
Senza un `DATABASE_URL`, la CLI usa il database di sviluppo gestito, che rappresenta
l'impostazione predefinita per un nuovo progetto, e il gate rifiuta i suoi quattro tool di database.
Il messaggio di rifiuto spiega la motivazione e indica le alternative funzionanti, senza suggerire
l'opt-out:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Da un terminale,
`rebase db push` e `rebase db migrate` vengono eseguiti su tale database; solo i tool MCP
vengono rifiutati.

Solo il loopback viene considerato locale: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
Gli intervalli privati come `10.x` e `192.168.x` **non** lo sono: hanno la stessa
probabilità di essere un cluster di staging condiviso o un portatile, e trattarli come
locali lascerebbe passare proprio l'incidente che il gate è stato progettato per prevenire.

Imposta `REBASE_MCP_ALLOW_REMOTE_WRITES=true` per disattivare questo controllo. L'impostazione
globale nella configurazione del client MCP rimuove il gate per ogni progetto raggiungibile
dal server, non solo per quello a cui stavi pensando.

## Marcatura dei dati non attendibili {#untrusted-data-marking}

Righe, record utente, elenchi di storage, job cron, risposte di funzioni e output della CLI
vengono restituiti racchiusi in un envelope esplicito:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualsiasi elemento archiviato nel tuo database è stato scritto da qualcuno e arriva
sullo stesso canale del contratto del tool seguito dall'assistente. L'envelope indica al
modello di trattarlo come contenuto inerte anziché come istruzioni.

L'`id` viene generato ex novo per ogni risposta, dopo che i dati sono stati scritti, e
solo il marcatore finale corrispondente chiude il blocco. Il testo all'interno dei dati che
ha una forma simile a un marcatore viene interrotto con uno spazio a larghezza zero, in modo
che una riga contenente `<<<END_UNTRUSTED_DATA>>>` non possa chiudere prematuramente l'envelope
ed esporre quanto segue all'esterno.

L'[endpoint remoto](/docs/ai/remote-mcp/) isola i risultati dei propri tool allo stesso
modo e lo comunica al client; il suo `structuredContent` trasporta il risultato in chiaro.
`list_tables` e `describe_table` fanno eccezione: solo un modello le legge, quindi
vengono inviate una sola volta, nel testo.

Si tratta di un marcatore, non di una sandbox. Un assistente in possesso di questi tool
è sicuro solo quanto i contenuti che gli consenti di leggere.

## Progetti multipli

Le configurazioni dei progetti sono memorizzate in `~/.rebase/projects.json`, e il server
può gestirne diverse contemporaneamente — utile quando si lavora tra ambienti locali e remoti.
Mentre `rebase dev` è in esecuzione, il server legge la porta attiva e la chiave di servizio
da `.rebase/state.json` nella directory del progetto, ed è questo che rende il caso locale zero-config.

:::note[Il registro è l'ultima parola, non la prima]
L'ordine di precedenza è quello descritto sopra: il blocco di ambiente, poi la directory di lavoro
se contiene un `rebase.json`, infine il `default` persistito.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` ricostruiscono il progetto
`default` **a ogni avvio**, non solo al primo. La ricostruzione avviene per l'intera voce:
un token registrato per la vecchia `projectDir` viene scartato anziché trasferito in una
directory per la quale non è mai stato emesso. Un `default` ricavato in questo modo — o dalla
directory di lavoro — non viene mai riscritto in `~/.rebase/projects.json`, affinché la
dev service key di un progetto non possa diventare quella di un altro.

`activeProject` è persistente (sticky), quindi se una sessione precedente ha chiamato
`rebase_project_switch`, i tool avranno come destinazione quel progetto e il server lo segnalerà
su stderr — a meno che tale progetto non sia registrato in una directory *diversa* da quella
in cui viene eseguito questo server, nel qual caso ripiegherà su `default` segnalandolo. Se un
assistente sembra leggere il database sbagliato, chiama prima `rebase_project_current`.
:::

I token vengono memorizzati in quel registro **in testo normale**. È un file nella tua home
directory contenente le credenziali di amministrazione per ogni progetto registrato; trattalo
di conseguenza.

## Rebase Cloud

Otto tool portano un'applicazione da questa directory a un backend live su
[Rebase Cloud](/docs/deployment/cloud/) e la mantengono in esecuzione. Ciascuno di essi avvia
`rebase cloud <command> --json` nella directory del progetto attivo: lo stesso comando che
eseguirebbe una persona, evitando così disallineamenti dovuti a una seconda implementazione.

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
| `rebase_cloud_projects_list` | `rebase cloud projects list --all-orgs` | No |

Il tipico percorso di un agente è: `rebase_cloud_provision`, quindi fornire all'utente
l'URL per il claim; `rebase_cloud_status` per visualizzare il progetto (finché non è
reclamato, `unclaimed` include l'URL di claim e la data di eliminazione); `rebase_cloud_deploy`
dopo una modifica; `rebase_cloud_logs` in caso di anomalie; e `rebase_cloud_rollback`
in caso di problemi in produzione.

**Su cosa agiscono.** Sul progetto a cui la directory attiva è collegata in
`.rebase/cloud.json`. Nessuno di essi accetta l'ID di un progetto o una directory, quindi un
assistente non può puntarli verso un progetto diverso da quello collegato alla directory.
Cambiare il progetto attivo con `rebase_project_switch` modifica la directory in cui vengono eseguiti.

**Con quale autorità.** Con qualsiasi credenziale la CLI risolva in quella directory:
`REBASE_TOKEN` quando impostato, poi il token memorizzato da `rebase cloud init --claim`
per un progetto non reclamato, infine la sessione di `rebase cloud login`. Nella directory
di quel progetto non reclamato, un `REBASE_TOKEN` che non ha scope sul progetto viene messo
da parte a favore del token del progetto stesso. Il piano di controllo verifica ogni chiamata
come verifica quelle della CLI, quindi con un token creato tramite `rebase cloud tokens create --can logs`
un assistente può leggere i log, e il piano di controllo rifiuterà i suoi deploy, le variabili
e i rollback. L'assenza di credenziali, o una credenziale rifiutata, restituisce un errore che
indica cosa deve fare l'utente (`rebase cloud login`, oppure reclamare il progetto).

**Perché il loopback gate non si applica.** Il gate controlla il `baseUrl` dell'app e il
`DATABASE_URL` della CLI; questi tool non usano nessuno dei due. Dopo `rebase_cloud_provision`,
`REBASE_BASE_URL` punta al nuovo progetto cloud, quindi bloccarlo con il gate rifiuterebbe
proprio il deploy di cui il percorso ha bisogno. Il provisioning in sé crea soltanto: non tocca
alcuna app o database esistente, e la CLI lo rifiuta comunque in una directory già collegata.
Un deploy, una variabile e un rollback modificano ciascuno l'ambiente di produzione. Ciò che
li protegge è la credenziale descritta sopra e l'approvazione dei tool del tuo client MCP.
Per impedire a un assistente di modificare un progetto cloud, imposta `REBASE_TOKEN` nell'ambiente
del server su un token privo delle capacità `deploy` ed `env`.

**Leggere qualsiasi tuo progetto.** I tool sopra descritti operano sul progetto collegato.
Per leggere i dati di un altro progetto — qualsiasi progetto in qualunque organizzazione a cui
appartiene l'account che ha effettuato l'accesso, collegato qui o meno — `rebase_cloud_projects_list`
li elenca e `rebase_project_use_cloud` (con un ID, uno slug o un nome) indirizza i tool di dati
e di amministrazione verso di esso: `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Queste chiamate passano attraverso il proxy Studio
della console, con le credenziali stesse della CLI (`rebase cloud access-token`, letto per ciascuna
chiamata e mai memorizzato); il piano di controllo verifica l'accesso dell'utente e associa
la chiave di servizio del progetto dal proprio lato, in modo che nessuna chiave raggiunga la
macchina locale. Un progetto con Studio disattivato viene rifiutato e l'interruttore lo segnala.
Si tratta di una destinazione remota come qualsiasi altra, quindi i tool che modificano i dati
rimangono bloccati a meno che non sia impostato `REBASE_MCP_ALLOW_REMOTE_WRITES`;
`rebase_project_switch` permette di tornare indietro.

Ciascun tool è uno snapshot:

- `rebase_cloud_logs` non effettua mai il follow continuo. Il suo risultato include
  `nextSinceTime`; passalo nuovamente come `since` per leggere ciò che è avvenuto dopo.
  Restituisce le ultime 200 righe a meno che `tail` non indichi diversamente. `source: "build"`
  restituisce invece il log dell'ultima build.
- `rebase_cloud_deploy` segue il deployment fino al termine e verifica che la nuova
  versione risponda. `wait: false` termina non appena il deployment viene attivato.
  Non espelle mai un progetto dal runtime gestito, non effettua il deploy di versioni precedenti
  del framework né salta i controlli di build: queste sono decisioni riservate all'utente,
  e un rifiuto che ne richieda una lo specifica chiaramente.
- `rebase_cloud_rollback` passa `--yes`. La chiamata del tool funge da conferma, non
  essendoci un terminale in cui richiederla.

`rebase_cloud_env_set` scrive il valore sullo standard input della CLI, evitando così che
compaia sulla riga di comando dove `ps` lo mostrerebbe, e il valore viene escluso da qualsiasi
output restituito dal tool. Il risultato indica ciò che è stato memorizzato (la chiave, se è
segreta, se è in sospeso un nuovo deploy), mai il valore. `rebase_cloud_env_list` elenca solo le
chiavi. Una CLI precedente a `env set --stdin` viene rifiutata con un messaggio che invita
all'aggiornamento; il valore non viene inviato in altri modi.

I risultati vengono restituiti nell'[envelope dei dati non attendibili](#marcatura-dei-dati-non-attendibili-untrusted-data-marking),
anticipati da una riga del server sui passaggi successivi da compiere. Un rifiuto è un errore
del tool che include il codice della CLI, come `no_project`, `token_rejected`, `managed_project`
o `deploy_failed`. Quando il server riconosce il codice, aggiunge il passaggio successivo seguito
dal messaggio originario della CLI. Ogni tool verifica i propri argomenti rispetto allo schema
dichiarato prima di avviare qualsiasi processo, e rifiuta qualsiasi argomento non dichiarato.

## Riferimento dei tool

53 tool, suddivisi in dieci gruppi: schema e database, pianificazione dello schema, documenti,
utenti e ruoli, storage, cron, funzioni, il server di sviluppo, il registro dei progetti e
Rebase Cloud.
Ognuno di essi, con i requisiti e l'indicazione se il gate lo rifiuti nei confronti di una
destinazione non locale, è riportato nel [riferimento dei tool MCP](/docs/ai/mcp-tool-reference).

## Risorse

<span class="since-badge" data-since="0.31">Since 0.31</span>

Oltre ai tool, il server espone risorse MCP affinché un client possa ottenere il contesto del
progetto senza dover effettuare una chiamata a un tool:

| URI | Descrizione |
|---|---|
| `rebase://tables/{name}` | Sorgente TypeScript della definizione di una tabella (`defineTable`) |
| `rebase://schema` | Lo schema Drizzle generato (`schema.generated.ts`) |

I file delle tabelle sono i moduli della directory dello schema, a parte il relativo `index.ts`:
la chiave `tables` dell'app di backend in `rebase.json`, per impostazione predefinita
`backend/schema`, all'interno della directory del progetto attivo o della sua sottocartella `app/`.

`rebase://schema` viene elencato **solo se** lo schema generato esiste.
`findBackendDir` cerca `backend/` e poi `app/backend/` nella directory del progetto attivo, e legge
`src/schema.generated.ts` da quello che trova: in questo modo funzionano sia la struttura iniziale
sia questo monorepo, mentre un progetto strutturato diversamente, o uno in cui non è ancora stato
eseguito `rebase schema generate`, semplicemente non vedrà offerta la risorsa.

## L'endpoint remoto

Un backend distribuito può anche esporre esso stesso MCP, all'indirizzo `/mcp`, agli utenti che
usano la tua applicazione, ciascuno autenticato come se stesso nel rispetto della propria sicurezza
a livello di riga. Questo argomento ha una pagina dedicata:
[L'endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configurazione consigliata

- Punta il server a un progetto **locale** e lascia `REBASE_MCP_ALLOW_REMOTE_WRITES` non impostata.
  Il gate è la funzionalità più preziosa dell'intero pacchetto.
- Per qualsiasi ambiente remoto, registra una **chiave API `rk_` con scope limitati** anziché
  lasciare che l'auto-discovery fornisca una service key.
- Controlla `rebase_project_current` quando l'output sembra errato. Il progetto attivo è persistente
  (sticky) e risiede all'esterno del tuo repository.
- Tratta `~/.rebase/projects.json` come un file contenente dati sensibili e segreti.

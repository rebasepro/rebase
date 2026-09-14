---
sourceHash: 50026032d03a87e2
title: Server MCP
sidebar_label: Server MCP
description: Connetti Claude Code, Cursor, Gemini CLI o qualsiasi client MCP a un progetto Rebase — i 42 strumenti che espone, le credenziali con cui si autentica e il gate di loopback interposto tra un agent e la produzione.
---

`@rebasepro/mcp` è un server [Model Context Protocol](https://modelcontextprotocol.io)
che mette a disposizione di un assistente IA strumenti reali su un progetto Rebase: leggere e
scrivere righe, gestire utenti, eseguire migrazioni, invocare funzioni, pilotare il dev
server.

Comunica via MCP **esclusivamente su stdio**. Non c'è alcuna porta né listener: il
processo gode esattamente dello stesso livello di attendibilità di ciò che lo ha generato, e non c'è alcun
chiamante remoto da autenticare. Questa è la parte sicura. Le questioni interessanti riguardano
tutte ciò che fa *una volta* avviato, e questa pagina vi risponde prima di
mostrare il blocco di configurazione.

Un backend distribuito può anche servire MCP direttamente, via HTTP, per gli utenti che
utilizzano la tua applicazione. Si tratta di una cosa differente con un modello di credenziali diverso:
vedi [L'endpoint remoto](#lendpoint-remoto).

## Connettere un client

Il server è pubblicato su npm e non richiede alcun passaggio di installazione; `npx` lo scarica al volo.
Ciascun blocco seguente rappresenta l'integrazione completa.

**Claude Code** — `.mcp.json` nella directory root del tuo progetto. `rebase init` genera questo
file per te:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Cursor** — la stessa struttura, in `.cursor/mcp.json`:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
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
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Codex CLI** — TOML invece di JSON, in `~/.codex/config.toml`. È
a livello di utente, non di singolo progetto, quindi indica qui la directory del progetto:

```toml title="~/.codex/config.toml"
[mcp_servers.rebase]
command = "npx"
args = ["-y", "@rebasepro/mcp"]
env = { REBASE_PROJECT_DIR = "/absolute/path/to/your/project" }
```

**Kiro** — `.kiro/settings/mcp.json`:

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

Qualsiasi client MCP in grado di avviare un server stdio funziona; la struttura è la medesima.

### Su quale directory agisce

`REBASE_PROJECT_DIR` è la directory contenente `rebase.json`. C'è **un solo**
ordine di precedenza, ed è lo stesso in ogni client:

1. **Il blocco ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se uno di essi è impostato, il progetto `default` viene ricostruito
   a partire da essi a ogni avvio.
2. **La directory di lavoro del server**, quando contiene un file `rebase.json`. Il progetto
   in cui ci si trova ha priorità su qualsiasi cosa memorizzata in `~/.rebase/projects.json`.
3. **Il `default` persistito** in `~/.rebase/projects.json`, quando nessuno dei
   primi due specifica nulla.

L'auto-discovery da `.rebase/state.json` colma le lacune in tutti e tre i casi e non
sovrascrive mai un valore fornito da uno di essi.

I blocchi a livello di progetto impostano `REBASE_PROJECT_DIR` su `"."` — la directory di
lavoro del client corrisponde al progetto — poiché la regola 3 legge un file condiviso da ogni
progetto sulla macchina. Il blocco per Codex è a livello utente anziché per progetto,
quindi indica invece un percorso assoluto.

## Cosa può raggiungere il server

Questa è la sezione da leggere prima di puntare un assistente verso un database importante.

Il server gestisce **un'unica credenziale ambientale per l'intero processo**. Non c'è
un'identità per singolo strumento né una modalità di sola lettura; ogni strumento usa lo stesso token, e
l'unico selettore presente nel package serve per estendere i permessi (*opt-in*) anziché ridurli.

La credenziale utilizzata, in ordine di priorità, è:

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` dalle variabili d'ambiente
2. `REBASE_SERVICE_KEY` letta dal file `.env` del progetto
3. La service key rilevata automaticamente da `.rebase/state.json` mentre `rebase dev`
   è in esecuzione

Un token registrato manualmente per un progetto **prevale sull'auto-discovery**. Il rilevamento automatico
serve solo a colmare una mancanza.

:::danger[Il percorso zero-config è una credenziale di amministrazione]
Le opzioni 2 e 3 corrispondono alla **service key** — un segreto di amministrazione senza restrizioni di scope. Il backend
la risolve come `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Tale
identità ignora completamente l'elenco dei permessi delle chiavi API e soddisfa le
policy `_default_admin_read` / `_default_admin_write` che Rebase inietta in
ogni collection che non abbia impostato `disableDefaultPolicies`.

Di conseguenza, la risposta onesta alla domanda "l'RLS pone ancora dei limiti?" è: l'RLS *viene eseguito* — il
driver esegue il downgrade al ruolo `rebase_user` — dopodiché una policy scritta da Rebase
stesso concede qualsiasi permesso a quell'identità. Leggere ogni riga di ogni
collection è il **comportamento previsto della configurazione predefinita**, non un
bypass.

Con la configurazione zero-config, un agent in possesso di questi strumenti può leggere e scrivere ogni
riga di ogni collection, elencare tutti gli utenti, reimpostare qualsiasi password, invocare qualsiasi funzione
di backend ed eseguire DDL su qualsiasi `DATABASE_URL` a cui il progetto si risolve.
:::

### Fornire invece una credenziale ristretta

Registrando una [chiave API](/docs/backend/api-keys) con permessi limitati (scoped), il modello
a due gate si applica realmente. Una chiave senza privilegi di amministrazione viene eseguita con i ruoli `["service"]`, che le
policy admin iniettate **non** menzionano — di conseguenza l'RLS non le concede nulla a meno che una
delle tue policy non disponga altrimenti, e l'elenco dei permessi ne restringe ulteriormente il raggio d'azione:

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Quindi passa la chiave `rk_live_…` risultante al server invece di lasciare che
rilevi automaticamente una service key:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absolute/path/to/your/project",
        "REBASE_API_TOKEN": "rk_live_..."
      }
    }
  }
}
```

Due aspetti che questa procedura **non** copre, entrambi da conoscere prima di farvi affidamento:

- **Non restringe gli strumenti CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e gli strumenti di gestione dei branch eseguono la CLI di Rebase, la quale si connette tramite
  `DATABASE_URL` e non vede mai il tuo token. Il loopback gate descritto di seguito è l'unico
  argine posto davanti a essi.
- **Una chiave non-admin non può utilizzare gli strumenti di amministrazione.** `list_users`, `create_user`,
  `update_user`, `delete_user`, `list_roles` e `rebase_auth_reset_password`
  sono protetti da `requireAdmin` e falliranno con una chiave limitata. Questo è il
  normale funzionamento del sistema, ma implica dover scegliere tra ampiezza di accesso e restrizione dei permessi,
  senza poter ottenere entrambi contemporaneamente.

Una chiave API con `admin: true` è diversa: possiede i ruoli
`["admin", "service"]`, superando le medesime policy admin predefinite gestite dalla
service key. Sul piano dei dati la sua portata è identica a quella della service key. Il vantaggio aggiuntivo è che
è **revocabile, soggetta a scadenza e con rate limiting per singola chiave**, caratteristiche
assenti nella service key — ruotare quest'ultima richiede la modifica del file `.env` e il riavvio del server.

Consulta [Agent e server MCP](/docs/backend/api-keys#agents-and-mcp-servers) per la
guida completa sulla definizione dello scope delle chiavi.

### Rendere una collection del tutto irraggiungibile

Il motivo per cui una credenziale di amministrazione può leggere tutto risiede nella policy di base che Rebase
inietta in ciascuna collection, concedendo l'accesso al contesto server attendibile e al
ruolo `admin`. Una collection può escludere questa policy di base e assumersi la piena
responsabilità del proprio RLS:

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

A questo punto, l'unico modo per accedere è una corrispondenza con `patient_id`. L'uid della service key è la
stringa letterale `service`, quindi una regola sull'owner non vi corrisponderà mai — le letture restituiranno zero
righe e le scritture verranno respinte da Postgres. Questo è l'unico controllo che vincola
la credenziale predefinita del server MCP anziché darne per scontata la piena accessibilità.

Ricorda che si tratta di una modifica RLS effettiva, non solo documentale: diventa operativa
solo dopo che `rebase schema generate` e una migrazione ne hanno applicato le policy. Consulta
[Regole di sicurezza (RLS)](/docs/collections/security-rules).

## Il loopback gate

`rebase_project_add` accetta qualsiasi `baseUrl`, e gli strumenti CLI si connettono con
qualsiasi `DATABASE_URL` dichiarato dal progetto. Lo stesso set di strumenti che modifica un
database di prova sul tuo laptop potrebbe quindi eliminare righe in produzione, senza nulla
nel mezzo se non il giudizio dell'assistente su quale sia il progetto attivo.

**L'esecuzione di ogni strumento che modifica l'ambiente di destinazione viene rifiutata a meno che tale destinazione non si trovi
sull'interfaccia di loopback.** Il gate è definito come un elenco di ciò che *non* è
sottoposto a restrizione, cosicché ogni strumento aggiunto in seguito risulti protetto per impostazione predefinita.

- **Non vincolati — letture:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Non vincolati — solo locali:** `rebase_schema_introspect`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, gli strumenti per il dev-server e quelli per il registro progetti.
  Questi scrivono file locali o stato locale e non hanno alcuna destinazione remota da verificare.
- **Vincolati rispetto a `DATABASE_URL`:** i restanti strumenti CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Vincolati rispetto al `baseUrl` del progetto:** i restanti strumenti SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Le due destinazioni non sono intercambiabili. Gli strumenti CLI non elaborano mai `baseUrl`, perciò un
backend localhost affiancato a un `DATABASE_URL` di produzione viene verificato rispetto
al database, non al backend.

Un rifiuto si presenta in questo modo:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se non è possibile risolvere alcuna stringa di connessione, gli strumenti DB vengono rifiutati** —
una destinazione non verificabile non è considerata sicura:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Solo il loopback viene considerato locale: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Gli intervalli privati come `10.x` e `192.168.x` **non** lo sono — hanno la stessa probabilità di rappresentare
un cluster di staging condiviso quanto un laptop, e trattarli come locali lascerebbe
passare esattamente quegli incidenti che il gate è stato progettato per prevenire.

Imposta `REBASE_MCP_ALLOW_REMOTE_WRITES=true` per disattivare questo comportamento. Impostarlo a livello globale nella
configurazione del client MCP rimuove il gate per ogni progetto raggiungibile dal server, non
soltanto per quello desiderato.

## Marcatura dei dati non attendibili

Righe, record utente, elenchi di storage, cron job, risposte di funzioni e output
della CLI vengono restituiti racchiusi in un contenitore esplicito:

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Qualsiasi dato archiviato nel tuo database è stato scritto da qualcuno e perviene
sullo stesso canale del contratto degli strumenti seguito dall'assistente. L'involucro indica
al modello di trattare tale contenuto come dati inerti anziché come istruzioni.

Si tratta di un marcatore, non di una sandbox. Un assistente provvisto di questi strumenti è sicuro
soltanto nella misura in cui sono sicuri i contenuti che gli è consentito leggere.

## Progetti multipli

Le configurazioni dei progetti sono memorizzate in `~/.rebase/projects.json`, e il server
può gestirne diverse contemporaneamente — utile quando si lavora tra ambienti
locali e remoti. Mentre `rebase dev` è in esecuzione, il server legge la porta attiva e
la service key da `.rebase/state.json` nella directory del progetto, consentendo
la configurazione zero-config per il caso locale.

:::note[Il registro ha l'ultima parola, non la prima]
L'ordine di precedenza è quello sopra descritto: blocco ambiente, poi la directory di lavoro
se contiene un file `rebase.json`, infine il `default` persistito.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` ricostruiscono il
progetto `default` **a ogni avvio**, non solo al primo. La ricostruzione riguarda
l'intera voce: un token registrato per il vecchio `projectDir` viene rimosso anziché
mantenuto in una directory per cui non era mai stato emesso. Un `default` derivato in
questo modo — o dalla directory di lavoro — non viene mai riscritto in
`~/.rebase/projects.json`, impedendo che la dev service key di un progetto diventi
quella di un altro.

`activeProject` è persistente (sticky), quindi se una sessione precedente ha chiamato
`rebase_project_switch`, gli strumenti punteranno a quel progetto e il server lo notificherà su
stderr — a meno che quel progetto non sia registrato sotto una directory *diversa* da
quella in cui viene eseguito questo server; in tal caso ripiegherà su `default` notificandolo.
Se un assistente sembra leggere il database sbagliato, richiama prima
`rebase_project_current`.
:::

I token sono salvati in quel registro **in chiaro**. Si tratta di un file nella tua home
directory che conserva credenziali di amministrazione per ogni progetto registrato; trattalo
con la dovuta attenzione.

## Riferimento degli strumenti

42 strumenti, suddivisi in nove gruppi. Gli strumenti contrassegnati con ⚠ vengono rifiutati verso destinazioni non locali
a meno che non sia impostato l'opt-out.

### Schema e database (12)

Avviano la CLI di Rebase nella directory del progetto attivo.

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_schema_generate` | — | Genera lo schema Drizzle a partire dalle definizioni delle collection |
| `rebase_db_push` ⚠ | — | Applica lo schema direttamente al database (scorciatoia per dev) |
| `rebase_schema_introspect` | — | Effettua l'introspezione del database attivo trasformandolo in definizioni di collection |
| `rebase_db_generate` | — | Genera file di migrazione SQL a partire dalle modifiche dello schema |
| `rebase_db_migrate` ⚠ | — | Esegue tutte le migrazioni SQL in sospeso |
| `rebase_generate_sdk` | — | Genera l'SDK TypeScript con tipizzazione completa |
| `rebase_doctor` | — | Rileva disallineamenti tra definizioni, schema generato e database attivo |
| `rebase_db_branch_create` ⚠ | `name` | Crea un branch del database (solo amministratori) |
| `rebase_db_branch_list` | — | Elenca i branch del database (solo amministratori) |
| `rebase_db_branch_delete` ⚠ | `name` | Elimina un branch del database (solo amministratori) |
| `rebase_db_branch_info` | `name` | Informazioni e stato del branch (solo amministratori) |
| `rebase_db_branch_switch` | — | Punta questo checkout a un branch, oppure di nuovo al database principale (solo amministratori) |

### Pianificazione dello schema (1)

Interroga il backend per verificare l'effetto di una modifica, tramite `POST /api/admin/schema/plan`. Nessuna
CLI e nessun file scritto su disco — opera sul database di sviluppo gestito,
cosa che i comandi basati su Atlas non possono fare.

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | L'SQL che la modifica a una collection eseguirebbe e quali istruzioni comportano perdita di dati |

### Documenti (5)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `list_documents` | `collection` | Elenca le righe, con parametri opzionali `limit`, `offset`, `orderBy`, `where` |
| `get_document` | `collection`, `id` | Recupera una singola riga tramite ID |
| `create_document` ⚠ | `collection`, `data` | Crea una riga |
| `update_document` ⚠ | `collection`, `id`, `data` | Aggiorna una riga |
| `delete_document` ⚠ | `collection`, `id` | Elimina una riga |

### Utenti e ruoli (6)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `list_users` | — | Elenca tutti gli utenti, compresi i ruoli |
| `create_user` ⚠ | `email` | Crea un utente (`displayName`, `password`, `roles` opzionali) |
| `update_user` ⚠ | `uid` | Aggiorna email, nome visualizzato o ruoli |
| `delete_user` ⚠ | `uid` | Elimina un utente |
| `list_roles` | — | Elenca i ruoli definiti |
| `rebase_auth_reset_password` ⚠ | `email` | Reimposta una password tramite le API di amministrazione |

`create_user` e `update_user` accettano entrambi il parametro `roles`, potendo quindi assegnare permessi di
amministratore. Per questo motivo sono vincolati dal gate anziché essere considerati puramente "additivi".

### Storage (3)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `storage_list_objects` | — | Elenca gli oggetti archiviati |
| `storage_get_download_url` | `key` | Un URL di download firmato temporaneo e la sua scadenza — non i metadati dell'oggetto |
| `storage_delete_object` ⚠ | `key` | Elimina un oggetto |

`storage_get_download_url` è classificato come operazione di lettura poiché non altera
l'ambiente — tuttavia, l'URL firmato generato costituisce una credenziale di tipo bearer la cui validità persiste oltre
la chiamata dello strumento.

### Cron (5)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `cron_list_jobs` | — | Elenca i job pianificati e il loro stato |
| `cron_get_job` | `jobId` | Dettagli del job |
| `cron_get_job_logs` | `jobId` | Log di esecuzione |
| `cron_trigger_job` ⚠ | `jobId` | Esegue un job immediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Abilita o disabilita un job |

`cron_toggle_job` può disattivare silenziosamente un job di backup o di fatturazione — una modifica che
non genera errori né output visibili finché non ci si accorge dell'assenza dei risultati previsti.

### Funzioni (1)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca una [funzione personalizzata](/docs/backend/custom-functions) con qualsiasi metodo e payload |

Questo comando richiama codice mai visto dal server MCP, con un metodo e un payload
scelti dal modello. Il suo raggio di impatto corrisponde a qualsiasi azione eseguibile dalle tue funzioni.

### Dev server (3)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_dev_start` | — | Avvia il dev server; termina immediatamente |
| `rebase_dev_logs` | — | Legge l'output recente (predefinito 50 righe, buffer di 500 righe) |
| `rebase_dev_stop` | — | Arresta il dev server |

### Registro progetti (6)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_project_list` | — | Elenca i progetti registrati e mostra quello attivo |
| `rebase_project_switch` | `name` | Cambia il progetto attivo |
| `rebase_project_add` | `name` | Registra un progetto (`baseUrl`, `projectDir` opzionale, `token`) |
| `rebase_project_remove` | `name` | Rimuove un progetto (il progetto predefinito non può essere rimosso) |
| `rebase_project_current` | — | Mostra il progetto attivo e il suo stato di autenticazione |
| `rebase_project_status` | — | Controlla lo stato di salute (health-check) del backend attivo |

`rebase_project_switch` non è vincolato dal gate, poiché si limita a reindirizzare tutte le altre operazioni
anziché agire direttamente su una destinazione. Un assistente può dunque passare a un
progetto remoto senza attivare il gate — semplicemente non potrà poi eseguirvi strumenti
distruttivi.

## Risorse

Oltre agli strumenti, il server espone risorse MCP per consentire a un client di recuperare il
contesto del progetto senza dover consumare una chiamata a uno strumento:

| URI | Descrizione |
|---|---|
| `rebase://collections/{name}` | Codice sorgente TypeScript della definizione di una collection |
| `rebase://schema` | Lo schema Drizzle generato (`schema.generated.ts`) |

Le collection vengono individuate a partire da `app/config/collections/`,
`config/collections/` o `collections/` all'interno della directory del progetto attivo —
a seconda di quale sia presente.

`rebase://schema` viene elencato **solo se** lo schema generato esiste.
`findBackendDir` cerca `backend/` e successivamente `app/backend/` nella directory del
progetto attivo, leggendo `src/schema.generated.ts` da quello individuato —
funzionando quindi sia con la struttura standard scaffoldata che con quella di questo monorepo; un progetto organizzato in
un terzo modo, o che non abbia ancora eseguito `rebase schema generate`, semplicemente non
vedrà la risorsa tra quelle disponibili.

## L'endpoint remoto

Tutto quanto descritto sopra è uno strumento di sviluppo: viene eseguito sulla tua macchina e fa uso di una service
key o di una chiave API. Un backend distribuito può anche servire MCP in autonomia, all'indirizzo `/mcp`, per
gli utenti della tua applicazione. Un assistente connesso da uno di essi leggerà e
scriverà nel progetto **con l'identità di quell'utente**, e ogni chiamata sarà soggetta alla
Row-Level Security associata all'utente stesso.

La funzionalità è disattivata per impostazione predefinita ed entrambe le variabili sono obbligatorie:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Senza `REBASE_PUBLIC_URL`, un segreto JWT o un driver dati in grado di applicare lo scope di una query
a un singolo utente, l'endpoint rifiuterà di montarsi segnalandone il motivo nel log di avvio. Nessun
`REBASE_ROLE` può forzarne l'abilitazione.

- **OAuth, con schermata di consenso.** Un client individua l'authorization server
  tramite `/.well-known/oauth-protected-resource`, si registra (la registrazione dinamica
  è abilitata per impostazione predefinita; `REBASE_MCP_OPEN_REGISTRATION=false` la limita
  ai soli client registrati manualmente) e indirizza l'utente a una schermata di consenso che ne esegue
  l'accesso tramite l'endpoint `/auth/login` esistente.
- **Sei strumenti, due scope.** `mcp:read` mette a disposizione `list_collections`,
  `query_collection` e `get_document`; `mcp:write` aggiunge `create_document`,
  `update_document` e `delete_document`. Lo scope determina quali strumenti vengono
  offerti, non quali righe: un elenco vuoto può essere il normale risultato dell'RLS, e `mcp:write` non
  potrà comunque scrivere una riga a cui l'utente non ha accesso.
- **Un token riservato esclusivamente a questo endpoint.** Un access token MCP viene rifiutato da
  `/api/data`, `/api/admin` e dal WebSocket; connettere un assistente non equivale quindi
  a fornirgli una sessione utente completa.

Due limitazioni da tenere presenti. La disconnessione di un client (`DELETE /api/oauth/grants/:clientId`, con la
sessione dell'utente) revoca immediatamente i suoi refresh token, ma un access token
già emesso continuerà a funzionare fino alla sua scadenza, entro un'ora. Inoltre, i ruoli assegnati a
una concessione sono quelli posseduti dall'utente al momento del consenso. Una successiva modifica dei ruoli non
si riflette su di essa: un client che continua a rinnovare il token conserverà tali ruoli finché l'utente
non procederà alla disconnessione.

I percorsi sono descritti in [Endpoint](/docs/backend/endpoints/#mcp-surface) e le
variabili in [Configurazione](/docs/getting-started/configuration/#mcp-surface).

## Configurazione consigliata

- Punta il server a un progetto **locale** e lascia `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non impostato. Il gate è la funzionalità di sicurezza più importante del pacchetto.
- Per qualsiasi ambiente remoto, registra una **chiave API `rk_` con scope limitato** anziché consentire
  all'auto-discovery di fornire una service key.
- Esegui `rebase_project_current` se l'output sembra non corrispondere. Il progetto attivo è
  persistente e risiede al di fuori del tuo repository.
- Tratta `~/.rebase/projects.json` come un file contenente segreti riservati.

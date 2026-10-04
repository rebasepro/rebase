---
sourceHash: 1cc4acaed4c60088
title: Server MCP
sidebar_label: Server MCP
description: Connetti Claude Code, Cursor, Gemini CLI o qualsiasi client MCP a un progetto Rebase — i 42 tool esposti, le credenziali con cui si autentica e il loopback gate che si interpone tra un agent e la produzione.
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
credenziali: vedi [L'endpoint remoto](#lendpoint-remoto).

## Connettere un client

Il server viene eseguito dal tuo progetto: `@rebasepro/mcp` è una devDependency che ogni
scaffold di `rebase init` fissa insieme alla CLI, e ogni blocco seguente — l'intera
integrazione — avvia quella copia (`pnpm exec rebase-mcp`, oppure `npx --no rebase-mcp`
in un progetto npm), mai una più recente da npm. Un progetto più vecchio la aggiunge una
volta, con `rebase skills install --mcp` oppure `pnpm add -D @rebasepro/mcp`.

<span class="since-badge" data-since="0.24">Da 0.24</span> `rebase init` scrive il blocco per ciascun agent selezionato quando
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

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` dall'ambiente
2. `REBASE_SERVICE_KEY` letto dal file `.env` del progetto
3. La service key rilevata automaticamente da `.rebase/state.json` mentre `rebase dev`
   è in esecuzione

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

<span class="since-badge" data-since="0.24">Da 0.24</span> Registra una [API key](/docs/backend/api-keys) con ambito limitato e il modello a
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
    // Rimuove la baseline admin/server iniettata — nulla è leggibile
    // tranne quanto consentito dalle regole sottostanti.
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
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Non soggetti a gate — solo locali:** `rebase_schema_introspect`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, i tool del dev-server e i tool del registro dei progetti.
  Questi scrivono file locali o stato locale e non hanno alcuna destinazione remota da verificare.
- **Soggetti a gate rispetto a `DATABASE_URL`:** i restanti tool della CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Soggetti a gate rispetto al `baseUrl` del progetto:** i restanti tool dell'SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Le due destinazioni non sono intercambiabili. I tool della CLI non vedono mai `baseUrl`, quindi un
backend su localhost associato a un `DATABASE_URL` di produzione viene verificato rispetto
al database, non al backend.

Un rifiuto si presenta in questo modo:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se non è possibile risolvere alcuna stringa di connessione, i tool del DB vengono rifiutati** —
una destinazione non verificabile non è considerata sicura:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Solo il loopback è considerato locale: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
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

L'[endpoint remoto](#lendpoint-remoto) racchiude allo stesso modo i risultati dei
suoi tool e lo comunica al client; il suo `structuredContent` trasporta il risultato puro.

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

## Riferimento dei tool

42 tool, suddivisi in nove gruppi: schema e database, pianificazione dello schema,
documenti, utenti e ruoli, storage, cron, funzioni, il dev server e il registro
dei progetti. Ognuno, con ciò che richiede e se il gate lo rifiuta rivolto a una
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

Tutto quanto descritto sopra è uno strumento per sviluppatori: viene eseguito sulla tua macchina e contiene una service
key o un'API key. Un backend distribuito può anche servire direttamente MCP, all'indirizzo `/mcp`, per
gli utenti che utilizzano la tua applicazione. L'assistente collegato da uno di essi legge e
scrive sul progetto **con l'identità di tale utente**, e ogni chiamata viene eseguita nell'ambito della sua
personale sicurezza a livello di riga (row-level security).

La funzionalità è disattivata a meno che non venga abilitata esplicitamente, ed entrambe le variabili sono obbligatorie:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # la reale origine di questo deployment
```

Senza `REBASE_PUBLIC_URL`, un secret JWT o un driver dati in grado di limitare l'ambito di una query
a un singolo utente, l'endpoint si rifiuta di essere montato e ne spiega il motivo nel log di avvio. Nessun
`REBASE_ROLE` è in grado di abilitarlo.

- **OAuth, con schermata di consenso.** Un client individua l'authorization server
  tramite `/.well-known/oauth-protected-resource`, si registra (la registrazione dinamica
  è attiva per impostazione predefinita; `REBASE_MCP_OPEN_REGISTRATION=false` la limita
  ai client registrati manualmente) e reindirizza la persona a una schermata di consenso che ne esegue
  l'accesso tramite il tuo `/auth/login` esistente.
- <span class="since-badge" data-since="0.24">Da 0.24</span> **Sette tool, tre scope.** Gli stessi [scope](/docs/backend/roles-and-scopes/)
  usati da ogni credenziale. `data:read` offre `list_collections`,
  `query_collection`, `count_documents` e `get_document`; `data:write` aggiunge `create_document` e
  `update_document`; `data:delete` aggiunge `delete_document`. Un client che non chiede
  nulla riceve `data:read`. Ognuno si restringe a una collection: `data:read:posts`
  elenca e legge `posts` e nient'altro. Uno scope determina quali tool vengono
  offerti e quali collection raggiungono, non quali righe: un elenco vuoto può essere il normale
  funzionamento dell'RLS, e `data:write` continua a non poter scrivere una riga che la persona non potrebbe scrivere.
- **Le autorizzazioni concesse prima della 0.24 mantengono la loro portata.** `mcp:read` viene letto come
  `data:read`, e `mcp:write` come `data:write data:delete`, sulle autorizzazioni memorizzate e
  sui token già emessi.
- <span class="since-badge" data-since="0.24">Da 0.24</span> **Funziona anche una API key.** `/mcp` accetta anche `Authorization: Bearer rk_…`, per
  un client configurato con un header anziché con un flusso OAuth. La chiave raggiunge
  i tool coperti dai suoi scope `data:*`, con l'identità con cui agisce: una
  [chiave personale](/docs/backend/api-keys/#personal-keys) come il suo proprietario, una service key
  come `api-key:<id>`.
- **Il vocabolario dell'SDK, le risposte di REST.** I tool accettano ciò che
  accetta l'SDK — `where` (`{"status": ["==", "paid"]}`), `orderBy`
  (`["created_at", "desc"]` oppure `"created_at:desc"`), `limit`, `offset`,
  `searchString`, e `data` per una scrittura — e leggono attraverso il percorso
  di `GET /api/data/<collection>`, quindi una riga torna come la serve REST
  (date ISO, un `belongsTo` come la sua chiave esterna, ad es. `authorId`) e
  può essere rinviata in un aggiornamento senza modifiche. `query_collection`
  risponde `{ data, meta }` con `meta.total` e `meta.hasMore`,
  `count_documents` risponde `{ count }`, e `list_collections` risponde con
  gli schemi OpenAPI `row` e `create` di ciascuna collection, più
  `softDeleteField` per indicare dove le righe vanno nel cestino. Come su
  REST, un `limit` superiore a 1000, un argomento non dichiarato e una
  modifica o eliminazione di una riga nel cestino (404) vengono rifiutati;
  impostare il campo di soft-delete a `null` la ripristina.
- **Un token valido solo per questo endpoint.** Un token di accesso MCP viene rifiutato da
  `/api/data`, `/api/admin` e dai WebSocket, quindi connettere un assistente non
  equivale a fornirgli una sessione generale.

Una limitazione. La disconnessione di un client (`DELETE /api/oauth/grants/:clientId`, con la
sessione propria dell'utente) revoca immediatamente i relativi refresh token, ma un token di accesso
già emesso continua a funzionare fino alla sua scadenza, entro un'ora. Lo stesso intervallo di un'ora
delimita tutto il resto: a ogni refresh vengono riletti i ruoli dell'utente, rifiutando
un account eliminato o un'autorizzazione antecedente all'ultimo "disconnetti ovunque"
o cambio password. Pertanto, un declassamento di privilegi o una disconnessione si riflette su un client connesso
entro il ciclo di vita di un singolo token di accesso. Una sessione ospite (guest) non può concedere alcun consenso.

Le route sono documentate in [Endpoint](/docs/backend/endpoints/#mcp-surface) e le
variabili in [Configurazione](/docs/getting-started/configuration/#mcp-surface).

## Configurazione consigliata

- Punta il server a un progetto **locale** e lascia `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non impostato. Il gate è l'elemento di maggior valore dell'intero pacchetto.
- Per qualsiasi elemento remoto, registra una **chiave API `rk_` con restrizioni** anziché lasciare che
  l'auto-discovery fornisca una service key.
- Esegui `rebase_project_current` se l'output sembra errato. Il progetto attivo è
  persistente e risiede al di fuori del tuo repository.
- Considera `~/.rebase/projects.json` come un file contenente segreti riservati.

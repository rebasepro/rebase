---
sourceHash: dcb903c511617dd5
title: Server MCP
sidebar_label: Server MCP
description: Connetti Claude Code, Cursor, Gemini CLI o qualsiasi client MCP a un progetto Rebase — i 42 strumenti che espone, le credenziali con cui si autentica e il gate di loopback posto tra un agente e la produzione.
---

`@rebasepro/mcp` è un server [Model Context Protocol](https://modelcontextprotocol.io)
che fornisce a un assistente AI strumenti reali per interagire con un progetto Rebase: leggere e
scrivere righe, gestire utenti, eseguire migrazioni, invocare funzioni e controllare il
server di sviluppo.

Comunica tramite MCP **esclusivamente su stdio**. Non esiste alcuna porta né listener: il
processo è affidabile esattamente quanto ciò che lo ha generato e non vi è alcun
chiamante remoto da autenticare. Questa è la parte sicura. Le questioni interessanti riguardano
tutte ciò che fa *una volta* avviato, e questa pagina risponde a tali domande prima di
mostrare il blocco di configurazione.

## Connessione di un client

Il server è pubblicato su npm e non richiede installazione: `npx` lo scarica.
Ogni blocco qui sotto è l'intera integrazione.

**Claude Code** — `.mcp.json` nella radice del progetto. `rebase init` scrive questo file al posto tuo:

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

**Cursor** — la stessa forma, in `.cursor/mcp.json`:

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

**Codex CLI** — TOML invece di JSON, in `~/.codex/config.toml`. È a livello utente, non per progetto, quindi indica qui la directory del progetto:

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

Funziona qualsiasi client MCP in grado di avviare un server stdio; la forma è sempre la stessa.

### Su quale directory agisce

`REBASE_PROJECT_DIR` è la directory che contiene `rebase.json`. C'è **una** sola
precedenza, ed è la stessa in ogni client:

1. **Il blocco di ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se una di esse è impostata, il progetto `default` viene
   ricostruito da esse a ogni avvio.
2. **La directory di lavoro del server**, quando contiene un `rebase.json`. Un
   progetto in cui ti trovi ha la precedenza su qualsiasi cosa sia memorizzata in
   `~/.rebase/projects.json`.
3. **Il `default` persistito** in `~/.rebase/projects.json`, quando nessuno dei
   primi due dice qualcosa.

Il rilevamento automatico da `.rebase/state.json` riempie i vuoti in tutti e tre
i casi e non sovrascrive mai un valore fornito da uno di essi.

I blocchi a livello di progetto impostano `REBASE_PROJECT_DIR` a `"."` — la
directory di lavoro del client è il progetto — perché la regola 3 legge un file
condiviso da tutti i progetti della macchina. Il blocco Codex è a livello utente
anziché per progetto, quindi indica un percorso assoluto.

## Cosa può raggiungere il server

Questa è la sezione da leggere prima di puntare un assistente verso un database a cui
tieni.

Il server gestisce **una sola credenziale di ambiente per l'intero processo**. Non esiste
un'identità specifica per singolo strumento né una modalità di sola lettura; ogni strumento utilizza lo stesso token, e
l'unico flag presente nel pacchetto serve ad *ampliare* l'accesso anziché limitarlo.

Quale credenziale viene utilizzata, in ordine di priorità:

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` dall'ambiente
2. `REBASE_SERVICE_KEY` letta dal file `.env` del progetto
3. La chiave di servizio (service key) rilevata automaticamente da `.rebase/state.json` mentre `rebase dev`
   è in esecuzione

Un token registrato manualmente per un progetto **ha la priorità sul rilevamento automatico**. Il discovery
serve solo a colmare le mancanze.

:::danger[Il percorso a configurazione zero usa una credenziale da amministratore]
Le opzioni 2 e 3 utilizzano la **service key** — un segreto di amministrazione privo di restrizioni di ambito (unscoped). Il backend
la risolve in `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Tale
identità salta completamente l'elenco dei permessi della chiave API e soddisfa le
policy `_default_admin_read` / `_default_admin_write` che Rebase inietta in
ogni collezione che non abbia impostato `disableDefaultPolicies`.

Quindi, la risposta onesta alla domanda "l'RLS pone ancora dei vincoli?" è: l'RLS *viene eseguito* — il
driver esegue il downgrade al ruolo `rebase_user` — e successivamente una policy scritta da Rebase
stesso concede a quell'identità accesso completo. La lettura di ogni riga di ogni
collezione è il **comportamento previsto della configurazione predefinita**, non un
bypass di sicurezza.

Con la configurazione zero-config, un agente che dispone di questi strumenti può leggere e scrivere ogni
riga di ogni collezione, elencare tutti gli utenti, reimpostare qualsiasi password, invocare qualsiasi
funzione di backend ed eseguire DDL su qualsiasi `DATABASE_URL` a cui il progetto fa riferimento.
:::

### Assegnare una credenziale con ambito ristretto

Registrando una [chiave API](/docs/backend/api-keys) con ambito ristretto (scoped), il modello a
doppio gate viene applicato realmente. Una chiave non-admin viene eseguita con i ruoli `["service"]`, che le
policy di amministrazione predefinite iniettate **non** includono: di conseguenza, l'RLS non le concede nulla a meno che una delle
tue policy non specifichi diversamente, e l'elenco dei permessi la restringe ulteriormente:

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Assegna quindi la chiave `rk_live_…` risultante al server invece di lasciare che
rilevi automaticamente una chiave di servizio:

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

Due aspetti che questo approccio **non** copre, entrambi importanti da conoscere prima di farvi affidamento:

- **Non limita gli strumenti CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e gli strumenti di branch avviano la CLI di Rebase, che si connette tramite
  `DATABASE_URL` e non vede mai il tuo token. Il gate di loopback descritto sotto è l'unica
  protezione posta davanti a questi comandi.
- **Una chiave non-admin non può utilizzare gli strumenti di amministrazione.** `list_users`, `create_user`,
  `update_user`, `delete_user`, `list_roles` e `rebase_auth_reset_password`
  sono protetti da `requireAdmin` e falliranno con una chiave con ambito limitato. Questo è il
  comportamento corretto del sistema, ma implica dover scegliere tra ampiezza di accesso e restrizione dei permessi
  invece di poter disporre di entrambi contemporaneamente.

Una chiave API con `admin: true` è diversa: include i ruoli
`["admin", "service"]`, soddisfacendo le stesse policy admin predefinite della
chiave di servizio. Sul piano dei dati, la sua portata è identica a quella della chiave di servizio. Il vantaggio aggiuntivo è
che risulta **revocabile, con scadenza e soggetta a rate limiting per singola chiave**, nessuna delle quali
caratteristiche si applica alla chiave di servizio — ruotare quest'ultima richiede infatti la modifica di `.env` e il riavvio del server.

Consulta [Agenti e Server MCP](/docs/backend/api-keys#agents-and-mcp-servers) per la
guida completa sulla definizione degli ambiti delle chiavi.

### Rendere una collezione del tutto inaccessibile

Il motivo per cui una credenziale di amministrazione può leggere tutto è la policy di base che Rebase
inietta in ogni collezione, concedendo l'accesso al contesto del server fidato e al
ruolo `admin`. Una collezione può disattivare questa base predefinita e assumere la piena
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

Ora l'unico modo per accedere è verificare la corrispondenza con `patient_id`. Lo uid della chiave di servizio è la
stringa letterale `service`, quindi una regola basata sul proprietario (owner) non corrisponderà mai — le letture restituiranno zero
righe e le scritture verranno rifiutate da Postgres. Questo è l'unico meccanismo di controllo che vincola
la credenziale predefinita del server MCP invece di ignorarla.

Ricorda che si tratta di una modifica RLS effettiva a livello di database, non solo documentale: diventa effettiva
solo dopo che `rebase schema generate` e una migrazione avranno applicato le policy. Consulta
[Regole di sicurezza (RLS)](/docs/collections/security-rules).

## Il gate di loopback

`rebase_project_add` accetta qualsiasi `baseUrl`, e gli strumenti CLI si connettono con
qualsiasi `DATABASE_URL` dichiarato dal progetto. Lo stesso elenco di strumenti che modifica un
database temporaneo di sviluppo sul tuo computer portatile può quindi eliminare righe di produzione, senza nulla
frapposto se non la valutazione dell'assistente su quale progetto sia attivo.

**Ogni strumento che modifica l'ambiente di destinazione viene rifiutato a meno che tale destinazione non si
trovi sull'interfaccia di loopback.** Il gate è strutturato come un elenco di ciò che *non* è
sottoposto a restrizione; pertanto, qualsiasi strumento aggiunto successivamente sarà protetto per impostazione predefinita.

- **Non soggetti a restrizioni — letture:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Non soggetti a restrizioni — solo locali:** `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, gli strumenti del server di sviluppo e gli strumenti del registro dei progetti.
  Questi scrivono file locali o stato locale e non hanno alcuna destinazione remota da verificare.
- **Soggetti a verifica su `DATABASE_URL`:** i restanti strumenti CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Soggetti a verifica su `baseUrl` del progetto:** i restanti strumenti SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Le due destinazioni non sono intercambiabili. Gli strumenti CLI non leggono mai `baseUrl`, quindi un
backend su localhost affiancato a un `DATABASE_URL` di produzione viene verificato rispetto
al database, non al backend.

Un rifiuto si presenta così:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se non è possibile risolvere alcuna stringa di connessione, gli strumenti DB vengono rifiutati** —
un target non verificabile non è considerato sicuro:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Solo il loopback viene considerato locale: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Gli intervalli privati come `10.x` e `192.168.x` **non** lo sono: è altrettanto probabile che appartengano a
un cluster di staging condiviso quanto a un portatile, e trattarli come locali lascerebbe passare
esattamente l'errore accidentale che il gate è stato progettato per prevenire.

Imposta `REBASE_MCP_ALLOW_REMOTE_WRITES=true` per disattivare questa protezione. Impostarlo a livello globale nella
configurazione del client MCP rimuove il gate per ogni progetto a cui il server può accedere,
non solo per quello a cui stavi pensando.

## Contrassegno dei dati non attendibili

Righe, record utente, elenchi di storage, job cron, risposte di funzioni e output della
CLI vengono restituiti racchiusi in un wrapper esplicito:

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Qualsiasi elemento archiviato nel database è stato scritto da qualcuno e arriva
sullo stesso canale del contratto degli strumenti seguito dall'assistente. L'involucro (envelope) indica
al modello di trattarlo come contenuto inerte anziché come istruzioni.

Si tratta di un marcatore, non di una sandbox. Un assistente dotato di questi strumenti è sicuro solo
quanto il contenuto che gli consenti di leggere.

## Progetti multipli

Le configurazioni dei progetti sono memorizzate in `~/.rebase/projects.json` e il server
può gestirne diversi contemporaneamente — utile quando si lavora tra ambienti
locali e remoti. Mentre `rebase dev` è in esecuzione, il server legge la porta attiva e la
chiave di servizio da `.rebase/state.json` nella directory del progetto, rendendo il caso
locale completamente a configurazione zero.

:::note[Il registro è l'ultima parola, non la prima]
Vale la precedenza qui sopra: blocco di ambiente, poi la directory di lavoro
quando contiene un `rebase.json`, poi il `default` persistito.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` ricostruiscono il
progetto `default` **a ogni avvio**, non solo al primo. La ricostruzione riguarda
l'intera voce: un token registrato per il vecchio `projectDir` viene scartato
anziché essere trasferito in una directory per cui non era mai stato emesso. Un
`default` derivato così — o dalla directory di lavoro — non viene mai riscritto
in `~/.rebase/projects.json`, perché la chiave di servizio di sviluppo di un
progetto non diventi quella di un altro.

`activeProject` è persistente: se una sessione precedente ha chiamato
`rebase_project_switch`, gli strumenti fanno riferimento a quel progetto e il
server lo segnala su stderr — a meno che quel progetto sia registrato sotto una
directory *diversa* da quella in cui gira questo server, nel qual caso torna a
`default` e lo dice. Se un assistente sembra leggere il database sbagliato,
esegui prima `rebase_project_current`.
:::

I token vengono memorizzati in tale registro **in chiaro**. Si tratta di un file nella tua
home directory contenente credenziali di amministrazione per ogni progetto registrato;
trattalo con la dovuta cautela.

## Riferimento degli strumenti

42 strumenti, suddivisi in nove gruppi. Gli strumenti contrassegnati con ⚠ vengono rifiutati su destinazioni non locali, a meno che non si scelga esplicitamente di consentirli.

### Schema e database (12)

Avviano la CLI di Rebase nella directory del progetto attivo.

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `rebase_schema_generate` | — | Genera lo schema Drizzle dalle definizioni delle collezioni |
| `rebase_db_push` ⚠ | — | Applica lo schema direttamente al database (scorciatoia di sviluppo) |
| `rebase_schema_introspect` | — | Esegue l'introspezione del database attivo nelle definizioni delle collezioni |
| `rebase_db_generate` | — | Genera file di migrazione SQL dalle modifiche allo schema |
| `rebase_db_migrate` ⚠ | — | Esegue tutte le migrazioni SQL in sospeso |
| `rebase_generate_sdk` | — | Genera l'SDK TypeScript completamente tipizzato |
| `rebase_doctor` | — | Rileva disallineamenti tra definizioni, schema generato e database attivo |
| `rebase_db_branch_create` ⚠ | `name` | Crea un branch del database (solo amministratori) |
| `rebase_db_branch_list` | — | Elenca i branch del database (solo amministratori) |
| `rebase_db_branch_delete` ⚠ | `name` | Elimina un branch del database (solo amministratori) |
| `rebase_db_branch_info` | `name` | Informazioni e stato del branch (solo amministratori) |
| `rebase_db_branch_switch` | — | Punta questo checkout a un branch, o di nuovo al database principale (solo amministratori) |

### Pianificazione dello schema (1)

Chiede al backend che cosa farebbe una modifica, tramite `POST /api/admin/schema/plan`.
Nessuna CLI e nulla scritto su disco: funziona sul database di sviluppo gestito,
dove i comandi basati su Atlas non possono.

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | L'SQL che eseguirebbe la modifica di una collection, e quali statement distruggono dati |

### Documenti (5)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `list_documents` | `collection` | Elenca le righe, con `limit`, `offset`, `orderBy`, `where` opzionali |
| `get_document` | `collection`, `id` | Recupera una singola riga tramite ID |
| `create_document` ⚠ | `collection`, `data` | Crea una riga |
| `update_document` ⚠ | `collection`, `id`, `data` | Aggiorna una riga |
| `delete_document` ⚠ | `collection`, `id` | Elimina una riga |

### Utenti e ruoli (6)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `list_users` | — | Elenca tutti gli utenti, inclusi i ruoli |
| `create_user` ⚠ | `email` | Crea un utente (`displayName`, `password`, `roles` opzionali) |
| `update_user` ⚠ | `uid` | Aggiorna email, nome visualizzato o ruoli |
| `delete_user` ⚠ | `uid` | Elimina un utente |
| `list_roles` | — | Elenca i ruoli definiti |
| `rebase_auth_reset_password` ⚠ | `email` | Reimposta una password tramite l'API di amministrazione |

Sia `create_user` che `update_user` accettano `roles`, quindi entrambi possono creare un utente
amministratore. Per questo motivo sono soggetti a restrizioni anziché essere considerati puramente "additivi".

### Storage (3)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `storage_list_objects` | — | Elenca gli oggetti archiviati |
| `storage_get_download_url` | `key` | Un URL di download firmato temporaneo e la sua scadenza — non i metadati dell'oggetto |
| `storage_delete_object` ⚠ | `key` | Elimina un oggetto |

`storage_get_download_url` è classificato come lettura perché non modifica
l'ambiente, ma l'URL firmato generato è una capability al portatore che sopravvive
alla chiamata dello strumento.

### Cron (5)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `cron_list_jobs` | — | Elenca i job pianificati e il loro stato |
| `cron_get_job` | `jobId` | Dettagli del job |
| `cron_get_job_logs` | `jobId` | Log di esecuzione |
| `cron_trigger_job` ⚠ | `jobId` | Esegue un job immediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Abilita o disabilita un job |

`cron_toggle_job` può disabilitare silenziosamente un backup o un job di fatturazione — una modifica
senza errori e senza output finché qualcosa non risulterà mancante in seguito.

### Funzioni (1)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca una [funzione personalizzata](/docs/backend/custom-functions) con qualsiasi metodo e payload |

Questo comando esegue codice che il server MCP non ha mai visto, con un metodo e un body scelti
dal modello. Il suo raggio d'impatto dipende interamente da ciò che fanno le tue funzioni.

### Server di sviluppo (3)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `rebase_dev_start` | — | Avvia il server di sviluppo; ritorna immediatamente |
| `rebase_dev_logs` | — | Legge l'output recente (predefinito 50 righe, buffer di 500 righe) |
| `rebase_dev_stop` | — | Ferma il server di sviluppo |

### Registro dei progetti (6)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `rebase_project_list` | — | Elenca i progetti registrati e mostra quello attivo |
| `rebase_project_switch` | `name` | Cambia il progetto attivo |
| `rebase_project_add` | `name` | Registra un progetto (`baseUrl`, `projectDir` e `token` opzionali) |
| `rebase_project_remove` | `name` | Rimuove un progetto (il progetto predefinito non può essere rimosso) |
| `rebase_project_current` | — | Mostra il progetto attivo e il relativo stato di autenticazione |
| `rebase_project_status` | — | Verifica lo stato di integrità (health check) del backend attivo |

`rebase_project_switch` non è soggetto a restrizioni di loopback, perché cambia la destinazione
di tutto il resto anziché agire direttamente su un target. Un assistente può quindi passare a un
progetto remoto senza attivare il blocco del gate — semplicemente non potrà poi eseguire uno strumento
distruttivo su di esso.

## Risorse

Oltre agli strumenti, il server espone risorse MCP in modo che un client possa recuperare il
contesto del progetto senza dover consumare una chiamata a uno strumento:

| URI | Descrizione |
|---|---|
| `rebase://collections/{name}` | Codice sorgente TypeScript della definizione di una collezione |
| `rebase://schema` | Lo schema Drizzle generato (`schema.generated.ts`) |

Le collezioni vengono rilevate da `app/config/collections/`,
`config/collections/` o `collections/` all'interno della directory del progetto attivo —
a seconda di quale sia presente.

`rebase://schema` viene elencata **solo se** lo schema generato esiste.
`findBackendDir` cerca `backend/` e poi `app/backend/` nella directory del
progetto attivo e legge `src/schema.generated.ts` da quella che trova: funzionano
quindi sia il layout generato dallo scaffold sia quello di questo monorepo. Un
progetto organizzato in un terzo modo, o che non ha ancora eseguito
`rebase schema generate`, semplicemente non vedrà la risorsa offerta.

## Configurazione consigliata

- Punta il server a un progetto **locale** e lascia `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non impostata. Il gate è l'elemento di maggior valore dell'intero pacchetto.
- Per qualsiasi ambiente remoto, registra una **chiave API `rk_` con ambito limitato** anziché
  consentire al discovery di fornire una chiave di servizio.
- Controlla `rebase_project_current` quando l'output sembra errato. Il progetto attivo è
  persistente e risiede al di fuori del tuo repository.
- Tratta `~/.rebase/projects.json` come un file di segreti.

---

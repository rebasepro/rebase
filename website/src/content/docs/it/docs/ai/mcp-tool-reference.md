---
sourceHash: c7ba0e6c6150d210
title: Riferimento strumenti MCP
sidebar_label: Riferimento strumenti MCP
description: Tutti gli strumenti registrati dal server MCP di Rebase, raggruppati — requisiti, funzionalità e quali vengono rifiutati dal loopback gate nei confronti di un progetto non locale.
---

Gli strumenti che [`@rebasepro/mcp`](/docs/ai/mcp) offre a un assistente. Il modo in cui si connette, le credenziali in suo possesso e come il [loopback gate](/docs/ai/mcp#the-loopback-gate) determina il significato di ⚠ sono descritti nella pagina del [server MCP](/docs/ai/mcp).

53 strumenti, suddivisi in dieci gruppi. Gli strumenti contrassegnati con ⚠ vengono rifiutati sui target non locali, a meno che non si scelga esplicitamente di disattivare il blocco.

## Schema e database (13)

Esegue la CLI di Rebase nella directory del progetto attivo.

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_schema_generate` | — | Genera lo schema Drizzle dalle definizioni delle collezioni |
| `rebase_db_push` ⚠ | — | Applica lo schema direttamente al database (scorciatoia per lo sviluppo) |
| `rebase_schema_introspect` | — | Esegue l'introspezione del database attivo nelle definizioni delle collezioni |
| `rebase_db_generate` | — | Genera i file di migrazione SQL dalle modifiche allo schema |
| `rebase_db_migrate` ⚠ | — | Esegue tutte le migrazioni SQL in sospeso |
| `rebase_generate_sdk` | — | Genera l'SDK TypeScript con tipizzazione completa |
| `rebase_doctor` | — | Rileva disallineamenti (drift) tra definizioni, schema generato e database attivo |
| `rebase_db_branch_create` ⚠ | `name` | Crea un branch del database (solo amministratori) |
| `rebase_db_branch_list` | — | Elenca i branch del database (solo amministratori) |
| `rebase_db_branch_delete` ⚠ | `name` | Elimina un branch del database (solo amministratori) |
| `rebase_db_branch_info` | `name` | Informazioni e stato del branch (solo amministratori) |
| `rebase_db_branch_diff` | `name` | Modifiche apportate da un branch rispetto al database di origine — schema, policy e righe, con conflitti; non modifica nessuno dei due (solo amministratori) |
| `rebase_db_branch_switch` | — | Punta questo checkout a un branch o di nuovo al database principale (solo amministratori) |

## Pianificazione dello schema (1)

Chiede al backend l'effetto di una modifica tramite `POST /api/admin/schema/plan`. Nessuna CLI e nulla viene scritto su disco: opera sul database di sviluppo gestito, cosa che i comandi basati su Atlas non possono fare.

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | L'SQL che verrebbe eseguito dalla modifica di una collezione e quali istruzioni distruggono dati |

## Documenti (5)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `list_documents` | `collection` | Elenca le righe, con `limit`, `offset`, `orderBy`, `where` opzionali |
| `get_document` | `collection`, `id` | Recupera una singola riga tramite ID |
| `create_document` ⚠ | `collection`, `data` | Crea una riga |
| `update_document` ⚠ | `collection`, `id`, `data` | Aggiorna una riga |
| `delete_document` ⚠ | `collection`, `id` | Elimina una riga |

## Utenti e ruoli (6)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `list_users` | — | Elenca tutti gli utenti, inclusi i ruoli |
| `create_user` ⚠ | `email` | Crea un utente (`displayName`, `password`, `roles` opzionali) |
| `update_user` ⚠ | `uid` | Aggiorna email, nome visualizzato o ruoli |
| `delete_user` ⚠ | `uid` | Elimina un utente |
| `list_roles` | — | Elenca i ruoli definiti |
| `rebase_auth_reset_password` ⚠ | `email` | Reimposta una password tramite l'API di amministrazione |

`create_user` e `update_user` accettano entrambi `roles`, quindi possono entrambi creare un amministratore. Per questo motivo sono protetti da gate anziché essere considerati semplicemente "additivi".

## Storage (3)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `storage_list_objects` | — | Elenca gli oggetti archiviati |
| `storage_get_download_url` | `key` | Un URL di download firmato temporaneo e la sua scadenza — non i metadati dell'oggetto |
| `storage_delete_object` ⚠ | `key` | Elimina un oggetto |

`storage_get_download_url` è classificato come lettura perché non modifica l'ambiente, ma l'URL firmato generato è una bearer capability che sopravvive alla chiamata dello strumento.

## Cron (5)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `cron_list_jobs` | — | Elenca i job pianificati e il loro stato |
| `cron_get_job` | `jobId` | Dettagli del job |
| `cron_get_job_logs` | `jobId` | Log di esecuzione |
| `cron_trigger_job` ⚠ | `jobId` | Esegue immediatamente un job |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Abilita o disabilita un job |

`cron_toggle_job` può disattivare silenziosamente un backup o un job di fatturazione: una modifica senza errori né output finché in seguito non viene a mancare qualcosa.

## Funzioni (1)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca una [funzione personalizzata](/docs/backend/custom-functions) con qualsiasi metodo e payload |

Questo chiama codice che il server MCP non ha mai visto, con un metodo e un body scelti dal modello. Il suo raggio di impatto corrisponde a qualunque azione compiano le tue funzioni.

## Server di sviluppo (3)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_dev_start` | — | Avvia il server di sviluppo; restituisce immediatamente il controllo |
| `rebase_dev_logs` | — | Legge l'output recente (predefinito: 50 righe, buffer di 500 righe) |
| `rebase_dev_stop` | — | Arresta il server di sviluppo |

## Registro dei progetti (7)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_project_list` | — | Elenca i progetti registrati e mostra quello attivo |
| `rebase_project_switch` | `name` | Cambia il progetto attivo |
| `rebase_project_add` | `name` | Registra un progetto (`projectDir`, `baseUrl`, `token` opzionali) |
| `rebase_project_remove` | `name` | Rimuove un progetto (il progetto predefinito non può essere rimosso) |
| `rebase_project_current` | — | Mostra il progetto attivo e il relativo stato di autenticazione |
| `rebase_project_status` | — | Esegue il controllo dello stato di integrità (health check) del backend attivo |
| `rebase_project_use_cloud` | `project` | Imposta come target un progetto Rebase Cloud dell'account connesso per ID, slug o nome, tramite il proxy Studio della console |

`rebase_project_switch` non è protetto da gate, perché reindirizza tutto il resto anziché agire direttamente su un target. Un assistente può quindi passare a un progetto remoto senza attivare il gate, semplicemente non potrà poi eseguirvi strumenti distruttivi. `rebase_project_use_cloud` è lo stesso tipo di switch: indirizza gli strumenti per i dati e l'amministrazione a un progetto di produzione, in cui le letture funzionano e il gate rifiuta le scritture.

## Rebase Cloud (9)

Esegue `rebase cloud … --json` nella directory del progetto attivo, sul progetto a cui è collegata, utilizzando le credenziali proprie della CLI. Consulta [Rebase Cloud](/docs/ai/mcp#rebase-cloud) per scoprire su cosa agiscono e perché nessuno di essi è protetto da gate.

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_cloud_provision` | — | Un backend attivo senza account (`rebase cloud init --claim`): l'URL attivo, l'URL di amministrazione e un URL di claim (`name`, `deploy`) |
| `rebase_cloud_status` | — | URL, stato, ultimo deploy, runtime, database, storage e URL di claim (se non ancora reclamato) del progetto collegato |
| `rebase_cloud_deploy` | — | Esegue il deploy e lo segue fino al termine (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Uno snapshot del log di runtime o dell'ultimo log di compilazione (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Non segue mai in streaming |
| `rebase_cloud_env_list` | — | Chiavi delle variabili, mai i valori (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Imposta una variabile; il valore viene passato tramite stdin e non viene mai restituito (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Deployment recenti e quelli verso cui è possibile eseguire il rollback (`limit`) |
| `rebase_cloud_projects_list` | — | Tutti i progetti a cui l'account connesso può accedere, in tutte le sue organizzazioni |
| `rebase_cloud_rollback` | — | Rimette in servizio un precedente deployment riuscito (`deploymentId`) |

`rebase_cloud_provision` crea un progetto e collega questa directory. Non legge mai il `baseUrl` del progetto attivo, quindi il gate non lo controlla; la CLI lo rifiuta in una directory già collegata.

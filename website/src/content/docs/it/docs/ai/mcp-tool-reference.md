---
sourceHash: 42fbd65cd7d89699
title: Riferimento degli strumenti MCP
sidebar_label: Riferimento degli strumenti MCP
description: Tutti gli strumenti registrati dal server MCP di Rebase, raggruppati per categoria — cosa richiede e cosa fa ciascuno, e quali il loopback gate rifiuta nei confronti di un progetto non locale.
---

Gli strumenti che [`@rebasepro/mcp`](/docs/ai/mcp) offre a un assistente. Il modo in cui si connette, quali credenziali possiede e come il [loopback gate](/docs/ai/mcp#the-loopback-gate) stabilisce cosa significhi ⚠ sono descritti nella pagina del [server MCP](/docs/ai/mcp).

53 strumenti, suddivisi in dieci gruppi. Gli strumenti contrassegnati con ⚠ vengono rifiutati sui target non locali a meno che non si scelga di disattivare la protezione.

Ogni strumento al di fuori del gruppo del registro dei progetti, di `rebase_cloud_projects_list`, `rebase_cloud_provision` e `rebase_dev_logs` accetta anche un parametro opzionale `project` (un nome registrato, oppure uno slug o id Cloud), verificato rispetto al collegamento Cloud della directory di sessione prima dell'esecuzione. Consulta [Su quale progetto agisce una chiamata](/docs/ai/mcp#which-project-a-call-acts-on).

## Schema e database (13)

Esegue la CLI di Rebase nella directory del progetto attivo.

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_schema_generate` | — | Genera lo schema Drizzle dalle tabelle in `backend/schema` |
| `rebase_db_push` ⚠ | — | Applica lo schema direttamente al database (scorciatoia per lo sviluppo) |
| `rebase_schema_introspect` | — | Scrive un `defineTable` in `backend/schema` per ciascuna tabella presente nel database attivo |
| `rebase_db_generate` | — | Genera file di migrazione SQL a partire dalle modifiche dello schema |
| `rebase_db_migrate` ⚠ | — | Esegue tutte le migrazioni SQL in sospeso |
| `rebase_generate_sdk` | — | Genera l'SDK TypeScript completamente tipizzato |
| `rebase_doctor` | — | Rileva il disallineamento (drift) tra le tabelle in `backend/schema`, lo schema generato e il database attivo |
| `rebase_db_branch_create` ⚠ | `name` | Crea un branch del database (solo amministratori) |
| `rebase_db_branch_list` | — | Elenca i branch del database (solo amministratori) |
| `rebase_db_branch_delete` ⚠ | `name` | Elimina un branch del database (solo amministratori) |
| `rebase_db_branch_info` | `name` | Informazioni e stato del branch (solo amministratori) |
| `rebase_db_branch_diff` | `name` | Cosa ha modificato un branch rispetto al database da cui è stato creato — schema, policy e righe, con conflitti; non modifica nessuno dei due (solo amministratori) |
| `rebase_db_branch_switch` | — | Punta questo checkout a un branch o torna al database principale (solo amministratori) |

## Pianificazione dello schema (1)

Chiede al backend cosa comporterebbe una modifica tramite
`POST /api/admin/schema/plan`. Non richiede un processo CLI e non scrive nulla
su disco. Funziona anche sul database di sviluppo gestito.

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_schema_plan` | `patches` | L'SQL che un elenco di modifiche `TablePatch` eseguirebbe e quali istruzioni distruggono dati — vedi [Modifica live dello schema](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Righe (5)

Gli stessi nomi usati dall'endpoint `/mcp` remoto; in precedenza erano `list_documents`, `get_document`, `create_document`, `update_document` e `delete_document`, con un argomento `collection`.

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `query_table` | `table` | Legge righe, con `limit`, `offset`, `orderBy`, `where` opzionali, come fa `data.table(name).find()` |
| `get_row` | `table`, `id` | Recupera una singola riga tramite ID |
| `create_row` ⚠ | `table`, `data` | Crea una riga |
| `update_row` ⚠ | `table`, `id`, `data` | Aggiorna una riga; vengono modificate solo le colonne specificate |
| `delete_row` ⚠ | `table`, `id` | Elimina una riga |

## Utenti e ruoli (6)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `list_users` | — | Elenca tutti gli utenti, inclusi i ruoli |
| `create_user` ⚠ | `email` | Crea un utente (`displayName`, `password`, `roles` opzionali) |
| `update_user` ⚠ | `uid` | Aggiorna email, nome visualizzato o ruoli |
| `delete_user` ⚠ | `uid` | Elimina un utente |
| `list_roles` | — | Elenca i ruoli definiti |
| `rebase_auth_reset_password` ⚠ | `email` | Reimposta una password tramite l'API admin |

Sia `create_user` che `update_user` accettano `roles`, quindi entrambi possono creare un utente amministratore. È per questo che sono controllati tramite gate invece di essere considerati semplicemente "additivi".

## Storage (3)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `storage_list_objects` | — | Elenca gli oggetti archiviati |
| `storage_get_download_url` | `key` | Un URL di download firmato temporaneo e la sua scadenza — non i metadati dell'oggetto |
| `storage_delete_object` ⚠ | `key` | Elimina un oggetto |

`storage_get_download_url` è classificato come lettura poiché non modifica l'ambiente — ma l'URL firmato che genera è una capacità al portatore (bearer capability) che sopravvive alla chiamata dello strumento.

## Cron (5)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `cron_list_jobs` | — | Elenca i job pianificati e il loro stato |
| `cron_get_job` | `jobId` | Dettagli del job |
| `cron_get_job_logs` | `jobId` | Log di esecuzione |
| `cron_trigger_job` ⚠ | `jobId` | Esegue immediatamente un job |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Abilita o disabilita un job |

`cron_toggle_job` può disabilitare silenziosamente un job di backup o di fatturazione — una modifica senza errori né output finché in seguito non ci si accorge che manca qualcosa.

## Funzioni (1)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca una [funzione personalizzata](/docs/backend/custom-functions) con qualsiasi metodo e payload |

Questo chiama codice che il server MCP non ha mai visto, con un metodo e un body scelti dal modello. Il suo raggio di impatto (blast radius) corrisponde a qualunque cosa facciano le tue funzioni.

## Server di sviluppo (3)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_dev_start` | — | Avvia il server di sviluppo; restituisce immediatamente il controllo |
| `rebase_dev_logs` | — | Legge l'output recente (predefinito 50 righe, buffer da 500 righe) |
| `rebase_dev_stop` | — | Arresta il server di sviluppo |

## Registro dei progetti (7)

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_project_list` | — | Elenca i progetti registrati e mostra quello attivo |
| `rebase_project_switch` | `name` | Cambia il progetto attivo |
| `rebase_project_add` | `name` | Registra un progetto (`projectDir`, `baseUrl`, `token` opzionali) |
| `rebase_project_remove` | `name` | Rimuove un progetto (il progetto predefinito non può essere rimosso) |
| `rebase_project_current` | — | Mostra il progetto attivo e il suo stato di autenticazione |
| `rebase_project_status` | — | Verifica lo stato di integrità (health check) del backend attivo |
| `rebase_project_use_cloud` | `project` | Punta a un progetto Rebase Cloud dell'account connesso tramite ID, slug o nome, attraverso il proxy Studio della console |

`rebase_project_switch` non è controllato da gate, perché reindirizza tutto il resto invece di agire direttamente su un target. Un assistente può quindi passare a un progetto remoto senza attivare il gate — semplicemente non potrà poi eseguirvi uno strumento distruttivo. `rebase_project_use_cloud` è lo stesso tipo di cambio: punta gli strumenti dati e admin a un progetto di produzione, dove le letture funzionano e il gate rifiuta le scritture.

## Rebase Cloud (9)

Esegue `rebase cloud … --json` nella directory del progetto attivo, rispetto al progetto a cui è collegata, con le credenziali della CLI stessa. Consulta [Rebase Cloud](/docs/ai/mcp#rebase-cloud) per sapere su cosa agiscono e perché nessuno di essi è protetto da gate.

| Strumento | Obbligatorio | Descrizione |
|---|---|---|
| `rebase_cloud_provision` | — | Un backend live senza account (`rebase cloud init --claim`): l'URL live, l'URL admin e un URL di claim (`name`, `deploy`, `confirm`). Senza `confirm: true` descrive solo ciò che farebbe |
| `rebase_cloud_status` | — | L'URL del progetto collegato, lo stato, l'ultimo deploy, il runtime, il database, lo storage e il relativo URL di claim finché non viene riscattato |
| `rebase_cloud_deploy` | — | Esegue il deploy e lo segue fino al completamento (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`, `confirm`). Un deploy in produzione senza `confirm: true` descrive solo ciò che farebbe |
| `rebase_cloud_logs` | — | Uno snapshot del log di runtime, oppure il log di build più recente (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Non rimane mai in ascolto continuo |
| `rebase_cloud_env_list` | — | Le chiavi delle variabili, mai i valori (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Imposta una variabile; il valore passa attraverso stdin e non viene mai restituito (`secret`, `preview`, `confirm`). In produzione, senza `confirm: true` descrive solo ciò che farebbe |
| `rebase_cloud_deployments_list` | — | Deploy recenti e quelli verso cui è possibile effettuare il rollback (`limit`) |
| `rebase_cloud_projects_list` | — | Ogni progetto raggiungibile dall'account connesso, in tutte le sue organizzazioni |
| `rebase_cloud_rollback` | — | Rimette in servizio un deployment precedente avvenuto con successo (`deploymentId`, `confirm`). Senza `confirm: true` descrive solo ciò che farebbe |

`rebase_cloud_provision` crea un progetto e collega questa directory. Non legge mai il `baseUrl` del progetto attivo, quindi il gate non lo controlla; la CLI lo rifiuta in una directory già collegata.

---
sourceHash: 50d3082d86c52ae2
title: Riferimento degli strumenti MCP
sidebar_label: Riferimento degli strumenti MCP
description: Tutti gli strumenti registrati dal server MCP di Rebase, divisi per gruppo — cosa richiede ed esegue ciascuno di essi, e quali vengono rifiutati dal loopback gate per i progetti non locali.
---

Gli strumenti che [`@rebasepro/mcp`](/docs/ai/mcp) offre a un assistente. Le modalità di connessione, le credenziali utilizzate e il modo in cui il [loopback gate](/docs/ai/mcp#the-loopback-gate) determina il significato di ⚠ sono descritti nella pagina [MCP server](/docs/ai/mcp).

53 strumenti, divisi in dieci gruppi. Gli strumenti contrassegnati con ⚠ vengono rifiutati per le destinazioni non locali, a meno che non si scelga di disattivare questa protezione (opt-out).

## Schema e database (13)

<span class="since-badge" data-since="0.31">Da 0.31</span>

Esegue la CLI di Rebase nella directory del progetto attivo.

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `rebase_schema_generate` | — | Genera lo schema Drizzle dalle tabelle in `backend/schema` |
| `rebase_db_push` ⚠ | — | Applica lo schema direttamente al database (scorciatoia per lo sviluppo) |
| `rebase_schema_introspect` | — | Scrive un `defineTable` in `backend/schema` per ogni tabella presente nel database live |
| `rebase_db_generate` | — | Genera file di migrazione SQL a partire dalle modifiche allo schema |
| `rebase_db_migrate` ⚠ | — | Esegue tutte le migrazioni SQL in sospeso |
| `rebase_generate_sdk` | — | Genera l'SDK TypeScript completamente tipizzato |
| `rebase_doctor` | — | Rileva il disallineamento (drift) tra le tabelle in `backend/schema`, lo schema generato e il database live |
| `rebase_db_branch_create` ⚠ | `name` | Crea un branch del database (solo per amministratori) |
| `rebase_db_branch_list` | — | Elenca i branch del database (solo per amministratori) |
| `rebase_db_branch_delete` ⚠ | `name` | Elimina un branch del database (solo per amministratori) |
| `rebase_db_branch_info` | `name` | Informazioni e stato del branch (solo per amministratori) |
| `rebase_db_branch_diff` | `name` | Mostra cosa è cambiato in un branch rispetto al database da cui è stato creato — schema, policy e righe, con conflitti; non modifica nessuno dei due (solo per amministratori) |
| `rebase_db_branch_switch` | — | Punta questo checkout a un branch o di nuovo al database principale (solo per amministratori) |

## Pianificazione dello schema (1)

<span class="since-badge" data-since="0.31">Da 0.31</span>

Chiede al backend cosa comporterebbe una modifica, tramite `POST /api/admin/schema/plan`. Nessuna CLI e niente scritto su disco: funziona sul database di sviluppo gestito, cosa che i comandi basati su Atlas non possono fare.

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `rebase_schema_plan` | `patches` | L'SQL che un elenco di modifiche `TablePatch` eseguirebbe e quali istruzioni distruggono dati — consulta [Live schema editing](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Righe (5)

<span class="since-badge" data-since="0.31">Da 0.31</span> Gli stessi nomi utilizzati dall'endpoint remoto `/mcp`; in precedenza erano `list_documents`, `get_document`, `create_document`, `update_document` e `delete_document`, con un argomento `collection`.

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `query_table` | `table` | Legge le righe, con parametri opzionali `limit`, `offset`, `orderBy`, `where`, analogamente a `data.table(name).find()` |
| `get_row` | `table`, `id` | Recupera una singola riga per ID |
| `create_row` ⚠ | `table`, `data` | Crea una riga |
| `update_row` ⚠ | `table`, `id`, `data` | Aggiorna una riga; vengono modificate solo le colonne specificate |
| `delete_row` ⚠ | `table`, `id` | Elimina una riga |

## Utenti e ruoli (6)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `list_users` | — | Elenca tutti gli utenti, inclusi i ruoli |
| `create_user` ⚠ | `email` | Crea un utente (`displayName`, `password`, `roles` opzionali) |
| `update_user` ⚠ | `uid` | Aggiorna email, nome visualizzato o ruoli |
| `delete_user` ⚠ | `uid` | Elimina un utente |
| `list_roles` | — | Elenca i ruoli definiti |
| `rebase_auth_reset_password` ⚠ | `email` | Reimposta una password tramite l'API admin |

Sia `create_user` che `update_user` accettano `roles`, quindi entrambi possono creare un amministratore. Per questo motivo sono protetti (gated) anziché essere considerati come meramente "additivi".

## Storage (3)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `storage_list_objects` | — | Elenca gli oggetti archiviati |
| `storage_get_download_url` | `key` | Un URL temporaneo firmato per il download e la sua scadenza — non i metadati dell'oggetto |
| `storage_delete_object` ⚠ | `key` | Elimina un oggetto |

`storage_get_download_url` è classificato come operazione di lettura perché non modifica l'ambiente, ma l'URL firmato che genera rappresenta una funzionalità di tipo bearer valida anche oltre la chiamata dello strumento.

## Cron (5)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `cron_list_jobs` | — | Elenca i job pianificati e il loro stato |
| `cron_get_job` | `jobId` | Dettagli del job |
| `cron_get_job_logs` | `jobId` | Log di esecuzione |
| `cron_trigger_job` ⚠ | `jobId` | Esegue un job immediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Abilita o disabilita un job |

`cron_toggle_job` può disabilitare silenziosamente un job di backup o di fatturazione: una modifica senza errori né output, fino a quando non si noterà che qualcosa manca in seguito.

## Funzioni (1)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `invoke_function` ⚠ | `name` | Richiama una [funzione personalizzata](/docs/backend/custom-functions) con qualsiasi metodo e payload |

Questo richiama codice che il server MCP non ha mai visto prima, con un metodo e un corpo scelti dal modello. Il suo raggio di impatto (blast radius) corrisponde a qualunque cosa facciano le tue funzioni.

## Dev server (3)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `rebase_dev_start` | — | Avvia il dev server; termina immediatamente restituendo il controllo |
| `rebase_dev_logs` | — | Legge l'output recente (predefinito: 50 righe, buffer da 500 righe) |
| `rebase_dev_stop` | — | Arresta il dev server |

## Registro progetti (7)

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `rebase_project_list` | — | Elenca i progetti registrati e mostra quello attivo |
| `rebase_project_switch` | `name` | Cambia il progetto attivo |
| `rebase_project_add` | `name` | Registra un progetto (`projectDir`, `baseUrl`, `token` opzionali) |
| `rebase_project_remove` | `name` | Rimuove un progetto (il progetto predefinito non può essere rimosso) |
| `rebase_project_current` | — | Mostra il progetto attivo e il relativo stato di autenticazione |
| `rebase_project_status` | — | Esegue un controllo dello stato di integrità (health check) del backend attivo |
| `rebase_project_use_cloud` | `project` | Imposta come target un progetto Rebase Cloud dell'account connesso tramite ID, slug o nome, attraverso il proxy Studio della console |

`rebase_project_switch` non è sottoposto al controllo del gate, poiché reindirizza tutto il resto invece di agire direttamente su un target. Un assistente può quindi passare a un progetto remoto senza attivare il blocco del gate; semplicemente, non potrà poi eseguire strumenti distruttivi su di esso. `rebase_project_use_cloud` è lo stesso tipo di comando: indirizza gli strumenti dati e amministrativi verso un progetto di produzione, dove le letture funzionano mentre il gate rifiuta le scritture.

## Rebase Cloud (9)

Esegue `rebase cloud … --json` nella directory del progetto attivo, sul progetto a cui è collegato, utilizzando le credenziali della CLI stessa. Consulta [Rebase Cloud](/docs/ai/mcp#rebase-cloud) per scoprire su cosa agiscono e perché nessuno di essi è protetto dal gate.

| Strumento | Richiesto | Descrizione |
|---|---|---|
| `rebase_cloud_provision` | — | Un backend live senza account (`rebase cloud init --claim`): l'URL live, l'URL admin e un URL di claim (`name`, `deploy`) |
| `rebase_cloud_status` | — | URL del progetto collegato, stato, ultimo deploy, runtime, database, storage e relativo URL di claim finché non viene riscattato |
| `rebase_cloud_deploy` | — | Esegue il deploy e lo segue fino al completamento (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Un'istantanea del log di runtime o l'ultimo log di build (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Non resta mai in ascolto continuo |
| `rebase_cloud_env_list` | — | Chiavi delle variabili, mai i valori (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Imposta una variabile; il valore viene passato tramite stdin e non viene mai restituito (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Deploy recenti e verso quali è possibile eseguire un rollback (`limit`) |
| `rebase_cloud_projects_list` | — | Tutti i progetti a cui l'account connesso può accedere, in tutte le sue organizzazioni |
| `rebase_cloud_rollback` | — | Ripristina in servizio un deploy precedente completato con successo (`deploymentId`) |

`rebase_cloud_provision` crea un progetto e collega questa directory. Non legge mai il `baseUrl` del progetto attivo, pertanto il gate non effettua controlli; la CLI lo rifiuta se eseguito in una directory già collegata.

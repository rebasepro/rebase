---
sourceHash: e68d814b6b83ef41
title: Riferimento dei tool MCP
sidebar_label: Riferimento dei tool MCP
description: Ogni tool registrato dal server MCP di Rebase, per gruppo — cosa richiede e cosa fa ciascuno, e quali vengono rifiutati dal loopback gate se rivolti a un progetto non locale.
---

I tool che [`@rebasepro/mcp`](/docs/ai/mcp) offre a un assistente. Come si connette,
quale credenziale possiede e come il [loopback gate](/docs/ai/mcp#the-loopback-gate)
decide cosa significa ⚠ si trovano nella pagina del [server MCP](/docs/ai/mcp).

42 tool, suddivisi in nove gruppi. I tool contrassegnati con ⚠ vengono rifiutati se rivolti a destinazioni non locali,
a meno che non si scelga esplicitamente di disattivare il controllo.

## Schema & database (12)

Avviano la CLI di Rebase nella directory del progetto attivo.

| Tool | Richiesto | Descrizione |
|---|---|---|
| `rebase_schema_generate` | — | Genera lo schema Drizzle dalle definizioni delle collection |
| `rebase_db_push` ⚠ | — | Applica lo schema direttamente al database (scorciatoia per lo sviluppo) |
| `rebase_schema_introspect` | — | Esegue l'introspezione del database attivo trasformandolo in definizioni di collection |
| `rebase_db_generate` | — | Genera i file di migrazione SQL dalle modifiche allo schema |
| `rebase_db_migrate` ⚠ | — | Esegue tutte le migrazioni SQL in sospeso |
| `rebase_generate_sdk` | — | Genera l'SDK TypeScript con tipizzazione completa |
| `rebase_doctor` | — | Rileva disallineamenti (drift) tra definizioni, schema generato e database attivo |
| `rebase_db_branch_create` ⚠ | `name` | Crea un branch del database (solo amministratori) |
| `rebase_db_branch_list` | — | Elenca i branch del database (solo amministratori) |
| `rebase_db_branch_delete` ⚠ | `name` | Elimina un branch del database (solo amministratori) |
| `rebase_db_branch_info` | `name` | Informazioni e stato del branch (solo amministratori) |
| `rebase_db_branch_switch` | — | Punta questo checkout a un branch, o di nuovo al database principale (solo amministratori) |

## Pianificazione dello schema (1)

Chiede al backend cosa comporterebbe una modifica, tramite `POST /api/admin/schema/plan`. Nessuna
CLI e nessun file scritto su disco: funziona sul database di sviluppo gestito, operazione
non supportata dai comandi basati su Atlas.

| Tool | Richiesto | Descrizione |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | L'SQL che verrebbe eseguito dalla modifica di una collection, e quali istruzioni eliminano dati |

## Documenti (5)

| Tool | Richiesto | Descrizione |
|---|---|---|
| `list_documents` | `collection` | Elenca le righe, con parametri opzionali `limit`, `offset`, `orderBy`, `where` |
| `get_document` | `collection`, `id` | Recupera una singola riga per ID |
| `create_document` ⚠ | `collection`, `data` | Crea una riga |
| `update_document` ⚠ | `collection`, `id`, `data` | Aggiorna una riga |
| `delete_document` ⚠ | `collection`, `id` | Elimina una riga |

## Utenti & ruoli (6)

| Tool | Richiesto | Descrizione |
|---|---|---|
| `list_users` | — | Elenca tutti gli utenti, inclusi i ruoli |
| `create_user` ⚠ | `email` | Crea un utente (opzionali: `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | Aggiorna email, nome visualizzato o ruoli |
| `delete_user` ⚠ | `uid` | Elimina un utente |
| `list_roles` | — | Elenca i ruoli definiti |
| `rebase_auth_reset_password` ⚠ | `email` | Reimposta una password tramite l'API di amministrazione |

Sia `create_user` che `update_user` accettano `roles`, pertanto entrambi possono assegnare permessi
di amministratore. Questo è il motivo per cui sono soggetti a gate anziché essere trattati come meramente "aggiuntivi".

## Storage (3)

| Tool | Richiesto | Descrizione |
|---|---|---|
| `storage_list_objects` | — | Elenca gli oggetti archiviati |
| `storage_get_download_url` | `key` | Un URL di download firmato temporaneo e la sua scadenza — non i metadati dell'oggetto |
| `storage_delete_object` ⚠ | `key` | Elimina un oggetto |

`storage_get_download_url` è classificato come lettura poiché non modifica
l'ambiente — tuttavia l'URL firmato generato è una bearer capability valida oltre
la chiamata del tool.

## Cron (5)

| Tool | Richiesto | Descrizione |
|---|---|---|
| `cron_list_jobs` | — | Elenca i job pianificati e il loro stato |
| `cron_get_job` | `jobId` | Dettagli del job |
| `cron_get_job_logs` | `jobId` | Log di esecuzione |
| `cron_trigger_job` ⚠ | `jobId` | Esegue immediatamente un job |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Abilita o disabilita un job |

`cron_toggle_job` può disattivare silenziosamente un backup o un job di fatturazione — una modifica
priva di errori e senza output finché in seguito non viene rilevata una mancanza.

## Funzioni (1)

| Tool | Richiesto | Descrizione |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca una [funzione personalizzata](/docs/backend/custom-functions) con qualsiasi metodo e payload |

Questo comando richiama codice che il server MCP non ha mai visto, con un metodo e un corpo scelti
dal modello. Il suo raggio d'azione corrisponde a qualsiasi cosa facciano le tue funzioni.

## Dev server (3)

| Tool | Richiesto | Descrizione |
|---|---|---|
| `rebase_dev_start` | — | Avvia il dev server; termina immediatamente |
| `rebase_dev_logs` | — | Legge l'output recente (predefinito 50 righe, buffer da 500 righe) |
| `rebase_dev_stop` | — | Arresta il dev server |

## Registro dei progetti (6)

| Tool | Richiesto | Descrizione |
|---|---|---|
| `rebase_project_list` | — | Elenca i progetti registrati e mostra quello attivo |
| `rebase_project_switch` | `name` | Cambia il progetto attivo |
| `rebase_project_add` | `name` | Registra un progetto (`baseUrl`, opzionali `projectDir`, `token`) |
| `rebase_project_remove` | `name` | Rimuove un progetto (il progetto default non può essere rimosso) |
| `rebase_project_current` | — | Mostra il progetto attivo e il relativo stato di autenticazione |
| `rebase_project_status` | — | Controlla lo stato di salute (health-check) del backend attivo |

`rebase_project_switch` non è soggetto a gate, poiché reindirizza tutto il resto
anziché intervenire direttamente su una destinazione. Un assistente può quindi passare a un
progetto remoto senza attivare il blocco — semplicemente non potrà poi eseguire tool
distruttivi su di esso.

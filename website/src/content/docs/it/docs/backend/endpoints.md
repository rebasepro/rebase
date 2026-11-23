---
sourceHash: c2fabe52d7bfc689
title: Indice degli endpoint
sidebar_label: Indice degli endpoint
description: Tutte le route HTTP montate da un backend Rebase — dati, autenticazione, storage, admin, meta — con il gate associato a ciascuna e la pagina di approfondimento.
---

Tutte le route montate dal server, in una sola tabella, con i requisiti necessari per raggiungerle.

I percorsi assumono il `basePath` predefinito `/api`; `REBASE_BASE_PATH` li sposta
tutti insieme. `/health`, `/livez` e `/metrics` risiedono volutamente al di fuori di esso,
poiché un orchestratore interroga `/health` e non dovrebbe dover conoscere il percorso di
base. `/health` è *anche* montato al suo interno, in modo che `/api/health` risponda allo
stesso modo anziché restituire un 404 proprio nel momento in cui qualcuno sta controllando
se il server è attivo.

Un gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — confronta questa
tabella con le route registrate dal codice sorgente, in modo che non sia possibile aggiungere
una nuova superficie senza che compaia qui.

## Gate

| Gate | Significato |
|---|---|
| **none** | Non autenticato. Chiunque possa raggiungere l'host può effettuarne la chiamata |
| **session** | Un chiamante autenticato: un token di accesso o una chiave API con ambito limitato all'operazione |
| **`resource:action`** | Un chiamante in possesso di tale [scope](/docs/backend/roles-and-scopes/): un amministratore, un utente il cui ruolo lo dichiara, una chiave API creata con esso o la service key |
| **RLS** | Autenticato, e poi il database decide riga per riga — vedi [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montato solo al di fuori dell'ambiente di produzione |

## Dati

Generati per tabella, quindi i percorsi contengono i tuoi slug anziché un elenco
fisso. `:slug` è lo slug di una tabella (il suo nome, a meno che `defineTable` non imposti `slug`).

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | L'elenco, con parametri di query nel corpo — [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Il conteggio, con parametri di query nel corpo — [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Ricalcola una vista materializzata, sulle viste che sono materializzate — [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias deprecato di `PATCH` — stessa scrittura parziale, risponde con `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserisce più righe, opzionalmente con upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Aggiorna più righe per id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina più righe per id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Scrittura su più tabelle in una singola transazione — [Writing over REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

`:id` è la chiave della riga. In una tabella con chiave composita corrisponde al
valore di ogni colonna chiave, nell'ordine della chiave, unito da `:::` (con ogni
parte codificata come URL): una tabella con chiave `(agency_id, id)` indirizza
una riga come `/api/data/proposals/<agency_id>:::<id>`. Un indirizzo con un numero
errato di parti viene rifiutato con `400 COMPOSITE_KEY_ADDRESS`, specificando le
colonne chiave.

Il conteggio e l'aggregazione sono route a sé stanti, registrate prima di `/:id`
in modo che `aggregate` non venga interpretato come l'id di un'entità. `?select=` e
`?groupBy=` sono i loro parametri, e `select` è obbligatorio su `/aggregate`.

La ricerca testuale, la ricerca vettoriale, l'inclusione di relazioni e la selezione
dei campi *sono* parametri di query su `GET /api/data/:slug` anziché route distinte —
`searchString`, `vector_search`, `include`, `fields`. Consulta [REST API](/docs/backend/api/).

Un progetto che non dichiara alcuna tabella e non ne introspezione alcuna gestisce
questo prefisso con un unico `404 NO_TABLES`. Consulta [Backend only](/docs/getting-started/headless/).

## Autenticazione

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Cosa può offrire la schermata di login: registrazione, reimpostazione della password, magic link, codici email, accesso ospite, provider OAuth e se la configurazione del primo amministratore è in sospeso |
| `POST` | `/api/auth/register` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un refresh token) | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoca tutte le altre sessioni |
| `DELETE` | `/api/auth/sessions/:id` | session | Ne revoca una |
| `POST` | `/api/auth/forgot-password` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un token di reimpostazione) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Invia un link di conferma via email al nuovo indirizzo — [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un token di collegamento) | Sposta l'account sul nuovo indirizzo — [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token di verifica) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token di verifica, e una sessione o la password per mantenerla) | [Email verification](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token di collegamento) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codici monouso via email |
| `POST` | `/api/auth/otp/verify` | none (un codice) | Codici monouso via email |
| `POST` | `/api/auth/device` | none | [Device sign-in](/docs/backend/device-sign-in/). Disattivato a meno che il backend non lo abiliti |
| `POST` | `/api/auth/device/token` | none (un codice dispositivo) | [Device sign-in](/docs/backend/device-sign-in/): il polling del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Device sign-in](/docs/backend/device-sign-in/): cosa mostra la pagina di approvazione |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un secondo fattore) | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessioni ospite. Disattivato a meno che non sia impostato `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un ospite) | Trasforma un ospite in un account |
| `POST` | `/api/auth/find-user` | session | Disattivato a meno che non sia impostato `AUTH_ALLOW_USER_LOOKUP` — costituisce una superficie di enumerazione |
| `POST` | `/api/auth/:provider` | none | Uno per ciascun provider OAuth/OIDC configurato |
| `POST` | `/api/auth/link/:provider` | session | Collega un provider all'account che ha effettuato l'accesso |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un accesso in corso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un challenge id) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Tutti gli scope noti a questo backend e quelli detenuti dal chiamante — [Roles and scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un account) | Le [personal keys](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | session (un account) | La chiave in chiaro viene restituita una sola volta. `403 PERSONAL_KEYS_DISABLED` a meno che la tabella di autenticazione non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un account) | Revoca una delle chiavi del chiamante |
| `GET` | `/.well-known/jwks.json` | none | Il JWKS pubblico, quando è configurata la [firma asimmetrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Admin

Tutto ciò che si trova sotto `/api/admin` richiede uno scope dal piano di
amministrazione, e ciascuna superficie specifica il proprio: `users:read` elenca
gli account, `cron:write` attiva un job. Un amministratore li detiene tutti, così
come la service key. Una persona detiene quelli dichiarati dai propri ruoli, e una
chiave API quelli con cui è stata creata. Una chiave limitata all'ambito di una
tabella non accede a nulla di tutto questo. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e solo finché non esiste alcun amministratore | Rifiutato in produzione — vedi [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestione utenti |
| `POST` | `/api/admin/users` | `users:write` | Gestione utenti. I ruoli che vanno oltre quelli del chiamante vengono rifiutati |
| `POST` | `/api/admin/users/import` | `users:write` | [Importa account](/docs/backend/auth-endpoints/#importing-accounts) mantenendone gli id: nessuna password, nessuna email, un id o un'email già occupati vengono ignorati. Al massimo 100 per richiesta. I ruoli che vanno oltre quelli del chiamante vengono rifiutati |
| `GET` | `/api/admin/users/pick` | `users:read`, o accesso in scrittura a una tabella con una colonna `.userId()` | La [lettura del selettore utenti](/docs/backend/auth-endpoints/): solo id, nome, email e avatar. Una tabella le cui regole di scrittura sono in SQL grezzo non è considerata |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestione utenti |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che dispone di più permessi del chiamante |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che dispone di più permessi del chiamante |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Genera una password temporanea |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Rimuove i secondi fattori e i codici di recupero dell'account, termina le sue sessioni |
| `GET` | `/api/admin/guests` | `users:read` | Ospiti, ordinati a partire da quelli visti meno di recente. `?lastSeenBefore=` li limita a quelli che l'eliminazione sottostante elaborerebbe, e `total` ne restituisce il conteggio |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un batch di ospiti visti l'ultima volta prima di `?lastSeenBefore=`, che è obbligatorio. Risponde con `{ deleted, skipped, remaining }`. Ripetere finché `remaining` non è 0, con `?offset=` impostato sul numero di quelli saltati. Gli account veri e propri non sono raggiungibili |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un ospite. Un account viene rifiutato con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e i ruoli dichiarati dal progetto, con i rispettivi scope |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API keys](/docs/backend/api-keys/). Mai tramite una chiave API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La chiave in chiaro viene restituita una sola volta, al momento della creazione |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Abilita o disabilita un job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Esegue un job immediatamente. `?async=1` risponde con `202` una volta avviato — [Cron Jobs API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario dei backup |
| `GET` | `/api/admin/backups/download` | `backups:read` | Trasmette in streaming un backup. Con `?token=` ottenuto da un link di download, non è richiesto alcun header, limitatamente a quel backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un link verso un backup, `{ key }` → `{ url, token, expiresIn }`, valido per 60 secondi — [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Avvia una scansione per i file memorizzati non referenziati da alcuna riga, `?storageId=&olderThanHours=`, in background. Risponde con `202` e il record della scansione: `id`, `status` (`queued`) e `runner` (`worker` quando è un job `storage.orphans` sulla coda dei job, `in-process` quando il server lo esegue direttamente). Il relativo record viene scritto nella sorgente, sotto il percorso riservato `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Il record della scansione, `?storageId=`. Durante l'esecuzione: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` su `collectionsTotal`, `unscanned`). Una volta `completed`: `result`, il report restituito dalla precedente `GET /orphans`. Un'esecuzione che smette di riportare avanzamenti per 10 minuti viene considerata `failed`. `404 STORAGE_SCAN_NOT_FOUND` quando la sorgente non contiene tale scansione |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina gli orfani di una scansione completata in background, `202`. Ciascuno viene nuovamente confrontato con ogni riga e voce cronologica, e richiesto un'ultima volta subito prima dell'eliminazione. Il risultato è il campo `deletion` del record della scansione. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Deprecato: la scansione all'interno della richiesta, `?storageId=&olderThanHours=`. Risponde con `Deprecation: true`. Usa `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Deprecato, senza `?scan=`: esegue nuovamente la scansione ed elimina all'interno della richiesta. `409 STORAGE_SCAN_INCOMPLETE` quando una tabella non può essere letta |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una cartella in un'altra sorgente con le stesse chiavi, una pagina per chiamata — ciò che invia `rebase storage move`; `400 STORAGE_SAME_LOCATION` per `deleteSource` tra due sorgenti che risiedono nella stessa posizione |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Elenca nuovamente la sorgente dopo uno spostamento, con lo stesso corpo, una pagina per chiamata: `{ checked, notMoved: [{ key, reason }], cursor? }` — ogni file ancora presente nella sorgente con `deleteSource`, ogni file di cui la destinazione non ha copia senza di esso. `rebase storage move` la interroga quando lo spostamento è completato |
| `GET` | `/api/admin/logs` | `logs:read` | Il buffer dei log recenti |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Le voci più recenti |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | L'ultimo risultato dell'audit pianificato |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Ruoli, ruoli di regola degli utenti e service key attive che un amministratore può simulare |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Ciascuna tabella nel modo in cui `{ role?, userId?, apiKeyId? }` vi accede: righe visibili rispetto a quelle del chiamante, nascoste per scope o RLS, campi mascherati. Solo per sessioni di amministratore |
| `POST` | `/api/admin/sql/csv` | `database:write` | Trasmette in streaming l'intero risultato di una query in sola lettura come CSV — \"Download full result as CSV\" di [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Cosa ha modificato un [branch](/docs/backend/branching/#reviewing-and-merging-a-branch): schema, policy e righe, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Scrive le righe del branch nel suo parent, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` quando uno dei due lati è cambiato rispetto al diff, o se le righe sono in conflitto |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Pianifica una modifica; non ne applica mai alcuna |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo una persona, a meno che non sia impostato `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Pianifica la rimozione del vincolo `NOT NULL` e l'eliminazione delle colonne non dichiarate elencate in `drop`, per [schema reconcile](/docs/cli/schema/#rebase-schema-reconcile); non ne applica mai alcuna |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applica un piano di riconciliazione, solo se il suo `digest` coincide con il `confirm` inviato |
| `POST` | `/api/admin/schema/reload` | `schema:write` | Esegue nuovamente l'introspezione di PostgreSQL e ricarica REST, Realtime, OpenAPI, storage policy, webhook, ruoli e job pianificati sul posto senza riavvio |
| `GET` | `/api/admin/db/tables` | `database:read` | Elenca le tabelle PostgreSQL dell'utente con colonne, indici, policy RLS e overlay `rebase.table_meta` |
| `POST` | `/api/admin/db/tables` | `database:write` | Crea una tabella PostgreSQL con policy RLS e metadati iniziali opzionali (`dryRun: true` mostra l'anteprima dell'SQL), quindi ricarica a caldo |
| `PATCH` | `/api/admin/db/tables/:table` | `database:write` | Rinomina una tabella, attiva o disattiva la Row Level Security (`rlsEnabled`) o aggiorna le impostazioni di overlay API di `rebase.table_meta` (`meta`), quindi ricarica a caldo |
| `DELETE` | `/api/admin/db/tables/:table` | `database:write` | Elimina una tabella PostgreSQL (richiede `{ confirm: "<table>" }` a meno che non sia `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/columns` | `database:write` | Aggiunge una colonna a una tabella PostgreSQL e ricarica a caldo |
| `PATCH` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Modifica una colonna (rinomina, tipo, supporto ai null, valore predefinito) e ricarica a caldo |
| `DELETE` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Elimina una colonna (richiede `{ confirm: "<column>" }` a meno che non sia `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/indexes` | `database:write` | Crea un indice su una tabella PostgreSQL |
| `DELETE` | `/api/admin/db/tables/:table/indexes/:index` | `database:write` | Elimina un indice su una tabella PostgreSQL |
| `POST` | `/api/admin/db/tables/:table/policies` | `database:write` | Crea una policy RLS PostgreSQL su una tabella e ricarica a caldo |
| `DELETE` | `/api/admin/db/tables/:table/policies/:policy` | `database:write` | Elimina una policy RLS PostgreSQL su una tabella e ricarica a caldo |
| `GET` | `/api/admin/storage/policies` | `database:read` | Elenca le storage policy dichiarative zero-code da `rebase.storage_policies` |
| `POST` | `/api/admin/storage/policies` | `database:write` | Crea una storage access policy dichiarativa |
| `PATCH` | `/api/admin/storage/policies/:id` | `database:write` | Aggiorna una storage access policy dichiarativa |
| `DELETE` | `/api/admin/storage/policies/:id` | `database:write` | Elimina una storage access policy dichiarativa |
| `GET` | `/api/admin/webhooks` | `database:read` | Elenca i webhook di database zero-code da `rebase.webhooks` |
| `POST` | `/api/admin/webhooks` | `database:write` | Crea un webhook di database |
| `PATCH` | `/api/admin/webhooks/:id` | `database:write` | Aggiorna un webhook di database |
| `DELETE` | `/api/admin/webhooks/:id` | `database:write` | Elimina un webhook di database |
| `POST` | `/api/admin/webhooks/:id/test` | `database:write` | Invia una notifica di prova in tempo reale a un endpoint webhook configurato |
| `GET` | `/api/admin/roles` | `users:read` | Elenca ruoli e scope RBAC zero-code da `rebase.roles` |
| `POST` | `/api/admin/roles` | `users:write` | Crea o aggiorna un ruolo RBAC zero-code |
| `PUT` | `/api/admin/roles/:name` | `users:write` | Aggiorna un ruolo RBAC zero-code |
| `DELETE` | `/api/admin/roles/:name` | `users:write` | Elimina un ruolo RBAC zero-code |
| `GET` | `/api/admin/cron/jobs` | `cron:read` | Elenca i job cron SQL/HTTP pianificati zero-code da `rebase.cron_jobs` |
| `POST` | `/api/admin/cron/jobs` | `cron:write` | Crea un cron job SQL o HTTP pianificato zero-code. Un job SQL esegue la propria istruzione utilizzando la connessione del server stesso, pertanto richiede anche `database:write` |
| `PATCH` | `/api/admin/cron/jobs/:id` | `cron:write` | Aggiorna un cron job pianificato zero-code; un job SQL, o uno che lo diventa, richiede anche `database:write` |
| `DELETE` | `/api/admin/cron/jobs/:id` | `cron:write` | Elimina un cron job pianificato zero-code |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indica se l'editor è disponibile e il motivo in caso contrario |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Ogni tabella esportata da `backend/schema/index.ts` nel modo in cui l'editor la legge, con ciò che viene modificato nel codice (in sola lettura) e il motivo — [Live schema editing](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: i file che la modifica scriverebbe, compilati; non scrive nulla |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | La stessa modifica, scritta in `backend/schema`; il database non viene toccato |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tabelle presenti nel database e non dichiarate in `backend/schema`: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Una di esse descritta: `{ table: { …, descriptor, rlsRaised?, notes } }`, per "Import an existing table". `404` se sconosciuta o già dichiarata, `400 SCHEMA_EDIT_REFUSED` in assenza di una chiave primaria |
| `GET` | `/api/admin/ui-config` | session | Le preferenze UI del workspace per tabella, quelle dell'utente chiamante e l'indicazione se il chiamante può scrivere quelle del workspace — vedi [Customizing a table](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Unisce un delta `UiTablePreferences` nelle preferenze del workspace di una tabella (`replace` sostituisce). Scritto in `frontend/src/cms/ui-config.json` se il server ha i permessi di scrittura sul sorgente del progetto, altrimenti in `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Rimuove le preferenze del workspace di una tabella |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (una persona) | Le preferenze del chiamante per una tabella. Una chiave API non ne possiede alcuna: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (una persona) | Rimuove le preferenze del chiamante per una tabella |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Le email catturate dal transport di sviluppo anziché inviate |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Svuota la casella di posta catturata |

Anche `/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` sono
serviti sui rispettivi percorsi precedenti alla versione 0.17 senza il segmento
`/admin`. Questi alias sono riservati ai progetti che non hanno ancora effettuato
la migrazione; scrivi nuovo codice utilizzando il percorso canonico.

## Schema

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, o una credenziale con `schema:read` o uno scope `data:*` | Tutte le tabelle servite da questo backend, sotto forma di array JSON di descrittori redatti in base al chiamante |
| `GET` | `/api/schema/tables/:slug` | come sopra | Un descrittore. `404 TABLE_NOT_FOUND` quando a questo chiamante non viene servita quella tabella |

I descrittori costituiscono la base con cui il CMS visualizza le proprie impostazioni
predefinite, da cui Studio ricava il visualizzatore dello schema e l'editor RLS,
e da cui le app MCP generano tabelle e moduli. Includono le colonne con i rispettivi
tipi Postgres, la supportabilità dei null, le regole di convalida e di storage, le
relazioni per slug e la configurazione della row-level security. Il codice degli hook
non lascia mai il server: un descrittore indica soltanto quali hook possiede una tabella.

Ciò che viene restituito al chiamante dipende dalla sua identità:

| Chiamante | Tabelle | Redazione |
|---|---|---|
| Un amministratore, un titolare di `schema:read` o la service key | tutte le tabelle, incluse le viste normali | colonne `.private()`, per chiunque |
| Qualsiasi altra persona autenticata, inclusi gli ospiti | solo le tabelle che una regola permissiva rende accessibili per i suoi ruoli (più la tabella di autenticazione e le viste materializzate di cui possiede i `roles`) | colonne e relazioni per cui i suoi ruoli falliscono `access.read`; colonne `.private()`; solo le regole applicabili ai suoi ruoli; relazioni verso tabelle non servite al chiamante; flag degli hook; SQL grezzo nelle regole, policy compilate, query di viste e indici |
| Una credenziale (chiave API, token MCP o piattaforma) | le tabelle indicate dai suoi scope `data:*`, o tutte quante con `schema:read` | come sopra, valutato in base agli scope posseduti |
| Nessun utente autenticato | nessuna — `401` — a meno che il backend non imposti `schemaTables: { public: true }` | in tal caso, le tabelle con una regola `select` pubblica, redatte come per il chiamante con i privilegi minimi: nessuna colonna con un elenco `access.read`, nessun SQL grezzo, nessuna policy |

Una persona mantiene `metadata`, `softDelete`, `tenant`, `history` e `search` sulle
tabelle a lei servite. `schemaTables: { persons: "all" }` nelle opzioni del backend
descrive ogni tabella e regola a qualsiasi chiamante autenticato; il valore predefinito
è `"granted"`. Le connessioni MCP vengono valutate come una credenziale, dal
medesimo serializzatore.

L'identità del chiamante proviene dall'adapter di autenticazione del backend, lo stesso
interrogato dalle route dei dati; pertanto, un backend con un [adapter personalizzato](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
viene servito qui (e su `/api/docs` e su ogni superficie admin) con i ruoli restituiti
dal suo adapter; una credenziale non riconosciuta restituisce un `401`.

Una credenziale che non detiene né `schema:read` né uno scope `data:*` riceve
un errore `403 SCOPE_MISSING`. Un backend senza alcuna autenticazione configurata risponde
a ogni richiesta con `404 SCHEMA_UNAVAILABLE`: non esiste alcun chiamante in base al quale
redigere i dati, e l'impostazione `auth.requireAuth: false` non modifica tale comportamento.

Le risposte contengono `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` e l'header `x-rebase-schema`; una richiesta il cui `If-None-Match`
specifica il tag corrente riceve un `304`. Il tag cambia ogni volta che cambia lo
schema, anche in seguito a una modifica a caldo dello schema.

`schemaTables` è un'opzione di `initializeRebaseBackend` priva di variabile d'ambiente:
un progetto generato vi accede tramite eject.

## Storage

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, per chiave | [Storage](/docs/backend/storage/#storage-endpoints): metadati per un massimo di 100 oggetti |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Le sorgenti di storage con nome servite da questo backend |
| `OPTIONS` | `/api/storage/tus` | none | Upload ripristinabili: le versioni e le estensioni TUS supportate da questo server |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Upload ripristinabili: creazione |
| `GET` | `/api/storage/tus/:id` | il proprietario dell'upload | Upload ripristinabili: offset |
| `PATCH` | `/api/storage/tus/:id` | il proprietario dell'upload | Upload ripristinabili: append |
| `DELETE` | `/api/storage/tus/:id` | il proprietario dell'upload | Upload ripristinabili: annullamento |

Un deployment senza alcuno storage configurato serve questo prefisso con un `501` che indica
la variabile necessaria, anziché restituire un 404 come se la funzionalità non esistesse —
a eccezione di `GET /api/storage/sources`, che risponde con `200` e un elenco vuoto.

## Push

Montato solo con `push: true` (`REBASE_PUSH=true`). Con le push abilitate ma in assenza
di chiavi, ogni route risponde con `503 PUSH_NOT_CONFIGURED`. Le chiavi API e la service key
vengono rifiutate: una sottoscrizione appartiene al browser di una persona.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/push/key` | session | La chiave pubblica VAPID — [Push notifications](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Questo browser riceve notifiche per il chiamante — [Push notifications](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Interrompi la ricezione, sul browser del chiamante — [Push notifications](/docs/backend/push-notifications/#routes) |

## Funzioni

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/functions` | session | I nomi delle funzioni servite e quanti file non è stato possibile caricare |
| any | `/api/functions/<name>` | qualsiasi cosa la funzione dichiari. Una chiave API necessita inoltre di `functions:invoke` | [Custom Functions](/docs/backend/custom-functions/) |

Una route per ciascun file sotto `backend/functions/`, quindi i percorsi provengono
dal tuo progetto. `GET /api/functions` li elenca solo a un chiamante autenticato — una
sessione, una chiave API o la service key — e risponde a chiunque altro con `401`: un
inventario degli endpoint personalizzati di un deployment non è pubblico.

## RPC

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/rpc/<name>` | l'`access` dell'RPC: none per `"public"` (soggetto a rate limit), session per `"authenticated"`; poi RLS all'interno della funzione. Una chiave API necessita inoltre di `data:read` (`data:write` per una RPC con `write: true`) | [SQL functions as RPC](/docs/backend/rpc/) |

Una route per ogni `defineRpc` esportato da `backend/schema/index.ts`, quindi i
percorsi provengono dal tuo progetto. Un nome non dichiarato risponde con `404
RPC_NOT_FOUND`, anche quando il database dispone di una funzione con quel nome.

## Meta e operazioni

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/livez` | none | Solo liveness: verifica se questo processo è in esecuzione. Non tocca il database, motivo per cui è il percorso di probe che un container dovrebbe utilizzare — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Riporta tutte le origini dati configurate, non solo quella predefinita |
| `GET` | `/api/docs` | il pubblico dell'endpoint di schema per impostazione predefinita (401 per anonimi a meno di `schemaTables.public`, 403 per una credenziale priva di uno scope di schema o dati); none quando `enableSwagger` è `true`; il gate admin quando è `false` | Il documento OpenAPI 3.0 relativo alle tabelle che `GET /api/schema/tables` descrive al chiamante (tutte quante con `enableSwagger: true`). `404 DOCS_UNAVAILABLE` quando non è configurata alcuna autenticazione |
| `GET` | `/api/swagger` | none | Swagger UI. Solo quando `enableSwagger` è `true`, e mai in produzione |
| `GET` | `/api/meta/schema-version` | none | L'hash dello schema a partire dal quale questo backend è stato compilato e la versione del runtime, e nient'altro |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — ogni tabella così come la vede un amministratore, l'input di `rebase generate-sdk --from`. `404` quando non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando impostato | Metriche Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando impostato | Le serie registrate alla base dei grafici di Studio. `501` su un runtime privo di backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN` quando impostato | Fino a 16 serie registrate contemporaneamente, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, raggruppate in bucket. Include le richieste al minuto e gli errori per superficie. `501` su un runtime privo di backend |

Le connessioni WebSocket arrivano come un aggiornamento HTTP (upgrade) sullo stesso
server anziché su un percorso dedicato — vedi [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montato solo quando `REBASE_MCP_ENABLED=true`, che richiede anche
`REBASE_PUBLIC_URL` — vedi
[Configuration](/docs/getting-started/configuration/#mcp-surface). Disattivato per
impostazione predefinita: nessun `REBASE_ROLE` lo attiva, poiché concede l'accesso al
progetto a software di terze parti e si tratta di una decisione che spetta a una persona.

I documenti `.well-known` si trovano all'**origine**, non sotto `basePath`: le RFC 8414
e RFC 9728 definiscono tali percorsi rispetto all'origine, e un client li recupera
prima di possedere qualsiasi token.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadati RFC 9728 che indicano questa risorsa e il relativo server di autorizzazione. Serviti anche nella forma con suffisso di percorso |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadati RFC 8414: gli endpoint, i tipi di autorizzazione (grant type) e i metodi PKCE supportati da questo deployment |
| `POST` | `/mcp` | Bearer OAuth o una chiave API | L'endpoint del protocollo MCP. Agisce **come l'utente autenticato** (o come chiunque sia rappresentato dalla chiave), quindi ogni lettura e scrittura è soggetta alla stessa RLS. Gli scope `data:*` determinano quali strumenti vengono offerti |
| `GET` | `/mcp` | Bearer OAuth o una chiave API | Risponde con `405` e `Allow: POST, DELETE`: questo server non apre alcuno stream avviato dal server. Il token viene verificato prima, quindi un token mancante o scaduto riceve invece la richiesta `401` |
| `DELETE` | `/mcp` | none | Risponde con `204`. L'endpoint non mantiene alcuna sessione, quindi non c'è nulla da terminare |
| `POST` | `/api/oauth/register` | rate-limited | Registrazione dinamica dei client RFC 7591. Rifiutata quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La schermata di consenso a cui viene reindirizzato un client |
| `POST` | `/api/oauth/authorize/decision` | session | La risposta dell'utente — approva o rifiuta |
| `POST` | `/api/oauth/token` | credenziali client + PKCE | Scambia un authorization code o esegue il refresh |
| `POST` | `/api/oauth/revoke` | credenziali client | Revoca del token RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quali client questo utente ha approvato |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Ne revoca uno, consentendo a una persona di annullare un consenso senza l'intervento di un amministratore |

L'endpoint MCP proprio del pannello di amministrazione non fa parte di questa
superficie: accetta la sessione del pannello di amministrazione, mai un token
OAuth, ed è montato con le route di amministrazione indipendentemente dal fatto
che `REBASE_MCP_ENABLED` sia impostato o meno, su un driver che applica a
ciascuna chiamata le regole RLS.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, mai anonimo | **Sperimentale.** Gli stessi strumenti di `/mcp`, per la persona autenticata, con `data:read`, `data:write` e `data:delete`, sotto la propria RLS. La `savedAppsView` del pannello di amministrazione apre le [saved apps](/docs/ai/remote-mcp/) tramite di esso |

## Correlati

- [REST API](/docs/backend/api/) — le route dei dati complete: filtri, ordinamento, paginazione, errori
- [Auth endpoints](/docs/backend/auth-endpoints/) — formati di richiesta e risposta per la tabella di autenticazione sopra riportata
- [Environment & Configuration](/docs/getting-started/configuration/) — le variabili che determinano quali di queste route vengono montate

---
sourceHash: 724a8d58e7df46ee
title: Indice degli endpoint
sidebar_label: Indice degli endpoint
description: Tutte le route HTTP montate da un backend Rebase — data, auth, storage, admin, meta — con il gate di ciascuna e la pagina che la descrive.
---

Tutte le route montate dal server, in un'unica tabella, con i requisiti per raggiungerle.

I percorsi assumono il `basePath` predefinito `/api`; `REBASE_BASE_PATH` li sposta
tutti insieme. `/health`, `/livez` e `/metrics` risiedono intenzionalmente al di fuori di esso,
poiché un orchestratore esegue probe su `/health` e non dovrebbe dover conoscere il percorso
di base. `/health` è *anche* montato sotto di esso, in modo che `/api/health` risponda allo stesso
modo anziché restituire un errore 404 proprio quando qualcuno sta controllando se il server
è attivo.

Un gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — confronta questa
tabella con le route registrate dal codice sorgente, impedendo l'aggiunta di una nuova superficie
senza che compaia qui.

## Gate

| Gate | Significato |
|---|---|
| **none** | Non autenticato. Chiunque possa raggiungere l'host può chiamarlo |
| **session** | Un chiamante autenticato: un token di accesso o una chiave API con ambito limitato all'operazione |
| **`resource:action`** | Un chiamante in possesso di tale [scope](/docs/backend/roles-and-scopes/): un amministratore, un utente il cui ruolo lo dichiara, una chiave API creata con esso, o la chiave di servizio |
| **RLS** | Autenticato, dopodiché il database decide riga per riga — vedi [Regole di sicurezza](/docs/collections/security-rules/) |
| **dev** | Montato solo al di fuori della produzione |

## Dati

Generato per ciascuna tabella, quindi i percorsi contengono i tuoi slug anziché un elenco
fisso. `:slug` è lo slug di una tabella (il suo nome, a meno che `defineTable` non imposti `slug`).

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Interrogazione](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | L'elenco, parametri di query nel corpo — [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Interrogazione](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Il conteggio, parametri di query nel corpo — [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Ricalcola una vista materializzata, sulle viste che sono materializzate — [Viste](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias deprecato di `PATCH` — stessa scrittura parziale, risponde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserisce più righe, opzionalmente eseguendo l'upsert — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Aggiorna più righe per ID — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina più righe per ID — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Scrive su più tabelle in una singola transazione — [Scrittura tramite REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Cronologia entità](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Cronologia entità](/docs/backend/history/) |

`:id` è la chiave della riga. Su una tabella con chiave composita, corrisponde al valore di ciascuna
colonna chiave, nell'ordine della chiave, unito da `:::` (ogni parte con codifica URL):
una tabella con chiave `(agency_id, id)` indirizza una riga come
`/api/data/proposals/<agency_id>:::<id>`. Un indirizzo con un numero errato di
parti viene rifiutato con `400 COMPOSITE_KEY_ADDRESS`, specificando le colonne chiave.

Il conteggio e l'aggregazione sono route a sé stanti, registrate prima di `/:id` in
modo che `aggregate` non venga interpretato come ID entità. `?select=` e `?groupBy=` sono
i loro parametri, e `select` è obbligatorio su `/aggregate`.

La ricerca di testo, la ricerca vettoriale, l'inclusione di relazioni e la selezione dei campi *sono* parametri
di query su `GET /api/data/:slug` anziché route — `searchString`,
`vector_search`, `include`, `fields`. Vedi [API REST](/docs/backend/api/).

Un progetto che non dichiara tabelle e non ne esegue l'introspezione serve questo prefisso
con un singolo `404 NO_TABLES`. Vedi [Solo backend](/docs/getting-started/headless/).

## Auth

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Ciò che la schermata di accesso può offrire: registrazione, reimpostazione della password, magic link, codici email, accesso ospite, provider OAuth e se la configurazione del primo amministratore è in sospeso |
| `POST` | `/api/auth/register` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un token di aggiornamento) | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoca tutte le altre sessioni |
| `DELETE` | `/api/auth/sessions/:id` | session | Ne revoca una |
| `POST` | `/api/auth/forgot-password` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un token di reset) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Invia un link di conferma al nuovo indirizzo — [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un token di link) | Trasferisce l'account sul nuovo indirizzo — [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticazione](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token di verifica) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token di verifica, e una sessione o la password per mantenerla) | [Verifica dell'email](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token di link) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codici monouso via email |
| `POST` | `/api/auth/otp/verify` | none (un codice) | Codici monouso via email |
| `POST` | `/api/auth/device` | none | [Accesso da dispositivo](/docs/backend/device-sign-in/). Disattivato a meno che il backend non lo abiliti |
| `POST` | `/api/auth/device/token` | none (un codice dispositivo) | [Accesso da dispositivo](/docs/backend/device-sign-in/): polling del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Accesso da dispositivo](/docs/backend/device-sign-in/): cosa mostra la pagina di approvazione |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un secondo fattore) | [Accesso da dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Accesso da dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessioni ospite. Disattivato a meno che non sia impostato `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un ospite) | Trasforma un ospite in un account |
| `POST` | `/api/auth/find-user` | session | Disattivato a meno che non sia impostato `AUTH_ALLOW_USER_LOOKUP` — si tratta di una superficie di enumerazione |
| `POST` | `/api/auth/:provider` | none | Uno per ciascun provider OAuth/OIDC configurato |
| `POST` | `/api/auth/link/:provider` | session | Collega un provider all'account autenticato |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un login in corso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un ID challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Tutti gli scope noti a questo backend e quelli detenuti dal chiamante — [Ruoli e scope](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un account) | Le [chiavi personali](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | session (un account) | La chiave in testo non crittografato viene restituita una sola volta. `403 PERSONAL_KEYS_DISABLED` a meno che la tabella auth non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un account) | Revoca una delle chiavi del chiamante |
| `GET` | `/.well-known/jwks.json` | none | Il JWKS pubblico, quando è configurata la [firma asimmetrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Admin

Tutto ciò che si trova sotto `/api/admin` richiede uno scope del piano admin, e ciascuna
superficie specifica il proprio: `users:read` elenca gli account, `cron:write` attiva un job.
Un amministratore li detiene tutti, così come la chiave di servizio. Un utente detiene quelli
dichiarati dai suoi ruoli, e una chiave API quelli con cui è stata creata. Una chiave limitata a
una tabella non ha accesso a nulla di tutto ciò. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e solo finché non esiste alcun amministratore | Rifiutato in produzione — vedi [Bootstrap del primo utente](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestione utenti |
| `POST` | `/api/admin/users` | `users:write` | Gestione utenti. I ruoli superiori a quelli del chiamante vengono rifiutati |
| `POST` | `/api/admin/users/import` | `users:write` | [Importa gli account](/docs/backend/auth-endpoints/#importing-accounts) mantenendone gli ID: nessuna email, nessuna password a meno che non sia fornito il relativo hash bcrypt, ID o email già occupati saltati. Al massimo 100 per richiesta. I ruoli superiori a quelli del chiamante vengono rifiutati |
| `GET` | `/api/admin/users/pick` | `users:read`, o accesso in scrittura a una tabella con colonna `.userId()` | La [lettura dello user picker](/docs/backend/auth-endpoints/): solo ID, nome, email e avatar. Una tabella le cui regole di scrittura sono SQL grezzo non è considerata valida |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestione utenti |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che detiene più permessi del chiamante |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che detiene più permessi del chiamante |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emette una password temporanea |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Rimuove i secondi fattori e i codici di ripristino dell'account, termina le sue sessioni |
| `GET` | `/api/admin/guests` | `users:read` | Ospiti, ordinati a partire da quelli non visti da più tempo. `?lastSeenBefore=` li limita a ciò che l'eliminazione sottostante elaborerebbe, e `total` li conta |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un batch di ospiti visti l'ultima volta prima di `?lastSeenBefore=`, che è obbligatorio. Risponde con `{ deleted, skipped, remaining }`. Ripetere finché `remaining` non è 0, con `?offset=` impostato sul numero di quelli saltati. Gli account non possono essere toccati |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un ospite. Un account viene rifiutato con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e i ruoli dichiarati dal progetto, con i relativi scope |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Chiavi API](/docs/backend/api-keys/). Mai una chiave API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La chiave in testo non crittografato viene restituita una sola volta, al momento della creazione |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Chiavi API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Chiavi API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Chiavi API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron job](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron job](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Abilita o disabilita un job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron job](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Esegue un job adesso. `?async=1` risponde `202` una volta avviato — [API Cron Job](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario dei backup |
| `GET` | `/api/admin/backups/download` | `backups:read` | Trasmette in streaming un backup. Con `?token=` proveniente da un link di download, non è necessario alcun header, limitatamente a quel backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un link a un backup, `{ key }` → `{ url, token, expiresIn }`, valido per 60 secondi — [Backup](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Avvia una scansione per i file archiviati a cui nessuna riga fa riferimento, `?storageId=&olderThanHours=`, in background. Risponde `202` con il record della scansione: `id`, `status` (`queued`) e `runner` (`worker` quando è un job `storage.orphans` nella coda dei job, `in-process` quando il server lo esegue direttamente). Il suo record viene scritto nell'origine, sotto il percorso riservato `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Il record della scansione, `?storageId=`. Mentre è in esecuzione: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` di `collectionsTotal`, `unscanned`). Una volta `completed`: `result`, il report restituito dal vecchio `GET /orphans`. Un'esecuzione che ha smesso di inviare aggiornamenti per 10 minuti viene considerata `failed`. `404 STORAGE_SCAN_NOT_FOUND` quando l'origine non contiene tale scansione |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina gli orfani di una scansione completata in background, `202`. Ciascuno viene ricontrollato rispetto a ogni riga e voce di cronologia, e verificato di nuovo subito prima di essere eliminato. Il risultato è la proprietà `deletion` del record di scansione. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Deprecato: esegue la scansione all'interno della richiesta, `?storageId=&olderThanHours=`. Risponde con `Deprecation: true`. Usa `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Deprecato, senza `?scan=`: esegue nuovamente la scansione ed elimina all'interno della richiesta. `409 STORAGE_SCAN_INCOMPLETE` quando non è stato possibile leggere una tabella |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una cartella su un'altra sorgente mantenendo le stesse chiavi, una pagina per chiamata — ciò che invia `rebase storage move`; `400 STORAGE_SAME_LOCATION` per `deleteSource` tra due sorgenti archiviate nella stessa posizione |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Elenca nuovamente l'origine dopo uno spostamento, con lo stesso corpo, una pagina per chiamata: `{ checked, notMoved: [{ key, reason }], cursor? }` — ogni file ancora presente nell'origine con `deleteSource`, ogni file di cui la destinazione non ha una copia senza di esso. `rebase storage move` lo interroga al completamento dello spostamento |
| `GET` | `/api/admin/logs` | `logs:read` | Il buffer dei log recenti |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Le voci più recenti |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | L'ultimo risultato dell'audit pianificato |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Ruoli, ruoli di regola degli utenti e chiavi di servizio attive che un amministratore può simulare |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Ciascuna tabella come `{ role?, userId?, apiKeyId? }` la raggiunge: righe visibili rispetto a quelle del chiamante, nascoste da scope o RLS, campi mascherati. Solo per sessione dell'amministratore |
| `POST` | `/api/admin/sql/csv` | `database:write` | Trasmette in streaming l'intero risultato di una query in sola lettura come CSV — "Download full result as CSV" di [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Cosa ha modificato un [branch](/docs/backend/branching/#reviewing-and-merging-a-branch): schema, policy e righe, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Scrive le righe del branch nel rispettivo parent, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` se uno dei due lati è cambiato rispetto al diff o se ci sono conflitti tra righe |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Modifica dinamica dello schema](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Pianifica una modifica; non ne applica alcuna |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo un utente fisico, a meno che non sia impostato `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Pianifica l'attenuazione di `NOT NULL` e l'eliminazione delle colonne non dichiarate elencate in `drop`, per [schema reconcile](/docs/cli/schema/#rebase-schema-reconcile); non applica alcuna modifica |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applica un piano di riconciliazione, solo se il suo `digest` coincide con il `confirm` inviato |
| `POST` | `/api/admin/schema/reload` | `schema:write` | Esegue nuovamente l'introspezione di PostgreSQL e ricarica REST, Realtime, OpenAPI, policy di archiviazione, webhook, ruoli e job pianificati a caldo senza riavviare |
| `GET` | `/api/admin/db/tables` | `database:read` | Elenca le tabelle PostgreSQL dell'utente con colonne, indici, policy RLS e overlay `rebase.table_meta` |
| `POST` | `/api/admin/db/tables` | `database:write` | Crea una tabella PostgreSQL con policy RLS e metadati iniziali opzionali (`dryRun: true` genera un'anteprima dell'SQL), quindi ricarica a caldo |
| `PATCH` | `/api/admin/db/tables/:table` | `database:write` | Rinomina una tabella, attiva/disattiva Row Level Security (`rlsEnabled`) o aggiorna le impostazioni dell'overlay API `rebase.table_meta` (`meta`), quindi ricarica a caldo |
| `DELETE` | `/api/admin/db/tables/:table` | `database:write` | Elimina una tabella PostgreSQL (richiede `{ confirm: "<table>" }` a meno che non sia `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/columns` | `database:write` | Aggiunge una colonna a una tabella PostgreSQL e ricarica a caldo |
| `PATCH` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Modifica una colonna (rinomina, tipo, supporto per valori null, valore predefinito) e ricarica a caldo |
| `DELETE` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Elimina una colonna (richiede `{ confirm: "<column>" }` a meno che non sia `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/indexes` | `database:write` | Crea un indice su una tabella PostgreSQL |
| `DELETE` | `/api/admin/db/tables/:table/indexes/:index` | `database:write` | Elimina un indice su una tabella PostgreSQL |
| `POST` | `/api/admin/db/tables/:table/policies` | `database:write` | Crea una policy RLS di PostgreSQL su una tabella e ricarica a caldo |
| `DELETE` | `/api/admin/db/tables/:table/policies/:policy` | `database:write` | Elimina una policy RLS di PostgreSQL su una tabella e ricarica a caldo |
| `GET` | `/api/admin/storage/policies` | `database:read` | Elenca le policy di archiviazione dichiarative zero-code da `rebase.storage_policies` |
| `POST` | `/api/admin/storage/policies` | `database:write` | Crea una policy dichiarativa di accesso allo storage |
| `PATCH` | `/api/admin/storage/policies/:id` | `database:write` | Aggiorna una policy dichiarativa di accesso allo storage |
| `DELETE` | `/api/admin/storage/policies/:id` | `database:write` | Elimina una policy dichiarativa di accesso allo storage |
| `GET` | `/api/admin/webhooks` | `database:read` | Elenca i webhook del database zero-code da `rebase.webhooks` |
| `POST` | `/api/admin/webhooks` | `database:write` | Crea un webhook del database |
| `PATCH` | `/api/admin/webhooks/:id` | `database:write` | Aggiorna un webhook del database |
| `DELETE` | `/api/admin/webhooks/:id` | `database:write` | Elimina un webhook del database |
| `POST` | `/api/admin/webhooks/:id/test` | `database:write` | Invia una consegna di test in tempo reale a un endpoint webhook configurato |
| `GET` | `/api/admin/roles` | `users:read` | Elenca ruoli e scope RBAC zero-code da `rebase.roles` |
| `POST` | `/api/admin/roles` | `users:write` | Crea o aggiorna un ruolo RBAC zero-code |
| `PUT` | `/api/admin/roles/:name` | `users:write` | Aggiorna un ruolo RBAC zero-code |
| `DELETE` | `/api/admin/roles/:name` | `users:write` | Elimina un ruolo RBAC zero-code |
| `GET` | `/api/admin/cron/jobs` | `cron:read` | Elenca i job SQL/HTTP pianificati zero-code da `rebase.cron_jobs` |
| `POST` | `/api/admin/cron/jobs` | `cron:write` | Crea un cron job pianificato SQL o HTTP zero-code. Un job SQL esegue la propria istruzione come connessione propria del server, quindi richiede anche `database:write` |
| `PATCH` | `/api/admin/cron/jobs/:id` | `cron:write` | Aggiorna un cron job pianificato zero-code; un job SQL, o uno che lo stia diventando, richiede anche `database:write` |
| `DELETE` | `/api/admin/cron/jobs/:id` | `cron:write` | Elimina un cron job pianificato zero-code |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indica se l'editor è disponibile e il motivo qualora non lo sia |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Ogni tabella esportata da `backend/schema/index.ts` così come letta dall'editor, con ciò che viene modificato nel codice (sola lettura) e il motivo — [Modifica dinamica dello schema](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: i file che la modifica scriverebbe, compilati; non scrive nulla |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | La stessa modifica, scritta in `backend/schema`; il database non viene toccato |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tabelle presenti nel database e non dichiarate in `backend/schema`: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Una di esse descritta: `{ table: { …, descriptor, rlsRaised?, notes } }`, per "Import an existing table". `404` se sconosciuta o già dichiarata, `400 SCHEMA_EDIT_REFUSED` in assenza di una chiave primaria |
| `GET` | `/api/admin/ui-config` | session | Le preferenze UI dell'area di lavoro per tabella, quelle del chiamante e se il chiamante può modificare quelle dell'area di lavoro — vedi [Personalizzazione di una tabella](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Unisce un delta `UiTablePreferences` nelle preferenze dell'area di lavoro di una tabella (`replace` sostituisce). Scritto in `frontend/src/cms/ui-config.json` se il server può scrivere nel sorgente del progetto, altrimenti in `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Rimuove le preferenze dell'area di lavoro per una tabella |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (un utente) | Le preferenze del chiamante per una tabella. Una chiave API non ne ha: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (un utente) | Rimuove le preferenze del chiamante per una tabella |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Email acquisite dal transport di sviluppo anziché inviate |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Svuota la casella di posta delle email acquisite |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` sono serviti anche
nei rispettivi percorsi precedenti alla versione 0.17 senza il segmento `/admin`. Questi alias
sono destinati ai progetti che non sono stati migrati; scrivi nuovo codice utilizzando il percorso canonico.

## Schema

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, o una credenziale con `schema:read` o uno scope `data:*` | Ogni tabella servita da questo backend, come array JSON di descrittori redatti per il chiamante |
| `GET` | `/api/schema/tables/:slug` | come sopra | Un descrittore. `404 TABLE_NOT_FOUND` quando a questo chiamante non viene servita quella tabella |

I descrittori sono ciò da cui il CMS esegue il rendering dei propri valori predefiniti, da cui Studio
ricava il visualizzatore dello schema e l'editor RLS, e da cui le app MCP
eseguono il rendering di tabelle e moduli. Contengono le colonne con i relativi tipi Postgres,
la supporto di valori null, le regole di convalida e archiviazione, le relazioni per slug e la
configurazione della row-level security. Il codice degli hook non lascia mai il server: un descrittore
indica solo quali hook possiede una tabella.

Ciò che viene restituito a un chiamante dipende dalla sua identità:

| Chiamante | Tabelle | Redatto |
|---|---|---|
| Un amministratore, un titolare di `schema:read`, o la chiave di servizio | ogni tabella, incluse le viste semplici | colonne `.private()`, per tutti |
| Qualsiasi altro utente autenticato, inclusi gli ospiti | solo le tabelle raggiungibili da una regola permissiva per i rispettivi ruoli (più la tabella auth e le viste materializzate di cui detengono i `roles`) | colonne e relazioni per cui i rispettivi ruoli non soddisfano `access.read`; colonne `.private()`; solo le regole applicabili ai rispettivi ruoli; relazioni verso tabelle non servite; flag degli hook; SQL grezzo in regole, policy compilate, query di viste e indici |
| Una credenziale (chiave API, token MCP o token di piattaforma) | le tabelle indicate dai relativi scope `data:*`, o tutte con `schema:read` | come sopra, valutato in base agli scope posseduti |
| Nessun utente autenticato | nessuna — `401` — a meno che il backend non imposti `schemaTables: { public: true }` | in tal caso, le tabelle con una regola `select` pubblica, redatte come per il chiamante con privilegi minimi: nessuna colonna con elenco `access.read`, nessun SQL grezzo, nessuna policy |

Un utente mantiene `metadata`, `softDelete`, `tenant`, `history` e `search` sulle
tabelle che gli vengono servite. `schemaTables: { persons: "all" }` nelle opzioni del backend
descrive ogni tabella e regola a ogni chiamante autenticato; il
valore predefinito è `"granted"`. Le connessioni MCP vengono valutate come
credenziale, dallo stesso serializzatore.

L'identità del chiamante proviene dall'adapter di autenticazione del backend, lo stesso interrogato dalle
route dei dati, quindi un backend con un [adapter personalizzato](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
viene servito qui (e su `/api/docs` e in ogni superficie admin) con i ruoli restituiti dal
suo adapter; una credenziale non riconosciuta restituisce `401`.

Una credenziale che non possiede né `schema:read` né uno scope `data:*` riceve
`403 SCOPE_MISSING`. Un backend senza autenticazione configurata risponde
a ogni richiesta con `404 SCHEMA_UNAVAILABLE`: non c'è alcun chiamante per cui redigere le informazioni, e
`auth.requireAuth: false` non modifica questo comportamento.

Le risposte includono `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` e l'header `x-rebase-schema`; una richiesta il cui `If-None-Match`
corrisponde al tag corrente riceve `304`. Il tag cambia quando cambia lo schema,
anche dopo una modifica dello schema a caldo.

`schemaTables` è un'opzione di `initializeRebaseBackend` senza variabile
d'ambiente: un progetto generato vi accede tramite eject.

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
| `GET` | `/api/storage/sources` | session | Le origini di storage con nome servite da questo backend |
| `OPTIONS` | `/api/storage/tus` | none | Caricamenti ripristinabili: le versioni e le estensioni TUS supportate da questo server |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Caricamenti ripristinabili: creazione |
| `GET` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: offset |
| `PATCH` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: aggiunta (append) |
| `DELETE` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: annullamento |

Un deployment senza storage configurato risponde su questo prefisso con un `501` indicando la
variabile necessaria, anziché restituire un 404 come se la funzionalità non esistesse —
fatta eccezione per `GET /api/storage/sources`, che risponde `200` con un elenco vuoto.

## Push

Montato solo con `push: true` (`REBASE_PUSH=true`). Con il push abilitato ma senza chiavi,
ogni route risponde `503 PUSH_NOT_CONFIGURED`. Le chiavi API e la chiave di servizio vengono
rifiutate: una sottoscrizione appartiene al browser di un utente.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/push/key` | session | La chiave pubblica VAPID — [Notifiche push](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Questo browser accetta le notifiche, per il chiamante — [Notifiche push](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Le interrompe, sul browser del chiamante — [Notifiche push](/docs/backend/push-notifications/#routes) |

## Funzioni

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/functions` | session | I nomi delle funzioni servite e quanti file non sono stati caricati |
| qualsiasi | `/api/functions/<name>` | qualsiasi cosa dichiari la funzione. Una chiave API necessita inoltre di `functions:invoke` | [Funzioni personalizzate](/docs/backend/custom-functions/) |

Una route per ciascun file sotto `backend/functions/`, quindi i percorsi provengono dal tuo
progetto. `GET /api/functions` li elenca solo a un chiamante autenticato — una
sessione, una chiave API o la chiave di servizio — e risponde a chiunque altro con `401`: un
inventario degli endpoint personalizzati di un deployment non è pubblico.

## RPC

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/rpc/<name>` | l'`access` della RPC: none per `"public"` (con limitazione della frequenza), session per `"authenticated"`; poi RLS all'interno della funzione. Una chiave API necessita inoltre di `data:read` (`data:write` per una RPC con `write: true`) | [Funzioni SQL come RPC](/docs/backend/rpc/) |

Una route per ogni `defineRpc` esportato da `backend/schema/index.ts`, quindi i
percorsi provengono dal tuo progetto. Un nome non dichiarato risponde con `404
RPC_NOT_FOUND`, anche se il database contiene una funzione con tale nome.

## Meta e operazioni

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/livez` | none | Solo liveness: indica se il processo è in esecuzione. Non tocca il database, motivo per cui è il percorso di probe che un container dovrebbe utilizzare — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Riporta ogni data source configurato, non solo quello predefinito |
| `GET` | `/api/docs` | il pubblico dell'endpoint dello schema per impostazione predefinita (401 anonimo a meno che non sia `schemaTables.public`, 403 per una credenziale priva di uno scope schema o data); none quando `enableSwagger` è `true`; il gate admin quando `false` | Il documento OpenAPI 3.0 delle tabelle che `GET /api/schema/tables` descrive al chiamante (tutte con `enableSwagger: true`). `404 DOCS_UNAVAILABLE` quando non è configurata alcuna autenticazione |
| `GET` | `/api/swagger` | none | Swagger UI. Solo quando `enableSwagger` è `true`, e mai in produzione |
| `GET` | `/api/meta/schema-version` | none | L'hash dello schema da cui è stato compilato questo backend e la versione di runtime, e nient'altro |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — ogni tabella così come la vede un amministratore, l'input di `rebase generate-sdk --from`. `404` quando non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando impostato | Metriche Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando impostato | Le serie registrate alla base dei grafici di Studio. `501` su un runtime senza backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN` quando impostato | Fino a 16 serie registrate contemporaneamente, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, raggruppate in bucket. Include richieste al minuto ed errori per superficie. `501` su un runtime senza backend |

Le connessioni WebSocket arrivano come upgrade HTTP sullo stesso server anziché su
un percorso dedicato — vedi [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montato solo quando `REBASE_MCP_ENABLED=true`, che richiede anche
`REBASE_PUBLIC_URL` — vedi
[Configurazione](/docs/getting-started/configuration/#mcp-surface). Disattivato per
impostazione predefinita: nessun `REBASE_ROLE` lo attiva, poiché concede l'accesso al progetto a
software di terze parti e questa è una decisione che spetta a una persona.

I documenti `.well-known` risiedono all'**origine**, non sotto `basePath`: RFC 8414
e RFC 9728 definiscono tali percorsi rispetto all'origine e un client li recupera
prima di possedere alcun token.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadati RFC 9728 che indicano questa risorsa e il relativo server di autorizzazione. Serviti anche nel formato con suffisso di percorso |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadati RFC 8414: gli endpoint, i grant type e i metodi PKCE supportati da questo deployment |
| `POST` | `/mcp` | OAuth bearer, o una chiave API | L'endpoint del protocollo MCP. Agisce **come l'utente autenticato** (o come l'entità per cui agisce la chiave), quindi ogni lettura e scrittura è soggetta alla stessa RLS. Gli scope `data:*` determinano quali strumenti vengono offerti |
| `GET` | `/mcp` | OAuth bearer, o una chiave API | Risponde `405` con `Allow: POST, DELETE`: questo server non avvia alcuno stream avviato dal server. Il token viene verificato per primo, quindi un token mancante o non valido riceve invece la richiesta di autenticazione `401` |
| `DELETE` | `/mcp` | none | Risponde `204`. L'endpoint non mantiene alcuna sessione, quindi non c'è nulla da terminare |
| `POST` | `/api/oauth/register` | con limitazione della frequenza | Registrazione dinamica dei client RFC 7591. Rifiutata quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La schermata di consenso a cui viene reindirizzato il client |
| `POST` | `/api/oauth/authorize/decision` | session | La risposta dell'utente — approva o rifiuta |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Scambia un authorization code, oppure effettua il refresh |
| `POST` | `/api/oauth/revoke` | client credentials | Revoca del token RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quali client sono stati approvati da questo utente |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Ne revoca uno, consentendo a un utente di revocare un consenso senza richiedere l'intervento di un amministratore |

L'endpoint MCP del pannello di amministrazione non fa parte di questa superficie: accetta la
sessione del pannello di amministrazione, mai un token OAuth, ed è montato con le
route admin indipendentemente dal fatto che `REBASE_MCP_ENABLED` sia impostato o meno, su un driver che applica
RLS a ciascuna chiamata.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, mai anonimo | **Sperimentale.** Gli stessi strumenti di `/mcp`, per l'utente autenticato, con `data:read`, `data:write` e `data:delete`, secondo la propria RLS. La vista `savedAppsView` del pannello di amministrazione apre le [applicazioni salvate](/docs/ai/remote-mcp/) attraverso di esso |

## Risorse correlate

- [API REST](/docs/backend/api/) — le route dei dati complete: filtri, ordinamento, paginazione, errori
- [Endpoint di autenticazione](/docs/backend/auth-endpoints/) — formati di richiesta e risposta per la tabella di autenticazione precedente
- [Ambiente e configurazione](/docs/getting-started/configuration/) — le variabili che determinano quali di queste vengono montate

---
sourceHash: eef9ab9f670101c8
title: Indice degli endpoint
sidebar_label: Indice degli endpoint
description: Tutte le route HTTP montate da un backend Rebase — dati, autenticazione, archiviazione, amministrazione, meta — con il gate associato a ciascuna e la pagina esplicativa.
---

Tutte le route montate dal server, in un'unica tabella, con i requisiti necessari per raggiungerle.

I percorsi presuppongono il `basePath` predefinito `/api`; `REBASE_BASE_PATH` li sposta
tutti insieme. `/health`, `/livez` e `/metrics` risiedono intenzionalmente al di fuori di esso,
poiché un orchestratore esegue probe su `/health` e non dovrebbe dover conoscere il percorso
di base. `/health` è *anche* montato sotto di esso, in modo che `/api/health` risponda allo
stesso modo anziché restituire un errore 404 proprio nel momento in cui qualcuno sta verificando
se il server è attivo.

Un gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — confronta questa
tabella con le route registrate dal codice sorgente, impedendo che una nuova superficie
venga aggiunta senza comparire qui.

## Gate

| Gate | Significato |
|---|---|
| **none** | Non autenticato. Chiunque possa raggiungere l'host può chiamarlo |
| **session** | Un chiamante autenticato: un token di accesso o una chiave API con ambito limitato all'operazione |
| **`resource:action`** | Un chiamante in possesso di tale [scope](/docs/backend/roles-and-scopes/): un amministratore, un utente il cui ruolo lo dichiara, una chiave API creata con esso o la chiave di servizio |
| **RLS** | Autenticato, dopodiché il database decide riga per riga — vedi [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montato solo al di fuori dell'ambiente di produzione |

## Data

Generato per tabella, quindi i percorsi contengono i tuoi slug invece di un
elenco fisso. `:slug` è lo slug di una tabella (il suo nome, a meno che `defineTable` non imposti `slug`).

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Interrogazione](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | L'elenco, con i parametri di query nel corpo — [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Interrogazione](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Il conteggio, con i parametri di query nel corpo — [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Ricalcola una vista materializzata, per le viste che sono materializzate — [Viste](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias deprecato di `PATCH` — stessa scrittura parziale, risponde con `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserisce più righe, opzionalmente con upsert — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Aggiorna più righe per id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina più righe per id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Scrittura su più tabelle in una singola transazione — [Scrittura tramite REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Cronologia entità](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Cronologia entità](/docs/backend/history/) |

`:id` è la chiave della riga. In una tabella con chiave composita, corrisponde al valore
di ciascuna colonna della chiave, nell'ordine della chiave stessa, unito da `:::` (con ogni
parte codificata come URL): una tabella con chiave su `(agency_id, id)` indirizza una riga come
`/api/data/proposals/<agency_id>:::<id>`. Un indirizzo con un numero errato di
parti viene rifiutato con `400 COMPOSITE_KEY_ADDRESS`, specificando le colonne della chiave.

Conteggio e aggregazione sono route a sé stanti, registrate prima di `/:id` in
modo che `aggregate` non venga interpretato come l'id di un'entità. `?select=` e `?groupBy=` sono
i loro parametri, e `select` è obbligatorio su `/aggregate`.

La ricerca testuale, la ricerca vettoriale, l'inclusione di relazioni e la selezione dei campi
*sono* parametri di query su `GET /api/data/:slug` anziché route separate — `searchString`,
`vector_search`, `include`, `fields`. Vedi [API REST](/docs/backend/api/).

Un progetto che non dichiara alcuna tabella e non ne esamina nessuna tramite introspezione gestisce questo prefisso
restituendo un singolo `404 NO_TABLES`. Vedi [Solo backend](/docs/getting-started/headless/).

## Auth

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Cosa può offrire la schermata di accesso: registrazione, reimpostazione della password, magic link, codici email, accesso ospite, provider OAuth e se la configurazione del primo amministratore è in sospeso |
| `POST` | `/api/auth/register` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un refresh token) | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoca tutte le altre sessioni |
| `DELETE` | `/api/auth/sessions/:id` | session | Ne revoca una |
| `POST` | `/api/auth/forgot-password` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un token di reimpostazione) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Invia un link di conferma via email al nuovo indirizzo — [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un token di collegamento) | Sposta l'account sul nuovo indirizzo — [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticazione](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token di verifica) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token di verifica e una sessione o la password per mantenerla) | [Verifica email](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token di collegamento) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codici monouso via email |
| `POST` | `/api/auth/otp/verify` | none (un codice) | Codici monouso via email |
| `POST` | `/api/auth/device` | none | [Accesso da dispositivo](/docs/backend/device-sign-in/). Disattivato a meno che il backend non lo abiliti |
| `POST` | `/api/auth/device/token` | none (un codice dispositivo) | [Accesso da dispositivo](/docs/backend/device-sign-in/): il polling del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Accesso da dispositivo](/docs/backend/device-sign-in/): cosa mostra la pagina di approvazione |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un secondo fattore) | [Accesso da dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Accesso da dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessioni ospite. Disattivato a meno che non sia impostato `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un ospite) | Trasforma un ospite in un account |
| `POST` | `/api/auth/find-user` | session | Disattivato a meno che non sia impostato `AUTH_ALLOW_USER_LOOKUP` — costituisce una superficie di enumerazione |
| `POST` | `/api/auth/:provider` | none | Uno per ciascun provider OAuth/OIDC configurato |
| `POST` | `/api/auth/link/:provider` | session | Collega un provider all'account attualmente connesso |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un accesso in corso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un id di challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Tutti gli scope noti a questo backend e quelli detenuti dal chiamante — [Ruoli e scope](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un account) | Le [chiavi personali](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | session (un account) | La chiave in testo non crittografato viene restituita una sola volta. `403 PERSONAL_KEYS_DISABLED` a meno che la tabella di autenticazione non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un account) | Revoca una delle chiavi dell'utente chiamante |
| `GET` | `/.well-known/jwks.json` | none | Il JWKS pubblico, quando è configurata la [firma asimmetrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Admin

Tutto ciò che risiede sotto `/api/admin` richiede uno scope dal piano di amministrazione e ciascuna
superficie specifica il proprio: `users:read` elenca gli account, `cron:write` attiva un job.
Un amministratore li detiene tutti, così come la chiave di servizio. Un utente possiede quelli
dichiarati dai propri ruoli, mentre una chiave API quelli con cui è stata creata. Una chiave limitata all'ambito
di una tabella non può accedere a nulla di tutto ciò. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e solo se non esiste alcun amministratore | Rifiutato in produzione — vedi [Bootstrap del primo utente](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestione utenti |
| `POST` | `/api/admin/users` | `users:write` | Gestione utenti. I ruoli superiori a quelli del chiamante vengono rifiutati |
| `GET` | `/api/admin/users/pick` | `users:read`, o accesso in scrittura a una tabella con colonna `.userId()` | La [lettura per il selettore utenti](/docs/backend/auth-endpoints/): solo id, nome, email e avatar. Una tabella le cui regole di scrittura sono in SQL grezzo non viene considerata |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestione utenti |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che detiene più permessi del chiamante |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che detiene più permessi del chiamante |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emette una password temporanea |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Rimuove i secondi fattori e i codici di ripristino dell'account, termina le sue sessioni |
| `GET` | `/api/admin/guests` | `users:read` | Ospiti, ordinati a partire da quelli visti meno di recente. `?lastSeenBefore=` li restringe a ciò che l'eliminazione sottostante rimuoverebbe e `total` ne fornisce il conteggio |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un batch di ospiti visti l'ultima volta prima di `?lastSeenBefore=`, che è obbligatorio. Risponde con `{ deleted, skipped, remaining }`. Ripetere finché `remaining` non è 0, con `?offset=` impostato sul numero di elementi saltati. Gli account non possono essere raggiunti |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un singolo ospite. Un account viene rifiutato con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e i ruoli dichiarati dal progetto, con i relativi scope |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Chiavi API](/docs/backend/api-keys/). Mai tramite una chiave API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La chiave in testo non crittografato viene restituita una sola volta, al momento della creazione |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Chiavi API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Chiavi API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Chiavi API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron job](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron job](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Abilita o disabilita un job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron job](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Esegue un job adesso. `?async=1` risponde con `202` una volta avviato — [API dei cron job](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario dei backup |
| `GET` | `/api/admin/backups/download` | `backups:read` | Trasmette in streaming un backup. Con `?token=` ottenuto da un link di download, non è richiesta alcuna intestazione, limitatamente a quel backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un link a un backup, `{ key }` → `{ url, token, expiresIn }`, valido per 60 secondi — [Backup](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Avvia una scansione in background per i file archiviati a cui nessuna riga fa riferimento, `?storageId=&olderThanHours=`. Risponde con `202` e il record della scansione: `id`, `status` (`queued`) e `runner` (`worker` quando si tratta di un job `storage.orphans` nella coda dei job, `in-process` quando il server lo esegue direttamente). Il record viene scritto nell'origine dati, sotto il percorso riservato `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Il record della scansione, `?storageId=`. Durante l'esecuzione: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` su `collectionsTotal`, `unscanned`). Una volta `completed`: `result`, il report restituito dalla precedente `GET /orphans`. Un'esecuzione che smette di inviare segnalazioni per 10 minuti viene considerata `failed`. `404 STORAGE_SCAN_NOT_FOUND` se la sorgente non contiene tale scansione |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina in background gli orfani di una scansione completata, restituendo `202`. Ciascun file viene ricontrollato rispetto a ogni riga e voce di cronologia e nuovamente verificato subito prima dell'eliminazione. Il risultato è registrato nel campo `deletion` del record di scansione. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Deprecato: la scansione avviene all'interno della richiesta, `?storageId=&olderThanHours=`. Risponde con `Deprecation: true`. Usare `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Deprecato, senza `?scan=`: esegue nuovamente la scansione ed elimina all'interno della richiesta. `409 STORAGE_SCAN_INCOMPLETE` quando non è stato possibile leggere una tabella |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una cartella in un'altra sorgente mantenendo le stesse chiavi, una pagina per chiamata — ciò che invia `rebase storage move`; `400 STORAGE_SAME_LOCATION` per `deleteSource` tra due sorgenti che archiviano nella stessa posizione |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Elenca nuovamente la sorgente dopo uno spostamento, con lo stesso corpo, una pagina per chiamata: `{ checked, notMoved: [{ key, reason }], cursor? }` — ogni file ancora presente nella sorgente con `deleteSource`, ogni file di cui la destinazione non possiede una copia senza di essa. Viene interrogato da `rebase storage move` al termine dello spostamento |
| `GET` | `/api/admin/logs` | `logs:read` | Il buffer dei log recenti |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Le voci più recenti |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | L'ultimo risultato dell'audit pianificato |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Ruoli, ruoli di regola degli utenti e chiavi di servizio attive che un amministratore può simulare |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Ciascuna tabella nel modo in cui `{ role?, userId?, apiKeyId? }` vi accede: righe visibili rispetto a quelle del chiamante, nascoste da scope o RLS, campi mascherati. Solo per sessioni di amministratore |
| `POST` | `/api/admin/sql/csv` | `database:write` | Trasmette in streaming l'intero risultato di una query in sola lettura come CSV — opzione "Scarica il risultato completo come CSV" di [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Cosa ha modificato un [branch](/docs/backend/branching/#reviewing-and-merging-a-branch): schema, criteri e righe, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Scrive le righe del branch nel relativo parent, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` se uno dei due lati è cambiato rispetto al diff o se ci sono conflitti tra righe |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Modifica dello schema in tempo reale](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Pianifica una modifica; non ne applica mai alcuna |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo un utente fisico, a meno che non sia impostato `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Pianifica la rimozione del vincolo `NOT NULL` e l'eliminazione delle colonne non dichiarate indicate in `drop`, per la [riconciliazione dello schema](/docs/cli/schema/#rebase-schema-reconcile); non applica mai alcuna modifica |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applica un piano di riconciliazione, solo se il relativo `digest` corrisponde al valore `confirm` inviato |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indica se l'editor è disponibile e il motivo qualora non lo sia |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Ogni tabella esportata da `backend/schema/index.ts` così come letta dall'editor, con l'indicazione di cosa viene modificato nel codice (in sola lettura) e del perché — [Modifica dello schema in tempo reale](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: i file che la modifica scriverebbe, compilati; non scrive nulla |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | La stessa modifica, scritta in `backend/schema`; il database non viene toccato |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tabelle presenti nel database ma non dichiarate in `backend/schema`: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Una di esse descritta: `{ table: { …, descriptor, rlsRaised?, notes } }`, per "Importa una tabella esistente". `404` se sconosciuta o già dichiarata, `400 SCHEMA_EDIT_REFUSED` in assenza di una chiave primaria |
| `GET` | `/api/admin/ui-config` | session | Le preferenze UI dell'area di lavoro per tabella, quelle del chiamante e se il chiamante ha i permessi di scrittura su quelle dell'area di lavoro — vedi [Studio](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Unisce un delta di `UiTablePreferences` nelle preferenze dell'area di lavoro di una tabella (`replace` sostituisce). Scritto in `frontend/src/cms/ui-config.json` se il server può scrivere nel codice sorgente del progetto, altrimenti in `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Rimuove le preferenze dell'area di lavoro di una tabella |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (un utente fisico) | Le preferenze personali del chiamante per una tabella. Una chiave API non ne possiede alcuna: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (un utente fisico) | Rimuove le preferenze personali del chiamante per una tabella |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Email catturate dal transport di sviluppo anziché inviate |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Svuota la casella di posta delle email catturate |

Anche `/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` vengono
serviti ai loro percorsi precedenti alla versione 0.17, privi del segmento `/admin`. Questi alias sono
destinati ai progetti che non sono ancora stati migrati; per il nuovo codice si consiglia di utilizzare il percorso canonico.

## Schema

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, o una credenziale con `schema:read` o uno scope `data:*` | Ogni tabella gestita da questo backend, come array JSON di descrittori oscurati in base al chiamante |
| `GET` | `/api/schema/tables/:slug` | come sopra | Un singolo descrittore. `404 TABLE_NOT_FOUND` quando questa tabella non viene servita al chiamante |

I descrittori sono gli elementi da cui il CMS genera le proprie impostazioni predefinite, da cui lo Studio
ricava il visualizzatore di schemi e l'editor RLS, e da cui le app MCP
renderizzano tabelle e moduli. Contengono le colonne con i rispettivi tipi Postgres,
l'ammissibilità di valori nulli (nullability), le regole di convalida e archiviazione, le relazioni per slug e la
postura di sicurezza a livello di riga (RLS). Il codice degli hook non lascia mai il server: un descrittore
indica unicamente quali hook possiede una tabella.

Ciò che viene fornito a un chiamante dipende dalla sua identità:

| Chiamante | Tabelle | Elementi oscurati |
|---|---|---|
| Un amministratore, un titolare di `schema:read` o la chiave di servizio | ogni tabella, incluse le viste semplici | colonne `.private()`, per tutti |
| Qualsiasi altro utente autenticato, inclusi gli ospiti | solo le tabelle raggiungibili da una regola permissiva per i loro ruoli (oltre alla tabella auth e alle viste materializzate di cui possiedono i `roles`) | colonne e relazioni per cui i loro ruoli non superano `access.read`; colonne `.private()`; solo le regole applicabili ai loro ruoli; relazioni verso tabelle a cui non hanno accesso; flag degli hook; SQL grezzo nelle regole, criteri compilati, query di viste e indici |
| Una credenziale (chiave API, token MCP o di piattaforma) | le tabelle specificate dai suoi scope `data:*`, o tutte quante con `schema:read` | come sopra, valutato in base agli scope posseduti |
| Nessun utente autenticato | nessuna — `401` — a meno che il backend non imposti `schemaTables: { public: true }` | in tal caso le tabelle con una regola `select` pubblica, oscurate come per il chiamante con i privilegi minimi: nessuna colonna con un elenco `access.read`, nessun SQL grezzo, nessun criterio |

Un utente conserva `metadata`, `softDelete`, `tenant`, `history` e `search` sulle
tabelle a cui ha accesso. L'opzione `schemaTables: { persons: "all" }` nelle opzioni
del backend descrive ogni tabella e regola a qualsiasi chiamante autenticato; il
valore predefinito è `"granted"`. Le connessioni MCP vengono valutate come
credenziali, dallo stesso serializzatore.

L'identità del chiamante è determinata dall'adapter di autenticazione del backend, lo stesso interrogato dalle
route dati; pertanto, un backend con un [adapter personalizzato](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
viene gestito qui (e su `/api/docs` e su ogni superficie admin) con i ruoli restituiti dal
relativo adapter; una credenziale non riconosciuta restituisce `401`.

Una credenziale priva sia di `schema:read` che di uno scope `data:*` riceve
`403 SCOPE_MISSING`. Un backend privo di autenticazione configurata risponde a
ogni richiesta con `404 SCHEMA_UNAVAILABLE`: non c'è alcun chiamante per cui oscurare i dati, e
l'impostazione `auth.requireAuth: false` non modifica tale comportamento.

Le risposte includono `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` e l'intestazione `x-rebase-schema`; una richiesta il cui header `If-None-Match`
specifica il tag corrente riceve un codice `304`. Il tag cambia ogni volta che lo schema viene modificato,
anche a seguito di una modifica dello schema in tempo reale.

`schemaTables` è un'opzione di `initializeRebaseBackend` priva di variabile
d'ambiente: un progetto generato tramite scaffolding vi accede eseguendo l'operazione di eject.

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
| `GET` | `/api/storage/sources` | session | Le sorgenti di archiviazione denominate gestite da questo backend |
| `OPTIONS` | `/api/storage/tus` | none | Caricamenti ripristinabili: le versioni e le estensioni TUS supportate da questo server |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Caricamenti ripristinabili: creazione |
| `GET` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: offset |
| `PATCH` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: aggiunta (append) |
| `DELETE` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: annullamento |

Un deployment senza archiviazione configurata gestisce questo prefisso restituendo un codice `501` che indica la
variabile necessaria, anziché restituire 404 come se la funzionalità non esistesse —
fatta eccezione per `GET /api/storage/sources`, che risponde con `200` e un elenco vuoto.

## Push

Montato solo con `push: true` (`REBASE_PUSH=true`). Con il push attivo ma senza chiavi configurate,
ogni route risponde con `503 PUSH_NOT_CONFIGURED`. Le chiavi API e la chiave di servizio vengono
rifiutate: una sottoscrizione appartiene al browser di un utente.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/push/key` | session | La chiave pubblica VAPID — [Notifiche push](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Questo browser riceve notifiche per il chiamante — [Notifiche push](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Le interrompe sul browser del chiamante stesso — [Notifiche push](/docs/backend/push-notifications/#routes) |

## Functions

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/functions` | session | I nomi delle funzioni gestite e quanti file non sono stati caricati |
| qualsiasi | `/api/functions/<name>` | qualsiasi cosa la funzione dichiari. Una chiave API necessita inoltre di `functions:invoke` | [Funzioni personalizzate](/docs/backend/custom-functions/) |

Una route per ciascun file presente in `backend/functions/`, quindi i percorsi provengono dal tuo
progetto. `GET /api/functions` le elenca solo a un chiamante autenticato — una
sessione, una chiave API o la chiave di servizio — e risponde a chiunque altro con `401`: un
inventario degli endpoint personalizzati di un deployment non è pubblico.

## Meta e operazioni

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/livez` | none | Solo liveness: verifica se questo processo è in esecuzione. Non tocca il database, motivo per cui è il percorso di probe che un container dovrebbe utilizzare — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Segnala ogni data source configurata, non solo quella predefinita |
| `GET` | `/api/docs` | il pubblico dell'endpoint schema per impostazione predefinita (401 per anonimi a meno di `schemaTables.public`, 403 per una credenziale senza scope di schema o di dati); none quando `enableSwagger` è `true`; il gate admin quando è `false` | Il documento OpenAPI 3.0 delle tabelle che `GET /api/schema/tables` descrive al chiamante (tutte con `enableSwagger: true`). `404 DOCS_UNAVAILABLE` quando non è configurata alcuna autenticazione |
| `GET` | `/api/swagger` | none | Swagger UI. Solo quando `enableSwagger` è `true`, e mai in produzione |
| `GET` | `/api/meta/schema-version` | none | L'hash dello schema da cui è stato compilato questo backend e la versione del runtime, e nient'altro |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — ogni tabella così come la vede un amministratore, l'input di `rebase generate-sdk --from`. `404` quando non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando impostato | Metriche Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando impostato | Le serie registrate alla base dei grafici di Studio. `501` su un runtime privo di backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN` quando impostato | Fino a 16 serie registrate insieme, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, raggruppate per intervallo. Include richieste ed errori al minuto per superficie. `501` su un runtime privo di backend |

Le connessioni WebSocket arrivano come upgrade HTTP sullo stesso server anziché su
un percorso dedicato — vedi [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montato solo quando `REBASE_MCP_ENABLED=true`, il che richiede anche
`REBASE_PUBLIC_URL` — vedi
[Configurazione](/docs/getting-started/configuration/#mcp-surface). Disattivato per
impostazione predefinita: nessun `REBASE_ROLE` lo attiva, poiché concede l'accesso al progetto a
software di terze parti e questa è una decisione che spetta a un utente.

I documenti `.well-known` si trovano all'**origine**, non sotto `basePath`: le RFC 8414
e RFC 9728 definiscono tali percorsi rispetto all'origine e un client li richiede
prima di possedere alcun token.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadati RFC 9728 che indicano questa risorsa e il relativo server di autorizzazione. Servito anche nella forma con suffisso del percorso |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadati RFC 8414: gli endpoint, i tipi di autorizzazione (grant type) e i metodi PKCE supportati da questo deployment |
| `POST` | `/mcp` | Bearer OAuth o una chiave API | L'endpoint del protocollo MCP. Agisce **come l'utente autenticato** (o come chiunque sia rappresentato dalla chiave), quindi ogni lettura e scrittura è soggetta alla stessa RLS. Gli scope `data:*` stabiliscono quali strumenti vengono offerti |
| `GET` | `/mcp` | Bearer OAuth o una chiave API | Risponde con `405` e l'intestazione `Allow: POST, DELETE`: questo server non apre alcuno stream avviato dal server. Il token viene verificato prima, quindi uno mancante o scaduto riceve invece la richiesta `401` |
| `DELETE` | `/mcp` | none | Risponde con `204`. L'endpoint non mantiene alcuna sessione, quindi non c'è nulla da terminare |
| `POST` | `/api/oauth/register` | soggetto a rate-limit | Registrazione dinamica dei client RFC 7591. Rifiutata quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La schermata di consenso a cui viene reindirizzato un client |
| `POST` | `/api/oauth/authorize/decision` | session | La risposta dell'utente — approva o nega |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Scambia un codice di autorizzazione o esegue il refresh |
| `POST` | `/api/oauth/revoke` | client credentials | Revoca dei token RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quali client sono stati approvati da questo utente |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Ne revoca uno, consentendo a un utente di annullare un consenso senza l'intervento di un amministratore |

L'endpoint MCP del pannello di amministrazione non fa parte di questa superficie: accetta la
sessione del pannello di amministrazione, mai un token OAuth, ed è montato con le route
di amministrazione indipendentemente dall'impostazione di `REBASE_MCP_ENABLED`, su un driver che applica a ciascuna
chiamata l'ambito RLS.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, mai anonimo | **Sperimentale.** Gli stessi strumenti di `/mcp`, per l'utente autenticato, con `data:read`, `data:write` e `data:delete`, sotto la propria RLS. Il componente `savedAppsView` del pannello di amministrazione apre le [applicazioni salvate](/docs/ai/remote-mcp/) tramite di esso |

## Risorse correlate

- [API REST](/docs/backend/api/) — tutte le route dati nel dettaglio: filtri, ordinamento, paginazione, errori
- [Endpoint di autenticazione](/docs/backend/auth-endpoints/) — struttura di richieste e risposte per la tabella di autenticazione sopra indicata
- [Ambiente e configurazione](/docs/getting-started/configuration/) — le variabili che stabiliscono quali di queste route vengono montate

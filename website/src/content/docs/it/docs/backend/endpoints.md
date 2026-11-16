---
sourceHash: 7fea9b51c30a3c41
title: Indice degli endpoint
sidebar_label: Indice degli endpoint
description: Tutte le route HTTP montate da un backend Rebase — dati, autenticazione, archiviazione, amministrazione, meta — con il gate di ciascuna e la pagina che la descrive.
---

Tutte le route montate dal server, in un'unica tabella, con i requisiti per raggiungerle.

I percorsi assumono il `basePath` predefinito `/api`; `REBASE_BASE_PATH` li sposta
tutti insieme. `/health`, `/livez` e `/metrics` risiedono intenzionalmente all'esterno
di esso, poiché un orchestratore esegue probe su `/health` e non dovrebbe dover
conoscere il percorso di base. `/health` è *anche* montato al suo interno, in modo
che `/api/health` risponda nello stesso modo anziché restituire un 404 nel momento
esatto in cui qualcuno sta verificando se il server è attivo.

Un gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — confronta questa
tabella con le route registrate dal codice sorgente, così che una nuova superficie
non possa essere aggiunta senza comparire qui.

## Gate

| Gate | Significato |
|---|---|
| **none** | Non autenticato. Chiunque possa raggiungere l'host può chiamarlo |
| **session** | Un chiamante autenticato: un token di accesso o una chiave API con ambito limitato all'operazione |
| **`resource:action`** | Un chiamante in possesso di tale [scope](/docs/backend/roles-and-scopes/): un amministratore, un utente il cui ruolo lo dichiara, una chiave API creata con esso o la service key |
| **RLS** | Autenticato, dopodiché il database decide riga per riga — vedi [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montato solo al di fuori dell'ambiente di produzione |

## Dati

Generati per tabella, quindi i percorsi utilizzano i tuoi slug anziché un elenco
fisso. `:slug` è lo slug di una tabella (il suo nome, a meno che `defineTable` non imposti `slug`).

| Metodo | Path | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | L'elenco, con i parametri di query nel corpo — [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Il conteggio, con i parametri di query nel corpo — [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Ricalcola una vista materializzata, sulle viste che sono materializzate — [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias deprecato di `PATCH` — stessa scrittura parziale, risponde con `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserisce più righe, opzionalmente eseguendo l'upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Aggiorna più righe in base all'id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina più righe in base all'id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Scrive su più tabelle in un'unica transazione — [Writing over REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Il conteggio e l'aggregazione sono route a sé stanti, registrate prima di `/:id` in
modo che `aggregate` non venga interpretato come l'ID di un'entità. `?select=` e `?groupBy=`
sono i loro parametri, e `select` è obbligatorio su `/aggregate`.

La ricerca testuale, la ricerca vettoriale, l'inclusione di relazioni e la selezione dei
campi *sono* parametri di query su `GET /api/data/:slug` anziché route — `searchString`,
`vector_search`, `include`, `fields`. Vedi [REST API](/docs/backend/api/).

Un progetto che non dichiara tabelle e non ne esegue l'introspezione gestisce questo
prefisso con un unico `404 NO_TABLES`. Vedi [Backend only](/docs/getting-started/headless/).

## Auth

| Metodo | Path | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Cosa può offrire la schermata di login: registrazione, reimpostazione della password, magic link, codici email, accesso guest, provider OAuth e se la configurazione del primo amministratore è in sospeso |
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
| `POST` | `/api/auth/change-email` | session | Invia tramite email un link di conferma al nuovo indirizzo — [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un token del link) | Sposta l'account sul nuovo indirizzo — [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token di verifica) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token di verifica e una sessione o la password per mantenerla) | [Email verification](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token del link) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codici monouso via email |
| `POST` | `/api/auth/otp/verify` | none (un codice) | Codici monouso via email |
| `POST` | `/api/auth/device` | none | [Device sign-in](/docs/backend/device-sign-in/). Disattivato a meno che il backend non lo abiliti |
| `POST` | `/api/auth/device/token` | none (un codice dispositivo) | [Device sign-in](/docs/backend/device-sign-in/): polling del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Device sign-in](/docs/backend/device-sign-in/): cosa mostra la pagina di approvazione |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un secondo fattore) | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessioni guest. Disattivato a meno di `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un guest) | Trasforma un guest in un account |
| `POST` | `/api/auth/find-user` | session | Disattivato a meno di `AUTH_ALLOW_USER_LOOKUP` — costituisce una superficie di enumerazione |
| `POST` | `/api/auth/:provider` | none | Uno per ogni provider OAuth/OIDC configurato |
| `POST` | `/api/auth/link/:provider` | session | Collega un provider all'account autenticato |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un login in corso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un ID challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Tutti gli scope noti a questo backend e quelli detenuti dal chiamante — [Roles and scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un account) | Le [personal keys](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | session (un account) | La chiave in chiaro viene restituita una sola volta. `403 PERSONAL_KEYS_DISABLED` a meno che la tabella auth non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un account) | Revoca una delle chiavi dell'utente chiamante |
| `GET` | `/.well-known/jwks.json` | none | Il JWKS pubblico, quando è configurata la [firma asimmetrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Admin

Tutto ciò che si trova sotto `/api/admin` richiede uno scope dal piano di amministrazione,
e ogni superficie indica il proprio: `users:read` elenca gli account, `cron:write` attiva
un job. Un amministratore li detiene tutti, così come la service key. Un utente possiede
quelli dichiarati dai propri ruoli, e una chiave API quelli con cui è stata creata. Una
chiave limitata a una tabella non ha accesso a nulla di tutto ciò. Vedi [Roles and scopes](/docs/backend/roles-and-scopes/).

| Metodo | Path | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e solo finché non esiste alcun amministratore | Rifiutato in produzione — vedi [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestione utenti |
| `POST` | `/api/admin/users` | `users:write` | Gestione utenti. I ruoli superiori a quelli del chiamante vengono rifiutati |
| `GET` | `/api/admin/users/pick` | `users:read`, o accesso in scrittura a una tabella con una colonna `.userId()` | La [lettura del selettore utenti](/docs/backend/auth-endpoints/): solo id, name, email e avatar. Una tabella le cui regole di scrittura sono SQL grezzo non viene considerata |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestione utenti |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che dispone di più permessi del chiamante |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che dispone di più permessi del chiamante |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Rilascia una password temporanea |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Rimuove i secondi fattori e i codici di recupero dell'account, termina le sue sessioni |
| `GET` | `/api/admin/guests` | `users:read` | Guest, ordinati a partire da quello non attivo da più tempo. `?lastSeenBefore=` li restringe a ciò che l'eliminazione sottostante prenderebbe, e `total` ne restituisce il conteggio |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un batch di guest visti l'ultima volta prima di `?lastSeenBefore=`, che è obbligatorio. Risponde con `{ deleted, skipped, remaining }`. Ripetere finché `remaining` non è 0, impostando `?offset=` sul numero di quelli saltati. Gli account non possono essere interessati |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un guest. Un account viene rifiutato con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e i ruoli dichiarati dal progetto, con i relativi scope |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API keys](/docs/backend/api-keys/). Mai una chiave API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La chiave in chiaro viene restituita una sola volta, al momento della creazione |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Abilita o disabilita un job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Esegue un job adesso. `?async=1` risponde con `202` una volta avviato — [Cron Jobs API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario dei backup |
| `GET` | `/api/admin/backups/download` | `backups:read` | Invia in streaming un backup. Con il `?token=` ottenuto da un link di download, non è necessario alcun header, limitatamente a quel backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un link a un backup, `{ key }` → `{ url, token, expiresIn }`, valido per 60 secondi — [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Avvia una scansione in background per i file archiviati a cui nessuna riga fa riferimento, `?storageId=&olderThanHours=`. Risponde con `202` e il record della scansione: `id`, `status` (`queued`) e `runner` (`worker` quando è un job `storage.orphans` sulla coda dei job, `in-process` quando il server lo esegue direttamente). Il record viene scritto nella sorgente, sotto il percorso riservato `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Il record della scansione, `?storageId=`. Durante l'esecuzione: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` su `collectionsTotal`, `unscanned`). Una volta `completed`: `result`, il report fornito dal vecchio `GET /orphans`. Un'esecuzione che ha smesso di inviare aggiornamenti per 10 minuti viene considerata `failed`. `404 STORAGE_SCAN_NOT_FOUND` quando la sorgente non contiene tale scansione |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina gli elementi orfani di una scansione completata in background, `202`. Ciascuno viene nuovamente verificato rispetto a ogni riga e voce di cronologia, e ricontrollato immediatamente prima dell'eliminazione. Il risultato è la proprietà `deletion` del record di scansione. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Deprecato: la scansione all'interno della richiesta, `?storageId=&olderThanHours=`. Risponde con `Deprecation: true`. Usa `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Deprecato, senza `?scan=`: esegue nuovamente la scansione ed elimina all'interno della richiesta. `409 STORAGE_SCAN_INCOMPLETE` se non è stato possibile leggere una tabella |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una cartella in un'altra sorgente con le stesse chiavi, una pagina per chiamata — ciò che invia `rebase storage move`; `400 STORAGE_SAME_LOCATION` per `deleteSource` tra due sorgenti che salvano nella stessa posizione |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Elenca nuovamente la sorgente dopo uno spostamento, con lo stesso corpo, una pagina per chiamata: `{ checked, notMoved: [{ key, reason }], cursor? }` — ogni file ancora presente nella sorgente con `deleteSource`, ogni file di cui la destinazione non ha una copia senza di esso. `rebase storage move` lo richiede al termine dello spostamento |
| `GET` | `/api/admin/logs` | `logs:read` | Il buffer dei log recenti |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Le voci più recenti |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | L'ultimo risultato dell'audit pianificato |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Ruoli, ruoli di regola degli utenti e service key attive che un amministratore può simulare |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Ogni tabella come viene visualizzata da `{ role?, userId?, apiKeyId? }`: righe visibili rispetto a quelle del chiamante, nascoste per scope o RLS, campi mascherati. Solo per sessione di amministratore |
| `POST` | `/api/admin/sql/csv` | `database:write` | Invia in streaming l'intero risultato di una query di sola lettura in formato CSV — "Download full result as CSV" di [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Cosa ha modificato un [branch](/docs/backend/branching/#reviewing-and-merging-a-branch): schema, policy e righe, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Scrive le righe del branch nel genitore, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` se uno dei due lati è cambiato rispetto al diff o se le righe sono in conflitto |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Pianifica una modifica; non ne applica mai alcuna |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo una persona fisica, a meno di `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Pianifica la rimozione del vincolo `NOT NULL` e l'eliminazione delle colonne non dichiarate indicate in `drop`, per [schema reconcile](/docs/cli/schema/#rebase-schema-reconcile); non ne applica mai alcuno |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applica un piano di riconciliazione, solo se il relativo `digest` corrisponde al `confirm` inviato |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indica se l'editor è disponibile e il motivo qualora non lo sia |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Tutte le tabelle esportate da `backend/schema/index.ts` così come vengono lette dall'editor, con ciò che è modificato nel codice (in sola lettura) e il relativo motivo — [Live schema editing](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: i file che la modifica scriverebbe, compilati; non scrive nulla |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | La stessa modifica, scritta in `backend/schema`; il database non viene toccato |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tabelle presenti nel database e non dichiarate da `backend/schema`: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Una di esse descritta: `{ table: { …, descriptor, rlsRaised?, notes } }`, per "Import an existing table". `404` se sconosciuta o già dichiarata, `400 SCHEMA_EDIT_REFUSED` in assenza di una chiave primaria |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | Le chiamate `defineFirestoreCollection` in `frontend/src/cms` che l'editor può riscrivere (solo in development) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | I file che una modifica a una di quelle chiamate scriverebbe; non scrive nulla |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | La stessa modifica, scritta sul posto. `409 SCHEMA_EDIT_STALE_FILE` se il file è cambiato sul disco |
| `GET` | `/api/admin/ui-config` | session | Le preferenze UI del workspace per tabella, quelle dell'utente chiamante e l'indicazione se il chiamante può modificare quelle del workspace — vedi [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Esegue il merge di un delta `UiTablePreferences` nelle preferenze di workspace di una tabella (`replace` le sostituisce). Scritto in `frontend/src/cms/ui-config.json` dove il server può scrivere il sorgente del progetto, altrimenti in `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Rimuove le preferenze di workspace di una tabella |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (un utente) | Le preferenze personali del chiamante per una tabella. Una chiave API non ne ha: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (un utente) | Rimuove le preferenze personali del chiamante per una tabella |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Email che il transport di sviluppo ha intercettato anziché inviare |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Svuota la casella di posta intercettata |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` sono serviti anche
nei loro percorsi precedenti alla versione 0.17 senza il segmento `/admin`. Tali
alias sono destinati ai progetti che non sono ancora migrati; scrivi il nuovo
codice facendo riferimento al percorso canonico.

## Schema

| Metodo | Path | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, o una credenziale con `schema:read` o uno scope `data:*` | Ogni tabella servita da questo backend, sotto forma di array JSON di descrittori redatti in base ai permessi del chiamante |
| `GET` | `/api/schema/tables/:slug` | come sopra | Un singolo descrittore. `404 TABLE_NOT_FOUND` se al chiamante non viene servita quella tabella |

I descrittori sono ciò da cui il CMS ricava le impostazioni predefinite di rendering,
da cui lo Studio disegna il visualizzatore dello schema e l'editor RLS, e da cui le app
MCP renderizzano tabelle e form. Includono le colonne con i rispettivi tipi Postgres,
l'accettazione di valori nulli (nullability), le regole di validazione e archiviazione,
le relazioni per slug e la configurazione della row-level security. Il codice degli hook
non lascia mai il server: un descrittore indica unicamente quali hook possiede una tabella.

Ciò che viene restituito al chiamante dipende dalla sua identità:

| Chiamante | Tabelle | Oscurato / Rimosso |
|---|---|---|
| Un amministratore, chi detiene `schema:read`, o la service key | tutte le tabelle, comprese le viste standard | colonne `.private()`, per chiunque |
| Qualsiasi altra persona autenticata, guest inclusi | solo le tabelle accessibili tramite una regola permissiva per i loro ruoli (più la tabella auth e le viste materializzate di cui detengono i `roles`) | colonne e relazioni per cui i loro ruoli non soddisfano `access.read`; colonne `.private()`; solo le regole applicabili ai loro ruoli; relazioni verso tabelle a cui non hanno accesso; flag degli hook; SQL grezzo nelle regole, policy compilate, query delle viste e indici |
| Una credenziale (chiave API, token MCP o di piattaforma) | le tabelle nominate dai suoi scope `data:*`, o tutte in presenza di `schema:read` | come sopra, valutato in base agli scope posseduti |
| Nessun utente autenticato | nessuna — `401` — a meno che il backend non imposti `schemaTables: { public: true }` | in tal caso le tabelle con una regola `select` pubblica, oscurate come per il chiamante con privilegi minimi: nessuna colonna con un elenco `access.read`, nessun SQL grezzo, nessuna policy |

Un utente mantiene `metadata`, `softDelete`, `tenant`, `history` e `search` sulle
tabelle a cui ha accesso. `schemaTables: { persons: "all" }` nelle opzioni del backend
descrive ogni tabella e regola a qualsiasi chiamante autenticato; il valore
predefinito è `"granted"`. Le connessioni MCP vengono valutate come una credenziale,
dallo stesso serializzatore.

L'identità del chiamante proviene dall'adapter di autenticazione del backend, lo stesso
interrogato dalle route dati; pertanto, un backend con un [custom adapter](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
viene servito qui (e su `/api/docs` e su ogni superficie admin) con i ruoli restituiti
dal suo adapter; una credenziale non riconosciuta restituisce un `401`.

Una credenziale che non possiede né `schema:read` né uno scope `data:*` riceve
`403 SCOPE_MISSING`. Un backend senza autenticazione configurata risponde a ogni
richiesta con `404 SCHEMA_UNAVAILABLE`: non c'è un chiamante per cui oscurare i dati,
e `auth.requireAuth: false` non cambia questo comportamento.

Le risposte includono `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` e l'header `x-rebase-schema`; una richiesta il cui `If-None-Match`
indica il tag corrente riceve un `304`. Il tag cambia ogni volta che cambia lo schema,
anche in seguito a una modifica dello schema live.

`schemaTables` è un'opzione di `initializeRebaseBackend` priva di variabile d'ambiente:
un progetto generato tramite scaffolding vi accede eseguendo l'eject.

## Storage

| Metodo | Path | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, per chiave | [Storage](/docs/backend/storage/#storage-endpoints): metadati per un massimo di 100 oggetti |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Le sorgenti di storage denominate servite da questo backend |
| `OPTIONS` | `/api/storage/tus` | none | Upload riprendibili: versioni TUS ed estensioni supportate da questo server |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Upload riprendibili: creazione |
| `GET` | `/api/storage/tus/:id` | il proprietario dell'upload | Upload riprendibili: offset |
| `PATCH` | `/api/storage/tus/:id` | il proprietario dell'upload | Upload riprendibili: append |
| `DELETE` | `/api/storage/tus/:id` | il proprietario dell'upload | Upload riprendibili: annullamento |

Un deployment privo di storage configurato gestisce questo prefisso con un `501` che
indica la variabile necessaria, anziché restituire un 404 come se la funzionalità non esistesse —
a eccezione di `GET /api/storage/sources`, che risponde `200` con un elenco vuoto.

## Push

Montato solo con `push: true` (`REBASE_PUSH=true`). Con il push abilitato ma senza chiavi
configurate, ogni route risponde `503 PUSH_NOT_CONFIGURED`. Le chiavi API e la service key
vengono rifiutate: una sottoscrizione appartiene al browser di una persona.

| Metodo | Path | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/push/key` | session | La chiave pubblica VAPID — [Push notifications](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Questo browser riceve notifiche per il chiamante — [Push notifications](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Le interrompe, sul browser del chiamante — [Push notifications](/docs/backend/push-notifications/#routes) |

## Functions

| Metodo | Path | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/functions` | session | I nomi delle funzioni servite e quanti file non sono stati caricati |
| qualsiasi | `/api/functions/<name>` | qualsiasi cosa la funzione dichiari. Una chiave API necessita inoltre di `functions:invoke` | [Custom Functions](/docs/backend/custom-functions/) |

Una route per ogni file in `backend/functions/`, quindi i percorsi derivano dal
tuo progetto. `GET /api/functions` li elenca solo a un chiamante autenticato —
una sessione, una chiave API o la service key — e risponde a chiunque altro con
`401`: l'inventario degli endpoint personalizzati di un deployment non è pubblico.

## Meta e operazioni

| Metodo | Path | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/livez` | none | Solo liveness: verifica se questo processo è in esecuzione. Non tocca il database, motivo per cui è il percorso di probe che un container dovrebbe utilizzare — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Segnala ogni data source configurata, non solo quella predefinita |
| `GET` | `/api/docs` | il pubblico dell'endpoint schema per impostazione predefinita (401 per anonimi a meno di `schemaTables.public`, 403 per una credenziale senza scope di schema o di dati); none quando `enableSwagger` è `true`; il gate admin quando è `false` | Il documento OpenAPI 3.0 delle tabelle che `GET /api/schema/tables` descrive al chiamante (tutte con `enableSwagger: true`). `404 DOCS_UNAVAILABLE` quando non è configurata alcuna autenticazione |
| `GET` | `/api/swagger` | none | Swagger UI. Solo quando `enableSwagger` è `true`, e mai in produzione |
| `GET` | `/api/meta/schema-version` | none | L'hash dello schema da cui è stato compilato questo backend e la versione del runtime, e nient'altro |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — ogni tabella così come la vede un amministratore, l'input di `rebase generate-sdk --from`. `404` quando non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando impostato | Metriche Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando impostato | Le serie registrate alla base dei grafici di Studio. `501` su un runtime privo di backend |

Le connessioni WebSocket arrivano come upgrade HTTP sullo stesso server anziché su
un percorso dedicato — vedi [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montato solo quando `REBASE_MCP_ENABLED=true`, che richiede anche
`REBASE_PUBLIC_URL` — vedi
[Configuration](/docs/getting-started/configuration/#mcp-surface). Disattivato per
impostazione predefinita: nessun `REBASE_ROLE` lo attiva, poiché concede l'accesso
al progetto a software di terze parti e questa è una decisione che spetta a una persona.

I documenti `.well-known` si trovano all'**origine**, non sotto `basePath`: le RFC 8414
e RFC 9728 definiscono tali percorsi rispetto all'origine e un client li richiede
prima di possedere alcun token.

| Metodo | Path | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadati RFC 9728 che definiscono questa risorsa e il relativo authorization server. Servito anche nella forma con suffisso di percorso |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadati RFC 8414: gli endpoint, i grant type e i metodi PKCE supportati da questo deployment |
| `POST` | `/mcp` | Bearer OAuth o chiave API | L'endpoint del protocollo MCP. Agisce **come l'utente autenticato** (o come chiunque sia rappresentato dalla chiave), quindi ogni lettura e scrittura è soggetta alla medesima RLS. Gli scope `data:*` determinano quali strumenti vengono offerti |
| `GET` | `/mcp` | Bearer OAuth o chiave API | Risponde `405` con `Allow: POST, DELETE`: questo server non apre stream avviati dal server. Il token viene verificato per primo, quindi un token mancante o non valido riceve invece la richiesta di autenticazione `401` |
| `DELETE` | `/mcp` | none | Risponde `204`. L'endpoint non conserva alcuna sessione, quindi non c'è nulla da terminare |
| `POST` | `/api/oauth/register` | rate-limited | Registrazione dinamica dei client RFC 7591. Rifiutata quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La schermata di consenso a cui viene reindirizzato un client |
| `POST` | `/api/oauth/authorize/decision` | session | La risposta dell'utente — approva o rifiuta |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Scambia un authorization code o esegue il refresh |
| `POST` | `/api/oauth/revoke` | client credentials | Revoca dei token RFC 7009 |
| `GET` | `/api/oauth/grants` | session | I client approvati da questo utente |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Ne revoca uno, consentendo a un utente di revocare un consenso senza l'intervento di un amministratore |

L'endpoint MCP proprietario del pannello di amministrazione non fa parte di questa
superficie: accetta la sessione del pannello di amministrazione, mai un token OAuth,
ed è montato con le route di amministrazione indipendentemente dall'impostazione
di `REBASE_MCP_ENABLED`, su un driver che applica a ciascuna chiamata l'ambito RLS.

| Metodo | Path | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, mai anonimo | **Sperimentale.** Gli stessi strumenti di `/mcp`, per la persona autenticata, con `data:read`, `data:write` e `data:delete`, nel rispetto della propria RLS. La vista `savedAppsView` del pannello di amministrazione apre le [saved apps](/docs/ai/remote-mcp/) tramite di esso |

## Correlati

- [REST API](/docs/backend/api/) — le route dei dati complete: filtri, ordinamento, paginazione, errori
- [Auth endpoints](/docs/backend/auth-endpoints/) — formati di richiesta e risposta per la tabella di autenticazione sopra indicata
- [Environment & Configuration](/docs/getting-started/configuration/) — le variabili che stabiliscono quali di queste route vengono montate

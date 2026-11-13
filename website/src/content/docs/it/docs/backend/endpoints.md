---
sourceHash: 9b25ea3a0b2cb11a
title: Indice degli endpoint
sidebar_label: Indice degli endpoint
description: Tutte le route HTTP montate da un backend Rebase — dati, autenticazione, storage, admin, meta — con il relativo gate e la pagina di approfondimento.
---

Tutte le route montate dal server, in un'unica tabella, con i requisiti per raggiungerle.

I percorsi presuppongono il `basePath` predefinito di `/api`; `REBASE_BASE_PATH` li
sposta tutti insieme. `/health`, `/livez` e `/metrics` risiedono intenzionalmente
all'esterno, poiché un orchestratore esegue sonde su `/health` e non deve essere
tenuto a conoscere il percorso di base. `/health` è *anche* montato al di sotto di esso,
in modo che `/api/health` risponda allo stesso modo invece di restituire un 404
nel momento stesso in cui qualcuno sta controllando se il server è attivo.

Un gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — confronta
questa tabella con le route registrate dal codice sorgente, impedendo così che
venga aggiunta una nuova superficie senza comparire qui.

## Gate

| Gate | Significato |
|---|---|
| **none** | Non autenticato. Chiunque possa raggiungere l'host può inviare chiamate |
| **session** | Un chiamante autenticato: un token di accesso o una chiave API con lo scope dell'operazione |
| **`resource:action`** | Un chiamante in possesso di tale [scope](/docs/backend/roles-and-scopes/): un amministratore, un utente il cui ruolo lo dichiara, una chiave API creata con esso o la chiave di servizio |
| **RLS** | Autenticato, dopodiché il database decide riga per riga — vedi [Regole di sicurezza](/docs/collections/security-rules/) |
| **dev** | Montato solo al di fuori dell'ambiente di produzione |

## Dati

<span class="since-badge" data-since="0.31">Da 0.31</span>

Generati per tabella, quindi i percorsi includono i tuoi slug anziché
un elenco fisso. `:slug` corrisponde allo slug della tabella (il suo nome, a meno che `defineTable` non imposti `slug`).

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | L'elenco, con parametri di query nel corpo — [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Il conteggio, con parametri di query nel corpo — [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Ricalcola una vista materializzata, sulle viste che sono materializzate — [Viste](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias deprecato di `PATCH` — stessa scrittura parziale, risponde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserisce più righe, facoltativamente eseguendo upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Aggiorna più righe per ID — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina più righe per ID — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Scrive su più tabelle in un'unica transazione — [Scrittura via REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Cronologia entità](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Cronologia entità](/docs/backend/history/) |

Conteggio e aggregazione sono route dedicate, registrate prima di `/:id` per
evitare che `aggregate` venga interpretato come ID di un'entità. `?select=` e `?groupBy=` sono
i loro parametri, e `select` è obbligatorio su `/aggregate`.

La ricerca testuale, la ricerca vettoriale, l'inclusione di relazioni e la selezione dei campi *sono* parametri
di query su `GET /api/data/:slug` anziché route distinte — `searchString`,
`vector_search`, `include`, `fields`. Vedi [REST API](/docs/backend/api/).

Un progetto che non dichiara tabelle e non ne esegue l'introspezione serve questo prefisso
come un singolo errore `404 NO_TABLES`. Vedi [Solo backend](/docs/getting-started/headless/).

## Autenticazione

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Cosa può offrire la schermata di login: registrazione, reimpostazione della password, magic link, codici email, accesso ospite, provider OAuth e se la configurazione del primo admin è in sospeso |
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
| `POST` | `/api/auth/reset-password` | none (un token di ripristino) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Invia via email un link di conferma al nuovo indirizzo — [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un token link) | Trasferisce l'account sul nuovo indirizzo — [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticazione](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token di verifica) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token di verifica e una sessione o la password per mantenerla) | [Verifica dell'email](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token link) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codici monouso via email |
| `POST` | `/api/auth/otp/verify` | none (un codice) | Codici monouso via email |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Da 0.31</span> [Accesso da dispositivo](/docs/backend/device-sign-in/). Disattivato a meno che il backend non lo abiliti |
| `POST` | `/api/auth/device/token` | none (un codice dispositivo) | [Accesso da dispositivo](/docs/backend/device-sign-in/): il polling del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Accesso da dispositivo](/docs/backend/device-sign-in/): cosa mostra la pagina di approvazione |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un secondo fattore) | [Accesso da dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Accesso da dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessioni ospite. Disattivato tranne con `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un ospite) | Trasforma un ospite in un account |
| `POST` | `/api/auth/find-user` | session | Disattivato tranne con `AUTH_ALLOW_USER_LOOKUP` — costituisce una superficie di enumerazione |
| `POST` | `/api/auth/:provider` | none | Uno per provider OAuth/OIDC configurato |
| `POST` | `/api/auth/link/:provider` | session | Collega un provider all'account autenticato |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un login in corso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un ID di challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Tutti gli scope noti a questo backend e quelli posseduti dal chiamante — [Ruoli e scope](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un account) | Le [chiavi personali](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | session (un account) | La chiave in chiaro viene restituita una sola volta. `403 PERSONAL_KEYS_DISABLED` a meno che la tabella di autenticazione non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un account) | Revoca una delle chiavi personali del chiamante |
| `GET` | `/.well-known/jwks.json` | none | Il JWKS pubblico, quando è configurata la [firma asimmetrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Admin

Tutto ciò che si trova sotto `/api/admin` richiede uno scope del piano di amministrazione, e ogni
superficie specifica il proprio: `users:read` elenca gli account, `cron:write` attiva un job.
Un amministratore li detiene tutti, e così pure la chiave di servizio. Un utente possiede quelli
dichiarati dai suoi ruoli, e una chiave API quelli con cui è stata creata. Una chiave con scope limitato a
una tabella non può accedere a nulla di tutto ciò. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e solo finché non esiste alcun admin | Rifiutato in produzione — vedi [Bootstrap del primo utente](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestione utenti |
| `POST` | `/api/admin/users` | `users:write` | Gestione utenti. I ruoli superiori a quelli del chiamante vengono rifiutati |
| `GET` | `/api/admin/users/pick` | `users:read`, o accesso in scrittura a una tabella con colonna `.userId()` | [Lettura del selettore utenti](/docs/backend/auth-endpoints/): solo id, name, email e avatar. Una tabella le cui regole di scrittura sono in SQL grezzo non è considerata valida |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestione utenti |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account con privilegi superiori a quelli del chiamante |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account con privilegi superiori a quelli del chiamante |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emette una password temporanea |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Rimuove i secondi fattori e i codici di ripristino dell'account, termina le sue sessioni |
| `GET` | `/api/admin/guests` | `users:read` | Ospiti, con ordinamento a partire da quelli visti meno di recente. `?lastSeenBefore=` li limita a quelli che l'eliminazione sottostante rimuoverebbe, e `total` ne fornisce il conteggio |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un batch degli ospiti visti l'ultima volta prima di `?lastSeenBefore=`, che è obbligatorio. Restituisce `{ deleted, skipped, remaining }`. Ripetere finché `remaining` non è 0, con `?offset=` impostato sul numero di quelli saltati. Gli account non possono essere raggiunti |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un ospite. Per un account la richiesta viene rifiutata con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e i ruoli dichiarati dal progetto, con i rispettivi scope |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Chiavi API](/docs/backend/api-keys/). Mai da una chiave API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La chiave in chiaro viene restituita una sola volta, al momento della creazione |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Chiavi API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Chiavi API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Chiavi API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Job](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Job](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Abilita o disabilita un job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Job](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Esegue un job adesso. `?async=1` risponde `202` dopo l'avvio — [API dei Cron Job](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario dei backup |
| `GET` | `/api/admin/backups/download` | `backups:read` | Esegue lo streaming di un backup. Con il `?token=` ottenuto da un link di download non è necessaria alcuna intestazione, ma solo per quel backup specifico |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un link a un backup, `{ key }` → `{ url, token, expiresIn }`, valido per 60 secondi — [Backup](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Avvia in background una scansione dei file archiviati privi di riferimenti nelle righe, `?storageId=&olderThanHours=`. Risponde `202` con il record della scansione: `id`, `status` (`queued`) e `runner` (`worker` quando è un job `storage.orphans` sulla coda, `in-process` quando il server lo esegue internamente). Il record viene scritto nella sorgente, sotto il percorso riservato `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Il record della scansione, `?storageId=`. Durante l'esecuzione: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` su `collectionsTotal`, `unscanned`). Una volta `completed`: `result`, il report che restituiva la precedente `GET /orphans`. Un'esecuzione che ha interrotto le segnalazioni per 10 minuti viene considerata `failed`. `404 STORAGE_SCAN_NOT_FOUND` se la sorgente non contiene tale scansione |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina gli orfani di una scansione completata in background, `202`. Ciascun file viene verificato nuovamente rispetto a ogni riga e voce di cronologia, e controllato un'ultima volta subito prima della cancellazione. L'esito corrisponde a `deletion` nel record della scansione. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Deprecato: la scansione all'interno della richiesta, `?storageId=&olderThanHours=`. Risponde con `Deprecation: true`. Usa `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Deprecato, senza `?scan=`: esegue nuovamente la scansione ed elimina all'interno della richiesta. `409 STORAGE_SCAN_INCOMPLETE` quando non è stato possibile leggere una tabella |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una cartella in un'altra sorgente con le stesse chiavi, una pagina per chiamata — ciò che invia `rebase storage move`; `400 STORAGE_SAME_LOCATION` per `deleteSource` tra due sorgenti archiviate nella stessa posizione |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Elenca nuovamente la sorgente dopo uno spostamento, con lo stesso corpo, una pagina per chiamata: `{ checked, notMoved: [{ key, reason }], cursor? }` — ogni file ancora presente nella sorgente con `deleteSource`, ogni file di cui la destinazione non possiede una copia senza di esso. `rebase storage move` lo interroga una volta terminato lo spostamento |
| `GET` | `/api/admin/logs` | `logs:read` | Il buffer dei log recenti |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Le voci più recenti |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Eventi Server-Sent (SSE) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | L'ultimo risultato dell'audit pianificato |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Ruoli, rule role degli utenti e chiavi di servizio attive che un amministratore può simulare |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Ciascuna tabella come visualizzata da `{ role?, userId?, apiKeyId? }`: righe visibili rispetto a quelle del chiamante, nascoste per scope o RLS, campi mascherati. Riservato alla sessione dell'amministratore |
| `POST` | `/api/admin/sql/csv` | `database:write` | Esegue lo streaming dell'intero risultato di una query di sola lettura come CSV — opzione "Download full result as CSV" di [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Le modifiche introdotte da un [branch](/docs/backend/branching/#reviewing-and-merging-a-branch): schema, criteri e righe, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Scrive le righe del branch nel relativo parent, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` se uno dei due lati è cambiato rispetto al diff o se si verificano conflitti tra le righe |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Modifica dello schema live](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Pianifica una modifica; non ne applica mai alcuna |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo utenti fisici, a meno che non sia impostato `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Pianifica l'allentamento di `NOT NULL` e l'eliminazione delle colonne non dichiarate indicate in `drop`, per la [riconciliazione dello schema](/docs/cli/schema/#rebase-schema-reconcile); non applica mai le modifiche |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applica un piano di riconciliazione, solo se il relativo `digest` coincide con il valore `confirm` inviato |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indica se l'editor è disponibile e la motivazione in caso contrario |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | <span class="since-badge" data-since="0.31">Da 0.31</span> Tutte le tabelle esportate da `backend/schema/index.ts` così come lette dall'editor, con l'indicazione di cosa viene modificato nel codice (sola lettura) e perché — [Modifica dello schema live](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> `{ patches: TablePatch[] }`: i file che verrebbero scritti dalla modifica, compilati; non scrive nulla |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> La medesima modifica, scritta in `backend/schema`; il database non viene toccato |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | <span class="since-badge" data-since="0.31">Da 0.31</span> Tabelle presenti nel database ma non dichiarate in `backend/schema`: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | <span class="since-badge" data-since="0.31">Da 0.31</span> Descrizione dettagliata di una di esse: `{ table: { …, descriptor, rlsRaised?, notes } }`, per l'opzione "Import an existing table". Restituisce `404` se sconosciuta o già dichiarata, `400 SCHEMA_EDIT_REFUSED` se priva di chiave primaria |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | <span class="since-badge" data-since="0.31">Da 0.31</span> Le chiamate a `defineFirestoreCollection` in `frontend/src/cms` riscrivibili dall'editor (solo in sviluppo) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> I file che verrebbero scritti modificando una di tali chiamate; non scrive nulla |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> La medesima modifica, scritta sul posto. `409 SCHEMA_EDIT_STALE_FILE` se il file è cambiato su disco |
| `GET` | `/api/admin/ui-config` | session | <span class="since-badge" data-since="0.31">Da 0.31</span> Le preferenze UI del workspace per ciascuna tabella, quelle personali del chiamante e l'indicazione se il chiamante può scrivere le preferenze del workspace — vedi [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> Unisce un delta `UiTablePreferences` nelle preferenze di workspace di una tabella (`replace` sostituisce). Scritto in `frontend/src/cms/ui-config.json` se il server è autorizzato a scrivere nel sorgente del progetto, altrimenti in `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> Rimuove le preferenze di workspace per una tabella |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (un utente fisico) | <span class="since-badge" data-since="0.31">Da 0.31</span> Le preferenze personali del chiamante per una tabella. Una chiave API non ne possiede: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (un utente fisico) | <span class="since-badge" data-since="0.31">Da 0.31</span> Rimuove le preferenze personali del chiamante per una tabella |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Email intercettate dal transport di sviluppo anziché inviate |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Svuota la casella di posta delle email catturate |

Anche `/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` sono
serviti nei rispettivi percorsi precedenti alla versione 0.17 privi del segmento `/admin`. Tali
alias sono pensati per progetti non ancora migrati; scrivere il nuovo codice puntando al percorso canonico.

## Schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, o una credenziale con `schema:read` o uno scope `data:*` | Tutte le tabelle servite da questo backend, fornite come array JSON di descrittori redatti in base al chiamante |
| `GET` | `/api/schema/tables/:slug` | come sopra | Un singolo descrittore. `404 TABLE_NOT_FOUND` se al chiamante non è servita tale tabella |

I descrittori costituiscono la base su cui il CMS renderizza i valori predefiniti,
su cui Studio disegna il visualizzatore di schemi e l'editor RLS, e su cui le app
MCP generano tabelle e form. Includono le colonne con i rispettivi tipi Postgres,
la nullabilità, le regole di validazione e storage, le relazioni tramite slug e la
configurazione della sicurezza a livello di riga (RLS). Il codice degli hook non lascia mai il server: un
descrittore indica solo quali hook possiede una tabella.

Il contenuto restituito al chiamante varia in base alla sua identità:

| Chiamante | Tabelle | Redatto |
|---|---|---|
| Un amministratore, un titolare di `schema:read` o la chiave di servizio | tutte le tabelle, incluse le viste semplici | colonne `.private()`, per chiunque |
| Qualsiasi altro utente autenticato, inclusi gli ospiti | solo le tabelle accessibili tramite una regola permissiva per i propri ruoli (più la tabella auth e le viste materializzate per cui possiede i `roles`) | colonne e relazioni per cui i rispettivi ruoli non superano `access.read`; colonne `.private()`; unicamente le regole applicabili ai propri ruoli; relazioni verso tabelle non servite; flag degli hook; SQL grezzo nelle regole, criteri compilati, query delle viste e indici |
| Una credenziale (chiave API, token MCP o token di piattaforma) | le tabelle specificate dai suoi scope `data:*`, o tutte in presenza di `schema:read` | come sopra, valutato in base agli scope posseduti |
| Nessun utente autenticato | nessuna — `401` — a meno che il backend non configuri `schemaTables: { public: true }` | in tal caso le tabelle con una regola `select` pubblica, redatte come per il chiamante con i privilegi minimi: nessuna colonna con elenco `access.read`, niente SQL grezzo, niente criteri |

Un utente mantiene `metadata`, `softDelete`, `tenant`, `history` e `search` sulle
tabelle a cui ha accesso. L'opzione `schemaTables: { persons: "all" }` nelle opzioni
del backend descrive ogni tabella e regola a qualsiasi chiamante autenticato; il
valore predefinito è `"granted"`. Le connessioni MCP vengono valutate come
credenziali dallo stesso serializzatore.

L'identità del chiamante viene determinata dall'adattatore di autenticazione del backend, lo stesso
interrogato dalle route dei dati; pertanto, un backend con un [adattatore personalizzato](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
viene servito qui (e su `/api/docs` e su ogni superficie admin) con i ruoli restituiti
dal rispettivo adattatore; una credenziale non riconosciuta restituisce un `401`.

Una credenziale priva sia di `schema:read` che di uno scope `data:*` riceve
`403 SCOPE_MISSING`. Un backend privo di autenticazione configurata risponde a
qualsiasi richiesta con `404 SCHEMA_UNAVAILABLE`: non c'è alcun chiamante per cui redigere i dati,
e impostare `auth.requireAuth: false` non modifica tale comportamento.

Le risposte includono `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` e l'intestazione `x-rebase-schema`; una richiesta il cui `If-None-Match`
indica il tag corrente riceve un `304`. Il tag cambia ogni volta che lo schema viene modificato,
anche a seguito di una modifica live dello schema.

`schemaTables` è un'opzione di `initializeRebaseBackend` priva di variabile
d'ambiente associata: un progetto scaffolded può accedervi effettuando l'eject.

## Storage

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, per chiave | [Storage](/docs/backend/storage/#storage-endpoints): metadati per un massimo di 100 oggetti |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Le sorgenti di storage con nome servite da questo backend |
| `OPTIONS` | `/api/storage/tus` | none | Caricamenti riprendibili: le versioni e le estensioni TUS supportate da questo server |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Caricamenti riprendibili: creazione |
| `GET` | `/api/storage/tus/:id` | proprietario del caricamento | Caricamenti riprendibili: offset |
| `PATCH` | `/api/storage/tus/:id` | proprietario del caricamento | Caricamenti riprendibili: append |
| `DELETE` | `/api/storage/tus/:id` | proprietario del caricamento | Caricamenti riprendibili: cancellazione |

Un deployment privo di storage configurato gestisce questo prefisso restituendo un errore `501`
che indica la variabile necessaria, anziché restituire un 404 come se la funzionalità non esistesse —
fatta eccezione per `GET /api/storage/sources`, che risponde con `200` e un elenco vuoto.

## Funzioni

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/functions` | session | I nomi delle funzioni servite e quanti file non è stato possibile caricare |
| qualsiasi | `/api/functions/<name>` | qualsiasi valore dichiarato dalla funzione. Una chiave API necessita inoltre di `functions:invoke` | [Funzioni personalizzate](/docs/backend/custom-functions/) |

Una route per ogni file presente sotto `backend/functions/`, per cui i percorsi dipendono
dal tuo progetto. `GET /api/functions` ne restituisce l'elenco solo ai chiamanti autenticati —
una sessione, una chiave API o la chiave di servizio — e risponde con `401` a chiunque altro:
l'inventario degli endpoint personalizzati di un deployment non è pubblico.

## Meta e operazioni

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/livez` | none | Sola liveness: verifica se questo processo è in esecuzione. Non tocca il database, motivo per cui è il percorso di sonda consigliato per un container — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Riporta lo stato di tutte le sorgenti dati configurate, non solo di quella predefinita |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Da 0.31</span> la stessa visibilità dell'endpoint di schema per impostazione predefinita (401 anonimo a meno di `schemaTables.public`, 403 per credenziali prive di scope per schema o dati); none quando `enableSwagger` è `true`; il gate admin quando è `false` | Il documento OpenAPI 3.0 relativo alle tabelle che `GET /api/schema/tables` descrive al chiamante (tutte se `enableSwagger: true`). Restituisce `404 DOCS_UNAVAILABLE` quando non è configurata alcuna autenticazione |
| `GET` | `/api/swagger` | none | Swagger UI. Disponibile solo quando `enableSwagger` è `true`, e mai in produzione |
| `GET` | `/api/meta/schema-version` | none | L'hash dello schema su cui è stato compilato questo backend e la versione di runtime, nient'altro |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — tutte le tabelle così come visibili a un amministratore, usato come input per `rebase generate-sdk --from`. `404` quando non è configurata l'autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` se impostato | Metriche di Prometheus, se `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` se impostato | Le serie storiche registrate alla base dei grafici di Studio. `501` su un runtime privo di backend |

Le connessioni WebSocket arrivano sotto forma di upgrade HTTP sullo stesso server anziché
su un percorso dedicato — vedi [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montata solo quando `REBASE_MCP_ENABLED=true`, che richiede anche
`REBASE_PUBLIC_URL` — vedi
[Configurazione](/docs/getting-started/configuration/#mcp-surface). Disattivata
per impostazione predefinita: nessun `REBASE_ROLE` la abilita automaticamente, poiché concederebbe l'accesso
al progetto a software di terze parti, decisione che deve essere presa da un essere umano.

I documenti `.well-known` risiedono nell'**origin**, non sotto `basePath`: RFC 8414
e RFC 9728 definiscono tali percorsi rispetto all'origine, e un client li
recupera prima di disporre di un token.

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadati RFC 9728 che specificano questa risorsa e il relativo server di autorizzazione. Serviti anche nel formato con percorso suffissato |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadati RFC 8414: gli endpoint, i grant type e i metodi PKCE supportati da questo deployment |
| `POST` | `/mcp` | OAuth bearer, o una chiave API | L'endpoint del protocollo MCP. Agisce **come l'utente autenticato** (o come il soggetto rappresentato dalla chiave), perciò ogni lettura e scrittura è subordinata allo stesso RLS. Gli scope `data:*` stabiliscono quali strumenti vengono offerti |
| `GET` | `/mcp` | OAuth bearer, o una chiave API | Risponde `405` con `Allow: POST, DELETE`: questo server non avvia stream su iniziativa del server. Il token viene verificato preliminarmente, restituendo un `401` in caso di token mancante o non aggiornato |
| `DELETE` | `/mcp` | none | Risponde `204`. L'endpoint non conserva alcuna sessione, per cui non c'è nulla da terminare |
| `POST` | `/api/oauth/register` | rate-limited | Registrazione dinamica dei client secondo RFC 7591. Rifiutata quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La schermata di consenso a cui viene reindirizzato il client |
| `POST` | `/api/oauth/authorize/decision` | session | La risposta fornita dall'utente — approva o rifiuta |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Scambia un codice di autorizzazione o esegue il refresh |
| `POST` | `/api/oauth/revoke` | client credentials | Revoca del token secondo RFC 7009 |
| `GET` | `/api/oauth/grants` | session | I client approvati dall'utente |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Ne revoca uno, consentendo all'utente di annullare un consenso senza richiedere l'intervento dell'admin |

L'endpoint MCP dedicato del pannello di amministrazione non fa parte di questa superficie: accetta
la sessione del pannello di amministrazione, mai un token OAuth, ed è montato assieme alle route
di amministrazione a prescindere dall'impostazione di `REBASE_MCP_ENABLED`, su un driver che
applica l'RLS a ogni chiamata.

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, mai anonimo | **Sperimentale.** Gli stessi tool di `/mcp`, per la persona autenticata, con `data:read`, `data:write` e `data:delete`, sotto il relativo RLS. Il componente `savedAppsView` del pannello di amministrazione apre le [applicazioni salvate](/docs/ai/remote-mcp/) attraverso di esso |

## Risorse correlate

- [REST API](/docs/backend/api/) — la documentazione completa delle route dati: filtri, ordinamento, paginazione, errori
- [Endpoint di autenticazione](/docs/backend/auth-endpoints/) — formati di richiesta e risposta per la tabella di autenticazione sopra indicata
- [Ambiente e configurazione](/docs/getting-started/configuration/) — le variabili che determinano quali di queste route vengono montate

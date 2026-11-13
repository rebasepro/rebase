---
sourceHash: fbd8c85494a26511
title: Indice degli endpoint
sidebar_label: Indice degli endpoint
description: Tutte le route HTTP montate da un backend Rebase — dati, autenticazione, storage, amministrazione, meta — con il gate corrispondente e la pagina che la descrive.
---

Tutte le route montate dal server, in un'unica tabella, con i requisiti per raggiungerle.

I percorsi presuppongono il `basePath` predefinito di `/api`; `REBASE_BASE_PATH` li sposta
tutti insieme. `/health`, `/livez` e `/metrics` risiedono volutamente al di fuori di esso,
poiché un orchestratore esegue probe su `/health` e non dovrebbe dover conoscere il percorso
di base. `/health` è *anche* montato al di sotto di esso, in modo che `/api/health` risponda
allo stesso modo invece di restituire un 404 nel momento esatto in cui qualcuno sta verificando
se il server è attivo.

Un gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — confronta questa
tabella con le route registrate dal codice sorgente, in modo che una nuova superficie non possa essere aggiunta
senza apparire qui.

## Gate

| Gate | Significato |
|---|---|
| **none** | Non autenticato. Chiunque possa raggiungere l'host può chiamarlo |
| **session** | Un chiamante autenticato: un token di accesso o una chiave API con ambito limitato all'operazione |
| **`resource:action`** | Un chiamante in possesso di tale [scope](/docs/backend/roles-and-scopes/): un amministratore, un utente il cui ruolo lo dichiara, una chiave API creata con esso o la service key |
| **RLS** | Autenticato, e successivamente il database decide riga per riga — vedi [Regole di Sicurezza](/docs/collections/security-rules/) |
| **dev** | Montato solo al di fuori dell'ambiente di produzione |

## Dati

<span class="since-badge" data-since="0.31">Da 0.31</span>

Generati per tabella, quindi i percorsi includono i tuoi slug invece di un
elenco fisso. `:slug` è lo slug di una tabella (il suo nome, a meno che `defineTable` non imposti `slug`).

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Interrogazione](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | L'elenco, con parametri di query nel corpo — [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Interrogazione](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Il conteggio, con parametri di query nel corpo — [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Ricalcola una vista materializzata, sulle viste che sono materializzate — [Viste](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias deprecato di `PATCH` — stessa scrittura parziale, risponde con `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserisce più righe, opzionalmente eseguendo un upsert — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Aggiorna più righe per id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina più righe per id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Scrive su più tabelle in un'unica transazione — [Scrittura via REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Cronologia entità](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Cronologia entità](/docs/backend/history/) |

Il conteggio e l'aggregazione sono route a sé stanti, registrate prima di `/:id` in
modo che `aggregate` non venga interpretato come l'id di un'entità. `?select=` e `?groupBy=` sono
i loro parametri, e `select` è obbligatorio su `/aggregate`.

La ricerca testuale, la ricerca vettoriale, l'inclusione di relazioni e la selezione dei campi *sono* parametri
di query su `GET /api/data/:slug` anziché route — `searchString`,
`vector_search`, `include`, `fields`. Vedi [API REST](/docs/backend/api/).

Un progetto che non dichiara tabelle e non ne esamina alcuna serve questo prefisso
come un singolo `404 NO_TABLES`. Vedi [Solo backend](/docs/getting-started/headless/).

## Autenticazione

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Ciò che la schermata di login può offrire: registrazione, reimpostazione della password, magic link, codici email, accesso ospite, provider OAuth e se la configurazione del primo amministratore è in sospeso |
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
| `POST` | `/api/auth/change-email` | session | Invia un link di conferma al nuovo indirizzo — [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un link token) | Trasferisce l'account sul nuovo indirizzo — [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticazione](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token di verifica) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token di verifica, e una sessione o la password per mantenerla) | [Verifica dell'email](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un link token) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codici monouso via email |
| `POST` | `/api/auth/otp/verify` | none (un codice) | Codici monouso via email |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Da 0.31</span> [Accesso da dispositivo](/docs/backend/device-sign-in/). Disattivato a meno che il backend non lo abiliti |
| `POST` | `/api/auth/device/token` | none (un codice dispositivo) | [Accesso da dispositivo](/docs/backend/device-sign-in/): il polling del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Accesso da dispositivo](/docs/backend/device-sign-in/): cosa mostra la pagina di approvazione |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un secondo fattore) | [Accesso da dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Accesso da dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessioni ospite. Disattivato a meno di `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un ospite) | Trasforma un ospite in un account |
| `POST` | `/api/auth/find-user` | session | Disattivato a meno di `AUTH_ALLOW_USER_LOOKUP` — costituisce una superficie di enumerazione |
| `POST` | `/api/auth/:provider` | none | Uno per provider OAuth/OIDC configurato |
| `POST` | `/api/auth/link/:provider` | session | Collega un provider all'account attualmente autenticato |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un login in corso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un id di challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Tutti gli scope noti a questo backend, e quelli detenuti dal chiamante — [Ruoli e scope](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un account) | Le [chiavi personali](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | session (un account) | La chiave in chiaro viene restituita una sola volta. `403 PERSONAL_KEYS_DISABLED` a meno che la tabella auth non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un account) | Revoca una delle chiavi personali del chiamante |
| `GET` | `/.well-known/jwks.json` | none | Il JWKS pubblico, quando è configurata la [firma asimmetrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Amministrazione

Tutto ciò che si trova sotto `/api/admin` richiede uno scope dal piano di amministrazione, e ciascuna
superficie definisce il proprio: `users:read` elenca gli account, `cron:write` attiva un job.
Un amministratore li detiene tutti, così come la service key. Un utente detiene quelli
dichiarati dai propri ruoli, e una chiave API quelli con cui è stata creata. Una chiave limitata
a una tabella non può accedere a nulla di tutto questo. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e solo finché non esiste alcun amministratore | Rifiutato in produzione — vedi [Bootstrap del primo utente](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestione utenti |
| `POST` | `/api/admin/users` | `users:write` | Gestione utenti. I ruoli superiori a quelli del chiamante vengono rifiutati |
| `GET` | `/api/admin/users/pick` | `users:read`, o accesso in scrittura a una tabella con una colonna `.userId()` | La [lettura per il selettore utenti](/docs/backend/auth-endpoints/): solo id, nome, email e avatar. Una tabella le cui regole di scrittura sono in SQL grezzo non è considerata valida |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestione utenti |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che detiene più permessi del chiamante |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che detiene più permessi del chiamante |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Rilascia una password temporanea |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Rimuove i secondi fattori e i codici di recupero dell'account, terminandone le sessioni |
| `GET` | `/api/admin/guests` | `users:read` | Ospiti, ordinati a partire da quelli non visti da più tempo. `?lastSeenBefore=` li limita a ciò che l'eliminazione sottostante rimuoverebbe, e `total` li conta |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un batch di ospiti visti l'ultima volta prima di `?lastSeenBefore=`, che è obbligatorio. Risponde con `{ deleted, skipped, remaining }`. Ripetere finché `remaining` non è 0, con `?offset=` impostato sul numero di elementi saltati. Gli account non possono essere raggiunti |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un ospite. Un account registrato viene rifiutato con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e i ruoli dichiarati dal progetto, con i relativi scope |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Chiavi API](/docs/backend/api-keys/). Mai da una chiave API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La chiave in chiaro viene restituita una sola volta, al momento della creazione |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Chiavi API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Chiavi API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Chiavi API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Job](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Job](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Abilita o disabilita un job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Job](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Esegue un job immediatamente. `?async=1` risponde con `202` non appena avviato — [API Cron Jobs](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario dei backup |
| `GET` | `/api/admin/backups/download` | `backups:read` | Trasmette un backup in streaming. Con `?token=` da un link di download, non è richiesto alcun header, limitatamente a quel backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un link a un backup, `{ key }` → `{ url, token, expiresIn }`, valido per 60 secondi — [Backup](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Avvia in background una scansione per i file archiviati privi di riferimenti nelle righe, `?storageId=&olderThanHours=`. Risponde con `202` e il record della scansione: `id`, `status` (`queued`) e `runner` (`worker` quando si tratta di un job `storage.orphans` nella coda dei job, `in-process` quando il server lo esegue direttamente). Il record viene salvato nell'origine dati, sotto il percorso riservato `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Il record della scansione, `?storageId=`. Durante l'esecuzione: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` su `collectionsTotal`, `unscanned`). Una volta `completed`: `result`, il report precedentemente restituito da `GET /orphans`. Un'esecuzione che interrompe le segnalazioni per 10 minuti viene considerata `failed`. `404 STORAGE_SCAN_NOT_FOUND` se la sorgente non contiene tale scansione |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina i file orfani di una scansione completata in background, `202`. Ciascun file viene ricontrollato rispetto a ogni riga e voce di cronologia, e verificato nuovamente appena prima della cancellazione. L'esito corrisponde al campo `deletion` del record di scansione. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Deprecato: la scansione all'interno della richiesta, `?storageId=&olderThanHours=`. Risponde con `Deprecation: true`. Usa `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Deprecato, senza `?scan=`: esegue nuovamente la scansione ed elimina all'interno della richiesta. `409 STORAGE_SCAN_INCOMPLETE` se una tabella non è leggibile |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una cartella in un'altra sorgente mantenendo le stesse chiavi, una pagina per chiamata — ciò che invia `rebase storage move`; `400 STORAGE_SAME_LOCATION` per `deleteSource` tra due sorgenti archiviate nella medesima posizione |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Elenca nuovamente la sorgente dopo uno spostamento, con lo stesso payload, una pagina per chiamata: `{ checked, notMoved: [{ key, reason }], cursor? }` — ogni file ancora presente nella sorgente in caso di `deleteSource`, ogni file di cui la destinazione non possiede una copia in caso contrario. `rebase storage move` invoca questo endpoint al termine del trasferimento |
| `GET` | `/api/admin/logs` | `logs:read` | Il buffer dei log recenti |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Le voci di log più recenti |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | L'esito più recente dell'audit pianificato |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Ruoli, ruoli di regola degli utenti e service key attive che un amministratore può simulare |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Ogni tabella accessibile da `{ role?, userId?, apiKeyId? }`: righe visibili rispetto a quelle del chiamante, nascoste da scope o RLS, campi mascherati. Riservato alla sessione dell'amministratore |
| `POST` | `/api/admin/sql/csv` | `database:write` | Trasmette l'intero risultato di una query di sola lettura come flusso CSV — l'opzione "Scarica il risultato completo come CSV" di [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Cosa ha modificato un [branch](/docs/backend/branching/#reviewing-and-merging-a-branch): schema, criteri e righe, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Scrive le righe del branch nel suo parent, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` se uno dei due lati è cambiato rispetto al diff, o se le righe sono in conflitto |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Modifica dello schema in tempo reale](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Pianifica una modifica; non ne applica mai alcuna |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Riservato a utenti fisici, a meno di `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Pianifica l'eliminazione del vincolo `NOT NULL` e la rimozione delle colonne non dichiarate indicate in `drop`, per la [riconciliazione dello schema](/docs/cli/schema/#rebase-schema-reconcile); non ne applica mai alcuna |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applica un piano di riconciliazione, solo se il relativo `digest` corrisponde al parametro `confirm` inviato |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Se l'editor è disponibile, e il motivo qualora non lo sia |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | <span class="since-badge" data-since="0.31">Da 0.31</span> Ogni tabella esportata da `backend/schema/index.ts` così come letta dall'editor, con le sezioni modificate nel codice (in sola lettura) e i relativi motivi — [Modifica dello schema in tempo reale](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> `{ patches: TablePatch[] }`: i file che la modifica scriverebbe, compilati; non scrive nulla |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> La medesima modifica, scritta in `backend/schema`; il database non viene toccato |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | <span class="since-badge" data-since="0.31">Da 0.31</span> Tabelle presenti nel database ma non dichiarate in `backend/schema`: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | <span class="since-badge" data-since="0.31">Da 0.31</span> Una di esse descritta in dettaglio: `{ table: { …, descriptor, rlsRaised?, notes } }`, per "Importa una tabella esistente". `404` se sconosciuta o già dichiarata, `400 SCHEMA_EDIT_REFUSED` se priva di chiave primaria |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | <span class="since-badge" data-since="0.31">Da 0.31</span> Le chiamate `defineFirestoreCollection` in `frontend/src/cms` che l'editor può riscrivere (solo in sviluppo) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> I file che verrebbero scritti modificando una di queste chiamate; non scrive nulla |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> La stessa modifica, applicata direttamente sul file. `409 SCHEMA_EDIT_STALE_FILE` se il file è cambiato su disco |
| `GET` | `/api/admin/ui-config` | session | <span class="since-badge" data-since="0.31">Da 0.31</span> Le preferenze UI dell'area di lavoro per tabella, quelle del chiamante, e se il chiamante ha i permessi di scrittura su quelle dell'area di lavoro — vedi [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> Esegue il merge di un delta `UiTablePreferences` nelle preferenze dell'area di lavoro di una tabella (`replace` sostituisce). Scritto in `frontend/src/cms/ui-config.json` se il server ha permessi di scrittura sui sorgenti del progetto, altrimenti in `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Da 0.31</span> Rimuove le preferenze dell'area di lavoro per una tabella |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (un utente fisico) | <span class="since-badge" data-since="0.31">Da 0.31</span> Le preferenze del chiamante per una tabella. Le chiavi API non ne hanno alcuna: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (un utente fisico) | <span class="since-badge" data-since="0.31">Da 0.31</span> Rimuove le preferenze del chiamante per una tabella |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Messaggi email intercettati dal transport di sviluppo anziché inviati |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Svuota la casella di posta intercettata |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` sono serviti anche
ai loro percorsi precedenti alla versione 0.17 senza il segmento `/admin`. Questi alias sono
pensati per i progetti che non sono ancora migrati; scrivi il nuovo codice facendo riferimento al percorso canonico.

## Schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, o credenziale con `schema:read` o uno scope `data:*` | Tutte le tabelle servite da questo backend, come array JSON di descrittori redatti in base al chiamante |
| `GET` | `/api/schema/tables/:slug` | come sopra | Un singolo descrittore. `404 TABLE_NOT_FOUND` se a questo chiamante non è servita quella tabella |

I descrittori costituiscono la base con cui il CMS visualizza le impostazioni predefinite,
Studio disegna il visualizzatore di schemi e l'editor RLS, e le app MCP
eseguono il rendering di tabelle e form. Includono le colonne con i rispettivi tipi Postgres,
la nullabilità, le regole di validazione e storage, le relazioni per slug e la
configurazione della sicurezza a livello di riga (RLS). Il codice degli hook non lascia mai il server: un descrittore
indica unicamente quali hook sono associati a una tabella.

Ciò che viene restituito al chiamante dipende dalla sua identità:

| Chiamante | Tabelle | Omissioni / Redazioni |
|---|---|---|
| Un amministratore, un possessore di `schema:read` o la service key | tutte le tabelle, incluse le viste semplici | colonne `.private()`, per chiunque |
| Qualsiasi altra persona autenticata, inclusi gli ospiti | solo le tabelle raggiungibili da una regola permissiva per i rispettivi ruoli (oltre alla tabella auth e alle viste materializzate di cui possiedono i `roles`) | colonne e relazioni per cui i rispettivi ruoli non superano `access.read`; colonne `.private()`; unicamente le regole applicabili ai loro ruoli; relazioni verso tabelle non servite al chiamante; flag degli hook; SQL grezzo nelle regole, criteri compilati, query delle viste e indici |
| Una credenziale (chiave API, token MCP o di piattaforma) | le tabelle indicate dai rispettivi scope `data:*`, o tutte quante con `schema:read` | come sopra, valutato in base agli scope posseduti |
| Nessun utente autenticato | nessuna — `401` — a meno che il backend non imposti `schemaTables: { public: true }` | in tal caso le tabelle con una regola `select` pubblica, redatte come per il chiamante con privilegi minimi: nessuna colonna con elenco `access.read`, niente SQL grezzo, niente criteri |

Un utente mantiene `metadata`, `softDelete`, `tenant`, `history` e `search` sulle
tabelle a cui ha accesso. L'opzione `schemaTables: { persons: "all" }` nelle opzioni
del backend descrive ogni tabella e regola a qualsiasi chiamante autenticato; il
valore predefinito è `"granted"`. Le connessioni MCP vengono valutate come
credenziali, mediante il medesimo serializzatore.

Una credenziale priva sia di `schema:read` che di uno scope `data:*` riceve
`403 SCOPE_MISSING`. Un backend senza alcuna autenticazione configurata risponde
a ogni richiesta con `404 SCHEMA_UNAVAILABLE`: non c'è un chiamante per cui redigere i dati, e
`auth.requireAuth: false` non modifica questo comportamento.

Le risposte includono gli header `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` e l'header `x-rebase-schema`; una richiesta il cui header `If-None-Match`
indica il tag corrente riceve `304`. Il tag cambia ogni volta che lo schema viene modificato,
inclusi i casi di modifica dello schema in tempo reale.

`schemaTables` è un'opzione di `initializeRebaseBackend` priva di variabile
di ambiente: un progetto scaffolded vi accede effettuando l'eject.

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
| `GET` | `/api/storage/sources` | session | Le sorgenti di archiviazione denominate servite da questo backend |
| `OPTIONS` | `/api/storage/tus` | none | Caricamenti ripristinabili: le versioni e le estensioni TUS supportate da questo server |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Caricamenti ripristinabili: creazione |
| `GET` | `/api/storage/tus/:id` | proprietario dell'upload | Caricamenti ripristinabili: offset |
| `PATCH` | `/api/storage/tus/:id` | proprietario dell'upload | Caricamenti ripristinabili: append |
| `DELETE` | `/api/storage/tus/:id` | proprietario dell'upload | Caricamenti ripristinabili: annullamento |

Un deployment privo di storage configurato risponde a questo prefisso con un codice `501`
indicante la variabile necessaria, anziché restituire un 404 come se la funzionalità non esistesse —
fatta eccezione per `GET /api/storage/sources`, che risponde `200` con un elenco vuoto.

## Funzioni

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/functions` | session | I nomi delle funzioni servite e il numero di file che non è stato possibile caricare |
| qualsiasi | `/api/functions/<name>` | qualsiasi cosa dichiarata dalla funzione. Una chiave API necessita inoltre di `functions:invoke` | [Funzioni personalizzate](/docs/backend/custom-functions/) |

Una route per ciascun file presente in `backend/functions/`, pertanto i percorsi provengono dal
tuo progetto. `GET /api/functions` li elenca esclusivamente a un chiamante autenticato — una
sessione, una chiave API o la service key — e risponde a chiunque altro con `401`: un
inventario degli endpoint personalizzati di un deployment non è pubblico.

## Meta e operazioni

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/livez` | none | Sola liveness: indica se questo processo è in esecuzione. Non tocca il database, motivo per cui è il percorso di probe che un container dovrebbe utilizzare — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Riporta ogni data source configurata, non solo quella predefinita |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Da 0.31</span> il pubblico dell'endpoint dello schema per impostazione predefinita (401 per anonimi a meno di `schemaTables.public`, 403 per credenziali prive di scope per schema o data); none se `enableSwagger` è `true`; il gate admin quando è `false` | Il documento OpenAPI 3.0 relativo alle tabelle descritte al chiamante da `GET /api/schema/tables` (tutte quante con `enableSwagger: true`). `404 DOCS_UNAVAILABLE` quando non è configurata alcuna autenticazione |
| `GET` | `/api/swagger` | none | Swagger UI. Solo quando `enableSwagger` è `true`, e mai in produzione |
| `GET` | `/api/meta/schema-version` | none | L'hash dello schema da cui è stato compilato questo backend e la versione di runtime, nient'altro |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — ogni tabella così come visualizzata da un amministratore, l'input di `rebase generate-sdk --from`. `404` se l'autenticazione non è configurata |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` se impostato | Metriche di Prometheus, se `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` se impostato | Le serie registrate alla base dei grafici di Studio. `501` su un runtime privo di backend |

Le connessioni WebSocket arrivano come upgrade HTTP sullo stesso server invece che su
un percorso dedicato — vedi [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montata solo quando `REBASE_MCP_ENABLED=true`, che richiede inoltre
`REBASE_PUBLIC_URL` — vedi
[Configurazione](/docs/getting-started/configuration/#mcp-surface). Disattivata per
impostazione predefinita: nessun `REBASE_ROLE` abilita questa funzionalità, poiché concede l'accesso
al progetto a software di terze parti e questa rappresenta una decisione che spetta a un utente.

I documenti `.well-known` risiedono all'**origine**, non sotto `basePath`: RFC 8414
e RFC 9728 definiscono tali percorsi rispetto all'origine, e un client li richiede
prima di disporre di un token.

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadati RFC 9728 che identificano questa risorsa e il relativo server di autorizzazione. Serviti anche nella forma con suffisso del percorso |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadati RFC 8414: gli endpoint, i tipi di autorizzazione e i metodi PKCE supportati da questo deployment |
| `POST` | `/mcp` | Bearer OAuth, o una chiave API | L'endpoint del protocollo MCP. Agisce **come l'utente autenticato** (o come colui che la chiave rappresenta), pertanto ogni operazione di lettura e scrittura è soggetta alla stessa RLS. Gli scope `data:*` determinano quali strumenti vengono offerti |
| `GET` | `/mcp` | Bearer OAuth, o una chiave API | Risponde `405` con `Allow: POST, DELETE`: questo server non apre stream avviati dal server. Il token viene verificato preliminarmente, pertanto l'assenza o la scadenza comporta la ricezione della challenge `401` |
| `DELETE` | `/mcp` | none | Risponde `204`. L'endpoint non memorizza alcuna sessione, quindi non c'è nulla da terminare |
| `POST` | `/api/oauth/register` | soggetto a rate-limit | Registrazione dinamica dei client RFC 7591. Rifiutata se `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La schermata di consenso a cui viene reindirizzato il client |
| `POST` | `/api/oauth/authorize/decision` | session | La decisione dell'utente in merito — approva o nega |
| `POST` | `/api/oauth/token` | credenziali client + PKCE | Scambia un codice di autorizzazione, o esegue il refresh |
| `POST` | `/api/oauth/revoke` | credenziali client | Revoca del token RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quali client sono stati approvati da questo utente |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Ne revoca uno, consentendo all'utente di revocare un consenso senza l'intervento di un amministratore |

L'endpoint MCP dedicato del pannello di amministrazione non fa parte di questa superficie: accetta
la sessione del pannello di amministrazione, mai un token OAuth, ed è montato con le route
di amministrazione a prescindere dall'impostazione di `REBASE_MCP_ENABLED`, tramite un driver che associa
ciascuna chiamata al controllo RLS.

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, mai anonimo | **Sperimentale.** Gli stessi strumenti di `/mcp`, per l'utente autenticato, con `data:read`, `data:write` e `data:delete`, sotto la relativa RLS. La visualizzazione `savedAppsView` del pannello di amministrazione apre le [applicazioni salvate](/docs/ai/remote-mcp/) attraverso di esso |

## Risorse correlate

- [API REST](/docs/backend/api/) — la documentazione completa delle route dati: filtri, ordinamento, paginazione, errori
- [Endpoint di autenticazione](/docs/backend/auth-endpoints/) — formati di richiesta e risposta per la tabella di autenticazione sopra indicata
- [Ambiente e configurazione](/docs/getting-started/configuration/) — le variabili che stabiliscono quali di questi endpoint vengono montati

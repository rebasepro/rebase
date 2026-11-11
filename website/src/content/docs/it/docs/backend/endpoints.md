---
sourceHash: 7410dc424b969f2a
title: Indice degli endpoint
sidebar_label: Indice degli endpoint
description: Tutte le rotte HTTP montate da un backend Rebase — dati, autenticazione, archiviazione, admin, meta — con il gate corrispondente e la pagina che la descrive.
---

Tutte le rotte montate dal server, in un'unica tabella, con i requisiti necessari per raggiungerle.

I percorsi presuppongono il `basePath` predefinito di `/api`; `REBASE_BASE_PATH` li sposta tutti insieme. `/health`, `/livez` e `/metrics` si trovano intenzionalmente all'esterno, poiché un orchestratore esegue i probe su `/health` e non dovrebbe dover conoscere il percorso di base. `/health` è *anche* montato al suo interno, in modo che `/api/health` risponda allo stesso modo anziché restituire un 404 proprio nel momento in cui si verifica se il server è attivo.

Un controllo (gate) — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — confronta questa tabella con le rotte registrate dal codice sorgente, impedendo l'aggiunta di una nuova superficie senza che compaia qui.

## Gate

| Gate | Significato |
|---|---|
| **none** | Non autenticato. Chiunque possa raggiungere l'host può chiamarlo |
| **session** | Un chiamante autenticato: un token di accesso o una chiave API con ambito limitato all'operazione |
| **`resource:action`** | Un chiamante in possesso di tale [scope](/docs/backend/roles-and-scopes/): un amministratore, un utente il cui ruolo lo dichiara, una chiave API creata con esso o la service key |
| **RLS** | Autenticato, e successivamente il database decide riga per riga — vedi [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montato solo al di fuori dell'ambiente di produzione |

## Dati

Generato per collezione, quindi i percorsi utilizzano gli slug specifici anziché un elenco fisso. `:slug` è lo `slug` di una collezione.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | L'elenco, con parametri di query nel corpo — [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Il conteggio, con parametri di query nel corpo — [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Ricalcola una collezione vista materializzata, sulle collezioni che ne supportano una — [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias deprecato di `PATCH` — stessa scrittura parziale, risponde con `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserisce più righe, facoltativamente eseguendo l'upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Aggiorna più righe per id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina più righe per id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Scrittura su più collezioni in un'unica transazione — [Writing over REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Il conteggio e l'aggregazione sono rotte a sé stanti, registrate prima di `/:id` affinché `aggregate` non venga interpretato come l'id di un'entità. `?select=` e `?groupBy=` sono i relativi parametri, e `select` è obbligatorio su `/aggregate`.

La ricerca testuale, la ricerca vettoriale, l'inclusione di relazioni e la selezione dei campi *sono* parametri di query su `GET /api/data/:slug` anziché rotte distinte — `searchString`, `vector_search`, `include`, `fields`. Vedi [REST API](/docs/backend/api/).

Un progetto che non dichiara né analizza mediante introspezione alcuna collezione risponde a questo prefisso con un unico `404 NO_COLLECTIONS`. Vedi [Backend only](/docs/getting-started/headless/).

## Autenticazione

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Ciò che la schermata di accesso può offrire: registrazione, reimpostazione della password, magic link, codici via email, accesso guest, provider OAuth e se la configurazione del primo amministratore è in sospeso |
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
| `POST` | `/api/auth/confirm-email-change` | none (un token del link) | Trasferisce l'account sul nuovo indirizzo — [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token di verifica) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token di verifica e una sessione o la password per mantenerla) | [Email verification](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token del link) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codici monouso via email |
| `POST` | `/api/auth/otp/verify` | none (un codice) | Codici monouso via email |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Da 0.31</span> [Device sign-in](/docs/backend/device-sign-in/). Disattivato a meno che il backend non lo abiliti |
| `POST` | `/api/auth/device/token` | none (un codice del dispositivo) | [Device sign-in](/docs/backend/device-sign-in/): il polling del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Device sign-in](/docs/backend/device-sign-in/): ciò che mostra la pagina di approvazione |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un secondo fattore) | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessioni guest. Disattivato se non è impostato `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un guest) | Trasforma un guest in un account |
| `POST` | `/api/auth/find-user` | session | Disattivato se non è impostato `AUTH_ALLOW_USER_LOOKUP` — costituisce una superficie di enumerazione |
| `POST` | `/api/auth/:provider` | none | Uno per ciascun provider OAuth/OIDC configurato |
| `POST` | `/api/auth/link/:provider` | session | Collega un provider all'account autenticato |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un accesso in corso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un ID di challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Tutti gli scope noti a questo backend e quelli posseduti dal chiamante — [Roles and scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un account) | Le [personal keys](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | session (un account) | La chiave in testo non crittografato viene restituita una sola volta. `403 PERSONAL_KEYS_DISABLED` a meno che la collezione degli utenti non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un account) | Revoca una delle chiavi dell'utente chiamante |
| `GET` | `/.well-known/jwks.json` | none | Il JWKS pubblico, quando è configurata la [firma asimmetrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Admin

Tutto ciò che si trova sotto `/api/admin` richiede uno scope dal piano di amministrazione, e ogni superficie dichiara il proprio: `users:read` elenca gli account, `cron:write` attiva un job. Un amministratore li possiede tutti, così come la service key. Una persona possiede quelli dichiarati dai propri ruoli, e una chiave API quelli con cui è stata creata. Una chiave limitata a una collezione non ha accesso a nulla di tutto ciò. Vedi [Roles and scopes](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e solo se non esiste ancora alcun amministratore | Rifiutato in produzione — vedi [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestione utenti |
| `POST` | `/api/admin/users` | `users:write` | Gestione utenti. I ruoli superiori a quelli del chiamante vengono rifiutati |
| `GET` | `/api/admin/users/pick` | `users:read`, oppure accesso in scrittura a una collezione con un campo `userSelect` | La [lettura dello user picker](/docs/backend/auth-endpoints/): solo id, nome, email e avatar. Una collezione le cui regole di scrittura sono in SQL grezzo non è considerata valida |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestione utenti |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che possiede più privilegi del chiamante |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che possiede più privilegi del chiamante |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emette una password temporanea |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Rimuove i secondi fattori e i codici di recupero dell'account, terminandone le sessioni |
| `GET` | `/api/admin/guests` | `users:read` | Guest, ordinati per ultima visualizzazione a partire dal meno recente. `?lastSeenBefore=` li restringe a ciò che la cancellazione sottostante eliminerebbe, e `total` ne fornisce il conteggio |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un batch dei guest visti l'ultima volta prima di `?lastSeenBefore=`, che è obbligatorio. Risponde con `{ deleted, skipped, remaining }`. Ripetere finché `remaining` non è 0, con `?offset=` impostato sul numero di elementi saltati. Non può interagire con gli account |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un guest. Un account viene rifiutato con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e i ruoli dichiarati dal progetto, con i rispettivi scope |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API keys](/docs/backend/api-keys/). Mai da una chiave API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La chiave in testo non crittografato viene restituita una sola volta, al momento della creazione |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Abilita o disabilita un job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Esegue un job adesso. `?async=1` risponde con `202` una volta avviato — [Cron Jobs API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario dei backup |
| `GET` | `/api/admin/backups/download` | `backups:read` | Trasmette in streaming un backup. Con `?token=` da un link di download non è richiesto alcun header, limitatamente a quel backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un link a un backup, `{ key }` → `{ url, token, expiresIn }`, valido per 60 secondi — [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Avvia in background una scansione dei file archiviati che non sono referenziati da alcuna riga, `?storageId=&olderThanHours=`. Risponde con `202` indicando il record della scansione: `id`, `status` (`queued`) e `runner` (`worker` quando si tratta di un job `storage.orphans` nella coda dei job, `in-process` quando il server lo esegue autonomamente). Il record viene scritto nella sorgente, sotto il percorso riservato `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Il record della scansione, `?storageId=`. Durante l'esecuzione: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` di `collectionsTotal`, `unscanned`). Una volta completata (`completed`): `result`, il report restituito dalla precedente `GET /orphans`. Un'esecuzione che smette di inviare aggiornamenti per 10 minuti viene considerata `failed`. `404 STORAGE_SCAN_NOT_FOUND` se la sorgente non contiene tale scansione |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina in background gli orfani di una scansione completata, `202`. Ciascun file viene verificato nuovamente rispetto a ogni riga e voce cronologica prima dell'eliminazione. Il risultato è la proprietà `deletion` del record di scansione. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Deprecato: esegue la scansione all'interno della richiesta, `?storageId=&olderThanHours=`. Risponde con `Deprecation: true`. Usa `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Deprecato, senza `?scan=`: riesegue la scansione ed elimina all'interno della richiesta. `409 STORAGE_SCAN_INCOMPLETE` se una collezione non può essere letta |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una cartella in un'altra sorgente mantenendo le stesse chiavi, una pagina per chiamata — ciò che invia `rebase storage move`; `400 STORAGE_SAME_LOCATION` per `deleteSource` tra due sorgenti archiviate nella stessa posizione |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Elenca nuovamente la sorgente dopo uno spostamento, con lo stesso corpo, una pagina per chiamata: `{ checked, notMoved: [{ key, reason }], cursor? }` — ogni file ancora presente nella sorgente con `deleteSource`, ogni file di cui la destinazione non ha una copia senza di esso. Viene interrogato da `rebase storage move` al termine dello spostamento |
| `GET` | `/api/admin/logs` | `logs:read` | Il buffer dei log recenti |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Le voci più recenti |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | L'ultimo risultato dell'audit pianificato |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Ruoli, rule role degli utenti e service key attive che un amministratore può simulare |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Ciascuna collezione come viene visualizzata da `{ role?, userId?, apiKeyId? }`: righe visibili rispetto a quelle del chiamante, nascoste da scope o RLS, campi mascherati. Solo sessione amministratore |
| `POST` | `/api/admin/sql/csv` | `database:write` | Trasmette in streaming l'intero risultato di una query in sola lettura come CSV — "Download full result as CSV" di [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Ciò che un [branch](/docs/backend/branching/#reviewing-and-merging-a-branch) ha modificato: schema, policy e righe, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Scrive le righe del branch nel genitore, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` quando uno dei due lati è cambiato rispetto al diff o vi sono conflitti tra le righe |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Pianifica una modifica; non ne applica mai alcuna |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo un utente umano, a meno che non sia impostato `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Pianifica la rimozione del vincolo `NOT NULL` e l'eliminazione delle colonne non dichiarate specificate in `drop`, per [schema reconcile](/docs/cli/schema/#rebase-schema-reconcile); non ne applica mai alcuno |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applica un piano di riconciliazione, solo se il relativo `digest` corrisponde al `confirm` inviato |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Se l'editor è disponibile e il motivo qualora non lo sia |
| `POST` | `/api/admin/schema-editor/collection/save` | `schema:write` | [Studio](/docs/studio/) — riscrive il sorgente della collezione |
| `POST` | `/api/admin/schema-editor/collection/delete` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | `schema:write` | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Email catturate dal trasporto di sviluppo anziché inviate |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Svuota la casella di posta catturata |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` sono serviti anche sui percorsi antecedenti alla versione 0.17 senza il segmento `/admin`. Questi alias sono destinati ai progetti che non sono ancora migrati; scrivere il nuovo codice utilizzando il percorso canonico.

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
| `GET` | `/api/storage/sources` | session | Le sorgenti di archiviazione denominate servite da questo backend |
| `OPTIONS` | `/api/storage/tus` | none | Caricamenti ripristinabili: le versioni e le estensioni TUS supportate da questo server |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Caricamenti ripristinabili: creazione |
| `GET` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: offset |
| `PATCH` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: aggiunta (append) |
| `DELETE` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: annullamento |

Un deployment senza alcuna configurazione di archiviazione risponde a questo prefisso con un codice `501` indicando la variabile necessaria, anziché restituire un 404 come se la funzionalità non esistesse — fatta eccezione per `GET /api/storage/sources`, che risponde `200` con un elenco vuoto.

## Funzioni

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/functions` | session | I nomi delle funzioni servite e quanti file non sono stati caricati |
| any | `/api/functions/<name>` | qualsiasi valore dichiarato dalla funzione. Una chiave API necessita anche di `functions:invoke` | [Custom Functions](/docs/backend/custom-functions/) |

Una rotta per ciascun file sotto `backend/functions/`, quindi i percorsi derivano dal proprio progetto. `GET /api/functions` li elenca solo a un chiamante autenticato — una sessione, una chiave API o la service key — e risponde a chiunque altro con `401`: l'inventario degli endpoint personalizzati di un deployment non è pubblico.

## Meta e operazioni

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/livez` | none | Solo liveness: verifica se questo processo è in esecuzione. Non tocca il database, motivo per cui è il percorso probe che un container dovrebbe utilizzare — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Riporta ogni data source configurata, non solo quella predefinita |
| `GET` | `/api/docs` | none (`schema:read` quando `enableSwagger` è `false`, il valore predefinito del runtime in produzione) | Il documento OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Solo al di fuori della produzione; `REBASE_ENABLE_SWAGGER` non può abilitarlo in produzione. Non viene servito quando `enableSwagger` è `false`, nemmeno in sviluppo |
| `GET` | `/api/meta/schema-version` | none | L'hash dello schema a partire dal quale è stato compilato questo backend e la versione del runtime, e nient'altro |
| `GET` | `/api/meta/contract` | `schema:read` | Il contratto completo della collezione, per `rebase generate-sdk --from`. `404` quando non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` se impostato | Metriche Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` se impostato | Le serie registrate alla base dei grafici di Studio. `501` su un runtime privo di backend |

Le connessioni WebSocket arrivano come un aggiornamento (HTTP upgrade) sullo stesso server anziché su un percorso dedicato — vedi [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montato solo quando `REBASE_MCP_ENABLED=true`, che richiede anche `REBASE_PUBLIC_URL` — vedi [Configuration](/docs/getting-started/configuration/#mcp-surface). Disattivato per impostazione predefinita: nessun `REBASE_ROLE` lo attiva, poiché concede l'accesso al progetto a software di terze parti e questa è una decisione riservata a un essere umano.

I documenti `.well-known` si trovano all'**origin**, non sotto `basePath`: le RFC 8414 e RFC 9728 definiscono tali percorsi relativi all'origin, e un client li recupera prima di possedere qualsiasi token.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadati RFC 9728 che definiscono questa risorsa e il relativo server di autorizzazione. Servito anche nella forma con suffisso del percorso |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadati RFC 8414: gli endpoint, i grant type e i metodi PKCE supportati da questo deployment |
| `POST` | `/mcp` | bearer OAuth, o una chiave API | L'endpoint del protocollo MCP. Agisce **come l'utente autenticato** (o come chiunque sia rappresentato dalla chiave), quindi ogni lettura e scrittura è soggetta alle medesime RLS. Gli scope `data:*` determinano quali strumenti vengono offerti |
| `GET` | `/mcp` | bearer OAuth, o una chiave API | Risponde `405` con `Allow: POST, DELETE`: questo server non apre stream avviati dal server. Il token viene verificato per primo, pertanto un token mancante o non valido riceverà invece la challenge `401` |
| `DELETE` | `/mcp` | none | Risponde `204`. L'endpoint non mantiene sessioni, quindi non c'è nulla da terminare |
| `POST` | `/api/oauth/register` | con limitazione della frequenza | Registrazione dinamica dei client RFC 7591. Rifiutata quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La schermata di consenso a cui viene reindirizzato un client |
| `POST` | `/api/oauth/authorize/decision` | session | La risposta dell'utente — approva o rifiuta |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Scambia un codice di autorizzazione o esegue il refresh |
| `POST` | `/api/oauth/revoke` | client credentials | Revoca dei token RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quali client sono stati approvati da questo utente |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Ne revoca uno, consentendo a un utente di revocare un consenso senza l'intervento di un amministratore |

L'endpoint MCP del pannello di amministrazione non fa parte di questa superficie: accetta la sessione del pannello di amministrazione, mai un token OAuth, ed è montato con le rotte admin indipendentemente dall'impostazione di `REBASE_MCP_ENABLED`, su un driver che limita l'ambito di ciascuna chiamata tramite RLS.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, mai anonimo | **Sperimentale.** Gli stessi strumenti di `/mcp`, per l'utente autenticato, con `data:read`, `data:write` e `data:delete`, soggetti alle sue RLS. La vista `savedAppsView` del pannello di amministrazione apre le [applicazioni salvate](/docs/ai/remote-mcp/) tramite questo endpoint |

## Correlati

- [REST API](/docs/backend/api/) — le rotte dei dati al completo: filtri, ordinamento, paginazione, errori
- [Auth endpoints](/docs/backend/auth-endpoints/) — formati di richiesta e risposta per la tabella di autenticazione sopra
- [Environment & Configuration](/docs/getting-started/configuration/) — le variabili che determinano quali di queste rotte vengono montate

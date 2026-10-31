---
sourceHash: 169899c54121eb6e
title: Indice degli endpoint
sidebar_label: Indice degli endpoint
description: Tutte le route HTTP montate da un backend Rebase — dati, autenticazione, archiviazione, amministrazione, meta — con il gate su ciascuna e la pagina che la descrive.
---

Tutte le route montate dal server, in un'unica tabella, con i requisiti necessari per raggiungerle.

I percorsi assumono il `basePath` predefinito `/api`; `REBASE_BASE_PATH` li sposta
tutti insieme. `/health`, `/livez` e `/metrics` risiedono volutamente al di fuori di esso,
poiché un orchestratore esegue probe su `/health` e non dovrebbe dover conoscere il percorso
base. `/health` è *anche* montato sotto di esso, così `/api/health` risponde allo stesso
modo anziché restituire un 404 proprio nel momento in cui qualcuno sta verificando se il server
è attivo.

Un gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — confronta questa
tabella con le route registrate dal codice sorgente, in modo che non sia possibile aggiungere
una nuova superficie senza che compaia qui.

## Gate

| Gate | Significato |
|---|---|
| **none** | Non autenticato. Chiunque possa raggiungere l'host può chiamarlo |
| **session** | Un chiamante autenticato: un token di accesso o una chiave API limitata all'operazione |
| **`resource:action`** | Un chiamante in possesso di tale [scope](/docs/backend/roles-and-scopes/): un amministratore, una persona il cui ruolo lo dichiara, una chiave API creata con esso o la chiave di servizio |
| **RLS** | Autenticato, dopodiché il database decide riga per riga — vedi [Regole di sicurezza](/docs/collections/security-rules/) |
| **dev** | Montato solo al di fuori della produzione |

## Dati

Generato per collezione, quindi i percorsi contengono i tuoi slug invece di un
elenco fisso. `:slug` è lo `slug` di una collezione.

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Interrogazione](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | L'elenco, parametri di query nel corpo — [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Interrogazione](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Il conteggio, parametri di query nel corpo — [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias deprecato di `PATCH` — stessa scrittura parziale, risponde con `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserisce più righe, facoltativamente eseguendo un upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Aggiorna più righe per ID — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina più righe per ID — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Scrittura attraverso più collezioni in un'unica transazione — [Scrittura via REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Cronologia entità](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Cronologia entità](/docs/backend/history/) |

Il conteggio e l'aggregazione sono route a sé stanti, registrate prima di `/:id` in
modo che `aggregate` non venga interpretato come l'ID di un'entità. `?select=` e `?groupBy=` sono
i loro parametri, e `select` è obbligatorio su `/aggregate`.

La ricerca testuale, la ricerca vettoriale, l'inclusione di relazioni e la selezione dei campi *sono* parametri
di query su `GET /api/data/:slug` anziché route — `searchString`,
`vector_search`, `include`, `fields`. Vedi [REST API](/docs/backend/api/).

Un progetto che non dichiara alcuna collezione e non ne esegue l'introspezione serve questo prefisso
come un singolo `404 NO_COLLECTIONS`. Vedi [Solo backend](/docs/getting-started/headless/).

## Autenticazione

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Cosa può offrire la schermata di login: registrazione, reimpostazione della password, magic link, codici via email, accesso come ospite, provider OAuth e se la configurazione del primo amministratore è in sospeso |
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
| `POST` | `/api/auth/confirm-email-change` | none (un link token) | Sposta l'account sul nuovo indirizzo — [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticazione](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token di verifica) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token di verifica, e una sessione o la password per mantenerla) | [Verifica dell'email](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un link token) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codici monouso via email |
| `POST` | `/api/auth/otp/verify` | none (un codice) | Codici monouso via email |
| `POST` | `/api/auth/anonymous` | none | Sessioni ospite. Disattivato a meno che non sia impostato `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un ospite) | Trasforma un ospite in un account |
| `POST` | `/api/auth/find-user` | session | Disattivato a meno che non sia impostato `AUTH_ALLOW_USER_LOOKUP` — rappresenta una superficie di enumerazione |
| `POST` | `/api/auth/:provider` | none | Uno per ogni provider OAuth/OIDC configurato |
| `POST` | `/api/auth/link/:provider` | session | Collega un provider all'account autenticato |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un accesso in corso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un challenge ID) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Tutti gli scope noti a questo backend e quelli posseduti dal chiamante — [Ruoli e scope](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un account) | Le [chiavi personali](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | session (un account) | La chiave in chiaro viene restituita una sola volta. `403 PERSONAL_KEYS_DISABLED` a meno che la collezione users non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un account) | Revoca una delle chiavi del chiamante |
| `GET` | `/.well-known/jwks.json` | none | Il JWKS pubblico, quando è configurata la [firma asimmetrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Amministrazione

Tutto ciò che si trova sotto `/api/admin` richiede uno scope dal piano di amministrazione, e ogni
superficie indica il proprio: `users:read` elenca gli account, `cron:write` attiva un job.
Un amministratore li possiede tutti, così come la chiave di servizio. Una persona possiede quelli
dichiarati dai propri ruoli, e una chiave API quelli con cui è stata creata. Una chiave limitata a
una collezione non può accedere a nulla di tutto questo. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e solo finché non esiste alcun amministratore | Rifiutato in produzione — vedi [Bootstrap del primo utente](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestione utenti |
| `POST` | `/api/admin/users` | `users:write` | Gestione utenti. I ruoli superiori a quelli del chiamante vengono rifiutati |
| `GET` | `/api/admin/users/pick` | `users:read`, oppure accesso in scrittura a una collezione con un campo `userSelect` | La [lettura del selettore utenti](/docs/backend/auth-endpoints/): solo id, nome, email e avatar. Una collezione le cui regole di scrittura sono SQL grezzo non è considerata valida |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestione utenti |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che possiede più privilegi del chiamante |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rifiutato per un account che possiede più privilegi del chiamante |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Rilascia una password temporanea |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Rimuove i secondi fattori e i codici di recupero dell'account, termina le sue sessioni |
| `GET` | `/api/admin/guests` | `users:read` | <span class="since-badge" data-since="0.27">Since 0.27</span> Ospiti, ordinati per ultima visualizzazione a partire dai meno recenti. `?lastSeenBefore=` li restringe a quanto verrebbe eliminato con l'operazione successiva, e `total` ne riporta il conteggio |
| `DELETE` | `/api/admin/guests` | `users:write` | <span class="since-badge" data-since="0.27">Since 0.27</span> Elimina un batch degli ospiti visti per l'ultima volta prima di `?lastSeenBefore=`, che è obbligatorio. Risponde con `{ deleted, skipped, remaining }`. Ripetere finché `remaining` non è 0, con `?offset=` impostato sul numero di elementi saltati. Gli account non possono essere raggiunti |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | <span class="since-badge" data-since="0.27">Since 0.27</span> Elimina un ospite. Un account viene rifiutato con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e i ruoli dichiarati dal progetto, con i relativi scope |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Chiavi API](/docs/backend/api-keys/). Mai una chiave API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La chiave in chiaro viene restituita una sola volta, al momento della creazione |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Chiavi API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Chiavi API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Chiavi API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Abilita o disabilita un job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Esegue subito un job. `?async=1` risponde `202` una volta avviato — [API dei cron job](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario dei backup |
| `GET` | `/api/admin/backups/download` | `backups:read` | Trasmette in streaming un backup. Con `?token=` da un link di download, non è richiesta alcuna intestazione, solo per quel backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un link a un backup, `{ key }` → `{ url, token, expiresIn }`, valido per 60 secondi — [Backup](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Avvia in background una scansione per i file archiviati non referenziati da alcuna riga, `?storageId=&olderThanHours=`. Risponde `202` con il record della scansione: `id`, `status` (`queued`) e `runner` (`worker` quando è un job `storage.orphans` nella coda dei job, `in-process` quando il server lo esegue internamente). Il record viene scritto nella sorgente, sotto il percorso riservato `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Il record della scansione, `?storageId=`. Durante l'esecuzione: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` su `collectionsTotal`, `unscanned`). Una volta `completed`: `result`, il report restituito dalla vecchia route `GET /orphans`. Un'esecuzione che smette di inviare report per 10 minuti viene considerata `failed`. `404 STORAGE_SCAN_NOT_FOUND` quando la sorgente non contiene tale scansione |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina in background gli orfani di una scansione completata, `202`. Ciascuno viene nuovamente verificato rispetto a ogni riga e voce di cronologia, e ricontrollato immediatamente prima dell'eliminazione. Il risultato è il campo `deletion` del record della scansione. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Deprecato: la scansione all'interno della richiesta, `?storageId=&olderThanHours=`. Risponde con `Deprecation: true`. Usa `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Deprecato, senza `?scan=`: esegue nuovamente la scansione ed elimina all'interno della richiesta. `409 STORAGE_SCAN_INCOMPLETE` se non è stato possibile leggere una collezione |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una cartella in un'altra sorgente mantenendo le stesse chiavi, una pagina per chiamata — ciò che invia `rebase storage move`; `400 STORAGE_SAME_LOCATION` per `deleteSource` tra due sorgenti archiviate nella stessa posizione |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Elenca nuovamente la sorgente dopo uno spostamento, con lo stesso corpo, una pagina per chiamata: `{ checked, notMoved: [{ key, reason }], cursor? }` — ogni file ancora presente nella sorgente con `deleteSource`, ogni file di cui la destinazione non ha una copia senza di esso. `rebase storage move` la interroga al termine dello spostamento |
| `GET` | `/api/admin/logs` | `logs:read` | Il buffer dei log recenti |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Le voci più recenti |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | L'ultimo risultato dell'audit pianificato |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Ruoli, ruoli di regola degli utenti e chiavi di servizio attive che un amministratore può simulare |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Ogni collezione nel modo in cui `{ role?, userId?, apiKeyId? }` vi accede: righe visibili rispetto a quelle del chiamante, nascoste per scope o RLS, campi mascherati. Solo sessione di amministratore |
| `POST` | `/api/admin/sql/csv` | `database:write` | Trasmette in streaming l'intero risultato di una query di sola lettura in formato CSV — la funzione "Download full result as CSV" di [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Cosa ha modificato un [branch](/docs/backend/branching/#reviewing-and-merging-a-branch): schema, criteri e righe, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Scrive le righe del branch nel genitore, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` se uno dei due lati è cambiato rispetto al diff o se ci sono conflitti tra le righe |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Modifica dello schema live](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Pianifica una modifica; non ne applica mai alcuna |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo una persona, a meno che non sia impostato `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indica se l'editor è disponibile e il motivo qualora non lo sia |
| `POST` | `/api/admin/schema-editor/collection/save` | `schema:write` | [Studio](/docs/studio/) — riscrive il sorgente della collezione |
| `POST` | `/api/admin/schema-editor/collection/delete` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | `schema:write` | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Email catturate dal trasporto di sviluppo invece di essere inviate |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Svuota la casella di posta catturata |

Anche `/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` sono
serviti nei loro percorsi precedenti alla versione 0.17 senza il segmento `/admin`. Questi
alias sono destinati ai progetti che non sono ancora stati migrati; scrivi il nuovo codice
utilizzando il percorso canonico.

## Archiviazione

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Archiviazione](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Archiviazione](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Archiviazione](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Archiviazione](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, per chiave | [Archiviazione](/docs/backend/storage/#storage-endpoints): metadati per un massimo di 100 oggetti |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Archiviazione](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Archiviazione](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Le sorgenti di archiviazione con nome servite da questo backend |
| `OPTIONS` | `/api/storage/tus` | none | Caricamenti ripristinabili: le versioni e le estensioni TUS supportate da questo server |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Caricamenti ripristinabili: creazione |
| `GET` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: offset |
| `PATCH` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: aggiunta (append) |
| `DELETE` | `/api/storage/tus/:id` | il proprietario del caricamento | Caricamenti ripristinabili: annullamento |

Un deployment senza archiviazione configurata serve questo prefisso con un `501` indicando la
variabile necessaria, invece di restituire un 404 come se la funzionalità non esistesse —
fatta eccezione per `GET /api/storage/sources`, che risponde `200` con un elenco vuoto.

## Funzioni

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/functions` | session | I nomi delle funzioni servite e quanti file non sono stati caricati |
| qualsiasi | `/api/functions/<name>` | qualsiasi cosa dichiarata dalla funzione. Una chiave API necessita anche di `functions:invoke` | [Funzioni personalizzate](/docs/backend/custom-functions/) |

Una route per file sotto `backend/functions/`, quindi i percorsi provengono dal tuo
progetto. `GET /api/functions` li elenca solo a un chiamante autenticato — una
sessione, una chiave API o la chiave di servizio — e risponde con `401` a chiunque
altro: l'inventario degli endpoint personalizzati di un deployment non è pubblico.

## Meta e operazioni

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/livez` | none | Solo liveness: indica se questo processo è in esecuzione. Non tocca il database, motivo per cui è il percorso di probe che un container dovrebbe usare — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Riporta ogni data source configurato, non solo quello predefinito |
| `GET` | `/api/docs` | none (`schema:read` quando `enableSwagger` è `false`, il valore predefinito del runtime in produzione) | Il documento OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Solo al di fuori della produzione; `REBASE_ENABLE_SWAGGER` non può abilitarlo in produzione. Non servito quando `enableSwagger` è `false`, neppure in fase di sviluppo |
| `GET` | `/api/meta/schema-version` | none | L'hash dello schema a partire dal quale è stato compilato questo backend e la versione del runtime, e nient'altro |
| `GET` | `/api/meta/contract` | `schema:read` | Il contratto completo delle collezioni, per `rebase generate-sdk --from`. `404` quando non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` se impostato | Metriche Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` se impostato | Le serie registrate alla base dei grafici di Studio. `501` su un runtime senza backend |

Le connessioni WebSocket arrivano come un aggiornamento HTTP (upgrade) sullo stesso server anziché su
un proprio percorso separato — vedi [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montata solo quando `REBASE_MCP_ENABLED=true`, che richiede anche
`REBASE_PUBLIC_URL` — vedi
[Configurazione](/docs/getting-started/configuration/#mcp-surface). Disabilitata per
impostazione predefinita: nessun `REBASE_ROLE` la attiva, poiché concede l'accesso al progetto
a software di terze parti e questa è una decisione che spetta a una persona.

I documenti `.well-known` risiedono all'**origine**, non sotto `basePath`: RFC 8414
e RFC 9728 definiscono tali percorsi relativi all'origine, e un client li recupera
prima di possedere qualsiasi token.

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadati RFC 9728 che indicano questa risorsa e il relativo server di autorizzazione. Serviti anche nella forma con suffisso del percorso |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadati RFC 8414: gli endpoint, i grant type e i metodi PKCE supportati da questo deployment |
| `POST` | `/mcp` | Bearer OAuth o una chiave API | L'endpoint del protocollo MCP. Agisce **come l'utente autenticato** (o come chiunque sia rappresentato dalla chiave), quindi ogni lettura e scrittura è soggetta allo stesso RLS. Gli scope `data:*` stabiliscono quali strumenti vengono offerti |
| `GET` | `/mcp` | Bearer OAuth o una chiave API | Risponde `405` con `Allow: POST, DELETE`: questo server non apre stream avviati dal server. Il token viene controllato prima, quindi uno mancante o scaduto riceve invece la richiesta `401` |
| `DELETE` | `/mcp` | none | Risponde `204`. L'endpoint non mantiene alcuna sessione, quindi non c'è nulla da terminare |
| `POST` | `/api/oauth/register` | rate-limited | Registrazione dinamica dei client RFC 7591. Rifiutata quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La schermata di consenso a cui viene reindirizzato un client |
| `POST` | `/api/oauth/authorize/decision` | session | La risposta dell'utente ad essa — approva o rifiuta |
| `POST` | `/api/oauth/token` | credenziali client + PKCE | Scambia un authorization code o esegue il refresh |
| `POST` | `/api/oauth/revoke` | credenziali client | Revoca del token RFC 7009 |
| `GET` | `/api/oauth/grants` | session | I client approvati da questo utente |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Ne revoca uno, consentendo a una persona di annullare un consenso senza un amministratore |

## Correlati

- [REST API](/docs/backend/api/) — tutte le route dei dati nel dettaglio: filtri, ordinamento, paginazione, errori
- [Endpoint di autenticazione](/docs/backend/auth-endpoints/) — formati di richiesta e risposta per la tabella di autenticazione sopra
- [Ambiente e configurazione](/docs/getting-started/configuration/) — le variabili che stabiliscono quali di questi endpoint vengono montati

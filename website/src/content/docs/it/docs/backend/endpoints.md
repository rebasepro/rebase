---
sourceHash: fd9c410ef80129f3
title: Indice degli endpoint
sidebar_label: Indice degli endpoint
description: Ogni route HTTP montata da un backend Rebase — data, auth, storage, admin, meta — con il relativo gate e la pagina che la descrive.
---

Ogni route montata dal server, in un'unica tabella, con i requisiti necessari per raggiungerla.

I percorsi assumono il `basePath` predefinito di `/api`; `REBASE_BASE_PATH` li sposta
tutti insieme. `/health`, `/livez` e `/metrics` si trovano intenzionalmente all'esterno,
poiché un orchestratore esegue probe su `/health` e non dovrebbe dover conoscere il percorso
di base. `/health` è montato *anche* sotto di esso, quindi `/api/health` risponde allo
stesso modo invece di restituire un 404 proprio nel momento in cui qualcuno sta verificando
se il server è attivo.

Un gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — confronta questa
tabella con le route registrate dal sorgente, in modo che una nuova superficie non possa
essere aggiunta senza comparire qui.

## Gate

| Gate | Significato |
|---|---|
| **none** | Non autenticato. Chiunque possa raggiungere l'host può invocarlo |
| **session** | Un chiamante autenticato: un access token o una chiave API con ambito limitato all'operazione |
| **admin** | Una sessione admin, una service key o una chiave API con privilegi admin |
| **RLS** | Autenticato, dopodiché il database decide riga per riga — vedi [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montato solo al di fuori della produzione |

## Dati

Generato per collection, quindi i percorsi contengono i tuoi slug anziché un elenco
fisso. `:slug` è lo `slug` di una collection.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias deprecato di `PATCH` — stessa scrittura parziale, risponde con `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserisce più righe, opzionalmente eseguendo l'upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Aggiorna più righe per id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina più righe per id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Scrive attraverso più collection in un'unica transazione — [Scrittura tramite REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Il conteggio e l'aggregazione sono route a sé stanti, registrate prima di `/:id` affinché
`aggregate` non venga interpretato come l'id di un'entità. `?select=` e `?groupBy=` sono
i relativi parametri, e `select` è obbligatorio su `/aggregate`.

La ricerca testuale, la ricerca vettoriale, l'inclusione di relazioni e la selezione dei campi
*sono* parametri di query su `GET /api/data/:slug` anziché route — `search`,
`vector_search`, `include`, `fields`. Vedi [REST API](/docs/backend/api/).

Un progetto che non dichiara collection e non ne analizza alcuna fornisce questo prefisso
come un singolo `404 NO_COLLECTIONS`. Vedi [Solo backend](/docs/getting-started/headless/).

## Autenticazione

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
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
| `POST` | `/api/auth/reset-password` | none (un token di reset) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/send-verification` | session | [Autenticazione](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token di verifica) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un link token) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codici monouso via email |
| `POST` | `/api/auth/otp/verify` | none (un codice) | Codici monouso via email |
| `POST` | `/api/auth/anonymous` | none | Sessioni guest. Disattivato a meno che non sia impostato `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un guest) | Trasforma un guest in un account |
| `POST` | `/api/auth/find-user` | session | Disattivato a meno che non sia impostato `AUTH_ALLOW_USER_LOOKUP` — costituisce una superficie di enumerazione |
| `POST` | `/api/auth/:provider` | none | Uno per ciascun provider OAuth/OIDC configurato |
| `POST` | `/api/auth/link/:provider` | session | Collega un provider all'account attualmente autenticato |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un accesso in corso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un ID di challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/.well-known/jwks.json` | none | Il JWKS pubblico, quando è configurata la [firma asimmetrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Amministrazione

Tutto ciò che si trova sotto `/api/admin` richiede una sessione admin, una service key
o una chiave API con ambito admin. Senza eccezioni: una chiave limitata a una
collection non può accedere a nulla di tutto questo.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e solo finché non esiste alcun admin | Rifiutato in produzione — vedi [Bootstrap del primo utente](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Gestione utenti |
| `POST` | `/api/admin/users` | admin | Gestione utenti |
| `GET` | `/api/admin/users/:uid` | admin | Gestione utenti |
| `PUT` | `/api/admin/users/:uid` | admin | Gestione utenti |
| `DELETE` | `/api/admin/users/:uid` | admin | Gestione utenti |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Rilascia una password temporanea |
| `GET` | `/api/admin/roles` | admin | I ruoli dichiarati dal progetto |
| `GET` | `/api/admin/api-keys` | admin | [Chiavi API](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | La chiave in testo non crittografato viene restituita una sola volta, al momento della creazione |
| `GET` | `/api/admin/api-keys/:id` | admin | [Chiavi API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [Chiavi API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [Chiavi API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Cron Job](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Cron Job](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Abilita o disabilita un job |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Cron Job](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Esegue un job immediatamente |
| `GET` | `/api/admin/backups` | admin | Inventario dei backup |
| `GET` | `/api/admin/backups/download` | admin | Trasmette in streaming un backup |
| `GET` | `/api/admin/logs` | admin | Il buffer dei log recenti |
| `GET` | `/api/admin/logs/latest` | admin | Le voci più recenti |
| `GET` | `/api/admin/logs/stream` | admin | Server-sent events |
| `GET` | `/api/admin/rls-audit` | admin | L'ultimo risultato dell'audit pianificato |
| `GET` | `/api/admin/schema/status` | admin | [Modifica dello schema in tempo reale](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Pianifica una modifica; non ne applica mai una |
| `POST` | `/api/admin/schema/apply` | admin | Disattivato a meno che non sia impostato `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | admin | Indica se l'editor è disponibile e il motivo quando non lo è |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) — riscrive il sorgente della collection |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | Email catturate dal transport di sviluppo invece di essere inviate |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` sono serviti anche
sui loro percorsi antecedenti alla versione 0.17 senza il segmento `/admin`. Tali alias
esistono per i progetti che non sono ancora stati migrati; scrivi il nuovo codice
puntando al percorso canonico.

## Storage

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Le sorgenti di storage denominate servite da questo backend |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Upload ripristinabili: creazione |
| `GET` | `/api/storage/tus/:id` | il proprietario dell'upload | Upload ripristinabili: offset |
| `PATCH` | `/api/storage/tus/:id` | il proprietario dell'upload | Upload ripristinabili: append |
| `DELETE` | `/api/storage/tus/:id` | il proprietario dell'upload | Upload ripristinabili: cancellazione |

Un deployment senza storage configurato risponde su questo prefisso con un errore `501`
indicando la variabile necessaria, anziché restituire un 404 come se la funzionalità non esistesse.

## Funzioni

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| any | `/api/functions/<name>` | qualunque cosa dichiari la funzione | [Funzioni personalizzate](/docs/backend/custom-functions/) |

Una route per file presente in `backend/functions/`, quindi i percorsi dipendono dal tuo
progetto. `GET /api/functions` **non** li elenca: l'inventario degli endpoint personalizzati
di un deployment non è pubblico.

## Metadati e operazioni

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/livez` | none | Sola liveness: indica se questo processo è in esecuzione. Non tocca il database, motivo per cui è il percorso di probe che un container dovrebbe utilizzare — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Riporta ogni data source configurata, non soltanto quella predefinita |
| `GET` | `/api/docs` | none (admin in produzione) | Il documento OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Solo in sviluppo a meno che non sia impostato `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | L'hash dello schema da cui è stato compilato questo backend, e nient'altro |
| `GET` | `/api/meta/contract` | admin | Il contratto completo delle collection, per `rebase generate-sdk --from`. `404` se non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` se impostato | Metriche di Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` se impostato | Le serie registrate alla base dei grafici di Studio. `501` su un runtime privo di backend |

Le connessioni WebSocket arrivano come un aggiornamento HTTP (upgrade) sullo stesso server
anziché su un percorso dedicato — vedi [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montata solo quando `REBASE_MCP_ENABLED=true`, che richiede anche
`REBASE_PUBLIC_URL` — vedi
[Configurazione](/docs/getting-started/configuration/#mcp-surface). Disattivata per
impostazione predefinita: nessun `REBASE_ROLE` la abilita, poiché concede l'accesso al progetto
a software di terze parti e questa è una decisione che spetta a una persona.

I documenti `.well-known` risiedono all'**origine**, non sotto `basePath`: le RFC 8414
e RFC 9728 definiscono tali percorsi rispetto all'origine e un client li richiede
prima di possedere qualsiasi token.

| Metodo | Percorso | Gate | Dettagli |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadati RFC 9728 che indicano questa risorsa e il relativo server di autorizzazione. Serviti anche nella forma con suffisso del percorso |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadati RFC 8414: gli endpoint, i tipi di grant e i metodi PKCE supportati da questo deployment |
| `POST` | `/mcp` | OAuth bearer | L'endpoint del protocollo MCP. Agisce **come l'utente autenticato**, quindi ogni operazione di lettura e scrittura è soggetta allo stesso RLS |
| `GET` | `/mcp` | OAuth bearer | Risponde `405` con `Allow: POST, DELETE`: questo server non apre stream avviati dal server. Il token viene verificato per primo, quindi uno mancante o non valido riceverà invece una richiesta di autenticazione `401` |
| `DELETE` | `/mcp` | none | Risponde `204`. L'endpoint non mantiene alcuna sessione, quindi non c'è nulla da terminare |
| `POST` | `/api/oauth/register` | rate-limited | Registrazione dinamica dei client RFC 7591. Rifiutata quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La schermata di consenso a cui viene reindirizzato il client |
| `POST` | `/api/oauth/authorize/decision` | session | La risposta della persona — approva o nega |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Scambia un authorization code, oppure effettua il refresh |
| `POST` | `/api/oauth/revoke` | client credentials | Revoca dei token RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quali client sono stati approvati da questo utente |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Ne revoca uno, consentendo a una persona di annullare un consenso senza l'intervento di un amministratore |

## Correlati

- [REST API](/docs/backend/api/) — le route dei dati nel dettaglio: filtri, ordinamento, paginazione, errori
- [Endpoint di autenticazione](/docs/backend/auth-endpoints/) — formati di richiesta e risposta per la tabella di autenticazione sopra indicata
- [Ambiente e configurazione](/docs/getting-started/configuration/) — le variabili che determinano quali di questi endpoint vengono montati

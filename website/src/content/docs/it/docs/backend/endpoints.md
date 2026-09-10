---
sourceHash: e08fbf11c0138bb1
title: Indice degli endpoint
sidebar_label: Indice degli endpoint
description: Tutte le route HTTP montate da un backend Rebase — data, auth, storage, admin, meta — con il relativo gate e la pagina che le illustra.
---

Tutte le route montate dal server, in un'unica tabella, con i requisiti necessari per raggiungerle.

I percorsi presuppongono il `basePath` predefinito di `/api`; `REBASE_BASE_PATH` li
sposta tutti insieme. `/health`, `/livez` e `/metrics` risiedono intenzionalmente al di fuori di esso,
poiché un orchestratore interroga `/health` tramite probe e non dovrebbe dover conoscere il
percorso di base. `/health` è *anche* montato al suo interno, in modo tale che `/api/health` risponda
allo stesso modo invece di restituire un 404 proprio nel momento in cui qualcuno sta verificando se il server
è attivo.

Un gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — confronta questa
tabella con le route registrate dal codice sorgente, impedendo l'aggiunta di una nuova
superficie senza che compaia qui.

## Gate

| Gate | Significato |
|---|---|
| **none** | Non autenticato. Chiunque possa raggiungere l'host può inviare la richiesta |
| **session** | Un chiamante autenticato: un token di accesso o una chiave API con ambito limitato all'operazione |
| **admin** | Una sessione admin, una chiave di servizio o una chiave API con ambito admin |
| **RLS** | Autenticato, dopodiché il database decide riga per riga — consulta le [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montato solo al di fuori dell'ambiente di produzione |

## Dati

Generati per ogni collezione, quindi i percorsi contengono i tuoi slug anziché un elenco
fisso. `:slug` indica lo `slug` di una collezione.

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Interrogazione](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Interrogazione](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias deprecato di `PATCH` — stessa scrittura parziale, restituisce `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserisce più righe, facoltativamente eseguendo l'upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Aggiorna più righe in base all'id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina più righe in base all'id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Esegue scritture su più collezioni in un'unica transazione — [Scrittura tramite REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Cronologia entità](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Cronologia entità](/docs/backend/history/) |

Il conteggio e l'aggregazione dispongono di route proprie, registrate prima di `/:id` in modo
che `aggregate` non venga interpretato come l'id di un'entità. `?select=` e `?groupBy=` sono
i relativi parametri, e `select` è obbligatorio su `/aggregate`.

La ricerca testuale, la ricerca vettoriale, l'inclusione di relazioni e la selezione dei campi *sono* parametri
di query su `GET /api/data/:slug` anziché route separate — `search`,
`vector_search`, `include`, `fields`. Consulta [REST API](/docs/backend/api/).

Un progetto che non dichiara collezioni e non ne analizza alcuna espone questo prefisso
restituendo un unico errore `404 NO_COLLECTIONS`. Consulta [Solo backend](/docs/getting-started/headless/).

## Autenticazione

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `POST` | `/api/auth/register` | none | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un token di refresh) | [Endpoint di autenticazione](/docs/backend/auth-endpoints/) |
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
| `POST` | `/api/auth/magic-link/verify` | none (un token del link) | [Autenticazione](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codici monouso via email |
| `POST` | `/api/auth/otp/verify` | none (un codice) | Codici monouso via email |
| `POST` | `/api/auth/anonymous` | none | Sessioni guest. Disabilitato a meno che non sia attivo `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un guest) | Converte un guest in un account |
| `POST` | `/api/auth/find-user` | session | Disabilitato a meno che non sia attivo `AUTH_ALLOW_USER_LOOKUP` — costituisce una superficie di enumerazione |
| `POST` | `/api/auth/:provider` | none | Uno per ciascun provider OAuth/OIDC configurato |
| `POST` | `/api/auth/link/:provider` | session | Collega un provider all'account attualmente autenticato |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un accesso in corso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un id di challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/.well-known/jwks.json` | none | Il JWKS pubblico, quando è configurata la [firma asimmetrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Amministrazione

Tutto ciò che si trova sotto `/api/admin` richiede una sessione admin, una chiave di servizio o una
chiave API con ambito admin. Non è una questione di permessi generici: una chiave con ambito limitato a una collezione
non può raggiungere nessuno di questi endpoint.

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e solo se non esiste alcun amministratore | Rifiutato in produzione — consulta [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Gestione utenti |
| `POST` | `/api/admin/users` | admin | Gestione utenti |
| `GET` | `/api/admin/users/:uid` | admin | Gestione utenti |
| `PUT` | `/api/admin/users/:uid` | admin | Gestione utenti |
| `DELETE` | `/api/admin/users/:uid` | admin | Gestione utenti |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Genera una password temporanea |
| `GET` | `/api/admin/roles` | admin | I ruoli dichiarati dal progetto |
| `GET` | `/api/admin/api-keys` | admin | [Chiavi API](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | La chiave in chiaro viene restituita solo una volta, alla creazione |
| `GET` | `/api/admin/api-keys/:id` | admin | [Chiavi API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [Chiavi API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [Chiavi API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Processi pianificati (Cron Jobs)](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Processi pianificati (Cron Jobs)](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Abilita o disabilita un processo |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Processi pianificati (Cron Jobs)](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Esegui un processo immediatamente |
| `GET` | `/api/admin/backups` | admin | Inventario dei backup |
| `GET` | `/api/admin/backups/download` | admin | Esegue lo streaming di un backup |
| `GET` | `/api/admin/logs` | admin | Il buffer dei log recenti |
| `GET` | `/api/admin/logs/latest` | admin | Le voci più recenti |
| `GET` | `/api/admin/logs/stream` | admin | Server-sent events |
| `GET` | `/api/admin/rls-audit` | admin | L'esito più recente del controllo audit pianificato |
| `GET` | `/api/admin/schema/status` | admin | [Modifica dello schema in tempo reale](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Pianifica una modifica; non la applica mai direttamente |
| `POST` | `/api/admin/schema/apply` | admin | Disabilitato a meno che non sia attivo `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | admin | Indica se l'editor è disponibile e la ragione in caso contrario |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) — riscrive i sorgenti della collezione |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | Email intercettate dal transport di sviluppo anziché inviate |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` sono disponibili
anche sui rispettivi percorsi precedenti alla versione 0.17 senza il segmento `/admin`. Tali alias sono
pensati per i progetti che non sono ancora stati aggiornati; per il nuovo codice si raccomanda di utilizzare il percorso canonico.

## Archiviazione

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Le origini di archiviazione denominate gestite da questo backend |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Caricamenti riprendibili: creazione |
| `GET` | `/api/storage/tus/:id` | proprietario del caricamento | Caricamenti riprendibili: offset |
| `PATCH` | `/api/storage/tus/:id` | proprietario del caricamento | Caricamenti riprendibili: append |
| `DELETE` | `/api/storage/tus/:id` | proprietario del caricamento | Caricamenti riprendibili: annullamento |

Un deployment senza alcun servizio di archiviazione configurato gestisce questo prefisso restituendo un errore `501`
indicando la variabile richiesta, anziché rispondere con un 404 come se la funzionalità non esistesse.

## Funzioni

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| any | `/api/functions/<name>` | qualsiasi valore dichiarato dalla funzione | [Funzioni personalizzate](/docs/backend/custom-functions/) |

Una route per ciascun file presente in `backend/functions/`, quindi i percorsi provengono dal tuo
progetto. `GET /api/functions` **non** li elenca: l'elenco degli endpoint personalizzati
di un deployment non è pubblico.

## Meta e operazioni

| Metodo | Percorso | Gate | Altro |
|---|---|---|---|
| `GET` | `/livez` | none | Solo liveness: indica se questo processo è in esecuzione. Non accede al database, ed è per questo il percorso di probe che un container dovrebbe utilizzare — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Segnala lo stato di ogni origine dati configurata, non solo di quella predefinita |
| `GET` | `/api/docs` | none (admin in produzione) | Il documento OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Solo in sviluppo a meno che non sia attivo `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | L'hash dello schema da cui è stato compilato questo backend, e nient'altro |
| `GET` | `/api/meta/contract` | admin | Il contratto completo delle collezioni, per `rebase generate-sdk --from`. Restituisce `404` quando non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` se impostato | Metriche Prometheus, se `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` se impostato | La serie temporale registrata alla base dei grafici di Studio. Restituisce `501` su un runtime privo di backend |

Le connessioni WebSocket avvengono tramite un aggiornamento (HTTP upgrade) sullo stesso server anziché
su un percorso dedicato — consulta [Realtime](/docs/backend/realtime/).

## Risorse correlate

- [REST API](/docs/backend/api/) — la documentazione completa sulle route dati: filtri, ordinamento, paginazione, errori
- [Endpoint di autenticazione](/docs/backend/auth-endpoints/) — struttura delle richieste e delle risposte per la tabella di autenticazione mostrata sopra
- [Ambiente e configurazione](/docs/getting-started/configuration/) — le variabili che stabiliscono quali di queste route debbano essere montate

---

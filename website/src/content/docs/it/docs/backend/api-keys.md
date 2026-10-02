---
sourceHash: 1806e56473009c2c
title: Chiavi API
sidebar_label: Chiavi API
description: "Chiavi di lunga durata per script, CI, agenti e integrazioni: chiavi di servizio e chiavi personali, gli scope che possiedono, come si combinano con la sicurezza a livello di riga e le route che le gestiscono."
---

## Chiavi API

<span class="since-badge" data-since="0.24">Da 0.24</span> Una chiave API è una credenziale bearer di lunga durata, `rk_live_…`, per un chiamante che
non è una persona in un browser: uno script, un job di CI, un agente, un client MCP, un altro
servizio. Ciò che una chiave può fare è un elenco di [scope](/docs/backend/roles-and-scopes/),
come `data:read:orders` o `cron:write`.

Ne esistono due tipi:

- Una **chiave di servizio** è l'identità macchina del progetto stesso. Agisce come
  `api-key:<id>`, non come una persona. Chiunque possieda `keys:write` le gestisce, sotto
  `/api/admin/api-keys`.
- Una **chiave personale** agisce come l'account che l'ha creata. Ogni account gestisce
  le proprie, sotto `/api/auth/keys`, quando l'app le attiva.

### Usare una chiave

Inviala come token bearer, come un access token. `$API_URL` è l'indirizzo del tuo
backend: quello che ha stampato `rebase dev`, oppure l'URL del tuo deployment.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

La stessa chiave funziona sull'API REST, sullo storage, sulle funzioni personalizzate, sulle
superfici di amministrazione raggiunte dai suoi scope, sul WebSocket realtime e sull'[endpoint `/mcp`](/docs/ai/mcp/#the-remote-endpoint).

## Chiavi di servizio

### Crearne una

<span class="since-badge" data-since="0.24">Da 0.24</span> Una chiave di servizio richiede un nome e almeno uno scope.

```bash
# CLI: talks to the backend with the service key from .env
rebase api-keys create --name "Order sync" --scopes data:read:orders,data:write:orders

# REST: needs keys:write
curl -X POST "$API_URL/api/admin/api-keys" \
  -H "Authorization: Bearer $REBASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Order sync",
    "scopes": ["data:read:orders", "data:write:orders"]
  }'
```

Oppure con l'SDK client:

```ts
const { key } = await client.apiKeys.createKey({
    name: "Order sync",
    scopes: ["data:read:orders", "data:write:orders"],
    expires_at: "2027-01-01T00:00:00.000Z"
});
console.log(key.key); // the only time the plaintext is returned
```

La risposta include la chiave completa in chiaro (`rk_live_...`) **esattamente una volta**.
Salvala subito.

| Campo | Tipo | Descrizione |
|---|---|---|
| `name` | `string` | Un'etichetta per le persone |
| `scopes` | `string[]` | Ciò che la chiave può fare. Almeno uno |
| `roles` | `string[]` | Ruoli RLS con cui viene eseguita la chiave, oltre a `service`. Facoltativo |
| `rate_limit` | `number \| null` | Richieste per intervallo di 15 minuti. `null` o assente usa il valore predefinito del server per le chiavi API, 1000 |
| `expires_at` | `string \| null` | Scadenza ISO-8601. Se assente, la chiave non scade mai |

### Scope e RLS: due controlli indipendenti

Una richiesta fatta con una chiave passa due controlli, ed entrambi devono consentirla:

1. **Gli scope della chiave**, verificati dalla route: `data:write:orders` permette alla chiave
   di scrivere `orders` e nient'altro.
2. **La sicurezza a livello di riga**, verificata dal database. Una chiave non la aggira mai. Una
   chiave di servizio viene eseguita come `uid: "api-key:<id>"` con il ruolo `service`, più gli eventuali
   `roles` che le sono stati dati. Le regole basate sul proprietario (`owner_id = rebase.uid()`) non
   le corrispondono mai.

Quindi una chiave con `data:read` può comunque ottenere risultati vuoti. È la RLS che funziona,
non un bug. Concedi il ruolo `service` nelle regole di sicurezza della collezione, oppure dai
alla chiave il ruolo `admin`.

#### Una chiave di servizio legge zero righe finché una regola non concede `service`

Questo è il passaggio che fa sembrare guasta una chiave con gli scope corretti. Il criterio RLS
che Rebase aggiunge per impostazione predefinita a ogni collezione compila in:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

Cioè il contesto del server, oppure un admin. Una chiave di servizio senza il ruolo `admin`
non corrisponde a nessuno dei due casi. Su una collezione senza `securityRules` la richiesta ha successo
con un risultato vuoto e nessun errore che spieghi perché. Concedi il ruolo esplicitamente:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Poiché `rebase.uid()` contiene l'id della chiave, una regola può anche limitare le righe a una sola
chiave:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Il ruolo `admin`

`roles: ["admin"]` (`--roles admin` nella CLI) fa sì che la chiave venga eseguita anche con il ruolo RLS
`admin`, quindi supera i criteri admin predefiniti e legge ogni riga di ogni collezione
che li mantiene. Questo riguarda le righe. Non concede alcuno scope: la chiave raggiunge
comunque solo ciò che elencano i suoi `scopes`.

Chi crea una chiave può darle solo ruoli che possiede a sua volta, a meno che non sia un
admin.

### Accesso completo, per CI e migrazioni

<span class="since-badge" data-since="0.24">Da 0.24</span> `--full-access` dà alla chiave ogni scope che il suo creatore possiede, tranne `keys:read` e
`keys:write`, che nessuna chiave può avere. Tramite la CLI, che usa la chiave di servizio,
sono tutti gli scope del piano dati e del piano di amministrazione. Aggiungi `--roles admin` e la chiave
legge anche ogni riga:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

È la configurazione giusta per CI, migrazioni e strumenti proprietari affidabili. Non
è la configurazione giusta per un agente.

## Chiavi personali

<span class="since-badge" data-since="0.24">Da 0.24</span> Una chiave personale agisce **come il suo proprietario**: con il suo uid, e con i suoi ruoli così come sono a
ogni richiesta. Le regole basate sul proprietario le corrispondono, quindi legge esattamente ciò che leggerebbe
il suo proprietario, ristretto dai suoi scope. È adatta agli script di una persona, a una CLI sul suo
portatile, o a uno strumento che collega al proprio account.

Sono disattivate per impostazione predefinita, perché ognuna è una credenziale di lunga durata per un
account. Attivale nel blocco auth della collezione users:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: { enabled: true, personalKeys: true },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Poi un account autenticato gestisce le proprie chiavi:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

Lo stesso via REST. `$ACCESS_TOKEN` è l'access token dell'account stesso, ottenuto
con l'accesso:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Una chiave personale accetta `name`, `scopes` e `expires_at`. Non ha `roles`,
perché viene eseguita con quelli del suo proprietario, né `rate_limit`. Inviare uno dei due dà
`400 INVALID_INPUT`.

Ciò che una chiave personale possiede sono i suoi scope, ridotti a ciò che il suo proprietario possiede **ora**.
Togli un ruolo al proprietario e ogni chiave che ha creato si restringe con esso. Elimina
l'account e le sue chiavi smettono di funzionare. Disattiva `personalKeys` e smette di funzionare
anche ogni chiave personale.

Solo un account può avere chiavi personali. Una chiave API, la chiave di servizio e una sessione
ospite vengono rifiutate: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` per una chiave,
`403 PERSONAL_KEY_NEEDS_ACCOUNT` per le altre due. Con la funzionalità disattivata, ogni
route risponde `403 PERSONAL_KEYS_DISABLED`.

## Cosa raggiunge ogni scope

### Dati

`data:read`, `data:write` e `data:delete`, semplici o ristretti a una collezione
(`data:read:posts`). L'operazione deriva dal metodo HTTP: `GET`, `HEAD`
e `OPTIONS` leggono, `POST`, `PUT` e `PATCH` scrivono, `DELETE` elimina.
`POST /api/data/:slug/bulk/delete` conta come eliminazione, anche se è un `POST`.

Su un percorso annidato, l'operazione viene verificata sulla collezione in cui termina il percorso,
e ogni collezione che il percorso attraversa richiede `data:read`. Una chiave che possiede solo
`data:read:posts` viene rifiutata su `/api/data/authors/1/posts` finché non può anche
leggere `authors`.

### Storage

`storage:read` elenca e scarica. `storage:write` carica e crea cartelle,
e copre ogni passaggio di un caricamento ripristinabile (TUS), inclusi il controllo dell'offset
e l'annullamento. `storage:delete` elimina. Il target è l'id di una sorgente di storage. L'id
della sorgente predefinita è `(default)`, quindi `storage:read:(default)` legge solo la sorgente
predefinita, e `storage:write:avatars` scrive su una sorgente chiamata `avatars`.
Dopo il controllo dello scope, [`storageAuthorize`](/docs/backend/storage/#per-object-authorization)
viene comunque eseguito, con l'identità della chiave.

### Funzioni

`functions:invoke` chiama ogni funzione personalizzata. `functions:invoke:<name>` ne chiama
una sola. Elencare le funzioni su `GET /api/functions` richiede lo scope semplice.

Non dare `functions:invoke` a una chiave che vuoi di sola lettura. Una funzione è
codice, e può scrivere. Dentro una funzione, `getScopes(c)` e `hasScope(c, …)`
leggono ciò che la chiave possiede, e un'app può dichiarare scope propri che una funzione
può verificare. Vedi [Funzioni personalizzate](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Superfici di amministrazione

Uno scope del piano di amministrazione su una chiave raggiunge quella superficie. Uno scheduler che avvia
i cron job ha bisogno di `cron:write`. Un log shipper ha bisogno di `logs:read`. Un job di backup ha bisogno di
`backups:read`. L'[indice degli endpoint](/docs/backend/endpoints/#admin) elenca lo
scope richiesto da ogni route.

`keys:read` e `keys:write` non possono mai andare su una chiave. Una chiave in grado di gestire le chiavi
potrebbe creare il proprio successore, o ampliare sé stessa. Ogni richiesta alle route delle chiavi
fatta con una chiave viene rifiutata con `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Gestisci
le chiavi come persona che possiede `keys:write`, oppure con la chiave di servizio.

### Realtime

Una chiave autentica anche il WebSocket: inviala nel messaggio `AUTHENTICATE`.
Le letture e le sottoscrizioni richiedono `data:read` sulla loro collezione, i salvataggi
`data:write`, le eliminazioni `data:delete`. Una sottoscrizione a un percorso annidato richiede lo
scope semplice. I canali (broadcast e presence) sono rifiutati per le chiavi. I messaggi dell'editor
SQL e dei branch richiedono `database:read` o `database:write`.

## Agenti e server MCP

<span class="since-badge" data-since="0.24">Da 0.24</span> Un agente ha bisogno della chiave *più ristretta* che svolga il suo lavoro. Parti da scope limitati, e dalle
una scadenza:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Escludi `data:delete` quando l'agente può modificare ma non deve rimuovere.
`delete` è separato da `write` proprio per questo motivo.

## Regole di creazione

Ogni chiave viene verificata rispetto a chi la crea, allo stesso modo su entrambe le route:

| Rifiuto | Quando |
|---|---|
| `400 INVALID_SCOPES` | Uno scope è malformato, sconosciuto, o porta un target che non accetta. `details.validScopes` elenca tutti quelli validi |
| `400 UNKNOWN_SCOPE_TARGET` | Un target nomina una collezione, una sorgente di storage o una funzione che questo backend non serve |
| `400 KEY_MANAGEMENT_SCOPE` | Sono stati richiesti `keys:read` o `keys:write` |
| `403 SCOPE_EXCEEDS_CREATOR` | Uno scope che il creatore non possiede. Una chiave non possiede mai più dell'account che l'ha creata |
| `403 ROLE_EXCEEDS_CREATOR` | Un ruolo di una chiave di servizio che il creatore non possiede, quando il creatore non è un admin |

Una richiesta per cui alla chiave stessa manca uno scope risponde `403 SCOPE_MISSING`, con lo
scope in `details.requiredScope`. Vedi [Codici di errore](/docs/backend/errors/#authentication-and-accounts).

## Gestire le chiavi

| Metodo | Percorso | Requisito |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Modifica `name`, `scopes`, `roles`, `rate_limit` o `expires_at`, con le stesse regole della creazione |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Revoca la chiave |
| `GET` | `/api/auth/keys` | Un account: le proprie chiavi personali |
| `POST` | `/api/auth/keys` | Un account, con `personalKeys` attivo |
| `DELETE` | `/api/auth/keys/:id` | Un account: revoca una delle proprie |

Ogni route restituisce le chiavi mascherate: `key_prefix`, mai l'hash. Ogni chiave riporta
il suo `kind` (`service` o `personal`), i suoi `scopes`, i suoi `roles` e, per una
chiave personale, il suo `owner_uid`.

La CLI copre le chiavi di servizio: `rebase api-keys list`, `get`, `create`, `revoke`
e `scopes`, che elenca ogni scope noto al backend. Vedi il
[riferimento della CLI](/docs/cli/#rebase-api-keys).

## Chiavi create prima degli scope

Le chiavi create prima che esistessero gli scope hanno un elenco `permissions` e un flag
`admin`. All'avvio, lo store assegna a ciascuna gli scope che ora possiede. Niente si amplia;
dove una vecchia concessione non ha una corrispondenza esatta, si restringe:

| Vecchia concessione | Scope attuali |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` e `storage:<op>` per ogni operazione, più `functions:invoke` se aveva `write` |
| `"storage"` | `storage:<op>` per ogni operazione |
| `"functions"` | `functions:invoke`, solo se aveva `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, solo se aveva `write` |
| `admin: true` | il ruolo `admin`, più `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

Il segreto non cambia, quindi un'integrazione continua a funzionare. Due concessioni si restringono:

- Una concessione su una funzione senza `write` non si traduce in nulla. Un `GET` contava come
  lettura, ma una funzione è codice, e chiamarne una non è una lettura.
- Una chiave admin non riceve alcun `database:*`, che prima non poteva comunque raggiungere, né
  `keys:*`, che nessuna chiave può avere.

Le vecchie colonne `permissions` e `admin` restano al loro posto, così un rollback a un
runtime precedente legge ancora le sue chiavi. Una richiesta che invia `permissions` o
`admin` al posto di `scopes` viene rifiutata con `400 INVALID_INPUT`.

## Passaggi successivi

- [Ruoli e scope](/docs/backend/roles-and-scopes/): ogni scope, e come i ruoli li possiedono
- [Indice degli endpoint](/docs/backend/endpoints/): lo scope richiesto da ogni route
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/): ciò che il database applica oltre agli scope di una chiave

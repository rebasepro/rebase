---
sourceHash: 8f9385dd3838df4f
title: Chiavi API
sidebar_label: Chiavi API
description: "Chiavi a lunga durata per script, CI, agenti e integrazioni: chiavi di servizio e chiavi personali, gli scope associati, come si integrano con la row-level security e le route che le gestiscono."
---

## Chiavi API

Una chiave API è una credenziale bearer a lunga durata, `rk_live_…`, destinata a un
chiamante che non è una persona in un browser: uno script, un job di CI, un agente,
un client MCP, un altro servizio. Le operazioni consentite a una chiave sono definite
da un elenco di [scope](/docs/backend/roles-and-scopes/), come `data:read:orders` o `cron:write`.

Ne esistono di due tipi:

- Una **chiave di servizio** (service key) rappresenta l'identità macchina del progetto. Agisce come
  `api-key:<id>`, non come una persona. Chiunque disponga di `keys:write` può gestirle, all'indirizzo
  `/api/admin/api-keys`.
- Una **chiave personale** (personal key) agisce come l'account che l'ha creata. Ogni account gestisce le
  proprie, all'indirizzo `/api/auth/keys`, quando l'applicazione le abilita.

### Utilizzo di una chiave

Inviala come bearer token, proprio come un access token. `$API_URL` è l'indirizzo
del tuo backend: ciò che ha stampato `rebase dev`, oppure l'URL del tuo deployment.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

La stessa chiave funziona sulle API REST, sullo storage, sulle custom function,
sulle interfacce di amministrazione coperte dai suoi scope, sul WebSocket realtime e sull'[`endpoint /mcp`](/docs/ai/remote-mcp/).

## Chiavi di servizio

### Creazione di una chiave

Una chiave di servizio richiede un nome e almeno uno scope.

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

La risposta include la chiave completa in chiaro (`rk_live_...`) **una sola volta**.
Salvala immediatamente.

| Campo | Tipo | Descrizione |
|---|---|---|
| `name` | `string` | Un'etichetta per le persone |
| `scopes` | `string[]` | Le operazioni consentite alla chiave. Almeno una |
| `roles` | `string[]` | Ruoli RLS con cui viene eseguita la chiave, oltre a `service`. Opzionale |
| `rate_limit` | `number \| null` | Richieste per intervallo di 15 minuti. Se `null` o assente, utilizza il valore predefinito del server per le chiavi API (1000). Consulta [Rate limit](#rate-limit) |
| `expires_at` | `string \| null` | Scadenza in formato ISO-8601. Se assente, non scade mai |

### Scope e RLS: due verifiche indipendenti

Una richiesta effettuata con una chiave supera due controlli, ed entrambi devono consentirla:

1. **Gli scope della chiave**, verificati dalla route: `data:write:orders` consente alla chiave di
   scrivere in `orders` e nient'altro.
2. **La Row-Level Security**, verificata dal database. Una chiave non la aggira mai. Una
   chiave di servizio viene eseguita come `uid: "api-key:<id>"` con il ruolo `service`, oltre a qualsiasi
   altro ruolo in `roles` assegnato. Le regole basate sul proprietario (`owner_id = rebase.uid()`) non
   corrispondono mai.

Pertanto, una chiave con `data:read` può comunque ottenere risultati vuoti. Non si tratta
di un bug, ma del normale funzionamento della RLS. Concedi il ruolo `service` nelle regole `rls`
della tabella, oppure assegna alla chiave il ruolo `admin`.

#### Una chiave di servizio legge zero righe finché una regola non concede il ruolo `service`

Questo è il passaggio che fa sembrare non funzionante una chiave con gli scope corretti. La policy RLS
che Rebase aggiunge a ogni tabella per impostazione predefinita viene compilata in:

```sql
(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))
```

Questo è il contesto del server, o un admin. Una chiave di servizio senza il ruolo `admin`
non soddisfa nessuna delle due condizioni. Su una tabella il cui `rls` è `"admin-only"`, la richiesta
ha successo restituendo un risultato vuoto e nessun errore che ne spieghi il motivo. Concedi il ruolo
in modo esplicito nella configurazione `rls` della tabella:

```ts
rls: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Poiché `rebase.uid()` include l'ID della chiave, una regola può anche limitare le righe
a una chiave specifica:

```ts
rls: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Il ruolo `admin`

`roles: ["admin"]` (`--roles admin` nella CLI) fa sì che la chiave venga eseguita anche con il ruolo
RLS `admin`, soddisfacendo quindi le policy di amministrazione predefinite di ogni tabella che le
prevede. Tali policy coprono `SELECT`, `INSERT`, `UPDATE` e `DELETE`, per cui la row-level security
non limita letture, scritture o eliminazioni della chiave: quest'ultima può leggere, modificare ed eliminare
qualsiasi riga raggiungibile dai suoi scope. Il ruolo supera inoltre i controlli di amministrazione al di fuori
del database: `requireAdmin` nelle [custom function](/docs/backend/custom-functions/) e le scritture
nello storage riservate agli amministratori. Non concede alcuno scope aggiuntivo: la chiave accede comunque
solo a quanto specificato nel suo elenco di `scopes`.

Chi crea una chiave può assegnarle solo i ruoli che possiede personalmente, a meno che non sia un
amministratore.

### Accesso completo, per CI e migrazioni

`--full-access` assegna alla chiave tutti gli scope posseduti dal suo creatore, ad eccezione di `keys:read` e
`keys:write`, che nessuna chiave può possedere. Tramite la CLI, che utilizza la chiave di servizio,
ciò corrisponde a ogni scope del data plane e dell'admin plane. Aggiungendo `--roles admin`, la
row-level security non limita più le righe lette, modificate o eliminate:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

Questa è la configurazione corretta per CI, migrazioni e strumenti proprietari attendibili. Non è
la configurazione adatta per un agente.

### Rate limit

Il `rate_limit` di una chiave indica quante richieste può effettuare in una finestra temporale
di 15 minuti, e ogni punto di ingresso viene conteggiato in un unico bucket, `api-key:<id>`:

- le sue richieste HTTP alle API di data, storage e functions;
- i suoi frame di dati sul socket realtime: recuperi (fetch), conteggi, salvataggi ed eliminazioni,
  nonché sottoscrizioni e richieste di cronologia dei canali oltre la
  [soglia consentita](/docs/backend/realtime/#what-a-write-costs-and-the-limits) per ciascun socket;
- le sue richieste a [`/mcp`](/docs/ai/remote-mcp/).

Senza un `rate_limit`, il bucket adotta il valore predefinito del server per le chiavi API, ovvero 1000. Una
chiave personale non ha un proprio `rate_limit` e viene conteggiata nel rispettivo bucket con tale
valore predefinito. Oltre tale limite, una richiesta HTTP risponde con `429` e un frame del socket con
`RATE_LIMITED`.

Le route di amministrazione in `/api/admin` e i messaggi amministrativi del socket, come quelli dell'editor
SQL, non sono soggetti a rate limit.

Un amministratore che simula una chiave ("Simulate access", `x-rebase-simulate-api-key-id`)
consuma la propria quota, non quella della chiave: l'integrazione in esecuzione con tale chiave
conserva l'intero budget. La simulazione o l'impersonificazione di un utente viene addebitata
all'amministratore allo stesso modo.

## Chiavi personali

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Una chiave personale agisce **come il suo proprietario**: il suo uid e i suoi ruoli per come sono al
momento di ciascuna richiesta. Le regole basate sul proprietario corrispondono, quindi legge esattamente
ciò che leggerebbe il suo proprietario, ristretto dai suoi scope. È adatta per gli script personali,
per una CLI sul proprio computer portatile o per uno strumento collegato al proprio account.

Sono disabilitate per impostazione predefinita, poiché ognuna rappresenta una credenziale a lunga durata
per un account. Abilitale nel blocco `auth` della [tabella users](/docs/schema/auth-table/):

```typescript
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique()
    },
    rls: "admin-only",
    auth: { personalKeys: true }
});
```

A questo punto, un account che ha effettuato l'accesso può gestire le proprie chiavi:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

La stessa operazione tramite REST. `$ACCESS_TOKEN` è l'access token dell'account, ottenuto al
momento dell'accesso:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Una chiave personale accetta `name`, `scopes` e `expires_at`. Non include `roles`,
perché viene eseguita con i ruoli del proprietario, né `rate_limit`. L'invio di uno di questi
parametri restituisce `400 INVALID_INPUT`.

I permessi di una chiave personale sono limitati ai suoi scope, ristretti a ciò che il suo proprietario possiede **in quel momento**.
Rimuovendo un ruolo al proprietario, tutte le chiavi create da quest'ultimo vedranno ridotti i propri privilegi di conseguenza.
Eliminando l'account, le sue chiavi smettono di funzionare. Disattivando `personalKeys`, anche tutte le chiavi personali
smettono di funzionare.

Solo un account può avere chiavi personali. Una chiave API, la chiave di servizio e una
sessione guest vengono rifiutate: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` per una chiave,
`403 PERSONAL_KEY_NEEDS_ACCOUNT` per le altre due. Con la funzionalità disattivata, ogni
route risponde con `403 PERSONAL_KEYS_DISABLED`.

## Ambito di applicazione di ciascuno scope

### Dati (Data)

`data:read`, `data:write` e `data:delete`, generici o limitati a una singola tabella
(`data:read:posts`). L'operazione è determinata dal metodo HTTP: `GET`, `HEAD`
e `OPTIONS` leggono, `POST`, `PUT` e `PATCH` scrivono, `DELETE` elimina.
`POST /api/data/:slug/bulk/delete` è considerata un'eliminazione, sebbene sia una `POST`.

Su un percorso annidato, l'operazione viene verificata sulla tabella finale del percorso,
e ogni tabella intermedia attraversata richiede `data:read`. A una chiave che possiede solo
`data:read:posts` viene negato l'accesso a `/api/data/authors/1/posts` finché non può
leggere anche `authors`.

### Storage

`storage:read` elenca e scarica file. `storage:write` carica file e crea cartelle,
e copre ogni fase di un caricamento ripristinabile (TUS), compresi il controllo dell'offset
e l'annullamento. `storage:delete` elimina. Il target è l'ID di una sorgente di storage. L'ID
della sorgente predefinita è `(default)`, quindi `storage:read:(default)` legge solo la sorgente
predefinita, mentre `storage:write:avatars` scrive su una sorgente denominata `avatars`.
Dopo la verifica dello scope, viene comunque eseguito [`storageAuthorize`](/docs/backend/storage-authorization/),
con l'identità della chiave.

### Funzioni (Functions)

`functions:invoke` richiama tutte le custom function. `functions:invoke:<name>` ne richiama
una specifica. L'elenco delle funzioni tramite `GET /api/functions` richiede lo scope generico.

Non assegnare `functions:invoke` a una chiave che intendi mantenere di sola lettura. Una funzione
è codice ed è in grado di scrivere. All'interno di una funzione, `getScopes(c)` e `hasScope(c, …)`
leggono gli scope associati alla chiave, e un'applicazione può dichiarare i propri scope personalizzati
affinché vengano verificati da una funzione. Consulta [Custom Functions](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Interfacce di amministrazione

Uno scope del piano di amministrazione (admin plane) assegnato a una chiave consente di raggiungere tale interfaccia. Uno scheduler che attiva
cron job necessita di `cron:write`. Un log shipper richiede `logs:read`. Un processo di backup richiede
`backups:read`. L'[indice degli endpoint](/docs/backend/endpoints/#admin) elenca lo
scope richiesto da ciascuna route.

`keys:read` e `keys:write` non possono mai essere assegnati a una chiave. Una chiave in grado di gestire chiavi
potrebbe generare il proprio successore o estendere i propri permessi. Qualsiasi richiesta alle route di gestione
delle chiavi effettuata con una chiave viene rifiutata con `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Gestisci
le chiavi come persona in possesso di `keys:write`, oppure tramite la chiave di servizio.

### Realtime

Una chiave autentica anche il WebSocket: inviala nel messaggio `AUTHENTICATE`.
Fetch e sottoscrizioni richiedono `data:read` sulla relativa tabella, i salvataggi
`data:write`, le eliminazioni `data:delete`. Una sottoscrizione a un percorso annidato richiede lo
scope generico. I canali (broadcast e presence) sono preclusi alle chiavi. I messaggi
dell'editor SQL e dei branch richiedono `database:read` o `database:write`.

## Agenti e server MCP

Un agente richiede la chiave con i permessi più *ristretti* possibili per svolgere il proprio compito. Inizia
limitando gli scope e impostando una scadenza:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Ometti `data:delete` quando l'agente può modificare ma non deve rimuovere dati.
`delete` è separato da `write` proprio per questo motivo.

## Regole di creazione

Ogni chiave viene verificata rispetto a chi la crea, nello stesso modo su entrambe le route:

| Rifiuto | Condizione |
|---|---|
| `400 INVALID_SCOPES` | Uno scope è malformato, sconosciuto o contiene un target non supportato. `details.validScopes` elenca gli scope che una chiave può possedere. Omette `keys:*`, che nessuna chiave può avere |
| `400 UNKNOWN_SCOPE_TARGET` | Un target specifica una tabella, una sorgente di storage o una funzione non gestita da questo backend |
| `400 KEY_MANAGEMENT_SCOPE` | È stato richiesto `keys:read` o `keys:write` |
| `403 SCOPE_EXCEEDS_CREATOR` | Uno scope che il creatore non possiede. Una chiave non può mai possedere più permessi dell'account che l'ha creata |
| `403 ROLE_EXCEEDS_CREATOR` | Un ruolo di service key che il creatore non possiede, se il creatore non è un amministratore |
| `400 INVALID_ROLE` | Il nome di un ruolo è vuoto o contiene `,` `{` `}` `"` `\` o un carattere di controllo, che la RLS interpreterebbe come ruoli distinti |
| `403 KEY_OUTRANKS_CALLER` | In caso di modifica (`PUT`) o revoca (`DELETE`): la chiave possiede già un ruolo o uno scope che il chiamante non ha, e il chiamante non è un amministratore |

Una richiesta per la quale la chiave stessa non dispone dello scope necessario risponde con `403 SCOPE_MISSING`,
riportando lo scope in `details.requiredScope`. Consulta [Codici di errore](/docs/backend/errors/#authentication-and-accounts).

## Gestione delle chiavi

| Metodo | Percorso | Requisiti |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Modifica `name`, `scopes`, `roles`, `rate_limit` o `expires_at`, seguendo le stesse regole previste per la creazione |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Revoca |
| `GET` | `/api/auth/keys` | Un account: le proprie chiavi personali |
| `POST` | `/api/auth/keys` | Un account, con `personalKeys` abilitato |
| `DELETE` | `/api/auth/keys/:id` | Un account: revoca una delle proprie chiavi |

Tutte le route restituiscono le chiavi mascherate: `key_prefix`, mai l'hash. Ciascuna chiave riporta
il proprio `kind` (`service` o `personal`), i propri `scopes`, i propri `roles` e, per una
chiave personale, il relativo `owner_uid`.

La CLI supporta le chiavi di servizio: `rebase api-keys list`, `get`, `create`, `revoke`
e `scopes`, che elenca ogni scope riconosciuto dal backend. Consulta il
[riferimento della CLI](/docs/cli/#rebase-api-keys). Si autentica tramite
`REBASE_SERVICE_KEY` dal file `.env` e la invia solo al server che `rebase dev`
sta eseguendo per questo progetto; pertanto, se il server è arrestato, non invia nulla. Per
un server avviato in altro modo, ad esempio con `rebase start` o all'interno di un container, imposta
`REBASE_BASE_URL` sul suo indirizzo
([l'ambiente della CLI](/docs/getting-started/configuration/#the-clis-own-environment)).

## Chiavi create prima dell'introduzione degli scope

Le chiavi create prima dell'introduzione degli scope includono un elenco di `permissions` e un
flag `admin`. All'avvio, il database assegna a ciascuna gli scope attualmente previsti. Nessun permesso viene esteso;
laddove una vecchia concessione non abbia una corrispondenza esatta, essa viene ristretta:

| Vecchia concessione | Scope attuali |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` e `storage:<op>` per ciascuna operazione, oltre a `functions:invoke` se includeva `write` |
| `"storage"` | `storage:<op>` per ciascuna operazione |
| `"functions"` | `functions:invoke`, solo se includeva `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, solo se includeva `write` |
| `admin: true` | il ruolo `admin`, oltre a `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

Il segreto non cambia, consentendo all'integrazione di continuare a funzionare. Due concessioni vengono ristrette:

- Una concessione per le funzioni senza `write` viene azzerata. Una chiamata `GET` veniva precedentemente
  considerata una lettura, ma una funzione è codice e la sua invocazione non equivale a una semplice lettura.
- Una chiave admin non riceve alcun permesso `database:*`, a cui non poteva accedere neanche prima, e nessun
  `keys:*`, che nessuna chiave può possedere.

Le vecchie colonne `permissions` e `admin` sono mantenute, in modo che un eventuale rollback a un
runtime precedente possa comunque leggere le relative chiavi. Una richiesta che invia `permissions` o
`admin` al posto di `scopes` viene rifiutata con `400 INVALID_INPUT`.

## Passaggi successivi

- [Ruoli e scope](/docs/backend/roles-and-scopes/): tutti gli scope e come i ruoli li contengono
- [Indice degli endpoint](/docs/backend/endpoints/): lo scope richiesto da ciascuna route
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/): cosa applica il database oltre agli scope di una chiave

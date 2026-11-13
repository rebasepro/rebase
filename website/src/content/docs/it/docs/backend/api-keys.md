---
sourceHash: 92edb85e26e286c4
title: Chiavi API
sidebar_label: Chiavi API
description: "Chiavi a lunga durata per script, CI, agenti e integrazioni: chiavi di servizio e chiavi personali, gli scope che detengono, come si compongono con la row-level security e le route che le gestiscono."
---

## Chiavi API

Una chiave API è una credenziale bearer a lunga durata, `rk_live_…`, destinata a un chiamante che non è una persona in un browser: uno script, un job di CI, un agente, un client MCP, un altro servizio. Le operazioni consentite a una chiave sono definite da un elenco di [scope](/docs/backend/roles-and-scopes/), come `data:read:orders` o `cron:write`.

Ne esistono di due tipi:

- Una **chiave di servizio** (service key) rappresenta l'identità macchina del progetto stesso. Agisce come `api-key:<id>`, non come una persona. Chiunque possieda `keys:write` le gestisce, sotto `/api/admin/api-keys`.
- Una **chiave personale** (personal key) agisce per conto dell'account che l'ha creata. Ciascun account gestisce le proprie, sotto `/api/auth/keys`, quando l'applicazione le abilita.

### Utilizzare una chiave

Inviala come bearer token, proprio come un access token. `$API_URL` è l'indirizzo del tuo backend: quello stampato da `rebase dev` o l'URL del tuo deployment.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

La stessa chiave funziona sull'API REST, sullo storage, sulle custom function, sulle superfici di amministrazione accessibili dai suoi scope, sul WebSocket realtime e sull'[`endpoint /mcp`](/docs/ai/remote-mcp/).

## Chiavi di servizio

### Crearne una

Una chiave di servizio richiede un nome e almeno uno scope.

```bash
# CLI: comunica con il backend usando la chiave di servizio da .env
rebase api-keys create --name "Order sync" --scopes data:read:orders,data:write:orders

# REST: richiede keys:write
curl -X POST "$API_URL/api/admin/api-keys" \
  -H "Authorization: Bearer $REBASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Order sync",
    "scopes": ["data:read:orders", "data:write:orders"]
  }'
```

Oppure tramite il client SDK:

```ts
const { key } = await client.apiKeys.createKey({
    name: "Order sync",
    scopes: ["data:read:orders", "data:write:orders"],
    expires_at: "2027-01-01T00:00:00.000Z"
});
console.log(key.key); // l'unica volta in cui la chiave viene restituita in chiaro
```

La risposta include la chiave completa in chiaro (`rk_live_...`) **esattamente una volta**. Salvala immediatamente.

| Campo | Tipo | Descrizione |
|---|---|---|
| `name` | `string` | Un'etichetta leggibile per le persone |
| `scopes` | `string[]` | Ciò che la chiave può fare. Almeno uno |
| `roles` | `string[]` | Ruoli RLS con cui la chiave viene eseguita, oltre a `service`. Opzionale |
| `rate_limit` | `number \| null` | Richieste per intervallo di 15 minuti. `null` o assente utilizza il valore predefinito del server per le chiavi API, ovvero 1000. Consulta [Rate limit](#rate-limit) |
| `expires_at` | `string \| null` | Scadenza in formato ISO-8601. Se assente, non scade mai |

### Scope e RLS: due controlli indipendenti

Una richiesta effettuata con una chiave supera due controlli, ed entrambi devono autorizzarla:

1. **Gli scope della chiave**, verificati dalla route: `data:write:orders` consente alla chiave di scrivere solo su `orders` e su nient'altro.
2. **La row-level security**, verificata dal database. Una chiave non la aggira mai. Una chiave di servizio viene eseguita con `uid: "api-key:<id>"` con il ruolo `service`, più eventuali `roles` che le sono stati assegnati. Le regole basate sul proprietario (`owner_id = rebase.uid()`) non corrispondono mai ad essa.

Pertanto, una chiave con lo scope `data:read` può comunque ricevere risultati vuoti. Questo è il normale funzionamento della RLS, non un bug. Concedi il ruolo `service` nelle regole di sicurezza della collection oppure assegna alla chiave il ruolo `admin`.

#### Una chiave di servizio legge zero righe finché una regola non concede `service`

Questo è il passaggio che fa sembrare non funzionante una chiave configurata correttamente. La policy RLS che Rebase aggiunge a ogni tabella per impostazione predefinita viene compilata come:

```sql
(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))
```

Si tratta del contesto del server o di un admin. Una chiave di servizio senza il ruolo `admin` non soddisfa nessuna delle due condizioni. Su una tabella la cui `rls` è `"admin-only"`, la richiesta ha successo restituendo un risultato vuoto e nessun errore che ne spieghi il motivo. Concedi esplicitamente il ruolo nella proprietà `rls` della tabella:

```ts
rls: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Poiché `rebase.uid()` contiene l'id della chiave, una regola può anche limitare le righe a una chiave specifica:

```ts
rls: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Il ruolo `admin`

`roles: ["admin"]` (`--roles admin` nella CLI) fa sì che la chiave venga eseguita anche con il ruolo RLS `admin`, superando così le policy di amministrazione predefinite di ogni collection che le mantiene. Tali policy coprono `SELECT`, `INSERT`, `UPDATE` e `DELETE`, pertanto la row-level security non limita le operazioni di lettura, scrittura o eliminazione della chiave: essa può leggere, modificare ed eliminare ogni riga raggiungibile dai suoi scope. Il ruolo supera inoltre i controlli di amministrazione all'esterno del database: `requireAdmin` nelle [custom function](/docs/backend/custom-functions/) e le scritture che lo storage riserva agli amministratori. Non concede alcuno scope aggiuntivo: la chiave accede comunque soltanto a ciò che è elencato nei suoi `scopes`.

Chi crea una chiave può assegnarle solo i ruoli che possiede personalmente, a meno che non sia un amministratore.

### Accesso completo, per CI e migrazioni

`--full-access` assegna alla chiave ogni scope posseduto da chi la crea, ad eccezione di `keys:read` e `keys:write`, che nessuna chiave può possedere. Tramite la CLI, che utilizza la chiave di servizio, si tratta di ogni scope del data plane e dell'admin plane. Aggiungi `--roles admin` e la row-level security non limiterà più quali righe può leggere, modificare o eliminare:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

Questa è la configurazione corretta per CI, migrazioni e strumenti proprietari affidabili. Non è la configurazione adeguata per un agente.

### Rate limit

Il `rate_limit` di una chiave indica quante richieste può effettuare in un intervallo di 15 minuti; ogni punto di accesso viene conteggiato all'interno di un unico bucket, `api-key:<id>`:

- le sue richieste HTTP alle API di dati, storage e funzioni;
- i suoi frame di dati sul socket realtime: fetch, conteggi, salvataggi ed eliminazioni, nonché sottoscrizioni e richieste di cronologia dei canali oltre la [quota](/docs/backend/realtime/#what-a-write-costs-and-the-limits) prevista per ciascun socket;
- le sue richieste a [`/mcp`](/docs/ai/remote-mcp/).

In assenza di un `rate_limit`, il bucket adotta il valore predefinito del server per le chiavi API, pari a 1000. Una chiave personale non ha un proprio `rate_limit` e viene conteggiata in un bucket dedicato a quel valore predefinito. Oltre il limite, una richiesta HTTP risponde con `429` e un frame del socket con `RATE_LIMITED`.

Le route di amministrazione sotto `/api/admin` e i messaggi di amministrazione del socket (come quelli dell'editor SQL) non sono soggetti a rate limit.

Un amministratore che simula una chiave ("Simulate access", `x-rebase-simulate-api-key-id`) consuma la propria quota personale, non quella della chiave: l'integrazione basata su quella chiave mantiene l'intero budget a disposizione. La simulazione o l'impersonificazione di un utente viene addebitata all'amministratore allo stesso modo.

## Chiavi personali

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Una chiave personale agisce **come il suo proprietario**: il suo uid e i suoi ruoli attuali al momento di ogni richiesta. Le regole basate sul proprietario corrispondono ad essa, pertanto legge esattamente ciò che leggerebbe il suo proprietario, ristretto dai suoi scope. È indicata per gli script personali, per una CLI sul proprio laptop o per uno strumento collegato al proprio account.

Sono disattivate per impostazione predefinita, poiché ciascuna di esse è una credenziale a lunga durata per un account. Abilitale nel blocco `auth` della [tabella degli utenti](/docs/schema/auth-table/):

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

A questo punto, un account autenticato può gestire le proprie chiavi:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // mostrata una sola volta

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

Lo stesso avviene tramite REST. `$ACCESS_TOKEN` è l'access token dell'account stesso, ottenuto dopo l'accesso:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Una chiave personale accetta `name`, `scopes` ed `expires_at`. Non include `roles` (perché viene eseguita con quelli del suo proprietario) né un `rate_limit`. L'invio di uno di questi parametri restituisce `400 INVALID_INPUT`.

Ciò che una chiave personale detiene sono i suoi scope, ridotti a ciò che il suo proprietario possiede **in quel momento**. Rimuovendo un ruolo dal proprietario, ogni chiave da lui creata si riduce di conseguenza. Eliminando l'account, le sue chiavi smettono di funzionare. Disattivando `personalKeys`, anche tutte le chiavi personali smettono di funzionare.

Solo un account può possedere chiavi personali. Una chiave API, la chiave di servizio e una sessione ospite vengono rifiutate: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` per una chiave, `403 PERSONAL_KEY_NEEDS_ACCOUNT` per gli altri due casi. Quando la funzionalità è disattivata, ogni route risponde con `403 PERSONAL_KEYS_DISABLED`.

## Cosa copre ciascuno scope

### Dati

`data:read`, `data:write` e `data:delete`, generici o limitati a una collection specifica (`data:read:posts`). L'operazione dipende dal metodo HTTP: `GET`, `HEAD` e `OPTIONS` leggono, `POST`, `PUT` e `PATCH` scrivono, `DELETE` elimina. `POST /api/data/:slug/bulk/delete` conta come un'eliminazione, sebbene sia una `POST`.

Su un percorso annidato, l'operazione viene verificata sulla collection finale del percorso, e ciascuna collection intermedia attraversata richiede `data:read`. A una chiave con il solo scope `data:read:posts` viene rifiutato l'accesso a `/api/data/authors/1/posts` finché non può leggere anche `authors`.

### Storage

`storage:read` elenca e scarica i file. `storage:write` carica e crea cartelle, e copre ogni passaggio di un caricamento ripristinabile (TUS), inclusi il controllo dell'offset e l'annullamento. `storage:delete` elimina. La destinazione è l'id di una sorgente di storage. L'id della sorgente predefinita è `(default)`, quindi `storage:read:(default)` legge solo la sorgente predefinita, mentre `storage:write:avatars` scrive su una sorgente denominata `avatars`. Dopo il controllo dello scope, [`storageAuthorize`](/docs/backend/storage-authorization/) viene comunque eseguita, con l'identità della chiave.

### Funzioni

`functions:invoke` richiama tutte le custom function. `functions:invoke:<name>` ne richiama una specifica. Elencare le funzioni su `GET /api/functions` richiede lo scope generico.

Non assegnare `functions:invoke` a una chiave che intendi mantenere di sola lettura. Una funzione è codice e può eseguire operazioni di scrittura. All'interno di una funzione, `getScopes(c)` e `hasScope(c, …)` verificano i permessi della chiave, e un'applicazione può dichiarare i propri scope personalizzati affinché una funzione li controlli. Consulta [Custom Functions](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Superfici di amministrazione

Uno scope dell'admin plane presente su una chiave consente di raggiungere tale superficie. Uno scheduler che attiva job di cron richiede `cron:write`. Un log shipper richiede `logs:read`. Un job di backup richiede `backups:read`. L'[indice degli endpoint](/docs/backend/endpoints/#admin) elenca lo scope richiesto da ciascuna route.

`keys:read` e `keys:write` non possono mai essere assegnati a una chiave. Una chiave in grado di gestire chiavi potrebbe generare il proprio successore o ampliare i propri privilegi. Qualsiasi richiesta alle route delle chiavi effettuata con una chiave viene rifiutata con `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Gestisci le chiavi come una persona in possesso di `keys:write` oppure tramite la chiave di servizio.

### Realtime

Una chiave autentica anche il WebSocket: inviala nel messaggio `AUTHENTICATE`. Le operazioni di fetch e subscription richiedono `data:read` sulla rispettiva collection, i salvataggi richiedono `data:write`, le eliminazioni `data:delete`. Una subscription a un percorso annidato richiede lo scope generico. I canali (broadcast e presence) sono preclusi alle chiavi. I messaggi dell'editor SQL e dei branch richiedono `database:read` o `database:write`.

## Agenti e server MCP

Un agente necessita della chiave con i privilegi più *ristretti* possibili per svolgere il proprio compito. Parti con scope limitati e definisci una scadenza:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Ometti `data:delete` se l'agente può modificare ma non deve eliminare elementi. Il permesso `delete` è separato da `write` proprio per questa ragione.

## Regole di emissione

Ogni chiave viene verificata rispetto a chi la crea, nello stesso modo su entrambe le route:

| Rifiuto | Quando |
|---|---|
| `400 INVALID_SCOPES` | Uno scope è malformato, sconosciuto o contiene una destinazione non valida. `details.validScopes` elenca gli scope consentiti per una chiave. Esclude `keys:*`, che nessuna chiave può possedere |
| `400 UNKNOWN_SCOPE_TARGET` | Una destinazione indica una collection, una sorgente di storage o una funzione non gestita da questo backend |
| `400 KEY_MANAGEMENT_SCOPE` | È stato richiesto `keys:read` o `keys:write` |
| `403 SCOPE_EXCEEDS_CREATOR` | Uno scope non posseduto da chi lo assegna. Una chiave non può mai possedere più permessi dell'account che l'ha creata |
| `403 ROLE_EXCEEDS_CREATOR` | Un ruolo per la chiave di servizio non posseduto da chi la crea, nel caso in cui chi la crea non sia un amministratore |
| `400 INVALID_ROLE` | Il nome di un ruolo è vuoto o contiene `,` `{` `}` `"` `\` o un carattere di controllo, che la RLS interpreterebbe come altri ruoli |
| `403 KEY_OUTRANKS_CALLER` | In caso di modifica (`PUT`) o revoca (`DELETE`): la chiave possiede già un ruolo o uno scope che il chiamante non possiede, e il chiamante non è un amministratore |

Una richiesta per la quale la chiave stessa non dispone dello scope necessario risponde con `403 SCOPE_MISSING`, indicando lo scope richiesto in `details.requiredScope`. Consulta [Codici di errore](/docs/backend/errors/#authentication-and-accounts).

## Gestione delle chiavi

| Metodo | Percorso | Richiede |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Modifica `name`, `scopes`, `roles`, `rate_limit` o `expires_at`, secondo le stesse regole di creazione |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Revoca |
| `GET` | `/api/auth/keys` | Un account: le proprie chiavi personali |
| `POST` | `/api/auth/keys` | Un account, con `personalKeys` abilitato |
| `DELETE` | `/api/auth/keys/:id` | Un account: revoca una delle proprie chiavi |

Ogni route restituisce le chiavi mascherate: `key_prefix`, mai l'hash. Ciascuna chiave segnala il proprio `kind` (`service` o `personal`), i suoi `scopes`, i suoi `roles` e, per una chiave personale, il relativo `owner_uid`.

La CLI gestisce le chiavi di servizio: `rebase api-keys list`, `get`, `create`, `revoke` e `scopes`, che elenca tutti gli scope noti al backend. Consulta la [guida di riferimento della CLI](/docs/cli/#rebase-api-keys). Si autentica tramite `REBASE_SERVICE_KEY` dal file `.env`, inviandola solo al server che `rebase dev` sta eseguendo per questo progetto; di conseguenza, se quel server è arrestato, non invia nulla. Per un server avviato in altro modo, ad esempio tramite `rebase start` o un container, imposta `REBASE_BASE_URL` sul suo indirizzo ([l'ambiente della CLI](/docs/getting-started/configuration/#the-clis-own-environment)).

## Chiavi create prima degli scope

Le chiavi create prima dell'introduzione degli scope includono un elenco `permissions` e un flag `admin`. All'avvio, l'archivio assegna a ciascuna gli scope corrispondenti. Nessun permesso viene esteso; qualora una vecchia assegnazione non abbia una corrispondenza esatta, viene ristretta:

| Vecchia assegnazione | Scope attuali |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` e `storage:<op>` per ciascuna operazione, più `functions:invoke` se includeva `write` |
| `"storage"` | `storage:<op>` per ciascuna operazione |
| `"functions"` | `functions:invoke`, solo se includeva `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, solo se includeva `write` |
| `admin: true` | il ruolo `admin`, più `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

Il segreto non cambia, pertanto un'integrazione continua a funzionare. Due tipi di concessioni vengono ristretti:

- Una concessione per le funzioni priva di `write` viene annullata. Una richiesta `GET` veniva precedentemente considerata come lettura, ma una funzione è codice e invocarne una non costituisce una semplice lettura.
- Una chiave di amministrazione non ottiene alcun permesso `database:*`, a cui non poteva accedere in precedenza, né `keys:*`, che nessuna chiave può possedere.

Le vecchie colonne `permissions` e `admin` vengono mantenute invariate, così un eventuale ripristino a un runtime precedente potrà ancora leggere le proprie chiavi. Una richiesta che invia `permissions` o `admin` al posto di `scopes` viene rifiutata con `400 INVALID_INPUT`.

## Passaggi successivi

- [Ruoli e scope](/docs/backend/roles-and-scopes/): tutti gli scope e come i ruoli li contengono
- [Indice degli endpoint](/docs/backend/endpoints/): lo scope richiesto da ciascuna route
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/): ciò che il database applica oltre agli scope di una chiave

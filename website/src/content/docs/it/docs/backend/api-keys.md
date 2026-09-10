---
sourceHash: 87d15c9eb4314422
title: Chiavi API
sidebar_label: Chiavi API
description:"\"Chiavi con ambito limitato e revocabili per chiamanti automatici: cosa può raggiungere una chiave, come gli ambiti si combinano con la sicurezza a livello di riga (RLS) e gli endpoint di amministrazione per gestirle.\""
---

## Chiavi API

Le chiavi API forniscono l'autenticazione machine-to-machine per agenti, server MCP, pipeline di CI e integrazioni esterne. Supportano la definizione dei permessi per singola collezione e l'accesso di amministrazione completo opzionale.

### Creazione di una chiave API

```bash
# Via CLI
rebase api-keys create --name "My Integration" \
  --permissions '[{"collection":"orders","operations":["read","write"]}]'

# Via REST (requires admin auth)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "permissions": [{ "collection": "orders", "operations": ["read", "write"] }]
  }'
```

La risposta include la chiave completa in chiaro (`rk_live_...`) **esattamente una volta** — salvala immediatamente.

### Utilizzo di una chiave API

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Permessi e RLS: due controlli indipendenti

La richiesta di una chiave API passa attraverso **due** controlli di autorizzazione, ed entrambi devono consentirla:

1. **L'elenco dei permessi della chiave** — collezione × operazione, verificato a livello di route.
2. **Row-Level Security (RLS)** — Le chiavi API *non* aggirano la RLS. Una chiave viene eseguita come
   `uid: "api-key:<id>"` con il ruolo `service` (più `admin` quando
   `admin: true`). Le chiavi admin passano tramite i criteri di amministrazione integrati; una
   chiave non admin vede solo le righe che una regola di sicurezza concede esplicitamente al
   ruolo `service` o al pubblico. Le regole basate sul proprietario
   (`owner_id = rebase.uid()`) non corrispondono mai a una chiave API.

Quindi una chiave non admin con permessi `"*"` può comunque ottenere risultati vuoti — è il
normale funzionamento della RLS, non un bug. È necessario concedere il ruolo `service` nelle
regole di sicurezza delle collezioni pertinenti, oppure utilizzare una chiave admin.

### Funzioni personalizzate

Le invocazioni delle funzioni hanno un ambito simile a quello delle collezioni, sotto il
namespace `functions`: `{"collection": "functions", "operations": ["write"]}` garantisce l'accesso a
tutte le funzioni, `"functions/<name>"` ne garantisce una sola e il carattere jolly globale `"*"` le
autorizza tutte. Una chiave priva di tale voce non può invocare alcuna funzione.

### Storage

Lo storage funziona allo stesso modo, sotto il namespace `storage`:
`{"collection": "storage", "operations": ["read", "write"]}` consente alla chiave di
scaricare/elencare (`read`), caricare e creare cartelle (`write`) ed eliminare file
(`delete`). Anche il carattere jolly globale `"*"` concede l'accesso allo storage. Una chiave priva di tale
voce non può interagire con lo storage. Le route di caricamento ripristinabile TUS contano come `write`
per ogni passaggio (inclusi il controllo dell'offset e l'annullamento), quindi una chiave con ambito di scrittura
può completare un caricamento in autonomia.

### Agenti e server MCP

Un agente necessita della chiave con i permessi più *ristretti* possibili per svolgere il proprio lavoro, non di una chiave admin. Inizia
con un ambito limitato e imposta una scadenza:

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Le operazioni sono `read`, `write` e `delete`, derivate dal metodo HTTP:
`GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` →
`delete`.

#### Una chiave con ambito legge zero righe finché una regola non concede il ruolo `service`

Questo è il passaggio che fa sembrare non funzionante una chiave con ambito configurato correttamente. Una chiave non admin
viene eseguita come `uid: "api-key:<id>"` con i ruoli `["service"]`, e il criterio RLS
inserito in ogni collezione per impostazione predefinita compila in:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

— il contesto del server, o un admin. Una chiave non admin non corrisponde a nessuno dei due casi, quindi su una
collezione priva di `securityRules` la richiesta ha successo con un insieme di risultati vuoto
e nessun errore che ne spieghi il motivo. Concedi il ruolo esplicitamente:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Poiché `rebase.uid()` contiene l'id della chiave, una regola può anche limitare l'ambito delle righe a una
chiave specifica:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Non usare `"*"` per una chiave di sola lettura

Il carattere jolly `"*"` non indica solo "ogni collezione" — corrisponde anche al namespace
`functions` e allo `storage`. Un `GET` conta come `read`, e l'handler di una funzione personalizzata
è codice arbitrario che può scrivere, quindi una chiave di "sola lettura" con carattere jolly può
apportare modifiche tramite una funzione. Indicare le collezioni esplicitamente non concede alla
chiave alcun accesso alle funzioni.

#### `--admin --full-access`: CI, migrazioni, strumenti di prima parte

`"admin": true` concede alla chiave il ruolo admin — route `/api/admin/*` per la gestione
dello schema, la gestione degli utenti e altro, oltre a cron, backup e log. In combinazione
con `--full-access` (`{"collection": "*", "operations": ["read", "write",
"delete"]}`), la chiave ha accesso a ogni collezione, all'intero storage e a ciascuna funzione personalizzata.
Questa è la configurazione adeguata per CI, migrazioni e strumenti proprietari affidabili — non per gli agenti.

```bash
# CLI
rebase api-keys create -n "CI" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

#### Nessun supporto realtime tramite chiavi API

Il WebSocket realtime non elabora i token `rk_` — accetta unicamente i JWT utente e
la chiave di servizio. Un agente autenticato con una chiave API esegue il polling degli
endpoint REST anziché effettuare la sottoscrizione.

### Opzioni delle chiavi

| Campo | Tipo | Descrizione |
|---|---|---|
| `name` | `string` | Etichetta leggibile |
| `permissions` | `ApiKeyPermission[]` | Accesso per collezione (`"*"` = tutto; `"functions/<name>"` = una funzione; `"storage"` = storage di file) |
| `admin` | `boolean` | Concede il ruolo admin — route di amministrazione + criteri RLS admin |
| `rate_limit` | `number \| null` | Richieste per intervallo di 15 minuti (`null` = valore predefinito del server, 1000) |
| `expires_at` | `string \| null` | Timestamp di scadenza ISO-8601 |

La CLI richiede un ambito esplicito: passa `--permissions '<json>'` o usa
`--full-access` — non esiste un'impostazione predefinita implicita di accesso completo.

Le chiavi possono essere elencate, aggiornate e revocate tramite `/api/admin/api-keys` o i
comandi CLI `rebase api-keys` — ma non tramite una chiave API. Qualsiasi richiesta a
`/api/admin/api-keys` autenticata con una chiave `rk_` viene rifiutata con `403
API_KEY_SELF_MANAGEMENT_FORBIDDEN`, indipendentemente dal suo flag `admin`. La gestione delle chiavi
richiede la sessione di un utente admin o la chiave di servizio.

## Passaggi successivi

- [API REST](/docs/backend/api/) — gli endpoint chiamati da una chiave
- [Indice degli endpoint](/docs/backend/endpoints/) — il controllo di accesso su ogni route, chiavi incluse
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/) — ciò che il database applica oltre agli ambiti di una chiave

---

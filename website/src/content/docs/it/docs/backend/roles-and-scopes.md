---
sourceHash: 1610ca294114442e
title: Ruoli e scope
sidebar_label: Ruoli e scope
description: "Cosa può fare un chiamante: il data plane posseduto da ogni persona, l'admin plane concesso dai ruoli, gli scope che un'app dichiara per se stessa e come ogni credenziale li trasporta."
---

Ogni richiesta a un backend Rebase pone una domanda: questo chiamante può fare questo?
La risposta è uno **scope**, una stringa denominata `resource:action`: `data:read`,
`users:write`, `cron:read`. La sessione di una persona, una chiave API, un token MCP e un
ruolo possiedono tutti degli scope, e utilizzano tutti le stesse stringhe. Una concessione
si legge allo stesso modo su una chiave, su un ruolo e su una schermata di consenso.

## Due piani

Gli scope sono suddivisi in due piani, e una persona li possiede in modo diverso.

**Il data plane** comprende `data:*`, `storage:*` e `functions:invoke`. Ogni
persona autenticata li possiede tutti. Ciò che una persona può fare con una riga è stabilito
dalla [row-level security](/docs/collections/security-rules/) della tabella, riga per riga,
e ciò che può fare con un file dalle [policy di archiviazione](/docs/backend/storage-authorization/).
Uno scope non decide mai questo per una persona. Su una chiave o un token, gli scope del
data plane si restringono: una chiave che possiede solo `data:read:posts` legge `posts` e
nient'altro, a prescindere da cosa consentirebbero le regole.

**L'admin plane** è tutto il resto: utenti, schema, database, backup,
cron, log e chiavi. Nessuno lo possiede implicitamente. Il ruolo integrato `admin`
lo possiede interamente. Qualsiasi altro ruolo possiede ciò che l'app dichiara per esso.

## Gli scope

| Scope | Piano | Target | Cosa consente |
|---|---|---|---|
| `data:read` | data | collection | Legge le righe, tramite la row-level security del chiamante |
| `data:write` | data | collection | Crea e aggiorna le righe, tramite la row-level security del chiamante |
| `data:delete` | data | collection | Elimina le righe, tramite la row-level security del chiamante |
| `storage:read` | data | storage source | Elenca e scarica file |
| `storage:write` | data | storage source | Carica file e crea cartelle |
| `storage:delete` | data | storage source | Elimina file |
| `functions:invoke` | data | function | Chiama funzioni personalizzate. Una funzione può fare qualsiasi cosa faccia il suo codice |
| `users:read` | admin | — | Elenca gli account e i loro ruoli |
| `users:write` | admin | — | Crea, modifica ed elimina account, reimposta password e secondi fattori, assegna ruoli fino a quelli posseduti dal titolare |
| `schema:read` | admin | — | Legge lo schema, pianifica modifiche allo schema, esegue l'audit RLS, legge la documentazione privata delle API |
| `schema:write` | admin | — | Applica le modifiche allo schema: modifica i file di schema e altera il database |
| `database:read` | admin | — | Elenca database, tabelle, ruoli Postgres e branch |
| `database:write` | admin | — | Esegue SQL come proprietario del database, al di fuori della row-level security, e crea o elimina branch |
| `backups:read` | admin | — | Elenca e scarica i backup: ogni riga, al di fuori della row-level security |
| `cron:read` | admin | — | Elenca i cron job e legge la cronologia delle loro esecuzioni |
| `cron:write` | admin | — | Attiva i cron job e li abilita o disabilita |
| `logs:read` | admin | — | Legge i log del server |
| `keys:read` | admin | — | Elenca le service key del progetto. Non concedibile a una chiave |
| `keys:write` | admin | — | Crea, modifica e revoca le service key. Non concedibile a una chiave |

`GET /api/auth/scopes` restituisce questo elenco per il backend in esecuzione, con l'aggiunta
degli scope propri dell'app, più gli scope posseduti dal chiamante. Qualsiasi chiamante
autenticato può leggerlo:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Target

Uno scope del data plane può essere ristretto a un singolo target, dopo un secondo carattere due punti:

- `data:read:posts` legge solo la tabella `posts`. Il target è lo slug di una tabella.
- `storage:write:avatars` carica solo nella risorsa di archiviazione `avatars`. L'ID
  della risorsa predefinita è `(default)`: `storage:read:(default)`.
- `functions:invoke:export` chiama solo la funzione `export`.

Lo scope generico copre ogni target. Uno scope ristretto copre solo il proprio target e
nient'altro. Non risponde mai a una richiesta riguardante tutti i target: una chiave che possiede
`data:read:posts` non può elencare tutte le tabelle.

Gli scope dell'admin plane non prevedono target. Uno scope dell'app ne prevede uno quando dichiara un
`target`, come mostrato di seguito.

## Dichiarazione dei ruoli

<span class="since-badge" data-since="0.31">Da 0.31</span>

I ruoli vengono dichiarati nella [tabella utenti](/docs/schema/auth-table/), sotto
`auth.roles`. Un ruolo è un nome riconosciuto dal database, che le policy di row-level security
possono verificare, unitamente a un elenco di scope dell'admin plane e dell'app.

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        roles: col.text({ enum: ["admin", "support", "developer", "editor"] }).array(),
    },
    rls: "admin-only",
    auth: {
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"],
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"],
            },
        },
    },
});
```

Una persona possiede un ruolo quando la sua colonna `roles` lo elenca. È possibile assegnarlo
nel pannello di amministrazione oppure tramite `PUT /api/admin/users/:uid`.

L'avvio rifiuta una dichiarazione che sembrerebbe una concessione che in realtà non è:

- **`admin` non può essere dichiarato.** È integrato e possiede ogni scope.
- **Un ruolo non può elencare uno scope del data plane.** Ogni persona possiede già
  il data plane. `data:write` su un ruolo non concederebbe nulla pur sembrando farlo.
  Ciò che un ruolo può fare con le righe appartiene alla configurazione [`rls`](/docs/collections/security-rules/) della tabella.
- **Ogni scope deve esistere.** Un nome sconosciuto blocca l'avvio ed elenca quelli validi.

Un ruolo non dichiarato è comunque un ruolo. `editor` nell'esempio precedente non ha alcuna voce,
quindi non possiede alcuno scope dell'admin plane, ma una policy RLS può comunque verificarlo.

`defaultRole`, il ruolo assegnato a ogni nuovo utente registrato, non può essere `admin` né
un ruolo dichiarato che possiede alcuno scope dell'admin plane. Un utente esterno che si registra
non deve possedere permessi di gestione del progetto. L'avvio lo rifiuta.

:::note[`schema-admin` è stato rimosso]
Le versioni precedenti consideravano un ruolo denominato `schema-admin` come un secondo amministratore. Ora
non ha più alcun significato di per sé. Se il tuo progetto lo utilizzava, dichiaralo con gli scope
necessari, ad esempio
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` elenca `admin` e ogni ruolo dichiarato con i relativi scope. Richiede
`users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## Scope dell'applicazione

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un'app può definire le proprie operazioni come scope, sotto `auth.scopes`:

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project",
            },
        },
    },
});
```

Il nome è `resource:action`, in minuscolo, senza target. Non può riutilizzare una risorsa
integrata: `data`, `storage`, `functions`, `users`, `schema`, `database`, `backups`, `cron`,
`logs` e `keys` sono già occupate. `label` è obbligatorio, perché corrisponde a quanto visualizzato
dall'utente al momento della concessione dello scope. `target` specifica il significato del target,
consentendo a una chiave di possedere ad esempio `project:deploy:p1`.

Ogni persona autenticata possiede tutti gli scope dell'app. Come per il data plane, il codice
dietro lo scope stabilisce se la persona può agire. Lo scope esiste affinché una chiave possa
essere limitata a quella sola azione. Anche un ruolo può elencare scope dell'app.

È possibile verificarne uno in una [funzione personalizzata](/docs/backend/custom-functions/) con `requireScope`:

```typescript
import { defineFunction, requireAuth, requireScope, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post(
        "/:project",
        requireAuth,
        requireScope("project:deploy", c => c.req.param("project")),
        async (c) => {
            // A person always passes requireScope. Decide here whether
            // this person may deploy this project.
            return c.json({ project: c.req.param("project"), by: getUserId(c) });
        }
    );
});
```

Una chiave che possiede `project:deploy:p1` supera la verifica per `p1` e riceve `403 SCOPE_MISSING`
per qualsiasi altro progetto. Ha inoltre bisogno di `functions:invoke`, o di
`functions:invoke:<name>` per questa funzione, per poter accedere alla funzione stessa.
`hasScope(c, scope, target)` e `getScopes(c)` rispondono alla stessa domanda all'interno di un gestore.

`requireScope`
rifiuta uno scope che nessuno potrebbe possedere. Un nome che non corrisponde a uno scope, o un nome
integrato con errori di digitazione come `data:raed`, genera un errore al caricamento della funzione.
Uno scope dell'app non dichiarato dal backend sotto `auth.scopes` restituisce a ogni chiamante,
amministratore compreso, `500 SCOPE_NOT_DECLARED`.

## Cosa comporta essere admin

`admin` è l'unico ruolo integrato, ed è molto più di un elenco di scope:

- Possiede ogni scope dell'admin plane, `keys:*` compreso.
- È un ruolo riconosciuto dal database. Le policy predefinite che Rebase aggiunge a ogni
  tabella lo ammettono, consentendo a un admin di leggere e scrivere ogni riga di una tabella
  che le mantiene. Una tabella con `defaultPolicies: false` le esclude.
- Solo un admin può concedere `admin`. Un ruolo che elenca tutti gli scope dell'admin plane
  non equivale comunque ad `admin`: non può assegnare `admin` e le policy predefinite
  non lo autorizzano.

`requireAdmin` controlla la presenza del ruolo. È preferibile utilizzare `requireScope` per qualsiasi
operazione che un ruolo più specifico o una chiave dovrebbe essere in grado di svolgere.

## Nessuno concede più di quanto possiede

Una sola regola disciplina qualsiasi meccanismo di concessione dell'accesso: **non può essere concesso
nulla di superiore a quanto posseduto da chi lo concede.**

Per le chiavi:

- Gli scope di una chiave devono rientrare in quelli del suo creatore. In caso contrario: `403 SCOPE_EXCEEDS_CREATOR`.
- I ruoli RLS di una service key devono essere ruoli posseduti dal suo creatore, a meno che il creatore
  non sia un admin. In caso contrario: `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` e `keys:write` non possono mai essere assegnati a una chiave. Una chiave che gestisce chiavi
  potrebbe generare il proprio successore: `400 KEY_MANAGEMENT_SCOPE`.
- Chi possiede `keys:write` non può modificare o revocare una chiave che possiede un ruolo o uno scope
  non posseduto dal chiamante stesso, a meno che non sia un admin: `403 KEY_OUTRANKS_CALLER`.
  Senza questo vincolo, potrebbe estendere una chiave con ruolo admin a ogni scope del data plane.

Per gli account, chi possiede `users:write`:

- non può modificare, reimpostare o eliminare un account i cui ruoli possiedono uno scope che il chiamante non detiene,
  né `admin` se il chiamante non è un admin:
  `403 ACCOUNT_OUTRANKS_CALLER`. Senza questo vincolo, un ruolo di supporto potrebbe reimpostare la password
  di un admin ed effettuare l'accesso con la sua identità.
- non può assegnare ruoli che comprendono permessi superiori ai propri, compreso `admin`: `403 ROLE_EXCEEDS_CALLER`.

Il nome di un ruolo può essere qualsiasi stringa eccetto una che verrebbe interpretata come ruoli
multipli: un nome vuoto o contenente `,` `{` `}` `"` `\` o un carattere di controllo viene
rifiutato con `400 INVALID_ROLE` ovunque venga scritto un ruolo (utenti, tabella utenti, service key).

## Come ciascuna credenziale detiene gli scope

| Credenziale | Agisce come | Possiede |
|---|---|---|
| Sessione di una persona | la persona | il data plane, ogni scope dell'app e gli scope dei suoi ruoli. Un admin possiede tutto |
| [Service key](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, con i ruoli RLS `service` più i propri `roles` | esattamente i propri scope |
| [Personal key](/docs/backend/api-keys/#personal-keys) `rk_live_…` | il suo proprietario, con i ruoli del proprietario aggiornati a ciascuna richiesta | i propri scope, limitati a quanto posseduto dal proprietario in quel momento |
| [Token MCP](/docs/ai/remote-mcp/) | la persona che lo ha collegato | `data:read`, `data:write`, `data:delete` in base a quanto concesso, facoltativamente per tabella |
| `REBASE_SERVICE_KEY` | `service`, con il ruolo `admin` | tutto |

Una chiave o un token non aggirano mai la row-level security. I loro scope rappresentano un limite
massimo, e le policy del database per l'identità con cui agiscono ne rappresentano un altro.

## Quando uno scope è mancante

La risposta restituita è `403 SCOPE_MISSING`, e `details.requiredScope` indica lo scope,
con il rispettivo target se presente:

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Per una persona, la soluzione è un ruolo che includa lo scope. Per una chiave, è una nuova chiave
che lo contenga.

## Passaggi successivi

- [Chiavi API](/docs/backend/api-keys/): service key, personal key e le regole di emissione
- [Row-level security](/docs/collections/security-rules/): cosa può fare una persona con ciascuna riga
- [Indice degli endpoint](/docs/backend/endpoints/): lo scope richiesto da ciascuna route
- [Codici di errore](/docs/backend/errors/#authentication-and-accounts): tutti i casi di rifiuto descritti sopra

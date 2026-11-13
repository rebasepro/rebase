---
sourceHash: 3b3d8ad69537b827
title: Ruoli e scope
sidebar_label: Ruoli e scope
description: "Cosa può fare un chiamante: il data plane a disposizione di ogni persona, l'admin plane concesso dai ruoli, gli scope che un'app dichiara per se stessa e come ciascuna credenziale li include."
---

Ogni richiesta a un backend Rebase pone una domanda: questo chiamante può fare questo?
La risposta è uno **scope**, una stringa denominata `resource:action`: `data:read`,
`users:write`, `cron:read`. La sessione di una persona, una chiave API, un token MCP e un
ruolo contengono tutti degli scope, e usano tutti le stesse stringhe. Una concessione si legge allo stesso
modo su una chiave, su un ruolo e su una schermata di consenso.

## Due piani

Gli scope si dividono in due piani e una persona li possiede in modo diverso.

**Il data plane** comprende `data:*`, `storage:*` e `functions:invoke`. Ogni
persona autenticata ne ha il pieno possesso. Ciò che una persona può fare con una riga è determinato dalla
[row-level security](/docs/collections/security-rules/) della tabella, riga per riga,
e ciò che può fare con un file dalle [storage policies](/docs/backend/storage-authorization/).
Uno scope non decide mai questo per una persona. Su una chiave o su un token, gli scope del data plane
si restringono: una chiave che detiene solo `data:read:posts` legge `posts` e nient'altro,
indipendentemente da quanto consentito dalle regole.

**L'admin plane** è tutto il resto: utenti, schema, database, backup,
cron, log e chiavi. Nessuno lo possiede implicitamente. Il ruolo predefinito `admin` detiene
tutto. Qualsiasi altro ruolo detiene ciò che l'app dichiara per esso.

## Gli scope

| Scope | Piano | Target | Cosa consente |
|---|---|---|---|
| `data:read` | data | collection | Legge le righe, tramite la row-level security del chiamante |
| `data:write` | data | collection | Crea e aggiorna le righe, tramite la row-level security del chiamante |
| `data:delete` | data | collection | Elimina le righe, tramite la row-level security del chiamante |
| `storage:read` | data | storage source | Elenca e scarica file |
| `storage:write` | data | storage source | Carica file e crea cartelle |
| `storage:delete` | data | storage source | Elimina file |
| `functions:invoke` | data | function | Esegue funzioni personalizzate. Una funzione può eseguire qualsiasi operazione prevista dal suo codice |
| `users:read` | admin | — | Elenca gli account e i rispettivi ruoli |
| `users:write` | admin | — | Crea, modifica ed elimina account, reimposta password e secondi fattori, assegna ruoli fino a quelli posseduti dal titolare |
| `schema:read` | admin | — | Legge lo schema, pianifica modifiche allo schema, esegue l'audit RLS, legge la documentazione delle API private |
| `schema:write` | admin | — | Applica modifiche allo schema: modifica i file di schema e altera il database |
| `database:read` | admin | — | Elenca database, tabelle, ruoli Postgres e branch |
| `database:write` | admin | — | Esegue SQL come proprietario del database, al di fuori della row-level security, e crea o elimina branch |
| `backups:read` | admin | — | Elenca e scarica backup: ogni riga, al di fuori della row-level security |
| `cron:read` | admin | — | Elenca i cron job e legge la cronologia delle esecuzioni |
| `cron:write` | admin | — | Attiva i cron job e li abilita o disabilita |
| `logs:read` | admin | — | Legge i log del server |
| `keys:read` | admin | — | Elenca le chiavi di servizio del progetto. Non concedibile a una chiave |
| `keys:write` | admin | — | Crea, modifica e revoca le chiavi di servizio. Non concedibile a una chiave |

`GET /api/auth/scopes` restituisce questo elenco per il backend in esecuzione, con l'aggiunta degli
scope specifici dell'app, più gli scope detenuti dal chiamante. Qualsiasi chiamante autenticato può
leggerlo:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Target

Uno scope del data plane può essere ristretto a un singolo target, dopo due punti aggiuntivi:

- `data:read:posts` legge solo la tabella `posts`. Il target è lo slug di una tabella.
- `storage:write:avatars` effettua upload solo verso la sorgente di archiviazione `avatars`. L'ID della sorgente predefinita è `(default)`: `storage:read:(default)`.
- `functions:invoke:export` invoca solo la funzione `export`.

Lo scope semplice copre tutti i target. Uno scope ristretto copre il proprio target e
nient'altro. Non risponde mai a una richiesta riguardante tutti i target: una chiave che detiene
`data:read:posts` non può elencare tutte le tabelle.

Gli scope dell'admin plane non accettano target. Uno scope di un'app ne accetta uno quando dichiara un
`target`, come descritto di seguito.

## Dichiarare i ruoli

<span class="since-badge" data-since="0.31">Since 0.31</span>

I ruoli vengono dichiarati nella [tabella utenti](/docs/schema/auth-table/), sotto
`auth.roles`. Un ruolo è un nome visibile al database, che le policy di
row-level security possono verificare, insieme a un elenco di scope dell'admin plane e dell'app.

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

Una persona possiede un ruolo quando la sua colonna `roles` lo include. Assegnalo nel pannello
di amministrazione oppure con `PUT /api/admin/users/:uid`.

L'avvio rifiuta una dichiarazione che sembrerebbe una concessione che in realtà non è:

- **`admin` non può essere dichiarato.** È integrato e detiene tutti gli scope.
- **Un ruolo non può elencare uno scope del data plane.** Ogni persona possiede già l'intero
  data plane. Aggiungere `data:write` a un ruolo non concederebbe nulla e darebbe solo l'illusione di concedere
  qualcosa. Ciò che un ruolo può fare con le righe appartiene alla configurazione [`rls`](/docs/collections/security-rules/) della tabella.
- **Ogni scope deve esistere.** Un nome sconosciuto causa l'errore all'avvio e mostra l'elenco di quelli validi.

Un ruolo non dichiarato rimane comunque un ruolo valido. `editor` sopra non ha alcuna voce associata, quindi
non possiede alcuno scope dell'admin plane, ma una policy RLS può comunque verificarlo.

`defaultRole`, il ruolo assegnato a ogni nuovo utente registrato, non può essere `admin` né un
ruolo dichiarato che detenga alcuno scope dell'admin plane. Uno sconosciuto che si registra non dovrebbe
avere alcuna autorizzazione per gestire il progetto. L'avvio rifiuterà tale configurazione.

:::note[`schema-admin` non è più disponibile]
Le versioni precedenti trattavano un ruolo chiamato `schema-admin` come un secondo amministratore. Ora
non ha più alcun significato intrinseco. Se il tuo progetto lo utilizzava, dichiaralo con gli scope
desiderati, ad esempio
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` elenca `admin` e ogni ruolo dichiarato con i relativi scope. Richiede
`users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## Scope dell'app

<span class="since-badge" data-since="0.31">Since 0.31</span>

Un'app può definire le proprie operazioni sotto forma di scope, sotto `auth.scopes`:

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

Il nome è nel formato `resource:action`, in minuscolo, senza target. Non può riutilizzare una
risorsa predefinita: `data`, `storage`, `functions`, `users`, `schema`,
`database`, `backups`, `cron`, `logs` e `keys` sono già occupate. `label` è obbligatorio,
perché è ciò che una persona legge quando concede lo scope. `target` definisce il significato
del target, in modo che una chiave possa contenere `project:deploy:p1`.

Ogni persona autenticata possiede tutti gli scope dell'app. Come per il data plane, è il codice
associato allo scope a decidere se tale persona può agire. Lo scope esiste affinché
una chiave possa essere limitata a quella singola azione. Anche un ruolo può elencare gli scope dell'app.

Verificane uno in una [funzione personalizzata](/docs/backend/custom-functions/) con `requireScope`:

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

Una chiave contenente `project:deploy:p1` ha esito positivo per `p1` e riceve `403 SCOPE_MISSING`
per qualsiasi altro progetto. Ha inoltre bisogno di `functions:invoke`, oppure di
`functions:invoke:<name>` per questa funzione, per poter accedere alla funzione stessa.
`hasScope(c, scope, target)` e `getScopes(c)` rispondono alla stessa domanda all'interno di un
handler.

`requireScope` rifiuta uno scope che nessuno potrebbe possedere. Un nome che non è uno scope, o un nome
predefinito digitato erroneamente come `data:raed`, genera un errore al caricamento della funzione. Uno scope dell'app
che il backend non dichiara sotto `auth.scopes` risponde a ogni chiamante, compreso un
amministratore, con `500 SCOPE_NOT_DECLARED`.

## Cosa significa admin

`admin` è l'unico ruolo predefinito ed è più di un semplice elenco di scope:

- Detiene tutti gli scope dell'admin plane, inclusi `keys:*`.
- È un ruolo riconosciuto dal database. Le policy predefinite che Rebase aggiunge a ciascuna
  tabella lo autorizzano, quindi un amministratore può leggere e scrivere ogni riga di una tabella che le
  mantiene attive. Una tabella con `defaultPolicies: false` le rimuove.
- Solo un admin può concedere il ruolo `admin`. Un ruolo che elenca tutti gli scope dell'admin plane
  non equivale comunque ad `admin`: non può concedere `admin` e le policy predefinite non
  lo autorizzano.

`requireAdmin` verifica la presenza del ruolo. È preferibile usare `requireScope` per qualsiasi operazione che un
ruolo più ristretto o una chiave dovrebbero poter eseguire.

## Nessuno concede più di quanto possiede

Una regola vale per ogni punto di accesso che assegna autorizzazioni: **nulla viene concesso con più privilegi di quanti ne possieda chi lo concede.**

Per le chiavi:

- Gli scope di una chiave devono rientrare in quelli del suo creatore. Altrimenti: `403 SCOPE_EXCEEDS_CREATOR`.
- I ruoli RLS di una chiave di servizio devono essere ruoli posseduti dal suo creatore, a meno che il creatore
  non sia un amministratore. Altrimenti: `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` e `keys:write` non possono mai essere assegnati a una chiave. Una chiave che gestisce chiavi potrebbe
  creare il proprio successore. `400 KEY_MANAGEMENT_SCOPE`.
- Chi possiede `keys:write` non può modificare o revocare una chiave che detiene un ruolo o
  uno scope non in suo possesso, a meno che non sia un amministratore: `403 KEY_OUTRANKS_CALLER`.
  Senza questo vincolo, potrebbe estendere una chiave con ruolo admin a tutti gli scope di dati.

Per gli account, chi detiene `users:write`:

- non può modificare, reimpostare o eliminare un account i cui ruoli possiedono uno scope che tale utente non possiede,
  o `admin` se non è un amministratore:
  `403 ACCOUNT_OUTRANKS_CALLER`. Senza questo vincolo, un ruolo di supporto potrebbe reimpostare la password
  di un amministratore e accedere al suo posto.
- non può concedere ruoli che detengono privilegi maggiori dei propri, incluso `admin`: `403 ROLE_EXCEEDS_CALLER`.

Il nome di un ruolo può essere qualsiasi stringa tranne un nome che verrebbe interpretato come
più ruoli: un nome vuoto o contenente `,` `{` `}` `"` `\` o un carattere
di controllo viene rifiutato con `400 INVALID_ROLE` ovunque venga inserito un ruolo (utenti,
tabella utenti, chiavi di servizio).

## Come ogni credenziale detiene gli scope

| Credenziale | Agisce come | Detiene |
|---|---|---|
| La sessione di una persona | la persona | il data plane, ogni scope dell'app e gli scope dei suoi ruoli. Un admin detiene tutto |
| [Chiave di servizio](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, con i ruoli RLS `service` più i propri `roles` | esattamente i suoi scope |
| [Chiave personale](/docs/backend/api-keys/#personal-keys) `rk_live_…` | il suo proprietario, con i ruoli del proprietario aggiornati a ogni richiesta | i suoi scope, limitati a quanto posseduto dal proprietario in quel momento |
| [Token MCP](/docs/ai/remote-mcp/) | la persona che l'ha connesso | `data:read`, `data:write`, `data:delete` come concessi, facoltativamente per collezione |
| `REBASE_SERVICE_KEY` | `service`, con il ruolo `admin` | tutto |

Una chiave o un token non eludono mai la row-level security. I suoi scope rappresentano un limite massimo,
e le policy del database per l'identità con cui agisce ne costituiscono un altro.

## Quando manca uno scope

La risposta è `403 SCOPE_MISSING`, e `details.requiredScope` indica il nome dello scope,
con il relativo target quando presente:

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

- [Chiavi API](/docs/backend/api-keys/): chiavi di servizio, chiavi personali e regole di creazione
- [Row-level security](/docs/collections/security-rules/): cosa può fare una persona con ciascuna riga
- [Indice degli endpoint](/docs/backend/endpoints/): lo scope richiesto da ciascuna route
- [Codici di errore](/docs/backend/errors/#authentication-and-accounts): tutti i rifiuti sopra elencati

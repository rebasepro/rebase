---
sourceHash: e89814d78c29b234
title: Ruoli e scope
sidebar_label: Ruoli e scope
description: "Cosa può fare un chiamante: il piano dati che ogni persona possiede, il piano di amministrazione che i ruoli concedono, gli scope che un'app dichiara per sé e come ogni credenziale li porta con sé."
---

<span class="since-badge" data-since="0.24">Da 0.24</span> Ogni richiesta a un backend Rebase pone una sola domanda: questo chiamante può farlo?
La risposta è uno **scope**, una stringa nella forma `resource:action`: `data:read`,
`users:write`, `cron:read`. La sessione di una persona, una chiave API, un token MCP e un
ruolo possiedono tutti degli scope, e usano tutti le stesse stringhe. Una concessione si legge allo stesso modo
su una chiave, su un ruolo e su una schermata di consenso.

## Due piani

Gli scope si dividono in due piani, e una persona li possiede in modo diverso.

**Il piano dati** è `data:*`, `storage:*` e `functions:invoke`. Ogni
persona autenticata lo possiede per intero. Cosa una persona può fare con una riga lo decidono
le [regole di sicurezza](/docs/collections/security-rules/) della collezione, riga per riga,
e cosa può fare con un file le [policy dello storage](/docs/backend/storage/#per-object-authorization).
Per una persona non lo decide mai uno scope. Su una chiave o un token, gli scope del piano dati
restringono: una chiave che possiede solo `data:read:posts` legge `posts` e nient'altro,
qualunque cosa consentano le regole.

**Il piano di amministrazione** è tutto il resto: utenti, schema, database, backup,
cron, log e chiavi. Nessuno lo possiede implicitamente. Il ruolo integrato `admin` lo possiede
per intero. Ogni altro ruolo possiede ciò che l'app dichiara per esso.

## Gli scope

| Scope | Piano | Target | Cosa consente |
|---|---|---|---|
| `data:read` | dati | collezione | Leggere righe, attraverso la sicurezza a livello di riga del chiamante |
| `data:write` | dati | collezione | Creare e aggiornare righe, attraverso la sicurezza a livello di riga del chiamante |
| `data:delete` | dati | collezione | Eliminare righe, attraverso la sicurezza a livello di riga del chiamante |
| `storage:read` | dati | sorgente di storage | Elencare e scaricare file |
| `storage:write` | dati | sorgente di storage | Caricare file e creare cartelle |
| `storage:delete` | dati | sorgente di storage | Eliminare file |
| `functions:invoke` | dati | funzione | Chiamare funzioni personalizzate. Una funzione può fare tutto ciò che fa il suo codice |
| `users:read` | admin | — | Elencare gli account e i loro ruoli |
| `users:write` | admin | — | Creare, modificare ed eliminare account, reimpostare password e secondi fattori, assegnare ruoli fino a quelli di chi lo possiede |
| `schema:read` | admin | — | Leggere lo schema delle collezioni, pianificare modifiche allo schema, eseguire l'audit RLS, leggere la documentazione privata dell'API |
| `schema:write` | admin | — | Applicare modifiche allo schema: modifica i file delle collezioni e altera il database |
| `database:read` | admin | — | Elencare database, tabelle, ruoli Postgres e branch |
| `database:write` | admin | — | Eseguire SQL come proprietario del database, al di fuori della sicurezza a livello di riga, e creare o eliminare branch |
| `backups:read` | admin | — | Elencare e scaricare i backup: ogni riga, al di fuori della sicurezza a livello di riga |
| `cron:read` | admin | — | Elencare i cron job e leggere la cronologia delle loro esecuzioni |
| `cron:write` | admin | — | Avviare i cron job e attivarli o disattivarli |
| `logs:read` | admin | — | Leggere i log del server |
| `keys:read` | admin | — | Elencare le chiavi di servizio del progetto. Mai concedibile a una chiave |
| `keys:write` | admin | — | Creare, modificare e revocare chiavi di servizio. Mai concedibile a una chiave |

`GET /api/auth/scopes` restituisce questo elenco per il backend in esecuzione, con in più gli
scope propri dell'app, oltre agli scope che il chiamante possiede. Qualsiasi chiamante autenticato
può leggerlo:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Target

Uno scope del piano dati può essere ristretto a un solo target, dopo un secondo due punti:

- `data:read:posts` legge solo la collezione `posts`. Il target è lo slug di una collezione.
- `storage:write:avatars` carica solo sulla sorgente di storage `avatars`. L'id della
  sorgente predefinita è `(default)`: `storage:read:(default)`.
- `functions:invoke:export` chiama solo la funzione `export`.

Lo scope semplice copre ogni target. Uno scope ristretto copre il proprio target e
nient'altro. Non risponde mai a una domanda su tutti i target: una chiave che possiede
`data:read:posts` non può elencare ogni collezione.

Gli scope del piano di amministrazione non accettano target. Uno scope dell'app ne accetta uno quando dichiara un
`target`, come più avanti.

## Dichiarare i ruoli

<span class="since-badge" data-since="0.24">Da 0.24</span> I ruoli si dichiarano sulla collezione users, sotto `auth.roles`. Un ruolo è un nome
che il database vede, a cui i criteri RLS possono corrispondere, più un elenco di scope del piano di amministrazione
e dell'app.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"]
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"]
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" },
        roles: {
            name: "Roles",
            type: "array",
            columnType: "text[]",
            of: {
                name: "Role",
                type: "string",
                enum: { admin: "Admin", support: "Support", developer: "Developer", editor: "Editor" }
            }
        }
    }
});
```

Una persona possiede un ruolo quando la sua colonna `roles` lo elenca. Assegnalo nel pannello
di amministrazione, oppure con `PUT /api/admin/users/:uid`.

L'avvio rifiuta una dichiarazione che sembrerebbe una concessione che non è:

- **`admin` non può essere dichiarato.** È integrato e possiede ogni scope.
- **Un ruolo non può elencare uno scope del piano dati.** Ogni persona possiede già il piano
  dati. `data:write` su un ruolo non concederebbe nulla e sembrerebbe concedere
  qualcosa. Cosa un ruolo può fare con le righe va nelle `securityRules` della collezione.
- **Ogni scope deve esistere.** Un nome sconosciuto fa fallire l'avvio ed elenca quelli validi.

Un ruolo che non dichiari è comunque un ruolo. `editor` qui sopra non ha una voce, quindi
non possiede alcuno scope del piano di amministrazione, e un criterio RLS può comunque corrispondergli.

`defaultRole`, il ruolo che riceve ogni nuovo utente registrato, non può essere `admin` né un
ruolo dichiarato che possiede uno scope del piano di amministrazione. Uno sconosciuto che si registra non deve
possedere nulla che gestisca il progetto. L'avvio lo rifiuta.

:::note[`schema-admin` non esiste più]
Le versioni precedenti trattavano un ruolo chiamato `schema-admin` come un secondo admin. Ora
da solo non significa nulla. Se il tuo progetto lo usava, dichiaralo con gli scope
che intendevi, per esempio
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` elenca `admin` e ogni ruolo dichiarato con i suoi scope.
Richiede `users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## Scope dell'app

Un'app può dare un nome di scope alle proprie operazioni, sotto `auth.scopes`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project"
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Il nome è `resource:action`, in minuscolo, senza target. Non può riutilizzare una
risorsa integrata: `data`, `storage`, `functions`, `users`, `schema`,
`database`, `backups`, `cron`, `logs` e `keys` sono già in uso. `label` è obbligatorio,
perché è ciò che una persona legge quando concede lo scope. `target` indica cosa
rappresenta un target, così una chiave può possedere `project:deploy:p1`.

Ogni persona autenticata possiede ogni scope dell'app. Come per il piano dati, è il codice
dietro lo scope a decidere se questa persona può agire. Lo scope esiste perché
una chiave possa essere ristretta a quella sola azione. Anche un ruolo può elencare scope dell'app.

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

Una chiave che possiede `project:deploy:p1` passa per `p1` e riceve `403 SCOPE_MISSING`
per qualsiasi altro progetto. Ha anche bisogno di `functions:invoke`, oppure di
`functions:invoke:<name>` per questa funzione, per raggiungere la funzione.
`hasScope(c, scope, target)` e `getScopes(c)` rispondono alla stessa domanda dentro un
handler.

## Cosa significa admin

`admin` è l'unico ruolo integrato, ed è più di un elenco di scope:

- Possiede ogni scope del piano di amministrazione, `keys:*` compresi.
- È un ruolo che il database vede. I criteri predefiniti che Rebase aggiunge a ogni
  collezione lo ammettono, quindi un admin legge e scrive ogni riga di una collezione
  che li mantiene. Una collezione con `disableDefaultPolicies: true` li elimina.
- Solo un admin può concedere `admin`. Un ruolo che elenca ogni scope del piano di amministrazione
  non è comunque `admin`: non può concedere `admin` ad altri, e i criteri predefiniti non
  lo ammettono.

`requireAdmin` verifica il ruolo. Preferisci `requireScope` per tutto ciò che un ruolo
più ristretto o una chiave deve poter fare.

## Nessuno concede più di quanto possiede

Una sola regola copre ogni via che distribuisce accesso: **nulla viene concesso con più
di quanto possiede chi lo concede.**

Per le chiavi:

- Gli scope di una chiave devono rientrare in quelli del suo creatore. Altrimenti `403 SCOPE_EXCEEDS_CREATOR`.
- I ruoli RLS di una chiave di servizio devono essere ruoli che il suo creatore possiede, a meno che il creatore
  non sia un admin. Altrimenti `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` e `keys:write` non vanno mai su una chiave. Una chiave che gestisce le chiavi potrebbe
  creare il proprio successore. `400 KEY_MANAGEMENT_SCOPE`.

Per gli account, chi possiede `users:write`:

- non può modificare, reimpostare o eliminare un account che possiede un ruolo o uno scope che lui non possiede:
  `403 ACCOUNT_OUTRANKS_CALLER`. Senza questa regola, un ruolo di supporto potrebbe reimpostare la
  password di un admin e accedere come lui.
- non può concedere ruoli che possiedono più di quanto possiede lui: `403 ROLE_EXCEEDS_CALLER`.

## Come ogni credenziale possiede gli scope

| Credenziale | Agisce come | Possiede |
|---|---|---|
| La sessione di una persona | la persona | il piano dati, ogni scope dell'app e gli scope dei suoi ruoli. Un admin possiede tutto |
| [Chiave di servizio](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, con i ruoli RLS `service` più i propri `roles` | esattamente i suoi scope |
| [Chiave personale](/docs/backend/api-keys/#personal-keys) `rk_live_…` | il suo proprietario, con i ruoli del proprietario così come sono a ogni richiesta | i suoi scope, ridotti a ciò che il proprietario possiede ora |
| [Token MCP](/docs/ai/mcp/#the-remote-endpoint) | la persona che l'ha collegato | `data:read`, `data:write`, `data:delete` come concessi, eventualmente per collezione |
| `REBASE_SERVICE_KEY` | `service`, con il ruolo `admin` | tutto |

Una chiave o un token non aggira mai la sicurezza a livello di riga. I suoi scope sono un limite,
e i criteri del database per l'identità con cui agisce sono un altro.

## Quando manca uno scope

<span class="since-badge" data-since="0.24">Da 0.24</span> La risposta è `403 SCOPE_MISSING`, e `details.requiredScope` nomina lo scope,
con il suo target quando ce n'è uno:

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Per una persona, la soluzione è un ruolo che elenca lo scope. Per una chiave, è una nuova chiave
che lo possiede.

## Passaggi successivi

- [Chiavi API](/docs/backend/api-keys/): chiavi di servizio, chiavi personali e le regole di creazione
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/): cosa può fare una persona con ogni riga
- [Indice degli endpoint](/docs/backend/endpoints/): lo scope richiesto da ogni route
- [Codici di errore](/docs/backend/errors/#authentication-and-accounts): ogni rifiuto descritto sopra

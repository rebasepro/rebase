---
sourceHash: 22cf5bf2953fb715
title: Regole di sicurezza (RLS)
sidebar_label: Regole di sicurezza
description: Definisci criteri di Row Level Security per le tue collection utilizzando scorciatoie pratiche o espressioni SQL raw.
---

## Panoramica

Le regole di sicurezza ti consentono di definire criteri di **Row Level Security (RLS)** per le tue tabelle PostgreSQL direttamente nelle definizioni delle collection. Quando lo schema Drizzle viene generato, Rebase crea le corrispondenti istruzioni `CREATE POLICY`.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "authorId" }
    ]
});
```

## Come funziona

1. Definisci `securityRules` su una collection
2. `rebase schema generate` crea lo schema Drizzle con RLS abilitato
3. `rebase db push` o `rebase db migrate` applica i criteri a PostgreSQL
4. Ogni query viene filtrata automaticamente in base al contesto dell'utente corrente

L'identità dell'utente autenticato è disponibile in SQL tramite:

| Funzione | Restituisce |
|----------|-------------|
| `rebase.uid()` | L'ID dell'utente corrente |
| `rebase.roles()` | ID dei ruoli applicativi separati da virgola |
| `rebase.jwt()` | Claim completi del JWT in formato JSONB |

Questi valori vengono impostati automaticamente per transazione dal backend di Rebase.

## Scorciatoie pratiche

### Accesso basato sul proprietario

Il pattern più semplice: gli utenti possono accedere solo alle righe di cui sono proprietari:

```typescript
securityRules: [
    { operation: "all", ownerField: "user_id" }
]
```

Questo genera: `USING (user_id = rebase.uid())`

### Accesso pubblico

Consenti a chiunque (inclusi gli utenti non autenticati) la lettura:

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

Questo genera: `USING (true)`

### Accesso autenticato

Consenti l'accesso a qualsiasi utente che ha effettuato l'accesso. Questa è una `condition` piuttosto che una scorciatoia `access` — `access` ha esattamente un solo valore, `"public"` — perché "autenticato" è un test sul chiamante, e il builder è il luogo in cui risiedono i test sul chiamante:

```typescript
import { policy } from "@rebasepro/types";

securityRules: [
    { operation: "select", condition: policy.authenticated() }
]
```

`policy.authenticated()` è vero anche per il *sign-in* anonimo, che genera una riga utente reale e una sessione reale. Usa `policy.registered()` quando un ospite non dovrebbe essere idoneo — scrivere una recensione, unirsi a un'organizzazione, spendere denaro.

### Accesso basato sui ruoli

Limita le operazioni a ruoli specifici:

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

### Accesso relazionale / per appartenenza

Per limitare l'accesso in base all'appartenenza a una collection *correlata* — ad esempio, "solo le righe del team a cui appartiene il chiamante" — usa la `condition` strutturata con `policy.existsIn`. Viene compilata in una singola sottoquery `EXISTS` correlata (senza ricerche riga per riga) ed è l'alternativa sicura e di prima classe alla scrittura manuale di codice SQL raw mostrata di seguito.

```typescript
import { policy } from "@rebasepro/types";

// documents visible only to members of the document's team:
securityRules: [
    {
        operation: "select",
        condition: policy.existsIn({
            collection: "team_members",         // the join / membership collection
            where: policy.and(
                // correlate to the row being checked:
                policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
                // …and to the caller:
                policy.compare(policy.field("user_id"), "eq", policy.authUid()),
            ),
        }),
    },
]
```

All'interno di `where`, `policy.field(...)` fa riferimento a una colonna della collection unita (`team_members`), mentre `policy.outerField(...)` fa riferimento a una colonna della riga in fase di verifica (`documents`). Combinalo con `policy.authUid()` per limitare l'ambito all'utente corrente. Poiché viene applicato dal database, l'interfaccia utente di amministrazione lo considera autoritativo a livello di server.

#### Il builder `policy`, nel dettaglio

Importato da `@rebasepro/types`. Le espressioni si compongono; gli operandi sono le foglie.

| Espressione | Compila in |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` | congiunzione / disgiunzione |
| `policy.not(e)` | negazione |
| `policy.compare(left, op, right)` | un confronto tra due operandi |
| `policy.rolesOverlap(roles)` | il chiamante ha **almeno uno** di questi ruoli applicativi |
| `policy.rolesContain(roles)` | il chiamante ha **tutti** questi ruoli applicativi |
| `policy.authenticated()` | autenticato — `rebase.uid()` è impostato **e non è un valore sentinella anonimo**. `IS NOT NULL` da solo sarebbe una tautologia, poiché una richiesta anonima imposta una sentinella invece di lasciarla vuota |
| `policy.registered()` | autenticato **con un account** — `authenticated()` e non un ospite. Vedi sotto |
| `policy.serverContext()` | `rebase.uid() IS NULL` — vedi l'avviso sotto |
| `policy.existsIn({ collection, where })` | una sottoquery `EXISTS` correlata |
| `policy.raw(sql)` | una via di fuga, inserita letteralmente |

| Operando | Significato |
|---|---|
| `policy.field(name)` | una colonna della collection verificata — oppure, all'interno di `existsIn`, di quella unita |
| `policy.outerField(name)` | all'interno di `existsIn`, una colonna della riga esterna |
| `policy.literal(value)` | una stringa, un numero, un booleano o `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | `rebase.roles()` |

### `authenticated()` e `registered()`

Due concetti differenti vengono definiti anonimi, ed è utile chiarire con precisione a quale dei due si riferisce una regola.

Una richiesta **non autenticata** non include alcuna sessione. Le viene assegnato un ID sentinella in modo che `rebase.uid()` non sia mai `NULL` nel percorso utente, e `policy.authenticated()` la esclude: è questo che la rende equivalente a "ha effettuato l'accesso" piuttosto che a "chiunque".

Un **ospite** (guest) è l'altra cosa: una sessione a cui non corrisponde nessuno. `POST /auth/anonymous` crea una vera riga utente con un vero uid, quindi un ospite supera qualsiasi test che controlla l'ID. Questo è lo scopo della funzionalità — un carrello prima del checkout, una bozza prima della registrazione — e significa che `authenticated()` è true per chiunque abbia premuto *Continua come ospite*, operazione che non richiede alcuna email, password o consenso.

`policy.registered()` equivale a `authenticated()` più "non un ospite". Usalo ovunque una regola riguardi qualcuno che potrebbe essere ritenuto responsabile di qualcosa: scrivere una recensione, unirsi a un'organizzazione, spendere denaro. Usa `authenticated()` quando un ospite è effettivamente benvenuto.

```ts
// Anyone with a session, guests included — a draft cart.
{ operation: "insert", check: policy.authenticated() }

// Someone with an account.
{ operation: "insert", check: policy.registered() }
```

Dietro le quinte, il flag guest viaggia con la sessione — si trova nel token di accesso e arriva al database come `rebase.is_anonymous()` — quindi una policy può effettuare il controllo senza una query di lookup. Un database gestito da un server troppo datato per impostarlo legge ogni sessione come un account, che è il comportamento che quel deployment già possedeva.

:::caution[`serverContext()` non è soddisfatto dal singleton del server]
Compila in `rebase.uid() IS NULL`, e `rebase.dataAsAdmin` viene eseguito come `uid: "service"` — quindi è **false** per l'accessor che la maggior parte delle persone intende per "il server". Una collection con `disableDefaultPolicies: true` la cui unica regola è `serverContext()` rifiuta tali scritture (`42501`) e restituisce zero righe — HTTP 200, vuoto — per tali letture. `rebase.sql()` è l'accessor che bypassa realmente le policy.
:::

## Espressioni SQL raw

Per una logica complessa, usa `using` e `withCheck`:

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

- **`using`** — Filtra quali righe esistenti sono visibili (si applica a SELECT, UPDATE, DELETE)
- **`withCheck`** — Convalida i valori delle nuove righe (si applica a INSERT, UPDATE)

I riferimenti alle colonne usano la sintassi `{column_name}` che viene risolta nel nome di colonna completo qualificato con la tabella.

## Combinare scorciatoie e SQL

Combina le scorciatoie pratiche con SQL raw:

```typescript
securityRules: [
    // Admins can do anything
    { operation: "all", roles: ["admin"], using: "true" },
    // Regular users can only see their own rows
    { operation: "select", ownerField: "user_id" },
    // Users can insert, but only for themselves
    { operation: "insert", withCheck: "{user_id} = rebase.uid()" },
    // Locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permissivo vs Restrittivo

PostgreSQL prevede due modalità di policy:

- **Permissive** (predefinito) — Più policy permissive vengono combinate con **OR**. Se almeno una viene soddisfatta, l'accesso è concesso.
- **Restrictive** — Le policy restrittive vengono combinate con **AND**. Devono essere soddisfatte tutte.

```typescript
securityRules: [
    // Permissive: owners can access their rows
    { operation: "all", ownerField: "user_id" },
    // Restrictive: but locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Operazioni

| Operazione | Equivalente SQL | Descrizione |
|-----------|-----------------|-------------|
| `"select"` | `SELECT` | Legge righe |
| `"insert"` | `INSERT` | Crea nuove righe |
| `"update"` | `UPDATE` | Modifica righe esistenti |
| `"delete"` | `DELETE` | Rimuove righe |
| `"all"` | Tutte le precedenti | Scorciatoia per tutte le operazioni |

Puoi anche usare `operations` (plurale) per applicare una sola regola a più operazioni:

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "authorId" }
```

## Interfaccia SecurityRule completa

`SecurityRule` è una **union**, non un singolo oggetto aperto: una regola sceglie esattamente un modo per esprimere il proprio predicato, e gli altri sono tipizzati come `never`, in modo che combinarli generi un errore di compilazione invece di una policy che ignora silenziosamente metà di ciò che hai scritto.

```typescript no-verify
// Shared by every variant
interface SecurityRuleBase {
    name?: string;                        // Policy name. Omit it and one is derived
    operation?: SecurityOperation;        // "select" | "insert" | "update" | "delete" | "all"
    operations?: SecurityOperation[];     // …or several at once
    mode?: "permissive" | "restrictive";  // Default: "permissive"
    roles?: string[];                     // App roles, via rebase.roles()
    pgRoles?: string[];                   // Native Postgres roles — the CREATE POLICY `TO` clause.
                                          // NOT the same as `roles`. Default: ["public"]
}

// …plus exactly one of:
{ ownerField: string }                        // <column> = rebase.uid()
{ access: "public" }                          // the one shortcut — "no row filter"
{ condition: PolicyExpression;                // the structured builder — `policy.*`
  check?: PolicyExpression }                  // defaults to `condition`, as Postgres does
{ using?: string; withCheck?: string }        // raw SQL
```

`roles` e `pgRoles` sono i due parametri che spesso si confondono. `roles` è un ruolo applicativo, applicato *all'interno* della clausola `USING` / `WITH CHECK` tramite `rebase.roles()`. `pgRoles` è un ruolo del database e controlla a quali connessioni la policy è effettivamente associata. Quasi tutti i progetti necessitano di `roles`.

:::tip[Popolamento della colonna specificata in `ownerField`]
`ownerField` confronta una colonna con `rebase.uid()`; non inserisce nulla al suo interno. Dichiara tale colonna come stringa con [`autoValue: "user_on_create"`](/docs/collections/properties#audit-columns) e il driver vi imprimerà l'uid dell'utente agente al momento dell'inserimento, sovrascrivendo qualsiasi valore inviato nel corpo della richiesta — il che rende vera la premessa della policy. Una colonna fornita direttamente dal chiamante è un dato che il chiamante può falsificare.
:::

## Esempi

### Piattaforma di blog

```typescript
securityRules: [
    // Anyone can read published posts
    { operation: "select", using: "{status} = 'published'" },
    // Authors can see their own drafts
    { operation: "select", ownerField: "authorId" },
    // Authors can create and edit their own posts
    { operations: ["insert", "update"], ownerField: "authorId" },
    // Only admins can delete
    { operation: "delete", roles: ["admin"] }
]
```

### SaaS multi-tenant

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

## Accesso anonimo (inserimenti pubblici)

Un'esigenza comune è consentire agli **utenti non autenticati** di inviare dati: moduli di contatto, iscrizioni alla newsletter, candidature pubbliche. Rebase fornisce un pattern pulito a questo scopo.

### Consigliato: una regola `withCheck` raw

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const contactMessagesCollection = defineCollection({
    slug: "contact_messages",
    name: "Contact Messages",
    table: "contact_messages",
    securityRules: [
        // Anyone can submit a contact message
        {
            operation: "insert",
            // A raw rule carries `using` (which rows are visible) and `withCheck`
            // (what a write must satisfy); an insert only exercises the latter.
            using: "true",
            withCheck: "true"
        },
        // Only admins can read, update, or delete messages
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

La scorciatoia `access: "public"` genera una policy che consente l'operazione senza richiedere l'autenticazione.

### Per acquisizione lead / registrazioni

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const leadSignupsCollection = defineCollection({
    slug: "lead_magnet_signups",
    name: "Lead Magnet Signups",
    table: "lead_magnet_signups",
    securityRules: [
        // Allow anonymous inserts
        { operation: "insert", using: "true", withCheck: "true" },
        // Admins can view all signups
        { operation: "select", roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

### Come funzionano le richieste anonime

Quando arriva una richiesta senza un token JWT, il backend di Rebase imposta le variabili di sessione di PostgreSQL su:

| Variabile | Valore |
|-----------|--------|
| `app.user_id` | `'anonymous'` |
| `app.user_roles` | `''` (vuoto) |

Ciò significa che:

- `rebase.uid()` restituisce `'anonymous'`
- `rebase.roles()` restituisce una stringa vuota
- Le policy `access: "public"` hanno successo perché generano `USING (true)` / `WITH CHECK (true)`
- Le condizioni `policy.authenticated()` falliscono perché verificano la presenza di un ID utente reale
- Le policy `ownerField` falliscono perché nessuna riga avrà `user_id = 'anonymous'` (a meno che non sia impostato esplicitamente)

### Avanzato: SQL raw per richieste anonime

Se hai bisogno di un controllo più granulare, usa SQL raw:

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "rebase.uid() = 'anonymous' OR rebase.uid() IS NOT NULL"
    }
]
```

:::tip
Evita il pattern legacy che verifica `string_to_array(rebase.roles(), ',')` per l'accesso anonimo. La scorciatoia `access: "public"` è più semplice e genera automaticamente la policy corretta.
:::

## Righe qui, campi a fianco

Le regole di sicurezza rispondono a una sola domanda: a **quali righe** ha accesso questo chiamante. Vengono applicate da Postgres stesso, su ogni istruzione, indipendentemente dal percorso: ecco perché rappresentano il modello di autorizzazione principale e tutto ciò che sta sopra di esse è una comodità.

Non hanno voce in capitolo sulle *colonne* di una riga a cui il chiamante ha accesso. Una policy che consente a un dipendente di leggere le righe del proprio team gli consente di leggerne ogni singolo campo, stipendio incluso. È a questo che serve l'[`access`](/docs/collections/field-access/) a livello di singola proprietà:

```typescript
salary: {
    type: "number",
    // Everyone the rules above let read the row; only HR gets this column.
    access: { read: ["hr"], write: [] }
}
```

I due meccanismi si sovrappongono e non entrano mai in contraddizione: una regola di campo non può ampliare l'accesso alle righe, e una riga che non puoi leggere non ha campi di cui parlare. I ruoli sono gli stessi — `rebase.roles()` all'interno di una policy, `user.roles` nella richiesta — quindi `rolesOverlap(['hr'])` in una regola e `access: { read: ["hr"] }` su una proprietà indicano lo stesso `hr`. Le regole sui campi vengono applicate dal server anziché da Postgres, pertanto coprono la superficie delle API; una query eseguita tramite `rebase.sql()` vede ogni colonna, esattamente come bypassa l'RLS.

## Prossimi passi

- **[Accesso ai campi](/docs/collections/field-access)** — Ruoli di lettura/scrittura per singolo campo
- **[Relazioni](/docs/collections/relations)** — Chiavi esterne e join
- **[Callback delle entità](/docs/collections/callbacks)** — Hook del ciclo di vita
- **[Funzioni personalizzate](/docs/backend/custom-functions)** — Endpoint API personalizzati

---
sourceHash: f385a35cc59df9c6
title: Row-level security
sidebar_label: Row-level security
description: "Ogni tabella dichiara la propria postura rls — admin-only, inherit o un elenco di regole — e Rebase la compila in policy di row-level security di Postgres. Formati delle regole, condizioni sintetiche, defaultRls e cosa fallisce in sicurezza."
---

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Ogni tabella stabilisce chi può accedere alle sue righe nella chiave `rls`. Rebase compila questa configurazione nella row-level security di Postgres: `ENABLE ROW LEVEL SECURITY` sulla tabella e una `CREATE POLICY` per ogni regola e operazione. Postgres filtra quindi ogni istruzione, su ogni route — REST, realtime, MCP, il CMS e l'SQL eseguito come chiamante — poiché le regole risiedono nel database, non nel codice dell'applicazione.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        status:   col.enum(["draft", "published"]).notNull().default("draft"),
        authorId: col.uuid().notNull().onCreateUser(),
    },
    rls: [
        // Anyone reads the published posts.
        { operation: "select", access: "public", condition: { status: "published" } },
        // Authors read and edit their own, drafts included.
        { operations: ["select", "insert", "update"], ownerField: "authorId" },
        // Editors may delete.
        { operation: "delete", roles: ["editor"] },
    ],
});
```

`rls` non ha un valore predefinito. Ometterlo genera un errore di tipo, e una tabella che raggiunge il compilatore senza una postura utilizzabile viene rifiutata. Consulta [Cosa fallisce in sicurezza](#cosa-fallisce-in-sicurezza).

:::note[Arrivi da collections?]
`rls` sostituisce `securityRules` ed è obbligatorio. Una regola scritta per `securityRules` è una voce valida di `rls` così com'è. La guida all'aggiornamento per questa release tratta `defaultSecurityRules` e `disableDefaultPolicies`.
:::

## Le tre posture

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

| `rls` | Significato |
|---|---|
| `"admin-only"` | Row-level security attiva e solo le policy di baseline per l'admin: il ruolo `admin` e il codice interno del server possono accedere alle righe. Tutti gli altri chiamanti non ottengono alcuna riga e le loro scritture vengono rifiutate. |
| `"inherit"` | Il `defaultRls` esportato da `backend/schema/index.ts`. Rifiutato se non è presente. |
| un elenco di regole | Le policy da generare, una o più. `[]` viene rifiutato: specifica `"admin-only"` per riservare una tabella solo agli admin. |

`"admin-only"` è la postura con cui iniziare per una tabella quando non hai ancora deciso chi debba vederla. Nulla viene esposto finché non scrivi le regole per esporlo.

### `defaultRls`

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`backend/schema/index.ts` può esportare una postura per le tabelle che specificano `rls: "inherit"`:

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { posts } from "./posts";
export { comments } from "./comments";

export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
    { operations: ["insert", "update", "delete"], roles: ["editor"] },
];
```

`defaultRls` è `"admin-only"` o un elenco non vuoto di regole. Si applica solo alle tabelle che specificano `"inherit"`; una tabella con regole proprie non ne riceve alcuna e i due elenchi non vengono mai uniti. Specificare `rls: "inherit"` senza esportare `defaultRls` interrompe `rebase db generate`, `rebase db push` e l'avvio con un errore che richiede di esportarne uno.

## Policy che una tabella riceve senza scriverle

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Le policy applicate a una tabella vanno oltre le sue sole regole:

- **La baseline per l'admin.** Ogni tabella ottiene le policy `<table>_default_admin_read` e `<table>_default_admin_write` per insert, update e delete. Sono di tipo permissive e consentono l'accesso al contesto del server e al ruolo `admin`, così che gli admin possano leggere e scrivere ogni riga. Le policy permissive vengono combinate con OR, quindi la baseline amplia qualsiasi cosa le tue regole consentano; non le restringe mai.
- **La tabella utenti.** Una tabella dichiarata con [`defineAuthTable`](/docs/schema/auth-table/) riceve anche una policy che consente a un utente autenticato di leggere la propria riga e un filtro restrittivo (restrictive gate) che permette solo a un admin di scrivere le colonne relative ai privilegi (`roles`), indipendentemente da cosa stabiliscano le sue regole.
- **Tenancy.** Una tabella con [`tenant`](/docs/collections/tenancy/) riceve una policy restrittiva che confina ogni operazione al tenant del chiamante.
- **Tabelle di giunzione.** La giunzione di una relazione [`manyToMany`](/docs/collections/relations/#manytomany--through-a-junction) riceve policy proprie.

Impostare `defaultPolicies: false` su una tabella rimuove la baseline permissiva per l'admin e mantiene i vincoli restrittivi, facendo sì che la tabella applichi esattamente le regole che hai scritto. Viene rifiutato insieme ad `"admin-only"`, che rappresenta la baseline e nient'altro: la combinazione lascerebbe una tabella inaccessibile a qualsiasi chiamante, admin inclusi.

Il DDL generato contrassegna ogni policy inserita e `rebase db push` ripristina quelle eventualmente rimosse manualmente.

## Formati delle regole

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Una regola assume uno dei seguenti formati. Combinarne due in una singola regola è un errore di tipo ed è rifiutato anche dal compilatore, consentendo di intercettare problemi in JavaScript e nei cast: `access` accanto a `ownerField`, `using` o `withCheck`; `ownerField` accanto a `using`, `withCheck`, `condition` o `check`; `condition` o `check` accanto a `using` o `withCheck`. Lo stesso vale per un valore non valido per `access`, `mode`, `operation(s)` o `roles` (un errore di battitura come `"restrictive"` errato viene rifiutato, non interpretato come permissivo). Una regola non diventa mai una policy che ignora silenziosamente metà di ciò che è stato scritto.

| Formato | Esempio | `USING` (quali righe) | `WITH CHECK` (cosa può essere scritto) |
|---|---|---|---|
| Owner | `{ ownerField: "authorId" }` | la colonna corrisponde all'id del chiamante | lo stesso |
| Pubblico | `{ access: "public" }` | ogni riga | ogni riga |
| Autenticato | `{ access: "authenticated" }` | ogni riga, per un chiamante autenticato | lo stesso |
| Autenticato con account | `{ access: "registered" }` | ogni riga, per un chiamante autenticato che non sia un guest | lo stesso |
| Accesso con condizione | `{ access: "public", condition: { status: "published" } }` | la condizione (e autenticato, per `"authenticated"` e `"registered"`) | `check`, altrimenti la condizione, vincolata allo stesso modo |
| Accesso con check | `{ access: "authenticated", check: { state: "open" } }` | solo il controllo di accesso | il check, vincolato dal controllo di accesso |
| Strutturato | `{ condition: policy.rolesOverlap(["moderator"]) }` | la condizione | `check`, altrimenti la condizione |
| SQL grezzo | `{ using: "{published_at} > now() - interval '30 days'" }` | l'SQL | `withCheck`, altrimenti `using` |
| Solo check grezzo | `{ operation: "insert", withCheck: "{owner_id} = rebase.uid()" }` | nessuna riga | l'SQL |
| Solo ruoli | `{ operation: "delete", roles: ["admin"] }` | ogni riga, per i ruoli | lo stesso |

Ogni formato accetta inoltre le chiavi condivise:

| Chiave | Predefinito | Cosa fa |
|---|---|---|
| `operation` | `"all"` | `"select"`, `"insert"`, `"update"`, `"delete"` o `"all"`. |
| `operations` | | Diverse operazioni contemporaneamente; viene generata una policy per ciascuna operazione. Ha la precedenza su `operation`. |
| `roles` | | Ruoli dell'applicazione; la regola si applica solo a un chiamante che possiede uno di essi. Combinato con AND rispetto al resto della regola. |
| `mode` | `"permissive"` | `"restrictive"` rende la regola un filtro aggiuntivo che deve anch'esso passare. Consulta [Permissive e restrictive](#permissive-e-restrictive). |
| `name` | derivato | Il nome della policy. In sua assenza, il nome viene ricavato dalla tabella, dall'operazione e da un hash della regola, pertanto la modifica di una regola comporterà la ridenominazione della relativa policy. |
| `pgRoles` | `["public"]` | Ruoli nativi di Postgres: la clausola `TO` di `CREATE POLICY`. Diverso da `roles`. |

I `roles` sono ruoli applicativi di Rebase, archiviati nella colonna `roles` della tabella utenti e letti all'interno di una policy tramite `rebase.roles()`. Non sono ruoli di Postgres: nomi come `anon` o `authenticated` appartengono a `pgRoles`, e inseriti in `roles` producono una condizione che nessun utente soddisfa. Quasi tutti i progetti necessitano di `roles`.

:::note[Regole migrate dalla versione 0.30]
Il compilatore della versione 0.30 leggeva solo una clausola di una regola e non riconosceva alcun valore di `access` oltre a `"public"`, pertanto quattro formati ora concedono autorizzazioni differenti: un semplice `access: "authenticated"` non concedeva nulla, mentre ora ammette qualsiasi chiamante autenticato. `rebase migrate collections-to-tables` elenca ciascuno di essi sotto "Review before deploying"; consulta [la guida all'aggiornamento](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning).
:::

### Owner

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const notes = defineTable("notes", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        ownerId: col.uuid().notNull().onCreateUser(),
        body:    col.text(),
    },
    rls: [{ operation: "all", ownerField: "ownerId" }],
});
```

Questo genera `USING ((owner_id)::text = (SELECT rebase.uid()))`.
`ownerField` indica il nome di una chiave di colonna, una colonna SQL o una relazione `belongsTo` (la relativa colonna di chiave esterna). Confronta la colonna con l'id del chiamante; non la compila. `.onCreateUser()` fa sì che il server scriva l'id del chiamante al momento della creazione, indipendentemente da cosa sia stato inviato nella richiesta, conferendo reale efficacia al confronto.

### Accesso pubblico

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`{ operation: "select", access: "public" }` genera `USING (true)`: nessun filtro sulle righe in lettura, quindi qualsiasi chiamante ammesso dalle API può leggere tutte le righe.

Amplia le righe che un chiamante può visualizzare, non chi può effettuare la chiamata. Per impostazione predefinita, le API rispondono comunque con 401 a una richiesta senza token. Imposta `AUTH_REQUIRE=false` (`auth.requireAuth: false`) per rimuovere tale blocco e lasciare che siano unicamente le policy a decidere; in tal caso, anche un chiamante non autenticato potrà leggere queste righe.

`{ access: "authenticated" }` è analogo, ma con una verifica di autenticazione: il chiamante deve avere una sessione. Un guest creato tramite accesso anonimo ne possiede una. `{ access: "registered" }` esclude anche i guest; è preferibile nei progetti che consentono l'accesso anonimo. Entrambi si combinano con `condition` e `check` allo stesso modo di `"public"`. Consulta [`authenticated()` e `registered()`](#authenticated-e-registered).

### Condizioni

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Una `condition` definisce a quali righe esistenti si applica una regola; un `check` stabilisce quali valori nuovi o aggiornati siano consentiti e assume come valore predefinito la condizione. Entrambi accettano il formato sintetico ad oggetto (shorthand) o un'espressione strutturata.

La forma **shorthand** è un semplice oggetto composto da chiavi di colonna e valori letterali. Risulta verificata quando ogni colonna è uguale al rispettivo valore, e un valore `null` equivale a `IS NULL`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const reports = defineTable("reports", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        state:     col.enum(["open", "closed"]).notNull().default("open"),
        public:    col.boolean().notNull().default(false),
        deletedAt: col.timestamp({ withTimezone: true }),
    },
    rls: [
        // Anyone reads public reports that are not deleted.
        { operation: "select", access: "public", condition: { public: true, deletedAt: null } },
        // Signed-in callers may file a report, but only as an open one.
        { operation: "insert", access: "authenticated", check: { state: "open" } },
    ],
});
```

La forma shorthand richiede almeno una chiave, e nessuna chiave può essere chiamata `kind` (poiché è così che viene riconosciuta un'espressione strutturata; per confrontare una colonna denominata `kind`, utilizza la forma estesa). Le sue chiavi vengono verificate rispetto alla tabella durante la compilazione dello schema: una chiave che non corrisponde ad alcuna colonna viene rifiutata, indicando la tabella e la chiave nel messaggio di errore.

Una condizione **strutturata** viene creata con `policy`, importato da `@rebasepro/types`. Viene compilata in SQL per il database e valutata in JavaScript dal CMS, in modo che il CMS non proponga mai un'azione che il database rifiuterebbe:

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { policy } from "@rebasepro/types";

export const documents = defineTable("documents", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        teamId: col.uuid().notNull(),
        userId: col.uuid().notNull(),
    },
    rls: [
        // The owner, or anyone holding `moderator`.
        {
            operation: "update",
            condition: policy.or(
                policy.compare(policy.field("userId"), "eq", policy.authUid()),
                policy.rolesOverlap(["moderator"])
            ),
        },
        // Members of the document's team read it.
        {
            operation: "select",
            condition: policy.existsIn({
                table: "team_members",
                where: policy.and(
                    policy.compare(policy.field("team_id"), "eq", policy.outerField("teamId")),
                    policy.compare(policy.field("user_id"), "eq", policy.authUid())
                ),
            }),
        },
    ],
});
```

All'interno di `existsIn`, `policy.field()` fa riferimento a una colonna dell'altra tabella e `policy.outerField()` a una colonna della riga in fase di verifica. Viene compilato in una sottoquery correlata `EXISTS`.

| Espressione | Viene compilata in |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` / `policy.not(e)` | congiunzione, disgiunzione, negazione |
| `policy.compare(left, op, right)` | un confronto; `op` è `"eq"`, `"neq"`, `"lt"`, `"lte"`, `"gt"` o `"gte"` |
| `policy.rolesOverlap(roles)` | il chiamante possiede **almeno uno** di questi ruoli |
| `policy.rolesContain(roles)` | il chiamante possiede **tutti** questi ruoli |
| `policy.authenticated()` | un chiamante autenticato |
| `policy.registered()` | un chiamante autenticato con un account, non un guest |
| `policy.serverContext()` | `rebase.uid() IS NULL`; vedi l'avvertenza sotto |
| `policy.existsIn({ table, where })` | una `EXISTS` correlata su un'altra tabella; se priva di `table`, viene rifiutata alla compilazione dello schema |
| `policy.raw(sql)` | l'SQL, inserito esattamente come scritto |

| Operando | Significato |
|---|---|
| `policy.field(name)` | una colonna della riga in fase di verifica o, all'interno di `existsIn`, dell'altra tabella |
| `policy.outerField(name)` | all'interno di `existsIn`, una colonna della riga in fase di verifica |
| `policy.literal(value)` | una stringa, numero, booleano o `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | i ruoli del chiamante sotto forma di array |
| `policy.authClaim(name)` | un custom claim sul token di sessione, convertito nel tipo della colonna con cui viene confrontato |

`existsIn`, `raw` e `authClaim` sono valutati unicamente dal database; il CMS li tratta come sconosciuti e riflette quanto segnalato dal server.

### SQL grezzo

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`using` e `withCheck` accettano codice SQL. `{column}` fa riferimento alla colonna della tabella, mentre il chiamante è disponibile come `rebase.uid()`, `rebase.roles()` (ruoli separati da virgola) e `rebase.jwt()` (i claim del token in formato `jsonb`):

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        orgId:    col.uuid().notNull(),
        isLocked: col.boolean().notNull().default(false),
    },
    rls: [
        {
            operation: "select",
            using: "EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = {org_id} AND m.user_id = rebase.uid())",
        },
        { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" },
    ],
});
```

L'SQL grezzo viene applicato esclusivamente da Postgres: il CMS non è in grado di valutarlo. È consigliabile preferire una condizione shorthand o strutturata ovunque consenta di ottenere lo stesso risultato.

## Valutazione una volta per istruzione

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Ogni elemento di una regola che non legge la riga — l'id del chiamante, un controllo sui ruoli, un claim, `serverContext()` — viene compilato all'interno di una sottoquery scalare. Una regola owner diventa `(user_id)::text = (SELECT rebase.uid())`. Postgres calcola questa sottoquery una sola volta per istruzione anziché una volta per riga, pianificando l'esecuzione come se il controllo superasse la metà della tabella invece dell'1,5%, garantendo che le pagine profonde di tabelle di grandi dimensioni continuino a utilizzare i relativi indici. Chi può leggere o scrivere cosa rimane invariato.

L'SQL grezzo riceve lo stesso trattamento quando Rebase è in grado di analizzarne la struttura (come accade per `owner_id = rebase.uid()`). Qualsiasi altra espressione viene inserita così come scritta; è quindi opportuno incapsulare autonomamente le chiamate: `(SELECT rebase.uid())`.

## `authenticated()` e `registered()`

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

A una richiesta completamente priva di sessione viene assegnato un id sentinella, pertanto `rebase.uid()` non è mai `NULL` durante una richiesta, e `policy.authenticated()` (così come `access: "authenticated"`) la esclude.

Un utente **guest** è differente: `POST /auth/anonymous` crea una vera riga utente con una sessione reale, quindi un guest supera ogni controllo basato sull'id. `policy.registered()` (e `access: "registered"`) corrisponde ad `authenticated()` combinato con "non un guest". Usalo ovunque una regola riguardi un'azione di cui l'utente possa essere ritenuto responsabile — scrivere una recensione, entrare in un'organizzazione, effettuare pagamenti — e `authenticated()` dove un guest è ammesso: un carrello prima del checkout, una bozza prima della registrazione.

:::caution[`serverContext()` non è soddisfatto da `dataAsAdmin`]
Viene compilato in `rebase.uid() IS NULL`, vero solo per i flussi integrati eseguiti senza alcun utente (registrazione, migrazioni). `rebase.dataAsAdmin` viene eseguito con `uid: "service"` e il ruolo `admin`, risultando pertanto **false** in quel contesto. Una tabella con `defaultPolicies: false` la cui unica regola è `serverContext()` rifiuterà tali scritture e non restituirà alcuna riga a tali letture. `rebase.sql()` è l'accessor che ignora le policy.
:::

## Permissive e restrictive

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Le regole permissive (impostazione predefinita) sono valutate in OR: una riga è accessibile quando una qualsiasi di esse la ammette. Le regole restrittive (restrictive) sono valutate in AND con esse: ogni regola restrittiva deve necessariamente essere soddisfatta. Una regola permissiva amplia l'accesso; una restrittiva può solo limitarlo. La tenancy è una regola restrittiva per questo motivo: una regola `access: "public"` presente altrove sulla tabella non può scavalcare il confine del tenant.

## Cosa fallisce in sicurezza

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Una tabella non può diventare accessibile per errore:

- **Nell'editor**, `rls` è obbligatorio e `[]` non è un valore valido.
- **Al caricamento del modulo**, `defineTable` genera un'eccezione se `rls` è mancante, vuoto o diverso da una delle tre posture, intercettando così anche problematiche in JavaScript e nei cast.
- **Alla compilazione dello schema** — `rebase db generate`, `rebase db push`, `rebase doctor` e all'avvio del server — lo schema viene rifiutato in caso di `"inherit"` senza un `defaultRls`, `"admin-only"` con `defaultPolicies: false`, o una regola che fa riferimento a una colonna non presente nella tabella (in `ownerField`, in una chiave shorthand o in `policy.field()`). Un errore di battitura in una regola finirebbe altrimenti per raggiungere `CREATE POLICY` e fallire in quel punto, su una tabella con row-level security già abilitata, lasciandola inaccessibile a chiunque.
- **Senza uno schema**, quando il backend legge le tabelle dal database, una tabella priva di `ENABLE ROW LEVEL SECURITY` non viene servita. All'avvio ne viene indicato il nome, insieme all'istruzione `ALTER TABLE … ENABLE ROW LEVEL SECURITY` necessaria a proteggerla. Consulta [Solo backend](/docs/getting-started/headless/).

Ogni richiesta esegue le proprie istruzioni con un ruolo del database a cui si applica la row-level security, all'interno di una transazione che include l'id, i ruoli e i claim del chiamante. È questo ciò che leggono `rebase.uid()`, `rebase.roles()` e `rebase.jwt()`.

## Richieste senza sessione

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Una richiesta senza token raggiunge le policy solo se `AUTH_REQUIRE=false`; in caso contrario, le API rispondono preventivamente con 401. Viene quindi eseguita con `rebase.uid()` impostato su `'anonymous'` e nessun ruolo: le regole `access: "public"` la ammettono, mentre le regole `access: "authenticated"` e owner la respingono.

Un modulo di contatto accetta inserimenti da chiunque e può essere letto solo dagli admin:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contactMessages = defineTable("contact_messages", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        email:   col.text().notNull().validate({ email: true }),
        message: col.text().notNull().validate({ max: 5000 }),
    },
    rls: [
        { operation: "insert", access: "public" },
        { operations: ["select", "update", "delete"], roles: ["admin"] },
    ],
});
```

## Righe qui, colonne accanto

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`rls` decide a quali righe può accedere un chiamante. Non ha invece alcun effetto sulle colonne delle righe a cui si ha accesso: una regola che consente a un dipendente di leggere le righe del proprio team gli permette di leggerne tutte le colonne, stipendio incluso. Le regole a livello di singola colonna si definiscono con [`.access()`](/docs/collections/field-access/) sulla colonna:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name:   col.text().notNull(),
        // Everyone the rules let read the row; only HR receives this column.
        salary: col.numeric({ precision: 10, scale: 2 }).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

I ruoli sono i medesimi: `policy.rolesOverlap(["hr"])` in una regola e `.access({ read: ["hr"] })` su una colonna fanno riferimento allo stesso `hr`. Le regole sulle colonne vengono applicate dal server, quindi coprono ogni route delle API; una query eseguita tramite `rebase.sql()` vede tutte le colonne, poiché scavalca la row-level security.

## Prossimi passi

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

- [Accesso ai campi](/docs/collections/field-access/): ruoli di lettura e scrittura per colonna
- [Tenancy](/docs/collections/tenancy/): un confine restrittivo per tenant
- [Ruoli e ambiti](/docs/backend/roles-and-scopes/): da dove provengono i ruoli
- [La tabella utenti](/docs/schema/auth-table/): le policy aggiunte da `defineAuthTable`

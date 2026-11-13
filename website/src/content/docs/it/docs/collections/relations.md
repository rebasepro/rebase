---
sourceHash: e0fcc045382336df
title: Relazioni
sidebar_label: Relazioni
description: "Collega le tabelle con rel.belongsTo, hasOne, hasMany, manyToMany e via: chiavi esterne associate o derivate, tabelle di giunzione con colonne _pivot, regole di eliminazione, regole di denominazione e join multi-hop."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Le `relations` di una tabella definiscono i collegamenti che essa ha con altre tabelle. Ognuna è una chiamata a `rel.*` e la sua chiave è il nome della relazione: ciò che `include` richiede, ciò che un percorso annidato come `/api/data/users/1/posts` legge e ciò che un'operazione di scrittura specifica per impostare il collegamento.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { tags } from "./tags";

export const posts = defineTable("posts", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true, onDelete: "restrict" }),
        tags:   rel.manyToMany(() => tags, { pivot: { sortOrder: col.integer().default(0) } }),
    },
    rls: "admin-only",
});
```

La destinazione è un thunk, `() => users`, in modo che due tabelle possano puntare l'una all'altra indipendentemente dall'ordine in cui vengono caricati i loro moduli. Nessuna delle due richiede un'annotazione di tipo: ciò che il thunk restituisce viene verificato durante la compilazione dello schema, e una relazione la cui destinazione non sia una tabella o una vista dello schema viene rifiutata in tale fase.

:::note[Provieni dalle collections?]
Le relazioni non sono più proprietà. La colonna di chiave esterna di un `belongsTo` viene derivata dalla relazione oppure associata a una colonna dichiarata dall'utente. La guida all'aggiornamento per questa release mostra la mappatura.
:::

## I cinque tipi

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Tipo | La chiave risiede | Restituisce | Opzioni |
|---|---|---|---|
| `rel.belongsTo` | su **questa** tabella | una riga | `localKey`, `notNull`, `unique`, `onDelete`, `onUpdate`, `index`, `constraint` |
| `rel.hasOne` | sulla tabella di **destinazione**, univoca | una riga | `foreignKey`, `sourceKey` |
| `rel.hasMany` | sulla tabella di **destinazione** | più righe | `foreignKey`, `sourceKey`, `orderBy` |
| `rel.manyToMany` | in una **tabella di giunzione** | più righe | `through`, `sourceKey`, `targetKey`, `pivot`, `onDelete` |
| `rel.via` | dove specificato da `steps` | una o più | `steps` (obbligatorio), `cardinality` |

Ogni opzione è facoltativa, tranne `steps` su `rel.via`. Il resto viene derivato in base alle regole descritte in [Nomi](#nomi).

Ogni tipo accetta inoltre `access` e `private`, che stabiliscono chi può ricevere le righe della relazione, esattamente come avviene per una colonna:

- `access: { read?, write? }` elenca i ruoli autorizzati a includere o filtrare in base alla relazione e i ruoli che possono impostare il collegamento. L'omissione di un elenco delega tale direzione alla riga; un elenco vuoto la preclude del tutto.
- `private: true` mantiene la relazione esclusivamente sul server: non sarà presente nelle API, nell'SDK o in OpenAPI.

Consulta [Field access](/docs/collections/field-access/) per scoprire cosa visualizza un chiamante privo di accesso.

## belongsTo — la chiave risiede su questa tabella

<span class="since-badge" data-since="0.31">Da 0.31</span>

`belongsTo` posiziona la chiave esterna sulla tabella dichiarante. La colonna SQL della chiave corrisponde a `localKey`, oppure a `<nome della relazione al singolare>_id` se omessa: `author` diventa `author_id`.

La relazione si **associa** a una colonna dichiarata oppure ne **deriva** una:

- **Associata (Bound).** Quando `columns` include una colonna il cui nome SQL corrisponde a `localKey`, la relazione la utilizza. Il suo tipo deve coincidere con quello della chiave di destinazione e i suoi modificatori (`.notNull()`, `.unique()`) definiscono le caratteristiche del collegamento.
- **Derivata (Derived).** In caso contrario, la relazione aggiunge la colonna dopo quelle dichiarate, con il tipo della chiave di destinazione. La sua chiave di trasmissione (wire key) corrisponde al camelCase della colonna: `author_id` viene esposto come `authorId`. `notNull: true` e `unique: true` specificati sulla relazione si applicano a questa colonna derivata.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

// Derived: an `author_id` column, served as `authorId`.
export const notes = defineTable("notes", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: { author: rel.belongsTo(() => users, { notNull: true }) },
    rls: "admin-only",
});

// Bound: `authorId` is the column `author_id`, so the relation uses it.
export const drafts = defineTable("drafts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        authorId: col.uuid().notNull(),
    },
    relations: { author: rel.belongsTo(() => users) },
    rls: "admin-only",
});
```

L'associazione mantiene visibile ogni colonna fisica all'interno di `columns`, nella posizione desiderata. La derivazione è più concisa. Entrambe producono la medesima tabella.

Una relazione e una colonna non possono condividere la stessa chiave: la chiave della relazione corrisponde a ciò che viene richiesto da `include`, quindi la colonna di chiave esterna necessita di una chiave propria (`authorId`, non `author`). Due relazioni non possono utilizzare la stessa colonna.

| Opzione | Valore predefinito | Funzione |
|---|---|---|
| `localKey` | `<nome al singolare>_id` | La colonna SQL che contiene la chiave. |
| `notNull` | `false` | La colonna derivata è `NOT NULL`. Su una colonna associata, applicare invece `.notNull()` direttamente alla colonna. |
| `unique` | `false` | La colonna derivata è `UNIQUE`, rendendo la relazione uno-a-uno. Su una colonna associata, applicare `.unique()`. |
| `onDelete` | `restrict` quando la colonna è `NOT NULL`, altrimenti `set null` | Cosa accade a questa riga quando la riga di destinazione viene eliminata. Consulta [Regole di eliminazione e aggiornamento](#regole-di-eliminazione-e-aggiornamento). |
| `onUpdate` | nessuno (Postgres applica `NO ACTION`) | Cosa accade quando la chiave di destinazione cambia. |
| `index` | `true` | `false` omette l'indice sulla colonna della chiave esterna. |
| `constraint` | `true` | `false` memorizza la chiave senza un vincolo di `FOREIGN KEY`. |

La colonna della chiave esterna viene indicizzata a meno che non si imposti `index: false`: Postgres indicizza la chiave a cui punta una foreign key, mai la colonna che la contiene; pertanto, senza un indice, ogni lettura dal lato opposto comporterebbe una scansione completa di questa tabella. Consulta [Foreign keys are indexed for you](/docs/backend/indexes#foreign-keys-are-indexed-for-you).

## hasOne e hasMany — la chiave risiede sulla destinazione

<span class="since-badge" data-since="0.31">Da 0.31</span>

`hasMany` legge le righe della destinazione che puntano a questa riga. `hasOne` rappresenta lo stesso tipo di collegamento, ma con al massimo una riga sul lato opposto. Nessuno dei due aggiunge una colonna qui: è la destinazione a dichiarare il `belongsTo` che ospita la chiave.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { posts } from "./posts";
import { profiles } from "./profiles";

export const authors = defineTable("authors", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    relations: {
        // reads posts.author_id
        posts:   rel.hasMany(() => posts, { foreignKey: "author_id" }),
        // reads profiles.author_id, which is unique
        profile: rel.hasOne(() => profiles, { foreignKey: "author_id" }),
    },
    rls: "admin-only",
});
```

`foreignKey` indica la colonna SQL sulla destinazione e il suo valore predefinito è `<slug di questa tabella al singolare>_id`: su `authors`, è `author_id`.

`hasMany` accetta un parametro `orderBy`: l'ordinamento con cui vengono restituite le righe correlate quando il chiamante non ne specifica alcuno. Può essere una singola chiave di ordinamento o più chiavi, ciascuna nella forma `[column, "asc" | "desc", nulls?]`, che specificano le colonne della destinazione:

```ts
posts: rel.hasMany(() => posts, { foreignKey: "author_id", orderBy: [["published_at", "desc"]] }),
```

L'ordinamento dichiarato si applica a un'inclusione (`include`), alla lettura di una relazione con genitore singolo e a un elenco annidato (`/api/data/authors/1/posts`) ogni volta che il chiamante non specifica un ordine. Un eventuale `orderBy` specificato dal chiamante lo sostituisce anziché estenderlo. La chiave della destinazione in ordine crescente conclude sempre l'ordinamento, garantendo così pagine stabili. Un `limit` di inclusione per genitore mantiene le prime righe di tale ordinamento e un elenco annidato lo pagina tramite offset o cursore.

### Join su una chiave naturale

<span class="since-badge" data-since="0.31">Da 0.31</span>

Per impostazione predefinita, la chiave della destinazione contiene la chiave primaria di questa riga. Quando i due lati sono collegati tramite un altro valore (un identificatore di identità esterno, uno SKU), `sourceKey` specifica la colonna presente su questa tabella:

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { applications } from "./applications";

export const talents = defineTable("talents", {
    columns: {
        id:         col.uuid().primaryKey().defaultRandom(),
        authUserId: col.text().notNull().unique(),
    },
    relations: {
        // applications.auth_user_id = talents.auth_user_id
        applications: rel.hasMany(() => applications, { sourceKey: "auth_user_id", foreignKey: "auth_user_id" }),
    },
    rls: "admin-only",
});
```

La colonna `sourceKey` deve essere univoca: un collegamento che indirizza più righe di origine non potrebbe determinare a quale di esse appartenga una riga correlata. Una riga con `sourceKey` impostata su `NULL` non raggiunge alcuna riga correlata e tentare una scrittura tramite la relazione genera un errore.

## manyToMany — tramite una giunzione

<span class="since-badge" data-since="0.31">Da 0.31</span>

`manyToMany` collega le righe tramite una tabella di giunzione creata da Rebase, dotata di una propria row-level security. La rimozione di un collegamento elimina la riga di giunzione, mai la destinazione.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const projects = defineTable("projects", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    relations: {
        members: rel.manyToMany(() => users, {
            through: "project_members",
            pivot: {
                role:    col.enum(["owner", "editor", "viewer"]).notNull().default("viewer"),
                addedAt: col.timestamp({ withTimezone: true }).onCreateNow(),
            },
        }),
    },
    rls: "admin-only",
});
```

| Opzione | Valore predefinito | Funzione |
|---|---|---|
| `through` | i due nomi delle tabelle SQL, ordinati alfabeticamente e uniti da `_` | La tabella di giunzione. Si trova sempre nello schema `public`. |
| `sourceKey` | `<slug di questa tabella al singolare>_id` | La colonna di giunzione che punta a questa tabella. |
| `targetKey` | `<nome della relazione al singolare>_id` | La colonna di giunzione che punta alla destinazione. |
| `pivot` | nessuno | Colonne aggiuntive sulla giunzione, create con `col.*`. |
| `onDelete` | `cascade` | Cosa accade a un collegamento quando una delle due righe viene eliminata. |

Entrambi i lati di uno stesso collegamento possono dichiararlo, ciascuno dal proprio punto di vista: `sourceKey` indica sempre la colonna della tabella dichiarante. Due relazioni che fanno riferimento alla stessa tabella di giunzione ma con colonne chiave differenti vengono rifiutate.

La destinazione può essere la tabella stessa (ad esempio, tracce simili ad altre tracce). Le sue due colonne di giunzione avrebbero entrambe come valore predefinito `track_id`, pertanto è necessario distinguere quella di destinazione con `targetKey`; un auto-collegamento (self-link) le cui due colonne si risolvono nello stesso nome viene rifiutato durante la compilazione dello schema:

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";

export const tracks = defineTable("tracks", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text().notNull() },
    relations: {
        similar: rel.manyToMany(() => tracks, {
            through: "tracks_similar",
            targetKey: "similar_track_id",
        }),
    },
    rls: "admin-only",
});
```

La destinazione può essere anche una vista (`defineView`): `db push`, l'avvio e `schema generate` creano la tabella di giunzione per essa, e `rebase doctor` conteggia tale giunzione come gestita. Una vista non dichiara alcun `manyToMany` proprio.

### `_pivot`: le colonne proprie della giunzione

<span class="since-badge" data-since="0.31">Da 0.31</span>

Le colonne `pivot` vengono lette e scritte sotto la chiave `_pivot`. Una lettura che include la relazione restituisce ogni riga correlata corredata delle colonne del proprio collegamento:

```json
{ "id": "p1", "name": "Website", "members": [
    { "id": "u7", "email": "ada@example.com", "_pivot": { "role": "owner", "addedAt": "2026-11-02T09:14:00Z" } }
] }
```

Un'operazione di scrittura imposta i collegamenti sotto forma di elenco, e un elemento può contenere il `_pivot` che il collegamento deve assumere:

```json
{ "members": [{ "id": "u7", "_pivot": { "role": "owner" } }, "u9"] }
```

Le colonne pivot accettano qualsiasi modificatore di colonna tranne `.primaryKey()`: la chiave della tabella di giunzione è costituita dalle sue due colonne di collegamento.

### `_count`: conteggio delle righe correlate

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un'inclusione di una relazione to-many (`hasMany`, `manyToMany`, un `via` di tipo to-many) può richiedere il totale unitamente a una pagina limitata di righe, restituito sotto la chiave `_count` della riga. Il conteggio viene effettuato nella stessa istruzione, applicando gli stessi filtri e la stessa row-level security. Consulta [Counting what a limit leaves out](/docs/sdk/relations#counting-what-a-limit-leaves-out).

## via — una catena esplicita di join

<span class="since-badge" data-since="0.31">Da 0.31</span>

`via` effettua la lettura attraverso join definiti esplicitamente: salti multipli (hop), chiavi composite o condizioni che non corrispondono a una semplice chiave esterna.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { permissions } from "./permissions";

export const members = defineTable("members", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: {
        permissions: rel.via(() => permissions, {
            steps: [
                { table: "member_roles",     on: { from: "id",            to: "member_id" } },
                { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
                { table: "permissions",      on: { from: "permission_id", to: "id" } },
            ],
        }),
    },
    rls: "admin-only",
});
```

Ogni passaggio unisce `table`, con `from` che indica una colonna della tabella precedente (questa tabella, per il primo passaggio) e `to` una colonna di `table`. Un elenco di colonne su entrambi i lati effettua la join su una chiave composita: `on: { from: ["company_code", "region_id"], to: ["code", "region_id"] }`. Un elenco di condizioni all'interno di `on` unisce una riga che soddisfa una qualsiasi di esse ed è di sola lettura.

`cardinality` è `"many"` a meno che non si specifichi `"one"`. È possibile eseguire scritture attraverso due tipi di catena, nello stesso modo in cui si scrive per il tipo che sostituiscono:

- una catena **to-one** di **un solo passaggio**: la riga di destinazione contiene la chiave, come con `hasOne`;
- una catena **to-many** di **due passaggi attraverso una tabella** intermedia tra gli estremi: tale tabella contiene i collegamenti, come con `manyToMany` (senza `_pivot`).

Tutte le altre catene sono di sola lettura. Un'operazione di creazione o aggiornamento che le specifichi viene rifiutata con `400 RELATION_NOT_WRITABLE`, così come qualsiasi operazione di scrittura annidata tramite `via`.

Una catena può passare attraverso una tabella già presente nella lettura — un `via` da una tabella a se stessa, oppure nipoti raggiunti passando due volte per la stessa tabella: ogni passaggio viene unito con un proprio alias. I filtri sulle relazioni o l'ordinamento in base a un conteggio di elementi correlati non supportano `via` e generano un messaggio esplicito.

## Regole di eliminazione e aggiornamento

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Azione | Comportamento |
|---|---|
| `"cascade"` | Elimina o aggiorna anche le righe correlate |
| `"restrict"` | Rifiuta l'eliminazione finché esistono righe correlate |
| `"no action"` | Come `restrict`, ma verificato al termine dell'istruzione |
| `"set null"` | Svuota la colonna della chiave esterna impostandola a `NULL` |
| `"set default"` | Imposta la colonna della chiave esterna sul suo valore predefinito |

Quando `onDelete` non è impostato, un `belongsTo` nullable azzera il puntatore (`set null`), uno `NOT NULL` rifiuta l'eliminazione (`restrict`), e un collegamento `manyToMany` viene eliminato insieme a una qualsiasi delle due righe (`cascade`). `NOT NULL` indica che una riga non può esistere senza il rispettivo genitore; non implica che l'eliminazione del genitore debba eliminare la riga. Specifica `"cascade"` se questo è l'effetto desiderato: è l'unico valore che rimuove righe non espressamente indicate.

## Nomi

<span class="since-badge" data-since="0.31">Da 0.31</span>

Qualsiasi nome utilizzato da una relazione viene derivato qualora non venga specificato esplicitamente. Le regole corrispondono a quelle già presenti in un database distribuito, pertanto non variano tra le release.

| Nome | Regola | `posts` con relazione `author` → `users` |
|---|---|---|
| Colonna `belongsTo` | `localKey`, altrimenti `<nome della relazione al singolare>_id` | `author_id` |
| Chiave di trasmissione (wire key) `belongsTo` | il camelCase della colonna | `authorId` |
| Colonna `hasOne` / `hasMany` sulla destinazione | `foreignKey`, altrimenti `<slug di questa tabella al singolare>_id` | `post_id` sulla destinazione |
| Tabella di giunzione | `through`, altrimenti entrambi i nomi delle tabelle SQL ordinati e uniti da `_` | `posts_tags` per `posts` ↔ `tags` |
| Colonna di giunzione verso questa tabella | `sourceKey`, altrimenti `<slug di questa tabella al singolare>_id` | `post_id` |
| Colonna di giunzione verso la destinazione | `targetKey`, altrimenti `<nome della relazione al singolare>_id` | `tag_id` per la relazione `tags` |

Una chiave esterna derivata eredita il tipo della chiave a cui punta. Una chiave di tipo `serial` viene referenziata da un semplice `integer` della medesima dimensione, e una chiave di tipo enum dal rispettivo tipo enum.

Il nome di una relazione `belongsTo` rappresenta la sua colonna di chiave esterna ovunque una tabella specifichi una colonna: in `indexes`, in `tenant` e nell'`ownerField` o nella condizione di una regola.

## Lettura e scrittura delle relazioni

<span class="since-badge" data-since="0.31">Da 0.31</span>

Le relazioni non vengono incluse in una lettura a meno che il chiamante non lo richieda esplicitamente:

```typescript
const { data } = await client.data.posts
    .include("author", "tags")
    .find();
```

Una riga contiene quindi sia la chiave esterna sia la riga correlata: `post.authorId` è sempre presente, mentre `post.author` compare solo quando incluso. L'[SDK tipizzato](/docs/sdk/relations/) illustra in dettaglio le inclusioni: limiti per relazione, filtri, ordinamento e annidamento.

Un'operazione di scrittura imposta un collegamento to-one tramite la sua chiave (`{ author: "u7" }` oppure `{ authorId: "u7" }`), o `null` per scollegarlo, e un collegamento to-many come elenco di ID di destinazione o oggetti `{ id, _pivot? }` (`{ tags: ["t1", "t2"] }`). Un collegamento to-one scritto sotto forma di oggetto (`{ author: { id: "u7" } }`) genera un errore `400 VALIDATION_INVALID_VALUE` che indica la relazione: inviare solo la chiave. Un filtro su una relazione ne confronta la chiave. Consulta [Writing data](/docs/sdk/writing/).

Nel CMS, ogni relazione to-many diventa una scheda sotto il record. Consulta [Relations in the admin panel](/docs/collections/relations-in-the-admin-panel/).

## Operazioni e configurazioni rifiutate

<span class="since-badge" data-since="0.31">Da 0.31</span>

`rel.via()` privo di `steps` genera un errore durante il caricamento del modulo. Durante la compilazione dello schema, una tabella viene rifiutata nei seguenti casi:

- una relazione la cui destinazione non sia una tabella o una vista dello schema;
- una relazione e una colonna che condividono la stessa chiave;
- una colonna associata il cui tipo non coincide con il tipo della chiave di destinazione, oppure la presenza di `notNull` o `unique` sulla relazione non supportati dalla colonna associata;
- due relazioni che utilizzano la stessa colonna di chiave esterna, oppure una colonna derivata la cui chiave o nome SQL è già utilizzato da un'altra colonna;
- un `belongsTo` che punta a una tabella con chiave composita, un `hasOne` o `hasMany` proveniente da una tabella con chiave composita senza `sourceKey`, oppure un `manyToMany` con una delle due parti composita: una colonna non può fare riferimento a più colonne, pertanto è necessario esprimerlo con `rel.via()`;
- due relazioni `manyToMany` che fanno riferimento alla medesima tabella di giunzione ma con colonne chiave diverse;
- un `manyToMany` le cui due colonne di giunzione si risolvono nello stesso nome (un auto-collegamento senza `targetKey`);
- una colonna pivot contrassegnata con `.primaryKey()` (la chiave della tabella di giunzione è formata dalle sue due colonne di collegamento) o che dichiara `.transform()` (gli hook delle colonne pivot non vengono mai eseguiti; l'`afterRead` della destinazione visualizza `_pivot`).

## Passaggi successivi

<span class="since-badge" data-since="0.31">Da 0.31</span>

- [Row-level security](/docs/collections/security-rules/): chi può accedere alle righe su entrambi i lati
- [Indexes](/docs/backend/indexes/): l'indice di chiave esterna e gli indici compositi sulle relazioni
- [Typed SDK relations](/docs/sdk/relations/): `include`, limiti per relazione, `_count`

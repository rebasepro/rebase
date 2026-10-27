---
sourceHash: d55621114a4225a1
title: Schema come Codice
sidebar_label: Schema come Codice
description: Come Rebase utilizza le collezioni TypeScript come unica fonte di verità per lo schema del tuo database, l'interfaccia utente e l'API.
---

## L'Idea Centrale

In Rebase, le tue **definizioni di collezione TypeScript sono l'unica fonte di verità**. Da un unico set di oggetti TypeScript, Rebase genera:

- **Tabelle PostgreSQL** tramite la generazione dello schema Drizzle ORM
- **Interfaccia Utente CRUD** — moduli, tabelle, validazione, tipi di campo
- Endpoint **API REST** con filtraggio, ordinamento e impaginazione
- **SDK tipizzato** — operazioni sui dati type-safe
- **Politiche RLS** — Sicurezza a Livello di Riga in Postgres

Ciò significa che il tuo schema è:
- **Sotto controllo di versione** — ogni modifica è un commit git
- **Type-safe** — TypeScript rileva gli errori in fase di compilazione
- **Revisionabile** — le modifiche allo schema passano attraverso le pull request
- **Portatile** — la stessa definizione funziona su frontend, backend e CLI

## Modifica Visuale con Manipolazione AST

Rebase fornisce anche un **editor di collezioni visuale** in modalità Studio. Quando un non-sviluppatore utilizza l'editor visuale per aggiungere un campo:

1. Lo Studio **non** modifica direttamente il database
2. Invece, utilizza [ts-morph](https://ts-morph.com/) per analizzare il tuo file sorgente TypeScript come un AST
3. Inserisce la nuova definizione di proprietà precisamente nel blocco `properties`
4. **Tutto il codice esistente, le callback e la logica personalizzata sono preservati intatti**
5. Il file viene salvato, attivando il ricaricamento a caldo

Questo approccio "UI come Generatore di Codice" significa che le modifiche visuali producono lo stesso TypeScript pulito che uno sviluppatore scriverebbe a mano.

## Pipeline di Generazione dello Schema

Le tue collezioni vengono lette una volta ed emesse due volte — come uno schema
Drizzle attraverso cui il server in esecuzione esegue le sue query, e come SQL
che descrive il database che volevi avere. È a questo SQL che il database viene
allineato, da [Atlas](https://atlasgo.io), che confronta lo schema desiderato
con quello reale e pianifica la modifica:

```
                        Collections (TypeScript)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   rebase schema generate                   (db push and db generate write
            │                               the SQL below on every run, into
            ▼                               .rebase/sql/, which is not committed)
  backend/src/schema.generated.ts                       │
  the Drizzle schema the runtime                        ▼
  reads and writes rows through             schema.sql              ← Atlas's desired state
                                            policies.sql            ← RLS, applied separately
                                            search.sql, vector.sql, ← Atlas cannot manage these
                                            triggers.sql
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Atlas plans the diff        Atlas writes the diff
                                   and applies it now          to drizzle/migrations/
                                          │                           │
                                          │                           ▼
                                          │                    rebase db migrate
                                          │                    applies them in order
                                          └─────────────┬─────────────┘
                                                        ▼
                                                  PostgreSQL
```

`db push` è il ciclo di sviluppo; `db generate` + `db migrate` è quello
revisionabile, e quello da usare in produzione. Entrambi passano per lo stesso
SQL generato, quindi non possono essere in disaccordo su cosa significhino le
tue collezioni, ed entrambi lo riscrivono da zero a partire dalle collezioni
prima di leggerlo, quindi nel tuo repository non c'è nessuna copia che possa
diventare obsoleta. Ciò che va nel commit sono le migrazioni. Consulta
[Generazione dello Schema](/docs/cli/schema) per tutti i flag.

### Esempio

Data questa collezione:

<!-- schema-sample: collection -->
```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name", validation: { required: true } },
        price: { type: "number", name: "Price", columnType: "numeric" },
        active: { type: "boolean", name: "Active", defaultValue: true },
        createdAt: { type: "date", name: "Created", autoValue: "on_create" }
    }
});
```

Rebase genera questo schema Drizzle — il file intero, con la colonna `id`, le policy predefinite e tutto il resto:

<!-- schema-sample: drizzle -->
```typescript
// schema.generated.ts
// This file is auto-generated by the Rebase Drizzle generator. Do not edit manually.

import { boolean, numeric, pgPolicy, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { relations as drizzleRelations, sql } from 'drizzle-orm';


export const products = pgTable("products", {
    name: text("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(sql`TRUE`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`),
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`)
}, (table) => ([
    pgPolicy("products_default_admin_read", { as: "permissive", for: "select", to: ["public"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_update", { as: "permissive", for: "update", to: ["public"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))`, withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_delete", { as: "permissive", for: "delete", to: ["public"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
])).enableRLS();

export const tables = { products };
export const enums = {  };
export const relations = {  };
```

Tre cose qui meritano una seconda lettura. La colonna `id` che non hai
dichiarato: ogni collezione ottiene una primary key `text` a meno che una
proprietà non dichiari `isId`, e il database la riempie con un uuid
(`gen_random_uuid()::text`), così una riga creata dal pannello di
amministrazione, dalla REST API o dall'SDK non ha bisogno di una propria
chiave. Una chiave che invii tu viene usata come fornita. Sulla 0.23 la colonna
non ha un default, e una creazione che non invia una chiave fallisce. Il blocco
`pgPolicy`: la row level security è abilitata su ogni tabella, e quelle
policy di base sono ciò che permette al contesto server attendibile e al
ruolo `admin` di poterla leggere comunque — consulta
[Regole di Sicurezza](/docs/collections/security-rules). E `active`, che porta
il `defaultValue` che hai scritto come default di **colonna**: un
`defaultValue` letterale viene compilato in un vero `DEFAULT`, quindi anche
una riga inserita dalla REST API, da uno script di seed o da `psql` lo
riceve, non solo quella digitata nel pannello di amministrazione. Un default
di tipo `reference` o `vector` non è un letterale di colonna e resta un
valore a livello applicativo.

E questo SQL, che è ciò che viene passato ad Atlas come stato desiderato:

<!-- schema-sample: sql -->
```sql
-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.

CREATE SCHEMA IF NOT EXISTS "rebase";

CREATE TABLE "public"."products" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "price" NUMERIC,
  "active" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

Policy, colonne di ricerca, indici vettoriali e trigger `updated_at` vengono scritti in
file propri e applicati dalla CLI direttamente — Atlas non ne gestisce
nessuno dei quattro.

## Sicurezza e Oggetti di Database Non Mappati

Quando Rebase aggiorna lo schema del database, mappa le definizioni delle collezioni TypeScript sulle tabelle del database. Per garantire che **gli oggetti del database non mappati (ad esempio tabelle, viste, enum) non vengano mai eliminati o modificati**, Rebase implementa diversi livelli di sicurezza:

1. **Esclusione delle Tabelle Non Mappate**: Prima di ogni push, la CLI elenca ogni tabella e vista del database e passa ad Atlas un `--exclude` per ognuna che non è alla base di alcuna collezione (né è la tabella di giunzione di una collezione), così Atlas non pianifica mai una modifica su di essa. Se il database non può essere letto, il push si interrompe invece di procedere con un elenco parziale.
2. **Schemi Gestiti da Rebase**: Lo schema `rebase` (tabelle di autenticazione, funzioni helper RLS, tabella delle revisioni di Atlas) e qualsiasi schema `auth` sono esclusi per intero, così un push non può mai pianificare un `DROP SCHEMA … CASCADE`.
3. **Oggetti che Atlas Non Sa Modellare**: Anche le colonne di ricerca, gli indici vettoriali e i trigger sono esclusi da Atlas, e vengono applicati a partire dai propri file generati.
4. **Blocco delle Modifiche Distruttive**: `rebase db push` esegue prima una simulazione (dry-run) del piano. Un'istruzione che distrugge dati — una colonna o tabella eliminata, un cambio di tipo con perdita di dati — ferma il push: in un terminale chiede di digitare `yes`, e senza terminale (CI, script, agent) lo rifiuta a meno che tu non passi `--allow-destructive`.
5. **Proprietà degli Indici in Base al Nome**: Gli indici sono l'unico oggetto che vive *su* una tabella mappata, quindi il filtro sulle tabelle non può proteggerli — e un push pianificava `DROP INDEX` per qualsiasi indice assente dallo stato desiderato, cioè per ogni indice scritto a mano. Ora Rebase nomina gli indici che genera `<table>_<columns>_ix_<7 hex>` (`_ux_` quando sono unici), una forma che nessun altro generatore di nomi qui produce, ed esclude dal diff tutto il resto in base al nome. Un indice scritto a mano, o arrivato tramite introspezione, non viene mai toccato; una dichiarazione che elimini rimuove comunque il suo indice, ed è l'intento. Vedi **[Indici](/docs/backend/indexes)**.

## Prossimi Passi

- **[Collezioni](/docs/collections)** — Riferimento completo alla configurazione delle collezioni
- **[Proprietà](/docs/collections/properties)** — Mappature dettagliate dei tipi di colonna
- **[Indici](/docs/backend/indexes)** — Dichiarare gli indici di cui le tue query hanno bisogno

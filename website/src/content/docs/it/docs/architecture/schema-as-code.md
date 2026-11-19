---
sourceHash: 74016480ba989bec
title: Schema as Code
sidebar_label: Schema as Code
description: Come Rebase utilizza le tabelle TypeScript in backend/schema come unica fonte di verità per lo schema del database, l'API, l'SDK e il pannello di amministrazione.
---

## L'idea di fondo

In Rebase, le **tabelle dichiarate con `defineTable` in `backend/schema/` sono l'unica fonte di verità**. A partire da esse, Rebase genera:

- **Tabelle PostgreSQL** tramite la generazione dello schema di Drizzle ORM
- **Policy RLS** — Row Level Security in Postgres, a partire dall'`rls` obbligatorio di ciascuna tabella
- **Endpoint REST API** con filtraggio, ordinamento e paginazione, oltre a realtime e MCP
- **SDK tipizzato** — operazioni sui dati type-safe
- **I valori predefiniti del pannello di amministrazione** — form, elenchi, validazione e tipi di campo, renderizzati a partire dai descrittori delle tabelle che il backend espone all'endpoint `GET /api/schema/tables`; ciò che il pannello mostra oltre ad essi risiede in `frontend/src/cms/`

Ciò significa che il tuo schema è:
- **Tracciato da un sistema di controllo versione** — ogni modifica corrisponde a un commit git
- **Type-safe** — TypeScript intercetta gli errori in fase di compilazione
- **Revisionabile** — le modifiche allo schema passano attraverso pull request
- **Portabile** — la stessa definizione viene letta dal backend, dalla CLI, dal generatore di SDK e, sotto forma di tipi, dal frontend

## Modifica visuale con manipolazione dell'AST

Rebase fornisce anche un **editor visuale di schemi** in Studio. Quando qualcuno lo utilizza per aggiungere una colonna:

1. Studio **non** modifica direttamente il database
2. Invia invece la modifica come `TablePatch`, e il server usa [ts-morph](https://ts-morph.com/) per analizzare il file della tabella in `backend/schema/` come un AST
3. Inserisce il nuovo builder `col.*` con precisione all'interno del blocco `columns`
4. **Tutto il codice esistente, gli hook e la logica personalizzata vengono preservati intatti**; una modifica che andrebbe a toccare codice che non deve riscrivere viene rifiutata
5. Il file viene salvato, attivando l'hot reload

L'*aspetto* di una tabella all'interno del pannello non fa parte di questo processo: etichette, icone e viste
vengono salvate come preferenze del pannello o scritte in `frontend/src/cms/`. Consulta
[Live schema editing](/docs/backend/live-schema-editing/) per le modifiche supportate e
per i casi in cui l'editor rifiuta un'operazione.

Questo approccio basato sull'"interfaccia utente come generatore di codice" fa sì che le modifiche visuali producano lo stesso TypeScript pulito che uno sviluppatore scriverebbe a mano.

## Pipeline di generazione dello schema

Le tabelle vengono lette una volta ed emesse in due forme: uno schema Drizzle usato dal
server e SQL che descrive il database desiderato. Ptah Compat pianifica le modifiche da
questo SQL. `db push` lo confronta con il database attivo, mentre `db generate` lo
confronta con la cronologia delle migrazioni:

```
                      Tables (backend/schema)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   rebase schema generate                   (db push and db generate write
            │                               the SQL below on every run, into
            ▼                               .rebase/sql/, which is not committed)
  backend/src/schema.generated.ts                       │
  the Drizzle schema the runtime                        ▼
  reads and writes rows through             schema.sql              ← full desired state
                                            ptah-managed.json       ← owned objects
                                            policies.sql, search.sql,
                                            vector.sql, triggers.sql,
                                            views.sql               ← boot and recovery
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Ptah plans the diff         Ptah writes the diff
                                   and applies it now          to drizzle/migrations/
                                          │                           │
                                          │                           ▼
                                          │                    rebase db migrate
                                          │                    applies them in order
                                          └─────────────┬─────────────┘
                                                        ▼
                                                  PostgreSQL
```

`db push` rappresenta il ciclo di sviluppo rapido; `db generate` + `db migrate` è il flusso
sottoponibile a revisione, nonché quello da adottare in produzione. Entrambi passano attraverso lo stesso
SQL generato, impedendo così qualsiasi disallineamento su ciò che le tabelle definiscono, ed
entrambi lo riscrivono ex novo a partire dalle tabelle prima di leggerlo, evitando che copie non aggiornate
rimangano nel repository. I file di migrazione sono l'unico elemento da sottoporre a commit. Consulta
[Schema Generation](/docs/cli/schema) per l'elenco completo dei flag.

### Esempio

Data questa tabella:

<!-- schema-sample: table -->
```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id: col.text().primaryKey().default(sql`gen_random_uuid()::text`),
        name: col.text().notNull(),
        price: col.numeric(),
        active: col.boolean().default(true),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow()
    },
    rls: "admin-only"
});
```

Rebase genera questo schema Drizzle — l'intero file, comprese le policy predefinite
e quant'altro:

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
    pgPolicy("products_default_admin_read", { as: "permissive", for: "select", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_insert", { as: "permissive", for: "insert", to: ["rebase_admin"], withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_update", { as: "permissive", for: "update", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))`, withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_delete", { as: "permissive", for: "delete", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
])).enableRLS();

export const tables = { products };
export const enums = {  };
export const relations = {  };
```

Ci sono tre aspetti che meritano particolare attenzione. La colonna `id`: il database
la popola con un uuid (`gen_random_uuid()::text`), pertanto una riga creata dal
pannello di amministrazione, dall'API REST o dall'SDK non richiede una chiave generata dal client;
se ne viene fornita una, verrà utilizzata così com'è. Il blocco `pgPolicy`: `rls: "admin-only"` abilita la row
level security e genera esclusivamente le policy di base, che consentono la lettura al solo contesto
server attendibile e al ruolo `admin` — e a nessun altro; vedi
[Row-level security](/docs/collections/security-rules). Infine `active`, che
mantiene il `.default(true)` dichiarato come default di **colonna**: un valore predefinito
letterale viene compilato in un vero `DEFAULT` a livello di database, cosicché una riga inserita tramite API REST, uno
script di seeding o `psql` lo riceva ugualmente, e non solo quando viene inserita dal pannello di amministrazione.

Un estratto dell’SQL che Ptah riceve come stato desiderato:

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

Il file completo dello stato desiderato contiene anche policy, funzioni, indici di
ricerca e vettoriali, trigger `updated_at` e viste dichiarati. I file SQL separati
rimangono per avvio e ripristino. `db push` e `db generate` pianificano questi oggetti
insieme.

## Sicurezza e oggetti del database non mappati

Rebase limita il piano di Ptah agli oggetti dichiarati. Ne registra i nomi in
`drizzle/ptah-managed.json`, anche dopo la rimozione di una dichiarazione. La rimozione
può quindi produrre un `DROP`. Tabelle, viste, funzioni ed estensioni esterne restano
fuori dal piano.

Includi `backend/drizzle/ptah-managed.json` in Git insieme alle migrazioni. Rebase
usa i nomi salvati per pianificare la rimozione delle dichiarazioni eliminate.

Il provisioning dell’autenticazione e le revisioni delle migrazioni sono esclusi. Le
funzioni helper che Rebase dichiara nello schema `rebase` sono invece incluse. Nelle
tabelle selezionate, la CLI protegge per nome anche policy, trigger, indici e vincoli
CHECK ed EXCLUDE personalizzati.

Rebase legge i vincoli CHECK ed EXCLUDE dal catalogo del database attivo. Per
policy, trigger e indici, legge anche i file di migrazione. Se una lettura del
catalogo fallisce, la pianificazione si interrompe.

Prima di applicare una modifica, `db push` mostra il piano e verifica le istruzioni
distruttive, incluso `DROP EXTENSION`. Usa `--dry-run` per vedere il piano senza
applicarlo. Consulta [Indici](/docs/backend/indexes) per sapere come Rebase distingue
gli indici dichiarati da quelli personalizzati.

## Passaggi successivi

- **[Tables](/docs/schema/)** — Tutte le opzioni di `defineTable`
- **[Columns](/docs/schema/columns/)** — Mappature dettagliate dei tipi di colonna
- **[Indexes](/docs/backend/indexes)** — Dichiarare gli indici necessari per le query

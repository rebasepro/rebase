---
title: Schema come Codice
sidebar_label: Schema come Codice
description: Come Rebase utilizza le collezioni TypeScript come unica fonte di verità per lo schema del tuo database, l'interfaccia utente e l'API.
---

## L'Idea Centrale

In Rebase, le tue **definizioni di collezione TypeScript sono l'unica fonte di verità**. Da un unico set di oggetti TypeScript, Rebase genera:

- **Tabelle PostgreSQL** tramite la generazione dello schema Drizzle ORM
- **Interfaccia Utente CRUD** — moduli, tabelle, validazione, tipi di campo
- Endpoint **API REST** con filtraggio, ordinamento e impaginazione
- **SDK Client** — operazioni sui dati type-safe
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

```
TypeScript Collections
        │
        ▼
  rebase schema generate
        │
        ▼
  Drizzle Schema (schema.generated.ts)
        │
        ▼
  rebase db generate
        │
        ▼
  SQL Migration Files
        │
        ▼
  rebase db migrate
        │
        ▼
  PostgreSQL Tables
```

### Esempio

Data questa collezione:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
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

Rebase genera questo schema Drizzle:

```typescript
// schema.generated.ts
import { pgTable, varchar, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(true),
    created_at: timestamp("created_at").defaultNow()
});
```

Che produce questo SQL:

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    price NUMERIC,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Sicurezza e Oggetti di Database Non Mappati

Quando Rebase aggiorna lo schema del database, mappa le definizioni delle collezioni TypeScript sulle tabelle del database. Per garantire che **gli oggetti del database non mappati (ad esempio tabelle, viste, enum) non vengano mai eliminati o modificati**, Rebase implementa diversi livelli di sicurezza:

1. **Filtraggio Rigido delle Tabelle (`tablesFilter`)**: La configurazione Drizzle generata limita dinamicamente la sincronizzazione alle sole tabelle esportate nello schema generato. Eventuali tabelle non riconosciute o tabelle di sistemi legacy esistenti nel database vengono ignorate dal motore di sincronizzazione.
2. **Restrizioni sullo Schema (`schemaFilter`)**: La sincronizzazione del database è limitata esclusivamente allo schema `public`. Le tabelle interne del database, gli schemi personalizzati e le tabelle specifiche delle estensioni non vengono toccate.
3. **Protezione dei Ruoli e delle Estensioni**: Drizzle è configurato per non gestire i ruoli del database (`entities.roles: false`) o le tabelle di supporto di estensioni come PostGIS.
4. **Conferma Interattiva in Modalità di Sviluppo**: Quando si esegue `rebase db push` in sviluppo, la CLI viene eseguita con i flag `--strict` e `--verbose`, il che assicura che gli sviluppatori debbano esaminare e approvare esplicitamente qualsiasi azione SQL distruttiva prima che venga eseguita.
5. **Proprietà degli Indici in Base al Nome**: Gli indici sono l'unico oggetto che vive *su* una tabella mappata, quindi il filtro sulle tabelle non può proteggerli — e un push pianificava `DROP INDEX` per qualsiasi indice assente dallo stato desiderato, cioè per ogni indice scritto a mano. Ora Rebase nomina gli indici che genera `<table>_<columns>_ix_<7 hex>` (`_ux_` quando sono unici), una forma che nessun altro generatore di nomi qui produce, ed esclude dal diff tutto il resto in base al nome. Un indice scritto a mano, o arrivato tramite introspezione, non viene mai toccato; una dichiarazione che elimini rimuove comunque il suo indice, ed è l'intento. Vedi **[Indici](/docs/backend/indexes)**.

## Prossimi Passi

- **[Collezioni](/docs/collections)** — Riferimento completo alla configurazione delle collezioni
- **[Proprietà](/docs/collections/properties)** — Mappature dettagliate dei tipi di colonna
- **[Indici](/docs/backend/indexes)** — Dichiarare gli indici di cui le tue query hanno bisogno

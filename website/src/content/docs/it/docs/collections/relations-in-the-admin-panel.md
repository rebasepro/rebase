---
sourceHash: 8f8ab97f8302c1f8
title: Relazioni nel pannello di amministrazione
sidebar_label: Relazioni nel pannello di amministrazione
description: "Come il CMS visualizza le relazioni di una tabella: un selettore per un belongsTo, una scheda sotto il record per ogni relazione to-many, righe di proprietà rispetto a righe condivise, le stesse regole via REST e le opzioni customizeTable per i campi di relazione."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il CMS legge le [relazioni](/docs/collections/relations/) di una tabella dal suo
descrittore e disegna ciascuna in base a ciò che è:

| Relazione | Nel record |
|---|---|
| `belongsTo` | un selettore della riga correlata, al posto della relativa colonna di chiave esterna |
| `hasOne` | un selettore della singola riga correlata |
| `hasMany`, `manyToMany`, un `via` di tipo to-many | una **scheda** che elenca le righe correlate |
| un `via` che non è modificabile | sola lettura |

```ts
// backend/schema/articles.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { tags } from "./tags";

export const articles = defineTable("articles", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
    },
    relations: {
        author:       rel.belongsTo(() => users, { notNull: true }),
        tags:         rel.manyToMany(() => tags),
        featuredTags: rel.manyToMany(() => tags, { through: "articles_featured_tags" }),
    },
    rls: "admin-only",
});
```

Il modulo mostra **Author** come selettore di un utente e nessun campo `authorId`: il
selettore modifica quella colonna. È obbligatorio, perché la chiave esterna è
`NOT NULL` senza alcun valore predefinito. Una chiave esterna che fa parte della chiave primaria
della tabella rimane un campo a sé stante accanto al selettore. **Tags** e **Featured Tags** sono
schede del record.

Una relazione la cui destinazione non viene servita al chiamante viene omessa: il CMS non può
aprire una tabella che non possiede. Un `belongsTo` lascia quindi la sua chiave esterna come
un semplice campo, in modo che il valore rimanga visibile e modificabile. Viene omesso anche un
`belongsTo` la cui chiave esterna non può essere letta dal chiamante.

## Il segmento del percorso è il nome della relazione

<span class="since-badge" data-since="0.31">Da 0.31</span>

Le righe di una scheda vengono indirizzate come `parent/parentId/relationName`:

```text
/c/authors/a-1/posts            the posts of author a-1
/c/articles/p-1/featuredTags    the featured tags of article p-1
```

L'ultimo segmento è il **nome della relazione**, la chiave in `relations`, non lo
slug della destinazione. È questo che consente il funzionamento di due relazioni verso la stessa tabella: ciascuna ha
il proprio nome, quindi ciascuna ottiene la propria scheda e il proprio percorso.

## Righe di proprietà rispetto a righe condivise

<span class="since-badge" data-since="0.31">Da 0.31</span>

Ciò che una scheda consente di fare dipende da come viene memorizzata la relazione:

| | Uno-a-molti (`hasMany`) | Molti-a-molti (`manyToMany`) |
|---|---|---|
| Il figlio appartiene a | solo a questo genitore | ogni genitore che lo collega |
| Crea | crea la riga sotto questo genitore | crea la riga e la collega |
| Aggiungi esistente | — | collega una riga esistente |
| Rimuovi | **elimina** la riga | **scollega** la riga; la riga rimane intatta |

Una scheda molti-a-molti offre **Aggiungi esistente** e **Rimuovi da questo record**, e
mai un'eliminazione che sottrarrebbe la riga ad altri genitori.

## Le stesse regole via REST

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una scheda è una normale query ristretta a un solo genitore, quindi accetta tutto ciò che
accetta un elenco radice (filtri, `orderBy`, `limit`, `offset`, `include`) e
`meta.total` conteggia le righe filtrate. Filtra per campo (`?field=op.value`) o
con un intero oggetto `?where={"field":["op","value"]}`:

```text
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

Il segmento del genitore è vincolante. Indirizzare una riga che non appartiene a quel genitore
restituisce `404`, e `PATCH` non sposta mai una riga da un genitore all'altro: imposta
la chiave esterna esplicitamente se è questo ciò che desideri.

Per una relazione molti-a-molti, `PATCH parent/id/child/childId` rappresenta l'*appartenenza a un insieme*: collega
la riga se non è ancora collegata, ed è idempotente. È così che si associa una riga
già esistente.

## Cosa non diventa una scheda

<span class="since-badge" data-since="0.31">Da 0.31</span>

- **Relazioni to-one**: un `belongsTo` o un `hasOne` è un campo del record, non
  un elenco. La scrittura tramite un percorso to-one viene rifiutata.
- **Una tabella con `hideFromEntityViews`** nel suo `customizeTable` non viene proposta
  come scheda sui record delle tabelle correlate ad essa.

## Personalizzazione dei campi di relazione

<span class="since-badge" data-since="0.31">Da 0.31</span>

```tsx
// frontend/src/cms/articles.tsx
import { customizeTable } from "@rebasepro/cms";
import type { articles } from "../../../backend/schema/articles";

export const articlesCms = customizeTable<typeof articles>("articles", {
    fields: {
        author: {
            previewFields: ["displayName", "email"],
            widget: "dialog",
            includeEntityLink: true,
        },
        featuredTags: {
            name: "Featured",
            renderInForm: true,
            overrides: { name: "Featured tags", defaultViewMode: "cards" },
        },
    },
});
```

| Opzione | Effetto |
|---|---|
| `previewFields` | I campi della destinazione mostrati nel chip per una riga correlata. Ne possono rientrare al massimo tre. |
| `widget` | `"select"` seleziona da un menu a discesa, `"dialog"` da una tabella ricercabile. |
| `fixedFilter` | Propone solo le righe che superano questo filtro. |
| `includeId` | Mostra l'id della riga correlata nelle anteprime. |
| `includeEntityLink` | Mostra un link che apre la riga correlata. |
| `renderInForm` | Disegna anche una relazione to-many come selettore nel modulo, accanto alla sua scheda. |
| `overrides` | Come la destinazione viene presentata nella scheda di questa relazione: qualsiasi opzione di tabella eccetto `fields`. |

`overrides` ridefinisce lo stile della scheda, non i campi della destinazione. Questi appartengono
al `customizeTable` della tabella di destinazione stessa, e inserire `fields` all'interno di `overrides`
genera un errore.

## Passaggi successivi

<span class="since-badge" data-since="0.31">Da 0.31</span>

- [Relazioni](/docs/collections/relations/): i cinque tipi e come dichiarare ciascuno
- [customizeTable](/docs/frontend/customize-table/#relations): opzioni di relazione nella guida di riferimento
- [Scrittura via REST](/docs/backend/writes/): creazione, aggiornamento ed eliminazione oltre a una scheda

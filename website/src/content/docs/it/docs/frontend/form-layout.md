---
sourceHash: 3830846c0457a79f
title: Layout del form
sidebar_label: Layout del form
description: Controlla come è organizzato il form dell'entità — estensioni delle colonne, sezioni e barra dei metadati.
---

## Panoramica

Il form dell'entità viene generato a partire dalle tue proprietà. Per impostazione predefinita, ricava un layout a due colonne dai tipi di proprietà, quindi una collezione che non specifica nulla sul layout ottiene comunque un form leggibile e ben strutturato, anziché una lunga sequenza di input a larghezza intera:

- l'id e i timestamp `createdAt` / `updatedAt` vengono collocati in una barra dei metadati, in sola lettura
- enum brevi, booleani, date e numeri occupano un'estensione ridotta
- testo lungo, markdown, array, mappe e campi di archiviazione occupano l'intera larghezza
- tutto il resto ne occupa la metà

Usa `admin.form` quando il risultato ricavato automaticamente non è adatto al tuo dominio.

## Larghezza del campo

La larghezza di un campo è definita come uno **span** (estensione) su una griglia a quattro colonne. `4` corrisponde alla larghezza intera della colonna principale.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: {
        sku: {
            name: "SKU",
            type: "string",
            admin: { span: 1 }
        },
        name: {
            name: "Product name",
            type: "string",
            admin: { span: 3 }
        },
        description: {
            name: "Description",
            type: "string",
            admin: { markdown: true, span: 4 }
        }
    }
});
```

Gli span si agganciano a una griglia condivisa, consentendo a due campi di allinearsi indipendentemente dall'ordine in cui sono stati dichiarati. Hanno sostituito `admin.widthPercentage`, le cui percentuali grezze non potevano allinearsi con precisione; una collezione che lo utilizza ancora dovrebbe scegliere lo span più vicino (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, altrimenti `4`).

Nei layout troppo stretti per due colonne — il pannello laterale, il riquadro diviso (split pane), uno smartphone — la griglia collassa su una singola colonna e gli span vengono ignorati.

## Sezioni

`sections` raggruppa la colonna principale sotto delle intestazioni. Una sezione provvista di titolo può essere compressa; una senza titolo non può esserlo.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const ordersCollection = defineCollection({
    slug: "orders",
    table: "orders",
    name: "Orders",
    properties: {
        reference: { name: "Reference", type: "string" },
        placed_at: { name: "Placed at", type: "date" },
        address: { name: "Address", type: "string" },
        carrier: { name: "Carrier", type: "string" },
        tracking_number: { name: "Tracking number", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    admin: {
        form: {
            sections: [
                { key: "identity", properties: ["reference", "placed_at"] },
                {
                    key: "shipping",
                    title: "Shipping",
                    properties: ["address", "carrier", "tracking_number"]
                },
                {
                    key: "internal",
                    title: "Internal notes",
                    properties: ["notes"],
                    collapsed: true
                }
            ]
        }
    }
});
```

Una proprietà non assegnata ad alcuna sezione non viene mai persa: finisce nell'ultima sezione senza titolo, oppure in un gruppo finale senza titolo se non ne esiste alcuna. L'aggiunta di una colonna al database non può quindi far scomparire silenziosamente un campo dal form.

Un errore di validazione all'interno di una sezione compressa ne provoca l'espansione automatica, in modo che un errore non rimanga mai nascosto dietro un'intestazione chiusa.

## La barra dei metadati

`sidebar` sposta i campi fuori dalla colonna principale in una stretta barra laterale adiacente — stato, proprietà, date di pubblicazione, flag.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const postsCollection = defineCollection({
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string", admin: { markdown: true } },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published at", type: "date" },
        author: { name: "Author", type: "string" }
    },
    admin: {
        form: {
            sidebar: ["status", "publishedAt", "author"],
            showRecordMeta: true
        }
    }
});
```

La barra laterale non utilizza la griglia, quindi `span` viene ignorato per i campi al suo interno. Dove non c'è spazio per la barra laterale, viene visualizzata come una normale sezione iniziale, evitando perdite di elementi su uno smartphone o nel pannello laterale.

`showRecordMeta` posiziona il blocco del record in sola lettura — id, data di creazione, data di aggiornamento — in fondo alla barra. Il valore predefinito è `true` ogni volta che viene mostrata la barra laterale, e sostituisce `hideIdFromForm` per la maggior parte delle collezioni: l'id smette di essere un campo in mezzo al form e diventa una riga di metadati copiabile.

Imposta `sidebar: []` per escludere del tutto la barra laterale derivata e mantenere ogni campo nella colonna principale.

## Riferimento

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Larghezza del campo sulla griglia del form a quattro colonne |
| `admin.form.sidebar` | `string[]` | Chiavi di proprietà mostrate nella barra dei metadati |
| `admin.form.sections` | `FormSection[]` | Gruppi provvisti di titolo per la colonna principale |
| `admin.form.showRecordMeta` | `boolean` | Mostra id/creazione/aggiornamento in fondo alla barra |

`FormSection` è `{ key, title?, properties, collapsed?, collapsible? }`.

## Correlati

- [Custom Fields](/docs/frontend/custom-fields/) — il campo che il layout sta organizzando
- [Entity Views](/docs/frontend/entity-views/) — un'intera scheda personalizzata accanto al form
- [Properties](/docs/collections/properties/) — le opzioni delle proprietà lette dal layout

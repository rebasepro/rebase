---
sourceHash: 3830846c0457a79f
title: Layout del Form
sidebar_label: Layout del Form
description: Controlla come è organizzato il form dell'entità — ampiezza delle colonne, sezioni e il rail dei metadati.
---

## Panoramica

Il form dell'entità viene generato a partire dalle tue proprietà. Per impostazione predefinita, deriva un layout a due colonne dai tipi di proprietà, quindi una collezione che non specifica nulla sul layout ottiene comunque un form dall'aspetto strutturato anziché una lunga sequenza di input a larghezza intera:

- l'id e i timestamp `createdAt` / `updatedAt` vanno in un rail di metadati, in sola lettura
- enum brevi, booleani, date e numeri occupano un'ampiezza ridotta
- testi lunghi, markdown, array, mappe e campi di archiviazione occupano l'intera larghezza
- tutto il resto occupa la metà

Usa `admin.form` quando il risultato derivato non è adatto al tuo dominio.

## Larghezza dei campi

La larghezza di un campo è uno **span** su una griglia a quattro colonne. `4` corrisponde all'intera larghezza della colonna principale.

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

Gli span si agganciano a una griglia condivisa, permettendo a due campi di allinearsi a prescindere dall'ordine in cui sono stati dichiarati. Hanno sostituito `admin.widthPercentage`, le cui percentuali grezze non potevano allinearsi con nulla; una collezione che lo utilizza ancora dovrebbe scegliere lo span più vicino (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, altrimenti `4`).

Su layout troppo stretti per due colonne — il pannello laterale, il riquadro diviso, uno smartphone — la griglia si riduce a una singola colonna e gli span vengono ignorati.

## Sezioni

`sections` raggruppa la colonna principale sotto delle intestazioni. Una sezione dotata di titolo può essere compressa; una priva di titolo no.

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

Una proprietà non assegnata ad alcuna sezione non viene mai tralasciata: finisce nell'ultima sezione senza titolo o in un gruppo finale privo di titolo se non ce n'è una. L'aggiunta di una colonna al database non può quindi far scomparire silenziosamente un campo dal form.

Un errore di validazione all'interno di una sezione compressa la espande automaticamente, impedendo che un errore rimanga nascosto dietro un'intestazione chiusa.

## Il rail dei metadati

`sidebar` sposta i campi fuori dalla colonna principale e li inserisce in un rail stretto al suo fianco — stato, proprietà, date di pubblicazione, flag.

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

Il rail non utilizza la griglia, quindi `span` viene ignorato per i campi al suo interno. Dove non c'è spazio per un rail, viene renderizzato come una normale sezione iniziale, così da non perdere nulla su uno smartphone o nel pannello laterale.

`showRecordMeta` posiziona il blocco del record in sola lettura — id, creato, aggiornato — in fondo al rail. Il valore predefinito è `true` ogni volta che viene mostrato un rail, e sostituisce `hideIdFromForm` per la maggior parte delle collezioni: l'id smette di essere un campo al centro del form e diventa una riga di metadati che può essere copiata.

Imposta `sidebar: []` per sopprimere completamente il rail derivato e mantenere ogni campo nella colonna principale.

## Riferimenti

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Larghezza del campo sulla griglia del form a quattro colonne |
| `admin.form.sidebar` | `string[]` | Chiavi delle proprietà mostrate nel rail dei metadati |
| `admin.form.sections` | `FormSection[]` | Gruppi con titolo per la colonna principale |
| `admin.form.showRecordMeta` | `boolean` | Mostra id/creato/aggiornato in fondo al rail |

`FormSection` è `{ key, title?, properties, collapsed?, collapsible? }`.

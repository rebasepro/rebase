---
sourceHash: 42da06ee7f0f6c0c
title: Layout del form
sidebar_label: Layout del form
description: Controlla la disposizione del form dell'entità — ampiezza delle colonne, sezioni e barra dei metadati.
---

## Panoramica

Il form dell'entità viene generato a partire dalle tue proprietà:

- l'id e i timestamp `createdAt` / `updatedAt` vengono inseriti in una barra dei metadati (rail), in sola lettura
- ogni altro campo occupa l'intera larghezza della colonna principale, tranne quando due
  campi adiacenti con lo stesso editor compatto — due numeri, due switch,
  due date con la stessa modalità, due select con opzioni brevi — condividono una riga

Un campo con un'etichetta lunga, un testo di aiuto superiore a 60 caratteri, `conditions`, una
regola `access` a livello di campo o `excludeFromApi` (il form non mostra nulla a un utente che
non può leggerlo), o un `Field` personalizzato non viene mai affiancato, e lo stesso vale per qualsiasi stringa di testo libero: nulla in
uno schema distingue il nome breve di un branch da un URL lungo. Il form non controlla mai
quale proprietà sia il titolo. Qualsiasi altra colonna deve essere richiesta esplicitamente dalla
collection, campo per campo, tramite `admin.span` — impostato in base a ciò che ciascun campo contiene, come
mostrato di seguito. Usa `admin.form` per
raggruppare i campi in sezioni e spostarli nella barra laterale.

## Larghezza del campo

La larghezza di un campo è definita da uno **span** su una griglia a quattro colonne. `4` rappresenta l'intera larghezza
della colonna principale.

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

Gli span si agganciano a una griglia condivisa, consentendo a due campi di allinearsi indipendentemente
dall'ordine in cui sono stati dichiarati. Hanno sostituito `admin.widthPercentage`,
le cui percentuali grezze non potevano allinearsi con precisione; una collection che
ne fa ancora uso dovrebbe scegliere lo span più vicino (≤30 → `1`, ≤55 → `2`, ≤80 → `3`,
altrimenti `4`).

Scegli uno span in base al contenuto del campo, non al suo tipo. Due valori brevi
logicamente correlati condividono una riga — data di inizio e fine, città e paese,
provider e regione con `2` ciascuno, oppure un valore e il suo qualificatore con `3` + `1`.
Numeri, booleani e codici brevi possono occupare `1` accanto ai campi correlati. Tutto
ciò che risulta lungo alla lettura — nomi, URL, email, ID, descrizioni, markdown, file —
mantiene `4`. Le righe vengono riempite nell'ordine di dichiarazione e nessun campo viene allargato automaticamente per colmare uno
spazio vuoto, quindi dichiara le coppie una accanto all'altra e assicurati che ogni riga sommi a 4.

Nei layout troppo stretti per due colonne — il pannello laterale, il riquadro diviso (split pane), uno smartphone
— la griglia si riduce a una singola colonna e gli span vengono ignorati.

## Sezioni

`sections` raggruppa la colonna principale sotto apposite intestazioni. Una sezione con titolo può essere
compressa; una priva di titolo non può esserlo.

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

Una proprietà non inclusa in alcuna sezione non viene mai persa: finisce nell'ultima
sezione senza titolo, oppure in un gruppo finale privo di titolo se non ne esiste alcuna. L'aggiunta di una colonna al
database non può quindi far scomparire silenziosamente un campo dal form.

Un errore di validazione all'interno di una sezione compressa la espande automaticamente, impedendo che un errore
resti nascosto dietro un'intestazione chiusa.

## La barra dei metadati

`sidebar` sposta i campi fuori dalla colonna principale per inserirli in una stretta barra laterale adiacente —
stato, titolarità, date di pubblicazione, flag.

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

La barra laterale non utilizza la griglia, quindi `span` viene ignorato per i campi al suo interno. Dove
non c'è spazio a sufficienza per una barra laterale, essa viene renderizzata come una normale sezione iniziale, così da non
perdere nulla su smartphone o nel pannello laterale.

`showRecordMeta` posiziona il blocco del record in sola lettura — id, data di creazione, data di aggiornamento — ai
piedi della barra laterale. È impostato di default su `true` ogni volta che viene mostrata una barra laterale, e sostituisce
`hideIdFromForm` per la maggior parte delle collection: l'id smette di essere un campo al centro del
form e diventa una riga di metadati che è possibile copiare.

Imposta `sidebar: []` per disattivare del tutto la barra laterale derivata e mantenere ogni campo nella
colonna principale.

## Riferimento

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Larghezza del campo sulla griglia a quattro colonne del form |
| `admin.form.sidebar` | `string[]` | Chiavi delle proprietà visualizzate nella barra dei metadati |
| `admin.form.sections` | `FormSection[]` | Gruppi con intestazione per la colonna principale |
| `admin.form.showRecordMeta` | `boolean` | Mostra id/creazione/aggiornamento ai piedi della barra |

`FormSection` corrisponde a `{ key, title?, properties, collapsed?, collapsible?, readVariant? }`. `readVariant: "summary"` dispone i campi della sezione come righe etichetta/valore nella vista di sola lettura del record; il valore predefinito, `"grid"`, usa la griglia del form.

## Correlati

- [Custom Fields](/docs/frontend/custom-fields/) — il campo che il layout sta organizzando
- [Entity Views](/docs/frontend/entity-views/) — un'intera scheda personalizzata accanto al form
- [Properties](/docs/collections/properties/) — le opzioni delle proprietà lette dal layout

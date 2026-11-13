---
sourceHash: 93694433369991ae
title: Layout del form
sidebar_label: Layout del form
description: "Organizza il form di un record: larghezze dei campi su una griglia a quattro colonne, sezioni con titolo e comprimibili, la barra laterale dei metadati e un componente che sostituisce il form generato."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il form del record viene generato a partire dalle colonne e dalle relazioni della tabella:

- l'id e i timestamp di creazione e aggiornamento vengono inseriti in una barra laterale dei metadati in sola lettura;
- ogni altro campo occupa l'intera larghezza della colonna principale, tranne nel caso in cui due campi adiacenti con lo stesso editor compatto (due numeri, due interruttori, due date con la stessa modalità, due menu a discesa con opzioni brevi) condividano una riga.

Un campo con un'etichetta lunga, un testo di aiuto superiore a 60 caratteri, `conditions`, una [regola di accesso](/docs/collections/field-access/) a livello di colonna o un `Field` personalizzato non viene mai affiancato, così come qualsiasi testo libero: nulla in uno schema permette di distinguere il nome breve di un branch da un lungo URL. Qualsiasi altra configurazione va richiesta in `customizeTable`, campo per campo con `span`, e per l'intero form con `form`.

```ts
// backend/schema/orders.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:             col.uuid().primaryKey().defaultRandom(),
        reference:      col.text().notNull(),
        sku:            col.text(),
        status:         col.enum(["placed", "shipped", "delivered"]).notNull().default("placed"),
        placedAt:       col.timestamp({ withTimezone: true }),
        address:        col.text(),
        carrier:        col.text(),
        trackingNumber: col.text(),
        notes:          col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/orders.tsx
import { customizeTable } from "@rebasepro/cms";
import type { orders } from "../../../backend/schema/orders";

export const ordersCms = customizeTable<typeof orders>("orders", {
    form: {
        sidebar: ["status", "placedAt"],
        sections: [
            { key: "identity", fields: ["reference", "sku"] },
            { key: "shipping", title: "Shipping", fields: ["address", "carrier", "trackingNumber"] },
            { key: "internal", title: "Internal notes", fields: ["notes"], collapsed: true },
        ],
    },
    fields: {
        reference: { span: 3 },
        sku:       { name: "SKU", span: 1 },
        carrier:   { span: 2 },
        trackingNumber: { span: 2 },
        notes:     { multiline: true },
    },
});
```

## Larghezza dei campi

<span class="since-badge" data-since="0.31">Da 0.31</span>

La larghezza di un campo è uno **span** su una griglia a quattro colonne; `4` corrisponde all'intera larghezza della colonna principale. Gli span si agganciano alla griglia, garantendo l'allineamento dei campi indipendentemente dall'ordine in cui sono stati dichiarati.

Scegli uno span in base al contenuto del campo, non al suo tipo. Due valori brevi correlati condividono una riga: data di inizio e di fine, città e paese, corriere e codice di tracciamento con `2` ciascuno, oppure un valore e il relativo qualificatore con `3` + `1`. Numeri, booleani e codici brevi possono occupare `1` accanto ai campi correlati. Tutto ciò che risulta lungo alla lettura (nomi, URL, email, id, descrizioni, markdown, file) mantiene `4`. Le righe si riempiono secondo l'ordine dei campi e nessun campo viene allargato automaticamente per colmare gli spazi vuoti; disponi quindi le coppie l'una accanto all'altra e fai in modo che ogni riga sommi a 4.

Nei layout troppo stretti per due colonne (il pannello laterale, il riquadro diviso, uno smartphone), la griglia si riduce a una sola colonna e gli span vengono ignorati.

## Sezioni

<span class="since-badge" data-since="0.31">Da 0.31</span>

`form.sections` raggruppa la colonna principale sotto diverse intestazioni. Ogni sezione è definita come `{ key, title?, fields, collapsed?, collapsible?, readVariant? }`. Una sezione con titolo può essere compressa; una senza titolo non può esserlo. `readVariant: "summary"` impila i campi della sezione come righe di etichetta e valore nella vista in sola lettura del record; l'impostazione predefinita, `"grid"`, utilizza la griglia del form.

Un campo non specificato in alcuna sezione non viene mai scartato: finisce nell'ultima sezione senza titolo, oppure in un gruppo finale senza titolo se non ne è presente alcuna. L'aggiunta di una colonna alla tabella non può far scomparire silenziosamente un campo dal form. Un errore di convalida all'interno di una sezione compressa la espande automaticamente.

Ogni voce viene verificata rispetto alla tabella. Le voci che il server non invia al chiamante corrente, a causa della mancanza di permessi di lettura per quella colonna, vengono ignorate.

## La barra laterale dei metadati

<span class="since-badge" data-since="0.31">Da 0.31</span>

`form.sidebar` sposta i campi fuori dalla colonna principale in una barra laterale stretta adiacente: stato, proprietà, date di pubblicazione, flag. La barra laterale non utilizza la griglia, quindi `span` viene ignorato al suo interno. Dove non c'è spazio sufficiente per una barra laterale, viene visualizzata come una normale sezione iniziale.

`form.showRecordMeta` posiziona il blocco del record in sola lettura (id, creato, aggiornato) in fondo alla barra laterale. È `true` ogni volta che viene mostrata una barra laterale. `sidebar: []` disattiva la barra laterale derivata e mantiene ogni campo nella colonna principale. `hideIdFromForm` nasconde completamente l'id dal form.

## Sostituire il form

<span class="since-badge" data-since="0.31">Da 0.31</span>

`formView` sostituisce il form generato con un componente personalizzato, importato per valore. Riceve gli stessi parametri `EntityCustomViewParams` di una [vista entità](/docs/frontend/entity-views/). `includeActions: true` mantiene i pulsanti Salva e Annulla nella barra del record mentre è visibile a schermo.

```tsx
import React from "react";
import { customizeTable } from "@rebasepro/cms";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import type { orders } from "../../../backend/schema/orders";

function OrderForm({ row, modifiedValues }: EntityCustomViewParams) {
    return <h2>{String(modifiedValues?.reference ?? row?.reference ?? "New order")}</h2>;
}

export const ordersCms = customizeTable<typeof orders>("orders", {
    formView: { Builder: OrderForm, includeActions: true },
});
```

Per una modifica più mirata, sostituisci invece una singola parte del form (`Entity.Form`, consulta [Sovrascrittura dei componenti](/docs/frontend/component-overrides/)), oppure organizza autonomamente alcuni campi con `<RecordForm>` e `<FormField>` all'interno di una pagina personalizzata (consulta [Pannelli](/docs/frontend/panels/)).

## Altre opzioni del form

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Opzione | Effetto |
|---|---|
| `formAutoSave` | Salva man mano che l'utente digita. |
| `alwaysApplyDefaultValues` | Applica i valori predefiniti dichiarati nei campi vuoti di un record memorizzato quando viene aperto. |
| `includeJsonView` | Aggiunge una scheda con il record in formato JSON. |
| `localChangesBackup` | Mantiene le modifiche non salvate nella memoria locale: `"manual_apply"`, `"auto_apply"` o `false`. |

## Correlati

<span class="since-badge" data-since="0.31">Da 0.31</span>

- [Campi personalizzati](/docs/frontend/custom-fields/): i campi organizzati dal layout
- [Viste entità](/docs/frontend/entity-views/): un'intera scheda personalizzata accanto al form
- [customizeTable](/docs/frontend/customize-table/#form): le opzioni del form nella documentazione di riferimento

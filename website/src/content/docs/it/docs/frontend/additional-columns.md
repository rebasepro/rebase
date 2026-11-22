---
sourceHash: 3c089e6c404f4635
title: Colonne aggiuntive
sidebar_label: Colonne aggiuntive
description: Aggiungi colonne calcolate/virtuali alle tabelle delle collezioni che derivano valori dai dati delle entità.
---

## Panoramica

Le colonne aggiuntive consentono di visualizzare dati calcolati o derivati nella tabella della collezione senza archiviarli nel database.

Una colonna calcolata appartiene alla tabella. Il record mostra già i valori da cui viene calcolata, quindi non è presente sul record a meno che il form non lo richieda: indica la sua `key` in `form.sections` o `form.sidebar` (vedi [Form layout](/docs/frontend/form-layout/)), o nei `fields` forniti a un `RecordForm` o `RecordDetail`.

## Definizione delle colonne aggiuntive

```tsx
// frontend/src/cms/products.tsx
import React from "react";
import { customizeTable } from "@rebasepro/cms";
import type { AdditionalFieldKey } from "@rebasepro/cms-types";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    additionalFields: [
        {
            key: "total",
            name: "Total",
            Builder: ({ row }) => {
                const items = Array.isArray(row.items) ? row.items : [];
                const total = items.reduce(
                    (sum: number, item: { price?: number; quantity?: number }) =>
                        sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0
                );
                return <span>{total.toFixed(2)}</span>;
            },
            dependencies: ["items"],
            value: ({ row }) => {
                const items = Array.isArray(row.items) ? row.items : [];
                return items.length;
            }
        }
    ],
    fieldOrder: ["name", "total" as AdditionalFieldKey, "status"],
});
```

| Chiave | Cosa fa |
|---|---|
| `key` | Identifica la colonna. Indicala in `fieldOrder` o `listFields` come `"total" as AdditionalFieldKey`. |
| `name` | L'intestazione. |
| `width` | La larghezza, in pixel. |
| `Builder` | Esegue il rendering della cella. |
| `dependencies` | I campi la cui modifica attiva nuovamente il rendering della cella; verificati rispetto alla tabella. |
| `value` | Il valore della cella, per l'esportazione. |

## Prop di Builder

| Prop | Tipo | Descrizione |
|------|------|-------------|
| `row` | `Record<string, unknown>` | Il record così come il server invia la riga: date come stringhe ISO, un belongsTo come colonna di chiave esterna, `id` solo se la tabella include tale colonna. Una relazione caricata dall'admin è nidificata sotto il proprio nome con le colonne del record correlato |
| `id` | `string` | L'id del record: la sua chiave primaria come stringa, con le parti di una chiave composta unite da `:::`. L'id accettato da `useSidePanel().open` e da una route |
| `context` | `RebaseContext` | Contesto Rebase completo |

`value({ row, id, context })` riceve le stesse prop.

## Passaggi successivi

- **[Entity Actions](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
- **[Custom Fields](/docs/frontend/custom-fields)** — Campi del form personalizzati

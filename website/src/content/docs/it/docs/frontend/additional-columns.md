---
sourceHash: 395db046e3ecafc8
title: Colonne aggiuntive
sidebar_label: Colonne aggiuntive
description: Aggiungi colonne calcolate/virtuali alle tabelle di collezione che derivano valori dai dati delle entità.
---

## Panoramica

Le colonne aggiuntive consentono di visualizzare dati calcolati o derivati nella tabella della collezione senza archiviarli nel database.

## Definizione delle colonne aggiuntive

<span class="since-badge" data-since="0.31">Da 0.31</span>

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
| `key` | Identifica la colonna. Nominala in `fieldOrder` o `listFields` come `"total" as AdditionalFieldKey`. |
| `name` | L'intestazione. |
| `width` | La larghezza, in pixel. |
| `Builder` | Esegue il rendering della cella. |
| `dependencies` | I campi la cui modifica comporta il re-rendering della cella; verificati rispetto alla tabella. |
| `value` | Il valore della cella, per l'esportazione. |

## Prop del Builder

| Prop | Tipo | Descrizione |
|------|------|-------------|
| `row` | `Record<string, unknown>` | Il record così come il server invia la riga: date come stringhe ISO, un belongsTo come la sua colonna di chiave esterna, `id` solo dove la tabella possiede tale colonna. Una relazione caricata dall'admin è annidata sotto il proprio nome con le colonne del record correlato |
| `id` | `string` | L'id del record: la sua chiave primaria come stringa, oppure le parti di una chiave composita unite da `:::`. L'id accettato da `useSidePanel().open` e da una route |
| `context` | `RebaseContext` | Contesto Rebase completo |

`value({ row, id, context })` riceve le stesse prop.

## Prossimi passi

- **[Entity Actions](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
- **[Custom Fields](/docs/frontend/custom-fields)** — Campi modulo personalizzati

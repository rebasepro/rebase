---
sourceHash: 395db046e3ecafc8
title: Zusätzliche Spalten
sidebar_label: Zusätzliche Spalten
description: Fügen Sie Collection-Tabellen berechnete/virtuelle Spalten hinzu, die Werte aus Entitätsdaten ableiten.
---

## Übersicht

Mit zusätzlichen Spalten können Sie berechnete oder abgeleitete Daten in der Collection-Tabelle anzeigen, ohne diese in der Datenbank zu speichern.

## Zusätzliche Spalten definieren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

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

| Key | Beschreibung |
|---|---|
| `key` | Identifiziert die Spalte. Geben Sie ihn in `fieldOrder` oder `listFields` als `"total" as AdditionalFieldKey` an. |
| `name` | Die Spaltenüberschrift. |
| `width` | Die Breite in Pixeln. |
| `Builder` | Rendert die Zelle. |
| `dependencies` | Die Felder, deren Änderung die Zelle neu rendert; wird mit der Tabelle abgeglichen. |
| `value` | Der Wert der Zelle für den Export. |

## Builder-Props

| Prop | Typ | Beschreibung |
|------|------|-------------|
| `row` | `Record<string, unknown>` | Der Datensatz, wie der Server die Zeile sendet: Datumsangaben als ISO-Strings, ein belongsTo als Fremdschlüsselspalte, `id` nur dort, wo die Tabelle diese Spalte besitzt. Eine vom Admin geladene Relation wird unter ihrem Namen als eigene Spalten des zugehörigen Datensatzes verschachtelt |
| `id` | `string` | Die ID des Datensatzes: sein Primärschlüssel als String, bei einem zusammengesetzten Schlüssel werden die Teile mit `:::` verbunden. Die ID, die `useSidePanel().open` und eine Route erwarten |
| `context` | `RebaseContext` | Vollständiger Rebase-Kontext |

`value({ row, id, context })` erhält dieselben Props.

## Nächste Schritte

- **[Entity Actions](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktionsschaltflächen
- **[Custom Fields](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder

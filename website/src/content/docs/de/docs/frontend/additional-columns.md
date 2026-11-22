---
sourceHash: 3c089e6c404f4635
title: Zusätzliche Spalten
sidebar_label: Zusätzliche Spalten
description: Fügen Sie Sammlungs-Tabellen berechnete/virtuelle Spalten hinzu, die Werte aus Entitätsdaten ableiten.
---

## Übersicht

Zusätzliche Spalten ermöglichen es Ihnen, berechnete oder abgeleitete Daten in der Sammlungs-Tabelle anzuzeigen, ohne sie in der Datenbank zu speichern.

Eine berechnete Spalte gehört zur Tabelle. Der Datensatz zeigt bereits die Werte an, aus denen sie berechnet wird, daher befindet sie sich nicht auf dem Datensatz, es sei denn, das Formular fordert sie an: Benennen Sie ihren `key` in `form.sections` oder `form.sidebar` (siehe [Formular-Layout](/docs/frontend/form-layout/)) oder in den `fields`, die einem `RecordForm` oder `RecordDetail` übergeben werden.

## Definieren zusätzlicher Spalten

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

| Key | Funktion |
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
| `row` | `Record<string, unknown>` | Der Datensatz, wie der Server die Zeile sendet: Datumsangaben als ISO-Strings, ein belongsTo als dessen Fremdschlüssel-Spalte, `id` nur dort, wo die Tabelle diese Spalte hat. Eine Relation, die der Admin geladen hat, ist unter ihrem Namen als die eigenen Spalten des verknüpften Datensatzes verschachtelt |
| `id` | `string` | Die ID des Datensatzes: sein Primärschlüssel als String, bei einem zusammengesetzten Schlüssel die durch `:::` verbundenen Teile. Die ID, die `useSidePanel().open` und eine Route entgegennehmen |
| `context` | `RebaseContext` | Vollständiger Rebase-Kontext |

`value({ row, id, context })` empfängt dieselben Props.

## Nächste Schritte

- **[Entity Actions](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktions-Buttons
- **[Custom Fields](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder

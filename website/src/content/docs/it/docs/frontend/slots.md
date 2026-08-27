---
title: Slot
sidebar_label: Slot
description: Riferimento per tutti gli slot dei punti di estensione UI disponibili in Rebase — posizioni con nome dove puoi iniettare componenti personalizzati.
---

## Panoramica

Gli slot sono punti di estensione UI con nome dove puoi iniettare componenti React personalizzati. Ogni slot ha props tipizzate specifiche per la sua posizione nell'UI. Rebase include 29 slot integrati che coprono la home page, la navigazione, le viste di collezione, i moduli entità, le dashboard e altro.

## Utilizzo

### Tramite la prop `<Rebase>`

```tsx
<Rebase
    client={client}
    slots={[
        {
            slot: "navigation.footer",
            Component: MyNavigationFooter,
            order: 10
        },
        {
            slot: "collection.actions",
            Component: BulkExportButton
        }
    ]}
>
```

### Tramite un plugin

```typescript
const myPlugin: RebasePlugin = {
    key: "my-plugin",
    slots: [
        {
            slot: "home.cards",
            Component: AnalyticsCard,
            order: 20
        }
    ]
};
```

:::note
`order` controlla l'ordine di rendering — i valori più bassi vengono renderizzati per primi. Il valore predefinito è `50`.
:::

## Slot Disponibili

#### Home Page

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Azioni nell'intestazione della home page |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Card aggiuntive nella home page |
| `home.children.start` | `PluginGenericProps` | Contenuto all'inizio della home page |
| `home.children.end` | `PluginGenericProps` | Contenuto alla fine della home page |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compatto all'interno di una card di collezione della home page |
| `home.collection.actions` | `PluginHomePageActionsProps` | Azioni sulle card di collezione della home page |

#### Navigazione

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Sotto il logo nel drawer della barra laterale |
| `navigation.footer` | `NavigationSlotProps` | Sopra l'interruttore di compressione in fondo al drawer |

#### Vista di Collezione

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Azioni della toolbar sul lato finale (dopo le `Actions` di collezione) |
| `collection.actions.start` | `CollectionActionsProps` | Azioni della toolbar sul lato iniziale (accanto ai filtri) |
| `collection.header.action` | `CollectionHeaderActionProps` | Pulsanti di azione delle intestazioni di colonna |
| `collection.add-column` | `CollectionAddColumnProps` | Area "Aggiungi colonna" nell'intestazione della tabella |
| `collection.error` | `CollectionErrorProps` | Visualizzazione dello stato di errore di una collezione |
| `collection.toolbar` | `CollectionToolbarProps` | Widget extra all'interno della riga della toolbar della collezione |
| `collection.empty-state` | `CollectionEmptyStateProps` | Stato vuoto personalizzato quando la collezione non ha dati |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widget sopra la tabella della collezione |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Barra laterale dei filtri personalizzata accanto alla tabella. **Non ancora renderizzato** — dichiarato, ma oggi nulla nel pannello lo renderizza. |

#### Entità / Modulo

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Azioni nella barra delle azioni del modulo entità |
| `form.actions.top` | `PluginFormActionProps` | Azioni sopra la barra delle azioni del modulo |
| `form.before` | `PluginFormActionProps` | Contenuto prima del titolo/elenco dei campi del modulo |
| `form.after` | `PluginFormActionProps` | Contenuto dopo l'elenco dei campi del modulo |
| `entity.row.actions` | `EntityRowActionsProps` | Azioni per riga nelle tabelle entità. **Non ancora renderizzato** — dichiarato, ma oggi nulla nel pannello lo renderizza. |
| `entity.field.before` | `EntityFieldSlotProps` | UI iniettata prima di un singolo campo del modulo. **Non ancora renderizzato** — dichiarato, ma oggi nulla nel pannello lo renderizza. |
| `entity.field.after` | `EntityFieldSlotProps` | UI iniettata dopo un singolo campo del modulo. **Non ancora renderizzato** — dichiarato, ma oggi nulla nel pannello lo renderizza. |

#### Dashboard

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widget sulla dashboard/home page. **Non ancora renderizzato** — dichiarato, ma oggi nulla nel pannello lo renderizza. |

#### Globale

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Componente della barra di ricerca tra collezioni. **Non ancora renderizzato** — dichiarato, ma oggi nulla nel pannello lo renderizza. |
| `shell.toolbar` | `ShellToolbarProps` | Azioni della toolbar di primo livello nella barra dell'app. **Non ancora renderizzato** — dichiarato, ma oggi nulla nel pannello lo renderizza. |

#### Kanban

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI di configurazione della board Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Aggiungi colonna" nella vista kanban |

## Riferimento delle Props degli Slot

Tutti i tipi di props degli slot sono esportati da `@rebasepro/types` e possono essere importati per componenti di slot type-safe:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Ogni tipo di props fornisce accesso al contesto rilevante per la posizione dello slot — metadati di collezione, dati entità, stato di navigazione e altro. Fai riferimento alle singole definizioni di tipo per tutti i dettagli sulle proprietà.

---
sourceHash: 24ecb93e6262aeca
title: Slot
sidebar_label: Slot
description: Riferimento per tutti gli slot dei punti di estensione dell'interfaccia utente disponibili in Rebase — posizioni con nome in cui è possibile iniettare componenti personalizzati.
---

## Panoramica

Gli slot sono punti di estensione della UI con nome in cui è possibile iniettare componenti React personalizzati. Ogni slot dispone di prop tipizzate specifiche per la sua posizione nella UI. Rebase include 29 slot integrati che coprono la home page, la navigazione, le viste di collezione, i form delle entità, le dashboard e altro ancora.

## Utilizzo

### Tramite la prop `<Rebase>`

```tsx no-verify
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

### Tramite plugin

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
`order` controlla l'ordine di rendering: i valori più bassi vengono renderizzati per primi. Il valore predefinito è `50`.
:::

## Slot disponibili

#### Home Page

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Azioni nell'intestazione della home page |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Card aggiuntive nella home page |
| `home.children.start` | `PluginGenericProps` | Contenuto all'inizio della home page |
| `home.children.end` | `PluginGenericProps` | Contenuto alla fine della home page |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compatto all'interno di una card di collezione della home page |
| `home.collection.actions` | `PluginHomePageActionsProps` | Azioni sulle card di collezione della home page |

#### Navigazione

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Sotto il logo nel drawer della barra laterale |
| `navigation.footer` | `NavigationSlotProps` | Sopra il comando di compressione in fondo al drawer |

#### Vista Collezione

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Azioni della toolbar sul lato finale (dopo `Actions` della collezione) |
| `collection.actions.start` | `CollectionActionsProps` | Azioni della toolbar sul lato iniziale (accanto ai filtri) |
| `collection.header.action` | `CollectionHeaderActionProps` | Pulsanti di azione nell'intestazione della colonna |
| `collection.add-column` | `CollectionAddColumnProps` | Area "Aggiungi colonna" nell'intestazione della tabella |
| `collection.error` | `CollectionErrorProps` | Visualizzazione dello stato di errore per una collezione |
| `collection.toolbar` | `CollectionToolbarProps` | Widget aggiuntivi all'interno della riga della toolbar della collezione |
| `collection.empty-state` | `CollectionEmptyStateProps` | Empty-state personalizzato quando la collezione non contiene dati |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widget sopra la tabella della collezione |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Barra laterale dei filtri personalizzata a fianco della tabella. **Non ancora renderizzato** — dichiarato, ma al momento nulla nell'admin lo renderizza. |

#### Entità / Form

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Azioni nella barra delle azioni del form dell'entità |
| `form.actions.top` | `PluginFormActionProps` | Azioni sopra la barra delle azioni del form |
| `form.before` | `PluginFormActionProps` | Contenuto prima del titolo/elenco dei campi del form |
| `form.after` | `PluginFormActionProps` | Contenuto dopo l'elenco dei campi del form |
| `entity.row.actions` | `EntityRowActionsProps` | Azioni per riga nelle tabelle delle entità. **Non ancora renderizzato** — dichiarato, ma al momento nulla nell'admin lo renderizza. |
| `entity.field.before` | `EntityFieldSlotProps` | UI iniettata prima di un singolo campo del form. **Non ancora renderizzato** — dichiarato, ma al momento nulla nell'admin lo renderizza. |
| `entity.field.after` | `EntityFieldSlotProps` | UI iniettata dopo un singolo campo del form. **Non ancora renderizzato** — dichiarato, ma al momento nulla nell'admin lo renderizza. |

#### Dashboard

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widget nella dashboard/home page. **Non ancora renderizzato** — dichiarato, ma al momento nulla nell'admin lo renderizza. |

#### Globale

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Componente barra di ricerca tra collezioni. **Non ancora renderizzato** — dichiarato, ma al momento nulla nell'admin lo renderizza. |
| `shell.toolbar` | `ShellToolbarProps` | Azioni della toolbar di primo livello nell'app bar. **Non ancora renderizzato** — dichiarato, ma al momento nulla nell'admin lo renderizza. |

#### Kanban

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI di configurazione della bacheca Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Aggiungi colonna" nella vista kanban |

## Riferimento alle prop degli slot

Tutti i tipi di prop degli slot sono esportati da `@rebasepro/types` e possono essere importati per componenti di slot type-safe:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Ogni tipo di prop fornisce accesso al contesto pertinente alla posizione dello slot: metadati della collezione, dati dell'entità, stato di navigazione e altro ancora. Fai riferimento alle singole definizioni dei tipi per tutti i dettagli sulle proprietà.

## Correlati

- [Override dei componenti (Swizzling)](/docs/frontend/component-overrides/) — quando uno slot non è sufficiente
- [Estendere Rebase](/docs/frontend/extending/) — il resto della superficie di estensione
- [Plugin](/docs/plugins/) — distribuire il contenuto dello slot come plugin

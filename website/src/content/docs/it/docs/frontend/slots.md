---
sourceHash: 02aa0ee46111d905
title: Slot
sidebar_label: Slot
description: Riferimento per tutti gli slot dei punti di estensione UI disponibili in Rebase — posizioni con nome in cui è possibile inserire componenti personalizzati.
---

## Panoramica

Gli slot sono punti di estensione della UI con nome in cui è possibile inserire componenti React personalizzati. Ciascun slot dispone di prop tipizzate specifiche per la sua posizione nell'interfaccia utente. Rebase include 27 slot integrati che coprono la home page, la navigazione, le viste delle collezioni, i form delle entità, la barra dell'applicazione e altro ancora.

Tutti gli slot presenti nella tabella seguente vengono renderizzati. Se registri un componente per uno di essi e non vedi nulla, il problema risiede nel tuo componente o nelle sue prop, non nello slot — `UNRENDERED_SLOTS` in `@rebasepro/cms-types` è vuoto, e un test ricava tale elenco scansionando i punti di rendering, quindi uno slot non può essere dichiarato qui senza averne uno.

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
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Schede aggiuntive nella home page |
| `home.children.start` | `PluginGenericProps` | Contenuto all'inizio della home page |
| `home.children.end` | `PluginGenericProps` | Contenuto alla fine della home page |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compatto all'interno di una scheda di collezione della home page |
| `home.collection.actions` | `PluginHomePageActionsProps` | Azioni sulle schede di collezione della home page |

#### Navigazione

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Sotto il logo nel drawer della barra laterale |
| `navigation.footer` | `NavigationSlotProps` | Sopra il toggle di compressione in fondo al drawer |

#### Vista Collezione

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Azioni della barra degli strumenti sul lato finale (dopo `Actions` della collezione) |
| `collection.actions.start` | `CollectionActionsProps` | Azioni della barra degli strumenti sul lato iniziale (accanto ai filtri) |
| `collection.header.action` | `CollectionHeaderActionProps` | Pulsanti di azione nell'intestazione di colonna |
| `collection.add-column` | `CollectionAddColumnProps` | Area "Aggiungi colonna" nell'intestazione della tabella |
| `collection.error` | `CollectionErrorProps` | Visualizzazione dello stato di errore per una collezione |
| `collection.toolbar` | `CollectionToolbarProps` | Widget aggiuntivi all'interno della riga della barra degli strumenti della collezione |
| `collection.empty-state` | `CollectionEmptyStateProps` | Stato vuoto personalizzato quando la collezione non contiene dati |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widget sopra la tabella della collezione |

Laddove a uno slot di collezione vengono passati il `tableController` o il
`selectionController` della vista, questi gestiscono le righe così come le invia il server:
`tableController.rows` (con i relativi ID nelle stesse posizioni in
`tableController.ids`, `loading`, `error` e il filtro, la ricerca e
l'ordinamento della barra degli strumenti), e una selezione per ID — `selection` è
`{ type: "rows", ids, rows }` o `{ type: "query", query, excludedIds, count }`,
e `isSelected(id)` interroga una singola riga.

#### Entità / Form

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Azioni nella barra delle azioni del form dell'entità. Riceve l'`id` del record (assente quando è nuovo), `path`, `status`, `collection` e `formContext` |
| `form.actions.top` | `PluginFormActionProps` | Azioni sopra la barra delle azioni del form |
| `form.before` | `PluginFormActionProps` | Contenuto prima del titolo/elenco dei campi del form |
| `form.after` | `PluginFormActionProps` | Contenuto dopo l'elenco dei campi del form |
| `entity.row.actions` | `EntityRowActionsProps` | Azioni per riga nelle tabelle delle collezioni, accanto agli strumenti di riga integrati. Riceve la riga così come inviata dal server (`row`), il relativo `id`, `path`, `collection`, il `selectionController` della tabella e il `context` |
| `entity.field.before` | `EntityFieldSlotProps` | UI inserita prima di un singolo campo del form. Riceve `propertyKey` e `property` del campo, oltre a `path` e `id` del record (assente quando è nuovo) |
| `entity.field.after` | `EntityFieldSlotProps` | UI inserita dopo un singolo campo del form |

#### Globale / Shell

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Ricerca tra collezioni, nella barra dell'applicazione accanto ai breadcrumb |
| `shell.toolbar` | `ShellToolbarProps` | Azioni di primo livello, alla fine della barra dell'applicazione |

:::note
Per un widget nella home page, usa `home.children.start`, `home.children.end`,
`home.cards` o `home.card.widget` — queste sono le quattro posizioni della home page.
Non esiste `dashboard.widget`: accettava solo il contesto, quindi non indicava alcuna
posizione su una pagina che ne aveva già quattro.

Per l'interfaccia utente dei filtri accanto a una tabella, usa `collection.toolbar` o
`collection.widgets`. Non esiste `collection.filter-panel`: l'admin non dispone di alcuna
barra laterale dei filtri in cui effettuare il rendering.
:::

#### Kanban

| Slot | Tipo di prop | Descrizione |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI di configurazione della bacheca kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Aggiungi colonna" nella vista kanban |

## Riferimento per le prop degli slot

Tutti i tipi di prop degli slot sono esportati da `@rebasepro/cms-types` e possono essere importati per garantire componenti slot type-safe:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Ciascun tipo di props fornisce l'accesso al contesto pertinente alla posizione dello slot — metadati della collezione, dati dell'entità, stato di navigazione e altro ancora. Fai riferimento alle definizioni dei singoli tipi per i dettagli completi sulle proprietà.

## Correlati

- [Override dei componenti (Swizzling)](/docs/frontend/component-overrides/) — quando uno slot non è sufficiente
- [Estendere Rebase](/docs/frontend/extending/) — il resto dell'area di estensione
- [Plugin](/docs/plugins/) — distribuire contenuti per gli slot come plugin

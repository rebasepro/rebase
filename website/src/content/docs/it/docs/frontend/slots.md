---
sourceHash: 35cdc0483d3f3fd4
title: Slot
sidebar_label: Slot
description: Riferimento per tutti gli slot dei punti di estensione dell'interfaccia utente disponibili in Rebase — posizioni con nome in cui è possibile iniettare componenti personalizzati.
---

## Panoramica

Gli slot sono punti di estensione dell'interfaccia utente (UI) con nome in cui è possibile iniettare componenti React personalizzati. Ciascuno slot dispone di prop tipizzate specifiche per la sua posizione nell'interfaccia utente. Rebase include 27 slot integrati che coprono la home page, la navigazione, le viste delle collezioni, i moduli delle entità, l'app bar e altro ancora.

Ogni slot nella tabella sottostante viene renderizzato. Se registri un componente per uno slot e non vedi nulla, l'errore risiede nel tuo componente o nelle sue prop, non nello slot — `UNRENDERED_SLOTS` in `@rebasepro/cms-types` è vuoto, e un test ricava tale elenco eseguendo una scansione delle posizioni di rendering, quindi uno slot non può essere dichiarato qui senza averne una.

## Utilizzo

### Tramite prop `<Rebase>`

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
`order` controlla l'ordine di rendering — i valori più bassi vengono renderizzati per primi. Il valore predefinito è `50`.
:::

## Slot disponibili

#### Home Page

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Azioni nell'intestazione della home page |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Schede aggiuntive nella home page |
| `home.children.start` | `PluginGenericProps` | Contenuto all'inizio della home page |
| `home.children.end` | `PluginGenericProps` | Contenuto alla fine della home page |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compatto all'interno di una scheda collezione della home page |
| `home.collection.actions` | `PluginHomePageActionsProps` | Azioni sulle schede delle collezioni della home page |

#### Navigazione

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Sotto il logo nel cassetto della barra laterale (sidebar drawer) |
| `navigation.footer` | `NavigationSlotProps` | Sopra il pulsante di compressione (collapse toggle) in fondo al cassetto |

#### Vista Collezione

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Azioni della barra degli strumenti sul lato finale (dopo `Actions` della collezione) |
| `collection.actions.start` | `CollectionActionsProps` | Azioni della barra degli strumenti sul lato iniziale (accanto ai filtri) |
| `collection.header.action` | `CollectionHeaderActionProps` | Pulsanti di azione nell'intestazione della colonna |
| `collection.add-column` | `CollectionAddColumnProps` | Area "Aggiungi colonna" nell'intestazione della tabella |
| `collection.error` | `CollectionErrorProps` | Visualizzazione dello stato di errore per una collezione |
| `collection.toolbar` | `CollectionToolbarProps` | Widget extra all'interno della riga della barra degli strumenti della collezione |
| `collection.empty-state` | `CollectionEmptyStateProps` | Stato vuoto personalizzato quando la collezione non ha dati |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widget sopra la tabella della collezione |

Quando a uno slot di collezione vengono passati il `tableController` o il
`selectionController` della vista, essi gestiscono le righe così come le invia il server:
`tableController.rows` (con `loading`, `error` e i comandi di filtro,
ricerca e ordinamento della barra degli strumenti) e una selezione per id — `selection` è
`{ type: "rows", ids, rows }` o `{ type: "query", query, excludedIds, count }`,
e `isSelected(id)` interroga una singola riga.

#### Entità / Modulo

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Azioni nella barra delle azioni del modulo entità. Riceve l'`id` del record (assente finché è nuovo), `path`, `status`, `collection` e `formContext` |
| `form.actions.top` | `PluginFormActionProps` | Azioni sopra la barra delle azioni del modulo |
| `form.before` | `PluginFormActionProps` | Contenuto prima del titolo/elenco dei campi del modulo |
| `form.after` | `PluginFormActionProps` | Contenuto dopo l'elenco dei campi del modulo |
| `entity.row.actions` | `EntityRowActionsProps` | Azioni per riga nelle tabelle delle collezioni, accanto agli strumenti integrati della riga. Riceve la riga così come la invia il server (`row`), il suo `id`, `path`, `collection`, il `selectionController` della tabella e il `context` |
| `entity.field.before` | `EntityFieldSlotProps` | Interfaccia utente iniettata prima di un singolo campo del modulo. Riceve `propertyKey` e `property` del campo, e `path` e `id` del record (assente finché è nuovo) |
| `entity.field.after` | `EntityFieldSlotProps` | Interfaccia utente iniettata dopo un singolo campo del modulo |

#### Globale / Shell

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Ricerca tra collezioni, nell'app bar accanto ai breadcrumb |
| `shell.toolbar` | `ShellToolbarProps` | Azioni di livello superiore, alla fine dell'app bar |

:::note
Per un widget nella home page, usa `home.children.start`, `home.children.end`,
`home.cards` o `home.card.widget` — queste sono le quattro posizioni della home page.
Non esiste `dashboard.widget`: prendeva solo il contesto, quindi non specificava alcuna
posizione su una pagina che ne aveva già quattro.

Per l'interfaccia utente dei filtri accanto a una tabella, usa `collection.toolbar` o
`collection.widgets`. Non esiste `collection.filter-panel`: il pannello di amministrazione non ha una
barra laterale per i filtri in cui renderizzarsi.
:::

#### Kanban

| Slot | Tipo di Props | Descrizione |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | Interfaccia di configurazione della bacheca kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Aggiungi colonna" nella vista kanban |

## Riferimento Props degli Slot

Tutti i tipi di prop degli slot sono esportati da `@rebasepro/cms-types` e possono essere importati per componenti slot con type safety:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Ogni tipo di prop fornisce l'accesso al contesto pertinente alla posizione dello slot — metadati della collezione, dati dell'entità, stato di navigazione e altro ancora. Fai riferimento alle definizioni dei singoli tipi per i dettagli completi sulle proprietà.

## Risorse correlate

- [Override dei componenti (Swizzling)](/docs/frontend/component-overrides/) — quando uno slot non è sufficiente
- [Estendere Rebase](/docs/frontend/extending/) — il resto dell'area di estensione
- [Plugin](/docs/plugins/) — distribuire il contenuto dello slot come plugin

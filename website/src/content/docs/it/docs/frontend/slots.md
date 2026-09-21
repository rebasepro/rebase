---
sourceHash: e229c0d2b62d6bee
title: Slot
sidebar_label: Slot
description: Riferimento per tutti gli slot dei punti di estensione dell'interfaccia utente disponibili in Rebase — posizioni con nome in cui è possibile iniettare componenti personalizzati.
---

## Panoramica

Gli slot sono punti di estensione dell'interfaccia utente dotati di nome in cui è possibile iniettare componenti React personalizzati. Ciascun slot dispone di props tipizzate specifiche per la sua posizione nell'interfaccia utente. Rebase include 27 slot integrati che coprono la home page, la navigazione, le viste di collezione, i form delle entità, la barra dell'applicazione e altro ancora.

Tutti gli slot indicati nella tabella seguente vengono renderizzati. Se registri un componente per uno slot e non vedi nulla, il problema risiede nel tuo componente o nelle sue props, non nello slot — `UNRENDERED_SLOTS` in `@rebasepro/cms-types` è vuoto e un test ricava tale elenco scansionando i punti di rendering, pertanto uno slot non può essere dichiarato qui senza averne uno.

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

| Slot | Tipo props | Descrizione |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Azioni nell'intestazione della home page |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Schede aggiuntive nella home page |
| `home.children.start` | `PluginGenericProps` | Contenuto all'inizio della home page |
| `home.children.end` | `PluginGenericProps` | Contenuto alla fine della home page |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compatto all'interno di una scheda di collezione nella home page |
| `home.collection.actions` | `PluginHomePageActionsProps` | Azioni sulle schede di collezione nella home page |

#### Navigazione

| Slot | Tipo props | Descrizione |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Sotto il logo nella barra laterale a scomparsa |
| `navigation.footer` | `NavigationSlotProps` | Sopra il selettore di riduzione (collapse toggle) nella parte inferiore della barra laterale |

#### Vista collezione

| Slot | Tipo props | Descrizione |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Azioni della barra degli strumenti sul lato finale (dopo le `Actions` della collezione) |
| `collection.actions.start` | `CollectionActionsProps` | Azioni della barra degli strumenti sul lato iniziale (accanto ai filtri) |
| `collection.header.action` | `CollectionHeaderActionProps` | Pulsanti di azione nell'intestazione della colonna |
| `collection.add-column` | `CollectionAddColumnProps` | Area "Aggiungi colonna" nell'intestazione della tabella |
| `collection.error` | `CollectionErrorProps` | Visualizzazione dello stato di errore per una collezione |
| `collection.toolbar` | `CollectionToolbarProps` | Widget aggiuntivi all'interno della riga della barra degli strumenti della collezione |
| `collection.empty-state` | `CollectionEmptyStateProps` | Stato vuoto personalizzato quando la collezione non contiene dati |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widget sopra la tabella della collezione |

#### Entità / Form

| Slot | Tipo props | Descrizione |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Azioni nella barra delle azioni del form dell'entità |
| `form.actions.top` | `PluginFormActionProps` | Azioni sopra la barra delle azioni del form |
| `form.before` | `PluginFormActionProps` | Contenuto prima del titolo del form/elenco dei campi |
| `form.after` | `PluginFormActionProps` | Contenuto dopo l'elenco dei campi del form |
| `entity.row.actions` | `EntityRowActionsProps` | Azioni per singola riga nelle tabelle di collezione, accanto agli strumenti di riga integrati |
| `entity.field.before` | `EntityFieldSlotProps` | UI iniettata prima di un singolo campo del form |
| `entity.field.after` | `EntityFieldSlotProps` | UI iniettata dopo un singolo campo del form |

#### Globale / Shell

| Slot | Tipo props | Descrizione |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Ricerca globale tra collezioni, nella barra dell'applicazione accanto ai breadcrumb |
| `shell.toolbar` | `ShellToolbarProps` | Azioni di primo livello, all'estremità della barra dell'applicazione |

:::note
Per un widget nella home page, usa `home.children.start`, `home.children.end`,
`home.cards` o `home.card.widget` — queste sono le quattro posizioni previste per la home page.
Non esiste `dashboard.widget`: riceveva solo il contesto e non faceva riferimento ad alcuna
posizione specifica in una pagina che ne aveva già quattro.

Per l'interfaccia utente dei filtri accanto a una tabella, usa `collection.toolbar` o
`collection.widgets`. Non esiste `collection.filter-panel`: l'interfaccia di amministrazione
non include una barra laterale per i filtri in cui eseguire il rendering.
:::

#### Kanban

| Slot | Tipo props | Descrizione |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI di configurazione della bacheca kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Aggiungi colonna" nella vista kanban |

## Riferimento props degli slot

Tutti i tipi di props degli slot sono esportati da `@rebasepro/types` e possono essere importati per creare componenti di slot type-safe:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Ogni tipo di props fornisce accesso al contesto pertinente alla posizione dello slot — metadati della collezione, dati dell'entità, stato della navigazione e altro ancora. Fai riferimento alle definizioni dei singoli tipi per i dettagli completi sulle proprietà.

## Correlati

- [Override dei componenti (Swizzling)](/docs/frontend/component-overrides/) — quando uno slot non è sufficiente
- [Estendere Rebase](/docs/frontend/extending/) — il resto delle opzioni di estensione
- [Plugin](/docs/plugins/) — distribuire contenuti per slot sotto forma di plugin

---
sourceHash: db22b88374775aed
title: Personalizzare l'Admin
sidebar_label: Personalizzare l'Admin
description: Come personalizzare l'admin di Rebase — building block, hook e posizioni, con ricette testate per singleton, impostazioni per utente, azioni di massa, viste calendario, dashboard e schermate di login personalizzate.
---

L'admin è costruito a partire da parti che puoi usare tu stesso. Per personalizzarlo
scrivi un normale componente React e lo inserisci in una posizione. Questo è l'intero modello:

- **Building block** da renderizzare — la tabella di una collection, il form di un record, l'UI kit.
- **Hook** per i dati, l'utente autenticato, i toast e la navigazione.
- **Posizioni** in cui inserire un componente — una pagina, una modalità di visualizzazione di una collection, un pulsante della barra degli strumenti, una scheda di un record, un campo, uno slot accanto a una parte predefinita, o un override che ne sostituisce una.

Se un building block non fa ciò di cui hai bisogno, copia il suo codice sorgente nel
tuo progetto e modificalo — vedi [Copiare una parte predefinita](#copiare-una-parte-predefinita). Qui
nulla richiede la previa esistenza di un'opzione di configurazione.

## Ricette

Esempi funzionanti e testati sono forniti all'interno di `@rebasepro/cms`, quindi quelli
in `node_modules/@rebasepro/cms/recipes` corrispondono sempre alla versione installata.
Importano solo pacchetti pubblici: copiane uno nel tuo progetto così com'è.

| Ricetta | Cosa illustra |
|---|---|
| `site-settings.tsx` | Un singleton: un record di impostazioni su una pagina dedicata, creato al primo salvataggio. |
| `my-preferences.tsx` | Impostazioni per utente: ogni utente modifica il record associato al proprio uid. |
| `bulk-set-status.tsx` | Un pulsante della barra degli strumenti che aggiorna tutte le righe selezionate. |
| `calendar-view.tsx` | Una nuova modalità di visualizzazione: le righe di una collection su una griglia mensile. |
| `orders-dashboard.tsx` | Una pagina che legge i dati, disegna un grafico e si collega all'admin. |
| `custom-login.tsx` | Sostituzione della schermata di login. |

Il file `README.md` al loro fianco è il riferimento completo per building block, hook e posizioni.

## Esempio: un singleton

Un singleton non è un tipo speciale di collection. È una tabella ordinaria la cui pagina
apre sempre la stessa riga. `EntityFormPanel`, dato un id, modifica quel record e
lo crea con quell'id la prima volta, quindi non è necessario alcun seeding.

```tsx
import React from "react";
import { defineCollection } from "@rebasepro/cms-types";
import type { AppView } from "@rebasepro/cms-types";
import { EntityFormPanel } from "@rebasepro/cms";
import { Container, Typography } from "@rebasepro/ui";

// config/collections/site_settings.ts — `rebase db push` creates the table.
export const siteSettingsCollection = defineCollection({
    name: "Site settings",
    slug: "site_settings",
    table: "site_settings",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        siteName: { name: "Site name", type: "string", validation: { required: true } },
        maintenanceMode: { name: "Maintenance mode", type: "boolean" }
    },
    admin: { hideFromNavigation: true, hideIdFromForm: true }
});

// Add to <RebaseCMS views={[siteSettingsView]}>.
export const siteSettingsView: AppView = {
    slug: "settings/site",
    name: "Site settings",
    icon: "Settings",
    view: (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <EntityFormPanel collection={siteSettingsCollection} id={"site"}/>
        </Container>
    )
};
```

La stessa struttura con `id={user.uid}` (da `useAuthController()`) costituisce una
pagina di impostazioni per singolo utente.

<span class="since-badge" data-since="0.29">Da 0.29</span> Per mostrare solo alcuni
dei campi, passa `fields={["siteName"]}`. Per disporli autonomamente, passa
`layout` con dei `<FormField name="…"/>` nel tuo JSX. In entrambi i casi il form
convalida solo ciò che mostra — vedi
[Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Posizioni

| Per aggiungere… | Inserisci un componente in |
|---|---|
| Una pagina | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Una modalità di visualizzazione per una collection | `collectionViews={[{ key, name, Builder }]}` e `admin.customViews: ["key"]` — vedi [Modalità di visualizzazione](/docs/frontend/view-modes) |
| Un pulsante nella barra degli strumenti di una collection | `admin.Actions: [Component]` |
| Un pulsante su un record | `admin.entityActions` — vedi [Azioni dell'entità](/docs/frontend/entity-actions) |
| Una scheda su un record | `admin.entityViews` — vedi [Viste dell'entità](/docs/frontend/entity-views) |
| Come viene modificato o mostrato un campo | `admin.Field` / `admin.Preview` — vedi [Campi personalizzati](/docs/frontend/custom-fields) |
| Qualcosa accanto a una parte predefinita | `<Rebase slots>` — vedi [Slot](/docs/frontend/slots) |
| Una sostituzione per una parte predefinita | `<Rebase components>` — vedi [Override dei componenti](/docs/frontend/component-overrides) |

## Cosa passa ogni posizione al tuo componente

| Posizione | Il tuo componente riceve |
|---|---|
| Una pagina (`views`) | Nulla: leggi ciò di cui hai bisogno tramite gli hook. Viene renderizzata all'interno del router dell'admin, quindi `useUrlController().navigate(…)` (o `react-router`) funziona. |
| Un `Builder` di modalità di visualizzazione | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (le cui `rows` sono le righe selezionate dalla ricerca e dai filtri della barra degli strumenti, così come inviate dal server; `loading`, `error`, …), `onRowClick(row)` per aprire una riga nel modo in cui la collection apre le righe, `selectionController`, `highlightedIds`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`), `openNewDocument(defaults?)`, `context`. Trasforma `selection` in righe con `resolveSelection({ selection, data: context.data, collection })` — può rappresentare "ogni riga corrispondente al filtro", non solo quelle spuntate. |
| `Builder` di `admin.entityViews` | `EntityCustomViewParams`: `collection`, il record (`entity`, assente durante la sua creazione), i suoi valori non salvati (`modifiedValues`) e il form (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Effettua l'accesso con `authController.emailPasswordLogin?.(email, password)` (opzionale: presente quando l'accesso via email è abilitato); in caso di errore viene generata un'eccezione, presente anche in `authController.authProviderError`. Una volta impostato `authController.user`, l'admin sostituisce automaticamente la schermata. |
| Qualsiasi altro override | Le prop della parte che sostituisce; con `wrap: true`, queste più `OriginalComponent`. |

## Hook

| Hook | Pacchetto | Cosa fornisce |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Un elenco live di righe / una singola riga live, così come inviate dal server. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, tramite il server, in modo da applicare callback e regole di sicurezza. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, per il codice al di fuori dello stato di React; le stesse righe e scritture che eseguono le stesse callback. |
| `useAuthController` | `@rebasepro/app` | L'`user` autenticato (uid, ruoli), accesso e disconnessione. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` per una notifica toast. |
| `useSidePanel` | `@rebasepro/cms` | Apre qualsiasi record nel pannello laterale. |
| `useUrlController` | `@rebasepro/cms` | URL dell'admin e navigazione. |
| `resolveSelection` | `@rebasepro/cms` | Una selezione della tabella — righe spuntate o "tutte le corrispondenti" — sotto forma di righe: `resolveSelection({ selection, data: context.data, collection })`. |

## Copiare una parte predefinita

Quando una parte predefinita è vicina a ciò che desideri, copia il suo codice sorgente dal
repository `@rebasepro/cms` (o `@rebasepro/app`) nel tuo progetto, indirizza i
relativi import verso i pacchetti, modificalo e registralo con il suo nome in
`<Rebase components>`. Tutto ciò che una parte importa è un export pubblico, quindi la copia
compila — per ogni parte eccetto tre, e queste tre eccezioni sono intenzionali:

- **`Collection.View`** è la composizione di ogni modalità di visualizzazione — list, table,
  cards, board, split — con la modifica inline, l'editor di campo popup, la finestra di dialogo
  di eliminazione e lo stato URL della modalità di visualizzazione. Ciò che importa sono i
  componenti interni di tali modalità. Sostituiscine invece una parte (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, che sono tutte
  copiabili), aggiungi una [modalità di visualizzazione](/docs/frontend/view-modes)
  personalizzata, oppure eseguine il wrapping con `wrap: true`.
- **`DetailView`** è la composizione della vista del record: barra di identità, schede,
  inspector e i pulsanti dell'elenco diviso (split list), attorno agli id delle schede che sono valori URL.
  Personalizza un record con le [viste dell'entità](/docs/frontend/entity-views),
  le [azioni dell'entità](/docs/frontend/entity-actions), gli [slot](/docs/frontend/slots) `form.*`,
  oppure gli override di `Entity.Form` e `EditView.FormActions`, che sono copiabili.
- **`HomePage`** è copiabile ad eccezione del riordinamento drag-and-drop di schede e
  gruppi, che non dispone di un'API propria da esportare. Una home page personalizzata
  compone `NavigationGroup`, `NavigationCardBinding` e `FavouritesView` tramite
  `useNavigationStateController().topLevelNavigation`; per estendere quella predefinita,
  usa lo slot `home.cards`.

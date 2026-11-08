---
sourceHash: 6ad8431f3a96e286
title: Personalizzare l'Admin
sidebar_label: Personalizzare l'Admin
description: Come personalizzare l'admin di Rebase — building block, hook e posizioni, con ricette testate per singleton, impostazioni per utente, azioni di massa, viste calendario, dashboard e schermate di login personalizzate.
---

L'admin è costruito a partire da parti che puoi utilizzare tu stesso. Per personalizzarlo
basta scrivere un normale componente React e inserirlo in una posizione designata. Questo è l'intero modello:

- **Building block** che renderizzi — la tabella di una collection, il form di un record, l'UI kit.
- **Hook** per i dati, l'utente autenticato, i toast e la navigazione.
- **Posizioni (Places)** in cui inserire un componente — una pagina, una modalità di visualizzazione di una collection, un pulsante della barra degli strumenti, una scheda del record, un campo, uno slot accanto a una parte predefinita o un override che ne sostituisce una.

Se un building block non fa ciò di cui hai bisogno, copia il suo codice sorgente nel tuo progetto
e modificalo — vedi [Copiare una parte integrata](#copiare-una-parte-integrata). Nulla
qui richiede l'esistenza preventiva di un'opzione di configurazione.

## Ricette

Esempi funzionanti e testati sono inclusi all'interno di `@rebasepro/cms`, quindi quelli presenti in
`node_modules/@rebasepro/cms/recipes` corrispondono sempre alla versione installata. Importano
esclusivamente pacchetti pubblici: puoi copiarne uno nel tuo progetto così com'è.

| Ricetta | Cosa mostra |
|---|---|
| `site-settings.tsx` | Un singleton: un singolo record di impostazioni su una propria pagina, creato al primo salvataggio. |
| `my-preferences.tsx` | Impostazioni per utente: ciascun utente modifica il record associato al proprio uid. |
| `bulk-set-status.tsx` | Un pulsante della barra degli strumenti che aggiorna tutte le righe selezionate. |
| `calendar-view.tsx` | Una nuova modalità di visualizzazione: le righe di una collection su una griglia mensile. |
| `orders-dashboard.tsx` | Una pagina che legge dati, disegna un grafico e si collega all'admin. |
| `custom-login.tsx` | Sostituzione della schermata di login. |

Il file `README.md` al loro fianco costituisce la documentazione di riferimento completa per building block, hook e posizioni.

## Esempio: un singleton

Un singleton non è un tipo speciale di collection. È una normale tabella la cui pagina
apre sempre la stessa riga. Ricevendo un id, `EntityFormPanel` modifica quel record e
lo crea con tale id la prima volta, senza necessità di alcun seeding.

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

La stessa struttura con `id={user.uid}` (da `useAuthController()`) diventa una
pagina di impostazioni per utente.

<span class="since-badge" data-since="0.29">Da 0.29</span> Per mostrare solo una parte
dei campi, passa `fields={["siteName"]}`. Per disporli autonomamente, passa
`layout` con dei `<FormField name="…"/>` nel tuo JSX. In entrambi i casi il form
convalida soltanto ciò che mostra — vedi
[Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Posizioni

| Per aggiungere… | Inserisci un componente in |
|---|---|
| Una pagina | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Una modalità di visualizzazione per una collection | `collectionViews={[{ key, name, Builder }]}` e `admin.customViews: ["key"]` — vedi [Modalità di visualizzazione](/docs/frontend/view-modes) |
| Un pulsante nella barra degli strumenti di una collection | `admin.Actions: [Component]` |
| Un pulsante su un record | `admin.entityActions` — vedi [Entity Actions](/docs/frontend/entity-actions) |
| Una scheda su un record | `admin.entityViews` — vedi [Entity Views](/docs/frontend/entity-views) |
| Il modo in cui un campo viene modificato o mostrato | `admin.Field` / `admin.Preview` — vedi [Campi personalizzati](/docs/frontend/custom-fields) |
| Un elemento accanto a una parte predefinita | `<Rebase slots>` — vedi [Slot](/docs/frontend/slots) |
| Una sostituzione di una parte predefinita | `<Rebase components>` — vedi [Override dei componenti](/docs/frontend/component-overrides) |

## Cosa passa ogni posizione al tuo componente

| Posizione | Il tuo componente riceve |
|---|---|
| Una pagina (`views`) | Nulla: leggi ciò di cui hai bisogno tramite gli hook. Viene renderizzata all'interno del router dell'admin, quindi `useUrlController().navigate(…)` (o `react-router`) funziona regolarmente. |
| Un `Builder` di modalità di visualizzazione | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (le sue `rows` sono le righe selezionate dalla ricerca e dai filtri della barra degli strumenti, così come inviate dal server; `loading`, `error`, …), `onRowClick(row)` per aprire una riga nel modo in cui la collection apre le righe, `selectionController`, `highlightedIds` (gli id sotto forma di stringhe), `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows` e i relativi `ids`), `openNewDocument(defaults?)`, `context`. Trasforma `selection` in righe e relativi id con `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` — può rappresentare "ogni riga corrispondente al filtro", non soltanto quelle spuntate. |
| Un `Builder` di `admin.entityViews` | `EntityCustomViewParams`: `collection`, il record salvato (`row`) e il suo id (`id`), entrambi assenti durante la creazione iniziale, i suoi valori non salvati (`modifiedValues`) e il form (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Effettua l'accesso con `authController.emailPasswordLogin?.(email, password)` (opzionale: presente quando l'accesso via email è abilitato); in caso di errore viene sollevata un'eccezione ed è presente anche su `authController.authProviderError`. Una volta impostato `authController.user`, l'admin sostituisce automaticamente la schermata. |
| Qualsiasi altro override | Le prop della parte che sostituisce; con `wrap: true`, queste con l'aggiunta di `OriginalComponent`. |

## Hook

| Hook | Pacchetto | Cosa fornisce |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Un elenco live di righe / una singola riga live, così come inviate dal server. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, tramite il server, in modo che si applichino callback e regole di sicurezza. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, per il codice al di fuori dello stato di React; le stesse righe e scritture che eseguono gli stessi callback. |
| `useAuthController` | `@rebasepro/app` | L'`user` autenticato (uid, ruoli), accesso e disconnessione. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` per un toast. |
| `useSidePanel` | `@rebasepro/cms` | Apre qualsiasi record nel pannello laterale. |
| `useUrlController` | `@rebasepro/cms` | URL dell'admin e navigazione. |
| `resolveSelection` | `@rebasepro/cms` | Una selezione di tabella — righe spuntate o "tutte le corrispondenti" — sotto forma di righe e dei relativi id: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copiare una parte integrata

Quando una parte predefinita è vicina a ciò che desideri, copia il suo codice sorgente dal repository
`@rebasepro/cms` (o `@rebasepro/app`) all'interno del tuo progetto, reindirizza i suoi import relativi
verso i pacchetti, modificala e registrala con il suo nome in
`<Rebase components>`. Tutto ciò che una parte importa è un export pubblico, quindi la copia
compilerà senza problemi — per ogni parte tranne tre, e queste tre eccezioni sono deliberate:

- **`Collection.View`** è la composizione di ogni modalità di visualizzazione — lista, tabella,
  schede (cards), bacheca (board), vista divisa (split) — con modifica inline, l'editor popup dei campi,
  la finestra di dialogo di eliminazione e lo stato dell'URL della modalità di visualizzazione. Ciò che importa sono i componenti
  interni di tali modalità. Sostituisci invece una singola parte di essa (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, tutte facilmente copiabili), aggiungi una
  tua [modalità di visualizzazione](/docs/frontend/view-modes), oppure avvolgila
  con `wrap: true`.
- **`DetailView`** è la composizione della vista record: barra di identità, schede,
  inspector e i pulsanti dell'elenco diviso, attorno a id di schede che sono valori URL.
  Personalizza un record con le [entity view](/docs/frontend/entity-views),
  le [entity action](/docs/frontend/entity-actions), gli [slot](/docs/frontend/slots) `form.*`,
  oppure gli override `Entity.Form` ed
  `EditView.FormActions`, che sono copiabili.
- **`HomePage`** è copiabile ad eccezione del riordinamento drag-and-drop di schede e
  gruppi, che non dispone di un'API pubblica da esportare. Una home page personalizzata
  compone `NavigationGroup`, `NavigationCardBinding` e `FavouritesView` su
  `useNavigationStateController().topLevelNavigation`; per estendere quella predefinita,
  utilizza lo slot `home.cards`.

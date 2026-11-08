---
sourceHash: 31ccfe9d60f8eafe
title: Personalizzazione dell'Admin
sidebar_label: Personalizzazione dell'Admin
description: Come personalizzare l'admin di Rebase — building block, hook e posizioni, con ricette testate per singleton, impostazioni per utente, azioni di massa, viste calendario, dashboard e schermate di login personalizzate.
---

L'admin è composto da parti che puoi usare direttamente. Per personalizzarlo, scrivi
un normale componente React e inseriscilo in una posizione. Questo è l'intero modello:

- **Building block** che renderizzi — la tabella di una collection, il form di un singolo record, l'UI kit.
- **Hook** per i dati, l'utente autenticato, i toast e la navigazione.
- **Posizioni** in cui inserire un componente — una pagina, una modalità di visualizzazione di una collection, un pulsante della toolbar, una scheda del record, un campo, uno slot accanto a una parte integrata o un override che ne sostituisce una.

Se un building block non fa ciò di cui hai bisogno, copia il suo codice sorgente nel tuo progetto
e modificalo — vedi [Copiare una parte integrata](#copiare-una-parte-integrata). Non è necessario
che esista preventivamente alcuna opzione di configurazione.

## Ricette

Esempi funzionanti e testati sono inclusi in `@rebasepro/cms`, quindi quelli che si trovano in
`node_modules/@rebasepro/cms/recipes` corrispondono sempre alla versione installata. Essi
importano solo pacchetti pubblici: copiane uno nel tuo progetto così com'è.

| Ricetta | Cosa mostra |
|---|---|
| `site-settings.tsx` | Un singleton: un record di impostazioni su una propria pagina, creato al primo salvataggio. |
| `my-preferences.tsx` | Impostazioni per utente: ciascun utente modifica il record associato al proprio uid. |
| `bulk-set-status.tsx` | Un pulsante della toolbar che aggiorna ogni riga selezionata. |
| `calendar-view.tsx` | Una nuova modalità di visualizzazione: le righe di una collection su una griglia mensile. |
| `orders-dashboard.tsx` | Una pagina che legge i dati, disegna un grafico e si collega all'admin. |
| `custom-login.tsx` | Sostituzione della schermata di login. |

Il file `README.md` al loro fianco è il riferimento completo per building block, hook e posizioni.

## Esempio: un singleton

Un singleton non è un tipo speciale di collection. È una tabella ordinaria la cui pagina
apre sempre la stessa riga. Passandogli un ID, `EntityFormPanel` modifica quel record e,
la prima volta, lo crea con quell'ID, quindi non è necessario eseguire alcun seed preliminare dei dati.

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
            <EntityFormPanel collection={siteSettingsCollection} entityId={"site"}/>
        </Container>
    )
};
```

La stessa struttura con `entityId={user.uid}` (ottenuto da `useAuthController()`) funge da
pagina di impostazioni per utente.

<span class="since-badge" data-since="0.29">Da 0.29</span> Per mostrare solo alcuni dei
campi, passa `fields={["siteName"]}`. Per disporli autonomamente, passa
`layout` con i componenti `<FormField name="…"/>` all'interno del tuo JSX. In entrambi i casi il form
convalida solo ciò che mostra — vedi
[Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Posizioni

| Per aggiungere… | Inserisci un componente in |
|---|---|
| Una pagina | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Una modalità di visualizzazione per una collection | `collectionViews={[{ key, name, Builder }]}` e `admin.customViews: ["key"]` — vedi [Modalità di visualizzazione](/docs/frontend/view-modes) |
| Un pulsante nella toolbar di una collection | `admin.Actions: [Component]` |
| Un pulsante su un record | `admin.entityActions` — vedi [Entity Actions](/docs/frontend/entity-actions) |
| Una scheda su un record | `admin.entityViews` — vedi [Entity Views](/docs/frontend/entity-views) |
| La modalità di modifica o visualizzazione di un campo | `admin.Field` / `admin.Preview` — vedi [Campi personalizzati](/docs/frontend/custom-fields) |
| Qualcosa accanto a una parte integrata | `<Rebase slots>` — vedi [Slot](/docs/frontend/slots) |
| Una sostituzione di una parte integrata | `<Rebase components>` — vedi [Override dei componenti](/docs/frontend/component-overrides) |

## Cosa riceve il tuo componente in ogni posizione

| Posizione | Il tuo componente riceve |
|---|---|
| Una pagina (`views`) | Nulla: leggi ciò di cui hai bisogno tramite gli hook. Viene renderizzata all'interno del router dell'admin, quindi `useUrlController().navigate(…)` (o `react-router`) funziona regolarmente. |
| Un `Builder` di una modalità di visualizzazione | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (i cui `data` sono le righe selezionate dalla ricerca e dai filtri della toolbar, `dataLoading`, …), `onEntityClick(entity)` per aprire una riga nel modo in cui la collection apre le righe, `selectionController`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `clearSelection()`), `tableController`, `openNewDocument(defaults?)`. Trasforma `selection` in righe con `resolveSelection({ selection, accessor: useData().collection(path) })` — può rappresentare "ogni riga corrispondente al filtro", non soltanto quelle spuntate. |
| Un `Builder` di `admin.entityViews` | `EntityCustomViewParams`: `collection`, il record (`entity`, assente durante la creazione), i suoi valori non salvati (`modifiedValues`) e il form (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Esegui l'accesso con `authController.emailPasswordLogin?.(email, password)` (opzionale: presente quando l'accesso via email è abilitato); in caso di errore viene generata un'eccezione, presente anche in `authController.authProviderError`. Una volta impostato `authController.user`, l'admin sostituisce automaticamente la schermata. |
| Qualsiasi altro override | Le prop della parte che sostituisce; con `wrap: true`, queste più `OriginalComponent`. |

## Hook

| Hook | Pacchetto | Cosa fornisce |
|---|---|---|
| `useData` | `@rebasepro/app` | `useData().collection("orders").find / findById / create / update / delete`, tramite il server, in modo che si applichino callback e regole di sicurezza. |
| `useCollection` / `useFetch` | `@rebasepro/app` | Un elenco in tempo reale di righe / un record in tempo reale. |
| `useAuthController` | `@rebasepro/app` | L'`user` autenticato (uid, ruoli), accesso e disconnessione. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` per un toast. |
| `useSidePanel` | `@rebasepro/cms` | Apre qualsiasi record nel pannello laterale. |
| `useUrlController` | `@rebasepro/cms` | URL dell'admin e navigazione. |
| `resolveSelection` | `@rebasepro/cms` | Una selezione della tabella — righe spuntate o "tutte le corrispondenti" — sotto forma di righe. |

## Copiare una parte integrata

Quando una parte integrata è vicina a ciò di cui hai bisogno, copia il suo codice sorgente dal
repository `@rebasepro/cms` (o `@rebasepro/app`) nel tuo progetto, indirizza i suoi
import relativi verso i pacchetti, modificala e registrala con il suo nome in
`<Rebase components>`. Tutto ciò che una parte importa è un export pubblico, quindi la copia
compila — per ogni parte tranne tre, e queste tre eccezioni sono intenzionali:

- **`Collection.View`** è la composizione di ogni modalità di visualizzazione — elenco, tabella,
  schede, board, split — con modifica inline, l'editor di campo popup, la finestra di dialogo
  di eliminazione e lo stato URL della modalità di visualizzazione. Ciò che importa sono i
  componenti interni di tali modalità. Sostituisci invece una sua parte (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, che sono tutte copiabili),
  aggiungi una tua [modalità di visualizzazione](/docs/frontend/view-modes) o esegui il wrap
  con `wrap: true`.
- **`DetailView`** è la composizione della vista del record: barra di identità, schede,
  inspector e i pulsanti dell'elenco diviso, attorno agli ID delle schede che sono valori URL.
  Personalizza un record con le [entity view](/docs/frontend/entity-views),
  le [entity action](/docs/frontend/entity-actions), gli [slot](/docs/frontend/slots) `form.*`
  o gli override `Entity.Form` ed `EditView.FormActions`, che sono copiabili.
- **`HomePage`** è copiabile tranne per il riordinamento drag-and-drop di schede e
  gruppi, che non ha una propria API da esportare. Una home page personalizzata
  compone `NavigationGroup`, `NavigationCardBinding` e `FavouritesView` sopra
  `useNavigationStateController().topLevelNavigation`; per estendere quella predefinita,
  usa lo slot `home.cards`.

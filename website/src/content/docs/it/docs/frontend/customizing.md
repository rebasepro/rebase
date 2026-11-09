---
sourceHash: f28407f4fb9eb7a2
title: Personalizzazione dell'Admin
sidebar_label: Personalizzazione dell'Admin
description: Come personalizzare l'admin di Rebase — building block, hook e posizioni, con ricette testate per singleton, impostazioni per utente, azioni di gruppo, viste calendario, dashboard e schermate di login personalizzate.
---

L'admin è costruito a partire da elementi che puoi utilizzare tu stesso. Per personalizzarlo scrivi un normale componente React e lo inserisci in una posizione. Questo è l'intero modello:

- **Building block** da renderizzare — la tabella di una collection, il form di un record, il kit UI.
- **Hook** per i dati, l'utente autenticato, i toast e la navigazione.
- **Posizioni (places)** in cui inserire un componente — una pagina, una modalità di visualizzazione di una collection, un pulsante della toolbar, una scheda di un record, un campo, uno slot accanto a una parte integrata o un override che ne sostituisce una.

Se un building block non fa ciò di cui hai bisogno, copia il suo codice sorgente nel tuo progetto e modificalo — vedi [Copiare una parte integrata](#copiare-una-parte-integrata). Nessun elemento qui richiede che esista prima un'opzione di configurazione.

## Ricette

Esempi funzionanti e testati sono inclusi all'interno di `@rebasepro/cms`, quindi quelli in `node_modules/@rebasepro/cms/recipes` corrispondono sempre alla versione installata. Importano solo pacchetti pubblici: puoi copiarne uno nel tuo progetto così com'è.

| Recipe | Cosa mostra |
|---|---|
| `site-settings.tsx` | Un singleton: un record di impostazioni su una propria pagina, creato al primo salvataggio. |
| `my-preferences.tsx` | Impostazioni per utente: ciascun utente modifica il record associato al proprio uid. |
| `bulk-set-status.tsx` | Un pulsante della toolbar che aggiorna ogni riga selezionata. |
| `calendar-view.tsx` | Una nuova modalità di visualizzazione: le righe di una collection su una griglia mensile. |
| `orders-dashboard.tsx` | Una pagina che legge i dati, disegna un grafico e crea collegamenti all'interno dell'admin. |
| `custom-login.tsx` | Sostituzione della schermata di login. |

Il file `README.md` situato accanto ad essi è il riferimento completo per building block, hook e posizioni.

## Esempio: un singleton

Un singleton non è un tipo speciale di collection. È una normale tabella la cui pagina apre sempre la stessa riga. Ricevendo un id, `RecordForm` modifica quel record e lo crea con quell'id la prima volta, quindi non è necessario alcun seeding.

```tsx
import React from "react";
import { defineCollection } from "@rebasepro/cms-types";
import type { AppView } from "@rebasepro/cms-types";
import { RecordForm } from "@rebasepro/cms";
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
            <RecordForm collection={siteSettingsCollection} id={"site"}/>
        </Container>
    )
};
```

La stessa struttura con `id={user.uid}` (da `useAuthController()`) funge da pagina delle impostazioni per utente.

Per mostrare solo alcuni dei campi, passa `fields={["siteName"]}`. Per disporli autonomamente, passa `layout` con dei `<FormField name="…"/>` nel tuo JSX. In entrambi i casi il form convalida solo ciò che mostra — consulta [Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Posizioni (Places)

| Per aggiungere… | Inserisci un componente in |
|---|---|
| Una pagina | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Una modalità di visualizzazione per una collection | `collectionViews={[{ key, name, Builder }]}` e `admin.customViews: ["key"]` — vedi [View Modes](/docs/frontend/view-modes) |
| Un pulsante nella toolbar di una collection | `admin.Actions: [Component]` |
| Un pulsante su un record | `admin.entityActions` — vedi [Entity Actions](/docs/frontend/entity-actions) |
| Una scheda su un record | `admin.entityViews` — vedi [Entity Views](/docs/frontend/entity-views) |
| Come un campo viene modificato o mostrato | `admin.Field` / `admin.Preview` — vedi [Custom Fields](/docs/frontend/custom-fields) |
| Qualcosa accanto a una parte integrata | `<Rebase slots>` — vedi [Slots](/docs/frontend/slots) |
| Una sostituzione per una parte integrata | `<Rebase components>` — vedi [Component Overrides](/docs/frontend/component-overrides) |

## Cosa riceve il tuo componente da ciascuna posizione

| Posizione | Il tuo componente riceve |
|---|---|
| Una pagina (`views`) | Nulla: leggi ciò di cui hai bisogno tramite gli hook. Viene renderizzata all'interno del router dell'admin, quindi `useUrlController().navigate(…)` (o `react-router`) funziona. |
| Il `Builder` di una modalità di visualizzazione | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (le sue `rows` sono le righe selezionate dalla ricerca e dai filtri della toolbar, così come inviate dal server; `loading`, `error`, …), `onRowClick(row)` per aprire una riga nello stesso modo in cui la collection apre le righe, `selectionController`, `highlightedIds` (id come stringhe), `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows` e i relativi `ids`), `openNewDocument(defaults?)`, `context`. Converti `selection` in righe e relativi id con `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` — può rappresentare "ogni riga corrispondente al filtro", non solo quelle selezionate. |
| Il `Builder` di `admin.entityViews` | `EntityCustomViewParams`: `collection`, il record salvato (`row`) e il suo id (`id`), entrambi assenti durante la fase di creazione, i suoi valori non salvati (`modifiedValues`) e il form (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Effettua l'accesso con `authController.emailPasswordLogin?.(email, password)` (opzionale: presente quando l'accesso via email è abilitato); in caso di errore viene lanciata un'eccezione ed è presente anche su `authController.authProviderError`. Una volta impostato `authController.user`, l'admin sostituisce automaticamente la schermata. |
| Qualsiasi altro override | Le prop della parte che sostituisce; con `wrap: true`, queste più `OriginalComponent`. |

## Hook

| Hook | Pacchetto | Cosa fornisce |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Un elenco live di righe / una singola riga live, così come inviate dal server. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, tramite il server, in modo da applicare callback e regole di sicurezza. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, per il codice esterno allo stato di React; le stesse righe e operazioni di scrittura che eseguono le medesime callback. |
| `useAuthController` | `@rebasepro/app` | L'`user` autenticato (uid, ruoli), login e logout. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` per un toast. |
| `useSidePanel` | `@rebasepro/cms` | Apre qualsiasi record nel pannello laterale. |
| `useUrlController` | `@rebasepro/cms` | URL dell'admin e navigazione. |
| `resolveSelection` | `@rebasepro/cms` | Una selezione di tabella — righe spuntate o "tutte le corrispondenti" — sotto forma di righe e relativi id: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copiare una parte integrata

Quando una parte integrata si avvicina a ciò che desideri, copia il suo codice sorgente dal repository `@rebasepro/cms` (o `@rebasepro/app`) nel tuo progetto, imposta i suoi import relativi verso i pacchetti, modificalo e registralo sotto il suo nome in `<Rebase components>`. Tutto ciò che una parte importa è un export pubblico, quindi la copia compila — per qualsiasi parte tranne tre, e l'eccezione per queste tre è intenzionale:

- **`Collection.View`** è la composizione di ogni modalità di visualizzazione — lista, tabella, schede, bacheca, split — con editing inline, l'editor del campo in popup, la finestra di dialogo di eliminazione e lo stato URL della modalità di visualizzazione. Ciò che importa sono i componenti interni di tali modalità. Sostituisci invece una sua parte (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, che sono tutte copiabili), aggiungi una [modalità di visualizzazione](/docs/frontend/view-modes) personalizzata, oppure esegui il wrap con `wrap: true`.
- **`DetailView`** è la composizione della vista del record: barra di identità, schede, inspector e i pulsanti dell'elenco diviso, attorno agli id delle schede che sono valori URL. Personalizza un record con [entity views](/docs/frontend/entity-views), [entity actions](/docs/frontend/entity-actions), gli [slot](/docs/frontend/slots) `form.*` oppure gli override `Entity.Form` ed `EditView.FormActions`, che sono copiabili.
- **`HomePage`** è copiabile ad eccezione del riordinamento drag-and-drop di schede e gruppi, che non dispone di una propria API da esportare. Una home page personalizzata compone `NavigationGroup`, `NavigationCardBinding` e `FavouritesView` su `useNavigationStateController().topLevelNavigation`; per aggiungerne alla versione predefinita, usa lo slot `home.cards`.

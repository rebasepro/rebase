---
sourceHash: 362c7b70fede8ad5
title: Personalizzazione dell'Admin
sidebar_label: Personalizzazione dell'Admin
description: Come personalizzare l'admin di Rebase — componenti di base, hook e punti di inserimento, con ricette testate per singleton, impostazioni per utente, azioni di massa, viste a calendario, dashboard e schermate di login personalizzate.
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

L'admin è costruito a partire da elementi modulari che puoi utilizzare tu stesso. Per personalizzarlo, basta scrivere
un comune componente React e posizionarlo in un punto di inserimento. Questo è l'intero modello:

- **Componenti di base** (building blocks) da renderizzare — la tabella di una collection, il form di un singolo record, il kit UI.
- **Hook** per i dati, l'utente autenticato, notifiche toast e navigazione.
- **Punti di inserimento** (places) dove collocare un componente — una pagina, una modalità di visualizzazione, un pulsante della toolbar, una scheda (tab) di un record, un campo, uno slot accanto a un elemento nativo o un override che ne sostituisce uno.

Se un componente di base non soddisfa le tue esigenze, copiane il codice sorgente nel tuo progetto
e modificalo — vedi [Copiare un elemento nativo](#copiare-un-elemento-nativo). Nessun
elemento richiede una preventiva opzione di configurazione per poter esistere. I punti di inserimento a livello di tabella sono
opzioni di [`customizeTable`](/docs/frontend/customize-table/).

## Ricette

Esempi funzionanti e testati sono inclusi direttamente in `@rebasepro/cms`, in modo che quelli presenti in
`node_modules/@rebasepro/cms/recipes` corrispondano sempre alla versione installata. Importano
esclusivamente pacchetti pubblici: puoi copiarne uno nel tuo progetto così com'è.

| Ricetta | Cosa illustra |
|---|---|
| `site-settings.tsx` | Un singleton: un singolo record di impostazioni su una propria pagina, creato al primo salvataggio. |
| `my-preferences.tsx` | Impostazioni per utente: ciascun utente modifica il record associato al proprio uid. |
| `bulk-set-status.tsx` | Un pulsante della toolbar che aggiorna tutte le righe selezionate. |
| `calendar-view.tsx` | Una nuova modalità di visualizzazione: le righe di una collection su una griglia mensile. |
| `orders-dashboard.tsx` | Una pagina che legge dati, disegna un grafico e si collega all'admin. |
| `custom-login.tsx` | Sostituzione della schermata di login. |

Il file `README.md` posizionato accanto ad esse rappresenta la guida di riferimento completa per componenti di base, hook e punti di inserimento.

## Esempio: un singleton

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un singleton non è un tipo speciale di tabella. È una normale tabella la cui pagina
apre sempre la stessa riga. Ricevendo un id, `RecordForm` modifica quel record e
lo crea con quell'id la prima volta, eliminando la necessità di seeding preventivo.

```ts
// backend/schema/site_settings.ts: `rebase db push` creates the table.
import { defineTable, col } from "@rebasepro/server/schema";

export const siteSettings = defineTable("site_settings", {
    columns: {
        id:              col.text().primaryKey(),
        siteName:        col.text().notNull(),
        maintenanceMode: col.boolean().notNull().default(false),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/site_settings.tsx
import React from "react";
import { customizeTable, RecordForm } from "@rebasepro/cms";
import type { AppView } from "@rebasepro/cms-types";
import { Container, Typography } from "@rebasepro/ui";
import type { siteSettings } from "../../../backend/schema/site_settings";

// Reachable only through the page below, not from the drawer.
export const siteSettingsCms = customizeTable<typeof siteSettings>("site_settings", {
    name: "Site settings",
    hideFromNavigation: true,
    hideIdFromForm: true,
});

// Add to <RebaseCMS views={[siteSettingsView]}>.
export const siteSettingsView: AppView = {
    slug: "settings/site",
    name: "Site settings",
    icon: "Settings",
    view: (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <RecordForm collection={"site_settings"} id={"site"}/>
        </Container>
    )
};
```

La stessa struttura con `id={user.uid}` (da `useAuthController()`) costituisce una
pagina di impostazioni per utente.

Per mostrare solo alcuni
dei campi, passa `fields={["siteName"]}`. Per disporli autonomamente, passa
`layout` con i componenti `<FormField name="…"/>` nel tuo JSX. In entrambi i casi, il form
valida unicamente ciò che mostra — vedi
[Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Punti di inserimento

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Per aggiungere… | Posiziona un componente in |
|---|---|
| Una pagina | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Una modalità di visualizzazione per una tabella | `customViews` nel relativo `customizeTable`, o `<RebaseCMS collectionViews>` e la chiave — vedi [Modalità di visualizzazione personalizzate](/docs/frontend/extending#custom-view-modes) |
| Un pulsante nella toolbar di una collection | `Actions: [Component]` in `customizeTable` |
| Un pulsante su un record | `entityActions` in `customizeTable` — vedi [Azioni sulle entità](/docs/frontend/entity-actions) |
| Una scheda (tab) su un record | `entityViews` in `customizeTable` — vedi [Viste sulle entità](/docs/frontend/entity-views) |
| Come un campo viene modificato o mostrato | `Field` / `Preview` sul campo in `customizeTable` — vedi [Campi personalizzati](/docs/frontend/custom-fields) |
| Qualcosa accanto a un elemento nativo | `<Rebase slots>` — vedi [Slot](/docs/frontend/slots) |
| Un sostituto per un elemento nativo | `<Rebase components>` — vedi [Override dei componenti](/docs/frontend/component-overrides) |

## Cosa riceve il tuo componente in ogni punto

| Punto di inserimento | Il tuo componente riceve |
|---|---|
| Una pagina (`views`) | Nulla: leggi ciò di cui hai bisogno tramite gli hook. Viene renderizzata all'interno del router dell'admin, quindi `useUrlController().navigate(…)` (o `react-router`) funziona regolarmente. |
| Un `Builder` per una vista | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (le sue `rows` sono le righe selezionate dai filtri e dalla ricerca della toolbar, così come inviate dal server; `loading`, `error`, …), `onRowClick(row)` per aprire una riga nello stesso modo in cui la collection apre le righe, `selectionController`, `highlightedIds` (id come stringhe), `emptyComponent`. |
| `Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`, e i relativi `ids`), `openNewDocument(defaults?)`, `context`. Converti `selection` in righe e relativi id con `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` — può rappresentare "ogni riga che corrisponde al filtro", non solo quelle selezionate manualmente. |
| Un `Builder` in `entityViews` | `EntityCustomViewParams`: `collection`, il record salvato (`row`) e il relativo id (`id`), entrambi assenti durante la fase di creazione, i relativi valori non salvati (`modifiedValues`) e il form (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Effettua l'accesso con `authController.emailPasswordLogin?.(email, password)` (opzionale: presente quando l'accesso via email è abilitato); in caso di errore viene lanciata un'eccezione ed è presente anche in `authController.authProviderError`. Una volta impostato `authController.user`, l'admin sostituisce automaticamente la schermata. |
| Qualsiasi altro override | Le prop della parte che sostituisce; con `wrap: true`, quelle prop più `OriginalComponent`. |

## Hook

| Hook | Pacchetto | Cosa fornisce |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Un elenco live di righe / una singola riga live, esattamente come trasmesse dal server. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, tramite il server, in modo che si applichino gli hook di tabella e la sicurezza a livello di riga (RLS). |
| `useRebaseContext` | `@rebasepro/app` | `context.data.orders.find / findById / create / update / delete`, per codice al di fuori dello stato di React; le stesse righe e operazioni di scrittura che eseguono gli stessi hook. |
| `useAuthController` | `@rebasepro/app` | L'utente autenticato (`user`, con uid e ruoli), metodi di login e logout. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` per mostrare un toast. |
| `useSidePanel` | `@rebasepro/cms` | Consente di aprire qualsiasi record nel pannello laterale. |
| `useUrlController` | `@rebasepro/cms` | URL e navigazione dell'admin. |
| `resolveSelection` | `@rebasepro/cms` | Una selezione di tabella — righe spuntate o "tutte quelle corrispondenti" — sotto forma di righe e relativi id: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copiare un elemento nativo

Quando un elemento nativo è simile a ciò che ti serve, copiane il sorgente dal
repository `@rebasepro/cms` (o `@rebasepro/app`) nel tuo progetto, adatta i relativi import
ai pacchetti, modificalo e registralo con il suo nome in
`<Rebase components>`. Tutto ciò che un elemento importa è esportato pubblicamente, quindi la copia
compilerà senza problemi — per ogni elemento tranne tre, e l'eccezione per questi tre è intenzionale:

- **`Collection.View`** è la composizione di tutte le modalità di visualizzazione — elenco, tabella,
  schede, lavagna, divisa — comprensiva di modifica inline, editor a comparsa dei campi, finestra di dialogo
  di eliminazione e stato dell'URL della modalità di visualizzazione. Ciò che importa sono i meccanismi
  interni di tali modalità. Sostituiscine invece una parte (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, che sono tutti
  copiabili), aggiungi una [modalità di visualizzazione](/docs/frontend/view-modes) personalizzata, oppure esegui un wrapping
  con `wrap: true`.
- **`DetailView`** è la composizione della vista del record: barra di identità, schede,
  inspector e pulsanti dell'elenco diviso, attorno a id di schede che sono valori di URL.
  Personalizza un record tramite [viste sulle entità](/docs/frontend/entity-views),
  [azioni sulle entità](/docs/frontend/entity-actions), gli [slot](/docs/frontend/slots)
  `form.*`, oppure gli override di `Entity.Form` e
  `EditView.FormActions`, che sono copiabili.
- **`HomePage`** è copiabile eccetto per il riordinamento drag-and-drop di schede e
  gruppi, che non dispone di un'API esportata dedicata. Una home page personalizzata
  compone `NavigationGroup`, `NavigationCardBinding` e `FavouritesView` basandosi su
  `useNavigationStateController().topLevelNavigation`; per estendere quella predefinita,
  utilizza lo slot `home.cards`.

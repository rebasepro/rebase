---
sourceHash: cfdbc982479ba3b1
title: Personalizzare l'Admin
sidebar_label: Personalizzare l'Admin
description: Come personalizzare l'admin di Rebase — componenti di base, hook e posizioni, con ricette testate per singleton, impostazioni per utente, azioni di massa, viste calendario, dashboard e schermate di login personalizzate.
---

L'admin è costruito a partire da elementi che puoi utilizzare tu stesso. Per personalizzarlo,
basta scrivere un normale componente React e inserirlo in una posizione. Questo è l'intero modello:

- **Componenti di base** che renderizzi — la tabella di una collection, il form di un record, il kit UI.
- **Hook** per i dati, l'utente autenticato, i toast e la navigazione.
- **Posizioni** in cui inserire un componente — una pagina, una modalità di visualizzazione di una collection, un pulsante della toolbar, una scheda di un record, un campo, uno slot accanto a un elemento integrato o un override che ne sostituisce uno.

Se un componente di base non fa al caso tuo, copia il suo codice sorgente nel tuo progetto
e modificalo. Nulla qui richiede l'esistenza preventiva di un'opzione di configurazione.

## Ricette

Esempi funzionanti e testati sono inclusi all'interno di `@rebasepro/cms`, quindi quelli in
`node_modules/@rebasepro/cms/recipes` corrispondono sempre alla versione installata. Importano
solo pacchetti pubblici: puoi copiarne uno nel tuo progetto così com'è.

| Ricetta | Cosa mostra |
|---|---|
| `site-settings.tsx` | Un singleton: un record di impostazioni su una pagina dedicata, creato al primo salvataggio. |
| `my-preferences.tsx` | Impostazioni per utente: ciascun utente modifica il record identificato dal proprio uid. |
| `bulk-set-status.tsx` | Un pulsante nella toolbar che aggiorna ogni riga selezionata. |
| `calendar-view.tsx` | Una nuova modalità di visualizzazione: le righe di una collection su una griglia mensile. |
| `orders-dashboard.tsx` | Una pagina che legge i dati, disegna un grafico e rimanda all'admin. |
| `custom-login.tsx` | Sostituzione della schermata di login. |

Il file `README.md` al loro fianco è la documentazione di riferimento completa di componenti di base, hook e posizioni.

## Esempio: un singleton

Un singleton non è un tipo speciale di collection. È una tabella ordinaria la cui pagina
apre sempre la stessa riga. `EntityFormPanel`, a cui viene fornito un id, modifica quel record
e lo crea sotto quell'id la prima volta, quindi non è necessario alcun seeding.

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

La stessa struttura con `entityId={user.uid}` (da `useAuthController()`) costituisce una
pagina di impostazioni per utente.

## Posizioni

| Per aggiungere… | Inserisci un componente in |
|---|---|
| Una pagina | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Una modalità di visualizzazione per una collection | `collectionViews={[{ key, name, Builder }]}` e `admin.customViews: ["key"]` — vedi [Modalità di visualizzazione](/docs/frontend/view-modes) |
| Un pulsante nella toolbar di una collection | `admin.Actions: [Component]` |
| Un pulsante su un record | `admin.entityActions` — vedi [Azioni sull'entità](/docs/frontend/entity-actions) |
| Una scheda su un record | `admin.entityViews` — vedi [Viste dell'entità](/docs/frontend/entity-views) |
| Il modo in cui un campo viene modificato o mostrato | `admin.Field` / `admin.Preview` — vedi [Campi personalizzati](/docs/frontend/custom-fields) |
| Qualcosa accanto a una parte integrata | `<Rebase slots>` — vedi [Slot](/docs/frontend/slots) |
| Un sostituto per una parte integrata | `<Rebase components>` — vedi [Override dei componenti](/docs/frontend/component-overrides) |

## Hook

| Hook | Pacchetto | Cosa fornisce |
|---|---|---|
| `useData` | `@rebasepro/app` | `useData().collection("orders").find / findById / create / update / delete`, tramite il server, in modo che si applichino callback e regole di sicurezza. |
| `useCollection` / `useFetch` | `@rebasepro/app` | Un elenco live di righe / un record live. |
| `useAuthController` | `@rebasepro/app` | L'`user` autenticato (uid, ruoli), accesso e disconnessione. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` per un messaggio toast. |
| `useSidePanel` | `@rebasepro/cms` | Apre qualsiasi record nel pannello laterale. |
| `useUrlController` | `@rebasepro/cms` | URL dell'admin e navigazione. |
| `resolveSelection` | `@rebasepro/cms` | La selezione di una tabella — righe spuntate o "tutte le corrispondenti" — sotto forma di righe. |

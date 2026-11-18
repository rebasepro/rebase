---
sourceHash: bad5fe6e295033b6
title: Override dei componenti (Swizzling)
sidebar_label: Override dei componenti
description: Esegui l'override dei componenti UI predefiniti con implementazioni personalizzate a livello di applicazione o di collection.
---

## Panoramica

Rebase ti consente di eseguire l'override dei componenti UI predefiniti con le tue implementazioni personalizzate. Questo implementa un modello di component swizzling in stile Docusaurus che supporta due pattern di personalizzazione:
- **Modalità Eject** (predefinita): il tuo componente sostituisce completamente quello predefinito (built-in).
- **Modalità Wrap** (`wrap: true`): il tuo componente avvolge (wrap) l'originale. Ciò che avvolge (solitamente il componente predefinito) viene passato come prop `OriginalComponent` in modo da poterlo renderizzare all'interno del tuo layout/logica personalizzati.

Per modificare solo l'*aspetto* dell'admin — colori, font, angoli, logo — non è necessario un override: consulta [Temi e personalizzazione del brand](/docs/frontend/theming).

Gli override dei componenti possono essere applicati **globalmente** a livello di applicazione (sul provider `<Rebase>`) o **localmente** a livello di collection (all'interno delle singole definizioni di collection).

---

## Override globali dei componenti

Per eseguire l'override dei componenti a livello globale nell'intera applicazione, passa un oggetto `components` al provider principale `<Rebase>`.

```tsx
import { Rebase } from "@rebasepro/app";
import { MyAppBar } from "./components/MyAppBar";

function App() {
    return (
        <Rebase
            client={rebaseClient}
            components={{
                // Eject Mode: Replace the default AppBar entirely
                "Shell.AppBar": { Component: MyAppBar },

                // Wrap Mode: Wrap the login view to insert branding
                "Auth.LoginView": {
                    // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                        <div className="login-branding-container">
                            <header className="branding-header">My Custom Brand</header>
                            <OriginalComponent {...props} />
                        </div>
                    )) as unknown as React.ComponentType<Record<string, unknown>>,
                    wrap: true
                }
            }}
        >
            {/* your app */}
            …
        </Rebase>
    );
}
```

---

## Override dei componenti a livello di collection

Per eseguire l'override dei componenti solo per una tabella, passa `components` nel relativo
`customizeTable`. Questo è utile per lo stato vuoto (empty state), le schede o il form di una
tabella specifica. Ciascun `Component` è il componente stesso, importato per valore:
il file viene eseguito solo nel browser.

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ProductCustomForm } from "../../../../../components/ProductCustomForm";
import { ProductsEmptyState } from "../../../../../components/ProductsEmptyState";

export const productsCms = customizeTable<typeof products>("products", {
    components: {
        // Replace: the product form is drawn by your component alone.
        "Entity.Form": { Component: ProductCustomForm },
        // Wrap: your component receives the original as `OriginalComponent`.
        "Collection.EmptyState": { Component: ProductsEmptyState, wrap: true },
    },
});
```

Un componente che esegue il wrapping riceve ciò che avvolge come `OriginalComponent`: il
componente predefinito, a meno che anche l'app non ne esegua l'override (vedi
[Quando entrambi gli scope eseguono l'override di un componente](#quando-entrambi-gli-scope-eseguono-loverride-di-un-componente)):

```tsx
// frontend/src/components/ProductsEmptyState.tsx
import React from "react";

export function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <a href="/docs/import">Import your first products</a>
        </div>
    );
}
```

Un percorso stringa o un thunk lazy `() => import(…)` in `Component` genera un errore al caricamento del modulo,
indicando cosa scrivere invece.

### Quando entrambi gli scope eseguono l'override di un componente

I due scope si compongono. L'override a livello di app (`<Rebase components>`) viene applicato per primo al componente predefinito, e quello della tabella (`components` in `customizeTable`) viene applicato al risultato:

| Livello App | Livello Collection | Cosa viene renderizzato all'interno di quella collection |
|---|---|---|
| any | none | ciò che viene renderizzato ovunque: l'override a livello di app o il componente predefinito |
| none | wrap | il wrapper della collection attorno al componente predefinito |
| replace o wrap | wrap | il wrapper della collection attorno all'override a livello di app, passato come `OriginalComponent` |
| any | replace | solo il componente della collection; sostituisce entrambi |

In questo modo, una collection può aggiungere elementi attorno a un componente che l'app già personalizza, senza perdere tale personalizzazione. Per eliminare la versione a livello di app per una singola collection, usa la sostituzione (replace) anziché il wrapping.

---

## Ambiti dei componenti soggetti a override

### Componenti con ambito applicazione (`AppComponentName`)

Questi componenti possono essere sovrascritti solo a livello del provider root `<Rebase>`, poiché rappresentano la struttura a livello di shell.

| Chiave del componente | Descrizione |
|---|---|
| `"Shell.AppBar"` | La barra di intestazione nella parte superiore della pagina |
| `"Shell.Drawer"` | Il drawer di navigazione principale comprimibile della barra laterale |
| `"Shell.DrawerNavigationItem"` | Singoli link all'interno della barra laterale |
| `"Shell.DrawerNavigationGroup"` | Intestazioni dei gruppi di navigazione comprimibili nella barra laterale |
| `"HomePage"` | La home page predefinita in modalità contenuto |
| `"HomePage.CollectionCard"` | Singole schede di collection nella home page |
| `"Auth.LoginView"` | L'overlay mostrato quando viene richiesta l'autenticazione |

### Componenti con ambito collection (`CollectionComponentName`)

Questi componenti possono essere sovrascritti a livello globale (fungendo da impostazioni predefinite per tutte le collection) o su singole collection.

| Chiave del componente | Descrizione |
|---|---|
| `"Collection.View"` | L'intera pagina principale della collection |
| `"Collection.Table"` | La visualizzazione tabellare predefinita a foglio di calcolo |
| `"Collection.Card"` | Il wrapper degli elementi della vista a schede |
| `"Collection.EmptyState"` | Vista mostrata quando una collection è vuota |
| `"Collection.Actions"` | Pulsanti della barra degli strumenti sopra la tabella/schede |
| `"Collection.FilterField"` | Input di filtro personalizzato per una colonna |
| `"Entity.Form"` | Il form di dettaglio per la creazione/aggiornamento |
| `"EditView.FormActions"` | Barra dei pulsanti di invio/annullamento del form |
| `"DetailView"` | Vista di dettaglio in sola lettura |
| `"Entity.SidePanel"` | Il contenitore del pannello laterale per form/dettaglio |
| `"EntityPreview"` | Anteprima inline chip per riferimenti/relazioni |
| `"Entity.MissingReference"` | Renderizzato quando un'entità referenziata è mancante |

:::note[Tre chiavi non seguono il pattern `Entity.`]
`"DetailView"`, `"EntityPreview"` e `"EditView.FormActions"` non contengono il prefisso
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` e `"Entity.FormActions"` non
fanno parte dell'unione: generano errori di tipo e, in JavaScript puro, l'override semplicemente
non viene mai applicato.
:::

Il componente sostitutivo riceve le stesse props fornite al componente predefinito. La
mappa degli override non specifica un tipo di props per chiave — `ComponentOverride<P>` imposta di default
`P` a `Record<string, unknown>` — quindi tipizza tu stesso il parametro, oppure passa un argomento
di tipo, quando desideri verificare i tipi delle props. Alcuni dei componenti predefiniti esportano un
tipo per le props che puoi importare e riutilizzare: `CollectionViewProps` (`@rebasepro/ui`);
`CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps`
e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` e
`DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps`
(`@rebasepro/app`). Gli altri non dispongono di un tipo esportato per le props: scrivi la struttura (shape) che
effettivamente leggi.

### Cosa deve rispettare un override di `Collection.View`

`Collection.View` è ciò che viene disegnato da un `CollectionPanel`, quindi le props del pannello raggiungono
il tuo override come `CollectionViewBindingProps` (`@rebasepro/cms`), propagate (spread) su quelle
della collection stessa. Un componente sostitutivo che le ignora compromette ogni pagina in cui è incorporata
la collection. Rispetta almeno queste:

| Prop | Cosa si aspetta il chiamante |
|---|---|
| `collectionOverrides` | Le modifiche apportate dal chiamante alla collection (un filtro fisso, un ordinamento, la modalità di visualizzazione), applicate sulla collection registrata |
| `fields` | Solo queste proprietà, in questo ordine: le colonne e ciò da cui vengono popolate le righe dell'elenco e le schede |
| `highlightedIds` | Gli id delle righe visualizzate come selezionate; `[]` per nessuna |
| `onRowClick` | Chiamato con la riga selezionata (come inviata dal server) e il relativo id, anziché aprirla. L'`onRowClick` del pannello stesso |

Il pannello passa anche `viewMode` (la modalità in cui aprire), `toolbar` (la barra degli strumenti
da disegnare, `null` per nessuna) e `title` (`false` per non mostrare alcun titolo), dove impostati
dal relativo chiamante. Il componente predefinito `CollectionViewBinding` gestisce tutti questi parametri; un
override che ne esegue il wrapping anziché la sostituzione può passarli direttamente.

Per iniziare dalla parte predefinita anziché da zero, copia il relativo codice sorgente nel
tuo progetto e registra la copia qui: ogni parte tranne `Collection.View`,
`DetailView` e il drag-and-drop della home page si compila tramite le importazioni di pacchetto.
Consulta [Copia di una parte predefinita](/docs/frontend/customizing#copying-a-built-in-part).

## Correlati

- [Temi e personalizzazione del brand](/docs/frontend/theming/) — ridefinire lo stile dell'admin tramite token anziché componenti
- [Estendere Rebase](/docs/frontend/extending/) — i punti di estensione che non richiedono un override
- [Campi personalizzati](/docs/frontend/custom-fields/) — sostituire l'editor di una singola proprietà anziché un intero componente
- [Slot](/docs/frontend/slots/) — aggiungere elementi a un componente anziché sostituirlo

---
sourceHash: b16bc057fd9a76c0
title: Override dei componenti (Swizzling)
sidebar_label: Override dei componenti
description: Esegui l'override dei componenti UI predefiniti con implementazioni personalizzate a livello di applicazione o di collezione.
---

## Panoramica

Rebase ti consente di eseguire l'override dei componenti UI predefiniti con le tue implementazioni personalizzate. Questo implementa un modello di swizzling dei componenti in stile Docusaurus che supporta due pattern di personalizzazione:
- **Modalità Eject** (predefinita): il tuo componente sostituisce completamente quello integrato.
- **Modalità Wrap** (`wrap: true`): il tuo componente avvolge l'originale. Ciò che viene avvolto (solitamente il componente integrato) viene passato come prop `OriginalComponent`, consentendoti di renderizzarlo all'interno del tuo layout o della tua logica personalizzata.

Gli override dei componenti possono essere applicati **a livello globale** nell'applicazione (sul provider `<Rebase>`) o **a livello locale** nella collezione (all'interno delle singole definizioni di collezione).

---

## Override dei componenti a livello globale

Per eseguire l'override dei componenti a livello globale nell'intera applicazione, passa un oggetto `components` al provider radice `<Rebase>`.

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

## Override dei componenti a livello di collezione

<span class="since-badge" data-since="0.31">Da 0.31</span>

Per eseguire l'override dei componenti per una sola tabella, passa `components` nel suo `customizeTable`. Questo è utile per lo stato vuoto (empty state), le schede (card) o il form di una particolare tabella. Ciascun `Component` è il componente stesso, importato per valore: il file viene eseguito solo nel browser.

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

Un componente wrapper riceve ciò che avvolge come `OriginalComponent`: il componente integrato, a meno che anche la tua applicazione non ne esegua l'override (vedi [Quando entrambi gli ambiti eseguono l'override di un componente](#quando-entrambi-gli-ambiti-eseguono-loverride-di-un-componente)):

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

Un percorso stringa o un thunk lazy `() => import(…)` in `Component` genera un errore al caricamento del modulo, indicando cosa scrivere al suo posto.

### Quando entrambi gli ambiti eseguono l'override di un componente

<span class="since-badge" data-since="0.31">Da 0.31</span>

I due ambiti si compongono. L'override a livello di app (`<Rebase components>`) viene applicato per primo al componente integrato, e quello della tabella (`components` in `customizeTable`) viene applicato al risultato:

| Livello app | Livello collezione | Cosa viene renderizzato all'interno di quella collezione |
|---|---|---|
| qualsiasi | nessuno | ciò che viene renderizzato altrove: l'override a livello di app o il componente integrato |
| nessuno | wrap | il wrapper della collezione attorno al componente integrato |
| replace o wrap | wrap | il wrapper della collezione attorno all'override a livello di app, passato come `OriginalComponent` |
| qualsiasi | replace | solo il componente della collezione; sostituisce entrambi |

Pertanto, una collezione può aggiungere qualcosa attorno a un componente che la tua app già personalizza senza perdere tale personalizzazione. Per rimuovere la versione a livello di app per una singola collezione, usa replace invece di wrap.

---

## Ambiti dei componenti soggetti a override

### Componenti con ambito a livello di app (`AppComponentName`)

Questi componenti possono essere sottoposti a override solo a livello del provider radice `<Rebase>`, poiché rappresentano la struttura a livello di shell.

| Chiave del componente | Descrizione |
|---|---|
| `"Shell.AppBar"` | La barra di intestazione nella parte superiore della pagina |
| `"Shell.Drawer"` | Il drawer di navigazione principale comprimibile nella barra laterale |
| `"Shell.DrawerNavigationItem"` | Singoli link all'interno della barra laterale |
| `"Shell.DrawerNavigationGroup"` | Intestazioni comprimibili dei gruppi di navigazione nella barra laterale |
| `"HomePage"` | La home page predefinita in modalità contenuto |
| `"HomePage.CollectionCard"` | Singole schede di collezione nella home page |
| `"Auth.LoginView"` | L'overlay mostrato quando viene richiesta l'autenticazione |

### Componenti con ambito a livello di collezione (`CollectionComponentName`)

È possibile eseguire l'override di questi componenti a livello globale (fungendo da impostazioni predefinite per tutte le collezioni) o sulle singole collezioni.

| Chiave del componente | Descrizione |
|---|---|
| `"Collection.View"` | L'intera pagina principale della collezione |
| `"Collection.Table"` | La vista tabellare predefinita a foglio di calcolo |
| `"Collection.Card"` | Il wrapper degli elementi nella vista a schede (card view) |
| `"Collection.EmptyState"` | Vista mostrata quando una collezione è vuota |
| `"Collection.Actions"` | Pulsanti della barra degli strumenti sopra la tabella/schede |
| `"Collection.FilterField"` | Input di filtro personalizzato per una colonna |
| `"Entity.Form"` | Il form di dettaglio per la creazione/aggiornamento |
| `"EditView.FormActions"` | Barra dei pulsanti di invio/annullamento del form |
| `"DetailView"` | Vista di dettaglio in sola lettura |
| `"Entity.SidePanel"` | Il contenitore del pannello laterale per form/dettagli |
| `"EntityPreview"` | Anteprima inline in formato chip di riferimenti/relazioni |
| `"Entity.MissingReference"` | Renderizzato quando un'entità di riferimento è mancante |

:::note[Tre chiavi non seguono il pattern `Entity.`]
`"DetailView"`, `"EntityPreview"` ed `"EditView.FormActions"` non contengono il prefisso `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` ed `"Entity.FormActions"` non fanno parte del tipo union: generano errori di tipo e, in JavaScript puro, l'override semplicemente non viene mai applicato.
:::

Il tuo componente sostitutivo riceve le stesse props fornite al componente integrato. La mappa degli override non definisce un tipo di props per chiave — `ComponentOverride<P>` imposta `P` su `Record<string, unknown>` per impostazione predefinita — pertanto tipizza autonomamente il parametro, oppure passa un argomento di tipo, quando desideri la verifica dei tipi sulle props. Alcuni dei componenti integrati esportano un tipo per le props che puoi importare e riutilizzare: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` e `DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps` (`@rebasepro/app`). I restanti non hanno un tipo esportato per le props: definisci la struttura che effettivamente utilizzi.

### Cosa deve rispettare un override di `Collection.View`

`Collection.View` è ciò che viene renderizzato da `CollectionPanel`, quindi le props del pannello arrivano al tuo override come `CollectionViewBindingProps` (`@rebasepro/cms`), propagate insieme a quelle della collezione stessa. Un componente sostitutivo che le ignora provocherà il malfunzionamento di ogni pagina che incorpora la collezione. Rispetta almeno le seguenti:

| Prop | Cosa si aspetta il chiamante |
|---|---|
| `collectionOverrides` | Le modifiche apportate dal chiamante alla collezione (un filtro fisso, un ordinamento, la modalità di visualizzazione), applicate sulla collezione registrata |
| `fields` | Solo queste proprietà, in questo ordine: le colonne e i dati con cui vengono popolate le righe dell'elenco e le schede |
| `highlightedIds` | Gli ID delle righe renderizzate come selezionate; `[]` per nessuna |
| `onRowClick` | Chiamato con la riga cliccata, così come inviata dal server, e il suo ID, invece di aprirla. Rappresenta l'`onRowClick` del pannello stesso |

Il pannello passa inoltre `viewMode` (la modalità in cui aprire), `toolbar` (la barra degli strumenti da mostrare, `null` per nessuna) e `title` (`false` per non mostrare alcun titolo), laddove impostati dal chiamante. Il componente integrato `CollectionViewBinding` li gestisce tutti; un override che lo avvolge anziché sostituirlo può inoltrarli direttamente.

Per iniziare dal componente integrato anziché da zero, copia il suo codice sorgente nel tuo progetto e registra la copia qui: ogni parte, ad eccezione di `Collection.View`, `DetailView` e del drag-and-drop della home page, si compila con le importazioni dei pacchetti. Vedi [Copia di una parte integrata](/docs/frontend/customizing#copying-a-built-in-part).

## Contenuti correlati

- [Estendere Rebase](/docs/frontend/extending/) — i punti di estensione che non richiedono un override
- [Campi personalizzati](/docs/frontend/custom-fields/) — sostituire l'editor di una singola proprietà anziché un intero componente
- [Slot](/docs/frontend/slots/) — aggiungere elementi a un componente anziché sostituirlo

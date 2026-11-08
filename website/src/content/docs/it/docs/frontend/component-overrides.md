---
sourceHash: 5ceaf45e05dbf2b8
title: Override dei componenti (Swizzling)
sidebar_label: Override dei componenti
description: Esegui l'override dei componenti UI predefiniti con implementazioni personalizzate a livello di applicazione o di collezione.
---

## Panoramica

Rebase consente di eseguire l'override dei componenti UI predefiniti con le proprie implementazioni personalizzate. Ciò implementa un modello di swizzling dei componenti in stile Docusaurus che supporta due pattern di personalizzazione:
- **Modalità Eject** (predefinita): il tuo componente sostituisce completamente quello integrato.
- **Modalità Wrap** (`wrap: true`): il tuo componente avvolge l'originale. Ciò che avvolge (solitamente il componente integrato) viene passato come prop `OriginalComponent`, consentendoti di eseguirne il rendering all'interno del tuo layout/logica personalizzato.

Gli override dei componenti possono essere applicati a livello **globale** per l'intera applicazione (sul provider `<Rebase>`) o a livello **locale** per singola collezione (all'interno delle definizioni delle singole collezioni).

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

Per eseguire l'override dei componenti solo per una collezione specifica, aggiungi un oggetto `components` sotto il relativo blocco `admin`. Ciò è utile per personalizzare gli stati vuoti, le schede o le viste di dettaglio per modelli particolari.

Nello scaffold predefinito, `config/collections/` viene caricato **sia** dal pannello di amministrazione sia dal backend, che legge gli stessi file per ricavare lo schema e l'API. Pertanto, fai riferimento a ciascun componente tramite il **percorso del modulo** anziché importarlo. `Component` accetta le stesse forme di `admin.Field` ed `entityViews[].Builder`: un percorso, un `import()` lazy, o il componente stesso.

```ts
// config/collections/products.ts
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: "../../frontend/src/ProductCustomForm" },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                Component: "../../frontend/src/ProductsEmptyState",
                wrap: true
            }
        }
    }
});
```

Il componente wrapper risiede con il resto del codice frontend e riceve ciò che avvolge come `OriginalComponent` — il componente integrato, a meno che anche l'app non ne esegua l'override (vedi [Quando entrambi gli ambiti eseguono l'override di un componente](#quando-entrambi-gli-ambiti-eseguono-loverride-di-un-componente)):

```tsx
// frontend/src/ProductsEmptyState.tsx
import type React from "react";

export default function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <button onClick={() => importDemoProducts()}>
                Load Demo Products
            </button>
        </div>
    );
}
```

Ciascun modulo necessita di un **export predefinito**. Il plugin Vite per le collezioni riscrive un percorso in un'importazione lazy, in modo che il componente costituisca un chunk separato e venga caricato la prima volta che l'override viene renderizzato. Tale riscrittura copre i file all'interno della `collectionsDir` configurata. Un percorso specificato in un file esterno a essa raggiunge l'admin come semplice stringa: la console lo segnala e al suo posto viene renderizzato il componente integrato. Al di fuori di `collectionsDir`, scrivi tu stesso l'importazione lazy: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Anche un riferimento diretto (`Component: ProductCustomForm`) funziona, ma solo in un file di collezione che non viene caricato da nulla sul server, poiché importare il componente importa anche React e tutto ciò che esso trascina con sé.

### Quando entrambi gli ambiti eseguono l'override di un componente

Su 0.24, il wrapper di una collezione riceve sempre il componente integrato, e l'override a livello di applicazione viene ignorato all'interno di quella collezione.

I due ambiti si compongono. L'override a livello di applicazione (`<Rebase components>`) viene applicato per primo al componente integrato, e quello della collezione (`admin.components`) viene applicato al risultato:

| Livello applicazione | Livello collezione | Cosa viene renderizzato all'interno di quella collezione |
|---|---|---|
| any | none | ciò che viene renderizzato altrove: l'override a livello di app, o il componente integrato |
| none | wrap | il wrapper della collezione attorno al componente integrato |
| replace or wrap | wrap | il wrapper della collezione attorno all'override a livello di app, passato come `OriginalComponent` |
| any | replace | solo il componente della collezione; sostituisce entrambi |

In questo modo, una collezione può aggiungere qualcosa attorno a un componente che l'app già personalizza senza perdere tale personalizzazione. Per escludere la versione a livello di app per una singola collezione, usa replace invece di wrap.

---

## Ambiti dei componenti soggetti a override

### Componenti con ambito applicazione (`AppComponentName`)

Questi componenti possono essere sovrascritti solo a livello del provider radice `<Rebase>`, poiché rappresentano la struttura a livello di shell.

| Chiave del componente | Descrizione |
|---|---|
| `"Shell.AppBar"` | La barra di intestazione nella parte superiore della pagina |
| `"Shell.Drawer"` | Il pannello di navigazione a scomparsa della barra laterale principale |
| `"Shell.DrawerNavigationItem"` | Singoli link all'interno della barra laterale |
| `"Shell.DrawerNavigationGroup"` | Intestazioni di gruppo comprimibili per la navigazione nella barra laterale |
| `"HomePage"` | La landing page principale predefinita in modalità contenuto |
| `"HomePage.CollectionCard"` | Singole schede di collezione nella home page |
| `"Auth.LoginView"` | L'overlay mostrato quando viene richiesta l'autenticazione |

### Componenti con ambito collezione (`CollectionComponentName`)

Questi componenti possono essere sovrascritti a livello globale (fungendo da impostazioni predefinite per tutte le collezioni) o sulle singole collezioni.

| Chiave del componente | Descrizione |
|---|---|
| `"Collection.View"` | L'intera pagina principale della collezione |
| `"Collection.Table"` | La vista tabellare a foglio di calcolo predefinita |
| `"Collection.Card"` | Il wrapper per gli elementi della vista a schede |
| `"Collection.EmptyState"` | Vista mostrata quando una collezione è vuota |
| `"Collection.Actions"` | Pulsanti della barra degli strumenti sopra la tabella/schede |
| `"Collection.FilterField"` | Input di filtro personalizzato per una colonna |
| `"Entity.Form"` | Il modulo di dettaglio per creazione/aggiornamento |
| `"EditView.FormActions"` | Barra dei pulsanti di invio/annullamento del modulo |
| `"DetailView"` | Vista di dettaglio in sola lettura |
| `"Entity.SidePanel"` | Il contenitore del pannello laterale per modulo/dettaglio |
| `"EntityPreview"` | Anteprima inline in formato chip per riferimenti/relazioni |
| `"Entity.MissingReference"` | Renderizzato quando un'entità referenziata è mancante |

:::note[Tre chiavi non seguono il pattern `Entity.`]
`"DetailView"`, `"EntityPreview"` e `"EditView.FormActions"` non contengono il prefisso `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` e `"Entity.FormActions"` non fanno parte dell'unione: generano un errore di tipo e, in JavaScript puro, l'override semplicemente non viene mai applicato.
:::

Il tuo componente sostitutivo riceve le stesse prop fornite al componente integrato. La mappa degli override non specifica un tipo di prop per chiave — `ComponentOverride<P>` imposta `P` per impostazione predefinita su `Record<string, unknown>` — quindi tipizza tu stesso il parametro, oppure passa un argomento di tipo, quando desideri che le prop vengano verificate. Alcuni dei componenti integrati esportano un tipo di prop che puoi importare e riutilizzare: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` e `DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps` (`@rebasepro/app`). Gli altri non hanno un tipo di prop esportato: scrivi la struttura che effettivamente leggi.

### Cosa deve rispettare un override di `Collection.View`

`Collection.View` è ciò che viene disegnato da un `CollectionPanel`, quindi le prop del pannello raggiungono il tuo override come `CollectionViewBindingProps` (`@rebasepro/cms`), distribuite su quelle proprie della collezione. Una sostituzione che le ignora corrompe ogni pagina che incorpora la collezione. Rispetta almeno queste:

| Prop | Cosa si aspetta il chiamante |
|---|---|
| `collectionOverrides` | Cosa modifica il chiamante riguardo alla collezione (un filtro fisso, un ordinamento, la modalità di visualizzazione), applicato sopra la collezione registrata |
| `fields` | Solo queste proprietà, in questo ordine: le colonne e ciò con cui vengono popolate le righe dell'elenco e le schede |
| `highlightedEntityId` | La riga visualizzata come selezionata; `null` per nessuna |
| `onEntityClick` | Chiamato con la riga cliccata (un `Entity`) invece di aprirla. Il parametro `onRowClick` del pannello viene ricevuto sotto questa forma |

Il pannello passa anche `viewMode` (la modalità con cui aprirsi), `toolbar` (la barra degli strumenti da visualizzare, `null` per nessuna) e `title` (`false` per non mostrare alcun titolo), laddove il relativo chiamante li abbia impostati. Il componente integrato `CollectionViewBinding` li gestisce tutti; un override che lo avvolge anziché sostituirlo può inoltrarli direttamente.

Per iniziare dalla parte integrata anziché da zero, copia il relativo codice sorgente nel tuo progetto e registra la copia qui: ogni parte, a eccezione di `Collection.View`, `DetailView` e del drag-and-drop della home page, compila con importazioni di pacchetti. Vedi [Copiare una parte integrata](/docs/frontend/customizing#copying-a-built-in-part).

## Correlati

- [Estendere Rebase](/docs/frontend/extending/) — i punti di estensione che non richiedono un override
- [Campi personalizzati](/docs/frontend/custom-fields/) — sostituire l'editor di una singola proprietà anziché un intero componente
- [Slot](/docs/frontend/slots/) — aggiungere elementi a un componente invece di sostituirlo

---
sourceHash: 71362fa8c8eb7f20
title: Override dei componenti (Swizzling)
sidebar_label: Override dei componenti
description: Sovrascrivi i componenti UI predefiniti con implementazioni personalizzate a livello di applicazione o di collezione.
---

## Panoramica

Rebase consente di sovrascrivere i componenti UI predefiniti con le tue implementazioni personalizzate. Ciò implementa un modello di swizzling dei componenti in stile Docusaurus che supporta due pattern di personalizzazione:
- **Modalità eject** (predefinita): Il tuo componente sostituisce completamente quello integrato.
- **Modalità wrap** (`wrap: true`): Il tuo componente avvolge l'originale. Ciò che viene avvolto (solitamente il componente integrato) viene passato come prop `OriginalComponent` in modo da poterlo renderizzare all'interno del tuo layout o della tua logica personalizzati.

Gli override dei componenti possono essere applicati **globalmente** a livello di applicazione (sul provider `<Rebase>`) o **localmente** a livello di collezione (all'interno delle singole definizioni di collezione).

---

## Override dei componenti a livello globale

Per sovrascrivere i componenti a livello globale nell'intera applicazione, passa un oggetto `components` al provider radice `<Rebase>`.

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

Per sovrascrivere i componenti solo per una specifica collezione, aggiungi un oggetto `components` sotto il relativo blocco `admin`. Questo è utile per personalizzare stati vuoti, card o viste di dettaglio per modelli specifici.

Nello scaffold predefinito, `config/collections/` viene caricato **sia** dal pannello di amministrazione sia dal backend, che legge gli stessi file per ricavare lo schema e l'API. Pertanto, punta a ciascun componente tramite **percorso del modulo** anziché importarlo. `Component` accetta le stesse forme di `admin.Field` ed `entityViews[].Builder`: un percorso, un `import()` lazy, o il componente stesso.

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

Il componente wrapper risiede insieme al resto del codice frontend e riceve ciò che avvolge come `OriginalComponent` — il componente integrato, a meno che anche l'app non lo sovrascriva (vedi [Quando entrambi gli ambiti sovrascrivono un componente](#quando-entrambi-gli-ambiti-sovrascrivono-un-componente)):

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

Ogni modulo richiede un **default export**. Il plugin Vite per le collezioni riscrive un percorso in un'importazione lazy, in modo che il componente costituisca un chunk a sé stante e venga caricato la prima volta che l'override viene renderizzato. Questa riscrittura copre i file all'interno della directory `collectionsDir` configurata. Un percorso in un file al di fuori di essa arriva all'admin come una semplice stringa: la console lo notifica e il componente integrato viene renderizzato al suo posto. Al di fuori di `collectionsDir`, scrivi tu stesso l'importazione lazy: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Anche un riferimento diretto (`Component: ProductCustomForm`) funziona, ma solo in un file di collezione non caricato dal server, poiché l'importazione del componente comporta anche l'importazione di React e di tutte le relative dipendenze.

### Quando entrambi gli ambiti sovrascrivono un componente

Su 0.24, il wrapper di una collezione riceve sempre il componente integrato e l'override a livello di app viene ignorato all'interno di quella collezione.

I due ambiti si compongono. L'override a livello di app (`<Rebase components>`) viene applicato per primo al componente integrato, e quello della collezione (`admin.components`) viene applicato al risultato:

| Livello app | Livello collezione | Cosa viene renderizzato all'interno di quella collezione |
|---|---|---|
| qualsiasi | nessuno | ciò che viene renderizzato altrove: l'override a livello di app o il componente integrato |
| nessuno | wrap | il wrapper della collezione attorno al componente integrato |
| replace o wrap | wrap | il wrapper della collezione attorno all'override a livello di app, passato come `OriginalComponent` |
| qualsiasi | replace | il solo componente della collezione; sostituisce entrambi |

In questo modo una collezione può aggiungere elementi attorno a un componente già personalizzato dall'applicazione senza perdere tale personalizzazione. Per rimuovere la versione a livello di app per una determinata collezione, utilizza replace anziché wrap.

---

## Ambiti dei componenti sovrascrivibili

### Componenti con ambito applicazione (`AppComponentName`)

Questi componenti possono essere sovrascritti unicamente a livello del provider radice `<Rebase>`, poiché rappresentano la struttura a livello di shell.

| Chiave componente | Descrizione |
|---|---|
| `"Shell.AppBar"` | La barra di intestazione nella parte superiore della pagina |
| `"Shell.Drawer"` | Il pannello di navigazione laterale principale comprimibile |
| `"Shell.DrawerNavigationItem"` | Singoli link all'interno della barra laterale |
| `"Shell.DrawerNavigationGroup"` | Intestazioni comprimibili dei gruppi di navigazione nella barra laterale |
| `"HomePage"` | La landing page iniziale predefinita in modalità contenuto |
| `"HomePage.CollectionCard"` | Singole card di collezione nella home page |
| `"Auth.LoginView"` | L'overlay mostrato quando viene richiesta l'autenticazione |

### Componenti con ambito collezione (`CollectionComponentName`)

Questi componenti possono essere sovrascritti a livello globale (agendo come impostazioni predefinite per tutte le collezioni) o su singole collezioni.

| Chiave componente | Descrizione |
|---|---|
| `"Collection.View"` | L'intera landing page della collezione |
| `"Collection.Table"` | La vista tabellare predefinita a foglio di calcolo |
| `"Collection.Card"` | Il wrapper dell'elemento nella vista a card |
| `"Collection.EmptyState"` | Vista mostrata quando una collezione è vuota |
| `"Collection.Actions"` | Pulsanti della barra degli strumenti sopra la tabella/card |
| `"Collection.FilterField"` | Input di filtro personalizzato per una colonna |
| `"Entity.Form"` | Il form di dettaglio per creazione/aggiornamento |
| `"EditView.FormActions"` | Barra dei pulsanti di invio/annullamento del form |
| `"DetailView"` | Vista di dettaglio in sola lettura |
| `"Entity.SidePanel"` | Il contenitore del pannello laterale per form/dettaglio |
| `"EntityPreview"` | Anteprima chip inline per riferimenti/relazioni |
| `"Entity.MissingReference"` | Renderizzato quando un'entità referenziata è mancante |

:::note[Tre chiavi non seguono il pattern `Entity.`]
`"DetailView"`, `"EntityPreview"` ed `"EditView.FormActions"` non contengono il prefisso `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` ed `"Entity.FormActions"` non fanno parte dell'unione — generano un errore di tipo e, in JavaScript puro, l'override semplicemente non viene mai applicato.
:::

Il tuo componente sostitutivo riceve le stesse prop passate al componente integrato. La mappa degli override non definisce un tipo di prop per chiave — `ComponentOverride<P>` imposta `P` su `Record<string, unknown>` per impostazione predefinita — pertanto tipizza autonomamente il parametro, oppure passa un argomento di tipo, quando desideri validare le prop. Alcuni dei componenti integrati esportano un tipo per le prop che puoi importare e riutilizzare: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` e `DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps` (`@rebasepro/app`). Gli altri non forniscono un tipo esportato per le prop — definisci la struttura che leggi effettivamente.

### Cosa deve rispettare un override di `Collection.View`

`Collection.View` è ciò che viene disegnato da un `CollectionPanel`, quindi le prop del pannello raggiungono il tuo override come `CollectionViewBindingProps` (`@rebasepro/cms`), applicate in spread su quelle della collezione stessa. Un componente sostitutivo che le ignora compromette ogni pagina che incorpora la collezione. Rispetta almeno queste:

| Prop | Cosa si aspetta il chiamante |
|---|---|
| `collectionOverrides` | Le modifiche apportate dal chiamante alla collezione (un filtro fisso, un ordinamento, la modalità di visualizzazione), applicate sulla collezione registrata |
| `fields` | Solo queste proprietà, in questo ordine: le colonne e gli elementi da cui vengono popolate le righe dell'elenco e le card |
| `highlightedIds` | Gli id delle righe visualizzate come selezionate; `[]` per nessuna |
| `onRowClick` | Invocato con la riga cliccata, così come inviata dal server, e il suo id, invece di aprirla. Il `onRowClick` proprio del pannello |

Il pannello passa anche `viewMode` (la modalità con cui aprire), `toolbar` (la barra degli strumenti da visualizzare, `null` per nessuna) e `title` (`false` per non mostrare alcun titolo), se impostati dal chiamante. Il componente integrato `CollectionViewBinding` li gestisce tutti; un override che lo avvolge (wrap) anziché sostituirlo può inoltrarli direttamente.

Per iniziare dalla versione integrata anziché da zero, copia il suo codice sorgente nel tuo progetto e registra la copia qui: ogni elemento, ad eccezione di `Collection.View`, `DetailView` e del drag-and-drop della home page, compila con le importazioni dei pacchetti. Vedi [Copia di una parte integrata](/docs/frontend/customizing#copying-a-built-in-part).

## Correlati

- [Estendere Rebase](/docs/frontend/extending/) — i punti di estensione che non richiedono un override
- [Campi personalizzati](/docs/frontend/custom-fields/) — sostituire l'editor di una singola proprietà anziché un componente
- [Slot](/docs/frontend/slots/) — aggiungere elementi a un componente anziché sostituirlo

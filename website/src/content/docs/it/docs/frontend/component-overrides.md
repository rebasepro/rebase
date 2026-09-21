---
sourceHash: 973d76b134971c29
title: Override dei componenti (Swizzling)
sidebar_label: Override dei componenti
description: Esegui l'override dei componenti UI predefiniti con implementazioni personalizzate a livello di applicazione o di collection.
---

## Panoramica

Rebase consente di sovrascrivere (eseguire l'override) dei componenti UI predefiniti con implementazioni personalizzate. Questo approccio implementa un modello di swizzling dei componenti in stile Docusaurus che supporta due pattern di personalizzazione:
- **Modalità Eject** (predefinita): Il tuo componente sostituisce completamente quello integrato.
- **Modalità Wrap** (`wrap: true`): Il tuo componente avvolge (effettua il wrap di) quello originale. Il componente integrato viene passato tramite la prop `OriginalComponent`, consentendoti di effettuarne il rendering all'interno del tuo layout/della tua logica personalizzata.

Gli override dei componenti possono essere applicati a livello **globale** per l'intera applicazione (sul provider `<Rebase>`) o a livello **locale** per ciascuna collection (all'interno delle singole definizioni delle collection).

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

Per eseguire l'override dei componenti solo per una collection specifica, aggiungi un oggetto `components` all'interno del relativo blocco `admin`. Questo è utile per personalizzare empty state, card o viste di dettaglio per determinati modelli.

<span class="since-badge" data-since="0.22">Da 0.22</span> Nello scaffold predefinito, `config/collections/` viene caricato **sia** dal pannello di amministrazione che dal backend, il quale legge gli stessi file per ricavare lo schema e le API. Di conseguenza, fai riferimento a ciascun componente tramite il suo **percorso del modulo (module path)** invece di importarlo direttamente. `Component` accetta le stesse forme di `admin.Field` e `entityViews[].Builder`: un percorso, un `import()` lazy, oppure il componente stesso.

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

Il componente che effettua il wrapping risiede insieme al resto del codice frontend e riceve quello integrato come `OriginalComponent`:

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

Ogni modulo necessita di un **default export**. Il plugin Vite delle collection riscrive un percorso in un import lazy, in modo che il componente costituisca un chunk a sé stante e venga caricato la prima volta che l'override viene renderizzato. Questa riscrittura include i file all'interno della directory `collectionsDir` configurata. Un percorso all'interno di un file esterno ad essa giungerà all'admin come una semplice stringa: verrà segnalato nella console e al suo posto verrà renderizzato il componente integrato. Al di fuori di `collectionsDir`, scrivi tu stesso l'import lazy: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Anche un riferimento diretto (`Component: ProductCustomForm`) funziona, ma solo all'interno di un file di collection che non viene caricato da nulla sul server, poiché importare il componente importa anche React e tutte le sue dipendenze.

---

## Ambiti dei componenti soggetti a override

### Componenti con ambito App (`AppComponentName`)

Questi componenti possono essere sovrascritti solo a livello del provider root `<Rebase>`, poiché rappresentano la struttura di base dello shell.

| Chiave del componente | Descrizione |
|---|---|
| `"Shell.AppBar"` | La barra di intestazione in cima alla pagina |
| `"Shell.Drawer"` | Il drawer comprimibile di navigazione della barra laterale principale |
| `"Shell.DrawerNavigationItem"` | Singoli link all'interno della barra laterale |
| `"Shell.DrawerNavigationGroup"` | Intestazioni di gruppi di navigazione comprimibili nella barra laterale |
| `"HomePage"` | La home page di destinazione predefinita in modalità contenuto |
| `"HomePage.CollectionCard"` | Singole card delle collection nella home page |
| `"Auth.LoginView"` | L'overlay mostrato quando viene richiesta l'autenticazione |

### Componenti con ambito Collection (`CollectionComponentName`)

Questi componenti possono essere sovrascritti a livello globale (fungendo da impostazione predefinita per tutte le collection) o su singole collection.

| Chiave del componente | Descrizione |
|---|---|
| `"Collection.View"` | L'intera pagina principale della collection |
| `"Collection.Table"` | La vista tabellare predefinita a foglio di calcolo |
| `"Collection.Card"` | Il wrapper per gli elementi della vista a card |
| `"Collection.EmptyState"` | Vista mostrata quando una collection è vuota |
| `"Collection.Actions"` | Pulsanti della barra degli strumenti sopra la tabella/card |
| `"Collection.FilterField"` | Input di filtro personalizzato per una colonna |
| `"Entity.Form"` | Il form di dettaglio per la creazione/aggiornamento |
| `"EditView.FormActions"` | Barra dei pulsanti di invio/annullamento del form |
| `"DetailView"` | Vista di dettaglio di sola lettura |
| `"Entity.SidePanel"` | Il contenitore del pannello laterale per form/dettaglio |
| `"EntityPreview"` | Anteprima inline chip per riferimenti/relazioni |
| `"Entity.MissingReference"` | Renderizzato quando un'entità referenziata è mancante |

:::note[Tre chiavi non seguono il pattern `Entity.`]
`"DetailView"`, `"EntityPreview"` e `"EditView.FormActions"` non contengono il prefisso `Entity.`.
`"Entity.DetailView"`, `"Entity.Preview"` e `"Entity.FormActions"` non fanno parte dell'unione di tipi: generano un errore di tipo e, in plain JavaScript, l'override semplicemente non viene mai applicato.
:::

Il tuo componente sostitutivo riceve le stesse props fornite al componente integrato. La mappa di override non specifica un tipo di props per chiave — `ComponentOverride<P>` imposta `P` su `Record<string, unknown>` per impostazione predefinita — pertanto, definisci manualmente il tipo del parametro, o passa un argomento di tipo, quando desideri che le props vengano verificate. Alcuni componenti integrati esportano un tipo per le props che puoi importare e riutilizzare: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps` e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps` ed `EntityFormActionsProps` (`@rebasepro/cms`). Gli altri non dispongono di un tipo esportato per le props: dichiara la struttura che effettivamente utilizzi.

## Contenuti correlati

- [Estendere Rebase](/docs/frontend/extending/) — i punti di estensione che non necessitano di un override
- [Campi personalizzati](/docs/frontend/custom-fields/) — sostituire l'editor di una singola proprietà anziché un intero componente
- [Slot](/docs/frontend/slots/) — aggiungere elementi a un componente anziché sostituirlo

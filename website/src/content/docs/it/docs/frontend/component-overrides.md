---
sourceHash: 3e8accd144f401d4
title: Override dei componenti (Swizzling)
sidebar_label: Override dei componenti
description: Esegui l'override dei componenti UI predefiniti con implementazioni personalizzate a livello di applicazione o di collection.
---

## Panoramica

Rebase ti consente di eseguire l'override dei componenti UI predefiniti con le tue implementazioni personalizzate. Questo implementa un modello di swizzling dei componenti in stile Docusaurus che supporta due pattern di personalizzazione:
- **Modalità eject** (predefinita): Il tuo componente sostituisce completamente quello integrato.
- **Modalità wrap** (`wrap: true`): Il tuo componente avvolge quello originale. Il componente integrato viene passato come prop `OriginalComponent` in modo da poterlo renderizzare all'interno del tuo layout/della tua logica personalizzati.

Gli override dei componenti possono essere applicati a livello **globale** per l'intera applicazione (sul provider `<Rebase>`) o a livello **locale** per una specifica collection (all'interno delle definizioni delle singole collection).

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

Per eseguire l'override dei componenti solo per una collection specifica, aggiungi un oggetto `components` alla sua definizione. Questo è utile per personalizzare stati vuoti, card o viste di dettaglio per modelli particolari.

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { ProductCustomForm } from "./components/ProductCustomForm";

const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: ProductCustomForm },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                    <div className="empty-state-wrapper">
                        <OriginalComponent {...props} />
                        <button onClick={() => importDemoProducts()}>
                            Load Demo Products
                        </button>
                    </div>
                )) as unknown as React.ComponentType<Record<string, unknown>>,
                wrap: true
            }
        }
    }
});

```

---

## Ambiti dei componenti soggetti a override

### Componenti con ambito applicazione (`AppComponentName`)

Questi componenti possono essere sovrascritti solo a livello del provider radice `<Rebase>`, poiché rappresentano la struttura dello shell.

| Chiave del componente | Descrizione |
|---|---|
| `"Shell.AppBar"` | La barra di intestazione nella parte superiore della pagina |
| `"Shell.Drawer"` | Il cassetto di navigazione principale comprimibile nella barra laterale |
| `"Shell.DrawerNavigationItem"` | Singoli collegamenti all'interno della barra laterale |
| `"Shell.DrawerNavigationGroup"` | Intestazioni comprimibili dei gruppi di navigazione nella barra laterale |
| `"HomePage"` | La pagina iniziale predefinita in modalità contenuto |
| `"HomePage.CollectionCard"` | Singole card delle collection nella home page |
| `"Auth.LoginView"` | L'overlay mostrato quando viene richiesta l'autenticazione |

### Componenti con ambito collection (`CollectionComponentName`)

Questi componenti possono essere sovrascritti a livello globale (fungendo da impostazioni predefinite per tutte le collection) o sulle singole collection.

| Chiave del componente | Descrizione |
|---|---|
| `"Collection.View"` | L'intera pagina principale della collection |
| `"Collection.Table"` | La vista tabellare predefinita a foglio di calcolo |
| `"Collection.Card"` | Il wrapper degli elementi per la visualizzazione a schede |
| `"Collection.EmptyState"` | Vista mostrata quando una collection è vuota |
| `"Collection.Actions"` | Pulsanti della barra degli strumenti sopra la tabella/schede |
| `"Collection.FilterField"` | Input di filtro personalizzato per una colonna |
| `"Entity.Form"` | Il form di dettaglio per la creazione/aggiornamento |
| `"EditView.FormActions"` | Barra dei pulsanti di invio/annullamento del form |
| `"DetailView"` | Vista di dettaglio di sola lettura |
| `"Entity.SidePanel"` | Il contenitore del pannello laterale per form/dettagli |
| `"EntityPreview"` | Anteprima chip inline per riferimenti/relazioni |
| `"Entity.MissingReference"` | Renderizzato quando un'entità referenziata è mancante |

:::note[Tre chiavi non seguono il pattern `Entity.`]
`"DetailView"`, `"EntityPreview"` ed `"EditView.FormActions"` non hanno il prefisso
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` ed `"Entity.FormActions"` non
fanno parte dell'unione: generano un errore di tipo e, in JavaScript puro, l'override
semplicemente non viene mai applicato.
:::

Il tuo componente sostitutivo riceve le stesse props fornite al componente integrato. La
mappa degli override non assegna un tipo di props per chiave (`ComponentOverride<P>` imposta come
predefinito di `P` il tipo `Record<string, unknown>`), quindi tipizza autonomamente il parametro,
oppure passa un argomento di tipo, quando desideri che le props vengano verificate. Alcuni
dei componenti integrati esportano un tipo di props che puoi importare e riutilizzare: `CollectionViewProps`
(`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps` e
`FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps` ed
`EntityFormActionsProps` (`@rebasepro/cms`). I restanti non dispongono di un tipo di props esportato:
scrivi direttamente la forma della struttura che effettivamente leggi.

## Correlati

- [Estendere Rebase](/docs/frontend/extending/) — i punti di estensione che non richiedono un override
- [Campi personalizzati](/docs/frontend/custom-fields/) — sostituzione dell'editor di una singola proprietà anziché di un intero componente
- [Slot](/docs/frontend/slots/) — aggiunta di elementi a un componente anziché la sua sostituzione

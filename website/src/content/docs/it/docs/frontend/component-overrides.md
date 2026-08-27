---
title: Sovrascrittura dei Componenti (Swizzling)
sidebar_label: Sovrascrittura dei Componenti
description: Sovrascrivi i componenti UI predefiniti con implementazioni personalizzate a livello di applicazione o di collezione.
---

## Panoramica

Rebase ti consente di sovrascrivere i componenti UI predefiniti con le tue implementazioni personalizzate. Questo implementa un modello di swizzling dei componenti in stile Docusaurus che supporta due pattern di personalizzazione:
- **Modalità eject** (predefinita): Il tuo componente sostituisce completamente quello integrato.
- **Modalità wrap** (`wrap: true`): Il tuo componente avvolge l'originale. Il componente integrato viene passato come prop `OriginalComponent` così puoi renderizzarlo all'interno del tuo layout/logica personalizzata.

Le sovrascritture dei componenti possono essere applicate **globalmente** a livello di applicazione (sul provider `<Rebase>`) o **localmente** a livello di collezione (all'interno delle definizioni delle singole collezioni).

---

## Sovrascritture Globali dei Componenti

Per sovrascrivere i componenti globalmente in tutta la tua applicazione, passa un oggetto `components` al provider radice `<Rebase>`.

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

## Sovrascritture dei Componenti a Livello di Collezione

Per sovrascrivere i componenti solo per una collezione specifica, aggiungi un oggetto `components` alla sua definizione. Questo è utile per personalizzare stati vuoti, card o viste di dettaglio per modelli particolari.

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

## Ambiti dei Componenti Sovrascrivibili

### Componenti con Ambito App (`AppComponentName`)

Questi componenti possono essere sovrascritti solo a livello del provider radice `<Rebase>`, poiché rappresentano la struttura a livello di shell.

| Chiave del Componente | Descrizione |
|---|---|
| `"Shell.AppBar"` | La barra dell'intestazione in cima alla pagina |
| `"Shell.Drawer"` | Il drawer di navigazione laterale principale comprimibile |
| `"Shell.DrawerNavigationItem"` | Link individuali all'interno della barra laterale |
| `"Shell.DrawerNavigationGroup"` | Intestazioni dei gruppi di navigazione comprimibili nella barra laterale |
| `"HomePage"` | La home page predefinita in modalità contenuto |
| `"HomePage.CollectionCard"` | Card di collezione individuali nella home page |
| `"Auth.LoginView"` | L'overlay mostrato quando si richiede l'autenticazione |

### Componenti con Ambito Collezione (`CollectionComponentName`)

Questi componenti possono essere sovrascritti globalmente (agendo come predefiniti per tutte le collezioni) o su collezioni individuali.

| Chiave del Componente | Descrizione |
|---|---|
| `"Collection.View"` | L'intera home page della collezione |
| `"Collection.Table"` | La vista tabellare tipo foglio di calcolo predefinita |
| `"Collection.Card"` | Il wrapper dell'elemento della vista a card |
| `"Collection.EmptyState"` | Vista mostrata quando una collezione è vuota |
| `"Collection.Actions"` | Pulsanti della toolbar sopra la tabella/le card |
| `"Collection.FilterField"` | Campo di filtro personalizzato per una colonna |
| `"Entity.Form"` | Il modulo di dettaglio per creare/aggiornare |
| `"EditView.FormActions"` | Barra dei pulsanti di invio/annullamento del modulo |
| `"DetailView"` | Vista di dettaglio in sola lettura |
| `"Entity.SidePanel"` | Il contenitore del pannello laterale per modulo/dettaglio |
| `"EntityPreview"` | Anteprima inline del chip di riferimento/relazione |
| `"Entity.MissingReference"` | Renderizzato quando un'entità referenziata è mancante |

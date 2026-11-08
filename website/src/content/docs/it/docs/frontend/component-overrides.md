---
sourceHash: f17c7d88a5f91dd1
title: Override dei componenti (Swizzling)
sidebar_label: Override dei componenti
description: Esegui l'override dei componenti UI predefiniti con implementazioni personalizzate a livello di applicazione o di collection.
---

## Panoramica

Rebase ti consente di eseguire l'override dei componenti UI predefiniti con le tue implementazioni personalizzate. Questo implementa un modello di swizzling dei componenti in stile Docusaurus che supporta due pattern di personalizzazione:
- **Modalità Eject** (predefinita): il tuo componente sostituisce completamente quello integrato.
- **Modalità Wrap** (`wrap: true`): il tuo componente racchiude quello originale. Ciò che viene racchiuso (solitamente il componente integrato) viene passato come prop `OriginalComponent`, consentendoti di eseguirne il rendering all'interno del tuo layout o della tua logica personalizzata.

Gli override dei componenti possono essere applicati a livello **globale** a livello di applicazione (sul provider `<Rebase>`) o a livello **locale** a livello di collection (all'interno delle singole definizioni delle collection).

---

## Override globali dei componenti

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

## Override dei componenti a livello di collection

Per eseguire l'override dei componenti solo per una collection specifica, aggiungi un oggetto `components` sotto il relativo blocco `admin`. Questo è utile per personalizzare empty state, schede (card) o viste di dettaglio per modelli specifici.

Nello scaffold predefinito, `config/collections/` viene caricato **sia** dal pannello di amministrazione sia dal backend, che legge gli stessi file per ricavare lo schema e l'API. Pertanto, fai riferimento a ciascun componente tramite il **percorso del modulo** anziché importarlo. `Component` accetta gli stessi formati di `admin.Field` ed `entityViews[].Builder`: un percorso, un `import()` lazy o il componente stesso.

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

Il componente wrapper risiede con il resto del tuo codice frontend e riceve ciò che racchiude come `OriginalComponent` — il componente integrato, a meno che anche la tua app non ne esegua l'override (vedi [Quando entrambi gli scope eseguono l'override di un componente](#quando-entrambi-gli-scope-eseguono-loverride-di-un-componente)):

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

Ogni modulo necessita di un **export predefinito** (default export). Il plugin Vite per le collection riscrive il percorso trasformandolo in un import lazy, in modo che il componente costituisca un chunk a sé stante e venga caricato la prima volta che l'override viene renderizzato. Questa riscrittura riguarda i file all'interno della cartella configurata in `collectionsDir`. Un percorso all'interno di un file esterno raggiunge l'admin come una stringa semplice: la console lo notificherà e al suo posto verrà renderizzato il componente integrato. Al di fuori di `collectionsDir`, scrivi l'import lazy manualmente: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Anche un riferimento diretto (`Component: ProductCustomForm`) funziona, ma solo in un file di collection che non viene caricato in alcun modo dal server, poiché importare il componente importa anche React e tutto ciò che esso include.

### Quando entrambi gli scope eseguono l'override di un componente

Nella versione 0.24, il wrapper di una collection riceve sempre il componente integrato, e l'override a livello di app viene ignorato all'interno di quella collection.

I due scope si compongono. L'override a livello di app (`<Rebase components>`) viene applicato per primo al componente integrato, e quello della collection (`admin.components`) viene applicato al risultato:

| Livello app | Livello collection | Cosa viene renderizzato all'interno di quella collection |
|---|---|---|
| qualsiasi | nessuno | ciò che viene renderizzato altrove: l'override a livello di app o il componente integrato |
| nessuno | wrap | il wrapper della collection attorno al componente integrato |
| replace o wrap | wrap | il wrapper della collection attorno all'override a livello di app, passato come `OriginalComponent` |
| qualsiasi | replace | unicamente il componente della collection; sostituisce entrambi |

In questo modo, una collection può aggiungere elementi attorno a un componente già personalizzato dalla tua app senza perdere tale personalizzazione. Per rimuovere la versione a livello di app per una determinata collection, usa replace anziché wrap.

---

## Scope dei componenti che supportano l'override

### Componenti con scope a livello di app (`AppComponentName`)

È possibile eseguire l'override di questi componenti solo a livello del provider radice `<Rebase>`, poiché rappresentano la struttura a livello di shell.

| Chiave componente | Descrizione |
|---|---|
| `"Shell.AppBar"` | La barra di intestazione nella parte superiore della pagina |
| `"Shell.Drawer"` | Il cassetto (drawer) comprimibile di navigazione della barra laterale principale |
| `"Shell.DrawerNavigationItem"` | Singoli link all'interno della barra laterale |
| `"Shell.DrawerNavigationGroup"` | Intestazioni comprimibili dei gruppi di navigazione nella barra laterale |
| `"HomePage"` | La home page di atterraggio predefinita in modalità contenuto |
| `"HomePage.CollectionCard"` | Singole schede di collection nella home page |
| `"Auth.LoginView"` | L'overlay mostrato quando viene richiesta l'autenticazione |

### Componenti con scope a livello di collection (`CollectionComponentName`)

È possibile eseguire l'override di questi componenti a livello globale (fungendo da impostazioni predefinite per tutte le collection) o sulle singole collection.

| Chiave componente | Descrizione |
|---|---|
| `"Collection.View"` | L'intera pagina di atterraggio della collection |
| `"Collection.Table"` | La vista tabellare predefinita a foglio di calcolo |
| `"Collection.Card"` | Il wrapper degli elementi della vista a schede (card) |
| `"Collection.EmptyState"` | Vista mostrata quando una collection è vuota |
| `"Collection.Actions"` | Pulsanti della barra degli strumenti sopra la tabella/schede |
| `"Collection.FilterField"` | Input di filtro personalizzato per una colonna |
| `"Entity.Form"` | Il form di dettaglio per la creazione/aggiornamento |
| `"EditView.FormActions"` | Barra dei pulsanti di invio/annullamento del form |
| `"DetailView"` | Vista di dettaglio in sola lettura |
| `"Entity.SidePanel"` | Il contenitore a pannello laterale per form/dettaglio |
| `"EntityPreview"` | Anteprima inline chip per riferimenti/relazioni |
| `"Entity.MissingReference"` | Renderizzato quando un'entità di riferimento è mancante |

:::note[Tre chiavi non seguono il pattern `Entity.`]
`"DetailView"`, `"EntityPreview"` ed `"EditView.FormActions"` non contengono il prefisso
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` ed `"Entity.FormActions"` non
fanno parte dell'unione: generano un errore di tipo e, in JavaScript puro, l'override
semplicemente non viene mai applicato.
:::

Il tuo componente sostitutivo riceve le stesse prop fornite al componente integrato. La
mappa degli override non specifica un tipo di prop per chiave — `ComponentOverride<P>` imposta di default
`P` su `Record<string, unknown>` — quindi tipizza tu stesso il parametro, o passa un
argomento di tipo, quando desideri la verifica delle prop. Alcuni dei componenti integrati esportano un
tipo di prop che puoi importare e riutilizzare: `CollectionViewProps` (`@rebasepro/ui`);
`CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps`
e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` e
`DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps`
(`@rebasepro/app`). I restanti non hanno un tipo di prop esportato: definisci la struttura
che leggi effettivamente.

### Cosa deve rispettare un override di `Collection.View`

`Collection.View` è ciò che viene renderizzato da un `CollectionPanel`, quindi le prop del pannello raggiungono
il tuo override come `CollectionViewBindingProps` (`@rebasepro/cms`), propagate (spread) sulle prop
della collection stessa. Una sostituzione che le ignora provocherà anomalie su ogni pagina che
incorpora la collection. Rispetta almeno le seguenti:

| Prop | Cosa si attende il chiamante |
|---|---|
| `collectionOverrides` | Ciò che il chiamante modifica della collection (un filtro fisso, un ordinamento, la modalità di visualizzazione), applicato sulla collection registrata |
| `fields` | Solo queste proprietà, in questo ordine: le colonne e gli elementi da cui vengono popolate le righe dell'elenco e le schede |
| `highlightedIds` | Gli ID delle righe renderizzate come selezionate; `[]` per nessuna |
| `onRowClick` | Invocato con la riga selezionata, così come inviata dal server, invece di aprirla. È l'`onRowClick` del pannello stesso |

Il pannello passa inoltre `viewMode` (la modalità in cui aprirsi), `toolbar` (la barra degli strumenti
da mostrare, `null` per nessuna) e `title` (`false` per non mostrare alcun titolo), laddove impostati
dal chiamante. Il componente predefinito `CollectionViewBinding` li gestisce tutti; un
override che lo racchiude anziché sostituirlo può inoltrarli direttamente.

Per iniziare dalla parte integrata anziché da zero, copia il relativo codice sorgente nel
tuo progetto e registra qui la copia: ogni parte ad eccezione di `Collection.View`,
`DetailView` e del drag-and-drop della home page compila con le importazioni dei package.
Vedi [Copiare una parte integrata](/docs/frontend/customizing#copying-a-built-in-part).

## Contenuti correlati

- [Estendere Rebase](/docs/frontend/extending/) — i punti di estensione che non richiedono un override
- [Campi personalizzati](/docs/frontend/custom-fields/) — sostituire l'editor di una singola proprietà anziché un intero componente
- [Slot](/docs/frontend/slots/) — aggiungere elementi a un componente anziché sostituirlo

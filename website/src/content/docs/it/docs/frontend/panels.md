---
sourceHash: a9be6e44e281baff
title: Pannelli in una tua pagina
sidebar_label: Pannelli nelle tue pagine
description: "Mostra una collezione, il form di un record, un record o un valore in una tua pagina: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue e CollectionsProvider, senza alcuna shell di amministrazione attorno."
---

Nella versione 0.24
`CollectionPanel` accetta solo un `path` registrato e visualizza "Collection not
found" al di fuori dell'albero di amministrazione completo, mentre `EntityFormPanel` e
`CollectionsProvider` non esistono.

Non hai bisogno dell'intera interfaccia di amministrazione per mostrare una tabella. `<CollectionPanel>` accetta
la collezione come valore e funziona ovunque sotto `<Rebase>` e un router React
Router, senza `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
import { postsCollection } from "../config/collections/posts";
// Plus BrowserRouter, or any other router, from "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection={postsCollection}/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Un record si apre sopra la tua pagina, in un pannello laterale o in una finestra di dialogo, e mai tramite URL:
nessuna route di amministrazione gestisce la pagina, quindi `full_screen` e `split` si aprono come pannello
laterale, e `useUrlController().routesMounted` è `false` per i tuoi
componenti presenti. Funziona qualsiasi router: un semplice `<BrowserRouter>`, un
`<MemoryRouter>` o un data router. Un router è comunque richiesto. Un data router
consente inoltre a un record con modifiche non salvate di bloccare la navigazione in-app; con gli
altri solo il prompt di uscita dalla pagina del browser funge da protezione. Avvolgi il pannello in `<RebaseAuthGate>` se la pagina
deve mostrare prima l'accesso di Rebase.

## Cosa mostra un pannello

<span class="since-badge" data-since="0.29">Dalla 0.29</span>
Un pannello renderizza la collezione nello stesso modo dell'admin. Queste prop lo limitano a ciò di
cui la tua pagina ha bisogno; nessuna di esse modifica la pagina della collezione stessa.

```tsx
import {
    CollectionAddButton,
    CollectionFiltersButton,
    CollectionPanel,
    CollectionSearchBar,
    CollectionToolbar
} from "@rebasepro/cms";

<CollectionPanel
    collection={ordersCollection}
    viewMode="cards"
    fields={["number", "status", "total"]}
    toolbar={<CollectionToolbar
        start={<CollectionFiltersButton/>}
        end={<><CollectionSearchBar/><CollectionAddButton/></>}/>}
    onRowClick={(order) => setSelected(order.id)}
    className="max-h-[480px]"/>
```

- `fields` — le proprietà visualizzate, in questo ordine, e nient'altro. Nella
  tabella rappresentano le colonne. Nella lista, su una card e su una card kanban
  sono gli elementi da cui vengono compilate le varie posizioni della riga — titolo, immagine, sottotitolo, stato, data,
  chip di relazione, le colonne della lista — dando priorità a quelle indicate per prime; una posizione che nessuna
  di esse compila rimane vuota. Per questo pannello, ha la precedenza su `propertiesOrder`,
  sull'ordine delle colonne salvato dall'utente e su `listProperties`. Le larghezze delle colonne trascinate da un utente
  persistono comunque; l'ordine è definito da te, quindi le colonne non possono essere trascinate.
- `toolbar` — l'intera barra degli strumenti per impostazione predefinita, `null` per nessuna, oppure una composta
  dai suoi singoli elementi: `CollectionToolbar` (con `start` ed `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Questi leggono il pannello in cui vengono renderizzati e generano un errore
  altrove. Gli slot dei plugin e l'override di `Collection.Actions` risiedono nella
  barra degli strumenti predefinita.
- `onRowClick` — invocata con la riga cliccata invece dell'apertura gestita dal pannello,
  da una riga, una card, una card kanban e dall'azione di modifica. La riga è quella inviata dal
  server, nella stessa forma accettata da `useRows`, `useRow` e `<FieldValue>`: `id`,
  stringhe di data ISO (`YYYY-MM-DD` per una colonna di sola data) e una relazione belongsTo
  come relativa chiave esterna (`customerId`). Una relazione di cui il pannello ha caricato la
  destinazione arriva annidata sotto il proprio nome, come restituito dall'`include` di REST
  (`order.customer` è la riga del cliente); è presente anche la relativa chiave esterna.
- `highlightedIds` — gli ID delle righe renderizzate come selezionate, ad esempio quella mostrata da una pagina
  accanto all'elenco: `highlightedIds={selected ? [selected] : []}`.
  `[]` non ne evidenzia alcuna. In sua assenza, il pannello evidenzia l'ultima riga aperta.
- `viewMode` — la modalità in cui si apre, sovrascrivendo quella nell'URL e quella
  scelta per ultima dall'utente. È comunque possibile cambiare modalità.
- `title={false}` — nessun titolo sopra il pannello, né l'intestazione propria della vista a elenco.
- `updateUrl` — disattivato per impostazione predefinita: il pannello non legge né scrive i parametri
  `__view`, di filtro e di ordinamento della pagina.

Le `entityActions` della collezione vengono renderizzate su ogni riga, card e card kanban, sotto forma di
pulsanti quando dichiarate con `collapsed: false` e nel menu della riga in caso contrario — un
"Approva" su ogni card è un'azione.

Un pannello si dimensiona in base alle sue righe. Senza un'altezza definita dal genitore, o con solo un
`max-height`, una collezione breve renderizza la sua barra degli strumenti e le righe, mentre una lunga
scorre all'interno dello spazio disponibile, fino all'altezza della finestra. Assegnagli un'altezza per
riempirlo. La disposizione si adatta alla propria larghezza, non a quella della finestra: in una colonna
stretta utilizza il suo layout compatto, indipendentemente dallo schermo.

`propertiesOrder` riordina e non nasconde mai: una proprietà esclusa viene renderizzata
dopo quelle indicate. Per nasconderne una ovunque, imposta `admin.hideFromCollection`
su di essa; per mostrarne solo alcune in un punto specifico, passa `fields`.

## Il form di un singolo record

`<EntityFormPanel>` fa lo stesso per il form di un singolo record. Carica il record
tramite `id`, lo salva attraverso il data layer di `<Rebase>` come fa il
form nativo dell'admin, e chiama `onSaved` dopo ogni salvataggio passando il record salvato esattamente come il
server invia la riga, `row`, e il relativo `id`. Ometti `id` per creare un
record. `onClose` viene chiamato quando il form richiede di essere chiuso, ad esempio
dopo l'eliminazione del record:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Se qualcun altro elimina il record mentre il form è aperto, il form mantiene
quanto digitato e segnala che il record è stato eliminato altrove. La sua azione
"Salva come nuovo" lo trasforma in un form che crea un nuovo record con quei valori;
`onSaved` segnala quindi il nuovo record.

<span class="since-badge" data-since="0.29">Dalla 0.29</span> Il form può mostrare
parte di un record o disporlo a tuo piacimento. `fields` mostra solo i campi
indicati, in quell'ordine; le sezioni e la barra laterale mantengono il loro raggruppamento. `layout`
sostituisce i campi generati con il tuo JSX personalizzato, in cui
`<FormField name="…"/>` renderizza un campo con l'etichetta, le dimensioni e le regole assegnategli
dal form generato:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    id={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

In entrambi i casi, il form convalida solo i campi che mostra; il server controlla
comunque l'intero record. Un form che crea un record e omette un
campo obbligatorio senza un valore predefinito lo segnala all'apertura: un errore indica il nome del
campo e il salvataggio rimane bloccato finché il campo non viene mostrato o non gli viene assegnato un valore predefinito.
`collectionOverrides` modifica la collezione solo per questo form, proprio come fa per
`CollectionPanel`.

Ogni form isola i propri ID DOM, consentendo a due form di condividere la stessa pagina. Per trovare un campo
da un test, seleziona `[data-form-field="title"]` all'interno di
`[data-form-path="posts"]` del form.

<span class="since-badge" data-since="0.29">Dalla 0.29</span>
`<EntityViewPanel>` è l'equivalente in sola lettura di `EntityFormPanel`. Carica il
record tramite `id` e lo renderizza nello stesso modo della pagina del record dell'admin: le stesse
sezioni ed etichette, con ogni valore nella sua anteprima, così un enum viene mostrato come
chip, una data nel rispettivo fuso orario e una relazione con il titolo della sua destinazione. Accetta
`fields` e `collectionOverrides` come il form, ed esclude i campi che il
form esclude: quelli nascosti per questo record da una regola `conditions.hidden` e
quelli che l'utente autenticato non ha il permesso di leggere.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` renderizza un singolo valore nello stesso modo, all'interno del tuo JSX. Accetta
l'intera riga, così come restituita da `useRows`, `useRow` e `client.data`, poiché una
relazione belongsTo arriva sotto la colonna della chiave esterna (`customerId`) e non
sotto il nome della proprietà; `field="customer"` la individua lì. Richiede che la
collezione sia registrata a un livello superiore, tramite `<RebaseCMS>` o un `CollectionsProvider`.
Una collezione o un campo sconosciuti generano un errore che ne specifica il nome.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(row => (
        <div key={String(row.id)} className="flex gap-4">
            <FieldValue row={row} collection="orders" field="customer"/>
            <FieldValue row={row} collection="orders" field="status"/>
            <FieldValue row={row} collection="orders" field="placedAt"/>
        </div>
    ));
}
```

## Più pannelli in un unico scope

I tre pannelli integrano il proprio `CollectionsProvider` quando non ne è presente uno a monte. Questo è
il passaggio sottostante, ed è possibile montarlo manualmente per condividere un unico scope tra
più pannelli, oppure per utilizzare al di sotto i componenti di livello inferiore (`CollectionViewBinding`,
`useSidePanel`). Al suo interno, un pannello può indicare la propria collezione tramite `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` gestisce un registro delle collezioni fornite, con `modifyCollection`
e `injectCollections` dei tuoi plugin applicati come nell'admin, oltre ai pannelli
laterali e alle finestre di dialogo in cui si aprono i record, nonché la protezione per
le modifiche non salvate. Mantieni stabile l'array `collections`: tramite una costante di modulo
o `useMemo`.

## Prossimi passi

- [Personalizzazione dell'admin](/docs/frontend/customizing): dove inserire i
  tuoi componenti e le ricette create a partire da questi pannelli.
- [Hook](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, le righe lette da questi pannelli e da `FieldValue`.
- [Override dei componenti](/docs/frontend/component-overrides): sostituisci la vista
  o il form renderizzato da un pannello.

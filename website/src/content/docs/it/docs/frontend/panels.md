---
sourceHash: a33ca593ee016656
title: Pannelli in una propria pagina
sidebar_label: Pannelli nelle tue pagine
description: "Mostra una collection, il form di un record, un record o un singolo valore in una tua pagina: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue e CollectionsProvider, senza alcuna shell di amministrazione attorno."
---

Nella versione 0.24
`CollectionPanel` accetta solo un `path` registrato e visualizza "Collection not
found" al di fuori dell'albero di amministrazione completo, mentre `EntityFormPanel` e
`CollectionsProvider` non esistono.

Non è necessario l'intero pannello di amministrazione per mostrare una singola tabella. `<CollectionPanel>` accetta
la collection come valore e funziona ovunque sotto `<Rebase>` e un router React
Router, senza bisogno di `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`:

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
laterale e `useUrlController().routesMounted` è `false` per i tuoi componenti al
suo interno. Qualsiasi router è supportato: un semplice `<BrowserRouter>`, un
`<MemoryRouter>` o un data router. Un router è comunque richiesto. Un data router
consente inoltre a un record con modifiche non salvate di bloccare la navigazione interna all'app; con
gli altri router, solo il prompt di uscita dalla pagina del browser fornisce protezione. Avvolgi il pannello in `<RebaseAuthGate>` se la pagina
deve mostrare prima l'accesso di Rebase.

## Cosa mostra un pannello

<span class="since-badge" data-since="0.29">Da 0.29</span>
Un pannello renderizza la collection nello stesso modo dell'admin. Queste prop
lo restringono a ciò di cui la tua pagina ha bisogno; nessuna di esse modifica la pagina della collection stessa.

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
    onRowClick={(order, id) => setSelected(id)}
    className="max-h-[480px]"/>
```

- `fields` — le proprietà che mostra, in questo ordine, e nient'altro. Nella
  tabella rappresentano le colonne. Nella lista, su una scheda e su una scheda kanban
  sono gli elementi con cui vengono popolati gli spazi della riga — titolo, immagine, sottotitolo, stato, data,
  chip di relazione, colonne dell'elenco — con priorità ai primi;
  uno spazio non compilato da alcuno di essi rimane vuoto. Per questo pannello ha la precedenza su `propertiesOrder`,
  sull'ordine delle colonne salvato dall'utente e su `listProperties`. Le larghezze delle colonne ridimensionate
  dall'utente persistono comunque; l'ordine è definito da te, quindi le colonne non possono essere trascinate.
- `toolbar` — la barra degli strumenti completa per impostazione predefinita, `null` per nessuna, o una
  composta dalle sue parti: `CollectionToolbar` (con `start` ed `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Leggono il pannello in cui sono renderizzati e generano un errore
  altrove. Gli slot dei plugin e l'override di `Collection.Actions` risiedono nella
  barra degli strumenti predefinita.
- `onRowClick` — chiamata con la riga selezionata e il suo id invece di farla
  aprire dal pannello, a partire da una riga, una scheda, una scheda kanban e dall'azione di modifica. La riga è
  quella inviata dal server, nella stessa forma accettata da `useRows`, `useRow` e `<FieldValue>`:
  esattamente le sue colonne, stringhe di data ISO (`YYYY-MM-DD` per una colonna
  di sola data) e una relazione belongsTo sotto forma di foreign key (`customerId`). Una relazione di cui il pannello ha caricato
  la destinazione arriva nidificata sotto il suo nome, come restituito dalla clausola `include` di REST
  (`order.customer` è la riga del cliente); è presente anche la sua foreign key. L'id
  è la stringa con cui l'admin fa riferimento al record — la sua chiave primaria, o le parti di
  una chiave composita unite da `:::` — accettata da `highlightedIds` e
  `useSidePanel().open`. `row.id` è la colonna `id` del record, se la
  tabella ne ha una, con il tipo di quella colonna: `5` per una chiave intera, il cui id è
  `"5"`.
- `highlightedIds` — gli id delle righe visualizzate come selezionate, ad esempio quella
  mostrata da una pagina accanto all'elenco: `highlightedIds={selected ? [selected] : []}`.
  `[]` non ne evidenzia nessuna. Senza questa prop, il pannello evidenzia l'ultima riga aperta. Gli id
  vengono confrontati come stringhe, quindi per una chiave intera `5` e `"5"` corrispondono alla stessa riga.
- `viewMode` — la modalità con cui si apre, con priorità rispetto a quella nell'URL e all'ultima
  scelta dall'utente. È comunque possibile cambiare modalità.
- `title={false}` — nessun titolo sopra il pannello, né l'intestazione propria della vista elenco.
- `updateUrl` — disattivato per impostazione predefinita: il pannello non legge né scrive i
  parametri `__view`, filtro e ordinamento della pagina.

Le `entityActions` della collection vengono renderizzate su ogni riga, scheda e scheda kanban, come
pulsanti se dichiarate con `collapsed: false` e nel menu della riga in caso contrario — un
pulsante "Approva" su ogni scheda rappresenta un'azione.

Un pannello adatta le proprie dimensioni alle righe. Senza un'altezza definita dal genitore, o solo con un
`max-height`, una collection breve disegna la barra degli strumenti e le righe, mentre una più lunga
scorre nello spazio a disposizione, fino all'altezza della finestra. Assegna un'altezza per
riempirlo. La disposizione si basa sulla propria larghezza e non su quella della finestra: in una colonna
stretta adotta il layout compatto, indipendentemente dallo schermo.

`propertiesOrder` riordina e non nasconde mai: una proprietà omessa viene disegnata
dopo quelle specificate. Per nasconderne una ovunque, imposta `admin.hideFromCollection`
su di essa; per mostrarne solo alcune in un punto specifico, passa `fields`.

## Il form di un singolo record

`<EntityFormPanel>` fa lo stesso per il form di un singolo record. Carica il record
tramite `id`, lo salva attraverso il data layer di `<Rebase>` come fa il form
dell'admin stesso e chiama `onSaved` dopo ogni salvataggio con il record salvato restituito come
riga dal server, `row`, e il suo `id`. Ometti `id` per creare un
record. `onClose` viene chiamata quando il form richiede di essere chiuso, ad esempio dopo
l'eliminazione del record:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Se qualcun altro elimina il record mentre il form è aperto, il form mantiene
quanto digitato e segnala che il record è stato eliminato altrove. La sua azione "Salva come nuovo"
lo trasforma in un form per la creazione di un nuovo record con quei valori;
`onSaved` segnala quindi il nuovo record.

<span class="since-badge" data-since="0.29">Da 0.29</span> Il form può mostrare
una parte di un record o disporlo a tuo piacimento. `fields` mostra solo i campi
specificati, in quell'ordine; le sezioni e la rail mantengono il loro raggruppamento. `layout`
sostituisce i campi generati con il tuo JSX personalizzato, in cui
`<FormField name="…"/>` disegna un singolo campo con etichetta, dimensioni e regole assegnate
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

In entrambi i casi, il form convalida solo i campi mostrati; il server continua a
controllare l'intero record. Un form che crea un record e omette un
campo obbligatorio senza valore predefinito lo segnala all'apertura: un errore indica il
campo e il salvataggio rimane bloccato fino a quando il campo non viene mostrato o non gli viene assegnato un valore predefinito.
`collectionOverrides` modifica la collection solo per questo form, esattamente come accade per
`CollectionPanel`.

Ciascun form delimita l'ambito dei propri ID DOM, consentendo a due form di condividere la stessa pagina. Per trovare un campo
all'interno di un test, seleziona `[data-form-field="title"]` all'interno di
`[data-form-path="posts"]` del form.

<span class="since-badge" data-since="0.29">Da 0.29</span>
`<EntityViewPanel>` è il gemello di sola lettura di `EntityFormPanel`. Carica il
record tramite `id` e lo renderizza come fa la pagina del record nell'admin: le
stesse sezioni ed etichette, con ogni valore nella sua anteprima, così un enum viene mostrato come
chip, una data nel rispettivo fuso orario e una relazione come titolo della destinazione. Accetta
`fields` e `collectionOverrides` come il form, e omette i campi
che il form omette: quelli nascosti da una regola `conditions.hidden` per questo record e
quelli che l'utente autenticato non è autorizzato a leggere.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` renderizza un singolo valore nello stesso modo, all'interno del tuo JSX. Accetta
l'intera riga, così come restituita da `useRows`, `useRow` e `client.data`, poiché una
relazione belongsTo arriva sotto la rispettiva colonna foreign-key (`customerId`) e non
sotto il nome della proprietà; `field="customer"` la individua lì. Richiede che
la collection sia registrata a un livello superiore, tramite `<RebaseCMS>` o un `CollectionsProvider`.
Una collection o un campo sconosciuti generano un errore indicandone il nome.

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

## Diversi pannelli in un unico scope

I tre pannelli integrano il proprio `CollectionsProvider` quando non ne è presente uno a monte. Questo è
il passaggio sottostante, ed è possibile montarlo direttamente per condividere un unico scope tra
più pannelli o per utilizzare i componenti di livello inferiore (`CollectionViewBinding`,
`useSidePanel`) al suo interno. Al suo interno, un pannello può indicare la propria collection tramite `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` mantiene un registro delle collection fornite, con `modifyCollection`
e `injectCollections` dei tuoi plugin applicati come nell'admin,
oltre ai pannelli laterali e alle finestre di dialogo in cui si aprono i record, nonché la
protezione per le modifiche non salvate. Mantieni stabile l'array `collections`: tramite una costante a livello di modulo
o `useMemo`.

## Passaggi successivi

- [Personalizzare l'admin](/docs/frontend/customizing): i punti in cui è possibile
  inserire un tuo componente e le ricette create a partire da questi pannelli.
- [Hook](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, le righe lette da questi pannelli e da `FieldValue`.
- [Override dei componenti](/docs/frontend/component-overrides): sostituisci la vista
  o il form renderizzati da un pannello.

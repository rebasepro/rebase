---
sourceHash: 095805c8d62157c4
title: Pannelli in una pagina personalizzata
sidebar_label: Pannelli nelle tue pagine
description: "Mostra una collezione, il form di un record, un record o un singolo valore in una pagina personalizzata: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue e CollectionsProvider, senza la shell di amministrazione attorno."
---

Nella versione 0.24
`CollectionPanel` accetta solo un `path` registrato e renderizza "Collection not
found" al di fuori dell'albero completo dell'admin, mentre `EntityFormPanel` e
`CollectionsProvider` non esistono.

Non hai bisogno dell'intero pannello di amministrazione per mostrare una singola tabella. `<CollectionPanel>` accetta
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
nessuna route di amministrazione serve la pagina, quindi `full_screen` e `split` si aprono come pannello
laterale, e `useUrlController().routesMounted` è `false` per i tuoi componenti lì presenti. Qualsiasi router va bene: un semplice `<BrowserRouter>`, un
`<MemoryRouter>` o un data router. Un router è comunque richiesto. Un data router
consente inoltre a un record con modifiche non salvate di bloccare la navigazione in-app; con gli
altri, solo il prompt di uscita dalla pagina del browser fornisce protezione. Avvolgi il pannello in `<RebaseAuthGate>` se la pagina
deve mostrare prima il login di Rebase.

## Cosa mostra un pannello

<span class="since-badge" data-since="0.29">Da 0.29</span>
Un pannello disegna la collezione esattamente come fa l'admin. Queste prop lo restringono a ciò di cui
la tua pagina ha bisogno; nessuna di esse modifica la pagina propria della collezione.

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

- `fields` — le proprietà visualizzate, in questo ordine, e nient'altro. Nella
  tabella sono le colonne. Nella lista, su una card e su una card kanban
  costituiscono gli elementi con cui i vari campi della riga — titolo, immagine, sottotitolo, stato, data,
  chip di relazione, colonne della lista — vengono popolati, a partire dai primi; uno spazio che
  nessuno di essi compila rimane vuoto. Per questo pannello ha la priorità su `propertiesOrder`,
  sull'ordine delle colonne salvato dall'utente e su `listProperties`. Le larghezze delle colonne trascinate
  dall'utente persistono comunque; l'ordine è definito da te, quindi le colonne non possono essere trascinate.
- `toolbar` — l'intera barra degli strumenti per impostazione predefinita, `null` per ometterla, oppure una barra composta
  dai suoi singoli elementi: `CollectionToolbar` (con `start` ed `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Leggono il pannello in cui sono disegnati e generano un errore
  in qualsiasi altro contesto. Gli slot per i plugin e l'override `Collection.Actions` risiedono nella
  toolbar predefinita.
- `onRowClick` — funzione chiamata con la riga cliccata e il suo id invece dell'apertura predefinita
  del pannello, da una riga, una card, una card kanban e dall'azione di modifica. La riga è
  quella restituita dal server, la stessa struttura accettata da `useRows`, `useRow` e `<FieldValue>`:
  esattamente le sue colonne, stringhe di date ISO (`YYYY-MM-DD` per una colonna
  di sola data) e una relazione belongsTo come chiave esterna (`customerId`). Una relazione di cui il pannello ha caricato
  la destinazione arriva nidificata sotto il suo nome, come restituito da `include` di REST
  (`order.customer` è la riga del cliente); è presente anche la sua chiave esterna. L'id
  è la stringa con cui l'admin fa riferimento al record — la sua chiave primaria, o le parti di una chiave
  composta unite da `:::` — accettata da `highlightedIds` e
  `useSidePanel().open`. `row.id` è la colonna `id` del record, dove la
  tabella ne ha una, con il tipo di quella colonna: `5` per una chiave intera, il cui id è
  `"5"`.
- `highlightedIds` — gli id delle righe renderizzate come selezionate, ad esempio quella che una pagina
  mostra accanto alla lista: `highlightedIds={selected ? [selected] : []}`.
  `[]` non ne seleziona nessuna. Senza questa prop, il pannello evidenzia l'ultima riga aperta. Gli id
  vengono confrontati come stringhe, quindi un `5` e un `"5"` per una chiave intera rappresentano la stessa riga.
- `where` — quali righe visualizzare, nello stesso formato accettato da `useRows`:
  `where={{ status: ["==", "pending"] }}`. I filtri impostati dall'utente su altri
  campi si combinano con esso, e i relativi campi non possono essere modificati o cancellati
  dalla toolbar. Si adatta alla prop, quindi una barra di schede o una barra di un grafico cliccata possono
  pilotarlo direttamente dallo stato. Ha la priorità sul `fixedFilter` della collezione,
  campo per campo.
- `viewMode` — la modalità in cui si apre, con priorità rispetto a quella nell'URL e a quella
  scelta per ultima dall'utente. È comunque possibile cambiare modalità.
- `title={false}` — nessun titolo sopra il pannello, né l'intestazione propria della vista elenco.
- `updateUrl` — disattivato per impostazione predefinita: il pannello non legge né scrive i
  parametri `__view`, di filtro e di ordinamento della pagina.

Le `entityActions` della collezione vengono mostrate su ogni riga, card e card kanban, sotto forma
di pulsanti se dichiarate con `collapsed: false` e nel menu della riga altrimenti — un pulsante
"Approva" su ogni card è un'azione di questo tipo.

Un pannello si dimensiona in base alle sue righe. Senza un'altezza definita dal componente genitore, o con un semplice
`max-height`, una collezione breve mostra la toolbar e le righe, mentre una lunga
scorre all'interno dello spazio disponibile, fino all'altezza della finestra. Assegna un'altezza per
riempirla. Il pannello adatta il proprio layout in base alla propria larghezza, non a quella della finestra: in una
colonna stretta usa il suo layout compatto, a prescindere dalle dimensioni dello schermo.

`propertiesOrder` riordina e non nasconde mai: una proprietà esclusa viene disegnata
dopo quelle indicate. Per nasconderne una ovunque, imposta `admin.hideFromCollection`
su di essa; per mostrarne solo alcune in un punto specifico, passa `fields`.

## Il form di un singolo record

`<EntityFormPanel>` fa la stessa cosa per il form di un singolo record. Carica il record
tramite `id`, lo salva attraverso il data layer di `<Rebase>` esattamente come fa il form
dell'admin stesso, e chiama `onSaved` dopo ogni salvataggio passando il record salvato restituito dal
server, `row`, e il suo `id`. Ometti `id` per creare un nuovo
record. `onClose` viene chiamato quando il form richiede la chiusura, ad esempio dopo
l'eliminazione del record:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Come `CollectionPanel`, il form e `EntityViewPanel` accettano una collezione registrata
tramite `path`, senza dover passare l'oggetto di configurazione:
`<EntityFormPanel path="posts" id={postId}/>`. Sotto `<RebaseCMS>` o un
`CollectionsProvider` che la registra, questo è tutto ciò di cui hanno bisogno. Senza uno scope
superiore, passa la collezione direttamente come valore, come in questo esempio, e il pannello fornirà il
proprio scope; una collezione indicata tramite un percorso non registrato segnalerà che il record non è stato trovato.

Se qualcun altro elimina il record mentre il form è aperto, il form conserva
quanto digitato e segnala che il record è stato cancellato altrove. L'azione "Salva come nuovo"
lo trasforma in un form per creare un nuovo record con quei valori;
`onSaved` notificherà quindi il nuovo record.

<span class="since-badge" data-since="0.29">Da 0.29</span> Il form può mostrare solo una
parte di un record o disporlo a piacimento. `fields` mostra solo i campi
specificati, in quell'ordine; le sezioni e il rail mantengono il loro raggruppamento. `layout`
sostituisce i campi generati con il tuo JSX personalizzato, all'interno del quale
`<FormField name="…"/>` disegna un campo con etichetta, dimensione e regole definite
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

In entrambi i casi il form convalida solo i campi mostrati; il server continua a
verificare l'intero record. Un form che crea un record e omette un campo
obbligatorio senza valore predefinito lo segnala all'apertura: un errore indica il
campo e il salvataggio rimane bloccato finché il campo non viene mostrato o non gli viene assegnato un default.
`collectionOverrides` modifica la collezione solo per questo form, proprio come avviene per
`CollectionPanel`.

Ogni form isola i propri id DOM, quindi due form possono coesistere nella stessa pagina. Per individuare un campo
in un test, seleziona `[data-form-field="title"]` all'interno del contenitore del form
`[data-form-path="posts"]`.

<span class="since-badge" data-since="0.29">Da 0.29</span>
`<EntityViewPanel>` è la controparte in sola lettura di `EntityFormPanel`. Carica il
record tramite `id` e lo renderizza come fa la pagina del record dell'admin: le stesse
sezioni ed etichette, con ogni valore nella sua anteprima, così un enum viene mostrato come un
chip, una data nel rispettivo fuso orario e una relazione come titolo della destinazione. Accetta
`fields` e `collectionOverrides` esattamente come il form, ed esclude i campi che
il form esclude: quelli nascosti per questo record da una regola `conditions.hidden` e
quelli che l'utente autenticato non ha il permesso di leggere.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` disegna un singolo valore allo stesso modo, all'interno del tuo JSX. Accetta
l'intera riga, come restituita da `useRows`, `useRow` e `client.data`, poiché una
relazione belongsTo arriva sotto la colonna della chiave esterna (`customerId`), non
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
            <FieldValue row={row} path="orders" field="customer"/>
            <FieldValue row={row} path="orders" field="status"/>
            <FieldValue row={row} path="orders" field="placedAt"/>
        </div>
    ));
}
```

## Più pannelli in un unico scope

I tre pannelli integrano il proprio `CollectionsProvider` se non ne è presente uno superiore. Questo è
il componente sottostante, e puoi montarlo tu stesso per condividere un unico scope tra
più pannelli, o per usare le parti di livello inferiore (`CollectionViewBinding`,
`useSidePanel`) al suo interno. All'interno di esso, un pannello può identificare la propria collezione tramite `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` gestisce un registro delle collezioni fornite, con le funzioni
`modifyCollection` e `injectCollections` dei tuoi plugin applicate come nell'admin,
oltre ai pannelli laterali e alle finestre di dialogo in cui si aprono i record, nonché la
protezione per le modifiche non salvate. Mantieni stabile l'array `collections`: tramite una costante a livello di modulo
o con `useMemo`.

## Passaggi successivi

- [Personalizzare l'admin](/docs/frontend/customizing): i punti in cui è possibile inserire un
  proprio componente e i pattern realizzati a partire da questi pannelli.
- [Hook](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, le righe lette da questi pannelli e da `FieldValue`.
- [Override dei componenti](/docs/frontend/component-overrides): sostituisci la vista
  o il form renderizzati da un pannello.

---
sourceHash: 29030083cf83fb27
title: Pannelli in una pagina personalizzata
sidebar_label: Pannelli nelle tue pagine
description: "Mostra una collezione, il modulo di un record, un record o un singolo valore in una tua pagina: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue e CollectionsProvider, senza alcuna shell di amministrazione attorno ad essi."
---

Nella versione 0.24
`CollectionPanel` accetta solo un `path` registrato e visualizza "Collection not
found" al di fuori dell'intero albero di amministrazione, ed `EntityFormPanel` e
`CollectionsProvider` non esistono.

Non hai bisogno dell'intera interfaccia di amministrazione per mostrare una tabella. `<CollectionPanel>` accetta
la collezione come valore e funziona ovunque sotto `<Rebase>` e un router di React
Router, senza alcun `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`:

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
laterale, e `useUrlController().routesMounted` è `false` per i tuoi componenti al suo interno. Qualsiasi router funziona: un semplice `<BrowserRouter>`, un
`<MemoryRouter>` o un data router. Un router è comunque richiesto. Un data router
consente inoltre a un record con modifiche non salvate di bloccare la navigazione in-app; con gli
altri router, solo il prompt di uscita dalla pagina del browser offre protezione. Avvolgi il pannello in `<RebaseAuthGate>` se la pagina
deve mostrare prima il login di Rebase.

## Cosa mostra un pannello

<span class="since-badge" data-since="0.29">Dalla versione 0.29</span>
Un pannello renderizza la collezione esattamente come fa l'admin. Queste prop lo restringono a ciò di cui
la tua pagina ha bisogno; nessuna di esse modifica la pagina della collezione stessa.

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

- `fields` — le proprietà mostrate, in questo ordine, e nient'altro. Nella
  tabella rappresentano le colonne. Nella lista, su una scheda e su una scheda kanban
  sono gli elementi con cui vengono riempiti gli spazi della riga — titolo, immagine, sottotitolo, stato, data,
  chip di relazione, colonne della lista —, dando precedenza ai primi; uno spazio non coperto
  da nessuno di essi rimane vuoto. Per questo pannello ha la precedenza su `propertiesOrder`,
  sull'ordine delle colonne salvato da un utente e su `listProperties`. La larghezza delle colonne
  trascinata da un utente viene comunque mantenuta; l'ordine è personalizzato, quindi le colonne non possono essere trascinate.
- `toolbar` — la toolbar completa per impostazione predefinita, `null` per nessuna, oppure
  una barra composta dai suoi elementi costitutivi: `CollectionToolbar` (con `start` ed `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Essi leggono il pannello in cui vengono renderizzati e generano un errore
  altrove. Gli slot dei plugin e l'override di `Collection.Actions` si trovano nella toolbar predefinita.
- `onRowClick` — chiamata con la riga cliccata invece dell'apertura gestita dal pannello,
  a partire da una riga, una scheda, una scheda kanban e dall'azione di modifica. La riga corrisponde a quella
  inviata dal server, nella struttura accettata da `useRows`, `useRow` e `<FieldValue>`: stringhe di
  data ISO (`YYYY-MM-DD` per una colonna di sola data) e una relazione belongsTo come chiave esterna
  (`customerId`), non con il nome della relazione.
- `viewMode` — la modalità in cui si apre, sovrascrivendo quella nell'URL e quella
  scelta per ultima dall'utente. È comunque possibile cambiare modalità.
- `title={false}` — nessun titolo sopra il pannello, né l'intestazione propria della vista elenco.
- `updateUrl` — disattivato per impostazione predefinita: il pannello non legge né scrive i parametri
  `__view`, di filtro e di ordinamento della pagina.

Le `entityActions` della collezione vengono mostrate su ogni riga, scheda e scheda kanban, sotto forma di
pulsanti quando dichiarate con `collapsed: false` e nel menu della riga in caso contrario — un pulsante
"Approva" su ogni scheda costituisce un'azione.

Un pannello adatta le proprie dimensioni alle sue righe. Senza un'altezza definita dal genitore, o con solo una
`max-height`, una collezione breve mostra la sua toolbar e le sue righe, mentre una lunga scorre all'interno dello spazio disponibile,
fino all'altezza della finestra. Assegna un'altezza per riempirla. Il layout si adatta alla propria
larghezza e non a quella della finestra: in una colonna stretta utilizzerà il suo layout compatto, indipendentemente dallo schermo.

`propertiesOrder` riordina e non nasconde mai: una proprietà omessa viene renderizzata
dopo quelle indicate. Per nasconderne una ovunque, imposta `admin.hideFromCollection`
su di essa; per mostrarne solo alcune in un punto specifico, passa `fields`.

## Modulo di un singolo record

`<EntityFormPanel>` fa lo stesso per il modulo di un singolo record. Carica il record
tramite `entityId`, lo salva attraverso il data layer di `<Rebase>` come fa il
modulo nativo dell'admin e chiama `onSaved` dopo ogni salvataggio. Ometti `entityId` per creare un
record. `onClose` viene richiamato quando il modulo richiede di essere chiuso, ad esempio dopo
l'eliminazione del record:

```tsx
<EntityFormPanel
    collection={postsCollection}
    entityId={postId}
    onSaved={({ entity }) => console.log("saved", entity.id)}
    onClose={() => navigate("/posts")}/>
```

Se qualcun altro elimina il record mentre il modulo è aperto, il modulo conserva
quanto digitato e segnala che il record è stato eliminato altrove. L'azione "Salva come nuovo"
lo trasforma in un modulo che crea un nuovo record con quei valori;
`onSaved` notificherà quindi il nuovo record.

<span class="since-badge" data-since="0.29">Dalla versione 0.29</span> Il modulo può mostrare
parte di un record o disporlo a tuo piacimento. `fields` mostra solo i campi
specificati, in quell'ordine; le sezioni e la barra laterale mantengono il loro raggruppamento. `layout`
sostituisce i campi generati con il tuo JSX personalizzato, in cui
`<FormField name="…"/>` renderizza un singolo campo con l'etichetta, le dimensioni e le regole definite dal modulo generato:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    entityId={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

In entrambi i casi, il modulo convalida solo i campi mostrati; il server continua
comunque a verificare l'intero record. Un modulo che crea un record e omette un
campo obbligatorio privo di valore predefinito lo segnala all'apertura: un errore indica il
campo e il salvataggio rimane bloccato finché il campo non viene mostrato o non gli viene assegnato un valore predefinito.
`collectionOverrides` modifica la collezione solo per questo modulo, esattamente come avviene per
`CollectionPanel`.

Ogni modulo isola i propri ID DOM nello scope locale, consentendo a due moduli di condividere la stessa pagina. Per individuare un campo
da un test, seleziona `[data-form-field="title"]` all'interno di
`[data-form-path="posts"]` del modulo.

<span class="since-badge" data-since="0.29">Dalla versione 0.29</span>
`<EntityViewPanel>` è la controparte in sola lettura di `EntityFormPanel`. Carica il
record tramite `entityId` e lo renderizza come fa la pagina del record dell'admin: le stesse
sezioni ed etichette, con ciascun valore rappresentato come anteprima; pertanto, un enum viene mostrato come
chip, una data nel proprio fuso orario e una relazione con il titolo della destinazione. Accetta
`fields` e `collectionOverrides` allo stesso modo del modulo ed esclude i campi che
il modulo omette: quelli nascosti per questo record da una regola `conditions.hidden` e
quelli che l'utente autenticato non è autorizzato a leggere.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    entityId={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` mostra un singolo valore nello stesso modo, all'interno del tuo JSX personalizzato. Accetta
l'intera riga, così come restituita da `useRows`, `useRow` e `client.data`, poiché una
relazione belongsTo arriva sotto la colonna della chiave esterna (`customerId`) e non
sotto il nome della proprietà; `field="customer"` la individua lì. Richiede che la
collezione sia registrata a un livello superiore da `<RebaseCMS>` o da un `CollectionsProvider`.
Una collezione o un campo sconosciuto genera un errore che ne indica il nome.

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

I tre pannelli includono il proprio `CollectionsProvider` quando non ve n'è alcuno al di sopra. Si tratta
del livello sottostante, ed è possibile montarlo manualmente per condividere un unico scope tra
più pannelli o per utilizzare gli elementi di livello inferiore (`CollectionViewBinding`,
`useSidePanel`) al suo interno. Al suo interno, un pannello può fare riferimento alla propria collezione tramite `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` mantiene un registro delle collezioni fornite, con `modifyCollection`
e `injectCollections` dei tuoi plugin applicati come nell'admin, oltre ai pannelli laterali
e alle finestre di dialogo in cui si aprono i record, nonché al meccanismo di protezione per
le modifiche non salvate. Mantieni stabile l'array `collections`: usa una costante di modulo o `useMemo`.

## Passaggi successivi

- [Personalizzazione dell'admin](/docs/frontend/customizing): dove collocare un tuo
  componente e le ricette realizzate a partire da questi pannelli.
- [Hook](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, le righe lette da questi pannelli e da `FieldValue`.
- [Override dei componenti](/docs/frontend/component-overrides): sostituisci la vista
  o il modulo renderizzato da un pannello.

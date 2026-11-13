---
sourceHash: 749d3a5f47923f4d
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable definisce in che modo la collection di una tabella differisce da ciò che il CMS ricava: etichette, icona, viste, kanban, slot di visualizzazione, layout del modulo, azioni e opzioni per campo con componenti React importati per valore. Tutte le opzioni, con il rispettivo tipo ed effetto."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Se usi il CMS, ogni tabella fornita dal backend ha già una collection nel
pannello, ricavata dalla tabella stessa (vedi
[come le tabelle diventano collection](/docs/collections/)). `customizeTable` stabilisce
cosa deve differire, e nient'altro. Si trova nel frontend, accanto al resto
del tuo codice React, quindi un campo personalizzato è un componente che importi come qualsiasi altro.

```tsx
// frontend/src/cms/posts.tsx
import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";
import { CustomMarkdownEditor } from "../../../../../components/CustomMarkdownEditor";

export const postsCms = customizeTable<typeof posts>("posts", {
    name: "Blog Posts",
    singularName: "Blog Post",
    icon: "FileText",
    group: "Content",

    defaultViewMode: "cards",
    enabledViews: ["table", "cards", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },

    display: {
        title: "title",
        image: "heroImage",
        status: "status",
        date: "publishDate",
    },

    fields: {
        status: {
            enumLabels: {
                draft:        { label: "Draft", color: "gray" },
                needs_review: { label: "Needs Review", color: "orange" },
                published:    { label: "Published", color: "green" },
                archived:     { label: "Archived", color: "red" },
            },
        },
        title:   { multiline: true },
        content: { Field: CustomMarkdownEditor },
        orgId:   { hidden: true },
        __order: { hidden: true, disabled: true },
    },

    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Send",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "published",
            onClick: ({ id, context }) =>
                updateRecord(context, "posts", id, { status: "published", publishDate: new Date().toISOString() }, "Published"),
        },
    ],
});
```

Passa il risultato a `<RebaseCMS tableCustomizations={[postsCms]}/>`; vedi
[la panoramica del frontend](/docs/frontend/#rebasecms-props).

:::note[Arrivi dalle collection?]
Queste sono le opzioni di presentazione del vecchio blocco `admin`, al livello
superiore e sotto alcuni nuovi nomi (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). L'utilizzo di un vecchio nome solleva
un errore indicando quello nuovo.
:::

## Dove risiedono i file

<span class="since-badge" data-since="0.31">Da 0.31</span>

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

I nomi sono una convenzione. Ciò che conta è che i risultati raggiungano
`<RebaseCMS tableCustomizations>`. Una tabella senza un file viene mostrata come ricavata automaticamente.

Il frontend importa solo il **tipo** della tabella: `import type { posts }`. Un'importazione
di tipo viene rimossa al momento della compilazione del bundle, quindi gli hook e il codice server in
`backend/schema` non raggiungono mai il browser. Un'importazione di valori da `backend/` nel
codice frontend è l'unica cosa da non scrivere. Il backend non importa mai nulla
dal frontend.

## Lo slug e il tipo

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il primo argomento è lo slug della tabella: il nome con cui è stata definita, o lo
`slug` che le è stato assegnato. Con la tabella come argomento di tipo, lo slug, ogni chiave
che denomina un campo e ogni valore enum vengono verificati rispetto alla tabella:

| Verificato rispetto a `typeof posts` | Un errore è |
|---|---|
| il primo argomento | un errore di tipo a meno che non sia lo slug della tabella |
| chiavi di `fields` | una chiave di colonna o un nome di relazione |
| voci di `fieldOrder`, `listFields`, `form` | un campo, un percorso separato da punti all'interno di uno (`"seo.title"`), `subcollection:<relation>`, o la chiave di un campo aggiuntivo |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | un campo o un percorso all'interno di uno |
| `kanban.columnField` | una colonna che contiene un insieme chiuso di stringhe (`col.enum([...])`, o `.oneOf([...])`) |
| `kanban.orderField` | una colonna di testo |
| `enumLabels`, `enumOrder` | valori che la colonna può contenere; una colonna senza un insieme chiuso non accetta nessuno dei due |
| opzioni del campo | quelle del tipo della colonna: `multiline` su una colonna di testo, `format` su un numero |
| `entityActions[].onClick` e simili | `row` è l'`InferRow` della tabella |

`defineTable("blog_posts", { slug: "posts", … })` si personalizza come
`customizeTable<typeof posts>("posts", …)`: sempre un solo argomento di tipo. Senza l'argomento
di tipo, `customizeTable("posts", { … })` accetta le stesse opzioni,
ma con tipizzazione debole.

## Cosa viene rifiutato e cosa viene ignorato

<span class="since-badge" data-since="0.31">Da 0.31</span>

`customizeTable` verifica ciò che il compilatore non può rilevare al momento del caricamento del modulo, e
solleva un'eccezione indicando cosa scrivere al suo posto:

- un'opzione sconosciuta, suggerendo quella nota più vicina o il nuovo nome di una vecchia
  opzione di `admin`;
- un componente fornito come percorso stringa, un thunk lazy `() => import(…)` o qualsiasi
  cosa non sia un componente React;
- un'azione di entità senza `name` o `onClick`, una vista personalizzata senza
  `Builder`, un `kanban` senza `columnField`, un `referenceTo` che non è uno slug;
- `fields` all'interno degli `overrides` di una relazione: ridefinisci lo stile della tabella di destinazione con il suo
  `customizeTable` dedicato.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

Il risultato è bloccato (frozen). Il passaggio di due personalizzazioni dello stesso slug a
`<RebaseCMS>` solleva un errore: quale delle due prevarrebbe dipenderebbe dall'ordine di importazione.

Ciò che il server fornisce può differire da ciò rispetto a cui hai scritto il codice. Una colonna potrebbe essere
nascosta a questo chiamante (vedi [accesso ai campi](/docs/collections/field-access/)),
oppure la tabella potrebbe essere cambiata nel frattempo. Questo non è un errore a runtime. In
fase di sviluppo il pannello mostra un avviso per ogni mancata corrispondenza e la salta:

- una personalizzazione il cui slug non corrisponde ad alcuna tabella fornita viene ignorata;
- un campo, voce di colonna, slot di visualizzazione, voce di modulo o campo kanban non fornito dalla tabella
  viene scartato;
- un'opzione non applicabile al tipo del campo (`format` su una colonna di testo,
  `enumLabels` su un campo senza un insieme chiuso) viene ignorata.

Il resto della personalizzazione viene comunque applicato.

## Opzioni della tabella

<span class="since-badge" data-since="0.31">Da 0.31</span>

Ogni chiave è opzionale. Una chiave tralasciata mantiene ciò che il pannello ha ricavato automaticamente.

### Identità e navigazione

| Opzione | Tipo | Effetto |
|---|---|---|
| `name` | `string` | L'etichetta plurale: drawer, intestazione della pagina. Ricavata altrimenti dal nome della tabella. |
| `singularName` | `string` | L'etichetta di un singolo record. |
| `description` | `string` | Mostrata sotto l'intestazione e nella card della home. |
| `metadata` | `Record<string, unknown>` | I tuoi dati personalizzati, uniti ai `metadata` della tabella. |
| `icon` | `string \| ReactNode` | Il nome di un'icona Lucide (`"FileText"`) o un elemento. |
| `group` | `string` | Il gruppo di navigazione. |
| `hideFromNavigation` | `boolean` | Non visibile nel drawer. Comunque raggiungibile tramite URL e come destinazione di un riferimento. |
| `hideFromEntityViews` | `boolean` | Non proposta come scheda sui record delle tabelle ad essa collegate. |

### Viste

| Opzione | Tipo | Effetto |
|---|---|---|
| `defaultViewMode` | `ViewMode` | La vista su cui atterra un visitatore: `"list"`, `"table"`, `"cards"`, `"kanban"` o la chiave di una vista personalizzata. In alternativa `"list"`. |
| `enabledViews` | `ViewMode[]` | Le viste disponibili nel selettore. |
| `kanban` | `{ columnField, orderField? }` | La bacheca: la colonna in base alla quale raggruppare e la colonna di testo in cui memorizzare le chiavi di ordinamento. Vedi [Modalità di visualizzazione](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | Altri modi per visualizzare le righe: `{ key, name, Builder }`, o la chiave di una vista registrata su `<RebaseCMS collectionViews>`. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | L'altezza predefinita della riga. |

`kanban` accetta due chiavi:

| Chiave | Tipo | Effetto |
|---|---|---|
| `columnField` | chiave di colonna | La colonna da cui provengono le colonne della bacheca: un `col.enum([...])` o `.oneOf([...])` di stringhe. |
| `orderField` | chiave di colonna di testo | Dove viene memorizzata la posizione di una card all'interno della sua colonna, come chiave di ordinamento frazionaria. Senza di essa, l'ordine si resetta a ogni lettura. |

### Colonne e slot

| Opzione | Tipo | Effetto |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | L'ordine in cui vengono disegnati i campi. I campi tralasciati seguono a ruota, quindi nulla scompare. |
| `listFields` | `TableColumnId[]` | Le colonne della vista a elenco. |
| `previewFields` | `TableFieldKey[]` | I campi mostrati quando un record di questa tabella viene referenziato da un'altra. |
| `display` | `TableDisplay` | Cosa valorizza i parametri `title`, `subtitle`, `image`, `status`, `date` e `tags` di un record: il percorso di un campo o un resolver. Vedi [slot di visualizzazione](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Colonne calcolate. Vedi [Colonne aggiuntive](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Nasconde la colonna id. |

Una colonna calcolata accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `key` | `string` | Identifica la colonna. Nominala in `fieldOrder` come `"total" as AdditionalFieldKey`. |
| `name` | `string` | L'intestazione. |
| `width` | `number` | La larghezza, in pixel. |
| `Builder` | `(props) => ReactNode` | Esegue il rendering della cella a partire da `{ row, id, context }`. |
| `dependencies` | percorso o percorsi di campo | I campi la cui modifica attiva il nuovo rendering della cella. |
| `value` | `(props) => string \| number` | Il valore della cella, per l'esportazione. Può essere asincrono. |

### Valori predefiniti delle query

| Opzione | Tipo | Effetto |
|---|---|---|
| `sort` | `OrderBySpec` | L'ordinamento predefinito: `["publishDate", "desc"]`, o diverse chiavi in sequenza. |
| `fixedFilter` | `FilterValues` | Un filtro che il visitatore non può modificare. |
| `defaultFilter` | `FilterValues` | Il filtro da cui parte un visitatore. |
| `filterPresets` | `FilterPreset[]` | Filtri attivabili con un clic nella barra degli strumenti: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Carica a pagine (`true`, o la dimensione della pagina), o tutto in una volta (`false`). |

Vedi [Filtri e ordinamento](/docs/frontend/view-modes/#filters-presets-and-sort).

### Comportamento

| Opzione | Tipo | Effetto |
|---|---|---|
| `inlineEditing` | `boolean` | Modifica le celle direttamente all'interno della tabella. |
| `selectionEnabled` | `boolean` | Le righe possono essere selezionate. |
| `selectionController` | `SelectionController` | Una selezione gestita all'esterno della vista (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Se la barra degli strumenti offre l'esportazione, ed eventuali colonne extra per essa. Vedi [Importazione ed esportazione](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | La modalità di apertura di un record. |
| `defaultEntityAction` | `"view" \| "edit"` | Se il clic su un record lo apre in modalità visualizzazione o modifica. |
| `sideDialogWidth` | `number \| string` | La larghezza del pannello laterale in cui si apre un record. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | La scheda su cui si apre un record. |

### Modulo (Form)

| Opzione | Tipo | Effetto |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Sezioni e la barra laterale (rail) accanto al modulo. Vedi [Layout del modulo](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Un componente che sostituisce il modulo generato. `includeActions` mantiene Salva e Annulla nella barra del record. |
| `formAutoSave` | `boolean` | Salva mentre il visitatore digita. |
| `alwaysApplyDefaultValues` | `boolean` | Inserisce i valori predefiniti dichiarati nei campi vuoti di un record memorizzato quando viene aperto. |
| `includeJsonView` | `boolean` | Aggiunge una scheda con il record in formato JSON. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Mantiene le modifiche non salvate nella memoria locale (local storage). |
| `hideIdFromForm` | `boolean` | Nasconde l'id dal modulo. |

`form` accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `sidebar` | id dei campi | I campi posizionati nella barra laterale accanto al modulo. |
| `sections` | sezioni | Le sezioni della colonna principale, descritte sotto. |
| `showRecordMeta` | `boolean` | Mostra l'id del record e i timestamp nella barra laterale. |

Ogni sezione accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `key` | `string` | Identifica la sezione; è anche l'`id` della sua ancora. |
| `title` | `string` | L'intestazione. Nessuna se omessa. |
| `fields` | id dei campi | I campi della sezione, in ordine. |
| `collapsed` | `boolean` | Inizia compressa. |
| `collapsible` | `boolean` | Può essere compressa. |
| `readVariant` | `"grid" \| "summary"` | Come appare la sezione quando il record viene visualizzato anziché modificato. |

### Azioni, viste e override

| Opzione | Tipo | Effetto |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Azioni su un record. Un oggetto o la chiave di un'azione registrata su `<RebaseCMS entityActions>`. Vedi [Azioni di entità](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Azioni predefinite che questa tabella non offre. |
| `resetPasswordAction` | `false \| TableEntityAction` | <span class="since-badge" data-since="0.31">Da 0.31</span> Solo per la tabella di autenticazione (`defineAuthTable`): `false` rimuove l'azione predefinita di reimpostazione della password, un'azione la sostituisce (offerta a prescindere da ciò che supporta l'adapter di autenticazione: il backend è il tuo). Ignorata, con un avviso, su qualsiasi altra tabella. |
| `entityViews` | `(string \| TableEntityView)[]` | Schede aggiuntive su un record. Vedi [Viste di entità](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Componenti visualizzati nella barra degli strumenti della collection. |
| `components` | `TableComponentOverrides` | Override dei componenti nell'ambito della collection, ciascuno nella forma `{ Component, wrap? }`. Vedi [Override dei componenti](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callback che vengono eseguiti nel pannello dopo gli hook del server. Solo per la presentazione: vengono inviati a ogni visitatore e non garantiscono alcuna sicurezza. Vedi [Hook di React](/docs/hooks/). |
| `fields` | `TableFields` | Opzioni per campo, con chiave per colonna o relazione. Sotto. |

## Opzioni del campo

<span class="since-badge" data-since="0.31">Da 0.31</span>

`fields.<key>` accetta le opzioni applicabili a ogni campo, oltre a quelle specifiche del tipo
di colonna. La pagina [Campi](/docs/collections/properties/) mostra ciascuna opzione insieme al widget che
va a modificare.

### Tutti i campi

| Opzione | Tipo | Effetto |
|---|---|---|
| `name` | `string` | L'etichetta. Ricavata altrimenti dalla chiave (`publishDate` → "Publish Date"). |
| `description` | `string` | Testo di aiuto sotto il campo. |
| `hidden` | `boolean` | Escluso dalle viste tabella e card. Ancora presente nel modulo, e ancora letto e scritto dall'API. |
| `hiddenInForm` | `boolean` | Escluso dal modulo. Ancora presente nelle viste. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | Il controllo è disabilitato (in grigio). `disabledMessage` ne spiega il motivo a lato; `clearOnDisabled` cancella il valore quando viene disabilitato. |
| `readOnly` | `boolean` | Il valore viene visualizzato come testo, senza alcun controllo. |
| `Field` | `Component` | Sostituisce il controllo del modulo. Il componente stesso. Vedi [Campi personalizzati](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Sostituisce il modo in cui il valore viene visualizzato all'esterno del modulo. |
| `Filter` | `Component` | Sostituisce il controllo del filtro per questo campo. |
| `columnWidth` | `number` | La larghezza della colonna nella tabella, in pixel. |
| `filledByServer` | `boolean` | Un hook del server lo compila alla creazione: il modulo consente la creazione del record senza di esso. |
| `span` | `1 \| 2 \| 3 \| 4` | Quante delle quattro colonne della griglia del modulo occupa. |
| `customProps` | `unknown` | Passato inalterato ai tuoi `Field` e `Preview`. |
| `filterOperators` | `WhereFilterOp[]` | Limita gli operatori di filtro disponibili. `[]` disattiva il filtraggio per il campo. |
| `propertyConfig` | `string` | La chiave di un tipo di campo registrato su `<Rebase propertyConfigs>`. |
| `conditions` | `PropertyConditions` | Regole in formato JSON-logic che nascondono, disabilitano o rendono obbligatorio il campo in base ai valori del record. Solo per il modulo. Vedi [condizioni](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Restituisce le opzioni del campo applicabili al momento, in base al record in corso di modifica. Solo per il modulo. |
| `metadata` | `Record<string, unknown>` | I tuoi dati personalizzati. |

### Colonne di testo e uuid

| Opzione | Tipo | Effetto |
|---|---|---|
| `multiline` | `boolean` | Un input su più righe, che cresce con il contenuto. |
| `markdown` | `boolean` | Un editor markdown con anteprima. |
| `previewAsTag` | `boolean` | Visualizzato come chip anziché come testo. |
| `clearable` | `boolean` | Aggiunge un controllo per impostare il valore su `null`. |
| `urlPreview` | `PreviewType \| boolean` | Come viene mostrata l'anteprima di un URL nel valore: `"image"`, `"video"`, `"audio"`, `"file"`, oppure `true` per un link. |
| `referenceTo` | `string` | La colonna contiene la chiave di un record in un'altra collection, su qualsiasi origine dati: viene visualizzata e selezionata come riferimento allo slug di quella collection. Vedi [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Colonne con un insieme chiuso di valori

Un `col.enum([...])`, un `.oneOf([...])`, o un array di uno dei due:

| Opzione | Tipo | Effetto |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Etichette per alcuni dei valori. I valori tralasciati mantengono l'etichetta e il colore ricavati. |
| `enumOrder` | `value[]` | L'ordine in cui i valori vengono offerti e le colonne kanban vengono disegnate. Altrimenti l'ordine proprio della colonna. |
| `previewAsTag` | `boolean` | Su un `col.enum()`: visualizzato come chip. |
| `clearable` | `boolean` | Su un `col.enum()`: aggiunge un controllo per impostare il valore su `null`. |

Un `EnumLabel` accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `label` | `string` | Il testo sul chip e nel selettore. |
| `color` | `ColorKey \| ColorScheme` | Una chiave di colore per il chip (`"green"`, `"orangeDark"`) o uno schema `{ color, text }`. Un valore che ne è privo mantiene il colore assegnato di default. |
| `disabled` | `boolean` | Mostrato, ma non selezionabile. |

### Colonne numeriche

| Opzione | Tipo | Effetto |
|---|---|---|
| `clearable` | `boolean` | Aggiunge un controllo per impostare il valore su `null`. |
| `format` | `NumberFormatOptions` | Scrive il numero come valuta, percentuale o con decimali fissi. |

`format` accetta `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (un
codice ISO, obbligatorio con `"currency"`), `locale` (altrimenti quello dell'utente),
`minimumFractionDigits`, `maximumFractionDigits` e `notation`
(`"standard"` o `"compact"`, che scrive `12000` come `12K`). Modifica ciò che viene
visualizzato, mai ciò che viene salvato.

### Colonne data, timestamp e ora

| Opzione | Tipo | Effetto |
|---|---|---|
| `clearable` | `boolean` | Aggiunge un controllo per impostare il valore su `null`. |
| `mode` | `"date" \| "date_time"` | Seleziona e mostra solo un giorno, oppure un giorno e un'ora. Ricavato altrimenti dal tipo di colonna. |
| `timezone` | `string` | Il fuso orario IANA in cui il valore viene mostrato e selezionato (`"Europe/Madrid"`). Altrimenti quello dell'utente. |

### Colonne vettoriali

| Opzione | Tipo | Effetto |
|---|---|---|
| `clearable` | `boolean` | Aggiunge un controllo per impostare il valore su `null`. |

### Colonne di archiviazione (Storage)

| Opzione | Tipo | Effetto |
|---|---|---|
| `storage` | `StorageCustomization` | Le funzioni di caricamento che vengono eseguite nel browser. |
| `clearable` | `boolean` | Aggiunge un controllo per impostare il valore su `null`. |
| `urlPreview` | `PreviewType \| boolean` | Come viene mostrata l'anteprima dell'URL archiviato. |

`storage` accetta solo funzioni; le opzioni serializzabili rimangono su
`col.storage({ … })` (vedi [Caricamento di file](/docs/collections/file-uploads/)):

| Chiave | Firma | Effetto |
|---|---|---|
| `path` | `(context) => string` | La cartella in cui viene caricato un file, che sostituisce il modello `path` della colonna. |
| `fileName` | `(context) => string \| Promise<string>` | Il nome del file memorizzato, che sostituisce il modello `fileName` della colonna. |
| `processFile` | `(file) => Promise<File>` | Trasforma un file prima che venga caricato. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Trasforma il percorso o l'URL memorizzato prima che venga scritto nella colonna. |
| `previewUrl` | `(fileName) => string` | L'URL in corrispondenza del quale visualizzare l'anteprima di un file archiviato. |

### Colonne array

| Opzione | Tipo | Effetto |
|---|---|---|
| `expanded` | `boolean` | Ogni elemento è aperto al caricamento. |
| `minimalistView` | `boolean` | Elementi senza riquadro e intestazione. |
| `sortable` | `boolean` | Gli elementi possono essere riordinati tramite trascinamento. |
| `canAddElements` | `boolean` | È possibile aggiungere elementi. |
| `of` | opzioni del campo | Le opzioni di ciascun elemento. |
| `storage` | `StorageCustomization` | Le funzioni di caricamento, per `col.storage().multiple()`. |

I parametri `enumLabels` ed `enumOrder` impostati su un array si applicano ai suoi elementi.

### Colonne JSON

| Opzione | Tipo | Effetto |
|---|---|---|
| `expanded` | `boolean` | I campi del documento sono aperti al caricamento. |
| `minimalistView` | `boolean` | I campi del documento sono privi del loro riquadro. |
| `spreadChildren` | `boolean` | I campi del documento vengono disposti come se appartenessero al record stesso. |
| `keyValue` | `boolean` | Modificati come coppie chiave/valore libere. |
| `previewFields` | `string[]` | Le chiavi del documento mostrate nella sua anteprima. |
| `fields` | `{ [key]: opzioni del campo }` | Le opzioni di ciascuna chiave del documento. |
| `fieldOrder` | `string[]` | L'ordine in cui vengono mostrate le chiavi del documento. |
| `of` | opzioni del campo | Le opzioni di ciascun elemento, per un documento che è un elenco. |
| `oneOf` | `{ [variant]: opzioni del campo }` | Le opzioni di ciascuna variante di un blocco tipizzato (`json.oneOf`). |

Con `col.jsonb().$type<T>()` o una struttura `json.object({…})`, `fields` e `fieldOrder`
vengono tipizzati in base alle chiavi del documento. Vedi [Array e JSON](/docs/collections/arrays-and-maps/).

### Relazioni

| Opzione | Tipo | Effetto |
|---|---|---|
| `previewFields` | `string[]` | I campi della destinazione mostrati nel chip per una riga correlata. Se ne possono visualizzare al massimo tre. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | La riga o le righe correlate con cui si apre il modulo di un nuovo record: `new EntityRelation(id, "<target slug>")` (`EntityRelation` da `@rebasepro/cms-types`), o un elenco per una relazione "a molti". Scritto solo al momento del salvataggio del modulo. Il valore predefinito intrinseco di una colonna è `.default()` sulla colonna stessa. |
| `widget` | `"select" \| "dialog"` | Il modo in cui viene selezionata una riga correlata. |
| `fixedFilter` | `FilterValues` | Mostra solo le righe che soddisfano questo filtro. |
| `includeId` | `boolean` | Mostra l'id della riga correlata nelle anteprime. |
| `includeEntityLink` | `boolean` | Mostra un link che apre la riga correlata. |
| `renderInForm` | `boolean` | Visualizza inoltre una relazione "a molti" come selettore nel modulo, accanto alla relativa scheda. |
| `overrides` | opzioni della tabella senza `fields` | Come viene presentata la destinazione nella scheda di questa relazione. |

Vedi [Relazioni nel pannello](/docs/collections/relations-in-the-admin-panel/).

## Personalizzazioni, `ui-config.json` e preferenze

<span class="since-badge" data-since="0.31">Da 0.31</span>

Ciò che il pannello mostra per una tabella è composto secondo un ordine fisso, dove ogni livello si sovrappone
a quello precedente:

1. **La collection ricavata**: ciò che il pannello legge dalla tabella fornita dal server.
2. **Codice**: i risultati di `customizeTable` passati come `tableCustomizations`.
3. **`frontend/src/cms/ui-config.json`**: la presentazione del workspace salvata dall'editor
   delle collection durante lo sviluppo, passata come `uiConfig`. È un
   file nel frontend, quindi viene revisionato e distribuito insieme ad esso.
4. **Preferenze del workspace**: ciò che un amministratore salva su un deployment, nella
   tabella `rebase.ui_preferences` tramite
   [`/api/admin/ui-config`](/docs/backend/endpoints/). La loro scrittura richiede
   `schema:write`.
5. **Preferenze dell'utente**: larghezze delle colonne, selezioni di viste e
   colonne nascoste personalizzate dal singolo utente. Mantenute nel browser quando non si è autenticati.

Un file `App.tsx` creato da scaffolding include già il collegamento a questo file:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

Le preferenze contengono solo informazioni di presentazione: etichette, icona, modalità di visualizzazione, ordine delle colonne,
colonne nascoste, etichette e colori degli enum, kanban e valori predefiniti delle query. Gli elementi
dello schema non vengono mai salvati lì; l'[editor di collection](/docs/studio/) scrive questi ultimi
in `backend/schema`.

`rebase build` include `frontend/src/cms/ui-config.json` nel bundle
(`entry.uiConfig`), in modo che anche un backend distribuito lo riconosca: `GET /api/admin/ui-config`
lo fornisce come `shipped` accanto ai livelli del workspace e dell'utente, e le viste MCP
e `describe_table` fondono gli stessi tre livelli — il file, il workspace e
quello dell'utente stesso (nessuno nel caso di una chiave API) — consentendo a un agente di visualizzare le stesse etichette, ordine,
colonne nascoste ed etichette degli enum che un utente vede nel pannello.

`rebase verify` analizza ogni chiamata a `customizeTable` in `frontend/src/cms` rispetto
alle tabelle, senza eseguirla: individua eventuali personalizzazioni per tabelle o
campi inesistenti, colonne obbligatorie nascoste dal modulo, tabelle
personalizzate due volte, file `ui-config.json` non passati ad alcun `<RebaseCMS>` e configurazioni Vite
prive di `rebaseBackendGuard()`. Vedi [`rebase verify`](/docs/cli/#rebase-verify).

## Passaggi successivi

<span class="since-badge" data-since="0.31">Da 0.31</span>

- [Come le tabelle diventano collection](/docs/collections/): cosa ricava il pannello prima di tutto questo
- [Campi](/docs/collections/properties/): widget e opzioni per ciascun tipo di colonna
- [Modalità di visualizzazione](/docs/frontend/view-modes/): tabella, card, kanban, slot di visualizzazione, filtri
- [Azioni di entità](/docs/frontend/entity-actions/): `entityActions` e `updateRecord`
- [Firestore insieme a Postgres](/docs/frontend/firebase/): `externalCollections` e riferimenti tra diversi motori di database

---
sourceHash: afe3986ede62abca
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable definisce come la collection di una tabella si differenzia da ciò che il CMS ricava: etichette, icona, viste, kanban, display slot, layout del form, azioni e opzioni per campo con componenti React importati per valore. Tutte le opzioni, con relativo tipo ed effetto."
---

Se utilizzi il CMS, ogni tabella fornita dal backend ha già una collection nel
pannello, derivata dalla tabella stessa (vedi
[come le tabelle diventano collection](/docs/collections/)). `customizeTable`
stabilisce ciò che deve differire, e nient'altro. Risiede nel frontend, insieme
al resto del tuo codice React, quindi un campo personalizzato è un componente
che importi come qualsiasi altro.

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

:::note[Provieni dalle collection?]
Queste sono le opzioni di presentazione del vecchio blocco `admin`, al livello
radice e con alcuni nuovi nomi (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). L'uso di un vecchio nome
genera un errore indicando quello nuovo.
:::

## Dove risiedono i file

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

I nomi sono una convenzione. Ciò che conta è che i risultati raggiungano
`<RebaseCMS tableCustomizations>`. Una tabella senza un file associato viene
mostrata così come derivata.

Il frontend importa solo il **tipo** della tabella: `import type { posts }`.
Un'importazione di tipo viene rimossa durante la compilazione del bundle, quindi
hook e codice server in `backend/schema` non raggiungono mai il browser.
Un'importazione per valore da `backend/` nel codice frontend è l'unica cosa da
non fare. Il backend non importa mai nulla dal frontend.

## Lo slug e il tipo

Il primo argomento è lo slug della tabella: il nome con cui è stata definita, o
lo `slug` che le è stato assegnato. Con la tabella come argomento di tipo, lo
slug, ogni chiave che denomina un campo e ogni valore enum vengono verificati
rispetto alla tabella:

| Verificato rispetto a `typeof posts` | Un errore è |
|---|---|
| il primo argomento | un errore di tipo a meno che non corrisponda allo slug della tabella |
| chiavi di `fields` | una chiave di colonna o il nome di una relazione |
| voci di `fieldOrder`, `listFields`, `form` | un campo, un percorso con notazione a punti al suo interno (`"seo.title"`), `subcollection:<relation>` o la chiave di un campo aggiuntivo |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | un campo o un percorso al suo interno |
| `kanban.columnField` | una colonna contenente un set chiuso di stringhe (`col.enum([...])` o `.oneOf([...])`) |
| `kanban.orderField` | una colonna di testo |
| `enumLabels`, `enumOrder` | valori che la colonna può contenere; una colonna senza un set chiuso non accetta nessuno dei due |
| opzioni del campo | quelle del tipo della colonna: `multiline` su una colonna di testo, `format` su un numero |
| `entityActions[].onClick` e correlati | `row` è l'`InferRow` della tabella |

`defineTable("blog_posts", { slug: "posts", … })` si personalizza come
`customizeTable<typeof posts>("posts", …)`: sempre un solo argomento di tipo.
Senza l'argomento di tipo, `customizeTable("posts", { … })` accetta le stesse
opzioni, ma con tipizzazione debole.

## Cosa viene rifiutato e cosa viene ignorato

`customizeTable` controlla ciò che il compilatore non può vedere al momento del
caricamento del modulo, e genera un errore indicando cosa scrivere al suo posto:

- un'opzione sconosciuta, suggerendo quella nota più simile o il nuovo nome di
  una vecchia opzione `admin`;
- un componente fornito come percorso in formato stringa, un thunk lazy
  `() => import(…)` o qualsiasi elemento che non sia un componente React;
- un'azione di entità senza `name` o `onClick`, una vista personalizzata senza
  `Builder`, un `kanban` senza `columnField`, un `referenceTo` che non sia uno slug;
- `fields` all'interno degli `overrides` di una relazione: personalizza lo stile
  della tabella di destinazione con il suo specifico `customizeTable`.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

Il risultato è immutabile (frozen). Il passaggio di due personalizzazioni per lo
stesso slug a `<RebaseCMS>` genera un errore: quale prevarrebbe dipenderebbe
dall'ordine di importazione.

Ciò che il server fornisce può differire rispetto a ciò su cui è stato scritto il
codice. Una colonna potrebbe essere nascosta al chiamante (vedi
[accesso ai campi](/docs/collections/field-access/)), oppure la tabella potrebbe
essere cambiata nel frattempo. Questo non è un errore a runtime. In modalità di
sviluppo il pannello mostra un avviso per ogni discrepanza e la ignora:

- una personalizzazione il cui slug non corrisponde ad alcuna tabella fornita
  viene ignorata;
- un campo, una voce di colonna, un display slot, una voce di form o un campo
  kanban non fornito dalla tabella viene scartato;
- un'opzione non applicabile al tipo del campo (`format` su una colonna di testo,
  `enumLabels` su un campo senza set chiuso) viene ignorata.

Il resto della personalizzazione viene comunque applicato.

## Opzioni della tabella

Ogni chiave è opzionale. Una chiave omessa mantiene ciò che il pannello ha
derivato.

### Identità e navigazione

| Opzione | Tipo | Effetto |
|---|---|---|
| `name` | `string` | L'etichetta al plurale: drawer, intestazione della pagina. Altrimenti derivata dal nome della tabella. |
| `singularName` | `string` | L'etichetta di un singolo record. |
| `description` | `string` | Mostrata sotto l'intestazione e nella scheda home. |
| `metadata` | `Record<string, unknown>` | Dati personalizzati, uniti ai `metadata` della tabella. |
| `icon` | `string \| ReactNode` | Il nome di un'icona Lucide (`"FileText"`) o un elemento. |
| `group` | `string` | Il gruppo di navigazione. |
| `hideFromNavigation` | `boolean` | Non presente nel drawer. Sempre raggiungibile tramite URL e come target di riferimento. |
| `hideFromEntityViews` | `boolean` | Non offerta come scheda sui record delle tabelle ad essa collegate. |

### Viste

| Opzione | Tipo | Effetto |
|---|---|---|
| `defaultViewMode` | `ViewMode` | La vista su cui atterra l'utente: `"list"`, `"table"`, `"cards"`, `"kanban"` o la chiave di una vista personalizzata. In caso contrario, `"list"`. |
| `enabledViews` | `ViewMode[]` | Le viste offerte nel selettore. |
| `kanban` | `{ columnField, orderField? }` | La bacheca: la colonna in base alla quale raggruppa e la colonna di testo in cui memorizza le chiavi di ordinamento. Vedi [Modalità di visualizzazione](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | Ulteriori modalità per visualizzare le righe: `{ key, name, Builder }` o la chiave di una vista registrata su `<RebaseCMS collectionViews>`. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | L'altezza predefinita delle righe. |

`kanban` accetta due chiavi:

| Chiave | Tipo | Effetto |
|---|---|---|
| `columnField` | chiave di colonna | La colonna da cui derivano le colonne della bacheca: un `col.enum([...])` o `.oneOf([...])` di stringhe. |
| `orderField` | chiave di colonna di testo | Dove viene memorizzata la posizione di una scheda all'interno della sua colonna, come chiave di ordinamento frazionario. Senza di essa, l'ordine viene reimpostato a ogni lettura. La colonna è nascosta e disabilitata a meno che la sua voce in `fields` non indichi diversamente. |

### Colonne e slot

| Opzione | Tipo | Effetto |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | L'ordine in cui vengono disegnati i campi. I campi omessi seguono a ruota, quindi nulla scompare. |
| `listFields` | `TableColumnId[]` | Le colonne della tabella e della vista elenco: i campi visualizzati da esse, e nessun altro. La tabella li ordina secondo `fieldOrder` (o l'ordine definito dall'utente tramite trascinamento) se presente, altrimenti secondo `listFields`. I campi omessi rimangono comunque presenti sul record. |
| `previewFields` | `TableFieldKey[]` | I campi mostrati quando un record di questa tabella viene referenziato da un'altra. |
| `display` | `TableDisplay` | Ciò che popola `title`, `subtitle`, `image`, `status`, `date` e `tags` di un record: un percorso di campo o un resolver. Vedi [display slot](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Colonne calcolate della tabella. Non presenti sul record a meno che `form.sections` o `form.sidebar` non ne specifichi una. Vedi [Colonne aggiuntive](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Nasconde la colonna id. |

Una colonna calcolata accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `key` | `string` | Identifica la colonna. Indicala in `fieldOrder` come `"total" as AdditionalFieldKey`. |
| `name` | `string` | L'intestazione. |
| `width` | `number` | La larghezza, in pixel. |
| `Builder` | `(props) => ReactNode` | Esegue il rendering della cella a partire da `{ row, id, context }`. |
| `dependencies` | percorso o percorsi di campo | I campi la cui modifica attiva un nuovo rendering della cella. |
| `value` | `(props) => string \| number` | Il valore della cella, ai fini dell'esportazione. Può essere asincrono. |

### Impostazioni predefinite delle query

| Opzione | Tipo | Effetto |
|---|---|---|
| `sort` | `OrderBySpec` | L'ordinamento predefinito: `["publishDate", "desc"]`, o più chiavi in sequenza. |
| `fixedFilter` | `FilterValues` | Un filtro che l'utente non può modificare. |
| `defaultFilter` | `FilterValues` | Il filtro di partenza per l'utente. |
| `filterPresets` | `FilterPreset[]` | Filtri rapidi con un clic nella barra degli strumenti: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Carica a pagine (`true`, o la dimensione della pagina), oppure tutto in una volta (`false`). |

Vedi [Filtri e ordinamento](/docs/frontend/view-modes/#filters-presets-and-sort).

### Comportamento

| Opzione | Tipo | Effetto |
|---|---|---|
| `inlineEditing` | `boolean` | Modifica delle celle direttamente sul posto nella tabella. |
| `selectionEnabled` | `boolean` | Le righe possono essere selezionate. |
| `selectionController` | `SelectionController` | Una selezione gestita all'esterno della vista (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Determina se la barra degli strumenti offre l'esportazione e le relative colonne aggiuntive. Vedi [Importazione ed esportazione](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Come si apre un record. |
| `defaultEntityAction` | `"view" \| "edit"` | Determina se facendo clic su un record questo si apre in lettura o in modifica. |
| `sideDialogWidth` | `number \| string` | La larghezza del pannello laterale in cui si apre un record. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | La scheda su cui si apre un record. |

### Form

| Opzione | Tipo | Effetto |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Sezioni e la barra laterale (rail) accanto al form. Vedi [Layout del form](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Un componente che sostituisce il form generato. `includeActions` mantiene Salva e Annulla nella barra del record. |
| `formAutoSave` | `boolean` | Salvataggio automatico durante la digitazione dell'utente. |
| `alwaysApplyDefaultValues` | `boolean` | Popola i campi vuoti di un record salvato con i valori predefiniti dichiarati al momento dell'apertura. |
| `includeJsonView` | `boolean` | Aggiunge una scheda con il record in formato JSON. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Mantiene le modifiche non salvate nel local storage. |
| `hideIdFromForm` | `boolean` | Nasconde l'id dal form. |

`form` accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `sidebar` | id dei campi | I campi estratti nella barra laterale accanto al form. |
| `sections` | sezioni | Le sezioni della colonna principale, descritte di seguito. |
| `showRecordMeta` | `boolean` | Mostra l'id e i timestamp del record nella barra laterale. |

Ogni sezione accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `key` | `string` | Identifica la sezione; è anche l'`id` della sua ancora. |
| `title` | `string` | L'intestazione. Nessuna se omessa. |
| `fields` | id dei campi | I campi della sezione, in ordine. |
| `collapsed` | `boolean` | Inizia compressa (chiusa). |
| `collapsible` | `boolean` | Può essere compressa. |
| `readVariant` | `"grid" \| "summary"` | Come viene visualizzata la sezione quando il record viene mostrato anziché modificato. |

### Azioni, viste e override

| Opzione | Tipo | Effetto |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Azioni su un record. Un oggetto o la chiave di un'azione registrata su `<RebaseCMS entityActions>`. Vedi [Azioni di entità](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Azioni integrate non offerte da questa tabella. |
| `resetPasswordAction` | `false \| TableEntityAction` | Solo per la tabella di autenticazione (`defineAuthTable`): `false` rimuove l'azione integrata di reimpostazione della password, un'azione la sostituisce (offerta indipendentemente da ciò che supporta l'adattatore di autenticazione: il backend è tuo). Ignorato, con un avviso, su qualsiasi altra tabella. |
| `entityViews` | `(string \| TableEntityView)[]` | Schede aggiuntive su un record. Vedi [Viste di entità](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Componenti renderizzati nella barra degli strumenti della collection. |
| `components` | `TableComponentOverrides` | Override dei componenti con ambito di collection, ciascuno `{ Component, wrap? }`. Vedi [Override dei componenti](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callback eseguiti nel pannello dopo gli hook del server. Solo a scopo di presentazione: vengono inviati a ogni visitatore e non garantiscono alcuna sicurezza. Vedi [Hook React](/docs/hooks/). |
| `fields` | `TableFields` | Opzioni per singolo campo, indicizzate per colonna o relazione. Descritte di seguito. |

## Opzioni dei campi

`fields.<key>` accetta le opzioni disponibili per ogni campo, oltre a quelle
specifiche del tipo di colonna. [Campi](/docs/collections/properties/) mostra
ciascuna opzione insieme al widget che modifica.

### Ogni campo

| Opzione | Tipo | Effetto |
|---|---|---|
| `name` | `string` | L'etichetta. Altrimenti derivata dalla chiave (`publishDate` → "Publish Date"). |
| `description` | `string` | Testo di aiuto sotto il campo. |
| `hidden` | `boolean` | Escluso dalle viste tabella, elenco e schede, e dal record: sia dal form che dalla vista in lettura. Viene comunque letto e scritto tramite API. |
| `hiddenInForm` | `boolean` | Escluso dal record (dal form e dalla vista in lettura). Sempre presente nelle viste. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | Il controllo è disabilitato (in grigio). `disabledMessage` ne indica il motivo accanto; `clearOnDisabled` cancella il valore quando il campo diventa disabilitato. |
| `readOnly` | `boolean` | Il valore viene visualizzato come testo, senza alcun controllo interattivo. |
| `Field` | `Component` | Sostituisce il controllo del form. Il componente stesso. Vedi [Campi personalizzati](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Sostituisce il modo in cui il valore viene visualizzato all'esterno del form. |
| `Filter` | `Component` | Sostituisce il controllo del filtro per questo campo. |
| `columnWidth` | `number` | La larghezza della colonna nella tabella, in pixel. |
| `filledByServer` | `boolean` | Un hook del server lo compila al momento della creazione: il form consente la creazione di un record senza di esso. Una colonna contrassegnata con `.serverDefault()` nel relativo `defineTable` lo è già; imposta questa opzione solo per sovrascrivere la tabella (`false` lo rende nuovamente obbligatorio). |
| `span` | `1 \| 2 \| 3 \| 4` | Il numero di colonne (su quattro) occupate nella griglia del form. |
| `customProps` | `unknown` | Passato invariato a `Field` e `Preview` personalizzati. |
| `filterOperators` | `WhereFilterOp[]` | Limita gli operatori di filtro disponibili. `[]` disattiva il filtraggio per il campo. |
| `propertyConfig` | `string` | La chiave di un tipo di campo registrato su `<Rebase propertyConfigs>`. |
| `conditions` | `PropertyConditions` | Regole JSON-logic che nascondono, disabilitano o rendono obbligatorio il campo in base ai valori del record. Solo per il form. Vedi [condizioni](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Restituisce le opzioni di campo applicabili al momento, in base al record in fase di modifica. Solo per il form. |
| `metadata` | `Record<string, unknown>` | Dati personalizzati. |

### Colonne di testo e uuid

| Opzione | Tipo | Effetto |
|---|---|---|
| `multiline` | `boolean` | Un input multilinea che cresce con il contenuto. |
| `markdown` | `boolean` | Un editor markdown con anteprima. |
| `previewAsTag` | `boolean` | Visualizzato come chip anziché come testo. |
| `clearable` | `boolean` | Aggiunge un controllo che imposta il valore su `null`. |
| `urlPreview` | `PreviewType \| boolean` | Come viene visualizzata l'anteprima di un URL nel valore: `"image"`, `"video"`, `"audio"`, `"file"` o `true` per un link. |
| `referenceTo` | `string` | La colonna contiene la chiave di un record in un'altra collection, su qualsiasi origine dati: viene visualizzata e selezionata come riferimento allo slug di quella collection. Vedi [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Colonne con un set chiuso di valori

Un `col.enum([...])`, un `.oneOf([...])` o un array di uno dei due:

| Opzione | Tipo | Effetto |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Etichette per alcuni dei valori. I valori omessi mantengono l'etichetta e il colore derivati. |
| `enumOrder` | `value[]` | L'ordine con cui i valori vengono presentati e le colonne kanban visualizzate. Altrimenti, l'ordine proprio della colonna. |
| `previewAsTag` | `boolean` | Su un `col.enum()`: visualizzato come chip. |
| `clearable` | `boolean` | Su un `col.enum()`: aggiunge un controllo che imposta il valore su `null`. |

Un `EnumLabel` accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `label` | `string` | Il testo sul chip e nel selettore. |
| `color` | `ColorKey \| ColorScheme` | Una chiave di colore per il chip (`"green"`, `"orangeDark"`) o uno schema `{ color, text }`. Un valore privo di indicazione mantiene il colore iniziale assegnato. |
| `disabled` | `boolean` | Mostrato, ma non selezionabile. |

### Colonne numeriche

| Opzione | Tipo | Effetto |
|---|---|---|
| `clearable` | `boolean` | Aggiunge un controllo che imposta il valore su `null`. |
| `format` | `NumberFormatOptions` | Formatta il numero come valuta, percentuale o con decimali fissi. |

`format` accetta `style` (`"decimal"`, `"currency"`, `"percent"`), `currency`
(un codice ISO, obbligatorio con `"currency"`), `locale` (in caso contrario,
quello del visualizzatore), `minimumFractionDigits`, `maximumFractionDigits` e
`notation` (`"standard"` o `"compact"`, che scrive `12000` come `12K`). Modifica
ciò che viene visualizzato, mai ciò che viene memorizzato.

### Colonne di data, timestamp e ora

| Opzione | Tipo | Effetto |
|---|---|---|
| `clearable` | `boolean` | Aggiunge un controllo che imposta il valore su `null`. |
| `mode` | `"date" \| "date_time"` | Consente di selezionare e visualizzare solo il giorno, oppure giorno e ora. Altrimenti derivato dal tipo di colonna. |
| `timezone` | `string` | Il fuso orario IANA in cui il valore viene mostrato e selezionato (`"Europe/Madrid"`). Altrimenti, quello del visualizzatore. |

### Colonne vettoriali

| Opzione | Tipo | Effetto |
|---|---|---|
| `clearable` | `boolean` | Aggiunge un controllo che imposta il valore su `null`. |

### Colonne di archiviazione (storage)

| Opzione | Tipo | Effetto |
|---|---|---|
| `storage` | `StorageCustomization` | Le funzioni di caricamento che vengono eseguite nel browser. |
| `clearable` | `boolean` | Aggiunge un controllo che imposta il valore su `null`. |
| `urlPreview` | `PreviewType \| boolean` | Come viene visualizzata l'anteprima dell'URL archiviato. |

`storage` accetta solo funzioni; le opzioni serializzabili rimangono su
`col.storage({ … })` (vedi [Caricamento file](/docs/collections/file-uploads/)):

| Chiave | Firma | Effetto |
|---|---|---|
| `path` | `(context) => string` | La cartella in cui viene caricato un file, sostituendo il template `path` della colonna. |
| `fileName` | `(context) => string \| Promise<string>` | Il nome del file memorizzato, sostituendo il template `fileName` della colonna. |
| `processFile` | `(file) => Promise<File>` | Trasforma un file prima del caricamento. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Trasforma il percorso o l'URL memorizzato prima che venga scritto nella colonna. |
| `previewUrl` | `(fileName) => string` | L'URL a cui visualizzare l'anteprima di un file archiviato. |

### Colonne array

| Opzione | Tipo | Effetto |
|---|---|---|
| `expanded` | `boolean` | Tutti gli elementi aperti al caricamento. |
| `minimalistView` | `boolean` | Elementi senza cornice e intestazione. |
| `sortable` | `boolean` | Gli elementi possono essere riordinati tramite trascinamento. |
| `canAddElements` | `boolean` | Gli elementi possono essere aggiunti. |
| `of` | opzioni del campo | Le opzioni di ciascun elemento. |
| `storage` | `StorageCustomization` | Le funzioni di caricamento, per `col.storage().multiple()`. |

`enumLabels` e `enumOrder` definiti su un array si applicano ai suoi elementi.

### Colonne JSON

| Opzione | Tipo | Effetto |
|---|---|---|
| `expanded` | `boolean` | I campi del documento sono aperti al caricamento. |
| `minimalistView` | `boolean` | I campi del documento senza la loro cornice. |
| `spreadChildren` | `boolean` | I campi del documento disposti come se appartenessero direttamente al record. |
| `keyValue` | `boolean` | Modificati come coppie chiave/valore libere. |
| `previewFields` | `string[]` | Le chiavi del documento menzionate nel suo riepilogo a riga singola, in questo ordine. |
| `fields` | `{ [key]: field options }` | Le opzioni per ciascuna chiave del documento. |
| `fieldOrder` | `string[]` | L'ordine in cui vengono mostrate le chiavi del documento. |
| `of` | opzioni del campo | Le opzioni per ciascun elemento, per un documento che è un elenco. |
| `oneOf` | `{ [variant]: field options }` | Le opzioni di ciascuna variante di un blocco tipizzato (`json.oneOf`). |

Con `col.jsonb().$type<T>()` o una forma `json.object({…})`, `fields` e
`fieldOrder` sono tipizzati in base alle chiavi del documento. Vedi
[Array e JSON](/docs/collections/arrays-and-maps/).

Nella cella di una tabella, in una riga di elenco o in una scheda, un documento
JSON occupa una singola riga: le sue prime quattro chiavi di primo livello (o i
suoi `previewFields`), etichettate con il rispettivo `name`, ciascuna con il
relativo valore se si tratta di testo breve, un numero o un sì/no, `3 items`
per un elenco e `4 fields` per un oggetto annidato, che non viene espanso. Un
elenco di documenti è rappresentato dal relativo conteggio. L'intero documento è
presente sul record e nell'editor espandibile della cella. Per una
visualizzazione migliore, specifica le chiavi rilevanti in `previewFields`,
oppure assegna al campo un componente `Preview`.

### Relazioni

| Opzione | Tipo | Effetto |
|---|---|---|
| `previewFields` | `string[]` | I campi della destinazione mostrati nel chip per una riga correlata. Ne possono rientrare al massimo tre. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | La riga correlata (o le righe) con cui si avvia il form di un nuovo record: `new EntityRelation(id, "<target slug>")` (`EntityRelation` da `@rebasepro/cms-types`), o un elenco per una relazione uno-a-molti. Scritto solo quando il form viene salvato. Il valore predefinito intrinseco di una colonna è definito con `.default()` sulla colonna stessa. |
| `widget` | `"select" \| "dialog"` | Come viene selezionata una riga correlata. |
| `fixedFilter` | `FilterValues` | Propone solo le righe che soddisfano questo filtro. |
| `includeId` | `boolean` | Mostra l'id della riga correlata nelle anteprime. |
| `includeEntityLink` | `boolean` | Mostra un link che apre la riga correlata. |
| `renderInForm` | `boolean` | Visualizza inoltre una relazione uno-a-molti come selettore nel form, accanto alla sua scheda. |
| `overrides` | opzioni della tabella senza `fields` | Come viene presentata la destinazione nella scheda di questa relazione. |

Vedi [Relazioni nel pannello](/docs/collections/relations-in-the-admin-panel/).

## Personalizzazioni, `ui-config.json` e preferenze

Ciò che il pannello mostra per una tabella viene composto secondo un ordine
fisso, dove ogni livello si sovrappone al precedente:

1. **La collection derivata**: ciò che il pannello ricava dalla tabella fornita
   dal server.
2. **Codice**: i risultati di `customizeTable` passati come `tableCustomizations`.
3. **`frontend/src/cms/ui-config.json`**: la presentazione del workspace,
   passata come `uiConfig`. È un file nel frontend, modificato manualmente (o
   dal tuo agent), quindi viene revisionato e distribuito insieme ad esso.
4. **Preferenze del workspace**: ciò che un amministratore salva su un
   deployment, nella tabella `rebase.ui_preferences` tramite
   [`/api/admin/ui-config`](/docs/backend/endpoints/). La scrittura di queste
   preferenze richiede `schema:write`.
5. **Preferenze dell'utente**: la larghezza delle colonne, le opzioni di
   visualizzazione e le colonne nascoste specifiche del singolo utente.
   Mantenute nel browser quando non si è autenticati.

Un file `App.tsx` generato automaticamente include già il collegamento al file:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

Le preferenze contengono esclusivamente elementi di presentazione: etichette,
icona, modalità di visualizzazione, ordine delle colonne, colonne nascoste,
etichette e colori degli enum, kanban e impostazioni predefinite delle query. Un
dato relativo allo schema non finisce mai lì; quelli risiedono in
`backend/schema`.

`rebase build` include `frontend/src/cms/ui-config.json` nel bundle
(`entry.uiConfig`), in modo che anche un backend distribuito lo conosca: `GET
/api/admin/ui-config` lo fornisce come `shipped` accanto ai livelli del workspace
e dell'utente, e le viste MCP e `describe_table` uniscono gli stessi tre livelli
— il file, il workspace e quello proprio del chiamante (nessuno per una chiave
API) — affinché un agent veda le etichette, l'ordine, le colonne nascoste e le
etichette degli enum che una persona vede nel pannello.

`rebase verify` analizza ogni chiamata a `customizeTable` in `frontend/src/cms`
rispetto alle tabelle, senza eseguirla: individua personalizzazioni per tabelle o
campi inesistenti, colonne obbligatorie nascoste dal form, tabelle
personalizzate due volte, un `ui-config.json` che non viene passato ad alcun
`<RebaseCMS>` e configurazioni Vite prive di `rebaseBackendGuard()`. Vedi
[`rebase verify`](/docs/cli/#rebase-verify).

## Passaggi successivi

- [Come le tabelle diventano collection](/docs/collections/): cosa ricava il pannello prima di tutto questo
- [Campi](/docs/collections/properties/): widget e opzioni per ciascun tipo di colonna
- [Modalità di visualizzazione](/docs/frontend/view-modes/): tabella, schede, kanban, display slot, filtri
- [Azioni di entità](/docs/frontend/entity-actions/): `entityActions` e `updateRecord`
- [Firestore accanto a Postgres](/docs/frontend/firebase/): `externalCollections` e riferimenti tra motori diversi

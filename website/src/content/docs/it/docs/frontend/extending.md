---
sourceHash: ec086b9ec3b281fc
title: Estendere Rebase
sidebar_label: Estendere Rebase
description: Una guida alle decisioni per scegliere il meccanismo di estensione corretto — plugin, slot, override dei componenti, viste di entità, azioni e altro ancora.
---

## Panoramica

Rebase offre circa una dozzina di meccanismi di estensione — plugin, slot, override dei componenti, viste di entità, azioni, campi personalizzati e altro ancora. Ciascuno si rivolge a un ambito diverso (a livello di app, per collezione, per entità, per proprietà) e a una parte diversa dell'interfaccia utente.

Questa guida ti aiuta a scegliere il meccanismo giusto per il tuo caso d'uso, per poi rimandare alla documentazione di riferimento dettagliata per ciascuno di essi.

:::tip[Inizia dal modello, non dalla lista]
Ogni meccanismo descritto di seguito si basa sullo stesso principio fondamentale: un componente React inserito in una posizione. [Personalizzare l'Admin](/docs/frontend/customizing) spiega questo modello in una singola pagina — elementi costitutivi, hook, posizioni — con ricette testate per un singleton delle impostazioni, impostazioni per singolo utente, un'azione di massa, una vista calendario, una dashboard e una schermata di login personalizzata. Leggilo prima; torna qui per scegliere la posizione.
:::

Tutto ciò che trovi qui riguarda il **pannello di amministrazione**. Per il server — restringere una lettura,
aggiungere una route, integrare il driver nel tuo processo, `rebase eject` — consulta
[Rebase non supporta X](/docs/backend/extending), che rappresenta lo stesso tipo di tabella
per il backend.

## Tabella delle Decisioni

| Voglio… | Meccanismo | Ambito | Riferimento |
|---|---|---|---|
| Sostituire l'app bar | `components` (`Shell.AppBar`) | app | [Override dei Componenti](/docs/frontend/component-overrides) |
| Sostituire la pagina di login | `components` (`Auth.LoginView`) | app | [Override dei Componenti](/docs/frontend/component-overrides) |
| Sostituire la home page | `components` (`HomePage`) | app | [Override dei Componenti](/docs/frontend/component-overrides) |
| Cambiare radicalmente l'aspetto del form di una collezione | `formView` | collezione | [più sotto](#formview) |
| Sostituire un singolo componente all'interno di una collezione | `admin.components` | collezione | [Override dei Componenti](/docs/frontend/component-overrides) |
| Impostare override dei componenti predefiniti per tutte le collezioni | `components` (nomi con ambito di collezione) | app | [Override dei Componenti](/docs/frontend/component-overrides) |
| Aggiungere un pulsante alla barra degli strumenti della collezione | `Actions` della collezione | collezione | [Azioni di Entità](/docs/frontend/entity-actions#collection-actions) |
| Iniettare dell'interfaccia utente in uno slot della barra degli strumenti della collezione | slot `collection.actions` | app/plugin | [Slot](/docs/frontend/slots) |
| Aggiungere una colonna calcolata a una tabella | `additionalFields` | collezione | [Colonne Aggiuntive](/docs/frontend/additional-columns) |
| Aggiungere un widget di campo personalizzato per un tipo di proprietà | `propertyConfigs` | tipo di proprietà | [Campi Personalizzati](/docs/frontend/custom-fields) |
| Aggiungere una scheda all'entità | `entityViews` | entità | [Viste di Entità](/docs/frontend/entity-views) |
| Eseguire il rendering delle righe di una collezione in modo diverso | `admin.customViews` | collezione | [più sotto](#modalità-di-visualizzazione-personalizzate) |
| Aggiungere un'azione contestuale/di riga o un pulsante di entità | `entityActions` | entità | [Azioni di Entità](/docs/frontend/entity-actions) |
| Inserire un valore o elemento grafico sulla scheda di una collezione nella home page | slot `home.card.widget` | app/plugin | [Slot](/docs/frontend/slots) |
| Iniettare dell'interfaccia utente in una posizione specifica del layout (chrome) | `slots` | app/plugin | [Slot](/docs/frontend/slots) |
| Rilasciare diverse estensioni come una singola unità installabile | `plugins` | app | [Plugin](/docs/plugins) |
| Stilizzare l'elemento appena creato | `@rebasepro/ui` + token di tema | qualsiasi | [Stilizzare l'Interfaccia Personalizzata](/docs/frontend/styling) |

:::tip[Qualunque cosa tu scelga, costruiscila usando il kit]
Ogni meccanismo descritto di seguito ti fornisce un componente React senza imporre
il modo in cui riempirlo. Usa i componenti di `@rebasepro/ui` e i token colore del tema
piuttosto che CSS scritto a mano — una vista personalizzata è comunque una vista di amministrazione, e un
colore hardcoded risulterà invisibile in uno dei due temi. Consulta
[Stilizzare l'Interfaccia Personalizzata](/docs/frontend/styling).
:::

## I Meccanismi in Dettaglio

### Plugin

**Ambito:** app.

Un plugin raggruppa collezioni iniettate o modificate, viste, contributi di slot, wrapper di campo, provider, hook e callback del ciclo di vita in un'unica unità installabile. Gli override dei componenti, le viste di entità, le azioni di entità e `propertyConfigs` non sono campi dei plugin: vanno configurati su `<Rebase>` o sulla collezione.

→ [Documentazione di riferimento sui Plugin](/docs/plugins)

### Slot

**Ambito:** app (contributo per slot).

Gli slot sono punti di estensione dell'interfaccia utente dotati di nome, distribuiti lungo l'intero layout (chrome) del CMS. Registrando un componente React associato al nome di uno slot, questo verrà renderizzato in quella posizione. Sono disponibili 27 slot che coprono la home page, la navigazione, le viste di collezione, i form, le righe di entità, i campi dei form e l'app bar — e ciascuno di essi viene renderizzato.

→ [Documentazione di riferimento sugli Slot](/docs/frontend/slots)

### Override dei Componenti (Swizzling)

**Ambito:** impostazioni predefinite a livello di app o per collezione.

Due modalità: **Eject** (sostituzione completa) o **Wrap** (estensione dell'originale).

19 nomi di componenti sostituibili suddivisi in due livelli:

**Solo a livello di app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Con ambito di collezione (12):**
- `Collection.View`
- `Collection.Table`
- `Collection.Card`
- `Collection.EmptyState`
- `Collection.Actions`
- `Collection.FilterField`
- `Entity.Form`
- `EditView.FormActions`
- `DetailView`
- `Entity.SidePanel`
- `EntityPreview`
- `Entity.MissingReference`

**Precedenza:** I `components` a livello di collezione hanno la precedenza sui valori predefiniti a livello di app per lo stesso nome di componente: una sostituzione a livello di collezione sostituisce entrambi, e un override di collezione con `wrap: true` avvolge quello a livello di app. I nomi dei componenti solo a livello di app (`Shell.*`, `HomePage`, `Auth.*`) possono essere sovrascritti solo a livello di `<Rebase>`.

→ [Override dei Componenti](/docs/frontend/component-overrides)

### Viste di Entità

**Ambito:** entità (aggiunge schede).

Viste personalizzate che appaiono come schede (tab) nella pagina di dettaglio dell'entità. Definite per collezione, oppure registrate una sola volta su `<Rebase entityViews>` (o `<RebaseCMS entityViews>`) e richiamate tramite `key` nel parametro `admin.entityViews` di una collezione.

→ [Viste di Entità](/docs/frontend/entity-views)

### Azioni di Entità

**Ambito:** entità.

Pulsanti di azione personalizzati su singole entità (pubblica, archivia, clona, ecc.). Definiti per collezione, oppure registrati una sola volta su `<Rebase entityActions>` (o `<RebaseCMS entityActions>`) e richiamati tramite `key` nel parametro `admin.entityActions` di una collezione.

→ [Azioni di Entità](/docs/frontend/entity-actions)

### `Actions` di Collezione

**Ambito:** collezione.

Componenti React a livello di barra degli strumenti che ricevono `CollectionActionsProps` (entità selezionate, controller della tabella, contesto della collezione). Renderizzati nella barra degli strumenti della collezione accanto alle azioni predefinite.

**Relazione con lo slot `collection.actions`:** Entrambi sono additivi — i componenti `Actions` vengono renderizzati per primi nella barra degli strumenti, seguiti dai contributi dello slot da `collection.actions`. Non si sostituiscono a vicenda.

→ [Azioni di Entità — Azioni di Collezione](/docs/frontend/entity-actions#collection-actions)

### Modalità di visualizzazione personalizzate
**Ambito:** collezione (aggiunge una modalità di visualizzazione).

Una mappa, un calendario, una galleria, una cronologia — un rendering differente delle *stesse righe*,
disponibile nel selettore delle viste della collezione accanto a Lista, Tabella, Schede e Lavagna.

```ts
// collection config
admin: {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView }
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map"
}
```

Oppure registra il componente una volta sola e richiamalo tramite chiave, il che lo rende
anche selezionabile dall'editor della collezione:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` riceve il `tableController` attivo, quindi la vista eredita
i filtri della collezione, la casella di ricerca, l'ordinamento, la paginazione, i controlli dei permessi
e il pannello laterale dell'entità — questo è l'intero motivo per dichiararne una invece di
costruire una `AppView`:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Le righe sono quelle del server, con la struttura restituita da `useRows`: date come stringhe ISO,
un belongsTo come la sua colonna chiave esterna, e una relazione caricata dalla vista annidata
sotto il rispettivo nome. `highlightedIds` contiene gli id delle righe che la vista mostra come
selezionate, e anche `selectionController` gestisce id e righe.

La selezione della vista aggiorna `?__view=`, persiste dopo il ricaricamento della pagina e viene salvata per singolo utente.
Dichiararne una è sufficiente per renderla disponibile — `enabledViews` deve essere configurato solo quando
si desidera *rimuovere le viste integrate*. Con una singola voce il selettore viene nascosto.

**Questo non è un modo per costruire una vista che copre più collezioni.** Una modalità di visualizzazione
è un rendering alternativo della query di una singola collezione. Se il tuo componente ignora
`tableController` e recupera autonomamente quattro tabelle diverse, dovrebbe essere una
[`AppView`](/docs/frontend#custom-views) — la barra degli strumenti sovrastante, con la sua casella
di ricerca e il conteggio dei record, descriverebbe una query che la vista non renderizza.

### `formView`
**Ambito:** collezione.

Sostituisce l'intero form di entità predefinito con un componente personalizzato. Si imposta nella definizione di una collezione:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Salva e Annulla nella barra (predefinito: true)
        }
    }
};

```

Da utilizzare quando è necessario un layout completamente personalizzato per l'esperienza di modifica delle entità di una collezione. Per modifiche minori, è preferibile usare `admin.components` con l'override di `Entity.Form`.

Il Builder viene renderizzato all'interno del form del record e riceve il suo `formContext` attivo: scrivi con `formContext.setFieldValue`, e il pulsante Salva della barra salverà il record. Nei casi in cui il record non può essere modificato — la vista di dettaglio in sola lettura, o un utente senza autorizzazione di modifica — `formContext.disabled` è `true` e i tentativi di scrittura generano un errore. Imposta `includeActions: false` se il tuo Builder gestisce il salvataggio in autonomia tramite `formContext.submit()`.

### `additionalFields`

**Ambito:** collezione.

Colonne calcolate/virtuali visualizzate nella tabella della collezione. Queste non corrispondono a proprietà memorizzate — vengono calcolate al momento del rendering.

→ [Colonne Aggiuntive](/docs/frontend/additional-columns)

### `propertyConfigs`

**Ambito:** tipo di proprietà.

Widget di campo personalizzati per tipi di proprietà specifici, che forniscono campi di form e componenti di anteprima dedicati.

→ [Campi Personalizzati](/docs/frontend/custom-fields)

## Non il pannello di amministrazione

Se ciò che desideri modificare riguarda il comportamento del server anziché ciò che
mostra il pannello, questa non è la pagina adatta. Il server dispone di una propria gerarchia:

| Voglio… | Livello | Riferimento |
|---|---|---|
| Limitare le righe restituite da un'operazione di lettura | callback `beforeQuery` | [Estendere il server](/docs/backend/extending#2-collection-callbacks) |
| Rimuovere o oscurare un valore in uscita | callback `afterRead` | [Callback](/docs/collections/callbacks) |
| Aggiungere un endpoint personalizzato | funzione personalizzata | [Funzioni Personalizzate](/docs/backend/custom-functions) |
| Configurare la ricerca per trovare sottostringhe *e* ignorare gli accenti | `search.mode: "hybrid"` | [Ricerca](/docs/backend/search) |
| Gestire direttamente il processo del server | server personalizzato, quindi `rebase eject` | [Estendere il server](/docs/backend/extending) |

→ [Rebase non supporta X](/docs/backend/extending)

## Riepilogo delle Precedenze

- **I componenti in `admin.components` di una collezione hanno la precedenza sui `components` globali** all'interno di quella collezione. Una sostituzione di collezione sostituisce entrambi; un override di collezione con `wrap: true` avvolge l'override globale ove presente (nella versione 0.24 avvolge il componente predefinito, ignorando l'override globale). Consulta [Override dei Componenti](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Le `Actions` di collezione e lo slot `collection.actions` sono additivi** — le `Actions` vengono renderizzate per prime, seguite dai contributi dello slot.
- **`entityActions` ed `entityViews` a livello di app fungono da registro, non da valori predefiniti:** una collezione mostra un elemento solo se la sua proprietà `admin.entityActions` / `admin.entityViews` ne indica la relativa `key`.
- **I plugin vengono applicati nell'ordine dell'array `plugins`**, non in base a `key`. I contributi agli slot vengono renderizzati in base al loro valore `order` (i valori più bassi per primi, 50 per impostazione predefinita), e i casi di parità mantengono tale ordine. I wrapper di campo provenienti da più plugin si compongono secondo tale sequenza, con quello del primo plugin posizionato più internamente; nella versione 0.24 veniva renderizzato solo l'ultimo wrapper. Consulta [Plugin](/docs/plugins#field-wrappers-from-several-plugins).

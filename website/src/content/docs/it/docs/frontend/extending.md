---
sourceHash: a874bc209f13c746
title: Estendere Rebase
sidebar_label: Estendere Rebase
description: Una guida alle decisioni per scegliere il meccanismo di estensione corretto — plugin, slot, override dei componenti, viste di entità, azioni e altro ancora.
---

## Panoramica

Rebase offre circa una dozzina di meccanismi di estensione — plugin, slot, override dei componenti, viste di entità, azioni, campi personalizzati e altro ancora. Ciascuno si rivolge a un ambito diverso (a livello di applicazione, per collezione, per entità, per proprietà) e a una parte diversa dell'interfaccia utente.

Questa guida ti aiuta a scegliere il meccanismo giusto per il tuo caso d'uso, per poi rimandare alla documentazione di riferimento dettagliata di ciascuno.

:::tip[Inizia dal modello, non dall'elenco]
Ogni meccanismo descritto di seguito si basa sullo stesso concetto di fondo: un componente React posizionato in un punto specifico. [Personalizzare l'Admin](/docs/frontend/customizing) spiega questo modello in un'unica pagina — elementi costitutivi, hook, posizioni — con ricette testate per un singleton di impostazioni, impostazioni per utente, un'azione massiva, una vista calendario, una dashboard e una schermata di login personalizzata. Leggilo prima; torna qui per scegliere la posizione corretta.
:::

Tutto ciò che trovi qui riguarda il **pannello di amministrazione**. Per il server — filtrare una lettura,
aggiungere una route, incorporare il driver nel proprio processo, `rebase eject` — consulta
[Rebase non supporta X](/docs/backend/extending), che rappresenta lo stesso tipo di tabella comparativa
per il backend.

## Tabella delle decisioni

| Voglio… | Meccanismo | Ambito | Riferimento |
|---|---|---|---|
| Sostituire la barra dell'applicazione | `components` (`Shell.AppBar`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Sostituire la pagina di login | `components` (`Auth.LoginView`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Sostituire la home page | `components` (`HomePage`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Cambiare completamente l'aspetto del form di una collezione | `formView` | collezione | [sotto](#formview) |
| Sostituire un singolo componente all'interno di una collezione | `collection.components` | collezione | [Override dei componenti](/docs/frontend/component-overrides) |
| Impostare override di componenti predefiniti per tutte le collezioni | `components` (nomi con ambito a livello di collezione) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Aggiungere un pulsante alla barra degli strumenti della collezione | `Actions` della collezione | collezione | [Azioni di entità](/docs/frontend/entity-actions#collection-actions) |
| Iniettare interfaccia utente in uno slot della barra degli strumenti della collezione | slot `collection.actions` | app/plugin | [Slot](/docs/frontend/slots) |
| Aggiungere una colonna calcolata a una tabella | `additionalFields` | collezione | [Colonne aggiuntive](/docs/frontend/additional-columns) |
| Aggiungere un widget personalizzato per un tipo di proprietà | `propertyConfigs` | tipo di proprietà | [Campi personalizzati](/docs/frontend/custom-fields) |
| Aggiungere una scheda entità | `entityViews` | entità | [Viste di entità](/docs/frontend/entity-views) |
| Eseguire il rendering delle righe di una collezione in modo diverso | `admin.customViews` | collezione | [sotto](#modalità-di-visualizzazione-personalizzate) |
| Aggiungere un'azione contestuale/di riga o un pulsante entità | `entityActions` | entità | [Azioni di entità](/docs/frontend/entity-actions) |
| Inserire un dato/indicatore sulla scheda della home page di una collezione | slot `home.card.widget` | app/plugin | [Slot](/docs/frontend/slots) |
| Iniettare interfaccia utente in una posizione specifica del layout (chrome) | `slots` | app/plugin | [Slot](/docs/frontend/slots) |
| Distribuire diverse estensioni come una singola unità installabile | `plugins` | app | [Plugin](/docs/plugins) |
| Applicare stili all'elemento appena creato | `@rebasepro/ui` + token del tema | qualsiasi | [Stilizzare l'interfaccia utente personalizzata](/docs/frontend/styling) |

:::tip[Qualunque cosa tu scelga, costruiscila usando il kit]
Ogni meccanismo illustrato di seguito ti mette a disposizione un componente React senza vincoli
sul contenuto con cui riempirlo. Usa i componenti di `@rebasepro/ui` e i token colore del tema
piuttosto che CSS scritto a mano — una vista personalizzata rimane pur sempre una vista di amministrazione,
e un colore hardcoded risulterà invisibile in uno dei due temi. Consulta
[Stilizzare l'interfaccia utente personalizzata](/docs/frontend/styling).
:::

## Dettaglio dei meccanismi

### Plugin

**Ambito:** app.

Un plugin raggruppa collezioni, viste, override dei componenti, contributi agli slot, autenticazione, origini dati, provider, hook e callback del ciclo di vita in una singola unità installabile. Tutti gli altri meccanismi elencati qui possono essere forniti tramite l'interfaccia di un plugin.

→ [Riferimento per i plugin](/docs/plugins)

### Slot

**Ambito:** app (applicato per ciascun singolo slot).

Gli slot sono punti di estensione denominati dell'interfaccia utente distribuiti all'interno dell'infrastruttura (chrome) del CMS. Registri un componente React destinato a un nome di slot specifico, ed esso viene renderizzato in quella posizione. Ci sono 27 slot che coprono la home page, la navigazione, le viste delle collezioni, i form, le righe di entità, i campi dei form e la barra dell'applicazione — e ciascuno di essi viene renderizzato.

→ [Riferimento per gli slot](/docs/frontend/slots)

### Override dei componenti (Swizzling)

**Ambito:** impostazioni predefinite a livello di app o per singola collezione.

Due modalità: **Eject** (sostituzione completa) o **Wrap** (estensione dell'originale).

19 nomi di componenti sovrascrivibili suddivisi in due livelli:

**Solo per app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Con ambito per collezione (12):**
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

**Priorità:** I `components` a livello di collezione sovrascrivono i valori predefiniti a livello di app per lo stesso nome di componente (semplice object spread — i valori della collezione sovrascrivono i valori globali). I nomi dei componenti disponibili solo a livello di app (`Shell.*`, `HomePage`, `Auth.*`) possono essere sovrascritti unicamente a livello di `<Rebase>`.

→ [Override dei componenti](/docs/frontend/component-overrides)

### Viste di entità

**Ambito:** entità (aggiunge schede).

Viste personalizzate che appaiono come schede nella pagina di dettaglio dell'entità. Possono essere definite a livello globale su `<Rebase>` o per collezione.

→ [Viste di entità](/docs/frontend/entity-views)

### Azioni di entità

**Ambito:** entità.

Pulsanti di azione personalizzati su singole entità (pubblica, archivia, clona, ecc.). Possono essere definiti a livello globale o per collezione.

→ [Azioni di entità](/docs/frontend/entity-actions)

### `Actions` della collezione

**Ambito:** collezione.

Componenti React a livello di barra degli strumenti che ricevono `CollectionActionsProps` (entità selezionate, controller della tabella, contesto della collezione). Vengono renderizzati nella barra degli strumenti della collezione insieme alle azioni integrate.

**Relazione con lo slot `collection.actions`:** Entrambi sono additivi — i componenti `Actions` vengono renderizzati per primi nella barra degli strumenti, seguiti dai contributi dello slot `collection.actions`. Non si sostituiscono a vicenda.

→ [Azioni di entità — Azioni della collezione](/docs/frontend/entity-actions#collection-actions)

### Modalità di visualizzazione personalizzate
**Ambito:** collezione (aggiunge una modalità di visualizzazione).

Una mappa, un calendario, una galleria, una cronologia — un altro modo di visualizzare *le stesse righe*,
disponibile nel selettore delle viste della collezione accanto a Lista, Tabella, Schede e Lavagna (Board).

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

In alternativa, registra il componente una volta e nominalo tramite chiave, operazione che lo rende
inoltre selezionabile dall'editor della collezione:

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
e il pannello laterale dell'entità — questo è l'intero motivo per cui dichiararne una invece di
creare una `AppView`:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

La scelta della vista aggiorna `?__view=`, persiste dopo il ricaricamento della pagina e viene salvata per singolo utente.
Dichiararne una è sufficiente per renderla disponibile — `enabledViews` deve essere impostato solo quando
si desidera *rimuovere le viste integrate*. Con un'unica voce, il selettore rimane nascosto.

**Questo non è un modo per costruire una vista che abbraccia diverse collezioni.** Una modalità di visualizzazione
è un'altra rappresentazione della query di una singola collezione. Se il tuo componente ignora
`tableController` e recupera autonomamente quattro tabelle separate, dovrebbe essere una
[`AppView`](/docs/frontend#custom-views) — la barra degli strumenti sopra di esso, con la sua casella
di ricerca e il conteggio dei record, descriverebbe una query che il componente non renderizza.

### `formView`
**Ambito:** collezione.

Sostituisce l'intero form predefinito dell'entità con un componente personalizzato. Si imposta nella definizione di una collezione:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Save and Discard in the bar (default: true)
        }
    }
};

```

Da utilizzare quando hai bisogno di un layout completamente personalizzato per l'esperienza di modifica delle entità di una collezione. Per modifiche più contenute, è preferibile utilizzare `collection.components` con l'override di `Entity.Form`.

Il Builder viene renderizzato all'interno del form del record e riceve il relativo `formContext` attivo: scrivi con `formContext.setFieldValue`, e il tasto Salva della barra memorizzerà il record. Laddove il record non può essere modificato — la vista di dettaglio in sola lettura o un utente senza permessi di modifica — `formContext.disabled` è `true` e i tentativi di scrittura generano un errore. Imposta `includeActions: false` se il tuo Builder esegue il salvataggio autonomamente tramite `formContext.submit()`.

### `additionalFields`

**Ambito:** collezione.

Colonne calcolate/virtuali mostrate nella tabella della collezione. Non corrispondono a proprietà archiviate, ma vengono calcolate in fase di rendering.

→ [Colonne aggiuntive](/docs/frontend/additional-columns)

### `propertyConfigs`

**Ambito:** tipo di proprietà.

Widget di campo personalizzati per specifici tipi di proprietà, che forniscono campi form e componenti di anteprima personalizzati.

→ [Campi personalizzati](/docs/frontend/custom-fields)

## Non il pannello di amministrazione

Se ciò che desideri modificare è il comportamento del server anziché ciò che
mostra il pannello, questa non è la pagina corretta. Il server segue una propria gerarchia:

| Voglio… | Livello | Riferimento |
|---|---|---|
| Limitare le righe restituite da una lettura | callback `beforeQuery` | [Estendere il server](/docs/backend/extending#2-collection-callbacks) |
| Oscurare un valore in uscita | callback `afterRead` | [Callback](/docs/collections/callbacks) |
| Aggiungere un endpoint personalizzato | funzione personalizzata | [Funzioni personalizzate](/docs/backend/custom-functions) |
| Fare in modo che la ricerca trovi sottostringhe *e* normalizzi gli accenti | `search.mode: "hybrid"` | [Ricerca](/docs/backend/search) |
| Gestire autonomamente il processo del server | server personalizzato, quindi `rebase eject` | [Estendere il server](/docs/backend/extending) |

→ [Rebase non supporta X](/docs/backend/extending)

## Riepilogo delle priorità

- **`collection.components` ha la precedenza sui `components` globali** all'interno di quella collezione. Una sostituzione a livello di collezione sostituisce entrambi; un override con `wrap: true` a livello di collezione avvolge l'override globale se presente (nella versione 0.24 avvolge il componente integrato e l'override globale viene ignorato). Consulta [Override dei componenti](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Le `Actions` della collezione e lo slot `collection.actions` sono additivi** — i componenti `Actions` vengono renderizzati per primi, seguiti dai contributi dello slot.
- **`entityActions` ed `entityViews` a livello di collezione estendono (non sostituiscono) quelli globali.**
- **I plugin vengono applicati nell'ordine dell'array `plugins`**, non in base alla `key`. I contributi agli slot vengono renderizzati in base al loro `order` (il più basso per primo, 50 come valore predefinito) e, a parità di valore, mantengono tale ordine. I wrapper di campo provenienti da più plugin si compongono in quell'ordine, con quello del primo plugin posizionato più all'interno; nella versione 0.24 veniva renderizzato solo l'ultimo wrapper. Consulta [Plugin](/docs/plugins#field-wrappers-from-several-plugins).

---
sourceHash: 3317ba94279d0cb8
title: Estendere Rebase
sidebar_label: Estendere Rebase
description: Una guida alle decisioni per scegliere il meccanismo di estensione corretto — plugin, slot, override di componenti, viste entità, azioni e altro ancora.
---

## Panoramica

Rebase offre circa una dozzina di meccanismi di estensione: plugin, slot, override di componenti, viste entità, azioni, campi personalizzati e altro ancora. Ognuno di essi si rivolge a un ambito diverso (a livello di app, per collezione, per entità, per proprietà) e a una parte diversa dell'interfaccia utente.

Questa guida ti aiuta a scegliere il meccanismo giusto per il tuo caso d'uso, rimandando poi alla guida di riferimento dettagliata per ciascuno di essi.

:::tip[Inizia con il modello, non con l'elenco]
Ogni meccanismo descritto di seguito si basa sullo stesso concetto fondamentale: un componente React inserito in una posizione. [Personalizzare l'Admin](/docs/frontend/customizing) spiega questo modello in una sola pagina — blocchi costitutivi, hook, posizioni — con ricette testate per un singleton di impostazioni, impostazioni per utente, un'azione di massa, una vista calendario, una dashboard e una schermata di login personalizzata. Leggilo prima; torna qui per scegliere la posizione.
:::

Tutto ciò che si trova qui riguarda il **pannello di amministrazione**. Per il server — limitare una lettura, aggiungere una route, incorporare il driver nel proprio processo, `rebase eject` — consulta [Rebase non fa X](/docs/backend/extending), che fornisce una tabella simile per il backend.

## Tabella delle decisioni

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Desidero… | Meccanismo | Ambito | Riferimento |
|---|---|---|---|
| Sostituire l'app bar | `components` (`Shell.AppBar`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Sostituire la pagina di login | `components` (`Auth.LoginView`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Sostituire la home page | `components` (`HomePage`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Modificare completamente l'aspetto del form di una tabella | `formView` in `customizeTable` | tabella | [qui sotto](#formview) |
| Sostituire un componente all'interno della collezione di una tabella | `components` in `customizeTable` | tabella | [Override dei componenti](/docs/frontend/component-overrides#collection-level-component-overrides) |
| Impostare override di componenti predefiniti per tutte le collezioni | `components` (nomi con ambito di collezione) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Aggiungere un pulsante alla barra degli strumenti della collezione | `Actions` in `customizeTable` | tabella | [Azioni entità](/docs/frontend/entity-actions#collection-actions) |
| Iniettare UI in uno slot della barra degli strumenti della collezione | slot `collection.actions` | app/plugin | [Slot](/docs/frontend/slots) |
| Aggiungere una colonna calcolata a una tabella | `additionalFields` in `customizeTable` | tabella | [Colonne aggiuntive](/docs/frontend/additional-columns) |
| Sostituire il controllo di un campo | `Field` in `customizeTable` | campo | [Campi personalizzati](/docs/frontend/custom-fields) |
| Registrare un tipo di campo riutilizzabile | `propertyConfigs` | app | [Campi personalizzati](/docs/frontend/custom-fields#a-reusable-field-type) |
| Aggiungere una scheda (tab) per un'entità | `entityViews` in `customizeTable` | entità | [Viste entità](/docs/frontend/entity-views) |
| Eseguire il rendering delle righe di una tabella in modo diverso | `customViews` in `customizeTable` | tabella | [qui sotto](#modalità-di-visualizzazione-personalizzate) |
| Aggiungere un'azione contestuale/di riga o un pulsante per l'entità | `entityActions` in `customizeTable` | entità | [Azioni entità](/docs/frontend/entity-actions) |
| Inserire una cifra o un widget sulla scheda della home page di una collezione | slot `home.card.widget` | app/plugin | [Slot](/docs/frontend/slots) |
| Iniettare UI in una posizione specifica del chrome | `slots` | app/plugin | [Slot](/docs/frontend/slots) |
| Distribuire diverse estensioni come un'unica unità installabile | `plugins` | app | [Plugin](/docs/plugins) |
| Applicare stili a ciò che è stato appena creato | `@rebasepro/ui` + token del tema | qualsiasi | [Stile per la UI personalizzata](/docs/frontend/styling) |

:::tip[Qualunque cosa tu scelga, costruiscila usando il kit]
Ognuno dei meccanismi descritti di seguito ti fornisce un componente React senza vincolare il contenuto con cui riempirlo. Usa i componenti di `@rebasepro/ui` e i token di colore del tema invece del CSS scritto a mano: una vista personalizzata rimane pur sempre una vista di amministrazione, e un colore hardcoded risulterà invisibile in uno dei due temi. Consulta [Stile per la UI personalizzata](/docs/frontend/styling).
:::

## I meccanismi nel dettaglio

### Plugin

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Ambito:** app.

Un plugin raggruppa collezioni iniettate o modificate, viste, contributi di slot, wrapper di campo, provider, hook e callback del ciclo di vita in un'unica unità installabile. Gli override dei componenti, le viste entità, le azioni entità e `propertyConfigs` non sono campi dei plugin: vanno impostati su `<Rebase>` o nel `customizeTable` di una tabella.

→ [Riferimento dei plugin](/docs/plugins)

### Slot

**Ambito:** app (fornito per singolo slot).

Gli slot sono punti di estensione UI con nome distribuiti nell'intera interfaccia (chrome) del CMS. Registri un componente React associato a un nome di slot, e questo viene renderizzato in quella posizione. Sono presenti 27 slot che coprono la home page, la navigazione, le viste collezione, i form, le righe delle entità, i campi dei form e l'app bar — e ognuno di essi viene renderizzato.

→ [Riferimento degli slot](/docs/frontend/slots)

### Override dei componenti (Swizzling)

**Ambito:** impostazioni predefinite a livello di app o per collezione.

Due modalità: **Eject** (sostituzione completa) o **Wrap** (estensione dell'originale).

19 nomi di componenti sovrascrivibili suddivisi in due livelli:

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

**Precedenza:** La proprietà `components` di una tabella si applica sopra i valori predefiniti a livello di app per lo stesso nome di componente: una sostituzione a livello di collezione sostituisce entrambi, mentre un override con `wrap: true` a livello di collezione avvolge quello a livello di app. I nomi dei componenti disponibili solo a livello di app (`Shell.*`, `HomePage`, `Auth.*`) possono essere sovrascritti solo a livello di `<Rebase>`.

→ [Override dei componenti](/docs/frontend/component-overrides)

### Viste entità

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Ambito:** entità (aggiunge tab).

Viste personalizzate che appaiono come tab nella pagina di dettaglio dell'entità. Sono definite per tabella in `customizeTable`, oppure registrate una sola volta su `<Rebase entityViews>` (o `<RebaseCMS entityViews>`) e richiamate tramite la relativa `key` nelle `entityViews` di una tabella.

→ [Viste entità](/docs/frontend/entity-views)

### Azioni entità

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Ambito:** entità.

Pulsanti di azione personalizzati sulle singole entità (pubblica, archivia, clona, ecc.). Definiti per tabella in `customizeTable`, oppure registrati una sola volta su `<Rebase entityActions>` (o `<RebaseCMS entityActions>`) e richiamati tramite la relativa `key` nelle `entityActions` di una tabella.

→ [Azioni entità](/docs/frontend/entity-actions)

### `Actions` di collezione

**Ambito:** collezione.

Componenti React a livello di barra degli strumenti che ricevono `CollectionActionsProps` (entità selezionate, controller della tabella, contesto della collezione). Vengono renderizzati nella barra degli strumenti della collezione accanto alle azioni integrate.

**Relazione con lo slot `collection.actions`:** Entrambi sono additivi — i componenti `Actions` vengono renderizzati per primi nella barra degli strumenti, seguiti dai contributi dello slot `collection.actions`. Non si sostituiscono a vicenda.

→ [Azioni entità — Azioni di collezione](/docs/frontend/entity-actions#collection-actions)

### Modalità di visualizzazione personalizzate

<span class="since-badge" data-since="0.31">Da 0.31</span>
**Ambito:** collezione (aggiunge una modalità di visualizzazione).

Una mappa, un calendario, una galleria, una cronologia — un altro modo di renderizzare *le stesse righe*, offerto nel selettore di vista della collezione accanto a List, Table, Cards e Board.

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";
import { MapView } from "../../../../../components/MapView";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView },
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map",
});
```

Oppure registra il componente una sola volta e richiamalo per chiave, il che lo rende anche selezionabile dall'editor della collezione:

```tsx
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    customViews: ["map"],
});
```

`Builder` riceve il `tableController` attivo, quindi la vista eredita i filtri della collezione, la casella di ricerca, l'ordinamento, la paginazione, i controlli dei permessi e il pannello laterale dell'entità — questo è il motivo principale per cui dichiararne uno invece di creare una `AppView`:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Le righe provengono dal server, con la stessa struttura restituita da `useRows`: date come stringhe ISO, un belongsTo come colonna di chiave esterna e le relazioni caricate dalla vista nidificate sotto il relativo nome. Una riga ha una colonna `id` solo se la tabella la possiede; il suo id è accessibile a parte, come `tableController.ids[i]` per `tableController.rows[i]`. `highlightedIds` indica gli id delle righe che la vista visualizza come selezionate, e anche `selectionController` opera con id e righe:

```tsx
import type { CollectionCustomViewParams } from "@rebasepro/cms-types";
import { Card, Typography } from "@rebasepro/ui";

function CardsView({ tableController, highlightedIds, onRowClick }: CollectionCustomViewParams) {
    return <div className="grid grid-cols-3 gap-4 p-4">
        {tableController.rows.map((row, i) => {
            const id = tableController.ids[i];
            return <Card key={id}
                className={highlightedIds?.includes(id) ? "p-4 ring-2 ring-primary" : "p-4"}
                onClick={() => onRowClick?.(row)}>
                <Typography variant="subtitle2">{String(row.title ?? id)}</Typography>
            </Card>;
        })}
    </div>;
}
```

La scelta della vista aggiorna `?__view=`, persiste a un ricaricamento della pagina e viene memorizzata per utente. Dichiararne una è sufficiente per renderla disponibile — `enabledViews` deve essere impostato solo quando si desidera *rimuovere le viste integrate*. Con una sola voce il selettore viene nascosto.

**Questo non è un modo per creare una vista che abbraccia diverse collezioni.** Una modalità di visualizzazione è un rendering alternativo della query di una singola collezione. Se il tuo componente ignora `tableController` ed effettua il fetch autonomo di quattro tabelle diverse, dovrebbe invece essere una [`AppView`](/docs/frontend#custom-views) — altrimenti la barra degli strumenti sovrastante, con la sua casella di ricerca e il conteggio dei record, descriverebbe una query che non è quella renderizzata.

### `formView`

<span class="since-badge" data-since="0.31">Da 0.31</span>
**Ambito:** collezione.

Sostituisce l'intero form predefinito dell'entità con un componente personalizzato, configurato con `formView: { Builder, includeActions }` in `customizeTable`; consulta [Sostituire il form](/docs/frontend/form-layout/#replacing-the-form). `includeActions` (predefinito `true`) mantiene i pulsanti Salva e Annulla nella barra.

Utilizzalo quando hai bisogno di un layout completamente personalizzato per la modifica dei record di una tabella. Per modifiche minori, è preferibile utilizzare l'override di `Entity.Form` in `components`.

Il Builder viene renderizzato all'interno del form del record e riceve il relativo `formContext` attivo: scrivi con `formContext.setFieldValue`, e il pulsante Salva nella barra salverà il record. Nei casi in cui il record non può essere modificato — la vista di dettaglio di sola lettura, o un utente privo di permessi di modifica — `formContext.disabled` è `true` e le operazioni di scrittura generano un errore. Imposta `includeActions: false` se il tuo Builder gestisce il salvataggio autonomamente tramite `formContext.submit()`.

### `additionalFields`

**Ambito:** collezione.

Colonne calcolate visualizzate nella tabella della collezione. Non corrispondono a colonne archiviate: vengono calcolate al momento del rendering.

→ [Colonne aggiuntive](/docs/frontend/additional-columns)

### `propertyConfigs`

**Ambito:** tipo di proprietà.

Tipi di campo riutilizzabili, registrati una sola volta in `<Rebase propertyConfigs>` e richiamati tramite il `propertyConfig` di un campo.

→ [Campi personalizzati](/docs/frontend/custom-fields)

## Non il pannello di amministrazione

Se ciò che desideri modificare è il comportamento del server piuttosto che ciò che mostra il pannello, questa non è la pagina giusta. Il server ha la sua scala di meccanismi:

| Desidero… | Livello | Riferimento |
|---|---|---|
| Limitare le righe restituite da una lettura | hook `beforeQuery` | [Estendere il server](/docs/backend/extending#2-table-hooks) |
| Mascherare un valore in uscita | hook `afterRead` | [Hook di tabella](/docs/collections/callbacks) |
| Aggiungere un endpoint personalizzato | funzione personalizzata | [Funzioni personalizzate](/docs/backend/custom-functions) |
| Fare in modo che la ricerca trovi sottostringhe *e* ignori gli accenti | `search.mode: "hybrid"` | [Ricerca](/docs/backend/search) |
| Gestire direttamente il processo del server | server personalizzato, poi `rebase eject` | [Estendere il server](/docs/backend/extending) |

→ [Rebase non fa X](/docs/backend/extending)

## Riepilogo delle precedenze

<span class="since-badge" data-since="0.31">Da 0.31</span>

- **La proprietà `components` di una tabella ha la precedenza sui `components` globali** all'interno della sua collezione. Una sostituzione a livello di collezione sostituisce entrambi; un override con `wrap: true` a livello di collezione avvolge l'override globale, qualora presente. Consulta [Override dei componenti](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Le `Actions` di collezione e lo slot `collection.actions` sono additivi** — i componenti `Actions` vengono renderizzati per primi, seguiti dai contributi dello slot.
- **Le `entityActions` e `entityViews` a livello di app fungono da registro, non da impostazioni predefinite:** una tabella ne mostra una solo quando le sue specifiche `entityActions` / `entityViews` in `customizeTable` ne indicano la `key`.
- **I plugin si applicano nell'ordine dell'array `plugins`**, non in base alla `key`. I contributi agli slot vengono renderizzati in base al loro `order` (prima i valori più bassi, 50 per impostazione predefinita), e i casi di parità mantengono tale ordine. I wrapper di campo provenienti da più plugin si compongono in quell'ordine, con quello del primo plugin posizionato più all'interno. Consulta [Plugin](/docs/plugins#field-wrappers-from-several-plugins).

---
sourceHash: 26f6f53fc55b88dc
title: Estendere Rebase
sidebar_label: Estendere Rebase
description: Una guida alle decisioni per scegliere il meccanismo di estensione corretto — plugin, slot, override di componenti, viste entità, azioni e altro ancora.
---

## Panoramica

Rebase offre circa una dozzina di meccanismi di estensione: plugin, slot, override di componenti, viste entità, azioni, campi personalizzati e altro ancora. Ognuno di essi ha come obiettivo un ambito diverso (a livello di app, per collezione, per entità, per proprietà) e una parte diversa della UI.

Questa guida ti aiuta a scegliere il meccanismo adatto al tuo caso d'uso, rimandando poi alla documentazione di riferimento dettagliata per ciascuno.

:::tip[Inizia dal modello, non dall'elenco]
Sotto il cofano, ogni meccanismo riportato di seguito è la stessa cosa: un componente React inserito in una posizione. [Personalizzare l'Admin](/docs/frontend/customizing) spiega questo modello in una singola pagina — blocchi di base, hook, posizioni — con ricette testate per un singleton delle impostazioni, impostazioni per utente, un'azione di massa, una vista calendario, una dashboard e una schermata di login personalizzata. Leggilo prima; torna qui per scegliere la posizione.
:::

Tutto ciò che trovi qui riguarda il **pannello di amministrazione**. Per il server — restringere una lettura,
aggiungere una route, incorporare il driver nel proprio processo, `rebase eject` — consulta
[Rebase non fa X](/docs/backend/extending), che offre lo stesso tipo di tabella
per il backend.

## Tabella delle decisioni

| Voglio… | Meccanismo | Ambito | Riferimento |
|---|---|---|---|
| Sostituire l'app bar | `components` (`Shell.AppBar`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Sostituire la pagina di login | `components` (`Auth.LoginView`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Sostituire la home page | `components` (`HomePage`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Modificare completamente l'aspetto del form di una tabella | `formView` in `customizeTable` | table | [in basso](#formview) |
| Sostituire un componente all'interno della collezione di una tabella | `components` in `customizeTable` | table | [Override dei componenti](/docs/frontend/component-overrides#collection-level-component-overrides) |
| Impostare gli override dei componenti predefiniti per tutte le collezioni | `components` (nomi con ambito collezione) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Aggiungere un pulsante alla barra degli strumenti della collezione | `Actions` in `customizeTable` | table | [Azioni entità](/docs/frontend/entity-actions#collection-actions) |
| Iniettare UI in uno slot della barra degli strumenti della collezione | slot `collection.actions` | app/plugin | [Slot](/docs/frontend/slots) |
| Aggiungere una colonna calcolata a una tabella | `additionalFields` in `customizeTable` | table | [Colonne aggiuntive](/docs/frontend/additional-columns) |
| Sostituire il controllo di un campo | `Field` in `customizeTable` | field | [Campi personalizzati](/docs/frontend/custom-fields) |
| Registrare un tipo di campo riutilizzabile | `propertyConfigs` | app | [Campi personalizzati](/docs/frontend/custom-fields#a-reusable-field-type) |
| Aggiungere una scheda (tab) entità | `entityViews` in `customizeTable` | entity | [Viste entità](/docs/frontend/entity-views) |
| Renderizzare le righe di una tabella in modo diverso | `customViews` in `customizeTable` | table | [in basso](#modalità-di-visualizzazione-personalizzate-custom-view-modes) |
| Aggiungere un'azione contestuale/di riga o un pulsante entità | `entityActions` in `customizeTable` | entity | [Azioni entità](/docs/frontend/entity-actions) |
| Inserire una cifra/grafico sulla card di una collezione nella home page | slot `home.card.widget` | app/plugin | [Slot](/docs/frontend/slots) |
| Iniettare UI in una posizione specifica del chrome dell'interfaccia | `slots` | app/plugin | [Slot](/docs/frontend/slots) |
| Distribuire più estensioni come un'unica unità installabile | `plugins` | app | [Plugin](/docs/plugins) |
| Personalizzare lo stile di ciò che ho appena creato | `@rebasepro/ui` + token del tema | qualsiasi | [Stile della UI personalizzata](/docs/frontend/styling) |

:::tip[Qualsiasi cosa tu scelga, costruiscila usando il kit]
Ogni meccanismo di seguito ti fornisce un componente React senza imporre come
riempirlo. Usa i componenti di `@rebasepro/ui` e i token colore del tema anziché
CSS scritto a mano: una vista personalizzata è pur sempre una vista di amministrazione,
e un colore hardcoded risulterà invisibile in uno dei due temi. Consulta
[Stile della UI personalizzata](/docs/frontend/styling).
:::

## I meccanismi nel dettaglio

### Plugin

**Ambito:** app.

Un plugin raggruppa collezioni iniettate o modificate, viste, contributi a slot, wrapper di campi, provider, hook e callback del ciclo di vita in un'unica unità installabile. Gli override dei componenti, le viste entità, le azioni entità e `propertyConfigs` non sono campi dei plugin: vanno impostati su `<Rebase>` o nel `customizeTable` di una tabella.

→ [Riferimento plugin](/docs/plugins)

### Slot

**Ambito:** app (forniti per slot).

Gli slot sono punti di estensione UI con nome distribuiti in tutta la struttura (chrome) del CMS. Registri un componente React indicando il nome di uno slot ed esso viene renderizzato in quella posizione. Ci sono 27 slot che coprono la home page, la navigazione, le viste delle collezioni, i form, le righe delle entità, i campi del form e l'app bar — e ciascuno di essi viene renderizzato.

→ [Riferimento slot](/docs/frontend/slots)

### Override dei componenti (Swizzling)

**Ambito:** impostazioni predefinite a livello di app o per collezione.

Due modalità: **Eject** (sostituzione completa) o **Wrap** (estensione dell'originale).

19 nomi di componenti sostituibili in due livelli:

**Solo app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Con ambito collezione (12):**
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

**Precedenza:** Le proprietà `components` di una tabella si applicano al di sopra dei valori predefiniti a livello di app per lo stesso nome di componente: una sostituzione a livello di collezione sostituisce entrambi, mentre un override con `wrap: true` a livello di collezione racchiude quello a livello di app. I nomi di componenti disponibili solo a livello di app (`Shell.*`, `HomePage`, `Auth.*`) possono essere sovrascritti solo a livello di `<Rebase>`.

→ [Override dei componenti](/docs/frontend/component-overrides)

### Viste entità

**Ambito:** entità (aggiunge schede).

Viste personalizzate che appaiono come schede (tab) nella pagina di dettaglio dell'entità. Vengono definite per tabella in `customizeTable`, oppure registrate una sola volta su `<Rebase entityViews>` (o `<RebaseCMS entityViews>`) e richiamate tramite la loro `key` nel campo `entityViews` di una tabella.

→ [Viste entità](/docs/frontend/entity-views)

### Azioni entità

**Ambito:** entità.

Pulsanti di azione personalizzati sulle singole entità (pubblica, archivia, clona, ecc.). Definiti per tabella in `customizeTable`, oppure registrati una sola volta su `<Rebase entityActions>` (o `<RebaseCMS entityActions>`) e richiamati tramite `key` nel campo `entityActions` di una tabella.

→ [Azioni entità](/docs/frontend/entity-actions)

### `Actions` di collezione

**Ambito:** collezione.

Componenti React a livello di toolbar che ricevono `CollectionActionsProps` (entità selezionate, table controller, contesto della collezione). Vengono renderizzati nella toolbar della collezione accanto alle azioni integrate.

**Relazione con lo slot `collection.actions`:** Entrambi sono additivi — i componenti `Actions` vengono renderizzati per primi nella toolbar, seguiti dai contributi dello slot `collection.actions`. Non si sostituiscono a vicenda.

→ [Azioni entità — Azioni di collezione](/docs/frontend/entity-actions#collection-actions)

### Modalità di visualizzazione personalizzate {#custom-view-modes}

**Ambito:** collezione (aggiunge una modalità di visualizzazione).

Una mappa, un calendario, una galleria, una timeline: un altro modo di renderizzare *le stesse righe*,
offerto nel selettore delle viste della collezione accanto a Elenco, Tabella, Schede e Kanban (Board).

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

Oppure registra il componente una volta e richiamalo tramite chiave:

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

`Builder` riceve il `tableController` attivo, quindi la vista eredita i filtri
della collezione, la casella di ricerca, l'ordinamento, la paginazione, i controlli dei permessi
e il pannello laterale dell'entità — questo è il motivo principale per dichiararne una invece di
creare una `AppView`:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Le righe sono quelle restituite dal server, nella struttura restituita da `useRows`: date come stringhe ISO,
un belongsTo come colonna della chiave esterna e una relazione caricata dalla vista nidificata
sotto il rispettivo nome. Una riga ha una colonna `id` solo se la sua tabella la possiede; il relativo id si trova
accanto, `tableController.ids[i]` per `tableController.rows[i]`.
`highlightedIds` contiene gli id delle righe che la vista visualizza come selezionate, e
anche `selectionController` opera con id e righe:

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

Selezionare la vista aggiorna `?__view=`, persiste al ricaricamento della pagina e viene memorizzato per ciascun utente.
È sufficiente dichiararne una per renderla disponibile — è necessario impostare `enabledViews` solo quando desideri
*rimuovere le viste integrate*. Con una sola voce, il selettore viene nascosto.

**Questo non è il modo per creare una vista che abbraccia più collezioni.** Una modalità di visualizzazione
è un rendering alternativo della query di una singola collezione. Se il tuo componente ignora
`tableController` ed esegue il fetch di quattro tabelle per conto proprio, dovrebbe essere una
[`AppView`](/docs/frontend#custom-views) — la toolbar sovrastante, con la sua casella di ricerca
e il conteggio dei record, descriverebbe una query che il componente non renderizza affatto.

### `formView`

**Ambito:** collezione.

Sostituisce l'intero form di default dell'entità con un componente personalizzato, impostato con
`formView: { Builder, includeActions }` in `customizeTable`; consulta
[Sostituire il form](/docs/frontend/form-layout/#replacing-the-form).
`includeActions` (predefinito `true`) mantiene i pulsanti Salva e Annulla nella barra.

Usalo quando hai bisogno di un layout completamente personalizzato per la modifica dei record di una tabella.
Per modifiche minori, è preferibile utilizzare l'override di `Entity.Form` in `components`.

Il Builder viene renderizzato all'interno del form del record e riceve il suo `formContext` attivo: scrivi con `formContext.setFieldValue` e il pulsante Salva della barra memorizzerà il record. Nei casi in cui il record non può essere modificato — la vista di dettaglio in sola lettura o un utente privo dei permessi di modifica — `formContext.disabled` è `true` e i tentativi di scrittura generano un errore. Imposta `includeActions: false` se il tuo Builder gestisce il salvataggio autonomamente tramite `formContext.submit()`.

### `additionalFields`

**Ambito:** collezione.

Colonne calcolate mostrate nella tabella della collezione. Non corrispondono a colonne memorizzate nel database: vengono calcolate al momento del rendering.

→ [Colonne aggiuntive](/docs/frontend/additional-columns)

### `propertyConfigs`

**Ambito:** tipo di proprietà.

Tipi di campo riutilizzabili, registrati una sola volta su `<Rebase propertyConfigs>` e richiamati tramite il `propertyConfig` di un campo.

→ [Campi personalizzati](/docs/frontend/custom-fields)

## Non solo pannello di amministrazione

Se ciò che desideri modificare è il comportamento del server anziché ciò che mostra il
pannello, questa non è la pagina giusta. Il server ha la sua scala di opzioni:

| Voglio… | Livello | Riferimento |
|---|---|---|
| Restringere quali righe vengono restituite da una lettura | hook `beforeQuery` | [Estendere il server](/docs/backend/extending#2-table-hooks) |
| Oscurare un valore in uscita | hook `afterRead` | [Hook di tabella](/docs/collections/callbacks) |
| Aggiungere un endpoint personalizzato | funzione personalizzata | [Funzioni personalizzate](/docs/backend/custom-functions) |
| Fare in modo che la ricerca trovi sottostringhe *e* ignori gli accenti | `search.mode: "hybrid"` | [Ricerca](/docs/backend/search) |
| Gestire direttamente il processo del server | server personalizzato, poi `rebase eject` | [Estendere il server](/docs/backend/extending) |

→ [Rebase non fa X](/docs/backend/extending)

## Riepilogo delle precedenze

- **La proprietà `components` di una tabella ha la precedenza sui `components` globali** all'interno della sua collezione. Una sostituzione a livello di collezione sostituisce entrambi; un override con `wrap: true` a livello di collezione racchiude l'override globale, se presente. Consulta [Override dei componenti](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Le `Actions` di collezione e lo slot `collection.actions` sono additivi** — le `Actions` vengono renderizzate per prime, seguite dai contributi dello slot.
- **`entityActions` ed `entityViews` a livello di app costituiscono un registro, non dei valori predefiniti:** una tabella mostra una voce solo quando il proprio `entityActions` / `entityViews` in `customizeTable` ne specifica la `key`.
- **I plugin vengono applicati nell'ordine dell'array `plugins`**, non in base a `key`. I contributi agli slot vengono renderizzati in base al loro `order` (il valore più basso per primo, 50 per impostazione predefinita), e a parità di valore mantengono tale ordine. I wrapper di campo provenienti da più plugin si compongono in quest'ordine, con quello del primo plugin posizionato più all'interno. Consulta [Plugin](/docs/plugins#field-wrappers-from-several-plugins).

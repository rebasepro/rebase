---
sourceHash: d1b243f804318232
title: Plugin-System
sidebar_label: Plugins
description: Erweitern Sie Rebase mit Plugins – binden Sie UI-Komponenten ein, modifizieren Sie Collections, fügen Sie Toolbar-Aktionen hinzu und erstellen Sie benutzerdefinierte Field Builder.
---

## Übersicht

**Plugins sind ein Konzept des Admin-Panels.** Sie laufen im Browser innerhalb des
React-Admins und werden dort registriert, wo Sie diesen erstellen. Nichts auf dieser Seite greift
auf das Backend zu: Ein Plugin kann weder eine Route noch einen Callback oder Cron-Job hinzufügen. Dafür siehe
[Custom Functions](/docs/backend/custom-functions), [Entity
Callbacks](/docs/collections/callbacks) und [Cron Jobs](/docs/backend/cron-jobs).

Plugins sind der primäre Erweiterungsmechanismus im Panel. Sie können:

- Die gesamte App mit einem **Provider** kapseln (Kontext, State Management)
- **Aktionen und Widgets auf der Startseite** hinzufügen
- **Collection-View**-Komponenten einbinden (Toolbar, Spaltenüberschriften)
- **Formular**-Komponenten hinzufügen (Field Builder, zusätzliche Panels)
- Collections dynamisch **injizieren oder modifizieren**

## Plugin-Interface

```typescript
interface RebasePlugin {
    key: string;                    // Unique identifier
    loading?: boolean;              // Hold admin content until the plugin is ready

    // UI contributions — a flat array, each entry naming its slot.
    // This replaced the old per-area objects (homePage, collectionView, form).
    slots?: AnySlotContribution[];

    // HOC providers. `scope: "root"` wraps the whole admin below
    // RebaseContext; `scope: "form"` wraps each entity form / edit view.
    providers?: PluginProvider[];

    // Behavioural (non-UI) hooks: collection modification and injection,
    // column reordering, navigation entries.
    hooks?: PluginHooks;

    // Custom field rendering (e.g. data enhancement).
    fieldBuilder?: FieldBuilderConfig;

    // Views added to the navigation automatically.
    views?: AppView[];

    // onMount, onAuthStateChange, onUnmount — see below.
    lifecycle?: PluginLifecycle;
}
```

Jedes dieser Felder ist optional, mit Ausnahme von `key`. Die vollständige Liste der Slot-Namen finden Sie auf
der Seite **[Slots](/docs/frontend/slots)**.

### Lebenszyklus

- `onMount(context)` wird einmalig ausgeführt, sobald die Authentifizierung bereit ist: Ein Benutzer ist
  angemeldet oder die Anmeldung wurde übersprungen.
- `onAuthStateChange(user)` wird bei jeder späteren Änderung des Benutzers ausgeführt: der neue Benutzer bei
  einer Anmeldung, `null` bei einer Abmeldung. Das Plugin bleibt über beides hinweg gemountet.
- `onUnmount()` wird ausgeführt, wenn `<Rebase>` unmountet.

`lifecycle.onCollectionChange` ist veraltet. Es wurde nie aufgerufen. Ein Plugin, das es setzt, kompiliert weiterhin, und `<Rebase>` warnt einmal pro
Plugin. Um den Zeilen einer Collection zu folgen, abonnieren Sie diese in `onMount` und
beenden Sie das Abonnement in `onUnmount`:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

let stopListening: (() => void) | undefined;

const openOrdersPlugin: RebasePlugin = {
    key: "open_orders",
    lifecycle: {
        onMount: (context) => {
            stopListening = context.data.orders.listen(
                { where: { status: ["==", "open"] } },
                ({ data }) => console.log(`${data.length} open orders`)
            );
        },
        onUnmount: () => stopListening?.()
    }
};
```

## Verwendung von Plugins

Plugins werden `<Rebase>` neben dem Client übergeben. Alles darunter – die
Navigation, die Collection-Views, die Formulare – liest sie von dort:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

export function App() {
    const authController = useRebaseAuthController({ client });
    const dataEnhancementPlugin = useDataEnhancementPlugin();

    return (
        <Rebase
            client={client}
            authController={authController}
            plugins={[dataEnhancementPlugin]}
        >
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Plugins werden normalerweise durch einen Hook erstellt, daher wird das Array bei jedem Rendern neu erzeugt;
das ist völlig in Ordnung und der Grund, warum `plugins` eine Prop ist, anstatt etwas, das Sie
manuell memoizieren müssen. Zwei Plugins mit demselben `key` sind ein Fehler – `<Rebase>`
protokolliert die Duplikate, anstatt eines stillschweigend zu verwerfen.

Für einen einzelnen Beitrag benötigen Sie überhaupt kein Plugin: `<Rebase slots>`
akzeptiert dieselben `SlotContribution`-Einträge direkt.

### Bei manueller Komposition

Nur wenn Sie `<RebaseShell>` durch die darunter liegenden Ebenen ersetzt haben,
muss die Plugin-Liste manuell in den Navigations-Controller weitergereicht werden:

```tsx
const navigationStateController = useBuildNavigationStateController({
    plugins,
    collections: () => collections,
    // These four are required — the controller resolves navigation against them.
    authController,
    data,
    collectionRegistryController,
    urlController
});
```

`<RebaseNavigation>` übernimmt genau diesen Aufruf für Sie und liest `plugins` aus dem
Customization-Controller, den `<Rebase>` bereitstellt. Siehe
[Erweitert: Manuelles Layout](/docs/frontend#advanced-manual-layout).

## Erstellen eines Plugins

Hier ist ein minimales Plugin, das jeder Collection eine Toolbar-Aktion hinzufügt:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

function useMyPlugin(): RebasePlugin {
    return {
        key: "my_plugin",

        // `slots` is a flat array of contributions, each naming its slot.
        // See the Slots page for the full list of slot names.
        slots: [
            { slot: "collection.actions", Component: MyToolbarAction }
        ],

        // `fieldBuilder` is top-level and takes a `wrap` function that returns
        // a *component* (or null to leave the field as it is) — it is not
        // a render function and no longer lives under `form`.
        fieldBuilder: {
            wrap: ({ property }) =>
                property.propertyConfig === "my_custom_field" ? MyCustomField : null
        }
    };
}
```

### Field-Wrapper aus mehreren Plugins

Wrapper aus mehreren Plugins greifen in der Reihenfolge des `plugins`-Arrays ineinander.
Das `wrap` jedes Plugins erhält als `params.Field` das Feld so, wie die Plugins
davor es hinterlassen haben; der Wrapper des ersten Plugins ist also der innerste und der
des letzten der äußerste. Ein Plugin, dessen `wrap` `null` zurückgibt oder dessen `enabled`-Guard
für das Feld `false` zurückgibt, reicht es unverändert weiter. Ein Wrapper, der
`Field` rendert, behält somit jeden Wrapper davor bei:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";
import { Typography } from "@rebasepro/ui";

const descriptionPlugin: RebasePlugin = {
    key: "description_below",
    fieldBuilder: {
        // `Field` is the built-in field, or the earlier plugins' wrapper of it.
        wrap: ({ Field, property }) => property.description
            ? (props) => (
                <>
                    <Field {...props}/>
                    <Typography variant="caption" color="secondary">
                        {property.description}
                    </Typography>
                </>
            )
            : null
    }
};
```

## Integrierte Plugins



### Data Enhancement Plugin

KI-gestützte Feld-Autovervollständigung:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

Es fügt jedem Formular eine Autofill-Aktion und jedem Markdown-Feld einen **Autocomplete**-Slash-Befehl
hinzu, der den Text ab dem Cursor fortsetzt. Beides erscheint
nur dort, wo das Plugin aktiviert ist: Der Dienst meldet sich als verfügbar und
`getConfigForPath` (wenn Sie eines übergeben) lässt die Collection zu. Ein Feld, dessen
`customProps.editorProps.aiController` einen eigenen Controller benennt, verwendet diesen.
Ein anderes Plugin kann Markdown-Feldern auf dieselbe Weise einen Controller zuweisen, und zwar mit
`EditorAIControllerProvider` aus `@rebasepro/cms` in einem Provider mit Form-Scope.

![Data enhancement](/img/data_enhancement.png)

:::caution[Dieses Plugin sendet Daten von Ihrem Rechner weg]
Autofill sendet die Feldwerte der Entity per POST an einen gehosteten Dienst, um einen
Vorschlag zu generieren: ausschließlich die Werte deklarierter Properties, niemals die von schreibgeschützten,
deaktivierten oder ausgeblendeten Properties, solchen mit `dynamicProps` oder Spalten, die die Collection
nicht deklariert. Standardmäßig ist dieser Dienst **`https://app.rebase.pro/api/functions/ai`**,
der von Rebase betrieben wird – kostenlos nutzbar, ohne Konfiguration und ohne Anmeldedaten:
Die Anfragen sind anonym und werden über Rate-Limits statt über Identitäten begrenzt. Ihr
JWT wird nicht gesendet. Die Slash-Autovervollständigung des Editors sendet ebenfalls Text: bis zu 8.000
Zeichen auf jeder Seite des Cursors, niemals das gesamte Dokument.

Ob das akzeptabel ist, hängt vom Inhalt der Felder ab. Richten Sie `endpoint` auf
Ihr eigenes Deployment aus, um die Generierung innerhalb Ihrer Infrastruktur zu halten:

```typescript no-verify
const enhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

Das Übertragungsformat ist der gesamte Vertrag – siehe `api.ts` in `@rebasepro/plugin-ai`,
mit einer Referenzimplementierung in `functions/ai.ts` der Control Plane. Das
Plugin rendert nichts, bis der Host, auf den es verweist, sich unter
`GET /status` als verfügbar meldet. Eine falsche URL führt also lediglich zu einer fehlenden Schaltfläche und nicht zu einer fehlgeschlagenen Anfrage.

Jedes andere integrierte Plugin läuft lokal im Browser und sendet nichts nach außen.
:::

## Collection-Injection

Plugins können dynamisch neue Collections hinzufügen:

```typescript
hooks: {
    // Receives the resolved collections and returns the full list to use.
    injectCollections: (collections) => [...collections, auditLogCollection]
}
```

## Collection-Modifikation

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Plugins können bestehende Collections modifizieren:

```typescript
hooks: {
    // Receives one collection, returns the modified one.
    modifyCollection: (collection) => ({
        ...collection,
        description: `${collection.description ?? ""} Managed by the ops team.`.trim()
    })
}
```

Die Collection, die ein Plugin empfängt, ist die aufgelöste Ansicht einer Tabelle des Panels, nachdem
ihr `customizeTable` angewendet wurde; ein Plugin sieht also das, was das Panel gleich
zeichnen wird.

`modifyCollection` ist synchron, und der Admin wendet es an, wenn er seine
Collections auflöst, nicht jedes Mal, wenn sich das Plugin ändert. Wenn die Änderung Daten
erfordert, die Sie abrufen müssen, rufen Sie diese vor dem Rendern von `<Rebase>` ab und erstellen Sie das Plugin
aus den zurückgegebenen Daten:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import type { RebasePlugin } from "@rebasepro/cms-types";
import { CircularProgressCenter } from "@rebasepro/ui";

export function App() {
    const authController = useRebaseAuthController({ client });
    const [labels, setLabels] = useState<Record<string, string>>();

    useEffect(() => {
        fetch("/collection-labels.json")
            .then((response) => response.json())
            .then(setLabels);
    }, []);

    const labelsPlugin = useMemo<RebasePlugin | undefined>(() => labels && {
        key: "collection_labels",
        hooks: {
            modifyCollection: (collection) => ({
                ...collection,
                name: labels[collection.slug] ?? collection.name
            })
        }
    }, [labels]);

    if (!labelsPlugin) return <CircularProgressCenter/>;

    return (
        <Rebase client={client} authController={authController} plugins={[labelsPlugin]}>
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

`hooks.modifyCollectionAsync` ist veraltet. Es wurde nie aufgerufen. Ein Plugin, das es setzt, kompiliert weiterhin, und `<Rebase>` warnt einmal pro
Plugin. Verwenden Sie `modifyCollection` wie oben beschrieben.

## Nächste Schritte

- **[Studio Tools](/docs/studio)** — SQL-Konsole, JS-Konsole, RLS-Editor
- **[Custom Fields](/docs/frontend/custom-fields)** — Erstellen benutzerdefinierter Formularfelder

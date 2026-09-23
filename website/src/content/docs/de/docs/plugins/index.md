---
sourceHash: eff51262efe91a3e
title: Plugin-System
sidebar_label: Plugins
description: Erweitern Sie Rebase mit Plugins – injizieren Sie UI-Komponenten, modifizieren Sie Collections, fügen Sie Toolbar-Aktionen hinzu und erstellen Sie benutzerdefinierte Field Builder.
---

## Übersicht

**Plugins sind ein Konzept des Admin-Panels.** Sie laufen im Browser, innerhalb des
React-Admins, und werden dort registriert, wo Sie es erstellen. Nichts auf dieser Seite greift
auf das Backend zu: Ein Plugin kann weder eine Route noch einen Callback oder einen Cron hinzufügen. Siehe hierzu
[Custom Functions](/docs/backend/custom-functions), [Entity
Callbacks](/docs/collections/callbacks) und [Cron Jobs](/docs/backend/cron-jobs).

Plugins sind der primäre Erweiterungsmechanismus im Panel. Sie können:

- Die gesamte App mit einem **Provider** kapseln (Kontext, State-Management)
- **Aktionen für die Startseite** und Widgets hinzufügen
- Komponenten für die **Collection-Ansicht** injizieren (Toolbar, Column Builder)
- **Formular**-Komponenten hinzufügen (Field Builder, zusätzliche Panels)
- **Collections dynamisch injizieren oder modifizieren**

## Plugin-Interface

```typescript
interface RebasePlugin {
    key: string;                    // Unique identifier
    loading?: boolean;              // Hold admin content until the plugin is ready

    // UI contributions — a flat array, each entry naming its slot.
    // This replaced the old per-area objects (homePage, collectionView, form).
    slots?: SlotContribution[];

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

Jede dieser Eigenschaften ist optional, außer `key`. Die vollständige Liste der Slot-Namen finden Sie auf
der Seite **[Slots](/docs/frontend/slots)**.

### Lebenszyklus

- `onMount(context)` wird einmal ausgeführt, sobald die Authentifizierung zum
  ersten Mal bereit ist: Ein Benutzer ist angemeldet, oder die Anmeldung wurde
  übersprungen.
- `onAuthStateChange(user)` wird bei jedem späteren Benutzerwechsel ausgeführt:
  mit dem neuen Benutzer bei einer Anmeldung, mit `null` bei einer Abmeldung.
  Das Plugin bleibt dabei in beiden Fällen gemountet.
- `onUnmount()` wird ausgeführt, wenn `<Rebase>` unmountet wird.

## Plugins verwenden

Plugins werden an `<Rebase>` übergeben, neben dem Client. Alles darunter – die
Navigation, die Collection-Ansichten, die Formulare – liest sie von dort:

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
            <RebaseCMS collections={collections}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Plugins werden normalerweise über einen Hook erstellt, sodass das Array bei jedem Render-Vorgang neu aufgebaut wird;
das ist in Ordnung und der Grund dafür, dass `plugins` eine Prop ist und nicht
manuell memoriert werden muss. Zwei Plugins mit demselben `key` sind ein Fehler – `<Rebase>`
protokolliert Duplikate, anstatt sie stillschweigend zu verwerfen.

Für einen einzelnen Beitrag benötigen Sie überhaupt kein Plugin: `<Rebase slots>`
akzeptiert dieselben `SlotContribution`-Einträge direkt.

### Bei manueller Komposition

Nur wenn Sie `<RebaseShell>` durch die darunterliegenden Layer ersetzt haben,
muss die Plugin-Liste manuell an den Navigation-Controller übergeben werden:

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

## Ein Plugin erstellen

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
        // a *component* (or null to leave the default field alone) — it is not
        // a render function and no longer lives under `form`.
        fieldBuilder: {
            wrap: ({ property }) =>
                property.propertyConfig === "my_custom_field" ? MyCustomField : null
        }
    };
}
```

## Integrierte Plugins



### Data Enhancement Plugin

KI-gestützte Feld-Autovervollständigung:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Data enhancement](/img/data_enhancement.png)

:::caution[Dieses Plugin sendet Daten von Ihrem Rechner]
Autofill sendet die Feldwerte der Entität an einen gehosteten Dienst, um einen
Vorschlag zu generieren. Standardmäßig ist dieser Dienst **`https://app.rebase.pro/api/functions/ai`**,
der von Rebase betrieben wird – kostenlos nutzbar, ohne Konfiguration und ohne Anmeldedaten:
Die Anfragen sind anonym und werden durch Ratenbegrenzung statt durch Identität beschränkt. Ihr
JWT wird nicht gesendet.

Ob dies akzeptabel ist, hängt davon ab, was in den Feldern enthalten ist. Richten Sie `endpoint` auf
Ihr eigenes Deployment, um die Generierung innerhalb Ihrer Infrastruktur zu belassen:

```typescript no-verify
const enhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

Das Übertragungsformat ist der gesamte Vertrag – siehe `api.ts` in `@rebasepro/plugin-ai`,
mit einer Referenzimplementierung in `functions/ai.ts` der Control Plane. Das
Plugin rendert nichts, bis der Host, auf den es verweist, sich unter
`GET /status` als verfügbar meldet. Eine falsche URL führt daher eher zu einem fehlenden Button als zu einer fehlgeschlagenen Anfrage.

Jedes andere integrierte Plugin läuft lokal im Browser und sendet keine Daten nach außen.
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

Plugins können bestehende Collections modifizieren:

```typescript
hooks: {
    // Receives one collection, returns the modified one.
    // Use `modifyCollectionAsync` when the change needs a fetch.
    modifyCollection: (collection) => ({
        ...collection,
        properties: {
            ...collection.properties,
            last_modified_by: {
                type: "string",
                name: "Modified By",
                admin: { readOnly: true }
            }
        }
    })
}
```

## Nächste Schritte

- **[Studio-Tools](/docs/studio)** – SQL-Konsole, JS-Konsole, RLS-Editor
- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** – Erstellen benutzerdefinierter Formularfelder

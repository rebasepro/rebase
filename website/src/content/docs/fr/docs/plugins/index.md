---
sourceHash: eff51262efe91a3e
title: Système de plugins
sidebar_label: Plugins
description: Étendez Rebase avec des plugins — injectez des composants d'interface, modifiez des collections, ajoutez des actions de barre d'outils et créez des constructeurs de champs personnalisés.
---

## Vue d'ensemble

**Les plugins sont un concept propre au panneau d'administration.** Ils s'exécutent dans le navigateur, au sein de l'admin React, et sont enregistrés là où vous le construisez. Rien dans cette page ne concerne le backend : un plugin ne peut pas ajouter de route, de callback ou de tâche cron. Pour cela, consultez [Custom Functions](/docs/backend/custom-functions), [Entity Callbacks](/docs/collections/callbacks) et [Cron Jobs](/docs/backend/cron-jobs).

Les plugins constituent le mécanisme d'extension principal du panneau. Ils peuvent :

- Envelopper l'ensemble de l'application avec un **provider** (contexte, gestion d'état)
- Ajouter des **actions sur la page d'accueil** et des widgets
- Injecter des composants de **vue de collection** (barre d'outils, générateurs de colonnes)
- Ajouter des composants de **formulaire** (générateurs de champs, panneaux supplémentaires)
- **Injecter ou modifier des collections** dynamiquement

## Interface des plugins

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

Chacun de ces éléments est optionnel à l'exception de `key`. La liste complète des noms d'emplacements (slots) se trouve sur la page **[Slots](/docs/frontend/slots)**.

### Cycle de vie

- `onMount(context)` s'exécute une fois, lorsque l'authentification est prête pour la première fois : un utilisateur est connecté, ou la connexion a été ignorée.
- `onAuthStateChange(user)` s'exécute à chaque changement d'utilisateur ultérieur : avec le nouvel utilisateur lors d'une connexion, avec `null` lors d'une déconnexion. Le plugin reste monté dans les deux cas.
- `onUnmount()` s'exécute lorsque `<Rebase>` est démonté.

## Utilisation des plugins

Les plugins se placent sur `<Rebase>`, aux côtés du client. Tout ce qui se trouve en dessous — la navigation, les vues de collection, les formulaires — les lit à partir de là :

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

Les plugins sont généralement construits par un hook, de sorte que le tableau est reconstruit à chaque rendu ; cela ne pose aucun problème, et c'est la raison pour laquelle `plugins` est une prop plutôt qu'un élément à mémoïser manuellement. Deux plugins avec la même `key` constituent une erreur — `<Rebase>` journalise les doublons plutôt que d'en ignorer un silencieusement.

Pour une contribution unique, vous n'avez pas du tout besoin d'un plugin : `<Rebase slots>` accepte directement les mêmes entrées `SlotContribution`.

### Dans le cadre d'une composition manuelle

La liste des plugins ne doit être transmise manuellement dans le contrôleur de navigation que si vous avez remplacé `<RebaseShell>` par les couches sous-jacentes :

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

`<RebaseNavigation>` effectue exactement cet appel pour vous, en lisant `plugins` depuis le contrôleur de personnalisation fourni par `<Rebase>`. Consultez [Advanced: manual layout](/docs/frontend#advanced-manual-layout).

## Création d'un plugin

Voici un plugin minimal qui ajoute une action de barre d'outils à chaque collection :

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

## Plugins intégrés



### Plugin d'enrichissement des données (Data Enhancement)

Autocomplétion de champs alimentée par l'IA :

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Data enhancement](/img/data_enhancement.png)

:::caution[Ce plugin envoie des données en dehors de votre machine]
Le remplissage automatique envoie les valeurs des champs de l'entité à un service hébergé afin de générer une suggestion. Par défaut, ce service est **`https://app.rebase.pro/api/functions/ai`**, géré par Rebase — gratuit d'utilisation, sans configuration, et sans identifiant associé : les requêtes sont anonymes, limitées par un quota de débit plutôt que par l'identité. Votre JWT n'est pas envoyé.

L'acceptabilité de ce fonctionnement dépend du contenu des champs. Pointez `endpoint` vers votre propre déploiement pour conserver la génération au sein de votre infrastructure :

```typescript no-verify
const enhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

Le format réseau constitue l'intégralité du contrat — consultez `api.ts` dans `@rebasepro/plugin-ai`, avec une implémentation de référence dans `functions/ai.ts` du plan de contrôle. Le plugin n'affiche rien tant que l'hôte vers lequel il pointe ne se déclare pas disponible sur `GET /status` ; ainsi, une URL erronée se traduit par un bouton manquant plutôt que par une requête en échec.

Tous les autres plugins intégrés s'exécutent localement dans le navigateur et n'envoient rien vers l'extérieur.
:::

## Injection de collections

Les plugins peuvent ajouter dynamiquement de nouvelles collections :

```typescript
hooks: {
    // Receives the resolved collections and returns the full list to use.
    injectCollections: (collections) => [...collections, auditLogCollection]
}
```

## Modification de collections

Les plugins peuvent modifier des collections existantes :

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

## Étapes suivantes

- **[Studio Tools](/docs/studio)** — Console SQL, console JS, éditeur RLS
- **[Custom Fields](/docs/frontend/custom-fields)** — Création de champs de formulaire personnalisés

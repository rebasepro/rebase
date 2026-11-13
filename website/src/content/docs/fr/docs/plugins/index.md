---
sourceHash: d1b243f804318232
title: Système de plugins
sidebar_label: Plugins
description: Étendez Rebase avec des plugins — injectez des composants d'interface utilisateur, modifiez des collections, ajoutez des actions dans la barre d'outils et créez des générateurs de champs personnalisés.
---

## Aperçu

**Les plugins sont un concept propre au panneau d'administration.** Ils s'exécutent dans le navigateur, au sein de l'admin React, et sont enregistrés là où vous le construisez. Rien sur cette page n'atteint le backend : un plugin ne peut pas ajouter de route, de callback ou de cron. Pour cela, consultez [Fonctions personnalisées](/docs/backend/custom-functions), [Callbacks d'entités](/docs/collections/callbacks) et [Tâches Cron](/docs/backend/cron-jobs).

Les plugins constituent le principal mécanisme d'extension du panneau. Ils permettent de :

- Envelopper l'ensemble de l'application avec un **provider** (contexte, gestion d'état)
- Ajouter des **actions sur la page d'accueil** et des widgets
- Injecter des composants de **vue de collection** (barre d'outils, en-têtes de colonnes)
- Ajouter des composants de **formulaire** (générateurs de champs, panneaux supplémentaires)
- **Injecter ou modifier des collections** dynamiquement

## Interface des plugins

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

Chacun de ces éléments est facultatif, à l'exception de `key`. La liste complète des noms de slots se trouve sur la page **[Slots](/docs/frontend/slots)**.

### Cycle de vie

- `onMount(context)` s'exécute une seule fois, lorsque l'authentification devient prête pour la première fois : un utilisateur est connecté ou la connexion a été ignorée.
- `onAuthStateChange(user)` s'exécute à chaque changement ultérieur d'utilisateur : le nouvel utilisateur lors d'une connexion, `null` lors d'une déconnexion. Le plugin reste monté dans les deux cas.
- `onUnmount()` s'exécute lorsque `<Rebase>` est démonté.

`lifecycle.onCollectionChange` est obsolète. Rien ne l'a jamais appelé. Un plugin qui le définit compile toujours, et `<Rebase>` émet un avertissement une fois par plugin. Pour suivre les lignes d'une collection, abonnez-vous depuis `onMount` et désabonnez-vous dans `onUnmount` :

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
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Les plugins sont généralement construits par un hook, de sorte que le tableau est reconstruit à chaque rendu ; cela ne pose aucun problème, et c'est pourquoi `plugins` est une prop plutôt qu'un élément que vous mémorisez manuellement. Deux plugins possédant la même `key` constituent une erreur — `<Rebase>` journalise les doublons plutôt que d'en ignorer un silencieusement.

Pour une contribution unique, vous n'avez pas du tout besoin d'un plugin : `<Rebase slots>` accepte directement les mêmes entrées `SlotContribution`.

### En composition manuelle

La liste des plugins ne doit être transmise manuellement au contrôleur de navigation que si vous avez remplacé `<RebaseShell>` par les couches sous-jacentes :

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

`<RebaseNavigation>` effectue exactement cet appel pour vous, en lisant `plugins` depuis le contrôleur de personnalisation fourni par `<Rebase>`. Consultez [Avancé : mise en page manuelle](/docs/frontend#advanced-manual-layout).

## Créer un plugin

Voici un plugin minimal qui ajoute une action dans la barre d'outils à chaque collection :

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

### Wrappers de champs provenant de plusieurs plugins

Les wrappers issus de plusieurs plugins se composent selon l'ordre du tableau `plugins`. La fonction `wrap` de chaque plugin reçoit, via `params.Field`, le champ tel que les plugins précédents l'ont laissé, de sorte que le wrapper du premier plugin est le plus interne et celui du dernier est le plus externe. Un plugin dont le `wrap` renvoie `null`, ou dont la garde `enabled` renvoie `false` pour le champ, le transmet sans modification. Un wrapper qui effectue le rendu de `Field` conserve donc tous les wrappers qui le précèdent :

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

## Plugins intégrés



### Plugin Data Enhancement

Autocomplétion des champs optimisée par l'IA :

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

Il ajoute une action Autofill à chaque formulaire, ainsi qu'une commande slash **Autocomplete** à chaque champ markdown, qui poursuit le texte à partir du curseur. Les deux n'apparaissent que là où le plugin est activé : le service s'annonce comme disponible et `getConfigForPath` (si vous en fournissez un) autorise la collection. Un champ dont la propriété `customProps.editorProps.aiController` spécifie son propre contrôleur utilise celui-ci. Un autre plugin peut fournir un contrôleur aux champs markdown de la même manière, avec `EditorAIControllerProvider` de `@rebasepro/cms` dans un provider à portée formulaire (`scope: "form"`).

![Amélioration des données](/img/data_enhancement.png)

:::caution[Ce plugin envoie des données en dehors de votre machine]
Autofill transmet les valeurs des champs de l'entité à un service hébergé pour générer une suggestion : uniquement les valeurs des propriétés déclarées, jamais celles d'un champ en lecture seule, désactivé ou masqué, comportant des `dynamicProps`, ou d'une colonne que la collection ne déclare pas. Par défaut, ce service est **`https://app.rebase.pro/api/functions/ai`**, géré par Rebase — gratuit, sans configuration et sans identifiants associés : les requêtes sont anonymes, limitées par quota de fréquence plutôt que par identité. Votre JWT n'est pas envoyé. L'autocomplétion slash de l'éditeur transmet également du texte : jusqu'à 8 000 caractères de part et d'autre du curseur, jamais le document entier.

L'acceptabilité de ce fonctionnement dépend de la nature des données contenues dans ces champs. Pointez `endpoint` vers votre propre déploiement pour conserver la génération au sein de votre infrastructure :

```typescript no-verify
const enhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

Le format réseau (wire format) constitue l'intégralité du contrat — consultez `api.ts` dans `@rebasepro/plugin-ai`, avec une implémentation de référence dans `functions/ai.ts` du plan de contrôle. Le plugin n'affiche rien tant que l'hôte vers lequel il pointe ne s'annonce pas disponible sur `GET /status`, de sorte qu'une URL incorrecte se traduit par un bouton absent plutôt que par une requête en échec.

Tous les autres plugins intégrés sont locaux au navigateur et n'envoient rien nulle part.
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

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les plugins peuvent modifier des collections existantes :

```typescript
hooks: {
    // Receives one collection, returns the modified one.
    modifyCollection: (collection) => ({
        ...collection,
        description: `${collection.description ?? ""} Managed by the ops team.`.trim()
    })
}
```

La collection qu'un plugin reçoit correspond à la vue résolue d'une table par le panneau, après l'application de son `customizeTable`, de sorte qu'un plugin voit ce que le panneau s'apprête à afficher.

`modifyCollection` est synchrone, et l'administration l'applique lorsqu'elle résout ses collections, et non à chaque modification du plugin. Lorsque la modification nécessite des données que vous devez récupérer (fetch), récupérez-les avant d'afficher `<Rebase>` et construisez le plugin à partir du résultat obtenu :

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

`hooks.modifyCollectionAsync` est obsolète. Rien ne l'a jamais appelé. Un plugin qui le définit compile toujours, et `<Rebase>` émet un avertissement une fois par plugin. Utilisez `modifyCollection` comme indiqué ci-dessus.

## Étapes suivantes

- **[Outils Studio](/docs/studio)** — Console SQL, console JS, éditeur RLS
- **[Champs personnalisés](/docs/frontend/custom-fields)** — Création de champs de formulaire personnalisés

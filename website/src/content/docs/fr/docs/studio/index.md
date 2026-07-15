---
title: Outils du Studio
sidebar_label: Studio
description: Rebase Studio fournit des outils de développement pour l'édition visuelle de schémas, les requêtes SQL, le scripting JavaScript, la gestion des politiques RLS et la navigation dans le stockage.
---

## Aperçu

Rebase dispose de deux modes :

- **Mode Contenu** — Pour les éditeurs de contenu et les équipes opérationnelles. Affiche les collections et la gestion des données.
- **Mode Studio** — Pour les développeurs. Débloque les outils destinés aux développeurs.

Basculez entre les modes à l'aide du contrôleur de mode administrateur ou du bouton de basculement de l'interface utilisateur dans la barre d'application.

## Outils Studio intégrés

### Éditeur de collection

Un éditeur de schéma visuel qui vous permet de créer et de modifier des collections via une interface utilisateur glisser-déposer. Lorsque vous enregistrez les modifications, il utilise [ts-morph](https://ts-morph.com/) pour mettre à jour vos fichiers sources TypeScript via la manipulation d'AST — en préservant tout le code existant et la logique personnalisée.

![Éditeur de collection](/img/collection_editor.png)

```tsx
import { RebaseAdmin } from "@rebasepro/admin";

// The Collection Editor is automatically enabled when you provide the 
// collectionEditor configuration to your RebaseAdmin component
<RebaseAdmin
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

### Console SQL

Exécutez des requêtes SQL brutes sur votre base de données PostgreSQL et visualisez les résultats dans un tableau :

```tsx
import { SQLEditor } from "@rebasepro/studio";

{ slug: "sql", name: "SQL Console", view: <SQLEditor /> }
```

### Console JS

Écrivez et exécutez du JavaScript en utilisant le SDK Rebase :

```tsx
import { JSEditor } from "@rebasepro/studio";

{ slug: "js", name: "JS Console", view: <JSEditor /> }
```

### Éditeur de politiques RLS

Visualisez et gérez les politiques de sécurité au niveau des lignes (Row Level Security) pour vos tables PostgreSQL :

```tsx
import { RLSEditor } from "@rebasepro/studio";

{ slug: "rls", name: "RLS Policies", view: <RLSEditor /> }
```

### Navigateur de stockage

Parcourez, téléchargez et gérez les fichiers dans vos backends de stockage :

```tsx
import { StorageView } from "@rebasepro/studio";

{ slug: "storage", name: "Storage", view: <StorageView /> }
```

## Ajout de vues Studio

Les outils Studio sont automatiquement disponibles lorsque vous incluez le composant `RebaseStudio` dans votre application :

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            {/* Custom views are injected and studio mode is managed automatically */}
            <RebaseStudio />
            {/* ... */}
        </Rebase>
    );
}
```

Ces vues apparaissent dans la navigation latérale lorsque le mode Studio est actif.

## Prochaines étapes

- **[Plugins](/docs/plugins)** — Étendez le framework avec des plugins
- **[Collections](/docs/collections)** — Configuration des collections
---

---
sourceHash: 7a38ec538e644612
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
import { RebaseCMS } from "@rebasepro/cms";

// The Collection Editor is automatically enabled when you provide the 
// collectionEditor configuration to your RebaseCMS component
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

### Outils intégrés

Ils sont fournis avec Studio et **chargés à la demande par `RebaseStudio`** — chacun forme un chunk distinct, récupéré à la première ouverture. Ils ne sont pas importables séparément : `@rebasepro/studio` n'exporte délibérément que l'orchestrateur, si bien qu'une console jamais ouverte ne coûte rien.

| Onglet | Slug | Rôle |
|--------|------|------|
| Console SQL | `sql` | Exécuter du SQL brut sur votre base PostgreSQL et lire les résultats dans un tableau |
| Console JS | `js` | Écrire et exécuter du JavaScript via le SDK Rebase |
| Éditeur de politiques RLS | `rls` | Inspecter et gérer les politiques Row Level Security de vos tables |
| Navigateur de stockage | `storage` | Parcourir, téléverser et gérer les fichiers de vos backends de stockage |


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

---
sourceHash: 3e18de6e2b935fc7
title: Firebase
sidebar_label: Firebase
description: "@rebasepro/firebase exécute Rebase CMS avec Firestore, Firebase Auth et Firebase Storage — un adaptateur côté client, sans aucun serveur Rebase impliqué."
---

`@rebasepro/firebase` connecte Rebase CMS à Firebase. Vos
collections décrivent des documents Firestore, et le panneau les lit et les écrit
via le SDK Firebase.

:::caution[Expérimental et structurellement différent du reste de Rebase]
Il s'agit d'un **adaptateur côté client**. Aucun serveur Rebase n'intervient : le
navigateur communique directement avec Firebase, de sorte que tout ce que fournit le backend de Rebase —
la sécurité au niveau des lignes (row-level security), l'API REST, le SDK généré, les fonctions, les crons, le
modèle d'accès au stockage — ne fait pas partie de cette configuration.

L'autorisation repose sur les **Firebase Security Rules**, rédigées et déployées dans Firebase.
Les `securityRules` de Rebase sur une collection ne s'appliquent pas.
:::

## Installation

```bash
pnpm add @rebasepro/firebase firebase
```

Peer dependencies : `firebase` (10, 11 ou 12), `react` ≥ 19, `react-dom` ≥ 19, et
optionnellement `typesense` pour la recherche textuelle.

## Ce que cela vous apporte

- **`RebaseFirebaseApp`** — une application d'administration complète : connexion Firebase Auth, routage
  et opérations CRUD sur Firestore construites à partir des définitions de vos collections.
- **Hooks par service** — auth, Firestore, stockage, App Check, gestion des utilisateurs.
- **Adaptateurs de recherche textuelle** — Algolia, Typesense, Pinecone ou local.

```tsx title="src/App.tsx" no-verify
import { RebaseFirebaseApp } from "@rebasepro/firebase";

export default function App() {
    return <RebaseFirebaseApp
        name="My Project"
        firebaseConfig={firebaseConfig}
        collections={[posts, authors]}
    />;
}
```

Un exemple fonctionnel est disponible dans [`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).

## Ce qui n'est pas transposé

Tout ce qui décrit le **backend** de Rebase sur ce site concerne
la voie PostgreSQL (ou MongoDB), et non celle-ci :

| | |
|---|---|
| Sécurité au niveau des lignes (RLS) | Firebase Security Rules à la place, écrites dans Firebase |
| API REST et SDK généré | Absents — le navigateur utilise le SDK Firebase |
| Fonctions et crons | Cloud Functions for Firebase à la place |
| Modèle d'accès au stockage | Règles Firebase Storage à la place |
| Studio, `rls-check`, migrations | Fonctionnalités Postgres ; non applicables |

## Quand le choisir

Optez pour cette solution si vous disposez déjà d'un projet Firebase et souhaitez une meilleure interface
d'administration par-dessus. Si vous devez choisir un backend plutôt que de vous adapter à un backend
existant, la [voie PostgreSQL](/docs/getting-started/quickstart/) est celle traitée dans le reste de
cette documentation.

## Ressources associées

- [Configuration Frontend](/docs/frontend/) — le panneau dont cela remplace la couche de données
- [Authentification et connexion](/docs/frontend/authentication/) — l'interface de connexion, dans les deux cas
- [Définition des collections](/docs/collections/) — la structure de collection lue par les deux pilotes

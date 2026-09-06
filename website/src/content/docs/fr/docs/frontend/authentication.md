---
sourceHash: 90e2137462c112d2
title: Authentification et connexion
sidebar_label: Authentification et connexion
description: Configurez le contrôleur d'authentification, la vue de connexion et la simulation de rôles dans votre frontend React Rebase.
---

## Vue d'ensemble

Rebase fournit des composants et hooks React prêts à l'emploi pour l'authentification :

- **`useRebaseAuthController`** — Gère l'état d'authentification, les tokens et la persistance de session
- **`LoginView`** — Formulaire de connexion/inscription préfabriqué avec prise en charge OAuth
- **Simulation de rôles** — Testez différents rôles sans vous déconnecter

## Contrôleur d'authentification

Le hook `useRebaseAuthController` est le cœur de l'authentification frontend. Il gère l'utilisateur actuel, les tokens et la session :

```typescript
import { useRebaseAuthController } from "@rebasepro/app";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional — enables Google OAuth
});

// Available properties:
authController.user           // Current user object (or null)
authController.initialLoading // True while checking stored session
authController.signOut()      // Log out
authController.getAuthToken() // Get current JWT for API calls
```

Passez le `authController` au contrôleur de navigation Rebase pour protéger l'intégralité du panneau d'administration derrière l'authentification.

## Vue de connexion

Le composant `LoginView` fournit un formulaire complet de connexion et d'inscription :

```tsx
import { LoginView } from "@rebasepro/app";

if (!authController.user) {
    return (
        <LoginView
            authController={authController}
            googleClientId={GOOGLE_CLIENT_ID}
        />
    );
}
```

La vue de connexion gère :
- Connexion et inscription par e-mail/mot de passe
- Connexion Google, GitHub et LinkedIn (lorsqu'elle est configurée)
- Flux de réinitialisation de mot de passe
- Validation de formulaire et états d'erreur

## Modèle de rôles

Les rôles sont stockés sous forme de colonne de tableau `text[]` directement sur la table `rebase.users`. Vous définissez les rôles disponibles sous forme d'enum dans la définition de votre collection d'utilisateurs :

```typescript title="config/collections/users.ts"
roles: {
    name: "Roles",
    type: "array",
    columnType: "text[]",
    of: {
        name: "Role",
        type: "string",
        enum: {
            admin: "Admin",
            editor: "Editor",
            viewer: "Viewer"
        }
    },
    admin: {
        readOnly: false
    }
}
```

Pour ajouter ou supprimer des options de rôle, mettez à jour la map `enum` dans votre collection d'utilisateurs et régénérez le schéma.

## Simulation de rôles (mode développement)

En mode développeur, vous pouvez simuler différents rôles sans vous déconnecter. C'est utile pour tester les politiques RLS :

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Étapes suivantes

- **[Authentification backend](/docs/backend/authentication)** — JWT, fournisseurs OAuth, configuration SMTP
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — Contrôle d'accès au niveau des lignes par collection
- **[Authentification du SDK client](/docs/sdk/authentication)** — Méthodes d'authentification programmatiques

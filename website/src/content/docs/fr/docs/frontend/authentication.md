---
sourceHash: 90e2137462c112d2
title: Authentification et connexion
sidebar_label: Authentification et connexion
description: Configurez le contrôleur d'authentification, la vue de connexion et la simulation de rôles dans votre frontend React Rebase.
---

## Vue d'ensemble

Rebase fournit des composants React et des hooks prêts à l'emploi pour l'authentification :

- **`useRebaseAuthController`** — Gère l'état d'authentification, les jetons et la persistance de session
- **`LoginView`** — Formulaire de connexion/inscription préconçu avec prise en charge d'OAuth
- **Simulation de rôles** — Testez différents rôles sans vous déconnecter

## Contrôleur d'authentification

Le hook `useRebaseAuthController` est le cœur de l'authentification côté frontend. Il gère l'utilisateur actuel, les jetons et la session :

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

Passez l'`authController` au contrôleur de navigation Rebase pour restreindre l'accès à l'ensemble du panneau d'administration derrière une authentification.

## Vue de connexion

Le composant `LoginView` fournit un formulaire complet de connexion et d'inscription :

```tsx
import { LoginView } from "@rebasepro/app";

function App() {
    if (!authController.user) {
        return (
            <LoginView
                authController={authController}
                googleClientId={GOOGLE_CLIENT_ID}
            />
        );
    }
    return <MyApp />;
}
```

La vue de connexion prend en charge :
- La connexion et l'inscription par e-mail/mot de passe
- La connexion OAuth via Google, GitHub et LinkedIn (lorsqu'elle est configurée)
- Le flux de réinitialisation de mot de passe
- La validation des formulaires et la gestion des états d'erreur

## Modèle de rôles

Les rôles sont stockés directement sous forme d'une colonne de tableau `text[]` dans la table `rebase.users`. Vous définissez les rôles disponibles sous forme d'enum dans la définition de votre collection d'utilisateurs :

```typescript title="config/collections/users.ts" no-verify
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

Pour ajouter ou supprimer des options de rôles, mettez à jour la structure `enum` dans votre collection d'utilisateurs et régénérez le schéma.

## Simulation de rôles (Mode Dev)

En mode développeur, vous pouvez simuler différents rôles sans avoir à vous déconnecter. Cela s'avère particulièrement utile pour tester les politiques RLS :

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Prochaines étapes

- **[Authentification backend](/docs/backend/authentication)** — JWT, fournisseurs OAuth, configuration SMTP
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — Contrôle d'accès au niveau des lignes (row-level) par collection
- **[Authentification du SDK Client](/docs/sdk/authentication)** — Méthodes d'authentification programmatiques

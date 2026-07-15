---
title: Authentification
sidebar_label: Authentification
description: Configure l'authentification JWT, les fournisseurs OAuth (Google, LinkedIn), la gestion des utilisateurs et le contrôle d'accès basé sur les rôles.
---

## Aperçu

Rebase inclut un système d'authentification complet :

- **Jetons JWT** — Flux de jetons d'accès et de rafraîchissement
- **Plugins OAuth** — Architecture enfichable pour Google, LinkedIn, et plus
- **Gestion des utilisateurs** — Inscription, connexion, réinitialisation du mot de passe
- **Accès basé sur les rôles** — Attribuer des rôles aux utilisateurs, vérifier les permissions dans les collections
- **Auto-amorçage** — Le premier utilisateur obtient automatiquement le rôle d'administrateur

## Configuration du Backend

```typescript
import { createGoogleProvider, createLinkedinProvider } from "@rebasepro/server";

await initializeRebaseBackend({
    // ...
    auth: {
        jwtSecret: process.env.JWT_SECRET!,  // Required
        accessExpiresIn: "1h",               // Access token lifetime
        refreshExpiresIn: "30d",             // Refresh token lifetime
        requireAuth: true,                   // Require auth for data API
        allowRegistration: false,            // Allow new signups
        google: process.env.GOOGLE_CLIENT_ID ? {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET
        } : undefined,
        linkedin: process.env.LINKEDIN_CLIENT_ID ? {
            clientId: process.env.LINKEDIN_CLIENT_ID,
            clientSecret: process.env.LINKEDIN_CLIENT_SECRET
        } : undefined,
        email: {
            smtp: {
                host: "smtp.gmail.com",
                port: 587,
                secure: false,
                user: "noreply@example.com",
                pass: "app-password",
                from: "Rebase <noreply@example.com>"
            }
        }
    }
});
```

Les tables d'authentification (`rebase.users`, `rebase.roles`, `rebase.user_roles`, `rebase.refresh_tokens`) sont **auto-créées** au premier démarrage.

### Adaptateurs d'Authentification Personnalisés

Rebase permet le remplacement complet du système d'authentification par défaut via l'interface `AuthAdapter`. Passez un adaptateur personnalisé à la propriété `auth` pour contourner entièrement le mécanisme intégré de JWT et de tables d'utilisateurs (par exemple, pour une intégration avec Firebase Auth, Auth0 ou un fournisseur externe de SSO d'entreprise).

Les tables d'authentification (`rebase.users`, `rebase.roles`, `rebase.user_roles`, `rebase.refresh_tokens`) sont **créées automatiquement** lors du premier démarrage.

## Points d'accès d'Authentification

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Créer un nouveau compte |
| `POST` | `/api/auth/login` | Se connecter avec email/mot de passe |
| `POST` | `/api/auth/refresh` | Actualiser le jeton d'accès |
| `POST` | `/api/auth/<provider-id>` | Point d'accès de connexion dynamique pour tout fournisseur OAuth configuré (par ex. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/logout` | Révoquer le jeton de rafraîchissement |
| `POST` | `/api/auth/forgot-password` | Envoyer un email de réinitialisation de mot de passe |
| `POST` | `/api/auth/reset-password` | Réinitialiser le mot de passe avec un jeton |

## Configuration du Frontend

### Contrôleur d'Authentification

```typescript
import { useRebaseAuthController } from "@rebasepro/app";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional
});

// Propriétés disponibles :
authController.user          // Objet utilisateur actuel (ou null)
authController.initialLoading // Vrai lors de la vérification de la session stockée
authController.signOut()     // Se déconnecter
authController.getAuthToken() // Obtenir le JWT actuel pour les appels d'API
```

### Vue de Connexion

```tsx
import { RebaseLoginView } from "@rebasepro/app";

if (!authController.user) {
    return (
        <RebaseLoginView
            authController={authController}
            googleEnabled={!!GOOGLE_CLIENT_ID}
            googleClientId={GOOGLE_CLIENT_ID}
        />
    );
}
```

## Gestion des Utilisateurs et des Rôles

### Services Backend

Après l'initialisation, l'instance du backend fournit `userService` et `roleService` :

```typescript
const { userService, roleService } = instance;

// Lister tous les utilisateurs
const users = await userService.listUsers();

// Attribuer un rôle
await roleService.assignRole(userId, roleId);
```

### Composants Frontend

Rebase fournit des vues intégrées pour la gestion des utilisateurs et des rôles :

```tsx
import { UsersView, RolesView } from "@rebasepro/app";
import { useBackendUserManagement } from "@rebasepro/app";

const userManagement = useBackendUserManagement({
    client: rebaseClient,
    currentUser: authController.user
});

// Dans vos routes :
<Route path="/users" element={<UsersView userManagement={userManagement} />} />
<Route path="/roles" element={<RolesView userManagement={userManagement} />} />
```

![Interface de gestion des utilisateurs](/img/user_management.png)

## Simulation de Rôle (Mode Dev)

En mode développeur, vous pouvez simuler différents rôles sans vous déconnecter :

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// Lorsque activé, l'interface utilisateur se comporte comme si l'utilisateur actuel avait ce rôle
effectiveRoleController.setEffectiveRole("editor");
```

## Amorçage du Premier Utilisateur

Lorsqu'aucun utilisateur n'existe dans la base de données, la première personne à s'inscrire devient automatiquement un administrateur. Après cela, l'inscription est contrôlée par le paramètre `allowRegistration`.

Cela garantit que vous pouvez toujours amorcer un nouveau déploiement sans avoir à ensemencer manuellement la base de données.

## Prochaines Étapes

- **[Stockage](/docs/storage)** — Configuration du stockage de fichiers
- **[Collections](/docs/collections)** — Permissions par collection
---

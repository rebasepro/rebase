---
sourceHash: 62fa2c4fbfc717e1
title: Authentification et connexion
sidebar_label: Authentification et connexion
description: Configurez le contrôleur d'authentification, la vue de connexion et la simulation de rôle dans votre frontend React Rebase.
---

## Aperçu

Rebase fournit des composants et des hooks React prêts à l'emploi pour l'authentification :

- **`useRebaseAuthController`** — Gère l'état d'authentification, les jetons et la persistance de session
- **`LoginView`** — Formulaire de connexion/inscription prédéfini avec prise en charge OAuth
- **Simulation de rôle** — Testez différents rôles sans vous déconnecter

## Contrôleur d'authentification

Le hook `useRebaseAuthController` est le cœur de l'authentification frontend. Il gère l'utilisateur actuel, les jetons et la session :

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

Passez le `authController` à `<Rebase authController>`. `<RebaseShell>` (ou `<RebaseAuthGate>` dans une mise en page manuelle) le lit à partir de là et restreint l'ensemble du panneau d'administration derrière l'authentification.

## Votre propre fournisseur d'authentification

Si votre application connecte les utilisateurs avec son propre fournisseur (Clerk, Firebase Auth, une session propre), fournissez au client que vous passez à `<Rebase client>` un getter de jeton. Les requêtes HTTP du panneau et son socket en temps réel envoient tous deux ce qu'il retourne, de sorte que les vues de collection en direct s'exécutent sous la même identité d'utilisateur :

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

Le `authController` à ses côtés signale alors l'utilisateur connecté de votre fournisseur (un `AuthController` issu de `@rebasepro/cms-types`) au lieu d'envelopper `client.auth`. Le backend doit également accepter le jeton : consultez [Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters), et [Votre propre fournisseur d'authentification](/docs/sdk/your-own-auth-provider/) pour tous les détails côté client.

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
- Connexion et inscription par e-mail/mot de passe
- Connexion OAuth avec Google, GitHub et LinkedIn (lorsque configuré)
- Flux de réinitialisation de mot de passe
- Validation de formulaire et états d'erreur

## Modèle de rôles

Les rôles sont stockés sous forme de colonne de tableau `text[]` directement dans la table `rebase.users`. Vous définissez les rôles disponibles sous forme d'énumération dans la définition de votre collection d'utilisateurs :

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

Pour ajouter ou supprimer des options de rôles, mettez à jour la map `enum` dans votre collection d'utilisateurs et régénérez le schéma.

Un rôle dans cette liste est un nom auquel vos [règles de sécurité](/docs/collections/security-rules) peuvent correspondre. Ce qu'il peut faire au-delà de ses lignes (gérer les utilisateurs, lire les journaux, modifier le schéma) est déclaré séparément, sous `auth.roles` sur la même collection. `admin` est intégré et possède tous les droits. Consultez [Rôles et portées](/docs/backend/roles-and-scopes).

## Tester les accès : Simuler l'accès

Pour vérifier ce qu'un rôle, un utilisateur ou une clé de service peut lire, un administrateur utilise **Simuler l'accès** (Simulate access), la pastille au-dessus de votre avatar dans le tiroir du panneau d'administration (dans la barre d'application sur un petit écran, ou lorsque le shell n'a pas de tiroir). Choisissez un rôle (avec un identifiant d'utilisateur optionnel, qui n'a pas besoin d'être un compte existant), un utilisateur ou une clé de service active.
Chaque vue de données, ainsi que l'onglet Historique d'un enregistrement, lit alors à travers le serveur sous cette identité, en appliquant les véritables politiques de sécurité au niveau des lignes (RLS) : une grille affiche exactement les lignes qu'elle peut lire, les champs que ses rôles ne peuvent pas lire sont masqués, et la bannière indique le nombre de collections dans lesquelles elle ne voit rien. Le serveur vérifie à chaque requête que vous êtes bien administrateur.

L'accès simulé est en lecture seule. Lorsqu'il est actif, les vues ne proposent aucune création, modification, suppression ou rétablissement d'historique, et le serveur refuse toute écriture portant une simulation avec `403 SIMULATION_READ_ONLY`, afin que rien ne soit enregistré sous l'identité de quelqu'un d'autre. Arrêtez la simulation pour apporter des modifications.

Ce qu'il ne simule pas : le filtre `requireAuth` de l'API de données, qui laisse passer un appelant anonyme simulé afin que vous puissiez voir ce que les politiques des lignes lui accordent (une fonction personnalisée le traite comme n'ayant aucune session, tout comme un véritable appelant anonyme) ; le stockage, dont les fichiers sont lus sous votre propre identité, les téléversements étant désactivés pendant la simulation ; et les mises à jour en direct, qui sont mises en pause jusqu'à ce que vous arrêtiez la simulation.

La même opération par le code, sur le SDK, s'effectue via `client.simulate()`. Elle dérive un client dont les requêtes transmettent la simulation, et seule la session propre d'un administrateur peut l'utiliser :

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.collection("tickets").find();
asCustomer.close();
```

Le client dérivé est typé par la même `Database` que celui dont il provient, et constitue un client à part entière : appelez `close()` lorsque vous avez terminé.

Le sélecteur de rôle effectif n'est pas un testeur de RLS : il modifie uniquement les vues Studio listées par la navigation, n'envoie rien au serveur et n'évalue aucune politique. `useBuildEffectiveRoleController`, qui en construisait un, est obsolète et émet un avertissement unique lorsqu'il est appelé : `<Rebase>` construit son propre contrôleur lorsqu'aucun n'est transmis, et Simuler l'accès est la méthode recommandée pour tester ce qu'un rôle peut faire.

## Prochaines étapes

- **[Authentification backend](/docs/backend/authentication)** — JWT, fournisseurs OAuth, configuration SMTP
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — Contrôle d'accès au niveau des lignes par collection
- **[Authentification avec le SDK typé](/docs/sdk/authentication)** — Méthodes d'authentification programmatiques

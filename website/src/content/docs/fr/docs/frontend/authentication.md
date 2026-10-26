---
sourceHash: fe474014627c7510
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

Passez l'`authController` à `<Rebase authController>`. `<RebaseShell>` (ou `<RebaseAuthGate>` dans une mise en page manuelle) l'y lit et restreint l'accès à l'ensemble du panneau d'administration derrière une authentification.

## Votre propre fournisseur d'authentification

En 0.24, le
getter n'authentifie que les requêtes HTTP, et le socket temps réel du panneau reste
anonyme.

Si votre application connecte les utilisateurs avec son propre fournisseur (Clerk, Firebase Auth, une
session qui lui est propre), donnez un getter de jeton au client que vous passez à `<Rebase client>`.
Les requêtes HTTP du panneau et son socket temps réel envoient tous deux ce qu'il
renvoie, de sorte que les vues de collection en direct s'exécutent sous le même utilisateur :

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

L'`authController` qui l'accompagne rapporte alors l'utilisateur connecté de votre fournisseur
(un `AuthController` de `@rebasepro/cms-types`) au lieu d'envelopper
`client.auth`. Le backend doit lui aussi accepter le jeton : voir
[Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters), et
[Utiliser votre propre fournisseur d'authentification](/docs/sdk/authentication#using-your-own-auth-provider)
pour le côté client en détail.

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

Un rôle de cette liste est un nom que vos [règles de sécurité](/docs/collections/security-rules) peuvent cibler. Ce qu'il peut faire au-delà de ses lignes (gérer les utilisateurs, lire les journaux, modifier le schéma) se déclare à part, sous `auth.roles` dans la même collection. `admin` est intégré et détient tout. Voir [Rôles et portées](/docs/backend/roles-and-scopes).

## Tester l'accès : Simulate access

Pour vérifier ce qu'un rôle, un utilisateur ou une clé de service peut lire, un administrateur utilise
**Simulate access**, la pastille située au-dessus de votre avatar dans le tiroir du panneau d'administration (dans
la barre d'application sur un petit écran, ou lorsque le shell n'a pas de tiroir). Choisissez un rôle
(avec un identifiant d'utilisateur facultatif, qui n'a pas besoin d'être un compte), un utilisateur, ou une
clé de service active.
Chaque vue de données, ainsi que l'onglet History d'un enregistrement, lit alors via le serveur en tant que
cette identité, par rapport aux véritables politiques de sécurité au niveau des lignes : une grille affiche
exactement les lignes qu'elle peut lire,
les champs que ses rôles ne peuvent pas lire sont masqués, et la bannière compte les collections
dans lesquelles elle ne voit rien. Le serveur vérifie à chaque requête que vous êtes
administrateur.

L'accès simulé est en lecture seule. Tant qu'il est actif, les vues n'offrent ni création, ni modification,
ni suppression, ni restauration de l'historique, et le serveur refuse toute écriture qui porte une simulation avec
`403 SIMULATION_READ_ONLY`, si bien que rien n'est enregistré au nom de quelqu'un d'autre. Arrêtez la simulation
pour effectuer des modifications.

Ce qu'elle ne simule pas : la barrière `requireAuth` de l'API de données, qui laisse passer un appelant
anonyme simulé afin que vous voyiez ce que les politiques des lignes lui accordent
(une fonction personnalisée le voit comme sans session, comme un véritable appelant anonyme) ;
le stockage, dont les fichiers sont lus sous votre identité, les téléversements étant désactivés pendant la simulation ; et
les mises à jour en direct, qui se mettent en pause jusqu'à l'arrêt de la simulation.

La même chose depuis le code, sur le SDK, est `client.simulate()`. Il dérive un
client dont les requêtes portent la simulation, et seule la session d'un administrateur
peut l'utiliser :

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.collection("tickets").find();
asCustomer.close();
```

Le client dérivé est typé par le même `Database` que celui dont il provient, et
est un client à part entière : faites-lui un `close()` lorsque vous avez terminé.

Le commutateur de rôle effectif n'est pas un testeur de RLS : il ne change que les vues Studio
que la navigation liste, n'envoie rien au serveur et n'évalue aucune
politique. `useBuildEffectiveRoleController`, qui en construisait un, est déprécié et
avertit une fois lorsqu'il est appelé : `<Rebase>` construit son propre contrôleur quand aucun n'est
passé, et Simulate access est le moyen de tester ce qu'un rôle peut faire.

## Prochaines étapes

- **[Authentification backend](/docs/backend/authentication)** — JWT, fournisseurs OAuth, configuration SMTP
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — Contrôle d'accès au niveau des lignes (row-level) par collection
- **[Authentification du SDK typé](/docs/sdk/authentication)** — Méthodes d'authentification programmatiques

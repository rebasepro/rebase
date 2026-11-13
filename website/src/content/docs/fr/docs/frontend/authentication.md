---
sourceHash: 9c7b1e0ee0076030
title: Authentification et connexion
sidebar_label: Authentification et connexion
description: Configurez le contrôleur d'authentification, la vue de connexion et la simulation de rôles dans votre frontend React Rebase.
---

## Présentation

Rebase fournit des composants et des hooks React prêts à l'emploi pour l'authentification :

- **`useRebaseAuthController`** — Gère l'état d'authentification, les jetons et la persistance de session
- **`LoginView`** — Formulaire de connexion/inscription préconçu avec prise en charge OAuth
- **Simulation de rôles** — Testez différents rôles sans vous déconnecter

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

Passez le `authController` à `<Rebase authController>`. `<RebaseShell>` (ou `<RebaseAuthGate>` dans une disposition manuelle) le lit à partir de là et verrouille l'ensemble du panneau d'administration derrière l'authentification.

## Votre propre fournisseur d'authentification

Si votre application connecte les utilisateurs avec son propre fournisseur (Clerk, Firebase Auth, une session qui lui est propre), fournissez au client que vous passez à `<Rebase client>` un récupérateur de jeton (*token getter*). Les requêtes HTTP du panneau ainsi que son socket en temps réel envoient tous deux ce qu'il renvoie, afin que les vues en direct s'exécutent sous la même identité utilisateur :

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

Le `authController` à ses côtés signale alors l'utilisateur connecté de votre fournisseur (un `AuthController` issu de `@rebasepro/cms-types`) au lieu d'envelopper `client.auth`. Le backend doit également accepter le jeton : consultez [Custom auth adapters](/docs/backend/auth-adapters), ainsi que [Your Own Auth Provider](/docs/sdk/your-own-auth-provider/) pour le côté client complet.

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

La vue de connexion gère :
- La connexion et l'inscription par e-mail/mot de passe
- La connexion OAuth via Google, GitHub et LinkedIn (lorsqu'elle est configurée)
- Le flux de réinitialisation de mot de passe
- La validation du formulaire et les états d'erreur

## Modèle de rôles

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les rôles sont stockés sous forme de colonne de type tableau `text[]` dans la table des utilisateurs. Vous définissez les rôles qu'un utilisateur peut détenir sous forme d'ensemble fermé sur cette colonne, dans la table déclarée avec [`defineAuthTable`](/docs/schema/auth-table/) :

```typescript title="backend/schema/users.ts"
roles: col.text({ enum: ["admin", "editor", "viewer"] }).array(),
```

Pour ajouter ou supprimer un rôle, modifiez cette liste. Les libellés que le panneau affiche pour chaque valeur relèvent du frontend : `enumLabels` sur le champ dans `frontend/src/cms/users.tsx` (voir [Personnaliser une table](/docs/frontend/customize-table/)).

Un rôle dans cette liste est un nom auquel vos [règles de sécurité](/docs/collections/security-rules) peuvent correspondre. Ce qu'il peut faire au-delà de ses lignes (gérer les utilisateurs, lire les journaux, modifier le schéma) est déclaré séparément, sous `auth.roles` dans cette même table. `admin` est intégré par défaut et dispose de tous les droits. Voir [Rôles et portées](/docs/backend/roles-and-scopes).

## Tester les accès : Simuler l'accès

Pour vérifier ce qu'un rôle, un utilisateur ou une clé de service peut lire, un administrateur utilise **Simuler l'accès** (*Simulate access*), la pastille située au-dessus de votre avatar dans le tiroir du panneau d'administration (dans la barre d'application sur un petit écran, ou lorsque le shell ne comporte pas de tiroir). Choisissez un rôle (avec un identifiant utilisateur optionnel, qui n'a pas besoin d'être un compte réel), un utilisateur ou une clé de service active.
Chaque vue de données, ainsi que l'onglet Historique d'un enregistrement, lit alors les données à travers le serveur sous cette identité, en appliquant les véritables politiques de sécurité au niveau des lignes (*RLS*) : une grille affiche exactement les lignes qu'elle peut lire, les champs que ses rôles ne peuvent pas lire sont masqués, et la bannière compte les tables dans lesquelles elle ne voit rien. Le serveur vérifie à chaque requête que vous êtes bien administrateur.

L'accès simulé est en lecture seule. Lorsqu'il est actif, les vues ne proposent aucune action de création, de modification, de suppression ou de restauration d'historique, et le serveur refuse toute écriture associée à une simulation avec `403 SIMULATION_READ_ONLY`, afin que rien ne soit enregistré sous l'identité de quelqu'un d'autre. Quittez le mode de simulation pour apporter des modifications.

Ce que la fonctionnalité ne simule pas : le contrôle `requireAuth` de l'API de données, qui laisse passer un appelant anonyme simulé pour que vous puissiez voir ce que les politiques des lignes lui accordent (une fonction personnalisée le verra comme dépourvu de session, tout comme un véritable appelant anonyme) ; le stockage, dont les fichiers sont lus sous votre identité, les téléversements étant désactivés pendant la simulation ; et les mises à jour en direct, qui se mettent en pause jusqu'à ce que vous quittiez la simulation.

La même opération par le code, via le SDK, s'effectue avec `client.simulate()`. Elle dérive un client dont les requêtes intègrent la simulation, et seule la session d'un administrateur peut l'utiliser :

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.table("tickets").find();
asCustomer.close();
```

Le client dérivé est typé par la même `Database` que celle d'origine, et fonctionne comme un client autonome : fermez-le avec `close()` lorsque vous avez terminé.

Le sélecteur de rôle effectif n'est pas un outil de test de RLS : il modifie uniquement les vues Studio affichées dans la navigation, n'envoie rien au serveur et n'évalue aucune politique. `useBuildEffectiveRoleController`, qui permettait d'en créer un, est déprécié et émet un avertissement lorsqu'il est appelé : `<Rebase>` construit son propre contrôleur lorsqu'aucun n'est fourni, et Simuler l'accès est la méthode recommandée pour tester ce qu'un rôle peut faire.

## Prochaines étapes

- **[Authentification backend](/docs/backend/authentication)** — JWT, fournisseurs OAuth, configuration SMTP
- **[Sécurité au niveau des lignes](/docs/collections/security-rules)** — Contrôle d'accès au niveau des lignes par table
- **[Authentification avec le SDK typé](/docs/sdk/authentication)** — Méthodes d'authentification par programmation

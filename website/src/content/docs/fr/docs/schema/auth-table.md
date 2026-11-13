---
sourceHash: c7bebbe33f0a0611
title: La table des utilisateurs
sidebar_label: Table des utilisateurs
description: "defineAuthTable déclare la table dans laquelle l'authentification stocke les utilisateurs : les colonnes nécessaires à l'authentification, une politique d'auto-lecture, des colonnes de privilèges réservées aux administrateurs, et le modèle d'accès — rôles, scopes applicatifs, clés personnelles et hooks de cycle de vie des utilisateurs."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`defineAuthTable` déclare la table que l'authentification lit et écrit. Il
s'agit d'un `defineTable` auquel s'ajoutent trois éléments :

- **Les colonnes nécessaires à l'authentification** sont ajoutées lorsque la table ne les déclare pas :
  l'e-mail, le hachage du mot de passe, la colonne `roles`, l'état de vérification et
  les autres champs utilisés par la connexion.
- **Les politiques sur lesquelles repose l'authentification** sont ajoutées quelle que soit la configuration de `rls` : un utilisateur connecté
  lit sa propre ligne, et seul un administrateur peut modifier les colonnes de privilèges, de sorte que personne
  ne peut s'attribuer un rôle.
- **Un bloc `auth`** déclare le modèle d'accès et les hooks exécutés lorsqu'un
  administrateur crée un utilisateur ou réinitialise un mot de passe.

```ts
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        email:       col.text().notNull().unique(),
        displayName: col.text(),
        roles:       col.text({ enum: ["admin", "editor", "support"] }).array(),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    rls: [
        // Editors may list users; everyone reads their own row through the injected policy.
        { operation: "select", roles: ["editor"] },
    ],
    auth: {
        roles: {
            support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] },
        },
        personalKeys: true,
    },
});
```

Un projet comporte au maximum une table des utilisateurs. Un second `defineAuthTable` est refusé
lors de la compilation du schéma ; utilisez plutôt un `defineTable`.

`rls` est obligatoire ici comme pour chaque table. L'auto-lecture injectée et la restriction
d'écriture réservée aux administrateurs s'ajoutent à vos règles, de sorte que `"admin-only"` constitue une posture valide :
les administrateurs gèrent les utilisateurs, et chaque utilisateur peut toujours lire sa propre ligne.

## Les colonnes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Déclarez les colonnes que votre application lit ou présente, avec les modificateurs de votre choix ;
l'authentification ajoute celles dont elle a besoin et que vous avez omises. Une colonne déclarée portant la clé
ou le nom SQL d'une colonne d'authentification (`email`, `displayName`, `roles`, `passwordHash`,
`emailVerified`, `createdAt`, …) correspond à cette colonne.

Les secrets du serveur ne quittent jamais le serveur : le hachage du mot de passe et le
jeton de vérification sont privés, quelle que soit la déclaration, de sorte qu'une lecture ne les
renvoie jamais et qu'une écriture client ne peut pas les définir.

Un utilisateur détient un rôle lorsque sa colonne `roles` le liste. Déclarer la colonne comme
`col.text({ enum: [...] }).array()` la limite aux rôles que vous nommez ; la laisser
omise la laisse ouverte, puisqu'un rôle existe dès qu'il est attribué à un utilisateur.

Les règles sur les autres tables peuvent désigner les colonnes de la table des utilisateurs comme d'habitude. Une règle sur
la table des utilisateurs elle-même peut également désigner chaque colonne d'authentification, déclarée ou non.

## Le bloc `auth`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Clé | Description |
|---|---|
| `roles` | Les rôles qu'un utilisateur peut détenir, chacun avec un `name`, une `description` facultative et les `scopes` applicatifs et d'administration qu'il accorde. `admin` est intégré par défaut et ne peut pas être déclaré. |
| `scopes` | Les scopes propres à l'application, sous la forme `resource:action`, chacun avec un `label`, une `description` facultative et une `target` facultative. |
| `personalKeys` | `true` permet à chaque utilisateur de créer des [clés d'API personnelles](/docs/backend/api-keys/#personal-keys). |
| `onCreateUser` | S'exécute lorsqu'un administrateur crée un utilisateur via l'API : renvoie les valeurs à stocker et, éventuellement, un mot de passe temporaire à afficher à l'administrateur. |
| `onResetPassword` | S'exécute lorsqu'un administrateur réinitialise le mot de passe d'un utilisateur : renvoie un mot de passe temporaire, ou envoie votre propre lien de réinitialisation. |

`roles`, `scopes` et `personalKeys` sont fournis avec le descripteur de la table.
Les deux hooks restent sur le serveur ; le descripteur indique uniquement lesquels existent. La page [Rôles et scopes](/docs/backend/roles-and-scopes/)
détaille ce que chaque scope accorde et la façon dont les clés et jetons peuvent les restreindre.

### `onCreateUser` et `onResetPassword`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```ts
import { randomBytes } from "node:crypto";
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const members = defineAuthTable("members", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        onCreateUser: async (values, ctx) => {
            const temporaryPassword = randomBytes(12).toString("base64url");
            return {
                values: { ...values, passwordHash: await ctx.hashPassword(temporaryPassword), emailVerified: true },
                temporaryPassword,
            };
        },
        onResetPassword: async (_userId, ctx) => {
            if (ctx.emailConfigured && ctx.sendEmail) {
                // Send your own reset link here and return no temporary password.
                return { invitationSent: true };
            }
            return { temporaryPassword: randomBytes(12).toString("base64url"), invitationSent: false };
        },
    },
});
```

Un `temporaryPassword` renvoyé par `onResetPassword` devient le mot de passe du
compte : Rebase le hache, l'enregistre, déconnecte l'utilisateur de toutes ses sessions et
l'affiche à l'administrateur pour qu'il le transmette. N'en renvoyez aucun lorsque le hook envoie son propre
lien de réinitialisation ; le mot de passe reste alors inchangé jusqu'à ce que l'utilisateur en définisse un nouveau, et ses
sessions sont tout de même fermées.

Les deux hooks reçoivent un contexte contenant :

- `hashPassword(password)` : hache avec l'algorithme configuré ;
- `sendEmail(options)` : envoie un e-mail, présent uniquement lorsque l'e-mail est configuré.
  La promesse se résout avec le retour du fournisseur (`messageId`, `accepted`,
  `rejected`) ;
- `emailConfigured`, `appName` et `resetPasswordUrl`.

## Ce qui ne s'exécute pas lors des écritures d'authentification

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

L'inscription, la connexion OAuth et la gestion des utilisateurs par un administrateur écrivent
directement dans la table des utilisateurs. Les [hooks](/docs/collections/callbacks/) de la table ne s'exécutent pas pour ces
écritures ; un e-mail de bienvenue dans `afterSave` ne sera donc jamais déclenché lors de l'inscription. Placez-le plutôt dans les
hooks de cycle de vie de l'authentification (`beforeUserCreate`, `afterUserCreate`, `afterUserDelete`,
…) configurés sur le backend. Consultez [Authentification](/docs/backend/authentication/).

## Prochaines étapes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [Authentification](/docs/backend/authentication/) : méthodes de connexion, jetons et hooks d'authentification
- [Rôles et scopes](/docs/backend/roles-and-scopes/) : déclaration des rôles et des scopes applicatifs
- [Sécurité au niveau des lignes (RLS)](/docs/collections/security-rules/) : les politiques complémentaires à celles injectées

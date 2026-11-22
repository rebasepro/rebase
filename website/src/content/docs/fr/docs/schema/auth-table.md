---
sourceHash: e934bb43a5bf4916
title: La table des utilisateurs
sidebar_label: Table des utilisateurs
description: "defineAuthTable déclare la table dans laquelle l'authentification stocke les utilisateurs : les colonnes nécessaires à l'authentification, une stratégie d'auto-lecture, des colonnes de privilèges réservées aux administrateurs, ainsi que le modèle d'accès — rôles, scopes applicatifs, clés personnelles et hooks de cycle de vie des utilisateurs."
---

`defineAuthTable` déclare la table que l'authentification lit et écrit. C'est
un `defineTable` auquel s'ajoutent trois éléments :

- **Les colonnes nécessaires à l'authentification** sont ajoutées lorsque la table ne les déclare pas :
  l'e-mail, le hachage du mot de passe, la colonne `roles`, l'état de vérification et
  les autres champs utilisés pour la connexion.
- **Les stratégies sur lesquelles repose l'authentification** sont ajoutées quelle que soit la configuration de `rls` :
  un utilisateur connecté lit sa propre ligne, et seul un administrateur écrit dans les colonnes de privilèges,
  empêchant ainsi quiconque de s'octroyer un rôle.
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

Un projet ne possède au maximum qu'une seule table d'utilisateurs. Un second `defineAuthTable` est refusé
lors de la compilation du schéma ; utilisez plutôt un `defineTable`.

`rls` est requis ici comme pour chaque table. L'auto-lecture injectée et la restriction
d'écriture administrateur s'ajoutent à vos règles, faisant d'`"admin-only"` une configuration valide :
les administrateurs gèrent les utilisateurs, et chaque utilisateur lit toujours sa propre ligne.

## Les colonnes

Déclarez les colonnes que votre application lit ou présente, avec les modificateurs souhaités ;
l'authentification ajoute celles dont elle a besoin et que vous avez omises. Une colonne déclarée portant
la clé ou le nom SQL d'une colonne d'authentification (`email`, `displayName`, `roles`, `passwordHash`,
`emailVerified`, `createdAt`, …) correspond à cette colonne.

Les secrets du serveur ne quittent jamais le serveur : le hachage du mot de passe et le
jeton de vérification sont privés, quelle que soit la déclaration, de sorte qu'une lecture ne
les renvoie jamais et qu'une écriture client ne peut pas les définir.

Un utilisateur possède un rôle lorsque sa colonne `roles` le mentionne. Déclarer la colonne sous la forme
`col.text({ enum: [...] }).array()` la restreint aux rôles que vous nommez ; l'omettre
la laisse ouverte, puisqu'un rôle existe dès qu'il est attribué à un utilisateur.

Les règles définies sur d'autres tables peuvent faire référence aux colonnes de la table des utilisateurs comme d'habitude. Une règle sur
la table des utilisateurs elle-même peut également cibler chaque colonne d'authentification, déclarée ou non.

## Sans table d'utilisateurs

<span class="since-badge" data-since="0.35">Depuis 0.35</span>

En déclarer une est facultatif. L'authentification fonctionne dans les deux cas : sans `defineAuthTable`,
elle conserve ses utilisateurs dans `rebase.users`, et les comptes ainsi que les rôles sont gérés dans la section
**Users & Roles** du Studio. L'interface d'administration n'affiche les Utilisateurs sous forme de table que si
le projet en déclare une ; ne pas inclure le fichier permet donc de ne pas l'afficher dans l'administration.

Pour la déclarer, partez du fichier `backend/schema/users.ts` de l'échafaudage de départ, ou exécutez
`rebase schema introspect --users` sur une base de données contenant déjà `rebase.users`.
Les deux options correspondent à la table créée par l'authentification (une clé `text` et chaque
colonne d'authentification), de sorte que `db push` n'y modifie rien, et qu'une migration issue de
`db generate` la crée avec `IF NOT EXISTS`. Ajoutez ensuite vos propres colonnes.

## Le bloc `auth`

| Clé | Ce qu'elle fait |
|---|---|
| `roles` | Les rôles qu'un utilisateur peut détenir, chacun avec un `name`, une `description` facultative et les `scopes` accordés pour l'administration et l'application. `admin` est intégré nativement et ne peut pas être déclaré. |
| `scopes` | Les scopes propres à l'application, sous la forme `resource:action`, chacun avec un `label`, une `description` facultative et une cible `target` facultative. |
| `personalKeys` | `true` permet à chaque utilisateur de créer des [clés API personnelles](/docs/backend/api-keys/#personal-keys). |
| `onCreateUser` | S'exécute lorsqu'un administrateur crée un utilisateur via l'API : renvoie les valeurs à enregistrer et, facultativement, un mot de passe temporaire à afficher à l'administrateur. |
| `onResetPassword` | S'exécute lorsqu'un administrateur réinitialise le mot de passe d'un utilisateur : renvoie un mot de passe temporaire ou envoie votre propre lien de réinitialisation. |

`roles`, `scopes` et `personalKeys` sont fournis avec le descripteur de la table.
Les deux hooks restent sur le serveur ; le descripteur indique uniquement lesquels existent. La documentation [Rôles et scopes](/docs/backend/roles-and-scopes/)
détaille ce que chaque scope accorde et comment les clés et les jetons le restreignent.

### `onCreateUser` et `onResetPassword`

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

Un `temporaryPassword` renvoyé par `onResetPassword` devient le mot de passe
du compte : Rebase le hache, l'enregistre, déconnecte l'utilisateur de l'ensemble de ses sessions et
l'affiche à l'administrateur pour qu'il puisse le transmettre. N'en renvoyez aucun si le hook envoie son
propre lien de réinitialisation ; le mot de passe reste alors inchangé jusqu'à ce que l'utilisateur en définisse un nouveau,
et ses sessions prennent tout de même fin.

Les deux hooks reçoivent un contexte contenant :

- `hashPassword(password)` : hache selon l'algorithme configuré ;
- `sendEmail(options)` : envoie un e-mail, présent uniquement lorsque l'e-mail est configuré.
  La promesse est résolue avec les informations retournées par le fournisseur (`messageId`, `accepted`,
  `rejected`) ;
- `emailConfigured`, `appName` et `resetPasswordUrl`.

## Ce qui ne s'exécute pas lors des écritures d'authentification

L'inscription, la connexion OAuth et la gestion des utilisateurs par un administrateur écrivent
directement dans la table des utilisateurs. Les [hooks](/docs/collections/callbacks/) de la table ne s'exécutent pas pour ces
écritures ; ainsi, un e-mail de bienvenue dans `afterSave` ne se déclenchera jamais lors d'une inscription.
Placez-le plutôt dans les hooks de cycle de vie de l'authentification (`beforeUserCreate`, `afterUserCreate`, `afterUserDelete`,
…) configurés côté backend. Consultez [Authentification](/docs/backend/authentication/).

## Prochaines étapes

- [Authentification](/docs/backend/authentication/) : méthodes de connexion, jetons et hooks d'authentification
- [Rôles et scopes](/docs/backend/roles-and-scopes/) : déclaration des rôles et des scopes applicatifs
- [Sécurité au niveau des lignes (RLS)](/docs/collections/security-rules/) : les stratégies appliquées aux côtés de celles injectées

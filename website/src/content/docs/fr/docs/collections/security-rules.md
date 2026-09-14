---
sourceHash: 22cf5bf2953fb715
title: Règles de sécurité (RLS)
sidebar_label: Règles de sécurité
description: Définissez des stratégies de sécurité au niveau des lignes (RLS) pour vos collections à l'aide de raccourcis pratiques ou d'expressions SQL brutes.
---

## Vue d'ensemble

Les règles de sécurité vous permettent de définir des stratégies de **sécurité au niveau des lignes (Row Level Security - RLS)** pour vos tables PostgreSQL directement dans vos définitions de collections. Lorsque le schéma Drizzle est généré, Rebase crée les instructions `CREATE POLICY` correspondantes.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "authorId" }
    ]
});
```

## Fonctionnement

1. Vous définissez des `securityRules` sur une collection
2. `rebase schema generate` crée le schéma Drizzle avec le RLS activé
3. `rebase db push` ou `rebase db migrate` applique les stratégies à PostgreSQL
4. Chaque requête est filtrée automatiquement selon le contexte de l'utilisateur actuel

L'identité de l'utilisateur authentifié est accessible en SQL via :

| Fonction | Retourne |
|----------|----------|
| `rebase.uid()` | L'ID de l'utilisateur actuel |
| `rebase.roles()` | Les ID de rôles de l'application séparés par des virgules |
| `rebase.jwt()` | L'ensemble des revendications (claims) JWT sous forme de JSONB |

Ces valeurs sont définies automatiquement par transaction par le backend Rebase.

## Raccourcis pratiques

### Accès basé sur le propriétaire

Le modèle le plus simple — les utilisateurs ne peuvent accéder qu'aux lignes dont ils sont propriétaires :

```typescript
securityRules: [
    { operation: "all", ownerField: "user_id" }
]
```

Cela génère : `USING (user_id = rebase.uid())`

### Accès public

Permettre à quiconque (y compris les utilisateurs non authentifiés) de lire :

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

Cela génère : `USING (true)`

### Accès authentifié

Autoriser tout utilisateur connecté. Il s'agit d'une `condition` plutôt que d'un raccourci d'`access` — `access` n'a qu'une seule valeur possible, `"public"` — car "connecté" est un test appliqué à l'appelant, et c'est dans le builder que résident les tests concernant l'appelant :

```typescript
import { policy } from "@rebasepro/types";

securityRules: [
    { operation: "select", condition: policy.authenticated() }
]
```

`policy.authenticated()` est également vrai pour une *connexion* anonyme, qui crée une véritable ligne d'utilisateur et une véritable session. Utilisez `policy.registered()` lorsqu'un invité ne doit pas être admissible — rédiger un avis, rejoindre une organisation, effectuer un paiement.

### Accès basé sur les rôles

Restreindre les opérations à des rôles spécifiques :

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

### Accès par appartenance / relationnel

Pour restreindre l'accès en fonction de l'appartenance à une collection *associée* — par exemple, "uniquement les lignes dont l'appelant fait partie de l'équipe" — utilisez la `condition` structurée avec `policy.existsIn`. Elle est compilée en une sous-requête `EXISTS` corrélée unique (sans recherche par ligne) et constitue l'alternative sécurisée et native à l'écriture manuelle du SQL brut présenté plus bas.

```typescript
import { policy } from "@rebasepro/types";

// documents visible only to members of the document's team:
securityRules: [
    {
        operation: "select",
        condition: policy.existsIn({
            collection: "team_members",         // the join / membership collection
            where: policy.and(
                // correlate to the row being checked:
                policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
                // …and to the caller:
                policy.compare(policy.field("user_id"), "eq", policy.authUid()),
            ),
        }),
    },
]
```

À l'intérieur de `where`, `policy.field(...)` fait référence à une colonne de la collection jointe (`team_members`), tandis que `policy.outerField(...)` fait référence à une colonne de la ligne en cours de vérification (`documents`). Combinez ceci avec `policy.authUid()` pour restreindre la portée à l'utilisateur actuel. Comme cette règle est appliquée par la base de données, l'interface d'administration la considère comme faisant autorité côté serveur.

#### Le générateur `policy`, au complet

Importé depuis `@rebasepro/types`. Les expressions se composent ; les opérandes sont les feuilles.

| Expression | Se compile en |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` | conjonction / disjonction |
| `policy.not(e)` | négation |
| `policy.compare(left, op, right)` | une comparaison entre deux opérandes |
| `policy.rolesOverlap(roles)` | l'appelant possède **au moins un** de ces rôles applicatifs |
| `policy.rolesContain(roles)` | l'appelant possède **tous** ces rôles applicatifs |
| `policy.authenticated()` | connecté — `rebase.uid()` est défini **et n'est pas une sentinelle anonyme**. `IS NOT NULL` seul serait une tautologie, car une requête anonyme définit une sentinelle au lieu de la laisser indéfinie |
| `policy.registered()` | connecté **avec un compte** — `authenticated()` et non un invité. Voir ci-dessous |
| `policy.serverContext()` | `rebase.uid() IS NULL` — voir l'avertissement ci-dessous |
| `policy.existsIn({ collection, where })` | une sous-requête `EXISTS` corrélée |
| `policy.raw(sql)` | une trappe de sortie, insérée textuellement |

| Opérande | Signification |
|---|---|
| `policy.field(name)` | une colonne de la collection en cours de vérification — ou, dans `existsIn`, de la collection jointe |
| `policy.outerField(name)` | dans `existsIn`, une colonne de la ligne externe |
| `policy.literal(value)` | une chaîne, un nombre, un booléen ou `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | `rebase.roles()` |

### `authenticated()` et `registered()`

Deux situations distinctes sont qualifiées d'anonymes, et il convient d'être précis sur ce qu'une règle cible.

Une requête **non authentifiée** ne transporte aucune session. On lui attribue un identifiant sentinelle afin que `rebase.uid()` ne soit jamais `NULL` sur le parcours utilisateur, et `policy.authenticated()` l'exclut — c'est ce qui lui donne la signification "connecté" plutôt que "n'importe qui".

Un **invité** est l'autre cas : une session sans utilisateur réel derrière elle. `POST /auth/anonymous` génère une vraie ligne d'utilisateur avec un vrai uid, de sorte qu'un invité passe tous les tests basés sur l'identifiant. C'est l'objectif même de cette fonctionnalité — un panier avant le paiement, un brouillon avant l'inscription — et cela signifie que `authenticated()` est vrai pour quiconque a cliqué sur *Continuer en tant qu'invité*, ce qui ne requiert aucun e-mail, aucun mot de passe et aucune acceptation de conditions.

`policy.registered()` équivaut à `authenticated()` plus "n'est pas un invité". Utilisez-le dès qu'une règle concerne une personne pouvant être tenue responsable de quelque chose : rédiger un avis, rejoindre une organisation, dépenser de l'argent. Utilisez `authenticated()` lorsqu'un invité est véritablement le bienvenu.

```ts
// Anyone with a session, guests included — a draft cart.
{ operation: "insert", check: policy.authenticated() }

// Someone with an account.
{ operation: "insert", check: policy.registered() }
```

En coulisses, l'indicateur invité voyage avec la session — il se trouve dans le jeton d'accès et parvient à la base de données sous la forme `rebase.is_anonymous()` — ce qui permet à une stratégie de poser la question sans requête supplémentaire. Une base de données gérée par un serveur trop ancien pour le définir interprète chaque session comme un compte, ce qui correspond au comportement que ce déploiement avait déjà.

:::caution[`serverContext()` n'est pas satisfait par le singleton serveur]
Il se compile en `rebase.uid() IS NULL`, et `rebase.dataAsAdmin` s'exécute en tant que `uid: "service"` — il est donc **faux** pour l'accesseur que la plupart des gens désignent par "le serveur". Une collection avec `disableDefaultPolicies: true` dont la seule règle est `serverContext()` rejette ces écritures (`42501`) et retourne zéro ligne — HTTP 200, vide — pour ces lectures. `rebase.sql()` est l'accesseur qui contourne véritablement les stratégies de sécurité.
:::

## Expressions SQL brutes

Pour une logique complexe, utilisez `using` et `withCheck` :

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

- **`using`** — Filtre les lignes existantes qui sont visibles (s'applique à SELECT, UPDATE, DELETE)
- **`withCheck`** — Valide les valeurs des nouvelles lignes (s'applique à INSERT, UPDATE)

Les références de colonnes utilisent la syntaxe `{column_name}`, qui est résolue en nom de colonne qualifié complet avec la table.

## Combiner raccourcis et SQL

Mélangez les raccourcis pratiques avec du SQL brut :

```typescript
securityRules: [
    // Admins can do anything
    { operation: "all", roles: ["admin"], using: "true" },
    // Regular users can only see their own rows
    { operation: "select", ownerField: "user_id" },
    // Users can insert, but only for themselves
    { operation: "insert", withCheck: "{user_id} = rebase.uid()" },
    // Locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permissif vs Restrictif

PostgreSQL propose deux modes de stratégie :

- **Permissif** (par défaut) — Plusieurs stratégies permissives sont combinées avec un opérateur **OU** (OR). Si au moins une est validée, l'accès est accordé.
- **Restrictif** — Les stratégies restrictives sont combinées avec un opérateur **ET** (AND). Toutes doivent être validées.

```typescript
securityRules: [
    // Permissive: owners can access their rows
    { operation: "all", ownerField: "user_id" },
    // Restrictive: but locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Opérations

| Opération | Équivalent SQL | Description |
|-----------|----------------|-------------|
| `"select"` | `SELECT` | Lire des lignes |
| `"insert"` | `INSERT` | Créer de nouvelles lignes |
| `"update"` | `UPDATE` | Modifier des lignes existantes |
| `"delete"` | `DELETE` | Supprimer des lignes |
| `"all"` | Tous les éléments ci-dessus | Raccourci pour toutes les opérations |

Vous pouvez également utiliser `operations` (au pluriel) pour appliquer une règle à plusieurs opérations :

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "authorId" }
```

## Interface SecurityRule complète

`SecurityRule` est une **union**, pas un objet ouvert unique : une règle choisit exactement une façon d'exprimer son prédicat, et les autres sont typées à `never` afin que les mélanger produise une erreur de compilation plutôt qu'une stratégie qui ignorerait silencieusement la moitié de ce que vous avez écrit.

```typescript no-verify
// Shared by every variant
interface SecurityRuleBase {
    name?: string;                        // Policy name. Omit it and one is derived
    operation?: SecurityOperation;        // "select" | "insert" | "update" | "delete" | "all"
    operations?: SecurityOperation[];     // …or several at once
    mode?: "permissive" | "restrictive";  // Default: "permissive"
    roles?: string[];                     // App roles, via rebase.roles()
    pgRoles?: string[];                   // Native Postgres roles — the CREATE POLICY `TO` clause.
                                          // NOT the same as `roles`. Default: ["public"]
}

// …plus exactly one of:
{ ownerField: string }                        // <column> = rebase.uid()
{ access: "public" }                          // the one shortcut — "no row filter"
{ condition: PolicyExpression;                // the structured builder — `policy.*`
  check?: PolicyExpression }                  // defaults to `condition`, as Postgres does
{ using?: string; withCheck?: string }        // raw SQL
```

`roles` et `pgRoles` sont les deux propriétés qui prêtent à confusion. `roles` est un rôle applicatif, appliqué *à l'intérieur* de la clause `USING` / `WITH CHECK` via `rebase.roles()`. `pgRoles` est un rôle de base de données, et contrôle à quelles connexions la stratégie est rattachée. La quasi-totalité des projets ont besoin de `roles`.

:::tip[Remplir la colonne désignée par `ownerField`]
`ownerField` compare une colonne à `rebase.uid()` ; il n'y insère rien. Déclarez cette colonne sous forme de chaîne avec [`autoValue: "user_on_create"`](/docs/collections/properties#audit-columns) et le pilote inscrira l'uid de l'utilisateur actif lors de l'insertion, écrasant tout ce que le corps de la requête a envoyé — ce qui rend la prémisse de la règle vraie. Une colonne fournie par l'appelant est une colonne sur laquelle l'appelant peut mentir.
:::

## Exemples

### Plateforme de blog

```typescript
securityRules: [
    // Anyone can read published posts
    { operation: "select", using: "{status} = 'published'" },
    // Authors can see their own drafts
    { operation: "select", ownerField: "authorId" },
    // Authors can create and edit their own posts
    { operations: ["insert", "update"], ownerField: "authorId" },
    // Only admins can delete
    { operation: "delete", roles: ["admin"] }
]
```

### SaaS multi-tenant

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

## Accès anonyme (insertions publiques)

Un besoin courant consiste à autoriser les **utilisateurs non authentifiés** à soumettre des données — formulaires de contact, inscriptions à des newsletters, candidatures publiques. Rebase fournit un modèle clair pour cela.

### Recommandé : une règle `withCheck` brute

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const contactMessagesCollection = defineCollection({
    slug: "contact_messages",
    name: "Contact Messages",
    table: "contact_messages",
    securityRules: [
        // Anyone can submit a contact message
        {
            operation: "insert",
            // A raw rule carries `using` (which rows are visible) and `withCheck`
            // (what a write must satisfy); an insert only exercises the latter.
            using: "true",
            withCheck: "true"
        },
        // Only admins can read, update, or delete messages
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Le raccourci `access: "public"` génère une stratégie qui autorise l'opération sans nécessiter d'authentification.

### Pour la capture de leads / inscriptions

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const leadSignupsCollection = defineCollection({
    slug: "lead_magnet_signups",
    name: "Lead Magnet Signups",
    table: "lead_magnet_signups",
    securityRules: [
        // Allow anonymous inserts
        { operation: "insert", using: "true", withCheck: "true" },
        // Admins can view all signups
        { operation: "select", roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

### Comment fonctionnent les requêtes anonymes

Lorsqu'une requête arrive sans jeton JWT, le backend Rebase définit les variables de session PostgreSQL comme suit :

| Variable | Valeur |
|----------|--------|
| `app.user_id` | `'anonymous'` |
| `app.user_roles` | `''` (vide) |

Cela signifie que :

- `rebase.uid()` retourne `'anonymous'`
- `rebase.roles()` retourne une chaîne vide
- Les stratégies `access: "public"` passent car elles génèrent `USING (true)` / `WITH CHECK (true)`
- Les conditions `policy.authenticated()` échouent car elles recherchent un ID d'utilisateur réel
- Les stratégies `ownerField` échouent car aucune ligne n'aura `user_id = 'anonymous'` (sauf si explicitement défini)

### Avancé : SQL brut pour les accès anonymes

Si vous avez besoin d'un contrôle plus granulaire, utilisez du SQL brut :

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "rebase.uid() = 'anonymous' OR rebase.uid() IS NOT NULL"
    }
]
```

:::tip
Évitez l'ancien modèle consistant à vérifier `string_to_array(rebase.roles(), ',')` pour l'accès anonyme. Le raccourci `access: "public"` est plus simple et génère automatiquement la stratégie appropriée.
:::

## Lignes d'un côté, champs de l'autre

Les règles de sécurité répondent à une seule question : **à quelles lignes** cet appelant a-t-il accès. Elles sont appliquées par Postgres lui-même, sur chaque instruction, quelle que soit la route — c'est pourquoi elles constituent le modèle d'autorisation et que tout ce qui se trouve au-dessus n'est que commodité.

Elles ne déterminent rien concernant les *colonnes* d'une ligne à laquelle un appelant a accès. Une stratégie qui permet à un employé de lire les lignes de son équipe lui permet de lire chaque champ de ces lignes, salaire inclus. C'est précisément le rôle de [`access`](/docs/collections/field-access/) par propriété :

```typescript
salary: {
    type: "number",
    // Everyone the rules above let read the row; only HR gets this column.
    access: { read: ["hr"], write: [] }
}
```

Les deux se cumulent et ne se contredisent jamais : une règle de champ ne peut pas élargir l'accès aux lignes, et une ligne que vous ne pouvez pas lire ne contient aucun champ accessible. Les rôles sont identiques — `rebase.roles()` dans une stratégie, `user.roles` sur la requête — ainsi, `rolesOverlap(['hr'])` dans une règle et `access: { read: ["hr"] }` sur une propriété font référence au même rôle `hr`. Les règles de champ sont appliquées par le serveur plutôt que par Postgres, de sorte qu'elles couvrent la surface de l'API ; une requête exécutée via `rebase.sql()` voit toutes les colonnes, tout comme elle contourne le RLS.

## Étapes suivantes

- **[Accès aux champs](/docs/collections/field-access)** — Rôles de lecture/écriture par champ
- **[Relations](/docs/collections/relations)** — Clés étrangères et jointures
- **[Callbacks d'entité](/docs/collections/callbacks)** — Hooks de cycle de vie
- **[Fonctions personnalisées](/docs/backend/custom-functions)** — Points de terminaison d'API personnalisés

---
sourceHash: 7b1dfed5d63d5937
title: Règles de Sécurité (RLS)
sidebar_label: Règles de Sécurité
description: Définissez des politiques de sécurité au niveau des lignes (Row Level Security - RLS) pour vos collections en utilisant des raccourcis pratiques ou des expressions SQL brutes.
---

## Aperçu

Les règles de sécurité vous permettent de définir des politiques de **sécurité au niveau des lignes (RLS)** pour vos tables PostgreSQL directement dans vos définitions de collection. Lorsque le schéma Drizzle est généré, Rebase crée les instructions `CREATE POLICY` correspondantes.

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

## Comment cela fonctionne

1. Vous définissez des `securityRules` sur une collection
2. `rebase schema generate` crée un schéma Drizzle avec RLS activé
3. `rebase db push` ou `rebase db migrate` applique les politiques à PostgreSQL
4. Chaque requête est automatiquement filtrée par le contexte de l'utilisateur actuel

L'identité de l'utilisateur authentifié est disponible en SQL via :

| Fonction | Renvoie |
|----------|---------|
| `rebase.uid()` | L'ID de l'utilisateur actuel |
| `rebase.roles()` | ID de rôles d'application séparés par des virgules |
| `rebase.jwt()` | Revendications JWT complètes en JSONB |

Ceux-ci sont définis automatiquement par transaction par le backend Rebase.

## Raccourcis Pratiques

### Accès basé sur le propriétaire

Le modèle le plus simple — les utilisateurs ne peuvent accéder qu'aux lignes qu'ils possèdent :

```typescript
securityRules: [
    { operation: "all", ownerField: "userId" }
]
```

Ceci génère : `USING (user_id = rebase.uid())`

### Accès Public

Permettre à quiconque (y compris les utilisateurs non authentifiés) de lire :

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

Ceci génère : `USING (true)`

### Accès Authentifié

Permettre à tout utilisateur authentifié :

```typescript
securityRules: [
    { operation: "select", access: "authenticated" }
]
```

### Accès basé sur les rôles

Restreindre les opérations à des rôles spécifiques :

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

## Expressions SQL Brutes

Pour une logique complexe, utilisez `using` et `withCheck` :

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

- **`using`** — Filtre les lignes existantes visibles (s'applique à SELECT, UPDATE, DELETE)
- **`withCheck`** — Valide les nouvelles valeurs de ligne (s'applique à INSERT, UPDATE)

Les références de colonnes utilisent la syntaxe `{column_name}` qui est résolue en colonne entièrement qualifiée par la table.

## Combiner les raccourcis et le SQL

Mélangez les raccourcis pratiques avec du SQL brut :

```typescript
securityRules: [
    // Les administrateurs peuvent tout faire
    { operation: "all", roles: ["admin"], using: "true" },
    // Les utilisateurs réguliers ne peuvent voir que leurs propres lignes
    { operation: "select", ownerField: "userId" },
    // Les utilisateurs peuvent insérer, mais uniquement pour eux-mêmes
    { operation: "insert", withCheck: "{userId} = rebase.uid()" },
    // Les lignes verrouillées ne peuvent pas être mises à jour
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permissif vs Restrictif

PostgreSQL a deux modes de politique :

- **Permissif** (par défaut) — Plusieurs politiques permissives sont combinées avec un **OU**. Si l'une d'elles passe, l'accès est accordé.
- **Restrictif** — Les politiques restrictives sont combinées avec un **ET**. Toutes doivent passer.

```typescript
securityRules: [
    // Permissif : les propriétaires peuvent accéder à leurs lignes
    { operation: "all", ownerField: "userId" },
    // Restrictif : mais les lignes verrouillées ne peuvent pas être mises à jour
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Opérations

| Opération | Équivalent SQL | Description |
|-----------|---------------|-------------|
| `"select"` | `SELECT` | Lire les lignes |
| `"insert"` | `INSERT` | Créer de nouvelles lignes |
| `"update"` | `UPDATE` | Modifier les lignes existantes |
| `"delete"` | `DELETE` | Supprimer les lignes |
| `"all"` | Toutes les opérations ci-dessus | Raccourci pour toutes les opérations |

Vous pouvez également utiliser `operations` (au pluriel) pour appliquer une règle à plusieurs opérations :

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "authorId" }
```

## Interface complète de SecurityRule

```typescript
interface SecurityRule {
    name?: string;              // Nom de politique lisible par l'homme
    operation?: SecurityOperation;   // Opération unique
    operations?: SecurityOperation[]; // Opérations multiples
    mode?: "permissive" | "restrictive"; // Par défaut : "permissive"
    access?: "public" | "authenticated";
    ownerField?: string;        // Colonne contenant l'ID de l'utilisateur propriétaire
    roles?: string[];           // Rôles d'application auxquels cette politique s'applique
    using?: string;             // Expression SQL brute USING
    withCheck?: string;         // Expression SQL brute WITH CHECK
}
```

## Exemples

### Plateforme de Blog

```typescript
securityRules: [
    // Tout le monde peut lire les publications publiées
    { operation: "select", using: "{status} = 'published'" },
    // Les auteurs peuvent voir leurs propres brouillons
    { operation: "select", ownerField: "authorId" },
    // Les auteurs peuvent créer et modifier leurs propres publications
    { operations: ["insert", "update"], ownerField: "authorId" },
    // Seuls les administrateurs peuvent supprimer
    { operation: "delete", roles: ["admin"] }
]
```

### SaaS Multi-Locataire

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

## Accès Anonyme (Insertions Publiques)

Un besoin courant est de permettre aux **utilisateurs non authentifiés** de soumettre des données — formulaires de contact, inscriptions à la newsletter, applications publiques. Rebase offre un modèle clair pour cela.

### Recommandé : `access: "public"` avec `withCheck`

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const contactMessagesCollection = defineCollection({
    slug: "contact_messages",
    name: "Contact Messages",
    table: "contact_messages",
    securityRules: [
        // Tout le monde peut soumettre un message de contact
        {
            operation: "insert",
            // A raw rule carries `using` (which rows are visible) and `withCheck`
            // (what a write must satisfy); an insert only exercises the latter.
            using: "true",
            withCheck: "true"
        },
        // Seuls les administrateurs peuvent lire, modifier ou supprimer des messages
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Le raccourci `access: "public"` génère une politique qui autorise l'opération sans nécessiter d'authentification.

### Pour la Capture de Leads / Inscriptions

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const leadSignupsCollection = defineCollection({
    slug: "lead_magnet_signups",
    name: "Lead Magnet Signups",
    table: "lead_magnet_signups",
    securityRules: [
        // Autoriser les insertions anonymes
        { operation: "insert", using: "true", withCheck: "true" },
        // Les administrateurs peuvent consulter toutes les inscriptions
        { operation: "select", roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

### Comment Fonctionnent les Requêtes Anonymes

Lorsqu'une requête arrive sans jeton JWT, le backend Rebase définit les variables de session PostgreSQL à :

| Variable | Valeur |
|----------|-------|
| `app.userId` | `'anonymous'` |
| `app.user_roles` | `''` (vide) |

Cela signifie que :

- `rebase.uid()` renvoie `'anonymous'`
- `rebase.roles()` renvoie une chaîne vide
- Les politiques `access: "public"` passent car elles génèrent `USING (true)` / `WITH CHECK (true)`
- Les politiques `access: "authenticated"` échouent car elles vérifient un véritable ID d'utilisateur
- Les politiques `ownerField` échouent car aucune ligne n'aura `userId = 'anonymous'` (sauf si explicitement défini)

### Avancé : SQL Brut pour l'Anonyme

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
Évitez le modèle hérité de vérification de `string_to_array(rebase.roles(), ',')` pour l'accès anonyme. Le raccourci `access: "public"` est plus simple et génère automatiquement la politique correcte.
:::

## Prochaines Étapes

- **[Relations](/docs/collections/relations)** — Clés étrangères et jointures
- **[Callbacks d'Entité](/docs/collections/callbacks)** — Hooks de cycle de vie
- **[Fonctions Personnalisées](/docs/backend/custom-functions)** — Points d'API personnalisés

---

---
sourceHash: 9338d2b094861fba
title: Tenancy
sidebar_label: Tenancy
description: Isolez chaque ligne d'une table à un site, une organisation ou un espace de travail avec une seule déclaration de tenant, appliquée par la sécurité au niveau des lignes (RLS) de Postgres.
---

## Ce que cela fait

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Sur une table, `tenant` désigne la colonne qui contient le tenant auquel
appartient une ligne (un site, une organisation, un espace de travail) et indique d'où
provient le tenant de l'appelant. À partir de cette unique déclaration, Rebase génère :

- **Une politique RLS restrictive**, `<table>_tenant_scope`. Les politiques
  restrictives sont combinées par un opérateur ET (AND) avec toutes les autres politiques
  de la table ; ainsi, la gestion du tenant restreint ce que le `rls` de la table
  autorise et ne l'élargit jamais. Une règle `access: "public"` ailleurs dans le
  fichier ne peut pas lever cette limite.
- **Une colonne `NOT NULL` et indexée.** Une ligne sans tenant n'appartiendrait
  à personne, et une colonne de tenant non indexée transformerait chaque lecture
  en un parcours séquentiel (sequential scan).
- **Le tenant lors des écritures.** Une création qui laisse le champ vide
  reçoit le tenant de l'appelant lorsque celui-ci en possède exactement un. Tout ce
  qui est ambigu ou externe est refusé (voir [Écritures](#écritures)).
- **Un déclencheur qui maintient les lignes dans leur tenant.** Une mise à jour
  qui déplace une ligne vers un autre tenant est refusée, aussi bien dans l'API
  que dans le SQL exécuté en tant qu'appelant.

Comme Postgres l'applique, le panneau d'administration, l'API REST, le SDK et le SQL
exécuté en tant qu'appelant voient tous les mêmes lignes.

## Un tenant par utilisateur : un claim

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Lorsque chaque utilisateur appartient à un seul et unique tenant, placez-le sur son
jeton de session et indiquez le nom du claim :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        siteId: col.uuid().notNull(),
        title:  col.text().notNull(),
    },
    tenant: { field: "siteId", from: { claim: "site_id" } },
    rls: [{ operation: "all", access: "authenticated" }],
});
```

La politique compare le `site_id` de la ligne avec le claim `site_id`, converti dans le
type de la colonne. Le claim provient de votre fournisseur d'identité ou du hook
d'authentification `customizeAccessToken` (`auth.hooks`, voir [Authentification](/docs/backend/authentication/) ;
le runtime managé n'a pas de route pour les hooks, cela nécessite donc un backend éjecté).
Les claims réservés tels que `uid`, `roles` et `aal` ne peuvent pas désigner un tenant :
ils sont écrits après les claims personnalisés de sorte qu'un hook ne peut pas les
définir, et toute configuration qui en nomme un est refusée.

## Plusieurs tenants par utilisateur : une table d'appartenance

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Lorsque des utilisateurs interviennent sur plusieurs tenants (un éditeur sur deux sites,
un consultant dans trois organisations), conservez les appartenances dans une table dédiée :

```ts
// backend/schema/site-members.ts
import { defineTable, col } from "@rebasepro/server/schema";

// One row per person per site they work on.
export const siteMembers = defineTable("site_members", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        userId: col.uuid().notNull(),
        siteId: col.uuid().notNull(),
    },
    // Members read their own rows. Required: the tenancy policy reads this
    // table as the caller, so without it nobody but an admin sees a post.
    rls: [{ operation: "select", ownerField: "userId" }],
});
```

```ts
// backend/schema/posts.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        siteId: col.uuid().notNull(),
        title:  col.text().notNull(),
    },
    tenant: {
        field: "siteId",
        from: { membership: { table: "site_members", userField: "userId", tenantField: "siteId" } },
    },
    rls: [{ operation: "all", access: "authenticated" }],
});
```

`membership.table` est le slug de la table d'appartenance ; `userField` et
`tenantField` sont les clés des colonnes de celle-ci.

La politique est un `EXISTS` corrélé sur `site_members` : « l'appelant est-il
membre du site de cette ligne ? », résolu au sein de la même requête. Rien n'est
stocké dans le jeton, donc l'ajout ou la suppression d'une appartenance prend
effet dès l'instruction suivante, sans nécessiter de reconnexion.

La table d'appartenance doit permettre aux appelants de lire leurs propres lignes,
car une politique est évaluée sous l'identité de l'utilisateur effectuant la requête
et la propre RLS de la table d'appartenance s'applique en son sein. Le démarrage (Boot)
refuse toute configuration où ce n'est pas le cas, et l'erreur indique la règle à ajouter.
Le démarrage refuse également une table d'appartenance qui n'existe pas, à laquelle il
manque l'une des colonnes indiquées, ou qui n'est pas stockée dans la même base de données Postgres.

## À qui cela ne s'applique pas

`bypassRoles` liste les rôles qui peuvent lire et écrire sur l'ensemble des tenants. Sa
valeur par défaut est `["admin"]`, afin que le panneau d'administration n'affiche pas une
table vide à un administrateur. Un tableau vide signifie qu'aucun rôle ne la contourne ;
le contexte de confiance propre au serveur (migrations, flux d'authentification) la contourne toujours.

```typescript
tenant: { field: "siteId", from: { claim: "site_id" }, bypassRoles: ["admin", "support"] }
```

## Écritures

Chaque refus renvoie une erreur `400` qui précise le champ, avant même d'interroger la base de données :

| Code | Condition |
|---|---|
| `TENANT_REQUIRED` | Une création a laissé le champ vide et l'appelant n'a aucun tenant, ou appartient à plusieurs. Envoyez le tenant lors de l'écriture |
| `TENANT_MISMATCH` | L'écriture spécifie un tenant auquel l'appelant n'appartient pas |
| `TENANT_IMMUTABLE` | Une mise à jour déplacerait la ligne vers un autre tenant. Créez-la dans l'autre tenant et supprimez celle-ci, ou effectuez l'opération avec un rôle défini dans `bypassRoles` |

Le SQL exécuté en tant qu'appelant obtient les mêmes réponses de la part de Postgres :
la clause `WITH CHECK` de la politique refuse un tenant tiers, et un déclencheur
`BEFORE UPDATE` refuse le déplacement (`42501`). Un appelant disposant d'un rôle de
contournement est exempté de ces trois vérifications.

## Le champ

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- Une colonne de type texte, `uuid`, énumération ou entier (`numeric` également),
  ou une relation `belongsTo` vers la table des tenants. Pour une relation, sa
  colonne de clé étrangère constitue le champ ; aucune seconde colonne n'est créée.
- Il doit être déclaré sur la table et accessible en lecture : le schéma est refusé
  si le champ est manquant, d'un autre type, ou restreint par `.private()` ou
  `.access({ read })`. Le typage vérifie que le champ correspond bien au nom d'une colonne.
- La colonne est définie comme `NOT NULL`, quelle que soit sa déclaration d'origine,
  et indexée.
- Pas sur une vue : c'est la sécurité au niveau des lignes (row-level security) qui l'applique.

## Ce que cela ne couvre pas

- **Fichiers.** Les téléversements ne sont pas des lignes. Délimitez-les par
  chemin grâce à l'[autorisation de stockage](/docs/backend/storage-authorization/),
  par exemple un dossier par site.
- **Navigation.** Les tables sont affichées ou masquées dans le CMS par rôle,
  et non par tenant. Le membre d'un site voit les mêmes tables que tout le monde,
  contenant uniquement les lignes de son site.
- **Infrastructure séparée.** Tous les tenants partagent une base de données et un
  serveur uniques. Si des tenants ne doivent absolument pas partager d'infrastructure,
  attribuez à chacun son propre déploiement.

## Voir aussi

- [Sécurité au niveau des lignes](/docs/collections/security-rules/) : les règles avec lesquelles la gestion du tenant est combinée via un opérateur ET
- [Accès aux champs](/docs/collections/field-access/) : permissions de lecture et d'écriture par champ
- [Autorisation de stockage](/docs/backend/storage-authorization/) : qui lit et écrit quels fichiers

---
sourceHash: 0d49afd8ac50f59e
title: Accès aux champs
sidebar_label: Accès aux champs
description: Permissions de lecture et d'écriture par propriété selon le rôle. Un appelant autorisé par les règles de sécurité de la ligne ne reçoit tout de même pas un champ que ses rôles ne lui permettent pas de lire.
---

## Vue d'ensemble

Les [règles de sécurité](/docs/collections/security-rules/) déterminent les **lignes** auxquelles un appelant a accès. `access` détermine quels **champs d'une ligne accessible** il peut voir et modifier.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const staff = defineCollection({
    slug: "staff",
    name: "Staff",
    table: "staff",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        salary: {
            type: "number",
            // Read by HR (and admins). Set by nobody through the API.
            access: { read: ["hr"], write: [] }
        }
    },
    securityRules: [
        { operation: "select", access: "public" }
    ]
});
```

La règle ci-dessus n'applique aucun filtre de ligne sur `select`, ainsi chaque appelant autorisé par l'API lit toutes les lignes de la table `staff`. Seul un appelant possédant le rôle `hr` obtient la colonne `salary`, et personne ne peut la modifier via HTTP.

## La règle

`access` comporte deux listes facultatives, et une liste omise n'est pas une liste vide — toute la fonctionnalité repose sur cette différence.

| `read` / `write` | Signification |
|------------------|---------------|
| omis | Délègue à la ligne. Quiconque est autorisé par les règles de sécurité de la collection à lire (ou écrire) la ligne accède au champ. |
| `[]` | Personne, via l'API, quel que soit le niveau de privilège — ni `admin`, ni la clé de service, ni une lecture intra-processus. |
| `["hr"]` | Un appelant possédant `hr`, **ou** `admin`, **ou** du code serveur approuvé (trusted) sans requête sous-jacente. |

Les rôles sont des rôles d'application Rebase — les mêmes que ceux renvoyés par `rebase.roles()` dans une politique et sur lesquels `policy.rolesOverlap` s'appuie. Ils proviennent du contexte d'appel : `user.roles` sur la requête authentifiée.

### Pourquoi `admin` passe toujours

Chaque politique de base injectée par Rebase comporte une branche `rolesOverlap(['admin'])`, et `rebase.dataAsAdmin` s'exécute avec `{ uid: "service", roles: ["admin"] }`. Une règle de champ qui empêcherait un administrateur d'accéder à une colonne de sa propre base de données empêcherait également le Studio de l'afficher et le CLI de l'exporter. Si vous avez besoin d'une colonne qu'aucun administrateur ne peut lire via l'API, utilisez `read: []`.

### Pourquoi le plan approuvé (trusted plane) passe

Un appel intra-processus à `rebase.data` dans un hook, une migration ou l'adaptateur d'authentification vérifiant un mot de passe n'a aucune requête ni aucun rôle associé. Il s'agit de code serveur, et une liste de rôles ne s'y applique pas. `[]` s'applique toujours : il s'agit d'une directive concernant la surface de l'API plutôt que l'identité de l'appelant.

## `excludeFromApi` repose sur le même mécanisme

`excludeFromApi: true` est un sucre syntaxique pour `access: { read: [], write: [] }`. Le même prédicat sous-tend ces deux syntaxes, tout ce qui se trouve sur cette page s'applique donc également à ce paramètre. Utilisez la forme la plus lisible selon vous — mais pas les deux sur une même propriété, ce qui serait rejeté au démarrage.

## Ce que voit un appelant

### Lectures

Un champ que vous ne pouvez pas lire est **absent** de la réponse. Ni `null`, ni une chaîne vide — la clé n'existe tout simplement pas.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

C'est délibéré. Une valeur masquée renvoyée sous la forme `null` ne peut être distinguée d'un `null` stocké en base, ce qui permettrait à un client de cartographier toute la colonne en les comptant — et un `update` renvoyant la ligne écraserait la vraie valeur avec le `null` reçu.

Cela s'applique à chaque sortie : liste, récupération unitaire, cibles de relations incluses avec `?include=`, résultats `_batch`, trames en temps réel provenant de `.listen()`, résultats d'agrégations et instantanés de l'[historique](#history).

### Requêtes

Une clause `where`, `orderBy`, `fields`, un `select` d'agrégation ou un `groupBy` mentionnant un champ que vous ne pouvez pas lire renvoie une erreur **400 `FIELD_NOT_READABLE`** :

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on 'staff' with your roles, so it cannot be used in a filter.",
    "details": {
      "collection": "staff",
      "fields": ["salary"],
      "violations": [
        { "field": "salary", "code": "access", "message": "'salary' is not readable with your roles." }
      ]
    }
  }
}
```

Sans cela, la valeur serait lisible prédicat par prédicat : vingt requêtes suffiraient pour effectuer une recherche binaire sur un salaire.

L'erreur **nomme le champ**. C'est un choix délibéré, pas un oubli : le document OpenAPI publié liste chaque propriété de chaque collection — il est servi par l'application, et non par le routeur de données authentifié — les noms de champs sont donc déjà publics. Masquer le nom ici ne protégerait rien et répondrait par « champ inconnu » à une simple faute de frappe d'un appelant, l'incitant à chercher une erreur d'orthographe inexistante. **Les noms de champs sont publics ; les valeurs des champs ne le sont pas.**

### Écritures

Une valeur pour un champ que vous ne pouvez pas écrire renvoie une **400**, jamais une clé ignorée silencieusement — une écriture qui écarterait un champ indiquerait un succès pour une modification qui n'a pas eu lieu.

| Code | Cas d'application |
|------|-------------------|
| `FIELD_NOT_WRITABLE` | `write` est une liste de rôles que vous ne satisfaites pas. Votre collègue peut obtenir un 200 pour le même corps de requête. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` est défini sur `[]` (ou `excludeFromApi`). Personne ne peut l'écrire ; la réponse est identique pour chaque appelant. |

Les deux renvoient `details.violations` indexé par le nom envoyé sur le réseau. Appliqué lors de la création, `PATCH`/`PUT`, `/bulk`, `_batch`, les upserts, les opérations de champ (`{ "salary": { "$inc": 1000 } }` mentionne `salary` comme n'importe quelle valeur) et la trame WebSocket `SAVE`.

## Recherche

La recherche par défaut (fallback) — une collection sans bloc `search` — applique un `ILIKE` sur vos propriétés de type chaîne de caractères et ignore celles que l'appelant ne peut pas lire. Rien ne fuite par ce biais.

Une collection qui déclare **effectivement** un [bloc `search`](/docs/backend/api/) compile vers une unique colonne `tsvector` générée et partagée entre tous les appelants. Il n'existe pas de variante par rôle ; ainsi, un champ restreint mentionné dans `search.fields` resterait *trouvable* par des appelants qui ne peuvent pourtant jamais voir sa valeur — reconstituant l'information terme par terme. Rebase refuse cette combinaison au démarrage : retirez le champ de `search.fields`, ou supprimez la restriction de lecture.

## Historique

L'[historique des entités](/docs/backend/api/) conserve l'intégralité de la ligne, et il est accessible à toute personne pouvant lire la ligne — le critère d'accès est « pouvez-vous récupérer cette entité », et non « êtes-vous administrateur ». La règle de lecture est donc également appliquée à chaque instantané stocké : l'entrée reste listée, avec l'auteur et la date de modification, et les colonnes masquées sont retirées de ses `values`.

La restauration (revert) n'est pas affectée. La route de restauration lit l'entrée stockée côté serveur, ce qui permet à un appelant de rétablir une version dont il ne peut voir l'ensemble des champs — exactement comme il peut déjà écraser une ligne sans en lire l'intégralité.

## Ce qu'affiche le panneau d'administration

Rien à configurer. Le Studio lit à travers la même API ; par conséquent, un champ que l'appelant ne peut pas lire n'arrive jamais et le formulaire ne l'affiche pas ; un champ qu'il ne peut pas modifier est refusé si un envoi est tenté. Il s'agit d'une garantie côté serveur, contrairement à `admin.hideFromCollection`, qui empêche uniquement le panneau de *rendre* un champ tout en laissant la valeur dans le JSON.

## Types générés et OpenAPI

Les types `Row`, `Insert` et `Update` du SDK ont une structure unique pour tous les appelants — il n'existe pas de type `Row` qui convienne à la fois à un lecteur possédant le rôle `hr` et à un lecteur ne le possédant pas — ainsi, une règle basée sur un **rôle** ne les modifie pas. Un champ interdit à tous (`[]` ou `excludeFromApi`) en est absent, comme cela a toujours été le cas.

Le document OpenAPI énonce la règle plutôt que de prétendre s'adapter à chaque appelant. Chaque propriété restreinte inclut `x-rebase-access` :

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un champ que personne ne peut lire est absent du schéma de lecture et des paramètres de filtre ; un champ que personne ne peut écrire est absent du schéma d'entrée. Les deux directions correspondent à des schémas distincts et sont évaluées séparément : ainsi, un jeton qu'un administrateur envoie mais ne relit jamais apparaîtra dans le corps de la requête et non dans la ligne retournée.

## Écritures intra-processus

`rebase.data` et `rebase.dataAsAdmin` dans un hook, une fonction ou une tâche cron ne passent pas par la vérification d'écriture. C'est la même exemption dont `excludeFromApi` a toujours bénéficié, et c'est ce qui rend la règle applicable en pratique : quelque chose doit bien pouvoir stocker le hachage du mot de passe.

Les lectures via `rebase.dataAsAdmin` disposent du rôle `admin`, donc une règle de rôle ne leur masque rien. `[]` masque toujours les données — y compris pour `dataAsAdmin`. Utilisez [`rebase.sql()`](/docs/backend/api/) si vous avez besoin de la colonne brute.

## Validation

Les cas suivants sont refusés au démarrage, avant même que le serveur ne traite la moindre requête :

- `access` et `excludeFromApi` sur la même propriété — ils reposent sur le même mécanisme, et l'indicateur l'emporte, rendant le bloc adjacent inopérant ;
- une simple chaîne de caractères là où une liste est attendue (`read: "admin"`), ce qui est interprété comme une règle non vide qu'aucun appelant ne satisfait et masquerait le champ à tout le monde ;
- un rôle qui n'est pas une chaîne non vide ;
- un champ restreint mentionné dans le `search.fields` de la collection.

Les *noms* de rôles ne sont pas vérifiés par rapport à un ensemble prédéfini : les rôles sont des données applicatives, créées et supprimées pendant le fonctionnement du serveur. Une faute de frappe dans l'un d'eux donne un champ que personne ne peut lire, ce qui constitue une sécurité par défaut (fail-safe).

## Voir aussi

- [Règles de sécurité (RLS)](/docs/collections/security-rules/) — quelles lignes un appelant peut atteindre
- [Propriétés](/docs/collections/properties/) — le tableau complet des options
- [Codes d'erreur](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`

---

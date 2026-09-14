---
sourceHash: b3e463880abd2023
title: Accès aux champs
sidebar_label: Accès aux champs
description: Permissions de lecture et d'écriture par propriété et par rôle. Un appelant autorisé par les règles de sécurité de la ligne ne reçoit toujours pas un champ que ses rôles ne permettent pas de lire.
---

## Vue d'ensemble

Les [règles de sécurité](/docs/collections/security-rules/) déterminent les **lignes** auxquelles un appelant a accès. `access` détermine les **champs d'une ligne atteinte** qu'il peut voir et modifier.

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

La règle ci-dessus n'applique aucun filtre de ligne sur `select` ; ainsi, chaque appelant autorisé par l'API lit chaque ligne de la table staff. Seul un appelant disposant du rôle `hr` obtient la colonne `salary`, et personne ne peut la définir via HTTP.

## La règle

`access` comporte deux listes optionnelles, et une liste omise n'est pas une liste vide — toute la fonctionnalité repose sur cette différence.

| `read` / `write` | Signification |
|------------------|---------------|
| omis | Délégation à la ligne. Toute personne autorisée par les règles de sécurité de la collection à lire (ou écrire) la ligne obtient le champ. |
| `[]` | Personne, via l'API, quel que soit le niveau de privilège — ni `admin`, ni la clé de service, ni une lecture in-process. |
| `["hr"]` | Un appelant disposant de `hr`, **ou** `admin`, **ou** du code serveur de confiance sans requête sous-jacente. |

Les rôles sont les rôles d'application Rebase — les mêmes que ceux renvoyés par `rebase.roles()` dans une politique et avec lesquels `policy.rolesOverlap` effectue ses vérifications. Ils proviennent du contexte de l'appel : `user.roles` sur la requête authentifiée.

### Pourquoi `admin` passe toujours

Chaque politique de base injectée par Rebase comporte une branche `rolesOverlap(['admin'])`, et `rebase.dataAsAdmin` s'exécute en tant que `{ uid: "service", roles: ["admin"] }`. Une règle de champ qui pourrait bloquer l'accès d'un administrateur à une colonne de sa propre base de données empêcherait également le Studio de l'afficher et le CLI de l'exporter. Si vous avez besoin d'une colonne qu'aucun administrateur ne peut lire via l'API, utilisez `read: []`.

### Pourquoi le plan de confiance passe

Le code serveur sans requête sous-jacente — une migration, ou l'adaptateur d'authentification vérifiant un mot de passe — lit sans aucun rôle, et une liste de rôles ne s'applique pas à lui. `[]` s'applique toujours : il s'agit d'une instruction concernant la surface de l'API plutôt que l'identité de l'appelant.

Le `context.data` d'un callback n'appartient pas à ce plan. Au sein d'une requête, il lit avec les rôles de l'appelant ; les règles de champ s'appliquent donc à ce qu'il lit exactement comme elles s'appliquent à la requête.

## `excludeFromApi` repose sur le même mécanisme

`excludeFromApi: true` est un raccourci syntaxique pour `access: { read: [], write: [] }`. Le même prédicat sous-tend les deux syntaxes, donc tout ce qui figure sur cette page s'applique également à ce drapeau. Utilisez la syntaxe la plus lisible selon votre cas — mais pas les deux sur une même propriété, ce qui est rejeté au démarrage.

## Ce que voit un appelant

### Lectures

Un champ que vous ne pouvez pas lire est **absent** de la réponse. Pas `null`, pas une chaîne vide — la clé n'existe pas.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

C'est délibéré. Une valeur masquée renvoyée sous la forme `null` est indiscernable d'un `null` stocké en base ; un client pourrait donc cartographier toute la colonne en les dénombrant — et un `update` renvoyant la ligne écraserait la vraie valeur avec le null qui lui a été transmis.

Cela s'applique à chaque sortie : liste, lecture unitaire, cibles de relation incluses avec `?include=`, résultats de `_batch`, trames temps réel issues de `.listen()`, résultats d'agrégation et instantanés de l'[historique](#historique).

### Requêtes

Un `where`, `orderBy`, `fields`, un `select` d'agrégation ou un `groupBy` mentionnant un champ que vous ne pouvez pas lire renvoie une erreur **400 `FIELD_NOT_READABLE`** :

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

Sans cela, la valeur serait lisible prédicat par prédicat : vingt requêtes équivaudraient à une recherche binaire sur un salaire.

L'erreur **nomme le champ**. C'est un choix délibéré, pas un oubli : le document OpenAPI publié liste chaque propriété de chaque collection — il est servi au niveau de l'application, pas au niveau du routeur de données authentifié — les noms de champs sont donc déjà publics. Masquer le nom ici ne protégerait rien et répondrait à une véritable faute de frappe d'un appelant par "champ inconnu", l'incitant à chercher une erreur de syntaxe inexistante. **Les noms de champs sont publics ; les valeurs des champs ne le sont pas.**

### Écritures

Fournir une valeur pour un champ que vous ne pouvez pas écrire renvoie une erreur **400**, jamais une suppression silencieuse de la clé — une écriture qui écarte un champ indiquerait un succès pour une modification qui n'a pas eu lieu.

| Code | Quand |
|------|-------|
| `FIELD_NOT_WRITABLE` | `write` est une liste de rôles que vous ne remplissez pas. Votre collègue peut recevoir un 200 pour le même corps de requête. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` vaut `[]` (ou `excludeFromApi`). Personne ne peut l'écrire ; la réponse est identique pour tous les appelants. |

Les deux comportent `details.violations` indexé par le nom envoyé sur le réseau. Ceci est appliqué lors de la création, des requêtes `PATCH`/`PUT`, `/bulk`, `_batch`, des upserts, des opérations de champ (`{ "salary": { "$inc": 1000 } }` cible `salary` comme n'importe quelle valeur) et de la trame WebSocket `SAVE`.

## Recherche

La recherche de secours — une collection sans bloc `search` — effectue une correspondance `ILIKE` sur vos propriétés de type chaîne, et ignore celles que l'appelant ne peut pas lire. Aucune donnée ne fuite par ce biais.

Une collection qui déclare **effectivement** un [bloc `search`](/docs/backend/api/) compile vers une colonne générée unique `tsvector` partagée par tous les appelants. Il n'en existe aucune variante par rôle ; ainsi, un champ restreint mentionné dans `search.fields` resterait *interrogeable* par des appelants qui ne peuvent pourtant jamais voir sa valeur — devenant récupérable terme par terme. Rebase refuse cette combinaison au démarrage : retirez le champ de `search.fields`, ou supprimez la restriction de lecture.

## Historique

L'[historique des entités](/docs/backend/api/) stocke la ligne complète, et il est accessible à toute personne pouvant lire la ligne — la condition d'accès est "pouvez-vous récupérer cette entité", et non "êtes-vous administrateur". La règle de lecture s'applique donc également à chaque instantané stocké : l'entrée est toujours listée, avec l'auteur et la date de modification, mais les colonnes restreintes sont retirées de ses `values`.

Le rétablissement (revert) n'est pas affecté. La route de rétablissement lit l'entrée stockée côté serveur, de sorte qu'un appelant peut restaurer une version dont il ne peut pas voir tous les champs — exactement comme il peut déjà écraser une ligne sans la lire en intégralité.

## Ce que montre le panneau d'administration

Rien à configurer. Le Studio lit via la même API ; un champ que l'appelant ne peut pas lire n'arrive donc jamais et le formulaire ne l'affiche pas ; un champ qu'il ne peut pas écrire est rejeté si une tentative d'envoi a lieu. Il s'agit d'une garantie côté serveur, contrairement à `admin.hideFromCollection`, qui empêche uniquement le panneau d'*afficher* un champ tout en laissant la valeur dans le JSON.

## Types générés et OpenAPI

Les types `Row`, `Insert` et `Update` du SDK ont une structure unique pour tous les appelants — il n'existe pas de type `Row` qui soit adapté à la fois à un lecteur ayant le rôle `hr` et à un autre qui ne l'a pas — une règle basée sur les **rôles** ne les modifie donc pas. Un champ fermé à tout le monde (`[]`, ou `excludeFromApi`) en est absent, comme cela a toujours été le cas.

Le document OpenAPI explicite la règle plutôt que de simuler un schéma par appelant. Chaque propriété restreinte porte `x-rebase-access` :

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un champ que personne ne peut lire est absent du schéma de lecture et des paramètres de filtrage ; un champ que personne ne peut écrire est absent du schéma d'entrée. Les deux directions correspondent à des schémas distincts et sont évaluées séparément ; ainsi, un jeton qu'un administrateur envoie et ne relit jamais apparaît dans le corps de la requête mais pas dans la ligne renvoyée.

## Écritures in-process

Les écritures in-process — `context.data` dans un callback, `rebase.dataAsAdmin` dans un callback, une fonction ou une tâche cron — ne sont pas soumises au contrôle d'écriture. Il s'agit de la même exemption dont `excludeFromApi` a toujours bénéficié, et c'est ce qui rend la règle applicable en pratique : un mécanisme doit bien être en mesure de stocker le hachage du mot de passe.

Les lectures via `rebase.dataAsAdmin` disposent du rôle `admin`, de sorte qu'une règle de rôle ne leur masque rien. `[]` continue de s'appliquer — y compris pour `dataAsAdmin`. Utilisez [`rebase.sql()`](/docs/backend/api/) si vous avez besoin d'accéder directement à la colonne brute.

## Validation

Ces configurations sont refusées au démarrage, avant que le serveur ne traite la moindre requête :

- `access` et `excludeFromApi` sur la même propriété — ils partagent le même mécanisme, et le drapeau l'emporte, rendant le bloc adjacent inopérant ;
- une simple chaîne là où une liste est attendue (`read: "admin"`), ce qui est interprété comme une règle non vide qu'aucun appelant ne satisfait et masquerait le champ à tout le monde ;
- un rôle qui n'est pas une chaîne non vide ;
- un champ restreint mentionné dans `search.fields` de la collection.

Les *noms* de rôles ne sont pas validés par rapport à une liste prédéfinie : les rôles sont des données applicatives, créées et supprimées pendant l'exécution du serveur. Une faute de frappe dans un rôle produit un champ que personne ne peut lire, ce qui constitue le comportement d'échec le plus sûr.

## Voir aussi

- [Règles de sécurité (RLS)](/docs/collections/security-rules/) — les lignes auxquelles un appelant a accès
- [Propriétés](/docs/collections/properties/) — le tableau complet des options
- [Codes d'erreur](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`

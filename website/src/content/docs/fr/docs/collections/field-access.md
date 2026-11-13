---
sourceHash: f55095351eb33abe
title: Accès aux champs
sidebar_label: Accès aux champs
description: "Permissions de lecture et d'écriture par colonne selon le rôle avec .access(), colonnes qui ne quittent jamais le serveur avec .private(), et colonnes non modifiables par les clients avec .readOnly(). Un appelant autorisé par les stratégies de la ligne ne reçoit tout de même pas une colonne que ses rôles ne lui permettent pas de lire."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

La [sécurité au niveau des lignes](/docs/collections/security-rules/) détermine les **lignes** auxquelles un appelant a accès. Trois modificateurs de colonne déterminent les **colonnes d'une ligne accessible** qu'il voit et peut modifier :

| Modificateur | Lecture | Écriture |
|---|---|---|
| `.access({ read, write })` | les rôles spécifiés dans `read` | les rôles spécifiés dans `write` |
| `.private()` | personne, via l'API | personne, via l'API |
| `.readOnly()` | identique à la ligne | personne, via l'API |

Les relations acceptent les mêmes règles en tant qu'options : `rel.*(target, { access: { read, write } })` et `rel.*(target, { private: true })`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name:   col.text().notNull(),
        // Read by HR (and admins). Set by nobody through the API.
        salary: col.numeric({ precision: 10, scale: 2 }).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "public" }],
});
```

La règle ci-dessus n'applique aucun filtre de ligne sur `select`, de sorte que chaque appelant autorisé par l'API peut lire chaque ligne de la table staff. Seul un appelant disposant du rôle `hr` obtient la colonne `salary`, et personne ne peut la définir via HTTP.

## La règle

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`.access()` accepte deux listes facultatives, et une liste omise n'est pas une liste vide — toute la fonctionnalité repose sur cette différence.

| `read` / `write` | Signification |
|------------------|---------------|
| omis | Délègue à la ligne. Quiconque est autorisé par la configuration `rls` de la table à lire (ou écrire) la ligne a accès à la colonne. |
| `[]` | Personne, via l'API, quel que soit le niveau de privilège — ni `admin`, ni la clé de service, ni une lecture in-process. |
| `["hr"]` | Un appelant disposant du rôle `hr`, **ou** `admin`, **ou** du code serveur de confiance sans requête associée. |

Les rôles sont les rôles applicatifs de Rebase — ceux-là mêmes que `rebase.roles()` renvoie au sein d'une stratégie et que `policy.rolesOverlap` évalue. Ils proviennent du contexte d'appel : `user.roles` sur la requête authentifiée.

### Pourquoi `admin` passe toujours

Chaque stratégie de base injectée par Rebase comporte une branche `rolesOverlap(['admin'])`, et `rebase.dataAsAdmin` s'exécute en tant que `{ uid: "service", roles: ["admin"] }`. Une règle de champ qui empêcherait un administrateur d'accéder à une colonne de sa propre base de données empêcherait également le Studio de l'afficher et la CLI de l'exporter. Si vous avez besoin d'une colonne qu'aucun administrateur ne peut lire via l'API, utilisez `read: []`.

### Pourquoi le plan de confiance passe

Le code serveur sans requête sous-jacente — une migration, ou l'adaptateur d'authentification vérifiant un mot de passe — effectue des lectures sans aucun rôle, et une liste de rôles ne s'applique donc pas à lui. `[]` s'applique toujours : il s'agit d'une déclaration concernant la surface de l'API plutôt que l'identité de l'appelant.

Le `context.data` d'un hook ne fait pas partie de ce plan. Au sein d'une requête, il lit avec les rôles de l'appelant, de sorte que les règles de champ s'appliquent à ses lectures exactement comme elles s'appliquent à la requête : le pilote lui-même refuse tout filtre, tri, projection, inclusion (`include`), recherche vectorielle, agrégat ou test d'unicité qui cible une colonne que ces rôles ne peuvent pas lire (`FIELD_NOT_READABLE`), et traite le nom d'une colonne `.private()` comme une faute de frappe — tout comme pour REST et le socket.

## `.private()` et `.readOnly()` reposent sur le même mécanisme

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`.private()` équivaut à `.access({ read: [], write: [] })`, à une différence près : une colonne privée est également omise d'OpenAPI, des types du SDK et des schémas d'outils MCP, de sorte que son nom n'est pas public non plus (voir [Requêtes](#requêtes)). Une colonne ne peut pas être à la fois `.private()` et déclarer `.access()` ; le schéma est refusé.

`.readOnly()` correspond à `write: []` : personne ne peut écrire dans la colonne via l'API, quel que soit son rôle, tandis que les valeurs par défaut, les déclencheurs et le code serveur peuvent toujours la renseigner. Les lectures sont déléguées à la ligne, ou à `.access({ read })` lorsque les deux sont spécifiés.

## Ce que voit l'appelant

### Lectures

Un champ que vous ne pouvez pas lire est **absent** de la réponse. Pas `null`, pas une chaîne vide — la clé n'est tout simplement pas présente.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

C'est intentionnel. Une valeur masquée renvoyée sous la forme de `null` ne se distinguerait pas d'une valeur `null` stockée, ce qui permettrait à un client de cartographier toute la colonne en les comptant — et un `update` renvoyant la ligne écraserait la vraie valeur avec le `null` reçu.

Cela s'applique à chaque point de sortie : liste, get individuel, cibles de relations incluses avec `?include=`, résultats de `_batch`, trames en temps réel issues de `.listen()`, résultats d'agrégation et instantanés de l'[historique](#historique).

La valeur d'une relation correspond à ses lignes associées ; par conséquent, une relation que vous ne pouvez pas lire est entièrement retenue. `?include=` l'omet de la ligne, ainsi que son `_count`, quel que soit le canal : REST, le SDK, `.listen()` et les inclusions imbriquées d'un niveau inférieur. La nommer ailleurs est refusé comme pour un champ (voir [Requêtes](#requêtes)).

### Requêtes

Une clause `where`, `orderBy`, `fields`, `select` d'agrégat ou `groupBy` nommant un champ que vous ne pouvez pas lire renvoie une erreur **400 `FIELD_NOT_READABLE`**. Il en va de même pour un filtre via une relation sur un champ de sa cible que vous ne pouvez pas lire (`?author.salary=gt.1`), un tri par agrégat sur celui-ci (`orderBy=max(staff.salary)`), ainsi qu'une relation illisible nommée dans un chemin imbriqué (`/departments/1/members`, `/departments/1/members/7`) ou un tri par agrégat (`orderBy=count(members)`) :

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on table 'staff' with your roles, so it cannot be used in a filter.",
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

Sans cela, la valeur serait lisible prédicat par prédicat : vingt requêtes équivaudraient à une recherche dichotomique sur un salaire.

L'erreur **nomme le champ**. C'est un choix délibéré et non un oubli : le document OpenAPI publié liste chaque colonne de chaque table — il est servi par l'application et non par le routeur de données authentifié — les noms de champs sont donc déjà publics. Masquer le nom ici ne protégerait rien et répondrait à une véritable faute de frappe d'un appelant par "champ inconnu", l'incitant à chercher une faute d'orthographe inexistante. **Les noms de champs sont publics ; les valeurs des champs ne le sont pas.**

Sauf pour une colonne `.private()`. OpenAPI, `describe_table` et le SDK généré l'omettent, de sorte que son nom n'est pas public, et un message "non lisible" confirmerait son existence. Un filtre, `orderBy`, `fields`, `include`, `select` d'agrégat ou `groupBy`, ou encore `vector_search` la nommant reçoit exactement la même réponse qu'un nom mal orthographié — `UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`, avec le même message et les mêmes détails — et aucune réponse de champ inconnu ne la liste parmi les champs valides.

### Écritures

Une valeur fournie pour un champ dans lequel vous ne pouvez pas écrire renvoie une erreur **400**, et n'est jamais une clé ignorée silencieusement — une écriture qui écarterait un champ indiquerait un succès pour une modification qui n'a pas eu lieu.

| Code | Cas d'application |
|------|-------------------|
| `FIELD_NOT_WRITABLE` | `write` est une liste de rôles que vous ne remplissez pas. Votre collègue peut obtenir un code 200 pour le même corps de requête. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` est `[]`, ou la colonne est `.private()` ou `.readOnly()`. Personne ne peut y écrire ; la réponse est identique pour chaque appelant. |

Les deux comportent un champ `details.violations` indexé par le nom envoyé sur le réseau. Cette règle est appliquée lors des créations, `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, opérations sur les champs (`{ "salary": { "$inc": 1000 } }` mentionne `salary` comme n'importe quelle valeur) et sur la trame WebSocket `SAVE`.

Une opération sur un champ requiert également la permission `read` sur ce champ. Une opération sur un champ que vous pouvez modifier mais pas lire est refusée avec l'erreur `FIELD_NOT_READABLE` : savoir si elle a franchi une limite vous indiquerait la valeur que vous n'êtes pas autorisé à voir.

### Un lien suit sa colonne clé

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une relation `belongsTo` et la colonne clé à laquelle elle est liée représentent un seul et même champ avec deux écritures. Écrire `{ "reviewer": 7 }` est soumis à toutes les règles de `reviewerId` (sa règle d'écriture, `.readOnly()`, `.private()`, un horodatage de création, la colonne de tenant) ; envoyer les deux avec des valeurs différentes renvoie `400 VALIDATION_INVALID_VALUE`. Un appelant qui ne peut pas lire `reviewerId` n'obtient pas `reviewer` dans un `include`, et une entrée de filtre, de tri ou de `fields` qui la nomme répond par `FIELD_NOT_READABLE` ; derrière une clé `.private()`, la relation n'existe tout simplement pas pour les clients. Le point de terminaison du schéma, OpenAPI et MCP décrivent les deux ensemble.

Il en va de même pour chaque relation, quel que soit ce que lit sa jointure : une relation `hasMany` / `hasOne` lit la clé étrangère de la cible, une relation `via` lit chaque colonne sur laquelle ses étapes se joignent, sur chaque table traversée. Un appelant qui ne peut pas lire l'une de ces colonnes n'obtient pas la relation dans un `include` ou un `_count`, reçoit une erreur `FIELD_NOT_READABLE` lors d'un filtrage ou d'un tri via celle-ci (une relation inconnue lorsque la colonne est `.private()`), et ne la voit pas décrite.

Une relation `via` passant par une table que le serveur ne dessert pas — une table qu'il masque (`TABLE_WITHHELD`) ou qu'aucune de ses tables ne déclare — est inaccessible à tout appelant, code de confiance inclus : ses colonnes de jointure sont considérées comme illisibles et inscriptibles, elle est donc omise de `include`, et tout filtre, tri ou chemin passant par elle est refusé (`FIELD_NOT_READABLE`, ou `503 TABLE_WITHHELD` mentionnant la table masquée).

Une relation `manyToMany` dont la table de jonction est déclarée par vos soins (`through` référence un `defineTable`) est soumise aux règles de colonnes de cette table : une écriture définissant une colonne de liaison `.readOnly()`, `.private()` ou verrouillée par `access.write` sur la jonction est refusée (`VALIDATION_EXCLUDED_FIELDS` / `FIELD_NOT_WRITABLE`), tout comme un champ `_pivot` verrouillé par la jonction. Il en va de même pour les routes imbriquées (`POST`, `PATCH` et `DELETE /:table/:id/:relation/:targetId`, ainsi qu'une modification de `_pivot`) et le WebSocket. Une jonction créée automatiquement par Rebase ne possède pas de règles propres.

`strictWrites: false` sur une table permet uniquement de transmettre au pilote une clé non déclarée par la table. Cela n'assouplit en aucun cas une règle sur une colonne déclarée, un horodatage, le tenant, la clé, une cible de relation ou un champ `_pivot`.

## Recherche

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

La recherche par défaut — pour une table sans bloc `search` — effectue une correspondance `ILIKE` sur vos colonnes de texte, et ignore celles que l'appelant ne peut pas lire. Rien ne fuite par ce biais.

Une table qui déclare **effectivement** un [bloc `search`](/docs/backend/search) est compilée en une unique colonne `tsvector` générée et partagée par tous les appelants. Il n'en existe aucune variante par rôle, de sorte qu'une colonne restreinte mentionnée dans `search.fields` resterait *trouvable* par des appelants qui ne peuvent jamais voir sa valeur — pouvant être reconstituée terme par terme. Le schéma est refusé dans ce cas : retirez la colonne de `search.fields` ou supprimez la restriction de lecture. Une colonne `tenant` ne peut pas non plus faire l'objet d'une restriction de lecture.

## Historique

L'[historique des entités](/docs/backend/history) stocke la ligne entière et est accessible à quiconque peut lire la ligne — le contrôle d'accès repose sur la question "pouvez-vous récupérer cette entité", et non "êtes-vous administrateur". La règle de lecture est donc également appliquée à chaque instantané stocké : l'entrée reste listée, avec l'auteur et la date de la modification, mais les colonnes restreintes sont retirées de ses `values`.

La restauration n'est pas affectée. La route de restauration lit l'entrée stockée côté serveur, ce qui permet à un appelant de restaurer une version dont il ne peut voir tous les champs — tout comme il peut déjà écraser une ligne sans la lire en intégralité.

## Ce que le CMS affiche

Rien à configurer. Le CMS lit les données via la même API, de sorte qu'une colonne que l'appelant ne peut pas lire n'est jamais transmise et le formulaire ne l'affiche pas ; une colonne dans laquelle il ne peut pas écrire est refusée si un élément tente de l'envoyer. Il s'agit d'une garantie côté serveur, contrairement au masquage d'un champ dans le CMS, qui empêche seulement son *rendu* tout en laissant la valeur dans le JSON.

## Types générés et OpenAPI

Les types `Row`, `Insert` et `Update` du SDK ont une structure unique pour chaque appelant — il n'existe pas de type `Row` adapté à la fois à un lecteur disposant du rôle `hr` et à un lecteur ne le possédant pas — une règle de **rôle** ne les modifie donc pas. Une colonne `.private()` est absente des trois types, et une colonne `.readOnly()` est absente de `Insert` et `Update`. Les [types inférés](/docs/schema/types/) suivent la même règle.

Le document OpenAPI énonce la règle plutôt que de prétendre s'adapter à chaque appelant. Chaque colonne restreinte comporte `x-rebase-access` :

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un champ que personne ne peut lire est absent du schéma de lecture et des paramètres de filtrage ; un champ dans lequel personne ne peut écrire est absent du schéma d'entrée. Les deux sens constituent des schémas distincts et sont évalués séparément, de sorte qu'un jeton qu'un administrateur envoie et ne relit jamais apparaît dans le corps de la requête mais pas dans la ligne.

## Écritures in-process

Les écritures in-process — `context.data` dans un hook, `rebase.dataAsAdmin` dans un hook, une fonction ou une tâche cron — ne sont pas soumises au contrôle d'écriture : `.readOnly()`, un `access.write` par champ et `.private()` sont des règles propres aux limites de l'API. C'est précisément ce qui rend la règle applicable : il faut bien que quelque chose puisse stocker le hash du mot de passe. Ce qui reste en revanche appliqué in-process, pour une colonne comme pour le lien qui lui est associé : les horodatages du serveur prévalent sur une valeur fournie, une ligne ne peut pas changer de tenant, et sa clé ne peut pas être modifiée. La sécurité au niveau des lignes s'applique partout.

Les lectures via `rebase.dataAsAdmin` détiennent le rôle `admin`, de sorte qu'une règle de rôle ne leur masque rien. `[]` le fait toujours — y compris pour `dataAsAdmin`. Utilisez [`rebase.sql()`](/docs/backend/custom-functions) si vous avez besoin d'accéder à la colonne brute.

## Validation

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`.access()` sur une colonne, et `access` sur une relation, lèvent une exception au chargement du module sauf si `read` et `write` sont des listes de noms de rôles non vides : une chaîne de caractères fournie à la place d'une liste (`read: "admin"`) est refusée plutôt qu'interprétée autrement.

Les éléments suivants sont refusés lors de la compilation du schéma, avant même que le serveur ne traite la moindre requête :

- `.private()` et `.access()` sur la même colonne : ils reposent sur un seul et même mécanisme ;
- une colonne soumise à une restriction de lecture spécifiée dans le champ `search.fields` de la table, ou utilisée comme champ `tenant` ;
- une clé primaire `.private()` : la clé est l'élément permettant d'adresser chaque ligne.

Les *noms* de rôles ne sont pas vérifiés par rapport à un ensemble prédéfini : les rôles sont des données applicatives, créées et supprimées pendant l'exécution du serveur. Une faute de frappe dans un rôle donne un champ que personne ne peut lire, ce qui constitue un comportement d'échec sécurisé.

## Voir aussi

- [Sécurité au niveau des lignes](/docs/collections/security-rules/) — quelles lignes un appelant peut atteindre
- [Colonnes](/docs/schema/columns/) — tous les modificateurs de colonnes
- [Codes d'erreur](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`

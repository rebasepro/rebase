---
sourceHash: 8ce5fe3122103e0c
title: Accès aux champs
sidebar_label: Accès aux champs
description: "Permissions de lecture et d'écriture par colonne selon le rôle avec .access(), colonnes qui ne quittent jamais le serveur avec .private(), et colonnes que les clients ne peuvent pas écrire avec .readOnly(). Un appelant autorisé par les politiques de la ligne ne reçoit toujours pas une colonne que ses rôles ne peuvent pas lire."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

La [sécurité au niveau des lignes](/docs/collections/security-rules/) détermine quelles **lignes** un
appelant peut atteindre. Trois modificateurs de colonne déterminent quelles **colonnes d'une ligne atteinte**
il peut voir et définir :

| Modificateur | Lecture | Écriture |
|---|---|---|
| `.access({ read, write })` | les rôles spécifiés dans `read`, s'ils sont fournis | les rôles spécifiés dans `write`, s'ils sont fournis |
| `.private()` | personne, via l'API | personne, via l'API |
| `.readOnly()` | identique à la ligne | personne, via l'API |

Les relations acceptent les mêmes règles en tant qu'options : `rel.*(target, { access: { read, write } })`
et `rel.*(target, { private: true })`.

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

La règle ci-dessus n'applique aucun filtre de ligne sur `select`, donc chaque appelant autorisé par l'API
peut lire chaque ligne de `staff`. Seul un appelant disposant du rôle `hr` obtient la colonne `salary`
d'une ligne, et personne ne peut la définir via HTTP.

## La règle

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`.access()` prend deux listes optionnelles, et une liste omise n'est pas une liste vide —
cette distinction constitue tout l'intérêt de la fonctionnalité.

| `read` / `write` | Signification |
|------------------|---------------|
| omis | Déléguer à la ligne. Toute personne autorisée par le `rls` de la table à lire (ou écrire) la ligne obtient la colonne. |
| `[]` | Personne, via l'API, quel que soit le niveau de privilège — ni `admin`, ni la clé de service, ni une lecture in-process. |
| `["hr"]` | Un appelant disposant du rôle `hr`, **ou** `admin`, **ou** du code serveur de confiance sans requête associée. |

Les rôles sont des rôles applicatifs Rebase — les mêmes que ceux renvoyés par `rebase.roles()`
au sein d'une politique et sur lesquels `policy.rolesOverlap` effectue ses vérifications. Ils proviennent du
contexte de l'appel : `user.roles` sur la requête authentifiée.

### Pourquoi `admin` passe toujours

Chaque politique de base injectée par Rebase comporte une branche `rolesOverlap(['admin'])`, et
`rebase.dataAsAdmin` s'exécute en tant que `{ uid: "service", roles: ["admin"] }`. Une règle de champ
qui empêcherait un administrateur d'accéder à une colonne de sa propre base de données
empêcherait également le Studio de l'afficher et la CLI de l'exporter. Si vous
avez besoin d'une colonne qu'aucun administrateur ne peut lire via l'API, utilisez `read: []`.

### Pourquoi le plan de confiance passe

Le code serveur sans requête sous-jacente — une migration, ou l'adaptateur d'authentification
qui vérifie un mot de passe — lit sans aucun rôle, et une liste de rôles ne
s'applique pas à lui. `[]` s'applique toujours : il s'agit d'une déclaration sur la surface de l'API plutôt
que sur l'identité de l'appelant.

Le `context.data` d'un hook ne relève pas de ce plan. Au sein d'une requête, il lit avec les
rôles de l'appelant, de sorte que les règles de champ s'appliquent à ce qu'il lit exactement comme elles s'appliquent
à la requête : le pilote lui-même refuse tout filtre, tri, projection, include,
recherche vectorielle, agrégat ou test d'unicité qui mentionne une colonne que ces rôles
ne peuvent pas lire (`FIELD_NOT_READABLE`), et répond à un nom `.private()` de la même manière qu'à
une faute de frappe — exactement comme REST et le socket.

## `.private()` et `.readOnly()` utilisent le même mécanisme

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`.private()` équivaut à `.access({ read: [], write: [] })`, à une différence près : une
colonne privée est également exclue d'OpenAPI, des types du SDK et des schémas
d'outils MCP, de sorte que son nom n'est pas public non plus (voir [Requêtes](#requêtes)). Une colonne
ne peut pas être à la fois `.private()` et déclarer `.access()` ; le schéma est refusé.

`.readOnly()` équivaut à `write: []` : personne n'écrit dans la colonne via l'API, quel que soit
son rôle, tandis que les valeurs par défaut, les déclencheurs et le code serveur continuent de la renseigner. Les lectures sont
laissées à la ligne, ou à `.access({ read })` lorsque les deux sont définis.

## Ce qu'un appelant voit

### Lectures

Un champ que vous ne pouvez pas lire est **absent** de la réponse. Ni `null`, ni une chaîne
vide — la clé n'est tout simplement pas présente.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

C'est délibéré. Une valeur masquée renvoyée sous forme de `null` ne pourrait être distinguée d'un
`null` réellement stocké, permettant à un client de cartographier toute la colonne en les comptant — et un
`update` renvoyant la ligne écraserait la vraie valeur avec le null qui lui a été fourni.

Cela s'applique à chaque point de sortie : liste, lecture individuelle, cibles de relation incluses avec
`?include=`, résultats de `_batch`, trames temps réel de `.listen()`, résultats
d'agrégation et instantanés de l'[historique](#historique).

La valeur d'une relation réside dans ses lignes associées, donc une relation que vous ne pouvez pas lire est
entièrement retenue. `?include=` l'exclut de la ligne, ainsi que son `_count`, par
toutes les voies d'accès : REST, le SDK, `.listen()` et les inclusions imbriquées au niveau inférieur.
La nommer ailleurs est refusé comme pour un champ (voir [Requêtes](#requêtes)).

### Requêtes

Un `where`, `orderBy`, `fields`, `select` d'agrégation ou `groupBy` qui nomme un champ que vous
ne pouvez pas lire renvoie une erreur **400 `FIELD_NOT_READABLE`**. Il en va de même pour un filtre à travers une relation
sur un champ de sa cible que vous ne pouvez pas lire (`?author.salary=gt.1`), un tri
d'agrégation sur celui-ci (`orderBy=max(staff.salary)`), ainsi qu'une relation que vous ne pouvez pas lire
mentionnée dans un chemin imbriqué (`/departments/1/members`, `/departments/1/members/7`) ou
un tri d'agrégation (`orderBy=count(members)`) :

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

Sans cela, la valeur serait lisible prédicat par prédicat : vingt requêtes suffiraient à effectuer une
recherche dichotomique sur un salaire.

L'erreur **nomme le champ**. C'est un choix délibéré et non un oubli : le
document OpenAPI publié répertorie chaque colonne de chaque table — il est
fourni par l'application et non par le routeur de données authentifié — les noms de champs sont
donc déjà publics. Masquer le nom ici ne protégerait rien et répondrait à une
véritable faute de frappe de l'appelant par « champ inconnu », l'incitant à chercher une faute
d'orthographe inexistante. **Les noms de champs sont publics ; les valeurs des champs ne le sont pas.**

Sauf pour une colonne `.private()`. OpenAPI, `describe_table` et le SDK généré
l'excluent, son nom n'est donc pas public, et la mention « non lisible » confirmerait son
existence. Un filtre, `orderBy`, `fields`, `include`, `select` d'agrégation ou
`groupBy`, ou `vector_search` qui en nomme une reçoit exactement la même réponse qu'un nom mal orthographié —
`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`,
`UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`, avec
le même message et les mêmes détails — et aucune réponse de champ inconnu ne la liste parmi les champs valides.

### Écritures

Fournir une valeur pour un champ que vous ne pouvez pas écrire renvoie une **400**, jamais une clé ignorée silencieusement —
une écriture qui écarterait un champ confirmerait le succès d'une modification qui n'a pas eu lieu.

| Code | Quand |
|------|-------|
| `FIELD_NOT_WRITABLE` | `write` est une liste de rôles que vous ne remplissez pas. Votre collègue peut obtenir un 200 avec le même corps de requête. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` est `[]`, ou la colonne est `.private()` ou `.readOnly()`. Personne ne peut l'écrire ; la réponse est la même pour chaque appelant. |

Les deux comportent `details.violations` indexé par le nom réseau envoyé. Appliqué lors de la
création, des requêtes `PATCH`/`PUT`, `/bulk`, `_batch`, des upserts, des opérations sur les champs
(`{ "salary": { "$inc": 1000 } }` désigne `salary` comme n'importe quelle valeur) et de la trame WebSocket `SAVE`.

Une opération sur un champ nécessite également le droit de `read` sur ce champ. Une opération sur un champ que vous pouvez
écrire mais pas lire est refusée avec `FIELD_NOT_READABLE` : savoir si elle a franchi un
seuil vous révélerait la valeur que vous n'êtes pas autorisé à voir.

### Un lien suit sa colonne clé

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un `belongsTo` et la colonne clé à laquelle il est lié constituent un seul et même champ sous deux
formes. Écrire `{ "reviewer": 7 }` est soumis à chaque règle de `reviewerId`
(sa règle d'écriture, `.readOnly()`, `.private()`, un horodatage de création, la colonne
tenant) ; envoyer les deux avec des valeurs différentes renvoie `400 VALIDATION_INVALID_VALUE`.
Un appelant qui ne peut pas lire `reviewerId` n'obtient pas `reviewer` dans un `include`,
et une entrée de filtre, de tri ou de `fields` le mentionnant renvoie `FIELD_NOT_READABLE` ;
derrière une clé `.private()`, la relation n'existe tout simplement pas pour les clients. Le
point de terminaison de schéma, OpenAPI et MCP décrivent les deux conjointement.

Il en va de même pour chaque relation, via tout ce que lit sa jointure : un
`hasMany` / `hasOne` lit la clé étrangère de la cible, un `via` lit chaque colonne sur laquelle ses
étapes se joignent, sur chaque table traversée. Un appelant qui ne peut pas lire l'une
de ces colonnes n'obtient pas la relation dans un `include` ou un `_count`, reçoit
`FIELD_NOT_READABLE` lors d'un filtrage ou d'un tri à travers celle-ci (une relation inconnue lorsque
la colonne est `.private()`), et ne la voit pas décrite.

`strictWrites: false` sur une table permet uniquement de transmettre au pilote une clé non déclarée par la
table. Cela n'assouplit jamais une règle sur une colonne déclarée, un horodatage,
le tenant, la clé, une cible de relation ou `_pivot`.

## Recherche

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

La recherche de repli — pour une table sans bloc `search` — effectue une correspondance `ILIKE` sur
vos colonnes textuelles, et ignore celles que l'appelant ne peut pas lire. Rien ne fuite
par ce biais.

Une table qui déclare **effectivement** un [bloc `search`](/docs/backend/search) est compilée
en une seule colonne `tsvector` générée et partagée par tous les appelants. Il n'existe pas de
variante par rôle, de sorte qu'une colonne restreinte mentionnée dans `search.fields` resterait
*accessible aux correspondances* pour des appelants qui ne peuvent jamais voir sa valeur — et récupérable terme
par terme. Le schéma est refusé avec cette combinaison : supprimez la colonne de
`search.fields` ou retirez la restriction de lecture. Une colonne `tenant` ne peut pas non plus faire l'objet d'une
restriction de lecture.

## Historique

L'[historique des entités](/docs/backend/history) stocke la ligne entière, et il est accessible à
quiconque peut lire la ligne — le critère d'accès est « pouvez-vous récupérer cette entité » et non « êtes-vous
un administrateur ». La règle de lecture s'applique donc également à chaque instantané stocké : l'entrée
est toujours listée, avec l'auteur et la date de la modification, et les colonnes masquées sont absentes
de ses `values`.

Le rétablissement (revert) n'est pas affecté. La route de rétablissement lit l'entrée stockée côté serveur, de sorte qu'un
appelant peut restaurer une version dont il ne peut pas voir tous les champs — exactement comme il
peut déjà écraser une ligne sans la lire en totalité.

## Ce qu'affiche le CMS

Rien à configurer. Le CMS lit via la même API, donc une colonne que
l'appelant ne peut pas lire n'arrive jamais et le formulaire ne l'affiche pas ; une colonne qu'il
ne peut pas écrire est refusée si un élément tente de l'envoyer. C'est une garantie
côté serveur, contrairement au masquage d'un champ dans le CMS, qui empêche seulement son
*rendu* tout en laissant la valeur dans le JSON.

## Types générés et OpenAPI

Les types `Row`, `Insert` et `Update` du SDK ont une structure unique pour chaque appelant —
il n'existe pas de `Row` qui conviendrait à la fois à un lecteur qui détient le rôle `hr` et à un lecteur qui ne l'a
pas — une règle de **rôle** ne les modifie donc pas. Une colonne `.private()` est absente
des trois, et une colonne `.readOnly()` est absente de `Insert` et `Update`. Les
[types inférés](/docs/schema/types/) suivent la même règle.

Le document OpenAPI énonce la règle plutôt que de prétendre s'adapter à chaque appelant.
Chaque colonne restreinte comporte `x-rebase-access` :

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un champ que personne ne peut lire est absent du schéma de lecture et des paramètres
de filtrage ; un champ que personne ne peut écrire est absent du schéma d'entrée. Les deux
directions correspondent à des schémas distincts et sont évaluées séparément, ainsi un token qu'un administrateur
envoie et ne relit jamais apparaît dans le corps de la requête et non dans la ligne.

## Écritures in-process

Les écritures in-process — `context.data` dans un hook, `rebase.dataAsAdmin` dans un hook,
une fonction ou une tâche cron — ne passent pas par la vérification d'écriture : `.readOnly()`,
un `access.write` par champ et `.private()` sont des règles propres à la frontière de l'API.
C'est ce qui rend la règle applicable en pratique : quelque chose doit pouvoir
stocker le hash du mot de passe. Ce qui reste en vigueur in-process, pour une colonne comme pour le
lien qui lui est associé : les horodatages serveur prévalent sur une valeur fournie, une ligne ne peut pas
changer de tenant, et sa clé ne peut pas être modifiée. La sécurité au niveau des lignes s'applique
partout.

Les lectures via `rebase.dataAsAdmin` disposent du rôle `admin`, donc une règle de rôle ne
leur masque rien. `[]` continue de s'appliquer — y compris pour `dataAsAdmin`. Utilisez
[`rebase.sql()`](/docs/backend/custom-functions) si vous avez besoin de la colonne brute.

## Validation

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`.access()` sur une colonne et `access` sur une relation lèvent une erreur lors du chargement
du module sauf si `read` et `write` sont des listes de noms de rôles non vides : une chaîne
de caractères là où une liste est attendue (`read: "admin"`) est refusée plutôt qu'interprétée comme
autre chose.

Les éléments suivants sont refusés lors de la compilation du schéma, avant que le serveur ne traite
la moindre requête :

- `.private()` et `.access()` sur la même colonne : ils relèvent du même mécanisme ;
- une colonne à lecture restreinte mentionnée dans le `search.fields` de la table, ou utilisée comme son
  champ `tenant` ;
- une clé primaire `.private()` : la clé est le moyen d'adresser chaque ligne.

Les *noms* de rôles ne sont pas vérifiés par rapport à un ensemble défini : les rôles sont des données applicatives, créées
et supprimées pendant que le serveur s'exécute. Une faute de frappe dans l'un d'eux donne un champ que personne ne peut lire, ce
qui constitue un comportement d'échec sécurisé (fail-safe).

## Voir aussi

- [Sécurité au niveau des lignes](/docs/collections/security-rules/) — quelles lignes un appelant peut atteindre
- [Colonnes](/docs/schema/columns/) — tous les modificateurs de colonne
- [Codes d'erreur](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`

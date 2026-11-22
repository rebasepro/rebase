---
sourceHash: 45b2459dff0e5ec4
title: Modification de schéma en direct
description: Créez et modifiez des tables sur un backend en cours d'exécution — la modification est écrite dans backend/schema, d'abord commitée dans votre dépôt, puis appliquée.
---

L'éditeur de schéma source uniquement, `/api/admin/schema-editor/*`, réécrit les
fichiers de tables dans `backend/schema` et ne touche à rien d'autre. Cela fonctionne sur votre
machine et nulle part ailleurs : les fichiers d'un serveur déployé sont reconstruits à partir de votre
dépôt à chaque déploiement, de sorte qu'une modification effectuée à cet endroit serait ignorée lors du
déploiement suivant.

La modification de schéma en direct est la réponse à cela. Elle **commite la modification dans votre
dépôt, puis applique le DDL** — la modification survit ainsi au déploiement suivant,
car le déploiement est construit à partir de celui-ci. L'éditeur RLS de Studio enregistre les
politiques d'une table via ces routes — planifiées, affichées sous forme de SQL, confirmées, puis
appliquées — et un script ou un agent disposant du scope peut envoyer les mêmes modifications.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status et plan nécessitent le scope `schema:read`, et apply nécessite `schema:write`, comme
toute autre surface `/api/admin` qui spécifie un scope. Un administrateur dispose des deux.
L'application nécessite également une chose de plus que le scope — voir [Qui peut appliquer](#qui-peut-appliquer).

## Les modifications : `TablePatch`

Chaque route qui modifie le schéma prend le même corps, `{ patches }` : une liste
de modifications, chacune désignant sa table par son slug. Le type est `TablePatch`, issu de
`@rebasepro/types`.

| `op` | Ce qu'il écrit dans `backend/schema` |
|---|---|
| `createTable` | un nouveau fichier `backend/schema/<name>.ts` contenant la table, exporté depuis `index.ts` |
| `deleteTable` | supprime le fichier et son export |
| `addColumn` `{ key, column, before? }` | une colonne, avant celle désignée par `before`, ou en dernier |
| `changeColumn` `{ key, column }` | réécrit la chaîne de constructeur d'une colonne ; un `.transform()` écrit dessus est conservé |
| `renameColumn` `{ key, to, column }` | renomme la clé, en conservant la colonne SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | supprime ou réordonne une colonne |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | une entrée `rel.*` ; le `target` de la relation est un slug |
| `setRls` `{ rls }` | la posture : `"admin-only"`, `"inherit"` ou une liste de règles |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | une règle de la liste |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` ou `metadata` ; `null` la supprime |

Une colonne transite sous forme de définition — le type Postgres sous forme de `{ kind: … }`, et les
modificateurs sous forme d'indicateurs (flags) — sans ses hooks `.transform()`, qui sont du code et restent
là où ils sont écrits :

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Seul le code désigné par une modification est réécrit. Tout le reste demeure inchangé —
imports, commentaires, formatage, colonne partagée depuis un autre module. L'éditeur
refuse, en nommant l'expression, toute modification qui atteint *l'intérieur* de quelque chose défini
dans le code : une table construite avec un spread, une colonne construite par un helper, des règles conservées dans
une variable, une clé calculée, une colonne dont la forme JSON contient des transformations. De plus, il
ne renomme jamais un slug, une table, un schéma ou le nom d'une définition (cela déplace des
données : écrivez une migration), ne supprime jamais la dernière règle (utilisez `setRls` avec
`"admin-only"`), refuse `rls` sur une vue et refuse de supprimer une table ciblée par d'autres
relations. Une modification dont le résultat ne compile pas est refusée avec
`SCHEMA_EDIT_DOES_NOT_COMPILE` accompagné des problèmes du compilateur. Rien n'est écrit
en cas de refus.

L'apparence d'une table dans le panneau d'administration — libellés, icônes, groupes, modes d'affichage, couleurs
d'énumérations — n'est pas une modification de schéma : cela réside dans `frontend/src/cms` et les
préférences enregistrées du panneau, et rien de tout cela ne transite dans un `TablePatch`.

`$ADMIN_TOKEN` est un jeton d'accès — l'`accessToken` renvoyé lors d'une connexion — pour un
compte disposant de `schema:read` : un administrateur, ou un rôle qui le déclare. Rien sur
la machine ne le définit à votre place.

## Planifier avant d'appliquer

`/plan` n'a pas d'effets secondaires. Envoyez les modifications en POST, et il vous indiquera leur signification :

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"patches":[{"op":"addColumn","table":"posts","key":"subtitle","column":{"type":{"kind":"text"}}}]}'
```

```json
{
  "applicable": true,
  "verdict": "safe",
  "changes": [
    { "kind": "add-property", "verdict": "safe", "collection": "posts",
      "property": "subtitle", "detail": "New optional property subtitle …" }
  ],
  "statements": ["ALTER TABLE \"public\".\"posts\" ADD COLUMN IF NOT EXISTS \"subtitle\" TEXT;"],
  "files": ["backend/schema/posts.ts", "backend/src/schema.generated.ts"],
  "message": "…the commit message the apply would use…",
  "withheldConstraints": [],
  "followUp": []
}
```

`files` représente chaque fichier commité par l'application : la source de la table, lorsque le backend
peut l'écrire, puis le schéma généré. Les enregistrements de modifications du planificateur conservent
leurs noms de protocole (`add-property`, `collection`, `property`).

Ce n'est pas une simple commodité. Deux des trois verdicts sont des refus, et l'un
d'eux est un refus que vous ne découvririez autrement qu'en appuyant sur le bouton sur une
base de données en production.

## Les trois verdicts

| Verdict | Signification |
|---|---|
| `safe` | Le chemin ensure au démarrage l'exprime et le résultat correspond à votre configuration. Appliqué. |
| `diverges` | Elle s'applique *en partie*, laissant une base de données qui ne correspond pas à votre configuration — sans qu'aucun rapport ne le signale. Refusé. |
| `needs-migration` | Le chemin ensure ne peut pas du tout l'exprimer. Refusé. |

`diverges` est celui qui mérite d'être bien compris, car ces modifications semblent avoir
fonctionné :

- **Une colonne `.notNull()` ajoutée à une table qui contient déjà des lignes** arrive
  **nullable**. `NOT NULL` est vérifié par rapport à chaque ligne déjà présente, et les lignes
  écrites avant que la colonne n'existe n'ont pas de valeur pour celle-ci. Sur une table **vide**,
  il n'y a rien à vérifier, la contrainte est donc appliquée et cela est
  `safe`.
- **Rendre une colonne existante `.notNull()`** présente la même dynamique : `SET NOT NULL`
  analyse toute la table, c'est donc `safe` sur une table vide et `diverges` sur une table peuplée
  jusqu'à ce que vous effectuiez un remplissage rétroactif (backfill).

Deux modifications qui étaient auparavant `diverges` sont désormais `safe`, car le chemin ensure
les prend en charge :

- **Une valeur ajoutée à un enum existant** s'applique via
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Auparavant, elle était ignorée avec l'ensemble
  du type, et la première ligne utilisant la nouvelle valeur était rejetée par un type qui
  n'en avait jamais entendu parler.
- **Assouplir une colonne `.notNull()`** supprime le `NOT NULL`. Il était auparavant laissé en
  place, de sorte que les écritures omettant la colonne continuaient d'échouer.

### Contraintes demandées et non appliquées

Une modification peut être applicable tout en laissant non appliquée une contrainte requise par
votre configuration — c'est le cas d'une colonne `.notNull()` sur une table déjà peuplée. Il ne
s'agit pas d'un refus, elle n'apparaît donc pas dans `changes` ; elle apparaît dans
`withheldConstraints`, accompagnée de l'obstacle et de la façon de le lever :

```json
{
  "withheldConstraints": [
    {
      "target": "public.posts.author",
      "kind": "not-null",
      "reason": "\"author\" is required, but \"public.posts\" already holds rows …",
      "remedy": "Backfill the column, then apply this again."
    }
  ]
}
```

Le chemin ensure au démarrage signale la même chose sous la forme d'un avertissement. Avant l'existence
de ce mécanisme, une contrainte retenue l'était en silence.

`needs-migration` couvre tout ce que le chemin ensure ne peut pas faire : supprimer une
table ou une colonne, modifier le type d'une colonne (un entier devenant booléen, une chaîne
devenant un enum, le type d'élément d'un tableau, la longueur d'un varchar), renommer une
colonne, modifier une clé primaire, supprimer une valeur d'enum, rendre une colonne existante
unique, et modifier une relation — son type, sa cible, sa `localKey`, son
`onDelete`. Un `hasMany` ou `hasOne` dont la colonne de liaison n'est créée par rien est
également refusé. Chaque refus indique la modification en cause et ce qu'il convient de faire à la place.

Le verdict est déduit du schéma produit par chaque côté — le même plan à partir duquel
`schema.generated.ts` et `db push` sont générés — ainsi, une modification qui altère la
base de données ne peut pas être signalée comme une absence de changement. Deux modifications qui ressemblent à des changements
et ne sont pas refusées :

- **Renommer la clé d'une colonne tout en conservant sa colonne SQL** (`renameColumn`,
  qui écrit l'ancien nom comme premier argument du builder, `col.text("old_name")`) ne déplace aucune donnée. C'est `safe` ; les clients d'API lisent le nouveau nom.
- **Définir, modifier ou supprimer une valeur par défaut** ne lie que les écritures futures. C'est
  `safe`, et appliqué avec `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Modifier la source uniquement

Une modification refusée peut tout de même être écrite dans `backend/schema` et commitée,
laissant la base de données en l'état — la suppression d'une colonne que vous ne servez plus est
le cas classique. Envoyez `/apply` avec `"sourceOnly": true`. Rien n'est exécuté ; le message
de commit indique ce que la base de données conserve, par exemple
`chore(schema): remove sku from products (source only — column products.sku kept)`,
et chaque modification dans le plan comporte une phrase `sourceOnly` précisant ce qu'elle
laisse derrière elle — y compris lorsqu'une colonne laissée en arrière est `NOT NULL` sans
valeur par défaut, ce qui fait échouer toute insertion ultérieure jusqu'à ce qu'elle soit supprimée ou rendue
nullable. Une modification qui n'en possède pas (déplacement d'une clé primaire, relation dont la colonne
de liaison n'est créée par rien) ne peut pas être écrite dans la source seule.

Sur un déploiement qui ne modifie rien dans sa base de données (`REBASE_PROVISION=false`),
aucune modification n'est appliquée depuis le panneau, donc chaque changement emprunte cette voie : le
bouton principal de la boîte de dialogue indique **Commit** et envoie `"sourceOnly": true`, et le
processus qui modifie cette base de données applique le schéma.

Supprimer une table suit le même chemin : `/apply` avec une
modification `deleteTable` et `"sourceOnly": true` supprime le fichier de la table et son
export dans `index.ts` et commite les deux ; la table et ses lignes restent dans la
base de données. L'opération est refusée tant qu'une relation d'une autre table la cible, en nommant
cette table — la supprimer empêcherait le schéma de compiler.

## Ce qui est commité

Pas seulement le fichier de table. Le schéma Drizzle est généré à partir de celui-ci, et une
version obsolète casserait le déploiement suivant ; les deux sont donc inclus dans le même commit :

- `backend/schema/<name>.ts` — la table elle-même, et `backend/schema/index.ts` lorsqu'une table est créée ou supprimée
- `backend/src/schema.generated.ts` — le schéma Drizzle

Ces chemins sont relatifs à votre **projet**, et non à votre dépôt. Lorsque les
deux coïncident — un projet `rebase init`, ce qui est le cas habituel — vous n'avez pas
à vous en soucier. Lorsque votre projet se trouve dans un sous-répertoire d'un dépôt plus
vaste, les chemins sont préfixés par celui-ci, déterminé en remontant depuis votre
répertoire schema jusqu'au `rebase.json` le plus proche. Un projet sans
`rebase.json` conserve les chemins simples.

Aucun SQL n'est inclus dans le commit. `rebase db push` et `rebase db generate` écrivent le
leur à partir des tables à chaque exécution, dans `.rebase/sql/`, qui est ignoré par git (gitignored).

Le message de commit décrit le changement plutôt que de simplement l'annoncer, et il est
attribué à la personne qui l'a effectué, via le nom d'affichage et l'adresse e-mail du compte
(un utilisateur ne possédant ni l'un ni l'autre est commité en tant que `<uid>@users.noreply.rebase.pro`).

Un changement de schéma accompagné d'un auteur et d'un diff dans l'historique de votre projet est quelque chose
que ni Firebase ni Supabase ne vous offrent — leurs modifications de tables sont invisibles pour
votre dépôt.

## Qui peut appliquer

Détenir `schema:read` suffit pour **planifier**. La planification n'a pas d'effets secondaires, et un
job de CI qui demande si une modification de schéma proposée est applicable en est un bon cas
d'usage.

L'application est un second privilège, car appliquer écrit un commit et qu'un commit
porte un auteur :

| Appelant | Plan | Apply |
|---|---|---|
| Une personne connectée détenant `schema:write` | oui | oui |
| Une clé d'API détenant `schema:read` / `schema:write` | oui | non |
| La clé de service du serveur | oui | non |

Un identifiant n'est pas un auteur. `api-key:7c3f…` dans votre environnement de CI n'est pas
une personne, et lui permettre d'écrire dans votre dépôt produit exactement cet
historique sans attribution que cette fonctionnalité a pour but de remplacer.

Si vous souhaitez automatiser les modifications de schéma — par exemple pour un pipeline de migration —,
activez-le délibérément :

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

ou `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Le commit est alors attribué
à l'identifiant par son nom — `Rebase API key (7c3f)` — de sorte que la lecture de `git log` un
mois plus tard vous indique toujours quelles modifications ont été faites par une personne.

`GET /api/admin/schema/status` indique ce que *vous* avez le droit de faire, et pas seulement ce que le
serveur prend en charge, afin qu'un panneau puisse désactiver le contrôle et en expliquer la raison au lieu de
vous essuyer un refus une fois votre décision prise :

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## Si votre projet conserve des migrations versionnées

Appliquer ici n'écrit **pas** de migration, et ne le peut pas : une migration est au format d'Atlas
avec un fichier d'intégrité, forgée par un binaire externe sur une base de données temporaire,
et un serveur en cours d'exécution ne dispose ni de l'un ni de l'autre.

Ce qu'il commite en revanche, c'est le fichier de table, et c'est à partir de celui-ci que `rebase db generate`
écrit la migration. La migration n'est donc qu'à une seule commande :

```bash
rebase db generate
```

Le plan et le résultat l'indiquent tous deux lorsque votre projet a des migrations, car
sinon l'échec est silencieux : votre base de données comporte le changement et votre dépôt
le décrit, mais le prochain environnement construit en rejouant les migrations ne l'aura pas,
sans qu'aucun message n'ait prévenu.

Un projet provisionné par boot-ensure — le runtime managé, ainsi que tout auto-hébergement
conservant `REBASE_MIGRATE_ON_BOOT` à sa valeur par défaut — n'a besoin d'aucune migration. Ses
tables constituent le schéma, et le redémarrage suivant réconcilie le tout.

## Commiter d'abord, appliquer ensuite

L'ordre compte et n'est pas arbitraire.

Si le DDL s'exécutait en premier et que le commit échouait, votre base de données contiendrait une colonne
non décrite par votre dépôt. Le chemin ensure ne supprimant jamais rien, le
déploiement suivant ne la retirerait pas et ne la mentionnerait pas non plus — une colonne invisible, absente
de vos tables, jusqu'à ce que quelqu'un parte à sa recherche.

Commiter d'abord échoue dans l'autre sens : le dépôt décrit quelque chose que
la base de données ne possède pas encore. C'est l'état ordinaire de tout projet entre
une modification et un déploiement, et le boot le réconcilie au démarrage suivant.

Une application ayant échoué n'est donc **pas une erreur**. La réponse l'indique :

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Les règles prennent effet dans la même application

Une modification du `rls` d'une table (ou une nouvelle table) est appliquée lors de la même application : les
politiques des tables modifiées sont écrites dans la base de données juste après le DDL,
et la réponse indique ce qui s'est passé sous `policies` :

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Lorsque les politiques ne peuvent pas être écrites — un backend qui ne peut pas provisionner
(`provision.tables` désactivé) ou un pilote dépourvu de cette capacité —, le statut est
`"deferred"` ; lorsque leur écriture échoue, il est `"failed"`, accompagné de l'erreur. Les deux
portent le message « Rules saved to source; they take effect on the next
deploy. », et le panneau continue d'afficher les règles que Postgres applique jusqu'alors,
jamais des règles qui ne sont pas en vigueur.

Les hooks modifiés dans la source prennent également effet lors de l'application : le serveur exécute les
tables compilées du schéma modifié sans redémarrage.

## Servi sans redémarrage

Une modification appliquée depuis le Studio est servie immédiatement. Le pilote Postgres relit
les tables modifiées depuis la base de données et les remplace à chaud : l'API de données,
les includes, les hooks et le temps réel voient une nouvelle table, colonne, relation ou table de jonction
sans redémarrage, et une nouvelle table obtient ses privilèges (grants) et sa capture de modifications. La
réponse l'indique sous `serving` :

```json
{ "serving": { "status": "now" } }
```

Sur un déploiement dont les tables sont dérivées de la base de données (sans
`backend/schema`), ou avec un pilote incapable de rafraîchir ses tables, la
base de données et la source intègrent la modification mais le processus continue de servir
les tables avec lesquelles il s'est ouvert. Le statut est alors `"after-restart"`, avec un `message`
que le compte-rendu du Studio affiche sous forme d'avertissement ; redémarrez le processus pour servir la
modification.

## Quand le fichier a été modifié pendant l'édition

Une modification est préparée par rapport aux fichiers tels qu'ils sont. Si l'un d'eux change sur
le disque avant que la modification ne soit appliquée — enregistrement dans l'IDE, autre processus —, l'application
n'écrit rien et répond 409 `SCHEMA_EDIT_STALE_FILE`. Effectuez à nouveau la modification
sur le fichier dans son état actuel.

## Où cela fonctionne

La modification de schéma en direct réécrit `backend/schema` avec le même éditeur que celui utilisé par les
sauvegardes en source uniquement du panneau (nécessite l'installation de `ts-morph`). La provenance de cette
source détermine où elle s'exécute :

- **Sur le disque** (`schemaDir`, par défaut) : elle s'exécute là où l'éditeur en source uniquement
  s'exécute. Cet éditeur est désactivé sous `NODE_ENV=production`, sauf si le serveur
  définit `schemaEditor: true`.
- **Dans un dépôt que vous spécifiez** (`liveSchema.repository`, ou
  `REBASE_LIVE_SCHEMA_REPOSITORY` pour un bundle) : la source est lue depuis
  GitHub et la modification y est commitée en retour, de sorte qu'elle s'exécute n'importe où,
  production comprise. C'est l'option d'activation pour un bundle compilé.

| Déploiement | Fonctionne |
|---|---|
| `rebase dev` sur votre machine | oui |
| Auto-hébergement avec le projet et son arbre de travail git montés | oui, quand `NODE_ENV` n'est pas `production`, ou avec `schemaEditor: true` |
| Un bundle compilé : un auto-hébergement servant un build, ou l'image publiée | seulement s'il l'active avec `REBASE_LIVE_SCHEMA_REPOSITORY` — voir [À partir d'un bundle compilé](#à-partir-dun-bundle-compilé) |
| Tout serveur ayant `liveSchema.repository` configuré | oui, `NODE_ENV=production` inclus |

Un bundle est un résultat compilé, il ne contient donc pas de source `backend/schema`, et
le runtime qui le sert désactive l'éditeur source uniquement. À moins qu'il ne spécifie un
dépôt, `/api/admin/schema/status` répond `enabled: false` avec le code
`SCHEMA_EDITOR_DISABLED` : modifiez `backend/schema` en développement, commitez et
déployez.

### À partir d'un bundle compilé

Un bundle n'a pas de code propre à configurer, il s'active donc via des variables d'environnement.
Rien ne change pour un bundle qui ne les définit pas.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

La liste complète se trouve dans [Configuration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Un dépôt spécifié sans identifiant utilisable (aucun, les deux types, une GitHub
App incomplète), ou avec une valeur qui n'est pas `owner/name`, refuse de démarrer plutôt que de servir
un éditeur qui échouerait dès qu'un utilisateur appuie sur Apply. Il en va de même pour la variable supprimée
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, avec un message mentionnant
`REBASE_LIVE_SCHEMA_PATH`, et pour un chemin qui sortirait du dépôt.

Ce qui reste identique lorsqu'elle est activée :

- Il s'agit d'une surface `/api/admin` : aucune réponse sans `schema:read`, et
  `/apply` nécessite `schema:write` et une personne physique (voir [Qui peut appliquer](#qui-peut-appliquer)).
- La cible d'écriture est uniquement le dépôt que vous avez désigné. L'éditeur source uniquement,
  qui écrit les fichiers à côté du processus, reste désactivé.
- Chaque modification est planifiée, présentée, commitée, puis appliquée, exactement comme sur votre
  machine.

Le processus qui a appliqué la modification la sert immédiatement : ses routes REST, les
descripteurs `GET /api/schema/tables` et le panneau d'administration suivent la modification
sans redémarrage. Les autres réplicas, ainsi que ce processus après un redémarrage, servent les
tables avec lesquelles le bundle a été compilé jusqu'à ce que votre pipeline construise et déploie le
commit.

Ainsi, une modification attend que la précédente soit servie. Une modification planifiée par rapport à
des tables pour lesquelles le dépôt est déjà en avance commiterait des fichiers de schéma générés
omettant la modification précédente. Chaque application génère donc
`schema.generated.ts` à partir des tables que ce processus sert et le compare à
la copie du dépôt. S'ils diffèrent, l'application est refusée avec
`SCHEMA_CHANGE_FAILED`, en désignant le fichier, jusqu'à ce qu'un processus exécutant ce commit
remplace celui-ci. La vérification lit le dépôt et non la mémoire de ce processus ;
elle reste donc valable après un redémarrage, sur l'ensemble des réplicas, et pour un changement qu'un développeur
a poussé qui n'est pas encore déployé. La planification reste accessible pendant ce temps.

Les copies diffèrent également lorsque le fichier a été généré par une autre version de Rebase,
reformaté ou modifié à la main. Si rien n'est en attente de déploiement, exécutez
`rebase schema generate` avec la version qu'utilise le déploiement, commitez le
résultat et déployez-le. Les fins de ligne et les espaces en fin de ligne ne sont pas considérés comme une
différence.

### Commiter dans un dépôt distant

`liveSchema.repository` fait en sorte que le serveur commite chaque modification dans un dépôt GitHub
via la Git Data API au lieu d'exécuter `git commit` dans un
arbre de travail (working tree). Cela ne dépend pas de l'activation de l'éditeur en source uniquement : avec un
dépôt configuré, la modification en direct fonctionne sous `NODE_ENV=production` et avec
`schemaEditor: false`, car rien n'est écrit sur cette machine. Un bundle
le configure via les variables mentionnées ci-dessus.

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where backend/schema lives in that repository.
            // Defaults to "backend/schema".
            schemaPath: "backend/schema",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

Le répertoire schema est alors lu depuis le dépôt, réécrit avec le
même éditeur que celui exécuté localement, et ce qui a changé est commité en retour via la
Git Data API : un blob par fichier, un tree, un commit et une mise à jour de référence (ref update). Rien n'est
cloné et rien n'est laissé sur le disque. L'intégralité du répertoire est lue, pas seulement le
fichier modifié, de sorte qu'une relation peut cibler une autre table et la suppression d'une table fonctionne
comme localement : refusée tant que la relation d'une autre table la cible, et
retirée de `index.ts` dans le même commit. Seul `backend/schema` est récupéré ;
ainsi, un fichier de table qui importe quelque chose en dehors de ce dossier ne peut pas être modifié de cette façon.

`auth` prend en charge un jeton ou une installation GitHub App :

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Utilisez le jeton pour un projet unique commitant dans un dépôt que vous possédez déjà —
créer une App pour que votre propre serveur puisse y commiter représente beaucoup de formalités pour
un identifiant d'une seule ligne. Utilisez l'App pour un plan de contrôle gérant une seule clé à travers
de nombreux projets, ce que fait Rebase Cloud : une seule App, une installation par
projet, et aucun secret par client à renouveler.

Le jeton requiert les permissions `contents: read and write` sur ce dépôt, et rien d'autre.

Sans `liveSchema.repository`, le commit est un simple `git commit` dans l'arbre
de travail qui contient `schemaDir` : rien à authentifier, pas de jeton, pas de
réseau.

Deux éléments rendent son utilisation sûre sur un dépôt dans lequel quelqu'un d'autre
travaille :

- Il n'indexe (stage) **que** les fichiers qu'il a générés. Un commit de schéma qui embarquerait du
  travail à moitié terminé serait impossible à relire, et l'opération refuse
  catégoriquement de s'exécuter si l'arbre contient déjà l'un de ses propres fichiers modifié.
- La voie distante ne force jamais la mise à jour d'une référence (`force-update`). Si du contenu a été intégré pendant
  la construction du commit, la mise à jour est rejetée — perdre silencieusement
  le commit de quelqu'un est pire que d'échouer.

## Limites

- Uniquement des modifications additives. Tout le reste est refusé avec un motif, car le
  chemin ensure est la seule chose qui modifie un schéma et il ne peut qu'ajouter.
- Aucun fichier de migration n'est écrit. Un projet provisionné par boot-ensure n'en a pas besoin ;
  un projet provisionné par des migrations doit exécuter `rebase db generate`, qui en
  génère un via Atlas avec le hachage d'intégrité requis par Atlas.
- Postgres uniquement. La capacité est détectée sur le pilote, et un pilote
  dépourvu de celle-ci répond `SCHEMA_EDITING_UNSUPPORTED`.
- Un déploiement dont les tables sont dérivées de la base de données sert une modification
  appliquée après le redémarrage suivant (`serving.status: "after-restart"`, voir
  [Servi sans redémarrage](#servi-sans-redémarrage)).

## Voir aussi

- [Génération de schéma](/docs/cli/schema/) — les mêmes modifications en ligne de commande
- [Tables](/docs/schema/) — ce que l'éditeur réécrit
- [Studio](/docs/studio/) — le panneau derrière lequel se trouvent ces routes

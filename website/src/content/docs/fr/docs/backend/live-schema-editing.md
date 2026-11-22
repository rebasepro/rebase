---
sourceHash: 972a11a8dc0defac
title: Édition de schéma en direct
description: Créez et modifiez des tables sur un backend en cours d'exécution — la modification est écrite dans backend/schema, d'abord commitée dans votre dépôt, puis appliquée.
---

L'éditeur de schéma du panneau d'administration réécrit les fichiers de table dans
`backend/schema`. Cela fonctionne sur votre machine et nulle part ailleurs : les
fichiers d'un serveur déployé sont reconstruits à partir de votre dépôt à chaque
déploiement, de sorte qu'une modification effectuée à cet endroit serait ignorée
lors du déploiement suivant.

L'édition de schéma en direct est la réponse à cela. Elle **commite la modification dans votre
dépôt, puis applique le DDL** — ainsi, la modification survit au déploiement suivant,
car le déploiement est construit à partir de celle-ci.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status et plan nécessitent le scope `schema:read`, et apply nécessite `schema:write`,
comme toute autre surface de `/api/admin` qui spécifie un scope. Un administrateur
dispose des deux. L'application nécessite également une chose de plus que le scope —
voir [Qui peut appliquer](#qui-peut-appliquer).

## Les modifications : `TablePatch`

Chaque route qui modifie le schéma accepte le même corps, `{ patches }` : une liste
de modifications, chacune désignant sa table par son slug. Le type est `TablePatch`,
issu de `@rebasepro/types`.

| `op` | Ce qu'il écrit dans `backend/schema` |
|---|---|
| `createTable` | un nouveau `backend/schema/<name>.ts` contenant la table, exportée depuis `index.ts` |
| `deleteTable` | supprime le fichier et son export |
| `addColumn` `{ key, column, before? }` | une colonne, avant celle désignée par `before`, ou en dernier |
| `changeColumn` `{ key, column }` | réécrit la chaîne du builder d'une colonne ; un `.transform()` défini dessus est conservé |
| `renameColumn` `{ key, to, column }` | renomme la clé, en conservant la colonne SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | supprime ou réordonne une colonne |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | une entrée `rel.*` ; la `target` de la relation est un slug |
| `setRls` `{ rls }` | la posture : `"admin-only"`, `"inherit"` ou une liste de règles |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | une règle de la liste |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` ou `metadata` ; `null` la supprime |

Une colonne est transmise sous forme de définition — le type Postgres en tant que
`{ kind: … }`, et les modificateurs sous forme de drapeaux — sans ses hooks `.transform()`,
qui constituent du code et restent là où ils sont écrits :

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Seul le code désigné par une modification est réécrit. Tout le reste reste tel quel —
imports, commentaires, formatage, une colonne partagée depuis un autre module. L'éditeur
refuse, en nommant l'expression, une modification qui atteint l'*intérieur* de
quelque chose défini dans le code : une table construite avec un spread, une colonne
construite par un helper, des règles contenues dans une variable, une clé calculée, une
colonne dont la structure JSON comporte des transformations. Il ne renomme également
jamais un slug, une table, un schéma ou le nom d'une définition (cela déplace des
données : écrivez une migration), ne supprime jamais la dernière règle (par exemple
`setRls` avec `"admin-only"`), refuse `rls` sur une vue et refuse la suppression d'une
table ciblée par d'autres relations. Une modification dont le résultat ne compile pas
est refusée avec `SCHEMA_EDIT_DOES_NOT_COMPILE` accompagné des erreurs du compilateur.
Rien n'est écrit en cas de refus.

L'apparence d'une table dans le panneau d'administration — libellés, icônes, groupes,
modes de vue, couleurs d'énumérations — n'est pas une modification de schéma : elle réside
dans `frontend/src/cms` et dans les préférences enregistrées du panneau, et rien de tout
cela ne transite dans un `TablePatch`.

`$ADMIN_TOKEN` est un jeton d'accès — l'`accessToken` renvoyé lors de la connexion —
pour un compte disposant de `schema:read` : un administrateur ou un rôle qui le déclare.
Rien sur la machine ne le définit à votre place.

## Planifier avant d'appliquer

`/plan` n'a aucun effet secondaire. Envoyez les modifications en POST, et il vous
indique ce qu'elles impliquent :

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

`files` représente chaque fichier que l'apply commite : la source de la table,
lorsque le backend peut l'écrire, puis le schéma généré. Les enregistrements de
modification du planificateur conservent leurs noms de transit réseau (`add-property`,
`collection`, `property`).

Il ne s'agit pas d'une simple commodité. Deux des trois verdicts sont des refus, et l'un
d'eux est un refus que vous ne découvririez autrement qu'en appuyant sur le bouton sur
une base de données en production.

## Les trois verdicts

| Verdict | Signification |
|---|---|
| `safe` | Le chemin ensure au démarrage l'exprime et le résultat correspond à votre configuration. Appliqué. |
| `diverges` | Il s'applique *en partie*, laissant une base de données qui ne correspond pas à votre configuration — et rien ne le signale. Refusé. |
| `needs-migration` | Le chemin ensure ne peut pas du tout l'exprimer. Refusé. |

`diverges` est celui qui mérite d'être bien compris, car ces modifications semblent
avoir fonctionné :

- **Une colonne `.notNull()` ajoutée à une table contenant déjà des lignes** arrive
  en tant que **nullable**. `NOT NULL` est vérifié par rapport à chaque ligne déjà
  présente, et les lignes écrites avant que la colonne n'existe n'ont aucune valeur
  pour celle-ci. Sur une table **vide**, il n'y a rien à vérifier, la contrainte est
  donc appliquée et cela est considéré comme `safe`.
- **Rendre une colonne existante `.notNull()`** présente la même logique : `SET NOT NULL`
  analyse toute la table, c'est donc `safe` sur une table vide et `diverges` sur une table
  peuplée jusqu'à ce que vous effectuiez un remplissage rétroactif (backfill).

Deux modifications qui étaient autrefois `diverges` sont désormais `safe`, car le
chemin ensure les prend en charge :

- **Une valeur ajoutée à un enum existant** s'applique via
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Auparavant, elle était ignorée avec l'ensemble
  du type, et la première ligne utilisant la nouvelle valeur était rejetée par un type
  qui n'en avait jamais eu connaissance.
- **Assouplir une colonne `.notNull()`** supprime le `NOT NULL`. Il était auparavant
  laissé en place, de sorte que les écritures omettant la colonne continuaient d'échouer.

### Contraintes demandées et non appliquées

Une modification peut être applicable tout en laissant non appliquée une contrainte
demandée par votre configuration — c'est le cas d'une colonne `.notNull()` sur une table
déjà peuplée. Il ne s'agit pas d'un refus, elle n'apparaît donc pas dans `changes` ; elle
apparaît dans `withheldConstraints`, avec l'obstacle rencontré et ce qui permettrait de
le lever :

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

Le chemin ensure au démarrage signale la même chose sous forme d'avertissement. Avant
l'existence de cette fonctionnalité, une contrainte retenue l'était silencieusement.

`needs-migration` couvre tout ce que le chemin ensure ne peut pas faire : supprimer une
table ou une colonne, changer le type d'une colonne (un toggle d'entier, une chaîne
devenant un enum, le type d'élément d'un tableau, la longueur d'un varchar), renommer
une colonne, changer une clé primaire, supprimer une valeur d'enum, rendre une colonne
existante unique, et modifier une relation — son type, sa cible, sa `localKey`, son
`onDelete`. Un `hasMany` ou `hasOne` dont la colonne de liaison n'est créée par rien
est également refusé. Chaque refus mentionne la modification et ce qu'il convient de
faire à la place.

Le verdict est déduit du schéma produit de chaque côté — le même plan à partir duquel
`schema.generated.ts` et `db push` sont générés — ainsi, une modification qui altère la
base de données ne peut pas être signalée comme une absence de changement. Deux
modifications qui ressemblent à des changements et ne sont pas refusées :

- **Renommer la clé d'une colonne tout en conservant sa colonne SQL** (`renameColumn`,
  qui écrit l'ancien nom comme premier argument du builder, `col.text("old_name")`) ne
  déplace aucune donnée. C'est `safe` ; les clients de l'API liront le nouveau nom.
- **Définir, modifier ou supprimer une valeur par défaut** ne lie que les écritures
  futures. C'est `safe`, et appliqué avec `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Modifier la source uniquement

Une modification refusée peut tout de même être écrite dans `backend/schema` et commitée,
en laissant la base de données telle quelle — la suppression d'une colonne que vous ne
servez plus en est le cas typique. Envoyez un POST sur `/apply` avec `"sourceOnly": true`.
Rien n'est exécuté ; le message de commit indique ce que la base de données conserve,
par exemple
`chore(schema): remove sku from products (source only — column products.sku kept)`,
et chaque modification du plan comporte une phrase `sourceOnly` précisant ce qu'elle
laisse derrière elle — y compris lorsqu'une colonne laissée de côté est `NOT NULL` sans
valeur par défaut, ce qui fait échouer toute insertion ultérieure jusqu'à ce qu'elle
soit supprimée ou rendue nullable. Une modification sans cela (le déplacement d'une
clé primaire, une relation dont la colonne de liaison n'est créée par rien) ne peut
pas être écrite uniquement dans la source.

Sur un déploiement qui ne modifie rien dans sa base de données (`REBASE_PROVISION=false`),
aucun changement n'est appliqué depuis le panneau, donc chaque modification suit cette
voie : le bouton principal de la boîte de dialogue indique **Commit** et envoie
`"sourceOnly": true`, et le processus chargé de modifier cette base de données applique
le schéma.

Supprimer une table depuis le panneau d'administration suit le même chemin : `/apply`
avec une modification `deleteTable` et `"sourceOnly": true` supprime le fichier de la
table et son export dans `index.ts` et commite les deux ; la table et ses lignes restent
dans la base de données. L'opération est refusée tant qu'une relation d'une autre table
la cible, en nommant cette table — la supprimer empêcherait le schéma de compiler.

## Ce qui est commité

Pas seulement le fichier de la table. Le schéma Drizzle en est généré, et un
schéma obsolète casserait le déploiement suivant ; les deux figurent donc dans le
même commit :

- `backend/schema/<name>.ts` — la table elle-même, et `backend/schema/index.ts` lorsqu'une table est créée ou supprimée
- `backend/src/schema.generated.ts` — le schéma Drizzle

Ces chemins sont relatifs à votre **projet**, et non à votre dépôt. Lorsque les
deux sont identiques — un projet `rebase init`, ce qui est le cas habituel —, il n'y
a rien de particulier à anticiper. Lorsque votre projet se trouve dans un sous-répertoire
d'un dépôt plus vaste, les chemins sont préfixés par celui-ci, déterminé en remontant
depuis votre répertoire de schéma jusqu'au `rebase.json` le plus proche. Un projet
sans `rebase.json` conserve les chemins simples.

Aucun SQL ne va dans le commit. `rebase db push` et `rebase db generate` écrivent le
leur à partir des tables à chaque exécution, dans `.rebase/sql/`, qui est ignoré par git.

Le message de commit décrit le changement plutôt que de simplement l'annoncer, et
est attribué à la personne qui l'a effectué, via le nom d'affichage et l'adresse e-mail
du compte (un utilisateur ne possédant ni l'un ni l'autre est commité en tant que
`<uid>@users.noreply.rebase.pro`).

Une modification de schéma avec un auteur et un diff dans l'historique de votre projet
est une chose que ni Firebase ni Supabase ne vous offrent — leurs modifications de
table sont invisibles pour votre dépôt.

## Qui peut appliquer

Détenir `schema:read` suffit pour **planifier**. La planification n'a pas d'effets
secondaires, et un job CI vérifiant si une modification de schéma proposée est
applicable en est un bon cas d'usage.

L'application est un second privilège, car appliquer écrit un commit et un commit
comporte un auteur :

| Appelant | Plan | Apply |
|---|---|---|
| Une personne connectée détenant `schema:write` | oui | oui |
| Une clé d'API détenant `schema:read` / `schema:write` | oui | non |
| La clé de service du serveur | oui | non |

Un identifiant n'est pas un auteur. `api-key:7c3f…` dans votre environnement de CI
n'est pas un individu, et le laisser écrire dans votre dépôt produit exactement
l'historique non attribuable que cette fonctionnalité vise à remplacer.

Si vous souhaitez automatiser les modifications de schéma — par exemple dans un
pipeline de migration —, activez-le délibérément :

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

ou `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Le commit est alors attribué
à l'identifiant par son nom — `Rebase API key (7c3f)` — de sorte que la lecture
de `git log` un mois plus tard vous indique toujours quelles modifications ont
été effectuées par une personne.

`GET /api/admin/schema/status` indique ce que *vous* avez le droit de faire, et pas
seulement ce que le serveur prend en charge, afin qu'un panneau d'administration
puisse désactiver le contrôle et en expliquer la raison plutôt que de vous refuser
l'accès après votre prise de décision :

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

Appliquer ici n'écrit **pas** de migration, et ne le peut pas : une migration
utilise le format d'Atlas avec un fichier d'intégrité, généré par un binaire
externe sur une base de données temporaire, et un serveur en cours d'exécution
ne dispose ni de l'un ni de l'autre.

Ce qu'il commite, en revanche, c'est le fichier de la table, et c'est à partir
de celui-ci que `rebase db generate` génère la migration. La migration n'est donc
qu'à une seule commande :

```bash
rebase db generate
```

Le plan et le résultat l'indiquent tous deux lorsque votre projet utilise des
migrations, car sinon la défaillance est silencieuse : votre base de données possède
la modification et votre dépôt la décrit, mais le prochain environnement construit
en rejouant les migrations ne la possédera pas, et rien ne l'aura signalé.

Un projet provisionné par l'ensure au démarrage — le runtime managé, et tout
auto-hébergement laissant `REBASE_MIGRATE_ON_BOOT` à sa valeur par défaut — n'a
besoin d'aucune migration. Ses tables constituent le schéma, et le prochain
démarrage procède à la réconciliation.

## Commiter d'abord, appliquer ensuite

L'ordre compte et n'est pas arbitraire.

Si le DDL s'exécutait en premier et que le commit échouait, votre base de données
comporterait une colonne que votre dépôt ne décrirait pas. Le chemin ensure ne supprime
jamais rien, donc le déploiement suivant ne la retirerait pas et ne la mentionnerait
pas non plus — une colonne invisible, absente de vos tables, jusqu'à ce que quelqu'un
aille vérifier.

Commiter en premier échoue dans l'autre sens : le dépôt décrit quelque chose que la
base de données ne possède pas encore. C'est l'état ordinaire de tout projet entre
une modification et un déploiement, et le démarrage le réconcilie au lancement suivant.

Par conséquent, un échec de l'apply n'est **pas une erreur**. La réponse le précise :

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Les règles prennent effet dans le même apply

Une modification du `rls` d'une table (ou une nouvelle table) est appliquée dans le
même apply : les stratégies (policies) des tables modifiées sont écrites dans la base
de données immédiatement après le DDL, et la réponse indique ce qui s'est passé sous
`policies` :

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Lorsque les stratégies ne peuvent pas être écrites — un backend qui n'est pas autorisé
à provisionner (`provision.tables` désactivé) ou un pilote dépourvu de cette capacité —,
le statut est `"deferred"` ; lorsque leur écriture échoue, il est `"failed"`, accompagné
de l'erreur. Les deux comportent le message « Rules saved to source; they take effect on
the next deploy. », et le panneau continue d'afficher les règles appliquées par Postgres
d'ici là, jamais des règles qui ne sont pas en vigueur.

Les hooks modifiés dans le code source prennent également effet avec l'apply : le
serveur exécute les tables compilées du schéma modifié sans redémarrage.

## Pris en charge sans redémarrage

Une modification appliquée depuis le Studio est prise en compte immédiatement. Le
pilote Postgres relit les tables modifiées depuis la base de données et les remplace :
l'API de données, les includes, les hooks et le realtime voient une nouvelle table,
colonne, relation ou table de jonction sans redémarrage, et une nouvelle table reçoit
ses autorisations et la capture des changements. La réponse l'indique sous `serving` :

```json
{ "serving": { "status": "now" } }
```

Sur un déploiement dont les tables sont dérivées de la base de données (pas de
`backend/schema`), ou avec un pilote incapable d'actualiser ses tables, la base de
données et la source intègrent la modification mais le processus continue de servir
les tables avec lesquelles il a démarré. Le statut est alors `"after-restart"`, avec
un `message` que le compte-rendu du Studio affiche sous forme d'avertissement ;
redémarrez le processus pour prendre en compte le changement.

## Quand le fichier a été modifié pendant l'édition

Une modification est préparée par rapport aux fichiers tels qu'ils existent. Si l'un
d'eux change sur le disque avant que la modification ne soit appliquée — enregistrement
dans l'IDE, autre processus —, l'apply n'écrit rien et renvoie une réponse 409
`SCHEMA_EDIT_STALE_FILE`. Effectuez à nouveau la modification sur le fichier tel qu'il
est désormais.

## Où cela fonctionne

L'édition de schéma en direct réécrit `backend/schema` avec le même éditeur que celui
utilisé par les sauvegardes sur les sources seules du panneau (nécessite l'installation
de `ts-morph`). L'origine de cette source détermine où elle peut s'exécuter :

- **Sur le disque** (`schemaDir`, par défaut) : elle s'exécute là où s'exécute l'éditeur
  de source seule. Cet éditeur est désactivé sous `NODE_ENV=production` sauf si le
  serveur définit `schemaEditor: true`.
- **Dans un dépôt que vous spécifiez** (`liveSchema.repository`, ou
  `REBASE_LIVE_SCHEMA_REPOSITORY` pour un bundle) : la source est lue depuis GitHub et
  la modification y est commitée en retour, de sorte qu'elle fonctionne n'importe où,
  production incluse. Il s'agit de l'option d'activation pour un bundle compilé.

| Déploiement | Fonctionne |
|---|---|
| `rebase dev` sur votre machine | oui |
| Auto-hébergement avec le projet et son arbre de travail git montés | oui, lorsque `NODE_ENV` n'est pas `production`, ou avec `schemaEditor: true` |
| Un bundle compilé : un auto-hébergement servant un build, ou l'image publiée | seulement s'il l'active avec `REBASE_LIVE_SCHEMA_REPOSITORY` — voir [Depuis un bundle compilé](#depuis-un-bundle-compilé) |
| Tout serveur avec `liveSchema.repository` configuré | oui, `NODE_ENV=production` inclus |

Un bundle est un livrable compilé, il ne contient donc pas le code source de
`backend/schema`, et le runtime qui le dessert désactive l'éditeur de source seule.
À moins qu'il ne désigne un dépôt, `/api/admin/schema/status` répond `enabled: false`
avec le code `SCHEMA_EDITOR_DISABLED` : modifiez `backend/schema` en développement,
commitez et déployez.

### Depuis un bundle compilé

Un bundle ne possède pas de code propre à configurer, il s'active donc via des
variables d'environnement. Rien ne change pour un bundle qui ne les définit pas.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

La liste complète se trouve dans [Configuration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Un dépôt spécifié sans identifiant utilisable (aucun, les deux types, une GitHub App
incomplète) ou avec une valeur qui n'est pas de la forme `owner/name` refusera de
démarrer, plutôt que de proposer un éditeur qui échouerait dès que quelqu'un clique
sur Apply. Il en va de même pour l'ancienne variable
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, avec un message mentionnant
`REBASE_LIVE_SCHEMA_PATH`, ainsi que pour un chemin sortant du dépôt.

Ce qui reste identique lorsqu'elle est activée :

- Il s'agit d'une surface `/api/admin` : aucune réponse sans `schema:read`, et
  `/apply` nécessite `schema:write` ainsi qu'une personne physique (voir [Qui peut appliquer](#qui-peut-appliquer)).
- La cible d'écriture est uniquement le dépôt que vous avez désigné. L'éditeur de
  source seule, qui écrit des fichiers aux côtés du processus, reste désactivé.
- Chaque modification est planifiée, affichée, commitée, puis appliquée, exactement
  comme sur votre machine.

Le processus qui a appliqué la modification la prend en charge immédiatement : ses
routes REST, les descripteurs `GET /api/schema/tables` et le panneau d'administration
suivent la modification sans redémarrage. Les autres réplicas, ainsi que ce processus
après un redémarrage, continuent de servir les tables avec lesquelles le bundle a été
compilé jusqu'à ce que votre pipeline construise et déploie le commit.

Ainsi, une modification attend que la précédente soit prise en compte. Une modification
planifiée par rapport à des tables vis-à-vis desquelles le dépôt a déjà de l'avance
commiterait des fichiers de schéma générés omettant la modification antérieure. Chaque
apply génère donc `schema.generated.ts` à partir des tables servies par ce processus et
le compare à la copie du dépôt. S'ils diffèrent, l'apply est refusé avec
`SCHEMA_CHANGE_FAILED`, en désignant le fichier, jusqu'à ce qu'un processus exécutant ce
commit remplace celui-ci. La vérification lit le dépôt et non la mémoire de ce processus,
de sorte qu'elle reste valide à travers un redémarrage, sur l'ensemble des réplicas, et
pour une modification poussée par un développeur qui n'est pas encore déployée. La
planification reste quant à elle disponible.

Les copies diffèrent également lorsque le fichier a été généré par une autre version
de Rebase, reformaté ou modifié à la main. Si rien n'est en attente de déploiement,
exécutez `rebase schema generate` avec la version exécutée par le déploiement, commitez
le résultat et déployez-le. Les fins de ligne et les espaces en fin de ligne ne sont
pas considérés comme des différences.

### Commiter dans un dépôt distant

`liveSchema.repository` permet au serveur de commiter chaque modification dans un
dépôt GitHub via l'API Git Data au lieu d'exécuter `git commit` dans un arbre de
travail (working tree). Cela ne dépend pas de l'activation de l'éditeur de source
seule : avec un dépôt configuré, l'édition en direct fonctionne sous
`NODE_ENV=production` et avec `schemaEditor: false`, car rien n'est écrit sur cette
machine. Un bundle la configure via les variables ci-dessus.

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

Le répertoire du schéma est ensuite lu depuis le dépôt, réécrit avec le même éditeur
que celui exécuté localement, et ce qui a changé est commité en retour via l'API Git
Data : un blob par fichier, un tree, un commit et une mise à jour de référence. Rien
n'est cloné et rien n'est laissé sur le disque. L'ensemble du répertoire est lu, pas
seulement le fichier modifié, de sorte qu'une relation puisse cibler une autre table
et que la suppression d'une table fonctionne comme localement : refusée tant que la
relation d'une autre table la cible, et retirée d'`index.ts` dans le même commit. Seul
`backend/schema` est récupéré, de sorte qu'un fichier de table qui importe quelque
chose en dehors de ce dossier ne peut pas être modifié de cette façon.

`auth` accepte un jeton ou une installation de GitHub App :

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Utilisez le jeton pour un projet unique commitant dans un dépôt que vous possédez
déjà — mettre en place une App pour que votre propre serveur puisse y commiter
représente beaucoup de formalités pour un identifiant d'une seule ligne. Utilisez
l'App pour un plan de contrôle détenant une seule clé pour plusieurs projets, ce que
fait Rebase Cloud : une seule App, une installation par projet, et aucun secret propre
à chaque client à renouveler.

Le jeton ne nécessite que `contents: read and write` sur ce dépôt, et rien d'autre.

Sans `liveSchema.repository`, le commit est un simple `git commit` dans l'arbre de
travail qui contient `schemaDir` : rien à authentifier, aucun jeton, aucun réseau.

Deux éléments garantissent la sécurité d'exécution sur un dépôt dans lequel quelqu'un
d'autre travaille :

- Il ne prépare (stage) **que** les fichiers qu'il a générés. Un commit de schéma
  qui embarquerait du travail à moitié terminé serait impossible à relire, et
  l'opération refuse catégoriquement de s'exécuter si l'arbre contient déjà l'un de
  ses propres fichiers modifié.
- Le chemin distant ne force jamais la mise à jour d'une référence. Si des modifications
  ont été intégrées pendant la création du commit, la mise à jour est rejetée — perdre
  le commit de quelqu'un silencieusement est bien pire qu'un échec.

## Limitations

- Uniquement des modifications additives. Tout le reste est refusé avec un motif, car
  le chemin ensure est le seul mécanisme qui modifie un schéma et il ne peut que réaliser
  des ajouts.
- Aucun fichier de migration n'est écrit. Un projet provisionné par l'ensure au
  démarrage n'en a pas besoin ; un projet provisionné par des migrations doit
  exécuter `rebase db generate`, qui en génère un via Atlas avec le hash d'intégrité
  requis par Atlas.
- Postgres uniquement. La capacité est détectée sur le pilote, et un pilote qui en est
  dépourvu répond `SCHEMA_EDITING_UNSUPPORTED`.
- Un déploiement dont les tables sont dérivées de la base de données prend en compte
  une modification appliquée après le redémarrage suivant (`serving.status: "after-restart"`,
  voir [Pris en charge sans redémarrage](#pris-en-charge-sans-redémarrage)).

## Voir aussi

- [Génération de schéma](/docs/cli/schema/) — les mêmes modifications depuis la ligne de commande
- [Tables](/docs/schema/) — ce que l'éditeur réécrit
- [Studio](/docs/studio/) — le panneau derrière lequel se trouvent ces routes

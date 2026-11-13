---
sourceHash: a8ca2780e6bbad15
title: Édition de schéma en direct
description: Créez et modifiez des tables sur un backend en cours d'exécution — la modification est écrite dans backend/schema, d'abord commitée dans votre dépôt, puis appliquée.
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

L'éditeur de schéma dans le panneau d'administration réécrit les fichiers de table dans
`backend/schema`. Cela fonctionne sur votre machine et nulle part ailleurs : les fichiers
d'un serveur déployé sont reconstruits à partir de votre dépôt à chaque déploiement, de sorte
qu'une modification effectuée à cet endroit serait ignorée au suivant.

L'édition de schéma en direct est la réponse à cela. Elle **commite la modification dans votre
dépôt, puis applique le DDL** — ainsi, la modification survit au déploiement suivant, car le
déploiement est construit à partir de celle-ci.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status et plan nécessitent la portée `schema:read`, et apply nécessite `schema:write`,
comme toute autre surface de `/api/admin` qui spécifie une portée. Un administrateur dispose des deux.
L'application nécessite également une chose de plus que la portée — voir [Qui peut appliquer](#qui-peut-appliquer).

## Les modifications : `TablePatch`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque route qui modifie le schéma prend le même corps, `{ patches }` : une liste
de modifications, chacune désignant sa table par son slug. Le type est `TablePatch`,
issu de `@rebasepro/types`.

| `op` | Ce qu'elle écrit dans `backend/schema` |
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

Une colonne est transmise sous forme de définition — le type Postgres sous forme de `{ kind: … }`,
et les modificateurs sous forme d'indicateurs — sans ses hooks `.transform()`, qui sont du
code et restent là où ils sont écrits :

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Seul le code désigné par une modification est réécrit. Tout le reste demeure inchangé —
imports, commentaires, formatage, une colonne partagée depuis un autre module. L'éditeur
refuse, en nommant l'expression, toute modification qui atteint *l'intérieur* de quelque chose
défini dans le code : une table construite avec un spread, une colonne construite par un helper,
des règles contenues dans une variable, une clé calculée, une colonne dont la forme JSON comporte
des transformations. De plus, il ne renomme jamais un slug, une table, un schéma ou le nom d'une
définition (cela déplace des données : écrivez une migration), ne supprime jamais la dernière
règle (utilisez `setRls` avec `"admin-only"`), refuse `rls` sur une vue, et refuse la suppression
d'une table ciblée par d'autres relations. Une modification dont le résultat ne compile pas est
refusée avec `SCHEMA_EDIT_DOES_NOT_COMPILE` et les erreurs du compilateur. Rien n'est écrit
en cas de refus.

L'apparence d'une table dans le panneau d'administration — libellés, icônes, groupes, modes
de vue, couleurs d'enum — n'est pas une modification de schéma : elle réside dans `frontend/src/cms`
et dans les préférences enregistrées du panneau, et rien de tout cela ne transite dans un `TablePatch`.

`$ADMIN_TOKEN` est un jeton d'accès — l'`accessToken` renvoyé lors d'une connexion — pour un
compte disposant de `schema:read` : un administrateur, ou un rôle qui le déclare. Rien sur la
machine ne le définit pour vous.

## Planifier avant d'appliquer

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`/plan` n'a pas d'effets secondaires. Envoyez les modifications en POST, et il vous indique ce qu'elles impliquent :

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

`files` représente chaque fichier que l'application commite : la source de la table,
lorsque le backend peut l'écrire, puis le schéma généré. Les enregistrements de modifications
du planificateur conservent leurs noms de transit (`add-property`, `collection`, `property`).

Ce n'est pas une simple commodité. Deux des trois verdicts sont des refus, et l'un
d'eux est un refus que vous ne découvririez autrement qu'en appuyant sur le bouton sur
une base de données active.

## Les trois verdicts

| Verdict | Signification |
|---|---|
| `safe` | Le chemin ensure au démarrage l'exprime et le résultat correspond à votre configuration. Appliqué. |
| `diverges` | Elle s'applique *en partie*, laissant une base de données qui ne correspond pas à votre configuration — et rien ne le signale. Refusé. |
| `needs-migration` | Le chemin ensure ne peut pas l'exprimer du tout. Refusé. |

`diverges` est celui qui mérite d'être compris, car ces modifications semblent avoir
fonctionné :

- **Une colonne `.notNull()` ajoutée à une table contenant déjà des lignes** arrive
  **nullable**. `NOT NULL` est vérifié pour chaque ligne déjà présente, et les lignes
  écrites avant que la colonne n'existe n'ont aucune valeur pour celle-ci. Sur une table
  **vide**, il n'y a rien à vérifier, la contrainte est donc appliquée et cela est
  considéré comme `safe`.
- **Rendre une colonne existante `.notNull()`** présente la même logique : `SET NOT NULL`
  analyse la table, c'est donc `safe` sur une table vide et `diverges` sur une table peuplée
  jusqu'à ce que vous effectuiez un backfill.

Deux modifications qui étaient auparavant `diverges` sont désormais `safe`, car le chemin
ensure les prend en charge :

- **Une valeur ajoutée à un enum existant** est appliquée via
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Elle était auparavant ignorée en même temps que
  le type entier, et la première ligne utilisant la nouvelle valeur était rejetée par un
  type qui n'en avait jamais eu connaissance.
- **Assouplir une colonne `.notNull()`** supprime le `NOT NULL`. Il était auparavant laissé
  en place, de sorte que les écritures omettant la colonne échouaient toujours.

### Contraintes demandées et non appliquées

Une modification peut être applicable tout en laissant non appliquée une contrainte requise
par votre configuration — c'est le cas d'une colonne `.notNull()` sur une table déjà peuplée.
Cela ne constitue pas un refus, cela n'apparaît donc pas dans `changes` ; cela apparaît dans
`withheldConstraints`, avec l'obstacle rencontré et ce qui permettrait de le résoudre :

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

Le chemin ensure au démarrage signale la même chose sous forme d'avertissement. Avant l'existence
de ce mécanisme, une contrainte retenue l'était silencieusement.

`needs-migration` couvre tout ce que le chemin ensure ne peut pas faire : supprimer une
table ou une colonne, modifier le type d'une colonne (bascule en entier, une chaîne devenant
un enum, le type d'élément d'un tableau, la longueur d'un varchar), renommer une colonne, changer
une clé primaire, supprimer une valeur d'enum, rendre une colonne existante unique, et modifier
une relation — son genre, sa cible, sa `localKey`, son `onDelete`. Une relation `hasMany` ou
`hasOne` dont la colonne de liaison n'est créée par rien est également refusée. Chaque refus
indique la modification concernée et ce qu'il convient de faire à la place.

Le verdict est déduit du schéma produit de part et d'autre — le même plan à partir duquel
`schema.generated.ts` et `db push` sont générés — ainsi, une modification qui altère la base
de données ne peut pas être signalée comme une absence de changement. Deux modifications qui
ressemblent à des changements et ne sont pas refusées :

- **Renommer la clé d'une colonne tout en conservant sa colonne SQL** (`renameColumn`,
  qui écrit l'ancien nom comme premier argument du builder, `col.text("old_name")`) ne déplace
  aucune donnée. C'est `safe` ; les clients de l'API lisent le nouveau nom.
- **Définir, modifier ou supprimer une valeur par défaut** ne concerne que les futures écritures.
  C'est `safe`, et appliqué avec `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Modifier la source uniquement

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une modification refusée peut toujours être écrite dans `backend/schema` et commitée,
laissant la base de données telle quelle — la suppression d'une colonne que vous ne servez
plus en est le cas typique. Envoyez un POST sur `/apply` avec `"sourceOnly": true`. Rien
n'est exécuté ; le message de commit indique ce que la base de données conserve, par exemple
`chore(schema): remove sku from products (source only — column products.sku kept)`,
et chaque modification du plan comporte une phrase `sourceOnly` précisant ce qu'elle
laisse de côté — y compris lorsqu'une colonne conservée est `NOT NULL` sans valeur par défaut,
ce qui fait échouer toute insertion ultérieure jusqu'à ce qu'elle soit supprimée ou rendue
nullable. Une modification qui n'en comporte pas (déplacement d'une clé primaire, relation
dont la colonne de liaison n'est créée par rien) ne peut pas être écrite uniquement dans la source.

Sur un déploiement qui ne modifie rien dans sa base de données (`REBASE_PROVISION=false`),
aucune modification n'est appliquée depuis le panneau, donc chaque modification procède ainsi :
le bouton principal de la boîte de dialogue indique **Commit** et envoie `"sourceOnly": true`,
et le processus qui modifie cette base de données applique le schéma.

Supprimer une table depuis le panneau d'administration suit le même chemin : `/apply` avec
une modification `deleteTable` et `"sourceOnly": true` supprime le fichier de la table et son
export dans `index.ts` et commite les deux ; la table et ses lignes restent dans la base de
données. L'opération est refusée tant qu'une relation d'une autre table la cible, en nommant
cette table — la supprimer empêcherait la compilation du schéma.

## Ce qui est commité

Pas uniquement le fichier de la table. Le schéma Drizzle est généré à partir de celui-ci,
et un schéma obsolète casserait le prochain déploiement ; les deux sont donc inclus dans le même commit :

- `backend/schema/<name>.ts` — la table elle-même, et `backend/schema/index.ts` lorsqu'une table est créée ou supprimée
- `backend/src/schema.generated.ts` — le schéma Drizzle

Ces chemins sont relatifs à votre **projet**, et non à votre dépôt. Lorsque les deux
coïncident — un projet `rebase init`, ce qui est le cas habituel — il n'y a pas à s'en
soucier. Lorsque votre projet se trouve dans un sous-répertoire d'un dépôt plus vaste, les
chemins sont préfixés par celui-ci, déterminé en remontant depuis votre répertoire de schéma
jusqu'au `rebase.json` le plus proche. Un projet sans `rebase.json` conserve les chemins bruts.

Aucun SQL n'est inclus dans le commit. `rebase db push` et `rebase db generate` écrivent le
leur à partir des tables à chaque exécution, dans `.rebase/sql/`, qui est ignoré par git.

Le message de commit décrit la modification plutôt que de l'annoncer, et est attribué à
la personne qui l'a effectuée, via le nom d'affichage et l'adresse e-mail du compte (un
utilisateur ne possédant ni l'un ni l'autre est commité en tant que `<uid>@users.noreply.rebase.pro`).

Une modification de schéma avec un auteur et un diff dans l'historique de votre projet est
une chose que ni Firebase ni Supabase ne vous offrent — leurs modifications de tables sont
invisibles pour votre dépôt.

## Qui peut appliquer

Détenir `schema:read` suffit pour **planifier**. La planification n'a pas d'effets secondaires,
et un job CI vérifiant si une modification de schéma proposée est applicable en est un bon cas d'usage.

L'application est un second privilège, car appliquer écrit un commit et un commit porte un auteur :

| Appelant | Plan | Apply |
|---|---|---|
| Une personne connectée disposant de `schema:write` | oui | oui |
| Une clé d'API disposant de `schema:read` / `schema:write` | oui | non |
| La clé de service du serveur | oui | non |

Un identifiant d'authentification n'est pas un auteur. `api-key:7c3f…` dans votre environnement
CI n'est personne, et l'autoriser à écrire dans votre dépôt produit précisément l'historique non
attribuable que cette fonctionnalité vise à remplacer.

Si une modification automatisée de schéma est ce que vous souhaitez — par exemple dans un pipeline
de migration — activez-la délibérément :

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

ou `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Le commit est alors attribué à l'identifiant
par son nom — `Rebase API key (7c3f)` — ainsi la lecture de `git log` un mois plus tard vous indique
toujours quelles modifications ont été effectuées par une personne.

`GET /api/admin/schema/status` indique ce que *vous* pouvez faire, et pas seulement ce que le
serveur prend en charge, afin qu'un panneau puisse désactiver le contrôle et expliquer pourquoi
plutôt que de vous opposer un refus après que vous ayez pris votre décision :

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

Appliquer ici n'écrit **pas** de migration, et ne le peut pas : une migration utilise le format
d'Atlas avec un fichier d'intégrité, généré par un binaire externe sur une base de données temporaire,
et un serveur en cours d'exécution ne dispose ni de l'un ni de l'autre.

Ce qu'il commite, en revanche, c'est le fichier de la table, et c'est à partir de celui-ci que
`rebase db generate` écrit la migration. La migration n'est donc qu'à une seule commande :

```bash
rebase db generate
```

Le plan et le résultat l'indiquent tous deux lorsque votre projet utilise des migrations, car
sinon l'échec est silencieux : votre base de données comporte la modification et votre dépôt la
décrit, mais le prochain environnement construit en rejouant les migrations ne l'a pas, et rien
ne l'a signalé.

Un projet provisionné par boot-ensure — l'environnement d'exécution géré, ainsi que tout auto-hébergement
conservant `REBASE_MIGRATE_ON_BOOT` à sa valeur par défaut — n'a besoin d'aucune migration. Ses tables
constituent le schéma, et le prochain démarrage effectue la réconciliation.

## Commiter d'abord, appliquer ensuite

L'ordre compte et n'est pas arbitraire.

Si le DDL s'exécutait en premier et que le commit échouait, votre base de données aurait une
colonne que votre dépôt ne décrit pas. Le chemin ensure ne supprime jamais rien, donc le prochain
déploiement ne la retirerait pas et ne la mentionnerait pas non plus — une colonne invisible,
absente de vos tables, jusqu'à ce que quelqu'un aille chercher.

Commiter d'abord échoue dans l'autre sens : le dépôt décrit quelque chose que la base de données
ne possède pas encore. C'est l'état ordinaire de tout projet entre une modification et un déploiement,
et le boot le réconcilie au prochain démarrage.

Une application ayant échoué n'est donc **pas une erreur**. La réponse l'indique :

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Les règles prennent effet lors de la même application

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une modification du `rls` d'une table (ou une nouvelle table) est appliquée lors de la même
opération : les politiques des tables modifiées sont écrites dans la base de données juste après
le DDL, et la réponse indique ce qui s'est passé sous `policies` :

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Lorsque les politiques ne peuvent pas être écrites — un backend qui ne peut pas provisionner
(`provision.tables` désactivé) ou un pilote ne disposant pas de cette capacité — le statut est
`"deferred"` ; lorsque leur écriture échoue, il est `"failed"`, accompagné de l'erreur. Les deux
comportent le message « Rules saved to source; they take effect on the next deploy. », et le panneau
continue d'afficher les règles appliquées par Postgres jusque-là, jamais des règles qui ne sont pas en vigueur.

Les hooks modifiés dans le code source prennent également effet avec l'application : le serveur
exécute les tables compilées du schéma modifié sans redémarrage.

## Servi sans redémarrage

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une modification appliquée depuis le Studio est servie immédiatement. Le pilote Postgres relit
les tables modifiées depuis la base de données et les remplace : l'API de données, les includes,
les hooks et le realtime voient une nouvelle table, colonne, relation ou jonction sans redémarrage,
et une nouvelle table obtient ses privilèges et sa capture de modifications. La réponse l'indique
sous `serving` :

```json
{ "serving": { "status": "now" } }
```

Sur un déploiement dont les tables sont dérivées de la base de données (pas de `backend/schema`),
ou avec un pilote incapable d'actualiser ses tables, la base de données et la source comportent
la modification mais le processus continue de servir les tables avec lesquelles il a démarré.
Le statut est alors `"after-restart"`, avec un `message` que le reçu du Studio affiche sous forme
d'avertissement ; redémarrez le processus pour servir la modification.

## Quand le fichier a été modifié pendant l'édition

Une modification est préparée d'après les fichiers tels qu'ils sont. Si l'un d'eux change sur le
disque avant que la modification ne soit appliquée — enregistrement par un IDE, un autre processus —
l'application n'écrit rien et renvoie une réponse 409 `SCHEMA_EDIT_STALE_FILE`. L'éditeur de collection
propose Reload ; effectuez à nouveau la modification par rapport au fichier dans son état actuel.

## Où cela fonctionne

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

L'édition de schéma en direct réécrit `backend/schema` avec le même éditeur que les sauvegardes
source-only du panneau utilisent (il nécessite l'installation de `ts-morph`). La provenance de cette
source détermine où elle s'exécute :

- **Sur le disque** (`schemaDir`, par défaut) : elle s'exécute là où l'éditeur source-only
  s'exécute. Cet éditeur est désactivé sous `NODE_ENV=production` à moins que le serveur ne
  définisse `schemaEditor: true`.
- **Dans un dépôt que vous désignez** (`liveSchema.repository`, ou
  `REBASE_LIVE_SCHEMA_REPOSITORY` pour un bundle) : la source est lue depuis GitHub et la
  modification y est commitée en retour, de sorte qu'elle fonctionne partout, production comprise.
  C'est l'option d'activation pour un bundle compilé.

| Déploiement | Fonctionne |
|---|---|
| `rebase dev` sur votre machine | oui |
| Auto-hébergement avec le projet et son arbre de travail git montés | oui, lorsque `NODE_ENV` n'est pas `production`, ou avec `schemaEditor: true` |
| Un bundle compilé : un auto-hébergement servant un build, ou l'image publiée | uniquement s'il est activé avec `REBASE_LIVE_SCHEMA_REPOSITORY` — voir [Depuis un bundle compilé](#depuis-un-bundle-compilé) |
| Tout serveur avec `liveSchema.repository` configuré | oui, `NODE_ENV=production` inclus |

Un bundle est un artefact compilé, il ne contient donc pas le code source de `backend/schema`,
et le runtime qui le sert désactive l'éditeur source-only. À moins qu'il ne spécifie un dépôt,
`/api/admin/schema/status` répond `enabled: false` avec le code `SCHEMA_EDITOR_DISABLED` :
modifiez `backend/schema` en développement, commitez et déployez.

### Depuis un bundle compilé

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un bundle n'a pas de code propre à configurer, il s'active donc à l'aide de variables
d'environnement. Rien ne change pour un bundle qui ne les définit pas.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

La liste complète se trouve dans [Configuration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Un dépôt désigné sans identifiant utilisable (aucun, les deux types, une GitHub App incomplète),
ou avec une valeur qui n'est pas `owner/name`, refuse de démarrer, plutôt que de fournir un éditeur
qui échouerait dès que quelqu'un clique sur Apply. Il en va de même pour la variable supprimée
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, avec un message mentionnant `REBASE_LIVE_SCHEMA_PATH`, ainsi
que pour un chemin qui sortirait du dépôt.

Ce qui reste inchangé lorsqu'elle est activée :

- Il s'agit d'une surface de `/api/admin` : aucune réponse sans `schema:read`, et
  `/apply` requiert `schema:write` et une personne physique (voir [Qui peut appliquer](#qui-peut-appliquer)).
- La cible d'écriture est uniquement le dépôt que vous avez désigné. L'éditeur source-only,
  qui écrit des fichiers à côté du processus, reste désactivé.
- Chaque modification est planifiée, présentée, commitée, puis appliquée, exactement comme sur votre machine.

Le processus qui a appliqué la modification la sert immédiatement : ses routes REST, les
descripteurs `GET /api/schema/tables` et le panneau d'administration suivent la modification
sans redémarrage. Les autres réplicas, ainsi que ce processus après un redémarrage, servent les
tables avec lesquelles le bundle a été compilé jusqu'à ce que votre pipeline construise et déploie le commit.

Ainsi, une modification attend que la précédente soit servie. Une modification planifiée sur
des tables par rapport auxquelles le dépôt est déjà en avance commiterait des fichiers de schéma
générés qui omettraient la modification antérieure. Chaque application effectue donc le rendu de
`schema.generated.ts` à partir des tables que ce processus sert et le compare à la copie du dépôt.
S'ils diffèrent, l'application est refusée avec `SCHEMA_CHANGE_FAILED`, en désignant le fichier,
jusqu'à ce qu'un processus exécutant ce commit remplace celui-ci. La vérification lit le dépôt
et non la mémoire de ce processus, elle reste donc valable après un redémarrage, entre réplicas et
pour une modification poussée par un développeur qui n'est pas encore déployée. La planification
reste disponible pendant ce temps.

Les copies diffèrent également lorsque le fichier a été généré par une autre version de Rebase,
reformaté ou modifié à la main. Si rien n'est en attente de déploiement, exécutez `rebase schema generate`
avec la version exécutée par le déploiement, commitez le résultat et déployez-le. Les fins de ligne
et les espaces en fin de ligne ne sont pas considérés comme une différence.

### Commiter vers un dépôt distant

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`liveSchema.repository` permet au serveur de commiter chaque modification dans un dépôt GitHub
via la Git Data API au lieu d'exécuter `git commit` dans un arbre de travail. Cela ne dépend pas
de l'activation de l'éditeur source-only : avec un dépôt configuré, l'édition en direct fonctionne
sous `NODE_ENV=production` et avec `schemaEditor: false`, car rien n'est écrit sur cette machine.
Un bundle la configure via les variables ci-dessus.

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

Le répertoire de schéma est ensuite lu depuis le dépôt, réécrit avec le même éditeur qui
s'exécute localement, et les éléments modifiés sont commités en retour via la Git Data API :
un blob par fichier, un arbre, un commit et une mise à jour de référence. Rien n'est cloné et
rien n'est laissé sur le disque. Le répertoire entier est lu, et pas seulement le fichier modifié,
de sorte qu'une relation puisse cibler une autre table et que la suppression d'une table fonctionne
comme localement : refusée tant que la relation d'une autre table la cible, et retirée d'`index.ts`
dans le même commit. Seul `backend/schema` est récupéré, de sorte qu'un fichier de table qui importe
quelque chose en dehors de ce dossier ne peut pas être modifié de cette manière.

`auth` prend en charge un token ou une installation de GitHub App :

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Utilisez le token pour un projet unique qui commite vers un dépôt dont vous êtes déjà
propriétaire — mettre en place une App pour que votre propre serveur puisse commiter dessus
représente beaucoup de cérémonial pour un identifiant d'une seule ligne. Utilisez l'App pour un
plan de contrôle détenant une seule clé partagée entre plusieurs projets, ce que fait Rebase Cloud :
une seule App, une installation par projet, et aucun secret spécifique par client à faire tourner.

Le token nécessite `contents: read and write` sur ce dépôt, et rien d'autre.

Sans `liveSchema.repository`, le commit est un simple `git commit` dans l'arbre de travail qui
contient `schemaDir` : rien à authentifier, pas de token, pas de réseau.

Deux éléments rendent son exécution sûre sur un dépôt dans lequel quelqu'un d'autre travaille :

- Elle n'ajoute à l'index (**stage**) **uniquement** les fichiers qu'elle a générés. Un commit
  de schéma qui embarquerait du travail à moitié terminé serait impossible à relire pour quiconque,
  et l'opération refuse catégoriquement d'opérer si l'arbre possède déjà l'un de ses propres fichiers modifié.
- Le chemin distant ne force jamais la mise à jour d'une référence (`force-update`). Si des modifications
  ont été intégrées pendant la construction du commit, la mise à jour est rejetée — perdre silencieusement
  le commit de quelqu'un d'autre est pire qu'un échec.

## Limites

- Modifications additives uniquement. Tout le reste est refusé avec un motif, car le chemin ensure
  est le seul mécanisme qui modifie un schéma et il ne peut qu'ajouter.
- Aucun fichier de migration n'est écrit. Un projet provisionné par boot-ensure n'en a pas besoin ;
  un projet provisionné par des migrations doit exécuter `rebase db generate`, qui en génère un via
  Atlas avec le hachage d'intégrité requis par Atlas.
- Postgres uniquement. La capacité est détectée au niveau du pilote, et un pilote qui en est dépourvu
  répond `SCHEMA_EDITING_UNSUPPORTED`.
- Un déploiement dont les tables sont dérivées de la base de données sert une modification appliquée
  après le démarrage suivant (`serving.status: "after-restart"`, voir
  [Servi sans redémarrage](#servi-sans-redémarrage)).

## Voir aussi

- [Génération de schéma](/docs/cli/schema/) — les mêmes modifications depuis la ligne de commande
- [Tables](/docs/schema/) — ce que l'éditeur réécrit
- [Studio](/docs/studio/) — le panneau derrière lequel se trouvent ces routes

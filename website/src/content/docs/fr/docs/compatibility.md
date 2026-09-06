---
sourceHash: 64da41d7e9319170
slug: fr/docs/compatibility
title: Compatibilité
description: Ce que Rebase garantit ou non entre les versions — les six contrats versionnés, la façon dont chacun échoue, et ce qui peut encore changer dans une version mineure.
---

Ce que Rebase garantit d'une version à l'autre, et ce qu'il ne garantit pas.

C'est le document à lire avant de modifier quoi que ce soit dont dépend déjà un
projet déployé ou un tenant Rebase Cloud en cours d'exécution. C'est aussi la
réponse honnête à la question : « Si je développe sur Rebase aujourd'hui, qu'est-ce
qui risque de casser sous mes pieds plus tard ? »

## Ce que « bêta » signifie ici

Rebase est en bêta publique. La plupart des projets utilisent ce terme pour
signifier que « tout peut casser », ce qui ne donne au lecteur aucune visibilité
pour planifier. Voici donc la limite exacte fixée par ce projet :

> **L'API avec laquelle vous développez peut changer dans une version mineure, avec une entrée dans le journal des modifications (changelog).
> Vos données ne peuvent pas casser en silence.**

La première moitié correspond au comportement habituel en `0.x` et est décrite
ci-dessous. La seconde moitié est la partie qui mérite d'être vérifiée, car il
s'agit d'une affirmation sur des mécanismes plutôt que sur des intentions : les
contrats versionnés de la section suivante sont chacun gravés dans un artefact
ou une base de données, chacun est vérifié au démarrage ou à l'ingestion, et chacun
**échoue de manière explicite et spécifique** plutôt que de se dégrader. Un push
de schéma qui supprimerait une colonne est refusé par un garde-fou anti-destruction
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), et le chemin de mise
à niveau est lui-même un test : `upgrade-e2e.test.ts` restaure les bases de données
telles que les anciennes versions les avaient laissées, exécute le chemin de
migration actuel sur chacune d'elles, et vérifie que les lignes survivent — pas
seulement que le démarrage a réussi.

Ce que « bêta » signifie réellement : des fonctionnalités manquent encore, certains
sous-systèmes sont plus récents que d'autres, et la nature d'une imperfection réside
dans le fait que quelque chose est absent ou peu pratique, et non dans le fait qu'elle
corrompt silencieusement quoi que ce soit. L'état de maturité de chaque sous-système
est publié et daté au lieu d'être laissé à deviner.

## La promesse de la 0.x

Rebase est en `0.x` — 0.16 au moment de la rédaction. Cette section est rédigée pour
s'appliquer à chaque version 0.x plutôt qu'à une seule, afin de ne pas devenir
obsolète à chaque release. **Des changements cassants (breaking changes) sur l'API
TypeScript écrite par l'utilisateur sont toujours autorisés dans une version mineure**,
et le changelog est l'endroit où ils sont annoncés. Ce qui n'est *pas* autorisé à casser
silencieusement est l'ensemble des contrats versionnés ci-dessous : chacun est gravé
dans un artefact ou une base de données, chacun est vérifié au démarrage ou à
l'ingestion, et chacun échoue **de manière explicite et spécifique** plutôt que de se dégrader.

Cette distinction constitue l'intégralité de la promesse. Un export renommé vous
coûte une erreur de compilation et cinq minutes. Un bundle qui démarre sur le
mauvais runtime et sert des données subtilement erronées vous coûte un incident, et
les contrats existent pour que cette seconde catégorie ne puisse pas se produire en silence.

Rebase Cloud consomme exactement ces contrats et rien d'autre. Tout ce qui n'est
pas listé ici est un détail d'implémentation dont la plateforme ne dépend pas.

## Les contrats versionnés

Les valeurs ci-dessous sont lues depuis le code source ; considérez les références
de fichiers comme la vérité et ce tableau comme la carte.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrat | Déclaré dans | Vérifié dans | Sens de compatibilité |
|---|---|---|---|---|
| 1 | plage `rebase` dans `rebase.json` | le projet de l'utilisateur | CLI au build | le projet indique quels runtimes il accepte |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **rétrocompatible** — le nouveau runtime lit les anciens bundles |
| 3 | `RUNTIME_CONTRACT_VERSION` | même fichier | même fichier | **correspondance exacte, dans les deux sens** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | au démarrage, par rapport à `rebase.schema_meta` | **vers l'avant uniquement** — le nouveau runtime migre les anciennes bases de données |
| 5 | `manifest.schemaVersion` | émis par `rebase build` | envoyé par le SDK via `x-rebase-schema` | informatif — identifie le schéma avec lequel un client a été construit |
| 6 | Identifiants de base de données dérivés | `contracts/derived-names.txt` | `pnpm check:derived-names` | **figé** — un nom émis par une version n'est jamais redérivé |

### 1 — `rebase` dans `rebase.json`

Une plage semver, interprétée comme `engines` dans un `package.json` : les versions
de runtime acceptées par ce projet. Nommé délibérément `rebase` plutôt que `runtime`,
car `runtime` désigne déjà *qui détient le processus* (`managed` | `custom`) sur une application.

### 2 — `BUNDLE_FORMAT_VERSION` (actuellement 2)

La structure sur disque d'un bundle compilé. Un runtime accepte tout bundle dont
le format est **inférieur ou égal** au sien, ce qui permet à l'offre managée de
migrer un tenant vers une nouvelle image sans que personne n'ait à rebuilder son projet.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` un répertoire unique,
  `entry.admin` pour un admin embarqué.
- **2** — `kind: "backend" | "static"`, `entry.static` une liste, `entry.admin`
  supprimé. Le format 1 est toujours lu, via `upgradeLegacyManifest`.

**Incrémentez-le lorsque** la structure change de telle sorte qu'un runtime plus
ancien lirait incorrectement un bundle plus récent. Cette incrémentation transforme
un « démarre et ne sert rien » en un refus de démarrer.

### 3 — `RUNTIME_CONTRACT_VERSION` (actuellement 1)

La version majeure du contrat bundle↔runtime. Distincte de la version du paquet
`@rebasepro/server`, qui peut publier un nombre quelconque de mineures et de correctifs
pendant que celle-ci reste inchangée.

**Lisez ceci avant d'y toucher.** La vérification est `!==`, et non `>` :

> un bundle ciblant le contrat *N* s'exécute **uniquement** sur un runtime implémentant *N*

ainsi, l'incrémenter invalide **tous les bundles jamais construits**, d'un seul coup,
jusqu'à ce que chacun soit reconstruit. C'est la sévérité voulue — c'est le levier « rien
d'ancien ne peut tourner ici » — mais cela signifie qu'une incrémentation est une migration
à l'échelle de toute la flotte, pas une simple note de version. Pour l'offre managée,
cela doit être séquencé avec un rebuild du bundle de chaque tenant.

Si un changement est *additif* et que les anciens bundles restent corrects, il
concerne `BUNDLE_FORMAT_VERSION` (ou rien du tout), pas ceci.

### 4 — `AUTH_SCHEMA_VERSION` (actuellement 2)

Gravé dans `rebase.schema_meta` et comparé au démarrage. Un runtime **refuse de
démarrer** sur une base de données migrée par une version plus récente du framework,
plutôt que de fonctionner sur une structure qu'il ne comprend pas — lors d'un
déploiement progressif (rolling deploy), c'est ce qui fait la différence entre la
moitié de la flotte qui renvoie des erreurs et la moitié de la flotte qui corrompt des données.

La migration vers l'avant est automatique : `ensureAuthTablesExist` met à niveau
une ancienne base de données. Notez que ce bloc de migration est délibérément
encapsulé dans un `try/catch` et journalise au lieu de lever une exception — un
démarrage bancal vaut mieux qu'une boucle de crashs — donc **« il a démarré » ne prouve rien**.
Chaque assertion de la suite de tests de mise à niveau lit plutôt le catalogue ou les données.

**Incrémentez-le lorsqu'**une migration ne doit pas être ignorée par un runtime plus
ancien. Ne l'incrémentez pas pour une colonne additive et rétrocompatible ; un exemple
concret de ce jugement se trouve dans `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash des définitions de collections compilées, émis dans le manifeste du bundle et
renvoyé par un SDK généré dans l'en-tête `x-rebase-schema` (`SCHEMA_VERSION_HEADER`).
Il existe pour que la plateforme puisse indiquer « cette application a été construite
avec un schéma plus ancien » au lieu d'échouer mystérieusement à la première requête.

Le backend lit cet en-tête à chaque requête de données. Une dérive ne refuse jamais
un appel — un SDK en retard d'un schéma reste le plus souvent compatible, et livrer
le backend avant le frontend est l'ordre de déploiement habituel — mais lorsqu'une
requête échoue en 400 ou en 404, l'erreur porte la dérive comme cause :

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on collection \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v1:0e1c…",
      "serverSchema": "v1:9ab4…",
      "message": "This client was generated against schema v1:0e1c…; this backend serves v1:9ab4…"
    }
  }
}
```

Une colonne renommée se lit ainsi comme « votre SDK est périmé, régénérez-le »
plutôt que comme un champ dont vos propres types affirment l'existence. Une
requête qui aboutit n'en est jamais informée.

Il couvre **les collections uniquement**. La modification d'un hook ou d'une fonction
ne modifie pas le contrat d'un client et ne doit pas invalider tous les SDK générés.

### 6 — Identifiants de base de données dérivés

Chaque nom que ce framework détermine lui-même plutôt que de se le faire spécifier :
une colonne de clé étrangère, une contrainte de clé étrangère, une table de jonction
et ses deux colonnes clés, un type enum, un nom de policy, la colonne en `snake_case`
d'une propriété en `camelCase`.

> **Un identifiant dérivé est figé dès l'instant où une version l'émet.**

Pas « figé jusqu'à la prochaine majeure » — figé. Le raisonnement est différent des
cinq autres contrats, et plus strict. Ces derniers sont versionnés, donc une
incompatibilité peut être *détectée* et refusée. Celui-ci ne le peut pas : le nom
est écrit dans la base de données d'un client le jour de son déploiement, et il n'y
a pas d'estampille de version sur une colonne. Chaque base de données provisionnée par
chaque version jamais publiée conserve ce qu'elle a dérivé, et aucun code dans ce
dépôt ne peut intervenir pour toutes les renommer.

La version 0.13 en est l'exemple concret. `generateForeignKeyName` a appris à correctement
mettre au singulier — `categorie_id` → `category_id`, `addres_id` → `address_id` — ce qui
est sans conteste une meilleure dérivation, et cela a cassé toutes les anciennes bases
de données qui contenaient un pluriel irrégulier. Le mécanisme boot-ensure a migré la
colonne, donc les données ont survécu ; le fichier `schema.generated.ts` versionné du
projet ne l'a pas fait, et le démarrage a échoué sur une colonne qui existait. Trois
commits, un nouveau test d'intégration (seam test) et une mention permanente dans les
notes de mise à niveau, en échange d'un nom de colonne plus élégant que personne n'avait demandé.

**Si une dérivation est véritablement erronée**, elle change pour les collections créées
*ultérieurement*, derrière une stratégie de nommage enregistrée dans le projet — jamais
rétroactivement, et jamais comme effet de bord de l'amélioration de la fonction sous-jacente.

**La seule dérogation légitime** est une modification qui fait correspondre le code à un
nom que la base de données *possède déjà*. L'exemple concret est la troncature des
identifiants : Postgres coupe silencieusement un identifiant à 63 octets, donc un nom de
contrainte dérivé plus long n'a jamais été le nom présent dans le catalogue — la dérivation
décrivait un objet qui n'existait pas sous cette orthographe, et boot-ensure réémettait
`ADD CONSTRAINT` à chaque démarrage car sa comparaison ne pouvait jamais correspondre.
Tronquer à la construction modifie ce que ce dépôt *dérive* et ne change rien à ce que
toute base de données déployée *contient*. C'est le test à appliquer : non pas « le nouveau
nom est-il meilleur », mais « une base de données existante doit-elle changer ».
La seule chose toujours sûre est de *reconnaître* un ancien nom afin de le migrer :
`legacyForeignKeyName` existe pour être détecté, jamais pour être généré, et la ligne de
référence (baseline) fige également ces détections. En supprimer une annule silencieusement
la migration de chaque base de données portant encore cette orthographe.

**Le garde-fou.** `scripts/derived-names.mts` exécute un test de stress de nommage
(naming-stress fixture) — pluriels irréguliers, terminaison en `ss`, acronymes, jonction
depuis un slug au pluriel, surcharges explicites, slug suffisamment long pour être tronqué —
à travers les deux producteurs de DDL de schéma, et affiche chaque identifiant nommé par
l'un ou l'autre :

```bash
pnpm check:derived-names
```

Une ligne modifiée ou supprimée échoue en tant que rupture de contrat, avec l'ancienne
et la nouvelle orthographe côte à côte. Un changement purement additif échoue également,
mais avec l'indication « regenerate » — afin que la baseline ne dérive sous les pieds de personne.

Il garantit également que `rebase db push` et le boot-ensure du runtime managé dérivent
les *mêmes* noms, ce qui constitue un second contrat caché dans le premier : ils compilent
les mêmes collections via du code différent, et un projet poussé une fois puis démarré
plus tard ne doit pas se retrouver avec deux schémas.

## Ce qui n'est *pas* figé

Exprimé clairement, pour que personne n'en déduise une promesse qui n'a jamais été faite :

- L'API TypeScript écrite par l'utilisateur — configuration de collection, options de
  `initializeRebaseBackend`, props d'admin, noms de méthodes du SDK. Les changements
  cassants arrivent dans les versions mineures et sont annoncés dans le changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — ceux-ci évoluent le plus rapidement et ont le moins d'utilisateurs.
- Tout ce qui se trouve sous le dossier `src/` d'un paquet et qui n'est pas réexporté
  depuis son point d'entrée (barrel). `packages/client/src/index.ts` comporte une note
  expliquant que sa liste d'exports est soigneusement sélectionnée précisément pour qu'un
  export interne ne devienne pas public par accident.
- Le schéma de base de données de *vos* collections. Cela vous appartient ; Rebase ne
  possède que les schémas `rebase` et `auth`.

## Les garde-fous qui maintiennent ces règles

Rien de tout cela n'est une simple convention — chacun dispose d'un test qui échoue
en cas de rupture :

| Garde-fou | Ce qu'il garantit |
|---|---|
| `pnpm verify:corpus` | toutes les formes de bundles jamais publiées, démarrées sur le runtime actuel. Les fixtures dans `fixtures/bundles/` sont **écrites à la main et figées** — une fixture que le builder régénère évolue dès que le builder évolue |
| `pnpm verify:selfhost` | un vrai bundle compilé, replié, démarré et interrogé comme le ferait un navigateur |
| `upgrade-e2e.test.ts` | les anciens schémas de base de données (`schema-snapshots/`) pris en charge par le runtime actuel |
| `e2e/tests/cli-init-e2e.ts` | un projet échafaudé installé à partir de **véritables archives tarball**, et non de liens d'espace de travail (workspace links) |
| `e2e/tests/client-sdk-e2e.ts` | le parcours utilisateur final : inscription → connexion → lectures restreintes par RLS → rafraîchissement → stockage → temps réel |
| `pnpm check:derived-names` | chaque nom de colonne, contrainte, jonction, enum et policy dérivé par le framework — et le fait que le démarrage et `db push` les dérivent de façon identique |
| `pnpm rls:check` | les policies du schéma généré |
| `pnpm check:api-surface` | chaque export de `@rebasepro/server`, et ses membres, par rapport à `contracts/server.api.txt`. C'est le paquet que `infra/docker/entrypoint.mjs` lie par un lien symbolique par-dessus la propre copie d'un bundle déployé ; supprimer un export n'est donc une erreur de compilation pour personne — c'est un échec de démarrage à travers toute la flotte, lors d'un déploiement que personne n'a demandé |
| `pnpm test:gates` | les deux garde-fous ci-dessus, sur des fixtures. `check:api-surface` a passé toute son existence sans pouvoir détecter la disparition d'un membre de `const rebase` |
| `node scripts/check-release-bump.mjs` | vérifie que le niveau d'incrémentation sous lequel une release est publiée correspond à ce que la release a fait subir aux baselines ci-dessus — exécuté par `publish.yml` avant que le changelog ne soit gravé |
| CI saas | le plan de contrôle (control plane) compilé contre la branche `main` de ce dépôt, sur ses propres pushes et chaque nuit |

**Enregistrez une fixture de bundle et un instantané (snapshot) de schéma une fois par release.**
La valeur de ces deux corpus réside entièrement dans l'ancienneté du plus ancien,
et aucun ne peut être reconstitué a posteriori.

## Modifier un contrat

1. Déterminez duquel des six il s'agit. La plupart des changements ne concernent
   aucun d'entre eux — mais « aucun des six » ne signifie pas « sans controverse ».
   Supprimer ou renommer un export de `@rebasepro/server`, ou l'un de ses membres,
   ne fait partie d'aucun des six et constitue la modification la plus dangereuse du
   dépôt, car le code qu'elle casse est déjà compilé et ne sera pas recompilé.
   `pnpm check:api-surface` est ce qui maintient cette ligne de conduite ; la décision
   d'en faire ou non un septième contrat numéroté reste ouverte (`docs/audits/81-compat-policy.md`).
2. Ajoutez d'abord une fixture ou un snapshot pour l'**ancienne** structure, et vérifiez
   qu'il passe.
3. Effectuez le changement et incrémentez la constante.
4. Confirmez que l'ancienne fixture passe toujours, ou qu'elle échoue désormais *avec
   le message dont un utilisateur aurait besoin*. Les deux résultats sont valides ; le
   silence ne l'est pas.
5. Pour le contrat 3, planifiez la reconstruction de chaque bundle déployé avant de
   fusionner.
6. Le contrat 6 est l'exception aux étapes 3 et 4 : il n'y a pas de constante à incrémenter
   ni de version sur laquelle refuser l'exécution, car une colonne ne porte aucune estampille
   de version. L'étape qui les remplace consiste à décider de ne pas faire la modification —
   consultez la section ci-dessus pour voir à quoi ressemble l'alternative.

---

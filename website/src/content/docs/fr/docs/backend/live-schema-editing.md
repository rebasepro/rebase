---
sourceHash: 7253b4b5232fa542
title: Édition de schéma en direct
description: Créez et modifiez des collections sur un backend en cours d'exécution — d'abord validé dans votre dépôt, puis appliqué.
---

L'éditeur de schéma dans le panneau d'administration réécrit le code source de vos collections. Cela fonctionne sur votre machine et nulle part ailleurs : les fichiers d'un serveur déployé sont reconstruits à partir de votre dépôt à chaque déploiement, de sorte qu'une modification effectuée à cet endroit serait ignorée au suivant.

L'édition de schéma en direct est la réponse à cela. Elle **valide la modification dans votre dépôt, puis applique le DDL** — ainsi, la modification survit au déploiement suivant, car celui-ci est construit à partir d'elle.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Tous trois sont réservés aux administrateurs, comme toutes les autres interfaces `/api/admin`. L'application nécessite une condition supplémentaire en plus d'être administrateur — voir [Qui peut appliquer](#qui-peut-appliquer).

## Planifier avant d'appliquer

`/plan` n'a pas d'effets secondaires. Envoyez la collection telle qu'elle devrait être au final, et il vous indique ce que la modification implique :

`$ADMIN_TOKEN` est un jeton d'accès administrateur — l'`accessToken` renvoyé lors de la connexion pour un compte avec le rôle d'administrateur. Rien sur la machine ne le définit pour vous.

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"collectionId":"posts","collection":{}}'
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
  "files": ["backend/src/schema.generated.ts", "drizzle/schema.sql"]
}
```

Il ne s'agit pas d'un simple confort. Deux des trois verdicts sont des refus, et l'un d'eux est un refus que vous ne découvririez autrement qu'en appuyant sur le bouton sur une base de données en production.

## Les trois verdicts

| Verdict | Signification |
|---|---|
| `safe` | Le chemin d'assurance (ensure path) au démarrage l'exprime et le résultat correspond à votre configuration. Appliqué. |
| `diverges` | Il s'applique *en partie*, laissant une base de données qui ne correspond pas à votre configuration — et rien ne le signale. Refusé. |
| `needs-migration` | Le chemin d'assurance ne peut pas du tout l'exprimer. Refusé. |

`diverges` est celui qui mérite d'être compris, car ces modifications semblent avoir fonctionné :

- **Une propriété obligatoire ajoutée à une table contenant déjà des lignes** arrive sous forme **nullable**. `NOT NULL` est vérifié pour chaque ligne déjà présente, et les lignes écrites avant que la propriété n'existe n'ont aucune valeur pour celle-ci. Sur une table **vide**, il n'y a rien à vérifier, la contrainte est donc appliquée et cela est considéré comme `safe`.
- **Rendre obligatoire une propriété existante** présente la même dynamique : `SET NOT NULL` analyse la table, c'est donc `safe` sur une table vide et `diverges` sur une table peuplée jusqu'à ce que vous effectuiez un remplissage rétroactif (backfill).

Deux modifications qui étaient autrefois `diverges` sont maintenant `safe`, car le chemin d'assurance les prend en charge :

- **Une valeur ajoutée à un enum existant** s'applique, via `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Auparavant, elle était ignorée en même temps que tout le type, et la première ligne utilisant la nouvelle valeur était rejetée par un type qui n'en avait jamais entendu parler.
- **Assouplir une propriété obligatoire** supprime le `NOT NULL`. Auparavant, il était laissé en place, de sorte que les écritures omettant la propriété échouaient toujours.

### Contraintes demandées mais non appliquées

Une modification peut être applicable tout en laissant non appliquée une exigence de votre configuration — une propriété obligatoire sur une table peuplée en est un exemple. Cela ne constitue pas un refus, donc cela n'apparaît pas dans `changes` ; cela apparaît dans `withheldConstraints`, avec l'obstacle et ce qui permettrait de le lever :

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

Le chemin d'assurance au démarrage signale la même chose sous forme d'avertissement. Avant que cela n'existe, une contrainte retenue l'était en silence.

`needs-migration` couvre tout ce que le chemin d'assurance ne peut pas faire : supprimer une collection ou une propriété, changer un type, renommer une colonne, modifier une clé primaire, supprimer une valeur d'enum. Chaque refus nomme le changement et indique quoi faire à la place.

## Ce qui est validé (commit)

Pas seulement le fichier de collection. Une modification de schéma touche plusieurs artefacts générés, et un artefact obsolète casse le prochain déploiement :

- `config/collections/<name>.ts` — la collection elle-même
- `backend/src/schema.generated.ts` — le schéma Drizzle
- `drizzle/schema.sql`, `drizzle/policies.sql`, `drizzle/search.sql`

Ces chemins sont relatifs à votre **projet**, et non à votre dépôt. Lorsque les deux sont identiques — un projet `rebase init`, ce qui est le cas habituel — il n'y a pas à s'en soucier. Lorsque votre projet se trouve dans un sous-répertoire d'un dépôt plus vaste, les chemins sont préfixés par celui-ci, trouvé en remontant depuis votre répertoire de collections jusqu'au `rebase.json` le plus proche. Un projet sans `rebase.json` conserve les chemins simples.

Le message de commit décrit la modification plutôt que d'en annoncer une, et est attribué à l'administrateur qui l'a effectuée. Une modification de schéma avec un auteur et un diff dans l'historique de votre projet est une chose que ni Firebase ni Supabase ne vous offrent — leurs modifications de tables sont invisibles pour votre dépôt.

## Qui peut appliquer

Être administrateur est suffisant pour **planifier**. La planification n'a aucun effet secondaire, et un job CI demandant si un changement de collection proposé est applicable en est une bonne utilisation.

L'application est un second privilège, car appliquer écrit un commit et un commit porte un auteur :

| Appelant | Planifier | Appliquer |
|---|---|---|
| Un administrateur connecté | oui | oui |
| Une clé d'API | oui | non |
| La clé de service du serveur | oui | non |

Un identifiant n'est pas un auteur. `api-key:7c3f…` dans votre environnement de CI n'est pas une personne physique, et lui permettre d'écrire dans votre dépôt produit exactement l'historique non attribuable que cette fonctionnalité vise à remplacer.

Si une modification automatisée du schéma est ce que vous souhaitez — un pipeline de migration, par exemple — activez-la délibérément :

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

ou `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Le commit est ensuite attribué à l'identifiant par son nom — `Rebase API key (7c3f)` — de sorte que la lecture de `git log` un mois plus tard vous indique toujours quels changements ont été effectués par une personne.

`GET /api/admin/schema/status` indique ce que *vous* pouvez faire, et pas seulement ce que le serveur prend en charge, afin qu'un panneau puisse désactiver la commande et expliquer pourquoi plutôt que de vous refuser l'accès après votre décision :

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

Appliquer ici n'écrit **pas** de migration, et ne le peut pas : une migration utilise le format d'Atlas avec un fichier d'intégrité, généré par un binaire externe sur une base de données temporaire, et un serveur en cours d'exécution ne dispose ni de l'un ni de l'autre.

Ce qu'il écrit en revanche, c'est `drizzle/schema.sql` — qui est exactement le fichier sur lequel `rebase db generate` calcule le diff. La migration n'est donc qu'à une commande :

```bash
rebase db generate
```

Le plan et le résultat l'indiquent tous deux lorsque votre projet a des migrations, car sinon l'échec est silencieux : votre base de données contient la modification et votre dépôt la décrit, mais le prochain environnement construit en rejouant les migrations ne l'aura pas, et rien ne l'aura signalé.

Un projet provisionné par boot-ensure — le runtime managé, ainsi que tout auto-hébergement laissant `REBASE_MIGRATE_ON_BOOT` à sa valeur par défaut — n'a besoin d'aucune migration. Ses collections constituent le schéma, et le prochain démarrage procède à la réconciliation.

## Valider d'abord, appliquer ensuite

L'ordre compte et il n'est pas arbitraire.

Si le DDL s'exécutait en premier et que le commit échouait, votre base de données contiendrait une colonne que votre dépôt ne décrit pas. Le chemin d'assurance ne supprimant jamais rien, le prochain déploiement ne la retirerait pas et ne la mentionnerait pas non plus — une colonne invisible, absente de vos collections, jusqu'à ce que quelqu'un la remarque.

Valider d'abord échoue dans l'autre sens : le dépôt décrit quelque chose que la base de données ne possède pas encore. C'est l'état ordinaire de tout projet entre une modification et un déploiement, et le démarrage le réconcilie au prochain lancement.

Un échec de l'application n'est donc **pas une erreur**. La réponse le précise :

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Où cela fonctionne

La ligne de démarcation réside dans le fait que le serveur en cours d'exécution dispose ou non de votre **code source sur le disque** — et non dans le fait qu'il s'agisse de la production.

### MongoDB

Tout ce qui précède décrit Postgres, où une modification de schéma implique du DDL. Sur MongoDB, il n'y a pas de table à modifier : ajouter une propriété n'ajoute rien, en supprimer une ne supprime rien, et un document écrit hier est toujours valide demain.

Chaque modification est donc applicable, rien n'est jamais refusé, et le plan ne contient aucune instruction — le commit *est* la modification. Le panneau indique « Valider » plutôt que « Valider et appliquer », et ne prétend pas que quelque chose a été exécuté sur la base de données.

La seule chose qui mérite une lecture attentive est une suppression. Sur Postgres, la suppression d'une propriété est refusée car elle entraînerait la suppression d'une colonne. Sur MongoDB, le champ reste dans chaque document qui le possède ; votre API cesse simplement de le renvoyer. La modification l'indique explicitement plutôt que de vous laisser supposer le comportement relationnel.

| Déploiement | Fonctionne |
|---|---|
| `rebase dev` sur votre machine | oui |
| Auto-hébergement avec le projet monté | oui |
| Auto-hébergement à partir d'un bundle compilé | oui, avec `liveSchema.repository` |
| Rebase Cloud, ou tout bundle | oui, avec `liveSchema.repository` |

Un bundle étant un résultat compilé, il ne contient pas le code source des collections. Configurez `liveSchema.repository` et le code source sera récupéré depuis votre dépôt à la place ; sans cela, les routes répondent `SCHEMA_EDITING_NO_REPOSITORY` en indiquant la raison.

### Un déploiement sans code source sur le disque

Un bundle est un résultat compilé — chaque client Cloud, et tout auto-hébergement servant un build. Il n'y a pas de code source de collection à réécrire pour l'éditeur, pointez-le donc vers le dépôt dans lequel se trouve réellement le code source :

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where the collection source lives in that repository.
            // Defaults to "config/collections".
            collectionsPath: "config/collections",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

La modification est alors lue depuis le dépôt, réécrite avec le même éditeur que celui qui s'exécute localement, et validée via l'API Git Data — un blob, une arborescence (tree), un commit et une mise à jour de référence. Rien n'est cloné et rien n'est laissé sur le disque.

`auth` prend un jeton ou une installation de GitHub App :

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Utilisez le jeton pour un projet unique validant dans un dépôt que vous possédez déjà — mettre en place une App pour que votre propre serveur puisse y valider des modifications représente beaucoup de formalités pour un identifiant d'une ligne. Utilisez l'App pour un plan de contrôle détenant une seule clé sur plusieurs projets, ce que fait Rebase Cloud : une App, une installation par projet, et aucun secret par client à renouveler.

Le jeton a besoin de `contents: read and write` sur ce dépôt, et rien d'autre.

Sur une machine qui possède le dépôt, le commit est un simple `git commit` — rien à authentifier, aucun jeton, aucun réseau. Un déploiement qui n'en possède pas valide via l'API Git Data à la place, sans clone — voir [Un déploiement sans code source sur le disque](#un-déploiement-sans-code-source-sur-le-disque).

Deux éléments garantissent la sécurité de l'exécution sur un dépôt dans lequel quelqu'un d'autre travaille :

- Il n'indexe (stage) **que** les fichiers qu'il a générés. Un commit de schéma qui embarquerait du travail à moitié terminé serait un commit que personne ne pourrait relire, et l'opération est refusée d'emblée si l'arborescence comporte déjà l'un de ses propres fichiers modifié.
- Le chemin distant ne force jamais la mise à jour d'une référence. Si quelque chose a été envoyé pendant la construction du commit, la mise à jour est rejetée — perdre le commit de quelqu'un silencieusement est pire que d'échouer.

## Limites

- Modifications additives uniquement. Tout le reste est refusé avec un motif, car le chemin d'assurance est la seule chose qui modifie un schéma et il ne peut qu'ajouter.
- Aucun fichier de migration n'est écrit. Un projet provisionné par boot-ensure n'en a pas besoin ; un projet provisionné par migrations doit exécuter `rebase db generate`, qui en produit un via Atlas avec le hachage d'intégrité requis par Atlas.
- Postgres uniquement. La fonctionnalité est détectée sur le pilote, et les autres moteurs répondent `SCHEMA_EDITING_UNSUPPORTED`.

## Liens connexes

- [Génération de schéma](/docs/cli/schema/) — les mêmes modifications depuis la ligne de commande
- [Définition des collections](/docs/collections/) — ce que l'éditeur réécrit
- [Studio](/docs/studio/) — le panneau derrière lequel se trouvent ces routes

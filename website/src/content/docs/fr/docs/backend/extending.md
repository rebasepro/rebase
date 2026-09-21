---
sourceHash: d83b91c0dc03f048
title: Rebase ne gère pas X
sidebar_label: Étendre le serveur
description: L'échelle d'extension côté serveur — déclaration, callback de collection, fonction personnalisée, vos propres routes, votre propre serveur, eject — avec ce que chacune peut et ne peut pas atteindre.
---

## Vue d'ensemble

Quelque chose dont vous avez besoin n'est pas dans la configuration de la collection. Cette page présente l'ordre
dans lequel essayer les différentes solutions et — ce qui est plus utile — ce que chaque échelon *ne peut pas*
atteindre, afin que vous arrêtiez de monter dès le premier échelon capable de faire le travail.

Il existe une page équivalente pour le panneau d'administration :
[Étendre Rebase](/docs/frontend/extending) couvre les plugins, les slots, les surcharges
de composants et les vues personnalisées. Celle-ci concerne le serveur.

La règle codifiée par cette échelle : **chaque échelon vous coûte quelque chose que celui du dessous
conservait.** Une déclaration est portable, évolutive et comprise par le planificateur de schéma,
le SDK généré et le panneau d'administration. Au moment où vous atteignez
`rebase eject`, vous devenez propriétaire de la séquence de démarrage, et les mises à niveau du runtime
de la plateforme n'atteignent plus votre projet. Montez donc seulement jusqu'où vous y êtes contraint.

## L'échelle

| # | Échelon | Atteint | N'atteint **pas** | Coût d'être ici |
|---|---|---|---|---|
| 1 | **Déclaration** — une propriété, une relation, un index, un bloc `search`, une règle de sécurité | Le schéma, le SDK généré, le panneau d'administration, le planificateur de migration | Tout ce qui doit exécuter du code | Aucun. C'est la voie recommandée |
| 2 | **Callback de collection** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Chaque lecture et écriture d'une collection, sur chaque transport, au sein de la transaction propre à la requête | Les requêtes qui ne touchent aucune collection ; l'enveloppe de réponse ; tout ce qui est asynchrone à l'écriture | S'exécute sur le chemin critique (hot path), maintenant la transaction ouverte |
| 3 | **Fonction personnalisée** — une application Hono dans `functions/` | Sa propre URL, avec l'authentification résolue, le pilote limité à l'appelant et `rebase` en main | Les routes intégrées `/api/data`. Elle se place *à côté*, pas devant | Une surface supplémentaire à autoriser ; aucune méthode du SDK n'est générée pour elle |
| 4 | **Vos propres routes et middlewares** sur l'application Hono | Tout ce qui est HTTP, y compris les chemins qui s'exécutent *avant* les routeurs de Rebase | Le pilote et l'identité de l'appelant, à moins que vous ne protégiez la route vous-même | En dehors de tout routeur Rebase : aucun middleware d'authentification ne s'est exécuté |
| 5 | **Votre propre serveur** — intégrer le pilote dans Express, Fastify ou un simple `http` | L'adaptateur de données et le temps réel, dans un processus que vous avez écrit | Tout ce que `initializeRebaseBackend` configure : routes d'authentification, stockage, jobs, cron, API d'administration, le serveur MCP | Vous assemblez le backend. Rebase est une bibliothèque ici, pas un coordinateur |
| 6 | **`rebase eject`** | Le point d'entrée et le `Dockerfile`, dans votre dépôt | — | **Les mises à niveau du runtime de la plateforme n'atteignent plus ce projet.** CORS, configuration de l'authentification, stockage et arrêt deviennent votre responsabilité |

:::tip[Deux échelons sont souvent sautés sans raison]
<span class="since-badge" data-since="0.22">Depuis 0.22</span> `beforeQuery` (échelon 2) restreint une lecture *avant qu'elle ne soit compilée*, ce qui est
la raison pour laquelle les gens passent habituellement à l'échelon 3 ou 5. Et un bloc `search` avec
`mode: "hybrid"` (échelon 1) est ce pour quoi les gens se tournent généralement vers du SQL brut. Tous deux sont
suffisamment récents pour que les réponses plus anciennes sur Internet ne les mentionnent pas.
:::

## 1. Déclaration

La majeure partie de ce dont un backend a besoin est une déclaration sur la collection, car une
déclaration est le seul échelon que le reste du système peut lire. Le planificateur de schéma
la transforme en DDL, le générateur de code la transforme en méthodes SDK, le panneau d'administration
la rend visuellement, et `rebase doctor` la compare à la base de données active.

| Je veux… | Déclarer | Référence |
|---|---|---|
| Ajouter une colonne | une propriété | [Propriétés](/docs/collections/properties) |
| Lier deux collections | une propriété `relation` | [Relations](/docs/collections/relations) |
| Rendre une requête rapide | `indexes` | [Index](/docs/backend/indexes) |
| Décider qui peut lire ou écrire une ligne | `securityRules` | [Authentification](/docs/backend/authentication) |
| Rechercher du texte correctement — accents, JSONB, classement, sous-chaînes | un bloc `search` | [Recherche](/docs/backend/search) |
| Trouver des lignes par similarité sémantique | une propriété `vector` | [Recherche](/docs/backend/search) |
| Conserver les lignes supprimées | `softDelete` | [Écritures](/docs/backend/writes) |
| Enregistrer qui a modifié quoi | `history` | [Historique](/docs/backend/history) |
| Exécuter une tâche de manière planifiée | un fichier cron job | [Tâches Cron](/docs/backend/cron-jobs) |
| Exécuter quelque chose après une écriture, de manière différée | un job | [Jobs](/docs/backend/jobs) |

**Ce qu'elle ne peut pas atteindre :** tout ce qui doit prendre une décision au moment de la requête.
Une déclaration est une donnée. Si la réponse dépend de l'identité du demandeur, passez à l'échelon 2.

## 2. Callbacks de collection

**Portée :** une seule collection, ou toutes les collections lorsqu'ils sont enregistrés globalement sur
`initializeRebaseBackend({ callbacks })`.

Les callbacks se déclenchent sur **chaque** chemin de données — REST, le SDK, les souscriptions WebSocket
et les écritures côté serveur via `rebase.dataAsAdmin` — et chacun s'exécute au sein de la
transaction ouverte pour cette requête. C'est là tout leur intérêt : il n'y a aucun moyen
d'accéder aux lignes d'une collection en les contournant.

| Callback | Se déclenche | Utilisé pour |
|---|---|---|
| `beforeQuery` <span class="since-badge" data-since="0.22">Depuis 0.22</span> | avant qu'une lecture ne soit compilée | restreindre **quelles lignes** une lecture demande |
| `afterRead` | par ligne, après sa récupération | masquage, anonymisation des données personnelles, champs calculés |
| `beforeSave` | après validation, avant l'écriture | valeurs par défaut, colonnes dérivées, refus d'une écriture |
| `afterSave` | après l'écriture, avant le commit | effets de bord qui doivent être annulés avec celle-ci |
| `afterSaveError` | lorsqu'un enregistrement échoue | signalement ; `props.error` correspond à ce qui a été levé |
| `beforeDelete` | avant la suppression | la refuser |
| `afterDelete` | après la suppression, avant le commit | nettoyage en cascade |

→ [Callbacks par collection](/docs/collections/callbacks) ·
[Hooks globaux](/docs/backend/hooks)

### Restreindre une lecture avec `beforeQuery`

<span class="since-badge" data-since="0.22">Depuis 0.22</span> `afterRead` a accès aux lignes qui ont déjà été récupérées, ce qui lui permet de masquer une valeur
mais ne peut pas empêcher la ligne d'être lue. `beforeQuery` intervient plus tôt : la requête
analysée lui est transmise et il renvoie des conditions à combiner avec **AND**.

```ts
// config/collections/documents.ts
callbacks: {
    beforeQuery: ({ context }) => {
        if (context.user?.roles?.includes("admin")) return;        // no narrowing
        return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
    }
}
```

Trois propriétés méritent d'être connues avant de vous reposer dessus :

- **Il ne peut que restreindre.** La valeur de retour est un filtre à combiner via AND, et il n'y a
  aucune forme qu'il puisse retourner qui élargisse la lecture. C'est délibéré : un hook à qui l'on
  transmettrait la requête pour en renvoyer une autre pourrait supprimer une condition, et sur un plan
  de données avec sécurité au niveau des lignes (row-level-security), une condition supprimée renvoie toutes les lignes que
  les politiques autorisent.
- **Il se déclenche sur chaque chemin de lecture.** La liste, la lecture unique, le comptage,
  l'agrégat, la recherche, la lecture vectorielle, le listing d'un chemin imbriqué, la récupération en temps réel
  qui construit les trames de souscription, et les lignes chargées pour une relation ou
  un `?include=` — où c'est le hook de la collection **cible** qui s'applique.
  Un hook respecté par le listing et non par le comptage donne une page indiquant
  « 1 sur 4 résultats ».
- **Un filtre qu'il ne peut pas compiler refuse la requête.** Spécifier une colonne que la table
  ne possède pas renvoie un code 400, et non une condition ignorée, quelle que soit
  la configuration de `configureUnknownFilterFields`.

Une lecture n'est délibérément *pas* restreinte : la vérification d'unicité derrière
`validation: { unique: true }`. Elle demande si une valeur existe n'importe où dans la
table, et une fois restreinte, elle répondrait « unique » pour une valeur qu'une ligne masquée
détient déjà — laissant ainsi l'insertion échouer plutôt sur la contrainte.

`beforeQuery` est implémenté par `@rebasepro/server-postgres`. Une collection servie
par un autre moteur qui en déclare un **échoue au démarrage**, par son nom, plutôt que d'être
servie avec le hook rendu silencieusement inerte. Il en va de même pour un hook global associé à une source de données
qui n'est pas Postgres. Le masquage fonctionnant sur chaque moteur s'effectue avec `afterRead`.

**Ce que les callbacks ne peuvent pas atteindre :**

- Une requête qui ne touche aucune collection. Il n'y a rien à quoi le callback
  puisse se rattacher.
- L'enveloppe de réponse — code de statut, en-têtes, structure de pagination. Un callback
  renvoie des valeurs, pas une réponse.
- Le travail qui doit survivre à la transaction. `afterSave` s'exécute *avant* le commit,
  donc une exception levée ici annule l'écriture. Tout ce qui doit survivre à l'annulation
  de l'écriture ne fait pas partie de l'écriture : placez-le dans la
  [file d'attente de jobs](/docs/backend/jobs).
- Le travail lent, en pratique. Un callback maintient la transaction ouverte et une connexion
  du pool avec elle. Tout ce qui communique avec un tiers a sa place dans la file d'attente.

## 3. Fonctions personnalisées

**Portée :** une URL sous `/api/functions`.

Une application Hono dans `backend/functions/`, découverte par nom de fichier tout comme les collections
et les cron jobs. Les middlewares d'authentification ont déjà été exécutés lorsque votre gestionnaire est atteint,
le pilote est limité à l'appelant, et `rebase` est disponible pour le stockage, les e-mails,
les jobs et `dataAsAdmin`.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.collection("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Fonctions Personnalisées](/docs/backend/custom-functions)

**Ce qu'elle ne peut pas atteindre :** les routes intégrées `/api/data`. Une fonction se situe
*à côté*, pas devant elles, elle ne peut donc pas modifier la façon dont un listing est
filtré, paginé ou structuré — cela relève de l'échelon 2. Elle n'obtient pas non plus de méthode
SDK générée ; les appelants l'atteignent avec `client.functions.invoke(...)` ou un simple `fetch`.

## 4. Vos propres routes et middlewares

**Portée :** l'application Hono, avant que Rebase n'y touche.

`initializeRebaseBackend` prend l'application que vous lui passez, donc tout ce que vous enregistrez sur
cette application *avant* de l'appeler s'exécute avant chaque routeur Rebase — voir
[Ordre d'enregistrement des routes](/docs/backend/custom-functions#route-registration-order)
pour la structure.

:::caution[Aucun middleware d'authentification ne s'est exécuté ici]
Une route enregistrée de cette manière se trouve **en dehors** de chaque routeur Rebase, donc
`getDriver(c)` n'est pas défini et rien n'a vérifié de jeton. Protégez-la avec
`requireAuth` / `requireAdmin` importés depuis **`@rebasepro/server`** — la
racine du package — qui vérifient le jeton eux-mêmes. Les gardes exportés depuis
`@rebasepro/server/functions` lisent une identité qu'un routeur Rebase a déjà
résolue, et renvoient 500 plutôt que de feindre qu'il en existe une.
:::

Un piège Hono mérite d'être mentionné, car il est silencieux : `app.use("/*", guard)` couvre
uniquement les routes déclarées *en dessous*. Une route ajoutée ultérieurement — en bas
du fichier, dans plusieurs mois — ne sera pas protégée. Placez les gardes dans l'emplacement middleware
propre à la route.

**Ce qu'elle ne peut pas atteindre :** l'identité, le pilote limité à l'appelant et l'enveloppe d'erreur
— à moins que vous ne configuriez chacun d'eux vous-même. Tout ce qu'un routeur Rebase fournit à un gestionnaire est
le résultat d'une action menée par un routeur Rebase.

## 5. Votre propre serveur

**Portée :** le processus.

`@rebasepro/server-postgres` est indépendant du framework : il dépend de Drizzle et
du module `http.Server` de Node, et de rien d'autre. Vous pouvez donc intégrer l'adaptateur de données et
le temps réel dans Express, Fastify ou un simple Node, et vous passer entièrement du coordinateur.

→ [Intégration d'un serveur personnalisé](/docs/backend/custom-server)

**Ce qu'il ne peut pas atteindre :** tout ce que `initializeRebaseBackend` configure, ce qui
représente la majeure partie du backend — les routes d'authentification et le rafraîchissement des jetons, le stockage, la
file d'attente de jobs, cron, l'API d'administration avec laquelle le Studio communique, le serveur MCP, l'enveloppe
d'erreur, la pile de middlewares. Chacun de ces éléments peut être assemblé à la main ;
aucun ne s'assemble tout seul. Rebase est une bibliothèque à cet échelon, pas un
coordinateur.

Tournez-vous vers cette solution si vous avez un serveur existant qui doit rester le point d'entrée. Si
ce que vous voulez réellement est une unique route personnalisée, cela correspond à l'échelon 3 ou 4, pour une fraction
de la surface de code.

## 6. `rebase eject`

**Portée :** le dépôt.

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son
backend, de sorte que le dépôt construise sa propre image au lieu d'exécuter le
runtime publié.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Ce que cela coûte :** **les mises à niveau du runtime de la plateforme n'atteignent plus le projet.**
CORS, configuration de l'authentification, stockage et arrêt deviennent votre responsabilité à configurer et
à maintenir fonctionnels. C'est le seul échelon de l'échelle sur lequel il est difficile de faire marche arrière.

Prévisualisez-le d'abord. L'option `--force` remplace un fichier `backend/src/index.ts` ou
`env.ts` existant, en conservant le fichier actuel sous le nom `<name>.bak`.

## Quand aucune de ces options n'est la réponse

Deux cas méritent d'être cités, car l'échelle ne s'y applique pas.

**SQL brut.** Vous n'avez pas besoin de quitter le framework pour écrire une requête que le constructeur
de requêtes ne peut pas exprimer. Restreignez `driver.admin` avec `isSQLAdmin` et utilisez
`executeSql`, depuis une fonction personnalisée ou un callback :

```typescript
import { isSQLAdmin, type DataDriver } from "@rebasepro/types";

async function topSellers(driver: DataDriver, since: string) {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) throw new Error("Native SQL is not available on this driver.");
    return admin.executeSql(
        "select product_id, sum(qty) from order_lines where created_at > $1 group by 1",
        { params: [since] }
    );
}
```

`driver` est ce que le contexte d'une fonction personnalisée vous transmet (`c.get("driver")`), ou
`context.driver` à l'intérieur d'un callback. Restreignez-le avec `isSQLAdmin` plutôt que
par un transtypage (casting) : ce garde fait la différence entre un pilote incapable d'exécuter du SQL qui
vous en informe clairement et un pilote qui lève `admin.executeSql is not a function` au point d'appel.

**Quelque chose que le framework devrait faire et ne fait pas.** Si vous vous retrouvez
à devoir patcher `@rebasepro/server-postgres`, ou à exécuter `eject` pour un seul comportement, cela
mérite une issue plutôt qu'un fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
<span class="since-badge" data-since="0.22">Depuis 0.22</span> `beforeQuery` et `search.mode: "hybrid"` existent tous deux parce qu'un pilote patché
était la seule alternative possible.

## Voir aussi

- [Étendre Rebase (frontend)](/docs/frontend/extending) — la même échelle pour le panneau d'administration
- [Callbacks par collection](/docs/collections/callbacks)
- [Hooks globaux](/docs/backend/hooks)
- [Fonctions Personnalisées](/docs/backend/custom-functions)
- [Intégration d'un serveur personnalisé](/docs/backend/custom-server)
- [Recherche](/docs/backend/search)
- [Index des points de terminaison](/docs/backend/endpoints) — chaque route montée par le serveur

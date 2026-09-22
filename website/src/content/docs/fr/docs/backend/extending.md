---
sourceHash: 41183c8dc79d618d
title: Rebase ne fait pas X
sidebar_label: Étendre le serveur
description: L'échelle d'extension côté serveur — déclaration, callback de collection, fonction personnalisée, vos propres routes, votre propre serveur, eject — avec ce que chacun peut et ne peut pas atteindre.
---

## Vue d'ensemble

Quelque chose dont vous avez besoin ne se trouve pas dans la configuration de la collection. Cette page présente l'ordre dans lequel essayer les solutions et — plus utile encore — ce que chaque échelon *ne peut pas* atteindre, afin que vous arrêtiez de monter dès le premier qui répond au besoin.

Il existe une page équivalente pour le panneau d'administration :
[Extending Rebase](/docs/frontend/extending) couvre les plugins, les slots, les surcharges de composants et les vues personnalisées. Celle-ci concerne le serveur.

La règle incarnée par cette échelle : **chaque échelon vous coûte quelque chose que celui du dessous préservait.** Une déclaration est portable, évolutive et comprise par le planificateur de schéma, le SDK généré et le panneau d'administration. Lorsque vous atteignez `rebase eject`, vous devenez propriétaire de la séquence de démarrage, et les mises à niveau du runtime de la plateforme n'atteignent plus votre projet. Ne montez donc pas plus haut que nécessaire.

## L'échelle

| # | Échelon | Ce qu'il atteint | Ce qu'il n'atteint **pas** | Le coût à ce niveau |
|---|---|---|---|---|
| 1 | **Déclaration** — une propriété, une relation, un index, un bloc `search`, une règle de sécurité | Le schéma, le SDK généré, le panneau d'administration, le planificateur de migration | Tout ce qui doit exécuter du code | Aucun. C'est la voie privilégiée |
| 2 | **Callback de collection** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Chaque lecture et écriture d'une collection, sur tous les transports, au sein de la transaction propre à la requête | Les requêtes qui ne touchent aucune collection ; l'enveloppe de réponse ; tout ce qui est asynchrone par rapport à l'écriture | S'exécute sur le chemin critique (hot path), maintenant la transaction ouverte |
| 3 | **Fonction personnalisée** — une application Hono dans `functions/` | Sa propre URL, avec l'authentification résolue, le driver restreint à l'appelant et `rebase` à disposition | Les routes natives `/api/data`. Elle se situe *à côté*, pas devant | Une surface d'autorisation supplémentaire ; aucune méthode SDK n'est générée pour elle |
| 4 | **Vos propres routes et middlewares** sur l'application Hono | Tout ce qui est HTTP, y compris les chemins qui s'exécutent *avant* les routeurs de Rebase | Le driver et l'identité de l'appelant, à moins de protéger la route vous-même | En dehors de tout routeur Rebase : aucun middleware d'authentification n'a été exécuté |
| 5 | **Votre propre serveur** — intégrer le driver dans Express, Fastify ou un simple serveur `http` | L'adaptateur de données et le temps réel, dans un processus que vous avez écrit | Tout ce que configure `initializeRebaseBackend` : routes d'authentification, stockage, jobs, cron, API d'administration, le serveur MCP | Vous assemblez le backend. Rebase est ici une bibliothèque, pas un coordinateur |
| 6 | **`rebase eject`** | Le point d'entrée et le `Dockerfile`, dans votre dépôt | — | **Les mises à niveau du runtime de la plateforme n'atteignent plus ce projet.** CORS, câblage de l'authentification, stockage et arrêt deviennent votre responsabilité |

:::tip[Deux échelons sont souvent ignorés sans raison]
`beforeQuery` (échelon 2) restreint une lecture *avant qu'elle ne soit compilée*, ce pour quoi les développeurs passent souvent directement à l'échelon 3 ou 5. Et un bloc `search` avec `mode: "hybrid"` (échelon 1) est ce pour quoi on a généralement recours au SQL brut. Ces deux fonctionnalités sont suffisamment récentes pour que les anciennes réponses sur Internet n'en parlent pas.
:::

## 1. Déclaration

La plupart des besoins d'un backend se résument à une déclaration sur la collection, car la déclaration est le seul échelon que le reste du système peut lire. Le planificateur de schéma la convertit en DDL, le générateur de code la transforme en méthodes SDK, le panneau d'administration l'affiche, et `rebase doctor` la compare à la base de données en production.

| Je souhaite… | Déclarer | Référence |
|---|---|---|
| Ajouter une colonne | une propriété | [Properties](/docs/collections/properties) |
| Lier deux collections | une propriété `relation` | [Relations](/docs/collections/relations) |
| Accélérer une requête | `indexes` | [Indexes](/docs/backend/indexes) |
| Définir qui peut lire ou écrire une ligne | `securityRules` | [Authentication](/docs/backend/authentication) |
| Rechercher du texte correctement — accents, JSONB, classement, sous-chaînes | un bloc `search` | [Search](/docs/backend/search) |
| Trouver des lignes par similarité sémantique | une propriété `vector` | [Search](/docs/backend/search) |
| Conserver les lignes supprimées | `softDelete` | [Writes](/docs/backend/writes) |
| Enregistrer qui a modifié quoi | `history` | [History](/docs/backend/history) |
| Exécuter une tâche de façon planifiée | un fichier de cron job | [Cron Jobs](/docs/backend/cron-jobs) |
| Exécuter quelque chose après une écriture, en tâche de fond | un job | [Jobs](/docs/backend/jobs) |

**Ce qu'elle ne peut pas atteindre :** tout ce qui doit prendre une décision au moment de la requête. Une déclaration est une donnée. Si la réponse dépend de l'identité de l'appelant, passez à l'échelon 2.

## 2. Callbacks de collection

**Portée :** une collection, ou toutes les collections lorsqu'ils sont enregistrés globalement via `initializeRebaseBackend({ callbacks })`.

Les callbacks se déclenchent sur **tous** les chemins de données — REST, le SDK, les abonnements WebSocket et les écritures côté serveur via `rebase.dataAsAdmin` — et chacun s'exécute au sein de la transaction ouverte pour cette requête. C'est tout leur intérêt : il n'existe aucun moyen d'accéder aux lignes d'une collection en les contournant.

| Callback | Se déclenche | Utilisé pour |
|---|---|---|
| `beforeQuery` | avant la compilation d'une lecture | restreindre **quelles lignes** une lecture demande |
| `afterRead` | par ligne, après sa récupération | caviardage, masquage des données personnelles (PII), champs calculés |
| `beforeSave` | après la validation, avant l'écriture | valeurs par défaut, colonnes dérivées, refus d'écriture |
| `afterSave` | après l'écriture, avant le commit | effets secondaires qui doivent être annulés avec elle |
| `afterSaveError` | lorsqu'une sauvegarde lève une erreur | signalement ; `props.error` contient l'erreur levée |
| `beforeDelete` | avant la suppression | la refuser |
| `afterDelete` | après la suppression, avant le commit | nettoyage en cascade |

→ [Per-collection callbacks](/docs/collections/callbacks) ·
[Global hooks](/docs/backend/hooks)

### Restreindre une lecture avec `beforeQuery`

`afterRead` voit les lignes qui ont déjà été récupérées ; il peut donc caviarder une valeur mais ne peut pas empêcher la lecture de la ligne. `beforeQuery` intervient plus tôt : il reçoit la requête analysée et renvoie des conditions à combiner avec un **AND**.

```ts
// config/collections/documents.ts
callbacks: {
    beforeQuery: ({ context }) => {
        if (context.user?.roles?.includes("admin")) return;        // no narrowing
        return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
    }
}
```

Trois propriétés méritent d'être connues avant de s'appuyer dessus :

- **Il ne peut que restreindre.** La valeur de retour est un filtre combiné par un AND, et aucune structure renvoyée ne peut élargir la lecture. C'est délibéré : un hook recevant la requête et devant en retourner une pourrait omettre une condition, et sur un plan de données appliquant la sécurité au niveau des lignes (RLS), une condition omise renvoie toutes les lignes que les politiques autorisent.
- **Il se déclenche sur tous les chemins de lecture.** La liste, la récupération unitaire, le décompte (count), l'agrégation, la recherche, la lecture vectorielle, une liste par chemin imbriqué, le rafraîchissement temps réel générant les trames d'abonnement, et les lignes chargées pour une relation ou un `?include=` — où c'est le hook de la collection **cible** qui s'applique. Un hook pris en compte par la liste mais pas par le décompte donnerait une page affichant « 1 sur 4 résultats ».
- **Un filtre qu'il ne peut pas compiler refuse la requête.** Indiquer une colonne qui n'existe pas dans la table produit une erreur 400, et non une condition ignorée, quelle que soit la valeur de `configureUnknownFilterFields`.
- **Une écriture ciblant une ligne qu'il exclut renvoie une 404.** Une mise à jour ou une suppression visant une ligne en dehors de la portée est refusée avant l'écriture, avec la même réponse « no row … » qu'une lecture — ainsi, une portée s'applique aussi aux écritures, pas seulement aux lectures. En revanche, il ne filtre *pas* les valeurs en cours d'écriture : refuser une écriture en fonction de son contenu relève de `beforeSave`.

Une lecture n'est délibérément *pas* restreinte : la vérification d'unicité liée à `validation: { unique: true }`. Elle vérifie si une valeur existe n'importe où dans la table ; si elle était restreinte, elle répondrait « unique » pour une valeur déjà détenue par une ligne masquée — laissant l'insertion échouer au niveau de la contrainte SQL.

`beforeQuery` est implémenté par `@rebasepro/server-postgres`. Une collection gérée par un autre moteur qui en déclare un **échoue au démarrage**, explicitement par son nom, plutôt que d'être exécutée avec un hook silencieusement inerte. Il en va de même pour un callback global associé à une source de données qui n'est pas Postgres. Le caviardage qui fonctionne sur tous les moteurs est `afterRead`.

**Ce que les callbacks ne peuvent pas atteindre :**

- Une requête qui ne touche aucune collection. Il n'y a aucun support auquel rattacher le callback.
- L'enveloppe de réponse — code de statut, en-têtes, format de pagination. Un callback renvoie des valeurs, pas une réponse.
- Les opérations qui doivent survivre à la transaction. `afterSave` s'exécute *avant* le commit ; une exception à ce niveau annule donc l'écriture (rollback). Tout ce qui doit subsister même si l'écriture est annulée ne fait pas partie de l'écriture : placez-le dans la [file de jobs](/docs/backend/jobs).
- Les tâches lentes, en pratique. Un callback maintient la transaction ouverte, et avec elle une connexion du pool. Tout ce qui communique avec un service tiers doit être placé dans la file d'attente.

## 3. Fonctions personnalisées

**Portée :** une URL sous `/api/functions`.

Une application Hono dans `backend/functions/`, découverte par son nom de fichier de la même manière que les collections et les tâches cron. Le middleware d'authentification a déjà été exécuté lorsque votre gestionnaire est atteint, le driver est restreint au périmètre de l'appelant, et `rebase` est disponible pour le stockage, les e-mails, les jobs et `dataAsAdmin`.

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

→ [Custom Functions](/docs/backend/custom-functions)

**Ce qu'elle ne peut pas atteindre :** les routes natives `/api/data`. Une fonction se situe *à côté*, pas devant elles ; elle ne peut donc pas modifier la façon dont une liste est filtrée, paginée ou structurée — c'est le rôle de l'échelon 2. Elle ne bénéficie d'aucune méthode générée dans le SDK ; les appelants y accèdent via `client.functions.invoke(...)` ou un simple `fetch`.

## 4. Vos propres routes et middlewares

**Portée :** l'application Hono, avant que Rebase n'intervienne.

`initializeRebaseBackend` prend l'application que vous lui passez, donc tout ce que vous enregistrez sur cette application *avant* de l'appeler s'exécute avant chaque routeur Rebase — voir [Route Registration Order](/docs/backend/custom-functions#route-registration-order) pour la structure.

:::caution[Aucun middleware d'authentification ne s'y est exécuté]
Une route enregistrée de cette manière est **en dehors** de tout routeur Rebase : `getDriver(c)` n'est pas défini et rien n'a vérifié de jeton. Protégez-la avec `requireAuth` / `requireAdmin` importés depuis **`@rebasepro/server`** — la racine du package — qui vérifient le jeton eux-mêmes. Les gardes exportés depuis `@rebasepro/server/functions` lisent une identité qu'un routeur Rebase a déjà résolue, et renvoient une 500 plutôt que de feindre qu'elle existe.
:::

Un piège de Hono bon à connaître, car il est silencieux : `app.use("/*", guard)` ne couvre que les routes déclarées *en dessous* de lui. Une route ajoutée plus tard — tout en bas du fichier, dans plusieurs mois — ne sera pas protégée. Placez les gardes dans l'emplacement de middleware propre à la route.

**Ce qu'ils ne peuvent pas atteindre :** l'identité, le driver restreint et l'enveloppe d'erreur — à moins que vous ne les configuriez vous-même. Tout ce qu'un routeur Rebase fournit à un gestionnaire est le résultat de ce que ce routeur Rebase a accompli.

## 5. Votre propre serveur

**Portée :** le processus.

`@rebasepro/server-postgres` est agnostique vis-à-vis du framework : il dépend de Drizzle et du module `http.Server` de Node, et de rien d'autre. Vous pouvez donc intégrer l'adaptateur de données et le temps réel dans Express, Fastify ou du simple Node, et vous passer totalement du coordinateur.

→ [Custom Server Integration](/docs/backend/custom-server)

**Ce qu'il ne peut pas atteindre :** tout ce que `initializeRebaseBackend` configure, c'est-à-dire l'essentiel du backend — les routes d'authentification et le rafraîchissement des tokens, le stockage, la file de jobs, cron, l'API d'administration avec laquelle Studio communique, le serveur MCP, l'enveloppe d'erreur, la pile de middlewares. Chacun de ces éléments peut être assemblé manuellement ; aucun ne s'assemble tout seul. Rebase est une bibliothèque à cet échelon, pas un coordinateur.

Optez pour cette solution lorsque vous avez un serveur existant qui doit rester le point d'entrée. Si votre besoin réel est une simple route personnalisée, cela relève de l'échelon 3 ou 4, avec une surface d'exposition bien moindre.

## 6. `rebase eject`

**Portée :** le dépôt.

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, afin que le dépôt construise sa propre image au lieu d'exécuter le runtime publié.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Ce que cela coûte :** **les mises à niveau du runtime de la plateforme n'atteignent plus le projet.** CORS, câblage de l'authentification, stockage et procédure d'arrêt deviennent votre responsabilité à configurer et à maintenir. C'est le seul échelon de l'échelle dont le retour en arrière est difficile.

Prévisualisez d'abord. `--force` remplace un fichier `backend/src/index.ts` ou `env.ts` existant, en conservant le fichier actuel sous le nom `<name>.bak`.

## Quand aucune de ces options n'est la solution

Deux cas méritent d'être mentionnés, car l'échelle ne s'y applique pas.

**SQL brut.** Vous n'avez pas besoin de quitter le framework pour écrire une requête que le générateur de requêtes ne peut pas exprimer. Restreignez `driver.admin` avec `isSQLAdmin` et utilisez `executeSql`, depuis une fonction personnalisée ou un callback :

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

`driver` est ce que vous transmet le contexte d'une fonction personnalisée (`c.get("driver")`), ou `context.driver` dans un callback. Restreignez son type avec `isSQLAdmin` plutôt que de forcer le transtypage (casting) : ce garde fait la différence entre un driver incapable d'exécuter du SQL qui le signale clairement, et un driver qui lève une exception `admin.executeSql is not a function` au point d'appel.

**Quelque chose que le framework devrait faire mais ne fait pas.** Si vous vous retrouvez à patcher `@rebasepro/server-postgres`, ou à faire un eject pour un seul comportement, cela mérite l'ouverture d'une issue plutôt qu'un fork — [github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues). `beforeQuery` et `search.mode: "hybrid"` existent tous deux parce qu'un driver patché était la seule alternative.

## Voir aussi

- [Extending Rebase (frontend)](/docs/frontend/extending) — la même échelle pour le panneau d'administration
- [Per-collection callbacks](/docs/collections/callbacks)
- [Global hooks](/docs/backend/hooks)
- [Custom Functions](/docs/backend/custom-functions)
- [Custom Server Integration](/docs/backend/custom-server)
- [Search](/docs/backend/search)
- [Endpoint index](/docs/backend/endpoints) — toutes les routes montées par le serveur

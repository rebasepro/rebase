---
sourceHash: 8412da52cc99478c
title: Rebase ne fait pas X
sidebar_label: Étendre le serveur
description: L'échelle d'extension côté serveur — déclaration, hook de table, fonction personnalisée, vos propres routes, votre propre serveur, eject — avec ce que chacun peut et ne peut pas atteindre.
---

## Vue d'ensemble

Quelque chose dont vous avez besoin n'est pas dans la définition de la table. Cette page présente l'ordre dans lequel
essayer les différentes approches, et — ce qui est plus utile — ce que chaque barreau *ne peut pas* atteindre, afin que vous arrêtiez
de monter dès le premier niveau capable de faire le travail.

Il existe une page correspondante pour le panneau d'administration :
[Étendre Rebase](/docs/frontend/extending) couvre les plugins, les slots, les surcharges
de composants et les vues personnalisées. Celle-ci concerne le serveur.

La règle codifiée par l'échelle : **chaque barreau vous coûte quelque chose que le précédent
conservait.** Une déclaration est portable, évolutive et comprise par le planificateur
de schéma, le SDK généré et le panneau d'administration. Lorsque vous atteignez
`rebase eject`, vous êtes propriétaire de la séquence de démarrage, et les mises à niveau du runtime de la plateforme
n'atteignent plus votre projet. Grimpez donc uniquement jusqu'au niveau strictement nécessaire.

## L'échelle

| # | Barreau | Atteint | N'atteint **pas** | Coût d'être ici |
|---|---|---|---|---|
| 1 | **Déclaration** — une colonne, une relation, un index, un bloc `search`, une règle `rls` | Le schéma, le SDK généré, le panneau d'administration, le planificateur de migration | Tout ce qui doit exécuter du code | Aucun. C'est la voie recommandée |
| 2 | **Hook de table** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Chaque lecture et écriture d'une table, sur chaque transport, au sein de la transaction propre à la requête | Les requêtes qui ne touchent à aucune table ; l'enveloppe de réponse ; tout ce qui est asynchrone à l'écriture | S'exécute sur le chemin critique (hot path), maintenant la transaction ouverte |
| 3 | **Fonction personnalisée** — une application Hono dans `functions/` | Sa propre URL, avec l'authentification résolue, le driver limité à la portée de l'appelant et `rebase` sous la main | Les routes `/api/data` intégrées. Elle se place *à côté* d'elles, pas devant | Une surface d'autorisation supplémentaire ; aucune méthode SDK n'est générée pour elle |
| 4 | **Vos propres routes et middlewares** sur l'application Hono | Tout ce qui concerne HTTP, y compris les chemins s'exécutant *avant* les routeurs de Rebase | Le driver et l'identité de l'appelant, sauf si vous protégez la route vous-même | En dehors de tout routeur Rebase : aucun middleware d'authentification n'a été exécuté |
| 5 | **Votre propre serveur** — construisez le backend avec `createRebaseBackend` et montez les groupes de routes souhaités, ou intégrez le driver seul dans Express, Fastify ou du `http` pur | Chaque groupe de routes, au chemin de votre choix, et le choix du processus qui démarre les timers ; tout en bas, l'adaptateur de données et le temps réel seuls | Avec le driver seul : tout le reste, des routes d'authentification et du stockage jusqu'au cron et l'API d'administration | Vous appelez chaque étape que `initializeRebaseBackend` réalisait pour vous |
| 6 | **`rebase eject`** | Le point d'entrée et le `Dockerfile`, dans votre dépôt | — | **Les mises à niveau du runtime de la plateforme ne s'appliquent plus à ce projet.** Le CORS, la configuration de l'authentification, le stockage et l'arrêt vous incombent |

:::tip[Deux barreaux sont souvent sautés sans raison]
`beforeQuery` (barreau 2) restreint une lecture *avant qu'elle ne soit compilée*, ce qui est
la raison pour laquelle les gens montent généralement au barreau 3 ou 5. Et un bloc `search` avec
`mode: "hybrid"` (barreau 1) est ce pourquoi les gens se tournent généralement vers le SQL brut. Ces deux fonctionnalités sont
suffisamment récentes pour que les réponses plus anciennes sur Internet ne les mentionnent pas.
:::

## 1. Déclaration

La plupart des besoins d'un backend correspondent à une déclaration sur la table, car
la déclaration est le seul barreau que le reste du système peut interpréter. Le planificateur de schéma
la transforme en DDL, le générateur de code la convertit en méthodes SDK, le panneau d'administration
l'affiche, et `rebase doctor` la compare à la base de données active.

| Je veux… | Déclarer | Référence |
|---|---|---|
| Ajouter une colonne | une colonne `col.*` | [Colonnes](/docs/schema/columns/) |
| Lier deux tables | une relation `rel.*` | [Relations](/docs/collections/relations) |
| Rendre une requête rapide | `indexes` | [Index](/docs/backend/indexes) |
| Décider qui peut lire ou écrire une ligne | `rls` | [Sécurité au niveau des lignes (RLS)](/docs/collections/security-rules/) |
| Rechercher du texte correctement — accents, JSONB, classement, sous-chaînes | un bloc `search` | [Recherche](/docs/backend/search) |
| Trouver des lignes par similarité sémantique | une colonne `col.vector()` | [Recherche vectorielle](/docs/backend/vector-search/) |
| Conserver les lignes supprimées | `softDelete` | [Suppression réversible (Soft delete)](/docs/collections/soft-delete) |
| Enregistrer qui a modifié quoi | `history` | [Historique](/docs/backend/history) |
| Exécuter une tâche de manière planifiée | un fichier de cron job | [Tâches Cron](/docs/backend/cron-jobs) |
| Exécuter une action après une écriture, de manière asynchrone | un job | [Jobs](/docs/backend/jobs) |

**Ce qu'elle ne peut pas atteindre :** tout ce qui doit prendre une décision au moment de la requête.
Une déclaration est une donnée. Si la réponse dépend de l'auteur de la demande, passez au barreau 2.

## 2. Hooks de table

**Portée :** une table, ou toutes les tables lorsqu'ils sont exportés sous le nom `hooks` depuis
`backend/hooks.ts` (`initializeRebaseBackend({ hooks })` après éjection).

Les hooks se déclenchent sur **tous** les chemins de données — REST, le SDK, les souscriptions
WebSocket et les écritures côté serveur via `rebase.dataAsAdmin` — et chacun s'exécute à l'intérieur
de la transaction ouverte pour cette requête. C'est là tout leur intérêt : il n'y a aucun moyen
d'accéder aux lignes d'une table en les contournant.

| Hook | Se déclenche | Utilisé pour |
|---|---|---|
| `beforeQuery` | avant la compilation d'une lecture | restreindre **les lignes** ciblées par une lecture |
| `afterRead` | par ligne, après sa récupération | caviardage, masquage de données sensibles (PII), champs calculés |
| `beforeSave` | après validation, avant l'écriture | valeurs par défaut, colonnes dérivées, refus d'une écriture |
| `afterSave` | après l'écriture, avant le commit | effets secondaires devant être annulés avec celle-ci |
| `afterSaveError` | lorsqu'une sauvegarde lève une exception | journalisation/rapports ; `props.error` contient l'erreur levée |
| `beforeDelete` | avant la suppression | refuser la suppression |
| `afterDelete` | après la suppression, avant le commit | nettoyage en cascade |

→ [Hooks de table](/docs/collections/callbacks) ·
[Hooks globaux](/docs/backend/hooks)

### Restreindre une lecture avec `beforeQuery`

<span class="since-badge" data-since="0.31">Depuis la 0.31</span>

`afterRead` accède aux lignes qui ont déjà été récupérées, il peut donc masquer une valeur
mais ne peut pas empêcher la ligne d'être lue. `beforeQuery` intervient plus tôt : il reçoit
la requête analysée et renvoie des conditions à combiner avec **AND**.

```ts
// backend/schema/documents.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const documents = defineTable("documents", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        tenantId: col.text(),
        body: col.text()
    },
    rls: "admin-only",
    hooks: {
        beforeQuery: ({ context }) => {
            if (context.user?.roles?.includes("admin")) return;        // no narrowing
            return { filter: { tenantId: ["==", context.user?.claims?.tenant ?? null] } };
        }
    }
});
```

Quatre propriétés sont essentielles à connaître avant de vous reposer dessus :

- **Il ne peut que restreindre.** La valeur de retour est un filtre combiné par AND, et il
  n'existe aucune structure qu'il puisse renvoyer pour élargir la lecture. C'est délibéré : un hook
  qui recevrait la requête et devrait en renvoyer une pourrait supprimer une condition, et sur un
  plan de données régi par le RLS, une condition supprimée renverrait toutes les lignes autorisées
  par les politiques.
- **Il se déclenche sur chaque chemin de lecture.** La liste, la récupération unitaire, le décompte (count),
  l'agrégat, la recherche, la lecture vectorielle, une liste imbriquée, le rafraîchissement temps réel
  qui génère les frames de souscription, ainsi que les lignes chargées pour une relation ou
  un `?include=` — où c'est le hook de la table **cible** qui s'applique.
  Un hook pris en compte par le listing mais ignoré par le décompte produirait une page affichant
  « 1 sur 4 résultats ».
- **Un filtre qu'il ne peut pas compiler refuse la requête.** Mentionner une colonne qui
  n'existe pas dans la table génère une erreur 400, et non une condition ignorée, quelle que soit
  la configuration de `configureUnknownFilterFields`.
- **Une écriture sur une ligne qu'il exclut renvoie une 404.** Une mise à jour ou une suppression ciblant
  une ligne hors du périmètre est refusée avant l'écriture, avec la même réponse « aucune ligne… »
  qu'une lecture — une restriction s'applique donc aussi aux écritures, pas seulement aux
  lectures. Ce qu'il ne valide *pas*, ce sont les valeurs écrites : le refus d'une écriture
  en fonction de son contenu relève de `beforeSave`.

Une lecture n'est délibérément *pas* restreinte : la vérification d'unicité derrière
`.unique()`. Elle cherche à déterminer si une valeur existe n'importe où dans la
table ; si elle était restreinte, elle indiquerait « unique » pour une valeur déjà contenue
dans une ligne masquée — menant l'insertion à échouer sur la contrainte à la place.

**Ce que les hooks ne peuvent pas atteindre :**

- Une requête qui ne touche aucune table. Il n'y a aucun élément auquel
  rattacher le hook.
- L'enveloppe de réponse — code de statut, en-têtes, structure de pagination. Un hook
  renvoie des valeurs, pas une réponse.
- Les opérations qui doivent survivre à la transaction. `afterSave` s'exécute *avant* le commit,
  donc une erreur levée à cet endroit annule (rollback) l'écriture. Tout ce qui doit subsister après
  l'annulation d'une écriture ne fait pas partie de l'écriture : placez-le dans la
  [file de jobs](/docs/backend/jobs).
- En pratique, les traitements lents. Un hook maintient la transaction ouverte ainsi qu'une
  connexion du pool. Tout ce qui communique avec un service tiers doit aller dans la file.

## 3. Fonctions personnalisées

**Portée :** une URL sous `/api/functions`.

Une application Hono dans `backend/functions/`, découverte par son nom de fichier à la manière des tâches cron,
ou transmise sous forme de valeur (`functions: { promote }`). Les middlewares d'authentification ont déjà été exécutés lorsque votre gestionnaire est atteint,
le driver est restreint à l'appelant, et `rebase` est disponible pour le stockage, les e-mails,
les jobs et `dataAsAdmin`.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.table("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Fonctions personnalisées](/docs/backend/custom-functions)

**Ce qu'elle ne peut pas atteindre :** les routes `/api/data` intégrées. Une fonction se situe
*à côté* de ces dernières, pas devant, elle ne peut donc pas modifier la façon dont une liste est
filtrée, paginée ou structurée — cela relève du barreau 2. De plus, aucune méthode SDK n'est
générée pour elle ; les appelants l'invoquent avec `client.functions.invoke(...)` ou un simple `fetch`.

## 4. Vos propres routes et middlewares

**Portée :** l'application Hono, avant que Rebase n'intervienne.

`initializeRebaseBackend` prend l'application que vous lui transmettez, donc tout ce que vous enregistrez sur
cette application *avant* cet appel s'exécute avant chaque routeur Rebase — consultez
[Ordre d'enregistrement des routes](/docs/backend/custom-functions#route-registration-order)
pour en voir la structure. Un groupe de routes que vous montez vous-même depuis `backend.routes` (barreau 5)
ne fait pas partie de ces routes : il intègre son propre middleware d'authentification.

:::caution[Aucun middleware d'authentification n'a été exécuté à cet endroit]
Une route enregistrée de cette manière est située **en dehors** de tout routeur Rebase,
`getDriver(c)` n'est donc pas défini et aucun jeton n'a été vérifié. Protégez-la avec
`requireAuth` importé depuis **`@rebasepro/server`** — la racine du paquet — qui
vérifie lui-même le jeton, puis `requireAdmin` ou `requireScope` depuis ce même
import pour déterminer ce que l'appelant est autorisé à faire. Les gardes exportés depuis
`@rebasepro/server/functions` lisent une identité déjà résolue par un routeur Rebase,
et renverront une erreur 500 plutôt que de feindre qu'il en existe une.
:::

Un piège classique de Hono à signaler, car il est silencieux : `app.use("/*", guard)` ne couvre
que les routes déclarées *en dessous* de lui. Une route ajoutée ultérieurement — en bas
du fichier, plusieurs mois plus tard — ne sera pas protégée. Placez les gardes directement
dans l'emplacement de middleware dédié de la route.

**Ce qu'elle ne peut pas atteindre :** l'identité, le driver scopé et l'enveloppe d'erreur
— à moins que vous ne les configuriez vous-même. Tout ce qu'un routeur Rebase fournit à un gestionnaire est
le fruit d'un traitement effectué par ce routeur.

## 5. Votre propre serveur

**Portée :** le processus.

`initializeRebaseBackend` est un raccourci regroupant plusieurs appels publics, et ce barreau
consiste à les appeler vous-même. `createRebaseBackend` initialise le backend sans rien monter,
démarrer ou écouter. `backend.routes` met à disposition chaque groupe de routes sous la forme d'une
sous-application Hono que vous pouvez monter individuellement, sur n'importe quel chemin. `mount`, `attachRealtime` et
`start` se chargent du reste, si vous le souhaitez :

```typescript
const backend = await createRebaseBackend({ database: adapter, auth, schemaDir, provision: true });

app.route("/v2/data", backend.routes.data());   // only the parts you want,
app.route("/v2/auth", backend.routes.auth());   // at the paths you want
await backend.attachRealtime(server);
backend.start();                                // cron, job workers, sweeps
```

Un groupe intègre son propre contexte d'authentification, ses limites de requêtes (rate limits) et son contrôle d'administration, et rejette
les en-têtes d'usurpation d'identité et de simulation, sauf s'il s'agit du groupe data ou functions,
de sorte que `getDriver(c)` fonctionne dans un groupe monté n'importe où. En revanche, il n'embarque pas les
middlewares globaux ajoutés par `mount()` : la limite de taille du corps de requête, la compression, la protection CSRF et
l'enveloppe d'erreur doivent être ajoutés par vos soins lorsque vous montez les groupes un par un.

En allant encore un cran plus bas, `@rebasepro/server-postgres` est indépendant de tout framework : il
ne dépend que de Drizzle et du module `http.Server` de Node, vous pouvez donc intégrer
le driver de données et le temps réel dans Express, Fastify ou Node pur, en vous passant
totalement du serveur Rebase.

→ [Intégration d'un serveur personnalisé](/docs/backend/custom-server)

**Ce qu'il ne peut pas atteindre :** avec `createRebaseBackend`, rien n'est inaccessible ;
vous assumez simplement l'ordre des appels. Avec le driver seul, tout ce que le
serveur configure doit être conçu par vos soins : les routes d'authentification et le rafraîchissement des jetons, le stockage,
la file de jobs, le cron, l'API d'administration utilisée par le Studio, le serveur MCP,
l'enveloppe d'erreur et la suite de middlewares.

Adoptez cette approche lorsque vous avez un serveur existant qui doit rester le point d'entrée, ou
lorsqu'une partie seulement du backend doit tourner dans ce processus. Si votre besoin réel
se résume à une route personnalisée, cela relève du barreau 3 ou 4, avec une surface de code bien moindre.

## 6. `rebase eject`

**Portée :** le dépôt.

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son
backend, de sorte que le dépôt compile sa propre image au lieu d'utiliser le
runtime publié.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Ce que cela coûte :** **les mises à niveau du runtime de la plateforme ne s'appliquent plus au projet.**
Le CORS, la configuration de l'authentification, le stockage et l'arrêt deviennent sous votre entière responsabilité.
C'est le seul barreau de l'échelle sur lequel il est difficile de faire marche arrière.

Prévisualisez les changements au préalable. `--force` remplace un fichier `backend/src/index.ts` ou
`env.ts` existant, en conservant le fichier actuel sous la forme `<nom>.bak`.

## Quand aucune de ces options n'est la bonne

Deux situations méritent d'être mentionnées, car l'échelle ne leur correspond pas.

**Le SQL brut.** Vous n'avez pas besoin de quitter le framework pour concevoir une requête que le
générateur de requêtes ne peut pas formuler. Restreignez `driver.admin` avec `isSQLAdmin` et utilisez
`executeSql`, depuis une fonction personnalisée ou un hook :

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

`driver` est ce que vous transmet le contexte d'une fonction personnalisée (`c.get("driver")`), ou
`context.driver` à l'intérieur d'un hook. Restreignez son type avec `isSQLAdmin` plutôt que
par un transtypage (cast) : cette garde permet à un driver incapable d'exécuter du SQL de le
signaler proprement, au lieu de lever une erreur `admin.executeSql is not a function` au moment de l'appel.

`executeSql` renvoie
toutes les lignes qu'il lit. Pour le SQL dont vous ne maîtrisez pas le volume de données, passez `maxResultBytes` :
un résultat dont les lignes dépassent cette taille en octets est rejeté avec une erreur dont
le champ `code` est `RESULT_TOO_LARGE`, sans jamais être renvoyé partiellement. L'événement temps réel
`EXECUTE_SQL`, par lequel passe l'`executeSql` d'un client admin, fixe cette limite à 128 Mo pour
tous les appelants.

**Une fonctionnalité que le framework devrait gérer et ne gère pas.** Si vous en venez à
devoir patcher `@rebasepro/server-postgres`, ou à vous éjecter pour un seul comportement, cela
mérite l'ouverture d'une issue plutôt qu'un fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
`beforeQuery` et `search.mode: "hybrid"` existent tous deux parce qu'un driver patché
était la seule autre solution.

## Voir aussi

- [Étendre Rebase (frontend)](/docs/frontend/extending) — la même échelle pour le panneau d'administration
- [Hooks de table](/docs/collections/callbacks)
- [Hooks globaux](/docs/backend/hooks)
- [Fonctions personnalisées](/docs/backend/custom-functions)
- [Intégration d'un serveur personnalisé](/docs/backend/custom-server)
- [Recherche](/docs/backend/search)
- [Index des endpoints](/docs/backend/endpoints) — chaque route montée par le serveur

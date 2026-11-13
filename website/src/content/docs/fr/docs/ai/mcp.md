---
sourceHash: 43fd981d241b2237
title: Serveur MCP
sidebar_label: Serveur MCP
description: Connectez Claude Code, Cursor, Gemini CLI ou n'importe quel client MCP à un projet Rebase — les 53 outils qu'il expose, l'identifiant avec lequel il s'authentifie et la barrière loopback qui s'interpose entre un agent et la production.
---

`@rebasepro/mcp` est un serveur [Model Context Protocol](https://modelcontextprotocol.io)
qui fournit à un assistant IA de véritables outils sur un projet Rebase : lire et
écrire des lignes, gérer les utilisateurs, exécuter des migrations,
invoquer des fonctions, piloter le serveur de développement.

Il communique via MCP sur **stdio uniquement**. Il n'y a aucun port ni aucun écouteur — le
processus est exactement aussi digne de confiance que ce qui l'a lancé, et il n'y a aucun
appelant distant à authentifier. C'est la partie sécurisée. Les questions intéressantes
portent toutes sur ce qu'il fait *une fois* en cours d'exécution, et cette page y répond
avant de vous présenter le bloc de configuration.

Un backend déployé peut également servir MCP lui-même, via HTTP, aux personnes qui utilisent
votre application. Il s'agit de quelque chose de différent avec un modèle d'identifiants différent :
voir [Le point de terminaison MCP distant](/docs/ai/remote-mcp/).

:::tip[Vous utilisez Claude sur le Web, sur ordinateur ou sur mobile ?]
Ajoutez plutôt le [connecteur Rebase](/docs/ai/rebase-connector/) :
`https://app.rebase.pro/mcp`, une seule fois, pour chaque projet que vous exécutez sur Rebase Cloud
ou sur vos propres serveurs. Cette page concerne le serveur local qu'un assistant de code démarre
à l'intérieur d'un projet.
:::

## Connexion d'un client

Le serveur s'exécute depuis votre projet : `@rebasepro/mcp` est une devDependency que chaque
squelette généré par `rebase init` verrouille avec le CLI, et chaque bloc ci-dessous — l'intégration
complète — démarre cette copie (`pnpm exec rebase-mcp`, ou `npx --no rebase-mcp` dans un projet npm),
jamais une version plus récente depuis npm. Un projet plus ancien l'ajoute une fois,
avec `rebase skills install --mcp` ou `pnpm add -D @rebasepro/mcp`.

`rebase init` écrit le bloc pour chaque agent que vous choisissez lorsqu'il
[configure vos agents de codage IA](/docs/ai/skills#set-up-by-rebase-init), en conservant
tous les autres serveurs déjà présents dans le fichier. `rebase init --agent cursor,codex` fait
de même sans poser de questions.

**Claude Code** — `.mcp.json` à la racine de votre projet. `rebase init` écrit ce
fichier pour vous :

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Cursor** — la même structure, dans `.cursor/mcp.json`. Cursor remplace
`${workspaceFolder}` par la racine du projet :

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Gemini CLI** — `.gemini/settings.json`, sous la même clé :

```json title=".gemini/settings.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Codex CLI** — TOML plutôt que JSON, dans le fichier `.codex/config.toml` du projet.
Codex ne lit la configuration d'un projet qu'une fois que vous lui avez accordé votre confiance :

```toml title=".codex/config.toml"
[mcp_servers.rebase]
command = "pnpm"
args = ["exec", "rebase-mcp"]

[mcp_servers.rebase.env]
REBASE_PROJECT_DIR = "."
```

**Kiro** — `.kiro/settings/mcp.json` :

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**GitHub Copilot dans VS Code** — `.vscode/mcp.json`, sous `servers` et avec
un transport explicite :

```json title=".vscode/mcp.json"
{
  "servers": {
    "rebase": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Windsurf** lit les serveurs MCP uniquement depuis sa configuration au niveau utilisateur, il n'y a donc
aucun fichier de projet à écrire. Ajoutez le serveur dans ses paramètres MCP sous `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, avec ce chemin comme `REBASE_PROJECT_DIR`.

Tout client MCP capable de lancer un serveur stdio fonctionne ; la structure est la même.

### Sur quel répertoire il agit

`REBASE_PROJECT_DIR` est le répertoire contenant `rebase.json`. Il existe **un seul**
ordre de priorité, et il est le même dans chaque client :

1. **Le bloc d'environnement** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si l'un d'eux est défini, le projet `default` est reconstruit
   à partir de ceux-ci à chaque démarrage.
2. **Le répertoire de travail du serveur**, lorsqu'il contient un fichier `rebase.json`. Le projet
   dans lequel vous vous trouvez prime sur tout ce qui est mémorisé dans `~/.rebase/projects.json`.
3. **La valeur par défaut persistée (`default`)** dans `~/.rebase/projects.json`, lorsque aucun des
   deux premiers n'indique quoi que ce soit.

L'auto-détection à partir de `.rebase/state.json` comble les manques dans ces trois cas et
n'écrase jamais une valeur fournie par l'un d'eux.

Les blocs au niveau projet désignent le projet — `"."`, le répertoire de travail
du client, ou `${workspaceFolder}` de l'éditeur — car la règle 3 lit un fichier
partagé par tous les projets de la machine. Une configuration au niveau utilisateur, comme celle
de Windsurf, indique plutôt un chemin absolu.

## Ce que le serveur peut atteindre

C'est la section à lire avant de pointer un assistant vers une base de données qui vous
importe.

Le serveur utilise **un seul identifiant ambiant pour l'ensemble du processus**. Il n'y a pas
d'identité par outil ni de mode lecture seule ; chaque outil utilise le même jeton, et le
seul commutateur du package permet d'*augmenter* la portée plutôt que de la restreindre.

Voici de quel identifiant il s'agit, par ordre de priorité :

1. `REBASE_API_TOKEN` provenant de l'environnement. `REBASE_TOKEN` n'est pas lu ici :
   c'est le jeton du plan de contrôle du CLI, et il n'est jamais envoyé à l'application (le
   serveur le signale une fois sur stderr lorsqu'il est le seul défini). Les outils cloud
   le transmettent toujours au CLI qu'ils lancent, qui l'envoie au plan de contrôle.
2. `REBASE_SERVICE_KEY` lu depuis le fichier `.env` du projet.
3. La clé de service découverte automatiquement depuis `.rebase/state.json` pendant que
   `rebase dev` est en cours d'exécution.

2 et 3 représentent la clé du backend de développement de cette machine, utilisée uniquement lorsque la cible
est sur loopback. Lorsque `REBASE_BASE_URL` pointe ailleurs — `rebase cloud init --claim`
écrit l'adresse du projet cloud, et aucun `REBASE_API_TOKEN` jusqu'à ce qu'un déploiement
réussisse — le serveur n'envoie aucun jeton et le signale une fois sur stderr.

Un jeton que vous enregistrez pour un projet **l'emporte sur l'auto-détection**. La découverte
ne fait que combler un manque.

:::danger[La voie zéro-configuration utilise un identifiant administrateur]
Les options 2 et 3 correspondent à la **clé de service** — un secret administrateur sans restriction de portée. Le backend
la résout en `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Cette
identité détient chaque [portée](/docs/backend/roles-and-scopes/), et elle satisfait les
politiques `_default_admin_read` / `_default_admin_write` que Rebase injecte dans
chaque table n'ayant pas défini `defaultPolicies: false`.

La réponse honnête à la question « La RLS la restreint-elle toujours ? » est donc : la RLS *s'exécute* — le
pilote rétrograde bien vers le rôle `rebase_user` — puis une politique écrite par Rebase
lui-même accorde tout à cette identité. Lire chaque ligne de chaque
table est le **comportement prévu de la configuration par défaut**, et non un
contournement.

Avec la configuration sans réglage, un agent disposant de ces outils peut lire et écrire chaque
ligne de chaque table, lister tous les utilisateurs, réinitialiser n'importe quel mot de passe, invoquer n'importe quelle
fonction backend et exécuter du DDL sur n'importe quel `DATABASE_URL` résolu par le projet.
:::

### Lui attribuer plutôt un identifiant restreint

Enregistrez une [clé d'API](/docs/backend/api-keys) à portée limitée et le modèle à deux
barrières s'applique réellement. Une clé de service s'exécute avec les rôles `["service"]`, que les
politiques d'administration injectées ne mentionnent **pas** — la RLS ne lui accorde donc rien à moins qu'une de
vos propres politiques n'en dispose autrement, et ses portées la restreignent davantage :

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Transmettez ensuite la clé `rk_live_…` obtenue au serveur plutôt que de le laisser
détecter une clé de service :

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absolute/path/to/your/project",
        "REBASE_API_TOKEN": "rk_live_..."
      }
    }
  }
}
```

Deux choses que cela ne fait **pas**, toutes deux bonnes à savoir avant de vous y fier :

- **Cela ne restreint pas les outils CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` et les outils de branche lancent le CLI Rebase, qui se connecte avec
  `DATABASE_URL` et ne voit jamais votre jeton. La barrière loopback ci-dessous est la
  seule protection devant ceux-ci.
- **Une clé n'accède à un outil d'administration qu'avec la portée correspondante.** `list_users` et
  `list_roles` nécessitent `users:read` ; `create_user`, `update_user`, `delete_user` et
  `rebase_auth_reset_password` nécessitent `users:write` ; les outils de stockage et de cron
  nécessitent la portée `storage:*` ou `cron:*` correspondante ; `invoke_function` nécessite
  `functions:invoke`. Sans
  elle, l'appel répond `403 SCOPE_MISSING`. Même avec `users:write`, une clé ne peut pas
  modifier le compte d'un administrateur : un administrateur détient `keys:read` et `keys:write`, ce qu'aucune
  clé ne peut avoir, et personne ne peut gérer un compte qui possède plus de droits que soi-même.

Une clé créée avec `--roles admin` est différente : elle porte les rôles
`["service", "admin"]`, ce qui valide les mêmes politiques d'administration par défaut que la clé
de service. Donnez-lui également `--full-access` et sa portée sera celle de la clé de service,
la gestion des clés en moins. Ce qu'elle apporte de plus, c'est qu'elle est **révocable, expirante et
limitée en débit par clé**, ce qui n'est pas le cas de la clé de service — faire tourner cette dernière
nécessite de modifier `.env` et de redémarrer le serveur.

Consultez [Agents et serveurs MCP](/docs/backend/api-keys#agents-and-mcp-servers) pour le
guide complet sur la définition des portées de clés.

### Mettre une table totalement hors de portée

<span class="since-badge" data-since="0.31">Since 0.31</span>

La raison pour laquelle un identifiant administrateur lit tout est la politique de base que Rebase
injecte dans chaque table, accordant l'accès au contexte de serveur de confiance et au
rôle `admin`. Une table peut refuser cette base et assumer l'entière
responsabilité de sa propre RLS :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const medicalRecords = defineTable("medical_records", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        patientId: col.text(),
        notes:     col.text(),
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    defaultPolicies: false,
    rls: [
        { operations: ["select", "update"], ownerField: "patientId" },
    ],
});
```

Désormais, le seul moyen d'y accéder est de correspondre à `patientId`. L'uid de la clé de service étant la
chaîne littérale `service`, une règle de propriétaire n'y correspond jamais — les lectures renvoient zéro
ligne et les écritures sont rejetées par Postgres. Il s'agit du seul contrôle qui contraint
l'identifiant par défaut du serveur MCP plutôt que de le supposer acquis.

N'oubliez pas qu'il s'agit d'un véritable changement RLS, et non d'un changement de documentation : il ne prend effet
qu'une fois que `rebase schema generate` et une migration ont appliqué les politiques. Voir
[Sécurité au niveau des lignes (RLS)](/docs/collections/security-rules).

## La barrière loopback

<span class="since-badge" data-since="0.31">Since 0.31</span>

`rebase_project_add` accepte n'importe quel `baseUrl`, et les outils CLI se connectent avec
le `DATABASE_URL` déclaré par le projet. La même liste d'outils qui modifie une base de
données de test sur votre ordinateur portable peut par conséquent supprimer des lignes de production, sans rien
d'autre entre les deux que le discernement de l'assistant quant au projet actif.

**Tout outil qui modifie l'environnement cible est refusé, sauf si cette cible se trouve
sur l'interface loopback.** La barrière est conçue sous forme d'une liste de ce qui n'est *pas*
restreint, de sorte qu'un outil ajouté ultérieurement soit protégé par défaut.

- **Non restreints — lectures :** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, et les lectures Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Non restreints — écritures Rebase Cloud :** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Le provisionnement crée un projet ; les autres modifient un projet de production. Aucun
  d'entre eux ne passe par `baseUrl` ou `DATABASE_URL`, qui sont les seuls éléments que la barrière peut
  vérifier. Voir [Rebase Cloud](#rebase-cloud) pour savoir ce qui les protège.
- **Non restreints — local uniquement :** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, les outils du serveur de développement et les outils de registre de projets.
  Ceux-ci écrivent des fichiers locaux ou un état local et n'ont pas de cible distante à vérifier.
- **Restreints par rapport à `DATABASE_URL` :** les outils CLI restants — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Restreints par rapport au `baseUrl` du projet :** les outils SDK restants —
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  et `invoke_function`.

Les deux cibles ne sont pas interchangeables. Les outils CLI ne voient jamais `baseUrl` ; ainsi, un
backend sur localhost situé à côté d'un `DATABASE_URL` de production est vérifié par rapport à
la base de données, et non par rapport au backend.

Un refus ressemble à ceci :

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si aucune chaîne de connexion ne peut être résolue, les outils de base de données restreints sont refusés.**
Sans `DATABASE_URL`, le CLI utilise la base de données de développement gérée, qui est
la valeur par défaut pour un nouveau projet, et la barrière y refuse ses quatre outils de base de données.
Le message de refus en explique la raison et indique ce qui fonctionne à la place. Il ne suggère pas
de désactiver la protection :

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Depuis un terminal,
`rebase db push` et `rebase db migrate` s'exécutent bien sur cette base de données ; seuls les
outils MCP sont refusés.

Seul le loopback est considéré comme local : `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(et `0.0.0.0`).
Les plages privées telles que `10.x` et `192.168.x` ne le sont **pas** — elles sont tout aussi
susceptibles d'être un cluster de staging partagé qu'un ordinateur portable, et les traiter comme locales
laisserait passer précisément l'accident que la barrière est censée empêcher.

Définissez `REBASE_MCP_ALLOW_REMOTE_WRITES=true` pour désactiver cette protection. Le définir globalement dans
la configuration de votre client MCP supprime la barrière pour tous les projets auxquels le serveur peut accéder,
et pas seulement celui auquel vous pensiez.

## Marquage des données non fiables

Les lignes, les enregistrements d'utilisateurs, les listes de stockage, les tâches cron, les réponses de fonctions et les
sorties CLI sont renvoyés enveloppés dans une balise explicite :

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Tout ce qui est stocké dans votre base de données a été écrit par quelqu'un, et arrive
sur le même canal que le contrat d'outil que l'assistant suit. L'enveloppe indique
au modèle de le traiter comme du contenu inerte plutôt que comme des instructions.

L'`id` est généré à neuf pour chaque réponse, après l'écriture des données, et
seul le marqueur de fin portant cet identifiant ferme le bloc. Tout texte à l'intérieur des données qui
ressemble à un marqueur est interrompu par un espace sans chasse, de sorte qu'une ligne affichant
`<<<END_UNTRUSTED_DATA>>>` ne puisse pas fermer l'enveloppe prématurément et exposer ce qui suit
en dehors de celle-ci.

Le [point de terminaison distant](/docs/ai/remote-mcp/) isole les résultats de ses outils de la même
manière et le signale au client ; son `structuredContent` transporte le résultat brut.
`list_tables` et
`describe_table` font exception : seul un modèle les lit, elles sont donc
envoyées une seule fois, dans le texte.

Il s'agit d'un marqueur, pas d'un bac à sable. Un assistant disposant de ces outils n'est sûr
qu'à hauteur de la sûreté du contenu que vous lui permettez de lire.

## Projets multiples

Les configurations de projets sont stockées dans `~/.rebase/projects.json`, et le serveur
peut en gérer plusieurs à la fois — utile lorsque vous travaillez sur des environnements locaux
et distants. Pendant que `rebase dev` est en cours d'exécution, le serveur lit le port actif et
la clé de service dans `.rebase/state.json` dans le répertoire du projet, ce qui rend le cas
local sans aucune configuration nécessaire.

:::note[Le registre a le dernier mot, pas le premier]
L'ordre de priorité est celui indiqué ci-dessus : le bloc d'environnement, puis le répertoire de travail
lorsqu'il contient un `rebase.json`, puis le `default` persisté.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` et `REBASE_API_TOKEN` reconstruisent le
projet `default` **à chaque démarrage**, pas seulement au premier. La reconstruction concerne
l'entrée entière : un jeton enregistré pour l'ancien `projectDir` est abandonné plutôt
que transféré dans un répertoire pour lequel il n'a jamais été émis. Un projet `default` obtenu
de cette manière — ou à partir du répertoire de travail — n'est jamais réécrit dans
`~/.rebase/projects.json`, afin que la clé de service de développement d'un projet ne puisse pas devenir
celle d'un autre.

`activeProject` est persistant, donc si une session précédente a appelé
`rebase_project_switch`, les outils ciblent ce projet et le serveur le signale sur
stderr — à moins que ce projet ne soit enregistré dans un répertoire *différent* de
celui dans lequel ce serveur s'exécute, auquel cas il revient à `default` et le
signale. Si un assistant semble lire la mauvaise base de données, appelez
`rebase_project_current` d'abord.
:::

Les jetons sont stockés dans ce registre **en texte brut**. Il s'agit d'un fichier dans votre
répertoire personnel contenant des identifiants administrateur pour chaque projet que vous avez enregistré ;
traitez-le en conséquence.

## Rebase Cloud

Huit outils permettent de faire passer une application de ce répertoire à un backend opérationnel sur
[Rebase Cloud](/docs/deployment/cloud/) et de la maintenir en fonctionnement. Chacun lance
`rebase cloud <command> --json` dans le répertoire du projet actif : la même
commande qu'un utilisateur exécute, il n'y a donc aucune seconde implémentation susceptible de diverger.

| Outil | Exécute | Modifie le projet |
|---|---|---|
| `rebase_cloud_provision` | `rebase cloud init --claim` | En crée un, sans compte |
| `rebase_cloud_status` | `rebase cloud status` | Non |
| `rebase_cloud_deploy` | `rebase cloud deploy` | Oui |
| `rebase_cloud_logs` | `rebase cloud logs [--runtime]` | Non |
| `rebase_cloud_env_list` | `rebase cloud env list` | Non |
| `rebase_cloud_env_set` | `rebase cloud env set KEY --stdin` | Oui, à partir du prochain déploiement |
| `rebase_cloud_deployments_list` | `rebase cloud deployments list` | Non |
| `rebase_cloud_rollback` | `rebase cloud rollback --yes` | Oui |
| `rebase_cloud_projects_list` | `rebase cloud projects list --all-orgs` | Non |

Le parcours habituel de l'agent est le suivant : `rebase_cloud_provision`, puis donner à l'utilisateur l'URL
de revendication ; `rebase_cloud_status` pour voir le projet (tant qu'il n'est pas revendiqué,
`unclaimed` contient l'URL de revendication et le moment de sa suppression) ; `rebase_cloud_deploy`
après une modification ; `rebase_cloud_logs` en cas de dysfonctionnement ; et
`rebase_cloud_rollback` lorsque la production est en panne.

**Sur quoi ils agissent.** Le projet auquel le répertoire actif est lié dans
`.rebase/cloud.json`. Aucun d'eux ne prend d'identifiant de projet ou de répertoire, de sorte qu'un
assistant ne peut pas les faire pointer vers un autre projet que celui auquel le répertoire est
lié. Changer de projet actif avec `rebase_project_switch` change
le répertoire dans lequel ils s'exécutent.

**Sous quelle autorité.** Ce que le CLI résout dans ce répertoire : `REBASE_TOKEN`
lorsqu'il est défini, puis le jeton stocké par `rebase cloud init --claim` pour un
projet non revendiqué, puis la session `rebase cloud login`. Dans le répertoire de ce
projet non revendiqué, un `REBASE_TOKEN` qui ne possède aucune portée sur le projet est mis
de côté au profit du jeton propre au projet. Le plan de contrôle
vérifie chaque appel comme il vérifie ceux du CLI ; ainsi, avec un jeton créé par
`rebase cloud tokens create --can logs`, un assistant peut lire les logs, et le
plan de contrôle refusera ses déploiements, variables et rollbacks. L'absence d'identifiant, ou un identifiant refusé, renvoie une erreur indiquant ce que
l'utilisateur doit faire (`rebase cloud login`, ou revendiquer le projet).

**Pourquoi la barrière loopback ne s'applique pas.** La barrière vérifie le `baseUrl` de l'application et
le `DATABASE_URL` du CLI ; ces outils n'utilisent ni l'un ni l'autre. Après `rebase_cloud_provision`,
`REBASE_BASE_URL` pointe vers le nouveau projet cloud, donc appliquer la barrière dessus refuserait
le déploiement même dont le flux a besoin. Le provisionnement lui-même ne fait que créer : il ne touche
à aucune application ou base de données existante, et le CLI le refuse toujours dans un répertoire
déjà lié. Un déploiement, une variable et un rollback modifient
chacun la production. Ce qui se dresse devant eux, ce sont les identifiants décrits ci-dessus et
l'approbation des outils par votre client MCP. Pour empêcher un assistant de modifier un projet
cloud, définissez `REBASE_TOKEN` dans l'environnement du serveur avec un jeton ne disposant pas des
fonctionnalités `deploy` et `env`.

**Lire n'importe lequel de vos projets.** Les outils ci-dessus agissent sur le projet lié.
Pour lire les données d'un autre projet — n'importe quel projet de n'importe quelle organisation à laquelle
appartient le compte connecté, lié ici ou non — `rebase_cloud_projects_list` les énumère
et `rebase_project_use_cloud` (avec un identifiant, un slug ou un nom) y dirige les outils de données et
d'administration : `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Ces appels passent par le proxy Studio de la console,
munis des propres identifiants du CLI (`rebase cloud access-token`, lu à chaque appel et jamais stocké) ;
le plan de contrôle vérifie l'accès de l'utilisateur et associe la clé de service du projet de son côté,
de sorte qu'aucune clé n'atteint la machine. Un projet dont Studio est désactivé est refusé,
et le commutateur l'indique. Il s'agit d'une cible distante comme une autre, les outils modifiant
les données y restent donc refusés sauf si `REBASE_MCP_ALLOW_REMOTE_WRITES` est défini ;
`rebase_project_switch` permet de revenir en arrière.

Chaque outil est un instantané :

- `rebase_cloud_logs` ne suit jamais en continu. Son résultat contient `nextSinceTime` ; renvoyez-le
  en tant que `since` pour lire ce qui s'est passé après. Il renvoie les 200 dernières lignes sauf si
  `tail` en indique autrement. `source: "build"` renvoie plutôt les derniers logs de build.
- `rebase_cloud_deploy` suit le déploiement jusqu'au bout et vérifie que la nouvelle
  version répond. `wait: false` revient dès que le déploiement est déclenché.
  Il n'éjecte jamais un projet du runtime managé, ne déploie jamais une version plus ancienne du
  framework et n'ignore jamais les vérifications de build : ce sont les décisions de l'utilisateur, et un
  refus nécessitant l'une d'elles le signale.
- `rebase_cloud_rollback` passe `--yes`. L'appel d'outil constitue la confirmation, puisqu'il
  n'y a pas de terminal pour la demander.

`rebase_cloud_env_set` écrit la valeur sur l'entrée standard du CLI, de sorte qu'elle ne se retrouve
jamais sur une ligne de commande où `ps` pourrait l'afficher, et la valeur est expurgée de tout
ce que l'outil renvoie. Son résultat indique ce qui a été stocké (la clé, si elle est secrète, si un
redéploiement est en attente), jamais la valeur. `rebase_cloud_env_list` liste uniquement les clés.
Un CLI trop ancien pour `env set --stdin` est refusé avec un message invitant à le mettre à niveau ;
la valeur n'est pas envoyée par un autre moyen.

Les résultats sont renvoyés dans l'[enveloppe de données non fiables](#marquage-des-données-non-fiables),
précédés d'une ligne du serveur indiquant la marche à suivre. Un refus est une erreur d'outil
portant le code du CLI, comme `no_project`, `token_rejected`, `managed_project` ou `deploy_failed`.
Lorsque le serveur reconnaît le code, il ajoute l'étape suivante, puis le message propre au CLI.
Chaque outil vérifie ses arguments par rapport au schéma qu'il publie avant que quoi que ce soit ne
soit exécuté, et refuse tout argument qu'il ne déclare pas.

## Référence des outils

53 outils, répartis en dix groupes : schéma et base de données, planification de schéma, documents, utilisateurs
et rôles, stockage, cron, fonctions, serveur de développement, registre de projets et
Rebase Cloud.
Chacun d'eux, avec ses prérequis et l'indication selon laquelle la barrière le refuse ou non face à une cible
non locale, figure dans la [référence des outils MCP](/docs/ai/mcp-tool-reference).

## Ressources

<span class="since-badge" data-since="0.31">Since 0.31</span>

Au-delà des outils, le serveur expose des ressources MCP permettant à un client de récupérer
le contexte du projet sans consommer d'appel d'outil :

| URI | Description |
|---|---|
| `rebase://tables/{name}` | Code source TypeScript d'une définition de table (`defineTable`) |
| `rebase://schema` | Le schéma Drizzle généré (`schema.generated.ts`) |

Les fichiers de table sont les modules du répertoire de schéma, hormis son `index.ts` : la
clé `tables` de l'application backend dans `rebase.json`, `backend/schema` par défaut,
sous le répertoire du projet actif ou son `app/`.

`rebase://schema` n'est listé **que si** le schéma généré existe.
`findBackendDir` recherche `backend/` puis `app/backend/` sous le répertoire du
projet actif, et lit `src/schema.generated.ts` depuis le premier trouvé — de sorte
que l'organisation initiale par défaut et celle de ce monorepo fonctionnent toutes deux, et qu'un
projet structuré différemment, ou n'ayant pas encore exécuté `rebase schema generate`, ne verra
tout simplement pas la ressource proposée.

## Le point de terminaison distant

Un backend déployé peut également servir MCP lui-même, sur `/mcp`, aux personnes qui utilisent
votre application, chacune se connectant sous sa propre identité avec sa propre sécurité au niveau
des lignes. Cela dispose de sa propre page :
[Le point de terminaison MCP distant](/docs/ai/remote-mcp/).

## Configuration recommandée

- Pointez le serveur vers un projet **local** et laissez `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non défini. La barrière est l'élément le plus précieux du package.
- Pour tout ce qui est distant, enregistrez une **clé d'API `rk_` restreinte** plutôt que de laisser
  la détection automatique fournir une clé de service.
- Vérifiez `rebase_project_current` lorsque la sortie semble incorrecte. Le projet actif est
  persistant et réside en dehors de votre dépôt.
- Traitez `~/.rebase/projects.json` comme un fichier de secrets.

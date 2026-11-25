---
sourceHash: c4c752011dc403fc
title: Serveur MCP
sidebar_label: Serveur MCP
description: Connectez Claude Code, Cursor, Gemini CLI ou n'importe quel client MCP à un projet Rebase — les 53 outils exposés, l'identifiant avec lequel il s'authentifie et le filtre loopback qui sépare un agent de la production.
---

`@rebasepro/mcp` est un serveur [Model Context Protocol](https://modelcontextprotocol.io)
qui fournit à un assistant IA de véritables outils sur un projet Rebase : lire et
écrire des lignes, gérer les utilisateurs, exécuter des migrations, invoquer des fonctions,
piloter le serveur de développement.

Il communique en MCP via **stdio uniquement**. Il n'y a ni port ni écouteur réseau — le
processus bénéficie exactement du même niveau de confiance que ce qui l'a lancé, et aucun
appelant distant n'a besoin d'être authentifié. C'est la partie sécurisée. Les questions
intéressantes portent toutes sur ce qu'il fait *une fois* en cours d'exécution, et cette page
y répond avant de vous présenter le bloc de configuration.

Un backend déployé peut également servir lui-même le protocole MCP, via HTTP, aux utilisateurs
de votre application. C'est une approche différente avec un modèle d'identifiants différent :
consultez [Le point de terminaison MCP distant](/docs/ai/remote-mcp/).

:::tip[Vous utilisez Claude sur le web, desktop ou mobile ?]
Ajoutez plutôt le [connecteur Rebase](/docs/ai/rebase-connector/) :
`https://app.rebase.pro/mcp`, une seule fois, pour chaque projet que vous exécutez sur Rebase Cloud
ou sur vos propres serveurs. Cette page concerne le serveur local qu'un assistant de code démarre
au sein d'un projet.
:::

## Connecter un client

Le serveur s'exécute depuis votre projet : `@rebasepro/mcp` est une devDependency que chaque
initialisation `rebase init` verrouille avec la CLI, et chaque bloc ci-dessous — l'intégration
complète — démarre cette copie (`pnpm exec rebase-mcp`, ou `npx --no rebase-mcp`
dans un projet npm), jamais une version plus récente depuis npm. Un projet plus ancien l'ajoute une
seule fois, avec `rebase skills install --mcp` ou `pnpm add -D @rebasepro/mcp`.

`rebase init` écrit le bloc pour chaque agent que vous choisissez lorsqu'il
[configure vos agents de codage IA](/docs/ai/skills#set-up-by-rebase-init), en conservant
les autres serveurs déjà présents dans le fichier. `rebase init --agent cursor,codex` fait
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

**Codex CLI** — du TOML plutôt que du JSON, dans le fichier `.codex/config.toml` du projet.
Codex ne lit la configuration d'un projet qu'une fois que vous avez approuvé le projet :

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

**Windsurf** ne lit les serveurs MCP qu'à partir de sa configuration utilisateur globale, il n'y a donc
aucun fichier de projet à écrire. Ajoutez le serveur dans ses paramètres MCP sous la forme `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, avec ce chemin comme valeur pour `REBASE_PROJECT_DIR`.

Tout client MCP capable de lancer un serveur stdio fonctionne ; la structure est identique.

### Sur quel répertoire agit-il

`REBASE_PROJECT_DIR` est le répertoire contenant `rebase.json`. Il existe **un seul**
ordre de priorité, et il est identique dans chaque client :

1. **Le bloc d'environnement** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si l'un d'entre eux est défini, le projet `default` est reconstruit
   à partir de ces variables à chaque démarrage.
2. **Le répertoire de travail du serveur**, lorsqu'il contient un fichier `rebase.json`. Le projet
   dans lequel vous vous trouvez l'emporte sur tout ce qui est mémorisé dans `~/.rebase/projects.json`.
3. **Le projet `default` persistant** dans `~/.rebase/projects.json`, lorsque aucun des deux
   premiers éléments n'est renseigné.

L'auto-découverte depuis `.rebase/state.json` comble les manques dans les trois cas et ne
remplace jamais une valeur fournie par l'un d'eux.

Les blocs définis au niveau du projet désignent le projet — `"."`, le répertoire de travail
du client, ou `${workspaceFolder}` dans l'éditeur — car la règle 3 lit un fichier
partagé par tous les projets de la machine. Une configuration utilisateur, comme celle de Windsurf,
indique plutôt un chemin absolu.

## Ce à quoi le serveur a accès

C'est la section à lire avant de pointer un assistant vers une base de données importante.

Le serveur utilise **un unique identifiant ambiant pour l'ensemble du processus**. Il n'y a pas
d'identité par outil ni de mode lecture seule ; chaque outil utilise le même jeton, et le
seul commutateur du package sert à accorder *plus* d'accès plutôt que moins.

De quel identifiant s'agit-il, par ordre de priorité :

1. `REBASE_API_TOKEN` depuis l'environnement. `REBASE_TOKEN` n'est pas lu ici :
   il s'agit du jeton du plan de contrôle de la CLI, et il n'est jamais envoyé à l'application (le
   serveur le signale une fois sur stderr lorsqu'il est le seul défini). Les outils cloud
   le transmettent toujours à la CLI qu'ils lancent, qui l'envoie au plan de contrôle.
2. `REBASE_SERVICE_KEY` lu depuis le fichier `.env` du projet
3. La clé de service auto-découverte depuis `.rebase/state.json` pendant que `rebase dev`
   est en cours d'exécution

2 et 3 correspondent à la clé du backend de dev de cette machine, utilisée uniquement lorsque la cible est sur
le loopback. Lorsque `REBASE_BASE_URL` pointe ailleurs — `rebase cloud init --claim`
écrit l'adresse du projet cloud, et aucun `REBASE_API_TOKEN` tant qu'un déploiement ne réussit pas — le
serveur n'envoie aucun jeton et le signale une fois sur stderr.

Un jeton que vous enregistrez pour un projet **l'emporte sur l'auto-découverte**. La découverte ne
sert qu'à combler un manque.

:::danger[L'approche sans configuration utilise un identifiant administrateur]
Les options 2 et 3 correspondent à la **clé de service** (*service key*) — un secret d'administration
sans restriction de portée. Le backend la résout en `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Cette
identité possède toutes les [portées (scopes)](/docs/backend/roles-and-scopes/), et satisfait les
politiques `_default_admin_read` / `_default_admin_write` que Rebase injecte dans chaque
table n'ayant pas défini `defaultPolicies: false`.

Ainsi, la réponse honnête à la question « la RLS s'applique-t-elle toujours ? » est : la RLS *s'exécute* — le
pilote rétrograde bien vers le rôle `rebase_user` — et ensuite une politique rédigée par Rebase
lui-même accorde tous les droits à cette identité. La lecture de chaque ligne de chaque
table est le **comportement prévu de la configuration par défaut**, et non un contournement.

Avec la configuration par défaut sans réglage, un agent disposant de ces outils peut lire et écrire chaque
ligne de chaque table, lister tous les utilisateurs, réinitialiser n'importe quel mot de passe, appeler n'importe quelle
fonction backend et exécuter du DDL sur n'importe quelle `DATABASE_URL` résolue par le projet.
:::

### Lui attribuer plutôt un identifiant restreint

Enregistrez une [clé d'API](/docs/backend/api-keys) délimitée et le modèle à deux
filtres s'applique réellement. Une clé de service s'exécute avec les rôles `["service"]`, que les
politiques d'administration injectées ne mentionnent **pas** — ainsi, la RLS ne lui accorde rien sauf si l'une
de vos propres politiques indique le contraire, et ses portées restreignent encore son accès :

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Transmettez ensuite la clé `rk_live_…` résultante au serveur au lieu de le laisser
découvrir une clé de service :

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

Deux choses que cela ne fait **pas**, toutes deux importantes à savoir avant de vous reposer dessus :

- **Cela ne restreint pas les outils CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` et les outils de branches lancent la CLI Rebase, qui se connecte avec
  `DATABASE_URL` et ne voit jamais votre jeton. Le filtre loopback ci-dessous est la
  seule protection devant ces commandes.
- **Une clé n'accède à un outil d'administration qu'avec la portée correspondante.** `list_users` et
  `list_roles` nécessitent `users:read` ; `create_user`, `update_user`, `delete_user` et
  `rebase_auth_reset_password` nécessitent `users:write` ; les outils de stockage et cron
  nécessitent la portée `storage:*` ou `cron:*` associée ; `invoke_function` nécessite
  `functions:invoke`. Sans
  cela, l'appel répond `403 SCOPE_MISSING`. Même avec `users:write`, une clé ne peut pas
  modifier le compte d'un administrateur : un administrateur détient `keys:read` et `keys:write`, ce qu'aucune
  clé ne peut avoir, et personne ne peut gérer un compte qui possède plus de droits que soi.

Une clé créée avec `--roles admin` est un cas différent : elle porte les rôles
`["service", "admin"]`, ce qui valide les mêmes politiques d'administration par défaut que la
clé de service. Ajoutez-lui également `--full-access` et sa portée sera identique à celle de la clé de service,
la gestion des clés en moins. Ce qu'elle apporte en plus, c'est qu'elle est **révocable, peut expirer et dispose
d'une limitation de débit par clé**, ce qui n'est le cas pour aucune clé de service — effectuer une rotation
de cette dernière implique de modifier `.env` et de redémarrer le serveur.

Consultez [Agents et serveurs MCP](/docs/backend/api-keys#agents-and-mcp-servers) pour le
guide complet sur la définition des portées de clés.

### Rendre une table totalement inaccessible

La raison pour laquelle un identifiant administrateur lit tout est la politique de base que Rebase
injecte dans chaque table, accordant l'accès au contexte serveur de confiance et au
rôle `admin`. Une table peut refuser cette base de référence et assumer l'entière
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

Désormais, le seul moyen d'y accéder est de correspondre à `patientId`. L'uid de la clé de service est la
chaîne littérale `service`, de sorte qu'une règle de propriétaire ne correspond jamais — les lectures renvoient zéro
ligne et les écritures sont rejetées par Postgres. C'est le seul contrôle qui restreint
l'identifiant par défaut du serveur MCP plutôt que de lui faire confiance aveuglément.

N'oubliez pas qu'il s'agit d'une véritable modification de la RLS, et non d'une simple convention : elle ne prend effet
qu'une fois que `rebase schema generate` et une migration ont appliqué les politiques. Voir
[Sécurité au niveau des lignes](/docs/collections/security-rules).

## Le filtre loopback

`rebase_project_add` accepte n'importe quelle `baseUrl`, et les outils CLI se connectent avec
la valeur `DATABASE_URL` déclarée par le projet. La même liste d'outils qui modifie une
base de test sur votre machine portable peut donc supprimer des lignes en production, sans rien
d'autre entre les deux que le jugement de l'assistant quant au projet actif.

**Tout outil qui modifie l'environnement cible est refusé sauf si cette cible se trouve
sur l'interface loopback.** Le filtre est conçu sous la forme d'une liste de ce qui n'*est pas*
filtré, de sorte qu'un outil ajouté ultérieurement est protégé par défaut.

- **Non filtrés — lectures :** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, ainsi que les lectures Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Non filtrés — écritures Rebase Cloud :** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Le provisionnement crée un projet ; les autres modifient un projet de production. Aucun
  d'entre eux ne passe par `baseUrl` ou `DATABASE_URL`, qui sont les seuls éléments que le filtre peut
  vérifier. Voir [Rebase Cloud](#rebase-cloud) pour connaître les protections en place devant eux.
- **Non filtrés — locaux uniquement :** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, les outils du serveur de développement et les outils du registre de projets.
  Ceux-ci écrivent des fichiers locaux ou un état local et n'ont aucune cible distante à vérifier.
- **Filtrés par rapport à `DATABASE_URL` :** les outils CLI restants — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Filtrés par rapport à l'URL `baseUrl` du projet :** les outils SDK restants —
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  et `invoke_function`.

Les deux cibles ne sont pas interchangeables. Les outils CLI ne voient jamais `baseUrl`, de sorte qu'un
backend sur localhost associé à une `DATABASE_URL` de production est vérifié par rapport à
la base de données, et non par rapport au backend.

Un refus se présente ainsi :

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si aucune chaîne de connexion ne peut être résolue, les outils DB filtrés sont refusés.**
En l'absence de `DATABASE_URL`, la CLI utilise la base de données de développement gérée, qui est
la valeur par défaut pour un nouveau projet, et le filtre y refuse ses quatre outils de base de données.
Le message de refus en explique la raison et indique ce qui fonctionne à la place. Il ne suggère
pas de contourner la protection :

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Depuis un terminal,
`rebase db push` et `rebase db migrate` s'exécutent bien sur cette base de données ; seuls les outils
MCP sont refusés.

Seul le loopback est considéré comme local : `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(et `0.0.0.0`).
Les plages privées comme `10.x` et `192.168.x` ne le sont **pas** — elles correspondent tout aussi bien à
un cluster de préproduction partagé qu'à un ordinateur portable, et les traiter comme locales laisserait
passer précisément l'accident que ce filtre a pour but d'empêcher.

Définissez `REBASE_MCP_ALLOW_REMOTE_WRITES=true` pour désactiver cette protection. La définir globalement dans la
configuration de votre client MCP supprime le filtre pour chaque projet accessible par le serveur,
et pas seulement pour celui auquel vous pensiez.

## Marquage des données non fiables

Les lignes, les enregistrements d'utilisateurs, les listes d'objets de stockage, les tâches cron, les réponses de fonctions et les
sorties CLI reviennent enveloppés dans une balise explicite :

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Tout ce qui est stocké dans votre base de données a été écrit par quelqu'un, et arrive sur
le même canal que le contrat d'outil suivi par l'assistant. L'enveloppe indique
au modèle de traiter ces données comme du contenu inerte plutôt que comme des instructions.

L'`id` est généré à neuf pour chaque réponse, après l'écriture des données, et
seul le marqueur de fin portant cet identifiant ferme le bloc. Tout texte au sein des données ressemblant à
un marqueur est altéré par une espace sans chasse (zero-width space), de sorte qu'une ligne affichant
`<<<END_UNTRUSTED_DATA>>>` ne puisse pas fermer l'enveloppe prématurément et placer ce qui suit
à l'extérieur.

Le [point de terminaison distant](/docs/ai/remote-mcp/) isole les résultats de ses outils de la même
façon et le signale au client ; son `structuredContent` contient le résultat brut.
`list_tables` et
`describe_table` font exception : seul un modèle les lit, elles sont donc
envoyées une seule fois, dans le texte.

Il s'agit d'un marqueur, pas d'un bac à sable (sandbox). Un assistant disposant de ces outils n'est
sûr que dans la limite du contenu que vous lui permettez de lire.

## Projets multiples

Les configurations de projet sont stockées dans `~/.rebase/projects.json`, et le serveur
peut en gérer plusieurs à la fois — très pratique lorsque vous travaillez entre des
environnements locaux et distants. Pendant que `rebase dev` tourne, le serveur lit le port actif et
la clé de service dans `.rebase/state.json` dans le répertoire du projet, ce qui
permet le fonctionnement sans configuration en local.

:::note[Le registre a le dernier mot, pas le premier]
L'ordre de priorité est celui mentionné plus haut : le bloc d'environnement, puis le répertoire de travail
lorsqu'il contient un `rebase.json`, puis le `default` persistant.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` et `REBASE_API_TOKEN` reconstruisent le
projet `default` **à chaque démarrage**, et pas seulement au premier. La reconstruction concerne
l'entrée entière : un jeton enregistré pour l'ancien `projectDir` est abandonné plutôt
que reporté dans un répertoire pour lequel il n'a jamais été émis. Un `default` dérivé de
cette manière — ou depuis le répertoire de travail — n'est jamais réécrit dans
`~/.rebase/projects.json`, empêchant ainsi la clé de service de dev d'un projet de devenir
celle d'un autre.

`activeProject` est persistant (« sticky ») : si une session précédente a appelé
`rebase_project_switch`, les outils ciblent ce projet et le serveur le signale sur
stderr — sauf si ce projet est enregistré sous un répertoire *différent* de
celui dans lequel ce serveur s'exécute, auquel cas il bascule sur `default` et le
signale. Si un assistant semble lire la mauvaise base de données, appelez d'abord
`rebase_project_current`.
:::

### Sur quel projet agit un appel

`activeProject` s'applique à l'échelle de la machine, et un serveur est souvent installé une seule fois pour toute la machine. Ainsi, chaque outil qui agit sur un projet (tous sauf les outils de registre `rebase_project_*`, `rebase_cloud_projects_list`, `rebase_cloud_provision` et `rebase_dev_logs`) résout son projet **par appel**, et accepte un paramètre optionnel `project` : le nom d'un projet enregistré, ou un slug ou id Rebase Cloud. L'appel est vérifié par rapport à la liaison Cloud (`.rebase/cloud.json`) du répertoire dans lequel la session travaille : la première racine ([root](https://modelcontextprotocol.io/specification/latest/client/roots)) du client, sinon le répertoire de travail du serveur.

| L'appel | Le répertoire de la session | Résultat |
|---|---|---|
| spécifie un projet | est lié au même projet | s'exécute dessus |
| spécifie un projet | est lié à un autre projet | **refusé**, rien ne s'exécute |
| ne spécifie aucun projet | est lié à un projet différent du projet actif | **refusé**, rien ne s'exécute |
| ne spécifie aucun projet | est lié ; le projet actif est un projet local situé ailleurs | s'exécute sur le projet lié |
| ne spécifie aucun projet | n'est pas lié | s'exécute sur le projet actif ; une *écriture* sur un projet Cloud sélectionné par une session antérieure nécessite que le projet soit nommé |

Un refus mentionne les deux projets. `rebase_project_current` indique le répertoire et la liaison de la session sous `session`. `rebase_cloud_env_set` et `rebase_cloud_rollback` transmettent le projet résolu à la CLI avec `--project` ; `rebase_cloud_deploy` déploie le répertoire dans lequel il s'exécute, il est donc refusé lorsque la liaison de ce répertoire pointe vers un autre projet.

Les jetons sont stockés dans ce registre **en clair**. Il s'agit d'un fichier situé dans votre
répertoire personnel qui contient les identifiants administrateur de chaque projet que vous avez enregistré ;
traitez-le en conséquence.

## Rebase Cloud

Huit outils permettent de propulser une application depuis ce répertoire vers un backend actif sur
[Rebase Cloud](/docs/deployment/cloud/) et de le maintenir en fonctionnement. Chacun lance
`rebase cloud <command> --json` dans le répertoire du projet actif : la même
commande qu'un utilisateur exécuterait, évitant ainsi toute dérive liée à une seconde implémentation.

| Outil | Exécute | Modifie le projet |
|---|---|---|
| `rebase_cloud_provision` | `rebase cloud init --claim` | En crée un, sans compte |
| `rebase_cloud_status` | `rebase cloud status` | Non |
| `rebase_cloud_deploy` | `rebase cloud deploy` | Oui |
| `rebase_cloud_logs` | `rebase cloud logs [--runtime]` | Non |
| `rebase_cloud_env_list` | `rebase cloud env list` | Non |
| `rebase_cloud_env_set` | `rebase cloud env set KEY --stdin` | Oui, dès le prochain déploiement |
| `rebase_cloud_deployments_list` | `rebase cloud deployments list` | Non |
| `rebase_cloud_rollback` | `rebase cloud rollback --yes` | Oui |
| `rebase_cloud_projects_list` | `rebase cloud projects list --all-orgs` | Non |

Le parcours habituel de l'agent est : `rebase_cloud_provision`, puis donner l'URL de
revendication à l'utilisateur ; `rebase_cloud_status` pour consulter l'état du projet (tant qu'il n'est pas revendiqué,
`unclaimed` contient l'URL de revendication et le moment de sa suppression) ; `rebase_cloud_deploy`
après une modification ; `rebase_cloud_logs` lorsque quelque chose se passe mal ; et
`rebase_cloud_rollback` lorsque la production est en panne.

**Ce sur quoi ils agissent.** Le projet auquel l'appel est résolu, comme décrit dans
[Sur quel projet agit un appel](#sur-quel-projet-agit-un-appel) : l'argument `project`,
vérifié par rapport à la liaison du répertoire de session, ou cette liaison, ou
le projet actif. Un appel mentionnant un projet auquel le répertoire de session n'est pas
lié est refusé avant même qu'un processus ne soit lancé.

**Avec quelle autorité.** Tout ce que la CLI résout dans ce répertoire : `REBASE_TOKEN`
lorsqu'il est défini, puis le jeton que `rebase cloud init --claim` a stocké pour un
projet non revendiqué, puis la session `rebase cloud login`. Dans le répertoire de ce
projet non revendiqué, un `REBASE_TOKEN` sans portée sur le projet est mis
de côté au profit du jeton propre au projet. Le plan de contrôle
vérifie chaque appel de la même façon qu'il vérifie ceux de la CLI : ainsi, avec un jeton créé via
`rebase cloud tokens create --can logs`, un assistant peut lire les logs, et le
plan de contrôle refusera ses déploiements, variables et rollbacks. L'absence d'identifiant, ou un identifiant refusé,
renvoie une erreur indiquant ce que l'utilisateur doit faire (`rebase cloud login`, ou revendiquer le projet).

**Pourquoi le filtre loopback ne s'applique pas.** Le filtre vérifie l'URL `baseUrl` de l'application et
la `DATABASE_URL` de la CLI ; ces outils n'utilisent ni l'une ni l'autre. Après `rebase_cloud_provision`,
`REBASE_BASE_URL` pointe vers le nouveau projet cloud, de sorte que le filtrer refuserait
précisément le déploiement nécessaire au processus. Le provisionnement en lui-même ne fait que créer : il ne touche
à aucune application ou base de données existante, et la CLI le refuse de toute façon dans un répertoire
déjà lié. Un déploiement, une variable et un rollback modifient
chacun la production. Ce qui se dresse devant eux, ce sont les identifiants mentionnés plus haut,
l'approbation de l'outil par votre client MCP, et `confirm: true` : `rebase_cloud_deploy` vers
la production, `rebase_cloud_env_set` en production, `rebase_cloud_rollback` et
`rebase_cloud_provision` indiquent ce qu'ils feraient et n'effectuent aucune action jusqu'à ce qu'un appel
répète les mêmes arguments avec `confirm: true`, ce que l'assistant n'envoie qu'après
accord de l'utilisateur. Un déploiement de prévisualisation et une variable de prévisualisation n'en ont pas besoin. Pour empêcher un assistant de modifier un projet cloud,
définissez `REBASE_TOKEN` dans l'environnement du serveur avec un jeton dépourvu des
capacités `deploy` et `env`.

**Lire n'importe lequel de vos projets.** Les outils ci-dessus agissent sur le projet lié.
Pour lire les données d'un autre projet — n'importe quel projet de n'importe quelle organisation à laquelle
appartient le compte connecté, qu'il soit lié ici ou non — `rebase_cloud_projects_list` en dresse la liste
et `rebase_project_use_cloud` (avec un id, slug ou nom) oriente les outils de données et
d'administration vers celui-ci : `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Ces appels transitent par le proxy Studio de la console,
portant l'identifiant propre à la CLI (`rebase cloud access-token`, lu à chaque appel et jamais stocké) ;
le plan de contrôle vérifie l'accès de la personne et rattache la clé de service du projet de son côté, de sorte
qu'aucune clé n'arrive sur la machine. Un projet où Studio est désactivé est refusé, et le commutateur
l'indique. Il s'agit d'une cible distante comme une autre, de sorte que les outils qui modifient des données y restent refusés
sauf si `REBASE_MCP_ALLOW_REMOTE_WRITES` est défini ; `rebase_project_switch` permet de
revenir en arrière.

Chaque outil fournit une capture instantanée :

- `rebase_cloud_logs` ne suit jamais les logs en continu (follow). Son résultat comporte `nextSinceTime` ; renvoyez-le
  comme paramètre `since` pour lire ce qui s'est passé après. Il renvoie les 200 dernières lignes sauf si
  `tail` indique autre chose. `source: "build"` renvoie plutôt le journal de build le plus récent.
- `rebase_cloud_deploy` suit le déploiement jusqu'à la fin et vérifie que la nouvelle
  version répond. `wait: false` rend la main dès que le déploiement est déclenché.
  Il n'éjecte jamais un projet du runtime managé, ne déploie pas une version plus ancienne du framework
  et n'ignore pas les vérifications de build : ce sont des décisions qui incombent à l'utilisateur, et un
  refus en nécessitant une le signale.
- `rebase_cloud_rollback` transmet `--yes` dès que l'appel comporte `confirm: true`
  (ci-dessous), puisqu'il n'y a pas de terminal pour demander confirmation.

`rebase_cloud_env_set` écrit la valeur sur l'entrée standard de la CLI, elle ne se retrouve
donc jamais sur une ligne de commande où `ps` pourrait la révéler, et la valeur est expurgée
de tout ce que l'outil renvoie. Son résultat indique ce qui a été enregistré (la clé, si elle est
secrète, si un redéploiement est en attente), mais jamais la valeur. `rebase_cloud_env_list`
liste uniquement les clés. Une version de la CLI antérieure à `env set --stdin` est refusée avec un message invitant
à la mettre à niveau ; la valeur n'est transmise par aucun autre moyen.

Les résultats reviennent dans l'[enveloppe de données non fiables](#marquage-des-données-non-fiables),
précédés d'une ligne du serveur indiquant ce qu'il faut faire ensuite. Un refus constitue une erreur d'outil
portant le code de la CLI, tel que `no_project`, `token_rejected`,
`managed_project` ou `deploy_failed`. Lorsque le serveur reconnaît le code, il
ajoute l'étape suivante, puis le message propre à la CLI. Chaque outil vérifie ses arguments
par rapport au schéma qu'il annonce avant de lancer quoi que ce soit, et refuse tout
argument qu'il n'a pas déclaré.

## Référence des outils

53 outils, répartis en dix groupes : schéma et base de données, planification de schéma, documents, utilisateurs
et rôles, stockage, cron, fonctions, serveur de développement, registre de projets et
Rebase Cloud.
Chacun d'eux, avec ses prérequis et l'indication si le filtre le bloque sur une cible non locale,
est détaillé dans la [référence des outils MCP](/docs/ai/mcp-tool-reference).

## Ressources

Au-delà des outils, le serveur expose des ressources MCP afin qu'un client puisse récupérer
le contexte du projet sans consommer d'appel d'outil :

| URI | Description |
|---|---|
| `rebase://tables/{name}` | Source TypeScript d'une définition de table (`defineTable`) |
| `rebase://schema` | Le schéma Drizzle généré (`schema.generated.ts`) |

Les fichiers de tables sont les modules du répertoire de schéma, à l'exception de son `index.ts` : la
clé `tables` de l'application backend dans `rebase.json`, `backend/schema` par défaut,
sous le répertoire du projet actif ou son sous-répertoire `app/`.

`rebase://schema` n'est listé **que si** le schéma généré existe.
`findBackendDir` recherche `backend/` puis `app/backend/` sous le répertoire du projet
actif, et lit `src/schema.generated.ts` dans celui qu'il trouve — ainsi, la disposition générée
par défaut tout comme celle de ce monorepo fonctionnent, et un projet organisé d'une autre manière,
ou qui n'a pas encore exécuté `rebase schema generate`, ne verra tout simplement pas la ressource proposée.

## Skills

Le serveur met également à disposition les 24 [skills d'agent Rebase](/docs/ai/skills/)
via l'extension de skills MCP. Un client utilisant la révision du protocole 2026-07-28 ou
ultérieure en charge une lorsqu'il en a besoin. Dans Claude Code, il s'agit de `/rebase:rebase-tables`
et ainsi de suite. Sans `@rebasepro/agent-skills`, le serveur démarre sans elles et le
signale sur stderr.

## Le point de terminaison distant

Un backend déployé peut également servir lui-même le protocole MCP, sur `/mcp`, aux personnes qui
utilisent votre application, chacune se connectant sous sa propre identité et soumise à ses
propres règles de sécurité au niveau des lignes. Cela dispose de sa propre page :
[Le point de terminaison MCP distant](/docs/ai/remote-mcp/).

## Configuration recommandée

- Pointez le serveur vers un projet **local** et laissez `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non défini. Ce filtre est l'élément le plus précieux de ce package.
- Pour tout ce qui est distant, enregistrez une **clé d'API `rk_` restreinte** plutôt que de laisser
  l'auto-découverte transmettre une clé de service.
- Vérifiez `rebase_project_current` lorsque les résultats semblent incorrects. Le projet actif est
  persistant et réside en dehors de votre dépôt.
- Traitez `~/.rebase/projects.json` comme un fichier de secrets.

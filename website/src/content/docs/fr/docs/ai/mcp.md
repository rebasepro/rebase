---
sourceHash: 59966953b83890cf
title: Serveur MCP
sidebar_label: Serveur MCP
description: Connectez Claude Code, Cursor, Gemini CLI ou n'importe quel client MCP à un projet Rebase — les 53 outils qu'il expose, l'identifiant avec lequel il s'authentifie, et la barrière loopback qui sépare un agent de la production.
---

`@rebasepro/mcp` est un serveur [Model Context Protocol](https://modelcontextprotocol.io)
qui fournit à un assistant IA de véritables outils sur un projet Rebase : lire et
écrire des lignes, gérer les utilisateurs, exécuter des migrations,
invoquer des fonctions, piloter le serveur de développement.

Il communique via MCP sur **stdio uniquement**. Il n'y a aucun port ni écouteur — le
processus a exactement le même niveau de confiance que ce qui l'a lancé, et il n'y a aucun
appelant distant à authentifier. C'est la partie sécurisée. Les questions intéressantes portent
toutes sur ce qu'il fait *une fois* en cours d'exécution, et cette page y répond avant de
vous présenter le bloc de configuration.

Un backend déployé peut également servir MCP lui-même, via HTTP, aux utilisateurs
de votre application. C'est une approche différente avec un modèle d'identifiants différent :
voir [Le point de terminaison MCP distant](/docs/ai/remote-mcp/).

## Connexion d'un client

Le serveur s'exécute depuis votre projet : `@rebasepro/mcp` est une devDependency que
chaque squelette généré par `rebase init` fige avec le CLI, et chaque bloc ci-dessous — l'intégration
complète — démarre cette copie (`pnpm exec rebase-mcp`, ou `npx --no rebase-mcp`
dans un projet npm), jamais une version plus récente provenant de npm. Un projet plus ancien l'ajoute une
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

**Codex CLI** — en TOML plutôt qu'en JSON, dans le fichier `.codex/config.toml` du projet.
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

**Windsurf** lit les serveurs MCP uniquement depuis sa configuration utilisateur,
il n'y a donc aucun fichier de projet à écrire. Ajoutez le serveur dans ses paramètres MCP avec `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, avec ce chemin comme `REBASE_PROJECT_DIR`.

Tout client MCP capable de lancer un serveur stdio fonctionne ; la structure est la même.

### Sur quel répertoire il opère

`REBASE_PROJECT_DIR` est le répertoire contenant `rebase.json`. Il existe **un seul**
ordre de priorité, et il est identique dans chaque client :

1. **Le bloc d'environnement** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si l'un d'eux est défini, le projet `default` est reconstruit
   à partir de ceux-ci à chaque démarrage.
2. **Le répertoire de travail du serveur**, lorsqu'il contient un `rebase.json`. Un projet
   dans lequel vous vous trouvez a la priorité sur tout ce qui est mémorisé dans `~/.rebase/projects.json`.
3. **Le projet `default` persisté** dans `~/.rebase/projects.json`, lorsqu'aucun des
   deux premiers n'indique quoi que ce soit.

La détection automatique depuis `.rebase/state.json` comble les manques dans les trois cas et ne
remplace jamais une valeur fournie par l'un d'eux.

Les blocs au niveau du projet désignent le projet — `"."`, le répertoire de travail du
client, ou le `${workspaceFolder}` de l'éditeur — car la règle 3 lit un fichier
partagé par tous les projets de la machine. Une configuration au niveau utilisateur, comme celle de Windsurf,
indique plutôt un chemin absolu.

## Ce à quoi le serveur peut accéder

C'est la section à lire avant de faire pointer un assistant vers une base de données qui vous
tient à cœur.

Le serveur utilise **un seul identifiant ambiant pour l'ensemble du processus**. Il n'y a pas
d'identité par outil ni de mode lecture seule ; chaque outil utilise le même jeton, et le
seul commutateur du paquet permet d'*étendre* l'accès plutôt que de le restreindre.

De quel identifiant s'agit-il, par ordre de priorité :

1. `REBASE_API_TOKEN` issu de l'environnement. `REBASE_TOKEN` n'est pas lu ici :
   c'est le jeton du plan de contrôle du CLI, et il n'est jamais envoyé à l'application (le
   serveur le signale une fois sur stderr lorsqu'il est le seul défini). Les outils cloud
   le transmettent toujours au CLI qu'ils exécutent, qui l'envoie au plan de contrôle.
2. `REBASE_SERVICE_KEY` lu depuis le fichier `.env` du projet
3. La clé de service découverte automatiquement depuis `.rebase/state.json` pendant l'exécution
   de `rebase dev`

2 et 3 correspondent à la clé du backend de dev de cette machine, utilisée uniquement lorsque la cible se trouve sur
l'interface loopback. Lorsque `REBASE_BASE_URL` pointe ailleurs — `rebase cloud init --claim`
écrit l'adresse du projet cloud, et aucun `REBASE_API_TOKEN` tant qu'un déploiement
n'a pas réussi —, le serveur n'envoie aucun jeton et le signale une fois sur stderr.

Un jeton que vous enregistrez pour un projet **l'emporte sur la découverte automatique**. La découverte sert uniquement
à combler un manque.

:::danger[L'approche sans configuration utilise un identifiant administrateur]
Les options 2 et 3 correspondent à la **clé de service** — un secret administrateur sans restriction de portée (unscoped). Le backend
la résout en `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Cette
identité détient chaque [portée (scope)](/docs/backend/roles-and-scopes/), et elle satisfait les
politiques `_default_admin_read` / `_default_admin_write` que Rebase injecte dans
chaque collection qui n'a pas défini `disableDefaultPolicies`.

La réponse honnête à la question « le RLS s'applique-t-il toujours ? » est donc : le RLS *s'exécute* — le
pilote bascule bien vers le rôle `rebase_user` — puis une politique écrite par Rebase
lui-même accorde tout à cette identité. La lecture de chaque ligne de chaque
collection est le **comportement prévu par la configuration par défaut**, et non un
contournement.

Avec la configuration sans réglage (zero-config), un agent disposant de ces outils peut lire et écrire chaque
ligne de chaque collection, lister tous les utilisateurs, réinitialiser n'importe quel mot de passe, invoquer n'importe quelle fonction backend
et exécuter du DDL sur n'importe quel `DATABASE_URL` résolu par le projet.
:::

### Lui attribuer plutôt un identifiant restreint

Enregistrez une [clé d'API](/docs/backend/api-keys) avec restrictions de portée (scoped) et le modèle à deux
barrières s'applique réellement. Une clé de service s'exécute avec les rôles `["service"]`, que les
politiques administrateur injectées ne mentionnent **pas** — ainsi, le RLS ne lui accorde rien à moins que l'une de
vos propres politiques ne spécifie le contraire, et ses portées la restreignent encore davantage :

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

Deux choses que cela ne fait **pas**, toutes deux bonnes à savoir avant de s'y fier :

- **Cela ne restreint pas les outils CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` et les outils de branche exécutent le CLI Rebase, qui se connecte avec
  `DATABASE_URL` et ne voit jamais votre jeton. La barrière loopback ci-dessous est le
  seul rempart qui les protège.
- **Une clé n'accède à un outil d'administration qu'avec la portée correspondante de cet outil.** `list_users` et
  `list_roles` nécessitent `users:read` ; `create_user`, `update_user`, `delete_user` et
  `rebase_auth_reset_password` nécessitent `users:write` ; les outils de stockage et cron
  nécessitent la portée `storage:*` ou `cron:*` correspondante ; `invoke_function` nécessite
  `functions:invoke`. Sans
  cela, l'appel répond `403 SCOPE_MISSING`. Même avec `users:write`, une clé ne peut pas
  modifier le compte d'un administrateur : un administrateur détient `keys:read` et `keys:write`, ce qu'aucune
  clé ne peut avoir, et personne ne peut gérer un compte disposant de plus de privilèges que lui-même.

Une clé créée avec `--roles admin` est une tout autre affaire : elle comporte les rôles
`["service", "admin"]`, ce qui valide les mêmes politiques administrateur par défaut que la clé de
service. Donnez-lui également `--full-access` et sa portée équivaut à celle de la clé de service,
la gestion des clés en moins. Ce qu'elle apporte de plus, c'est qu'elle est **révocable, peut expirer et dispose d'une
limite de débit par clé**, ce qui n'est le cas pour aucune des caractéristiques de la clé de service — effectuer une rotation de cette
dernière implique de modifier `.env` et de redémarrer le serveur.

Consultez [Agents et serveurs MCP](/docs/backend/api-keys#agents-and-mcp-servers) pour obtenir
l'intégralité des recommandations sur la portée des clés.

### Rendre une collection totalement inaccessible

La raison pour laquelle un identifiant administrateur peut tout lire réside dans la politique de base que Rebase
injecte dans chaque collection, accordant l'accès au contexte serveur de confiance et au
rôle `admin`. Une collection peut refuser cette politique de base et prendre l'entière
responsabilité de son propre RLS :

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const medicalRecordsCollection = defineCollection({
    slug: "medical_records",
    name: "Medical records",
    table: "medical_records",
    properties: {
        patient_id: { name: "Patient", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    disableDefaultPolicies: true,
    securityRules: [
        { operations: ["select", "update"], ownerField: "patient_id" }
    ]
});
```

Désormais, la seule façon d'y accéder est de correspondre à `patient_id`. L'uid de la clé de service étant la
chaîne littérale `service`, une règle de propriétaire ne correspondra jamais — les lectures renvoient zéro
ligne et les écritures sont rejetées par Postgres. C'est le seul contrôle qui contraint
l'identifiant par défaut du serveur MCP plutôt que de faire l'impasse dessus.

N'oubliez pas qu'il s'agit d'un véritable changement RLS, et non d'une simple convention documentaire : il ne prend effet
qu'une fois que `rebase schema generate` et une migration ont appliqué les politiques. Voir
[Règles de sécurité (RLS)](/docs/collections/security-rules).

## La barrière loopback

`rebase_project_add` accepte n'importe quelle `baseUrl`, et les outils CLI se connectent avec
le `DATABASE_URL` déclaré par le projet. La même liste d'outils qui modifie une
base de données temporaire sur votre ordinateur portable peut donc supprimer des lignes en production, sans
rien d'autre entre les deux que le discernement de l'assistant sur le projet actif.

**Tout outil qui modifie l'environnement cible est refusé, à moins que cette cible ne se trouve
sur l'interface loopback.** La barrière est conçue comme une liste de ce qui n'*est pas*
filtré, de sorte qu'un outil ajouté ultérieurement est protégé par défaut.

- **Non filtré — lectures :** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, et les lectures Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Non filtré — écritures Rebase Cloud :** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Le provisionnement crée un projet ; les autres modifient un projet de production. Aucun
  d'entre eux ne passe par `baseUrl` ou `DATABASE_URL`, qui sont les seuls éléments que la barrière peut
  vérifier. Voir [Rebase Cloud](#rebase-cloud) pour savoir ce qui les protège.
- **Non filtré — local uniquement :** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, les outils du serveur de développement et les outils du registre de projets.
  Ceux-ci écrivent des fichiers locaux ou un état local et n'ont aucune cible distante à vérifier.
- **Filtré selon `DATABASE_URL` :** les outils CLI restants — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Filtré selon la `baseUrl` du projet :** les outils SDK restants —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  et `invoke_function`.

Les deux cibles ne sont pas interchangeables. Les outils CLI ne voient jamais `baseUrl` ; ainsi, un
backend sur localhost associé à une `DATABASE_URL` de production est vérifié par rapport à
la base de données, et non par rapport au backend.

Un refus ressemble à ceci :

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si aucune chaîne de connexion ne peut être résolue, les outils de base de données filtrés sont refusés.**
En l'absence de `DATABASE_URL`, le CLI utilise la base de données de développement gérée, qui est
la valeur par défaut pour un nouveau projet, et la barrière y refuse ses quatre outils de base de données.
Le refus en explique la raison et indique ce qui fonctionne à la place. Il ne suggère pas
de désactiver la protection :

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Depuis un terminal,
`rebase db push` et `rebase db migrate` s'exécutent bien sur cette base de données ; seuls les outils MCP
sont refusés. Sur la version 0.24, le CLI les refuse également à cet endroit.

Seule l'interface loopback est considérée comme locale : `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(et `0.0.0.0`).
Les plages privées comme `10.x` et `192.168.x` ne le sont **pas** — elles sont tout aussi susceptibles d'être
un cluster de staging partagé qu'un ordinateur portable, et les traiter comme locales laisserait
passer précisément l'accident que la barrière est censée empêcher.

Définissez `REBASE_MCP_ALLOW_REMOTE_WRITES=true` pour désactiver cette protection. Le définir globalement dans la
configuration de votre client MCP supprime la barrière pour tous les projets auxquels le serveur peut accéder,
et pas seulement celui auquel vous pensiez.

## Balisage des données non fiables

Les lignes, enregistrements d'utilisateurs, listes de stockage, tâches cron, réponses de fonctions et sorties
CLI sont renvoyés enveloppés dans une enveloppe explicite :

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Tout ce qui est stocké dans votre base de données a été écrit par quelqu'un, et cela arrive sur
le même canal que le contrat d'outil que l'assistant suit. L'enveloppe indique au
modèle de traiter ces données comme du contenu inerte plutôt que comme des instructions.

L'`id` est généré à neuf pour chaque réponse, après l'écriture des données, et
seul le marqueur de fin le portant referme le bloc. Tout texte au sein des données ayant
l'apparence d'un marqueur est altéré par un espace sans chasse (zero-width space), de sorte qu'une ligne affichant
`<<<END_UNTRUSTED_DATA>>>` ne puisse pas fermer l'enveloppe prématurément et placer ce qui suit
à l'extérieur.

Le [point de terminaison distant](/docs/ai/remote-mcp/) délimite les résultats de ses outils de la
même manière et le signale au client ; son `structuredContent` transporte le résultat brut.
`list_collections` et
`describe_collection` font exception : seul un modèle les lit, elles sont donc
envoyées une seule fois, dans le texte. Avant la version 0.24, le listage comportait également une copie dans `structuredContent`.

Il s'agit d'un marqueur, pas d'un bac à sable (sandbox). Un assistant disposant de ces outils n'est sûr
qu'à la mesure du contenu que vous lui permettez de lire.

## Projets multiples

Les configurations de projet sont stockées dans `~/.rebase/projects.json`, et le serveur
peut en gérer plusieurs à la fois — pratique lorsque vous travaillez sur des environnements
locaux et distants. Pendant que `rebase dev` fonctionne, le serveur lit le port actif et
la clé de service dans `.rebase/state.json` au sein du répertoire du projet, ce qui
permet le fonctionnement sans configuration en local.

:::note[Le registre a le dernier mot, pas le premier]
L'ordre de priorité est celui indiqué plus haut : le bloc d'environnement, puis le répertoire de travail
lorsqu'il contient un `rebase.json`, puis le `default` persisté.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` et `REBASE_API_TOKEN` reconstruisent le
projet `default` **à chaque démarrage**, pas seulement au premier. La reconstruction est
intégrale : un jeton enregistré pour l'ancien `projectDir` est supprimé plutôt que
d'être transféré vers un répertoire pour lequel il n'a jamais été émis. Un `default` obtenu de
cette manière — ou à partir du répertoire de travail — n'est jamais réécrit dans
`~/.rebase/projects.json`, ce qui évite que la clé de service de dev d'un projet ne devienne
celle d'un autre.

`activeProject` est persistant (sticky) : si une session précédente a appelé
`rebase_project_switch`, les outils ciblent ce projet et le serveur l'indique sur
stderr — à moins que ce projet ne soit enregistré sous un répertoire *différent* de
celui dans lequel ce serveur s'exécute, auquel cas il revient à `default` et le
signale. Si un assistant semble lire la mauvaise base de données, appelez
d'abord `rebase_project_current`.
:::

Les jetons sont stockés dans ce registre **en texte brut**. Il s'agit d'un fichier situé dans votre
répertoire personnel qui contient des identifiants administrateur pour chaque projet que vous avez enregistré ;
traitez-le en conséquence.

## Rebase Cloud

Huit outils permettent de faire passer une application de ce répertoire à un backend en production sur
[Rebase Cloud](/docs/deployment/cloud/) et de la maintenir en fonctionnement. Chacun lance
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

Le parcours habituel de l'agent est le suivant : `rebase_cloud_provision`, puis fournir à l'utilisateur
l'URL de réclamation (claim) ; `rebase_cloud_status` pour consulter le projet (tant qu'il n'est pas réclamé,
`unclaimed` contient l'URL de réclamation et la date à laquelle il sera supprimé) ; `rebase_cloud_deploy`
après une modification ; `rebase_cloud_logs` en cas de dysfonctionnement ; et
`rebase_cloud_rollback` lorsque la production est en panne.

**Sur quoi ils agissent.** Le projet auquel le répertoire actif est lié dans
`.rebase/cloud.json`. Aucun d'entre eux ne prend d'identifiant de projet ou de répertoire, de sorte qu'un
assistant ne peut pas les faire pointer vers un autre projet que celui auquel le répertoire est
lié. Changer de projet actif avec `rebase_project_switch` change le répertoire dans lequel ils s'exécutent.

**Sous quelle autorité.** Tout ce que le CLI résout dans ce répertoire : `REBASE_TOKEN`
lorsqu'il est défini, puis le jeton stocké par `rebase cloud init --claim` pour un
projet non réclamé, puis la session `rebase cloud login`. Dans le répertoire de ce projet non réclamé, un
`REBASE_TOKEN` qui ne possède aucune portée sur le projet est mis de côté au profit du jeton propre au projet. Le plan de contrôle
vérifie chaque appel comme il vérifie ceux du CLI ; ainsi, avec un jeton créé via
`rebase cloud tokens create --can logs`, un assistant peut lire les journaux, et le
plan de contrôle refusera ses déploiements, variables et rollbacks. L'absence d'identifiant, ou un identifiant refusé, renvoie une erreur indiquant ce que l'utilisateur doit faire (`rebase cloud login`, ou réclamer le projet).

**Pourquoi la barrière loopback ne s'applique pas.** La barrière vérifie la `baseUrl` de l'application et
la `DATABASE_URL` du CLI ; ces outils n'utilisent ni l'une ni l'autre. Après `rebase_cloud_provision`,
`REBASE_BASE_URL` pointe vers le nouveau projet cloud ; filtrer dessus refuserait
donc le déploiement même dont le flux a besoin. Le provisionnement lui-même ne fait que créer : il ne touche
à aucune application ou base de données existante, et le CLI le refuse de toute façon dans un répertoire
déjà lié. Un déploiement, une variable et un rollback modifient chacun
la production. Ce qui les protège est l'identifiant mentionné ci-dessus et
l'approbation d'outil de votre client MCP. Pour empêcher un assistant de modifier un projet cloud,
définissez `REBASE_TOKEN` dans l'environnement du serveur avec un jeton sans les
capacités `deploy` et `env`.

**Lire n'importe lequel de vos projets.** Les outils ci-dessus agissent sur le projet lié.
Pour lire les données d'un autre projet — tout projet de toute organisation à laquelle appartient le
compte connecté, qu'il soit lié ici ou non —, `rebase_cloud_projects_list` les énumère
et `rebase_project_use_cloud` (avec un identifiant, un slug ou un nom) y dirige les outils de données et
d'administration : `list_documents`, `get_document`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Ces appels passent par le proxy Studio de la console,
portant l'identifiant propre au CLI (`rebase cloud access-token`, lu
à chaque appel et jamais stocké) ; le plan de contrôle vérifie les accès de la personne et
attache la clé de service du projet de son côté, de sorte qu'aucune clé n'arrive sur la machine.
Un projet où Studio est désactivé est refusé, et le commutateur l'indique. Il s'agit d'une cible
distante comme les autres, les outils modifiant des données y restent donc refusés
sauf si `REBASE_MCP_ALLOW_REMOTE_WRITES` est défini ; `rebase_project_switch` permet
de revenir en arrière.

Chaque outil fonctionne par instantané :

- `rebase_cloud_logs` ne suit jamais en continu (follow). Son résultat contient `nextSinceTime` ; renvoyez-le
  en paramètre `since` pour lire la suite. Il renvoie les 200 dernières lignes sauf si
  `tail` indique autre chose. `source: "build"` renvoie plutôt le journal de build le plus récent.
- `rebase_cloud_deploy` suit le déploiement jusqu'à son terme et vérifie que la nouvelle
  version répond. `wait: false` rend la main dès que le déploiement est déclenché.
  Il n'éjecte jamais un projet du runtime managé, ne déploie jamais une version plus ancienne du framework,
  ou n'ignore jamais les vérifications de build : ce sont des décisions qui reviennent à l'utilisateur, et un
  refus nécessitant l'une d'elles le précise.
- `rebase_cloud_rollback` passe `--yes`. L'appel de l'outil fait office de confirmation, puisqu'il
  n'y a pas de terminal pour demander confirmation.

`rebase_cloud_env_set` écrit la valeur sur l'entrée standard du CLI, de sorte qu'elle ne figure
jamais sur une ligne de commande où `ps` pourrait la révéler, et la valeur est expurgée de tout ce
que l'outil renvoie. Son résultat indique ce qui a été stocké (la clé, si elle
est secrète, si un redéploiement est en attente), jamais la valeur. `rebase_cloud_env_list`
liste uniquement les clés. Une version du CLI antérieure à `env set --stdin` est refusée avec un message invitant à la
mettre à niveau ; la valeur n'est pas transmise par un autre moyen.

Les résultats sont renvoyés dans l'[enveloppe de données non fiables](#balisage-des-données-non-fiables),
précédés d'une ligne du serveur indiquant la marche à suivre. Un refus est une erreur d'outil
portant le code du CLI, comme `no_project`, `token_rejected`,
`managed_project` ou `deploy_failed`. Lorsque le serveur reconnaît le code, il
ajoute l'étape suivante, puis le propre message du CLI. Chaque outil vérifie ses arguments
par rapport au schéma qu'il annonce avant toute exécution, et refuse un argument
qu'il ne déclare pas.

## Référence des outils

53 outils, répartis en dix groupes : schéma et base de données, planification de schéma, documents, utilisateurs
et rôles, stockage, cron, fonctions, serveur de développement, registre de projets et
Rebase Cloud.
Chacun d'eux, avec ses prérequis et l'indication de son éventuel refus par la barrière face à une cible non locale,
figure dans la [référence des outils MCP](/docs/ai/mcp-tool-reference).

## Ressources

Au-delà des outils, le serveur expose des ressources MCP afin qu'un client puisse extraire le
contexte du projet sans consommer d'appel d'outil :

| URI | Description |
|---|---|
| `rebase://collections/{name}` | Source TypeScript d'une définition de collection |
| `rebase://schema` | Le schéma Drizzle généré (`schema.generated.ts`) |

Les collections sont découvertes à partir de `app/config/collections/`,
`config/collections/` ou `collections/` dans le répertoire du projet actif —
selon le dossier existant.

`rebase://schema` n'est listé **que si** le schéma généré existe.
`findBackendDir` recherche `backend/` puis `app/backend/` dans le répertoire du
projet actif, et lit `src/schema.generated.ts` dans celui qu'il trouve —
ainsi, tant l'organisation générée par défaut que celle de ce monorepo fonctionnent, tandis qu'un projet organisé d'une
troisième manière, ou n'ayant pas encore exécuté `rebase schema generate`, ne
verra tout simplement pas la ressource proposée.

## Le point de terminaison distant

Un backend déployé peut également servir MCP lui-même, à l'adresse `/mcp`, aux personnes qui utilisent
votre application, chacun se connectant sous sa propre identité selon sa propre
sécurité au niveau des lignes (RLS). Cela fait l'objet d'une page dédiée :
[Le point de terminaison MCP distant](/docs/ai/remote-mcp/).

## Configuration recommandée

- Faites pointer le serveur vers un projet **local** et laissez `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non défini. La barrière est l'élément le plus précieux du paquet.
- Pour tout ce qui est distant, enregistrez une **clé d'API `rk_` avec portées restreintes** plutôt que de laisser
  la détection fournir une clé de service.
- Vérifiez `rebase_project_current` lorsque la sortie semble incorrecte. Le projet actif est
  persistant (sticky) et réside en dehors de votre dépôt.
- Traitez `~/.rebase/projects.json` comme un fichier contenant des secrets.

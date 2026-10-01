---
sourceHash: c30cc2c794d1f805
title: Serveur MCP
sidebar_label: Serveur MCP
description: Connectez Claude Code, Cursor, Gemini CLI ou n'importe quel client MCP à un projet Rebase — les 42 outils exposés, l'identifiant avec lequel il s'authentifie et le verrou loopback qui s'interpose entre un agent et la production.
---

`@rebasepro/mcp` est un serveur [Model Context Protocol](https://modelcontextprotocol.io)
qui fournit à un assistant IA de véritables outils sur un projet Rebase : lire et
écrire des lignes, gérer les utilisateurs, exécuter des migrations, invoquer des fonctions,
piloter le serveur de développement.

Il communique en MCP via **stdio uniquement**. Il n'y a ni port ni écouteur réseau — le
processus dispose exactement du même niveau de confiance que ce qui l'a lancé, et il n'y a
aucun appelant distant à authentifier. C'est la partie sécurisée. Les questions intéressantes
concernent toutes ce qu'il fait *une fois* en cours d'exécution, et cette page y répond avant
de vous présenter le bloc de configuration.

Un backend déployé peut également servir du MCP lui-même, via HTTP, aux personnes qui utilisent
votre application. Il s'agit d'une chose différente avec un modèle d'identifiants différent :
voir [Le point de terminaison distant](#the-remote-endpoint).

## Connecter un client

Le serveur est publié sur npm et ne nécessite aucune étape d'installation ; `npx` le récupère.
Chaque bloc ci-dessous constitue l'intégration complète.

<span class="since-badge" data-since="0.24">Depuis 0.24</span> `rebase init` écrit le bloc pour chaque agent sélectionné lorsqu'il
[configure vos agents de codage IA](/docs/ai/skills#set-up-by-rebase-init), tout en
conservant les autres serveurs déjà présents dans le fichier. `rebase init --agent cursor,codex` fait
de même sans poser de questions.

**Claude Code** — `.mcp.json` à la racine de votre projet. `rebase init` écrit ce
fichier pour vous :

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Cursor** — la même structure, dans `.cursor/mcp.json`. Cursor résout
`${workspaceFolder}` par la racine du projet :

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
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
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Codex CLI** — en TOML plutôt qu'en JSON, dans le fichier `.codex/config.toml` du projet.
Codex ne lit la configuration d'un projet qu'après que vous avez approuvé le projet :

```toml title=".codex/config.toml"
[mcp_servers.rebase]
command = "npx"
args = ["-y", "@rebasepro/mcp"]

[mcp_servers.rebase.env]
REBASE_PROJECT_DIR = "."
```

**Kiro** — `.kiro/settings/mcp.json` :

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
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
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Windsurf** lit les serveurs MCP uniquement depuis sa configuration utilisateur, il n'y a donc
aucun fichier de projet à écrire. Ajoutez le serveur dans les paramètres MCP de Windsurf, avec un
`REBASE_PROJECT_DIR` absolu.

Tout client MCP capable de lancer un serveur stdio fonctionne ; la structure reste la même.

### Sur quel répertoire il opère

`REBASE_PROJECT_DIR` est le répertoire contenant `rebase.json`. Il existe **un seul**
ordre de priorité, et il est identique dans chaque client :

1. **Le bloc d'environnement** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si l'un d'eux est défini, le projet `default` est reconstruit
   à partir de ceux-ci à chaque démarrage.
2. **Le répertoire de travail du serveur**, lorsqu'il contient un `rebase.json`. Un projet
   dans lequel vous vous trouvez a la priorité sur tout ce qui est mémorisé dans `~/.rebase/projects.json`.
3. **Le projet `default` persistant** dans `~/.rebase/projects.json`, lorsque aucun des deux
   premiers n'indique quoi que ce soit.

L'auto-découverte à partir de `.rebase/state.json` comble les manques dans les trois cas et n'écrase
jamais une valeur fournie par l'un d'eux.

Les blocs au niveau du projet désignent le projet — `"."`, le répertoire de travail du client ou
`${workspaceFolder}` de l'éditeur — car la règle 3 lit un fichier partagé par tous les projets
de la machine. Une configuration au niveau utilisateur, telle que celle de Windsurf, spécifie
quant à elle un chemin absolu.

## Ce à quoi le serveur peut accéder

C'est la section à lire avant de pointer un assistant vers une base de données à laquelle vous tenez.

Le serveur utilise **un identifiant ambiant unique pour l'ensemble du processus**. Il n'y a pas
d'identité par outil ni de mode lecture seule ; chaque outil utilise le même jeton, et le seul
commutateur du paquet permet d'*étendre* la portée plutôt que de la restreindre.

De quel identifiant il s'agit, par ordre de priorité :

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` issu de l'environnement
2. `REBASE_SERVICE_KEY` lu dans le fichier `.env` du projet
3. La clé de service découverte automatiquement depuis `.rebase/state.json` pendant
   que `rebase dev` s'exécute

Un jeton enregistré pour un projet **l'emporte sur l'auto-découverte**. La découverte ne fait
que combler un manque.

:::danger[La méthode sans configuration utilise un identifiant administrateur]
Les options 2 et 3 correspondent à la **clé de service** (`service key`) — un secret administrateur
sans restriction de portée. Le backend la résout en `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`.
Cette identité détient toutes les [portées](/docs/backend/roles-and-scopes/), et elle satisfait les
politiques `_default_admin_read` / `_default_admin_write` que Rebase injecte dans chaque collection
n'ayant pas défini `disableDefaultPolicies`.

La réponse honnête à la question « le RLS continue-t-il de s'appliquer ? » est donc la suivante : le
RLS *s'exécute* — le pilote passe bien au rôle `rebase_user` — puis une politique générée par Rebase
lui-même accorde tous les droits à cette identité. La lecture de chaque ligne de chaque collection est le
**comportement prévu par la configuration par défaut**, et non un contournement de sécurité.

Avec la configuration par défaut sans réglage particulier, un agent disposant de ces outils peut
lire et écrire chaque ligne de chaque collection, lister chaque utilisateur, réinitialiser n'importe quel
mot de passe, invoquer n'importe quelle fonction backend et exécuter du DDL sur n'importe quelle `DATABASE_URL`
résolue par le projet.
:::

### Lui attribuer un identifiant aux droits restreints

<span class="since-badge" data-since="0.24">Depuis 0.24</span> Enregistrez une [clé d'API](/docs/backend/api-keys) restreinte et le modèle à deux verrous s'applique
réellement. Une clé de service s'exécute avec les rôles `["service"]`, que les politiques
d'administration injectées ne mentionnent **pas** — ainsi, le RLS ne lui accorde rien à moins que l'une
de vos propres politiques n'en dispose autrement, et ses portées la restreignent davantage :

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Transmettez ensuite la clé `rk_live_…` obtenue au serveur au lieu de le laisser découvrir une clé de service :

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
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
  `DATABASE_URL` et ne voit jamais votre jeton. Le verrou loopback ci-dessous est le
  seul garde-fou face à ceux-ci.
- **Une clé n'atteint un outil d'administration qu'avec la portée de cet outil.** `list_users` et
  `list_roles` exigent `users:read` ; `create_user`, `update_user`, `delete_user` et
  `rebase_auth_reset_password` exigent `users:write` ; les outils de stockage et de cron
  exigent la portée `storage:*` ou `cron:*` correspondante ; `invoke_function` exige
  `functions:invoke`. Sans
  elle, l'appel répond `403 SCOPE_MISSING`. Même avec `users:write`, une clé ne peut pas
  modifier le compte d'un administrateur : un administrateur détient `keys:read` et `keys:write`,
  qu'aucune clé ne peut détenir, et personne ne peut gérer un compte qui détient plus que lui.

Une clé créée avec `--roles admin` est une autre affaire : elle porte les rôles
`["service", "admin"]`, ce qui valide les mêmes politiques admin par défaut que la
clé de service. Ajoutez-lui aussi `--full-access` et sa portée est celle de la clé de service,
moins la gestion des clés. Son avantage est qu'elle est **révocable, dotée d'une expiration et soumise
à une limitation de débit par clé**, ce qui n'est pas le cas de la clé de service — renouveler cette
dernière implique de modifier `.env` et de redémarrer le serveur.

Consultez [Agents et serveurs MCP](/docs/backend/api-keys#agents-and-mcp-servers) pour le guide
complet sur la restriction des clés.

### Rendre une collection totalement inaccessible

La raison pour laquelle un identifiant administrateur lit tout est la politique de base que Rebase
injecte dans chaque collection, accordant l'accès au contexte de serveur de confiance et au
rôle `admin`. Une collection peut désactiver cette politique de base et assumer l'entière
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

Désormais, la seule façon d'y accéder est de correspondre à `patient_id`. L'uid de la clé de service
étant la chaîne littérale `service`, une règle de propriété ne correspond jamais — les lectures renvoient
zéro ligne et les écritures sont rejetées par Postgres. Il s'agit du seul mécanisme qui restreint
l'identifiant par défaut du serveur MCP plutôt que de lui donner carte blanche.

N'oubliez pas qu'il s'agit d'une modification concrète de RLS, et non purement documentaire : elle ne prend effet
qu'une fois que `rebase schema generate` et une migration ont appliqué les politiques. Voir
[Règles de sécurité (RLS)](/docs/collections/security-rules).

## Le verrou loopback

`rebase_project_add` accepte n'importe quelle `baseUrl`, et les outils CLI se connectent à la
`DATABASE_URL` déclarée par le projet. La même liste d'outils qui modifie une base temporaire
sur votre ordinateur portable peut donc supprimer des lignes en production, sans autre intermédiaire
que le jugement de l'assistant quant au projet actif.

**Tout outil qui modifie l'environnement cible est refusé sauf si cette cible se trouve sur
l'interface loopback.** Le verrou est conçu comme une liste de ce qui n'*est pas*
verrouillé, de sorte qu'un outil ajouté ultérieurement est protégé par défaut.

- **Non verrouillés — lectures :** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Non verrouillés — locaux uniquement :** `rebase_schema_introspect`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, les outils du serveur de dev et les outils du registre de projets.
  Ceux-ci écrivent des fichiers locaux ou un état local et n'ont aucune cible distante à vérifier.
- **Verrouillés selon `DATABASE_URL` :** les outils CLI restants — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Verrouillés selon la `baseUrl` du projet :** les outils SDK restants —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Les deux cibles ne sont pas interchangeables. Les outils CLI ne voient jamais `baseUrl`, ainsi un backend
localhost associé à une `DATABASE_URL` de production est contrôlé par rapport à la base de données,
et non par rapport au backend.

Un refus ressemble à ceci :

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si aucune chaîne de connexion ne peut être résolue, les outils de base de données sont refusés** —
une cible invérifiable n'est pas une cible sûre :

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Seule l'interface loopback est considérée comme locale : `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Les plages privées telles que `10.x` et `192.168.x` ne le sont **pas** — celles-ci ont autant de chances
d'être un cluster de staging partagé qu'un ordinateur portable, et les traiter comme locales laisserait
passer précisément l'accident que ce verrou a pour rôle d'empêcher.

Définissez `REBASE_MCP_ALLOW_REMOTE_WRITES=true` pour désactiver cette protection. Le définir globalement
dans la configuration de votre client MCP désactive le verrou pour tous les projets auxquels le serveur a accès,
et pas seulement pour celui auquel vous pensiez.

## Marquage des données non fiables

Les lignes, enregistrements utilisateurs, listes de stockage, tâches cron, réponses de fonctions et
sorties CLI sont renvoyés enveloppés dans une balise explicite :

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Tout ce qui est stocké dans votre base de données a été écrit par quelqu'un, et cela arrive sur le
même canal que le contrat d'outils que l'assistant suit. L'enveloppe indique au modèle de traiter
cela comme un contenu inerte plutôt que comme des instructions.

L'`id` est généré à nouveau pour chaque réponse, après l'écriture des données, et seul le marqueur
de fin le portant clôture le bloc. Le texte à l'intérieur des données qui ressemble à un marqueur est
scindé par une espace sans chasse (zero-width space), de sorte qu'une ligne qui contiendrait
`<<<END_UNTRUSTED_DATA>>>` ne puisse pas fermer prématurément l'enveloppe et exposer ce qui la suit.

Il s'agit d'un marqueur, pas d'un bac à sable (sandbox). Un assistant disposant de ces outils n'est sûr
qu'à hauteur de la fiabilité du contenu que vous lui permettez de lire.

## Projets multiples

Les configurations des projets sont stockées dans `~/.rebase/projects.json`, et le serveur peut en
gérer plusieurs à la fois — très utile si vous travaillez à cheval entre des environnements locaux et
distants. Pendant que `rebase dev` s'exécute, le serveur lit le port actif et la clé de service depuis
`.rebase/state.json` dans le répertoire du projet, ce qui permet le fonctionnement sans configuration en local.

:::note[Le registre a le dernier mot, pas le premier]
L'ordre de priorité est celui mentionné plus haut : bloc d'environnement, puis le répertoire de travail
lorsqu'il contient un `rebase.json`, puis le projet `default` persistant.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` et `REBASE_API_TOKEN` reconstruisent le projet `default`
**à chaque démarrage**, pas seulement au premier. Cette reconstruction s'applique à l'entrée entière :
un jeton enregistré pour l'ancien `projectDir` est supprimé plutôt que transmis à un répertoire pour lequel
il n'a jamais été émis. Un projet `default` dérivé de cette manière — ou à partir du répertoire de travail —
n'est jamais réécrit dans `~/.rebase/projects.json`, ainsi la clé de service de dev d'un projet ne peut pas
devenir celle d'un autre.

`activeProject` est persistant : si une session précédente a appelé `rebase_project_switch`, les outils
cibleront ce projet et le serveur le signalera sur stderr — à moins que ce projet ne soit enregistré
sous un répertoire *différent* de celui dans lequel ce serveur s'exécute, auquel cas il bascule sur
`default` et le signale. Si un assistant semble lire la mauvaise base de données, appelez
`rebase_project_current` en premier lieu.
:::

Les jetons sont stockés dans ce registre **en clair**. Il s'agit d'un fichier dans votre répertoire
personnel qui contient des identifiants administrateurs pour chaque projet que vous avez enregistré ;
traitez-le en conséquence.

## Référence des outils

42 outils, répartis en neuf groupes. Les outils marqués d'un ⚠ sont refusés sur les cibles non locales
à moins que vous ne désactiviez cette protection.

### Schéma et base de données (12)

Lancent la CLI Rebase dans le répertoire du projet actif.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_generate` | — | Générer le schéma Drizzle à partir des définitions de collections |
| `rebase_db_push` ⚠ | — | Appliquer le schéma directement à la base de données (raccourci de dev) |
| `rebase_schema_introspect` | — | Introspecter la base de données en direct pour générer les définitions de collections |
| `rebase_db_generate` | — | Générer les fichiers de migration SQL à partir des modifications de schéma |
| `rebase_db_migrate` ⚠ | — | Exécuter toutes les migrations SQL en attente |
| `rebase_generate_sdk` | — | Générer le SDK TypeScript entièrement typé |
| `rebase_doctor` | — | Détecter les dérives entre les définitions, le schéma généré et la base de données en direct |
| `rebase_db_branch_create` ⚠ | `name` | Créer une branche de base de données (admins uniquement) |
| `rebase_db_branch_list` | — | Lister les branches de base de données (admins uniquement) |
| `rebase_db_branch_delete` ⚠ | `name` | Supprimer une branche de base de données (admins uniquement) |
| `rebase_db_branch_info` | `name` | Informations et statut de la branche (admins uniquement) |
| `rebase_db_branch_switch` | — | Pointer cette copie locale sur une branche, ou revenir à la base principale (admins uniquement) |

### Planification de schéma (1)

Demande au backend ce qu'impliquerait un changement, via `POST /api/admin/schema/plan`. Aucune
CLI et aucune écriture sur le disque — cela fonctionne sur la base de données de développement managée,
ce que les commandes basées sur Atlas ne peuvent pas faire.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | Le SQL que la modification d'une collection exécuterait, et les instructions qui détruisent des données |

### Documents (5)

| Outil | Requis | Description |
|---|---|---|
| `list_documents` | `collection` | Lister les lignes, avec `limit`, `offset`, `orderBy`, `where` facultatifs |
| `get_document` | `collection`, `id` | Récupérer une seule ligne par ID |
| `create_document` ⚠ | `collection`, `data` | Créer une ligne |
| `update_document` ⚠ | `collection`, `id`, `data` | Mettre à jour une ligne |
| `delete_document` ⚠ | `collection`, `id` | Supprimer une ligne |

### Utilisateurs et rôles (6)

| Outil | Requis | Description |
|---|---|---|
| `list_users` | — | Lister tous les utilisateurs, y compris les rôles |
| `create_user` ⚠ | `email` | Créer un utilisateur (`displayName`, `password`, `roles` facultatifs) |
| `update_user` ⚠ | `uid` | Mettre à jour l'e-mail, le nom d'affichage ou les rôles |
| `delete_user` ⚠ | `uid` | Supprimer un utilisateur |
| `list_roles` | — | Lister les rôles définis |
| `rebase_auth_reset_password` ⚠ | `email` | Réinitialiser un mot de passe via l'API admin |

`create_user` et `update_user` acceptent tous deux `roles`, de sorte que l'un ou l'autre peut attribuer
les droits admin. C'est pourquoi ils sont verrouillés plutôt que considérés comme simplement « additifs ».

### Stockage (3)

| Outil | Requis | Description |
|---|---|---|
| `storage_list_objects` | — | Lister les objets stockés |
| `storage_get_download_url` | `key` | Une URL de téléchargement signée temporaire et son expiration — et non les métadonnées de l'objet |
| `storage_delete_object` ⚠ | `key` | Supprimer un objet |

`storage_get_download_url` est classé comme une lecture car il ne modifie pas l'environnement — mais l'URL signée
qu'il génère est un jeton au porteur qui survit à l'appel de l'outil.

### Cron (5)

| Outil | Requis | Description |
|---|---|---|
| `cron_list_jobs` | — | Lister les tâches planifiées et leur statut |
| `cron_get_job` | `jobId` | Détails de la tâche |
| `cron_get_job_logs` | `jobId` | Journaux d'exécution |
| `cron_trigger_job` ⚠ | `jobId` | Exécuter une tâche immédiatement |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Activer ou désactiver une tâche |

`cron_toggle_job` peut désactiver silencieusement une sauvegarde ou une tâche de facturation — une modification
sans erreur ni retour jusqu'à ce que quelque chose vienne à manquer plus tard.

### Fonctions (1)

| Outil | Requis | Description |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoquer une [fonction personnalisée](/docs/backend/custom-functions) avec n'importe quelle méthode et charge utile |

Cela exécute du code que le serveur MCP n'a jamais vu, avec une méthode et un corps choisis par le modèle.
Son rayon d'impact correspond à tout ce que vos fonctions réalisent.

### Serveur de dev (3)

| Outil | Requis | Description |
|---|---|---|
| `rebase_dev_start` | — | Démarrer le serveur de dev ; retourne immédiatement |
| `rebase_dev_logs` | — | Lire les sorties récentes (50 lignes par défaut, tampon de 500 lignes) |
| `rebase_dev_stop` | — | Arrêter le serveur de dev |

### Registre de projets (6)

| Outil | Requis | Description |
|---|---|---|
| `rebase_project_list` | — | Lister les projets enregistrés et afficher le projet actif |
| `rebase_project_switch` | `name` | Changer le projet actif |
| `rebase_project_add` | `name` | Enregistrer un projet (`baseUrl`, `projectDir` et `token` facultatifs) |
| `rebase_project_remove` | `name` | Supprimer un projet (le projet default ne peut pas être supprimé) |
| `rebase_project_current` | — | Afficher le projet actif et son statut d'authentification |
| `rebase_project_status` | — | Vérifier la santé du backend actif |

`rebase_project_switch` n'est pas verrouillé, car il réoriente tout le reste plutôt que d'agir
directement sur une cible. Un assistant peut donc basculer vers un projet distant sans déclencher
le verrou — il ne pourra simplement pas y exécuter d'outil destructeur ensuite.

## Ressources

Au-delà des outils, le serveur expose des ressources MCP permettant à un client de récupérer
le contexte du projet sans consommer d'appel d'outil :

| URI | Description |
|---|---|
| `rebase://collections/{name}` | Code source TypeScript de la définition d'une collection |
| `rebase://schema` | Le schéma Drizzle généré (`schema.generated.ts`) |

Les collections sont découvertes depuis `app/config/collections/`,
`config/collections/` ou `collections/` dans le répertoire du projet actif —
selon ce qui existe.

`rebase://schema` n'est listé **que si** le schéma généré existe.
`findBackendDir` recherche `backend/` puis `app/backend/` dans le répertoire du
projet actif, et lit `src/schema.generated.ts` dans celui qu'il trouve —
ainsi, la structure générée par défaut tout comme celle de ce monorepo fonctionnent,
tandis qu'un projet organisé d'une autre manière, ou qui n'a pas encore exécuté
`rebase schema generate`, ne verra tout simplement pas la ressource proposée.

## Le point de terminaison distant

Tout ce qui précède concerne un outil de développement : il s'exécute sur votre machine et détient une clé
de service ou une clé d'API. Un backend déployé peut également servir du MCP lui-même, sur `/mcp`, pour
les personnes qui utilisent votre application. Un assistant connecté par l'une d'elles lit et
écrit dans le projet **en tant que cette personne**, et chaque appel s'exécute sous ses propres
règles de sécurité au niveau des lignes (RLS).

Il est désactivé par défaut, et les deux variables sont obligatoires :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, un secret JWT ou un pilote de données capable de restreindre une requête
à un utilisateur, le point de terminaison refuse de se monter et en explique la raison dans le journal de démarrage.
Aucun `REBASE_ROLE` ne permet de l'activer.

- **OAuth, avec écran de consentement.** Un client découvre le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre lui-même (l'enregistrement
  dynamique est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le limite
  aux clients que vous enregistrez), et redirige la personne vers un écran de consentement qui
  la connecte via votre `/auth/login` existant.
- <span class="since-badge" data-since="0.24">Depuis 0.24</span> **Six outils, trois portées (scopes).** Les mêmes [portées](/docs/backend/roles-and-scopes/)
  que celles de tous les identifiants. `data:read` propose `list_collections`,
  `query_collection` et `get_document` ; `data:write` ajoute `create_document` et
  `update_document` ; `data:delete` ajoute `delete_document`. Un client qui ne demande
  rien obtient `data:read`. Chacune se restreint à une collection : `data:read:posts`
  liste et lit `posts` et rien d'autre. Une portée détermine les outils proposés et les
  collections qu'ils atteignent, pas les lignes accessibles : une liste vide peut simplement
  être le résultat du RLS, et `data:write` ne peut toujours pas écrire une ligne à laquelle
  la personne n'a pas accès.
- **Les autorisations accordées avant 0.24 gardent leur portée.** `mcp:read` est lu comme
  `data:read`, et `mcp:write` comme `data:write data:delete`, sur les autorisations
  enregistrées et sur les jetons déjà émis.
- <span class="since-badge" data-since="0.24">Depuis 0.24</span> **Une clé API fonctionne aussi.** `/mcp` accepte aussi `Authorization: Bearer rk_…`, pour
  un client configuré avec un en-tête plutôt qu'avec un flux OAuth. La clé atteint
  les outils que couvrent ses portées `data:*`, en tant que l'identité pour laquelle elle agit : une
  [clé personnelle](/docs/backend/api-keys/#personal-keys) en tant que son propriétaire, une clé de service
  en tant que `api-key:<id>`.
- **Un jeton réservé à ce point de terminaison.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket, de sorte que connecter un assistant ne lui
  confère pas une session complète.

Une limite : déconnecter un client (`DELETE /api/oauth/grants/:clientId`, avec la
propre session de la personne) révoque immédiatement ses jetons de rafraîchissement (refresh tokens),
mais un jeton d'accès déjà émis reste valide jusqu'à son expiration, dans la limite d'une heure.
Ce même délai d'une heure encadre tout le reste : chaque rafraîchissement relit les rôles de la
personne et rejette un compte supprimé ou une autorisation antérieure à sa dernière action « se déconnecter de partout »
ou à son changement de mot de passe. Ainsi, une rétrogradation de rôle ou une déconnexion prend effet
pour un client connecté dans la durée de vie d'un jeton d'accès. Une session invité ne peut en aucun cas
donner son consentement.

Les routes se trouvent dans [Points de terminaison](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).

## Configuration recommandée

- Pointez le serveur vers un projet **local** et laissez `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non défini. Le verrou est l'élément le plus précieux de ce paquet.
- Pour tout projet distant, enregistrez une **clé d'API `rk_` restreinte** plutôt que de laisser
  l'auto-découverte transmettre une clé de service.
- Vérifiez `rebase_project_current` lorsque le résultat semble incorrect. Le projet actif est
  persistant et réside en dehors de votre dépôt.
- Traitez `~/.rebase/projects.json` comme un fichier de secrets.

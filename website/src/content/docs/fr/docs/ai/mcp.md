---
title: Serveur MCP
sidebar_label: Serveur MCP
description: Connectez Claude Code, Cursor, Gemini CLI ou tout client MCP à un projet Rebase — les 41 outils qu'il expose, l'identifiant avec lequel il s'authentifie et la barrière de loopback qui s'interpose entre un agent et la production.
---

`@rebasepro/mcp` est un serveur [Model Context Protocol](https://modelcontextprotocol.io)
qui fournit à un assistant IA de véritables outils sur un projet Rebase : lire et
écrire des lignes, gérer les utilisateurs, exécuter des migrations, invoquer des
fonctions, piloter le serveur de développement.

Il communique en MCP via **stdio uniquement**. Il n'y a aucun port ni listener — le
processus est exactement aussi fiable que ce qui l'a lancé, et il n'y a aucun appelant
distant à authentifier. C'est la partie sûre. Les questions intéressantes portent toutes
sur ce qu'il fait *une fois* qu'il est en cours d'exécution, et cette page y répond
avant de vous présenter le bloc de configuration.

## Connecter un client

Le serveur est publié sur npm et ne nécessite aucune installation ; `npx` le
récupère. Chaque bloc ci-dessous constitue l'intégration complète.

**Claude Code** — `.mcp.json` à la racine de votre projet. `rebase init` écrit ce fichier pour vous :

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"]
    }
  }
}
```

**Cursor** — la même forme, dans `.cursor/mcp.json` :

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"]
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
      "args": ["-y", "@rebasepro/mcp"]
    }
  }
}
```

**Codex CLI** — du TOML plutôt que du JSON, dans `~/.codex/config.toml`. Le fichier est au niveau utilisateur, pas au niveau projet : indiquez donc ici le répertoire du projet :

```toml title="~/.codex/config.toml"
[mcp_servers.rebase]
command = "npx"
args = ["-y", "@rebasepro/mcp"]
env = { REBASE_PROJECT_DIR = "/absolute/path/to/your/project" }
```

**Kiro** — `.kiro/settings/mcp.json` :

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"]
    }
  }
}
```

N'importe quel client MCP capable de lancer un serveur stdio fonctionne ; la forme est la même.

### Sur quel répertoire il agit

`REBASE_PROJECT_DIR` doit être le répertoire contenant `rebase.json`. Si vous
l'omettez, le serveur utilise son répertoire de travail, qui pour un fichier de
configuration au niveau du projet est le projet lui-même — c'est pourquoi seul
le bloc Codex, au niveau utilisateur, le définit.

Défini, il l'emporte : l'environnement reconstruit le projet `default` à chaque
démarrage, donc un chemin absolu dans une configuration utilisateur prime sur ce
que mémorise `~/.rebase/projects.json`.

## Ce à quoi le serveur a accès

C'est la section à lire avant de pointer un assistant vers une base de données à
laquelle vous tenez.

Le serveur dispose d'**un seul identifiant ambiant pour l'ensemble du processus**.
Il n'y a pas d'identité par outil ni de mode lecture seule ; chaque outil utilise le
même jeton, et le seul commutateur du package permet d'*étendre* la portée plutôt que
de la restreindre.

Cet identifiant est déterminé selon l'ordre de priorité suivant :

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` depuis l'environnement
2. `REBASE_SERVICE_KEY` lu depuis le `.env` du projet
3. La clé de service auto-détectée depuis `.rebase/state.json` pendant que
   `rebase dev` est en cours d'exécution

Un jeton que vous enregistrez pour un projet **l'emporte sur l'auto-détection**. La
détection ne sert qu'à combler un manque.

:::danger[La configuration zéro est un identifiant administrateur]
Les options 2 et 3 correspondent à la **clé de service (service key)** — un secret
administrateur sans restriction de portée. Le backend la résout en `uid: "service"`,
`roles: ["admin"]`, `isAdmin: true`. Cette identité ignore totalement la liste des
permissions des clés API et satisfait les politiques `_default_admin_read` /
`_default_admin_write` que Rebase injecte dans chaque collection n'ayant pas défini
`disableDefaultPolicies`.

Ainsi, la réponse honnête à la question « le RLS continue-t-il de la contraindre ? »
est : le RLS *s'exécute* — le pilote bascule bien vers le rôle `rebase_user` — puis une
politique écrite par Rebase lui-même accorde tous les droits à cette identité. Lire
chaque ligne de chaque collection est le **comportement prévu de la configuration par
défaut**, et non un contournement de sécurité.

Avec la configuration zéro, un agent disposant de ces outils peut lire et écrire chaque
ligne de chaque collection, lister chaque utilisateur, réinitialiser n'importe quel mot
de passe, invoquer n'importe quelle fonction backend et exécuter du DDL sur n'importe
quel `DATABASE_URL` résolu par le projet.
:::

### Lui attribuer un identifiant restreint à la place

Enregistrez une [clé API](/docs/backend/api#api-keys) restreinte et le modèle à
double barrière s'applique réellement. Une clé non-admin s'exécute avec les rôles
`["service"]`, que les politiques d'administration injectées ne mentionnent **pas** —
ainsi, le RLS ne lui accorde rien à moins que l'une de vos propres politiques n'en
dispose autrement, et la liste des permissions restreint encore davantage ses accès :

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Transmettez ensuite la clé `rk_live_…` obtenue au serveur plutôt que de le laisser
détecter une clé de service :

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

Deux choses que cela ne fait **pas**, toutes deux importantes à connaître avant de
vous y fier :

- **Cela ne restreint pas les outils CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` et les outils de branches lancent la CLI Rebase, qui se connecte avec
  `DATABASE_URL` et ne voit jamais votre jeton. La barrière de loopback ci-dessous est la
  seule protection devant ces commandes.
- **Une clé non-admin ne peut pas utiliser les outils d'administration.** `list_users`,
  `create_user`, `update_user`, `delete_user`, `list_roles` et
  `rebase_auth_reset_password` se trouvent derrière `requireAdmin` et échoueront avec
  une clé restreinte. C'est le comportement attendu du système, mais cela implique de
  choisir entre portée étendue et restriction plutôt que d'avoir les deux.

Une clé API avec `admin: true` est différente : elle porte les rôles `["admin", "service"]`,
ce qui valide les mêmes politiques admin par défaut que la clé de service. Sur le plan
des données, sa portée est identique à celle de la clé de service. Ce qu'elle apporte de
plus, c'est qu'elle est **révocable, expirante et soumise à une limitation de débit par
clé**, ce qui n'est pas le cas de la clé de service — faire tourner cette dernière
nécessite de modifier `.env` et de redémarrer le serveur.

Consultez [Agents et serveurs MCP](/docs/backend/api#agents-and-mcp-servers) pour le
guide complet sur la restriction des clés.

### Rendre une collection totalement inaccessible

La raison pour laquelle un identifiant administrateur a accès à tout réside dans la
politique de base que Rebase injecte dans chaque collection, accordant l'accès au
contexte serveur de confiance et au rôle `admin`. Une collection peut refuser cette
politique de base et prendre l'entière responsabilité de son propre RLS :

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

Désormais, le seul moyen d'y accéder est de correspondre à `patient_id`. L'uid de la
clé de service est la chaîne littérale `service`, de sorte qu'une règle de propriétaire
ne correspond jamais — les lectures renvoient zéro ligne et les écritures sont rejetées
par Postgres. Il s'agit du seul contrôle qui contraint l'identifiant par défaut du
serveur MCP plutôt que de l'ignorer.

N'oubliez pas qu'il s'agit d'une réelle modification RLS et non d'une simple
convention : elle ne prend effet qu'une fois que `rebase schema generate` et une
migration ont appliqué les politiques. Consultez
[Règles de sécurité (RLS)](/docs/collections/security-rules).

## La barrière de loopback

`rebase_project_add` accepte n'importe quelle `baseUrl`, et les outils CLI se
connectent avec le `DATABASE_URL` déclaré par le projet. La même liste d'outils qui
modifie une base de données temporaire sur votre machine locale peut ainsi supprimer
des lignes en production, sans rien d'autre entre les deux que le jugement de
l'assistant sur le projet actif.

**Tout outil modifiant l'environnement cible est refusé sauf si cette cible se trouve
sur l'interface de loopback.** La barrière est conçue comme une liste de ce qui
n'*est pas* restreint, de sorte qu'un outil ajouté ultérieurement est protégé par
défaut.

- **Non restreint — lectures :** `rebase_schema_plan`, `rebase_schema_introspect`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_metadata`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Non restreint — local uniquement :** `rebase_schema_generate`,
  `rebase_db_generate`, `rebase_generate_sdk`, les outils du serveur de développement
  et les outils de registre de projet. Ceux-ci écrivent des fichiers locaux ou un état
  local et n'ont aucune cible distante à vérifier.
- **Restreint par rapport à `DATABASE_URL` :** les outils CLI restants —
  `rebase_db_push`, `rebase_db_migrate`, `rebase_db_branch_create`,
  `rebase_db_branch_delete`.
- **Restreint par rapport à la `baseUrl` du projet :** les outils SDK restants —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Les deux cibles ne sont pas interchangeables. Les outils CLI ne voient jamais
`baseUrl`, de sorte qu'un backend localhost associé à un `DATABASE_URL` de production
est vérifié par rapport à la base de données, et non au backend.

Un refus se présente ainsi :

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si aucune chaîne de connexion ne peut être résolue, les outils de base de données
sont refusés** — une cible invérifiable n'est pas une cible sûre :

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Seul le loopback est considéré comme local : `localhost`, `*.localhost`,
`127.0.0.0/8`, `::1`. Les plages privées comme `10.x` et `192.168.x` ne le sont
**pas** — elles sont tout aussi susceptibles d'être un cluster de staging partagé
qu'un ordinateur portable, et les traiter comme locales laisserait passer précisément
l'accident que la barrière vise à empêcher.

Définissez `REBASE_MCP_ALLOW_REMOTE_WRITES=true` pour désactiver cette protection.
Le définir globalement dans la configuration de votre client MCP supprime la barrière
pour tous les projets auxquels le serveur a accès, et pas seulement celui auquel vous
pensiez.

## Marquage des données non fiables

Les lignes, les enregistrements d'utilisateurs, les listes de fichiers de stockage,
les tâches cron, les réponses de fonctions et les sorties CLI sont retournés
encapsulés dans une enveloppe explicite :

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Tout ce qui est stocké dans votre base de données a été écrit par quelqu'un et arrive
sur le même canal que le contrat d'outil suivi par l'assistant. L'enveloppe indique au
modèle de traiter ce contenu comme inerte plutôt que comme des instructions.

Il s'agit d'un marqueur, pas d'un bac à sable (sandbox). Un assistant disposant de ces
outils n'est sûr qu'à hauteur du contenu que vous l'autorisez à lire.

## Projets multiples

Les configurations de projet sont stockées dans `~/.rebase/projects.json`, et le
serveur peut en gérer plusieurs à la fois — très utile lorsque vous travaillez entre
environnements locaux et distants. Pendant que `rebase dev` s'exécute, le serveur lit
le port actif et la clé de service depuis `.rebase/state.json` dans le répertoire du
projet, ce qui permet le fonctionnement sans configuration en local.

:::note[Le bloc d'environnement l'emporte sur le registre]
`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` et `REBASE_API_TOKEN` reconstruisent le
projet `default` **à chaque démarrage**, et pas seulement au premier. La
reconstruction porte sur l'entrée entière : un jeton enregistré pour l'ancien
`projectDir` est abandonné plutôt que repris dans un répertoire pour lequel il
n'a jamais été émis.

Le `default` persisté n'est utilisé que lorsque la configuration du client ne
définit aucune des trois variables. `activeProject` reste persistant : si une
session précédente a appelé `rebase_project_switch`, les outils visent ce projet
et le serveur le signale sur stderr. Si un assistant semble lire la mauvaise
base de données, appelez d'abord `rebase_project_current`.
:::

Les jetons sont stockés dans ce registre **en clair**. Il s'agit d'un fichier situé
dans votre répertoire personnel contenant les identifiants administrateur de chaque
projet que vous avez enregistré ; traitez-le en conséquence.

## Référence des outils

41 outils, répartis en huit groupes. Les outils marqués d'un ⚠ sont refusés sur les
cibles non locales, sauf si vous désactivez cette restriction.

### Schéma & base de données (12)

Lance la CLI Rebase dans le répertoire du projet actif.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_plan` | — | Affiche le SQL que `rebase_db_push` exécuterait, sans rien exécuter |
| `rebase_schema_generate` | — | Générer le schéma Drizzle à partir des définitions de collection |
| `rebase_db_push` ⚠ | — | Appliquer le schéma directement à la base de données (raccourci de développement) |
| `rebase_schema_introspect` | — | Introspecter la base de données active pour générer les définitions de collection |
| `rebase_db_generate` | — | Générer les fichiers de migration SQL à partir des modifications de schéma |
| `rebase_db_migrate` ⚠ | — | Exécuter toutes les migrations SQL en attente |
| `rebase_generate_sdk` | — | Générer le SDK TypeScript entièrement typé |
| `rebase_doctor` | — | Détecter les dérives entre les définitions, le schéma généré et la base de données active |
| `rebase_db_branch_create` ⚠ | `name` | Créer une branche de base de données (administrateurs uniquement) |
| `rebase_db_branch_list` | — | Lister les branches de base de données (administrateurs uniquement) |
| `rebase_db_branch_delete` ⚠ | `name` | Supprimer une branche de base de données (administrateurs uniquement) |
| `rebase_db_branch_info` | `name` | Informations et état de la branche (administrateurs uniquement) |

### Documents (5)

| Outil | Requis | Description |
|---|---|---|
| `list_documents` | `collection` | Lister les lignes, avec `limit`, `offset`, `orderBy`, `where` facultatifs |
| `get_document` | `collection`, `id` | Récupérer une ligne unique par son ID |
| `create_document` ⚠ | `collection`, `data` | Créer une ligne |
| `update_document` ⚠ | `collection`, `id`, `data` | Mettre à jour une ligne |
| `delete_document` ⚠ | `collection`, `id` | Supprimer une ligne |

### Utilisateurs & rôles (6)

| Outil | Requis | Description |
|---|---|---|
| `list_users` | — | Lister tous les utilisateurs, rôles inclus |
| `create_user` ⚠ | `email` | Créer un utilisateur (`displayName`, `password`, `roles` facultatifs) |
| `update_user` ⚠ | `uid` | Mettre à jour l'e-mail, le nom d'affichage ou les rôles |
| `delete_user` ⚠ | `uid` | Supprimer un utilisateur |
| `list_roles` | — | Lister les rôles définis |
| `rebase_auth_reset_password` ⚠ | `email` | Réinitialiser un mot de passe via l'API d'administration |

`create_user` et `update_user` acceptent tous deux `roles`, ce qui permet à chacun
d'eux de créer un administrateur. C'est pourquoi ils sont restreints plutôt que
simplement considérés comme « additifs ».

### Stockage (3)

| Outil | Requis | Description |
|---|---|---|
| `storage_list_objects` | — | Lister les objets stockés |
| `storage_get_metadata` | `key` | Métadonnées assorties d'une URL de téléchargement signée temporaire |
| `storage_delete_object` ⚠ | `key` | Supprimer un objet |

`storage_get_metadata` est classé comme une lecture car il ne modifie pas
l'environnement — mais l'URL signée qu'il génère est un droit d'accès porteur qui
persiste au-delà de l'appel de l'outil.

### Cron (5)

| Outil | Requis | Description |
|---|---|---|
| `cron_list_jobs` | — | Lister les tâches planifiées et leur état |
| `cron_get_job` | `jobId` | Détails de la tâche |
| `cron_get_job_logs` | `jobId` | Journaux d'exécution |
| `cron_trigger_job` ⚠ | `jobId` | Exécuter une tâche immédiatement |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Activer ou désactiver une tâche |

`cron_toggle_job` peut désactiver silencieusement une sauvegarde ou une tâche de
facturation — une modification sans erreur ni retour jusqu'à ce qu'un manque soit
constaté ultérieurement.

### Fonctions (1)

| Outil | Requis | Description |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoquer une [fonction personnalisée](/docs/backend/custom-functions) avec n'importe quelle méthode et payload |

Cela appelle du code que le serveur MCP n'a jamais vu, avec une méthode et un corps de
requête choisis par le modèle. Son rayon d'impact correspond à tout ce que vos
fonctions réalisent.

### Serveur de développement (3)

| Outil | Requis | Description |
|---|---|---|
| `rebase_dev_start` | — | Démarrer le serveur de développement ; rend la main immédiatement |
| `rebase_dev_logs` | — | Lire les journaux récents (par défaut 50 lignes, tampon de 500 lignes) |
| `rebase_dev_stop` | — | Arrêter le serveur de développement |

### Registre de projets (6)

| Outil | Requis | Description |
|---|---|---|
| `rebase_project_list` | — | Lister les projets enregistrés et afficher le projet actif |
| `rebase_project_switch` | `name` | Changer de projet actif |
| `rebase_project_add` | `name` | Enregistrer un projet (`baseUrl`, `projectDir` et `token` facultatifs) |
| `rebase_project_remove` | `name` | Supprimer un projet (le projet par défaut ne peut pas être supprimé) |
| `rebase_project_current` | — | Afficher le projet actif et son statut d'authentification |
| `rebase_project_status` | — | Vérifier l'état de santé du backend actif |

`rebase_project_switch` n'est pas restreint, car il redirige l'ensemble sans agir
directement sur une cible. Un assistant peut donc basculer vers un projet distant sans
déclencher la barrière — il ne pourra simplement pas y exécuter d'outil destructeur
par la suite.

## Ressources

Au-delà des outils, le serveur expose des ressources MCP afin qu'un client puisse
récupérer le contexte du projet sans consommer d'appel d'outil :

| URI | Description |
|---|---|
| `rebase://collections/{name}` | Source TypeScript d'une définition de collection |
| `rebase://schema` | Le schéma Drizzle généré (`schema.generated.ts`) |

Les collections sont détectées depuis `app/config/collections/`, `config/collections/`
ou `collections/` sous le répertoire du projet actif — selon le premier trouvé.

`rebase://schema` n'est listée **que si** le schéma généré existe.
`findBackendDir` cherche `backend/` puis `app/backend/` sous le répertoire du
projet actif et lit `src/schema.generated.ts` depuis celui qu'il trouve — la
disposition du scaffold comme celle de ce monorepo fonctionnent donc. Un projet
organisé d'une troisième manière, ou dans lequel `rebase schema generate` n'a pas
encore été lancé, ne verra tout simplement pas la ressource proposée.

## Configuration recommandée

- Pointez le serveur vers un projet **local** et laissez `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non défini. La barrière est l'élément le plus précieux de ce package.
- Pour tout ce qui est distant, enregistrez une **clé API `rk_` restreinte** plutôt
  que de laisser la détection automatique fournir une clé de service.
- Vérifiez `rebase_project_current` lorsque la sortie semble incorrecte. Le projet
  actif persiste et réside en dehors de votre dépôt.
- Traitez `~/.rebase/projects.json` comme un fichier de secrets.

---

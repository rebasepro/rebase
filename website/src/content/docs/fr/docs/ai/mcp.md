---
sourceHash: 50026032d03a87e2
title: Serveur MCP
sidebar_label: Serveur MCP
description: Connectez Claude Code, Cursor, Gemini CLI ou tout client MCP à un projet Rebase — les 42 outils qu'il expose, l'identifiant avec lequel il s'authentifie, et la barrière de bouclage qui sépare un agent de la production.
---

`@rebasepro/mcp` est un serveur [Model Context Protocol](https://modelcontextprotocol.io)
qui fournit à un assistant IA de véritables outils sur un projet Rebase : lire et
écrire des lignes, gérer des utilisateurs, exécuter des migrations, invoquer des fonctions,
piloter le serveur de développement.

Il communique via MCP par **stdio uniquement**. Il n'y a ni port ni écouteur — le
processus bénéficie exactement du même niveau de confiance que l'entité qui l'a lancé,
et il n'y a aucun appelant distant à authentifier. C'est la partie sécurisée. Les questions
intéressantes concernent ce qu'il fait *une fois* en cours d'exécution, et cette page y
répond avant de vous présenter le bloc de configuration.

Un backend déployé peut également servir lui-même MCP, via HTTP, aux personnes qui utilisent
votre application. Il s'agit d'une tout autre fonctionnalité avec un modèle d'identifiants
différent : voir [Le point de terminaison distant](#le-point-de-terminaison-distant).

## Connecter un client

Le serveur est publié sur npm et ne nécessite aucune étape d'installation ; `npx` le télécharge.
Chaque bloc ci-dessous constitue l'intégration complète.

**Claude Code** — `.mcp.json` à la racine de votre projet. `rebase init` génère ce
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

**Cursor** — la même structure, dans `.cursor/mcp.json` :

```json title=".cursor/mcp.json"
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

**Codex CLI** — au format TOML plutôt que JSON, dans `~/.codex/config.toml`. Il est
défini au niveau utilisateur et non par projet, indiquez donc le répertoire du projet ici :

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
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

Tout client MCP capable de lancer un serveur stdio fonctionne ; la structure reste la même.

### Sur quel répertoire il agit

`REBASE_PROJECT_DIR` est le répertoire contenant `rebase.json`. Il existe **un seul**
ordre de priorité, identique pour chaque client :

1. **Le bloc d'environnement** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si l'un d'entre eux est défini, le projet `default` est reconstruit
   à partir de ceux-ci à chaque démarrage.
2. **Le répertoire de travail du serveur**, lorsqu'il contient un fichier `rebase.json`. Un projet
   dans lequel vous vous trouvez a la priorité sur tout ce qui est mémorisé dans `~/.rebase/projects.json`.
3. **Le projet `default` persisté** dans `~/.rebase/projects.json`, lorsque aucun des
   deux premiers n'est renseigné.

La détection automatique à partir de `.rebase/state.json` comble les manques dans les trois
cas et n'écrase jamais une valeur fournie par l'un d'eux.

Les blocs au niveau projet définissent `REBASE_PROJECT_DIR` sur `"."` — le répertoire de
travail du client est le projet — car la règle 3 lit un fichier partagé par tous les projets
de la machine. Le bloc Codex étant au niveau utilisateur plutôt que par projet, il spécifie
à la place un chemin absolu.

## Ce à quoi le serveur a accès

C'est la section à lire avant de pointer un assistant vers une base de données
importante.

Le serveur utilise **un identifiant ambiant unique pour l'ensemble du processus**. Il n'y a pas
d'identité par outil ni de mode lecture seule ; chaque outil utilise le même jeton, et le
seul commutateur du paquet sert à *élargir* la portée plutôt qu'à la restreindre.

Voici cet identifiant, par ordre de priorité :

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` depuis l'environnement
2. `REBASE_SERVICE_KEY` lu depuis le fichier `.env` du projet
3. La clé de service découverte automatiquement depuis `.rebase/state.json` pendant que `rebase dev`
   tourne

Un jeton enregistré pour un projet **l'emporte sur la détection automatique**. La découverte ne fait
que combler les manques.

:::danger[La méthode sans configuration est un identifiant administrateur]
Les options 2 et 3 correspondent à la **clé de service** — un secret administrateur sans restriction de portée.
Le backend la résout en `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Cette
identité contourne complètement la liste des permissions des clés d'API et satisfait les
politiques `_default_admin_read` / `_default_admin_write` que Rebase injecte dans
chaque collection n'ayant pas défini `disableDefaultPolicies`.

Ainsi, la réponse honnête à la question « le RLS s'applique-t-il toujours ? » est : le RLS *s'exécute* — le
pilote passe bien au rôle `rebase_user` — puis une politique écrite par Rebase lui-même accorde tous
les droits à cette identité. La lecture de chaque ligne de chaque collection est le **comportement prévu de la configuration par défaut**,
et non une faille de sécurité.

Avec la configuration par défaut (zero-config), un agent disposant de ces outils peut lire et modifier chaque
ligne de chaque collection, lister tous les utilisateurs, réinitialiser n'importe quel mot de passe, invoquer n'importe quelle fonction backend
et exécuter du DDL sur la base de données ciblée par `DATABASE_URL`.
:::

### Lui attribuer un identifiant restreint à la place

Enregistrez une [clé d'API](/docs/backend/api-keys) restreinte et le modèle à deux barrières
s'applique réellement. Une clé non-administrateur s'exécute avec les rôles `["service"]`, que les
politiques d'administration injectées ne mentionnent **pas** — ainsi, le RLS ne lui accorde rien à moins que l'une
de vos propres politiques ne spécifie le contraire, et la liste des permissions la restreint encore davantage :

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Transmettez ensuite la clé `rk_live_…` résultante au serveur au lieu de le laisser
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

Deux choses que cela ne fait **pas**, toutes deux importantes à savoir avant de vous reposer dessus :

- **Cela ne restreint pas les outils CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` et les outils de branches lancent le CLI Rebase, qui se connecte avec
  `DATABASE_URL` et ne voit jamais votre jeton. La barrière de bouclage ci-dessous est la
  seule protection devant ces commandes.
- **Une clé non-admin ne peut pas utiliser les outils d'administration.** `list_users`, `create_user`,
  `update_user`, `delete_user`, `list_roles` et `rebase_auth_reset_password`
  sont protégés par `requireAdmin` et échoueront avec une clé restreinte. C'est le
  comportement attendu du système, mais cela implique de choisir entre portée et restriction plutôt que
  d'avoir les deux.

Une clé d'API avec `admin: true` fonctionne différemment : elle porte les rôles
`["admin", "service"]`, ce qui valide les mêmes politiques d'administration par défaut que la
clé de service. Sur le plan des données, sa portée est identique à celle de la clé de service. Ce qu'elle apporte de plus, c'est qu'elle est
**révocable, expirante et soumise à une limitation de débit par clé**, rien de tout cela n'étant vrai
pour la clé de service — renouveler cette dernière nécessite d'éditer `.env` et de redémarrer le serveur.

Consultez [Agents and MCP Servers](/docs/backend/api-keys#agents-and-mcp-servers) pour le guide complet
sur la restriction des clés.

### Rendre une collection totalement inaccessible

La raison pour laquelle un identifiant administrateur peut tout lire réside dans la politique de base que Rebase
injecte dans chaque collection, accordant l'accès au contexte de serveur approuvé et au
rôle `admin`. Une collection peut désactiver cette politique de base et prendre l'entière
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

Désormais, le seul moyen d'accès est de correspondre à `patient_id`. L'uid de la clé de service étant la
chaîne littérale `service`, une règle de propriétaire ne lui correspond jamais — les lectures renvoient zéro
ligne et les écritures sont rejetées par Postgres. Il s'agit du seul contrôle qui restreint
l'identifiant par défaut du serveur MCP plutôt que de l'ignorer.

Gardez à l'esprit qu'il s'agit d'une réelle modification du RLS, pas simplement d'un élément de documentation : elle
ne prend effet qu'une fois que `rebase schema generate` et une migration ont appliqué les politiques. Voir
[Security Rules (RLS)](/docs/collections/security-rules).

## La barrière de bouclage

`rebase_project_add` accepte n'importe quelle `baseUrl`, et les outils CLI se connectent avec
la variable `DATABASE_URL` déclarée par le projet. La même liste d'outils qui modifie une
base de données temporaire sur votre machine portable peut par conséquent supprimer des lignes en production, sans
autre intermédiaire que le jugement de l'assistant quant au projet actif.

**Tout outil qui modifie l'environnement cible est refusé, sauf si cette cible se trouve sur
l'interface de bouclage (loopback).** La barrière est conçue sous la forme d'une liste de ce qui n'est *pas*
filtré, de sorte qu'un outil ajouté ultérieurement arrive protégé par défaut.

- **Non filtré — lectures :** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Non filtré — local uniquement :** `rebase_schema_introspect`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, les outils du serveur de développement et ceux du registre de projet.
  Ceux-ci écrivent des fichiers locaux ou un état local et n'ont aucune cible distante à vérifier.
- **Filtré via `DATABASE_URL` :** les outils CLI restants — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Filtré via l'`baseUrl` du projet :** les outils SDK restants —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Les deux cibles ne sont pas interchangeables. Les outils CLI ne voient jamais `baseUrl`, donc un
backend localhost associé à une `DATABASE_URL` de production est vérifié par rapport à
la base de données, et non au backend.

Un refus se présente ainsi :

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si aucune chaîne de connexion ne peut être résolue, les outils de base de données sont refusés** —
une cible invérifiable n'est pas sécurisée :

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Seule l'interface de bouclage est considérée comme locale : `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Les plages privées telles que `10.x` et `192.168.x` ne le sont **pas** — elles sont tout aussi susceptibles d'être
un cluster de staging partagé qu'un ordinateur portable, et les considérer comme locales autoriserait
précisément l'accident que cette barrière vise à empêcher.

Définissez `REBASE_MCP_ALLOW_REMOTE_WRITES=true` pour désactiver ce comportement. Le définir globalement dans
votre configuration de client MCP supprime la barrière pour tous les projets auxquels le serveur peut accéder,
pas seulement celui auquel vous pensiez.

## Marquage des données non fiables

Les lignes, les enregistrements utilisateurs, les listes de stockage, les tâches cron, les réponses de fonctions et les
sorties CLI reviennent encapsulés dans une enveloppe explicite :

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Tout ce qui est stocké dans votre base de données a été écrit par quelqu'un et arrive sur
le même canal que le contrat d'outil suivi par l'assistant. L'enveloppe indique
au modèle de le traiter comme du contenu inerte plutôt que comme des instructions.

Il s'agit d'un marqueur, pas d'un bac à sable (sandbox). Un assistant disposant de ces outils n'est sûr
qu'à hauteur de la sécurité du contenu que vous lui permettez de lire.

## Projets multiples

Les configurations de projet sont stockées dans `~/.rebase/projects.json`, et le serveur
peut en gérer plusieurs à la fois — très utile lorsque vous travaillez entre des environnements
locaux et distants. Pendant que `rebase dev` tourne, le serveur lit le port actif et
la clé de service depuis `.rebase/state.json` dans le répertoire du projet, ce qui
rend le cas local sans configuration.

:::note[Le registre a le dernier mot, pas le premier]
L'ordre de priorité est celui décrit précédemment : le bloc d'environnement, puis le répertoire de travail
s'il contient un fichier `rebase.json`, puis le projet `default` persistant.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` et `REBASE_API_TOKEN` reconstruisent le
projet `default` **à chaque démarrage**, et pas seulement au premier. La reconstruction
s'applique à l'entrée complète : un jeton enregistré pour l'ancien `projectDir` est abandonné plutôt
que reporté sur un répertoire pour lequel il n'a jamais été émis. Un projet `default` obtenu de cette
manière — ou à partir du répertoire de travail — n'est jamais réécrit dans
`~/.rebase/projects.json`, évitant ainsi que la clé de service de dev d'un projet ne devienne
celle d'un autre.

`activeProject` est persistant, donc si une session précédente a appelé
`rebase_project_switch`, les outils ciblent ce projet et le serveur l'indique sur
stderr — à moins que ce projet ne soit enregistré sous un répertoire *différent* de
celui dans lequel ce serveur s'exécute, auquel cas il revient à `default` et le
signale. Si un assistant semble lire la mauvaise base de données, appelez
d'abord `rebase_project_current`.
:::

Les jetons sont stockés dans ce registre **en texte brut**. Il s'agit d'un fichier dans votre
répertoire personnel qui contient des identifiants administrateur pour chaque projet que vous avez enregistré ;
traitez-le en conséquence.

## Référence des outils

42 outils, répartis en neuf groupes. Les outils marqués d'un ⚠ sont refusés sur les cibles non locales,
sauf dérogation de votre part.

### Schéma et base de données (12)

Lance le CLI Rebase dans le répertoire du projet actif.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_generate` | — | Générer le schéma Drizzle à partir des définitions de collections |
| `rebase_db_push` ⚠ | — | Appliquer le schéma directement à la base de données (raccourci de développement) |
| `rebase_schema_introspect` | — | Introspecter la base de données active pour générer les définitions de collections |
| `rebase_db_generate` | — | Générer des fichiers de migration SQL à partir des modifications de schéma |
| `rebase_db_migrate` ⚠ | — | Exécuter toutes les migrations SQL en attente |
| `rebase_generate_sdk` | — | Générer le SDK TypeScript entièrement typé |
| `rebase_doctor` | — | Détecter les dérives entre les définitions, le schéma généré et la base de données active |
| `rebase_db_branch_create` ⚠ | `name` | Créer une branche de base de données (administrateurs uniquement) |
| `rebase_db_branch_list` | — | Lister les branches de base de données (administrateurs uniquement) |
| `rebase_db_branch_delete` ⚠ | `name` | Supprimer une branche de base de données (administrateurs uniquement) |
| `rebase_db_branch_info` | `name` | Informations et état de la branche (administrateurs uniquement) |
| `rebase_db_branch_switch` | — | Pointer ce checkout vers une branche, ou revenir à la base principale (administrateurs uniquement) |

### Planification de schéma (1)

Demande au backend ce qu'impliquerait une modification, via `POST /api/admin/schema/plan`. Aucun
CLI ni écriture sur le disque — cela fonctionne sur la base de données de développement managée,
ce que les commandes basées sur Atlas ne peuvent pas faire.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | Le SQL que la modification d'une collection exécuterait, et quelles instructions détruisent des données |

### Documents (5)

| Outil | Requis | Description |
|---|---|---|
| `list_documents` | `collection` | Lister les lignes, avec options `limit`, `offset`, `orderBy`, `where` |
| `get_document` | `collection`, `id` | Récupérer une ligne unique par son ID |
| `create_document` ⚠ | `collection`, `data` | Créer une ligne |
| `update_document` ⚠ | `collection`, `id`, `data` | Mettre à jour une ligne |
| `delete_document` ⚠ | `collection`, `id` | Supprimer une ligne |

### Utilisateurs et rôles (6)

| Outil | Requis | Description |
|---|---|---|
| `list_users` | — | Lister tous les utilisateurs, rôles inclus |
| `create_user` ⚠ | `email` | Créer un utilisateur (optionnels `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | Mettre à jour l'e-mail, le nom d'affichage ou les rôles |
| `delete_user` ⚠ | `uid` | Supprimer un utilisateur |
| `list_roles` | — | Lister les rôles définis |
| `rebase_auth_reset_password` ⚠ | `email` | Réinitialiser un mot de passe via l'API d'administration |

`create_user` et `update_user` acceptent tous deux `roles`, de sorte que chacun peut créer un
administrateur. C'est la raison pour laquelle ils sont filtrés plutôt que simplement considérés comme « additifs ».

### Stockage (3)

| Outil | Requis | Description |
|---|---|---|
| `storage_list_objects` | — | Lister les objets stockés |
| `storage_get_download_url` | `key` | Une URL de téléchargement signée temporaire et son expiration — pas les métadonnées de l'objet |
| `storage_delete_object` ⚠ | `key` | Supprimer un objet |

`storage_get_download_url` est classé comme une lecture car il ne modifie pas
l'environnement — mais l'URL signée générée confère un droit d'accès porteur (bearer capability) qui subsiste
au-delà de l'appel d'outil.

### Cron (5)

| Outil | Requis | Description |
|---|---|---|
| `cron_list_jobs` | — | Lister les tâches planifiées et leur état |
| `cron_get_job` | `jobId` | Détails d'une tâche |
| `cron_get_job_logs` | `jobId` | Journaux d'exécution |
| `cron_trigger_job` ⚠ | `jobId` | Exécuter une tâche immédiatement |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Activer ou désactiver une tâche |

`cron_toggle_job` peut désactiver silencieusement une tâche de sauvegarde ou de facturation — un changement
sans erreur ni message de sortie jusqu'à ce qu'un manque se fasse sentir plus tard.

### Fonctions (1)

| Outil | Requis | Description |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoquer une [fonction personnalisée](/docs/backend/custom-functions) avec la méthode et la charge utile (payload) de votre choix |

Cela appelle du code que le serveur MCP n'a jamais vu, avec une méthode et un corps
choisis par le modèle. Son rayon d'impact correspond à tout ce que vos fonctions réalisent.

### Serveur de développement (3)

| Outil | Requis | Description |
|---|---|---|
| `rebase_dev_start` | — | Démarrer le serveur de développement ; répond immédiatement |
| `rebase_dev_logs` | — | Lire la sortie récente (50 lignes par défaut, tampon de 500 lignes) |
| `rebase_dev_stop` | — | Arrêter le serveur de développement |

### Registre de projet (6)

| Outil | Requis | Description |
|---|---|---|
| `rebase_project_list` | — | Lister les projets enregistrés et afficher le projet actif |
| `rebase_project_switch` | `name` | Changer de projet actif |
| `rebase_project_add` | `name` | Enregistrer un projet (`baseUrl`, optionnels `projectDir`, `token`) |
| `rebase_project_remove` | `name` | Supprimer un projet (le projet par défaut ne peut pas être supprimé) |
| `rebase_project_current` | — | Afficher le projet actif et son statut d'authentification |
| `rebase_project_status` | — | Vérifier la santé du backend actif |

`rebase_project_switch` n'est pas filtré, car il réoriente tout le reste plutôt
que d'agir directement sur une cible. Un assistant peut donc basculer vers un
projet distant sans déclencher la barrière de sécurité — il ne pourra simplement pas y exécuter d'outil
destructeur par la suite.

## Ressources

Au-delà des outils, le serveur expose des ressources MCP permettant à un client de récupérer
le contexte du projet sans consommer un appel d'outil :

| URI | Description |
|---|---|
| `rebase://collections/{name}` | Code source TypeScript d'une définition de collection |
| `rebase://schema` | Le schéma Drizzle généré (`schema.generated.ts`) |

Les collections sont découvertes à partir de `app/config/collections/`,
`config/collections/` ou `collections/` dans le répertoire du projet actif —
selon le dossier existant.

`rebase://schema` n'est listé **que si** le schéma généré existe.
`findBackendDir` recherche `backend/` puis `app/backend/` sous le répertoire du
projet actif, et lit `src/schema.generated.ts` dans celui qu'il trouve —
ainsi, la structure générée tout comme celle de ce monorepo fonctionnent, tandis qu'un projet structuré
différemment ou n'ayant pas encore exécuté `rebase schema generate` ne verra tout simplement pas la ressource proposée.

## Le point de terminaison distant

Tout ce qui précède est un outil pour développeur : il s'exécute sur votre machine et détient une clé
de service ou une clé d'API. Un backend déployé peut également servir lui-même MCP, sur `/mcp`, pour
les personnes qui utilisent votre application. Un assistant connecté par l'une d'elles lit et
écrit dans le projet **en tant que cette personne**, et chaque appel s'exécute sous sa propre
sécurité au niveau des lignes (RLS).

Il est désactivé par défaut, et les deux variables sont obligatoires :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, un secret JWT ou un pilote de données capable de restreindre une requête
à un utilisateur, le point de terminaison refuse de se monter et en explique la raison dans le journal de démarrage. Aucun
`REBASE_ROLE` ne l'active.

- **OAuth, avec un écran de consentement.** Un client trouve le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre lui-même (l'enregistrement
  dynamique est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le restreint
  aux clients que vous enregistrez), et redirige l'utilisateur vers un écran de consentement qui le
  connecte via votre `/auth/login` existant.
- **Six outils, deux portées (scopes).** `mcp:read` offre `list_collections`,
  `query_collection` et `get_document` ; `mcp:write` ajoute `create_document`,
  `update_document` et `delete_document`. Une portée détermine les outils proposés,
  pas les lignes accessibles : une liste vide peut simplement signifier que le RLS fait son travail, et `mcp:write` ne pourra
  toujours pas écrire une ligne que l'utilisateur n'aurait pas le droit d'écrire.
- **Un jeton réservé à ce point de terminaison.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket, de sorte que connecter un assistant ne
  lui transmet pas de session.

Deux limites. La déconnexion d'un client (`DELETE /api/oauth/grants/:clientId`, avec la
propre session de l'utilisateur) révoque immédiatement ses jetons de rafraîchissement, mais un jeton d'accès
déjà émis continue de fonctionner jusqu'à son expiration, dans l'heure qui suit. De plus, les rôles
associés à une autorisation sont ceux que l'utilisateur possédait au moment du consentement. Une modification de rôle ne
lui est pas répercutée : un client qui continue de se rafraîchir conserve ces rôles jusqu'à ce que l'utilisateur
le déconnecte.

Les routes sont détaillées dans [Endpoints](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).

## Configuration recommandée

- Pointez le serveur vers un projet **local** et laissez `REBASE_MCP_ALLOW_REMOTE_WRITES`
  non défini. Cette barrière de protection est l'élément le plus précieux du paquet.
- Pour tout environnement distant, enregistrez une **clé d'API `rk_` restreinte** plutôt que de laisser
  la détection automatique fournir une clé de service.
- Vérifiez `rebase_project_current` lorsque la sortie semble incorrecte. Le projet actif est
  persistant et réside en dehors de votre dépôt.
- Considérez `~/.rebase/projects.json` comme un fichier de secrets sensibles.

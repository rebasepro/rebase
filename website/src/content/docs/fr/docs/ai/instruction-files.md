---
sourceHash: eaad69efe348f395
title: Fichiers d'instructions pour l'IA
sidebar_label: Fichiers d'instructions pour l'IA
description: Chaque projet Rebase généré fournit ai-instructions.md ainsi que des fichiers pointeurs pour Claude, Cursor, Windsurf, Copilot et AGENTS.md qui intègrent les cinq règles que les assistants enfreignent le plus — une source unique de vérité, plusieurs noms de fichiers.
---

Chaque assistant souhaite avoir ses règles dans un fichier différent. Claude Code lit
`CLAUDE.md`, Cursor lit `.cursorrules`, Windsurf lit `.windsurfrules`,
Copilot lit `.github/copilot-instructions.md`, et la convention multi-fournisseurs
est `AGENTS.md`. Maintenir les mêmes directives dans cinq fichiers est le meilleur moyen
que quatre d'entre eux deviennent obsolètes.

`rebase init` écrit les cinq — en tant que **pointeurs vers un fichier unique que vous éditez réellement** :

```text
your-project/
├── ai-instructions.md            ← the real content
├── CLAUDE.md                     ← pointer
├── AGENTS.md                     ← pointer
├── .cursorrules                  ← pointer
├── .windsurfrules                ← pointer
└── .github/
    └── copilot-instructions.md   ← pointer
```

Chaque fichier pointeur nomme le véritable fichier, indique où se trouvent les compétences (skills) et contient les cinq règles qu'un assistant ne doit pas enfreindre, même s'il n'ouvre jamais rien d'autre :

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a file in `backend/schema/`.** Declare it with `defineTable` from `@rebasepro/server/schema` — columns, relations and a required `rls` — export it from `backend/schema/index.ts`, and `pnpm dev` creates it. How it looks in the admin panel is a separate, optional file: `frontend/src/cms/<table>.tsx` with `customizeTable`, which imports the table as a type only. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and hooks, so keep it for server work that needs every row and for reading a column marked `.private()`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its file from `pnpm schema:introspect`. With no `backend/schema/` (a headless project) the database is the schema instead: ai-instructions.md says how to serve a table.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<table>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`). In `.env`, change only a local setting the task needs (`AUTH_MAGIC_LINK`, `FRONTEND_URL`, `REBASE_FUNCTIONS_TIMEOUT_MS` and the like), one line at a time, and say which; never rewrite, print or rotate its secrets (`DATABASE_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`).
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see.
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Les autres ne diffèrent que par le répertoire des compétences de l'agent et la valeur de son `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — ainsi que par
le chemin relatif, qui est `../ai-instructions.md` dans
`.github/copilot-instructions.md` et `ai-instructions.md` dans `AGENTS.md`. La
troisième ligne est conditionnelle car `rebase init --agent` peut déjà avoir
installé les compétences avant même que l'assistant ne la lise.

Cela se produit à chaque `rebase init`, pour chaque préréglage, y compris `--headless`.
Il n'y a aucun drapeau (flag) ni aucune invite de commande.

`rebase init` écrit également `.mcp.json`, qui oriente Claude Code, Cursor et
tout autre client MCP vers le [serveur MCP Rebase](/docs/ai/mcp) — la propre copie
du projet, une devDependency épinglée avec la CLI (`npx --no rebase-mcp` dans un projet
npm) :

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

`REBASE_PROJECT_DIR` est `"."`, et non un chemin absolu : le client lance le serveur
à la racine du projet, et un chemin absolu est la seule ligne de ce fichier qui
ne peut pas être commitée. Elle est présente car `~/.rebase/projects.json` s'applique
à l'ensemble de la machine — un projet qui n'indique pas son propre répertoire se rabat sur
ce que le dernier projet sur cette machine a persisté. Voir
[l'ordre de priorité](/docs/ai/mcp#which-directory-it-acts-on).

## Pourquoi un pointeur plutôt qu'une copie

Les fichiers pointeurs ne contiennent presque rien. Un fichier qui désigne le vrai fichier
conserve les conventions au même endroit, et présente des propriétés qu'une copie n'a pas :

- **Un seul fichier à modifier.** Les règles ne peuvent pas diverger entre les assistants,
  car il n'y a qu'un seul jeu de règles.
- **Un seul diff à relire.** Une modification des conventions du projet correspond à la modification d'un seul
  fichier, et non de cinq fichiers identiques qu'un relecteur doit comparer.
- **Ajouter un assistant ne nécessite qu'un petit fichier.** Un nouvel outil avec un nouveau nom de fichier reçoit
  un pointeur, et non une sixième copie de vos conventions.

La seule exception est le bloc **Before you write any code**. Un assistant ne suit
pas toujours un lien de manière fiable : un assistant occupé par une tâche écrit d'abord le code,
et un autre démarré à la racine d'un dépôt dont le projet Rebase se trouve dans un
sous-dossier ne chargera jamais ces fichiers. Ainsi, les cinq règles dont l'infraction cause
le plus de dégâts (une table créée en SQL au lieu de `backend/schema`, des données lues et
écrites en contournant le SDK, une route non protégée, un déploiement, l'édition d'un fichier généré)
sont inscrites de manière identique dans chaque pointeur. Une vérification dans la CI garantit que les cinq
copies restent identiques.

Ce modèle vaut la peine d'être conservé si vous forkez le template de base, et mérite d'être adopté dans
des dépôts qui ne sont pas du tout des projets Rebase.

## Ce que contient `ai-instructions.md` au départ

Le fichier généré est délibérément court — il renvoie vers
[`rebase skills install`](/docs/ai/skills) pour approfondir, puis énonce les règles que
les assistants comprennent mal assez souvent pour mériter d'être répétées au début de chaque
session :

1. **Le schéma en tant que code.** Une table est un `defineTable` dans `backend/schema/<table>.ts`,
   exportée depuis `backend/schema/index.ts` — seul ce que l'index exporte est
   exposé — avec une `rls` obligatoire. Ne modifiez jamais manuellement le schéma Drizzle généré
   ni les tables Postgres — voir [Le schéma en tant que code](/docs/architecture/schema-as-code).
2. **L'application d'une modification de schéma** dépend de la base de données. Pendant que `pnpm dev`
   est en cours d'exécution, enregistrer un fichier dans `backend/schema/` constitue l'étape complète : cela
   régénère le schéma Drizzle et les types du SDK, et le démarrage crée les
   tables et colonnes manquantes. `pnpm db:push` ne sert qu'à ce que le démarrage laisse
   délibérément de côté — une colonne renommée, un type restreint, une colonne supprimée — sur la
   base de données de développement gérée tout comme sur votre propre PostgreSQL. La production s'effectue avec
   `pnpm db:generate` puis `pnpm db:migrate`.
3. **Utilisez le SDK.** Passez par `rebase.dataAsAdmin.<table>` pour les tâches effectuées en tant
   qu'identité de service, ou par `getDriver(c)` à l'intérieur d'une fonction lorsque la lecture doit s'exécuter
   en tant qu'appelant. Le client serveur ne dispose pas d'un simple accesseur `data`. Le SQL brut et les appels
   Drizzle directs contournent la validation, les hooks et la RLS.
4. **Protégez chaque route personnalisée.** Les routes dans `backend/functions/` sont montées
   *sans* authentification. Utilisez `requireAuth` / `requireAdmin` depuis
   `@rebasepro/server/functions` dans l'emplacement middleware propre à la route — lire
   `c.get("user")` n'est pas une protection, tout comme `app.use()` placé après la route.

Cette dernière règle est celle qu'il faut retenir. C'est la différence entre un middleware qui
s'exécute et un autre qui ne s'exécute pas, et un assistant à qui on ne l'a pas précisé
écrira systématiquement la version qui ne s'exécute pas — voir
[Fonctions personnalisées](/docs/backend/custom-functions).

`requireAdmin` n'autorise que le rôle `admin`. Lorsqu'un rôle plus restreint ou une clé d'API
doit pouvoir appeler une route, la protection à ajouter est `requireScope`, avec une portée (scope)
que l'application déclare — voir [Rôles et portées](/docs/backend/roles-and-scopes/#app-scopes).

Après les règles figurent deux sections qui ne s'appliquent qu'à certains projets. **Backend
runtime** liste ce que le runtime géré sur Rebase Cloud autorise : paquets,
mémoire et état au niveau du module, délais d'expiration (timeouts), ports sortants, configuration et
stockage pour les fichiers générés. Il renvoie vers
[Runtime backend géré](/docs/deployment/managed-runtime/), afin qu'un assistant
planifie une fonctionnalité backend en tenant compte des limites réelles au lieu de deviner. **Admin UI**
contient les règles de `@rebasepro/ui`. Elles s'appliquent aux vues à l'intérieur du panneau d'administration, et non
à un site public ou à une application statique desservis par le projet.

## Personnalisation

`ai-instructions.md` est votre fichier. Rien ne le régénère ni ne l'écrase — contrairement aux
[compétences installées](/docs/ai/skills), qui sont remplacées à chaque
`rebase skills install`. Les conventions spécifiques au projet ont leur place ici.

Ce qui y a sa place correspond à ce qu'un assistant ne peut pas déduire du code : quelles
tables sont historiques (legacy), quel service possède quelle table, la convention de nommage
qui n'est imposée nulle part, la migration qui ne doit pas être réexécutée. Gardez-le
court — les instructions chargées dans chaque requête rivalisent d'attention avec la tâche
réelle, et un fichier trop long sera seulement survolé par un assistant.

Et gardez la limite à l'esprit : ce fichier détermine ce qu'un assistant *écrit*. Il
n'a aucun impact sur ce qu'un agent connecté à votre base de données peut *faire* — cela est
déterminé par les identifiants qu'il détient, et rien dans le Markdown n'y changera quoi que ce soit. Voir
[le modèle d'identifiants du serveur MCP](/docs/ai/mcp#what-the-server-can-reach).

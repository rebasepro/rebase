---
sourceHash: 4a5c6ecfb9f66fd3
title: Fichiers d'instructions pour l'IA
sidebar_label: Fichiers d'instructions pour l'IA
description: Chaque projet Rebase initialisé inclut ai-instructions.md ainsi que des fichiers pointeurs pour Claude, Cursor, Windsurf, Copilot et AGENTS.md contenant les cinq règles que les assistants enfreignent le plus — une source unique de vérité, plusieurs noms de fichiers.
---

Chaque assistant requiert ses règles dans un fichier différent. Claude Code lit
`CLAUDE.md`, Cursor lit `.cursorrules`, Windsurf lit `.windsurfrules`,
Copilot lit `.github/copilot-instructions.md`, et la convention inter-fournisseurs
est `AGENTS.md`. Maintenir les mêmes directives dans cinq fichiers est le meilleur moyen pour que quatre d'entre eux
deviennent obsolètes.

`rebase init` génère les cinq — sous forme de **pointeurs vers un fichier unique que vous
éditez réellement** :

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

Chaque fichier pointeur désigne le fichier réel, indique où se trouvent les skills et contient les cinq règles qu'un assistant ne doit pas enfreindre, même s'il n'ouvre jamais rien d'autre :

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
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see. The admin derived from the tables is a draft: before calling an admin done, give every table it shows a `customizeTable` pass (a title, its columns, ids and raw JSON hidden, labels; ai-instructions.md, "Admin UI", has the checklist).
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Les autres ne diffèrent que par le répertoire de skills de l'agent et sa valeur `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — ainsi que par
le chemin relatif, qui est `../ai-instructions.md` dans
`.github/copilot-instructions.md` et `ai-instructions.md` dans `AGENTS.md`. La
troisième ligne est conditionnelle car `rebase init --agent` a peut-être déjà
installé les skills avant même que l'assistant ne les lise.

Cela se produit à chaque `rebase init`, pour chaque préréglage, y compris `--headless`.
Il n'y a aucun flag ni aucune invite de commande.

`rebase init` écrit également `.mcp.json`, qui oriente Claude Code, Cursor et
tout autre client MCP vers le [serveur MCP Rebase](/docs/ai/mcp) — la propre copie
du projet, une devDependency épinglée avec la CLI (`npx --no rebase-mcp` dans un
projet npm) :

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

`REBASE_PROJECT_DIR` vaut `"."`, et non un chemin absolu : le client lance le serveur
à la racine du projet, et un chemin absolu est la seule ligne de ce fichier qui
ne peut pas être commitée. Elle est présente car `~/.rebase/projects.json` est
globale à la machine — un projet qui n'indique aucun répertoire qui lui est propre se rabat sur
ce que le dernier projet sur cette machine a persisté. Consultez
[l'ordre de priorité](/docs/ai/mcp#which-directory-it-acts-on).

## Pourquoi un pointeur plutôt qu'une copie

Les fichiers pointeurs ne contiennent presque rien. Un fichier qui désigne le vrai fichier conserve les
conventions au même endroit et présente des caractéristiques qu'une copie n'a pas :

- **Un seul fichier à éditer.** Les règles ne peuvent pas diverger d'un assistant à l'autre, car il
  n'existe qu'un seul ensemble de règles.
- **Un seul diff à relire.** Une modification des conventions du projet correspond à la modification d'un seul
  fichier, et non de cinq fichiers identiques qu'un relecteur doit comparer.
- **L'ajout d'un assistant se résume à un petit fichier.** Un nouvel outil avec un nouveau nom de fichier reçoit
  un pointeur, et non une sixième copie de vos conventions.

La seule exception est le bloc **Before you write any code**. Un assistant ne
suit pas les liens de manière fiable : un assistant occupé par une tâche écrit d'abord le code,
et un assistant lancé à la racine d'un dépôt dont le projet Rebase réside dans un
sous-dossier ne charge jamais ces fichiers. Ainsi, les cinq règles dont la violation cause
le plus de dégâts (une table créée en SQL au lieu de `backend/schema`, des données lues et
écrites en contournant le SDK, une route non protégée, un déploiement, la modification d'un fichier généré)
sont inscrites à l'identique dans chaque pointeur. Une vérification en CI garantit
que les cinq copies restent strictement les mêmes.

Ce modèle vaut la peine d'être conservé si vous forkez le squelette (scaffold), et mérite d'être adopté dans
des dépôts qui ne sont pas du tout des projets Rebase.

## Par quoi commence `ai-instructions.md`

Le fichier généré est délibérément court — il renvoie à
[`rebase skills install`](/docs/ai/skills) pour plus de détails, puis énonce les règles que les
assistants enfreignent suffisamment souvent pour mériter d'être répétées au début de chaque
session :

1. **Schema as code.** Une table est un `defineTable` dans `backend/schema/<table>.ts`,
   exporté depuis `backend/schema/index.ts` — seul ce qui est exporté par l'index est
   exposé — avec une configuration `rls` obligatoire. Ne modifiez jamais manuellement le schéma Drizzle généré
   ni les tables Postgres — voir [Schema as Code](/docs/architecture/schema-as-code).
2. **Appliquer une modification de schéma** dépend de la base de données. Pendant que `pnpm dev`
   tourne, sauvegarder un fichier dans `backend/schema/` suffit amplement : cela
   régénère le schéma Drizzle et les types du SDK, et le démarrage crée les
   tables et colonnes manquantes. `pnpm db:push` ne sert que pour ce que le démarrage laisse délibérément
   de côté — une colonne renommée, un type restreint, une colonne supprimée — sur la
   base de données de développement gérée comme sur votre propre PostgreSQL. La production utilise
   `pnpm db:generate` puis `pnpm db:migrate`.
3. **Utilisez le SDK.** Passez par `rebase.dataAsAdmin.<table>` pour les tâches exécutées sous
   l'identité de service, ou par `getDriver(c)` à l'intérieur d'une fonction lorsque la lecture doit s'exécuter
   en tant qu'appelant. Le client serveur n'a pas d'accesseur `data` direct. Le SQL brut et les appels directs à
   Drizzle contournent la validation, les hooks et la RLS.
4. **Protégez chaque route personnalisée.** Les routes dans `backend/functions/` sont montées
   *sans* authentification. Utilisez `requireAuth` / `requireAdmin` depuis
   `@rebasepro/server/functions` dans l'emplacement de middleware propre à la route — la lecture de
   `c.get("user")` ne constitue pas une protection, pas plus que `app.use()` placé après la route.

Cette dernière règle est capitale. C'est la différence entre un middleware qui
s'exécute et un autre qui ne s'exécute pas, et un assistant qui n'a pas été prévenu
écrira immanquablement la version qui ne s'exécute pas — voir
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` n'admet que le rôle `admin`. Lorsqu'un rôle plus restreint ou une clé API
doit pouvoir appeler une route, la protection à ajouter est `requireScope`, avec un scope
déclaré par l'application — voir [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Après les règles viennent deux sections qui ne s'appliquent qu'à certains projets. **Backend
runtime** énumère ce que le runtime managé sur Rebase Cloud autorise : packages,
mémoire et état au niveau du module, timeouts, ports sortants, configuration et
stockage pour les fichiers générés. Elle renvoie à
[Managed backend runtime](/docs/deployment/managed-runtime/), afin qu'un assistant
conçoive une fonctionnalité backend en tenant compte des limites réelles plutôt qu'en devinant. **Admin UI**
contient les règles de `@rebasepro/ui`, ainsi que la checklist pour la passe `customizeTable`
dont chaque table a besoin avant qu'une interface d'administration ne soit considérée comme terminée : un titre, les colonnes qu'elle affiche, le masquage des identifiants,
des clés étrangères et du JSON brut, les libellés, un résumé pour les colonnes JSON, et une vérification
de l'interface en cours d'exécution. Les règles s'appliquent aux vues à l'intérieur du panneau d'administration, et non à un
site public ou une application statique servis par le projet.

## Vous l'approprier

`ai-instructions.md` est votre fichier. Rien ne le régénère ni ne l'écrase — contrairement aux
[skills installés](/docs/ai/skills), qui sont remplacés à chaque
`rebase skills install`. C'est ici que doivent figurer les conventions spécifiques à votre projet.

Une exception concerne un fichier auquel personne n'a touché : l'`ai-instructions.md` d'un
projet headless indique que la base de données constitue le schéma et qu'il n'y a pas de
`backend/schema/`, et `rebase schema introspect` crée précisément ce
répertoire. Lorsque le fichier est encore à l'octet près celui généré par le scaffold,
l'introspection le remplace par les règles de schéma-dans-le-code réservées au backend ; dès lors que vous
l'avez modifié, il reste inchangé et la commande indique lesquelles de ses règles ne
s'appliquent plus.

Ce qui y a sa place, c'est ce qu'un assistant ne peut pas déduire du code : quelles
tables sont obsolètes, quel service est propriétaire de telle table, la convention de nommage
qui n'est appliquée nulle part, la migration qui ne doit surtout pas être réexécutée. Restez
concis — les instructions chargées dans chaque requête entrent en concurrence avec la tâche réelle pour
mobiliser l'attention, et un fichier trop long risque d'être simplement survolé par un assistant.

Et gardez à l'esprit la limite : ce fichier influence ce qu'un assistant *écrit*. Il
n'a aucun impact sur ce qu'un agent connecté à votre base de données peut *faire* — cela est
déterminé par les identifiants dont il dispose, et rien dans le Markdown n'y changera quoi que ce soit. Consultez
[le modèle d'authentification du serveur MCP](/docs/ai/mcp#what-the-server-can-reach).

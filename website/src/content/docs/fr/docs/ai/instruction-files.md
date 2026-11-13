---
sourceHash: 80e40ea5912a48c8
title: Fichiers d'instructions pour l'IA
sidebar_label: Fichiers d'instructions pour l'IA
description: Chaque projet Rebase généré inclut ai-instructions.md ainsi que des fichiers pointeurs pour Claude, Cursor, Windsurf, Copilot et AGENTS.md reprenant les cinq règles les plus enfreintes par les assistants — une source unique de vérité, plusieurs noms de fichiers.
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque assistant attend ses règles dans un fichier différent. Claude Code lit
`CLAUDE.md`, Cursor lit `.cursorrules`, Windsurf lit `.windsurfrules`,
Copilot lit `.github/copilot-instructions.md`, et la convention inter-fournisseurs
est `AGENTS.md`. Maintenir les mêmes instructions dans cinq fichiers différents
est le meilleur moyen d'en voir quatre devenir obsolètes.

`rebase init` écrit ces cinq fichiers — sous forme de **pointeurs vers un fichier
unique que vous modifiez réellement** :

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

Chaque fichier pointeur nomme le véritable fichier, indique où se trouvent les skills et contient les cinq règles qu'un assistant ne doit enfreindre sous aucun prétexte, même s'il n'ouvre jamais rien d'autre :

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a file in `backend/schema/`.** Declare it with `defineTable` from `@rebasepro/server/schema` — columns, relations and a required `rls` — export it from `backend/schema/index.ts`, and `pnpm dev` creates it. How it looks in the admin panel is a separate, optional file: `frontend/src/cms/<table>.tsx` with `customizeTable`, which imports the table as a type only. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and hooks, so keep it for server work that needs every row and for reading a column marked `.private()`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its file from `pnpm schema:introspect`. With no `backend/schema/` (a headless project) the database is the schema instead: ai-instructions.md says how to serve a table.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<table>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit `.env`, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`).
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Les autres ne diffèrent que par le répertoire des skills de l'agent et sa valeur
`--agent` — `--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` —
ainsi que par le chemin relatif, qui est `../ai-instructions.md` dans
`.github/copilot-instructions.md` et `ai-instructions.md` dans `AGENTS.md`. La
troisième ligne est conditionnelle car `rebase init --agent` a pu installer les
skills avant même que l'assistant ne la lise.

Cela se produit à chaque `rebase init`, pour tous les presets y compris `--headless`.
Il n'y a aucun flag ni invite de commande.

`rebase init` génère également `.mcp.json`, qui pointe Claude Code, Cursor et
tout autre client MCP vers le [serveur MCP Rebase](/docs/ai/mcp) — la copie propre
au projet, une devDependency épinglée avec le CLI (`npx --no rebase-mcp` dans un
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

`REBASE_PROJECT_DIR` vaut `"."`, et non un chemin absolu : le client lance le
serveur à la racine du projet, et un chemin absolu est la seule ligne de ce
fichier qui ne peut pas être commitée. Cela s'explique par le fait que
`~/.rebase/projects.json` est commun à l'ensemble de la machine — un projet qui
n'indique pas son propre répertoire se rabat sur ce que le dernier projet sur
cette machine a persisté. Voir
[l'ordre de priorité](/docs/ai/mcp#which-directory-it-acts-on).

## Pourquoi un pointeur plutôt qu'une copie

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les fichiers pointeurs ne contiennent presque rien. Un fichier qui référence le
véritable document conserve les conventions en un seul endroit, et présente des
avantages qu'une copie n'a pas :

- **Un seul fichier à modifier.** Les règles ne peuvent pas diverger entre les
  assistants, car il n'existe qu'un unique jeu de règles.
- **Un seul diff à relire.** Une modification des conventions du projet
  correspond à un changement dans un seul fichier, et non dans cinq fichiers
  identiques qu'un relecteur doit comparer.
- **Ajouter un assistant ne demande qu'un petit fichier.** Un nouvel outil avec
  un nouveau nom de fichier reçoit un pointeur, et non une sixième copie de vos
  conventions.

La seule exception est le bloc **Before you write any code**. Un assistant ne suit
pas les liens de manière systématique : absorbé par une tâche, il écrit d'abord
le code, et un assistant lancé à la racine d'un dépôt dont le projet Rebase se
trouve dans un sous-dossier ne charge jamais ces fichiers. Ainsi, les cinq
règles dont l'infraction cause le plus de dégâts (une table créée en SQL plutôt
que dans `backend/schema`, des données lues et écrites sans passer par le SDK,
une route non protégée, un déploiement, la modification d'un fichier généré)
sont inscrites à l'identique dans chaque pointeur. Une vérification en CI
garantit que les cinq copies restent synchronisées.

Ce modèle mérite d'être conservé si vous forkez le scaffolding, et mérite
d'être adopté dans des dépôts qui ne sont pas du tout des projets Rebase.

## Le contenu initial de `ai-instructions.md`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le fichier généré est délibérément court — il renvoie à
[`rebase skills install`](/docs/ai/skills) pour plus de détails, puis énonce les
règles sur lesquelles les assistants se trompent suffisamment souvent pour
mériter d'être répétées au début de chaque session :

1. **Schema as code.** Une table est un `defineTable` dans `backend/schema/<table>.ts`,
   exporté depuis `backend/schema/index.ts` — seul ce qui est exporté par l'index
   est exposé — avec un `rls` obligatoire. Ne modifiez jamais manuellement le
   schéma Drizzle généré ni les tables Postgres — voir [Schema as Code](/docs/architecture/schema-as-code).
2. **Appliquer une modification de schéma** dépend de la base de données.
   Pendant que `pnpm dev` s'exécute, enregistrer un fichier dans `backend/schema/`
   suffit : cela regénère le schéma Drizzle ainsi que les types du SDK, et le
   démarrage crée les tables et colonnes manquantes. `pnpm db:push` ne sert que
   pour ce que le démarrage laisse délibérément de côté — une colonne renommée,
   un type restreint, une colonne supprimée — aussi bien sur la base de données de
   développement managée que sur votre propre PostgreSQL. La production s'appuie
   sur `pnpm db:generate` puis `pnpm db:migrate`.
3. **Utilisez le SDK.** Passez par `rebase.dataAsAdmin.<table>` pour les
   opérations effectuées avec l'identité de service, ou par `getDriver(c)` dans
   une fonction lorsque la lecture doit s'exécuter en tant qu'appelant. Le client
   serveur n'a pas d'accesseur `data` direct. Le SQL brut et les appels directs à
   Drizzle contournent la validation, les hooks et le RLS.
4. **Protégez chaque route personnalisée.** Les routes dans `backend/functions/`
   sont montées *sans* authentification. Utilisez `requireAuth` / `requireAdmin`
   de `@rebasepro/server/functions` dans l'emplacement middleware de la route
   elle-même — lire `c.get("user")` n'est pas une protection, tout comme
   `app.use()` placé après la route.

Cette dernière règle est capitale. C'est ce qui fait la différence entre un
middleware qui s'exécute et un qui ne s'exécute pas, et un assistant non
averti écrira immanquablement la version qui ne fonctionne pas — voir
[Fonctions personnalisées](/docs/backend/custom-functions).

`requireAdmin` n'autorise que le rôle `admin`. Lorsqu'un rôle plus restreint ou
une clé API doit pouvoir appeler une route, la protection à ajouter est
`requireScope`, avec un scope déclaré par l'application — voir [Rôles et scopes](/docs/backend/roles-and-scopes/#app-scopes).

Après les règles viennent deux sections qui ne s'appliquent qu'à certains
projets. **Backend runtime** liste ce que le runtime managé sur Rebase Cloud
autorise : packages, mémoire et état au niveau du module, timeouts, ports
sortants, configuration et stockage pour les fichiers générés. Elle renvoie vers
[Runtime backend managé](/docs/deployment/managed-runtime/), afin qu'un assistant
conçoive une fonctionnalité backend en tenant compte des limites réelles plutôt
qu'au hasard. **Admin UI** rassemble les règles de `@rebasepro/ui`. Elles
s'appliquent aux vues du panneau d'administration, et non à un site public ou à
une application statique servis par le projet.

## Vous l'approprier

`ai-instructions.md` est votre fichier. Rien ne le régénère ni ne l'écrase —
contrairement aux [skills installés](/docs/ai/skills), qui sont remplacés à
chaque `rebase skills install`. C'est ici que doivent se trouver les conventions
propres à votre projet.

Ce qui a sa place ici est ce qu'un assistant ne peut pas déduire du code :
quelles tables sont obsolètes (legacy), quel service détient quelle table, la
convention de nommage qui n'est appliquée nulle part, la migration qui ne doit
pas être réexécutée. Restez concis — les instructions chargées à chaque requête
concurrencent la tâche en cours pour capter l'attention de l'assistant, et un
fichier trop long sera lu en diagonale.

Et gardez bien cette distinction à l'esprit : ce fichier détermine ce qu'un
assistant *écrit*. Il n'a aucun impact sur ce qu'un agent connecté à votre base
de données peut *faire* — cela est régi par les identifiants dont il dispose,
et rien dans le Markdown n'y changera quoi que ce soit. Voir
[le modèle d'identifiants du serveur MCP](/docs/ai/mcp#what-the-server-can-reach).

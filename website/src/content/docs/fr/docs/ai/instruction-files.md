---
sourceHash: 5dd46da9d88b962e
title: Fichiers d'instructions IA
sidebar_label: Fichiers d'instructions IA
description: Chaque projet Rebase généré inclut ai-instructions.md ainsi que des fichiers pointeurs de trois lignes pour Claude, Cursor, Windsurf, Copilot et AGENTS.md — une source de vérité unique, de multiples noms de fichiers.
---

Chaque assistant veut ses règles dans un fichier différent. Claude Code lit
`CLAUDE.md`, Cursor lit `.cursorrules`, Windsurf lit `.windsurfrules`,
Copilot lit `.github/copilot-instructions.md`, et la convention
multi-fournisseurs est `AGENTS.md`. Maintenir les mêmes instructions dans cinq
fichiers est le meilleur moyen pour que quatre d'entre eux deviennent obsolètes.

`rebase init` écrit les cinq — en tant que **pointeurs vers un fichier unique que
vous éditez réellement** :

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

Chaque fichier pointeur fait trois lignes :

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.
```

Sur la version 0.23, la troisième ligne indique seulement à l'assistant d'exécuter
`rebase skills install --agent claude`, et le fichier `.mcp.json` ci-dessous démarre le
serveur avec `npx -y @rebasepro/mcp` depuis le registre.

Les autres ne diffèrent que par le répertoire de compétences (skills) de l'agent et sa valeur
`--agent` — `--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — ainsi
que par le chemin relatif, qui est `../ai-instructions.md` dans
`.github/copilot-instructions.md` et `ai-instructions.md` dans `AGENTS.md`. La
troisième ligne est conditionnelle car `rebase init --agent` a peut-être déjà
installé les compétences avant même que l'assistant ne la lise.

Cela se produit à chaque `rebase init`, pour chaque preset, y compris `--headless`.
Il n'y a aucun flag ni invite de commande.

`rebase init` écrit également `.mcp.json`, qui oriente Claude Code, Cursor et
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

`REBASE_PROJECT_DIR` vaut `"."`, et non un chemin absolu : le client lance le serveur
à la racine du projet, et un chemin absolu est la seule ligne de ce fichier qui
ne peut pas être commitée. Elle est présente car `~/.rebase/projects.json` s'applique
à l'ensemble de la machine — un projet qui ne spécifie pas de répertoire propre
se rabat sur ce que le dernier projet sur cette machine a persisté. Voir
[la précédence](/docs/ai/mcp#which-directory-it-acts-on).

## Pourquoi un pointeur plutôt qu'une copie

Les fichiers pointeurs sont délibérément dépourvus de contenu. Les assistants suivent
les liens Markdown relatifs, donc un fichier de trois lignes qui pointe vers le vrai
fichier obtient le même résultat qu'une copie — et il possède des propriétés qu'une
copie n'a pas :

- **Un seul fichier à modifier.** Les règles ne peuvent pas diverger entre les
  assistants, car il n'existe qu'un seul jeu de règles.
- **Un seul diff à relire.** Une modification des conventions du projet est une
  modification d'un seul fichier, et non de cinq fichiers identiques qu'un
  relecteur doit comparer.
- **Ajouter un assistant prend trois lignes.** Un nouvel outil avec un nouveau nom
  de fichier reçoit un pointeur, et non une sixième copie de vos conventions.

Ce modèle mérite d'être conservé si vous forkez le squelette (scaffold), et mérite
d'être adopté dans des dépôts qui ne sont pas du tout des projets Rebase.

## Ce que contient `ai-instructions.md` au départ

Le fichier généré est délibérément court — il renvoie vers
[`rebase skills install`](/docs/ai/skills) pour plus de détails, puis énonce les règles
que les assistants comprennent souvent de travers au point qu'il vaille la peine
de les répéter au début de chaque session :

1. **Le schéma en tant que code.** Les collections sont définies dans `config/collections/`.
   Ne modifiez jamais manuellement le schéma Drizzle généré ni les tables Postgres — voir
   [Le schéma en tant que code](/docs/architecture/schema-as-code).
2. **L'application d'une modification de collection** dépend de la base de données. Pendant
   que `pnpm dev` tourne, enregistrer le fichier de collection suffit : le démarrage régénère
   le schéma Drizzle et crée les tables et colonnes manquantes. `pnpm db:push` ne sert que
   pour ce que le démarrage ignore délibérément — une colonne renommée, un type restreint,
   un champ supprimé — aussi bien sur la base de données de développement gérée que sur votre
   propre PostgreSQL. En production, utilisez `pnpm db:generate` puis `pnpm db:migrate`.
   Sur la 0.24, `pnpm db:push` nécessite votre propre PostgreSQL, et le fichier l'indique.
3. **Utilisez le SDK.** Passez par `rebase.dataAsAdmin.<slug>` pour les opérations effectuées
   sous l'identité de service, ou par `getDriver(c)` à l'intérieur d'une fonction lorsque la
   lecture doit s'exécuter sous l'identité de l'appelant. Le client serveur n'a pas d'accesseur
   `data` direct. Le SQL brut et les appels directs à Drizzle contournent la validation, les
   callbacks et le RLS.
4. **Protégez chaque route personnalisée.** Les routes dans `backend/functions/` sont montées
   *sans* authentification. Utilisez `requireAuth` / `requireAdmin` de
   `@rebasepro/server/functions` dans l'emplacement middleware propre à la route — lire
   `c.get("user")` n'est pas une protection, pas plus que `app.use()` après la route.

Cette dernière règle est essentielle. C'est la différence entre un middleware qui
s'exécute et un qui ne s'exécute pas, et un assistant qui n'en a pas été informé
écrira systématiquement la version qui ne fonctionne pas — voir
[Fonctions personnalisées](/docs/backend/custom-functions).

`requireAdmin` n'admet que le rôle `admin`. Lorsqu'un rôle plus restreint ou une
clé d'API doit pouvoir appeler une route, la protection à ajouter est `requireScope`,
avec un scope déclaré par l'application — voir [Rôles et portées](/docs/backend/roles-and-scopes/#app-scopes).

Après les règles viennent deux sections qui ne s'appliquent qu'à certains projets.
**Backend runtime** liste ce que le runtime managé sur Rebase Cloud autorise : packages,
mémoire et état au niveau du module, timeouts, ports sortants, configuration et
stockage pour les fichiers générés. Elle renvoie vers
[Runtime backend managé](/docs/deployment/managed-runtime/), afin qu'un assistant
conçoive une fonctionnalité backend en tenant compte des limites réelles au lieu de
deviner. **Admin UI** contient les règles de `@rebasepro/ui`. Elles s'appliquent aux
vues à l'intérieur du panneau d'administration, et non à un site public ou à une
application statique servis par le projet.

## Vous l'approprier

`ai-instructions.md` est votre fichier. Rien ne le régénère ni ne l'écrase —
contrairement aux [compétences installées](/docs/ai/skills), qui sont remplacées
à chaque `rebase skills install`. Les conventions spécifiques au projet ont leur
place ici.

Ce qui y a sa place, c'est ce qu'un assistant ne peut pas déduire du code : quelles
collections sont obsolètes, quel service possède quelle table, la convention de
nommage qui n'est appliquée nulle part, la migration qui ne doit pas être réexécutée.
Restez concis — les instructions chargées à chaque requête entrent en concurrence
avec la tâche réelle pour capter l'attention de l'assistant, et un fichier trop long
sera lu en diagonale.

Et gardez cette limite à l'esprit : ce fichier oriente ce qu'un assistant *écrit*.
Il n'a aucun impact sur ce qu'un agent connecté à votre base de données peut *faire* —
cela est déterminé par les identifiants qu'il détient, et rien dans le Markdown n'y
changera quoi que ce soit. Voir
[le modèle d'identifiants du serveur MCP](/docs/ai/mcp#what-the-server-can-reach).

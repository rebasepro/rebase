---
sourceHash: 62b7632c6d62c832
title: Compétences d'agent
sidebar_label: Compétences d'agent
description: rebase skills install écrit 24 compétences de référence Rebase dans votre dépôt, selon la structure attendue par votre assistant IA — Cursor, Claude Code, Windsurf, Gemini CLI et Antigravity.
---

Un assistant IA ayant lu la documentation de Rebase écrit du meilleur code Rebase
qu'un assistant qui essaie de deviner d'après la forme de l'API. `rebase skills install` copie 24
fichiers de compétences Markdown dans votre dépôt, quelle que soit la structure
attendue par votre assistant :

```bash
rebase skills install
```

Les compétences sont **du matériel de référence, pas des outils**. Elles indiquent
à un assistant comment les tables sont déclarées, pourquoi les migrations se font en deux étapes,
et quelles erreurs le framework ne détectera pas pour lui. Pour les outils qui agissent sur
vos données, consultez le [serveur MCP](/docs/ai/mcp).

## Via MCP, sans rien installer

Les mêmes compétences parviennent à Claude via MCP. Le [connecteur Rebase](/docs/ai/rebase-connector/#skills)
et le [serveur MCP local](/docs/ai/mcp/#skills) les fournissent tous les 24, et un
client utilisant la révision 2026-07-28 du protocole ou une version ultérieure en charge une lorsqu'il en a besoin.
Claude Code les nomme `<server>:rebase-tables` et ainsi de suite. Les installer dans
le dépôt, comme décrit ci-dessous, reste ce qui permet de les rendre accessibles à tous les assistants,
associées à la version exacte exécutée par le projet.

Votre propre application peut également fournir des compétences aux personnes qui l'utilisent : voir
[le point de terminaison MCP distant](/docs/ai/remote-mcp/#skills).

## Configuration via `rebase init`

Un nouveau projet n'a pas besoin de cette commande. `rebase init` vous demande
s'il faut configurer vos agents de codage IA, puis liste ceux qu'il trouve sur la
machine :

```text
? Set up Rebase skills and the Rebase MCP server for your AI coding agent(s)? Yes

Detecting installed AI coding agents...
  ✓ Claude Code — ~/.claude
  ✓ Gemini CLI / Antigravity — ~/.gemini
  ✗ Cursor — ~/.cursor (not found)
  ✗ Windsurf — ~/.codeium/windsurf (not found)
  ✗ Codex CLI — ~/.codex (not found)
  ✗ Kiro — ~/.kiro (not found)
  · GitHub Copilot — can't be detected; tick it below if you use it
```

Les agents détectés sont cochés par défaut. Pour chacun de ceux que vous conservez, il écrit les compétences
et enregistre le [serveur MCP](/docs/ai/mcp) dans la configuration de projet de cet agent, le tout
avant le premier commit du projet. En CI, ou avec `--yes`, spécifiez-les :

```bash
rebase init my-app --yes --agent claude,cursor
```

## Un projet existant

`rebase init` refuse un répertoire qui contient déjà un projet, de sorte qu'un projet
créé avant l'existence de la configuration des agents — ou dont l'auteur a refusé l'invite —
bénéficie de la même configuration grâce à `rebase skills install --mcp` : les compétences, et le
[serveur MCP](/docs/ai/mcp) enregistré dans la configuration de projet de chaque agent. Les serveurs
déjà présents dans le fichier sont conservés, et une réexécution laisse l'entrée Rebase telle quelle.

```bash
rebase skills install --agent cursor --mcp
```

Sans `--mcp`, la commande écrit uniquement les compétences et mentionne les agents dont la
configuration ne contient pas encore le serveur.

## Quel assistant

La commande accepte `--agent` (ou `-a`), répétable et séparé par des virgules :

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sept cibles sont prises en charge — une pour chaque fichier de référence écrit par `rebase init` :

| `--agent` | Assistant | Écrit dans |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/rebase.mdc` + `.cursor/rules/<skill>/SKILL.md` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/rebase.md` + `.windsurf/rules/<skill>/SKILL.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |
| `codex` | Codex CLI | `.agents/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/rebase.md` + `.kiro/steering/<skill>/SKILL.md` |
| `copilot` | GitHub Copilot | `.github/instructions/rebase.instructions.md` + `<skill>/SKILL.md` |

:::note[Cursor, Windsurf, Kiro et Copilot reçoivent un fichier actif en permanence]
Ces quatre assistants chargent l'intégralité de leur répertoire de règles à chaque requête. Un fichier de règle par
compétence représentait environ **84 000 caractères** de référence Rebase avant chaque
question posée par un utilisateur, qu'elle concerne Rebase ou non — et une
instruction qu'un assistant survole est une instruction qu'il ne suit pas.

Ils reçoivent à la place `rebase.mdc` (ou `rebase.md`) : un index d'environ 3 Ko avec
`alwaysApply: true`, listant ce que chaque compétence couvre ainsi que le fichier à lire. Les
contenus se trouvent dans des sous-répertoires par compétence et sont ouverts à la demande.
:::

`gemini` couvre **à la fois** Gemini CLI et Antigravity — ils lisent le même
répertoire `.agents/`, il n'y a donc pas de valeur `antigravity` distincte. Codex le lit
également ; spécifier à la fois `gemini` et `codex` écrit le répertoire une seule fois.

Sans `--agent`, la commande détecte les assistants qu'un projet utilise déjà en
recherchant `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` et
`.kiro/`. Si elle n'en trouve aucun, elle vous invite à choisir, avec les assistants installés
sur la machine déjà pré-cochés.

**GitHub Copilot n'est jamais détecté.** Son répertoire serait `.github/`, et
`.github/` ne prouve pas que quelqu'un utilise Copilot : `rebase init` écrit
`.github/copilot-instructions.md` dans chaque squelette de projet, et la plupart des dépôts possèdent
un dossier `.github/` pour les workflows. Installez-le avec `--agent copilot`.

:::note[Un projet fraîchement initialisé affiche toujours l'invite]
`rebase init` écrit `CLAUDE.md`, `.cursorrules` et consorts, mais aucun des
*répertoires* que la détection recherche. Ainsi, la première exécution dans un nouveau projet renvoie
à l'invite — et dans un environnement de CI sans TTY, elle se termine par une erreur.
Spécifiez `--agent` explicitement dans tout contexte non interactif.
:::

## Local au projet, et destiné à être commité

Les compétences sont écrites **relativement à la racine de votre projet** — le répertoire parent le plus proche
contenant `rebase.json` — et non dans votre répertoire personnel ou le répertoire de travail actuel. Rien n'est installé globalement.

Commitez-les. Elles font partie du dépôt au même titre qu'une configuration de linter : l'assistant
de chaque contributeur travaille ainsi à partir de la même compréhension du code source,
y compris les contributeurs qui n'ont jamais exécuté la commande.

## Mettre à jour les compétences

**`rebase upgrade` les met à jour.** Les compétences sont intégrées à `@rebasepro/cli`, donc
après avoir installé la nouvelle version, [`rebase upgrade`](/docs/cli/#rebase-upgrade)
exécute le `rebase skills install` du nouveau CLI pour chaque assistant dont le répertoire de compétences
a été écrit par une installation, tout en conservant les fichiers que vous avez modifiés. Un projet déjà à jour
est également rafraîchi. Un rafraîchissement qui échoue ne fait jamais échouer la mise à niveau. Avec
`--json`, la propriété `skills` du document indique ce qui s'est passé : `{ agents, refreshed }`, avec
une `reason` lorsqu'il ne l'a pas fait (`dry_run`, `not_installed` après `--no-install`,
`no_project_cli` lorsque le projet n'installe pas `@rebasepro/cli` lui-même,
`failed`), ou `null` si aucune compétence n'est installée.

Si vous avez mis à jour les versions fixées d'une autre manière (un bot de dépendances, une modification manuelle), lancez
tout de même `rebase upgrade`, ou lancez l'installation vous-même :

```bash
rebase skills install
```

Sans `--agent`, elle rafraîchit les assistants dont les répertoires existent déjà
dans le projet. Les commandes se terminent également par une ligne lorsqu'une version plus récente de Rebase est disponible, afin qu'un
assistant travaillant dans le projet prenne connaissance de la nouvelle version sans avoir à être prévenu.

Chaque répertoire cible contient un manifeste `.rebase-skills.json` de ce que la
commande a écrit, afin qu'une réexécution puisse distinguer une modification personnelle d'une copie issue d'une version antérieure. Commitez-le
avec les compétences.

- Un fichier que personne n'a modifié est remplacé par la copie de la nouvelle version.
- Un fichier que vous avez modifié est conservé, et la commande le liste. `--force` le remplace.
- Une compétence qu'une version plus récente ne fournit plus est supprimée, sauf si vous l'avez modifiée.
  Dans ce cas, elle est conservée et listée.
- Les fichiers que la commande n'a jamais écrits ne sont pas touchés.

Les directives spécifiques au projet restent dans
[`ai-instructions.md`](/docs/ai/instruction-files), qui vous appartient. Une compétence
modifiée cesse de recevoir des mises à jour jusqu'à ce que vous utilisiez `--force`.

La commande fonctionne également en dehors d'un projet Rebase, en se rabattant sur le répertoire
de travail — ce qui est utile pour un dépôt frontend distinct qui communique avec un backend Rebase.

## Les 24 compétences

| Compétence | Description |
|---|---|
| `rebase-basics` | Principes fondamentaux, workflow et maintenance — le point d'entrée prérequis pour les autres |
| `rebase-tables` | Création de tables : colonnes, relations, `rls`, hooks, et la couche CMS supérieure (`customizeTable`) |
| `rebase-backend-postgres` | Le backend Postgres : configuration, génération de schéma, migrations, pooling, réplicas en lecture |
| `rebase-api` | L'API REST générée — points de terminaison, filtrage, tri, pagination |
| `rebase-sdk` | Le SDK TypeScript généré : CRUD, filtrage, recherche, authentification, temps réel, hors ligne, stockage |
| `rebase-auth` | Authentification, rôles, politiques RLS, MFA, clés d'API, OAuth, adaptateurs personnalisés |
| `rebase-security` | Contrôle d'accès, interception, conception fail-closed, masquage des PII, isolation des locataires |
| `rebase-realtime` | Le moteur WebSocket : synchronisation, canaux de diffusion, présence, diffusion des modifications de tables |
| `rebase-storage` | Stockage S3/GCS/local, téléversements, téléversements avec reprise TUS, transformations d'images |
| `rebase-custom-functions` | Points de terminaison d'API personnalisés via la découverte de fonctions basée sur les fichiers |
| `rebase-cron-jobs` | Planification de tâches d'arrière-plan récurrentes |
| `rebase-webhooks` | Webhooks HTTP sortants, signatures HMAC, nouvelles tentatives et backoff |
| `rebase-email` | SMTP, modèles, fournisseurs personnalisés, le singleton `rebase.email` |
| `rebase-entity-history` | Gestion des versions d'entités, suivi des modifications, journaux d'audit, restauration |
| `rebase-admin` | Navigation dans le panneau d'administration, tiroirs latéraux, URLs, intégration de panneaux de collections |
| `rebase-customize-admin` | Personnalisation de l'administration avec des composants React — singletons, pages de paramètres, actions groupées, modes de vue, champs personnalisés, remplacement d'éléments intégrés |
| `rebase-custom-views` | Écrans personnalisés dans l'administration — `rebase generate view`, vues de premier niveau, onglets d'enregistrements, widgets de champs |
| `rebase-dashboards` | KPIs, graphiques et tableaux de bord — indicateurs calculés en SQL, tracés avec `@rebasepro/ui`, placés dans des emplacements ou sur une page |
| `rebase-ui-components` | La bibliothèque de composants `@rebasepro/ui` |
| `rebase-design-language` | Le langage de conception de l'interface utilisateur : tokens, couleur, typographie, espacement, anti-patterns |
| `rebase-studio` | La couche d'outils de développement Studio — SQL, RLS, stockage, cron, visualiseur de schéma, journaux |
| `rebase-cloud` | Déploiement et exploitation sur Rebase Cloud — projets, bases de données gérées, variables d'environnement, domaines, journaux, retours en arrière |
| `rebase-deployment` | Auto-hébergement : Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway et Render |
| `rebase-local-env-setup` | Configuration initiale : Node.js, pnpm, PostgreSQL, Docker |

Deux d'entre elles demandent à être lues spontanément. `rebase-basics` indique qu'elle doit être utilisée
dès qu'un assistant touche de près ou de loin à Rebase, et `rebase-design-language` indique qu'un
agent doit la lire avant de créer ou modifier toute interface visuelle — celle-ci existe
car l'interface utilisateur générée dérive d'un design system plus vite que n'importe quel autre élément dans une
base de code.

## Exemple d'exécution

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

Les compétences proviennent du paquet `@rebasepro/agent-skills`, dont dépend le CLI,
de sorte que l'ensemble obtenu correspond à la version du CLI que vous avez installée.

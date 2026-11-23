---
sourceHash: df522ef7c8309826
title: Compétences d'agent
sidebar_label: Compétences d'agent
description: rebase skills install écrit 24 compétences de référence Rebase dans votre dépôt, selon la structure attendue par votre assistant IA — Cursor, Claude Code, Windsurf, Gemini CLI et Antigravity.
---

Un assistant IA ayant lu la documentation de Rebase écrit un meilleur code Rebase
qu'un assistant qui devine à partir de la structure de l'API. `rebase skills install` copie 24
fichiers de compétences Markdown dans votre dépôt, selon la disposition attendue par votre
assistant :

```bash
rebase skills install
```

Les compétences sont **du matériel de référence, pas des outils**. Elles expliquent à un assistant comment
les tables sont déclarées, pourquoi les migrations se font en deux étapes, et quelles erreurs le
framework ne détectera pas à sa place. Pour les outils qui agissent sur vos données, consultez le
[serveur MCP](/docs/ai/mcp).

## Configuration par `rebase init`

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

Les agents détectés sont pré-cochés. Pour chacun de ceux que vous conservez, la commande écrit les compétences
et enregistre le [serveur MCP](/docs/ai/mcp) dans la configuration de projet de cet agent, le tout
avant le premier commit du projet. En CI, ou avec `--yes`, spécifiez-les :

```bash
rebase init my-app --yes --agent claude,cursor
```

## Un projet existant

`rebase init` refuse un répertoire qui contient déjà un projet. Ainsi, un projet
créé avant l'existence de la configuration des agents — ou dont l'auteur a décliné
l'invite — obtient la même configuration via `rebase skills install --mcp` : les compétences, et le
[serveur MCP](/docs/ai/mcp) enregistré dans la configuration de projet de chaque agent. Les serveurs
déjà présents dans le fichier sont conservés, et une réexécution laisse l'entrée Rebase telle quelle.

```bash
rebase skills install --agent cursor --mcp
```

Sans `--mcp`, la commande écrit uniquement les compétences, et indique les agents dont la
configuration ne contient pas encore le serveur.

## Quel assistant

La commande accepte `--agent` (ou `-a`), répétable et séparé par des virgules :

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sept cibles sont prises en charge — une pour chaque fichier pointeur écrit par `rebase init` :

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
Ces quatre assistants chargent l'intégralité de leur répertoire de règles dans chaque requête. Un fichier de règle par
compétence représentait environ **84 000 caractères** de référence Rebase avant chaque
question posée par une personne, qu'elle concerne Rebase ou non — et une
instruction qu'un assistant survole est une instruction qu'il ne suit pas.

À la place, ils reçoivent `rebase.mdc` (ou `rebase.md`) : un index d'environ 3 Ko avec
`alwaysApply: true`, listant ce que chaque compétence couvre ainsi que le fichier à lire. Le
contenu réside dans des sous-répertoires par compétence et est ouvert à la demande.
:::

`gemini` couvre **à la fois** Gemini CLI et Antigravity — ils lisent le même
répertoire `.agents/`, il n'y a donc pas de valeur `antigravity` distincte. Codex le lit
également ; spécifier à la fois `gemini` et `codex` n'écrit le répertoire qu'une seule fois.

Sans `--agent`, la commande détecte les assistants qu'un projet utilise déjà en
recherchant `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` et
`.kiro/`. Si elle n'en trouve aucun, elle vous invite à choisir, avec les assistants installés
sur la machine déjà pré-cochés.

**GitHub Copilot n'est jamais détecté.** Son répertoire serait `.github/`, et
`.github/` ne prouve en rien que quelqu'un utilise Copilot : `rebase init` écrit
`.github/copilot-instructions.md` dans chaque squelette de projet, et la plupart des dépôts ont
un dossier `.github/` pour les workflows. Installez-le avec `--agent copilot`.

:::note[Un projet fraîchement généré invite toujours à choisir]
`rebase init` écrit `CLAUDE.md`, `.cursorrules` et consorts, mais aucun des
*répertoires* que la détection recherche. La première exécution dans un nouveau projet bascule
donc vers l'invite de sélection — et en CI, où il n'y a pas de TTY, elle se termine par une erreur.
Spécifiez `--agent` explicitement dans tout contexte non interactif.
:::

## Local au projet, et destiné à être commité

Les compétences sont écrites **relativement à la racine de votre projet** — l'ancêtre le plus proche
contenant `rebase.json` — et non dans votre répertoire personnel ni dans le répertoire
de travail actuel. Rien n'est installé globalement.

Commitez-les. Elles font partie du dépôt au même titre qu'une configuration de linter : l'assistant
de chaque contributeur travaille alors avec la même compréhension du code source,
y compris les contributeurs qui n'ont jamais exécuté la commande.

## Mettre à jour les compétences

**`rebase upgrade` les met à jour.** Les compétences sont fournies au sein de `@rebasepro/cli`. Ainsi,
après l'installation de la nouvelle version, [`rebase upgrade`](/docs/cli/#rebase-upgrade)
exécute la commande `rebase skills install` du nouveau CLI pour chaque assistant dont le répertoire de compétences
a été écrit lors d'une installation, tout en conservant les fichiers que vous avez modifiés. Un projet déjà sur cette
version est également actualisé. Un échec d'actualisation ne fait jamais échouer la mise à niveau. Avec
`--json`, la propriété `skills` du document indique ce qui s'est passé : `{ agents, refreshed }`, avec
un champ `reason` lorsqu'elle n'a pas eu lieu (`dry_run`, `not_installed` après `--no-install`,
`no_project_cli` quand le projet n'installe pas `@rebasepro/cli` lui-même,
`failed`), ou `null` si aucune compétence n'est installée.

Si vous avez mis à jour les versions d'une autre manière (un bot de dépendances, une modification manuelle),
exécutez tout de même `rebase upgrade`, ou lancez vous-même l'installation :

```bash
rebase skills install
```

Sans `--agent`, la commande actualise les assistants dont le projet possède déjà les
répertoires. Les commandes se terminent également par une ligne lorsqu'une nouvelle version de Rebase est disponible, afin
qu'un assistant travaillant dans le projet soit informé de la version sans intervention extérieure.

Chaque répertoire cible contient un manifeste `.rebase-skills.json` de ce que la
commande a écrit, ce qui permet à une réexécution de distinguer une modification manuelle de la copie d'une version antérieure. Commitez-le
avec les compétences.

- Un fichier que personne n'a modifié est remplacé par la copie de la nouvelle version.
- Un fichier que vous avez modifié est conservé, et la commande le liste. `--force` le remplace.
- Une compétence qu'une version plus récente ne fournit plus est supprimée, sauf si vous l'avez modifiée.
  Dans ce cas, elle est conservée et listée.
- Les fichiers que la commande n'a jamais écrits ne sont pas touchés.

Les instructions spécifiques au projet restent à leur place dans
[`ai-instructions.md`](/docs/ai/instruction-files), qui vous appartient. Une compétence modifiée
cesse de recevoir des mises à jour jusqu'à ce que vous utilisiez `--force`.

La commande fonctionne également en dehors d'un projet Rebase, en se rabattant sur le répertoire
de travail — ce qui est utile pour un dépôt frontend distinct qui communique avec un backend Rebase.

## Les 24 compétences

| Compétence | Couvre |
|---|---|
| `rebase-basics` | Principes fondamentaux, flux de travail et maintenance — le point d'entrée supposé par les autres |
| `rebase-tables` | Création de tables : colonnes, relations, `rls`, hooks et la couche CMS supérieure (`customizeTable`) |
| `rebase-backend-postgres` | Le backend Postgres : configuration, génération de schéma, migrations, pooling, réplicas de lecture |
| `rebase-api` | L'API REST générée — points de terminaison, filtrage, tri, pagination |
| `rebase-sdk` | Le SDK TypeScript généré : CRUD, filtrage, recherche, authentification, temps réel, hors ligne, stockage |
| `rebase-auth` | Authentification, rôles, politiques RLS, MFA, clés d'API, OAuth, adaptateurs personnalisés |
| `rebase-security` | Contrôle d'accès, interception, conception « fail-closed », masquage des données personnelles (PII), isolation des locataires |
| `rebase-realtime` | Le moteur WebSocket : synchronisation, canaux de diffusion (broadcast), présence, diffusion des modifications de tables |
| `rebase-storage` | Stockage S3/GCS/local, téléversements, téléversements avec reprise TUS, transformations d'images |
| `rebase-custom-functions` | Points de terminaison d'API personnalisés via la découverte de fonctions basée sur les fichiers |
| `rebase-cron-jobs` | Planification de tâches d'arrière-plan récurrentes |
| `rebase-webhooks` | Webhooks HTTP sortants, signatures HMAC, nouvelles tentatives et temporisation exponentielle (backoff) |
| `rebase-email` | SMTP, modèles, fournisseurs personnalisés, le singleton `rebase.email` |
| `rebase-entity-history` | Versionnement d'entités, suivi des modifications, journaux d'audit, restauration |
| `rebase-admin` | Navigation dans le panneau d'administration, volets latéraux, URLs, intégration de panneaux de collections |
| `rebase-customize-admin` | Personnalisation de l'administration avec des composants React — singletons, pages de paramètres, actions groupées, modes de vue, champs personnalisés, remplacement d'éléments intégrés |
| `rebase-custom-views` | Écrans personnalisés au sein de l'administration — `rebase generate view`, vues de premier niveau, onglets d'enregistrements, widgets de champs |
| `rebase-dashboards` | KPI, graphiques et tableaux de bord — indicateurs calculés en SQL, affichés avec `@rebasepro/ui`, placés dans des emplacements (slots) ou une page |
| `rebase-ui-components` | La bibliothèque de composants `@rebasepro/ui` |
| `rebase-design-language` | Le langage de conception d'interface : tokens, couleurs, typographie, espacement, anti-patterns |
| `rebase-studio` | La couche d'outils de développement Studio — SQL, RLS, stockage, cron, visualiseur de schéma, journaux |
| `rebase-cloud` | Déploiement et exploitation sur Rebase Cloud — projets, bases de données gérées, variables d'environnement, domaines, journaux, retours en arrière (rollbacks) |
| `rebase-deployment` | Auto-hébergement : Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway et Render |
| `rebase-local-env-setup` | Première configuration : Node.js, pnpm, PostgreSQL, Docker |

Deux d'entre elles demandent à être lues spontanément. `rebase-basics` indique qu'elle doit être utilisée
dès qu'un assistant touche de près ou de loin à Rebase, et `rebase-design-language` indique qu'un
agent doit la lire avant de créer ou modifier toute interface visuelle — cette dernière existe
parce qu'une interface générée dérive d'un design system plus vite que n'importe quel autre élément d'un
codebase.

## À quoi ressemble une exécution

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

Les compétences sont fournies par le paquet `@rebasepro/agent-skills`, dont dépend le CLI,
de sorte que l'ensemble obtenu correspond à la version de votre CLI installée.

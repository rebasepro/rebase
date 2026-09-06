---
sourceHash: 961bf86d4efda8bf
title: Compétences d'agent (Agent Skills)
sidebar_label: Agent Skills
description: rebase skills install écrit 21 compétences de référence Rebase dans votre dépôt, dans la structure attendue par votre assistant IA — Cursor, Claude Code, Windsurf, Gemini CLI et Antigravity.
---

Un assistant IA qui a lu la documentation de Rebase écrit un meilleur code Rebase
qu'un assistant qui essaie de deviner d'après la forme de l'API. `rebase skills install` copie 20
fichiers de compétences Markdown dans votre dépôt, selon la structure attendue par votre
assistant :

```bash
rebase skills install
```

Les compétences sont des **documents de référence, pas des outils**. Elles expliquent à un assistant comment
les collections sont définies, pourquoi les migrations se font en deux étapes, et quelles erreurs le
framework n'interceptera pas pour lui. Pour les outils qui agissent sur vos données, consultez le
[serveur MCP](/docs/ai/mcp).

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
| `codex` | Codex CLI | `.codex/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/rebase.md` + `.kiro/steering/<skill>/SKILL.md` |
| `copilot` | GitHub Copilot | `.github/instructions/rebase.instructions.md` + `<skill>/SKILL.md` |

:::note[Cursor, Windsurf, Kiro et Copilot reçoivent un seul fichier toujours actif]
Ces quatre-là chargent tout leur répertoire de règles dans chaque requête. Un
fichier de règles par compétence représentait environ **84 000 caractères** de
référence Rebase devant chaque question, qu'elle porte sur Rebase ou non — et
une instruction qu'un assistant survole est une instruction qu'il ne suit pas.

Ils reçoivent à la place `rebase.mdc` (ou `rebase.md`) : un index d'environ 3 Ko
avec `alwaysApply: true`, qui liste ce que couvre chaque compétence et le
fichier à lire. Les contenus restent dans des sous-répertoires par compétence et
sont ouverts à la demande.
:::

`gemini` couvre **à la fois** Gemini CLI et Antigravity — ils lisent le même
répertoire `.agents/`, il n'y a donc pas de valeur `antigravity` distincte.

Sans `--agent`, la commande détecte quels assistants sont déjà utilisés par un projet en
recherchant `.cursor/`, `.claude/`, `.windsurf/` et `.agents/`. Si elle n'en trouve
aucun, elle vous invite à faire un choix.

:::note[Un projet fraîchement initialisé affiche toujours une invite]
`rebase init` écrit `CLAUDE.md`, `.cursorrules` et autres, mais aucun des
*répertoires* que la détection recherche. Le premier lancement dans un nouveau projet
aboutit donc à l'invite — et dans un environnement CI, sans TTY, il se termine
par une erreur. Passez `--agent` explicitement dans tout contexte non interactif.
:::

## Local au projet, et destiné à être commité

Les compétences sont écrites **relativement à la racine de votre projet** — le répertoire parent le plus proche
contenant `rebase.json` — et non dans votre répertoire personnel ni dans le répertoire de travail
actuel. Rien n'est installé globalement.

Committez-les. Elles font partie du dépôt au même titre qu'une configuration de linter : l'assistant
de chaque contributeur dispose ainsi de la même compréhension du codebase,
y compris pour les contributeurs qui n'ont jamais exécuté la commande.

**Réexécutez la commande pour mettre à jour.** Les fichiers sont écrasés sans condition, donc
après une mise à niveau de Rebase :

```bash
rebase skills install --agent all
```

Deux conséquences à « sans condition » : les modifications locales apportées à une compétence installée sont
perdues lors de la prochaine exécution — conservez plutôt les directives spécifiques au projet dans
[`ai-instructions.md`](/docs/ai/instruction-files), qui vous appartient et n'est
jamais écrasé. De plus, les compétences supprimées dans une version plus récente ne sont pas effacées de
votre dépôt ; seuls les fichiers qui existent encore sont réécrits.

La commande fonctionne également en dehors d'un projet Rebase, en se rabattant sur le répertoire
de travail — ce qui est utile pour un dépôt frontend séparé communiquant avec un backend Rebase.

## Les 21 compétences

| Compétence | Couvre |
|---|---|
| `rebase-basics` | Principes fondamentaux, flux de travail et maintenance — le point d'entrée prérequis pour les autres |
| `rebase-collections` | Définition des collections, types de propriétés, validation, recherche |
| `rebase-backend-postgres` | Le backend Postgres : configuration, génération de schéma, migrations, pooling, réplicas de lecture |
| `rebase-api` | L'API REST générée — points de terminaison, filtrage, tri, pagination |
| `rebase-sdk` | Le SDK TypeScript généré : CRUD, filtrage, recherche, authentification, temps réel, hors-ligne, stockage |
| `rebase-auth` | Authentification, rôles, politiques RLS, MFA, clés d'API, OAuth, adaptateurs personnalisés |
| `rebase-security` | Contrôle d'accès, interception, conception « fail-closed », masquage de PII, isolation des locataires (tenants) |
| `rebase-realtime` | Le moteur WebSocket : synchronisation, canaux de diffusion, présence, diffusion des modifications de table |
| `rebase-storage` | Stockage S3/GCS/local, téléversements, téléversements reprenables TUS, transformations d'images |
| `rebase-custom-functions` | Points de terminaison d'API personnalisés via la découverte de fonctions basée sur les fichiers |
| `rebase-cron-jobs` | Planification de tâches d'arrière-plan récurrentes |
| `rebase-webhooks` | Webhooks HTTP sortants, signatures HMAC, nouvelles tentatives et backoff |
| `rebase-email` | SMTP, modèles, fournisseurs personnalisés, le singleton `rebase.email` |
| `rebase-entity-history` | Gestion des versions d'entités, suivi des modifications, journaux d'audit, restauration |
| `rebase-admin` | Navigation dans le panneau d'administration, tiroirs latéraux (drawers), URLs, intégration de panneaux de collection |
| `rebase-ui-components` | La bibliothèque de composants `@rebasepro/ui` |
| `rebase-design-language` | Le langage de conception d'interface utilisateur : tokens, couleur, typographie, espacement, anti-patterns |
| `rebase-studio` | La couche d'outils de développement Studio — SQL, RLS, stockage, cron, visualiseur de schéma, journaux |
| `rebase-cloud` | Déploiement et exploitation sur Rebase Cloud — projets, bases de données gérées, variables d'environnement, domaines, journaux, rollbacks |
| `rebase-deployment` | Auto-hébergement : Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway et Render |
| `rebase-local-env-setup` | Première configuration : Node.js, pnpm, PostgreSQL, Docker |

Deux d'entre elles demandent à être lues spontanément. `rebase-basics` indique qu'elle doit être utilisée
dès qu'un assistant touche à Rebase, et `rebase-design-language` indique qu'un
agent doit la lire avant de créer ou modifier toute interface visuelle — celle-ci existe
parce que les interfaces générées s'écartent d'un design system plus rapidement que n'importe quel autre élément d'un
codebase.

## À quoi ressemble une exécution

```text
  Found 21 Rebase skills

  ✓ Claude Code — 21 skills installed (+ 8 reference files) to .claude/skills
```

Les compétences sont fournies par le paquet `@rebasepro/agent-skills`, dont dépend le CLI,
de sorte que l'ensemble obtenu correspond à la version installée de votre CLI.

---

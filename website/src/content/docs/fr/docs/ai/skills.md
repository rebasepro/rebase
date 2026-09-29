---
sourceHash: 057f6243c593912e
title: Compétences d'agent
sidebar_label: Compétences d'agent
description: rebase skills install écrit 21 compétences de référence Rebase dans votre dépôt, selon l'organisation attendue par votre assistant IA — Cursor, Claude Code, Windsurf, Gemini CLI et Antigravity.
---

Un assistant IA qui a lu la documentation de Rebase écrit un meilleur code Rebase
qu'un assistant qui devine d'après la structure de l'API. `rebase skills install` copie 21
fichiers de compétences Markdown dans votre dépôt, selon l'organisation attendue
par votre assistant :

```bash
rebase skills install
```

Les compétences sont du **matériel de référence, pas des outils**. Elles expliquent à un assistant comment
les collections sont définies, pourquoi les migrations se font en deux étapes, et quelles erreurs le
framework ne détectera pas pour lui. Pour les outils qui interagissent avec vos données, consultez le
[serveur MCP](/docs/ai/mcp).

## Configuration par `rebase init`

<span class="since-badge" data-since="0.24">Depuis 0.24</span> Un nouveau projet n'a pas besoin de cette commande. `rebase init` vous demande
s'il doit configurer vos agents de codage IA, puis liste ceux qu'il détecte sur la
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

Les agents trouvés sont pré-cochés. Pour chacun de ceux que vous conservez, la commande écrit les compétences
et enregistre le [serveur MCP](/docs/ai/mcp) dans la configuration de projet de cet agent, le tout
avant le premier commit du projet. En CI, ou avec `--yes`, spécifiez-les nommément :

```bash
rebase init my-app --yes --agent claude,cursor
```

## Quel assistant

La commande accepte l'option `--agent` (ou `-a`), répétable et séparée par des virgules :

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
Ces quatre outils chargent l'intégralité de leur répertoire de règles à chaque requête. Un fichier de règle par
compétence représentait environ **84 000 caractères** de référence Rebase injectés avant chaque
question posée par un utilisateur, qu'elle concerne Rebase ou non — or, une
instruction qu'un assistant survole est une instruction qu'il ne suit pas.

Ils reçoivent donc `rebase.mdc` (ou `rebase.md`) à la place : un index d'environ 3 Ko avec
`alwaysApply: true`, listant ce que chaque compétence couvre ainsi que le fichier à lire. Les
contenus complets se trouvent dans des sous-répertoires dédiés à chaque compétence et ne sont ouverts qu'à la demande.
:::

`gemini` couvre **à la fois** Gemini CLI et Antigravity — ils lisent le même
répertoire `.agents/`, il n'y a donc pas de valeur `antigravity` distincte. Codex le lit
également ; spécifier à la fois `gemini` et `codex` écrit le répertoire une seule fois.

Sans `--agent`, la commande détecte les assistants déjà utilisés par un projet en
recherchant `.cursor/`, `.claude/`, `.windsurf/`, `.agents/`, `.codex/` et
`.kiro/`. Si elle n'en trouve aucun, elle vous invite à choisir, les assistants installés
sur la machine étant déjà cochés.

**GitHub Copilot n'est jamais détecté.** Son répertoire serait `.github/`, or
la présence de `.github/` ne prouve pas que quelqu'un utilise Copilot : `rebase init` écrit
`.github/copilot-instructions.md` dans chaque nouveau projet généré, et la plupart des dépôts possèdent
un dossier `.github/` pour les workflows. Installez-le avec `--agent copilot`.

:::note[Un projet fraîchement généré demande toujours confirmation]
`rebase init` écrit `CLAUDE.md`, `.cursorrules` et consorts, mais aucun des
*répertoires* recherchés par la détection. La première exécution dans un nouveau projet
bascule donc vers l'invite interactive — et en CI, où il n'y a pas de TTY, elle se termine
par une erreur. Passez `--agent` explicitement dans tout contexte non interactif.
:::

## Spécifique au projet, et destiné à être commité

Les compétences sont écrites **relativement à la racine de votre projet** — le répertoire parent le plus proche
contenant `rebase.json` — et non dans votre répertoire personnel ni dans le répertoire de
travail courant. Rien n'est installé globalement.

Commitez-les. Elles font partie du dépôt au même titre qu'une configuration de linter : chaque
assistant de chaque contributeur travaille ainsi à partir de la même compréhension de la base de code,
y compris les contributeurs qui n'ont jamais exécuté la commande.

**Réexécutez la commande pour mettre à jour.** Les fichiers sont écrasés sans condition, donc
après une mise à niveau de Rebase :

```bash
rebase skills install --agent all
```

Deux conséquences à cet écrasement inconditionnel : les modifications locales apportées à une compétence installée sont
perdues lors de la prochaine exécution — conservez plutôt les instructions spécifiques au projet dans
[`ai-instructions.md`](/docs/ai/instruction-files), qui vous appartient et n'est
jamais écrasé. De plus, les compétences supprimées dans une version plus récente ne sont pas supprimées de
votre dépôt ; seuls les fichiers existant toujours sont réécrits.

La commande fonctionne également en dehors d'un projet Rebase, en se rabattant sur le répertoire de
travail — ce qui est utile pour un dépôt frontend distinct qui communique avec un backend Rebase.

## Les 21 compétences

| Compétence | Sujets couverts |
|---|---|
| `rebase-basics` | Principes fondamentaux, workflow et maintenance — le point d'entrée prérequis pour les autres |
| `rebase-collections` | Définition des collections, types de propriétés, validation, recherche |
| `rebase-backend-postgres` | Le backend Postgres : configuration, génération de schéma, migrations, pooling, réplicas en lecture |
| `rebase-api` | L'API REST générée — points de terminaison, filtrage, tri, pagination |
| `rebase-sdk` | Le SDK TypeScript généré : CRUD, filtrage, recherche, authentification, temps réel, hors-ligne, stockage |
| `rebase-auth` | Authentification, rôles, politiques RLS, MFA, clés d'API, OAuth, adaptateurs personnalisés |
| `rebase-security` | Contrôle d'accès, interception, conception « fail-closed », masquage des PII, isolation des locataires |
| `rebase-realtime` | Le moteur WebSocket : synchronisation, canaux de diffusion, présence, diffusion des modifications de table |
| `rebase-storage` | Stockage S3/GCS/local, téléversements, téléversements reprenables TUS, transformations d'images |
| `rebase-custom-functions` | Points de terminaison d'API personnalisés via la découverte de fonctions basée sur les fichiers |
| `rebase-cron-jobs` | Planification de tâches d'arrière-plan récurrentes |
| `rebase-webhooks` | Webhooks HTTP sortants, signatures HMAC, nouvelles tentatives et backoff |
| `rebase-email` | SMTP, modèles, fournisseurs personnalisés, le singleton `rebase.email` |
| `rebase-entity-history` | Gestion des versions d'entités, suivi des modifications, journaux d'audit, restauration |
| `rebase-admin` | Navigation dans le panneau d'administration, volets latéraux, URL, intégration de panneaux de collection |
| `rebase-ui-components` | La bibliothèque de composants `@rebasepro/ui` |
| `rebase-design-language` | Le langage de design UI : tokens, couleurs, typographie, espacement, anti-patterns |
| `rebase-studio` | La couche d'outils de développement Studio — SQL, RLS, stockage, cron, visualiseur de schéma, journaux |
| `rebase-cloud` | Déploiement et exploitation sur Rebase Cloud — projets, bases de données gérées, variables d'environnement, domaines, journaux, rollbacks |
| `rebase-deployment` | Auto-hébergement : Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway et Render |
| `rebase-local-env-setup` | Première configuration : Node.js, pnpm, PostgreSQL, Docker |

Deux d'entre elles demandent à être lues spontanément. `rebase-basics` indique qu'elle doit être consultée
dès qu'un assistant touche de près ou de loin à Rebase, et `rebase-design-language` indique qu'un
agent doit la lire avant de créer ou modifier toute interface visuelle — celle-ci existe
car les interfaces générées s'écartent d'un design system plus rapidement que n'importe quel autre élément d'une
base de code.

## À quoi ressemble une exécution

```text
  Found 21 Rebase skills

  ✓ Claude Code — 21 skills installed (+ 8 reference files) to .claude/skills
```

Les compétences sont fournies par le paquet `@rebasepro/agent-skills`, dont dépend la CLI,
l'ensemble obtenu correspond donc à la version de la CLI que vous avez installée.

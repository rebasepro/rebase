---
sourceHash: 3c25626150027572
title: Fichiers d'instructions pour l'IA
sidebar_label: Fichiers d'instructions pour l'IA
description: Chaque projet Rebase généré inclut ai-instructions.md ainsi que des fichiers pointeurs de trois lignes pour Claude, Cursor, Windsurf, Copilot et AGENTS.md — une source unique de vérité, plusieurs noms de fichiers.
---

Chaque assistant attend ses règles dans un fichier différent. Claude Code lit
`CLAUDE.md`, Cursor lit `.cursorrules`, Windsurf lit `.windsurfrules`,
Copilot lit `.github/copilot-instructions.md`, et la convention
multi-fournisseurs est `AGENTS.md`. Maintenir les mêmes instructions dans cinq
fichiers est le meilleur moyen d'en avoir quatre obsolètes.

`rebase init` génère les cinq — sous forme de **pointeurs vers un fichier unique
que vous modifiez réellement** :

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

Chaque fichier pointeur comporte trois lignes :

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
Install the Rebase skills for this assistant: `rebase skills install --agent claude`.
```

Les autres ne diffèrent que par le dernier mot de la troisième ligne —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — et par
le chemin relatif, qui est `../ai-instructions.md` dans
`.github/copilot-instructions.md` et `ai-instructions.md` dans `AGENTS.md`.

Cela se produit lors de chaque `rebase init`, pour chaque preset y compris `--headless`.
Il n'y a aucun flag ni aucune invite.

`rebase init` écrit également `.mcp.json`, qui pointe Claude Code, Cursor et
n'importe quel autre client MCP vers le [serveur MCP Rebase](/fr/docs/ai/mcp) :

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

`REBASE_PROJECT_DIR` vaut `"."`, pas un chemin absolu : le client lance le
serveur à la racine du projet, et un chemin absolu est la seule ligne de ce
fichier qui ne peut pas être commitée. Il est là parce que
`~/.rebase/projects.json` vaut pour toute la machine — un projet qui ne nomme
aucun répertoire retombe sur ce que le dernier projet de cette machine y a
enregistré. Voir [la priorité](/fr/docs/ai/mcp#sur-quel-répertoire-il-agit).

## Pourquoi un pointeur plutôt qu'une copie

Les fichiers pointeurs sont délibérément dépourvus de contenu. Les assistants
suivent les liens Markdown relatifs, ainsi un fichier de trois lignes désignant le
fichier réel produit le même résultat qu'une copie — avec des avantages qu'une
copie n'a pas :

- **Un seul fichier à éditer.** Les règles ne peuvent pas diverger entre les
  assistants, car il n'existe qu'un seul ensemble de règles.
- **Un seul diff à relire.** Une modification des conventions du projet concerne
  un seul fichier, et non cinq fichiers identiques qu'un relecteur doit comparer.
- **Ajouter un assistant ne prend que trois lignes.** Un nouvel outil avec un
  nouveau nom de fichier reçoit un pointeur, et non une sixième copie de vos
  conventions.

Ce modèle vaut la peine d'être conservé si vous forkez le modèle de base
(scaffold), et mérite d'être adopté dans des dépôts qui ne sont pas du tout des
projets Rebase.

## Ce que contient initialement `ai-instructions.md`

Le fichier généré est délibérément court — il renvoie à
[`rebase skills install`](/docs/ai/skills) pour plus de détails, puis énonce
les règles que les assistants ne respectent pas assez souvent pour qu'il soit
utile de les répéter au début de chaque session :

1. **Schéma en tant que code.** Les collections sont définies dans
   `config/collections/`. Ne modifiez jamais manuellement le schéma Drizzle
   généré ni les tables Postgres — voir
   [Schéma en tant que code](/docs/architecture/schema-as-code).
2. **La façon d'appliquer un changement de collection dépend de la base de
   données.** Tant que `pnpm dev` tourne, enregistrer le fichier de la collection
   est toute l'étape : le démarrage régénère le schéma Drizzle et crée les tables
   et colonnes manquantes. `pnpm db:push` ne sert qu'à ce que le démarrage laisse
   délibérément de côté — une colonne renommée, un type restreint, un champ
   supprimé, la RLS d'une table de jonction — et il exige votre propre
   PostgreSQL, pas la base de données de développement gérée. En production,
   c'est `pnpm db:generate` puis `pnpm db:migrate`.
3. **Utilisez le SDK.** Passez par `rebase.dataAsAdmin.<slug>` pour le travail
   effectué sous l'identité du service, ou par `getDriver(c)` dans une fonction
   lorsque la lecture doit s'exécuter en tant qu'appelant. Le client serveur n'expose pas
   d'accesseur `data` simple ; le SQL brut et les
   appels Drizzle directs contournent la validation, les callbacks et le RLS.
4. **Protégez chaque route personnalisée.** Les routes dans `backend/functions/`
   sont montées *sans* authentification. Utilisez `requireAuth` / `requireAdmin`
   de `@rebasepro/server/functions` dans l'emplacement middleware propre à la route — lire
   `c.get("user")` n'est pas une protection, tout comme `app.use()` placé après
   la route.

Cette dernière règle est essentielle. C'est la différence entre un middleware
qui s'exécute et un qui ne s'exécute pas, et un assistant qui n'a pas été
prévenu écrira systématiquement la version qui ne s'exécute pas — voir
[Fonctions personnalisées](/docs/backend/custom-functions).

## Personnalisation

`ai-instructions.md` est votre fichier. Rien ne le régénère ni ne l'écrase —
contrairement aux [skills installés](/docs/ai/skills), qui sont remplacés à chaque
`rebase skills install`. Les conventions spécifiques au projet ont leur place ici.

Ce qui mérite d'y figurer est ce qu'un assistant ne peut pas déduire du code :
quelles collections sont héritées (legacy), quel service gère quelle table, la
convention de nommage qui n'est appliquée nulle part, la migration qui ne doit
pas être réexécutée. Restez concis — les instructions chargées à chaque requête
concurrencent la tâche en cours pour l'attention de l'IA, et un fichier trop long
sera simplement survolé.

Et gardez la limite à l'esprit : ce fichier détermine ce qu'un assistant *écrit*.
Il n'a aucun impact sur ce qu'un agent connecté à votre base de données peut *faire*
— cela dépend des identifiants dont il dispose, et aucun contenu Markdown ne peut
changer cela. Consultez
[le modèle d'identifiants du serveur MCP](/docs/ai/mcp#what-the-server-can-reach).

---

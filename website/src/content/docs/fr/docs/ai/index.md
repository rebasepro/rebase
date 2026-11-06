---
sourceHash: ff803e68f256ae11
title: IA & Agents
sidebar_label: Vue d'ensemble
description: Ce que Rebase propose pour les assistants de code IA et les agents autonomes — un serveur MCP, des compétences d'agent locales au projet, des fichiers d'instructions générés et le modèle d'identifiants qui détermine ce qu'un agent peut réellement atteindre.
---

**Pour utiliser Claude avec vos projets Rebase, ajoutez le [connecteur Rebase](/docs/ai/rebase-connector/).**
Dans Claude, ouvrez **Settings → Connectors → Add custom connector**, saisissez
`https://app.rebase.pro/mcp` et connectez-vous avec votre compte Rebase. Vos projets
Rebase Cloud sont immédiatement accessibles ; ajoutez chaque serveur auto-hébergé une seule fois avec
`rebase cloud connect https://your-app.com`. Un seul connecteur permet d'accéder à l'ensemble d'entre eux.

Au-delà de cela, Rebase propose cinq éléments distincts pour les assistants IA, chacun répondant à
des problématiques différentes. Il est utile de savoir vers lequel vous vous orientez :

| | Ce que c'est | Qui le consomme |
|---|---|---|
| [**Connecteur Rebase**](/docs/ai/rebase-connector) | Un connecteur MCP hébergé sur `app.rebase.pro/mcp` pour chaque projet que vous exécutez, sur Rebase Cloud ou auto-hébergé : données, schéma, cron, et sur les déploiements Cloud, environnement et logs | Claude sur le web, desktop et mobile, en votre nom |
| [**Serveur MCP**](/docs/ai/mcp) | Un serveur Model Context Protocol stdio doté de 53 outils couvrant votre schéma, vos données, utilisateurs, stockage, cron, serveur de dev et projet Rebase Cloud | Un assistant, au moment de l'exécution |
| [**Compétences d'agent**](/docs/ai/skills) | 23 fichiers de compétences Markdown écrits dans votre dépôt par `rebase skills install` | Un assistant, comme documentation de référence |
| [**Fichiers d'instructions**](/docs/ai/instruction-files) | `ai-instructions.md` ainsi que des fichiers de référence par assistant, générés par `rebase init` | Un assistant, sous forme de règles permanentes |
| [**Clés d'API**](/docs/backend/api-keys) | Des identifiants machine détenant des [portées (scopes)](/docs/backend/roles-and-scopes), par collection et par opération | Tout système effectuant des appels à l'API HTTP |

Les quatre premiers ont pour but de donner à un assistant des *connaissances* et des *outils*. Le
cinquième est le seul qui détermine ce qu'il a réellement le droit de faire.

## Ce qui compte vraiment : ce à quoi un agent a accès

Un agent doté d'outils sur votre base de données est un appelant d'API ordinaire qui se trouve
décider lui-même de sa prochaine requête. Rebase ne cherche pas à le contraindre par de simples
instructions — un prompt n'est pas un mécanisme de contrôle d'accès, et un agent qui
lit vos lignes lit du texte qu'un tiers a pu écrire. La
contrainte doit exister sous l'agent, au niveau de l'identifiant qu'il utilise.

Rebase soumet cet identifiant à deux barrières indépendantes :

1. **Les portées (scopes) de la clé.** Déclarées par opération *et*, si vous le souhaitez, par
   collection : `data:read:articles`, `data:write:articles`. Le droit `data:delete` est
   séparé de `data:write`, et c'est généralement celui qu'on souhaite refuser
   à un agent par ailleurs autorisé à modifier des données.
2. **La sécurité au niveau des lignes (Row-Level Security / RLS).** Les clés d'API ne contournent pas la RLS. Une clé se connecte avec le
   rôle Postgres `rebase_user` comme n'importe quel autre appelant, de sorte que vos stratégies (policies) déterminent
   toujours quelles lignes sont renvoyées.

Les deux doivent autoriser la requête. L'une ne remplace pas l'autre, et la seconde
est la raison pour laquelle une clé disposant de `data:read` sur chaque collection peut tout de même renvoyer
un résultat vide.

Un piège classique : la propriété `access: "public"` d'une collection élargit **les
lignes qu'un appelant peut voir**, et non **qui a le droit d'appeler**. C'est une règle portant sur la
visibilité des lignes, pas sur l'authentification. L'activer ne confère pas de portée à une clé,
et la désactiver n'en bloque aucune.

Les aspects pratiques — création de clés, choix des portées, rotation, expiration, limites de
taux — sont détaillés dans [Clés d'API](/docs/backend/api-keys).
Ne faites pas l'impasse sur les [Règles de sécurité (RLS)](/docs/collections/security-rules) en chemin ;
la seconde barrière ne vaut que ce que valent les stratégies que vous avez écrites.

:::caution[Le serveur MCP n'utilise pas de clé restreinte par défaut]
Le modèle à deux barrières ci-dessus décrit le fonctionnement d'une clé d'API. Ce n'est **pas** ce que
`@rebasepro/mcp` utilise, à moins que vous ne le configuriez ainsi. Laissé à lui-même, le serveur MCP
s'authentifie avec la **clé de service (service key)** de votre serveur de développement — un identifiant administrateur
sans restriction qui satisfait les stratégies d'administration par défaut sur chaque collection. Consultez
[Ce à quoi le serveur MCP peut accéder](/docs/ai/mcp#what-the-server-can-reach)
avant de diriger un assistant vers un environnement important.
:::

## Recherche vectorielle

Rebase prend en charge de façon native le type de propriété `vector` sur Postgres ainsi qu'une
méthode de requête `.vectorSearch()` avec le calcul de distance `cosine`, `l2` et `inner_product`.
Elle est déjà documentée à deux endroits distincts :

- [Interrogation des données → Recherche vectorielle](/docs/sdk/aggregates-and-search#vector-search) — la méthode
  du SDK, le champ `_distance` ajouté à chaque ligne et les spécificités
- [API REST → Recherche vectorielle](/docs/backend/api#vector-search) — les paramètres
  de requête `vector_search`, `vector`, `vector_distance` et `vector_threshold`

Trois choses à savoir avant de construire autour de cette fonctionnalité. **Rebase stocke et recherche
des plongements (embeddings) ; il ne les calcule pas** — il n'y a aucun fournisseur d'embeddings,
de réglage de modèle ou de clé d'API au sein de Rebase ; la génération des vecteurs est donc votre responsabilité.
**pgvector est un prérequis, et son installation nécessite votre accord (opt-in).**
Indiquer `database({ extensions: ["vector"] })` dans `config/resources.ts` permet à `rebase db
push` et à la validation du schéma au démarrage d'exécuter `CREATE EXTENSION IF NOT EXISTS vector` à votre
place ; sans cela, ils créent la colonne et vous laissent installer l'extension. Dans les deux
cas, le serveur nécessite une image contenant la bibliothèque et un rôle autorisé à l'installer.
Enfin, **chaque colonne vectorielle reçoit un index HNSW pour la
distance cosinus**, car le cosinus est la métrique utilisée par défaut par `vectorSearch` à moins de
fournir explicitement un paramètre `distance` — un index ne sert qu'un seul opérateur. Ajustez-le, ou désactivez-le,
sur la propriété : voir [L'index](/docs/sdk/aggregates-and-search#the-index).

Il n'est pas possible non plus de s'abonner en direct aux requêtes vectorielles ; `.vectorSearch(...).listen()` sera
rejeté avec l'erreur `VECTOR_SEARCH_NOT_LIVE`.

Pour la recherche lexicale — recherche textuelle avec classement sur les champs de votre choix, y compris le contenu JSONB
et les tableaux — voir [Recherche](/docs/backend/search). Il s'agit d'un mécanisme
différent et les deux n'interagissent pas.

## Pour aller plus loin

- [Connecteur Rebase](/docs/ai/rebase-connector) — Claude, connecté à l'ensemble de vos projets
- [Serveur MCP](/docs/ai/mcp) — connectez Claude Code, Cursor ou n'importe quel client MCP
- [Compétences d'agent](/docs/ai/skills) — `rebase skills install` et les 23 compétences
- [Fichiers d'instructions IA](/docs/ai/instruction-files) — le modèle de règles générées

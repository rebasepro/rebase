---
sourceHash: 4040537e5cc9b4d3
title: IA & Agents
sidebar_label: Vue d'ensemble
description: Ce que Rebase fournit pour les assistants de code IA et les agents autonomes — un serveur MCP, des compétences d'agent locales au projet, des fichiers d'instructions échafaudés, et le modèle d'identifiants qui détermine ce qu'un agent peut réellement atteindre.
---

**Pour utiliser Claude avec vos projets Rebase, ajoutez le [connecteur Rebase](/docs/ai/rebase-connector/).**
Dans Claude, ouvrez **Settings → Connectors → Add custom connector**, saisissez
`https://app.rebase.pro/mcp` et connectez-vous avec votre compte Rebase. Vos projets
Rebase Cloud sont immédiatement accessibles ; ajoutez chaque serveur auto-hébergé une seule fois avec
`rebase cloud connect https://your-app.com`. Un seul connecteur permet d'accéder à l'ensemble d'entre eux.

Au-delà de cela, Rebase fournit cinq éléments distincts pour les assistants IA, chacun répondant à
des problématiques différentes. Il est utile de savoir vers lequel vous vous tournez :

| | Ce que c'est | Qui le consomme |
|---|---|---|
| [**Connecteur Rebase**](/docs/ai/rebase-connector) | Un connecteur MCP hébergé sur `app.rebase.pro/mcp` pour chaque projet que vous exécutez, sur Rebase Cloud ou auto-hébergé : données, schéma, cron, et sur les déploiements Cloud, env et logs | Claude sur le web, desktop et mobile, en votre nom |
| [**Serveur MCP**](/docs/ai/mcp) | Un serveur Model Context Protocol stdio avec 53 outils sur votre schéma, vos données, vos utilisateurs, votre stockage, cron, votre serveur de dev et votre projet Rebase Cloud | Un assistant, lors de l'exécution |
| [**Compétences d'agent**](/docs/ai/skills) | 24 fichiers de compétences Markdown écrits dans votre dépôt par `rebase skills install` | Un assistant, comme matériel de référence |
| [**Fichiers d'instructions**](/docs/ai/instruction-files) | `ai-instructions.md` ainsi que des fichiers pointeurs par assistant, créés par `rebase init` | Un assistant, en tant que règles permanentes |
| [**Clés API**](/docs/backend/api-keys) | Identifiants machine détenant des [portées (scopes)](/docs/backend/roles-and-scopes), par table et par opération | Tout ce qui appelle l'API HTTP |

Les quatre premiers visent à donner à un assistant des *connaissances* et des *outils*. Le
cinquième est le seul qui décide de ce qu'il peut réellement faire.

## L'essentiel : ce qu'un agent peut toucher

Un agent disposant d'outils sur votre base de données est un appelant d'API ordinaire qui se trouve
décider lui-même de sa prochaine requête. Rebase n'essaie pas de le contraindre avec
des instructions — un prompt n'est pas un mécanisme de contrôle d'accès, et un agent qui
lit vos lignes lit du texte que quelqu'un d'autre a pu écrire. La
contrainte doit se situer en dessous de l'agent, au niveau des identifiants qu'il transporte.

Rebase associe deux barrières indépendantes à cet identifiant :

1. **Les portées (scopes) de la clé.** Déclarées par opération *et*, si vous le souhaitez, par
   table : `data:read:articles`, `data:write:articles`. `data:delete` est
   distinct de `data:write`, ce qui est généralement ce que vous souhaitez refuser
   à un agent par ailleurs autorisé à modifier des données.
2. **La sécurité au niveau des lignes (Row-Level Security - RLS).** Les clés API ne contournent pas RLS. Une clé se connecte en tant que
   rôle Postgres `rebase_user` comme n'importe quel autre appelant, de sorte que vos stratégies (policies) déterminent toujours
   quelles lignes sont renvoyées.

Les deux doivent autoriser une requête. L'une ne remplace pas l'autre, et la seconde
est la raison pour laquelle une clé détenant `data:read` sur chaque table peut tout de même renvoyer
un ensemble de résultats vide.

Un piège classique : la propriété `access: "public"` d'une table élargit **les
lignes qu'un appelant peut voir**, et non **qui peut appeler**. C'est une déclaration sur la
visibilité des lignes, pas sur l'authentification. L'accorder ne confère pas de portée à une clé,
et la refuser n'en bloque aucune.

Le fonctionnement technique — création de clés, choix des portées, rotation, expiration, limites
de débit — est abordé dans [Clés API](/docs/backend/api-keys).
Ne négligez pas les [Règles de sécurité (RLS)](/docs/collections/security-rules) au
passage ; la seconde barrière ne vaut que par les politiques que vous avez écrites.

:::caution[Le serveur MCP n'utilise pas de clé restreinte par défaut]
Le modèle à deux barrières ci-dessus décrit le fonctionnement d'une clé API. Ce n'est **pas** ce que
`@rebasepro/mcp` utilise par défaut, sauf si vous le configurez ainsi. Par défaut, le serveur MCP
s'authentifie avec la **clé de service** de votre serveur de développement — un identifiant administrateur
sans restriction de portée qui satisfait les stratégies d'administration par défaut sur chaque table. Consultez
[Ce que le serveur MCP peut atteindre](/docs/ai/mcp#what-the-server-can-reach)
avant de diriger un assistant vers un environnement sensible.
:::

## Recherche vectorielle

Rebase propose un type de propriété natif `vector` sur Postgres ainsi qu'une
méthode de requête `.vectorSearch()` prenant en charge les distances `cosine`, `l2` et `inner_product`.
Elle est déjà documentée, à deux endroits plutôt qu'un :

- [Interroger les données → Recherche vectorielle](/docs/sdk/aggregates-and-search#vector-search) — la méthode
  du SDK, le champ `_distance` qu'elle ajoute à chaque ligne et les points de vigilance
- [API REST → Recherche vectorielle](/docs/backend/api#vector-search) — les paramètres de
  requête `vector_search`, `vector`, `vector_distance` et `vector_threshold`

Trois choses à savoir avant de concevoir votre application autour de cette fonctionnalité. **Rebase stocke et recherche
des plongements (embeddings) ; il ne les calcule pas** — il n'y a aucun fournisseur d'embeddings,
paramètre de modèle ou clé d'API nulle part dans Rebase, la génération des vecteurs est donc à votre charge.
**pgvector est un prérequis, et son installation est facultative.**
`database({ extensions: ["vector"] })` dans `backend/resources.ts` permet à `rebase db
push` et à la vérification de schéma au démarrage d'exécuter `CREATE EXTENSION IF NOT EXISTS vector` à votre
place ; sans cela, ils créent la colonne et vous laissent gérer l'extension. Dans les deux
cas, le serveur a besoin d'une image contenant la bibliothèque et d'un rôle autorisé à l'installer.
De plus, **chaque colonne vectorielle reçoit un index HNSW pour
la distance cosinus**, car le cosinus est ce que `vectorSearch` mesure à moins que
vous ne spécifiez `distance` — un index ne sert qu'un seul opérateur. Ajustez-le, ou désactivez-le,
sur la propriété : voir [L'index](/docs/sdk/aggregates-and-search#the-index).

Il n'est pas non plus possible de s'abonner à des requêtes vectorielles ; `.vectorSearch(...).listen()` est
rejeté avec l'erreur `VECTOR_SEARCH_NOT_LIVE`.

Pour la recherche lexicale — recherche en texte intégral classée sur les champs que vous désignez, y compris
le contenu JSONB et les tableaux — consultez [Recherche](/docs/backend/search). Il s'agit d'un mécanisme
différent et les deux n'interagissent pas.

## Pour aller plus loin

- [Connecteur Rebase](/docs/ai/rebase-connector) — Claude, connecté à chacun de vos projets
- [Serveur MCP](/docs/ai/mcp) — connectez Claude Code, Cursor ou n'importe quel client MCP
- [Compétences d'agent](/docs/ai/skills) — `rebase skills install` et les 24 compétences
- [Fichiers d'instructions IA](/docs/ai/instruction-files) — le modèle de règles générées

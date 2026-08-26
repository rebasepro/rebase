---
title: IA et Agents
sidebar_label: Vue d'ensemble
description: Ce que Rebase propose pour les assistants de code IA et les agents autonomes — un serveur MCP, des compétences d'agent locales au projet, des fichiers d'instructions échafaudés et le modèle d'identifiants qui détermine ce à quoi un agent peut réellement accéder.
---

Rebase fournit quatre éléments distincts pour les assistants IA, et ils répondent
à des besoins différents. Il est utile de savoir auquel vous faites appel :

| | Ce que c'est | Qui le consomme |
|---|---|---|
| [**Serveur MCP**](/docs/ai/mcp) | Un serveur stdio Model Context Protocol avec 40 outils couvrant votre schéma, vos données, utilisateurs, stockage, cron et serveur de dev | Un assistant, au runtime |
| [**Compétences d'agent**](/docs/ai/skills) | 20 fichiers de compétences Markdown écrits dans votre dépôt par `rebase skills install` | Un assistant, en tant que documentation de référence |
| [**Fichiers d'instructions**](/docs/ai/instruction-files) | `ai-instructions.md` ainsi que des fichiers pointeurs par assistant, générés par `rebase init` | Un assistant, en tant que règles permanentes |
| [**Clés d'API**](/docs/backend/api#api-keys) | Identifiants machine délimités, par collection et par opération | Tout ce qui appelle l'API HTTP |

Les trois premiers visent à fournir à un assistant des *connaissances* et des
*outils*. Le quatrième est le seul qui détermine ce qu'il est réellement autorisé à
faire.

## Ce qui compte : ce à quoi un agent peut toucher

Un agent disposant d'outils sur votre base de données est un appelant d'API
ordinaire qui se trouve simplement décider de sa propre requête suivante. Rebase
n'essaie pas de le contraindre avec des instructions — un prompt n'est pas un
mécanisme de contrôle d'accès, et un agent qui lit vos lignes lit du texte que
quelqu'un d'autre a pu écrire. La contrainte doit se situer en dessous de
l'agent, dans l'identifiant qu'il utilise.

Rebase applique deux barrières indépendantes à cet identifiant :

1. **La liste des permissions de la clé d'API.** Déclarée par collection *et* par
   opération, où `delete` est dissociable de `write` — ce qui est généralement
   ce que vous souhaitez refuser à un agent qui a par ailleurs le droit de modifier.
2. **Row-Level Security (RLS).** Les clés d'API ne contournent pas la RLS. Une
   clé se connecte sous le rôle Postgres `rebase_user` comme n'importe quel autre
   appelant, de sorte que vos stratégies déterminent toujours quelles lignes sont
   renvoyées.

Les deux doivent autoriser une requête. Aucune ne remplace l'autre, et la seconde
est la raison pour laquelle une clé avec des permissions `"*"` peut quand même
renvoyer un jeu de résultats vide.

Un piège classique : le paramètre `access: "public"` d'une collection élargit
**les lignes qu'un appelant peut voir**, pas **qui peut appeler**. Il s'agit d'une
déclaration sur la visibilité des lignes, non sur l'authentification. L'accorder
n'ajoute pas un appelant à la liste des permissions, et le refuser ne bloque pas
un appelant.

Le fonctionnement — création de clés, JSON des permissions, rotation,
expiration, limites de débit — est détaillé dans [REST API → API Keys](/docs/backend/api#api-keys).
Ne négligez pas [Security Rules (RLS)](/docs/collections/security-rules) au passage ;
la seconde barrière ne vaut que ce que valent les stratégies que vous avez écrites.

:::caution[Le serveur MCP n'utilise pas par défaut une clé délimitée]
Le modèle à deux barrières ci-dessus décrit le fonctionnement d'une clé d'API. Ce
n'est **pas** ce que `@rebasepro/mcp` utilise, sauf si vous le configurez
explicitement pour cela. Par défaut, le serveur MCP s'authentifie avec la **clé
de service** (service key) de votre serveur de dev — un identifiant administrateur
sans restriction qui satisfait les stratégies d'administration par défaut sur
chaque collection. Consultez [What the MCP server can reach](/docs/ai/mcp#what-the-server-can-reach)
avant de diriger un assistant vers des données sensibles.
:::

## Recherche vectorielle

Rebase propose un type de propriété natif `vector` sur Postgres et une méthode
de requête `.vectorSearch()` avec les distances `cosine`, `l2` et `inner_product`.
Cela est déjà documenté à deux endroits différents :

- [Querying Data → Vector Search](/docs/sdk/querying#vector-search) — la méthode
  du SDK, le champ `_distance` qu'elle ajoute à chaque ligne et les mises en garde
- [REST API → Vector Search](/docs/backend/api#vector-search) — les paramètres
  de requête `vector_search`, `vector`, `vector_distance` et `vector_threshold`

Trois choses à savoir avant de concevoir votre architecture autour de cela.
**Rebase stocke et recherche des embeddings ; il ne les calcule pas** — il n'y a
aucun fournisseur d'embeddings, paramètre de modèle ou clé d'API dans Rebase, la
génération des vecteurs est donc de votre ressort. **pgvector est un prérequis.**
L'image de base de données du scaffold l'embarque, un projet créé par
`rebase init` n'a donc rien à faire ici ; pointé vers une base provisionnée par
quelqu'un d'autre, il vous faut une image portant l'extension et un rôle
autorisé à exécuter `CREATE EXTENSION vector;` une fois — Rebase n'installe pas
d'extensions à votre place. Et **chaque colonne vectorielle reçoit un index HNSW
pour la distance cosinus**, car c'est avec le cosinus que `vectorSearch` mesure
sauf si vous passez `distance` — un index ne sert qu'un seul opérateur. Réglez-le,
ou désactivez-le, sur la propriété : voir
[L'index](/docs/sdk/querying#the-index).

Il n'est pas non plus possible de s'abonner aux requêtes vectorielles ;
`.vectorSearch(...).listen()` est refusé avec l'erreur `VECTOR_SEARCH_NOT_LIVE`.

Pour la recherche lexicale — recherche plein texte classée sur les champs que vous
désignez, y compris le contenu JSONB et les tableaux — consultez [Search](/docs/backend/search).
Il s'agit d'un mécanisme différent et les deux n'interagissent pas.

## Où aller ensuite

- [Serveur MCP](/docs/ai/mcp) — connecter Claude Code, Cursor ou tout client MCP
- [Compétences d'agent](/docs/ai/skills) — `rebase skills install` et les 20 compétences
- [Fichiers d'instructions IA](/docs/ai/instruction-files) — le modèle de règles échafaudées

---

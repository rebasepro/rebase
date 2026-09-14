---
sourceHash: ec9977f5b00dc133
title: IA et agents
sidebar_label: Aperçu
description: Ce que Rebase fournit pour les assistants de code IA et les agents autonomes — un serveur MCP, des compétences d'agent locales au projet, des fichiers d'instructions échafaudés et le modèle d'identifiants qui détermine ce à quoi un agent peut réellement accéder.
---

Rebase fournit quatre éléments distincts pour les assistants IA, et ils répondent à des
problèmes différents. Il est utile de savoir lequel vous utilisez :

| | Ce que c'est | Qui le consomme |
|---|---|---|
| [**Serveur MCP**](/docs/ai/mcp) | Un serveur Model Context Protocol stdio doté de 42 outils couvrant votre schéma, vos données, vos utilisateurs, votre stockage, vos crons et votre serveur de développement | Un assistant, au moment de l'exécution |
| [**Compétences d'agent**](/docs/ai/skills) | 21 fichiers de compétences Markdown écrits dans votre dépôt par `rebase skills install` | Un assistant, comme documentation de référence |
| [**Fichiers d'instructions**](/docs/ai/instruction-files) | `ai-instructions.md` ainsi que des fichiers de pointeurs spécifiques à chaque assistant, générés par `rebase init` | Un assistant, comme règles permanentes |
| [**Clés d'API**](/docs/backend/api-keys) | Identifiants machine restreints, par collection et par opération | Tout ce qui appelle l'API HTTP |

Les trois premiers visent à fournir à un assistant des *connaissances* et des *outils*. Le
quatrième est le seul qui détermine ce qu'il est réellement autorisé à faire.

## Ce qui compte vraiment : ce à quoi un agent peut toucher

Un agent disposant d'outils sur votre base de données est un appelant d'API ordinaire qui se
trouve décider de sa propre requête suivante. Rebase n'essaie pas de le contraindre avec
des instructions — un prompt n'est pas un mécanisme de contrôle d'accès, et un agent qui
lit vos lignes lit du texte que quelqu'un d'autre a pu écrire. La contrainte
doit résider en dessous de l'agent, dans les identifiants qu'il transporte.

Rebase attribue à cet identifiant deux barrières indépendantes :

1. **La liste des permissions de la clé d'API.** Déclarée par collection *et* par opération,
   où `delete` est séparable de `write` — qui est généralement celle que vous souhaitez
   refuser à un agent par ailleurs autorisé à modifier.
2. **La sécurité au niveau des lignes (RLS).** Les clés d'API ne contournent pas la RLS. Une
   clé se connecte sous le rôle Postgres `rebase_user` comme n'importe quel autre appelant,
   de sorte que vos politiques déterminent toujours quelles lignes sont renvoyées.

Les deux doivent autoriser une requête. L'une ne remplace pas l'autre, et la seconde
est la raison pour laquelle une clé avec des permissions `"*"` peut toujours renvoyer
un ensemble de résultats vide.

Un piège classique : `access: "public"` sur une collection élargit **les lignes qu'un appelant
peut voir**, et non **qui peut appeler**. C'est une déclaration sur la visibilité des lignes,
pas sur l'authentification. L'accorder n'ajoute pas un appelant à la liste des permissions,
et le refuser n'en bloque aucun.

Le fonctionnement détaillé — création de clés, JSON des permissions, rotation, expiration, limites
de débit — est couvert dans [API REST → Clés d'API](/docs/backend/api-keys).
Ne sautez pas [Règles de sécurité (RLS)](/docs/collections/security-rules) au passage ;
la deuxième barrière n'est efficace que si les politiques que vous avez écrites le sont.

:::caution[Le serveur MCP n'utilise pas par défaut une clé restreinte]
Le modèle à deux barrières ci-dessus décrit le fonctionnement d'une clé d'API. Ce n'est **pas**
ce que `@rebasepro/mcp` utilise, sauf si vous le configurez pour cela. Par défaut, le serveur MCP
s'authentifie avec la **clé de service** de votre serveur de développement — un identifiant
administrateur sans restriction qui satisfait les politiques administrateur par défaut sur chaque
collection. Consultez [Ce à quoi le serveur MCP peut accéder](/docs/ai/mcp#what-the-server-can-reach)
avant de pointer un assistant vers des données importantes.
:::

## Recherche vectorielle

Rebase intègre un type de propriété natif `vector` sur Postgres et une
méthode de requête `.vectorSearch()` prenant en charge les distances `cosine`, `l2` et `inner_product`.
Cela est déjà documenté, à deux endroits différents :

- [Interroger les données → Recherche vectorielle](/docs/sdk/aggregates-and-search#vector-search) — la méthode
  du SDK, le champ `_distance` qu'elle ajoute à chaque ligne et les points d'attention
- [API REST → Recherche vectorielle](/docs/backend/api#vector-search) — les
  paramètres de requête `vector_search`, `vector`, `vector_distance` et `vector_threshold`

Trois choses à savoir avant de concevoir votre application autour de cette fonctionnalité. **Rebase stocke et cherche des
embeddings ; il ne les calcule pas** — il n'y a aucun fournisseur d'embeddings,
paramètre de modèle ou clé d'API au sein de Rebase, la génération des vecteurs est donc de votre ressort.
**pgvector est un prérequis, et son installation est facultative.**
`database({ extensions: ["vector"] })` dans `config/resources.ts` permet à `rebase db
push` et à la vérification du schéma au démarrage d'exécuter `CREATE EXTENSION IF NOT EXISTS vector` pour
vous ; sans cela, ils créent la colonne et vous laissent gérer l'extension. Dans les deux cas,
le serveur nécessite une image contenant la bibliothèque et un rôle autorisé à l'installer.
Et **chaque colonne vectorielle reçoit un index HNSW pour la distance cosinus**,
car le cosinus est ce que `vectorSearch` mesure sauf si vous spécifiez `distance` — un index ne dessert
qu'un seul opérateur. Ajustez-le, ou désactivez-le, au niveau de la propriété : voir [L'index](/docs/sdk/aggregates-and-search#the-index).

Il n'est pas non plus possible de s'abonner aux requêtes vectorielles ; `.vectorSearch(...).listen()`
est refusé avec l'erreur `VECTOR_SEARCH_NOT_LIVE`.

Pour la recherche lexicale — recherche en texte intégral classée sur les champs que vous spécifiez,
y compris le contenu JSONB et les tableaux — consultez [Recherche](/docs/backend/search). Il s'agit
d'un mécanisme distinct et les deux n'interagissent pas.

## Où aller ensuite

- [Serveur MCP](/docs/ai/mcp) — connecter Claude Code, Cursor ou n'importe quel client MCP
- [Compétences d'agent](/docs/ai/skills) — `rebase skills install` et les 21 compétences
- [Fichiers d'instructions pour l'IA](/docs/ai/instruction-files) — le modèle de règles échafaudées

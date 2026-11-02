---
sourceHash: f0b5790a3df6501a
title: IA & Agents
sidebar_label: Aperçu
description: Ce que Rebase propose pour les assistants de code IA et les agents autonomes — un serveur MCP, des compétences d'agent locales au projet, des fichiers d'instructions générés, et le modèle d'identifiants qui détermine ce qu'un agent peut réellement atteindre.
---

Rebase propose quatre éléments distincts pour les assistants IA, et ils répondent à des
problèmes différents. Il convient de bien comprendre lequel vous utilisez :

| | Ce que c'est | Qui le consomme |
|---|---|---|
| [**Serveur MCP**](/docs/ai/mcp) | Un serveur Model Context Protocol stdio avec 53 outils couvrant votre schéma, vos données, utilisateurs, stockage, tâches cron, serveur de dev et projet Rebase Cloud | Un assistant, à l'exécution |
| [**Compétences d'agent**](/docs/ai/skills) | 23 fichiers de compétences Markdown écrits dans votre dépôt par `rebase skills install` | Un assistant, comme matériel de référence |
| [**Fichiers d'instructions**](/docs/ai/instruction-files) | `ai-instructions.md` ainsi que des fichiers de référence par assistant, créés par `rebase init` | Un assistant, comme règles actives en permanence |
| [**Clés d'API**](/docs/backend/api-keys) | Des identifiants machine dotés de [portées (scopes)](/docs/backend/roles-and-scopes), par collection et par opération | Tout ce qui appelle l'API HTTP |

Les trois premiers visent à fournir à un assistant des *connaissances* et des *outils*. Le
quatrième est le seul qui détermine ce qu'il est réellement autorisé à faire.

## La partie essentielle : ce à quoi un agent a le droit de toucher

Un agent doté d'outils sur votre base de données est un client API ordinaire qui décide
lui-même de sa prochaine requête. Rebase n'essaie pas de le restreindre à l'aide
d'instructions — un prompt n'est pas un mécanisme de contrôle d'accès, et un agent qui
lit vos lignes lit du texte que quelqu'un d'autre a pu écrire. La
contrainte doit se situer en dessous de l'agent, au niveau de l'identifiant qu'il utilise.

Rebase applique deux contrôles indépendants à cet identifiant :

1. **Les portées (scopes) de la clé.** Déclarées par opération *et*, si vous le souhaitez, par
   collection : `data:read:articles`, `data:write:articles`. `data:delete` est
   distinct de `data:write`, qui est généralement celui que vous voulez refuser
   à un agent qui a par ailleurs le droit de modifier des données.
2. **La sécurité au niveau des lignes (Row-Level Security ou RLS).** Les clés d'API ne contournent pas la RLS. Une clé se connecte avec le
   rôle Postgres `rebase_user` comme n'importe quel autre appelant, de sorte que vos stratégies déterminent
   toujours quelles lignes sont renvoyées.

Les deux doivent autoriser une requête. Aucun ne remplace l'autre, et le second
est la raison pour laquelle une clé possédant `data:read` sur chaque collection peut quand même renvoyer
un ensemble de résultats vide.

Un piège fréquent : le paramètre `access: "public"` d'une collection élargit **les
lignes qu'un appelant peut voir**, et non **qui a le droit d'appeler**. C'est une déclaration sur la
visibilité des lignes, pas sur l'authentification. L'accorder ne donne pas de scope à une clé,
et le retirer n'en bloque aucun.

Le fonctionnement pratique — création de clés, choix des scopes, rotation, expiration, limites
de débit — est abordé dans [Clés d'API](/docs/backend/api-keys).
Ne manquez pas au passage [Règles de sécurité (RLS)](/docs/collections/security-rules) ;
le second contrôle n'est efficace qu'à la hauteur des stratégies que vous avez écrites.

:::caution[Le serveur MCP n'utilise pas de clé restreinte par défaut]
Le modèle à deux niveaux ci-dessus décrit le fonctionnement d'une clé d'API. Ce n'est **pas** ce que
`@rebasepro/mcp` utilise, à moins que vous ne le configuriez ainsi. Par défaut, le serveur MCP
s'authentifie avec la **clé de service** de votre serveur de développement — un identifiant administrateur sans scope
qui satisfait les politiques d'administration par défaut sur chaque collection. Consultez
[Ce que le serveur MCP peut atteindre](/docs/ai/mcp#what-the-server-can-reach)
avant de pointer un assistant vers quoi que ce soit d'important.
:::

## Recherche vectorielle (Vector search)

Rebase propose un type de propriété `vector` natif sur Postgres et une
méthode de requête `.vectorSearch()` avec les distances `cosine`, `l2` et `inner_product`.
Elle est déjà documentée, à deux endroits plutôt qu'un :

- [Interroger les données → Recherche vectorielle](/docs/sdk/aggregates-and-search#vector-search) — la méthode
  du SDK, le champ `_distance` qu'elle ajoute à chaque ligne, et les mises en garde
- [API REST → Recherche vectorielle](/docs/backend/api#vector-search) — les
  paramètres de requête `vector_search`, `vector`, `vector_distance` et `vector_threshold`

Trois choses à savoir avant de concevoir autour de cette fonctionnalité. **Rebase stocke et recherche les
embeddings ; il ne les calcule pas** — il n'y a aucun fournisseur d'embeddings, paramètre de modèle
ou clé d'API dans Rebase, la production des vecteurs est donc à votre charge.
**pgvector est un prérequis, et son installation est facultative.**
`database({ extensions: ["vector"] })` dans `config/resources.ts` permet à `rebase db
push` et à la vérification de schéma au démarrage d'exécuter `CREATE EXTENSION IF NOT EXISTS vector` à votre
place ; sans cela, ils créent la colonne et vous laissent gérer l'extension. Dans les deux
cas, le serveur nécessite une image contenant la bibliothèque et un rôle autorisé à l'installer.
Et **chaque colonne vectorielle reçoit un index HNSW pour la
distance cosinus**, car le cosinus est la mesure utilisée par `vectorSearch` à moins
que vous ne précisiez `distance` — un index ne sert qu'un seul opérateur. Ajustez-le, ou désactivez-le,
sur la propriété : voir [L'index](/docs/sdk/aggregates-and-search#the-index).

Les requêtes vectorielles ne permettent pas non plus de s'abonner en temps réel ; `.vectorSearch(...).listen()` est
rejeté avec l'erreur `VECTOR_SEARCH_NOT_LIVE`.

Pour la recherche lexicale — recherche textuelle classée (full-text) sur les champs de votre choix, y compris le contenu
JSONB et les tableaux — consultez [Recherche](/docs/backend/search). C'est un mécanisme
différent et les deux n'interagissent pas.

## Où aller ensuite

- [Serveur MCP](/docs/ai/mcp) — connecter Claude Code, Cursor ou n'importe quel client MCP
- [Compétences d'agent](/docs/ai/skills) — `rebase skills install` et les 23 compétences
- [Fichiers d'instructions IA](/docs/ai/instruction-files) — le modèle de règles générées

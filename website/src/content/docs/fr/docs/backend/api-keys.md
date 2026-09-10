---
sourceHash: 87d15c9eb4314422
title: Clés API
sidebar_label: Clés API
description:"\"Clés restreintes et révocables pour les appelants machine : ce à quoi une clé peut accéder, comment les portées s'articulent avec la sécurité au niveau des lignes (RLS), et les endpoints d'administration qui les gèrent.\""
---

## Clés API

Les clés API fournissent une authentification de machine à machine pour les agents, les serveurs MCP, les pipelines CI et les intégrations externes. Elles prennent en charge la définition de permissions par collection et un accès administrateur complet optionnel.

### Création d'une clé API

```bash
# Via CLI
rebase api-keys create --name "My Integration" \
  --permissions '[{"collection":"orders","operations":["read","write"]}]'

# Via REST (requires admin auth)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "permissions": [{ "collection": "orders", "operations": ["read", "write"] }]
  }'
```

La réponse inclut la clé complète en texte brut (`rk_live_...`) **exactement une fois** — enregistrez-la immédiatement.

### Utilisation d'une clé API

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Permissions et RLS : deux barrières indépendantes

La requête d'une clé API passe par **deux** vérifications d'autorisation, et les deux doivent l'autoriser :

1. **La liste de permissions de la clé** — collection × opération, vérifiée au niveau de la couche de routage.
2. **La sécurité au niveau des lignes (Row-Level Security / RLS)** — Les clés API ne contournent *pas* le RLS. Une clé s'exécute en tant que
   `uid: "api-key:<id>"` avec le rôle `service` (plus `admin` lorsque
   `admin: true`). Les clés admin passent via les stratégies admin intégrées ; une
   clé non-admin ne voit que les lignes qu'une règle de sécurité accorde explicitement
   au rôle `service` ou au public. Les règles basées sur le propriétaire
   (`owner_id = rebase.uid()`) ne correspondent jamais à une clé API.

Ainsi, une clé non-admin avec les permissions `"*"` peut toujours obtenir des résultats vides — c'est
le RLS qui fonctionne normalement, pas un bug. Accordez le rôle `service` dans les
règles de sécurité des collections concernées, ou utilisez une clé admin.

### Fonctions personnalisées

Les invocations de fonctions ont une portée définie comme les collections, sous l'espace de noms
`functions` : `{"collection": "functions", "operations": ["write"]}` donne accès à toutes les
fonctions, `"functions/<name>"` en autorise une, et le caractère générique global `"*"` les autorise
toutes. Une clé sans une telle entrée ne peut pas du tout invoquer de fonctions.

### Stockage

Le stockage fonctionne de la même manière, sous l'espace de noms `storage` :
`{"collection": "storage", "operations": ["read", "write"]}` permet à la clé de
télécharger/lister (`read`), téléverser et créer des dossiers (`write`), et supprimer des fichiers
(`delete`). Le caractère générique global `"*"` accorde également l'accès au stockage. Une clé sans
une telle entrée ne peut pas interagir avec le stockage. Les routes d'envoi avec reprise TUS comptent comme `write`
pour chaque étape (y compris la vérification du décalage et l'annulation), de sorte qu'une clé avec la portée d'écriture
peut effectuer un téléversement par elle-même.

### Agents et serveurs MCP

Un agent a besoin de la clé la plus *restreinte* possible pour accomplir sa tâche, et non d'une clé admin. Commencez
avec une portée limitée et définissez une date d'expiration :

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Les opérations sont `read`, `write` et `delete`, dérivées de la méthode HTTP :
`GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` →
`delete`.

#### Une clé restreinte lit zéro ligne tant qu'une règle n'accorde pas `service`

C'est l'étape qui donne l'impression qu'une clé correctement configurée ne fonctionne pas. Une clé non-admin
s'exécute avec `uid: "api-key:<id>"` et les rôles `["service"]`, et la stratégie RLS
injectée par défaut dans chaque collection compile vers :

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

— le contexte serveur, ou un administrateur. Une clé non-admin ne correspond à aucune des deux branches, de sorte que sur une
collection sans `securityRules`, la requête réussit avec un ensemble de résultats vide
et sans aucune erreur explicative. Accordez le rôle explicitement :

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Puisque `rebase.uid()` transporte l'identifiant de la clé, une règle peut également restreindre les lignes à une
clé spécifique :

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### N'utilisez pas `"*"` pour une clé en lecture seule

Le caractère générique `"*"` ne signifie pas « toutes les collections » — il correspond également à l'espace de noms
`functions` et à `storage`. Un `GET` compte comme `read`, et le gestionnaire d'une fonction
personnalisée est un code arbitraire pouvant effectuer des écritures ; ainsi, une clé « en lecture seule »
avec un caractère générique peut opérer des mutations via une fonction. Nommer explicitement les collections ne donne aucun
accès aux fonctions à la clé.

#### `--admin --full-access` : CI, migrations, outils internes

`"admin": true` accorde à la clé le rôle admin — les routes `/api/admin/*` pour la gestion
des schémas, la gestion des utilisateurs et plus encore, ainsi que le cron, les sauvegardes et les journaux. Combiné
avec `--full-access` (`{"collection": "*", "operations": ["read", "write",
"delete"]}`), la clé détient l'accès à chaque collection ainsi qu'à l'intégralité du stockage et à chaque fonction
personnalisée. C'est la configuration idéale pour la CI, les migrations et les outils internes
de confiance — pas pour les agents.

```bash
# CLI
rebase api-keys create -n "CI" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

#### Pas de temps réel via les clés API

Le WebSocket temps réel n'analyse pas les jetons `rk_` — il n'accepte que les JWT utilisateur et
la clé de service. Un agent authentifié avec une clé API effectue des requêtes périodiques (polling) sur les
endpoints REST au lieu de s'abonner.

### Options des clés

| Champ | Type | Description |
|---|---|---|
| `name` | `string` | Libellé lisible par l'humain |
| `permissions` | `ApiKeyPermission[]` | Accès par collection (`"*"` = tout ; `"functions/<name>"` = une fonction ; `"storage"` = stockage de fichiers) |
| `admin` | `boolean` | Accorde le rôle admin — routes admin + politiques RLS admin |
| `rate_limit` | `number \| null` | Requêtes par fenêtre de 15 min (`null` = valeur par défaut du serveur, 1000) |
| `expires_at` | `string \| null` | Horodatage d'expiration ISO-8601 |

Le CLI nécessite une portée explicite : passez `--permissions '<json>'` ou choisissez
`--full-access` — il n'y a pas d'accès complet silencieux par défaut.

Les clés peuvent être listées, mises à jour et révoquées via `/api/admin/api-keys` ou les
commandes CLI `rebase api-keys` — mais pas par une clé API. Toute requête vers
`/api/admin/api-keys` authentifiée avec une clé `rk_` est refusée avec `403
API_KEY_SELF_MANAGEMENT_FORBIDDEN`, quel que soit son indicateur `admin`. La gestion des clés
nécessite la session d'un utilisateur administrateur ou la clé de service.

## Prochaines étapes

- [API REST](/docs/backend/api/) — les endpoints qu'une clé appelle
- [Index des endpoints](/docs/backend/endpoints/) — le contrôle d'accès sur chaque route, clés comprises
- [Règles de sécurité (RLS)](/docs/collections/security-rules/) — ce que la base de données applique en plus des portées d'une clé

---

---
sourceHash: 3daf2012ee7cd662
title: Fonctions SQL en tant que RPC
sidebar_label: Fonctions SQL (RPC)
description: "Exposer une fonction Postgres sur POST /api/rpc/<name> avec defineRpc : déclarée par fonction, arguments validés, exécutée en tant qu'appelant sous la sécurité au niveau des lignes, celles publiques limitées en débit."
---

<span class="since-badge" data-since="0.35">Depuis 0.35</span>

Une fonction SQL déclarée avec `defineRpc` est exposée à l'adresse `POST /api/rpc/<name>`,
avec ses arguments nommés dans le corps JSON. Elle s'exécute en tant qu'appelant, de la même façon
que `getSql(c)` : un appelant anonyme avec l'identité anonyme, un utilisateur connecté en
tant que lui-même, de sorte que la sécurité au niveau des lignes (row-level security) des tables s'applique au sein de la fonction,
et une fonction `SECURITY DEFINER` s'exécute en tant que son propriétaire. C'est ce que fait
`supabase.rpc('fn', args)`, sans avoir à écrire un gestionnaire par fonction.

Seules les fonctions déclarées peuvent être appelées. Une fonction présente dans la base de données
mais qui n'a pas été déclarée renvoie `404 RPC_NOT_FOUND`.

## Déclarer une fonction

<span class="since-badge" data-since="0.35">Depuis 0.35</span>

Les déclarations résident aux côtés des tables, dans `backend/schema/`, et l'index du schéma
les exporte :

```typescript
// backend/schema/rpc.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",
    args: { token: json.string().required() }
});

export const myTrips = defineRpc("my_trips", {
    access: "authenticated",
    args: { from: json.date(), limit: json.number().validate({ integer: true, max: 100 }) }
});

export const bookTrip = defineRpc("book_trip", {
    access: "authenticated",
    write: true,
    args: { trip_id: json.number().required() }
});
```

```typescript
// backend/schema/index.ts
export * from "./rpc";
```

La fonction elle-même est du SQL que vous créez dans la base de données, par exemple à partir d'un fichier
situé sous `backend/sql/` :

```sql
CREATE OR REPLACE FUNCTION public.get_public_proposal(token text)
RETURNS public.proposals
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.proposals p WHERE p.share_token = get_public_proposal.token $$;
```

Le nom correspond au nom de la fonction tel que Postgres le stocke (un
`CREATE FUNCTION getProposal` sans guillemets est stocké sous la forme `getproposal`), et constitue également le segment d'URL.
`schema` vaut `"public"` par défaut. Tout comme pour une table, un RPC défini dans un fichier
sous `backend/schema/` qui n'est pas exporté par l'index interrompt le démarrage, tout comme
un nom déclaré deux fois.

| Option | Signification |
|---|---|
| `access` | Requis. `"public"` : n'importe qui, connecté ou non, toujours limité en débit. `"authenticated"` : tout appelant disposant d'une identité (une session, une session invité, une clé API, la clé de service) ; un appelant anonyme reçoit une `401` |
| `args` | Les arguments nommés, un champ `json.*` par paramètre SQL. Absent : la fonction n'en prend aucun |
| `schema` | Le schéma Postgres dans lequel se trouve la fonction. Par défaut `"public"` |
| `write` | Exécuter l'appel en lecture-écriture. Désactivé par défaut : l'appel est en lecture seule et peut être servi par un réplica de lecture |
| `rateLimit` | `{ limit, windowMs }` par appelant pour cette fonction. Un RPC public qui n'en définit pas est limité à 120 appels par minute |
| `description` | Ce qu'elle fait, pour quiconque lit les déclarations |

## Appeler une fonction

Depuis le SDK :

```typescript
const proposal = await rebase.rpc<Proposal | null>("get_public_proposal", { token });
const trips = await rebase.rpc<Trip[]>("my_trips", { limit: 20 });
```

Via HTTP :

```bash
curl -X POST https://your-app.example.com/api/rpc/get_public_proposal \
  -H "content-type: application/json" \
  -d '{"token": "f1c2…"}'
```

Un appel authentifié envoie son jeton comme sur n'importe quelle autre route. Les arguments peuvent être
typés à partir de la déclaration, que le frontend importe en tant que type uniquement :

```typescript
import type { RpcArgs } from "@rebasepro/server/schema";
import type { myTrips } from "../../backend/schema/rpc";

const args: RpcArgs<typeof myTrips> = { limit: 20 };
const trips = await rebase.rpc<Trip[]>("my_trips", args);
```

## Arguments

Le corps de la requête est vérifié par rapport à `args` avant que quoi que ce soit n'atteigne la base de données. Une clé
non mentionnée dans `args`, un argument `.required()` manquant et une valeur d'un type incorrect
(un nombre pour `json.string()`, une chaîne qui n'est pas une date pour
`json.date()`) sont rejetés avec un code `400 VALIDATION_CONSTRAINT`, chaque
violation nommant son champ (`filters.from`, `tags[2]`). Les règles acceptées par une colonne JSON
s'appliquent également : `.validate({ min, max, pattern, … })`, `.oneOf([...])`.

Un argument omis n'est pas transmis, de sorte que le `DEFAULT` propre à la fonction SQL
s'applique ; un `.default(value)` sur le champ le renseigne à la place. Un argument envoyé avec
la valeur `null` est transmis sous la forme `NULL`.

Les valeurs parviennent à la fonction sous la forme d'un unique paramètre lié, un objet JSON que
Postgres convertit dans les types de paramètres de la fonction (`json_to_record`) ; ainsi, un
tableau devient un `integer[]`, un objet un `jsonb`, une chaîne ISO un
`timestamptz`. Elles ne sont jamais directement injectées dans le texte de l'instruction. Une valeur
que Postgres ne peut pas interpréter selon le type du paramètre renvoie `400 RPC_INVALID_ARGUMENT`.

## Ce qu'elle renvoie

La réponse correspond au type de retour de la fonction, comme avec PostgREST :

| La fonction renvoie | La réponse |
|---|---|
| `SETOF <table>`, `TABLE (…)` | un tableau de lignes |
| `SETOF integer` (toute valeur unique) | un tableau de valeurs |
| un type ligne ou des paramètres `OUT` | la ligne, ou `null` lorsqu'elle vaut `NULL` |
| une valeur unique (`bigint`, `text`, `jsonb`, …) | la valeur |
| `void` | `null` |

Les valeurs sont formatées comme le fait `/api/data` : un `timestamptz` au format RFC 3339, un
`bigint` sous forme de nombre lorsqu'il rentre dans les limites autorisées.

## Identité d'exécution

Chaque appel ouvre une transaction au nom de l'appelant, avec la même identité que celle
utilisée par l'API de données. Ainsi, une fonction `SECURITY INVOKER` (par défaut) voit exactement les lignes
que les politiques de l'appelant lui permettent de voir, et `rebase.uid()` à l'intérieur de celle-ci correspond à l'appelant.
Un appelant anonyme d'un RPC public s'exécute sous l'identité anonyme : une politique
qui exige un utilisateur lui masquera toutes les lignes. Une fonction `SECURITY DEFINER`
s'exécute sous le rôle de son propriétaire, ce qui permet à une fonction de transmettre une ligne à un
appelant anonyme via un jeton sans lui ouvrir l'accès à la table.

Une clé API qui restreint ses permissions a besoin de `data:read` pour appeler un RPC, ou
de `data:write` pour un RPC déclaré avec `write: true`, sans restriction : une fonction lit
toutes les tables qu'elle a besoin de lire.

## Écritures

Un appel s'exécute en lecture seule, sauf si le RPC spécifie `write: true`. Une fonction qui
insère, met à jour ou supprime des données sans cela échoue avec l'erreur `500 RPC_READ_ONLY`. Une écriture
reste soumise aux politiques d'insertion et de mise à jour des tables en tant qu'appelant.

## Limites de débit

Chaque RPC `public` est limité par appelant (par identifiant utilisateur s'il est connecté, par adresse
sinon) : 120 appels par minute, sauf s'il déclare un `rateLimit`. Ce compteur réside
là où le backend conserve ses [limites de débit des fonctions](/docs/backend/function-rate-limits/),
de sorte que `REBASE_RATE_LIMIT_STORE=sql` le partage entre les réplicas. Au-delà, l'appel
renvoie `429 RATE_LIMITED` avec un en-tête `Retry-After`. Les appels consomment également le quota de l'API de
données de l'appelant. Un RPC `authenticated` n'est limité que lorsqu'il déclare un
`rateLimit`.

## Erreurs renvoyées par la fonction

`RAISE EXCEPTION 'This proposal has expired'` renvoie `400 RPC_EXCEPTION`
avec ce message, ainsi que `details.sqlState`, `detail` et `hint`.
`RAISE SQLSTATE 'PT404'` renvoie le code de statut situé après `PT`, comme dans PostgREST.
Tous les codes RPC sont répertoriés dans [Erreurs](/docs/backend/errors/#sql-functions-as-rpc).

## Sur le runtime géré et Rebase Cloud

Rien à configurer : les déclarations font partie de `backend/schema`, que
`rebase build` intègre dans le bundle, et le runtime les lit au même endroit où il lit
les tables. La fonction elle-même doit exister dans la base de données utilisée par le déploiement.

Un backend éjecté qui transmet `schemaDir` les lit depuis le même index ; un backend
qui transmet ses tables sous forme de valeurs transmet ses RPC de la même manière :

```typescript
await initializeRebaseBackend({ app, server, tables, rpc: [getPublicProposal, myTrips], /* … */ });
```

Les RPC font partie de la surface de données : un processus qui ne dessert pas `/api/data`
(`REBASE_ROLE=functions`) ne dessert pas `/api/rpc`, et ils s'exécutent sur la
base de données par défaut.

## Ce qu'il ne fait pas

- Les appels s'effectuent uniquement en `POST` ; un `GET` sur un nom déclaré renvoie `405`.
- Seuls les paramètres nommés peuvent être transmis. Une fonction dont les paramètres n'ont pas de
  noms, ou qui renvoie `SETOF record` sans paramètres `OUT`, ne peut pas être
  appelée de cette façon.
- Parmi les surcharges d'un même nom, l'appel atteint celle dont les paramètres nommés
  correspondent exactement aux arguments envoyés ; si deux fonctions correspondent, l'appel renvoie `500 RPC_AMBIGUOUS`.

Pour une logique qui ne se résume pas à une seule fonction SQL, écrivez une [fonction personnalisée](/docs/backend/custom-functions/)
et exécutez du SQL à l'intérieur avec `getSql(c)`.

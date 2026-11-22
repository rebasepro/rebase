---
sourceHash: 4561f107537e7ada
title: Pooling de connexions
sidebar_label: Pooling de connexions
description: Le service pgbouncer fourni par le fichier compose auto-hébergé pour les appelants ne pouvant pas maintenir de connexion, et ce qui cesse de fonctionner via son port avec le pooling de transactions.
---

Le runtime maintient un petit pool de connexions à longue durée de vie et n'a pas besoin de pooler. En revanche, tout le reste qui communique avec la même base de données et ne peut pas maintenir de connexion en a besoin : une fonction serverless, un script planifié, un outil de BI, un worker de file d'attente qui monte à cinquante instances. Le paramètre `max_connections` de Postgres est une limite stricte de quelques centaines et chaque connexion est un *processus*, de sorte qu'un déploiement massif (fan-out) de lambdas l'épuise bien avant que la base de données ne soit saturée.

Le fichier compose fournit un service `pgbouncer` pour ce trafic, associé à un profil afin qu'un déploiement sans de tels appelants n'exécute pas un processus inutile :

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

L'authentification client est générée à partir de `DATABASE_URL` au démarrage, afin que le mot de passe ne soit pas écrit deux fois. Le pooler s'authentifie auprès de Postgres avec `scram-sha-256`, que Postgres 18 stocke — la valeur par défaut `md5` de l'image fait échouer la connexion au *serveur* avec `FATAL: server login failed: wrong password type`, ce qui ressemble à une erreur de mot de passe alors que ce n'en est pas une.

Maintenez la somme des `PGBOUNCER_POOL_SIZE` sur l'ensemble des poolers largement en dessous de la valeur `max_connections` de la base de données — le runtime puise dans le même budget.

## Ce que le pooling de transactions change

Un client mutualisé conserve une connexion serveur pendant la durée d'une transaction puis la libère, ce qui permet à 500 clients de partager 20 connexions. Trois fonctionnalités cessent de fonctionner via ce port, et chacune d'entre elles est utilisée par Rebase lui-même — c'est précisément pourquoi le runtime se connecte directement et que ce port est réservé aux autres appelants :

- **`LISTEN`/`NOTIFY`.** [Realtime](/docs/backend/realtime/) repose dessus, et un écouteur nécessite une connexion qui survit à une transaction. `LISTEN` est *accepté* par le pooler — il répond `LISTEN`, puis aucune notification n'arrive jamais.
- **L'état de session** : `SET` (par opposition à `SET LOCAL`), les verrous consultatifs (advisory locks) conservés entre plusieurs instructions, les curseurs `WITH HOLD`, les tables temporaires. La transaction suivante peut atterrir sur une connexion serveur différente, qui ne verra rien de tout cela. Ces cas échouent tous de la même façon trompeuse : avec un seul client inactif, l'état persiste généralement, de sorte que cela fonctionne pendant vos tests et cesse de fonctionner sous la concurrence pour laquelle vous avez précisément introduit le pooler.
- **Les requêtes préparées au niveau du protocole (prepared statements).** La plupart des pilotes peuvent être configurés pour ne pas les utiliser — node-postgres ne le fait pas par défaut ; asyncpg nécessite `statement_cache_size=0`.

`SET LOCAL` est limité à la transaction et fonctionne, ce qui est utilisé pour configurer la sécurité au niveau des lignes (row-level security) — le RLS se comporte donc de manière identique à travers le port poolé.

Laissez le profil désactivé si rien en dehors du runtime ne se connecte à votre base de données. Un port inutilisé représente une surface d'attaque.

## Ensuite

- [Auto-hébergement](/docs/deployment/self-hosting/) : le fichier compose dont ce service fait partie.
- [Plus d'une instance](/docs/deployment/multiple-instances/) : l'état conservé par chaque processus de runtime, avant d'ajouter un réplica.

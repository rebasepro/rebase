---
sourceHash: 239a291d53ade1fd
title: MongoDB
sidebar_label: MongoDB
description:"\"@rebasepro/server-mongo fait fonctionner Rebase sur MongoDB : un pilote de données complet, du temps réel via change streams et un historique par instantanés — sans sécurité au niveau des lignes.\""
---

`@rebasepro/server-mongo` implémente le `BackendBootstrapper` de Rebase pour
MongoDB. L'API REST, le SDK généré, le panneau d'administration et la surface
d'authentification fonctionnent tous avec.

:::caution[Expérimental, et sans sécurité au niveau des lignes]
Lisez cette section avant de faire votre choix. MongoDB n'a pas d'équivalent à la
sécurité au niveau des lignes de PostgreSQL, donc **le modèle d'isolation sur lequel
repose le reste de Rebase ne s'applique pas ici**. Les `securityRules` sur une
collection ne sont pas appliquées par la base de données ; l'autorisation se
limite à ce que votre propre code vérifie.

Il ne s'agit pas d'une lacune en attente d'être comblée — c'est une caractéristique
du moteur. Si l'autorisation par ligne appliquée sous la couche applicative est la
raison pour laquelle vous vous intéressez à Rebase, utilisez le pilote PostgreSQL —
[Backend Setup](/docs/backend/) explique comment le configurer, et
[Security Rules](/docs/collections/security-rules/) détaille ce qu'il vous apporte.
:::

## Installation

```bash
pnpm add @rebasepro/server-mongo
```

```ts title="backend/src/index.ts" no-verify
import { rebase } from "@rebasepro/server";
import { createMongoBootstrapper } from "@rebasepro/server-mongo";

rebase({
    backend: createMongoBootstrapper({ url: process.env.DATABASE_URL! })
});
```

Définissez `DATABASE_URL` avec une chaîne de connexion MongoDB
(`mongodb://…` ou `mongodb+srv://…`).

## Ce qui fonctionne

| | |
|---|---|
| **API de données** | L'ensemble de la surface REST : list, get, create, update, delete, filtres, tri, pagination |
| **SDK généré** | Le même client typé que sur Postgres |
| **Temps réel** | Change streams. Cela nécessite un replica set — une instance `mongod` autonome (standalone) n'a pas d'oplog à suivre, le temps réel y est donc silencieusement indisponible |
| **Historique** | Basé sur des instantanés (snapshots), sous la même forme que sur Postgres |
| **Authentification** | Toute la surface d'authentification, avec ses dépôts stockés dans MongoDB |
| **Panneau d'administration** | Collections, formulaires, relations dans l'interface, champs de stockage |

## Ce qui est différent

- **Pas de sécurité au niveau des lignes (row-level security).** Voir l'avertissement ci-dessus. C'est le point essentiel.
- **Pas de surface SQL.** L'éditeur SQL de Studio, l'éditeur de règles RLS et
  `pnpm rls:check` sont des fonctionnalités Postgres et ne sont pas disponibles.
- **Pas d'intégrité relationnelle.** Une relation est une référence stockée que
  l'application résout ; il n'y a pas de clé étrangère, rien au niveau de la base
  de données n'empêche donc les références orphelines.
- **Pas de `rebase db push` / `generate` / `migrate`.** MongoDB n'a pas de schéma
  à migrer. Les collections sont créées au fur et à mesure de l'écriture des documents.

## Choisir entre les deux

Choisissez MongoDB lorsque les données ont véritablement la forme de documents et
que le modèle d'autorisation réside de toute façon dans votre application. Choisissez
PostgreSQL lorsque vous souhaitez que la base de données elle-même soit l'élément
qui applique qui peut voir quelle ligne — ce qui est l'argument que Rebase défend
partout ailleurs sur ce site.

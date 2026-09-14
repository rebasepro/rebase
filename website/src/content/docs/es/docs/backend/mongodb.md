---
sourceHash: 239a291d53ade1fd
title: MongoDB
sidebar_label: MongoDB
description:"\"@rebasepro/server-mongo ejecuta Rebase en MongoDB: un controlador de datos completo, tiempo real mediante change streams e historial de snapshots — y sin seguridad a nivel de fila.\""
---

`@rebasepro/server-mongo` implementa el `BackendBootstrapper` de Rebase para
MongoDB. La API REST, el SDK generado, el panel de administración y la superficie
de autenticación funcionan sobre él.

:::caution[Experimental, y no cuenta con seguridad a nivel de fila]
Lea esta sección antes de elegirlo. MongoDB no tiene un equivalente a la
seguridad a nivel de fila de PostgreSQL, por lo que **el modelo de aislamiento
en el que se basa el resto de Rebase no se aplica aquí**. Las `securityRules` en
una colección no son aplicadas por la base de datos; la autorización depende
exclusivamente de lo que compruebe su propio código.

Esto no es una brecha pendiente de solución: es una propiedad del motor. Si la
autorización a nivel de fila aplicada por debajo de la aplicación es la razón por
la que está evaluando Rebase, use el controlador de PostgreSQL — [Backend Setup](/docs/backend/)
es donde se configura, y [Security Rules](/docs/collections/security-rules/) es
lo que le ofrece.
:::

## Instalación

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

Establezca `DATABASE_URL` con una cadena de conexión de MongoDB
(`mongodb://…` o `mongodb+srv://…`).

## Qué funciona

| | |
|---|---|
| **API de datos** | La superficie REST completa: list, get, create, update, delete, filtros, ordenación, paginación |
| **SDK generado** | El mismo cliente tipado que en Postgres |
| **Tiempo real** | Change streams. Esto requiere un replica set; un `mongod` independiente (standalone) no tiene oplog al que hacer seguimiento, por lo que el tiempo real no estará disponible de forma silenciosa allí |
| **Historial** | Basado en snapshots, con la misma estructura que en Postgres |
| **Autenticación** | Toda la superficie de autenticación, con sus repositorios almacenados en MongoDB |
| **Panel de administración** | Colecciones, formularios, relaciones en la UI, campos de almacenamiento |

## Qué es diferente

- **Sin seguridad a nivel de fila.** Consulte la advertencia anterior. Este es el punto importante.
- **Sin superficie SQL.** El editor SQL de Studio, el editor de políticas RLS y
  `pnpm rls:check` son características de Postgres y no están disponibles.
- **Sin integridad relacional.** Una relación es una referencia almacenada que la aplicación
  resuelve; no hay claves foráneas, por lo que nada a nivel de base de datos impide
  que quede una referencia huérfana.
- **Sin `rebase db push` / `generate` / `migrate`.** MongoDB no tiene un esquema que
  migrar. Las colecciones se crean a medida que se escriben los documentos.

## Cómo elegir entre ambos

Elija MongoDB cuando los datos tengan verdaderamente forma de documento y el
modelo de autorización resida en su aplicación de todos modos. Elija PostgreSQL
cuando desee que sea la propia base de datos la que determine quién ve cada fila,
que es el argumento que Rebase defiende en todo el resto de este sitio.

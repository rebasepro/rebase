---
title: Ramificación de Bases de Datos
sidebar_label: Ramificación
description: Cree ramas de bases de datos aisladas para desarrollo, staging y pruebas utilizando CREATE DATABASE ... TEMPLATE de PostgreSQL — copias instantáneas y de alta fidelidad sin tiempo de inactividad.
---

## Descripción general

La ramificación de bases de datos le permite crear **copias instantáneas y aisladas** de toda su base de datos — esquema y datos — para desarrollo, staging o pruebas. Cada rama es una base de datos PostgreSQL real creada a partir de una plantilla, por lo que es una copia de alta fidelidad sin tiempo de inactividad.

Esto es similar a la ramificación de Git, pero para su base de datos. Cree una rama, experimente con migraciones o datos, y elimínela cuando termine. Su base de datos de producción nunca se modifica.

## Cómo funciona

Rebase utiliza el `CREATE DATABASE ... TEMPLATE` nativo de PostgreSQL para crear ramas. Esto es:

- **Instantáneo** — PostgreSQL copia la plantilla a nivel de sistema de archivos
- **Alta fidelidad** — esquema, datos, índices, restricciones, políticas RLS — todo se copia
- **Aislado** — los cambios en la rama no afectan a la base de datos de origen

Los metadatos de las ramas se almacenan en una tabla `rebase.branches` en la base de datos principal, por lo que el sistema siempre sabe qué ramas existen y de dónde provienen.

## API

La API de ramificación está disponible a través de la interfaz `DatabaseAdmin` del backend:

### Crear una Rama

```typescript
// Create a branch from the default database
await admin.createBranch("feature_auth");

// Create a branch from a specific source database
await admin.createBranch("staging", { source: "production" });
```

Esto crea una nueva base de datos PostgreSQL llamada `rb_feature_auth` (con prefijo para evitar colisiones) y la registra en la tabla de metadatos.

### Listar Ramas

```typescript
const branches = await admin.listBranches();
// [
//   {
//     name: "feature_auth",
//     parentDatabase: "rebase",
//     createdAt: "2026-04-15T10:30:00Z",
//     sizeBytes: 52428800
//   }
// ]
```

### Obtener Información de la Rama

```typescript
const branch = await admin.getBranchInfo("feature_auth");
// { name: "feature_auth", parentDatabase: "rebase", createdAt: ..., sizeBytes: ... }
```

### Eliminar una Rama

```typescript
await admin.deleteBranch("feature_auth");
```

Esto elimina la base de datos PostgreSQL y suprime los metadatos. La base de datos principal nunca puede ser eliminada.

## Configuración

La ramificación de bases de datos requiere que `adminConnectionString` esté configurada en su iniciador de PostgreSQL, ya que la creación y eliminación de bases de datos necesita privilegios elevados:

```typescript
createPostgresBootstrapper({
    connection: db,
    schema: { tables, enums, relations },
    adminConnectionString: process.env.ADMIN_CONNECTION_STRING || databaseUrl,
    connectionString
})
```

El `DatabasePoolManager` gestiona automáticamente la agrupación de conexiones para las bases de datos de las ramas. Cuando se cambia a una rama, el gestor de la agrupación crea un nuevo pool de conexiones dirigido a esa base de datos.

## Nomenclatura de Ramas

Los nombres de las ramas se desinfectan para permitir únicamente caracteres alfanuméricos y guiones bajos. El nombre real de la base de datos PostgreSQL se prefija con `rb_` para evitar colisiones:

| Nombre de la rama | Nombre de la base de datos |
|---|---|
| `feature_auth` | `rb_feature_auth` |
| `staging` | `rb_staging` |
| `v2_migration` | `rb_v2_migration` |

## Casos de Uso

### Entornos de Previsualización

Cree una rama para cada pull request o despliegue de previsualización. La rama obtiene una copia completa de los datos de producción, para que los revisores puedan probar con datos reales.

### Pruebas de Migración

Antes de ejecutar una migración en producción, cree una rama y ejecute la migración allí primero. Si algo sale mal, simplemente elimine la rama.

### Experimentos con Datos

¿Necesita probar una transformación de datos? Cree una rama, ejecute su script y verifique los resultados sin afectar la producción.

## Limitaciones

- **Conexiones activas** — PostgreSQL requiere que todas las conexiones a la base de datos de origen estén cerradas antes de crear una plantilla. El servicio de ramas desconecta automáticamente los pools inactivos, pero otros clientes (por ejemplo, pgAdmin) deben desconectarse manualmente.
- **Espacio en disco** — cada rama es una copia completa de la base de datos. Monitoree el uso del disco al crear muchas ramas.
- **Consultas entre bases de datos** — las ramas son bases de datos PostgreSQL separadas. No puede hacer JOIN entre una rama y la base de datos principal.

## Próximos Pasos

- **[Descripción General del Backend](/docs/backend)** — Referencia completa de configuración del backend
- **[CLI](/docs/cli)** — Gestione ramas desde la línea de comandos
- **[Historial de Entidades](/docs/backend/history)** — Rastree cambios dentro de una rama

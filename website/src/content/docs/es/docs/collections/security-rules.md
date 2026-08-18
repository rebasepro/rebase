---
title: Reglas de Seguridad (RLS)
sidebar_label: Reglas de Seguridad
description: Defina políticas de seguridad a nivel de fila (RLS) para sus colecciones utilizando atajos de conveniencia o expresiones SQL puras.
---

## Resumen

Las reglas de seguridad le permiten definir políticas de **Seguridad a Nivel de Fila (RLS)** para sus tablas PostgreSQL directamente en las definiciones de sus colecciones. Cuando se genera el esquema Drizzle, Rebase crea las sentencias `CREATE POLICY` correspondientes.

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "authorId" }
    ]
});
```

## Cómo Funciona

1. Usted define `securityRules` en una colección
2. `rebase schema generate` crea el esquema Drizzle con RLS habilitado
3. `rebase db push` o `rebase db migrate` aplica las políticas a PostgreSQL
4. Cada consulta es filtrada automáticamente por el contexto del usuario actual

La identidad del usuario autenticado está disponible en SQL a través de:

| Función | Devuelve |
|----------|---------|
| `rebase.uid()` | El ID del usuario actual |
| `rebase.roles()` | IDs de roles de aplicación separados por comas |
| `rebase.jwt()` | Reclamaciones JWT completas como JSONB |

Estos se establecen automáticamente por transacción por el backend de Rebase.

## Atajos de Conveniencia

### Acceso Basado en el Propietario

El patrón más simple: los usuarios solo pueden acceder a las filas que poseen:

```typescript
securityRules: [
    { operation: "all", ownerField: "userId" }
]
```

Esto genera: `USING (user_id = rebase.uid())`

### Acceso Público

Permitir que cualquiera (incluidos los usuarios no autenticados) lea:

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

Esto genera: `USING (true)`

### Acceso Autenticado

Permitir a cualquier usuario autenticado:

```typescript
securityRules: [
    { operation: "select", access: "authenticated" }
]
```

### Acceso Basado en Roles

Restringir operaciones a roles específicos:

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

## Expresiones SQL Puras

Para lógica compleja, utilice `using` y `withCheck`:

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

- **`using`** — Filtra qué filas existentes son visibles (se aplica a SELECT, UPDATE, DELETE)
- **`withCheck`** — Valida nuevos valores de fila (se aplica a INSERT, UPDATE)

Las referencias a columnas utilizan la sintaxis `{nombre_de_columna}` que se resuelve a la columna completa cualificada por la tabla.

## Combinando Atajos y SQL

Combine atajos de conveniencia con SQL puro:

```typescript
securityRules: [
    // Los administradores pueden hacer cualquier cosa
    { operation: "all", roles: ["admin"], using: "true" },
    // Los usuarios regulares solo pueden ver sus propias filas
    { operation: "select", ownerField: "userId" },
    // Los usuarios pueden insertar, pero solo para sí mismos
    { operation: "insert", withCheck: "{userId} = rebase.uid()" },
    // Las filas bloqueadas no se pueden actualizar
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permisivo vs Restrictivo

PostgreSQL tiene dos modos de política:

- **Permisivo** (predeterminado) — Múltiples políticas permisivas se combinan con **OR**. Si alguna de ellas se cumple, se concede el acceso.
- **Restrictivo** — Las políticas restrictivas se combinan con **AND**. Todas deben cumplirse.

```typescript
securityRules: [
    // Permisivo: los propietarios pueden acceder a sus filas
    { operation: "all", ownerField: "userId" },
    // Restrictivo: pero las filas bloqueadas no se pueden actualizar
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Operaciones

| Operación | Equivalente SQL | Descripción |
|-----------|---------------|-------------|
| `"select"` | `SELECT` | Leer filas |
| `"insert"` | `INSERT` | Crear nuevas filas |
| `"update"` | `UPDATE` | Modificar filas existentes |
| `"delete"` | `DELETE` | Eliminar filas |
| `"all"` | Todas las anteriores | Abreviatura para todas las operaciones |

También puede usar `operations` (plural) para aplicar una regla a múltiples operaciones:

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "authorId" }
```

## Interfaz Completa de SecurityRule

```typescript
interface SecurityRule {
    name?: string;              // Nombre de política legible por humanos
    operation?: SecurityOperation;   // Operación única
    operations?: SecurityOperation[]; // Múltiples operaciones
    mode?: "permissive" | "restrictive"; // Predeterminado: "permissive"
    access?: "public" | "authenticated";
    ownerField?: string;        // Columna que contiene el ID de usuario del propietario
    roles?: string[];           // Roles de aplicación a los que se aplica esta política
    using?: string;             // Expresión SQL USING pura
    withCheck?: string;         // Expresión SQL WITH CHECK pura
}
```

## Ejemplos

### Plataforma de Blog

```typescript
securityRules: [
    // Cualquiera puede leer publicaciones publicadas
    { operation: "select", using: "{status} = 'published'" },
    // Los autores pueden ver sus propios borradores
    { operation: "select", ownerField: "authorId" },
    // Los autores pueden crear y editar sus propias publicaciones
    { operations: ["insert", "update"], ownerField: "authorId" },
    // Solo los administradores pueden eliminar
    { operation: "delete", roles: ["admin"] }
]
```

### SaaS Multi-inquilino

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

## Acceso Anónimo (Inserciones Públicas)

Una necesidad común es permitir que **usuarios no autenticados** envíen datos — formularios de contacto, suscripciones a boletines, aplicaciones públicas. Rebase proporciona un patrón limpio para esto.

### Recomendado: `access: "public"` con `withCheck`

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const contactMessagesCollection: PostgresCollectionConfig = {
    slug: "contact_messages",
    name: "Contact Messages",
    table: "contact_messages",
    securityRules: [
        // Cualquiera puede enviar un mensaje de contacto
        {
            operation: "insert",
            // A raw rule carries `using` (which rows are visible) and `withCheck`
            // (what a write must satisfy); an insert only exercises the latter.
            using: "true",
            withCheck: "true"
        },
        // Solo los administradores pueden leer, actualizar o eliminar mensajes
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
};
```

El atajo `access: "public"` genera una política que permite la operación sin requerir autenticación.

### Para Captura de Leads / Registros

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const leadSignupsCollection: PostgresCollectionConfig = {
    slug: "lead_magnet_signups",
    name: "Lead Magnet Signups",
    table: "lead_magnet_signups",
    securityRules: [
        // Permitir inserciones anónimas
        { operation: "insert", using: "true", withCheck: "true" },
        // Los administradores pueden ver todos los registros
        { operation: "select", roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
};
```

### Cómo Funcionan las Solicitudes Anónimas

Cuando una solicitud llega sin un token JWT, el backend de Rebase establece las variables de sesión de PostgreSQL a:

| Variable | Valor |
|----------|-------|
| `app.userId` | `'anonymous'` |
| `app.user_roles` | `''` (vacío) |

Esto significa:

- `rebase.uid()` devuelve `'anonymous'`
- `rebase.roles()` devuelve una cadena vacía
- Las políticas `access: "public"` pasan porque generan `USING (true)` / `WITH CHECK (true)`
- Las políticas `access: "authenticated"` fallan porque verifican un ID de usuario real
- Las políticas `ownerField` fallan porque ninguna fila tendrá `userId = 'anonymous'` (a menos que se establezca explícitamente)

### Avanzado: SQL Puro para Anónimos

Si necesita un control más granular, utilice SQL puro:

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "rebase.uid() = 'anonymous' OR rebase.uid() IS NOT NULL"
    }
]
```

:::tip
Evite el patrón heredado de verificar `string_to_array(rebase.roles(), ',')` para acceso anónimo. El atajo `access: "public"` es más simple y genera la política correcta automáticamente.
:::

## Próximos Pasos

- **[Relaciones](/docs/collections/relations)** — Claves foráneas y uniones
- **[Callbacks de Entidad](/docs/collections/callbacks)** — Ganchos de ciclo de vida
- **[Funciones Personalizadas](/docs/backend/custom-functions)** — Puntos finales de API personalizados
---

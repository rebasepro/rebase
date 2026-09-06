---
sourceHash: 4e3fb1836c39f60c
title: Referencia de la CLI
sidebar_label: CLI
description: Comandos de la CLI de Rebase para la inicialización de proyectos, generación de esquemas, migraciones de bases de datos y generación de SDK.
---

## Visión general

La CLI de Rebase (`rebase`) gestiona tu proyecto desde el andamiaje hasta el despliegue.

## Instalación

```bash
pnpm add -g @rebasepro/cli
```

O úsalo a través de `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Comandos

### `rebase init`

Inicializa un nuevo proyecto Rebase:

```bash
rebase init [directory]
```

Configura la estructura del proyecto con paquetes de frontend, backend y compartidos.

### `rebase dev`

Inicia el servidor de desarrollo:

```bash
rebase dev
```

Inicia tanto el frontend como el backend con recarga en caliente.

### `rebase schema generate`

Genera el esquema Drizzle ORM a partir de tus colecciones TypeScript:

```bash
rebase schema generate
```

Esto lee tus colecciones de `config/collections/` y genera `backend/src/schema.generated.ts` con definiciones de tablas Drizzle, enumeraciones y relaciones.

### `rebase db push`

Envía los cambios de esquema directamente a la base de datos (solo desarrollo):

```bash
rebase db push
```

:::caution
`db push` modifica la base de datos directamente sin archivos de migración. Usa `db generate` + `db migrate` para producción.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de los cambios de esquema:

```bash
rebase db generate
```

Crea archivos de migración con marca de tiempo en `drizzle/` que pueden ser revisados y confirmados.

### `rebase db migrate`

Ejecuta las migraciones de base de datos pendientes:

```bash
rebase db migrate
```

Aplica todas las migraciones no aplicadas a la base de datos.

### `rebase generate-sdk`

Genera un SDK de cliente tipado a partir de tus definiciones de colección:

```bash
rebase generate-sdk
```

Crea tipos TypeScript y un cliente con seguridad de tipos para todas tus colecciones.

### `rebase doctor`

Ejecute diagnósticos para detectar discrepancias (drift) entre sus colecciones, el esquema generado y el estado actual de la base de datos:

```bash
rebase doctor
```

### `rebase auth`

Comandos de gestión de autenticación:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

## Flujo de trabajo de migración

El flujo de trabajo típico para los cambios de esquema:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration
rebase db generate

# 4. Review the generated SQL in drizzle/

# 5. Apply the migration
rebase db migrate
```

## Próximos pasos

- **[Esquema como Código](/docs/architecture/schema-as-code)** — Cómo funciona la generación de esquemas
- **[Inicio rápido](/docs/getting-started/quickstart)** — Comenzar

---

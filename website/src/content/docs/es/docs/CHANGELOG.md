---
slug: docs/changelog
title: Historial de Cambios
---
# Historial de Cambios

## [0.1.2] - 2026-05-15

### Mejoras

- **Eliminación de la dependencia de `lodash`** — Se reemplazó `lodash/cloneDeep` con una utilidad personalizada `deepClone` en `@rebasepro/utils`. Esto elimina la dependencia externa y corrige el fallo de `npx create-rebase-app` debido a la falta de `lodash` en tiempo de ejecución.
- **Nueva utilidad `deepClone`** — Una función ligera de clonación profunda que preserva referencias a funciones e instancias de clases (Date, GeoPoint, etc.), diseñada específicamente para objetos de colección de Rebase.

### CI y Herramientas

- **Flujo de trabajo de lanzamiento automatizado** — Nuevo flujo de trabajo de GitHub Actions (`Publish Stable Release`) que maneja el incremento de versión, la publicación en npm y la creación del lanzamiento en GitHub con un solo clic desde la pestaña de Actions.
- **Script de lanzamiento local** — `pnpm release:patch`, `pnpm release:minor`, `pnpm release:major` para realizar lanzamientos desde la línea de comandos con el mismo flujo.
- **Lanzamientos Canary** — Cada push a `main` publica una versión canary en npm (etiqueta de distribución `@canary`).

### Correcciones

- Se corrigieron las pruebas de la utilidad de navegación para asegurar la firma de llamada correcta con el parámetro de opciones `undefined` opcional.
- Se actualizaron las descripciones de los paquetes para reflejar la arquitectura basada en Postgres.

---

## [0.1.0] - 2025-05-14

🎉 **Primer lanzamiento público de Rebase** — un CMS headless de código abierto y panel de administración para Postgres.

### Puntos Destacados

- **Panel de Administración Completo** — Vistas de hoja de cálculo, tarjetas, listas y tablas para gestionar sus datos con edición en línea, filtrado, ordenación y búsqueda.
- **Backend de PostgreSQL** — Soporte de Postgres de primera clase con Drizzle ORM, introspección de esquemas y migraciones automáticas.
- **Autenticación** — Autenticación integrada con correo electrónico/contraseña, Google OAuth e inicio de sesión anónimo. Control de acceso basado en roles con permisos personalizables.
- **Almacenamiento** — Almacenamiento de archivos compatible con S3 con cambio de tamaño de imágenes, carga por arrastrar y soltar y gestión de metadatos.
- **Studio** — Editor de SQL, editor de políticas RLS, visualizador de esquemas, editor de JS/TS, tareas cron y explorador de API.
- **CLI** — `npx create-rebase-app` para crear la estructura de un nuevo proyecto en segundos. Soporta tanto npm como pnpm.
- **Generador de SDK** — Genera automáticamente SDKs de TypeScript completamente tipados a partir de las definiciones de sus colecciones.
- **Servidor MCP** — Servidor Model Context Protocol para la gestión de bases de datos asistida por IA.
- **Plugins** — Plugins de enriquecimiento de datos y análisis para extender la experiencia de administración.
- **Librería de Componentes de UI** — Un conjunto completo de componentes de React accesibles y personalizables basados en primitivas de Radix.
- **Soporte de Firebase** — Adaptadores opcionales de autenticación y origen de datos de Firebase/Firestore.
- **Soporte de MongoDB** — Adaptador de origen de datos opcional para MongoDB.

### Paquetes

| Paquete | Descripción |
|---|---|
| `@rebasepro/types` | Definiciones de tipos principales de TypeScript |
| `@rebasepro/utils` | Funciones de utilidad compartidas |
| `@rebasepro/common` | Módulos comunes compartidos entre paquetes |
| `@rebasepro/formex` | Librería ligera de gestión de formularios |
| `@rebasepro/ui` | Librería de componentes de React |
| `@rebasepro/core` | Lógica central del CMS y controladores |
| `@rebasepro/client` | Capa de acceso a datos del lado del cliente |
| `@rebasepro/client-postgresql` | Adaptador de cliente de PostgreSQL |
| `@rebasepro/client-firebase` | Adaptador de cliente de Firebase/Firestore |
| `@rebasepro/server-core` | Framework del servidor y middleware |
| `@rebasepro/server-postgresql` | Adaptador de servidor de PostgreSQL con Drizzle |
| `@rebasepro/server-mongodb` | Adaptador de servidor de MongoDB |
| `@rebasepro/auth` | Controladores y vistas de autenticación |
| `@rebasepro/admin` | Interfaz completa del panel de administración |
| `@rebasepro/studio` | Editor SQL, herramientas de esquema y utilidades para desarrolladores |
| `@rebasepro/cli` | CLI para la creación y gestión de proyectos |
| `@rebasepro/sdk-generator` | Generación de código SDK de TypeScript |
| `@rebasepro/mcp-server` | Servidor MCP para integraciones de IA |
| `@rebasepro/schema-inference` | Introspección e inferencia de esquemas de bases de datos |
| `@rebasepro/plugin-data-enhancement` | Plugin de enriquecimiento de datos impulsado por IA |
| `@rebasepro/plugin-insights` | Plugin de analíticas e información |

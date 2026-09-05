---
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install escribe 21 habilidades de referencia de Rebase en tu repositorio, en la estructura que espera tu asistente de IA — Cursor, Claude Code, Windsurf, Gemini CLI y Antigravity.
---

Un asistente de IA que ha leído la documentación de Rebase escribe mejor código de Rebase que uno que intenta adivinarlo a partir de la estructura de la API. `rebase skills install` copia 21 archivos Markdown de habilidades en tu repositorio, en la estructura que tu asistente espere:

```bash
rebase skills install
```

Las habilidades son **material de referencia, no herramientas**. Le explican a un asistente cómo se definen las colecciones, por qué las migraciones constan de dos pasos y qué errores no detectará el framework por él. Para herramientas que interactúan con tus datos, consulta el [servidor MCP](/docs/ai/mcp).

## Qué asistente

El comando acepta `--agent` (o `-a`), repetible y separado por comas:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Se admiten siete destinos, uno por cada archivo de puntero que escribe `rebase init`:

| `--agent` | Asistente | Destino |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/<skill>.mdc` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/<skill>.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |
| `codex` | Codex CLI | `.codex/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/<skill>.md` |
| `copilot` | GitHub Copilot | `.github/instructions/<skill>.instructions.md` |

`gemini` cubre **tanto** Gemini CLI como Antigravity; ambos leen el mismo directorio `.agents/`, por lo que no existe un valor `antigravity` independiente.

Si no se especifica `--agent`, el comando detecta qué asistentes ya utiliza un proyecto buscando `.cursor/`, `.claude/`, `.windsurf/` y `.agents/`. Si no encuentra ninguno, te solicitará que elijas uno.

:::note[Un proyecto recién generado siempre solicita confirmación]
`rebase init` genera `CLAUDE.md`, `.cursorrules` y similares, pero ninguno de los *directorios* que busca la detección. Por lo tanto, la primera ejecución en un proyecto nuevo recurre al prompt interactivo y, en CI, donde no hay TTY, finaliza con un error en su lugar. Pasa `--agent` explícitamente en cualquier contexto no interactivo.
:::

## Locales al proyecto y destinadas a incluirse en el repositorio

Las habilidades se escriben **de forma relativa a la raíz de tu proyecto** (el ancestro más cercano que contenga `rebase.json`), no en tu directorio de inicio ni en el directorio de trabajo actual. No se instala nada a nivel global.

Haz commit de ellas. Forman parte del repositorio de la misma manera que una configuración de linter: así, el asistente de cada colaborador trabajará a partir del mismo entendimiento de la base de código, incluidos los colaboradores que nunca hayan ejecutado el comando.

**Vuelve a ejecutar el comando para actualizar.** Los archivos se sobrescriben de forma incondicional, por lo que después de una actualización de Rebase:

```bash
rebase skills install --agent all
```

Dos consecuencias de «incondicionalmente»: las ediciones locales en una habilidad instalada se perderán en la siguiente ejecución; en su lugar, mantén las directrices específicas del proyecto en [`ai-instructions.md`](/docs/ai/instruction-files), que es tuyo y nunca se sobrescribe. Además, las habilidades eliminadas en una versión más reciente no se borran de tu repositorio; solo se reescriben los archivos que aún existen.

El comando también funciona fuera de un proyecto Rebase, recurriendo al directorio de trabajo actual, lo cual resulta útil para un repositorio frontend independiente que se comunica con un backend de Rebase.

## Las 21 habilidades

| Habilidad | Qué cubre |
|---|---|
| `rebase-basics` | Principios fundamentales, flujo de trabajo y mantenimiento: el punto de entrada que las demás asumen |
| `rebase-collections` | Definición de colecciones, tipos de propiedades, validación y capacidad de búsqueda |
| `rebase-backend-postgres` | El backend de Postgres: configuración, generación de esquemas, migraciones, pooling y réplicas de lectura |
| `rebase-api` | La API REST generada: endpoints, filtrado, ordenamiento y paginación |
| `rebase-sdk` | El SDK de TypeScript generado: CRUD, filtrado, búsqueda, autenticación, tiempo real, modo sin conexión y almacenamiento |
| `rebase-auth` | Autenticación, roles, políticas RLS, MFA, claves API, OAuth y adaptadores personalizados |
| `rebase-security` | Control de acceso, interceptación, diseño de fallo cerrado (fail-closed), enmascaramiento de PII y aislamiento de inquilinos |
| `rebase-realtime` | El motor de WebSockets: sincronización, canales de difusión (broadcast), presencia y emisiones de cambios en tablas |
| `rebase-storage` | Almacenamiento local/S3/GCS, subidas, subidas reanudables con TUS y transformaciones de imágenes |
| `rebase-custom-functions` | Endpoints de API personalizados mediante descubrimiento de funciones basado en archivos |
| `rebase-cron-jobs` | Programación de tareas periódicas en segundo plano |
| `rebase-webhooks` | Webhooks HTTP salientes, firmas HMAC, reintentos y retroceso (backoff) |
| `rebase-email` | SMTP, plantillas, proveedores personalizados y el singleton `rebase.email` |
| `rebase-entity-history` | Versionado de entidades, seguimiento de cambios, registros de auditoría y reversiones |
| `rebase-admin` | Navegación por el panel de administración, paneles laterales (drawers), URLs e incrustación de paneles de colecciones |
| `rebase-ui-components` | La biblioteca de componentes `@rebasepro/ui` |
| `rebase-design-language` | El lenguaje de diseño de UI: tokens, color, tipografía, espaciado y antipatrones |
| `rebase-studio` | La capa de herramientas de desarrollo de Studio: SQL, RLS, almacenamiento, cron, visualizador de esquemas y registros |
| `rebase-cloud` | Despliegue y operación en Rebase Cloud — proyectos, bases de datos gestionadas, variables de entorno, dominios, registros, rollbacks |
| `rebase-deployment` | Autoalojamiento: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway y Render |
| `rebase-local-env-setup` | Configuración inicial: Node.js, pnpm, PostgreSQL y Docker |

Dos de ellas solicitan ser leídas sin indicación previa. `rebase-basics` indica que debe utilizarse siempre que un asistente interactúe con Rebase en absoluto, y `rebase-design-language` indica que un agente debe leerla antes de crear o modificar cualquier interfaz visual; esta última existe porque la UI generada tiende a desviarse del sistema de diseño más rápido que cualquier otra parte de una base de código.

## Ejemplo de ejecución

```text
  Found 21 Rebase skills

  ✓ Claude Code — 21 skills installed (+ 1 reference file) to .claude/skills
```

Las habilidades se distribuyen desde el paquete `@rebasepro/agent-skills`, del cual depende la CLI, por lo que el conjunto obtenido coincide con la versión instalada de tu CLI.

---

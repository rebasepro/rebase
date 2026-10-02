---
sourceHash: 8fee7de68fa81701
title: Habilidades del agente
sidebar_label: Habilidades del agente
description: rebase skills install escribe 21 habilidades de referencia de Rebase en tu repositorio, en el formato que espera tu asistente de IA — Cursor, Claude Code, Windsurf, Gemini CLI y Antigravity.
---

Un asistente de IA que ha leído la documentación de Rebase escribe mejor código de Rebase que uno que intenta adivinar a partir de la estructura de la API. `rebase skills install` copia 21 archivos de habilidades en Markdown en tu repositorio, en la estructura que espere tu asistente:

```bash
rebase skills install
```

Las habilidades son **material de referencia, no herramientas**. Le indican al asistente cómo se definen las colecciones, por qué las migraciones constan de dos pasos y qué errores no detectará el framework por él. Para herramientas que interactúan con tus datos, consulta el [servidor MCP](/docs/ai/mcp).

## Configurado por `rebase init`

<span class="since-badge" data-since="0.24">Desde 0.24</span> Un proyecto nuevo no necesita el comando. `rebase init` pregunta si deseas configurar tus agentes de programación con IA y luego enumera los que encuentra en la máquina:

```text
? Set up Rebase skills and the Rebase MCP server for your AI coding agent(s)? Yes

Detecting installed AI coding agents...
  ✓ Claude Code — ~/.claude
  ✓ Gemini CLI / Antigravity — ~/.gemini
  ✗ Cursor — ~/.cursor (not found)
  ✗ Windsurf — ~/.codeium/windsurf (not found)
  ✗ Codex CLI — ~/.codex (not found)
  ✗ Kiro — ~/.kiro (not found)
  · GitHub Copilot — can't be detected; tick it below if you use it
```

Los agentes encontrados aparecen preseleccionados. Para cada uno que conserves, escribe las habilidades y registra el [servidor MCP](/docs/ai/mcp) en la configuración de proyecto de dicho agente, todo antes del primer commit del proyecto. En CI, o con `--yes`, indícalos por su nombre:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Un proyecto existente

<span class="since-badge" data-since="0.24">Desde 0.24</span> `rebase init` rechaza un directorio que ya contiene un proyecto, así que un
proyecto creado antes de que existiera la configuración de agentes — o uno
cuyo autor rechazó la pregunta — obtiene la misma configuración con
`rebase skills install --mcp`: las habilidades, y el [servidor MCP](/docs/ai/mcp)
registrado en la configuración de proyecto de cada agente. Los servidores que
ya estén en el archivo se conservan, y volver a ejecutarlo deja la entrada de
Rebase como está.

```bash
rebase skills install --agent cursor --mcp
```

Sin `--mcp` el comando escribe solo las habilidades, y nombra los agentes cuya
configuración todavía no tiene el servidor.

## Qué asistente

El comando acepta `--agent` (o `-a`), repetible y separado por comas:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Se admiten siete destinos, uno por cada archivo de referencia que escribe `rebase init`:

| `--agent` | Asistente | Se escribe en |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/rebase.mdc` + `.cursor/rules/<skill>/SKILL.md` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/rebase.md` + `.windsurf/rules/<skill>/SKILL.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |
| `codex` | Codex CLI | `.agents/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/rebase.md` + `.kiro/steering/<skill>/SKILL.md` |
| `copilot` | GitHub Copilot | `.github/instructions/rebase.instructions.md` + `<skill>/SKILL.md` |

:::note[Cursor, Windsurf, Kiro y Copilot reciben un archivo siempre activo]
Esos cuatro cargan todo su directorio de reglas en cada petición. Un archivo de regla por cada habilidad implicaba alrededor de **84.000 caracteres** de referencia de Rebase antes de cada pregunta que hacía un usuario, estuviera o no relacionada con Rebase; y una instrucción que un asistente lee por encima es una instrucción que no sigue.

En su lugar, reciben `rebase.mdc` (o `rebase.md`): un índice de ~3 KB con `alwaysApply: true`, que enumera lo que cubre cada habilidad y el archivo que debe leerse. El contenido se ubica en subdirectorios por habilidad y se abre bajo demanda.
:::

`gemini` cubre **tanto** Gemini CLI como Antigravity; ambos leen el mismo directorio `.agents/`, por lo que no existe un valor `antigravity` independiente. Codex también lo lee; indicar tanto `gemini` como `codex` escribe el directorio una sola vez.

Si no se especifica `--agent`, el comando detecta qué asistentes utiliza ya un proyecto buscando `.cursor/`, `.claude/`, `.windsurf/`, `.agents/`, `.codex/` y `.kiro/`. Si no encuentra ninguno, te solicitará que elijas, mostrando preseleccionados los asistentes instalados en la máquina.

**GitHub Copilot nunca se detecta automáticamente.** Su directorio sería `.github/`, y la presencia de `.github/` no es evidencia de que alguien use Copilot: `rebase init` escribe `.github/copilot-instructions.md` en cada proyecto generado, y la mayoría de los repositorios tienen un `.github/` para workflows. Instálalo con `--agent copilot`.

:::note[Un proyecto recién generado siempre solicita confirmación]
`rebase init` escribe `CLAUDE.md`, `.cursorrules` y archivos similares, pero ninguno de los *directorios* que busca el proceso de detección. Por lo tanto, la primera ejecución en un nuevo proyecto pasa directamente a la selección interactiva; y en entornos de CI, donde no hay una TTY, finaliza con un error. Pasa `--agent` explícitamente en cualquier contexto no interactivo.
:::

## Local al proyecto y pensado para hacer commit

Las habilidades se escriben **de forma relativa a la raíz de tu proyecto** (el ancestro más cercano que contenga `rebase.json`), no en tu directorio personal ni en el directorio de trabajo actual. Nada se instala de forma global.

Haz commit de ellas. Forman parte del repositorio de la misma manera que una configuración de linter: así, el asistente de cada colaborador trabaja a partir del mismo entendimiento de la base de código, incluidos los colaboradores que nunca ejecutaron el comando.

**Vuelve a ejecutar el comando para actualizar.** Los archivos se sobrescriben de forma incondicional, por lo que tras una actualización de Rebase:

```bash
rebase skills install --agent all
```

Dos consecuencias de que sea «incondicional»: las modificaciones locales en una habilidad instalada se perderán en la siguiente ejecución; en su lugar, mantén las directrices específicas del proyecto en [`ai-instructions.md`](/docs/ai/instruction-files), que es tuyo y nunca se sobrescribe. Además, las habilidades eliminadas en una versión más reciente no se borran de tu repositorio; solo se reescriben los archivos que aún existen.

El comando también funciona fuera de un proyecto de Rebase, recurriendo al directorio de trabajo actual; esto resulta útil para un repositorio frontend independiente que se comunica con un backend de Rebase.

## Las 21 habilidades

| Habilidad | Qué cubre |
|---|---|
| `rebase-basics` | Principios básicos, flujo de trabajo y mantenimiento: el punto de entrada que los demás asumen |
| `rebase-collections` | Definición de colecciones, tipos de propiedades, validación y capacidad de búsqueda |
| `rebase-backend-postgres` | El backend de Postgres: configuración, generación de esquemas, migraciones, pooling y réplicas de lectura |
| `rebase-api` | La API REST generada: endpoints, filtrado, ordenación y paginación |
| `rebase-sdk` | El SDK de TypeScript generado: CRUD, filtrado, búsqueda, autenticación, tiempo real, modo sin conexión y almacenamiento |
| `rebase-auth` | Autenticación, roles, políticas RLS, MFA, claves de API, OAuth y adaptadores personalizados |
| `rebase-security` | Control de acceso, interceptación, diseño de fallo cerrado (fail-closed), enmascaramiento de PII y aislamiento de inquilinos |
| `rebase-realtime` | El motor WebSocket: sincronización, canales de difusión, presencia y difusión de cambios en tablas |
| `rebase-storage` | Almacenamiento en S3/GCS/local, subidas, subidas reanudables con TUS y transformaciones de imágenes |
| `rebase-custom-functions` | Endpoints de API personalizados mediante detección de funciones basada en archivos |
| `rebase-cron-jobs` | Programación de tareas periódicas en segundo plano |
| `rebase-webhooks` | Webhooks HTTP salientes, firmas HMAC, reintentos y retroceso (backoff) |
| `rebase-email` | SMTP, plantillas, proveedores personalizados y el singleton `rebase.email` |
| `rebase-entity-history` | Control de versiones de entidades, seguimiento de cambios, registros de auditoría y reversión |
| `rebase-admin` | Navegación por el panel de administración, paneles laterales (side drawers), URLs e incrustación de paneles de colecciones |
| `rebase-ui-components` | La biblioteca de componentes `@rebasepro/ui` |
| `rebase-design-language` | El lenguaje de diseño de la interfaz: tokens, color, tipografía, espaciado y antipatrones |
| `rebase-studio` | La capa de herramientas de desarrollo de Studio: SQL, RLS, almacenamiento, cron, visualizador de esquemas y logs |
| `rebase-cloud` | Despliegue y operación en Rebase Cloud: proyectos, bases de datos gestionadas, variables de entorno, dominios, logs y rollbacks |
| `rebase-deployment` | Autoalojamiento: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway y Render |
| `rebase-local-env-setup` | Configuración inicial del entorno: Node.js, pnpm, PostgreSQL y Docker |

Dos de ellas solicitan ser leídas sin petición previa. `rebase-basics` indica que debe usarse siempre que un asistente interactúe con Rebase en cualquier medida, y `rebase-design-language` establece que un agente debe leerla antes de crear o modificar cualquier interfaz visual; esta última existe porque la interfaz de usuario generada se desvía de un sistema de diseño más rápido que cualquier otra cosa en una base de código.

## Cómo se ve una ejecución

```text
  Found 21 Rebase skills

  ✓ Claude Code — 21 skills installed (+ 8 reference files) to .claude/skills
```

Las habilidades se distribuyen desde el paquete `@rebasepro/agent-skills`, del cual depende la CLI, por lo que el conjunto que obtienes coincide con la versión instalada de tu CLI.

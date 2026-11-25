---
sourceHash: 62b7632c6d62c832
title: Habilidades de agente
sidebar_label: Habilidades de agente
description: rebase skills install escribe 24 habilidades de referencia de Rebase en tu repositorio, en la estructura que espera tu asistente de IA — Cursor, Claude Code, Windsurf, Gemini CLI y Antigravity.
---

Un asistente de IA que ha leído la documentación de Rebase escribe mejor código de Rebase
que uno que adivina a partir de la forma de la API. `rebase skills install` copia 24
archivos Markdown de habilidades en tu repositorio, en la estructura que espere
tu asistente:

```bash
rebase skills install
```

Las habilidades son **material de referencia, no herramientas**. Le indican a un asistente cómo
se declaran las tablas, por qué las migraciones constan de dos pasos y qué errores el
framework no detectará por él. Para herramientas que operan sobre tus datos, consulta el
[servidor MCP](/docs/ai/mcp).

## A través de MCP, sin nada instalado

Las mismas habilidades llegan a Claude a través de MCP. Tanto el [conector de Rebase](/docs/ai/rebase-connector/#skills)
como el [servidor MCP local](/docs/ai/mcp/#skills) proporcionan las 24, y un
cliente en la revisión de protocolo 2026-07-28 o posterior carga una cuando la necesita.
Claude Code las nombra `<server>:rebase-tables`, etc. Instalarlas en
el repositorio, como se muestra a continuación, sigue siendo lo que permite que lleguen a todos los asistentes, fijadas a
la versión que ejecuta el proyecto.

Tu propia aplicación también puede servir habilidades a las personas que la utilizan: consulta
[el endpoint MCP remoto](/docs/ai/remote-mcp/#skills).

## Configurado por `rebase init`

Un proyecto nuevo no necesita el comando. `rebase init` pregunta
si deseas configurar tus agentes de programación con IA y luego enumera los que encuentra en la
máquina:

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

Los agentes que encontró están preseleccionados. Para cada uno que conserves, escribe las habilidades
y registra el [servidor MCP](/docs/ai/mcp) en la configuración de proyecto de ese agente, todo
antes del primer commit del proyecto. En CI, o con `--yes`, indícalos por nombre:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Un proyecto existente

`rebase init` rechaza un directorio que ya contiene un proyecto, por lo que un proyecto
creado antes de que existiera la configuración de agentes —o uno cuyo autor rechazó la pregunta—
obtiene la misma configuración mediante `rebase skills install --mcp`: las habilidades y el
[servidor MCP](/docs/ai/mcp) registrado en la configuración de proyecto de cada agente. Los servidores
que ya estén en el archivo se conservan, y una nueva ejecución deja la entrada de Rebase tal como está.

```bash
rebase skills install --agent cursor --mcp
```

Sin `--mcp`, el comando solo escribe las habilidades e indica los agentes cuya
configuración aún no tiene el servidor.

## Qué asistente

El comando admite `--agent` (o `-a`), repetible y separado por comas:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Se admiten siete destinos, uno por cada archivo puntero que escribe `rebase init`:

| `--agent` | Asistente | Escrito en |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/rebase.mdc` + `.cursor/rules/<skill>/SKILL.md` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/rebase.md` + `.windsurf/rules/<skill>/SKILL.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |
| `codex` | Codex CLI | `.agents/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/rebase.md` + `.kiro/steering/<skill>/SKILL.md` |
| `copilot` | GitHub Copilot | `.github/instructions/rebase.instructions.md` + `<skill>/SKILL.md` |

:::note[Cursor, Windsurf, Kiro y Copilot obtienen un archivo siempre activo]
Esos cuatro cargan todo su directorio de reglas en cada solicitud. Un archivo de reglas por
habilidad significaba unos **84.000 caracteres** de referencia de Rebase antes de cada
pregunta que hacía una persona, tuviera o no que ver con Rebase; y una
instrucción que un asistente lee por encima es una instrucción que no sigue.

En su lugar, obtienen `rebase.mdc` (o `rebase.md`): un índice de ~3 KB con
`alwaysApply: true`, que enumera lo que cubre cada habilidad y el archivo que se debe leer. Los
cuerpos se encuentran en subdirectorios por habilidad y se abren bajo demanda.
:::

`gemini` cubre **tanto** Gemini CLI como Antigravity; ambos leen el mismo
directorio `.agents/`, por lo que no hay un valor `antigravity` independiente. Codex también
lo lee; especificar tanto `gemini` como `codex` escribe el directorio una sola vez.

Sin `--agent`, el comando detecta qué asistentes ya utiliza el proyecto
buscando `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` y
`.kiro/`. Si no encuentra ninguno, te solicita que elijas, con los asistentes instalados
en la máquina ya marcados.

**GitHub Copilot nunca se detecta.** Su directorio sería `.github/`, y
`.github/` no es evidencia de que alguien use Copilot: `rebase init` escribe
`.github/copilot-instructions.md` en cada proyecto generado mediante scaffold, y la mayoría de los repositorios tienen
un `.github/` para flujos de trabajo. Instálalo con `--agent copilot`.

:::note[Un proyecto recién generado siempre solicita confirmación]
`rebase init` escribe `CLAUDE.md`, `.cursorrules` y similares, pero ninguno de los
*directorios* que busca la detección. Por lo tanto, la primera ejecución en un nuevo proyecto pasa
directamente a la solicitud interactiva; y en CI, donde no hay una TTY, termina con un error.
Pasa `--agent` explícitamente en cualquier contexto no interactivo.
:::

## Local al proyecto y pensado para hacer commit

Las habilidades se escriben **relativas a la raíz de tu proyecto** —el ancestro más cercano
que contenga `rebase.json`—, no a tu directorio personal ni al directorio de
trabajo actual. No se instala nada de forma global.

Haz commit de ellas. Forman parte del repositorio de la misma manera que la configuración de un linter: así, el
asistente de cada colaborador trabaja a partir del mismo conocimiento del código base,
incluidos los colaboradores que nunca ejecutaron el comando.

## Actualizar las habilidades

**`rebase upgrade` las actualiza.** Las habilidades se distribuyen dentro de `@rebasepro/cli`, por
lo que después de instalar la nueva versión, [`rebase upgrade`](/docs/cli/#rebase-upgrade)
ejecuta el `rebase skills install` de la nueva CLI para cada asistente cuyo
directorio de habilidades haya sido escrito por una instalación, conservando los archivos que hayas editado. Un proyecto que ya se encuentre en esa
versión también se actualiza. Una actualización de habilidades que falle nunca hace fallar la actualización principal. Con
`--json`, la propiedad `skills` del documento indica lo que ocurrió: `{ agents, refreshed }`, con
un `reason` cuando no lo hizo (`dry_run`, `not_installed` después de `--no-install`,
`no_project_cli` cuando el proyecto no instala `@rebasepro/cli` por sí mismo,
`failed`), o `null` si no hay habilidades instaladas.

Si cambiaste las versiones fijadas de alguna otra manera (un bot de dependencias, una edición manual), ejecuta
`rebase upgrade` de todos modos, o la instalación tú mismo:

```bash
rebase skills install
```

Sin `--agent`, actualiza los asistentes cuyos directorios ya tiene el proyecto.
Los comandos también terminan con una línea cuando se publica una versión más reciente de Rebase, de modo que un
asistente que trabaja en el proyecto se entera del nuevo lanzamiento sin que se lo indiquen.

Cada directorio de destino contiene un manifiesto `.rebase-skills.json` con lo que
escribió el comando, de modo que una nueva ejecución pueda distinguir una edición manual de la copia de una versión anterior. Haz
commit de él junto con las habilidades.

- Un archivo que nadie haya editado se reemplaza con la copia de la nueva versión.
- Un archivo que hayas editado se conserva, y el comando lo enumera. `--force` lo reemplaza.
- Una habilidad que una versión más reciente ya no incluya se elimina, a menos que la hayas editado.
  En ese caso, se conserva y se enumera.
- Los archivos que el comando nunca escribió no se tocan.

Las directrices específicas del proyecto siguen perteneciendo a
[`ai-instructions.md`](/docs/ai/instruction-files), que es tuyo. Una habilidad
editada deja de recibir actualizaciones hasta que uses `--force`.

El comando también funciona fuera de un proyecto de Rebase, recurriendo al directorio
de trabajo actual; esto es útil para un repositorio de frontend independiente que se comunica con un backend de Rebase.

## Las 24 habilidades

| Skill | Qué cubre |
|---|---|
| `rebase-basics` | Principios fundamentales, flujo de trabajo y mantenimiento: el punto de entrada que las demás asumen |
| `rebase-tables` | Creación de tablas: columnas, relaciones, `rls`, hooks y la capa de CMS superior (`customizeTable`) |
| `rebase-backend-postgres` | El backend de Postgres: configuración, generación de esquemas, migraciones, pooling, réplicas de lectura |
| `rebase-api` | La API REST generada: endpoints, filtrado, ordenación, paginación |
| `rebase-sdk` | El SDK de TypeScript generado: CRUD, filtrado, búsqueda, autenticación, tiempo real, modo sin conexión, almacenamiento |
| `rebase-auth` | Autenticación, roles, políticas de RLS, MFA, claves de API, OAuth, adaptadores personalizados |
| `rebase-security` | Control de acceso, interceptación, diseño fail-closed, enmascaramiento de PII, aislamiento de inquilinos |
| `rebase-realtime` | El motor de WebSocket: sincronización, canales de difusión, presencia, difusión de cambios en tablas |
| `rebase-storage` | Almacenamiento en S3/GCS/local, subidas, subidas reanudables con TUS, transformaciones de imágenes |
| `rebase-custom-functions` | Endpoints de API personalizados mediante descubrimiento de funciones basado en archivos |
| `rebase-cron-jobs` | Programación de tareas periódicas en segundo plano |
| `rebase-webhooks` | Webhooks HTTP salientes, firmas HMAC, reintentos y retroceso |
| `rebase-email` | SMTP, plantillas, proveedores personalizados, el singleton `rebase.email` |
| `rebase-entity-history` | Control de versiones de entidades, seguimiento de cambios, registros de auditoría, reversión |
| `rebase-admin` | Navegación por el panel de administración, paneles laterales, URLs, incrustación de paneles de colecciones |
| `rebase-customize-admin` | Personalización del panel de administración con componentes de React: singletons, páginas de configuración, acciones masivas, modos de vista, campos personalizados, reemplazo de elementos integrados |
| `rebase-custom-views` | Pantallas personalizadas dentro de la administración: `rebase generate view`, vistas de nivel superior, pestañas de registros, widgets de campos |
| `rebase-dashboards` | KPIs, gráficos y paneles: números calculados en SQL, dibujados con `@rebasepro/ui`, ubicados en slots o en una página |
| `rebase-ui-components` | La biblioteca de componentes `@rebasepro/ui` |
| `rebase-design-language` | El lenguaje de diseño de UI: tokens, color, tipografía, espaciado, antipatrones |
| `rebase-studio` | La capa de herramientas de desarrollo de Studio: SQL, RLS, almacenamiento, cron, visualizador de esquemas, registros |
| `rebase-cloud` | Despliegue y operación en Rebase Cloud: proyectos, bases de datos gestionadas, variables de entorno, dominios, registros, reversiones |
| `rebase-deployment` | Autoalojamiento: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway y Render |
| `rebase-local-env-setup` | Configuración inicial: Node.js, pnpm, PostgreSQL, Docker |

Dos de ellas solicitan ser leídas sin previo aviso. `rebase-basics` indica que debe usarse
siempre que un asistente interactúe con Rebase de cualquier manera, y `rebase-design-language` especifica que un
agente debe leerla antes de crear o modificar cualquier interfaz de usuario visual; esta última existe
porque la interfaz de usuario generada se desvía del sistema de diseño más rápido que cualquier otra cosa en un
código base.

## Aspecto de una ejecución

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

Las habilidades se distribuyen desde el paquete `@rebasepro/agent-skills`, del cual depende la CLI,
por lo que el conjunto que obtienes coincide con la versión instalada de tu CLI.

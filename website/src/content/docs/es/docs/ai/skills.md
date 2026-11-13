---
sourceHash: dd9c77451521c040
title: Habilidades de agentes
sidebar_label: Habilidades de agentes
description: rebase skills install escribe 24 habilidades de referencia de Rebase en tu repositorio, en la distribución que tu asistente de IA espera — Cursor, Claude Code, Windsurf, Gemini CLI y Antigravity.
---

Un asistente de IA que ha leído la documentación de Rebase escribe mejor código de Rebase
que uno que adivina a partir de la estructura de la API. `rebase skills install` copia 24
archivos de habilidades en Markdown en tu repositorio, en cualquier distribución que
espere tu asistente:

```bash
rebase skills install
```

Las habilidades son **material de referencia, no herramientas**. Le indican a un asistente cómo
se declaran las tablas, por qué las migraciones constan de dos pasos y qué errores
no detectará el framework por él. Para herramientas que actúan sobre tus datos, consulta el
[servidor MCP](/docs/ai/mcp).

## Configurado por `rebase init`

Un proyecto nuevo no necesita el comando. `rebase init` pregunta
si deseas configurar tus agentes de programación con IA y luego lista los que encuentra en la
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

Los agentes encontrados aparecen preseleccionados. Para cada uno que conserves, escribe las habilidades
y registra el [servidor MCP](/docs/ai/mcp) en la configuración del proyecto de dicho agente, todo
antes del primer commit del proyecto. En CI, o con `--yes`, especifícalos:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Un proyecto existente

`rebase init` rechaza un directorio que ya contiene un proyecto, por lo que un proyecto
creado antes de que existiera la configuración de agentes —o uno cuyo autor rechazó la
pregunta interactiva— obtiene la misma configuración con `rebase skills install --mcp`: las habilidades y el
[servidor MCP](/docs/ai/mcp) registrado en la configuración del proyecto de cada agente. Los servidores
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

Se admiten siete destinos, uno por cada archivo de referencia que escribe `rebase init`:

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
`alwaysApply: true`, que lista lo que cubre cada habilidad y el archivo que se debe leer. Los
cuerpos se encuentran en subdirectorios por habilidad y se abren bajo demanda.
:::

`gemini` cubre **tanto** Gemini CLI como Antigravity; ambos leen el mismo
directorio `.agents/`, por lo que no hay un valor `antigravity` independiente. Codex también
lo lee; especificar tanto `gemini` como `codex` escribe el directorio una sola vez.

Sin `--agent`, el comando detecta qué asistentes ya utiliza un proyecto
buscando `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` y
`.kiro/`. Si no encuentra ninguno, te solicita que elijas, con los asistentes instalados
en la máquina ya seleccionados.

**GitHub Copilot nunca se detecta.** Su directorio sería `.github/`, y
`.github/` no es evidencia de que alguien use Copilot: `rebase init` escribe
`.github/copilot-instructions.md` en cada proyecto generado mediante scaffolding, y la mayoría de los repositorios tienen
un `.github/` para workflows. Instálalo con `--agent copilot`.

:::note[Un proyecto recién generado siempre solicita confirmación]
`rebase init` escribe `CLAUDE.md`, `.cursorrules` y similares, pero ninguno de los
*directorios* que busca la detección. Por lo tanto, la primera ejecución en un proyecto nuevo
pasa a la solicitud interactiva —y en CI, donde no hay una TTY, termina con un error
en su lugar—. Pasa `--agent` explícitamente en cualquier contexto no interactivo.
:::

## Local al proyecto y pensado para hacer commit

Las habilidades se escriben **de forma relativa a la raíz de tu proyecto** —el ancestro más cercano
que contenga `rebase.json`—, no en tu directorio personal ni en el directorio de
trabajo actual. No se instala nada de forma global.

Haz commit de ellas. Forman parte del repositorio de la misma manera que una configuración de linter: el
asistente de cada colaborador trabajará a partir de la misma comprensión del código base,
incluidos los colaboradores que nunca ejecutaron el comando.

**Vuelve a ejecutar el comando para actualizar** tras una actualización de Rebase:

```bash
rebase skills install --agent all
```

Cada directorio de destino contiene un manifiesto `.rebase-skills.json` con lo que
escribió el comando, de modo que una nueva ejecución pueda distinguir una edición manual de una copia de una versión anterior. Haz
commit de él junto con las habilidades.

- Un archivo que nadie editó se reemplaza con la copia de la nueva versión.
- Un archivo que editaste se conserva y el comando lo lista. `--force` lo reemplaza.
- Una habilidad que una versión más reciente ya no incluye se elimina, a menos que la hayas editado.
  En ese caso, se conserva y se lista.
- Los archivos que el comando nunca escribió no se modifican.

Las directrices específicas del proyecto siguen perteneciendo a
[`ai-instructions.md`](/docs/ai/instruction-files), que es tuyo. Una habilidad editada deja
de recibir actualizaciones hasta que uses `--force`.

El comando también funciona fuera de un proyecto de Rebase, recurriendo al directorio de
trabajo actual; esto es útil para un repositorio de frontend independiente que se comunica con un backend de Rebase.

## Las 24 habilidades

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Habilidad | Cubre |
|---|---|
| `rebase-basics` | Principios básicos, flujo de trabajo y mantenimiento: el punto de entrada que los demás asumen |
| `rebase-tables` | Creación de tablas: columnas, relaciones, `rls`, hooks y la capa de CMS superior (`customizeTable`) |
| `rebase-backend-postgres` | El backend de Postgres: configuración, generación de esquemas, migraciones, pooling, réplicas de lectura |
| `rebase-api` | La API REST generada: endpoints, filtrado, ordenamiento, paginación |
| `rebase-sdk` | El SDK de TypeScript generado: CRUD, filtrado, búsqueda, autenticación, tiempo real, offline, almacenamiento |
| `rebase-auth` | Autenticación, roles, políticas de RLS, MFA, claves de API, OAuth, adaptadores personalizados |
| `rebase-security` | Control de acceso, interceptación, diseño de fallo cerrado (fail-closed), enmascaramiento de PII, aislamiento de tenants |
| `rebase-realtime` | El motor de WebSockets: sincronización, canales de difusión (broadcast), presencia, difusiones de cambios en tablas |
| `rebase-storage` | Almacenamiento local/S3/GCS, subidas, subidas reanudables con TUS, transformaciones de imágenes |
| `rebase-custom-functions` | Endpoints de API personalizados mediante detección de funciones basada en archivos |
| `rebase-cron-jobs` | Programación de tareas periódicas en segundo plano |
| `rebase-webhooks` | Webhooks HTTP salientes, firmas HMAC, reintentos y retroceso (backoff) |
| `rebase-email` | SMTP, plantillas, proveedores personalizados, el singleton `rebase.email` |
| `rebase-entity-history` | Control de versiones de entidades, seguimiento de cambios, registros de auditoría, reversión |
| `rebase-admin` | Navegación por el panel de administración, cajones laterales (drawers), URLs, incrustación de paneles de colección |
| `rebase-customize-admin` | Personalización del panel de administración con componentes de React: singletons, páginas de configuración, acciones masivas, modos de visualización, campos personalizados, reemplazo de partes integradas |
| `rebase-custom-views` | Pantallas personalizadas dentro de la administración: `rebase generate view`, vistas de nivel superior, pestañas de registros, widgets de campos |
| `rebase-dashboards` | KPIs, gráficos y paneles de control: números calculados en SQL, dibujados con `@rebasepro/ui`, ubicados en slots o en una página |
| `rebase-ui-components` | La biblioteca de componentes `@rebasepro/ui` |
| `rebase-design-language` | El lenguaje de diseño de UI: tokens, color, tipografía, espaciado, antipatrones |
| `rebase-studio` | La capa de herramientas de desarrollo de Studio: SQL, RLS, almacenamiento, cron, visualizador de esquemas, registros |
| `rebase-cloud` | Despliegue y operación en Rebase Cloud: proyectos, bases de datos gestionadas, variables de entorno, dominios, registros, rollbacks |
| `rebase-deployment` | Autoalojamiento (self-hosting): Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway y Render |
| `rebase-local-env-setup` | Configuración inicial: Node.js, pnpm, PostgreSQL, Docker |

Dos de ellas solicitan ser leídas sin previo aviso. `rebase-basics` indica que debe usarse
siempre que un asistente interactúe con Rebase, y `rebase-design-language` indica que un
agente debe leerla antes de crear o modificar cualquier interfaz visual; esta última existe
porque la interfaz de usuario generada se desvía de un sistema de diseño más rápido que cualquier otra cosa en un
código base.

## Cómo se ve una ejecución

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

Las habilidades se distribuyen desde el paquete `@rebasepro/agent-skills`, del cual depende la CLI,
por lo que el conjunto que obtienes coincide con la versión de la CLI instalada.

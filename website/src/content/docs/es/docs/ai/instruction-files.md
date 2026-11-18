---
sourceHash: 4f52b1da35febe8d
title: Archivos de instrucciones para IA
sidebar_label: Archivos de instrucciones para IA
description: "Cada proyecto de Rebase generado incluye ai-instructions.md más archivos de puntero para Claude, Cursor, Windsurf, Copilot y AGENTS.md que contienen las cinco reglas que los asistentes rompen con más frecuencia: una única fuente de verdad, muchos nombres de archivo."
---

Cada asistente quiere sus reglas en un archivo diferente. Claude Code lee
`CLAUDE.md`, Cursor lee `.cursorrules`, Windsurf lee `.windsurfrules`,
Copilot lee `.github/copilot-instructions.md`, y la convención entre proveedores
es `AGENTS.md`. Mantener la misma guía en cinco archivos es la razón por la cual cuatro
de ellos terminan desactualizados.

`rebase init` escribe los cinco, como **punteros a un único archivo que realmente
editas**:

```text
your-project/
├── ai-instructions.md            ← the real content
├── CLAUDE.md                     ← pointer
├── AGENTS.md                     ← pointer
├── .cursorrules                  ← pointer
├── .windsurfrules                ← pointer
└── .github/
    └── copilot-instructions.md   ← pointer
```

Cada archivo de puntero nombra al archivo real, indica dónde se encuentran los skills y contiene las cinco reglas que un asistente no debe romper incluso si nunca abre nada más:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a file in `backend/schema/`.** Declare it with `defineTable` from `@rebasepro/server/schema` — columns, relations and a required `rls` — export it from `backend/schema/index.ts`, and `pnpm dev` creates it. How it looks in the admin panel is a separate, optional file: `frontend/src/cms/<table>.tsx` with `customizeTable`, which imports the table as a type only. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and hooks, so keep it for server work that needs every row and for reading a column marked `.private()`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its file from `pnpm schema:introspect`. With no `backend/schema/` (a headless project) the database is the schema instead: ai-instructions.md says how to serve a table.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<table>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit `.env`, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`).
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see.
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Los demás solo se diferencian en el directorio de skills del agente y su valor `--agent`
(`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot`), y en
la ruta relativa, que es `../ai-instructions.md` en
`.github/copilot-instructions.md` y `ai-instructions.md` en `AGENTS.md`. La
tercera línea es condicional porque `rebase init --agent` puede haber
instalado ya los skills antes de que el asistente la lea.

Esto ocurre en cada `rebase init`, para cada preset, incluido `--headless`.
No hay ningún flag ni mensaje de confirmación.

`rebase init` también escribe `.mcp.json`, que apunta Claude Code, Cursor y
cualquier otro cliente de MCP al [servidor MCP de Rebase](/docs/ai/mcp): la propia
copia del proyecto, una devDependency fijada con la CLI (`npx --no rebase-mcp` en un
proyecto npm):

```json title=".mcp.json"
{
    "mcpServers": {
        "rebase": {
            "command": "pnpm",
            "args": ["exec", "rebase-mcp"],
            "env": {
                "REBASE_PROJECT_DIR": "."
            }
        }
    }
}
```

`REBASE_PROJECT_DIR` es `"."`, no una ruta absoluta: el cliente genera el servidor
en la raíz del proyecto, y una ruta absoluta es la única línea de ese archivo que
no se puede commitear. Está ahí porque `~/.rebase/projects.json` es
a nivel de toda la máquina; un proyecto que no especifica su propio directorio recurre
a lo que haya persistido el último proyecto en esa máquina. Consulta
[el orden de precedencia](/docs/ai/mcp#which-directory-it-acts-on).

## Por qué un puntero en lugar de una copia

Los archivos de puntero casi no contienen nada. Un archivo que apunta al real mantiene las
convenciones en un solo lugar y tiene propiedades que una copia no tiene:

- **Un solo archivo para editar.** Las reglas no pueden divergir entre asistentes, porque solo
  hay un conjunto de reglas.
- **Un solo diff para revisar.** Un cambio en las convenciones del proyecto es un cambio en un
  solo archivo, no en cinco archivos idénticos que un revisor deba comparar.
- **Agregar un asistente es un solo archivo pequeño.** Una nueva herramienta con un nuevo
  nombre de archivo obtiene un puntero, no una sexta copia de tus convenciones.

La única excepción es el bloque **Before you write any code**. Un asistente no
sigue un enlace de manera fiable: uno que está ocupado con una tarea escribe el código primero,
y uno iniciado en la raíz de un repositorio cuyo proyecto de Rebase se encuentra en una
subcarpeta nunca llega a cargar estos archivos. Por lo tanto, las cinco reglas cuya infracción
causa el mayor daño (una tabla creada en SQL en lugar de en `backend/schema`, datos leídos y
escritos eludiendo el SDK, una ruta sin protección, un despliegue, un archivo generado editado)
están escritas en cada puntero, de forma idéntica. Una comprobación en CI mantiene las cinco
copias iguales.

Vale la pena mantener el patrón si haces un fork del scaffold, y vale la pena adoptarlo en
repositorios que ni siquiera son proyectos de Rebase.

## Con qué comienza `ai-instructions.md`

El archivo generado en el scaffold es deliberadamente corto: apunta a
[`rebase skills install`](/docs/ai/skills) para mayor profundidad y luego establece las reglas en
las que los asistentes se equivocan con la frecuencia suficiente como para que valga la pena repetirlas
al principio de cada sesión:

1. **Esquema como código.** Una tabla es un `defineTable` en `backend/schema/<table>.ts`,
   exportado desde `backend/schema/index.ts` (solo se sirve lo que exporta el index),
   con un `rls` obligatorio. Nunca edites a mano el esquema generado de Drizzle
   ni las tablas de Postgres; consulta [Schema as Code](/docs/architecture/schema-as-code).
2. **Aplicar un cambio de esquema** depende de la base de datos. Mientras `pnpm dev`
   está en ejecución, guardar un archivo en `backend/schema/` es todo lo que hay que hacer:
   regenera el esquema de Drizzle y los tipos del SDK, y el arranque crea las
   tablas y columnas que falten. `pnpm db:push` es solo para lo que el arranque deliberadamente
   no toca (una columna renombrada, un tipo más restringido, una columna eliminada), tanto en la
   base de datos de desarrollo administrada como en tu propio PostgreSQL. En producción
   es `pnpm db:generate` y luego `pnpm db:migrate`.
3. **Usa el SDK.** Utiliza `rebase.dataAsAdmin.<table>` para el trabajo realizado como
   identidad del servicio, o `getDriver(c)` dentro de una función cuando la lectura deba ejecutarse
   como el emisor de la llamada. El cliente del servidor no tiene un descriptor de acceso `data` simple.
   El SQL sin procesar y las llamadas directas a Drizzle omiten la validación, los hooks y RLS.
4. **Protege cada ruta personalizada.** Las rutas en `backend/functions/` se montan
   *sin* autenticación. Usa `requireAuth` / `requireAdmin` de
   `@rebasepro/server/functions` en el slot de middleware propio de la ruta: leer
   `c.get("user")` no es una protección, y tampoco lo es `app.use()` después de la ruta.

Esa última es la que hay que conservar. Es la diferencia entre un middleware que
se ejecuta y uno que no, y un asistente al que no se le haya advertido
escribirá invariablemente la versión que no lo hace; consulta
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` solo admite el rol `admin`. Cuando un rol más restringido o una clave de API
deba poder llamar a una ruta, la protección que se debe agregar es `requireScope`,
con un scope que declare la aplicación; consulta [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Después de las reglas vienen dos secciones que aplican solo en algunos proyectos. **Backend
runtime** enumera lo que permite el runtime administrado en Rebase Cloud: paquetes,
memoria y estado a nivel de módulo, tiempos de espera, puertos de salida, configuración y
almacenamiento para archivos generados. Enlaza a
[Managed backend runtime](/docs/deployment/managed-runtime/), para que un asistente
planifique una funcionalidad de backend teniendo en cuenta los límites reales en lugar de adivinarlos. **Admin UI**
contiene las reglas de `@rebasepro/ui`. Aplican a las vistas dentro del panel de administración, no
a un sitio público ni a una aplicación estática que sirva el proyecto.

## Hazlo tuyo

`ai-instructions.md` es tu archivo. Nada lo regenera ni lo sobrescribe, a diferencia de los
[skills instalados](/docs/ai/skills), que se reemplazan en cada
`rebase skills install`. Las convenciones específicas del proyecto pertenecen a este lugar.

Lo que se gana un lugar aquí es aquello que un asistente no puede inferir del código: qué
tablas son legacy, qué servicio es propietario de qué tabla, la convención de nomenclatura
que no se aplica en ningún otro lugar, la migración que no debe volver a ejecutarse. Mantenlo
corto: las instrucciones que se cargan en cada solicitud compiten por la atención con la tarea real,
y un archivo largo es uno que el asistente leerá por encima.

Y ten en cuenta los límites: este archivo define lo que un asistente *escribe*. No
tiene ningún impacto en lo que un agente conectado a tu base de datos pueda *hacer*; eso lo
determina la credencial que posee, y nada en Markdown lo cambia. Consulta
[el modelo de credenciales del servidor MCP](/docs/ai/mcp#what-the-server-can-reach).

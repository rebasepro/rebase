---
sourceHash: 4a5c6ecfb9f66fd3
title: Archivos de instrucciones para IA
sidebar_label: Archivos de instrucciones para IA
description: "Cada proyecto creado con Rebase incluye ai-instructions.md junto con archivos de referencia para Claude, Cursor, Windsurf, Copilot y AGENTS.md que contienen las cinco reglas que los asistentes rompen con mayor frecuencia: una única fuente de verdad, múltiples nombres de archivo."
---

Cada asistente requiere sus reglas en un archivo diferente. Claude Code lee
`CLAUDE.md`, Cursor lee `.cursorrules`, Windsurf lee `.windsurfrules`,
Copilot lee `.github/copilot-instructions.md` y la convención entre proveedores
es `AGENTS.md`. Mantener las mismas directrices en cinco archivos es la forma en que cuatro de ellos
terminan desactualizados.

`rebase init` genera los cinco, como **punteros a un único archivo que realmente
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

Cada archivo de referencia nombra al archivo real, indica dónde residen las skills y contiene las cinco reglas que un asistente no debe romper incluso si nunca abre nada más:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a file in `backend/schema/`.** Declare it with `defineTable` from `@rebasepro/server/schema` — columns, relations and a required `rls` — export it from `backend/schema/index.ts`, and `pnpm dev` creates it. How it looks in the admin panel is a separate, optional file: `frontend/src/cms/<table>.tsx` with `customizeTable`, which imports the table as a type only. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and hooks, so keep it for server work that needs every row and for reading a column marked `.private()`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its file from `pnpm schema:introspect`. With no `backend/schema/` (a headless project) the database is the schema instead: ai-instructions.md says how to serve a table.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<table>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`). In `.env`, change only a local setting the task needs (`AUTH_MAGIC_LINK`, `FRONTEND_URL`, `REBASE_FUNCTIONS_TIMEOUT_MS` and the like), one line at a time, and say which; never rewrite, print or rotate its secrets (`DATABASE_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`).
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see. The admin derived from the tables is a draft: before calling an admin done, give every table it shows a `customizeTable` pass (a title, its columns, ids and raw JSON hidden, labels; ai-instructions.md, "Admin UI", has the checklist).
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Los demás difieren únicamente en el directorio de skills del agente y en su valor `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — y en
la ruta relativa, que es `../ai-instructions.md` en
`.github/copilot-instructions.md` y `ai-instructions.md` en `AGENTS.md`. La
tercera línea es condicional porque `rebase init --agent` ya puede haber
instalado las skills antes de que el asistente la lea.

Esto ocurre en cada `rebase init`, para cada preset incluyendo `--headless`.
No hay ningún flag ni solicitud de confirmación.

`rebase init` también escribe `.mcp.json`, que apunta a Claude Code, Cursor y
cualquier otro cliente MCP al [servidor MCP de Rebase](/docs/ai/mcp) —la propia copia
del proyecto, una devDependency fijada con la CLI (`npx --no rebase-mcp` en un
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

`REBASE_PROJECT_DIR` es `"."`, no una ruta absoluta: el cliente inicia el servidor
en la raíz del proyecto, y una ruta absoluta es la única línea de ese archivo que
no se puede commitear. Está ahí porque `~/.rebase/projects.json` es
a nivel de toda la máquina; un proyecto que no especifica un directorio propio recurre a
lo que haya persistido el último proyecto en esa máquina. Consulta
[el orden de precedencia](/docs/ai/mcp#which-directory-it-acts-on).

## Por qué un puntero en lugar de una copia

Los archivos de referencia casi no contienen nada. Un archivo que apunta al real mantiene las
convenciones en un solo lugar y tiene propiedades que una copia no tiene:

- **Un solo archivo para editar.** Las reglas no pueden diferir entre asistentes, porque solo
  existe un conjunto de reglas.
- **Un único diff para revisar.** Un cambio en las convenciones del proyecto es un cambio en un solo
  archivo, no en cinco archivos idénticos que un revisor deba comparar.
- **Agregar un asistente es un solo archivo pequeño.** Una nueva herramienta con un nuevo nombre de archivo recibe
  un puntero, no una sexta copia de tus convenciones.

La única excepción es el bloque **Before you write any code**. Un asistente no
sigue enlaces de forma confiable: uno que está ocupado con una tarea escribirá el código primero,
y uno que se inicie en la raíz de un repositorio cuyo proyecto de Rebase se encuentra en una
subcarpeta nunca cargará estos archivos. Por lo tanto, las cinco reglas cuya violación causa
más daño (una tabla creada en SQL en lugar de en `backend/schema`, datos leídos y
escritos al margen del SDK, una ruta sin protección, un despliegue, un archivo generado editado)
se incluyen en cada puntero de forma idéntica. Una comprobación en CI mantiene
iguales las cinco copias.

Vale la pena conservar este patrón si haces un fork del scaffold, y adoptarlo en
repositorios que ni siquiera son proyectos de Rebase.

## Con qué comienza `ai-instructions.md`

El archivo generado en el scaffold es deliberadamente breve: remite a
[`rebase skills install`](/docs/ai/skills) para mayor profundidad y luego establece las reglas que los
asistentes infringen con suficiente frecuencia como para que valga la pena repetirlas al inicio de cada
sesión:

1. **Esquema como código.** Una tabla es un `defineTable` en `backend/schema/<table>.ts`,
   exportado desde `backend/schema/index.ts` —solo lo que el índice exporta está
   disponible— con un `rls` obligatorio. Nunca edites a mano el esquema generado de Drizzle
   ni las tablas de Postgres; consulta [Schema as Code](/docs/architecture/schema-as-code).
2. **Aplicar un cambio de esquema** depende de la base de datos. Mientras `pnpm dev`
   se está ejecutando, guardar un archivo en `backend/schema/` es todo el paso:
   regenera el esquema de Drizzle y los tipos del SDK, y el inicio crea las
   tablas y columnas faltantes. `pnpm db:push` es solo para lo que el inicio deja
   intacto deliberadamente —una columna renombrada, un tipo más restrictivo, una columna eliminada— tanto en
   la base de datos de desarrollo administrada como en tu propio PostgreSQL. En producción es
   `pnpm db:generate` y luego `pnpm db:migrate`.
3. **Usa el SDK.** Utiliza `rebase.dataAsAdmin.<table>` para operaciones realizadas con la
   identidad del servicio, o `getDriver(c)` dentro de una función cuando la lectura deba ejecutarse
   como el emisor de la llamada. El cliente del servidor no tiene un descriptor de acceso `data` simple. El SQL sin procesar y las llamadas
   directas de Drizzle eluden la validación, los hooks y el RLS.
4. **Protege cada ruta personalizada.** Las rutas en `backend/functions/` se montan
   *sin* autenticación. Usa `requireAuth` / `requireAdmin` de
   `@rebasepro/server/functions` en el slot de middleware propio de la ruta; leer
   `c.get("user")` no es una protección, y tampoco lo es `app.use()` después de la ruta.

Esa última es la clave a tener en cuenta. Es la diferencia entre un middleware que
se ejecuta y uno que no, y un asistente al que no se le haya indicado
escribirá infaliblemente la versión que no lo hace; consulta
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` solo admite el rol `admin`. Cuando un rol más restringido o una clave de API
deba poder invocar una ruta, la protección a agregar es `requireScope`, con un scope
declarado por la aplicación; consulta [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Después de las reglas vienen dos secciones que aplican solo en algunos proyectos. **Backend
runtime** detalla lo que permite el entorno de ejecución administrado en Rebase Cloud: paquetes,
memoria y estado a nivel de módulo, tiempos de espera, puertos de salida, configuración y
almacenamiento para archivos generados. Enlaza a
[Managed backend runtime](/docs/deployment/managed-runtime/), para que un asistente
planifique una funcionalidad de backend basándose en límites reales en lugar de adivinar. **Admin UI**
contiene las reglas de `@rebasepro/ui` y la lista de verificación para el pase de `customizeTable`
que cada tabla necesita antes de dar por terminado un panel de administración: un título, las columnas que lista, IDs,
claves foráneas y JSON en bruto ocultos, etiquetas, un resumen para columnas JSON y una revisión
visual del panel de administración en ejecución. Las reglas se aplican a las vistas dentro del panel de administración, no a un
sitio público o aplicación estática que el proyecto sirva.

## Hazlo tuyo

`ai-instructions.md` es tu archivo. Nada lo regenera ni lo sobrescribe, a diferencia de
las [skills instaladas](/docs/ai/skills), que se reemplazan en cada
`rebase skills install`. Las convenciones específicas del proyecto pertenecen aquí.

Una excepción, aplicable a un archivo que nadie ha modificado: el archivo `ai-instructions.md`
de un proyecto headless indica que la base de datos es el esquema y que no existe
`backend/schema/`, y `rebase schema introspect` escribe exactamente ese
directorio. Cuando el archivo sigue siendo byte por byte el que generó el scaffold,
la introspección lo reemplaza con las reglas de esquema como código exclusivas de backend; una vez que
lo hayas editado, se deja tal cual y el comando indica cuáles de sus reglas ya no
son válidas.

Lo que merece un lugar aquí es lo que un asistente no puede inferir a partir del código: qué
tablas son heredadas, qué servicio es dueño de qué tabla, la convención de nomenclatura
que no se aplica en ninguna parte, la migración que no debe volver a ejecutarse. Mantenlo
breve: las instrucciones cargadas en cada solicitud compiten por atención con la tarea real,
y un archivo largo es uno que el asistente leerá por encima.

Y ten presente el límite: este archivo determina lo que un asistente *escribe*. No
tiene ningún impacto en lo que un agente conectado a tu base de datos puede *hacer*; eso lo
determinan las credenciales con las que cuenta, y nada en Markdown puede cambiarlo. Consulta
[el modelo de credenciales del servidor MCP](/docs/ai/mcp#what-the-server-can-reach).

---
sourceHash: 80e40ea5912a48c8
title: Archivos de instrucciones para IA
sidebar_label: Archivos de instrucciones para IA
description: "Cada proyecto Rebase generado incluye ai-instructions.md junto con archivos de puntero para Claude, Cursor, Windsurf, Copilot y AGENTS.md con las cinco reglas que los asistentes rompen más frecuentemente: una única fuente de verdad, múltiples nombres de archivo."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada asistente requiere sus reglas en un archivo diferente. Claude Code lee
`CLAUDE.md`, Cursor lee `.cursorrules`, Windsurf lee `.windsurfrules`,
Copilot lee `.github/copilot-instructions.md`, y la convención entre proveedores
es `AGENTS.md`. Mantener las mismas instrucciones en cinco archivos es la razón
por la que cuatro de ellos terminan desactualizados.

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

Cada archivo de puntero hace referencia al real, indica dónde residen las skills y contiene las cinco reglas que un asistente no debe romper incluso si nunca abre nada más:

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
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Los demás solo se diferencian en el directorio de skills del agente y su valor de
`--agent` (`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot`),
así como en la ruta relativa, que es `../ai-instructions.md` en
`.github/copilot-instructions.md` y `ai-instructions.md` en `AGENTS.md`. La
tercera línea es condicional porque `rebase init --agent` puede haber
instalado ya las skills antes de que el asistente las lea.

Esto ocurre en cada `rebase init`, para cada preset, incluido `--headless`.
No hay flags ni confirmaciones interactivas.

`rebase init` también genera `.mcp.json`, que apunta Claude Code, Cursor y
cualquier otro cliente MCP al [servidor MCP de Rebase](/docs/ai/mcp): la propia
copia del proyecto, una devDependency fijada con la CLI (`npx --no rebase-mcp` en
un proyecto npm):

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
no se puede commitear. Está ahí porque `~/.rebase/projects.json` es a nivel de
todo el equipo: un proyecto que no especifica un directorio propio recurre al
que haya persistido el último proyecto en esa máquina. Consulta
[la precedencia](/docs/ai/mcp#which-directory-it-acts-on).

## Por qué un puntero en lugar de una copia

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Los archivos de puntero prácticamente no contienen nada. Un archivo que hace
referencia al real mantiene las convenciones en un solo lugar y tiene propiedades
que una copia no ofrece:

- **Un solo archivo para editar.** Las reglas no divergen entre asistentes, porque
  solo existe un único conjunto de reglas.
- **Un solo diff para revisar.** Un cambio en las convenciones del proyecto es un
  cambio en un solo archivo, no en cinco archivos idénticos que un revisor debe
  comparar.
- **Agregar un asistente es solo un archivo pequeño.** Una nueva herramienta con
  un nuevo nombre de archivo solo requiere un puntero, no una sexta copia de tus
  convenciones.

La única excepción es el bloque **Before you write any code**. Un asistente no
sigue enlaces de manera fiable: uno ocupado con una tarea escribe el código
primero, y uno iniciado en la raíz de un repositorio cuyo proyecto Rebase se
encuentra en una subcarpeta nunca llega a cargar estos archivos. Por lo tanto, las
cinco reglas cuya violación causa más daño (una tabla creada en SQL en lugar de
en `backend/schema`, datos leídos y escritos eludiendo el SDK, una ruta sin
protección, un despliegue, un archivo generado editado) están escritas en cada
puntero, de forma idéntica. Una comprobación en CI mantiene las cinco copias
sincronizadas.

Vale la pena conservar este patrón si haces un fork del scaffold, e incluso
adoptarlo en repositorios que no sean proyectos Rebase.

## Con qué comienza `ai-instructions.md`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El archivo generado es deliberadamente breve: apunta a
[`rebase skills install`](/docs/ai/skills) para mayor detalle y luego establece las
reglas en las que los asistentes se equivocan con suficiente frecuencia como
para que valga la pena repetirlas al comienzo de cada sesión:

1. **Esquema como código.** Una tabla es un `defineTable` en
   `backend/schema/<table>.ts`, exportado desde `backend/schema/index.ts` (solo
   se sirve lo que exporta el index), con una directiva `rls` obligatoria.
   Nunca edites a mano el esquema generado de Drizzle ni las tablas de Postgres;
   consulta [Schema as Code](/docs/architecture/schema-as-code).
2. **Aplicar un cambio de esquema** depende de la base de datos. Mientras `pnpm dev`
   se está ejecutando, guardar un archivo en `backend/schema/` es todo lo que se
   necesita: regenera el esquema de Drizzle y los tipos del SDK, y el inicio
   crea las tablas y columnas faltantes. `pnpm db:push` es solo para lo que el
   inicio deliberadamente no toca (una columna renombrada, un tipo restringido,
   una columna eliminada), tanto en la base de datos de desarrollo administrada
   como en tu propio PostgreSQL. En producción se utiliza `pnpm db:generate` y
   luego `pnpm db:migrate`.
3. **Usa el SDK.** Utiliza `rebase.dataAsAdmin.<table>` para el trabajo realizado
   con la identidad del servicio, o `getDriver(c)` dentro de una función cuando
   la lectura deba ejecutarse con los permisos de quien llama. El cliente del
   servidor no tiene un descriptor de acceso `data` plano. El SQL en crudo y las
   llamadas directas a Drizzle eluden la validación, los hooks y el RLS.
4. **Protege cada ruta personalizada.** Las rutas en `backend/functions/` se montan
   *sin* autenticación. Usa `requireAuth` / `requireAdmin` de
   `@rebasepro/server/functions` en el slot de middleware propio de la ruta: leer
   `c.get("user")` no es una protección, y tampoco lo es `app.use()` colocado
   después de la ruta.

Esa última regla es fundamental. Es la diferencia entre un middleware que se
ejecuta y uno que no, y un asistente al que no se le haya advertido escribirá
invariablemente la versión que no lo hace; consulta
[Funciones personalizadas](/docs/backend/custom-functions).

`requireAdmin` admite únicamente el rol `admin`. Cuando un rol más restringido o
una API key deba poder llamar a una ruta, la protección a agregar es
`requireScope`, con un scope declarado por la aplicación; consulta
[Roles y scopes](/docs/backend/roles-and-scopes/#app-scopes).

Después de las reglas vienen dos secciones que aplican solo en algunos proyectos.
**Backend runtime** lista lo que permite el runtime administrado en Rebase Cloud:
paquetes, memoria y estado a nivel de módulo, timeouts, puertos salientes,
configuración y almacenamiento para archivos generados. Enlaza a
[Managed backend runtime](/docs/deployment/managed-runtime/), de modo que un
asistente planifique una funcionalidad de backend basándose en límites reales en
lugar de adivinar. **Admin UI** contiene las reglas de `@rebasepro/ui`. Aplican a
las vistas dentro del panel de administración, no a un sitio público o aplicación
estática que sirva el proyecto.

## Hazlo tuyo

`ai-instructions.md` es tu archivo. Nada lo regenera ni lo sobrescribe, a
diferencia de las [skills instaladas](/docs/ai/skills), que se reemplazan en
cada `rebase skills install`. Las convenciones específicas del proyecto van aquí.

Lo que merece un lugar aquí es aquello que un asistente no puede inferir a partir
del código: qué tablas son legacy, qué servicio es propietario de qué tabla,
la convención de nomenclatura que no se aplica en ninguna otra parte, la
migración que no debe volver a ejecutarse. Mantenlo breve: las instrucciones
cargadas en cada petición compiten por la atención con la tarea real, y un
archivo largo es uno que el asistente leerá solo por encima.

Y ten presente el límite: este archivo define lo que un asistente *escribe*. No
influye en lo que un agente conectado a tu base de datos puede *hacer*; eso lo
determina la credencial que porta, y nada en Markdown cambiará eso. Consulta
[el modelo de credenciales del servidor MCP](/docs/ai/mcp#what-the-server-can-reach).

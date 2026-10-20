---
sourceHash: 5dd46da9d88b962e
title: Archivos de instrucciones de IA
sidebar_label: Archivos de instrucciones de IA
description: Cada proyecto de Rebase generado incluye ai-instructions.md junto con archivos de puntero de tres líneas para Claude, Cursor, Windsurf, Copilot y AGENTS.md — una única fuente de verdad, muchos nombres de archivo.
---

Cada asistente quiere sus reglas en un archivo diferente. Claude Code lee
`CLAUDE.md`, Cursor lee `.cursorrules`, Windsurf lee `.windsurfrules`,
Copilot lee `.github/copilot-instructions.md`, y la convención entre proveedores
es `AGENTS.md`. Mantener la misma guía en cinco archivos es la razón por la que
cuatro de ellos terminan desactualizados.

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

Cada archivo de puntero consta de tres líneas:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.
```

En la versión 0.23, la tercera línea solo le indica al asistente que ejecute
`rebase skills install --agent claude`, y el archivo `.mcp.json` que se muestra a
continuación inicia el servidor con `npx -y @rebasepro/mcp` desde el registro.

Los demás se diferencian únicamente en el directorio de habilidades del agente y
en su valor `--agent` (`--agent cursor`, `--agent windsurf`, `--agent codex`,
`--agent copilot`), así como en la ruta relativa, que es `../ai-instructions.md`
en `.github/copilot-instructions.md` y `ai-instructions.md` en `AGENTS.md`. La
tercera línea es condicional porque `rebase init --agent` puede haber instalado
ya las habilidades antes de que el asistente las lea.

Esto ocurre en cada `rebase init`, para cada preset incluyendo `--headless`.
No hay ningún flag ni interacción por consola.

`rebase init` también escribe `.mcp.json`, que apunta Claude Code, Cursor y
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
no se puede confirmar en el repositorio (commit). Está ahí porque
`~/.rebase/projects.json` es a nivel de toda la máquina; un proyecto que no
especifica un directorio propio recurre al que haya persistido el último proyecto
en esa máquina. Consulta [la precedencia](/docs/ai/mcp#which-directory-it-acts-on).

## Por qué un puntero en lugar de una copia

Los archivos de puntero carecen deliberadamente de contenido. Los asistentes siguen
los enlaces relativos de Markdown, por lo que un archivo de tres líneas que apunta
al verdadero obtiene el mismo resultado que una copia, y además tiene propiedades
que una copia no posee:

- **Un solo archivo para editar.** Las reglas no pueden diferir entre asistentes,
  porque solo hay un conjunto de reglas.
- **Un solo diff para revisar.** Un cambio en las convenciones del proyecto es un
  cambio en un solo archivo, no en cinco archivos idénticos que un revisor deba
  comparar.
- **Añadir un asistente toma tres líneas.** Una nueva herramienta con un nuevo
  nombre de archivo recibe un puntero, no una sexta copia de tus convenciones.

Vale la pena mantener este patrón si haces un fork de la estructura inicial (scaffold),
y vale la pena adoptarlo en repositorios que ni siquiera son proyectos de Rebase.

## Con qué comienza `ai-instructions.md`

El archivo generado es deliberadamente breve: apunta a
[`rebase skills install`](/docs/ai/skills) para mayor profundidad y luego establece
las reglas en las que los asistentes se equivocan con suficiente frecuencia como
para que valga la pena repetirlas al inicio de cada sesión:

1. **Esquema como código.** Las colecciones se definen en `config/collections/`.
   Nunca edites a mano el esquema generado de Drizzle ni las tablas de Postgres;
   consulta [Esquema como código](/docs/architecture/schema-as-code).
2. **Aplicar un cambio en una colección** depende de la base de datos. Mientras
   `pnpm dev` esté en ejecución, guardar el archivo de la colección es todo lo
   que necesitas hacer: el arranque regenera el esquema de Drizzle y crea las
   tablas y columnas faltantes. `pnpm db:push` es solo para lo que el arranque
   deliberadamente ignora (una columna renombrada, un tipo más restrictivo, un
   campo eliminado), tanto en la base de datos de desarrollo administrada como en
   tu propio PostgreSQL. En producción se utiliza `pnpm db:generate` y luego
   `pnpm db:migrate`. En la versión 0.24, `pnpm db:push` requiere tu propio
   PostgreSQL, y el archivo así lo indica.
3. **Usa el SDK.** Utiliza `rebase.dataAsAdmin.<slug>` para el trabajo realizado
   como la identidad del servicio, o `getDriver(c)` dentro de una función cuando
   la lectura deba ejecutarse como el emisor de la llamada (caller). El cliente
   del servidor no tiene un descriptor de acceso simple `data`. Las consultas
   SQL directas y las llamadas directas a Drizzle omiten la validación, los
   callbacks y RLS.
4. **Protege cada ruta personalizada.** Las rutas en `backend/functions/` se
   montan *sin* autenticación. Usa `requireAuth` / `requireAdmin` de
   `@rebasepro/server/functions` en la ranura de middleware propia de la ruta;
   leer `c.get("user")` no es una protección, y tampoco lo es `app.use()`
   después de la ruta.

Esta última es fundamental. Es la diferencia entre un middleware que se ejecuta
y uno que no, y un asistente al que no se le haya advertido escribirá
invariablemente la versión que no lo hace; consulta
[Funciones personalizadas](/docs/backend/custom-functions).

`requireAdmin` solo admite el rol `admin`. Cuando un rol más restringido o una
clave de API deban poder invocar una ruta, la protección que se debe agregar es
`requireScope`, con un alcance que la aplicación declare; consulta
[Roles y alcances](/docs/backend/roles-and-scopes/#app-scopes).

Después de las reglas vienen dos secciones que solo aplican a algunos proyectos.
**Backend runtime** enumera lo que permite el entorno de ejecución administrado
en Rebase Cloud: paquetes, memoria y estado a nivel de módulo, tiempos de espera
(timeouts), puertos de salida, configuración y almacenamiento para archivos
generados. Enlaza a
[Entorno de ejecución de backend administrado](/docs/deployment/managed-runtime/),
para que el asistente planifique una funcionalidad de backend considerando los
límites reales en lugar de adivinarlos. **Admin UI** contiene las reglas de
`@rebasepro/ui`. Aplican a las vistas dentro del panel de administración, no a un
sitio público o aplicación estática que sirva el proyecto.

## Hacerlo tuyo

`ai-instructions.md` es tu archivo. Nada lo regenera ni lo sobrescribe, a
diferencia de las [habilidades instaladas](/docs/ai/skills), que se reemplazan en
cada `rebase skills install`. Las convenciones específicas del proyecto
pertenecen a este archivo.

Lo que merece un lugar aquí es aquello que un asistente no puede inferir a partir
del código: qué colecciones son heredadas (legacy), qué servicio es propietario
de qué tabla, la convención de nomenclatura que no se aplica en ninguna parte, la
migración que no debe volver a ejecutarse. Mantenlo breve: las instrucciones
cargadas en cada solicitud compiten por atención con la tarea real, y un archivo
extenso es uno que el asistente leerá solo superficialmente.

Y ten en cuenta los límites: este archivo define lo que un asistente *escribe*. No
tiene ningún impacto en lo que un agente conectado a tu base de datos puede *hacer*;
eso lo determina la credencial que porta, y nada en Markdown puede cambiarlo.
Consulta [el modelo de credenciales del servidor MCP](/docs/ai/mcp#what-the-server-can-reach).

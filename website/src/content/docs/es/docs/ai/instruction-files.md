---
title: Archivos de instrucciones de IA
sidebar_label: Archivos de instrucciones de IA
description: Cada proyecto Rebase generado incluye ai-instructions.md junto con archivos de puntero de una línea para Claude, Cursor, Windsurf, Copilot y AGENTS.md — una sola fuente de verdad, muchos nombres de archivo.
---

Cada asistente busca sus reglas en un archivo diferente. Claude Code lee
`CLAUDE.md`, Cursor lee `.cursorrules`, Windsurf lee `.windsurfrules`,
Copilot lee `.github/copilot-instructions.md` y la convención entre
proveedores es `AGENTS.md`. Mantener las mismas directrices en cinco archivos
es la razón por la que cuatro de ellos terminan desactualizados.

`rebase init` crea los cinco — como **punteros a un único archivo que realmente
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

Cada archivo de puntero tiene dos líneas:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
```

`.github/copilot-instructions.md` es idéntico excepto por la ruta relativa
(`../ai-instructions.md`).

Esto ocurre en cada `rebase init`, para cada preset, incluido `--headless`.
No hay ningún flag ni confirmación interactiva.

## Por qué un puntero en lugar de una copia

Los archivos de puntero están deliberadamente vacíos de contenido. Los asistentes
siguen enlaces relativos de Markdown, por lo que un archivo de dos líneas que
apunta al real obtiene el mismo resultado que una copia — y tiene propiedades
que una copia no tiene:

- **Un solo archivo para editar.** Las reglas no se desincronizan entre
  asistentes, porque solo hay un conjunto de reglas.
- **Un solo diff para revisar.** Un cambio en las convenciones del proyecto es
  un cambio en un solo archivo, no en cinco archivos idénticos que un revisor
  deba comparar.
- **Añadir un asistente requiere dos líneas.** Una nueva herramienta con un
  nuevo nombre de archivo solo necesita un puntero, no una sexta copia de tus
  convenciones.

Vale la pena mantener este patrón si haces un fork del scaffold, y vale la pena
adoptarlo en repositorios que ni siquiera sean proyectos de Rebase.

## Con qué comienza `ai-instructions.md`

El archivo generado es deliberadamente breve: remite a
[`rebase skills install`](/docs/ai/skills) para mayor profundidad y luego
establece cuatro reglas en las que los asistentes se equivocan con la frecuencia
suficiente como para que valga la pena repetirlas al inicio de cada sesión:

1. **Esquema como código.** Las colecciones se definen en `config/collections/`.
   Nunca edites a mano el esquema generado de Drizzle ni las tablas de
   Postgres — consulta [Schema as Code](/docs/architecture/schema-as-code).
2. **Las migraciones son de dos pasos.** `rebase schema generate`, luego
   `rebase db push` en desarrollo, o `rebase db generate && rebase db migrate`
   para producción.
3. **Usa el SDK.** Accede a través de `client.data.<slug>` (browser) / `rebase.dataAsAdmin.<slug>` (server); el SQL directo y
   las llamadas directas a Drizzle omiten la validación, los callbacks y RLS.
4. **Protege cada ruta personalizada.** Las rutas en `backend/functions/` se
   montan *sin* autenticación. Usa `requireAuth` / `requireAdmin` de
   `@rebasepro/server` en la propia ranura de middleware de la ruta — leer
   `c.get("user")` no es una protección, y tampoco lo es `app.use()` después
   de la ruta.

Esta última es fundamental. Es la diferencia entre un middleware que se ejecuta
y uno que no, y un asistente al que no se le haya indicado escribirá
infaliblemente la versión que no lo hace — consulta
[Custom Functions](/docs/backend/custom-functions).

## Hazlo tuyo

`ai-instructions.md` es tu archivo. Nada lo regenera ni lo sobrescribe — a
diferencia de las [skills instaladas](/docs/ai/skills), que se reemplazan en
cada `rebase skills install`. Las convenciones específicas del proyecto
pertenecen aquí.

Lo que merece un lugar aquí es lo que un asistente no puede inferir del código:
qué colecciones son legacy, qué servicio es propietario de qué tabla, la
convención de nomenclatura que no se aplica en ninguna parte, la migración que
no debe volver a ejecutarse. Mantenlo breve: las instrucciones cargadas en cada
solicitud compiten por la atención con la tarea real, y un archivo largo es un
archivo que el asistente leerá por encima.

Y ten en cuenta el límite: este archivo da forma a lo que un asistente *escribe*.
No tiene ningún impacto en lo que un agente conectado a tu base de datos pueda
*hacer* — eso lo decide la credencial que posee, y nada en Markdown puede
cambiarlo. Consulta
[el modelo de credenciales del servidor MCP](/docs/ai/mcp#what-the-server-can-reach).

---

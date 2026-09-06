---
sourceHash: deec6d59eab82ff5
title: Herramientas de Studio
sidebar_label: Studio
description: Rebase Studio proporciona herramientas para desarrolladores para la edición visual de esquemas, consultas SQL, scripting de JavaScript, gestión de políticas RLS y navegación de almacenamiento.
---

## Overview

Rebase tiene dos modos:

- **Modo Contenido** — Para editores de contenido y equipos de operaciones. Muestra colecciones y gestión de datos.
- **Modo Studio** — Para desarrolladores. Desbloquea herramientas orientadas a desarrolladores.

Alterna entre modos usando el controlador de modo de administración o el interruptor de UI en la barra de la aplicación.

## Herramientas de Studio Integradas

### Collection Editor

Un editor visual de esquemas que te permite crear y modificar colecciones a través de una interfaz de usuario de arrastrar y soltar. Cuando guardas los cambios, utiliza [ts-morph](https://ts-morph.com/) para actualizar tus archivos fuente de TypeScript mediante manipulación de AST — preservando todo el código existente y la lógica personalizada.

![Editor de colecciones](/img/collection_editor.png)

El editor está activo dondequiera que se monte Studio — el `<RebaseStudio/>` de un scaffold basta, y no hay ninguna prop que añadir. `collectionEditor` lo ajusta, no lo activa:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// Studio está montado, así que el editor de colecciones está disponible.
// No hace falta nada más.
<Rebase>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` sirve para ajustarlo — un editor de solo lectura,
// otro token — no para activarlo.
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

Que un *guardado* llegue a aplicarse lo decide el servidor, no el panel: el editor reescribe los archivos fuente de las colecciones, así que está desactivado bajo `NODE_ENV=production`, en modo `baas` y en un servidor sin `collectionsDir`. El panel consulta `GET /api/schema-editor/status` y muestra el motivo que recibe junto al botón deshabilitado.

### Herramientas integradas

Se incluyen con Studio y **`RebaseStudio` las carga de forma diferida** — cada una es un chunk aparte, que se descarga la primera vez que la abres. No se pueden importar por separado: `@rebasepro/studio` exporta deliberadamente solo el orquestador, de modo que una consola que nunca abres no cuesta nada.

| Pestaña | Slug | Qué hace |
|---------|------|----------|
| Consola SQL | `sql` | Ejecuta SQL directo contra tu base de datos PostgreSQL y lee los resultados en una tabla |
| Consola JS | `js` | Escribe y ejecuta JavaScript a través del SDK de Rebase |
| Editor de políticas RLS | `rls` | Inspecciona y gestiona las políticas de Row Level Security de tus tablas |
| Navegador de almacenamiento | `storage` | Explora, sube y gestiona archivos en tus backends de almacenamiento |


## Añadir vistas de Studio

Las herramientas de Studio están automáticamente disponibles cuando incluyes el componente `RebaseStudio` dentro de tu aplicación:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            {/* Custom views are injected and studio mode is managed automatically */}
            <RebaseStudio />
            {/* ... */}
        </Rebase>
    );
}
```

Estas vistas aparecen en la navegación de la barra lateral cuando el modo Studio está activo.

## Próximos Pasos

- **[Plugins](/docs/plugins)** — Extiende el framework con plugins
- **[Colecciones](/docs/collections)** — Configuración de colecciones
---

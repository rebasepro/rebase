---
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

```tsx
import { RebaseAdmin } from "@rebasepro/admin";

// The Collection Editor is automatically enabled when you provide the 
// collectionEditor configuration to your RebaseAdmin component
<RebaseAdmin
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

### SQL Console

Ejecuta consultas SQL en bruto contra tu base de datos PostgreSQL y ve los resultados en una tabla:

```tsx
import { SQLEditor } from "@rebasepro/studio";

{ slug: "sql", name: "SQL Console", view: <SQLEditor /> }
```

### JS Console

Escribe y ejecuta JavaScript usando el SDK de Rebase:

```tsx
import { JSEditor } from "@rebasepro/studio";

{ slug: "js", name: "JS Console", view: <JSEditor /> }
```

### Editor de políticas RLS

Visualiza y gestiona políticas de Seguridad a Nivel de Fila (RLS) para tus tablas PostgreSQL:

```tsx
import { RLSEditor } from "@rebasepro/studio";

{ slug: "rls", name: "RLS Policies", view: <RLSEditor /> }
```

### Storage Browser

Explora, sube y gestiona archivos en tus backends de almacenamiento:

```tsx
import { StorageView } from "@rebasepro/studio";

{ slug: "storage", name: "Storage", view: <StorageView /> }
```

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

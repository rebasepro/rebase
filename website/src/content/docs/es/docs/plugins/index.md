---
sourceHash: eff51262efe91a3e
title: Sistema de plugins
sidebar_label: Plugins
description: Extiende Rebase con plugins — inyecta componentes de UI, modifica colecciones, añade acciones a la barra de herramientas y crea constructores de campos personalizados.
---

## Descripción general

**Los plugins son un concepto del panel de administración.** Se ejecutan en el
navegador, dentro de la interfaz de administración de React, y se registran
donde la construyes. Nada en esta página llega al backend: un plugin no puede
añadir una ruta, un callback o un cron. Para eso, consulta
[Funciones personalizadas](/docs/backend/custom-functions), [Callbacks de
entidad](/docs/collections/callbacks) y [Tareas cron](/docs/backend/cron-jobs).

Los plugins son el mecanismo principal de extensión en el panel. Pueden:

- Envolver toda la aplicación con un **provider** (contexto, gestión de estado)
- Añadir **acciones de la página de inicio** y widgets
- Inyectar componentes de **vista de colección** (barra de herramientas, constructores de columnas)
- Añadir componentes de **formulario** (constructores de campos, paneles adicionales)
- **Inyectar o modificar colecciones** dinámicamente

## Interfaz del plugin

```typescript
interface RebasePlugin {
    key: string;                    // Unique identifier
    loading?: boolean;              // Hold admin content until the plugin is ready

    // UI contributions — a flat array, each entry naming its slot.
    // This replaced the old per-area objects (homePage, collectionView, form).
    slots?: SlotContribution[];

    // HOC providers. `scope: "root"` wraps the whole admin below
    // RebaseContext; `scope: "form"` wraps each entity form / edit view.
    providers?: PluginProvider[];

    // Behavioural (non-UI) hooks: collection modification and injection,
    // column reordering, navigation entries.
    hooks?: PluginHooks;

    // Custom field rendering (e.g. data enhancement).
    fieldBuilder?: FieldBuilderConfig;

    // Views added to the navigation automatically.
    views?: AppView[];

    // onMount, onAuthStateChange, onUnmount — see below.
    lifecycle?: PluginLifecycle;
}
```

Cada uno de estos es opcional excepto `key`. La lista completa de nombres de slots
se encuentra en la página de **[Slots](/docs/frontend/slots)**.

### Ciclo de vida

- `onMount(context)` se ejecuta una vez, cuando la autenticación está lista por
  primera vez: hay un usuario con sesión iniciada, o se omitió el inicio de
  sesión.
- `onAuthStateChange(user)` se ejecuta en cada cambio de usuario posterior: con
  el nuevo usuario al iniciar sesión, con `null` al cerrarla. El plugin sigue
  montado en ambos casos.
- `onUnmount()` se ejecuta cuando `<Rebase>` se desmonta.

## Uso de plugins

Los plugins se colocan en `<Rebase>`, junto al cliente. Todo lo que esté
debajo —la navegación, las vistas de colección, los formularios— los lee desde allí:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

export function App() {
    const authController = useRebaseAuthController({ client });
    const dataEnhancementPlugin = useDataEnhancementPlugin();

    return (
        <Rebase
            client={client}
            authController={authController}
            plugins={[dataEnhancementPlugin]}
        >
            <RebaseCMS collections={collections}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Por lo general, los plugins se construyen mediante un hook, por lo que el array
se reconstruye en cada renderizado; esto es normal y es la razón por la cual
`plugins` es una prop en lugar de algo que debas memorizar manualmente. Dos
plugins con la misma `key` son un error: `<Rebase>` registra los duplicados en
lugar de descartar uno silenciosamente.

Para una sola contribución no necesitas un plugin en absoluto: `<Rebase slots>`
acepta directamente las mismas entradas `SlotContribution`.

### Con composición manual

Solo si has reemplazado `<RebaseShell>` con las capas subyacentes, la lista de
plugins debe pasarse manualmente al controlador de navegación:

```tsx
const navigationStateController = useBuildNavigationStateController({
    plugins,
    collections: () => collections,
    // These four are required — the controller resolves navigation against them.
    authController,
    data,
    collectionRegistryController,
    urlController
});
```

`<RebaseNavigation>` realiza exactamente esta llamada por ti, leyendo `plugins`
del controlador de personalización que proporciona `<Rebase>`. Consulta
[Avanzado: diseño manual](/docs/frontend#advanced-manual-layout).

## Creación de un plugin

Aquí tienes un plugin mínimo que añade una acción a la barra de herramientas en
cada colección:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

function useMyPlugin(): RebasePlugin {
    return {
        key: "my_plugin",

        // `slots` is a flat array of contributions, each naming its slot.
        // See the Slots page for the full list of slot names.
        slots: [
            { slot: "collection.actions", Component: MyToolbarAction }
        ],

        // `fieldBuilder` is top-level and takes a `wrap` function that returns
        // a *component* (or null to leave the default field alone) — it is not
        // a render function and no longer lives under `form`.
        fieldBuilder: {
            wrap: ({ property }) =>
                property.propertyConfig === "my_custom_field" ? MyCustomField : null
        }
    };
}
```

## Plugins integrados



### Plugin Data Enhancement

Autocompletado de campos impulsado por IA:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Mejora de datos](/img/data_enhancement.png)

:::caution[Este plugin envía datos fuera de tu equipo]
El autocompletado envía los valores de los campos de la entidad a un servicio
alojado para generar una sugerencia. Por defecto, ese servicio es
**`https://app.rebase.pro/api/functions/ai`**, operado por Rebase — de uso
gratuito, sin configuración y sin credenciales adjuntas: las peticiones son
anónimas, limitadas por tasa de solicitudes en lugar de por identidad. Tu JWT no
se envía.

Que esto sea aceptable o no depende de lo que contengan los campos. Apunta el
`endpoint` a tu propio despliegue para mantener la generación dentro de tu
infraestructura:

```typescript no-verify
const enhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

El formato de transmisión es todo el contrato; consulta `api.ts` en
`@rebasepro/plugin-ai`, con una implementación de referencia en
`functions/ai.ts` del plano de control. El plugin no renderiza nada hasta que el
host al que apunta informe que está disponible en `GET /status`, por lo que una
URL incorrecta simplemente ocultará el botón en lugar de provocar una petición
fallida.

Todos los demás plugins integrados son locales para el navegador y no envían
nada a ninguna parte.
:::

## Inyección de colecciones

Los plugins pueden añadir nuevas colecciones dinámicamente:

```typescript
hooks: {
    // Receives the resolved collections and returns the full list to use.
    injectCollections: (collections) => [...collections, auditLogCollection]
}
```

## Modificación de colecciones

Los plugins pueden modificar colecciones existentes:

```typescript
hooks: {
    // Receives one collection, returns the modified one.
    // Use `modifyCollectionAsync` when the change needs a fetch.
    modifyCollection: (collection) => ({
        ...collection,
        properties: {
            ...collection.properties,
            last_modified_by: {
                type: "string",
                name: "Modified By",
                admin: { readOnly: true }
            }
        }
    })
}
```

## Próximos pasos

- **[Herramientas de Studio](/docs/studio)** — Consola SQL, consola JS, editor RLS
- **[Campos personalizados](/docs/frontend/custom-fields)** — Creación de campos de formulario personalizados

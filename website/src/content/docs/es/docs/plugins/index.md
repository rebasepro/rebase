---
sourceHash: d1b243f804318232
title: Sistema de plugins
sidebar_label: Plugins
description: Extiende Rebase con plugins — inyecta componentes de interfaz de usuario, modifica colecciones, añade acciones a la barra de herramientas y crea constructores de campos personalizados.
---

## Descripción general

**Los plugins son un concepto del panel de administración.** Se ejecutan en el
navegador, dentro de la interfaz de administración de React, y se registran donde
se construye. Nada en esta página llega al backend: un plugin no puede añadir una
ruta, un callback o un cron. Para eso, consulta
[Custom Functions](/docs/backend/custom-functions), [Entity
Callbacks](/docs/collections/callbacks) y [Cron Jobs](/docs/backend/cron-jobs).

Los plugins son el mecanismo de extensión principal en el panel. Pueden:

- Envolver toda la aplicación con un **provider** (contexto, gestión de estado)
- Añadir **acciones en la página de inicio** y widgets
- Inyectar componentes de **vista de colección** (barra de herramientas, encabezados de columnas)
- Añadir componentes de **formulario** (constructores de campos, paneles adicionales)
- **Inyectar o modificar colecciones** dinámicamente

## Interfaz del plugin

```typescript
interface RebasePlugin {
    key: string;                    // Unique identifier
    loading?: boolean;              // Hold admin content until the plugin is ready

    // UI contributions — a flat array, each entry naming its slot.
    // This replaced the old per-area objects (homePage, collectionView, form).
    slots?: AnySlotContribution[];

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

Cada uno de estos es opcional excepto `key`. La lista completa de nombres de slots se
encuentra en la página de **[Slots](/docs/frontend/slots)**.

### Ciclo de vida

- `onMount(context)` se ejecuta una vez, cuando la autenticación está lista por
  primera vez: un usuario ha iniciado sesión o se ha omitido el inicio de sesión.
- `onAuthStateChange(user)` se ejecuta en cada cambio posterior de usuario: el
  nuevo usuario al iniciar sesión, `null` al cerrar sesión. El plugin permanece
  montado en ambos casos.
- `onUnmount()` se ejecuta cuando `<Rebase>` se desmonta.

`lifecycle.onCollectionChange` está obsoleto (deprecated). Nada llegó a llamarlo
nunca. Un plugin que lo configure aún compilará, y `<Rebase>` advertirá una vez por
plugin. Para seguir las filas de una colección, suscríbete desde `onMount` y
cancela la suscripción en `onUnmount`:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

let stopListening: (() => void) | undefined;

const openOrdersPlugin: RebasePlugin = {
    key: "open_orders",
    lifecycle: {
        onMount: (context) => {
            stopListening = context.data.orders.listen(
                { where: { status: ["==", "open"] } },
                ({ data }) => console.log(`${data.length} open orders`)
            );
        },
        onUnmount: () => stopListening?.()
    }
};
```

## Uso de plugins

Los plugins se colocan en `<Rebase>`, junto al cliente. Todo lo que esté por debajo
(la navegación, las vistas de colección, los formularios) los lee desde allí:

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
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Por lo general, los plugins se construyen mediante un hook, por lo que el array se
reconstruye en cada renderizado; esto es normal, y es la razón por la que `plugins`
es una prop en lugar de algo que debas memoizar manualmente. Dos plugins con la misma
`key` son un error: `<Rebase>` registra los duplicados en los logs en lugar de
descartar uno silenciosamente.

Para una única contribución no necesitas un plugin en absoluto: `<Rebase slots>`
acepta las mismas entradas `SlotContribution` directamente.

### Bajo composición manual

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

`<RebaseNavigation>` realiza exactamente esta llamada por ti, leyendo `plugins` desde
el controlador de personalización que proporciona `<Rebase>`. Consulta
[Advanced: manual layout](/docs/frontend#advanced-manual-layout).

## Creación de un plugin

Aquí tienes un plugin mínimo que añade una acción a la barra de herramientas en cada
colección:

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
        // a *component* (or null to leave the field as it is) — it is not
        // a render function and no longer lives under `form`.
        fieldBuilder: {
            wrap: ({ property }) =>
                property.propertyConfig === "my_custom_field" ? MyCustomField : null
        }
    };
}
```

### Wrappers de campos de varios plugins

Los wrappers de varios plugins se componen en el orden del array `plugins`. La
función `wrap` de cada plugin recibe, como `params.Field`, el campo tal como lo
dejaron los plugins anteriores, de modo que el wrapper del primer plugin es el más
interno y el del último es el más externo. Un plugin cuyo `wrap` devuelva `null`,
o cuyo guard `enabled` devuelva `false` para el campo, lo pasa sin cambios. Por lo
tanto, un wrapper que renderiza `Field` conserva todos los wrappers anteriores:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";
import { Typography } from "@rebasepro/ui";

const descriptionPlugin: RebasePlugin = {
    key: "description_below",
    fieldBuilder: {
        // `Field` is the built-in field, or the earlier plugins' wrapper of it.
        wrap: ({ Field, property }) => property.description
            ? (props) => (
                <>
                    <Field {...props}/>
                    <Typography variant="caption" color="secondary">
                        {property.description}
                    </Typography>
                </>
            )
            : null
    }
};
```

## Plugins integrados



### Plugin Data Enhancement

Autocompletado de campos potenciado por IA:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

Añade una acción de Autofill a cada formulario y un comando de barra inclinada (slash command)
**Autocomplete** a cada campo markdown, el cual continúa el texto desde el cursor. Ambos
aparecen solo donde el plugin está habilitado: el servicio se reporta a sí mismo como
disponible y `getConfigForPath` (cuando pasas uno) permite la colección. Un campo cuyo
`customProps.editorProps.aiController` designe un controlador propio utilizará ese.
Otro plugin puede proporcionar a los campos markdown un controlador de la misma manera,
mediante `EditorAIControllerProvider` de `@rebasepro/cms` en un provider con alcance de
formulario (form-scoped).

![Data enhancement](/img/data_enhancement.png)

:::caution[Este plugin envía datos fuera de tu máquina]
Autofill envía mediante POST los valores de los campos de la entidad a un servicio
alojado para generar una sugerencia: únicamente los valores de las propiedades
declaradas, nunca de una de solo lectura, deshabilitada u oculta, con `dynamicProps`,
o una columna que la colección no declare. Por defecto, ese servicio es
**`https://app.rebase.pro/api/functions/ai`**, gestionado por Rebase — de uso
gratuito, sin configuración y sin credenciales adjuntas: las peticiones son anónimas,
limitadas por tasa de uso (rate limit) en lugar de por identidad. Tu JWT no se envía.
El autocompletado mediante comando de barra inclinada del editor también envía texto:
hasta 8.000 caracteres a cada lado del cursor, nunca el documento completo.

Que esto sea aceptable depende de lo que contengan los campos. Apunta `endpoint` a tu
propio despliegue para mantener la generación dentro de tu infraestructura:

```typescript no-verify
const enhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

El formato de transmisión (wire format) constituye todo el contrato; consulta `api.ts`
en `@rebasepro/plugin-ai`, con una implementación de referencia en `functions/ai.ts`
del plano de control. El plugin no renderiza nada hasta que el host al que apunta
indique que está disponible en `GET /status`, por lo que una URL incorrecta se traduce
en un botón que no aparece en lugar de una petición fallida.

Todos los demás plugins integrados son locales en el navegador y no envían nada a
ninguna parte.
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

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Los plugins pueden modificar colecciones existentes:

```typescript
hooks: {
    // Receives one collection, returns the modified one.
    modifyCollection: (collection) => ({
        ...collection,
        description: `${collection.description ?? ""} Managed by the ops team.`.trim()
    })
}
```

La colección que recibe un plugin es la vista resuelta de una tabla en el panel,
después de haber aplicado su `customizeTable`, por lo que un plugin ve lo que el
panel está a punto de dibujar.

`modifyCollection` es síncrono y la administración lo aplica cuando resuelve sus
colecciones, no cada vez que el plugin cambia. Cuando el cambio necesita datos que
debes obtener (fetch), obténlos antes de renderizar `<Rebase>` y construye el
plugin a partir de lo recibido:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import type { RebasePlugin } from "@rebasepro/cms-types";
import { CircularProgressCenter } from "@rebasepro/ui";

export function App() {
    const authController = useRebaseAuthController({ client });
    const [labels, setLabels] = useState<Record<string, string>>();

    useEffect(() => {
        fetch("/collection-labels.json")
            .then((response) => response.json())
            .then(setLabels);
    }, []);

    const labelsPlugin = useMemo<RebasePlugin | undefined>(() => labels && {
        key: "collection_labels",
        hooks: {
            modifyCollection: (collection) => ({
                ...collection,
                name: labels[collection.slug] ?? collection.name
            })
        }
    }, [labels]);

    if (!labelsPlugin) return <CircularProgressCenter/>;

    return (
        <Rebase client={client} authController={authController} plugins={[labelsPlugin]}>
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

`hooks.modifyCollectionAsync` está obsoleto (deprecated). Nada llegó a llamarlo nunca.
Un plugin que lo configure aún compilará, y `<Rebase>` advertirá una vez por plugin.
Utiliza `modifyCollection` como se muestra arriba.

## Próximos pasos

- **[Studio Tools](/docs/studio)** — Consola SQL, consola JS, editor de RLS
- **[Custom Fields](/docs/frontend/custom-fields)** — Creación de campos de formulario personalizados

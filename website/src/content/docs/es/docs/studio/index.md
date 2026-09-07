---
sourceHash: c9634d9fe5d4bd79
title: Herramientas de Studio
sidebar_label: Studio
description: Rebase Studio proporciona herramientas para desarrolladores para la edición visual de esquemas, consultas SQL, scripting de JavaScript, gestión de políticas RLS y navegación de almacenamiento.
---

## Resumen

Studio es la mitad de desarrollo del panel de administración. La misma aplicación
que tu equipo de contenido usa para editar filas lleva también un editor de
esquemas, una consola SQL, un bloc de notas de JavaScript, un navegador de
políticas RLS y un navegador de almacenamiento — y Studio es el modo que los
desbloquea. Nada que instalar y nada que desplegar: ya está en el panel, detrás
del interruptor del cajón lateral.

![El editor de colecciones, la herramienta insignia de Studio: un editor visual de esquemas que reescribe tu TypeScript](/img/collection_editor.png)

Existe porque la alternativa es un segundo juego de credenciales. Editar una
colección, comprobar qué permite realmente una política o ejecutar una sola
consulta contra producción significa, si no, un cliente de base de datos, una
copia de la cadena de conexión y un registro de auditoría que acaba en «alguien
con psql». Studio hace todo eso como el administrador que ha iniciado sesión, a
través de la misma autorización que usa la API.

## Los dos modos

El panel tiene dos modos — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Para editores de contenido y equipos de operaciones. Muestra colecciones y gestión de datos. Es el valor por defecto.
- **Studio** (`"studio"`) — Para desarrolladores. Desbloquea las herramientas de abajo.

Alterna entre ellos con el controlador de modo de administración o con el
interruptor del cajón. El modo elegido se guarda en `localStorage` bajo
`rebase-admin-mode`; un navegador que usó el panel antes de 0.17.0 conserva el
valor antiguo `"content"` y se migra a `"cms"` al leerlo.

## Herramientas de Studio integradas

### Collection Editor

Un editor visual de esquemas que te permite crear y modificar colecciones a través de una interfaz de usuario de arrastrar y soltar. Cuando guardas los cambios, utiliza [ts-morph](https://ts-morph.com/) para actualizar tus archivos fuente de TypeScript mediante manipulación de AST — preservando todo el código existente y la lógica personalizada. Es la captura de pantalla del principio de esta página.

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

| Pestaña | Slug | Grupo | Qué hace |
|---------|------|-------|----------|
| Consola SQL | `sql` | Base de datos | Ejecuta SQL directo contra tu base de datos PostgreSQL y lee los resultados en una tabla |
| Políticas RLS | `rls` | Base de datos | Inspecciona y gestiona las políticas de Row Level Security de tus tablas |
| Visualizador de esquema | `schema-visualizer` | Base de datos | ERD interactivo de tablas y relaciones |
| Ramas | `branches` | Base de datos | Crea y gestiona [ramas de base de datos](/docs/backend/branching) |
| Copias de seguridad | `backups` | Base de datos | Explora y descarga las copias de seguridad de la base de datos |
| Explorador de logs | `logs` | Base de datos | Registro de peticiones en vivo, más todo lo que el servidor reporta en warn o error — ver abajo |
| Consola JS | `js` | Compute | Escribe y ejecuta JavaScript a través del SDK de Rebase |
| Tareas cron | `cron` | Compute | Inspecciona y gestiona [tareas programadas](/docs/backend/cron-jobs) |
| Almacenamiento | `storage` | Storage | Explora, sube y gestiona archivos en tus backends de almacenamiento |
| Explorador de API | `api` | API | Documentación interactiva de la API, con un ejecutor de peticiones |
| Claves de API | `api-keys` | Control de acceso | Crea y gestiona claves de API de servicio con ámbitos |

### Qué muestra el explorador de logs

Dos flujos en un único anillo en memoria, sostenido por el proceso del servidor:

- **Cada petición** — método, ruta, estado, duración, el `X-Request-ID`, la
  colección cuando la petición trataba de una, y, cuando la petición falló, el
  `code` de error y el mensaje que recibió el cliente. Una petición fallida se
  registra en `warn` (4xx) o `error` (5xx), de modo que el filtro de nivel la
  encuentra.
- **Todo lo que el servidor reporta en warn o error** — un aviso de esquema, un
  rechazo de autenticación, un diagnóstico del driver, un fallo de arranque.
  `source` sale del propio prefijo del mensaje (`[API]`, `[Auth]`, `[storage]`,
  `[realtime]`), y todo lo no reconocido es `system`.

La cháchara rutinaria de `info` queda fuera deliberadamente. El anillo guarda
10.000 entradas y un muro de `200` expulsa justo aquello para lo que abriste el
panel.

Una función personalizada que lanza una excepción muestra por eso su propio
mensaje aquí, junto a la petición que la llamó — el caso para el que esto existe.

El anillo es por proceso y por arranque: no es duradero, no se comparte entre
réplicas y un reinicio lo vacía. Para cualquier cosa que necesites conservar, lee
la salida estándar del proceso, que lleva las mismas líneas y más.

El **Collection Editor** también es una herramienta de Studio, pero no está en
esta lista porque se registra de otra manera: `RebaseStudio` no lo carga de forma
diferida. El panel lo monta dondequiera que Studio esté registrado, porque a
diferencia de las herramientas de arriba necesita el código fuente de las
colecciones del proyecto a mano para reescribirlo. Es una diferencia en cómo se
monta, no en lo que es — edita esquema y le corresponde estar junto a los
editores de SQL y RLS.

## Activar Studio

Un componente, en cualquier lugar dentro de `<Rebase>`. No renderiza nada —
registra las herramientas, y `<RebaseShell>` las dibuja:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Las herramientas aparecen en el cajón mientras el modo Studio está activo. Deja
`<RebaseStudio>` fuera por completo y entregarás un CMS solo de contenido: sin
modo Studio, sin interruptor, sin nada cargado de forma diferida.

## Añadir tu propia herramienta

`devViews` coloca tus propias vistas junto a las integradas. Son
[`AppView`](/docs/frontend#custom-views)s corrientes — lo único que convierte a
una en herramienta de Studio y no en vista del CMS es el componente en el que se
registra:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const queues: AppView = {
    slug: "queues",
    name: "Queues",
    group: "Compute",
    icon: "ListOrdered",
    description: "Depth and failures, per queue",
    view: <QueuesView/>
};

<RebaseStudio devViews={[queues]}/>
```

| Registrada en | Aparece en | Para |
|---|---|---|
| `<RebaseCMS views>` | modo contenido | cosas que usan las personas que editan contenido |
| `<RebaseStudio devViews>` | modo Studio | cosas que usas tú para operar el backend |

Una vista va exactamente en uno de los dos — el cajón ordena según quién la
registró, así que listar un slug en ambos la oculta del modo contenido.

Igual que `tools`, la lista se lee por su *contenido*: escribirla en línea es
seguro, y un re-render del host no vuelve a montar la herramienta que esté en
pantalla. Renombrar una vista o cambiar su grupo sí la registra de nuevo.

### Elegir qué herramientas aparecen

Omite `tools` y se registran todas las herramientas de arriba. Pásalo para
registrar un subconjunto — una consola alojada que ya tiene su propio navegador
de almacenamiento, por ejemplo, puede dejar esa fuera:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

La lista se lee por su *contenido*, no por su identidad, así que escribirla en
línea es seguro: un re-render del host no desmonta ni vuelve a montar la
herramienta que esté en pantalla.

## Próximos Pasos

- **[Plugins](/docs/plugins)** — Extiende el framework con plugins
- **[Colecciones](/docs/collections)** — Configuración de colecciones

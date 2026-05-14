---
title: Registro de cambios
---
## [3.1.0] - 2026-02-20

- **Integración de IA**:
  - Introducidas funciones de generación de colecciones y mejora de datos impulsadas por IA.
  - Añadido nuevo icono de IA e integradas capacidades de IA en el editor de colecciones.
- **Vista Kanban**:
  - Añadido soporte completo para tableros Kanban con columnas personalizables.
  - Implementado reordenamiento de columnas con arrastrar y soltar y actualizaciones optimistas.
  - Añadidas opciones de configuración de Kanban incluyendo colores de columna.

- **Características de la colección**:
  - Añadida vista `display` al editor de colecciones.
  - Implementado reordenamiento de columnas con arrastrar y soltar en tablas de datos con persistencia.
  - Mejorada la inferencia de colecciones con parámetros opcionales de filtro y ordenación.
- **Mejoras de UI/UX**:
  - Añadido alternador de modo de vista (Lista, Cuadrícula, Tabla) para un mejor control de la visualización de datos.
  - Implementados grupos de navegación con cajón colapsable.
  - Añadido soporte de modal de bloqueo a pantalla completa para el banner de cookies.
  - Armonizados los colores de los botones y rediseñados los componentes Tab.
  - Reemplazado `AutorenewIcon` con `FindInPageIcon` para mayor claridad.
  - Habilitado el comportamiento de desplazamiento suave.
- **Almacenamiento**:
  - Añadido soporte para URLs de almacenamiento totalmente cualificadas.
  - Añadidas opciones `includeBucketUrl` e `imageResize` para la subida de archivos.
- **Gestión de usuarios**:
  - Añadido método `updateUserFields` para actualizaciones directas de Firestore.
- **Correcciones**:
  - Actualizada la dependencia de Firebase a v12.7.0.
  - Actualizaciones de seguridad para Next.js (CVE-2025-66478).
  - Corregidos errores de validación de valores automáticos de fecha.
  - Corregidos problemas con la fusión de objetos y los cambios locales.
  - Mejorada la integración de búsqueda de texto con Typesense.
  - Corregido el diseño y estilo en FormEnhanceAction.

## [3.0.0] - 2025-12-01

- **Mejoras del editor**:
  - Mejorado el comportamiento de la tecla escape en el comando slash del editor.
  - Mejorado el comportamiento del menú de sugerencias.
  - Mejorado el manejo de sugerencias de ruta en los componentes del editor de colecciones.
  - Refactorizadas las sugerencias de colecciones raíz.
- **Mejoras de UI/UX**:
  - Añadida función `prettifyIdentifier` para formatear identificadores y mejorar la legibilidad.
  - Refactorizado el formato de claves para usar prettifyIdentifier.
  - Pequeños ajustes de UI en toda la aplicación.
  - Pequeña actualización visual de los diálogos.
  - Eliminado font-mono de la vista previa del mapa.
- **Editor de colecciones**:
  - Añadida edición de propiedades en línea al editor de colecciones.
  - Correcciones para el guardado de propiedades del editor de colecciones.
  - Aplicado un comportamiento consistente a las propiedades `editable` en colecciones y propiedades.
- **Actualizaciones de la API**:
  - Actualizadas las URLs del servidor API para usar nuevos endpoints.
- **Dependencias**:
  - Muchas actualizaciones de dependencias.
  - Añadida configuración de PostCSS con Tailwind CSS y Autoprefixer.
- **Gestión de usuarios**:
  - Refactorizada la gestión de usuarios para usar consistentemente `saas_uid` y `firebase_uid`.
  - Actualizados los estilos de los botones en EnableAuthView para mayor coherencia.
  - Refactorizados los formularios de usuario para mejorar el diseño y la gestión del estado.
- **Configuración del proyecto**:
  - Actualizado el manejo de la configuración del proyecto para tener en cuenta el estado de prueba.
  - Añadida pantalla de carga inicial.
- **Correcciones**:
  - Corregidos problemas de DND en el inicio.
  - Corregida la vista previa de cambios locales en las acciones de fila.
  - Corregido el diff de cambios locales.
  - Corregidas las fechas que perdían el foco al escribir y al seleccionar valores nulos en los filtros de fecha.
  - Corregido un fallo de UI en los filtros de enumeración de selección.
  - Corregidas las vistas de entidad a pantalla completa con caracteres codificados en su ID.
- **Almacenamiento e imágenes**:
  - Añadidas nuevas capacidades de redimensionamiento de imágenes.
  - Reemplazada la librería de compresión interna con compressor.js.
  - Mejorado el mensaje de error cuando Firebase Storage probablemente no está habilitado.
- **Mejora de datos**:
  - Ajustes cosméticos en la mejora de datos.
- **Gestión de formularios**:
  - Visualización de errores pre-guardado en la vista de tabla.
  - Mejorado el enfoque de errores al guardar el formulario con errores y retroalimentación.
  - Debouncing en el cambio de valores en Formex.
  - Añadido `initialTouched` al controlador Formex.
  - Cambiada la forma en que los valores "sucios" se persisten en el almacenamiento local.
- **Cambios locales**:
  - Añadido `enableLocalChangesBackup` a las colecciones, permitiendo a los usuarios deshabilitar la copia local de entidades no guardadas en el navegador.
  - Cambiado para que los cambios locales puedan aplicarse manualmente.
  - Borrando el indicador de cambios no guardados si la función no está habilitada en las colecciones.
- **Historial de entidades**:
  - Añadido un tipo más limpio al plugin de historial de entidades.


## [3.0.0-rc.4] - 2025-11-25

- Refactorizados los formularios de usuario para mejorar el diseño y la gestión del estado.
- Actualizado el manejo de la configuración del proyecto para tener en cuenta el estado de prueba.
- Muchas actualizaciones de dependencias.

## [3.0.0-rc.3] - 2025-11-07

- Visualización de errores pre-guardado en la vista de tabla.
- Corregidos problemas de DND en el inicio.
- Añadidas nuevas capacidades de redimensionamiento de imágenes y reemplazada la librería de compresión interna con compressor.js.
- Mejorado el mensaje de error cuando Firebase Storage probablemente no está habilitado.
- Pequeña actualización visual de los diálogos.
- Añadida edición de propiedades en línea al editor de colecciones.
- Correcciones para el guardado de propiedades del editor de colecciones y aplicación de un comportamiento consistente a las propiedades `editable` en colecciones y propiedades.
- Corregido un fallo de UI en los filtros de enumeración de selección.
- Corregidas las fechas que perdían el foco al escribir y al seleccionar valores nulos en los filtros de fecha.
- Corregida la vista previa de cambios locales en las acciones de fila.
- Eliminado font-mono de la vista previa del mapa.
- Corregido el diff de cambios locales.
- Añadido un tipo más limpio al plugin de historial de entidades.
- Cambiado para que los cambios locales puedan aplicarse manualmente.
- Añadido `enableLocalChangesBackup` a las colecciones, permitiendo a los usuarios deshabilitar la copia local de entidades no guardadas en el navegador.
- Debouncing en el cambio de valores en Formex y añadido `initialTouched` al controlador Formex.
- Cambiada la forma en que los valores "sucios" se persisten en el almacenamiento local.
- Mejorado el enfoque de errores al guardar el formulario con errores y retroalimentación.

## [3.0.0-rc.2] - 2025-10-16

- **Gestión de usuarios en Rebase Core**: Añadidas capacidades de gestión de usuarios directamente a Rebase Core, ampliando las opciones de autoalojamiento.
- **Campos de usuario como valores de cadena**: Soporte totalmente implementado para campos de usuario como valores de cadena, mejorando la flexibilidad en el manejo de datos de usuario.
- **Migración a TipTap V3**: Editor de markdown migrado a TipTap V3 para un rendimiento y características mejorados.
- **Adaptación a Tailwind 4**: Múltiples adaptaciones para soportar la adaptación a Tailwind 4, modernizando la infraestructura de estilos.
- **Mejoras de inicio de sesión**:
  - Implementado inicio de sesión por correo electrónico en la nube.
  - Añadida autenticación por correo electrónico y contraseña a Cloud SaaS.
  - Añadidos eventos analíticos de inicio de sesión.
  - Corregido el diseño de inicio de sesión de demostración.
- **Actualizaciones del sitio web**:
  - Añadido sitio de aterrizaje Astro (en progreso).
  - Actualizaciones de migración del sitio web.
  - Imágenes migradas.
  - CSS en línea del sitio web.
  - Actualizaciones de diseño web.
  - Ajustes de la página de seguridad.
- **Mejoras de la página de inicio**:
  - Guardando el estado colapsado de la página de inicio en el almacenamiento local.
  - Intento de corrección para el cambio de nombre de grupo en la página de inicio.
  - Revertidos algunos cambios de arrastrar y soltar.
- **Correcciones**:
  - Corregido el soporte SSR (Server-Side Rendering) del editor.
  - Corregida la importación de referencias con bases de datos secundarias.
  - Corregido el soporte para referencias de bases de datos secundarias.
  - Corregida la vista de permisos SaaS.
  - Corregido el filtro de entrada para números cuando el valor es 0.
  - Mejor gestión de errores para el doctor (herramienta de diagnóstico).
- **UI/UX**:
  - Eliminado el botón forzado de colección padre.
- **Dependencias**: Dependencias de plantilla actualizadas.
- **Documentación**:
  - Documentación mejorada para iconos personalizados en colecciones.
  - Añadida documentación de autenticación.
  - Añadida sección de información de seguridad.

## [3.0.0-rc.1] - 2025-09-25

- **Actualización a Firebase 12**: Actualizado a Firebase 12 para un rendimiento y características mejorados.
- **Mejoras del plugin de historial**:
  - Añadido seguimiento de valores anteriores al plugin de historial.
  - Añadida creación programática de entradas de historial.
- **Mejoras en las propiedades de referencia**:
  - Añadida configuración de referencia como campo de cadena.
  - Corregido que las columnas adicionales no se mostraran en la selección de referencia.
  - Corregidas las propiedades de referencia que no se renderizaban correctamente sin ruta pero con un Campo personalizado.
- **Actualizaciones de la UI**:
  - Actualizado el icono predeterminado de SaaS.
  - Actualizaciones de color de botones.
  - Colapsando secciones de inicio.
  - Pequeñas actualizaciones web y eliminado Algolia DocSearch.
- **Correcciones**:
  - Corregido el problema de inicio de sesión de Google Cloud.
  - Corregido el error al regresar de la vista de suscripción.
  - Corregido el almacenamiento de proyectos recientes.
  - Corregidas las importaciones de TipTap.
  - Corregido el paso de gclid correctamente a la aplicación.
  - Corrección de CLS (Cumulative Layout Shift) del sitio web.
- **CLI**: Añadidas instrucciones npm al CLI.
- **Dependencias**: Varias actualizaciones y limpieza de dependencias.
- **Documentación**: Corregida errata en custom_previews.md.
- **Importación/Exportación**: Limpiadas las importaciones.
- **Gestión de roles**: Añadida la capacidad de establecer roles programáticamente en el código.

## [3.0.0-beta.15] - 2025-08-18

- **Función de encuestas**: Añadida encuesta inicial de usuario con seguimiento analítico para mejorar la experiencia del usuario y recopilar comentarios.
- **Mejoras en las acciones de entidad**:
  - Añadido registro de acciones de entidad para una mejor organización.
  - Añadido contexto de formulario a las acciones de entidad.
  - Acciones de entidad ahora disponibles en modo pantalla completa.
  - Mejorada la página de acciones de entidad.
- **Gestión de suscripciones**:
  - Añadido enlace al portal de Stripe para una fácil gestión de suscripciones.
  - Mejorada la vista de suscripciones en la configuración del proyecto.
  - Añadida la capacidad de cambiar el método de pago.
  - Añadidos eventos analíticos para el éxito o fracaso de la suscripción.
  - Actualizaciones de precios.
- **Mejoras en la página de inicio**:
  - Añadida funcionalidad de arrastrar y soltar a las secciones de la página de inicio.
  - Añadida de nuevo la vista vacía predeterminada en la página de inicio.
  - Implementado comportamiento de soltar grupo.
  - Añadida la capacidad de renombrar grupos.
  - Las colecciones ahora se pueden editar dentro de la vista de edición de entidad.
  - Corregido el problema de renderizado de la búsqueda en la página de inicio.
- **Mejoras de UI/UX**:
  - Cambiados los botones predeterminados de color primario a neutral.
  - Añadido el tamaño de interruptor más pequeño.
  - Actualizado el gradiente de fondo del héroe.
  - Pequeñas actualizaciones de estilo.
  - Añadido alternador de moneda en la página de precios.
  - Hechos los iconos de colección más pequeños.
  - Optimizaciones móviles de la página de aterrizaje.
  - Añadida pequeña animación a las vistas de inicio de sesión.
  - Logo actualizado.
  - Pequeñas actualizaciones visuales del cajón.
- **Analíticas**:
  - Añadido seguimiento de campañas a las analíticas.
  - Añadidos eventos analíticos de aterrizaje.
  - Añadidos eventos analíticos para encuestas.
- **Actualizaciones de componentes**:
  - Cambiadas las props de clase de Alert.
  - Añadido `viewportClassName` al componente Select.
  - Actualización visual de la carga de archivos.
  - Permitido el uso de componentes React como iconos.
  - Añadidos `previous values` al plugin de historial.
  - Permitida la deshabilitación del foco en el diálogo.
- **Rendimiento y correcciones de errores**:
  - Corregido el tamaño del botón de carga.
  - Corregidas las entidades que se marcaban como "sucias" en la creación debido al campo markdown.
  - Corregido el error de filtrado por valores nulos.
  - Corregido el error de useMemo con argumentos cambiantes.
  - Corregido el error de las rutas de ID.
  - Corregido el orden de las colecciones fusionadas.
  - Optimizaciones de rendimiento y correcciones de errores de DND (arrastrar y soltar).
  - Corregido el manejo de rutas de grupos de colecciones.
- **Campos personalizados**: Mejorada la página de campos personalizados.
- **Corrección del diálogo de referencia**: Corregido el problema de ordenación del diálogo de referencia cuando se aplican filtros en la colección principal.
- **Demostración de producto**: Mejorada la acción de demostración de sincronización de producto.
- **Actualizaciones web**:
  - Actualizaciones de diseño web.
  - Optimizaciones móviles web.
  - Función getPath mejorada.
  - Añadidos atributos de datos al componente Button.
- **Documentación**: Mejorada la pipeline de generación de llms.txt.
- **Docusaurus**: Actualización de versión.

## [3.0.0-beta.14] - 2025-04-17

- **Alternador de vista JSON**: Añadido un alternador en la vista del editor de colecciones para acceder a los datos JSON en bruto.
- **Coherencia de la UI**: Mejorada la coherencia de la UI para los componentes de selección simple y múltiple.
- **Mejoras de formulario**: Mejorado el redimensionamiento de campos de formulario emergentes y el manejo de límites.
- **Plugin de historial de entidades**: Añadida funcionalidad de seguimiento de historial a Rebase Cloud y Rebase PRO.
- **Correcciones**:
  - Corregido el desbordamiento de texto en los títulos de entidad.
  - Corregidos los errores que se mostraban incorrectamente en arrays de mapas.
  - Corregidos los botones de truncamiento.
  - Corregidas las entidades de solo lectura que quedaban ocultas por la barra inferior.
  - Corregido el color del texto superpuesto en modo oscuro.
  - Corregidos los errores que no se borraban en el editor de colecciones.
  - Corregido mergeDeep para manejar casos nulos correctamente.
  - Corregido el restablecimiento del desplazamiento del eje X en la paginación.
  - Restaurada la indicación de error de celda de tabla.
- **Arrastrar y soltar**: Reemplazado `@hello-pangea/dnd` con `@dnd-kit` para un mejor rendimiento y flexibilidad.

## [3.0.0-beta.13] - 2025-04-11

- **Vista previa JSON**: Añadida pestaña de vista previa JSON a las entidades, proporcionando una vista de datos en bruto. Se puede deshabilitar con la prop `disableJsonTab`.
- **Mejoras de TextField**: Añadidas props `maxRows` y `minRows` al componente TextField para un mejor control de las entradas multilínea.
- **AuthController en PropertyBuilder**: Añadido `authController` al callback de PropertyBuilder, permitiendo el acceso al contexto de autenticación.
- **Mejoras de almacenamiento**: Añadido `processFile` a las propiedades de almacenamiento para el pre-procesamiento de archivos antes de la subida.
- **Formularios secundarios**: Los formularios secundarios ahora siempre se renderizan, incluso si están deshabilitados, para una mejor coherencia.
- **Mejoras de UI**:
  - Ajustados los tamaños de campo pequeño y más pequeño para una mejor jerarquía visual.
  - Actualizado el estilo de color neutral del botón.
  - Mejorado el diseño para IDs de entidad largos.
  - Varios ajustes menores de diseño.
- **Correcciones**:
  - Corregido el campo de referencia de array con un botón de añadir incorrecto.
  - Corregidas las subcolecciones que no resolvían la ruta correctamente.
  - Corregida la subcolección compleja con un error de navegación de alias.
  - Corregida la funcionalidad de exportación cuando `flatten arrays` es falso (las comillas dobles ahora se escapan correctamente).
  - Corregidos los problemas de selección de enumeración de CollectionDetailsForm.
  - Corregido el error de creación de entidad.
  - Corregida la actualización de URL para entidades con vista seleccionada por defecto.
  - Corregidos los valores que no se reiniciaban correctamente.
  - Corregidas las vistas de entidad de solo lectura que carecían de pestañas.
  - Corregido un error relacionado con el camel case.
- **Demo**: Añadida demostración del componente MultiSelect.

## [3.0.0-beta.12] - 2025-03-13

- **Vistas de entidad a pantalla completa**: Ahora puede abrir entidades en una vista a pantalla completa. Esto es útil cuando desea
  concentrarse en la entidad que está editando. Puede habilitar esta función configurando la propiedad `openEntityMode` en `full_screen`
  en la vista de colección. El modo predeterminado sigue siendo `side_panel`. Ha habido una gran renovación de la navegación para
  adaptarse a todos los nuevos casos de uso.
- **Preservación del desplazamiento**: Cuando abre una entidad en una vista a pantalla completa, la posición de desplazamiento de la vista de colección se conserva.
- **Borradores guardados localmente**: Los borradores ahora se guardan localmente en el navegador. Esto significa que si cierra accidentalmente el navegador o navega a otra página, sus cambios seguirán allí cuando regrese.
- Preservación del estado de la URL: El estado de los filtros y la ordenación ahora se conserva en la URL.
- **Funcionalidad de deshacer/rehacer**: Añadida la capacidad de deshacer y rehacer cambios al editar entidades.
- Añadida la bandera `alwaysApplyDefaultValues` a las colecciones. Esta bandera le permite aplicar los valores predeterminados al actualizar
  entidades, no solo al crearlas.
- Los formularios secundarios ahora conservan su ancho cuando están en modo panel lateral. Puede crear formularios secundarios completos
  que viven en su propia pestaña. Los formularios secundarios se construyen como componentes personalizados y pueden incluir cualquier componente, incluidos
  enlaces de campo.
- Añadido modo de color del sistema además de los modos oscuro y claro. El botón ahora es un desplegable en lugar de un alternador.
- Mejoras de formulario que incluyen el restablecimiento del estado inicial corregido después de guardar y las acciones de formulario de entidad desvinculadas.
- Advertencia al dejar formularios sin guardar para evitar la pérdida accidental de datos.
- Ahora puede anular las acciones de entidad predeterminadas proporcionando una acción con una de las claves `edit`, `copy` o `delete`
  en la propiedad `entityActions`.
- Corrección: Las propiedades de cadena con almacenamiento ahora tienen preferencia en las vistas previas.
- Corrección para la codificación de URL para colecciones.
- Corregido el desplazamiento de las acciones del diálogo cuando no deberían.
- Corrección para navegar a nuevas entidades desde el panel lateral.

## [3.0.0-beta.11] - 2024-12-13

- Nueva plantilla Next.js para Rebase PRO. Ahora puede crear un nuevo proyecto con la plantilla PRO usando el CLI.
- [BREAKING] Eliminado `userRoles` de AuthController. Ahora puede acceder a la propiedad `roles` en el objeto de usuario directamente.
- [BREAKING] Muchos tamaños de la UI de Rebase se han ajustado para una mejor coherencia. Esto solo le afectará si está utilizando
  componentes personalizados.
    - `smallest` o `tiny` han sido renombrados a `small`.
    - `small` ha sido renombrado a `medium`.
    - `medium` ha sido renombrado a `large`.
- [BREAKING] Para las versiones autoalojadas, ha habido un cambio en la API para los controladores de gestión de datos. El
  `authController` ahora se pasa al controlador de Gestión de Usuarios, en lugar de al revés. El
  `userManagementController` se puede usar como un controlador de autenticación, pero con toda la lógica añadida para la gestión de usuarios.

❌ Código anterior:

```typescript
    /**
 * Controller in charge of user management
 */
const userManagement = useBuildUserManagement({
        dataSourceDelegate: firestoreDelegate
    });

/**
 * Controller for managing authentication
 */
const authController: FirebaseAuthController = useFirebaseAuthController({
    firebaseApp,
    signInOptions,
    loading: userManagement.loading,
    defineRolesFor: userManagement.defineRolesFor
});
```

✅ Código posterior:

```typescript
    /**
 * Controller for managing authentication
 */
const authController: FirebaseAuthController = useFirebaseAuthController({
        firebaseApp,
        signInOptions
    });

/**
 * Controller in charge of user management
 */
const userManagement = useBuildUserManagement({
    dataSourceDelegate: firestoreDelegate,
    authController
});
```

- Añadidas muchas directivas "use client" a los componentes de UI.
- Corregidos problemas en el diálogo de código del editor de colecciones.
- Estilos web actualizados e integradas mejoras en Docusaurus.
- Estilo mejorado para referencias vacías y pequeños ajustes de diseño.
- Continuación del trabajo en progreso en los componentes personalizados del Editor.
- Reintroducida la variante de color primario oscuro para mejores opciones de tema.
- Pequeñas actualizaciones web para mejorar la estética y la funcionalidad.
- Corregido un error en el que el Editor no guardaba valores `false`.
- Reemplazadas todas las instancias de colores `gray` y `slate` con colores `surface` y `surface-accent` más unificados para la
  coherencia de la UI.
- Añadido fallback del componente Avatar e integrada la configuración de ESLint en las plantillas.
- Mejorado el manejo de errores en formularios y mejorados los mensajes de error en la nube.
- Refactorizada la lógica de gestión de usuarios para una mejor organización del código.
- Mejorado el manejo de propiedades de interruptor booleano en las configuraciones.
- Introducida la gestión de estado para los hijos en ArrayContainer.
- Añadida una receta para la creación de slugs, mejorando el manejo de URL y el SEO.
- Corregidos problemas de crash en campos repetidos para subpropiedades y abordados varios errores menores de estilo y funcionalidad.
- Realizadas mejoras en la capacidad de respuesta del mapa de calor (correcciones de HMR).
- Refactorizadas las funcionalidades de búsqueda de texto para una mayor eficiencia y añadida documentación relevante.
- Corregidos problemas con los campos de entrada numérica que bloqueaban el desplazamiento y reemplazado el selector de fecha con la entrada de fecha nativa de HTML para
  mayor coherencia.
- Si está utilizando el componente `Select`, ya no necesita proporcionar una función `renderValue`. El componente
  lo manejará automáticamente.
- Las propiedades de vista previa personalizadas ahora se renderizan si el valor no está definido.
- Corrección para la versión Cloud que actualizaba la navegación con demasiada frecuencia.
- Corrección para que la búsqueda local no funcionara al regresar a una colección.
- Corrección para un error al seleccionar una entidad de solo lectura.
- Corregido error de selección en grupos de colecciones para entidades que comparten ID.
- Las vistas previas de referencia ahora tienen en cuenta arrays de imágenes para la imagen de vista previa.

## [3.0.0-beta.10] - 2024-07-10

- Corregidos problemas con licencias incorrectas.
- Resueltas dependencias de TipTap.
- Abordadas varias actualizaciones menores de estilo en toda la web.
- Movido el CSS del cuerpo de las importaciones predeterminadas a archivos individuales para una mejor modularidad.
- Implementadas varias actualizaciones web, incluidas correcciones de estilo de selección y ajustes de título de diálogo para la búsqueda de texto.
- Actualizada la vista de selección de propiedades del editor de colecciones y mejorado el diseño de selección de widgets.
- Aplicados ajustes de AppBar para mejorar el comportamiento en dispositivos móviles.
- Mejoradas las salidas de consola y limpiados segmentos de código misceláneos.
- Mejorada la UI con la adición de un componente Slider y actualizada la documentación relacionada.
- Reemplazado el icono de edición de entidad con un lápiz para mayor claridad.
- Actualizadas las dependencias y refinada la gestión de proyectos con una función de verificación de licencia.
- Mejorado el manejo de entradas numéricas de Formex y corregida la exportación de DateTimeField en Next.js.
- Añadida generación de claves API y capacidades de selección de proyectos.
- Introducido un mensaje de advertencia de "vencido" y mejoras en el manejo de datos de colecciones y subcolecciones.
- Proporcionado un mejor manejo de errores y consistencia de diseño en la aplicación.


## [3.0.0-beta.9] - 2024-07-10

- **NUEVO EDITOR DE MARKDOWN**: El editor de markdown ha sido completamente renovado. Ahora soporta una vista previa en vivo y una experiencia de edición mucho
  más mejorada. Ahora incluye un menú slash al que se puede acceder escribiendo `/` en el editor. También una nueva
  barra de herramientas con botones para operaciones comunes de markdown. El nuevo editor también incluye una función de autocompletado de IA, que
  sugiere elementos de markdown a medida que escribe y muestra el markdown generado en tiempo real y resaltado.
- Los campos adicionales también se muestran ahora en el diálogo lateral de la entidad.
- La importación/exportación ahora se divide en 2 plugins separados.
- Los paquetes ahora no están minificados, dejando esa responsabilidad al agrupador del cliente.
- Añadido campo de tamaño máximo en el editor de colecciones para archivos.
- Mejorado el manejo de errores de subida de archivos incorrectos.
- Mejorando el error al abrir una entidad no accesible en la vista lateral.
- Ajustes del componente Select y eliminada la prop `multiple`.
- Nuevo componente `MultiSelect` con una UX mucho mejorada.
- Introducido AppCheck directamente en Rebase Cloud.
- Añadido soporte para MongoDB para Rebase PRO.
- Múltiples correcciones en el plugin de gestión de usuarios para proyectos PRO.
- Actualizadas las dependencias de react-router.
- Personalización mejorada, ahora puede definir los estilos para cada entrada de tipografía, incluyendo tamaño de fuente, tipografía...
- Búsqueda mejorada en la página de inicio, ahora usando fuse.js.
- Corrección para índice faltante y claves incorrectas en array de mapas con constructor de propiedades.
- Corrección para la posición del mango de arrastre en el editor.
- Renombrado `partOfBlock` a `minimalistView` en las props de campo.
- Ahora es posible definir propiedades de vista previa a nivel de colección.
- Estilos de referencias actualizados.
- Los tooltips han sido renovados para usar menos divs.
- Corrección para la posición del plugin de mejora de datos.
- Corrección de cómo puede anular la fuente de datos para colecciones específicas.
- Ahora también puede definir una base de datos diferente a `(default)` en la fuente de datos.
- El plugin de gestión de usuarios ahora guarda usuarios con el correo electrónico como clave, en lugar de un valor aleatorio.
- Corrección para paneles laterales que se ajustan al tamaño correcto cuando la ventana cambia de tamaño.
- Algunas actualizaciones de estilo del cajón.
- `RepeatFieldBinding` ahora puede usar propiedades de array no resueltas.

## [3.0.0-beta.8] - 2024-07-10

- Corrección para renderizados excesivos en la vista de formulario.
- Ahora puede usar componentes `PropertyFieldBinding` en sus vistas de entidad personalizadas, y se tratarán como
  campos regulares.
- Para vistas de entidad adicionales, ahora puede preservar la barra de acciones inferior, con la prop `includeActions`.
- Para propiedades de mapa, si no son requeridas, el valor podría ser `undefined`, pero si una propiedad hija tiene un valor,
  se activará la validación para todos los hijos.
- Corrección para que los mapas de datos no se recorrieran correctamente con valor nulo.
- La plantilla `pro` del CLI ahora soporta la creación de configuración de aplicación web.
- Corrección para la inferencia de datos del editor de colecciones para enumeraciones.
- Pequeña mejora de estilo de Sheet.
- Corregido el problema de carga de búsqueda local con datos en caché.
- Pequeña corrección visual para IDs.
- Actualizaciones de AppCheck.
- Corregida la apertura inconsistente de diálogos laterales de vista previa de referencia.
- Corregidos los iconos para vistas previas de imágenes.
- Navegando a la URL de inicio al cerrar sesión.
- Añadida la prop `previewUrl` en las opciones de almacenamiento (#639).
- Corregido el problema de seguridad de XLSX CVE-2024-22363 (#654).
- Corrección para la eliminación de claves en campos KeyValue.
- Añadido tamaño `large` para interruptores booleanos.
- Actualizado eslint a la última versión y configuración.
- Corrección de tipos para `removePropsIfExisting`.
- Corrección para el error de arrastre de video en campos de array.
- Añadida opción para solicitar restablecimiento de contraseña, en la vista de inicio de sesión de PRO.
- Permitiendo valores predeterminados nulos para las propiedades.
- Añadida cuenta a los enlaces de campo de array.
- Corregidos valores predeterminados en mapas anidados en arrays.
- Resolviendo la ruta de colección de entidad con la que proviene de la entidad, no de la configuración de la vista.
- Pequeña corrección para la imagen del logo.
- Corregidos los campos condicionales que no se actualizaban correctamente.
- Ocultar el botón de nuevo usuario si `disabledSignupScreen`.
- Mejorado el estilo de la barra de navegación de documentos.
- Permitiendo que los mapas sean completamente indefinidos.
- Deshabilitado el botón de añadir en grupos de colecciones.
- Gran refactorización de entidad, las vistas personalizadas ahora están bajo el proveedor formex.
- Corrección de CLI para usuarios no iniciados sesión.
- Corrección para que los datamaps no se recorrieran correctamente con valores nulos.
- Actualizaciones de las propiedades de andamiaje.

## [3.0.0-beta.7] - 2024-06-18

- Renombrada la clase de utilidad `cn` a `cls`, manteniendo `cn` disponible con una advertencia de obsolescencia.
- Añadida documentación de Menubar y documentos de esqueleto faltantes.
- Corregido el tipo de orden de propiedades para permitir subcolecciones.
- Nueva sección de UI añadida a la página de inicio.
- Mejorado el flujo de diálogo de guardar y cerrar.
- Permite ocultar IDs y enlaces de entidad en referencias y vistas previas.
- Eliminadas algunas transiciones CSS.
- Permite ocultar el alternador de modo de color.
- Añadido ejemplo de vista JSON.
- Cambiada la tabla virtual para usar tamaño en píxeles.
- Algunas actualizaciones de diseño para una mejor experiencia de usuario.
- Añadida de nuevo la columna de grupo de colección con IDs de padre.
- Mejorada la salida de resultados vacíos.
- Añadidas indicaciones y sugerencias de ejemplo para DataTalk.
- Vista de entidad lateral mejorada, calculada dinámicamente según la profundidad de la propiedad de colección.
- Corregidos los tipos de mergeDeep.
- Corregido un problema con la exportación de propiedades no existentes definidas en `propertiesOrder`.
- Corregidos problemas de la plantilla PRO sin proyectos en la nube.
- Mejorado el manejo de valores enum con valor 0.

## [3.0.0-beta.6] - 2024-04-23

- AppCheck añadido a cada variante de Rebase.
- Varias correcciones para el delegado de la fuente de datos.
- Corrección al guardar datos limpios.
- Corregido el problema de creación de roles de nuevos usuarios en la nube.
- Corregido el problema de visualización de mensajes de error en celdas de tabla.
- Corregido el problema de actualización de subcolecciones.
- Analíticas de importación/exportación y conversiones de mapeo de datos relacionados actualizadas.
- Actualizado y mejorado el manejo de roles y permisos de usuario.
- Mejorado el manejo de archivos de cuenta de servicio y la creación de proyectos usando SA.
- Actualizado el comportamiento de las consultas no indexadas.
- Conexión de gestión de usuarios a la demo eliminada.
- Actualizaciones de dependencias para mitigar problemas de seguridad.
- Expuestos métodos adicionales de inferencia de datos para una mejor personalización.
- Actualizaciones de la plantilla Pro para una UI/UX mejorada.
- Documentación actualizada para colecciones y gestión de usuarios.

## [3.0.0-beta.5] - 2024-04-01

- [BREAKING] El componente principal para Rebase Cloud ha sido renombrado de `RebaseApp` a `RebaseCloudApp`. Por favor, actualice
  sus importaciones en consecuencia.
- Correcciones relacionadas con el CLI. Ahora puede instalar el CLI globalmente con `npm install -g @rebasepro/cli`.

## [3.0.0-beta.4] - 2024-03-27

- [BREAKING] El nombre del paquete para Rebase Cloud ha cambiado de `rebase` a `@rebasepro/cloud`. Esto se hace
  para evitar conflictos con el paquete principal de Rebase. Si está utilizando Rebase Cloud, deberá actualizar sus
  importaciones.
- [BREAKING] Si está importando la configuración de tailwind, ahora puede encontrar la importación en:
  `import rebaseConfig from "@rebasepro/ui/tailwind.config.js";`
- [BREAKING] En ese caso, también necesita añadir `@tailwindcss/typography` a sus dependencias de desarrollo.
- [BREAKING] Necesita actualizar su `vite.config.js` y reemplazar el nombre del paquete en la configuración federada:
    ```javascript
    import { defineConfig } from "vite"
    import react from "@vitejs/plugin-react"
    import federation from "@originjs/vite-plugin-federation"
    
    // https://vitejs.dev/config/
    export default defineConfig({
        esbuild: {
            logOverride: { "this-is-undefined-in-esm": "silent" }
        },
        plugins: [
            react(),
            federation({
                name: "remote_app",
                filename: "remoteEntry.js",
                exposes: {
                    "./config": "./src/index"
                },
                shared: ["react", "react-dom", "@rebasepro/cloud", "@rebasepro/core", "@rebasepro/firebase", "@rebasepro/ui"]
            })
        ],
        build: {
            modulePreload: false,
            target: "ESNEXT",
            cssCodeSplit: false,
        }
    })
    ```
- Pequeñas mejoras de rendimiento y correcciones de errores.
- Funcionalidad de filtrado y ordenación mejorada para campos indexados.
- StorageSource extendido para soportar `bucketUrl` personalizado.
- Limpieza para genéricos del controlador de navegación y clases Markdown prose.
- Abordados los problemas de guardado de Gestión de Usuarios y renombrada la plantilla Cloud.
- Corregidos los rerenders de ReferenceWidget.tsx.
- Corregido el problema del botón de nueva colección en la página de inicio.
- Corregida la ruta de las plantillas del CLI.
- Roles integrados en AuthController.
- Pequeño cambio en la API de plugins.
- Añadidos detalles de usuario al desplegable de la barra de navegación.
- Dependencias actualizadas.
- Refactorización de la vista previa y el título de la vista de entidad.
- Trabajo en progreso del tablero Kanban.
- Corrección para nuevos valores de selección vacíos de Radix.
- Correcciones para propiedades indefinidas en arrays y editor.
- Parámetros adicionales añadidos en los controladores de autenticación.
- Refactorización de tarjetas de navegación y limpieza de la API de plugins.
- Corrección para la importación de datos con IDs no de cadena.
- Documentación: Añadida receta para gestionar callbacks de entidad.
- Actualizaciones web y corrección de CLI para yarn.

## [3.0.0-beta.3] - 2024-02-21

- Corrección para la importación de datos en subcolecciones.
- Reordenamiento de código.
- Minificación eliminada. Comprobaciones de tipo EntityReference cambiadas.
- Actualizaciones de subida de imágenes del editor.
- Cosmético.
- Movido el plugin del editor tailwind.config.js.
- Callbacks eliminados en vistas de navegación lateral, previene errores.
- Corrección de plantilla PRO.
- Limpieza de la vista de inicio de sesión PRO.

## [3.0.0-beta.2] - 2024-02-21

- Se añadió el paquete Formex para gestionar formularios en toda la plataforma. Formex es una librería
  interna de gestión de formularios con una API similar a Formik, pero con mejor rendimiento,
  y mucho más ligera.
- Proceso de incorporación mejorado para nuevos usuarios.
- Corregidos problemas de importación de datos para nuevas colecciones.
- Onboarding de SaaS ajustado para una mejor experiencia de usuario.
- Implementada validación de expresiones regulares para campos de entrada.
- Mejora en la retroalimentación de errores de inicio de sesión.
- Controlador de navegación extraído para una mejor gestionabilidad.
- Estilos actualizados para mayor coherencia.
- Vite y dependencias actualizados para rendimiento y seguridad.
- Formularios de usuario y rol refactorizados para usar Formex.
- Correcciones en los formularios de encabezado de tabla y problemas del editor de colecciones.
- Solucionados problemas de importación incorrecta de JSON.
- Formik eliminado, mejorando la gestión de formularios con Formex.
- Realizadas pequeñas correcciones de anidamiento HTML y debounce.
- Corregidos errores del menú del contenedor de array y de entrada multilínea.
- Configuración de Tailwind migrada a la librería para una gestión más sencilla.
- Configuración de Sentry ajustada para el reporte de errores.
- Corrección para la vista de edición de subcolecciones que se mostraba vacía.
- Correcciones para las propiedades de bloque y grupo en el editor que guardaban múltiples entradas al editar una subpropiedad existente.

## [3.0.0-beta.1] - 2024-02-01

La primera versión beta de Rebase v3.0.0.
Aunque todavía está en beta, consideramos que esta versión es lo suficientemente estable como para ser utilizada en
producción.

> Todos los cambios relacionados con la versión alfa de V2 están actualmente incluidos en estos documentos:
> - [Novedades en la versión 2.0.0](./what_is_new_v3)
> - [Guía de migración de la versión 1.x a la 2.0.0](./cloud/migrating_from_v2)

> El registro de cambios para las versiones 1.0.0 y anteriores se puede encontrar
> [aquí](https://rebase.pro/docs/1.0.0/changelog)

---
## [2.2.0] - 2023-11-09

- Corrección para enlaces de subcolección faltantes.
- Nuevo flujo de inicio de sesión con email y contraseña.
- Botón de añadir eliminado en el grupo de colecciones.
- Correcciones de exportación.
- Corrección para la búsqueda de colecciones.

## [2.1.0] - 2023-09-12

- [BREAKING] La lógica para verificar combinaciones de filtros válidas se ha movido a la interfaz `DataSource`.
  Esto mejora la capacidad de personalizar la fuente de datos y permite filtros más complejos.
  Este cambio solo le afectará si ha implementado una fuente de datos personalizada. Necesitará
  añadir un método `isFilterCombinationValid` a su fuente de datos.
- [BREAKING] La propiedad `filterCombinations` ha sido eliminada del componente `EntityCollection`.
  Esto ahora es gestionado por la fuente de datos. Si necesita permitir múltiples filtros, puede usar el
  nuevo callback `FireStoreIndexesBuilder`. Consulte
  la [documentación](https://rebase.pro/docs/collections/multiple_filters)
  para más información.
- Ahora puede usar `spreadChildren` anidados en propiedades de mapa, lo que permite mostrar arbitrarias
  estructuras anidadas como columnas individuales en la vista de colección.
- El valor del conteo de la colección ahora se actualiza con los filtros aplicados.
- Corrección para la exportación CSV que no funcionaba cuando los datos subyacentes eran inválidos.
- Corrección para el error de búsqueda de colección que devolvía un solo resultado.
- Corrección para campos de referencia que fallaban con valores incorrectos.

## [2.0.5] - 2023-07-11

- El valor predeterminado para las propiedades de cadena es ahora `null` en lugar de `""`.
- Corrección para que el controlador de búsqueda de texto cambiante no se actualizara como dependencia.
- Corrección para establecer un campo único utilizando una referencia, lo que generaba una consulta inválida en Firestore.

## [2.0.4] - 2023-06-15

- Corrección para que `forceFilter` no se aplicara correctamente en las vistas de referencia.
- Corrección para la configuración de validación de enum anulable.

## [2.0.3] - 2023-06-15

- Corrección para el formulario que reiniciaba valores al guardar.

## [2.0.2] - 2023-06-14

- `flexsearch` reemplazado por `js-search`. Sus importaciones son demasiado complicadas.
- Corrección para el formulario que asignaba IDs incorrectos.
-

## [2.0.1] - 2023-06-12

- Corrección para que las entradas de bloque no generaran el valor predeterminado correcto al añadir una nueva entrada. Esto causaba
  un error cuando la propiedad hija es un array, como en el ejemplo del blog.
- Añadida la propiedad `formAutoSave` a las colecciones. Esto elimina los botones del formulario y guarda automáticamente
  la entidad cuando hay cambios o el usuario abandona el formulario.
- Ahora puede acceder a `formContext` desde las vistas de colección, lo que le permite acceder a la entidad actual
  que se está editando, modificar valores y `guardar`.

## [2.0.0] - 2023-06-07

- Ahora puede usar un callback para definir la vista predeterminada de una entidad.
- Corrección al abrir entidades desde una vista personalizada que también utiliza subcolecciones.

## [2.0.0-rc.2] - 2023-06-05

- Dependencia `@mui/x-date-pickers` revertida a `^5.0.0`.
- Valores predeterminados asignados a cada propiedad ahora, basados en el tipo de propiedad.
  Por ejemplo, las propiedades booleanas tendrán un valor predeterminado de `false`, los mapas a `{}`,
  y la mayoría de las otras propiedades a `null`.
- Espacio vacío eliminado para propiedades ocultas en el diálogo lateral de la entidad.

## [2.0.0-rc.1] - 2023-05-31

- Añadidos campos clave-valor arbitrarios con la propiedad `keyValue` en propiedades de mapa.
- Dependencia `@mui/x-date-pickers` actualizada (es posible que necesite aumentar su versión
  a 6.5.0).
- Algunas mejoras en el componente `EntityCollectionTable`, en referencia a
  valores que se actualizan en segundo plano. También un correcto `debouncing` para
  los campos de la tabla.

## [2.0.0-beta.7] - 2023-05-23

- Añadido soporte para grupos de colecciones.
- [BREAKING] La función `countEntities` en la fuente de datos ahora toma un
  objeto en lugar de una cadena como parámetro. Esto solo le afectará si ha
  construido un componente personalizado utilizando esa función.
- Añadidas vistas previas de URL de cadena a los campos.
- Corrección para que los geopuntos no se serializaran correctamente al guardar.

## [2.0.0-beta.6] - 2023-05-11

- Corrección para que los tipos de Typescript no se exportaran correctamente y dieran errores
  al usar la librería con el inicio rápido.
- Corrección para que los mensajes de error no se mostraran correctamente en las nuevas entradas de texto.
- Corrección para la importación de flexsearch que causaba un fallo al usar webpack.

## [2.0.0-beta.5] - 2023-04-28

- Apariencia y sensación de los campos actualizadas. Los campos de texto ahora son personalizados, no los
  proporcionados por Material UI. Esto permite mayor personalización, menos código y
  mejor rendimiento.
- Vista de inicio de sesión no centrada corregida.
- Selección de campo emergente y error de arrastrar y soltar corregidos.
- Corrección para el campo de omitir inicio de sesión.
- HTML ahora se renderiza correctamente en las vistas previas de markdown.
- Corrección para que el permiso de lectura no se aplicara correctamente.
- Corrección para el estado de vista vacía no centrado en las colecciones.

## [2.0.0-beta.4] - 2023-03-30

- Corrección de error en el encabezado de la tabla.
- Añadida barra de búsqueda en la página de inicio.
- Añadida vista de colecciones favoritas y recientes en la página de inicio.
- Corrección para algunos constructores de propiedades profundamente anidados en arrays.
- Añadida la propiedad `autoOpenDrawer`, que permite abrir el cajón automáticamente al
  pasar el ratón por el menú.
- Permite elegir qué vista personalizada o subcolección se abre por defecto,
  con la propiedad `defaultSelectedView`. ¡Gracias a @SeeringPhil por el PR!
- Renombrado `builder` a `Builder` en las vistas personalizadas de colección para mayor coherencia.

## [2.0.0-beta.3] - 2023-03-21

- Corregido error relacionado con los controladores de selección personalizados.
- Corrección para el valor predeterminado no establecido en propiedades de array.
- Firebase App Check habilitado. ¡Gracias a @sengerts por el PR!
- Función de copiar añadida a las vistas de array. ¡Gracias a @guustmc por el PR!
- El diálogo lateral de la entidad ahora es más ancho por defecto.
- Pequeñas mejoras en las propiedades de bloque. Ahora el primer tipo se selecciona por defecto.
- Corregido un ordenamiento adicional que se añadía al aplicar múltiples filtros, lo que creaba un
  error. ¡Gracias a @juanleondev por el PR!
- `ReferenceSelectionView` renombrado a `ReferenceSelectionInner`.
- Añadidos filtros de referencia.
- Retraso de actualización de tabla corregido al eliminar una entidad.
- Ahora puede cambiar el valor de cualquier propiedad dentro de un campo personalizado.

## [2.0.0-beta.2] - 2023-01-30

- Corregido un error donde las acciones de colección reiniciaban su estado interno.
- Vista previa mejorada para archivos que no son imágenes, videos o audios.
- Optimizaciones de formulario.
- Corrección para que el diálogo de referencia no borrara la selección.
- Corrección para múltiples barras de error, cuando hay un error al subir un archivo.
- Corrección para la falta de resaltado al cerrar el diálogo lateral.
- Corrección para el retraso en la actualización de datos al cambiar filtros.
- Refactorización interna del componente `EntityCollectionTable`.
- [BREAKING] En el componente `EntityCollectionTable`, la propiedad `ActionsBuilder`
  ha sido reemplazada por `actions`.

## [2.0.0-beta.1] - 2023-01-18

Esta es la primera versión beta de Rebase v2.0.0.
Aunque todavía está en beta, consideramos que esta versión es lo suficientemente estable como para ser utilizada en
producción.

> Todos los cambios relacionados con la versión alfa de V2 están actualmente incluidos en estos documentos:
> - [Novedades en la versión 2.0.0](https://rebase.pro/docs/new_in_v2)
> - [Guía de migración de la versión 1.x a la 2.0.0](https://rebase.pro/docs/migrating_from_v1)

> El registro de cambios para las versiones 1.0.0 y anteriores se puede encontrar
> [aquí](https://rebase.pro/docs/1.0.0/changelog)

---

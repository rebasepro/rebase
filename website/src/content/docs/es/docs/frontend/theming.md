---
sourceHash: 93a59ca2be100841
title: Theming y personalización de marca
sidebar_label: Theming y personalización de marca
description: Aplica tu marca en el panel de administración — color, fuentes, esquinas, superficies, modo claro y oscuro, logotipo y pantalla de inicio de sesión — sobrescribiendo un puñado de tokens de CSS, sin tener que reescribir componentes.
---

## Descripción general

Cada parte del panel de administración — el drawer, las tablas, los formularios, los diálogos, Studio, la pantalla de inicio de sesión — se basa en un único conjunto de tokens de diseño en `@rebasepro/ui`. Cambia un token en tu propia hoja de estilos y cada parte que lo utilice se adaptará, en ambos temas.

Por lo tanto, adaptar la marca tiene dos niveles, y rara vez necesitarás el segundo:

1. **Tokens.** El color de marca, las fuentes, el radio de las esquinas y las superficies son variables CSS que se sobrescriben en `frontend/src/index.css`. El logotipo y el nombre son props en `<RebaseShell>`. Esto cubre lo que la mayoría de los proyectos entienden por "hacer que se vea como el nuestro".
2. **Componentes.** Cuando una parte debe *comportarse o distribuirse* de manera diferente — tu propia barra de aplicación, tu propia pantalla de inicio de sesión —, reemplázala con una [anulación de componente](/docs/frontend/component-overrides).

## Color de marca

Una sola línea. Coloca un bloque `@theme` después de las importaciones en `frontend/src/index.css`:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

@source "../node_modules/@rebasepro";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
    --color-primary: #16a34a;
}
```

Todo lo que use "primary" cambiará con él: botones sólidos, enlaces, casillas de verificación e interruptores activados, anillos de foco, la fila activa en el drawer, gráficos, selecciones. Los tokens relacionados se derivan de él, por lo que no es necesario configurarlos manualmente:

| Token | Derivado como | Utilizado para |
|---|---|---|
| `--color-primary-light` | más claro por 0.15 de luminosidad OKLCH | texto de énfasis en fondos oscuros |
| `--color-primary-dark` | más oscuro por 0.15 | estados hover y presionado |
| `--color-primary-bg` | primary al 10% de opacidad | filas seleccionadas, fondos tintados |
| `--color-on-primary` | blanco o negro, el que sea legible sobre el color primario | la etiqueta de un botón sólido, la marca de verificación en un checkbox |

`--color-on-primary` (nuevo en 0.34; antes de esta versión, los botones sólidos siempre mostraban etiquetas blancas) es lo que mantiene legible una marca con colores claros. Un color primario amarillo o lima obtiene etiquetas negras en sus botones en lugar de blancas con un contraste de 2:1. Cambia con una luminosidad OKLCH de 0.6, lo que selecciona la tinta de mayor contraste para casi cualquier color de marca real; si el tuyo está cerca de ese límite y prefieres la otra tinta, configúralo:

```css
@theme {
    --color-primary: #8b5cf6;
    --color-on-primary: #ffffff;
}
```

`--color-secondary` y `--color-on-secondary` funcionan de la misma manera. El panel de administración apenas utiliza secondary — está pensado para tu propia interfaz.

## Fuentes

El panel de administración define el texto del cuerpo en `--font-sans`, los encabezados en `--font-headers` y los valores de medición (ids, marcas de tiempo, código) en `--font-mono`. Instala la fuente, impórtala una vez y apunta el token hacia ella:

```bash
pnpm --dir frontend add @fontsource-variable/manrope
```

```tsx no-verify
// frontend/src/App.tsx, next to the existing font imports
import "@fontsource-variable/manrope";
```

```css
@theme {
    --font-sans: "Manrope Variable", ui-sans-serif, system-ui, sans-serif;
    --font-headers: "Manrope Variable", ui-sans-serif, system-ui, sans-serif;
}
```

Elimina las importaciones de fuentes que ya no uses (`@fontsource-variable/inter`, `@fontsource-variable/instrument-sans`), o de lo contrario se seguirán descargando.

## Esquinas

Tres radios definen toda la interfaz:

| Token | Por defecto | Utilizado para |
|---|---|---|
| `--radius-md` | `6px` | chips, bloques de código, mosaicos pequeños |
| `--radius-lg` | `9px` | controles, menús, resaltados de filas |
| `--radius-xl` | `13px` | tarjetas, diálogos, paneles laterales |

```css
@theme {
    /* A squarer, denser look */
    --radius-lg: 4px;
    --radius-xl: 6px;
}
```

## Superficies

Los fondos se nombran por rol, y cada rol tiene un valor para el modo claro y otro para el oscuro. Se trata de variables CSS estándar en lugar de tokens `@theme`, ya que cambian según el tema — por lo que debes sobrescribirlas bajo `:root` para el modo claro y `.dark` para el oscuro:

```css
/* A warmer ground in both themes */
:root {
    --surface-frame: #f4f1ec;
    --surface-sheet: #faf8f5;
}

.dark {
    --surface-frame: #0d0b09;
    --surface-sheet: #15120f;
    --surface-card: #1b1814;
}
```

| Variable | Qué es |
|---|---|
| `--surface-frame` | la página detrás de todo, alrededor del drawer |
| `--surface-sheet` | el área de contenido principal |
| `--surface-card` | tarjetas, filas de tablas, paneles de formularios |
| `--surface-raised` | un control o panel elevado sobre una tarjeta |
| `--surface-lifted` | menús, popovers, diálogos |
| `--surface-field` | el relleno de un campo de texto (translúcido) |
| `--surface-hover` / `--surface-active` | rellenos para hover y presionado (translúcidos) |
| `--surface-well` | un contenedor rehundido de código o registros |
| `--hairline` / `--hairline-strong` | bordes y separadores (translúcidos) |

Mantén el orden: en cada tema, frame, sheet y card deben distanciarse entre sí en la misma dirección. Los colores de texto están ajustados según los valores por defecto, así que después de un cambio importante revisa una página en ambos temas para verificar el contraste.

## Modo claro y oscuro

Por defecto, el panel de administración sigue la preferencia del sistema operativo, muestra un selector de tema y recuerda la elección del usuario.

Para ofrecer un único tema, gestiona el modo tú mismo. Pasa a `<Rebase>` un `modeController` cuyo `setMode` ignore el selector, y coloca la clase correspondiente en `<html>` — con tu propio controlador, Rebase no modificará las clases de la página:

```tsx
import type { ModeController } from "@rebasepro/app";

// Dark only. `frontend/index.html` also needs <html class="dark">.
const darkOnly: ModeController = {
    mode: "dark",
    setMode: () => {}
};

// <Rebase client={rebaseClient} authController={authController} modeController={darkOnly}>
```

## Logotipo y nombre

`<RebaseShell>` recibe el nombre y el logotipo que se muestran en el drawer. El mismo logotipo aparece en la pantalla de inicio de sesión integrada. Coloca los archivos en `frontend/public/`:

```tsx
import { RebaseShell } from "@rebasepro/cms";

export function Shell() {
    return <RebaseShell title="Acme Ops" logo="/logo.svg" logoDark="/logo-dark.svg"/>;
}
```

`logoDark` es opcional. Utilízalo cuando tu logotipo esté dibujado con tinta oscura y desaparecería en el tema oscuro; sin él, se utiliza `logo` en ambos.

El título y el icono de la pestaña del navegador proceden de `frontend/index.html`:

```html
<title>Acme Ops</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
```

## La pantalla de inicio de sesión

La pantalla de inicio de sesión integrada adopta el color de tu marca, las fuentes, las superficies y el `logo` del shell sin necesidad de código adicional.

Para cambiar sus textos o agregar tu propio contenido, pasa un `LoginView` configurado a `<RebaseAuth>`. En el archivo `App.tsx` generado, `authController` ya se encuentra en el ámbito:

```tsx
import { LoginView, RebaseAuth } from "@rebasepro/app";

<RebaseAuth loginView={
    <LoginView
        authController={authController}
        logo="/logo.svg"
        logoDark="/logo-dark.svg"
        title="Acme Ops"
        subtitle="Sign in with your work account"
        additionalComponent={<a href="https://acme.example/help">Trouble signing in?</a>}
    />
}/>
```

Otras props: `topComponent` (arriba de los botones de inicio de sesión), `layout="form-first"` (sin tarjeta propia, para una página que enmarque el inicio de sesión por sí misma, como una pantalla dividida junto a la imagen de un producto) y `disableSignupScreen`.

Para reemplazar la pantalla por completo, anula `"Auth.LoginView"` (consulta [Component Overrides](/docs/frontend/component-overrides)).

## Más allá de los tokens

- **Reemplaza una parte del shell** — la barra de la aplicación, el drawer, una fila de navegación, la pantalla de inicio de sesión — con una [anulación de componente](/docs/frontend/component-overrides).
- **Agrega tus propias páginas** que coincidan con el tema: [Styling Custom UI](/docs/frontend/styling) explica a partir de qué componentes y clases construirlas, para que tus tokens también se apliquen a ellas.

## Lista de verificación

- El color de marca se define una sola vez, en `@theme`, y en ningún otro lugar. No lo escribas como un valor literal en los componentes; usa `bg-primary` / `text-primary`.
- Observa un botón sólido y una casilla de verificación marcada: la etiqueta y la marca de verificación deben ser fáciles de leer.
- Alterna el tema y revisa una tabla, un formulario y un diálogo en ambos modos.
- Si reemplazaste las fuentes, elimina las importaciones de fuentes por defecto.

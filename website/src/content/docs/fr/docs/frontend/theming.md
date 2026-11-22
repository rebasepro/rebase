---
sourceHash: 93a59ca2be100841
title: Thèmes et image de marque
sidebar_label: Thèmes et image de marque
description: Appliquez votre image de marque à l'interface d'administration — couleur, polices, arrondis, surfaces, modes clair et sombre, logo et écran de connexion — en surchargeant simplement quelques tokens CSS, sans réécrire de composants.
---

## Vue d'ensemble

Chaque élément de l'administration — le volet latéral (drawer), les tableaux, les formulaires, les boîtes de dialogue, Studio, l'écran de connexion — s'appuie sur un ensemble unique de design tokens dans `@rebasepro/ui`. Modifiez un token dans votre propre feuille de style et chaque élément qui l'utilise s'adaptera, dans les deux thèmes.

La personnalisation graphique s'opère donc à deux niveaux, et vous aurez rarement besoin du second :

1. **Les tokens.** La couleur de marque, les polices, les rayons d'arrondi et les surfaces sont des variables CSS que vous surchargez dans `frontend/src/index.css`. Le logo et le nom sont des props sur `<RebaseShell>`. Cela couvre ce que la plupart des projets entendent par « adapter à notre identité ».
2. **Les composants.** Lorsqu'un élément doit *se comporter ou être agencé* différemment — votre propre barre d'application, votre propre écran de connexion — remplacez-le par une [surcharge de composant](/docs/frontend/component-overrides).

## Couleur de marque

Une seule ligne. Ajoutez un bloc `@theme` après les imports dans `frontend/src/index.css` :

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

@source "../node_modules/@rebasepro";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
    --color-primary: #16a34a;
}
```

Tout ce qui utilise « primary » s'adapte en conséquence : boutons pleins, liens, cases à cocher et interrupteurs activés, anneaux de focus, ligne active dans le volet latéral, graphiques, sélection. Les tokens associés en sont dérivés, vous n'avez donc pas besoin de les définir vous-même :

| Token | Dérivé selon | Utilisé pour |
|---|---|---|
| `--color-primary-light` | plus clair de 0,15 de luminosité OKLCH | texte d'accentuation sur fonds sombres |
| `--color-primary-dark` | plus sombre de 0,15 | états enfoncés (pressed) et survolés (hover) |
| `--color-primary-bg` | couleur primaire à 10 % d'opacité | lignes sélectionnées, arrière-plans teintés |
| `--color-on-primary` | blanc ou noir, selon la meilleure lisibilité sur la primaire | libellé d'un bouton plein, coche dans une case à cocher |

`--color-on-primary` (nouveau dans la version 0.34 ; auparavant, les boutons pleins affichaient toujours des libellés blancs) permet de préserver la lisibilité d'une marque claire. Une couleur primaire jaune ou vert lime aura des libellés noirs sur ses boutons plutôt que des blancs avec un contraste insuffisant de 2:1. Le basculement s'opère à une luminosité OKLCH de 0,6, ce qui sélectionne la couleur de texte offrant le meilleur contraste pour presque toutes les couleurs de marque réelles ; si la vôtre se situe près de cette limite et que vous préférez l'autre contraste, vous pouvez la définir manuellement :

```css
@theme {
    --color-primary: #8b5cf6;
    --color-on-primary: #ffffff;
}
```

`--color-secondary` et `--color-on-secondary` fonctionnent de la même manière. L'interface d'administration utilise très peu la couleur secondaire — elle est mise à disposition pour votre propre interface.

## Polices

L'interface d'administration applique `--font-sans` au corps de texte, `--font-headers` aux titres et `--font-mono` aux valeurs techniques (identifiants, horodatages, code). Installez la police, importez-la une fois, puis faites pointer le token dessus :

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

Supprimez les imports de polices que vous n'utilisez plus (`@fontsource-variable/inter`, `@fontsource-variable/instrument-sans`), sinon elles continueront à être téléchargées.

## Arrondis

Trois rayons régissent l'ensemble de l'interface utilisateur :

| Token | Par défaut | Utilisé pour |
|---|---|---|
| `--radius-md` | `6px` | badges (chips), blocs de code, petites tuiles |
| `--radius-lg` | `9px` | contrôles, menus, surbrillance de lignes |
| `--radius-xl` | `13px` | cartes, boîtes de dialogue, volets latéraux (side sheets) |

```css
@theme {
    /* A squarer, denser look */
    --radius-lg: 4px;
    --radius-xl: 6px;
}
```

## Surfaces

Les arrière-plans sont nommés selon leur rôle, et chaque rôle possède une valeur claire et une valeur sombre. Il s'agit de variables CSS standards plutôt que de tokens `@theme`, car elles basculent en fonction du thème — vous devez donc les surcharger sous `:root` pour le mode clair et `.dark` pour le mode sombre :

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

| Variable | Description |
|---|---|
| `--surface-frame` | la page derrière tous les éléments, autour du volet latéral |
| `--surface-sheet` | la zone de contenu principale |
| `--surface-card` | les cartes, lignes de tableau, panneaux de formulaire |
| `--surface-raised` | un contrôle ou un panneau surélevé par rapport à une carte |
| `--surface-lifted` | les menus, popovers, boîtes de dialogue |
| `--surface-field` | le fond d'un champ texte (translucide) |
| `--surface-hover` / `--surface-active` | fonds au survol et à l'état enfoncé (translucides) |
| `--surface-well` | un conteneur en creux pour le code ou les journaux (logs) |
| `--hairline` / `--hairline-strong` | bordures et séparateurs (translucides) |

Conservez la hiérarchie : dans chaque thème, frame, sheet et card doivent s'échelonner dans la même direction. Les couleurs de texte sont ajustées par rapport aux valeurs par défaut, donc après une modification importante, vérifiez le contraste d'une page dans les deux thèmes.

## Modes clair et sombre

Par défaut, l'interface d'administration s'aligne sur le système d'exploitation, affiche un sélecteur de thème et mémorise le choix de l'utilisateur.

Pour ne proposer qu'un seul thème, prenez le contrôle du mode. Passez à `<Rebase>` un `modeController` dont la fonction `setMode` ignore le sélecteur, et appliquez la classe correspondante sur `<html>` — avec votre propre contrôleur, Rebase ne modifie pas les classes de la page :

```tsx
import type { ModeController } from "@rebasepro/app";

// Dark only. `frontend/index.html` also needs <html class="dark">.
const darkOnly: ModeController = {
    mode: "dark",
    setMode: () => {}
};

// <Rebase client={rebaseClient} authController={authController} modeController={darkOnly}>
```

## Logo et nom

`<RebaseShell>` reçoit le nom et le logo affichés dans le volet latéral. Le même logo apparaît sur l'écran de connexion intégré. Placez les fichiers dans `frontend/public/` :

```tsx
import { RebaseShell } from "@rebasepro/cms";

export function Shell() {
    return <RebaseShell title="Acme Ops" logo="/logo.svg" logoDark="/logo-dark.svg"/>;
}
```

`logoDark` est optionnel. Utilisez-le lorsque votre logo est sombre et disparaîtrait sur le thème sombre ; sans cette propriété, `logo` est utilisé dans les deux thèmes.

Le titre et l'icône de l'onglet du navigateur proviennent de `frontend/index.html` :

```html
<title>Acme Ops</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
```

## L'écran de connexion

L'écran de connexion intégré hérite automatiquement de votre couleur de marque, de vos polices, de vos surfaces et du `logo` du shell sans code supplémentaire.

Pour modifier ses textes ou ajouter votre propre contenu, fournissez à `<RebaseAuth>` une `LoginView` configurée. Dans le fichier généré `App.tsx`, `authController` est déjà disponible :

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

Autres props : `topComponent` (au-dessus des boutons de connexion), `layout="form-first"` (sans carte dédiée, pour une page qui intègre elle-même le formulaire de connexion, comme un écran partagé à côté d'une image de produit) et `disableSignupScreen`.

Pour remplacer complètement l'écran, surchargez `"Auth.LoginView"` (voir [Surcharges de composants](/docs/frontend/component-overrides)).

## Au-delà des tokens

- **Remplacez une partie du shell** — la barre d'application, le volet latéral, une ligne de navigation, l'écran de connexion — à l'aide d'une [surcharge de composant](/docs/frontend/component-overrides).
- **Ajoutez vos propres pages** en accord avec le thème : [Styliser une UI personnalisée](/docs/frontend/styling) explique avec quels composants et classes les construire afin que vos tokens s'y appliquent également.

## Checklist

- La couleur de marque est définie une seule fois, dans `@theme`, et nulle part ailleurs. Ne l'écrivez pas sous forme de valeur littérale dans les composants ; utilisez `bg-primary` / `text-primary`.
- Vérifiez un bouton plein et une case à cocher active : le libellé et la coche doivent être faciles à lire.
- Basculez le thème et observez un tableau, un formulaire et une boîte de dialogue dans les deux modes.
- Si vous avez remplacé les polices, supprimez les imports de polices par défaut.

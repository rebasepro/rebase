---
sourceHash: 29a546b753005a42
title: Styliser l'UI personnalisée
sidebar_label: Styliser l'UI personnalisée
description: Créez des vues personnalisées, des pages d'accueil et des actions à partir des mêmes composants et jetons de thème que le reste de l'administration, afin qu'elles paraissent natives et respectent le thème.
---

## Vue d'ensemble

Chaque mécanisme d'extension de cette section vous fournit un composant React et s'efface — une [vue personnalisée](/docs/frontend/extending), une [page d'accueil](/docs/frontend/component-overrides), une [vue d'entité](/docs/frontend/entity-views), un [slot](/docs/frontend/slots). Ce qu'aucun d'eux n'indique, c'est *avec quoi la construire*.

La réponse est : les mêmes éléments à partir desquels l'administration est construite. Une vue personnalisée reste une vue d'administration. Elle se trouve dans la même structure, aux côtés des mêmes tableaux, sous le même commutateur de thème — elle doit donc utiliser les mêmes composants, la même échelle typographique et les mêmes jetons de couleur.

L'alternative consiste à inventer un second langage de conception au sein de la même application. C'est l'erreur courante, et elle ne se contente pas de paraître incohérente — elle casse l'affichage. Un `color: #111` écrit à la main devient invisible dès que quelqu'un passe au thème sombre, et aucun test ne le détecte.

## La règle

**Importez les composants depuis `@rebasepro/ui`. N'utilisez une simple balise `<div>` et une classe que pour la mise en page.**

```tsx
import { Alert, Button, Card, Chip, Typography } from "@rebasepro/ui";

export function DashboardView() {
    return (
        <div className="p-8 max-w-5xl mx-auto flex flex-col gap-8">
            <Typography variant="h4">Outreach</Typography>
            <Typography variant="body2" color="secondary">
                What ran last night, and what is waiting for you.
            </Typography>

            <Card className="p-4 flex flex-col gap-1">
                <Typography variant="h5" className="mb-0 tabular-nums">128</Typography>
                <Typography variant="subtitle2" className="mb-0">Signals</Typography>
                <Typography variant="caption" color="secondary" className="mb-0">12 approved</Typography>
            </Card>

            <Alert color="warning">Delivery is not configured, so nothing can be sent.</Alert>
        </div>
    );
}
```

Chaque composant du kit est répertorié sous [Composants UI](/docs/ui/components/Card) avec ses véritables props, générées à partir du code source. Vérifiez-y avant de développer vous-même : `Card`, `Chip`, `Badge`, `Alert`, `Button`, `Typography`, `Paper`, `Container`, `Table`, `Tooltip`, `Dialog` et une quarantaine d'autres existent déjà.

## Couleur : utilisez des jetons, jamais de valeurs littérales

Le thème est un ensemble de variables CSS exposées sous forme d'utilitaires Tailwind. Utilisez-les, et associez chaque valeur claire à une valeur `dark:` :

| Usage | Classe |
|---|---|
| Corps de texte | `text-surface-900 dark:text-surface-100` |
| Texte secondaire | `text-surface-600 dark:text-surface-400` — ou simplement `<Typography color="secondary">` |
| Arrière-plan de panneau | `bg-surface-accent-50 dark:bg-surface-800` |
| Bordures | `border-surface-200 dark:border-surface-700` |
| Accent | `text-primary` / `bg-primary` (`#0070F4`) |

Deux règles issues de dysfonctionnements réels :

- **N'écrivez jamais de valeur de couleur littérale.** `#111`, `rgba(128,128,128,.28)`, `white` — chacune n'est correcte que dans un seul thème. Une page dont les chiffres étaient définis avec `color: var(--fg, #111)` s'est affichée en noir sur fond noir pour tous les utilisateurs du thème sombre, alors qu'elle semblait parfaite pour la personne qui l'avait écrite.
- **Ne définissez jamais une couleur qu'un composant définit déjà.** `<Typography>` choisit la bonne couleur de premier plan en fonction du thème. La surcharger avec une classe est la façon dont un titre finit par être le seul élément de la page qui ignore le thème.

## Typographie : utilisez l'échelle

`Typography` prend en charge toute l'échelle — `h1`–`h6`, `subtitle1`/`subtitle2`, `body1`/`body2`, `caption`, `label`. Utilisez `variant`, et non une classe de taille de police (`font-size`). L'échelle encode déjà l'espacement des lettres (tracking) dont chaque niveau a besoin (`--tracking-display` à ≥30px, `--tracking-title` à 20–24px, `--tracking-heading` en dessous), ce qu'une classe `text-[27px]` ne fait pas.

L'interface produit ne descend pas en dessous de `text-xs`. Les niveaux `text-2xs` et `text-3xs` sont réservés aux pages marketing uniquement.

## Configuration

L'UI personnalisée nécessite que le CSS du thème et Tailwind pointent vers les packages, sinon les classes utilitaires utilisées *à l'intérieur* de `@rebasepro/ui` ne seront jamais générées :

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

/* Without this, Tailwind never scans the kit's own classes. */
@source "../node_modules/@rebasepro";

@custom-variant dark (&:where(.dark, .dark *));
```

`rebase init` écrit cela pour vous. Si votre vue personnalisée s'affiche sans style, c'est la première chose à vérifier.

## Liste de contrôle

Avant de déployer une vue personnalisée :

- Aucune valeur de couleur littérale — chaque couleur est un jeton ou provient d'un composant.
- Chaque `bg-`, `text-` et `border-` a un équivalent `dark:`.
- Le texte utilise `<Typography variant=…>`, et non une classe de taille de police.
- Les conteneurs sont des `Card` / `Paper`, et non un `<div>` avec une bordure écrite à la main.
- Basculez le thème et observez la page. C'est l'intégralité du test, et cela prend cinq secondes.

---

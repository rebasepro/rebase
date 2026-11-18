---
sourceHash: 8d29618687855b39
title: Styliser l'UI personnalisée
sidebar_label: Styliser l'UI personnalisée
description: Créez des vues personnalisées, des pages d'accueil et des actions à partir des mêmes composants et jetons de thème que le reste de l'administration, afin qu'elles s'intègrent naturellement et respectent le thème.
---

## Vue d'ensemble

Chaque mécanisme d'extension de cette section vous fournit un composant React et s'efface — une [vue personnalisée](/docs/frontend/extending), une [page d'accueil](/docs/frontend/component-overrides), une [vue d'entité](/docs/frontend/entity-views), un [slot](/docs/frontend/slots). Ce qu'aucun d'entre eux ne précise, c'est avec *quoi la construire*.

La réponse est : avec les mêmes éléments que ceux qui composent l'interface d'administration. Une vue personnalisée reste une vue d'administration. Elle s'intègre dans le même shell, à côté des mêmes tableaux, sous le même sélecteur de thème — elle doit donc utiliser les mêmes composants, la même échelle typographique et les mêmes jetons de couleur.

Cette page traite de la création de vos propres vues. Pour modifier l'apparence générale de l'administration — couleur de marque, polices, arrondis, logo —, consultez [Theming & Branding](/docs/frontend/theming) ; vos vues utilisant les mêmes jetons, elles suivront également ces changements.

L'alternative consiste à inventer un second langage visuel au sein de la même application. C'est l'erreur la plus fréquente, et cela ne crée pas seulement un manque de cohérence — cela casse l'interface. Un `color: #111` codé à la main devient invisible dès qu'un utilisateur bascule sur le thème sombre, et aucun test ne le détecte.

## La règle

**Importez les composants depuis `@rebasepro/ui`. N'utilisez une simple `<div>` et une classe que pour la mise en page.**

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

Chaque composant du kit est répertorié dans les [composants UI](/docs/ui/components/card/) avec ses véritables props, générées à partir du code source. Vérifiez-y avant de développer vos propres éléments : `Card`, `Chip`, `Badge`, `Alert`, `Button`, `Typography`, `Paper`, `Container`, `Table`, `Tooltip`, `Dialog` et environ soixante-dix autres existent déjà.

## Couleur : utilisez des jetons, jamais de valeurs littérales

Le thème est un ensemble de variables CSS exposées sous forme d'utilitaires Tailwind. Utilisez-les, et associez chaque valeur claire à une valeur `dark:` :

| Utilisation | Classe |
|---|---|
| Corps de texte | `text-surface-900 dark:text-surface-100` |
| Texte secondaire | `text-surface-600 dark:text-surface-400` — ou simplement `<Typography color="secondary">` |
| Arrière-plan de panneau | `bg-surface-accent-50 dark:bg-surface-800` |
| Bordures | `border-surface-200 dark:border-surface-700` |
| Accentuation | `text-primary` / `bg-primary` (la couleur de marque du projet, `#0070F4` par défaut) |
| Texte sur fond d'accentuation | `text-on-primary` — noir ou blanc, selon ce qui est lisible sur la couleur de marque |

Deux règles issues de cas réels d'anomalies :

- **N'écrivez jamais de couleur littérale.** `#111`, `rgba(128,128,128,.28)`, `white` — chacune n'est correcte que dans un seul thème. Une page dont les chiffres étaient définis avec `color: var(--fg, #111)` s'est affichée en noir sur noir pour tous les utilisateurs en thème sombre, alors qu'elle semblait parfaite à la personne qui l'avait conçue.
- **Ne définissez jamais une couleur qu'un composant applique déjà.** `<Typography>` choisit automatiquement le bon premier plan pour le thème. Le surcharger avec une classe est le meilleur moyen d'obtenir un titre qui devient le seul élément de la page à ignorer le thème.

## Typographie : utilisez l'échelle

`Typography` prend en charge toute l'échelle — `h1`–`h6`, `subtitle1`/`subtitle2`, `body1`/`body2`, `lead`, `caption`, `label`, `button`, `stat`, `micro`, `mono`. Utilisez `variant`, et non une classe de taille de police. L'échelle intègre déjà le crénage (tracking) requis par chaque niveau (`--tracking-display` pour ≥30px, `--tracking-title` pour 20–24px, `--tracking-heading` en dessous), ce qu'un `text-[27px]` ne fait pas.

L'UI du produit ne descend pas en dessous de `text-xs`, à une exception près : la variante `micro`, le libellé en majuscules au-dessus d'une valeur, repose sur `text-2xs`. Le niveau `text-3xs` existe uniquement pour les pages marketing.

## Configuration

L'UI personnalisée nécessite le CSS du thème et la configuration de Tailwind pointant vers les packages, sinon les classes utilitaires utilisées *à l'intérieur* de `@rebasepro/ui` ne seront jamais générées :

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

/* Without this, Tailwind never scans the kit's own classes. */
@source "../node_modules/@rebasepro";

@custom-variant dark (&:where(.dark, .dark *));
```

`rebase init` génère cela automatiquement pour vous. Si votre vue personnalisée s'affiche sans style, c'est la première chose à vérifier.

## Checklist

Avant de déployer une vue personnalisée :

- Aucune couleur littérale — chaque couleur est un jeton ou provient d'un composant.
- Chaque `bg-`, `text-` et `border-` possède un équivalent `dark:`.
- Le texte utilise `<Typography variant=…>`, et non une classe de taille de police.
- Les conteneurs sont des composants `Card` / `Paper`, et non une `<div>` avec une bordure codée à la main.
- Basculez le thème et observez la page. C'est l'intégralité du test, et cela prend cinq secondes.

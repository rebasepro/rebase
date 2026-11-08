---
sourceHash: 29030083cf83fb27
title: Des panneaux dans votre propre page
sidebar_label: Panneaux dans vos propres pages
description: "Affichez une collection, le formulaire d'un enregistrement, un enregistrement ou une valeur dans votre propre page : CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue et CollectionsProvider, sans interface d'administration autour d'eux."
---

Sur la version 0.24,
`CollectionPanel` ne prend qu'un `path` enregistré et affiche « Collection not
found » en dehors de l'arborescence complète de l'admin, et `EntityFormPanel` ainsi que
`CollectionsProvider` n'existent pas.

Vous n'avez pas besoin de l'ensemble de l'interface d'administration pour afficher un tableau. `<CollectionPanel>` prend
la collection en tant que valeur et fonctionne n'importe où sous `<Rebase>` et un routeur
React Router, sans `<RebaseCMS>`, `<RebaseNavigation>` ni `<RebaseShell>` :

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
import { postsCollection } from "../config/collections/posts";
// Plus BrowserRouter, or any other router, from "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection={postsCollection}/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Un enregistrement s'ouvre par-dessus votre page, dans un panneau latéral ou une boîte de dialogue, et jamais par URL :
aucune route d'administration ne sert la page, donc `full_screen` et `split` s'ouvrent sous la forme d'un panneau
latéral, et `useUrlController().routesMounted` vaut `false` pour vos propres composants à cet endroit.
N'importe quel routeur fonctionne : un simple `<BrowserRouter>`, un `<MemoryRouter>` ou un routeur de données (« data router »).
Un routeur reste obligatoire. Un routeur de données permet également à un enregistrement contenant des modifications non enregistrées
d'interrompre la navigation intégrée à l'application ; avec les autres, seule l'invite de fermeture de page du navigateur fait office de garde-fou.
Enveloppez le panneau dans `<RebaseAuthGate>` si la page doit d'abord afficher l'écran de connexion de Rebase.

## Ce qu'affiche un panneau

<span class="since-badge" data-since="0.29">Depuis la 0.29</span>
Un panneau affiche la collection de la même manière que l'admin. Ces props permettent de la restreindre
aux besoins de votre page ; aucune d'entre elles ne modifie la page propre à la collection.

```tsx
import {
    CollectionAddButton,
    CollectionFiltersButton,
    CollectionPanel,
    CollectionSearchBar,
    CollectionToolbar
} from "@rebasepro/cms";

<CollectionPanel
    collection={ordersCollection}
    viewMode="cards"
    fields={["number", "status", "total"]}
    toolbar={<CollectionToolbar
        start={<CollectionFiltersButton/>}
        end={<><CollectionSearchBar/><CollectionAddButton/></>}/>}
    onRowClick={(order) => setSelected(order.id)}
    className="max-h-[480px]"/>
```

- `fields` — les propriétés affichées, dans cet ordre précis, et rien d'autre. Dans la
  table, ce sont les colonnes. Dans la liste, sur une carte et sur une carte kanban, elles
  servent à remplir les emplacements de la ligne — titre, image, sous-titre, statut, date,
  pastilles de relation, colonnes de la liste —, les premières étant traitées en priorité ; un
  emplacement qu'aucune d'entre elles ne remplit reste vide. Pour ce panneau, cette prop prévaut
  sur `propertiesOrder`, sur l'ordre des colonnes enregistré par l'utilisateur et sur `listProperties`.
  Les largeurs de colonnes redimensionnées par un utilisateur persistent toujours ; l'ordre étant
  fixé par vous, les colonnes ne peuvent pas être réorganisées par glisser-déposer.
- `toolbar` — la barre d'outils complète par défaut, `null` pour la masquer, ou une barre composée
  de ses éléments : `CollectionToolbar` (avec `start` et `end`), `CollectionSearchBar`,
  `CollectionFiltersButton`, `CollectionViewModeToggle` et `CollectionAddButton`. Ces composants lisent
  le panneau dans lequel ils sont affichés, et lèvent une erreur partout ailleurs. Les emplacements
  de plugins et la surcharge `Collection.Actions` résident dans la barre d'outils par défaut.
- `onRowClick` — appelée avec la ligne cliquée au lieu que le panneau ne l'ouvre, depuis
  une ligne, une carte, une carte kanban ou l'action de modification. La ligne correspond à celle envoyée
  par le serveur, sous la forme acceptée par `useRows`, `useRow` et `<FieldValue>` : chaînes de date ISO
  (`YYYY-MM-DD` pour une colonne de date seule), et une relation belongsTo sous forme de clé étrangère
  (`customerId`), et non sous le nom de la relation.
- `viewMode` — le mode dans lequel le panneau s'ouvre, prioritaire sur celui de l'URL et sur le
  dernier choix de l'utilisateur. Ce dernier peut toujours en changer.
- `title={false}` — aucun titre au-dessus du panneau, ni d'en-tête propre à la vue en liste.
- `updateUrl` — désactivé par défaut : le panneau ne lit ni n'écrit les paramètres d'URL
  `__view`, de filtre et de tri de la page.

Les `entityActions` de la collection s'affichent sur chaque ligne, carte et carte kanban :
sous forme de boutons lorsqu'elles sont déclarées avec `collapsed: false`, et dans le menu de la
ligne dans le cas contraire — un bouton « Approuver » sur chaque carte constitue une action.

Un panneau adapte sa taille à ses lignes. Sans hauteur définie par son parent, ou avec seulement un
`max-height`, une collection courte affiche sa barre d'outils et ses lignes, tandis qu'une collection
longue défile à l'intérieur de l'espace disponible, jusqu'à concurrence de la hauteur de la fenêtre.
Donnez-lui une hauteur pour la remplir. Il s'organise selon sa propre largeur et non celle de la
fenêtre : dans une colonne étroite, il adopte sa disposition compacte, quelle que soit la taille de l'écran.

`propertiesOrder` réorganise et ne masque jamais : une propriété omise est affichée après celles qui
sont listées. Pour en masquer une partout, définissez `admin.hideFromCollection` sur celle-ci ; pour n'en
afficher que certaines à un endroit donné, transmettez `fields`.

## Formulaire d'un enregistrement

`<EntityFormPanel>` fait de même pour le formulaire d'un enregistrement. Il charge l'enregistrement
via `entityId`, l'enregistre à travers la couche de données de `<Rebase>` comme le fait le formulaire de
l'admin, et appelle `onSaved` après chaque sauvegarde. Omettez `entityId` pour créer un enregistrement.
`onClose` est appelée lorsque le formulaire demande à être quitté, par exemple après la suppression de son
enregistrement :

```tsx
<EntityFormPanel
    collection={postsCollection}
    entityId={postId}
    onSaved={({ entity }) => console.log("saved", entity.id)}
    onClose={() => navigate("/posts")}/>
```

Si quelqu'un d'autre supprime l'enregistrement pendant que le formulaire est ouvert, le formulaire
conserve les informations saisies et indique que l'enregistrement a été supprimé ailleurs. Son action
« Save as new » le transforme en un formulaire de création d'un nouvel enregistrement avec ces valeurs ;
`onSaved` retourne alors le nouvel enregistrement.

<span class="since-badge" data-since="0.29">Depuis la 0.29</span> Le formulaire peut afficher une partie
d'un enregistrement ou organiser sa disposition selon vos souhaits. `fields` n'affiche que les champs
mentionnés, dans cet ordre ; les sections et le panneau latéral (« rail ») conservent leur regroupement.
`layout` remplace les champs générés par votre propre JSX, dans lequel `<FormField name="…"/>` affiche un
champ avec le libellé, la taille et les règles définis par le formulaire généré :

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    entityId={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

Dans les deux cas, le formulaire ne valide que les champs affichés ; le serveur continue de valider
l'enregistrement complet. Un formulaire de création qui omet un champ obligatoire sans valeur par
défaut le signale dès son ouverture : une erreur indique le nom du champ, et l'enregistrement reste
bloqué tant que le champ n'est pas affiché ou doté d'une valeur par défaut. `collectionOverrides`
modifie la collection uniquement pour ce formulaire, tout comme pour `CollectionPanel`.

Chaque formulaire isole ses identifiants DOM, permettant ainsi à deux formulaires de cohabiter sur une
même page. Pour cibler un champ lors d'un test, sélectionnez `[data-form-field="title"]` à l'intérieur
du conteneur `[data-form-path="posts"]` du formulaire.

<span class="since-badge" data-since="0.29">Depuis la 0.29</span>
`<EntityViewPanel>` est le pendant en lecture seule de `EntityFormPanel`. Il charge l'enregistrement
via `entityId` et l'affiche à l'identique de la page d'enregistrement de l'admin : les mêmes sections et
libellés, chaque valeur apparaissant sous sa forme de prévisualisation (un enum sous forme de pastille,
une date dans son fuseau horaire et une relation sous le titre de sa cible). Il accepte `fields` et
`collectionOverrides` de la même manière que le formulaire, et omet les mêmes champs que lui : ceux qu'une
règle `conditions.hidden` masque pour cet enregistrement, et ceux que l'utilisateur connecté n'est pas
autorisé à lire.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    entityId={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` affiche une valeur unique de la même façon, au sein de votre propre JSX. Il prend la ligne
complète, telle que retournée par `useRows`, `useRow` et `client.data`, car une relation belongsTo arrive
sous sa colonne de clé étrangère (`customerId`) et non sous le nom de la propriété ; `field="customer"` la
retrouve ainsi à cet endroit. Il nécessite que la collection soit enregistrée en amont, par `<RebaseCMS>`
ou un `CollectionsProvider`. Une collection ou un champ inconnu lève une erreur précisant son nom.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(row => (
        <div key={String(row.id)} className="flex gap-4">
            <FieldValue row={row} collection="orders" field="customer"/>
            <FieldValue row={row} collection="orders" field="status"/>
            <FieldValue row={row} collection="orders" field="placedAt"/>
        </div>
    ));
}
```

## Plusieurs panneaux dans un même scope

Les trois panneaux intègrent leur propre `CollectionsProvider` si aucun n'est présent au-dessus d'eux.
Il s'agit de la couche sous-jacente, et vous pouvez la monter vous-même pour partager un scope unique
entre plusieurs panneaux, ou pour utiliser les éléments de plus bas niveau (`CollectionViewBinding`,
`useSidePanel`) situés en dessous. À l'intérieur, un panneau peut désigner sa collection par son `path` :

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` gère un registre des collections qui lui sont transmises, en appliquant les fonctions
`modifyCollection` et `injectCollections` de vos plugins comme dans l'admin, ainsi que les panneaux latéraux
et boîtes de dialogue dans lesquels les enregistrements s'ouvrent, sans oublier la protection contre les
modifications non enregistrées. Veillez à ce que le tableau `collections` reste stable : via une constante
de module ou avec `useMemo`.

## Étapes suivantes

- [Personnaliser l'administration](/docs/frontend/customizing) : les emplacements où intégrer vos
  composants, et les recettes conçues à partir de ces panneaux.
- [Hooks](/docs/hooks) : `useRows`, `useRow`, `useRowCount`, `useAggregate` et
  `useRowWrites`, les lignes lues par ces panneaux et par `FieldValue`.
- [Surcharges de composants](/docs/frontend/component-overrides) : remplacer la vue
  ou le formulaire affiché par un panneau.

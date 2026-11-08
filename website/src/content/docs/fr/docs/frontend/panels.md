---
sourceHash: 095805c8d62157c4
title: Panneaux dans votre propre page
sidebar_label: Panneaux dans vos propres pages
description: "Affichez une collection, le formulaire d'un enregistrement, un enregistrement ou une valeur dans votre propre page : CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue et CollectionsProvider, sans structure admin autour d'eux."
---

En 0.24,
`CollectionPanel` accepte uniquement un `path` enregistré et affiche « Collection not
found » en dehors de l'arborescence complète d'administration, tandis qu'`EntityFormPanel` et
`CollectionsProvider` n'existent pas.

Vous n'avez pas besoin de l'administration complète pour afficher une table. `<CollectionPanel>` prend
la collection comme valeur et fonctionne n'importe où sous `<Rebase>` et un routeur React
Router, sans `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>` :

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

Un enregistrement s'ouvre au-dessus de votre page, dans un panneau latéral ou une boîte de dialogue, et jamais par URL :
aucune route d'administration ne dessert la page, donc `full_screen` et `split` s'ouvrent sous forme de
panneau latéral, et `useUrlController().routesMounted` vaut `false` pour vos
propres composants à cet endroit. N'importe quel routeur fonctionne : un simple `<BrowserRouter>`, un
`<MemoryRouter>` ou un data router. Un routeur reste requis. Un data router
permet également à un enregistrement contenant des modifications non enregistrées de bloquer la navigation dans l'application ; avec
les autres, seule l'invite de fermeture de page du navigateur le protège. Enveloppez le panneau dans `<RebaseAuthGate>` si la page
doit d'abord afficher l'écran de connexion de Rebase.

## Ce qu'affiche un panneau

<span class="since-badge" data-since="0.29">Depuis 0.29</span>
Un panneau restitue la collection de la même manière que l'administration. Ces props permettent de la restreindre aux
besoins de votre page ; aucune d'elles ne modifie la page propre de la collection.

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
    onRowClick={(order, id) => setSelected(id)}
    className="max-h-[480px]"/>
```

- `fields` — les propriétés qu'il affiche, dans cet ordre, et rien d'autre. Dans la
  table, il s'agit des colonnes. Dans la liste, sur une carte et sur une carte kanban,
  elles servent à remplir les emplacements de la ligne — titre, image, sous-titre, statut, date,
  pastilles de relation, colonnes de la liste —, les premières en priorité ; un emplacement qu'aucune
  d'elles ne remplit reste vide. Pour ce panneau, elle prévaut sur `propertiesOrder`, sur l'ordre
  des colonnes enregistré par un utilisateur et sur `listProperties`. Les largeurs de colonnes redimensionnées
  par un utilisateur persistent toujours ; l'ordre vous appartient, les colonnes ne peuvent donc pas être réorganisées par glisser-déposer.
- `toolbar` — la barre d'outils complète par défaut, `null` pour aucune, ou une barre composée
  de ses éléments : `CollectionToolbar` (avec `start` et `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  et `CollectionAddButton`. Ils lisent le panneau dans lequel ils sont affichés et lèvent une erreur
  partout ailleurs. Les emplacements de plugins (slots) et la surcharge `Collection.Actions` résident dans la
  barre d'outils par défaut.
- `onRowClick` — appelée avec la ligne cliquée et son identifiant au lieu que le panneau
  ne l'ouvre, depuis une ligne, une carte, une carte kanban et l'action de modification. La ligne est
  celle renvoyée par le serveur, au format accepté par `useRows`, `useRow` et `<FieldValue>` :
  exactement ses colonnes, des chaînes de date ISO (`YYYY-MM-DD` pour une colonne
  de date seule), et une relation belongsTo sous forme de clé étrangère (`customerId`). Une relation dont le panneau a chargé
  la cible arrive imbriquée sous son nom, telle que le paramètre `include` de REST la renvoie
  (`order.customer` est la ligne du client) ; sa clé étrangère y figure également. L'id
  est la chaîne par laquelle l'administration référence l'enregistrement — sa clé primaire, ou les éléments d'une
  clé composite reliés par `:::` — qu'acceptent `highlightedIds` et
  `useSidePanel().open`. `row.id` est la colonne `id` de l'enregistrement, lorsque la
  table en possède une, avec le type de cette colonne : `5` pour une clé entière, dont l'id est
  `"5"`.
- `highlightedIds` — les identifiants des lignes affichées comme sélectionnées, par exemple celle qu'une
  page affiche à côté de la liste : `highlightedIds={selected ? [selected] : []}`.
  `[]` n'en met aucune en surbrillance. Sans cette prop, le panneau met en surbrillance la dernière ligne ouverte. Les identifiants
  sont comparés sous forme de chaînes, de sorte qu'une clé entière `5` et `"5"` correspondent à la même ligne.
- `where` — les lignes qu'il contient, au format attendu par `useRows` :
  `where={{ status: ["==", "pending"] }}`. Les filtres définis par l'utilisateur sur d'autres
  champs se combinent avec lui, et ses propres champs ne peuvent pas être modifiés ou effacés depuis
  la barre d'outils. Il suit la prop, de sorte qu'une barre d'onglets ou une barre de graphique cliquée peut
  le piloter depuis un état. Il prévaut sur le `fixedFilter` de la collection, champ par
  champ.
- `viewMode` — le mode dans lequel il s'ouvre, prioritaire sur celui de l'URL et sur le
  dernier choisi par l'utilisateur. Ce dernier peut toujours en changer.
- `title={false}` — aucun titre au-dessus du panneau, ni l'en-tête propre à la vue en liste.
- `updateUrl` — désactivé par défaut : le panneau ne lit ni n'écrit les paramètres
  `__view`, de filtrage et de tri de la page.

Les `entityActions` de la collection s'affichent sur chaque ligne, carte et carte kanban, sous
forme de boutons lorsqu'elles sont déclarées avec `collapsed: false` et dans le menu de la ligne sinon — un bouton
« Approuver » sur chaque carte correspond à une action.

Un panneau s'ajuste à la taille de ses lignes. Sans hauteur définie par son parent, ou avec seulement un
`max-height`, une collection courte affiche sa barre d'outils et ses lignes, et une collection longue
défile dans l'espace dont elle dispose, jusqu'à la hauteur de la fenêtre. Donnez-lui une hauteur pour
qu'il la remplisse. Il s'organise selon sa propre largeur, et non celle de la fenêtre : dans une colonne
étroite, il utilise sa disposition compacte, quel que soit l'écran.

`propertiesOrder` réorganise et ne masque jamais : une propriété omise est affichée
après celles qu'elle mentionne. Pour en masquer une partout, définissez `admin.hideFromCollection`
sur celle-ci ; pour n'en afficher que certaines à un endroit donné, passez `fields`.

## Formulaire d'un enregistrement

`<EntityFormPanel>` fait de même pour le formulaire d'un enregistrement. Il charge l'enregistrement
par `id`, l'enregistre via la couche de données de `<Rebase>` comme le fait le
propre formulaire de l'administration, et appelle `onSaved` après chaque sauvegarde avec l'enregistrement sauvegardé tel que le
serveur renvoie la ligne, `row`, et son `id`. Omettez `id` pour créer un
enregistrement. `onClose` est appelée lorsque le formulaire demande à être quitté, par exemple après
la suppression de son enregistrement :

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

À l'instar de `CollectionPanel`, le formulaire et `EntityViewPanel` acceptent une collection
enregistrée via `path`, sans avoir besoin de l'objet de configuration :
`<EntityFormPanel path="posts" id={postId}/>`. Sous `<RebaseCMS>` ou un
`CollectionsProvider` qui l'enregistre, c'est tout ce dont ils ont besoin. Sans portée
parente, transmettez la collection en tant que valeur, comme ici, et le panneau apporte la
sienne ; une collection désignée par un chemin que rien n'enregistre indique que l'enregistrement est introuvable.

Si quelqu'un d'autre supprime l'enregistrement alors que le formulaire est ouvert, le formulaire conserve
ce qui a été saisi et indique que l'enregistrement a été supprimé ailleurs. Son action « Save as new » (Enregistrer comme nouveau)
le transforme en un formulaire qui crée un nouvel enregistrement avec ces valeurs ;
`onSaved` signale alors le nouvel enregistrement.

<span class="since-badge" data-since="0.29">Depuis 0.29</span> Le formulaire peut afficher
une partie d'un enregistrement, ou l'agencer selon vos souhaits. `fields` affiche uniquement les champs qu'il
énumère, dans cet ordre ; les sections et le rail conservent leur regroupement. `layout`
remplace les champs générés par votre propre JSX, dans lequel
`<FormField name="…"/>` affiche un champ avec le libellé, la taille et les règles que le
formulaire généré lui attribue :

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    id={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

Dans les deux cas, le formulaire ne valide que les champs qu'il affiche ; le serveur vérifie
toujours l'intégralité de l'enregistrement. Un formulaire qui crée un enregistrement et omet un
champ obligatoire sans valeur par défaut l'indique dès son ouverture : une erreur nomme le
champ, et l'enregistrement reste bloqué jusqu'à ce que le champ soit affiché ou qu'une valeur par défaut lui soit attribuée.
`collectionOverrides` modifie la collection pour ce formulaire uniquement, comme pour
`CollectionPanel`.

Chaque formulaire isole ses identifiants DOM, de sorte que deux formulaires peuvent partager une même page. Pour cibler un champ
depuis un test, sélectionnez `[data-form-field="title"]` à l'intérieur du
`[data-form-path="posts"]` du formulaire.

<span class="since-badge" data-since="0.29">Depuis 0.29</span>
`<EntityViewPanel>` est le jumeau en lecture seule de `EntityFormPanel`. Il charge l'enregistrement
par `id` et le restitue comme le fait la page d'enregistrement de l'administration : les mêmes
sections et libellés, avec chaque valeur sous forme de prévisualisation, de sorte qu'une énumération s'affiche sous forme de
pastille, une date dans son fuseau horaire et une relation sous forme du titre de sa cible. Il accepte
`fields` et `collectionOverrides` comme le formulaire, et omet les champs que
le formulaire omet : celui qu'une règle `conditions.hidden` masque pour cet enregistrement, et
celui que l'utilisateur connecté n'a pas le droit de lire.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` affiche une valeur de la même manière, au sein de votre propre JSX. Il prend la
ligne entière, telle que `useRows`, `useRow` et `client.data` la renvoient, car une
relation belongsTo arrive sous sa colonne de clé étrangère (`customerId`), et non
sous le nom de la propriété ; `field="customer"` la trouve à cet endroit. Il nécessite que la
collection soit enregistrée plus haut dans l'arborescence, par `<RebaseCMS>` ou un `CollectionsProvider`.
Une collection ou un champ inconnu lève une erreur qui le nomme.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(row => (
        <div key={String(row.id)} className="flex gap-4">
            <FieldValue row={row} path="orders" field="customer"/>
            <FieldValue row={row} path="orders" field="status"/>
            <FieldValue row={row} path="orders" field="placedAt"/>
        </div>
    ));
}
```

## Plusieurs panneaux dans une même portée

Les trois panneaux intègrent leur propre `CollectionsProvider` lorsqu'aucun n'est présent au-dessus d'eux. C'est
l'étape sous-jacente, et vous pouvez le monter vous-même pour partager une même portée entre
plusieurs panneaux, ou pour utiliser les éléments de niveau inférieur (`CollectionViewBinding`,
`useSidePanel`) sous celui-ci. En son sein, un panneau peut désigner sa collection par `path` :

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` conserve un registre des collections que vous lui transmettez, avec
les méthodes `modifyCollection` et `injectCollections` de vos plugins appliquées comme dans l'administration,
ainsi que les panneaux latéraux et boîtes de dialogue dans lesquels les enregistrements s'ouvrent, et la
protection contre les modifications non enregistrées. Veillez à ce que le tableau `collections` reste stable : une constante de module
ou `useMemo`.

## Étapes suivantes

- [Personnalisation de l'administration](/docs/frontend/customizing) : les emplacements où intégrer
  vos composants, et les recettes conçues à partir de ces panneaux.
- [Hooks](/docs/hooks) : `useRows`, `useRow`, `useRowCount`, `useAggregate` et
  `useRowWrites`, les lignes que ces panneaux et `FieldValue` lisent.
- [Surcharges de composants](/docs/frontend/component-overrides) : remplacer la vue
  ou le formulaire qu'un panneau affiche.

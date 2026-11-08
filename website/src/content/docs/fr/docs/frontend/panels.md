---
sourceHash: a33ca593ee016656
title: Des panneaux dans votre propre page
sidebar_label: Panneaux dans vos propres pages
description: "Affichez une collection, le formulaire d'un enregistrement, un enregistrement ou une valeur dans votre propre page : CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue et CollectionsProvider, sans shell d'administration autour d'eux."
---

En 0.24,
`CollectionPanel` n'accepte qu'un `path` enregistré et affiche « Collection not
found » en dehors de l'arborescence d'administration complète, et `EntityFormPanel` ainsi que
`CollectionsProvider` n'existent pas.

Vous n'avez pas besoin de l'ensemble de l'administration pour afficher une seule table. `<CollectionPanel>` prend
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

Un enregistrement s'ouvre par-dessus votre page, dans un panneau latéral ou une boîte de dialogue, et jamais par URL :
aucune route d'administration ne dessert la page, donc `full_screen` et `split` s'ouvrent sous
forme de panneau latéral, et `useUrlController().routesMounted` vaut `false` pour vos
propres composants à cet endroit. N'importe quel routeur fonctionne : un simple `<BrowserRouter>`, un
`<MemoryRouter>` ou un routeur de données (*data router*). Un routeur reste obligatoire. Un data router
permet également à un enregistrement contenant des modifications non enregistrées d'interrompre la navigation dans l'application ; avec
les autres, seule l'invite de fermeture de page du navigateur le protège. Enveloppez le panneau dans `<RebaseAuthGate>` si la page
doit d'abord afficher la connexion Rebase.

## Ce qu'affiche un panneau

<span class="since-badge" data-since="0.29">Depuis 0.29</span>
Un panneau affiche la collection de la même manière que l'administration. Ces props permettent de le restreindre à ce dont
votre page a besoin ; aucune d'entre elles ne modifie la page propre de la collection.

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
  table, ce sont les colonnes. Dans la liste, sur une carte et sur une carte kanban, elles
  servent à remplir les emplacements de la ligne — titre, image, sous-titre, statut, date,
  puces de relation, colonnes de la liste —, les premières en priorité ; un emplacement qu'aucune
  d'entre elles ne remplit reste vide. Pour ce panneau, cette propriété l'emporte sur `propertiesOrder`,
  l'ordre des colonnes enregistré par un utilisateur et `listProperties`. La largeur des colonnes
  redimensionnées par un utilisateur persiste toujours ; l'ordre étant le vôtre, les colonnes ne peuvent pas être réorganisées par glisser-déposer.
- `toolbar` — la barre d'outils complète par défaut, `null` pour aucune, ou une barre composée de
  ses éléments : `CollectionToolbar` (avec `start` et `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  et `CollectionAddButton`. Ils lisent le panneau dans lequel ils sont affichés et lèvent
  une erreur partout ailleurs. Les emplacements de plugins (*plugin slots*) et la surcharge `Collection.Actions` résident dans
  la barre d'outils par défaut.
- `onRowClick` — appelée avec la ligne cliquée et son identifiant au lieu que le panneau
  ne l'ouvre, depuis une ligne, une carte, une carte kanban et l'action de modification. La ligne correspond
  à celle envoyée par le serveur, avec la structure attendue par `useRows`, `useRow` et `<FieldValue>` :
  exactement ses colonnes, des chaînes de date ISO (`YYYY-MM-DD` pour une colonne
  de type date uniquement), et une relation belongsTo sous forme de clé étrangère (`customerId`). Une relation dont le panneau a chargé la
  cible arrive imbriquée sous son nom, telle que retournée par le `include` de REST
  (`order.customer` est la ligne du client) ; sa clé étrangère s'y trouve également. L'identifiant
  est la chaîne par laquelle l'administration désigne l'enregistrement — sa clé primaire, ou les parties d'une clé
  composite jointes par `:::` — acceptée par `highlightedIds` et
  `useSidePanel().open`. `row.id` correspond à la colonne `id` de l'enregistrement, lorsque la
  table en possède une, avec le type de cette colonne : `5` pour une clé entière, dont l'identifiant est
  `"5"`.
- `highlightedIds` — les identifiants des lignes affichées comme sélectionnées, par exemple celle
  qu'une page affiche à côté de la liste : `highlightedIds={selected ? [selected] : []}`.
  `[]` n'en met aucune en surbrillance. Sans cela, le panneau met en surbrillance la dernière ligne ouverte. Les identifiants
  sont comparés sous forme de chaînes, donc `5` et `"5"` pour une clé entière représentent la même ligne.
- `viewMode` — le mode dans lequel il s'ouvre, prioritaire sur celui de l'URL et sur le dernier
  choisi par l'utilisateur. Ce dernier peut toujours en changer.
- `title={false}` — aucun titre au-dessus du panneau, ni l'en-tête propre de la vue en liste.
- `updateUrl` — désactivé par défaut : le panneau ne lit ni n'écrit les paramètres
  `__view`, de filtrage et de tri de la page.

Les `entityActions` de la collection s'affichent sur chaque ligne, carte et carte kanban, sous
forme de boutons lorsqu'elles sont déclarées avec `collapsed: false` et dans le menu de la ligne dans le cas contraire — un
bouton « Approuver » sur chaque carte est une action.

Un panneau ajuste sa taille à ses lignes. En l'absence de hauteur définie par son parent, ou avec seulement un
`max-height`, une collection courte affiche sa barre d'outils et ses lignes, tandis qu'une collection longue
défile dans l'espace disponible, jusqu'à la hauteur de la fenêtre. Donnez-lui une hauteur pour
qu'il la remplisse. Il s'organise selon sa propre largeur et non celle de la fenêtre : dans une colonne
étroite, il utilise sa disposition compacte, quel que soit l'écran.

`propertiesOrder` réorganise et ne masque jamais : une propriété omise est affichée
après celles qui sont listées. Pour en masquer une partout, définissez `admin.hideFromCollection`
sur celle-ci ; pour n'en afficher que certaines à un endroit précis, passez `fields`.

## Le formulaire d'un enregistrement

`<EntityFormPanel>` fait de même pour le formulaire d'un seul enregistrement. Il charge l'enregistrement
par son `id`, l'enregistre via la couche de données de `<Rebase>` comme le fait le formulaire
de l'administration, et appelle `onSaved` après chaque sauvegarde avec l'enregistrement sauvegardé tel que le
serveur renvoie la ligne, `row`, et son `id`. Omettez `id` pour créer un
enregistrement. `onClose` est appelé lorsque le formulaire demande à être quitté, par exemple après
la suppression de son enregistrement :

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Si quelqu'un d'autre supprime l'enregistrement alors que le formulaire est ouvert, le formulaire conserve
ce qui a été saisi et indique que l'enregistrement a été supprimé ailleurs. Son action « Enregistrer comme nouveau »
le transforme en un formulaire qui crée un nouvel enregistrement avec ces valeurs ;
`onSaved` signale alors le nouvel enregistrement.

<span class="since-badge" data-since="0.29">Depuis 0.29</span> Le formulaire peut afficher
une partie d'un enregistrement ou l'agencer selon vos souhaits. `fields` n'affiche que les champs
indiqués, dans cet ordre ; les sections et le rail conservent leur regroupement. `layout`
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
champ obligatoire sans valeur par défaut le signale dès son ouverture : une erreur nomme le
champ, et l'enregistrement reste bloqué jusqu'à ce que le champ soit affiché ou qu'une valeur par défaut lui soit attribuée.
`collectionOverrides` modifie la collection pour ce formulaire uniquement, tout comme pour
`CollectionPanel`.

Chaque formulaire isole la portée de ses identifiants DOM (*DOM ids*), de sorte que deux formulaires peuvent partager une même page. Pour cibler un champ
depuis un test, sélectionnez `[data-form-field="title"]` à l'intérieur du
`[data-form-path="posts"]` du formulaire.

<span class="since-badge" data-since="0.29">Depuis 0.29</span>
`<EntityViewPanel>` est le pendant en lecture seule d'`EntityFormPanel`. Il charge
l'enregistrement par son `id` et l'affiche comme le fait la page d'enregistrement de l'administration : les
mêmes sections et libellés, chaque valeur étant présentée sous sa forme d'aperçu, de sorte qu'une
énumération s'affiche sous forme de badge (*chip*), une date dans son fuseau horaire et une relation sous forme du titre de sa cible. Il accepte
`fields` et `collectionOverrides` comme le fait le formulaire, et omet les champs
que le formulaire omet : ceux qu'une règle `conditions.hidden` masque pour cet enregistrement, et
ceux que l'utilisateur connecté n'a pas le droit de lire.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` affiche une valeur unique de la même manière, à l'intérieur de votre propre JSX. Il prend la
ligne entière, telle que retournée par `useRows`, `useRow` et `client.data`, car une
relation belongsTo arrive sous sa colonne de clé étrangère (`customerId`) et non
sous le nom de la propriété ; `field="customer"` la retrouve là. Il nécessite que la
collection soit enregistrée plus haut dans l'arborescence, par `<RebaseCMS>` ou un `CollectionsProvider`.
Une collection ou un champ inconnu lève une erreur précisant son nom.

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

## Plusieurs panneaux dans une même portée

Les trois panneaux intègrent leur propre `CollectionsProvider` lorsqu'aucun n'est présent au-dessus d'eux. Il s'agit
de la couche sous-jacente, et vous pouvez la monter vous-même pour partager une même portée entre
plusieurs panneaux, ou pour utiliser les éléments de plus bas niveau (`CollectionViewBinding`,
`useSidePanel`) en dessous. À l'intérieur, un panneau peut désigner sa collection par son `path` :

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` contient un registre des collections que vous lui transmettez, avec les méthodes
`modifyCollection` et `injectCollections` de vos plugins appliquées comme dans l'administration,
ainsi que les panneaux latéraux et les boîtes de dialogue dans lesquels les enregistrements s'ouvrent, et la
protection contre les modifications non enregistrées. Veillez à ce que le tableau `collections` reste stable : une constante de module
ou `useMemo`.

## Prochaines étapes

- [Personnaliser l'administration](/docs/frontend/customizing) : les emplacements où intégrer
  vos propres composants, et les recettes conçues à partir de ces panneaux.
- [Hooks](/docs/hooks) : `useRows`, `useRow`, `useRowCount`, `useAggregate` et
  `useRowWrites`, les lignes que ces panneaux et `FieldValue` lisent.
- [Surcharges de composants](/docs/frontend/component-overrides) : remplacer la vue
  ou le formulaire affiché par un panneau.

---
sourceHash: f7689301748e2ce5
title: Tables dans le CMS
sidebar_label: Tables dans le CMS
description: "Comment le CMS affiche chaque table Postgres sans aucune configuration frontend : libellés, widget associé à chaque type de colonne, champs obligatoires et en lecture seule, relations, emplacements d'affichage et contrôles Créer, Modifier et Supprimer respectant la sécurité au niveau des lignes de la table."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Si vous utilisez le CMS, vous n'avez pas besoin de lui décrire vos tables. Lorsqu'un utilisateur se connecte, le panneau demande au backend les tables que cette personne est autorisée à voir, et affiche chacune d'elles sous la forme d'une **collection** : une page dans la navigation comprenant une vue tabulaire, un formulaire, des filtres et les lignes associées à l'enregistrement. Une table est l'objet backend que vous déclarez dans [`backend/schema`](/docs/schema/) ; une collection est la manière dont le panneau l'affiche.

```tsx
// frontend/src/App.tsx: nothing about posts, users or tags here.
<Rebase client={rebaseClient} authController={authController}>
    <RebaseAuth/>
    <RebaseCMS/>
    <RebaseShell title="Acme"/>
</Rebase>
```

Tout ce qui suit est dérivé du descripteur de la table : ses colonnes avec leurs types Postgres, leur acceptation des valeurs nulles (nullability), leurs valeurs par défaut, leurs règles de validation et de stockage, ses relations et sa posture de sécurité au niveau des lignes (row-level security). Pour modifier l'un de ces éléments, ajoutez un fichier [`customizeTable`](/docs/frontend/customize-table/) ; il n'indique que ce qui diffère.

:::note[Vous venez des collections ?]
Le panneau lisait auparavant `config/collections` via un plugin Vite. Il lit désormais les tables fournies par le backend, et la présentation réside dans `frontend/src/cms/*.tsx`.
:::

## D'où viennent les tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`<RebaseCMS>` appelle `client.schema.tables()`, qui lit `GET /api/schema/tables`. La réponse est la liste des descripteurs de tables, expurgée pour l'appelant : une table qu'il ne peut pas lire est absente, tout comme une colonne que ses rôles ne peuvent pas lire (voir [Accès aux champs](/docs/collections/field-access/)). Le code des hooks ne quitte jamais le serveur ; le descripteur indique uniquement quels hooks existent.

- Le panneau fait la demande dès qu'un utilisateur est connecté, et la renouvelle lorsque l'utilisateur connecté ou ses rôles changent. Aucune table n'est envoyée à un visiteur déconnecté.
- Le serveur associe un `ETag` à la réponse. Le client conserve la dernière réponse et renvoie l'étiquette, de sorte qu'un schéma inchangé ne coûte qu'un `304`.
- Actualiser la navigation relance la demande. L'éditeur de schéma effectue cette action après avoir modifié une table.

Les mêmes descripteurs pilotent le Studio et les applications MCP, garantissant que tous les trois partagent la même définition d'une table.

## Libellés

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque libellé est dérivé d'un identifiant, de sorte qu'une table soit lisible de la même manière pour chaque appelant et à chaque chargement :

| Identifiant | Libellé |
|---|---|
| colonne `first_name`, `firstName` ou `FirstName` | First Name |
| colonne `author_id`, `photoUrl`, `apiKey` | Author ID, Photo URL, API Key |
| colonne `__order` | Order |
| table `order_items` | Order Items, un enregistrement : Order Item |
| table `addresses`, `status_updates` | Addresses / Address, Status Updates / Status Update |
| valeur d'enum `needs_review` | Needs Review |

Les libellés de la table proviennent du nom sous lequel elle a été définie, et non de son slug ou de son nom SQL. `ID`, `IDs`, `URL`, `URLs`, `UUID`, `API` et `IP` conservent leurs majuscules. La mise au singulier ne modifie que le dernier mot et ne touche pas aux mots qui se terminent simplement par un `s` (`Status`, `Analysis`, `Address`).

## Le champ attribué à chaque colonne

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Colonne | Champ dans le formulaire | Remarques |
|---|---|---|
| `col.text()`, `col.varchar({ length })`, `col.char({ length })`, `col.uuid()` | champ texte | `varchar` et `char` limitent la longueur |
| une colonne texte avec `.validate({ email: true })` | champ email | validé en tant qu'email |
| une colonne texte avec `.validate({ url: true })` | champ URL, avec aperçu du lien | validé en tant qu'URL |
| une colonne texte avec `{ enum: [...] }`, une colonne numérique avec `.oneOf([...])` | menu déroulant (select) | une option par valeur |
| une colonne texte ou uuid avec `.userId()` | sélecteur d'utilisateur | la valeur est l'identifiant de l'utilisateur |
| `col.enum([...])`, une colonne `pgEnum` | menu déroulant (select), affiché sous forme de pastille colorée | une couleur par valeur, déterminée par la valeur elle-même |
| `col.smallint()` … `col.bigserial({ mode: "number" })` | champ numérique | nombres entiers uniquement |
| `col.real()`, `col.doublePrecision()`, `col.numeric({ precision, scale })` | champ numérique | |
| `col.boolean()` | interrupteur (switch) | |
| `col.timestamp({ withTimezone: true })` | sélecteur de date et heure | |
| `col.date()` | sélecteur de date | |
| `col.time()` | heure de la journée | |
| `col.storage(…)` | champ de téléversement avec aperçu | `.multiple()` est un champ multi-fichiers |
| `<item>.array()` | liste répétable du champ de l'élément | un tableau de texte `{ enum: [...] }` est une sélection multiple |
| `col.jsonb().$type<T>()`, `col.json().$type<T>()` | éditeur clé/valeur | le type `T` est effacé au moment de l'exécution |
| `col.jsonb(json.object({…}))` | un groupe de champs typés | listes, blocs typés et fichiers à l'intérieur, selon la structure |
| `col.geopoint()` | latitude et longitude | |
| `col.vector({ dimensions })` | champ vectoriel | |
| `col.bytea()` | champ binaire | base64 sur le réseau |

Une valeur d'enum conserve sa couleur où qu'elle apparaisse : dans le menu déroulant, sur la pastille de la table et en tant que colonne kanban. La couleur dépend uniquement de la valeur, l'ajout d'une valeur ne modifie donc jamais la couleur des autres. `customizeTable` permet de définir les libellés et les couleurs souhaités avec `enumLabels` ; une valeur non spécifiée conserve son libellé et sa couleur dérivés.

Une colonne `jsonb` déclarée avec une [structure `json.*`](/docs/schema/json/) bénéficie d'un véritable formulaire : un objet devient un groupe de champs, un tableau répète son élément, un tableau de `json.oneOf` devient un éditeur de blocs, et `json.storage()` est un champ de téléversement intégré. Sans structure définie, le panneau ne peut pas interpréter le document et propose une édition libre clé/valeur.

Chaque type de colonne, son widget et les options permettant de le modifier sont détaillés dans [Champs](/docs/collections/properties/).

## Champs obligatoires, valeurs par défaut et champs en lecture seule

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| La colonne | Dans le formulaire |
|---|---|
| `.notNull()` | obligatoire, avec le `requiredMessage` de `.validate()` lorsqu'il existe |
| `.default(literal)` | un nouvel enregistrement s'ouvre avec cette valeur ; reste obligatoire lors de la modification |
| `` .default(sql`…`) ``, `.defaultNow()`, `.dbDefault()` | peut être laissé vide lors de la création, la base de données s'occupant de le renseigner |
| `.unique()` | le formulaire vérifie que la valeur est inutilisée avant l'enregistrement |
| une clé primaire générée (`.defaultRandom()`, `.generatedByDefaultAsIdentity()`, un serial) | non modifiable ; une clé sans valeur par défaut est saisie manuellement lors de la création |
| `.onCreateNow()`, `.onUpdateNow()` | en lecture seule, et exclu des colonnes par défaut de la table |
| `.onCreateUser()`, `.onUpdateUser()` | en lecture seule |
| `.readOnly()`, `.generatedAlwaysAs(…)` | en lecture seule |
| le champ `tenant` de la table | renseigné par le serveur lors de la création, et exclu des colonnes par défaut de la table ; reste modifiable pour un appelant autorisé à l'écrire |
| `.private()` | jamais transmis, donc jamais affiché |

Les règles `.validate()` d'une colonne sont vérifiées par le formulaire avant l'enregistrement, tout comme le serveur les vérifie à la réception. Voir [Validation et conditions](/docs/collections/validation-and-conditions/).

L'identifiant de l'enregistrement ainsi que ses horodatages `.onCreateNow()` et `.onUpdateNow()` sont affichés dans le bloc en lecture seule en bas de la barre latérale du formulaire.

## Relations

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- Un `belongsTo` est un sélecteur de la ligne associée, à la place de sa colonne de clé étrangère : le formulaire affiche **Author**, et non **Author ID**. Il est obligatoire lorsque la clé étrangère est `NOT NULL` sans valeur par défaut. Une clé étrangère faisant partie de la clé primaire reste un champ distinct, aux côtés du sélecteur.
- Un `hasOne` est un sélecteur de l'unique ligne associée.
- Un `hasMany`, un `manyToMany` et un `via` de type « to-many » sont des **onglets** de l'enregistrement, listant les lignes associées. Le sélecteur à côté de l'onglet est masqué.
- Un `via` est en lecture seule, sauf s'il est explicitement configuré en écriture.
- Une relation vers une table qui n'est pas fournie à l'appelant est ignorée : le panneau ne peut pas ouvrir une table dont il ne dispose pas. Un `belongsTo` laisse alors sa clé étrangère sous forme de champ simple, afin que la valeur reste visible.

Voir [Relations dans le panneau d'administration](/docs/collections/relations-in-the-admin-panel/).

## Emplacements d'affichage

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque surface affichant un enregistrement utilise une partie de six emplacements : title, subtitle, image, status, date et tags (voir [emplacements d'affichage](/docs/frontend/view-modes/#display-slots)). Un emplacement n'est rempli à partir d'une colonne que lorsque celle-ci y a manifestement sa place ; la première colonne correspondante, dans l'ordre de déclaration, est retenue :

| Emplacement | Colonne |
|---|---|
| title | une colonne texte sans ensemble fermé de valeurs et sans fichier, dont la clé est `title`, `name`, `label`, `displayName`, `fullName`, `heading`, `subject` ou `username` (casse et séparateurs ignorés) |
| image | une colonne unique `col.storage()` dont la propriété `accept` spécifie un type d'image |
| status | une colonne nommée `status` avec un ensemble fermé de valeurs |
| date | une colonne de type date ou timestamp que le serveur n'horodate pas automatiquement (`publishDate`) ; à défaut, l'horodatage de mise à jour, puis l'horodatage de création |

Un emplacement qu'aucune colonne ne remplit est laissé à l'interprétation propre du panneau (pour le titre : le premier champ texte court). L'option `display` dans `customizeTable` permet de définir explicitement n'importe quel emplacement.

## Qui voit quels contrôles

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le panneau masque **Créer**, **Modifier** et **Supprimer** lorsque l'utilisateur connecté n'est pas autorisé à effectuer ces actions. Il prend cette décision en évaluant la sécurité au niveau des lignes (row-level security) de la table dans le navigateur, avec le même modèle de stratégies que celui compilé pour Postgres :

- les règles que vous avez déclarées dans `rls`, ainsi que les stratégies que Rebase ajoute à leurs côtés : la base de référence administrateur (sauf si `defaultPolicies: false`), la politique d'auto-lecture et de contrôle d'écriture administrateur de la table des utilisateurs, et la règle de partitionnement multi-locataire (tenancy) (voir [stratégies attribuées à une table](/docs/collections/security-rules/#policies-a-table-gets-without-writing-them)) ;
- `rls: "admin-only"` : seuls les administrateurs voient les contrôles ;
- une règle écrite en SQL brut ne peut pas être évaluée dans le navigateur, pas plus qu'une clause que le serveur a retenue pour cet appelant : le contrôle est affiché, et la base de données tranche au moment où l'écriture arrive ;
- une vue SQL est en lecture seule. Une vue standard est listée et les tables qu'elle lit déterminent les lignes retournées ; une vue matérialisée est listée pour les rôles qu'elle spécifie (`["admin"]` lorsqu'elle n'en mentionne aucun).

Cela détermine uniquement ce qui est affiché. Chaque écriture est à nouveau vérifiée par Postgres, de sorte qu'un contrôle qui n'aurait pas dû être affiché entraîne un refus d'écriture, jamais une écriture indue.

## Ordre et valeurs par défaut

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les tables apparaissent dans la navigation dans l'ordre où le backend les transmet, c'est-à-dire l'ordre dans lequel elles sont exportées depuis `backend/schema/index.ts`. Chacune s'ouvre dans la vue tabulaire. `customizeTable` permet de configurer `group`, `icon`, `defaultViewMode` et le reste ; `<RebaseCMS navigationGroupMappings>` organise les groupes à travers les tables.

## Chargement et erreurs

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- **Pendant le chargement des tables**, une route menant à une collection affiche l'état de chargement, et non « collection introuvable », et un lien direct s'ouvre dès que la collection existe.
- **Si les tables ne peuvent pas être chargées**, la page d'accueil et la route de la collection indiquent ce qui a échoué et proposent de réessayer. Lorsque le serveur n'accepte plus la session, le message invite à se reconnecter.
- **Un backend qui ne fournit aucune table** (sans authentification configurée, ou antérieur à la route) n'est pas une erreur : le panneau affiche les [collections externes](/docs/frontend/firebase/) et rien d'autre.

Les personnalisations qui désignent une table non fournie à l'appelant sont ignorées, avec un avertissement en mode développement. Voir [ce qui est refusé et ce qui est ignoré](/docs/frontend/customize-table/#what-is-refused-and-what-is-skipped).

## Grand nombre de tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Rien ne limite le nombre de tables. Le panneau a besoin de chaque collection pour construire la navigation, les descripteurs sont donc récupérés après la connexion, et ce dont l'ouverture d'une collection a besoin (la table, les vues d'enregistrements, le formulaire) n'est chargé qu'à ce moment-là. Un schéma volumineux ralentit davantage `rebase db push` que le panneau : avec 400 tables ou plus, un push prend plusieurs dizaines de secondes ; voir [combien de temps prend un push](/docs/cli/schema#rebase-db-push).

## Prochaines étapes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [customizeTable](/docs/frontend/customize-table/) : modifier l'un des éléments ci-dessus, par table
- [Champs](/docs/collections/properties/) : le widget et les options de chaque type de colonne
- [Modes de vue](/docs/frontend/view-modes/) : table, cartes, kanban, emplacements d'affichage et filtres
- [Relations dans le panneau](/docs/collections/relations-in-the-admin-panel/) : onglets, sélecteurs et tables de jonction (pivots)
- [Firestore aux côtés de Postgres](/docs/frontend/firebase/) : collections issues d'une autre source de données

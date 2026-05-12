---
slug: fr/docs/changelog
title: Journal des modifications
---
## [3.1.0] - 2026-02-20

- **Intégration de l'IA** :
  - Introduction de fonctionnalités de génération de collections et d'amélioration des données basées sur l'IA.
  - Ajout d'une nouvelle icône d'IA et intégration des capacités d'IA dans l'éditeur de collection.
- **Vue Kanban** :
  - Ajout du support complet pour les tableaux Kanban avec des colonnes personnalisables.
  - Implémentation du réordonnancement des colonnes par glisser-déposer et des mises à jour optimistes.
  - Ajout d'options de configuration Kanban, y compris les couleurs de colonne.

- **Fonctionnalités de collection** :
  - Ajout de la vue `display` à l'éditeur de collection.
  - Implémentation du réordonnancement des colonnes par glisser-déposer dans les tableaux de données avec persistance.
  - Amélioration de l'inférence de collection avec des paramètres de filtre et de tri optionnels.
- **Améliorations UI/UX** :
  - Ajout d'un sélecteur de mode d'affichage (Liste, Grille, Tableau) pour un meilleur contrôle de la visualisation des données.
  - Implémentation de groupes de navigation de tiroir escamotables.
  - Ajout du support de modal bloquant en plein écran pour la bannière de cookies.
  - Harmonisation des couleurs des boutons et restylage des composants d'onglets.
  - Remplacement de `AutorenewIcon` par `FindInPageIcon` pour une meilleure clarté.
  - Activation du comportement de défilement fluide.
- **Stockage** :
  - Ajout du support pour les URL de stockage entièrement qualifiées.
  - Ajout des options `includeBucketUrl` et `imageResize` pour les téléchargements de fichiers.
- **Gestion des utilisateurs** :
  - Ajout de la méthode `updateUserFields` pour les mises à jour directes de Firestore.
- **Correctifs** :
  - Mise à jour de la dépendance Firebase vers la v12.7.0.
  - Mises à jour de sécurité pour Next.js (CVE-2025-66478).
  - Correction de bugs de validation des autovalues de date.
  - Correction de problèmes de fusion d'objets et de modifications locales.
  - Amélioration de l'intégration de la recherche textuelle avec Typesense.
  - Correction de la mise en page et du style dans FormEnhanceAction.

## [3.0.0] - 2025-12-01

- **Améliorations de l'éditeur** :
  - Amélioration du comportement de la touche Échap dans la commande slash de l'éditeur.
  - Amélioration du comportement du menu de suggestion.
  - Amélioration de la gestion des suggestions de chemins dans les composants de l'éditeur de collection.
  - Refactorisation des suggestions de collection racine.
- **Améliorations UI/UX** :
  - Ajout de la fonction `prettifyIdentifier` pour formater les identifiants et améliorer la lisibilité.
  - Refactorisation du formatage des clés pour utiliser prettifyIdentifier.
  - Petits ajustements de l'interface utilisateur à travers l'application.
  - Petite mise à jour visuelle des boîtes de dialogue.
  - Suppression de la police font-mono de l'aperçu de la carte.
- **Éditeur de collection** :
  - Ajout de l'édition de prop en ligne à l'éditeur de collection.
  - Correctifs pour l'enregistrement des propriétés de l'éditeur de collection.
  - Application d'un comportement cohérent aux props `editable` dans les collections et les propriétés.
- **Mises à jour de l'API** :
  - Mise à jour des URL du serveur API pour utiliser de nouveaux points d'accès.
- **Dépendances** :
  - Nombreuses mises à jour de dépendances.
  - Ajout de la configuration PostCSS avec Tailwind CSS et Autoprefixer.
- **Gestion des utilisateurs** :
  - Refactorisation de la gestion des utilisateurs pour utiliser de manière cohérente `saas_uid` et `firebase_uid`.
  - Mise à jour des styles de bouton dans EnableAuthView pour une meilleure cohérence.
  - Refactorisation des formulaires utilisateurs pour améliorer la mise en page et la gestion de l'état.
- **Configuration du projet** :
  - Mise à jour de la gestion de la configuration du projet pour tenir compte du statut d'essai.
  - Ajout d'un écran de chargement initial.
- **Correctifs** :
  - Correction de problèmes de DND sur la page d'accueil.
  - Correction de l'aperçu des modifications locales dans les actions de ligne.
  - Correction de la différence des modifications locales.
  - Correction des dates perdant le focus lors de la saisie et lors de la sélection de valeurs nulles dans les filtres de date.
  - Correction d'un glitch UI dans les filtres d'énumération de sélection.
  - Correction des vues d'entité en plein écran avec des caractères encodés dans leur ID.
- **Stockage et images** :
  - Ajout de nouvelles capacités de redimensionnement d'images.
  - Remplacement de la bibliothèque de compression interne par compressor.js.
  - Amélioration du message d'erreur lorsque Firebase Storage n'est probablement pas activé.
- **Amélioration des données** :
  - Ajustement de l'esthétique de l'amélioration des données.
- **Gestion des formulaires** :
  - Affichage des erreurs avant sauvegarde dans la vue tableau.
  - Amélioration du focus sur l'erreur lors de l'enregistrement du formulaire avec des erreurs et un feedback.
  - Débounced sur le changement de valeurs dans Formex.
  - Ajout de `initialTouched` au contrôleur Formex.
  - Modification de la manière dont les valeurs "sales" sont persistées dans le stockage local.
- **Modifications locales** :
  - Ajout de `enableLocalChangesBackup` aux collections, permettant aux utilisateurs de désactiver la copie locale des entités non sauvegardées dans le navigateur.
  - Modification des changements locaux pour qu'ils puissent être appliqués manuellement.
  - Effacement de l'indicateur de modifications non sauvegardées si la fonctionnalité n'est pas activée dans les collections.
- **Historique d'entité** :
  - Ajout d'un type plus propre au plugin d'historique d'entité.


## [3.0.0-rc.4] - 2025-11-25

- Refactorisation des formulaires utilisateur pour améliorer la mise en page et la gestion de l'état.
- Mise à jour de la gestion de la configuration du projet pour tenir compte du statut d'essai.
- Nombreuses mises à jour de dépendances.

## [3.0.0-rc.3] - 2025-11-07

- Affichage des erreurs avant sauvegarde dans la vue tableau.
- Correction de problèmes de DND sur la page d'accueil.
- Ajout de nouvelles capacités de redimensionnement d'images et remplacement de la bibliothèque de compression interne par compressor.js.
- Amélioration du message d'erreur lorsque Firebase Storage n'est probablement pas activé.
- Petite mise à jour visuelle des boîtes de dialogue.
- Ajout de l'édition de prop en ligne à l'éditeur de collection.
- Correctifs pour l'enregistrement des propriétés de l'éditeur de collection et l'application d'un comportement cohérent aux props `editable` dans les collections et les propriétés.
- Correction d'un glitch UI dans les filtres d'énumération de sélection.
- Correction des dates perdant le focus lors de la saisie et lors de la sélection de valeurs nulles dans les filtres de date.
- Correction de l'aperçu des modifications locales dans les actions de ligne.
- Suppression de la police font-mono de l'aperçu de la carte.
- Correction de la différence des modifications locales.
- Ajout d'un type plus propre au plugin d'historique d'entité.
- Modification des changements locaux pour qu'ils puissent être appliqués manuellement.
- Ajout de `enableLocalChangesBackup` aux collections, permettant aux utilisateurs de désactiver la copie locale des entités non sauvegardées dans le navigateur.
- Débounced sur le changement de valeurs dans Formex et ajout de `initialTouched` au contrôleur Formex.
- Amélioration du focus sur l'erreur lors de l'enregistrement du formulaire avec des erreurs et un feedback.

## [3.0.0-rc.2] - 2025-10-16

- **Gestion des utilisateurs dans Rebase Core** : Ajout de capacités de gestion des utilisateurs directement à Rebase Core, élargissant les options auto-hébergées.
- **Champs utilisateur comme valeurs de chaîne** : Implémentation complète du support pour les champs utilisateur comme valeurs de chaîne, améliorant la flexibilité dans la gestion des données utilisateur.
- **Migration vers TipTap V3** : Migration de l'éditeur Markdown vers TipTap V3 pour des performances et des fonctionnalités améliorées.
- **Rénovation Tailwind 4** : Multiples adaptations pour supporter la rénovation Tailwind 4, modernisant l'infrastructure de style.
- **Améliorations de la connexion** :
  - Implémentation de la connexion par e-mail Cloud.
  - Ajout de l'authentification par e-mail et mot de passe à Cloud SaaS.
  - Ajout d'événements analytiques de connexion.
  - Correction de la mise en page de connexion de la démo.
- **Mises à jour du site web** :
  - Ajout d'un site d'atterrissage Astro (WIP).
  - Mises à jour de la migration du site web.
  - Images migrées.
  - CSS de site web en ligne.
  - Mises à jour de la conception web.
  - Ajustements de la page de sécurité.
- **Améliorations de la page d'accueil** :
  - Stockage de l'état réduit de la page d'accueil dans le stockage local.
  - Tentative de correction pour le renommage de groupe sur la page d'accueil.
  - Annulation de certaines modifications de glisser-déposer.
- **Correctifs** :
  - Correction du support SSR (Server-Side Rendering) de l'éditeur.
  - Correction de l'importation de références avec des bases de données secondaires.
  - Correction du support pour les références de base de données secondaires.
  - Correction de la vue des permissions SaaS.
  - Correction de l'entrée de filtre pour les nombres lorsque la valeur est 0.
  - Meilleure gestion des erreurs pour le docteur (outil de diagnostic).
- **UI/UX** :
  - Suppression du bouton de collection parent forcé.
- **Dépendances** : Mises à jour des dépendances du template.
- **Documentation** :
  - Amélioration de la documentation pour les icônes personnalisées dans les collections.
  - Ajout de la documentation d'authentification.
  - Ajout d'une section d'informations de sécurité.

## [3.0.0-rc.1] - 2025-09-25

- **Mise à niveau Firebase 12** : Mise à jour vers Firebase 12 pour des performances et des fonctionnalités améliorées.
- **Améliorations du plugin d'historique** :
  - Ajout du suivi des valeurs précédentes au plugin d'historique.
  - Ajout de la création programmatique d'entrées d'historique.
- **Améliorations des propriétés de référence** :
  - Ajout de la configuration du champ de référence en tant que chaîne.
  - Correction de l'affichage des colonnes supplémentaires dans la sélection de référence.
  - Correction des propriétés de référence ne s'affichant pas correctement sans chemin mais avec un champ personnalisé.
- **Mises à jour de l'interface utilisateur** :
  - Mise à jour de l'icône SaaS par défaut.
  - Mises à jour des couleurs des boutons.
  - Réduction des sections de la page d'accueil.
  - Petites mises à jour web et suppression d'Algolia DocSearch.
- **Correctifs** :
  - Correction du problème de connexion Google Cloud.
  - Correction de l'erreur au retour de la vue d'abonnement.
  - Correction du stockage du projet récent.
  - Correction des importations TipTap.
  - Correction du passage correct de gclid à l'application.
  - Correction du CLS (Cumulative Layout Shift) du site web.
- **CLI** : Ajout des instructions npm au CLI.
- **Dépendances** : Diverses mises à jour et nettoyage de dépendances.
- **Documentation** : Correction d'une faute de frappe dans custom_previews.md.
- **Import/Export** : Nettoyage des importations.
- **Gestion des rôles** : Ajout de la possibilité de définir des rôles par programmation dans le code.

## [3.0.0-beta.15] - 2025-08-18

- **Fonctionnalité d'enquête** : Ajout d'une enquête utilisateur initiale avec suivi analytique pour améliorer l'expérience utilisateur et recueillir des commentaires.
- **Améliorations des actions d'entité** :
  - Ajout d'un registre d'actions d'entité pour une meilleure organisation.
  - Ajout du contexte de formulaire aux actions d'entité.
  - Actions d'entité maintenant disponibles en mode plein écran.
  - Amélioration de la page des actions d'entité.
- **Gestion des abonnements** :
  - Ajout d'un lien vers le portail Stripe pour une gestion facile des abonnements.
  - Amélioration de la vue d'abonnement dans les paramètres du projet.
  - Ajout de la possibilité de changer de méthode de paiement.
  - Ajout d'événements analytiques pour le succès ou l'échec de l'abonnement.
  - Mises à jour des prix.
- **Améliorations de la page d'accueil** :
  - Ajout de la fonctionnalité de glisser-déposer aux sections de la page d'accueil.
  - Réintroduction de la vue vide par défaut sur la page d'accueil.
  - Implémentation du comportement de dépôt de groupe.
  - Ajout de la possibilité de renommer des groupes.
  - Les collections peuvent maintenant être éditées dans la vue d'édition d'entité.
  - Correction du problème de re-rendu de la recherche sur la page d'accueil.
- **Améliorations UI/UX** :
  - Changement des boutons par défaut de la couleur primaire à la couleur neutre.
  - Ajout de la plus petite taille de commutateur.
  - Mise à jour du dégradé de fond du héros.
  - Mises à jour mineures du style.
  - Ajout d'un sélecteur de devise sur la page de tarification.
  - Réduction de la taille des icônes de collection.
  - Optimisations mobiles de la page d'atterrissage.
  - Ajout d'une petite animation aux vues de connexion.
  - Mise à jour du logo.
  - Petites mises à jour visuelles du tiroir.
- **Analyses** :
  - Ajout du suivi des campagnes aux analyses.
  - Ajout d'événements analytiques de page d'atterrissage.
  - Ajout d'événements analytiques pour les enquêtes.
- **Mises à jour des composants** :
  - Modification des props de classe Alert.
  - Ajout de `viewportClassName` au composant Select.
  - Mise à jour visuelle du téléchargement de fichiers.
  - Permettre l'utilisation de composants React comme icônes.
  - Ajout des `previous values` au plugin d'historique.
  - Permettre de désactiver le focus dans la boîte de dialogue.
- **Performances et corrections de bugs** :
  - Correction de la taille du bouton de chargement.
  - Correction des entités devenant "sales" à la création à cause du champ markdown.
  - Correction d'un bug de filtrage pour les valeurs nulles.
  - Correction de l'erreur useMemo avec des arguments changeants.
  - Correction d'un bug de chemins d'ID.
  - Correction de l'ordre des collections fusionnées.
  - Optimisations des performances et corrections de bugs pour le DND (glisser-déposer).
  - Correction de la gestion des chemins des groupes de collection.
- **Champs personnalisés** : Amélioration de la page des champs personnalisés.
- **Correction du dialogue de référence** : Correction d'un problème de tri de la boîte de dialogue de référence lorsque des filtres sont appliqués dans la collection principale.
- **Démo produit** : Amélioration de l'action de démo de synchronisation de produit.
- **Mises à jour web** :
  - Mises à jour de la conception web.
  - Optimisations web mobile.
  - Amélioration de la fonction getPath.
  - Ajout d'attributs de données au composant Button.
- **Documentation** : Amélioration du pipeline de génération de llms.txt.
- **Docusaurus** : Mise à jour de version.

## [3.0.0-beta.14] - 2025-04-17

- **Bascule de vue JSON** : Ajout d'une bascule dans la vue de l'éditeur de collections pour accéder aux données JSON brutes.
- **Cohérence de l'interface utilisateur** : Amélioration de la cohérence de l'interface utilisateur pour les composants de sélection simple et multiple.
- **Améliorations de formulaire** : Amélioration du redimensionnement des champs de formulaire popup et de la gestion des limites.
- **Plugin d'historique d'entité** : Ajout de la fonctionnalité de suivi de l'historique à Rebase Cloud et Rebase PRO.
- **Correctifs** :
  - Correction du débordement de texte dans les titres d'entité.
  - Correction des erreurs affichées incorrectement dans les tableaux de cartes.
  - Correction des boutons tronqués.
  - Correction des entités en lecture seule masquées par la barre inférieure.
  - Correction de la couleur du texte de superposition en mode sombre.
  - Correction des erreurs non effacées dans l'éditeur de collection.
  - Correction de mergeDeep pour gérer correctement les cas nuls.
  - Correction du défilement réinitialisant l'axe X lors de la pagination.
  - Réintroduction de l'indication d'erreur de cellule de tableau.
- **Glisser-déposer** : Remplacement de `@hello-pangea/dnd` par `@dnd-kit` pour de meilleures performances et une meilleure flexibilité.

## [3.0.0-beta.13] - 2025-04-11

- **Aperçu JSON** : Ajout d'un onglet d'aperçu JSON aux entités, offrant une vue des données brutes. Peut être désactivé avec la prop `disableJsonTab`.
- **Améliorations de TextField** : Ajout des props `maxRows` et `minRows` au composant TextField pour un meilleur contrôle des entrées multilignes.
- **AuthController dans PropertyBuilder** : Ajout de `authController` au callback PropertyBuilder, permettant l'accès au contexte d'authentification.
- **Améliorations du stockage** : Ajout de `processFile` aux propriétés de stockage pour le pré-traitement des fichiers avant le téléchargement.
- **Formulaires secondaires** : Les formulaires secondaires sont maintenant toujours rendus, même s'ils sont désactivés, pour une meilleure cohérence.
- **Améliorations de l'interface utilisateur** :
  - Ajustement des tailles de champs petites et les plus petites pour une meilleure hiérarchie visuelle.
  - Mise à jour du style de couleur neutre des boutons.
  - Amélioration de la mise en page pour les longs ID d'entité.
  - Divers petits ajustements de mise en page.
- **Correctifs** :
  - Correction du champ de référence de tableau avec un bouton d'ajout incorrect.
  - Correction des sous-collections ne résolvant pas le chemin correctement.
  - Correction d'un bug de navigation d'alias avec une sous-collection complexe.
  - Correction de la fonctionnalité d'exportation lorsque `flatten arrays` est faux (les guillemets doubles sont maintenant échappés correctement).
  - Correction des problèmes de sélection d'énumération de CollectionDetailsForm.
  - Correction d'un bug de création d'entité.
  - Correction de la mise à jour de l'URL pour les entités avec vue sélectionnée par défaut.
  - Correction des valeurs ne se réinitialisant pas correctement.
  - Correction des vues d'entité en lecture seule manquant des onglets.
  - Correction d'un bug lié au camel case.
- **Démo** : Ajout d'une démonstration du composant MultiSelect.

## [3.0.0-beta.12] - 2025-03-13

- **Vues d'entité en plein écran** : Vous pouvez maintenant ouvrir les entités en mode plein écran. C'est utile lorsque vous voulez vous
  concentrer sur l'entité que vous éditez. Vous pouvez activer cette fonctionnalité en définissant la prop `openEntityMode` sur `full_screen`
  dans la vue de collection. Le mode par défaut reste `side_panel`. Une refonte majeure de la navigation a été effectuée pour
  s'adapter à tous les nouveaux cas d'utilisation.
- **Préservation du défilement** : Lorsque vous ouvrez une entité en mode plein écran, la position de défilement de la vue de collection est préservée.
- **Brouillons enregistrés localement** : Les brouillons sont maintenant enregistrés localement dans le navigateur. Cela signifie que si vous fermez
  accidentellement le navigateur ou naviguez ailleurs, vos modifications seront toujours là à votre retour.
- Préservation de l'état de l'URL : L'état des filtres et du tri est maintenant préservé dans l'URL.
- **Fonctionnalité Annuler/Rétablir** : Ajout de la possibilité d'annuler et de rétablir les modifications lors de l'édition d'entités.
- Ajout du flag `alwaysApplyDefaultValues` aux collections. Ce flag vous permet d'appliquer les valeurs par défaut lors de la mise à jour
  des entités, pas seulement lors de leur création.
- Les formulaires secondaires conservent maintenant leur largeur en mode panneau latéral. Vous pouvez créer des formulaires secondaires complets
  qui vivent dans leur propre onglet. Les formulaires secondaires sont construits comme des composants personnalisés et peuvent inclure
  n'importe quel composant, y compris les liaisons de champ.
- Ajout du mode couleur système en plus des modes sombre et clair. Le bouton est maintenant un menu déroulant au lieu d'une bascule.
- Améliorations de formulaire, y compris la réinitialisation de l'état initial après sauvegarde et les actions de formulaire d'entité détachées.
- Avertissement lors de la fermeture de formulaires non sauvegardés pour éviter la perte accidentelle de données.
- Vous pouvez maintenant remplacer les actions d'entité par défaut en fournissant une action avec l'une des clés `edit`, `copy` ou `delete`
  dans la prop `entityActions`.
- Correction : Les propriétés de chaîne avec stockage prennent maintenant la préférence dans les aperçus.
- Correction de l'encodage d'URL pour les collections.
- Correction du défilement des actions de dialogue quand ce n'était pas nécessaire.
- Correction de la navigation vers de nouvelles entités à partir du panneau latéral.

## [3.0.0-beta.11] - 2024-12-13

- Nouveau template Next.js pour Rebase PRO. Vous pouvez maintenant créer un nouveau projet avec le template PRO en utilisant le CLI.
- [CHANGEMENT MAJEUR] Suppression de `userRoles` de AuthController. Vous pouvez maintenant accéder directement à la prop `roles` dans l'objet utilisateur.
- [CHANGEMENT MAJEUR] De nombreuses tailles d'interface utilisateur Rebase ont été ajustées pour une meilleure cohérence. Cela ne vous affectera que si vous utilisez des composants personnalisés.
    - `smallest` ou `tiny` ont été renommés en `small`.
    - `small` a été renommé en `medium`.
    - `medium` a été renommé en `large`.
- [CHANGEMENT MAJEUR] Pour les versions auto-hébergées, il y a eu un changement dans l'API des contrôleurs de gestion des données. Le
  `authController` est maintenant passé au contrôleur de gestion des utilisateurs, et non l'inverse. Le
  `userManagementController` peut être utilisé comme contrôleur d'authentification, mais avec toute la logique supplémentaire pour la gestion des utilisateurs.

❌ Code avant :

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

✅ Code après :

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

- Ajout de nombreuses directives "use client" aux composants UI.
- Correction de problèmes dans la boîte de dialogue de code de l'éditeur de collection.
- Mise à jour des styles web et intégration des améliorations dans Docusaurus.
- Amélioration du style pour les références vides et ajustements de conception mineurs.
- Travail en cours sur les composants personnalisés de l'éditeur.
- Réintroduction de la variante de couleur primaire sombre pour de meilleures options de thème.
- Mises à jour web mineures pour une esthétique et des fonctionnalités améliorées.
- Correction d'un bug où l'éditeur n'enregistrait pas les valeurs fausses.
- Remplacement de toutes les instances de couleurs grises et ardoise par des couleurs `surface` et `surface-accent` plus unifiées pour une cohérence de l'interface utilisateur.
- Ajout d'un fallback de composant Avatar et intégration de la configuration ESLint dans les templates.
- Amélioration de la gestion des erreurs dans les formulaires et des messages d'erreur cloud.
- Refactorisation de la logique de gestion des utilisateurs pour une meilleure organisation du code.
- Amélioration de la gestion des propriétés de commutateur booléen dans les configurations.
- Introduction de la gestion de l'état pour les enfants dans ArrayContainer.
- Ajout d'une recette pour la création de slugs, améliorant la gestion des URL et le référencement.
- Correction des problèmes de crash dans les champs répétitifs pour les sous-propriétés et résolution de divers bugs mineurs de style et de fonctionnalité.
- Améliorations de la réactivité des cartes thermiques (correctifs HMR).
- Refactorisation des fonctionnalités de recherche textuelle pour une meilleure efficacité et ajout d'une documentation pertinente.
- Correction des problèmes de champs de saisie numérique bloquant le défilement et remplacement du sélecteur de date par une entrée de date HTML native pour une meilleure cohérence.
- Si vous utilisez le composant `Select`, vous n'avez plus besoin de fournir une fonction `renderValue`. Le composant le gérera automatiquement.
- Les propriétés d'aperçu personnalisées sont maintenant rendues si la valeur est indéfinie.
- Correction pour la version Cloud rafraîchissant la navigation trop souvent.
- Correction pour la recherche locale ne fonctionnant pas au retour à une collection.
- Correction d'un bug lors de la sélection d'une entité en lecture seule.
- Correction d'un bug de sélection dans les groupes de collection pour les entités partageant un ID.
- Les aperçus de référence prennent maintenant en compte les tableaux d'images pour l'image d'aperçu.

## [3.0.0-beta.10] - 2024-07-10

- Correction des problèmes de licences incorrectes.
- Résolution des dépendances TipTap.
- Résolution de diverses mises à jour mineures de style sur le web.
- Déplacement du CSS du corps des importations par défaut vers des fichiers individuels pour une meilleure modularité.
- Implémentation de plusieurs mises à jour web, y compris des corrections de style de sélection et des ajustements de titre de dialogue pour la recherche textuelle.
- Mise à jour de la vue de sélection de propriété de l'éditeur de collection et amélioration de la mise en page de sélection de widget.
- Application d'ajustements à l'AppBar pour améliorer le comportement sur les appareils mobiles.
- Amélioration des sorties console et nettoyage de divers segments de code.
- Amélioration de l'interface utilisateur avec l'ajout d'un composant Slider et mise à jour de la documentation associée.
- Remplacement de l'icône d'édition d'entité par un crayon pour plus de clarté.
- Mise à jour des dépendances et affinement de la gestion de projet avec une fonctionnalité de vérification de licence.
- Amélioration de la gestion des entrées numériques par Formex et correction de l'exportation de DateTimeField dans Next.js.
- Ajout de la génération de clé API et des capacités de sélection de projet.
- Introduction d'un message d'avertissement de retard et améliorations dans la gestion des données de collection et de sous-collection.
- Meilleure gestion des erreurs et cohérence de la mise en page dans l'application.


## [3.0.0-beta.9] - 2024-07-10

- **NOUVEL ÉDITEUR MARKDOWN** : L'éditeur Markdown a été entièrement remanié. Il prend désormais en charge un aperçu en direct et une expérience d'édition considérablement améliorée. Il inclut maintenant un menu slash auquel vous pouvez accéder en tapant `/` dans l'éditeur. De plus, une nouvelle barre d'outils avec des boutons pour les opérations Markdown courantes. Le nouvel éditeur inclut également une fonctionnalité de complétion automatique par IA, qui suggère des éléments Markdown au fur et à mesure que vous tapez, et affiche le Markdown généré en temps réel et en surbrillance.
- Des champs supplémentaires sont maintenant affichés dans la boîte de dialogue latérale de l'entité.
- L'import/export est maintenant divisé en 2 plugins distincts.
- Les paquets ne sont plus minifiés, laissant cette responsabilité au bundler client.
- Ajout d'un champ de taille maximale dans l'éditeur de collection pour les fichiers.
- Amélioration de la gestion des erreurs lors de téléchargements de fichiers incorrects.
- Amélioration de l'erreur lors de l'ouverture d'une entité non accessible dans la vue latérale.
- Ajustements du composant Select et suppression de la prop `multiple`.
- Nouveau composant `MultiSelect` avec une UX considérablement améliorée.
- Introduction d'AppCheck directement dans Rebase Cloud.
- Ajout du support MongoDB pour Rebase PRO.
- Multiples correctifs dans le plugin de gestion des utilisateurs pour les projets PRO.
- Mise à jour des dépendances react-router.
- Amélioration de la personnalisation, vous pouvez maintenant définir les styles pour chaque entrée de typographie, y compris la taille de la police, la typographie...
- Amélioration de la recherche sur la page d'accueil, utilisant maintenant fuse.js.
- Correction pour l'index manquant et les clés incorrectes dans un tableau de cartes avec constructeur de propriétés.
- Correction de la position de la poignée de glisser dans l'éditeur.
- Renommage de `partOfBlock` en `minimalistView` dans les props de champ.
- Il est maintenant possible de définir des propriétés d'aperçu au niveau de la collection.
- Mise à jour du style des références.
- Les info-bulles ont été remaniées pour utiliser moins de divs.
- Correction de la position du plugin d'amélioration des données.
- Correction de la façon dont vous pouvez surcharger la source de données pour des collections spécifiques.
- Vous pouvez maintenant également définir une base de données différente de `(default)` dans la source de données.
- Le plugin de gestion des utilisateurs enregistre maintenant les utilisateurs avec l'e-mail comme clé, au lieu d'une valeur aléatoire.
- Correction des panneaux latéraux s'ajustant à la bonne taille lorsque la fenêtre change de taille.
- Quelques mises à jour de style du tiroir.
- `RepeatFieldBinding` peut maintenant utiliser des propriétés de tableau non résolues.

## [3.0.0-beta.8] - 2024-07-10

- Correction des re-rendus excessifs dans la vue de formulaire.
- Vous pouvez maintenant utiliser les composants `PropertyFieldBinding` dans vos vues d'entité personnalisées, et ils seront traités comme des champs normaux.
- Pour les vues d'entité supplémentaires, vous pouvez maintenant préserver la barre d'actions inférieure, avec la prop `includeActions`.
- Pour les propriétés de carte, si elles ne sont pas requises, la valeur peut être `undefined`, mais si une propriété enfant a une valeur, la validation sera déclenchée pour tous les enfants.
- Correction des cartes de données ne étant pas parcourues correctement avec une valeur nulle.
- Le template CLI pro prend maintenant en charge la création de la configuration de l'application web.
- Correction de l'inférence des données de l'éditeur de collection pour les énumérations.
- Petite amélioration du style de la feuille.
- Correction du problème de chargement de la recherche locale avec les données mises en cache.
- Petite correction visuelle pour les ID.
- Mises à jour d'AppCheck.
- Correction de l'ouverture incohérente des boîtes de dialogue latérales d'aperçu de référence.
- Correction des icônes pour les aperçus d'image.
- Navigation vers l'URL d'accueil lors de la déconnexion.
- Ajout de la prop `previewUrl` dans les options de stockage (#639).
- Correction du problème de sécurité XLSX CVE-2024-22363 (#654).
- Correction pour la suppression des clés dans les champs KeyValue.
- Ajout d'une grande taille pour les commutateurs booléens.
- Mise à jour d'eslint vers la dernière version et configuration.
- Correction de types pour `removePropsIfExisting`.
- Correction d'un bug de glisser de vidéo dans les champs de tableau.
- Ajout d'une option pour demander la réinitialisation du mot de passe, dans la vue de connexion PRO.
- Autorisation des valeurs nulles par défaut pour les propriétés.
- Ajout d'un compteur aux liaisons de champ de tableau.
- Correction des valeurs par défaut dans les cartes imbriquées dans les tableaux.
- Résolution du chemin de collection d'entité avec celui provenant de l'entité, et non de la configuration de la vue.
- Petite correction pour l'image du logo.
- Correction des champs conditionnels ne se mettant pas à jour correctement.
- Masquer le bouton nouvel utilisateur si `disabledSignupScreen`.
- Amélioration du style de la barre de navigation des documents.
- Permettre aux cartes d'être complètement indéfinies.
- Bouton d'ajout désactivé dans les groupes de collection.
- Grande refactorisation d'entité, les vues personnalisées sont maintenant sous le fournisseur formex.
- Correction CLI pour les utilisateurs non connectés.
- Correction des datamaps ne étant pas parcourues correctement avec des valeurs nulles.
- Mises à jour des props d'échafaudage.

## [3.0.0-beta.7] - 2024-06-18

- Renommage de la classe utilitaire `cn` en `cls`, tout en gardant `cn` disponible avec un avertissement de dépréciation.
- Ajout de la documentation du Menubar et des documents squelettes manquants.
- Correction du type d'ordre des propriétés pour autoriser les sous-collections.
- Nouvelle section UI ajoutée à la page de destination.
- Amélioration du flux de dialogue d'enregistrement et de fermeture.
- Permettre de masquer les ID et les liens d'entité dans les références et les aperçus.
- Suppression de certaines transitions CSS.
- Permettre de masquer le sélecteur de mode de couleur.
- Ajout d'un exemple de vue JSON.
- Changement du tableau virtuel pour utiliser la taille en pixels.
- Quelques mises à jour de conception pour une meilleure expérience utilisateur.
- Réintroduction de la colonne de groupe de collection avec les ID parents.
- Amélioration de la sortie des résultats vides.
- Ajout d'exemples d'invites et de suggestions pour DataTalk.
- Amélioration de la vue d'entité latérale, calculée dynamiquement en fonction de la profondeur de la propriété de collection.
- Correction des types mergeDeep.
- Correction du problème d'exportation de propriétés non existantes définies dans `propertiesOrder`.
- Correction des problèmes de template PRO sans projets Cloud.
- Amélioration de la gestion des valeurs d'énumération avec la valeur 0.

## [3.0.0-beta.6] - 2024-04-23

- Ajout d'AppCheck à chaque variante Rebase.
- Divers correctifs pour le délégué de source de données.
- Correction dans l'enregistrement des données nettoyées.
- Correction du problème de création de nouveaux rôles utilisateur Cloud.
- Correction du problème d'affichage des messages d'erreur dans les cellules de tableau.
- Correction du problème de mise à jour des sous-collections.
- Mise à jour des analyses d'import/export et des conversions de mappage de données associées.
- Mise à jour et amélioration de la gestion des rôles et permissions des utilisateurs.
- Amélioration de la gestion des fichiers de compte de service et de la création de projets à l'aide de SA.
- Mise à jour du comportement des requêtes non indexées.
- Suppression de la connexion de la gestion des utilisateurs à la démo.
- Mises à jour de dépendances pour atténuer les problèmes de sécurité.
- Exposition de méthodes supplémentaires issues de l'inférence de données pour une meilleure personnalisation.
- Mises à jour du template Pro pour une UI/UX améliorée.
- Mise à jour de la documentation pour les collections et la gestion des utilisateurs.

## [3.0.0-beta.5] - 2024-04-01

- [CHANGEMENT MAJEUR] Le composant principal pour Rebase Cloud a été renommé de `RebaseApp` à `RebaseCloudApp`. Veuillez mettre à jour vos importations en conséquence.
- Correctifs liés au CLI. Vous pouvez maintenant installer le CLI globalement avec `npm install -g @rebasepro/cli`.

## [3.0.0-beta.4] - 2024-03-27

- [CHANGEMENT MAJEUR] Le nom du paquet pour Rebase Cloud a changé de `rebase` à `@rebasepro/cloud`. Ceci est fait
  pour éviter les conflits avec le paquet Rebase principal. Si vous utilisez Rebase Cloud, vous devrez mettre à jour vos
  importations.
- [CHANGEMENT MAJEUR] Si vous importez la configuration tailwind, vous pouvez maintenant trouver l'importation à :
  `import rebaseConfig from "@rebasepro/ui/tailwind.config.js";`
- [CHANGEMENT MAJEUR] Dans ce cas, vous devez également ajouter `@tailwindcss/typography` à vos dépendances de développement.
- [CHANGEMENT MAJEUR] Vous devez mettre à jour votre `vite.config.js` et remplacer le nom du paquet dans la configuration fédérée :
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
- Améliorations mineures des performances et corrections de bugs.
- Capacité de filtrage et de tri améliorée pour les champs indexés.
- Extension de StorageSource pour supporter `bucketUrl` personnalisé.
- Nettoyage des génériques du contrôleur de navigation et des classes de prose Markdown.
- Résolution des problèmes d'enregistrement de la gestion des utilisateurs et renommage du template Cloud.
- Correction des re-rendus de ReferenceWidget.tsx.
- Correction du problème du bouton de nouvelle collection sur la page d'accueil.
- Correction du chemin des templates CLI.
- Rôles intégrés à AuthController.
- Petite modification à l'API des plugins.
- Ajout des détails utilisateur au menu déroulant de la barre de navigation.
- Dépendances mises à jour.
- Refactorisation de l'aperçu et du titre de la vue d'entité.
- Tableau Kanban en cours de travail.
- Correction pour les nouvelles valeurs de sélection vides de radix.
- Correctifs pour les propriétés indéfinies dans les tableaux et l'éditeur.
- Paramètres supplémentaires ajoutés dans les contrôleurs d'authentification.
- Refactorisation des cartes de navigation et nettoyage de l'API Plugin.
- Correction pour l'importation de données avec des ID non-chaîne.
- Documentation : Ajout d'une recette pour la gestion des callbacks d'entité.
- Mises à jour web et correction CLI pour yarn.

## [3.0.0-beta.3] - 2024-02-21

- Correction pour l'importation de données dans les sous-collections.
- Réordonnancement du code.
- Suppression de la minification. Modification des vérifications de type EntityReference.
- Mises à jour du téléchargement d'images de l'éditeur.
- Cosmétique.
- Déplacement du plugin de l'éditeur tailwind.config.js.
- Suppression des callbacks dans les vues de navigation latérale, prévient les bugs.
- Correction du template PRO.
- Nettoyage de la vue de connexion PRO.

## [3.0.0-beta.2] - 2024-02-21

- Ajout du paquet Formex pour gérer les formulaires à travers la plateforme. Formex est une bibliothèque de gestion
  de formulaires interne avec une API similaire à Formik, mais avec de meilleures performances,
  et beaucoup plus légère.
- Amélioration du processus d'intégration pour les nouveaux utilisateurs.
- Correction des problèmes d'importation de données pour les nouvelles collections.
- Ajustement de l'intégration SaaS pour une meilleure expérience utilisateur.
- Implémentation de la validation regexp pour les champs de saisie.
- Amélioration du feedback d'erreur de connexion.
- Extraction du contrôleur de navigation pour une meilleure gérabilité.
- Styles mis à jour pour la cohérence.
- Mise à jour de Vite et des dépendances pour les performances et la sécurité.
- Refactorisation des formulaires utilisateur et de rôle pour utiliser Formex.
- Correction des formulaires d'en-tête de tableau et des problèmes de l'éditeur de collection.
- Résolution des problèmes d'importation JSON incorrects.
- Suppression de Formik, améliorant la gestion des formulaires avec Formex.
- Petites corrections de l'imbrication HTML et du debounce.
- Correction du menu du conteneur de tableau et des bugs d'entrée multiligne.
- Migration de la configuration Tailwind vers la bibliothèque pour une gestion plus facile.
- Ajustement de la configuration Sentry pour le rapport d'erreurs.
- Correction pour la vue d'édition des sous-collections montrant vide.
- Correctifs pour les propriétés de bloc et de groupe dans l'éditeur enregistrant plusieurs entrées lors de l'édition d'une sous-propriété existante.

## [3.0.0-beta.1] - 2024-02-01

La première version bêta de Rebase v3.0.0.
Bien qu'encore en version bêta, nous considérons cette version suffisamment stable pour être utilisée en
production.

> Tous les changements liés à la version alpha de V2 sont actuellement regroupés dans ces documents :
> - [Nouveautés de la version 2.0.0](./what_is_new_v3)
> - [Guide de migration de la version 1.x à 2.0.0](./cloud/migrating_from_v2)

> Le journal des modifications pour les versions 1.0.0 et les versions précédentes peut être
> trouvé [ici](https://rebase.pro/docs/1.0.0/changelog)

---

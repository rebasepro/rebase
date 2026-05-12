---
title: Importation de données
sidebar_label: Importation de données
slug: fr/docs/features/data-import
description: Importez des données depuis des fichiers CSV, JSON et Excel dans vos collections avec mappage des champs et validation.
---

## Vue d'ensemble

Rebase prend en charge l'importation de données depuis :

- Fichiers **CSV**
- Fichiers **JSON**
- Fichiers **Excel** (`.xlsx`)

L'assistant d'importation gère le mappage des colonnes, la conversion des types de données et la validation.

## Comment importer

1. Ouvrez une collection dans le panneau d'administration
2. Cliquez sur le bouton **Importer** dans la barre d'outils
3. Sélectionnez ou glissez-déposez votre fichier
4. Mappez les colonnes du fichier aux propriétés de la collection
5. Prévisualisez les données et résolvez toute erreur de validation
6. Cliquez sur **Importer** pour enregistrer toutes les entités

![Interface d'importation de données](/img/data_import.png)

## Configuration

Activer/désactiver l'importation par collection :

```typescript
const productsCollection: EntityCollection = {
    slug: "products",
    // Import is enabled by default
    // To disable:
    // importable: false
    properties: { /* ... */ }
};
```

## Étapes suivantes

- **[Exportation de données](/docs/features/data-export)** — Exportez des données vers CSV/JSON

---

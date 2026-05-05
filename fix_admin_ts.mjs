import fs from 'fs';
import path from 'path';

function removeLucideImport(filePath, namesToRemove) {
    let content = fs.readFileSync(filePath, 'utf8');
    const regex = /import\s+{([^}]+)}\s+from\s+["']lucide-react["'];?/g;
    content = content.replace(regex, (match, importsStr) => {
        const imports = importsStr.split(',').map(s => s.trim()).filter(Boolean);
        const filtered = imports.filter(name => {
            const baseName = name.split(' as ')[0].trim();
            return !namesToRemove.includes(baseName);
        });
        if (filtered.length === 0) return '';
        return `import { ${filtered.join(', ')} } from "lucide-react";`;
    });
    fs.writeFileSync(filePath, content);
}

const dir = './packages/admin/src';

const menuFiles = [
    'collection_editor/ui/collection_editor/AICollectionGeneratorPopover.tsx',
    'collection_editor/ui/collection_editor/PropertyTree.tsx',
    'collection_editor/ui/HomePageEditorCollectionAction.tsx',
    'components/ArrayContainer.tsx',
    'components/DefaultAppBar.tsx',
    'components/EntityCollectionTable/EntityCollectionRowActions.tsx',
    'form/components/LocalChangesMenu.tsx',
    'form/field_bindings/KeyValueFieldBinding.tsx'
];
menuFiles.forEach(f => removeLucideImport(path.join(dir, f), ['Menu']));

const userFiles = [
    'components/admin/UsersView.tsx',
    'hooks/navigation/useResolvedViews.tsx',
    'preview/components/UserPreview.tsx'
];
userFiles.forEach(f => removeLucideImport(path.join(dir, f), ['User']));

const linkFiles = [
    'components/DefaultAppBar.tsx',
    'components/DefaultDrawer.tsx',
    'components/HomePage/SmallNavigationCard.tsx'
];
linkFiles.forEach(f => removeLucideImport(path.join(dir, f), ['Link']));

const listFiles = [
    'components/EntityCollectionView/EntityCollectionListView.tsx'
];
listFiles.forEach(f => removeLucideImport(path.join(dir, f), ['List']));


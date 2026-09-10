import React, { lazy, Suspense } from "react";

// Typed, so `lazy` needs no cast. `import.meta.glob` without a type parameter
// resolves each module to `unknown`, which is what `lazy(componentImporter as
// any)` was papering over — and `any` there also switched off the check that
// the module has a `default` export at all, which is the one thing `lazy`
// requires of it.
const modules = import.meta.glob<{ default: React.ComponentType }>("/src/content/docs/samples/components/**/*.tsx");

const DynamicComponentLoader = ({ componentName }: { componentName: string }) => {
    const componentPath = `/src/content/docs/samples/components/${componentName}.tsx`;

    const componentImporter = modules[componentPath];

    if (!componentImporter) {
        console.error(`Component not found at path: ${componentPath}`);
        return <div>Component {componentName} not found</div>;
    }

    const Component = lazy(componentImporter);

    return (
        <Suspense fallback={null}>
            <Component/>
        </Suspense>
    );
};

export default DynamicComponentLoader;


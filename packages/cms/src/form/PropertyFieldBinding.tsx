
import type { FieldProps as CoreFieldProps, AdminCollection } from "@rebasepro/cms-types";
import type { FieldProps, PropertyFieldBindingProps } from "../types/fields";
import type { Property } from "@rebasepro/types";
import type { RebasePlugin, PluginFieldBuilderParams, PropertyConfig } from "@rebasepro/cms-types";
import React, { ComponentType, ReactElement, Suspense, useCallback, useRef } from "react";
import { deepEqual as equal } from "fast-equals"

import { resolveComponentRef } from "@rebasepro/app";

import { FormexController, getIn, useFormexGetter, useFormexSelector } from "@rebasepro/forms";

;
import { ReadOnlyFieldBinding } from "./field_bindings/ReadOnlyFieldBinding";
import { resolveFormProperty } from "./resolve_form_properties";
import { useClearRestoreValue } from "./useClearRestoreValue";

import { isPropertyBuilder, resolveProperty } from "@rebasepro/common";
import { isDisabled, isHidden, isReadOnly } from "@rebasepro/app";
import { useAuthController, useCustomizationController, useRebaseContext, useSlot, useTranslation } from "@rebasepro/app";
import { Typography } from "@rebasepro/ui";
import { getFieldConfig, getFieldId } from "../components/field_configs";
import { ErrorBoundary } from "@rebasepro/ui";

/**
 * This component renders a form field creating the corresponding configuration
 * from a property. For example if bound to a string property, it will generate
 * a text field.
 *
 * You can use it when you are creating a custom field, and need to
 * render additional fields mapped to properties. This is useful if you
 * need to build a complex property mapping, like an array where each index
 * is a different property.
 *
 * Please note that if you build a custom field in a component, the
 * **validation** passed in the property will have no effect. You need to set
 * the validation in the `AdminCollection` definition.
 *
 * @param propertyKey You can use nested names such as `address.street` or `friends[2]`
 * @param property
 * @param context
 * @param includeDescription
 * @param underlyingValueHasChanged
 * @param disabled
 * @param tableMode
 * @param partOfArray
 * @param autoFocus
 * @group Form custom fields
 */
export const PropertyFieldBinding = React.memo(PropertyFieldBindingInternal,
    (a: PropertyFieldBindingProps<Record<string, unknown>>, b: PropertyFieldBindingProps<Record<string, unknown>>) =>
        sameProps(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>, DEEP_COMPARED_BINDING_PROPS)
) as typeof PropertyFieldBindingInternal;

/**
 * Props compared by value rather than identity: a property is re-resolved
 * (`dynamicProps`, enums, a parent's `mergeDeep`) into a new object on every
 * render of whatever holds it, and an error for an array or map is a new
 * sub-object of the errors map whenever anything is validated.
 */
const DEEP_COMPARED_BINDING_PROPS = new Set(["property"]);
const DEEP_COMPARED_FIELD_PROPS = new Set(["property", "error", "customProps"]);

function sameProps(a: Record<string, unknown>, b: Record<string, unknown>, deep: Set<string>): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        if (Object.is(a[key], b[key])) continue;
        if (deep.has(key) && equal(a[key], b[key])) continue;
        return false;
    }
    return true;
}

function PropertyFieldBindingInternal<M extends Record<string, unknown> = Record<string, unknown>>
({
     propertyKey,
     property,
     context,
     includeDescription,
     hideLabel,
     underlyingValueHasChanged,
     disabled: disabledProp,
     partOfArray,
     partOfBlock,
     minimalistView,
     autoFocus,
     index,
     size,
     onPropertyChange
 }: PropertyFieldBindingProps<M>): ReactElement<PropertyFieldBindingProps<M>> {

    const authController = useAuthController();
    const customizationController = useCustomizationController();
    // Decided on the property as declared: once resolved, a builder or a rule
    // no longer says it was one.
    const alwaysRender = shouldPropertyReRender(property as Property, customizationController.plugins, customizationController.propertyConfigs);

    // This field's own slice of the form, so a change anywhere else does not
    // reach it. Through the form's context — which `Field` read — every field
    // of a record form re-rendered on every keystroke anywhere in it: all 500
    // items of an array nobody was typing into. A field that reads the rest of
    // the form while rendering takes the whole controller, and with it every
    // change, as it always has.
    const selectSlice = useCallback((formex: FormexController<Record<string, unknown>>): FieldSlice => ({
        formex: alwaysRender ? formex : undefined,
        value: getIn(formex.values, propertyKey),
        error: getIn(formex.errors, propertyKey) as FieldSlice["error"],
        touched: getIn(formex.touched, propertyKey) as boolean | undefined,
        submitted: formex.submitCount > 0,
        isSubmitting: formex.isSubmitting
    }), [propertyKey, alwaysRender]);
    const slice = useFormexSelector(selectSlice, sameSlice);
    const getFormex = useFormexGetter<Record<string, unknown>>();
    // What the property is resolved against. Read, not subscribed to, for a
    // field that is not `alwaysRender`: nothing it declares reads the values.
    const values = (slice.formex ?? getFormex()).values;

    let Component: ComponentType<FieldProps<Property, any, any>> | undefined;
    // `dynamicProps` and `conditions` both, as the save judges it.
    const resolvedProperty = resolveFormProperty({
        propertyKey,
        property: property,
        values,
        path: context.path,
        entityId: context.entityId,
        propertyConfigs: customizationController.propertyConfigs,
        index,
        authController
    }) as Property | null;

    const readOnly = resolvedProperty ? isReadOnly(resolvedProperty) : true;
    const disabled = disabledProp || readOnly || (resolvedProperty ? isDisabled(resolvedProperty) : false) || context.disabled;

    if (resolvedProperty === null || isHidden(resolvedProperty)) {
        return <></>;
    } else if (readOnly) {
        Component = ReadOnlyFieldBinding;
    } else if (resolvedProperty.admin?.Field) {
        const resolved = resolveComponentRef(resolvedProperty.admin.Field);
        if (resolved) {
            Component = resolved as ComponentType<FieldProps<Property, any, any>>;
        }
    } else {
        const propertyConfig = getFieldConfig(resolvedProperty, customizationController.propertyConfigs);
        if (!propertyConfig) {
            throw new Error(`INTERNAL: Could not find field config for property ${propertyKey}`);
        }
        const configProperty = resolveProperty({
            propertyKey,
            property: propertyConfig.property as Property,
            values,
            path: context.path,
            entityId: context.entityId,
            propertyConfigs: customizationController.propertyConfigs,
            index,
            authController
        }) as Property | null;
        Component = resolveComponentRef(configProperty?.admin?.Field) as ComponentType<FieldProps<Property, any, any>> | undefined;
    }
    if (!Component) {
        console.warn(`No field component found for property ${propertyKey}`);
        console.warn("Property:", property);
        return (
            <div className={"w-full"}>
                {`Currently the field ${resolvedProperty.type} is not supported`}
            </div>
        );
    }

    const componentProps: ResolvedPropertyFieldBindingProps<M> = {
        propertyKey,
        property: resolvedProperty,
        includeDescription,
        hideLabel,
        underlyingValueHasChanged,
        context,
        disabled,
        partOfArray,
        partOfBlock,
        minimalistView,
        autoFocus,
        size,
        onPropertyChange
    };

    // Keyed on the path, as the `Field` it replaces was: an array item that
    // moves to another index is a new field there.
    return <FieldInternal
        key={propertyKey}
        Component={Component as ComponentType<FieldProps<Property, any, any>>}
        alwaysRender={alwaysRender}
        componentProps={componentProps}
        slice={slice}
        getFormex={getFormex}/>;

}

/**
 * What one field reads from the form. `formex` is set only for a field that
 * re-renders on every change (see {@link shouldPropertyReRender}).
 */
type FieldSlice = {
    formex: FormexController<Record<string, unknown>> | undefined;
    value: unknown;
    error: string | string[] | Record<string, unknown> | undefined;
    touched: boolean | undefined;
    submitted: boolean;
    isSubmitting: boolean;
};

function sameSlice(a: FieldSlice, b: FieldSlice): boolean {
    return a.formex === b.formex &&
        Object.is(a.value, b.value) &&
        a.touched === b.touched &&
        a.submitted === b.submitted &&
        a.isSubmitting === b.isSubmitting &&
        // An array's or a map's error is a sub-object of the errors map, new
        // whenever anything is validated.
        (Object.is(a.error, b.error) || equal(a.error, b.error));
}

type ResolvedPropertyFieldBindingProps<M extends Record<string, unknown> = Record<string, unknown>> =
    Omit<PropertyFieldBindingProps<M>, "property">
    & {
    property: Property
};

function FieldInternal<CustomProps, M extends Record<string, unknown>>
({
     Component,
     alwaysRender,
     componentProps: {
         propertyKey,
         property,
         includeDescription,
         hideLabel,
         underlyingValueHasChanged,
         partOfArray,
         partOfBlock,
         minimalistView,
         autoFocus,
         context,
         disabled,
         size,
         onPropertyChange
     },
     slice,
     getFormex
 }:
 {
     Component: ComponentType<FieldProps<Property, any, any>>,
     alwaysRender: boolean,
     componentProps: ResolvedPropertyFieldBindingProps<M>,
     slice: FieldSlice,
     getFormex: () => FormexController<Record<string, unknown>>
 }) {

    const { plugins } = useCustomizationController();
    const { t } = useTranslation();

    // This is the one component every form field goes through, which is why the
    // two field slots render here rather than in each field binding: a slot
    // honoured by the string field and not by the date field is worse than one
    // that never renders at all.
    const rebaseContext = useRebaseContext();
    const fieldSlotProps = React.useMemo(() => ({
        propertyKey,
        property,
        path: context.path ?? "",
        entityId: context.entityId,
        collection: context.collection,
        context: rebaseContext
    }), [propertyKey, property, context.path, context.entityId, context.collection, rebaseContext]);
    const beforeField = useSlot("entity.field.before", fieldSlotProps);
    const afterField = useSlot("entity.field.after", fieldSlotProps);

    const customFieldProps: unknown = property.admin?.customProps;
    const { value, error, touched, isSubmitting } = slice;

    const showError = Boolean(error &&
        (slice.submitted || property.validation?.unique) &&
        (!Array.isArray(error) || !!error.filter((e: unknown) => !!e).length));

    const WrappedComponent: ComponentType<FieldProps<Property, any, any>> | null = useWrappedComponent<unknown, any>({
        path: context.path,
        collection: context.collection,
        propertyKey: propertyKey,
        property: property,
        Component: Component as ComponentType<FieldProps<Property, unknown, M>>,
        plugins: plugins
    });
    const UsedComponent: ComponentType<FieldProps<Property, any, any>> = WrappedComponent ?? Component;

    // Read the controller when called, not when rendered: this component
    // re-renders with its own slice only, and the form moves on without it.
    const setValue = useCallback((value: unknown | null, shouldValidate?: boolean) => {
        const formex = getFormex();
        formex.setFieldTouched(propertyKey, true, false);
        formex.setFieldValue(propertyKey, value, shouldValidate);
    }, [getFormex, propertyKey]);

    const setFieldValue = useCallback((otherPropertyKey: string, value: unknown | null, shouldValidate?: boolean) => {
        const formex = getFormex();
        formex.setFieldTouched(propertyKey, true, false);
        formex.setFieldValue(otherPropertyKey, value, shouldValidate);
    }, [getFormex, propertyKey]);

    // `disabled: { clearOnDisabled: true }`, for every field: called here and
    // not in each binding, where six of them never did and a disabled relation
    // kept its value and saved it.
    useClearRestoreValue({ property: property as Property, value, setValue });

    // A parent that builds `onPropertyChange` inline (an array item's
    // `storeProps`, a map's wrapper) would otherwise hand every child a new
    // function on each of its renders, and every child would re-render for it.
    const onPropertyChangeRef = useRef(onPropertyChange);
    onPropertyChangeRef.current = onPropertyChange;
    const stableOnPropertyChange = useCallback((changed: Partial<Property>) => onPropertyChangeRef.current?.(changed), []);

    const cmsFieldProps: FieldProps<Property, CustomProps, M> = {
        propertyKey,
        value,
        setValue,
        setFieldValue,
        error: error as string | undefined,
        touched,
        showError,
        isSubmitting,
        includeDescription: includeDescription ?? true,
        hideLabel: hideLabel ?? false,
        property: property as Property,
        disabled: disabled ?? false,
        underlyingValueHasChanged: underlyingValueHasChanged ?? false,
        partOfArray: partOfArray ?? false,
        partOfBlock: partOfBlock ?? false,
        minimalistView: minimalistView ?? false,
        autoFocus: autoFocus ?? false,
        customProps: customFieldProps as CustomProps,
        context,
        size,
        onPropertyChange: onPropertyChange ? stableOnPropertyChange : undefined
    };

    return (
        <ErrorBoundary>
            {beforeField}

            <Suspense fallback={null}>
                <MemoisedField Component={UsedComponent}
                    alwaysRender={alwaysRender}
                    fieldProps={cmsFieldProps as FieldProps<Property, any, any>}/>
            </Suspense>

            {afterField}

            {underlyingValueHasChanged && !isSubmitting &&
                <Typography variant={"caption"} className={"ml-3.5"}>
                    {t("value_updated_elsewhere")}
                </Typography>}

        </ErrorBoundary>);

}

type MemoisedFieldProps = {
    Component: ComponentType<FieldProps<Property, any, any>>,
    alwaysRender: boolean,
    fieldProps: FieldProps<Property, any, any>
};

/**
 * The field's own component, rendered again only when its own slice of the
 * form changed — value, error, touched, the flags — or when the context it
 * draws the record from did (see `fieldContext` in `EntityForm`). Every field
 * of the form used to re-render on every keystroke anywhere in it.
 *
 * A field that may read *another* field's value while rendering cannot know
 * when to re-render from its own props, so those always do: see
 * {@link shouldPropertyReRender}.
 */
const MemoisedField = React.memo(
    function MemoisedField({ Component, fieldProps }: MemoisedFieldProps) {
        return <Component {...fieldProps}/>;
    },
    (prev: MemoisedFieldProps, next: MemoisedFieldProps) =>
        !next.alwaysRender &&
        prev.Component === next.Component &&
        sameProps(prev.fieldProps as unknown as Record<string, unknown>, next.fieldProps as unknown as Record<string, unknown>, DEEP_COMPARED_FIELD_PROPS)
);

/**
 * Whether a field has to re-render on every change to the form, because what
 * it draws can depend on values other than its own:
 * - a plugin `fieldBuilder` wraps it in a component of the plugin's;
 * - a custom `admin.Field` gets the whole form through `context`;
 * - `dynamicProps` and `conditions` are functions of every value;
 * - a storage path or file name given as a function is built from the values
 *   the binding holds;
 * - a custom `propertyConfig` whose property says any of the above, since the
 *   field is resolved through it.
 * Inside maps, arrays and blocks too, since their bindings render the children.
 */
const shouldPropertyReRender = (property: Property | undefined, plugins?: RebasePlugin[], propertyConfigs?: Record<string, PropertyConfig>): boolean => {
    if (!property) return false;
    if (plugins?.some((plugin) => plugin.fieldBuilder)) {
        return true;
    }
    const recurse = (child: unknown) => shouldPropertyReRender(child as Property, plugins, propertyConfigs);
    if (isPropertyBuilder(property) || property.conditions || property.admin?.Field) {
        return true;
    }
    const storage = "storage" in property ? property.storage : undefined;
    if (storage && (typeof storage.storagePath === "function" || typeof storage.fileName === "function")) {
        return true;
    }
    const configProperty = property.propertyConfig ? propertyConfigs?.[property.propertyConfig]?.property : undefined;
    if (configProperty && configProperty !== property && recurse(configProperty)) {
        return true;
    }
    if (property.type === "map" && property.properties) {
        return Object.values(property.properties).some(recurse);
    }
    if (property.type === "array") {
        if (Array.isArray(property.of)) {
            return property.of.some(recurse);
        }
        if (property.of && recurse(property.of)) {
            return true;
        }
        if (property.oneOf?.properties) {
            return Object.values(property.oneOf.properties).some(recurse);
        }
    }
    return false;
}

interface UseWrappedComponentParams<M extends Record<string, unknown> = Record<string, unknown>> {
    path?: string,
    collection?: AdminCollection<M>,
    propertyKey: string,
    property: Property,
    Component: ComponentType<FieldProps<Property, unknown, M>>,
    plugins?: RebasePlugin[]
}

function useWrappedComponent<T, M extends Record<string, unknown> = Record<string, unknown>>(
    {
        path,
        collection,
        propertyKey,
        property,
        Component,
        plugins
    }: UseWrappedComponentParams<M>
): ComponentType<FieldProps<Property, unknown, M>> | null {

    const wrapperRef = useRef<ComponentType<FieldProps<Property, unknown, M>> | null>((() => {
        let Wrapper: ComponentType<FieldProps<Property, unknown, M>> | null = null;
        if (plugins) {
            plugins.forEach((plugin) => {
                const fieldId = getFieldId(property);
                if (fieldId && plugin.fieldBuilder) {
                    const params: PluginFieldBuilderParams = {
                        fieldConfigId: fieldId,
                        propertyKey,
                        property,
                        Field: Component as ComponentType<CoreFieldProps<Property, unknown, Record<string, unknown>>>,
                        plugin,
                        path,
                        collection: collection as AdminCollection | undefined
                    };
                    const enabled = plugin.fieldBuilder.enabled?.(params);
                    if (enabled === undefined || enabled)
                        Wrapper = (plugin.fieldBuilder.wrap(params) as ComponentType<FieldProps<Property, unknown, M>> | null) ?? Wrapper;
                }
                if (!fieldId) {
                    console.warn("INTERNAL: Field id not found for property", property);
                }
            });
        }
        return Wrapper;
    })());

    return wrapperRef.current;
}

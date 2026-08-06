
import type { FieldProps as CoreFieldProps, AdminCollection } from "@rebasepro/admin-types";
import type { FieldProps, PropertyFieldBindingProps } from "../types/fields";
import type { Property } from "@rebasepro/types";
import type { RebasePlugin, PluginFieldBuilderParams } from "@rebasepro/admin-types";
import React, { ComponentType, ReactElement, Suspense, useCallback, useRef } from "react";
import { deepEqual as equal } from "fast-equals"

import { resolveComponentRef } from "@rebasepro/app";

import { Field, FormexFieldProps, getIn } from "@rebasepro/forms";

;
import { ReadOnlyFieldBinding } from "./field_bindings/ReadOnlyFieldBinding";

import { isPropertyBuilder, resolveProperty } from "@rebasepro/common";
import { isDisabled, isHidden, isReadOnly } from "@rebasepro/app";
import { useAuthController, useCustomizationController } from "@rebasepro/app";
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
export const PropertyFieldBinding = React.memo(PropertyFieldBindingInternal, (a: PropertyFieldBindingProps<Record<string, unknown>>, b: PropertyFieldBindingProps<Record<string, unknown>>) => {
    if (a.propertyKey !== b.propertyKey) {
        return false;
    }
    if (a.index !== b.index) {
        return false;
    }

    if (a.size !== b.size) {
        return false;
    }
    const aIsBuilder = isPropertyBuilder(a.property);
    const bIsBuilder = isPropertyBuilder(b.property);

    const baseCheck = (aIsBuilder === bIsBuilder || equal(a.property, b.property)) &&
        a.disabled === b.disabled;
    if (!baseCheck) {
        return false;
    }

    if (shouldPropertyReRender(b.property)) {
        return false;
    }

    return false;
}) as typeof PropertyFieldBindingInternal;

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

    return (
        <Field
            key={propertyKey}
            name={propertyKey}
        >
            {(fieldProps) => {

                let Component: ComponentType<FieldProps<Property, any, any>> | undefined;
                const resolvedProperty = resolveProperty({
                    propertyKey,
                    property: property,
                    values: fieldProps.form.values,
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
                        values: fieldProps.form.values,
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

                return <FieldInternal
                    Component={Component as ComponentType<FieldProps<Property, any, any>>}
                    componentProps={componentProps}
                    formexFieldProps={fieldProps as FormexFieldProps<unknown, Record<string, unknown>>}/>;
            }}
        </Field>
    );

}

type ResolvedPropertyFieldBindingProps<M extends Record<string, unknown> = Record<string, unknown>> =
    Omit<PropertyFieldBindingProps<M>, "property">
    & {
    property: Property
};

function FieldInternal<CustomProps, M extends Record<string, unknown>>
({
     Component,
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
     formexFieldProps
 }:
 {
     Component: ComponentType<FieldProps<Property, any, any>>,
     componentProps: ResolvedPropertyFieldBindingProps<M>,
     formexFieldProps: FormexFieldProps<unknown, Record<string, unknown>>
 }) {

    const { plugins } = useCustomizationController();

    const customFieldProps: unknown = property.admin?.customProps;
    const value = formexFieldProps.field.value;
    const error = getIn(formexFieldProps.form.errors, propertyKey) as string | string[] | undefined;
    const touched = getIn(formexFieldProps.form.touched, propertyKey) as boolean | undefined;

    const showError = Boolean(error &&
        (formexFieldProps.form.submitCount > 0 || property.validation?.unique) &&
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

    const isSubmitting = formexFieldProps.form.isSubmitting;

    const setValue = useCallback((value: unknown | null, shouldValidate?: boolean) => {
        formexFieldProps.form.setFieldTouched(propertyKey, true, false);
        formexFieldProps.form.setFieldValue(propertyKey, value, shouldValidate);
    }, []);

    const setFieldValue = useCallback((otherPropertyKey: string, value: unknown | null, shouldValidate?: boolean) => {
        formexFieldProps.form.setFieldTouched(propertyKey, true, false);
        formexFieldProps.form.setFieldValue(otherPropertyKey, value, shouldValidate);
    }, []);

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
        onPropertyChange
    };

    return (
        <ErrorBoundary>
            <Suspense fallback={null}>
                <UsedComponent {...cmsFieldProps}/>
            </Suspense>

            {underlyingValueHasChanged && !isSubmitting &&
                <Typography variant={"caption"} className={"ml-3.5"}>
                    This value has been updated elsewhere
                </Typography>}

        </ErrorBoundary>);

}

const shouldPropertyReRender = (property: Property, plugins?: RebasePlugin[]): boolean => {
    if (plugins?.some((plugin) => plugin.fieldBuilder)) {
        return true;
    }
    if (isPropertyBuilder(property)) {
        return true;
    }
    const defAProperty = property as Property;
    const rerenderThisProperty = Boolean(defAProperty.admin?.Field);
    if (defAProperty.type === "map" && defAProperty.properties) {
        return Boolean(rerenderThisProperty || Object.values(defAProperty.properties).some((childProperty) => shouldPropertyReRender(childProperty as Property, plugins)));
    } else {
        return Boolean(rerenderThisProperty);
    }
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
                        Field: Component as unknown as ComponentType<CoreFieldProps<Property, unknown, Record<string, unknown>>>,
                        plugin,
                        path,
                        collection: collection as AdminCollection | undefined
                    };
                    const enabled = plugin.fieldBuilder.enabled?.(params);
                    if (enabled === undefined || enabled)
                        Wrapper = (plugin.fieldBuilder.wrap(params) as unknown as ComponentType<FieldProps<Property, unknown, M>> | null) ?? Wrapper;
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

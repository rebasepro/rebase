import React, { useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FormexController } from "./types";


const FormexContext = React.createContext<FormexController<any> | null>(null);

/**
 * The controller a {@link Formex} provides, held where a component can read it
 * without subscribing to every change of it — which is what reading the
 * context does. See {@link useFormexSelector}.
 */
type FormexStore = {
    controller: FormexController<any>;
    readonly listeners: Set<() => void>;
    readonly subscribe: (listener: () => void) => () => void;
    readonly getController: () => FormexController<any>;
};

const FormexStoreContext = React.createContext<FormexStore | null>(null);

function createFormexStore(controller: FormexController<any>): FormexStore {
    const listeners = new Set<() => void>();
    const store: FormexStore = {
        controller,
        listeners,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getController: () => store.controller
    };
    return store;
}

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export const useFormex = <T = any>() => {
    const ctx = useContext(FormexContext);
    if (!ctx) throw new Error("useFormex must be used within a Formex provider");
    return ctx as FormexController<T>;
};

export const Formex = <T = any>({ value, children }: { value: FormexController<T>, children: React.ReactNode }) => {
    const [store] = useState(() => createFormexStore(value));
    // During render rather than in an effect: a component this same render
    // reaches — an array item mounting, a field whose props changed — has to
    // read the controller it is being rendered with, not the one before it.
    store.controller = value;
    useIsomorphicLayoutEffect(() => {
        // Before paint, so a field that subscribed to its own slice of the form
        // shows a change in the same frame as everything that read the context.
        for (const listener of Array.from(store.listeners)) listener();
    }, [store, value]);
    return <FormexContext.Provider value={value}>
        <FormexStoreContext.Provider value={store}>{children}</FormexStoreContext.Provider>
    </FormexContext.Provider>;
};

function useFormexStore(): FormexStore {
    const store = useContext(FormexStoreContext);
    if (!store) throw new Error("useFormex must be used within a Formex provider");
    return store;
}

/**
 * A slice of the enclosing form's controller. The caller re-renders when the
 * slice changes — judged by `isEqual` — and not on every change to the form,
 * which is what {@link useFormex} does.
 *
 * `selector` and `isEqual` are keys: pass stable functions (module-level, or
 * `useCallback`), or the slice is recomputed on every render.
 *
 * @internal Exported for `@rebasepro/cms`'s field bindings, so a keystroke in a
 * record form re-renders the field it went into and not every field. Not part
 * of the supported API; use {@link useFormex}.
 */
export function useFormexSelector<S, T = any>(
    selector: (controller: FormexController<T>) => S,
    isEqual: (a: S, b: S) => boolean = Object.is
): S {
    const store = useFormexStore();
    const getSelection = useMemo(() => {
        // Recomputed once per controller, and handed back unchanged while it is
        // equal to the last one: `useSyncExternalStore` re-renders on identity.
        let memo: { controller: FormexController<any>, selection: S } | undefined;
        return () => {
            const controller = store.controller;
            if (memo && memo.controller === controller) return memo.selection;
            const selection = selector(controller as FormexController<T>);
            memo = { controller, selection: memo && isEqual(memo.selection, selection) ? memo.selection : selection };
            return memo.selection;
        };
    }, [store, selector, isEqual]);
    return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}

/**
 * The enclosing form's controller as it is now, read without subscribing to
 * it: for event handlers and effects of a component that renders from
 * {@link useFormexSelector}. The function itself never changes.
 *
 * @internal Exported for `@rebasepro/cms`'s field bindings. Use
 * {@link useFormex}.
 */
export function useFormexGetter<T = any>(): () => FormexController<T> {
    return useFormexStore().getController as () => FormexController<T>;
}

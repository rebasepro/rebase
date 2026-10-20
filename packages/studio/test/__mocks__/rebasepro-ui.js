const React = require("react");

/** What a `Tabs` or a `RadioGroup` holds for its items: the value, and how to change it. */
const SelectionContext = React.createContext(null);

/**
 * The design system, stubbed. Entries below are here because a test asserts on
 * something specific about them — an aria-label, a change handler, a value that
 * is not a component at all.
 *
 * Everything else falls through the Proxy to a div that renders its children.
 * It used to be absent instead: a pane that reached for one more component than
 * this file listed failed to render at all, with React's "Element type is
 * invalid" and no clue which import it meant. Growing the list by hand, once
 * per test that touched a new pane, is what made this a maintenance surface
 * rather than a fixture.
 */
const explicit = {
    // Not a component: the real helper, so the console's global shortcuts
    // decide exactly as they do in the app.
    isKeyHandled: require("../../../ui/src/util/keys").isKeyHandled,
    Card: ({ children, ...props }) =>
        React.createElement("div", { "data-testid": "card",
...props }, children),
    cls: (...args) => args.filter(Boolean).join(" "),
    Container: ({ children, ...props }) =>
        React.createElement("div", { "data-testid": "container",
...props }, children),
    Typography: ({ children, ...props }) =>
        React.createElement("span", props, children),
    ExpandablePanel: ({ title, children }) => {
        // Derive an accessible name from the title element's text so that
        // `getByRole("region", { name })` keeps working.
        const label = title && title.props ? title.props.children : undefined;
        return React.createElement(
            "section",
            {
                "data-testid": "expandable-panel",
                "aria-label": typeof label === "string" ? label : undefined
            },
            React.createElement("div", null, title),
            children
        );
    },
    ArrowRightIcon: () => React.createElement("span", null, "→"),
    ArrowDownToLineIcon: () => React.createElement("span", null, "↓"),
    iconSize: { small: 16,
medium: 24,
large: 32 },
    defaultBorderMixin: "border-surface-200",

    // Rendered as the native equivalents so component tests can query and drive
    // them by role, rather than by reaching for internals that only exist here.
    //
    // `Button` and `IconButton` are here rather than in the Proxy fallback
    // because the fallback renders a `<div>` and drops every prop: a test could
    // see the label and never be able to press it, which is the difference
    // between asserting a component renders and asserting what it does.
    // Panels arrive as props, not as children, so the Proxy fallback rendered
    // an empty div — a pane laid out with this one had no DOM at all and every
    // query against it failed as if the component were broken.
    // The real table: the fallback div would drop the row's ref (the storage
    // list's lazy-metadata observer), its handlers and `th scope="col"`.
    ...require("../../../ui/src/components/Table"),
    ResizablePanels: ({ firstPanel, secondPanel }) =>
        React.createElement("div", { "data-testid": "resizable-panels" }, firstPanel, secondPanel),
    Button: ({ children, startIcon, endIcon, variant: _v, color: _c, size: _s, ...props }) =>
        React.createElement("button", { type: "button",
            ...props }, startIcon, children, endIcon),
    IconButton: ({ children, variant: _v, color: _c, size: _s, ...props }) =>
        React.createElement("button", { type: "button",
            ...props }, children),
    // Real elements, and `Tab` really is a `<button>` — Radix's `TabsTrigger`
    // is one, and the fallback's `<div>` hid a `<button>` nested inside a
    // `<button>` in the SQL console's tab strip for as long as it stood in.
    // Pressing one changes the value, as Radix's does, so a pane's other tabs
    // can be reached.
    Tabs: ({ children, value, onValueChange, variant: _var, className: _c, innerClassName: _i }) =>
        React.createElement(SelectionContext.Provider, { value: { value, onValueChange } },
            React.createElement("div", { role: "tablist" }, children)),
    Tab: function Tab({ children, value, className: _c, disabled }) {
        const selection = React.useContext(SelectionContext);
        return React.createElement("button", { type: "button",
            role: "tab",
            disabled,
            "aria-selected": selection?.value === value,
            onClick: () => selection?.onValueChange?.(value),
            "data-value": value }, children);
    },
    // Native radios, named by the `Label` whose `htmlFor` is their `id`.
    RadioGroup: ({ children, value, onValueChange, className: _c }) =>
        React.createElement(SelectionContext.Provider, { value: { value, onValueChange } },
            React.createElement("div", { role: "radiogroup" }, children)),
    RadioGroupItem: function RadioGroupItem({ id, value, disabled, className: _c }) {
        const selection = React.useContext(SelectionContext);
        return React.createElement("input", { type: "radio",
            id,
            value,
            disabled,
            checked: selection?.value === value,
            onChange: () => selection?.onValueChange?.(value) });
    },
    Select: ({ value, onValueChange, children, placeholder, ...props }) =>
        React.createElement(
            "select",
            {
                value,
                "aria-label": placeholder,
                onChange: (e) => onValueChange && onValueChange(e.target.value),
                ...props
            },
            children
        ),
    SelectItem: ({ value, children }) =>
        React.createElement("option", { value }, children),
    TextField: ({ value, onChange, ...props }) =>
        React.createElement("input", { value,
            onChange,
            ...props }),
    // `padding` and `size` are styling props the real component takes and a bare
    // `<input>` would render as invalid DOM attributes.
    Checkbox: ({ checked, onCheckedChange, padding: _padding, size: _size, ...props }) =>
        React.createElement("input", {
            type: "checkbox",
            checked: !!checked,
            onChange: (e) => onCheckedChange && onCheckedChange(e.target.checked),
            ...props
        }),
    Label: ({ children, htmlFor, ...props }) =>
        React.createElement("label", { htmlFor,
            ...props }, children),
    CircularProgressCenter: () => React.createElement("div", { "data-testid": "loading" }),
    // A segmented control: one pressable button per option.
    ToggleButtonGroup: ({ value, onValueChange, options }) =>
        React.createElement("div", { role: "group" }, options.map((option) =>
            React.createElement("button", {
                key: option.value,
                type: "button",
                "aria-pressed": value === option.value,
                onClick: () => onValueChange(option.value)
            }, option.label))),
    useIsDarkMode: () => false,
    // The real one adds retry and chunk-error handling around React.lazy. A test
    // that renders a Studio view is not exercising any of that, and the loader
    // is never called unless the route is visited.
    lazyChunk: (loader) => React.lazy(loader)
};

module.exports = new Proxy(explicit, {
    get: (target, key) => {
        if (key in target) return target[key];
        if (key === "__esModule") return true;
        // A symbol reaches here when something introspects the module (jest's
        // own equality checks, `util.inspect`). Answering with a component
        // would be a lie.
        if (typeof key !== "string") return undefined;
        // Only a component may be stubbed. A helper or a hook (lowercase) that
        // fell through used to come back as a component too — a truthy
        // function — so `if (isKeyHandled(e)) return` returned on every key and
        // the SQL console's Cmd+Enter did nothing in these tests, silently.
        // Undefined makes the missing entry a "not a function" error that
        // names it; add it to `explicit` above.
        if (!/^[A-Z]/.test(key)) return undefined;
        const Stub = ({ children }) => React.createElement("div", null, children);
        Stub.displayName = key;
        return Stub;
    },
    has: () => true
});

const React = require("react");

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
    Tabs: ({ children, value: _v, onValueChange: _o, variant: _var, className: _c, innerClassName: _i }) =>
        React.createElement("div", { role: "tablist" }, children),
    Tab: ({ children, value, className: _c, disabled }) =>
        React.createElement("button", { type: "button",
            role: "tab",
            disabled,
            "data-value": value }, children),
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
        const Stub = ({ children }) => React.createElement("div", null, children);
        Stub.displayName = key;
        return Stub;
    },
    has: () => true
});

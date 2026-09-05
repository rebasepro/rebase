const React = require("react");

module.exports = {
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

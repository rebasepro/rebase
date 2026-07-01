const React = require("react");

module.exports = {
    Card: ({ children, ...props }) =>
        React.createElement("div", { "data-testid": "card", ...props }, children),
    cls: (...args) => args.filter(Boolean).join(" "),
    Container: ({ children, ...props }) =>
        React.createElement("div", { "data-testid": "container", ...props }, children),
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
    iconSize: { small: 16, medium: 24, large: 32 }
};

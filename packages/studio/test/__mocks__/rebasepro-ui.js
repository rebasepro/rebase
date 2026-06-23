const React = require("react");

module.exports = {
    Card: ({ children, ...props }) =>
        React.createElement("div", { "data-testid": "card", ...props }, children),
    cls: (...args) => args.filter(Boolean).join(" "),
    Container: ({ children, ...props }) =>
        React.createElement("div", { "data-testid": "container", ...props }, children),
    Typography: ({ children, ...props }) =>
        React.createElement("span", props, children),
    ArrowRightIcon: () => React.createElement("span", null, "→"),
    iconSize: { small: 16, medium: 24, large: 32 }
};

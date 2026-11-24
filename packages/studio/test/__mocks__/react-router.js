const React = require("react");

/**
 * react-router, stubbed for every suite: its ESM build does not load under
 * this jest setup. The query string is real state, so a view that keeps its
 * selection in `?table=` reads back what it wrote; navigation is recorded on
 * `navigated` instead of happening.
 *
 * A suite that needs something specific still says so with its own
 * `jest.mock("react-router", …)`, which wins over this file.
 */
const navigated = [];

function useSearchParams() {
    const [params, setParams] = React.useState(() => new URLSearchParams());
    const set = React.useCallback((next) => {
        setParams((previous) => {
            const value = typeof next === "function" ? next(previous) : next;
            return value === previous ? previous : new URLSearchParams(value);
        });
    }, []);
    return [params, set];
}

function useNavigate() {
    return React.useCallback((to) => {
        navigated.push(to);
    }, []);
}

module.exports = {
    __esModule: true,
    navigated,
    useSearchParams,
    useNavigate,
    useLocation: () => ({ pathname: "/", search: "", hash: "", state: null, key: "default" }),
    useParams: () => ({}),
    Navigate: () => null,
    Link: ({ to, children, ...props }) => React.createElement("a", { href: String(to), ...props }, children),
    MemoryRouter: ({ children }) => children,
    Routes: ({ children }) => children,
    Route: () => null
};

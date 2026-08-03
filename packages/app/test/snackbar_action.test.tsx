import React from "react";
import { render, act } from "@testing-library/react";
import { SnackbarProvider } from "../src/contexts/SnackbarProvider";
import { useSnackbarController } from "../src/hooks/useSnackbarController";

/**
 * The real provider renders, so what is on screen is what a browser would
 * show — but `enqueueSnackbar`/`closeSnackbar` are wrapped so the keys the
 * controller mints and closes can be asserted directly. Both matter and
 * neither is observable from the DOM: two snackbars are collapsed into one by
 * `preventDuplicate` unless their keys differ, and notistack unmounts a closed
 * snackbar on a CSS `transitionend` that jsdom never fires.
 */
const enqueuedKeys: unknown[] = [];
const closedKeys: unknown[] = [];

jest.mock("notistack", () => {
    const actual = jest.requireActual("notistack");
    return {
        ...actual,
        useSnackbar: () => {
            const { enqueueSnackbar, closeSnackbar } = actual.useSnackbar();
            return {
                enqueueSnackbar: (options: { key?: unknown }) => {
                    const key = enqueueSnackbar(options);
                    enqueuedKeys.push(options?.key ?? key);
                    return key;
                },
                closeSnackbar: (key?: unknown) => {
                    closedKeys.push(key);
                    return closeSnackbar(key as never);
                }
            };
        }
    };
});

beforeEach(() => {
    enqueuedKeys.length = 0;
    closedKeys.length = 0;
});

/**
 * The snackbar's action slot.
 *
 * Undo-after-mutation is the interaction a triage or queue screen is built
 * around, and the window in which undo means anything is the window the
 * snackbar is up. The controller wrapped notistack, which supports actions
 * natively, and did not pass one through — so every such view had to build its
 * own undo strip elsewhere on the page.
 */
describe("useSnackbarController — action slot", () => {

    /** Render a component that opens one snackbar and hand back the DOM. */
    const openSnackbar = async (props: Parameters<ReturnType<typeof useSnackbarController>["open"]>[0]) => {
        const Opener = () => {
            const snackbar = useSnackbarController();
            React.useEffect(() => { snackbar.open(props); }, []);
            return null;
        };
        let result!: ReturnType<typeof render>;
        await act(async () => {
            result = render(<SnackbarProvider><Opener/></SnackbarProvider>);
        });
        return result;
    };

    it("renders the action's label as a button", async () => {
        const { findByText } = await openSnackbar({
            type: "success",
            message: "Application rejected",
            action: { label: "Undo", onClick: jest.fn() }
        });

        const button = await findByText("Undo");
        expect(button.closest("button")).not.toBeNull();
    });

    it("runs onClick and closes that snackbar", async () => {
        const onClick = jest.fn();
        const { findByText } = await openSnackbar({
            type: "success",
            message: "Application rejected",
            action: { label: "Undo", onClick }
        });

        const button = await findByText("Undo");
        await act(async () => { button.closest("button")!.click(); });

        expect(onClick).toHaveBeenCalledTimes(1);
        // Closed by key, not globally: a second click cannot undo the same
        // thing twice, and the other snackbars on screen stay up.
        //
        // The call is the assertion rather than the node's disappearance —
        // notistack unmounts on the exit transition's `transitionend`, which
        // jsdom never fires, so the element lingers here and would not in a
        // browser.
        expect(closedKeys).toEqual([enqueuedKeys[0]]);
    });

    it("shows two identical messages when each carries an action", async () => {
        // The provider sets `preventDuplicate`, which is right for a bare
        // confirmation and wrong here: rejecting two applications in a row
        // produces the same text twice, and collapsing them would leave the
        // second rejection with no way back.
        const Opener = () => {
            const snackbar = useSnackbarController();
            React.useEffect(() => {
                snackbar.open({ type: "success", message: "Rejected", action: { label: "Undo", onClick: jest.fn() } });
                snackbar.open({ type: "success", message: "Rejected", action: { label: "Undo", onClick: jest.fn() } });
            }, []);
            return null;
        };

        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<SnackbarProvider><Opener/></SnackbarProvider>);
        });

        expect(await view.findAllByText("Undo")).toHaveLength(2);
        // Distinct keys are what makes that true — `preventDuplicate` compares
        // them, so two snackbars sharing one would collapse into a single
        // "Rejected" with a single Undo.
        expect(new Set(enqueuedKeys).size).toBe(2);
    });

    it("renders no button when no action is given", async () => {
        const { queryByRole, findByText } = await openSnackbar({
            type: "info",
            message: "Saved"
        });

        await findByText("Saved");
        expect(queryByRole("button")).toBeNull();
    });
});

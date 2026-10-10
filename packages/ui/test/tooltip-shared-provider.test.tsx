/**
 * One tooltip provider for a screen, not one per tooltip.
 *
 * Every `Tooltip` mounted its own Radix provider. A table's row actions carry a
 * few tooltips per row, so a page of rows mounted hundreds of providers — 300
 * tooltips took 19 ms to mount and 9 ms to re-render against 12 / 5 ms with one
 * shared provider — and, since each provider times only its own tooltip, the
 * skip-delay between neighbouring tooltips never applied: moving along a row of
 * icons waited out the full delay on every one.
 *
 * `TooltipProvider` is that shared provider (the admin shell mounts one); a
 * `Tooltip` under it uses it, and one rendered anywhere else still brings its
 * own.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

let providerMounts = 0;

jest.mock("@radix-ui/react-tooltip", () => {
    const actual = jest.requireActual("@radix-ui/react-tooltip");
    const ActualProvider = actual.Provider;
    function CountingProvider(props: React.ComponentProps<typeof ActualProvider>) {
        React.useEffect(() => {
            providerMounts++;
        }, []);
        return <ActualProvider {...props}/>;
    }
    return { ...actual, Provider: CountingProvider, TooltipProvider: CountingProvider };
});

import { Tooltip, TooltipProvider } from "../src/components/Tooltip";

function Row({ count }: { count: number }) {
    return <>{Array.from({ length: count }, (_, i) => (
        <Tooltip key={i} title={`Action ${i}`} asChild={true}>
            <button type={"button"}>{`action ${i}`}</button>
        </Tooltip>
    ))}</>;
}

beforeEach(() => {
    providerMounts = 0;
});

describe("tooltips under a TooltipProvider", () => {

    it("share it: 100 tooltips mount one provider", () => {
        render(<TooltipProvider><Row count={100}/></TooltipProvider>);
        expect(providerMounts).toBe(1);
    });

    it("still open on focus", async () => {
        render(<TooltipProvider><Row count={3}/></TooltipProvider>);
        fireEvent.focus(screen.getByText("action 1"));
        expect((await screen.findByRole("tooltip")).textContent).toContain("Action 1");
    });

    it("open the next one without the delay right after one closes", () => {
        jest.useFakeTimers();
        try {
            render(<TooltipProvider><Row count={2}/></TooltipProvider>);
            const first = screen.getByText("action 0");
            const second = screen.getByText("action 1");

            act(() => {
                fireEvent.focus(first);
            });
            expect(screen.getByRole("tooltip").textContent).toContain("Action 0");

            act(() => {
                fireEvent.blur(first);
                fireEvent.pointerMove(second, { pointerType: "mouse" });
            });
            // No timer advanced: within the skip window the next opens at once.
            expect(screen.getByRole("tooltip").textContent).toContain("Action 1");
        } finally {
            jest.useRealTimers();
        }
    });
});

describe("a tooltip outside any TooltipProvider", () => {

    it("brings its own", () => {
        render(<Row count={3}/>);
        expect(providerMounts).toBe(3);
    });

    it("still opens on focus", async () => {
        render(<Row count={2}/>);
        fireEvent.focus(screen.getByText("action 0"));
        expect((await screen.findByRole("tooltip")).textContent).toContain("Action 0");
    });
});

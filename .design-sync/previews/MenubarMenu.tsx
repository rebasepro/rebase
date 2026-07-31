import React from "react";
import {
    Menubar,
    MenubarMenu,
    MenubarTrigger,
    MenubarPortal,
    MenubarContent,
    MenubarItem,
    MenubarSeparator,
    MenubarShortcut
} from "@rebasepro/ui";

// MenubarMenu groups one trigger with its content — it never renders
// visibly different itself, so the two useful states are "menu closed"
// (just the trigger, in a bar of menus) and "menu open" (its content
// visible). Radix only opens a menu from a real pointer event on the
// trigger, so we dispatch one on mount to force the open state for the
// static capture.
function useOpenMenu(ref: React.RefObject<HTMLDivElement>, triggerIndex: number) {
    React.useEffect(() => {
        const trigger = ref.current?.querySelectorAll('button[aria-haspopup="menu"]')[triggerIndex] as HTMLElement | undefined;
        trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    }, [ref, triggerIndex]);
}

export const Closed = () => (
    <div className="p-4">
        <Menubar>
            <MenubarMenu>
                <MenubarTrigger>File</MenubarTrigger>
            </MenubarMenu>
            <MenubarMenu>
                <MenubarTrigger>Edit</MenubarTrigger>
            </MenubarMenu>
            <MenubarMenu>
                <MenubarTrigger>View</MenubarTrigger>
            </MenubarMenu>
        </Menubar>
    </div>
);

export const Open = () => {
    const ref = React.useRef<HTMLDivElement>(null);
    useOpenMenu(ref, 0);
    return (
        <div ref={ref} className="p-4 h-[280px]">
            <Menubar>
                <MenubarMenu>
                    <MenubarTrigger>File</MenubarTrigger>
                    <MenubarPortal>
                        <MenubarContent>
                            <MenubarItem>New table<MenubarShortcut>⌘N</MenubarShortcut></MenubarItem>
                            <MenubarItem>Save<MenubarShortcut>⌘S</MenubarShortcut></MenubarItem>
                            <MenubarSeparator/>
                            <MenubarItem disabled>Close project</MenubarItem>
                        </MenubarContent>
                    </MenubarPortal>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>Edit</MenubarTrigger>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>View</MenubarTrigger>
                </MenubarMenu>
            </Menubar>
        </div>
    );
};

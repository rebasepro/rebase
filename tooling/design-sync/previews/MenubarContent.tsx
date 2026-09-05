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

function useOpenMenu(ref: React.RefObject<HTMLDivElement | null>, triggerIndex: number) {
    React.useEffect(() => {
        const trigger = ref.current?.querySelectorAll('button[aria-haspopup="menu"]')[triggerIndex] as HTMLElement | undefined;
        trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    }, [ref, triggerIndex]);
}

export const Basic = () => {
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
                            <MenubarItem>New SQL query<MenubarShortcut>⌘⇧N</MenubarShortcut></MenubarItem>
                            <MenubarItem>Save<MenubarShortcut>⌘S</MenubarShortcut></MenubarItem>
                            <MenubarSeparator/>
                            <MenubarItem disabled>Close project</MenubarItem>
                        </MenubarContent>
                    </MenubarPortal>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>Edit</MenubarTrigger>
                </MenubarMenu>
            </Menubar>
        </div>
    );
};

// align="end" — content hangs from the right edge of its trigger instead
// of the left, useful for a trigger near the bar's right edge.
export const AlignEnd = () => {
    const ref = React.useRef<HTMLDivElement>(null);
    useOpenMenu(ref, 1);
    return (
        <div ref={ref} className="p-4 h-[260px]">
            <Menubar className="w-[320px] justify-end">
                <MenubarMenu>
                    <MenubarTrigger>File</MenubarTrigger>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>Help</MenubarTrigger>
                    <MenubarPortal>
                        <MenubarContent align="end">
                            <MenubarItem>Documentation</MenubarItem>
                            <MenubarItem>Keyboard shortcuts<MenubarShortcut>⌘/</MenubarShortcut></MenubarItem>
                            <MenubarSeparator/>
                            <MenubarItem>About RebasePro</MenubarItem>
                        </MenubarContent>
                    </MenubarPortal>
                </MenubarMenu>
            </Menubar>
        </div>
    );
};

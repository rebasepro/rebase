import React from "react";
import {
    Menubar,
    MenubarMenu,
    MenubarTrigger,
    MenubarPortal,
    MenubarContent,
    MenubarItem,
    MenubarSeparator,
    MenubarShortcut,
    MenubarSub,
    MenubarSubTrigger,
    MenubarSubContent,
    MenubarSubTriggerIndicator
} from "@rebasepro/ui";

// Opens the parent menu on mount (a real pointerdown, what Radix's trigger
// itself listens for), then a tick later fires a real click on the
// submenu's SubTrigger (what Radix's MenuSubTrigger listens for to open) —
// once it has actually mounted into the now-open MenubarContent.
function useOpenMenuWithSub(ref: React.RefObject<HTMLDivElement | null>, triggerIndex: number) {
    React.useEffect(() => {
        const trigger = ref.current?.querySelectorAll('button[aria-haspopup="menu"]')[triggerIndex] as HTMLElement | undefined;
        trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
        const t = setTimeout(() => {
            const subTrigger = document.querySelector('[data-radix-menubar-subtrigger]') as HTMLElement | null;
            subTrigger?.click();
        }, 60);
        return () => clearTimeout(t);
    }, [ref, triggerIndex]);
}

// A nested Export submenu off the File menu — the console's own use for a
// two-level menu (SQL vs CSV export).
export const Basic = () => {
    const ref = React.useRef<HTMLDivElement>(null);
    useOpenMenuWithSub(ref, 0);
    return (
        <div ref={ref} className="p-4 h-[400px]">
            <Menubar>
                <MenubarMenu>
                    <MenubarTrigger>File</MenubarTrigger>
                    <MenubarPortal>
                        <MenubarContent>
                            <MenubarItem>New table<MenubarShortcut>⌘N</MenubarShortcut></MenubarItem>
                            <MenubarItem>Save<MenubarShortcut>⌘S</MenubarShortcut></MenubarItem>
                            <MenubarSeparator/>
                            <MenubarSub>
                                <MenubarSubTrigger>
                                    Export
                                    <MenubarSubTriggerIndicator/>
                                </MenubarSubTrigger>
                                <MenubarPortal>
                                    <MenubarSubContent>
                                        <MenubarItem>Export as SQL</MenubarItem>
                                        <MenubarItem>Export as CSV</MenubarItem>
                                    </MenubarSubContent>
                                </MenubarPortal>
                            </MenubarSub>
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

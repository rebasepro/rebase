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

function useOpenMenuWithSub(ref: React.RefObject<HTMLDivElement>, triggerIndex: number) {
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

// The submenu's own popup surface — same paper/shadow as MenubarContent,
// anchored to the right of its SubTrigger.
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
                                        <MenubarSeparator/>
                                        <MenubarItem disabled>Export as Parquet</MenubarItem>
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

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

function useOpenMenu(ref: React.RefObject<HTMLDivElement>, triggerIndex: number) {
    React.useEffect(() => {
        const trigger = ref.current?.querySelectorAll('button[aria-haspopup="menu"]')[triggerIndex] as HTMLElement | undefined;
        trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    }, [ref, triggerIndex]);
}

// The chevron glyph itself — a fixed `ChevronRightIcon`, rendered at the
// end of a SubTrigger row to hint the row expands sideways.
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
                            <MenubarItem>Save<MenubarShortcut>⌘S</MenubarShortcut></MenubarItem>
                            <MenubarSeparator/>
                            <MenubarSub>
                                <MenubarSubTrigger>
                                    Export
                                    <MenubarSubTriggerIndicator/>
                                </MenubarSubTrigger>
                            </MenubarSub>
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

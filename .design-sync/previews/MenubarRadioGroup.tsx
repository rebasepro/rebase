import React from "react";
import {
    Menubar,
    MenubarMenu,
    MenubarTrigger,
    MenubarPortal,
    MenubarContent,
    MenubarRadioGroup,
    MenubarRadioItem,
    MenubarItemIndicator,
    MenubarSeparator,
    MenubarItem
} from "@rebasepro/ui";

function useOpenMenu(ref: React.RefObject<HTMLDivElement>, triggerIndex: number) {
    React.useEffect(() => {
        const trigger = ref.current?.querySelectorAll('button[aria-haspopup="menu"]')[triggerIndex] as HTMLElement | undefined;
        trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    }, [ref, triggerIndex]);
}

// A single-select group inside the View menu — the console's theme picker.
export const Basic = () => {
    const ref = React.useRef<HTMLDivElement>(null);
    useOpenMenu(ref, 0);
    return (
        <div ref={ref} className="p-4 h-[300px]">
            <Menubar>
                <MenubarMenu>
                    <MenubarTrigger>View</MenubarTrigger>
                    <MenubarPortal>
                        <MenubarContent>
                            <MenubarItem disabled>Theme</MenubarItem>
                            <MenubarSeparator/>
                            <MenubarRadioGroup value="dark">
                                <MenubarRadioItem value="light">
                                    <MenubarItemIndicator/>
                                    Light
                                </MenubarRadioItem>
                                <MenubarRadioItem value="dark">
                                    <MenubarItemIndicator/>
                                    Dark
                                </MenubarRadioItem>
                                <MenubarRadioItem value="system">
                                    <MenubarItemIndicator/>
                                    System
                                </MenubarRadioItem>
                            </MenubarRadioGroup>
                        </MenubarContent>
                    </MenubarPortal>
                </MenubarMenu>
            </Menubar>
        </div>
    );
};

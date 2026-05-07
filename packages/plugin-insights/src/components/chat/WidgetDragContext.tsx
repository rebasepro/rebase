import React, { createContext, useContext } from "react";

type WidgetDragContextProps = {
    onWidgetDragStart?: (config: any) => void;
    onWidgetDragEnd?: () => void;
};

const WidgetDragContext = createContext<WidgetDragContextProps>({});

export const useWidgetDrag = () => useContext(WidgetDragContext);

export const WidgetDragProvider: React.FC<{
    children: React.ReactNode,
    onWidgetDragStart?: (config: any) => void,
    onWidgetDragEnd?: () => void
}> = ({ children, onWidgetDragStart, onWidgetDragEnd }) => {
    return <WidgetDragContext.Provider value={{ onWidgetDragStart, onWidgetDragEnd }}>{children}</WidgetDragContext.Provider>;
};

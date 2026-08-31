import React from "react";
import { Scene } from "../components/Scene";
import { Map as SchemaMap } from "../reel/Map";

/**
 * 09 · THE SCHEMA — 260 frames.
 *
 * Follows Studio, which names four tools in a column — SQL editor, schema
 * visualiser, RLS editor, logs — and shows one screenshot for all four. This is
 * the second of them, at full size, doing the thing it is for.
 *
 * It is also the only scene in the film built from nodes and edges, which is
 * most of why it earns the room.
 */
export const S08c_Map: React.FC = () => (
    <Scene>
        <SchemaMap />
    </Scene>
);

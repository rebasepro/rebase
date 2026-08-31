import React from "react";
import { Scene } from "../components/Scene";
import { Routes } from "../reel/Routes";

/** 04 · FORTY ENDPOINTS — 270 frames. Follows "there is no second data model"
 *  and turns it into a quantity: the pivot scene names what one definition
 *  produces, and this is the REST half of that list, counted. */
export const S04b_Routes: React.FC = () => (
    <Scene>
        <Routes />
    </Scene>
);

import React from "react";
import { Scene } from "../components/Scene";
import { Matrix } from "../reel/Matrix";

/** 12 · ACCESS IS NOT A SWITCH — 240 frames. Between the claim and its
 *  demonstration: the claim says authorization lives in the database, this says
 *  how much of it there is, and the next scene shows it deciding. */
export const S12_Matrix: React.FC = () => (
    <Scene>
        <Matrix />
    </Scene>
);

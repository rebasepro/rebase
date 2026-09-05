import React from "react";
import { AbsoluteFill } from "remotion";
import { Scene } from "../components/Scene";
import { BentoTiles } from "../bento/Bento";
import { OVERLAP } from "../transitions";

/**
 * EVERY VIEW — 240 frames. The only scene with no chapter and no headline.
 *
 * It follows the panel, and it is the answer to "yes, but how much IS there".
 * Five and six make the offer one layer at a time and each can only hold a
 * single screen while it does; this holds seven, each doing something only it
 * does — search, filter a table, switch a view from cards to a table, read a
 * form and its relations, drag a card between board columns, select rows, open
 * a record out of a list.
 *
 * No title on purpose. A headline would take the top third and shrink every
 * tile to pay for it, and there is nothing to say here that seven live views
 * do not already say. The voiceover carries the line instead.
 *
 * The tiles arrive with a fraction of the travel they use standalone: the
 * scene already enters on the film's own transition, and two motions over the
 * same frames fight rather than compound.
 */

export const S07b_Everything: React.FC = () => (
    <Scene>
        <AbsoluteFill>
            {/* The scene is mounted OVERLAP frames longer than its nominal 240
                so it can cross with the panel before it (Intro.tsx). The tiles'
                own Sequences have to cover that too, or seven clips unmount
                on the first frame of the exit and the grid slides out as
                seven empty boxes. */}
            <BentoTiles duration={240 + OVERLAP} travel={110} lift={30} />
        </AbsoluteFill>
    </Scene>
);

import React from "react";
import { Scene } from "../components/Scene";
import { TwoUsers } from "../reel/TwoUsers";

/**
 * 08 · THE SAME QUERY, TWICE — 240 frames.
 *
 * Sits between the claim and the proof, and the order is the argument: the
 * claim states that authorization is in the database, this shows it happening,
 * and rls-check then verifies it on a database the viewer chooses. Assertion,
 * demonstration, independent check.
 *
 * It is placed AFTER the claim rather than instead of it because the claim
 * scene carries the policy — the thing that makes this behaviour explicable.
 * Shown first, this would be a magic trick.
 */
export const S08b_TwoUsers: React.FC = () => (
    <Scene>
        <TwoUsers />
    </Scene>
);

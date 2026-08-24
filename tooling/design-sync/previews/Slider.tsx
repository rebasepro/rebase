import React from "react";
import { Slider } from "@rebasepro/ui";

export const Basic = () => (
    <div className="w-[320px] p-6">
        <Slider defaultValue={[60]} min={0} max={100} step={1}/>
    </div>
);

export const Range = () => (
    <div className="w-[320px] p-6">
        <Slider defaultValue={[25, 75]} min={0} max={100} step={1}/>
    </div>
);

export const Sizes = () => (
    <div className="flex flex-col gap-8 w-[320px] p-6">
        <Slider size="regular" defaultValue={[40]} min={0} max={100}/>
        <Slider size="small" defaultValue={[40]} min={0} max={100}/>
    </div>
);

export const Disabled = () => (
    <div className="w-[320px] p-6">
        <Slider disabled defaultValue={[30]} min={0} max={100}/>
    </div>
);

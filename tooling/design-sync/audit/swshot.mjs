import { chromium } from "playwright";
import { fileURLToPath } from "url";
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:520,height:200}, deviceScaleFactor:3 });
await p.goto(new URL("switch.html", import.meta.url).href);
await p.waitForTimeout(900);
const r = await p.evaluate(()=>window.__sw());
r.forEach(x=>console.log(
  x.k.padEnd(18), "track", x.track.padEnd(9), "knob", x.knob.padEnd(9),
  "gaps L/R/T", (x.leftGap+"/"+x.rightGap+"/"+x.topGap).padEnd(10),
  (x.leftGap===x.topGap && (x.k.endsWith("off")? x.leftGap>0 : x.rightGap>0)) ? "ok" : "CHECK",
  "| transition:", x.transition));
await p.screenshot({ path:fileURLToPath(new URL("switch.png", import.meta.url)), clip:{x:0,y:0,width:460,height:150} });
await b.close();

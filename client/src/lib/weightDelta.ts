/** A change is visible only at the same precision used for its label (percentage points). */
export function weightDelta(delta:number){
 const points=delta*100,rounded=Math.round(Math.abs(points)*100)/100;
 const direction=!Number.isFinite(points)||rounded===0?0:points>0?1:-1;
 return {direction,label:Number.isFinite(points)?`${direction>0?'+':direction<0?'-':''}${rounded.toFixed(2)} pts`:'—'};
}

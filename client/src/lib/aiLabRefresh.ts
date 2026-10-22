/** Les nouveaux relevés précèdent la qualification, puis la relecture des vues. */
export async function refreshAILabInOrder(operations:{stations:()=>Promise<unknown>;references:()=>Promise<unknown>;readers:Array<()=>Promise<unknown>>}){
 // Un flux indisponible ne doit pas empêcher la relecture des archives conservées.
 await Promise.allSettled([Promise.resolve().then(operations.stations)]);
 await Promise.allSettled([Promise.resolve().then(operations.references)]);
 return Promise.allSettled(operations.readers.map(read=>Promise.resolve().then(read)));
}

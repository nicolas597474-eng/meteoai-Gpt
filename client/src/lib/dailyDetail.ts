const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const capitalise=(value:string)=>value.charAt(0).toLocaleUpperCase('fr-FR')+value.slice(1);
function civilDate(value:string):Date|null {
  if(!datePattern.test(value))return null;
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date:null;
}
export function dailyDisplayDate(value:string,now=Date.now()) {
  const date=civilDate(value);
  if(!date)return {line1:'—',line2:'Date indisponible'};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  return {line1:value===today?'Auj.':capitalise(new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'short'}).format(date)),line2:new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'numeric',month:'short'}).format(date)};
}
export function dailyDetailDate(value:string) {
  const date=civilDate(value);
  return date?capitalise(new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(date)):'Date indisponible';
}
export function selectedDailyIndex(days:readonly {date:string}[],selected:string|null):number|null {
  if(selected===null)return null;
  const index=days.findIndex(day=>day.date===selected);
  return index<0?null:index;
}

/** Un ancien cache peut commencer hier : le premier élément n’est pas forcément aujourd’hui. */
export function dailyForecastForToday<T extends {date:string}>(days:readonly T[],now=Date.now()):T|null {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  return days.find(day=>day.date===today)??null;
}

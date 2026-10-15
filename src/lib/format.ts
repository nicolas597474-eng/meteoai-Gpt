export const number = (n: number | null | undefined, digits = 0) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const hourFormat=new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const shortHourFormat=new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric' });
const fullDateFormat=new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });
export const parisHourFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',hour:'2-digit',hourCycle:'h23'});
export const hour = (time: number) => hourFormat.format(time);
export const shortHour = (time: number) => shortHourFormat.format(time);
export const fullDate = (time: number) => fullDateFormat.format(time);
export const dayLabel = (date: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric' }).format(new Date(date+'T12:00:00Z'));
export const cardinal = (degrees: number | null) => degrees == null ? '—' : ['N','NE','E','SE','S','SO','O','NO'][Math.round(degrees/45)%8];
export function condition(code: number | null) {
  if (code == null) return 'Conditions indisponibles';
  if (code === 0) return 'Ciel dégagé'; if (code === 1) return 'Belles éclaircies'; if (code === 2) return 'Partiellement nuageux'; if (code === 3) return 'Ciel couvert';
  if (code <= 48) return 'Brume & brouillard'; if (code <= 57) return 'Bruine légère'; if (code <= 67) return 'Pluie'; if (code <= 77) return 'Neige'; if (code <= 82) return 'Averses'; if (code <= 86) return 'Averses de neige'; return 'Orages';
}
export function weatherKind(code: number | null): 'sun'|'cloud'|'partly'|'rain'|'snow'|'storm'|'fog' {
  if (code == null) return 'cloud'; if (code === 0) return 'sun'; if (code <= 2) return 'partly'; if (code === 3) return 'cloud'; if (code <= 48) return 'fog'; if (code <= 67) return 'rain'; if (code <= 77) return 'snow'; if (code <= 82) return 'rain'; if (code <= 86) return 'snow'; return 'storm';
}
export function relativeTime(time: number) { const m = Math.max(0,Math.round((Date.now()-time)/60000)); return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m/60)} h` : `il y a ${Math.floor(m/1440)} j`; }

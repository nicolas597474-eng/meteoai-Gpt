export type Place = {name:string;lat:number;lon:number;localMode?:'standard'|'local'|'ultra-local'};
export type Variable = 'temperature'|'apparentTemperature'|'precipitation'|'windSpeed'|'windGust'|'humidity'|'pressure'|'cloudCover'|'dewPoint'|'visibility'|'uvIndex'|'probability';
export type Activity = 'kayak'|'randonnée'|'vélo'|'jardinage'|'tonte'|'promenade'|'plage';
export type Intent = 'weather'|'stations'|'models'|'reliability'|'weights'|'activity'|'rainProtection'|'guide'|'unknown';
export type Context = {place:Place;date:string;period:'now'|'day';variable:Variable;intent:Intent;activity?:Activity;protection?:'raincoat'|'umbrella';daypart?:'morning'|'afternoon'|'evening';time?:string;models:string[];topic:string;page:string};
export type Source = {label:string;kind:'observation'|'forecast'|'calculation'|'documentation';updatedAt?:string;validAt?:string;href:string};
export type GeminiState={status:string;model?:string;remaining?:number|null;limit?:number;resetAt?:number;retryAt?:number|null;reason?:string|null;text?:string;cached?:boolean};
export type Reply = {text:string;sources:Source[];links?:Array<{label:string;href:string}>;suggestions?:string[];choices?:Place[];context?:Context;ai?:GeminiState};
export type Message = {role:'user'|'assistant';text:string;at:number;reply?:Reply};
export type Conversation = {version:1;at:number;context:Context|null;messages:Message[]};
export type Plan = {question:string;context:Context;locationQuery?:string;clarification?:string;explicitDate:boolean;explicitPlace:boolean};
export type Reading = {value:number|null;kind:Source['kind'];label:string;updatedAt?:string;reason?:string};
export type Hour = {validAt:number;date:string;hour:string;temp:number|null;apparentTemp:number|null;precipitation:number|null;windSpeed:number|null;windGust:number|null;humidity:number|null;pressure?:number|null;cloudCover:number|null;uvIndex:number|null;dewPoint?:number|null;visibility?:number|null;weatherCode?:number|null;forecastWeighting?:any};
export type Day = {date:string;tempMax:number|null;tempMin:number|null;precipitation:number|null;windSpeed:number|null;windGust:number|null;humidity:number|null;cloudCover:number|null;uvIndex?:number|null;fusionDetails?:any[]};
export type Forecast = {hours:Hour[];days:Day[];updatedAt?:string;stale:boolean;models:string[]};
export type Station = {name:string;temp:number;distance:number;time:number;anomaly:boolean};
/** Lecture uniquement. Aucun outil de mutation et aucun fournisseur IA. */
export type DataPort = {
 resolvePlace:(query:string)=>Promise<Place[]>;
 current:(place:Place,variable:Variable)=>Promise<Reading>;
 forecast:(place:Place,days:boolean)=>Promise<Forecast>;
 stations:(place:Place)=>Promise<Station[]>;
 comparison:(place:Place)=>Promise<any>;
 reliability:(place:Place)=>Promise<any>;
};
export const ALLOWED_LINKS=new Set(['/','/details','/laboratoire','/ranking','/ai-lab','/history','/weight-comparison','/favorites','/connexion-netatmo']);
export const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/[’']/g,' ').replace(/\s+/g,' ').trim();
export const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
export const dateAt=(now:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export const dateValid=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export const shiftDate=(date:string,days:number)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
export const number=(value:number,digits=1)=>value.toLocaleString('fr-FR',{maximumFractionDigits:digits});
export const dateLabel=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Paris'});
export const VARIABLES:Record<Variable,{label:string;unit:string;hour:keyof Hour;day?:keyof Day}>={
 temperature:{label:'Température',unit:'°C',hour:'temp'},apparentTemperature:{label:'Ressenti',unit:'°C',hour:'apparentTemp'},precipitation:{label:'Précipitations',unit:'mm',hour:'precipitation',day:'precipitation'},windSpeed:{label:'Vent',unit:'km/h',hour:'windSpeed',day:'windSpeed'},windGust:{label:'Rafales',unit:'km/h',hour:'windGust',day:'windGust'},humidity:{label:'Humidité',unit:'%',hour:'humidity',day:'humidity'},pressure:{label:'Pression de surface estimée',unit:'hPa',hour:'pressure'},cloudCover:{label:'Nuages',unit:'%',hour:'cloudCover',day:'cloudCover'},dewPoint:{label:'Point de rosée',unit:'°C',hour:'dewPoint'},visibility:{label:'Visibilité',unit:'km',hour:'visibility'},uvIndex:{label:'Indice UV',unit:'',hour:'uvIndex',day:'uvIndex'},probability:{label:'Probabilité de pluie',unit:'%',hour:'precipitation'},
};

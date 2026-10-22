import {describe,it,expect} from 'vitest';
import {landscapeKind,landscapeTerrainClip,nearestPopulation} from './landscapeScene';
import {projectApparentBodyOnArc} from './celestialSvgPaths';
const flat=[{azimuthDeg:90,elevationDeg:0},{azimuthDeg:180,elevationDeg:0},{azimuthDeg:270,elevationDeg:0}];
describe('paysage lié au lieu et au terrain',()=>{
 it('choisit les trois types demandés, y compris hors ligne',()=>{
  expect(landscapeKind({name:'Chamonix-Mont-Blanc',lat:45.9237,lon:6.8694},[],null)).toBe('mountain');
  expect(landscapeKind({name:'Lille',lat:50.6292,lon:3.0573},flat,null)).toBe('city');
  expect(landscapeKind({name:'Hondeghem',lat:50.7567,lon:2.5204},flat,null)).toBe('countryside');
 });
 it('utilise le relief et la population documentés pour les autres lieux',()=>{
  const place={name:'Autre lieu',lat:48,lon:2};
  expect(landscapeKind(place,flat,80000)).toBe('city');expect(landscapeKind(place,flat,1200)).toBe('countryside');
  expect(landscapeKind(place,[{azimuthDeg:180,elevationDeg:15}],80000)).toBe('mountain');
 });
 it('ne laisse aucune photo au-dessus de la hauteur réelle de l’horizon',()=>{
  expect(landscapeTerrainClip([])).toBeNull();
  expect(landscapeTerrainClip(flat)).toBe('polygon(8.00% 75.0000%,50.00% 75.0000%,92.00% 75.0000%,100.00% 100.0000%,0.00% 100.0000%)');
  const clip=landscapeTerrainClip(flat.map(p=>({...p,elevationDeg:10})))!;
  const body=projectApparentBodyOnArc({altitudeDeg:10,azimuthDeg:180,aboveHorizon:true})!;
  const horizonY=Number(clip.match(/50.00% ([\d.]+)%/)![1])/100*192;
  expect(horizonY).toBeCloseTo(192-(body.bottom+32),1);
 });
 it('les 32 pixels de sol ne déplacent pas les positions astronomiques',()=>{
  for(const altitudeDeg of [0,10,45,90]){const body=projectApparentBodyOnArc({altitudeDeg,azimuthDeg:180,aboveHorizon:true})!;expect(192-(body.bottom+32)).toBe(160-body.bottom);}
 });
 it('refuse la population d’un homonyme éloigné et ne convertit pas une absence en zéro',()=>{
  const point={name:'Lille',lat:50.63,lon:3.05};
  expect(nearestPopulation([{latitude:55,longitude:10,population:999999},{latitude:50.631,longitude:3.051,population:232000}],point)).toBe(232000);
  expect(nearestPopulation([{latitude:55,longitude:10,population:999999}],point)).toBeNull();
  expect(nearestPopulation([{latitude:50.63,longitude:3.05}],point)).toBeNull();
 });
});

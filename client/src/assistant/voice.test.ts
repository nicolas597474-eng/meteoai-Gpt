import {afterEach,expect,it,vi} from 'vitest';
import {createVoiceDictation,voiceConstructor,type Recognition} from './voice';
class FakeRecognition implements Recognition{
 static instances:FakeRecognition[]=[];
 lang='';continuous=true;interimResults=false;maxAlternatives=0;
 onresult:Recognition['onresult']=null;onerror:Recognition['onerror']=null;onend:Recognition['onend']=null;
 start=vi.fn();stop=vi.fn();abort=vi.fn();
 constructor(){FakeRecognition.instances.push(this);}
}
function setup(){FakeRecognition.instances=[];const text=vi.fn(),state=vi.fn(),voice=createVoiceDictation(FakeRecognition,text,state);return {voice,text,state,get recognition(){return FakeRecognition.instances.at(-1)!;}};}
afterEach(()=>vi.useRealTimers());
it('détecte la variante disponible et laisse le clavier disponible sans API vocale',()=>{expect(voiceConstructor({})).toBeNull();expect(voiceConstructor(null)).toBeNull();expect(voiceConstructor({SpeechRecognition:FakeRecognition})).toBe(FakeRecognition);expect(voiceConstructor({webkitSpeechRecognition:FakeRecognition})).toBe(FakeRecognition);});
it('n’ouvre pas le micro avant l’action utilisateur et ne crée pas deux écoutes',()=>{const s=setup();expect(FakeRecognition.instances).toHaveLength(0);s.voice.start();s.voice.start();expect(FakeRecognition.instances).toHaveLength(1);expect(s.recognition.start).toHaveBeenCalledTimes(1);expect(s.recognition.lang).toBe('fr-FR');expect(s.recognition.continuous).toBe(false);s.voice.cancel();});
it('place seulement le texte final dans le champ pour relecture, sans soumission',()=>{const s=setup();s.voice.start();s.recognition.onresult!({results:[{isFinal:false,0:{transcript:'Va-t-il'}}]});expect(s.text).not.toHaveBeenCalled();expect(s.state).toHaveBeenLastCalledWith(expect.objectContaining({interim:'Va-t-il',listening:true}));s.recognition.onresult!({results:[{isFinal:true,0:{transcript:'Va-t-il pleuvoir demain ?'}}]});expect(s.text).toHaveBeenLastCalledWith('Va-t-il pleuvoir demain ?');s.recognition.onend!();expect(s.state).toHaveBeenLastCalledWith(expect.objectContaining({listening:false,message:expect.stringContaining('Relisez')}));});
it('explique le refus de permission et libère le micro',()=>{const s=setup();s.voice.start();s.recognition.onerror!({error:'not-allowed'});expect(s.recognition.abort).toHaveBeenCalledTimes(1);expect(s.state).toHaveBeenLastCalledWith(expect.objectContaining({listening:false,message:expect.stringContaining('refusé')}));expect(s.recognition.onresult).toBeNull();});
it('ignore tout résultat tardif après fermeture ou nouvelle conversation',()=>{const s=setup();s.voice.start();const late=s.recognition.onresult!;s.voice.cancel();late({results:[{isFinal:true,0:{transcript:'Ancienne dictée'}}]});expect(s.text).not.toHaveBeenCalled();expect(s.recognition.abort).toHaveBeenCalledTimes(1);});
it('borne la durée même si le navigateur ne termine pas son écoute',()=>{vi.useFakeTimers();const s=setup();s.voice.start();vi.advanceTimersByTime(45000);expect(s.recognition.stop).toHaveBeenCalledTimes(1);vi.advanceTimersByTime(2000);expect(s.recognition.abort).toHaveBeenCalledTimes(1);expect(s.state).toHaveBeenLastCalledWith(expect.objectContaining({listening:false}));expect(vi.getTimerCount()).toBe(0);});
it('limite le texte dicté à la taille acceptée par l’assistant',()=>{const s=setup();s.voice.start();s.recognition.onresult!({results:[{isFinal:true,0:{transcript:'a'.repeat(900)}}]});expect(s.text.mock.calls[0][0]).toHaveLength(600);expect(s.recognition.stop).toHaveBeenCalledTimes(1);s.voice.cancel();});

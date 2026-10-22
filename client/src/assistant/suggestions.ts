import type {GeminiState} from './contracts';
export type AssistantSuggestion={question:string;engine:'local'|'gemini'};
const localQuestions=[
 'Dois-je prévoir un K-way demain matin ?',
 'Combien de millimètres de pluie sont prévus demain ?',
 'Quelles seront les plus fortes rafales demain ?',
 'Quelle est la station la plus proche de mon lieu ?',
 'Compare AROME et ICON pour la pluie.',
 'La fiabilité des prévisions est-elle déjà mesurée ?',
];
const localGuides=['À quoi sert le mode Ultra Local ?','Comment lire les scores de fiabilité ?'];
const advancedQuestions=['Puis-je faire une randonnée demain ?','Pourquoi les modèles annoncent-ils des températures différentes ?'];
export function assistantSuggestions(state:GeminiState|null,now=Date.now()):AssistantSuggestion[]{
 const available=state?.status==='ready'&&typeof state.remaining==='number'&&state.remaining>0&&(!state.retryAt||state.retryAt<=now);
 return [...localQuestions.map(question=>({question,engine:'local' as const})),...(available?advancedQuestions:localGuides).map(question=>({question,engine:available?'gemini' as const:'local' as const}))];
}

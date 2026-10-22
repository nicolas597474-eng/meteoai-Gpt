/** Erreurs contrôlées des fonctions privées, sans exposer une erreur SQL. */
export class ApiError extends Error {
 constructor(message:string,public status=400){super(message);}
}

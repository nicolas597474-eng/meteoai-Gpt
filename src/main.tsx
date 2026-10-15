import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends Component<{children:ReactNode},{error:boolean}> {
  state={error:false};
  static getDerivedStateFromError(){return {error:true};}
  componentDidCatch(error:Error,info:ErrorInfo){console.error('MeteoAI',error,info.componentStack);}
  render(){return this.state.error?<main className="fatal-error"><h1>Une turbulence passagère.</h1><p>L’interface a rencontré une erreur. Vos données enregistrées restent sur cet appareil.</p><button onClick={()=>location.reload()}>Recharger MeteoAI</button></main>:this.props.children;}
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>);

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Dialog({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog?.close();document.body.style.overflow=previous;};},[]);
  return <dialog ref={ref} className={`detail-dialog ${wide?'detail-dialog--wide':''}`} onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose();}} aria-labelledby="dialog-title"><div className="dialog-inner"><header className="dialog-header"><div><span className="eyebrow">SOUS LA SURFACE</span><h2 id="dialog-title">{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Fermer la fenêtre"><X size={20}/></button></header>{children}</div></dialog>;
}

export function RooflineBundle({selected,onToggle}:{selected:boolean;onToggle:()=>void}){
  return <div className="bundle"><h4>Complete Roofline System</h4><p>Fascia + Soffits + Guttering — £3,220 bundle (save £300)</p><button aria-pressed={selected} onClick={onToggle}>{selected?'Remove':'Add bundle'}</button></div>
}

export const PRICES:Record<string,number>={windows:8500,doors:1250,patio:3200,'garage-doors':2800,'roofline-bundle':3220,fascia:1450,soffits:920,guttering:850,conservatory:12000,cladding:9200,render:7800,insulation:5400,roof:11000,solar:6000,fencing:2400}
export function calculateBundle(ids:string[]){
  if(ids.includes('fascia')&&ids.includes('soffits')&&ids.includes('guttering')){
    return{total:3220,saving:300,breakdown:{fascia:1450,soffits:920,guttering:850}}
  }
  return{total:ids.reduce((a,id)=>a+(PRICES[id]||0),0),saving:0,breakdown:{}}
}
export function calculateTotal(selected:string[]){
  const hasBundle=selected.includes('roofline-bundle')
  const base=selected.filter(id=>id!=='roofline-bundle').reduce((a,id)=>a+(PRICES[id]||0),0)
  return base+(hasBundle?PRICES['roofline-bundle']:0)
}
export function calculateScoreDelta(selected:string[]){
  let delta=0; if(selected.includes('windows'))delta+=7; if(selected.includes('roofline-bundle'))delta+=6; if(selected.includes('cladding'))delta+=8; return delta
}

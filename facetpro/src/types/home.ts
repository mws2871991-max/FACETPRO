export interface PropertyHealthScore{overall:number;target:number;kerb:number;energy:number;modern:number;maint:number}
export type PropertyHealthScoreAlias = PropertyHealthScore
export interface HomeElement{id:string;type:'roof'|'windows'|'door'|'cladding'|'garage'|'gutters'|'driveway'|'solar'|'render'|'insulation'|'fencing'|'decking'|'porch'|'conservatory';label:string;ageYears:number;status:'good'|'needs-attention'|'critical'|'excellent'|'potential';included?:boolean;potentialSaving?:number}
export interface Home{id:string;address:string;postcode:string;propertyHealth:PropertyHealthScore;elements:HomeElement[]}
export type ProjectId='cladding'|'windows'|'doors'|'roofline-bundle'|'roofing'|'solar'|'conservatories'|'porches'|'garage-doors'|'render'|'insulation'|'fencing'|'decking'
export interface Project{id:ProjectId;label:string;group:'windows-doors'|'roofline'|'extensions'|'finishes'|'energy';price:number}
export const PROJECT_GROUPS=[
  {id:'windows-doors',label:'Windows & Doors',badge:'80% start here',projects:['windows','doors','garage-doors'] as ProjectId[]},
  {id:'roofline',label:'Roofline System — Fascia, Soffits, Guttering',projects:['roofline-bundle'] as ProjectId[]},
  {id:'extensions',label:'Extensions & Structures',projects:['conservatories','porches'] as ProjectId[]},
  {id:'finishes',label:'Exterior Finishes',projects:['cladding','render','insulation','roofing'] as ProjectId[]},
  {id:'outdoor',label:'Outdoor & Energy',projects:['fencing','decking','solar'] as ProjectId[]},
]
export const JOURNEY=['Inspect','Improve','Estimate','Compare','Export'] as const

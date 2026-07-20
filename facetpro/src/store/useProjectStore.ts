import {create} from 'zustand'
import {persist} from 'zustand/middleware'
import type {ProjectId,Home} from '../types/home'

interface ProjectState{
  selected:ProjectId[]
  home:Home|null
  total:number
  addProject:(id:ProjectId)=>void
  removeProject:(id:ProjectId)=>void
  toggleProject:(id:ProjectId)=>void
  setHome:(h:Home)=>void
}
export const useProjectStore=create<ProjectState>()(persist((set,get)=>({
  selected:['windows','roofline-bundle'],
  home:null,
  total:12840,
  addProject:(id)=>set({selected:[...new Set([...get().selected,id])]}),
  removeProject:(id)=>set({selected:get().selected.filter(x=>x!==id)}),
  toggleProject:(id)=>{const s=get().selected;set({selected:s.includes(id)?s.filter(x=>x!==id):[...s,id]})},
  setHome:(home)=>set({home}),
}),{name:'facet_home_45_acacia'}))

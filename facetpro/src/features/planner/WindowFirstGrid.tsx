import {PROJECT_GROUPS} from '../../types/home'
import {useProjectStore} from '../../store/useProjectStore'
export function WindowFirstGrid(){
  const {selected,toggleProject}=useProjectStore()
  return <div>{PROJECT_GROUPS.map(g=><section key={g.id}><h3>{g.label} {g.badge&&<span>{g.badge}</span>}</h3><div className="grid">{g.projects.map(id=><button key={id} aria-pressed={selected.includes(id)} onClick={()=>toggleProject(id)} className={selected.includes(id)?'selected':''}>{id}</button>)}</div></section>)}</div>
}

import type {HomeElement} from '../../types/home'
export function HomeElementCard({el}:{el:HomeElement}){
  return <div className="card"><h4>{el.label}</h4><p>{el.ageYears} yrs • {el.status}</p>{el.included&&<span>Included in plan</span>}</div>
}

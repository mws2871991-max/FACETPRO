import {WindowFirstGrid} from './features/planner/WindowFirstGrid'
import {HomeScore} from './features/home/HomeScore'
import {useProjectStore} from './store/useProjectStore'
export default function App(){
  const {home}=useProjectStore()
  return <main><WindowFirstGrid/>{home&&<HomeScore score={home.score}/>}</main>
}

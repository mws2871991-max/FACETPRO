import type {HomeScore as HS} from '../../types/home'
export function HomeScore({score}:{score:HS}){
  return <div aria-label={`Home Score ${score.overall} to ${score.target}`}><div className="ring">{score.overall} → {score.target}</div><ul><li>Kerb {score.kerb}</li><li>Energy {score.energy}</li><li>Modern {score.modern}</li><li>Maint {score.maint}</li></ul></div>
}

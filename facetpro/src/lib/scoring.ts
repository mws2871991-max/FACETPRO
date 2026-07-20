import type {HomeScore} from '../types/home'
export function projectToScore(current:HomeScore,delta:number):HomeScore{
  return{...current,target:Math.min(100,current.overall+delta)}
}

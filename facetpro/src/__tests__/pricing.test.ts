import {describe,test,expect} from 'vitest'
import {calculateBundle,calculateTotal,calculateScoreDelta} from '../lib/pricing'
describe('pricing',()=>{
  test('roofline bundle saves £300',()=>{const r=calculateBundle(['fascia','soffits','guttering']);expect(r.total).toBe(3220);expect(r.saving).toBe(300)})
  test('total windows + roofline bundle',()=>{expect(calculateTotal(['windows','roofline-bundle'])).toBe(8500+3220)})
  test('score delta windows+roofline=13',()=>{expect(calculateScoreDelta(['windows','roofline-bundle'])).toBe(13)})
})

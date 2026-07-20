import {test,expect} from '@playwright/test'
test('windows first → home score 78→91',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'windows'}).click()
  await page.getByRole('button',{name:'roofline-bundle'}).click()
  await page.getByRole('button',{name:'Build My Digital Home'}).click()
  await expect(page.getByText('78 → 91')).toBeVisible()
})

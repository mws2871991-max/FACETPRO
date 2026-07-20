import React from 'react'
type Props=React.ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'ghost'}
export const Button=React.forwardRef<HTMLButtonElement,Props>(({variant='primary',className='',children,...rest},ref)=>{
  const base=variant==='primary'?'btn-primary':'btn-ghost'
  return <button ref={ref} className={`${base} ${className}`} {...rest}>{children}</button>
})
Button.displayName='Button'

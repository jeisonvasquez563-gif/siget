import '@testing-library/jest-dom/vitest'
import { afterEach, expect } from 'vitest'
import { cleanup } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'
import { olvidarToken } from '../api.js'

expect.extend(toHaveNoViolations)

// jsdom no trae todo lo que usa la interfaz
window.scrollTo = () => {}
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
}

afterEach(() => {
  cleanup()
  olvidarToken()
  document.documentElement.removeAttribute('data-tema')
  try { localStorage.clear() } catch { /* sin almacenamiento */ }
})

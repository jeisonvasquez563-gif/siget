// Paginación de «Mis trámites», la bandeja de la institución y la supervisión: 20 por página, «Anterior / Siguiente», «Mostrando a a b de N · Página X de Y»
// anunciado a los lectores de pantalla, y los filtros se conservan. Se arma la aplicación completa contra el servidor de ejemplo (src/mock.js), que
// tiene 28 trámites propios para Ana (2 páginas) y 41 en la bandeja del MOP (3 páginas), y paginado como el servidor real (`total`, `limite`, `desplazamiento`).
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { Paginacion, usePagina } from '../comun.jsx'
import { instalarMock } from '../mock.js'
import { traerTramites } from '../Tramites.jsx'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }

afterEach(() => vi.restoreAllMocks())

async function abrirComo(usuario, modulo) {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const user = userEvent.setup()
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  await user.click(within(nav).getByRole('button', { name: new RegExp(`^${modulo}`) }))
  await screen.findByRole('heading', { name: modulo })
  return { ...utilidades, user }
}

const filasDeDatos = () => screen.getAllByRole('row').slice(1) // sin el encabezado
const paginador = () => screen.getByRole('navigation', { name: 'Paginación' })
const estado = () => within(paginador()).getByRole('status')
const boton = (nombre) => within(paginador()).getByRole('button', { name: nombre })

describe('«Mis trámites»', () => {
  it('muestra 20 por página y dónde está uno: «Mostrando 1 a 20 de 28 trámites · Página 1 de 2»', async () => {
    await abrirComo('ana.ciudadana', 'Mis trámites')
    expect(filasDeDatos()).toHaveLength(20)
    expect(estado()).toHaveTextContent('Mostrando 1 a 20 de 28 trámites · Página 1 de 2')
    expect(boton(/Anterior/)).toBeDisabled()
    expect(boton(/Siguiente/)).toBeEnabled()
  })

  it('el estado de la paginación es una región viva: los lectores de pantalla anuncian el cambio de página', async () => {
    await abrirComo('ana.ciudadana', 'Mis trámites')
    expect(estado()).toHaveAttribute('aria-live', 'polite')
    expect(estado()).toHaveAttribute('aria-atomic', 'true')
  })

  it('«Siguiente» lleva a la segunda página con los 8 restantes y «Anterior» regresa', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis trámites')
    expect(screen.getByRole('row', { name: /Trámite 44:/ })).toBeInTheDocument() // lo más reciente, primero
    await user.click(boton(/Siguiente/))
    expect(filasDeDatos()).toHaveLength(8)
    expect(estado()).toHaveTextContent('Mostrando 21 a 28 de 28 trámites · Página 2 de 2')
    expect(boton(/Siguiente/)).toBeDisabled()
    expect(boton(/Anterior/)).toBeEnabled()
    expect(screen.queryByRole('row', { name: /Trámite 44:/ })).not.toBeInTheDocument()
    await user.click(boton(/Anterior/))
    expect(filasDeDatos()).toHaveLength(20)
    expect(estado()).toHaveTextContent('Página 1 de 2')
  })

  it('la búsqueda se conserva al cambiar de página y, al cambiarla, se vuelve a la primera', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis trámites')
    await user.click(boton(/Siguiente/))
    const buscador = screen.getByRole('searchbox')
    await user.type(buscador, 'certificado')
    expect(buscador).toHaveValue('certificado')
    // «certificado» deja 1 de sus 28 trámites (se busca por número o nombre del trámite): cabe en una página
    expect(screen.queryByRole('navigation', { name: 'Paginación' })).not.toBeInTheDocument() // cabe en una sola página: sin controles
    expect(filasDeDatos()).toHaveLength(1)
    await user.clear(buscador)
    expect(estado()).toHaveTextContent('Mostrando 1 a 20 de 28 trámites · Página 1 de 2') // volvió a la primera, no se quedó en la 2
  })

  it('con 20 trámites o menos no hay controles de paginación', async () => {
    await abrirComo('beto.ciudadano', 'Mis trámites') // 4 sueltos + 11 antiguos = 15
    expect(filasDeDatos()).toHaveLength(15)
    expect(screen.queryByRole('navigation', { name: 'Paginación' })).not.toBeInTheDocument()
  })

  it('es accesible (axe) con los controles de paginación', async () => {
    const { container } = await abrirComo('ana.ciudadana', 'Mis trámites')
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('la bandeja de la institución y la supervisión', () => {
  async function conTodos(usuario, modulo) {
    const o = await abrirComo(usuario, modulo)
    await o.user.click(screen.getByRole('button', { name: 'Todos' }))
    return o
  }

  it('«Todos» tiene 41 trámites en 3 páginas, de 20, 20 y 1', async () => {
    const { user } = await conTodos('fabio.mop', 'Bandeja de la institución')
    expect(estado()).toHaveTextContent('Mostrando 1 a 20 de 41 trámites · Página 1 de 3')
    await user.click(boton(/Siguiente/))
    expect(estado()).toHaveTextContent('Mostrando 21 a 40 de 41 trámites · Página 2 de 3')
    await user.click(boton(/Siguiente/))
    expect(filasDeDatos()).toHaveLength(1)
    expect(estado()).toHaveTextContent('Mostrando 41 a 41 de 41 trámites · Página 3 de 3')
    expect(boton(/Siguiente/)).toBeDisabled()
  })

  it('cambiar el filtro vuelve a la primera página y conserva el filtro elegido', async () => {
    const { user } = await conTodos('fabio.mop', 'Bandeja de la institución')
    await user.click(boton(/Siguiente/))
    expect(estado()).toHaveTextContent('Página 2 de 3')
    await user.click(screen.getByRole('button', { name: 'Abiertos' }))
    expect(screen.getByRole('button', { name: 'Abiertos' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('navigation', { name: 'Paginación' })).not.toBeInTheDocument() // los abiertos caben en una página
    await user.click(screen.getByRole('button', { name: 'Todos' }))
    expect(estado()).toHaveTextContent('Mostrando 1 a 20 de 41 trámites · Página 1 de 3')
  })

  it('la página se conserva al cambiar entre lista y tablero', async () => {
    const { user } = await conTodos('fabio.mop', 'Bandeja de la institución')
    await user.click(boton(/Siguiente/))
    await user.click(screen.getByRole('button', { name: /Tablero/ }))
    expect(estado()).toHaveTextContent('Página 2 de 3')
    const tablero = screen.getAllByRole('region').filter((r) => r.className.includes('columna'))
    expect(tablero.length).toBe(4)
    await user.click(screen.getByRole('button', { name: /Lista/ }))
    expect(estado()).toHaveTextContent('Página 2 de 3')
  })

  it('en el tablero el número de cada columna es el total, no el de la página, y no cambia al pasar de página', async () => {
    const { user } = await conTodos('fabio.mop', 'Bandeja de la institución')
    await user.click(screen.getByRole('button', { name: /Tablero/ }))
    const columnas = () => screen.getAllByRole('region').filter((r) => r.className.includes('columna'))
    const cuentas = () => columnas().map((c) => Number(c.querySelector('.cuenta').textContent))
    const fichas = () => columnas().map((c) => c.querySelectorAll('.ficha').length)
    const primera = cuentas()
    expect(primera.reduce((a, b) => a + b, 0)).toBe(41) // los 41 trámites, repartidos por columna
    expect(fichas().reduce((a, b) => a + b, 0)).toBe(20) // pero solo 20 fichas en esta página
    expect(primera.some((n, i) => n > fichas()[i])).toBe(true)
    // el indicador de arriba coincide con la columna: ambos son del total
    const pendientes = screen.getByText('Pendientes', { selector: '.indicador span' }).previousSibling
    expect(Number(pendientes.textContent)).toBe(primera[0])
    await user.click(boton(/Siguiente/))
    expect(estado()).toHaveTextContent('Página 2 de 3')
    expect(cuentas()).toEqual(primera)
    expect(fichas().reduce((a, b) => a + b, 0)).toBe(20)
    await user.click(boton(/Siguiente/))
    expect(cuentas()).toEqual(primera)
    expect(fichas().reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('los indicadores de «Mis trámites» y de la bandeja no dependen de la página', async () => {
    const mis = await abrirComo('ana.ciudadana', 'Mis trámites')
    const valor = (texto) => Number(screen.getByText(texto, { selector: '.indicador span' }).previousSibling.textContent)
    const enCurso = valor('En curso'), aprobados = valor('Aprobados')
    await mis.user.click(boton(/Siguiente/))
    expect([valor('En curso'), valor('Aprobados')]).toEqual([enCurso, aprobados])
    mis.unmount()
    const band = await abrirComo('fabio.mop', 'Bandeja de la institución')
    await band.user.click(screen.getByRole('button', { name: 'Todos' }))
    const antes = ['Pendientes', 'En tramitación', 'En subsanación', 'Con el plazo vencido'].map(valor)
    await band.user.click(boton(/Siguiente/))
    expect(['Pendientes', 'En tramitación', 'En subsanación', 'Con el plazo vencido'].map(valor)).toEqual(antes)
  })

  it('la supervisión también pagina y el filtro «Escalados» se conserva sobre todos los trámites', async () => {
    const { user } = await conTodos('saul.mop', 'Supervisión')
    expect(estado()).toHaveTextContent('Página 1 de 3')
    await user.click(screen.getByRole('button', { name: 'Escalados' }))
    expect(screen.queryByRole('navigation', { name: 'Paginación' })).not.toBeInTheDocument()
  })

  it('es accesible (axe) con los controles de paginación', async () => {
    const { container } = await conTodos('fabio.mop', 'Bandeja de la institución')
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('traer los trámites del servidor', () => {
  const fila = (id) => ({ id, estado: 'Pendiente', tipo_tramite: { id: 1, nombre: 'X' }, institucion: { id: 1, nombre: 'Y' } })

  function servidorDe(total) {
    const pedidas = []
    window.fetch = vi.fn(async (ruta) => {
      const p = new URL(ruta, 'http://localhost').searchParams
      const limite = Number(p.get('limite'))
      const desde = Number(p.get('desplazamiento') || 0)
      pedidas.push({ limite, desde })
      const resultados = Array.from({ length: Math.max(0, Math.min(limite, total - desde)) }, (_, i) => fila(total - desde - i))
      return new Response(JSON.stringify({ resultados, total, limite, desplazamiento: desde }), { status: 200 })
    })
    return pedidas
  }

  it('usa el `total` para pedir todas las páginas de a 100 (ya no se pierde lo que pasa de 100)', async () => {
    const pedidas = servidorDe(250)
    const { filas, total, truncado } = await traerTramites()
    expect(pedidas.map((p) => p.desde).sort((a, b) => a - b)).toEqual([0, 100, 200])
    expect(pedidas.every((p) => p.limite === 100)).toBe(true)
    expect(filas).toHaveLength(250)
    expect(new Set(filas.map((t) => t.id)).size).toBe(250)
    expect(total).toBe(250)
    expect(truncado).toBe(false)
  })

  it('con 100 o menos hace una sola petición', async () => {
    const pedidas = servidorDe(37)
    expect((await traerTramites()).filas).toHaveLength(37)
    expect(pedidas).toHaveLength(1)
  })

  it('descarta los repetidos si el desplazamiento se corrió mientras se pedía', async () => {
    let n = 0
    window.fetch = vi.fn(async () => {
      n += 1
      const resultados = n === 1 ? Array.from({ length: 100 }, (_, i) => fila(200 - i)) : Array.from({ length: 50 }, (_, i) => fila(101 - i)) // la 2.ª repite el 101
      return new Response(JSON.stringify({ resultados, total: 150, limite: 100, desplazamiento: 0 }), { status: 200 })
    })
    const { filas } = await traerTramites()
    expect(filas).toHaveLength(149)
    expect(new Set(filas.map((t) => t.id)).size).toBe(149)
  })

  it('avisa que está truncado si pasa del tope de seguridad (5000)', async () => {
    servidorDe(5200)
    const { filas, truncado } = await traerTramites()
    expect(truncado).toBe(true)
    expect(filas).toHaveLength(5000)
  })
})

describe('el servidor de ejemplo pagina como el real', () => {
  async function pedir(ruta) {
    instalarMock('ana.ciudadana', { demora: 0 })
    return fetch(ruta)
  }

  it('devuelve `total`, `limite` y `desplazamiento` y respeta la página pedida', async () => {
    const r = await pedir('/tramites/?limite=5&desplazamiento=10')
    const d = await r.json()
    expect(r.status).toBe(200)
    expect(d).toMatchObject({ total: 28, limite: 5, desplazamiento: 10 })
    expect(d.resultados).toHaveLength(5)
  })

  it('rechaza un `limite` fuera de 1 a 100 o un desplazamiento inválido', async () => {
    for (const ruta of ['/tramites/?limite=0', '/tramites/?limite=101', '/tramites/?limite=abc', '/tramites/?desplazamiento=-1']) {
      const r = await pedir(ruta)
      expect(r.status, ruta).toBe(400)
      expect((await r.json()).codigo).toBe('paginacion_invalida')
    }
  })
})

describe('el componente de paginación', () => {
  function Ejemplo({ total }) {
    const filas = Array.from({ length: total }, (_, i) => i + 1)
    const { pagina, setPagina, visibles } = usePagina(filas, 20)
    return <><ul>{visibles.map((n) => <li key={n}>{n}</li>)}</ul><Paginacion total={total} pagina={pagina} cambiar={setPagina} unidad="cosas" /></>
  }

  it('reparte la lista y ajusta el texto a la última página', async () => {
    const user = userEvent.setup()
    render(<Ejemplo total={45} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(20)
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('status')).toHaveTextContent('Mostrando 41 a 45 de 45 cosas · Página 3 de 3')
  })

  it('no se dibuja si cabe en una página', () => {
    render(<Ejemplo total={20} />)
    expect(screen.queryByRole('navigation', { name: 'Paginación' })).not.toBeInTheDocument()
  })
})

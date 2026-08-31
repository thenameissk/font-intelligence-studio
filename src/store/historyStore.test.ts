import { beforeEach, describe, expect, it } from 'vitest'
import { useFontStore } from './fontStore'
import { useHistoryStore } from './historyStore'
import type { Outline } from '@/types/geometry'

const outlineA: Outline = { contours: [] }
const outlineB: Outline = { contours: [] }

beforeEach(() => {
  useFontStore.setState({ edits: {}, kerningEdits: {}, revision: 0 })
  useHistoryStore.getState().clear()
})

describe('history', () => {
  it('records a one-shot change and undoes it', () => {
    const history = useHistoryStore.getState()
    history.commit('Change width', { 5: { advanceWidth: 600 } })

    expect(useFontStore.getState().edits[5]).toEqual({ advanceWidth: 600 })
    expect(useHistoryStore.getState().canUndo()).toBe(true)

    useHistoryStore.getState().undo()
    expect(useFontStore.getState().edits[5]).toBeUndefined()

    useHistoryStore.getState().redo()
    expect(useFontStore.getState().edits[5]).toEqual({ advanceWidth: 600 })
  })

  it('restores the previous value rather than clearing it', () => {
    const history = useHistoryStore.getState()
    history.commit('First', { 5: { advanceWidth: 600 } })
    history.commit('Second', { 5: { advanceWidth: 700 } })

    useHistoryStore.getState().undo()
    expect(useFontStore.getState().edits[5]).toEqual({ advanceWidth: 600 })

    useHistoryStore.getState().undo()
    expect(useFontStore.getState().edits[5]).toBeUndefined()
  })

  it('collapses a drag into a single undo step', () => {
    const history = useHistoryStore.getState()
    history.begin('Move node')
    for (let i = 1; i <= 20; i += 1) {
      useHistoryStore.getState().update({ 7: { outline: outlineA, advanceWidth: i } })
    }
    useHistoryStore.getState().end()

    expect(useHistoryStore.getState().past).toHaveLength(1)
    expect(useFontStore.getState().edits[7]?.advanceWidth).toBe(20)

    useHistoryStore.getState().undo()
    expect(useFontStore.getState().edits[7]).toBeUndefined()
  })

  it('does not record a transaction that changed nothing', () => {
    const history = useHistoryStore.getState()
    history.begin('Move node')
    useHistoryStore.getState().end()
    expect(useHistoryStore.getState().past).toHaveLength(0)
  })

  it('aborting a transaction restores the starting state', () => {
    useHistoryStore.getState().commit('Setup', { 3: { outline: outlineA } })
    useHistoryStore.getState().begin('Move node')
    useHistoryStore.getState().update({ 3: { outline: outlineB } })
    expect(useFontStore.getState().edits[3]?.outline).toBe(outlineB)

    useHistoryStore.getState().abort()
    expect(useFontStore.getState().edits[3]?.outline).toBe(outlineA)
    expect(useHistoryStore.getState().past).toHaveLength(1)
  })

  it('clears the redo stack when new work is committed', () => {
    const history = useHistoryStore.getState()
    history.commit('One', { 1: { advanceWidth: 100 } })
    useHistoryStore.getState().undo()
    expect(useHistoryStore.getState().canRedo()).toBe(true)

    useHistoryStore.getState().commit('Two', { 2: { advanceWidth: 200 } })
    expect(useHistoryStore.getState().canRedo()).toBe(false)
  })

  it('reverts a glyph when the patch is null', () => {
    const history = useHistoryStore.getState()
    history.commit('Edit', { 9: { advanceWidth: 500 } })
    history.commit('Revert', { 9: null })
    expect(useFontStore.getState().edits[9]).toBeUndefined()

    useHistoryStore.getState().undo()
    expect(useFontStore.getState().edits[9]).toEqual({ advanceWidth: 500 })
  })

  it('undoes kerning changes', () => {
    const history = useHistoryStore.getState()
    history.commit('Kern', {}, { '10,20': -40 })
    expect(useFontStore.getState().kerningEdits['10,20']).toBe(-40)

    useHistoryStore.getState().undo()
    expect(useFontStore.getState().kerningEdits['10,20']).toBeUndefined()
  })

  it('only stores the glyphs a command touched', () => {
    const history = useHistoryStore.getState()
    history.commit('Wide edit', { 1: { advanceWidth: 1 }, 2: { advanceWidth: 2 } })
    const command = useHistoryStore.getState().past[0]
    expect(Object.keys(command.before)).toEqual(['1', '2'])
    expect(command.glyphs).toEqual([1, 2])
  })
})

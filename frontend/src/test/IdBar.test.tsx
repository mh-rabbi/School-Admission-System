import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdBar } from '../components/IdBar'
import { STUDENT_ID_STORAGE_KEY, StudentIdProvider, useStudentId } from '../state/StudentIdProvider'

const ID = '20152691234567890'

/** Exposes what API-calling code would use, so tests can assert it never sees an invalid ID. */
function Probe() {
  const { studentId } = useStudentId()
  return <output data-testid="valid-id">{studentId ?? 'none'}</output>
}

function setup() {
  return render(
    <StudentIdProvider>
      <IdBar />
      <Probe />
    </StudentIdProvider>,
  )
}

const field = () => screen.getByLabelText('Student registration number') as HTMLInputElement

afterEach(() => vi.unstubAllGlobals())

describe('IdBar', () => {
  it('starts empty with a prompt, no valid id, and numeric keyboard hints', () => {
    setup()
    expect(field()).toHaveValue('')
    expect(field()).toHaveAttribute('inputmode', 'numeric')
    expect(field()).toHaveAccessibleDescription(/enter your 17-digit/i)
    expect(screen.getByTestId('valid-id')).toHaveTextContent('none')
  })

  it('shows live progress while typing, and exposes the id only when complete', async () => {
    setup()
    await userEvent.type(field(), '2015269')
    expect(screen.getByText('7/17 digits')).toBeInTheDocument()
    expect(screen.getByTestId('valid-id')).toHaveTextContent('none')
    await userEvent.type(field(), '1234567890')
    expect(screen.getByText('ID looks good')).toBeInTheDocument()
    expect(screen.getByTestId('valid-id')).toHaveTextContent(ID)
  })

  it('converts Bengali digits to ASCII in the field and accepts the result', async () => {
    setup()
    await userEvent.type(field(), '২০১৫২৬৯১২৩৪৫৬৭৮৯০')
    expect(field()).toHaveValue(ID)
    expect(screen.getByTestId('valid-id')).toHaveTextContent(ID)
  })

  it('flags letters and pasted spaces as invalid and exposes no id', async () => {
    setup()
    await userEvent.type(field(), '2015abc')
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/only the digits 0–9/i)).toBeInTheDocument()
    await userEvent.clear(field())
    await userEvent.click(field())
    await userEvent.paste('2015 2691 2345 6789 0')
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('valid-id')).toHaveTextContent('none')
  })

  it('reports too many digits instead of silently cutting them', async () => {
    setup()
    await userEvent.type(field(), ID + '12')
    expect(screen.getByText(/19 entered, 17 needed/)).toBeInTheDocument()
    expect(screen.getByTestId('valid-id')).toHaveTextContent('none')
  })

  it('trims pasted surrounding whitespace', async () => {
    setup()
    await userEvent.click(field())
    await userEvent.paste(`  ${ID} `)
    expect(field()).toHaveValue(ID)
    expect(screen.getByTestId('valid-id')).toHaveTextContent(ID)
  })

  it('persists the id and restores it after a "refresh" (new mount)', async () => {
    const first = setup()
    await userEvent.type(field(), ID)
    expect(window.localStorage.getItem(STUDENT_ID_STORAGE_KEY)).toBe(ID)
    first.unmount()

    setup()
    expect(field()).toHaveValue(ID)
    expect(screen.getByTestId('valid-id')).toHaveTextContent(ID)
  })

  it('restores a Bengali-digit value saved by an older session as ASCII', () => {
    window.localStorage.setItem(STUDENT_ID_STORAGE_KEY, '২০১৫২৬৯১২৩৪৫৬৭৮৯০')
    setup()
    expect(field()).toHaveValue(ID)
  })

  it('keeps working when storage is blocked (private mode / site data disabled)', async () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    vi.stubGlobal('localStorage', blocked)
    setup()
    await userEvent.type(field(), ID)
    expect(screen.getByTestId('valid-id')).toHaveTextContent(ID)
  })

  it('can be focused from elsewhere (used when Apply is pressed without an id)', () => {
    function FocusButton() {
      const { focusInput } = useStudentId()
      return <button onClick={focusInput}>go</button>
    }
    render(
      <StudentIdProvider>
        <IdBar />
        <FocusButton />
      </StudentIdProvider>,
    )
    screen.getByText('go').click()
    expect(field()).toHaveFocus()
  })
})

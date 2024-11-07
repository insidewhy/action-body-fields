import { munamuna, returns, spy } from 'munamuna'
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest'
import * as actionsCore from '@actions/core'
import * as octokitRest from '@octokit/rest'

import { run } from './index'

vi.mock('@actions/core', () => ({}))
vi.mock('@octokit/rest', () => ({}))

const getInputMock = munamuna(actionsCore).getInput
const issuesMock = munamuna(octokitRest).Octokit[returns].issues

beforeEach(() => {
  vi.clearAllMocks()
})

const fieldsToString = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

const fieldsToBlock = (fields?: Record<string, string>) =>
  fields ? `<!-- body fields -->\r\n${fieldsToString(fields)}\r\n<!-- end body fields -->` : ''

function mockDependencies(
  fields: Record<string, string>,
  bodyFields: Record<string, string> | undefined = undefined,
  {
    prepend = false,
    appendToValues = false,
    bodyContent = undefined,
    oldTitle,
    title,
    titleFrom,
  }: {
    prepend?: boolean
    appendToValues?: boolean
    bodyContent?: string
    oldTitle?: string
    title?: string
    titleFrom?: string
  } = {},
): Mock {
  getInputMock.mockReturnValueOnce(fieldsToString(fields))
  getInputMock.mockReturnValueOnce('token')
  getInputMock.mockReturnValueOnce('123')
  getInputMock.mockReturnValueOnce('owner/repo')
  getInputMock.mockReturnValueOnce(prepend.toString())
  getInputMock.mockReturnValueOnce(appendToValues.toString())
  getInputMock.mockReturnValueOnce(title)
  getInputMock.mockReturnValueOnce(titleFrom)

  const body = `${bodyFields ? fieldsToBlock(bodyFields) : ''}${bodyContent ?? ''}`

  issuesMock.get[returns].data.body = body
  if (oldTitle) {
    issuesMock.get[returns].data.title = oldTitle
  }
  return issuesMock.update[spy]
}

function expectFields(
  update: Mock,
  fields?: Record<string, string>,
  { contentAfterFields = '', title }: { contentAfterFields?: string; title?: string } = {},
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expectedUpdate: any = {
    owner: 'owner',
    repo: 'repo',
    issue_number: 123,
  }
  if (title) {
    expectedUpdate.title = title
  }

  const body = fields && fieldsToBlock(fields)
  if (body) {
    expectedUpdate.body = body + contentAfterFields
  } else if (contentAfterFields) {
    expectedUpdate.body = contentAfterFields
  }

  expect(update).toHaveBeenCalledWith(expectedUpdate)
}

it('can prepend fields to body without any fields', async () => {
  const update = mockDependencies({ mr: '1', cat: '2' }, undefined, {
    bodyContent: 'cool',
  })
  await run()
  expectFields(update, { mr: '1', cat: '2' }, { contentAfterFields: '\n\ncool' })
})

it('can update, add and preserve fields', async () => {
  const update = mockDependencies({ mr: '3', jives: '2' }, { mr: '1', cat: '2' })
  await run()
  expectFields(update, { mr: '3', cat: '2', jives: '2' })
})

it('can update, prepend and preserve fields', async () => {
  const update = mockDependencies({ mr: '3', jives: '6' }, { mr: '1', cat: '2' }, { prepend: true })
  await run()
  expectFields(update, { jives: '6', mr: '3', cat: '2' })
})

it('can append suffixes to fields', async () => {
  const update = mockDependencies(
    { mr: '(hey)', jives: '(man)' },
    { mr: '1', cat: '2' },
    { appendToValues: true },
  )
  await run()
  expectFields(update, { mr: '1 (hey)', cat: '2' })
})

it('does not call update function when there are no changes to make', async () => {
  const update = mockDependencies({ mr: '1' }, { mr: '1', cat: '2' })
  await run()
  expect(update).not.toHaveBeenCalled()
})

it('does not call update function when there are no appends to make', async () => {
  const update1 = mockDependencies(
    { mr: 'sfx' },
    { mr: '1 sfx', cat: '2' },
    { appendToValues: true },
  )
  await run()
  expect(update1).not.toHaveBeenCalled()

  const update2 = mockDependencies({ mr: 'sfx' }, { cat: '2' }, { appendToValues: true })
  await run()
  expect(update2).not.toHaveBeenCalled()
})

describe('when titleFrom is used', () => {
  it('can update the title only if the title has changed but not the fields', async () => {
    const update = mockDependencies(
      { mr: 'new' },
      { mr: 'new', cat: '2' },
      { oldTitle: 'old', titleFrom: 'mr' },
    )
    await run()
    expectFields(update, undefined, { title: 'new' })
  })

  it('does nothing if neither the title nor the body have changed', async () => {
    const update = mockDependencies(
      { mr: 'new' },
      { mr: 'new', cat: '2' },
      { oldTitle: 'new', titleFrom: 'mr' },
    )
    await run()
    expect(update).not.toHaveBeenCalled()
  })

  it('can update title and prepend fields to body without any fields', async () => {
    const update = mockDependencies({ mr: '1', cat: '2' }, undefined, {
      bodyContent: 'cool',
      oldTitle: 'old',
      titleFrom: 'mr',
    })
    await run()
    expectFields(update, { mr: '1', cat: '2' }, { contentAfterFields: '\n\ncool', title: '1' })
  })

  it('can update title from new field and body when both have changed', async () => {
    const update = mockDependencies(
      { mr: '3' },
      { mr: '1', cat: '2' },
      { oldTitle: 'old', titleFrom: 'mr' },
    )
    await run()
    expectFields(update, { mr: '3', cat: '2' }, { title: '3' })
  })

  it('can update title from old field and body when both have changed', async () => {
    const update = mockDependencies(
      { mr: '3' },
      { mr: '1', cat: '2' },
      { oldTitle: 'old', titleFrom: 'cat' },
    )
    await run()
    expectFields(update, { mr: '3', cat: '2' }, { title: '2' })
  })
})

describe('when title is used', () => {
  it('can update the title only if the title has changed but not the fields', async () => {
    const update = mockDependencies(
      { mr: 'new' },
      { mr: 'new', cat: '2' },
      { oldTitle: 'old', title: 'ey' },
    )
    await run()
    expectFields(update, undefined, { title: 'ey' })
  })

  it('does nothing if neither the title nor the body have changed', async () => {
    const update = mockDependencies(
      { mr: 'new' },
      { mr: 'new', cat: '2' },
      { oldTitle: 'new', title: 'new' },
    )
    await run()
    expect(update).not.toHaveBeenCalled()
  })

  it('can update title and body when both have changed', async () => {
    const update = mockDependencies(
      { mr: '3' },
      { mr: '1', cat: '2' },
      { oldTitle: 'old', title: 'new' },
    )
    await run()
    expectFields(update, { mr: '3', cat: '2' }, { title: 'new' })
  })
})

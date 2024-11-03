import { munamuna, returns, spy } from 'munamuna'
import { beforeEach, expect, it, vi, Mock } from 'vitest'
import { getInput } from '@actions/core'
import * as octokitRest from '@octokit/rest'

import { run } from './index'

vi.mock('@actions/core', () => ({ getInput: vi.fn() }))

vi.mock('@octokit/rest', () => ({}))

const getInputMock = vi.mocked(getInput)
const issuesMock = munamuna(octokitRest).Octokit[returns].issues

beforeEach(() => {
  vi.clearAllMocks()
})

const fieldsToString = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

const fieldsToBlock = (fields: Record<string, string>) =>
  `<!-- body fields -->\r\n${fieldsToString(fields)}\r\n<!-- end body fields -->`

function mockDependencies(
  fields: Record<string, string>,
  bodyFields: Record<string, string> | undefined = undefined,
  {
    prepend = false,
    appendToValues = false,
    bodyContent = undefined,
  }: { prepend?: boolean; appendToValues?: boolean; bodyContent?: string } = {},
): Mock {
  getInputMock.mockReturnValueOnce(fieldsToString(fields))
  getInputMock.mockReturnValueOnce('token')
  getInputMock.mockReturnValueOnce('123')
  getInputMock.mockReturnValueOnce('owner/repo')
  getInputMock.mockReturnValueOnce(prepend.toString())
  getInputMock.mockReturnValueOnce(appendToValues.toString())

  const body = `${bodyFields ? fieldsToBlock(bodyFields) : ''}${bodyContent ?? ''}`

  issuesMock.get[returns].data.body = body
  return issuesMock.update[spy]
}

function expectFields(
  update: Mock,
  fields: Record<string, string>,
  contentAfterFields?: string,
): void {
  expect(update).toHaveBeenCalledWith({
    owner: 'owner',
    repo: 'repo',
    issue_number: 123,
    body: `${fieldsToBlock(fields)}${contentAfterFields ?? ''}`,
  })
}

it('can prepend fields to body without any fields', async () => {
  const update = mockDependencies({ mr: '1', cat: '2' }, undefined, {
    bodyContent: 'cool',
  })
  await run()
  expectFields(update, { mr: '1', cat: '2' }, '\n\ncool')
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

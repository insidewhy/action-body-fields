import { beforeEach, expect, it, vi, Mock } from 'vitest'
import { getInput } from '@actions/core'
import { Octokit } from '@octokit/rest'

import { run } from './index'

vi.mock('@actions/core', () => ({ getInput: vi.fn() }))
vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }))

const getInputMock = vi.mocked(getInput)
const octokitMock = vi.mocked(Octokit)

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
  prepend = false,
  appendToValues = false,
): Mock {
  getInputMock.mockReturnValueOnce(fieldsToString(fields))
  getInputMock.mockReturnValueOnce('token')
  getInputMock.mockReturnValueOnce('123')
  getInputMock.mockReturnValueOnce('owner/repo')
  getInputMock.mockReturnValueOnce(prepend.toString())
  getInputMock.mockReturnValueOnce(appendToValues.toString())

  const update = vi.fn()

  octokitMock.mockImplementation(() => {
    return {
      issues: {
        get: vi
          .fn()
          .mockReturnValue({ data: { body: bodyFields ? fieldsToBlock(bodyFields) : '' } }),
        update,
      },
    } as unknown as Octokit
  })

  return update
}

function expectFields(update: Mock, fields: Record<string, string>): void {
  expect(update).toHaveBeenCalledWith({
    owner: 'owner',
    repo: 'repo',
    issue_number: 123,
    body: fieldsToBlock(fields),
  })
}

it('can prepend fields to body without any fields', async () => {
  const update = mockDependencies({ mr: '1', cat: '2' })
  await run()
  expectFields(update, { mr: '1', cat: '2' })
})

it('can update, add and preserve fields', async () => {
  const update = mockDependencies({ mr: '3', jives: '2' }, { mr: '1', cat: '2' })
  await run()
  // TODO: mr's position should be preserved
  expectFields(update, { cat: '2', mr: '3', jives: '2' })
})

it('can update, prepend and preserve fields', async () => {
  const update = mockDependencies({ mr: '3', jives: '6' }, { mr: '1', cat: '2' }, true)
  await run()
  // TODO: mr's position should be preserved and jive should come first
  expectFields(update, { mr: '3', jives: '6', cat: '2' })
})

it('can append suffixes to fields', async () => {
  const update = mockDependencies(
    { mr: '(hey)', jives: '(man)' },
    { mr: '1', cat: '2' },
    false,
    true,
  )
  await run()
  // TODO: mr's position should be preserved
  expectFields(update, { cat: '2', mr: '1 (hey)' })
})
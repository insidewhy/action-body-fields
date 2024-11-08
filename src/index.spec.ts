import { munamuna, returns, spy } from 'munamuna'
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest'
import * as actionsCore from '@actions/core'
import * as octokitRest from '@octokit/rest'

import { getBlockHeader, getBlockFooter, run, buildBlock, Config } from './index'

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

const fieldsToBlockContent = (
  blockName: string,
  fields?: Record<string, string>,
  header?: string,
  footer?: string,
) => {
  if (!fields) {
    return ''
  }

  const blockHeader = getBlockHeader(blockName)
  const blockFooter = getBlockFooter(blockName)
  return buildBlock(blockHeader, blockFooter, fieldsToString(fields), header ?? '', footer ?? '')
}

const COMMON_UPDATE_FIELDS = {
  owner: 'owner',
  repo: 'repo',
  issue_number: 123,
}

type MockConfig = Partial<
  Omit<Config, 'removeFields' | 'owner' | 'repo' | 'githubToken' | 'issueNumber'>
> & {
  // string instead of string[]
  removeFields?: string
}

function mockConfig({
  fieldsRaw,
  prepend = false,
  appendToValues = false,
  title,
  titleFrom,
  header,
  footer,
  blockName,
  blockPosition,
  content,
  remove = false,
  removeFields,
}: MockConfig = {}): void {
  getInputMock.mockReturnValueOnce(`${COMMON_UPDATE_FIELDS.owner}/${COMMON_UPDATE_FIELDS.repo}`)
  getInputMock.mockReturnValueOnce(blockPosition ?? '')
  getInputMock.mockReturnValueOnce(blockName ?? '')
  getInputMock.mockReturnValueOnce(removeFields ?? '')

  getInputMock.mockReturnValueOnce(fieldsRaw ?? '')
  getInputMock.mockReturnValueOnce('token')
  getInputMock.mockReturnValueOnce(COMMON_UPDATE_FIELDS.issue_number)
  getInputMock.mockReturnValueOnce(prepend.toString())
  getInputMock.mockReturnValueOnce(appendToValues.toString())
  getInputMock.mockReturnValueOnce(title ?? '')
  getInputMock.mockReturnValueOnce(titleFrom ?? '')
  getInputMock.mockReturnValueOnce(header ?? '')
  getInputMock.mockReturnValueOnce(footer ?? '')
  getInputMock.mockReturnValueOnce(content ?? '')
  getInputMock.mockReturnValueOnce(remove.toString())
}

interface MockBlock {
  blockName?: string
  fields?: Record<string, string>
  header?: string
  footer?: string
}

function mockConfigsAndBlocks(
  configs: Array<
    {
      fields?: Record<string, string>
      existingBlocks?: MockBlock[]
    } & Omit<MockConfig, 'fieldsRaw'>
  >,
  existing: {
    title?: string
    bodyAfterBlock?: string
  } = {},
): Mock {
  for (const config of configs) {
    mockConfig({
      ...config,
      fieldsRaw: config.fields && fieldsToString(config.fields),
    })
    let mockBody =
      config.existingBlocks
        ?.map((block) =>
          fieldsToBlockContent(
            block.blockName ?? 'default',
            block.fields,
            block.header,
            block.footer,
          ),
        )
        ?.join('\n\n') ?? ''

    if (existing.bodyAfterBlock) {
      mockBody += mockBody ? `\n\n${existing.bodyAfterBlock}` : existing.bodyAfterBlock
    }

    const mockReturn: any = { data: { body: mockBody } }
    if (existing.title) {
      mockReturn.data.title = existing.title
    }
    issuesMock.get.mockReturnValueOnce(mockReturn)
  }

  return issuesMock.update[spy]
}

function mockConfigAndBlock(
  fields?: Record<string, string>,
  mockConfigOptions: Omit<MockConfig, 'fieldsRaw'> = {},
  bodyFields: Record<string, string> | undefined = undefined,
  existingContent: Omit<MockBlock, 'fields'> & {
    title?: string
    bodyAfterBlock?: string
  } = {},
): Mock {
  return mockConfigsAndBlocks(
    [
      {
        ...mockConfigOptions,
        fields,
        existingBlocks: [
          {
            blockName: mockConfigOptions.blockName,
            fields: bodyFields,
            header: existingContent.header,
            footer: existingContent.footer,
          },
        ],
      },
    ],
    { title: existingContent.title, bodyAfterBlock: existingContent.bodyAfterBlock },
  )
}

interface ExpectedUpdate {
  contentAfterFields?: string
  title?: string
}

function expectBlocksRaw(
  update: Mock,
  blocks: string[],
  { contentAfterFields = '', title }: ExpectedUpdate = {},
): void {
  const expectedUpdate: typeof COMMON_UPDATE_FIELDS & { body?: string; title?: string } = {
    ...COMMON_UPDATE_FIELDS,
  }
  if (title) {
    expectedUpdate.title = title
  }

  const body = blocks.join('\n\n')
  if (body) {
    expectedUpdate.body = body + contentAfterFields
  } else if (contentAfterFields) {
    expectedUpdate.body = contentAfterFields
  }

  expect(update).toHaveBeenLastCalledWith(expectedUpdate)
}

interface ExpectedBlock {
  name: string
  fields: Record<string, string>
  header?: string
  footer?: string
}

function expectBlocks(update: Mock, blocks: ExpectedBlock[], expectedUpdate: ExpectedUpdate): void {
  return expectBlocksRaw(
    update,
    blocks.map((block) =>
      fieldsToBlockContent(block.name, block.fields, block.header, block.footer),
    ),
    expectedUpdate,
  )
}

function expectFields(
  update: Mock,
  fields?: Record<string, string>,
  {
    contentAfterFields = '',
    title,
    header,
    footer,
  }: { contentAfterFields?: string; title?: string; header?: string; footer?: string } = {},
): void {
  expectBlocks(update, fields ? [{ name: 'default', fields, header, footer }] : [], {
    contentAfterFields,
    title,
  })
}

it('can prepend fields to body without any fields', async () => {
  const update = mockConfigAndBlock({ mr: '1', cat: '2' }, undefined, undefined, {
    bodyAfterBlock: 'cool',
  })
  await run()
  expectBlocksRaw(update, ['<!-- body fields -->\r\nmr: 1\ncat: 2\r\n<!-- end body fields -->'], {
    contentAfterFields: '\n\ncool',
  })
})

it('can update, add and preserve fields', async () => {
  const update = mockConfigAndBlock({ mr: '3', jives: '2' }, undefined, { mr: '1', cat: '2' })
  await run()
  expectFields(update, { mr: '3', cat: '2', jives: '2' })
})

it('can update, prepend and preserve fields', async () => {
  const update = mockConfigAndBlock(
    { mr: '3', jives: '6' },
    { prepend: true },
    { mr: '1', cat: '2' },
  )
  await run()
  expectFields(update, { jives: '6', mr: '3', cat: '2' })
})

it('can append suffixes to fields', async () => {
  const update = mockConfigAndBlock(
    { mr: '(hey)', jives: '(man)' },
    { appendToValues: true },
    { mr: '1', cat: '2' },
  )
  await run()
  expectFields(update, { mr: '1 (hey)', cat: '2' })
})

it('does not call update function when there are no changes to make', async () => {
  const update = mockConfigAndBlock({ mr: '1' }, undefined, { mr: '1', cat: '2' })
  await run()
  expect(update).not.toHaveBeenCalled()
})

it('does not call update function when there are no appends to make', async () => {
  const update1 = mockConfigAndBlock(
    { mr: 'sfx' },
    { appendToValues: true },
    { mr: '1 sfx', cat: '2' },
  )
  await run()
  expect(update1).not.toHaveBeenCalled()

  const update2 = mockConfigAndBlock({ mr: 'sfx' }, { appendToValues: true }, { cat: '2' })
  await run()
  expect(update2).not.toHaveBeenCalled()
})

describe('when titleFrom is used', () => {
  it('can update the title only if the title has changed but not the fields', async () => {
    const update = mockConfigAndBlock(
      { mr: 'new' },
      { titleFrom: 'mr' },
      { mr: 'new', cat: '2' },
      { title: 'old' },
    )
    await run()
    expectFields(update, undefined, { title: 'new' })
  })

  it('does nothing if neither the title nor the body have changed', async () => {
    const update = mockConfigAndBlock(
      { mr: 'new' },
      { titleFrom: 'mr' },
      { mr: 'new', cat: '2' },
      { title: 'new' },
    )
    await run()
    expect(update).not.toHaveBeenCalled()
  })

  it('can update title and prepend fields to body without any fields', async () => {
    const update = mockConfigAndBlock({ mr: '1', cat: '2' }, { titleFrom: 'mr' }, undefined, {
      bodyAfterBlock: 'cool',
      title: 'old',
    })
    await run()
    expectFields(update, { mr: '1', cat: '2' }, { contentAfterFields: '\n\ncool', title: '1' })
  })

  it('can update title from new field and body when both have changed', async () => {
    const update = mockConfigAndBlock(
      { mr: '3' },
      { titleFrom: 'mr' },
      { mr: '1', cat: '2' },
      { title: 'old' },
    )
    await run()
    expectFields(update, { mr: '3', cat: '2' }, { title: '3' })
  })

  it('can update title from old field and body when both have changed', async () => {
    const update = mockConfigAndBlock(
      { mr: '3' },
      { titleFrom: 'cat' },
      { mr: '1', cat: '2' },
      { title: 'old' },
    )
    await run()
    expectFields(update, { mr: '3', cat: '2' }, { title: '2' })
  })
})

describe('when title is used', () => {
  it('can update the title only if the title has changed but not the fields', async () => {
    const update = mockConfigAndBlock(
      { mr: 'new' },
      { title: 'ey' },
      { mr: 'new', cat: '2' },
      { title: 'old' },
    )
    await run()
    expectFields(update, undefined, { title: 'ey' })
  })

  it('does nothing if neither the title nor the body have changed', async () => {
    const update = mockConfigAndBlock(
      { mr: 'new' },
      { title: 'new' },
      { mr: 'new', cat: '2' },
      { title: 'new' },
    )
    await run()
    expect(update).not.toHaveBeenCalled()
  })

  it('can update title and body when both have changed', async () => {
    const update = mockConfigAndBlock(
      { mr: '3' },
      { title: 'new' },
      { mr: '1', cat: '2' },
      { title: 'old' },
    )
    await run()
    expectFields(update, { mr: '3', cat: '2' }, { title: 'new' })
  })
})

describe('when remove-fields is used', () => {
  it('can remove a field', async () => {
    const update = mockConfigAndBlock(undefined, { removeFields: 'cat' }, { mr: 'new', cat: '2' })
    await run()
    expectFields(update, { mr: 'new' })
  })

  it('can remove multiple fields', async () => {
    const update = mockConfigAndBlock(
      undefined,
      { removeFields: 'mr,cat' },
      { mr: 'new', cat: '2', friend: '4' },
    )
    await run()
    expectFields(update, { friend: '4' })
  })

  it('removes the block if there are no fields left', async () => {
    const update = mockConfigAndBlock(
      undefined,
      { removeFields: 'mr' },
      { mr: 'new' },
      { bodyAfterBlock: 'mamas' },
    )
    await run()
    expect(update).toHaveBeenLastCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 123,
      body: 'mamas',
    })
  })
})

describe('with existing or new headers and footers', () => {
  it('preserves existing headers and footer', async () => {
    const update = mockConfigAndBlock(
      { mr: '4' },
      undefined,
      { mr: '3' },
      { header: 'foo', footer: 'yeah' },
    )
    await run()
    expectFields(update, { mr: '4' }, { header: 'foo', footer: 'yeah' })
  })

  it('updates existing header and footer', async () => {
    const update = mockConfigAndBlock(
      { mr: '4' },
      { header: 'chiz', footer: 'yop' },
      { mr: '3' },
      { header: 'foo', footer: 'yeah' },
    )
    await run()
    expectFields(update, { mr: '4' }, { header: 'chiz', footer: 'yop' })
  })

  it('adds new header and footer', async () => {
    const update = mockConfigAndBlock({ mr: '4' }, { header: 'chiz', footer: 'yop' }, { mr: '3' })
    await run()
    expectFields(update, { mr: '4' }, { header: 'chiz', footer: 'yop' })
  })

  it('adds new header when there are no changes to fields', async () => {
    const update = mockConfigAndBlock({ mr: '4' }, { header: 'chiz' }, { mr: '4' })
    await run()
    expectFields(update, { mr: '4' }, { header: 'chiz' })
  })

  it('adds new footer when there are no changes to fields', async () => {
    const update = mockConfigAndBlock({ mr: '4' }, { footer: 'chapo' }, { mr: '4' })
    await run()
    expectFields(update, { mr: '4' }, { footer: 'chapo' })
  })

  it('removes header and footer when final field is removed via remove-fields', async () => {
    const update = mockConfigAndBlock(
      undefined,
      { footer: 'chapo', removeFields: 'mr' },
      { mr: '4' },
    )
    await run()
    expect(update).toHaveBeenLastCalledWith({
      ...COMMON_UPDATE_FIELDS,
      body: '',
    })
  })
})

describe('named blocks', () => {
  it('can be created multiple times', async () => {
    const firstFields = { mr: '1' }
    const update = mockConfigsAndBlocks(
      [
        { fields: firstFields },
        { fields: { cat: '2' }, blockName: 'susan', existingBlocks: [{ fields: firstFields }] },
      ],
      { bodyAfterBlock: 'cool' },
    )
    await run()
    const defaultBlock = '<!-- body fields -->\r\nmr: 1\r\n<!-- end body fields -->'
    expectBlocksRaw(update, [defaultBlock], {
      contentAfterFields: '\n\ncool',
    })

    const susanBlock = '<!-- body fields: susan -->\r\ncat: 2\r\n<!-- end body fields: susan -->'
    await run()
    expectBlocksRaw(update, [defaultBlock, susanBlock], {
      contentAfterFields: '\n\ncool',
    })
  })

  it('can be prepended using blockPosition: first', async () => {
    const firstFields = { mr: '1' }
    const update = mockConfigsAndBlocks([
      { fields: firstFields },
      {
        fields: { cat: '2' },
        blockPosition: 'first',
        blockName: 'susan',
        existingBlocks: [{ fields: firstFields }],
      },
    ])
    await run()
    const defaultBlock = '<!-- body fields -->\r\nmr: 1\r\n<!-- end body fields -->'
    expectBlocksRaw(update, [defaultBlock])

    const susanBlock = '<!-- body fields: susan -->\r\ncat: 2\r\n<!-- end body fields: susan -->'
    await run()
    expectBlocksRaw(update, [susanBlock, defaultBlock])
  })
})

describe('content option', () => {
  it('can create a new content block', async () => {
    const update = mockConfigAndBlock(undefined, { content: 'hey there' })
    await run()
    expectBlocksRaw(update, ['<!-- body fields -->\r\nhey there\r\n<!-- end body fields -->'])
  })

  it.only('can update a content block', async () => {
    const update = mockConfigAndBlock(
      undefined,
      { content: 'how how the caribou' },
      { cheeses: 'hello' },
    )
    await run()
    expectBlocksRaw(update, [
      '<!-- body fields -->\r\nhow how the caribou\r\n<!-- end body fields -->',
    ])
  })

  it('does nothing if content has not changed', async () => {
    const update = mockConfigAndBlock(
      undefined,
      { content: 'cheeses: hello' },
      { cheeses: 'hello' },
    )
    await run()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('remove option', () => {
  it('can remove a block', async () => {
    const update = mockConfigAndBlock(
      undefined,
      { remove: true },
      { mr: 'new' },
      { bodyAfterBlock: 'mamak rice' },
    )
    await run()
    expect(update).toHaveBeenLastCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 123,
      body: 'mamak rice',
    })
  })

  it('does nothing if there is no block', async () => {
    const update = mockConfigAndBlock(undefined, { remove: true }, undefined, {
      bodyAfterBlock: 'mamak rice',
    })
    await run()
    expect(update).not.toHaveBeenCalled()
  })
})

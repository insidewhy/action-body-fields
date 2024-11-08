import { getInput } from '@actions/core'
import { Octokit } from '@octokit/rest'

function parseFields(fieldsRaw: string[]): Map<string, string> {
  return new Map(
    fieldsRaw.map((field) => {
      const sepIndex = field.indexOf(': ')
      return [field.substring(0, sepIndex), field.substring(sepIndex + 2)]
    }),
  )
}

function parseFieldsWithHeaderAndFooter(fieldsRaw: string[]): {
  header: string
  footer: string
  fields: Map<string, string>
} {
  let header = ''
  let finishedHeader = false
  let footer = ''
  const fields = new Map<string, string>()

  for (const line of fieldsRaw) {
    const sepIndex = line.indexOf(': ')
    if (sepIndex === -1) {
      if (finishedHeader) {
        footer += footer ? `\n${line}` : line
      } else {
        header += header ? `\n${line}` : line
      }
    } else {
      finishedHeader = true
      fields.set(line.substring(0, sepIndex), line.substring(sepIndex + 2))
    }
  }

  return { header, footer, fields }
}

export interface Config {
  fieldsRaw: string
  githubToken: string
  issueNumber: number
  owner: string
  repo: string
  prepend: boolean
  appendToValues: boolean
  title: string
  titleFrom: string
  removeFields: string[]
  header: string
  footer: string
  blockName: string
  blockPosition: 'first' | 'after'
  content: string
  remove: boolean

  // calculated, for convenience
  blockHeader: string
  blockFooter: string
}

function validateBlockPosition(blockPosition: string): asserts blockPosition is 'first' | 'after' {
  if (blockPosition !== 'first' && blockPosition !== 'after') {
    throw new Error('block-position must be "first" or "after"')
  }
}

export const getBlockHeader = (blockName: string) =>
  `<!-- body fields${blockName === 'default' ? '' : ': ' + blockName} -->\r\n`

export const getBlockFooter = (blockName: string) =>
  `\r\n<!-- end body fields${blockName === 'default' ? '' : ': ' + blockName} -->`

function getConfig(): Config {
  const [owner, repo] = getInput('repository', { required: true }).split('/')

  const blockPosition = getInput('block-position') || 'after'
  validateBlockPosition(blockPosition)

  const blockName = getInput('block-name') || 'default'
  const removeFields = getInput('remove-fields')

  const options = {
    owner,
    repo,
    fieldsRaw: getInput('fields'),
    githubToken: getInput('github-token', { required: true }),
    issueNumber: parseInt(getInput('issue-number', { required: true })),
    prepend: getInput('prepend') === 'true',
    appendToValues: getInput('append-to-values') === 'true',
    title: getInput('title'),
    titleFrom: getInput('title-from'),
    removeFields: removeFields ? removeFields.split(',') : [],
    header: getInput('header'),
    footer: getInput('footer'),
    blockName,
    blockPosition,
    content: getInput('content'),
    remove: getInput('remove') === 'true',
    blockHeader: getBlockHeader(blockName),
    blockFooter: getBlockFooter(blockName),
  }

  if (options.titleFrom && options.appendToValues) {
    throw new Error('Cannot use title-from with append-to-values')
  }
  if (options.title && options.titleFrom) {
    throw new Error('Cannot use title with title-from')
  }
  if (options.content) {
    if (options.fieldsRaw) {
      throw new Error('Cannot use content with fields, header or footer')
    }
    if (options.titleFrom) {
      throw new Error('Cannot use content with title-from')
    }
    if (options.removeFields.length) {
      throw new Error('Cannot use content with remove-fields')
    }
  }

  return options
}

export const buildBlock = (
  blockHeader: string,
  blockFooter: string,
  fieldContent: string,
  header: string,
  footer: string,
): string => {
  const content = (header ? header + '\n' : header) + fieldContent + (footer ? '\n' + footer : '')
  return `${blockHeader}${content}${blockFooter}`
}

interface Update {
  title?: string
  body?: string
}

const createNewBlock = (cfg: Config, issueBody: string | null | undefined): Update | undefined => {
  if (cfg.appendToValues) {
    console.log('no block to append values')
  } else if (cfg.fieldsRaw || cfg.content) {
    console.log('creating block')

    const newFields = parseFields(cfg.fieldsRaw.split(/\r?\n/))
    const newTitle = cfg.titleFrom ? newFields.get(cfg.titleFrom) : cfg.title
    const newBlock = buildBlock(
      cfg.blockHeader,
      cfg.blockFooter,
      cfg.fieldsRaw || cfg.content,
      cfg.header,
      cfg.footer,
    )

    let body = newBlock
    if (issueBody) {
      if (cfg.blockPosition === 'first') {
        body = `${newBlock}\n\n${issueBody}`
      } else {
        // try to position it after the final block end
        let foundBlock = false
        body = issueBody.replace(
          /(.*<!-- end body fields[^\r\n]+[\r\n]*)(.*)/s,
          (_matched, before, after) => {
            foundBlock = true
            return before.trimEnd() + '\n\n' + newBlock + (after ? '\n\n' + after : '')
          },
        )
        if (!foundBlock) {
          // there was no block so it goes first
          body = `${newBlock}\n\n${issueBody}`
        }
      }
    }

    const update: Update = { body }
    if (newTitle) {
      update.title = newTitle
    }
    return update
  }

  return undefined
}

async function getUpdate(client: Octokit, cfg: Config): Promise<Update | undefined> {
  const { owner, repo, issueNumber: issue_number } = cfg
  const issue = await client.issues.get({ owner, repo, issue_number })

  const { body: issueBody } = issue.data

  let foundBlock = false
  const existingBlock = issueBody?.replace(
    new RegExp(`.*(${cfg.blockHeader}.*${cfg.blockFooter}).*`, 's'),
    (_matched, block) => {
      foundBlock = true
      return block
    },
  )

  if (!existingBlock || !foundBlock) {
    return cfg.remove ? undefined : createNewBlock(cfg, issueBody)
  }

  const { content } = cfg
  if (content) {
    const existingContent = existingBlock
      .replace(/^[^\r\n]+\r?\n/s, '')
      .replace(/\r?\n[^\r\n]+$/s, '')

    if (content !== existingContent) {
      const update: Update = {
        body: issueBody!.replace(
          existingBlock,
          buildBlock(cfg.blockHeader, cfg.blockFooter, content, cfg.header, cfg.footer),
        ),
      }
      if (cfg.title && cfg.title !== issue.data.title) {
        console.log('updating block and title')
        update.title = cfg.title
      } else {
        console.log('updating block')
      }
      return update
    }
  }

  if (cfg.remove) {
    const update: Update = {
      // TODO: the trimStart approach only works to remove newlines around the block
      // if the block is at the beginning of the body
      body: issueBody!.replace(existingBlock, '').trimStart(),
    }
    return update
  }

  const { header, footer, fields } = parseFieldsWithHeaderAndFooter(
    existingBlock.split(/\r?\n/).slice(1, -1),
  )
  const fieldsToAdd = new Map<string, string>()
  const newFields = cfg.fieldsRaw ? parseFields(cfg.fieldsRaw.split(/\r?\n/)) : new Map()

  let hasChange = false

  for (const [key, value] of newFields) {
    const existingValue = fields.get(key)

    if (cfg.appendToValues) {
      if (existingValue) {
        const toAppend = ` ${value}`
        if (!existingValue.endsWith(toAppend)) {
          fields.set(key, `${existingValue}${toAppend}`)
          hasChange = true
        }
      }
      continue
    }

    if (existingValue) {
      if (existingValue !== value) {
        fields.set(key, value)
        hasChange = true
      }
    } else {
      fieldsToAdd.set(key, value)
      hasChange = true
    }
  }

  for (const toRemove of cfg.removeFields) {
    if (fields.delete(toRemove)) {
      hasChange = true
    }
  }

  const oldTitle = issue.data.title
  const newTitle = cfg.titleFrom
    ? (newFields.get(cfg.titleFrom) ?? fields.get(cfg.titleFrom))
    : cfg.title

  if (!hasChange) {
    console.log('no changes to block')

    if (newTitle && newTitle !== oldTitle) {
      console.log('updating title')
      return { title: newTitle }
    }

    if (header === cfg.header && footer === cfg.footer) {
      return undefined
    }
  }

  const fieldsToBlockContent = (fields: Map<string, string>) =>
    Array.from(fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')

  let newBlockContent = fields.size ? fieldsToBlockContent(fields) : ''

  if (fieldsToAdd.size) {
    const newFieldsContent = fieldsToBlockContent(fieldsToAdd)
    if (cfg.prepend) {
      newBlockContent = newBlockContent
        ? `${newFieldsContent}\n${newBlockContent}`
        : newFieldsContent
    } else {
      if (newBlockContent) {
        newBlockContent += `\n${newFieldsContent}`
      } else {
        newBlockContent += newFieldsContent
      }
    }
  }

  const update: Update = {
    // TODO: the trimStart approach only works to remove newlines around the block
    // if the block is at the beginning of the body
    body: issueBody!
      .replace(
        existingBlock,
        newBlockContent
          ? buildBlock(
              cfg.blockHeader,
              cfg.blockFooter,
              newBlockContent,
              cfg.header || header,
              cfg.footer || footer,
            )
          : '',
      )
      .trimStart(),
  }
  if (newTitle && newTitle !== oldTitle) {
    console.log('updating block and title')
    update.title = newTitle
  } else {
    console.log('updating block')
  }

  return update
}

export async function run(): Promise<void> {
  const cfg = getConfig()

  const client = new Octokit({ auth: cfg.githubToken })

  const update = await getUpdate(client, cfg)
  if (update) {
    const { owner, repo, issueNumber: issue_number } = cfg
    await client.issues.update({
      owner,
      repo,
      issue_number,
      ...update,
    })
  }
}

if (process.env.GITHUB_ACTIONS) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

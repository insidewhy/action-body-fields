import { getInput } from '@actions/core'
import { Octokit, RestEndpointMethodTypes } from '@octokit/rest'

const BODY_HEADER = '<!-- body fields -->\r\n'
const BODY_FOOTER = '\r\n<!-- end body fields -->'

type UpdateParameters = RestEndpointMethodTypes['issues']['update']['parameters']

function parseFields(fieldsRaw: string[]): Map<string, string> {
  return new Map(
    fieldsRaw.map((field) => {
      const sepIndex = field.indexOf(': ')
      return [field.substring(0, sepIndex), field.substring(sepIndex + 2)]
    }),
  )
}

export async function run(): Promise<void> {
  const fieldsRaw = getInput('fields', { required: true })
  const githubToken = getInput('github-token', { required: true })
  const issue_number = parseInt(getInput('issue-number', { required: true }))
  const [owner, repo] = getInput('repository', { required: true }).split('/')
  const prepend = getInput('prepend') === 'true'
  const appendToValues = getInput('append-to-values') === 'true'
  const title = getInput('title')
  const titleFrom = getInput('title-from')

  const client = new Octokit({ auth: githubToken })
  const issue = await client.issues.get({ owner, repo, issue_number })

  if (titleFrom && appendToValues) {
    throw new Error('Cannot use title-from with append-to-values')
  }
  if (title && titleFrom) {
    throw new Error('Cannot use title with title-from')
  }

  const { title: oldTitle, body: issueBody } = issue.data

  let foundBlock = false
  const existingBlock = issueBody?.replace(
    new RegExp(`.*(${BODY_HEADER}.*${BODY_FOOTER}).*`, 's'),
    (_matched, block) => {
      foundBlock = true
      return block
    },
  )

  if (!existingBlock || !foundBlock) {
    if (appendToValues) {
      console.log('no block to append values')
    } else {
      console.log('creating block')
      const newFields = parseFields(fieldsRaw.split(/\r?\n/))
      const newTitle = titleFrom ? newFields.get(titleFrom) : title
      const body = `${BODY_HEADER}${fieldsRaw}${BODY_FOOTER}${issueBody ? '\n\n' + issueBody : ''}`
      const update: UpdateParameters = { owner, repo, issue_number, body }
      if (newTitle) {
        update.title = newTitle
      }

      await client.issues.update(update)
    }

    return
  }

  const fields = parseFields(existingBlock.split(/\r?\n/).slice(1, -1))
  const fieldsToAdd = new Map<string, string>()
  const newFields = parseFields(fieldsRaw.split(/\r?\n/))

  let hasChange = false

  for (const [key, value] of newFields) {
    const existingValue = fields.get(key)

    if (appendToValues) {
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

  const newTitle = titleFrom ? (newFields.get(titleFrom) ?? fields.get(titleFrom)) : title

  if (!hasChange) {
    console.log('no changes to block')

    if (newTitle && newTitle !== oldTitle) {
      console.log('updating title')
      await client.issues.update({ owner, repo, issue_number, title: newTitle })
    }
    return
  }

  const fieldsToBlock = (fields: Map<string, string>) =>
    Array.from(fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')

  let newBlockContent = fieldsToBlock(fields)

  if (fieldsToAdd.size) {
    const newFieldsContent = fieldsToBlock(fieldsToAdd)
    if (prepend) {
      newBlockContent = `${newFieldsContent}\n${newBlockContent}`
    } else {
      newBlockContent += `\n${newFieldsContent}`
    }
  }

  const update: UpdateParameters = {
    owner,
    repo,
    issue_number,
    body: issueBody!.replace(existingBlock, `${BODY_HEADER}${newBlockContent}${BODY_FOOTER}`),
  }
  if (newTitle && newTitle !== oldTitle) {
    console.log('updating block and title')
    update.title = newTitle
  } else {
    console.log('updating block')
  }

  await client.issues.update(update)
}

if (process.env.GITHUB_ACTIONS) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

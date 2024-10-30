import { getInput } from '@actions/core'
import { Octokit } from '@octokit/rest'

const BODY_HEADER = '<!-- body fields -->\r\n'
const BODY_FOOTER = '\r\n<!-- end body fields -->'

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

  const client = new Octokit({ auth: githubToken })
  const issue = await client.issues.get({ owner, repo, issue_number })

  const issueBody = issue.data.body
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
      const body = `${BODY_HEADER}${fieldsRaw}${BODY_FOOTER}${issueBody ? '\n\n' + issueBody : ''}`
      await client.issues.update({ owner, repo, issue_number, body })
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

  if (!hasChange) {
    console.log('no changes to block')
    return
  }

  console.log('updating block')

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

  await client.issues.update({
    owner,
    repo,
    issue_number,
    body: issueBody!.replace(existingBlock, `${BODY_HEADER}${newBlockContent}${BODY_FOOTER}`),
  })
}

if (process.env.GITHUB_ACTIONS) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

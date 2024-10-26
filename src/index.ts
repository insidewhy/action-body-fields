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

async function run(): Promise<void> {
  const fieldsRaw = getInput('fields', { required: true }).trim()
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
      await client.issues.update({
        owner,
        repo,
        issue_number,
        body: `${BODY_HEADER}${fieldsRaw}${BODY_FOOTER}${issueBody ?? ''}`,
      })
    }

    return
  }

  const existingBlockLines = existingBlock.split(/\r?\n/).slice(1, -1)
  const untouchedFields = parseFields(existingBlockLines)
  const fields = parseFields(fieldsRaw.split(/\r?\n/))

  let hasChange = false
  const newBlockFields: string[] = []

  for (const [key, value] of fields) {
    const existingValue = untouchedFields.get(key)

    if (appendToValues) {
      if (existingValue) {
        const toAppend = ` ${value}`
        if (existingValue.endsWith(toAppend)) {
          newBlockFields.push(`${key}: ${existingValue}`)
        } else {
          newBlockFields.push(`${key}: ${existingValue}${toAppend}`)
          hasChange = true
        }
      }
    } else {
      newBlockFields.push(`${key}: ${value}`)
      if (existingValue !== value) {
        hasChange = true
      }
    }

    // leave in map for prepending/appending later
    if (existingValue) {
      untouchedFields.delete(key)
    }
  }

  if (!hasChange) {
    console.log('no changes to block')
    return
  }

  console.log('updating block')
  const newFieldsRaw = newBlockFields.join('\n')
  let newBlockContent = ''
  if (!untouchedFields.size) {
    newBlockContent = newFieldsRaw
  } else {
    const preservedBlockContent = Array.from(untouchedFields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    if (prepend) {
      newBlockContent = `${newFieldsRaw}\n${preservedBlockContent}`
    } else {
      newBlockContent = `${preservedBlockContent}\n${newFieldsRaw}`
    }
  }

  await client.issues.update({
    owner,
    repo,
    issue_number,
    body: issueBody!.replace(existingBlock, `${BODY_HEADER}${newBlockContent}${BODY_FOOTER}`),
  })
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

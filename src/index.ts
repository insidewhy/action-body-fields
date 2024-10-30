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

  const unreferencedFields = parseFields(existingBlock.split(/\r?\n/).slice(1, -1))
  const fields = parseFields(fieldsRaw.split(/\r?\n/))

  let hasChange = false
  const referencedFields: string[] = []

  for (const [key, value] of fields) {
    const existingValue = unreferencedFields.get(key)

    if (appendToValues) {
      if (existingValue) {
        const toAppend = ` ${value}`
        if (existingValue.endsWith(toAppend)) {
          referencedFields.push(`${key}: ${existingValue}`)
        } else {
          referencedFields.push(`${key}: ${existingValue}${toAppend}`)
          hasChange = true
        }
      }
    } else {
      referencedFields.push(`${key}: ${value}`)
      if (existingValue !== value) {
        hasChange = true
      }
    }

    // leave in map for prepending/appending later
    if (existingValue) {
      unreferencedFields.delete(key)
    }
  }

  if (!hasChange) {
    console.log('no changes to block')
    return
  }

  console.log('updating block')
  const referencedFieldsContent = referencedFields.join('\n')
  let newBlockContent = ''
  if (!unreferencedFields.size) {
    newBlockContent = referencedFieldsContent
  } else {
    const unreferencedFieldsContent = Array.from(unreferencedFields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    if (prepend) {
      newBlockContent = `${referencedFieldsContent}\n${unreferencedFieldsContent}`
    } else {
      newBlockContent = `${unreferencedFieldsContent}\n${referencedFieldsContent}`
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

import * as core from '@actions/core'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import {readFileSync} from 'fs'
import {glob} from 'glob'
import {parse} from 'yaml'

const insensitivePattern = /\(\?i\)/

async function schema(schemaName, schemaDir) {
  const baseDirSanitized = schemaDir.replace(/\/$/, '')
  const files = await glob('**/*.json', {cwd: baseDirSanitized})
  const schemas = []
  for (const file of files) {
    const fullPath = `${baseDirSanitized}/${file}`
    const schema = JSON.parse(readFileSync(fullPath, 'utf8'))
    schemas.push(schema)
  }
  const ajv = new Ajv2020({
    strict: false,
    code: {
      regExp: (pattern, u) => {
        let flags = u
        let newPattern = pattern
        if (insensitivePattern.test(pattern)) {
          newPattern = newPattern.replace(insensitivePattern, '')
          flags += 'i'
        }
        return new RegExp(newPattern, flags)
      }
    },
    schemas
  }) // options can be passed, e.g. {allErrors: true}
  addFormats(ajv)

  return ajv.getSchema(schemaName)
}

// Helper function to validate all json files in the baseDir
export async function jsonValidator(exclude) {
  const baseDir = core.getInput('base_dir').trim()
  const schemaDir = core.getInput('schema_dir').trim()
  const schemaName = core.getInput('schema_name').trim()

  // remove trailing slash from baseDir
  const baseDirSanitized = baseDir.replace(/\/$/, '')

  // setup the schema (if provided)
  const validate = await schema(schemaName, schemaDir)

  // loop through all json files in the baseDir and validate them
  var result = {
    success: true,
    passed: 0,
    failed: 0,
    skipped: 0,
    violations: []
  }

  const files = await glob('**/*{yaml, yml}', {cwd: baseDirSanitized})
  for (const file of files) {
    // construct the full path to the file
    const fullPath = `${baseDirSanitized}/${file}`

    if (exclude.isExcluded(fullPath)) {
      core.info(`skipping due to exclude match: ${fullPath}`)
      result.skipped++
      continue
    }

    var data

    try {
      // try to parse the file
      data = parse(readFileSync(fullPath, 'utf8'))
    } catch {
      // if the json file is invalid, log an error and set success to false
      core.error(`❌ failed to parse JSON file: ${fullPath}`)
      result.success = false
      result.failed++
      result.violations.push({
        file: fullPath,
        errors: [
          {
            path: null,
            message: 'Invalid JSON'
          }
        ]
      })
      continue
    }

    // if a jsonSchema is provided, validate the json against it
    const valid = validate(data)
    if (!valid) {
      // if the json file is invalid against the schema, log an error and set success to false
      core.error(
        `❌ failed to parse JSON file: ${fullPath}\n${JSON.stringify(
          validate.errors
        )}`
      )
      result.success = false
      result.failed++

      // add the errors to the result object (path and message)
      // where path is the path to the property that failed validation
      var errors = []
      for (const error of validate.errors) {
        errors.push({
          path: error.instancePath || null,
          message: error.message
        })
      }

      // add the file and errors to the result object
      result.violations.push({
        file: `${fullPath}`,
        errors: errors
      })
      continue
    }

    result.passed++
    core.info(`${fullPath} is valid`)
  }

  // return the result object
  return result
}

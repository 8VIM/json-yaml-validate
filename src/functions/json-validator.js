import * as core from '@actions/core'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import {readFileSync} from 'fs'
import {globSync, glob} from 'glob'
import {parse} from 'yaml'

const insensitivePattern = /\(\?i\)/

async function schema(schemaDir) {
  const files = await glob(`${schemaDir}/*.json`)

  const schemas = []
  for (const file in files) {
    const schema = JSON.parse(readFileSync(file, 'utf8'))
    schemas.push(schema)
  }
  const ajv = new Ajv({
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

  // compile the schema
  return ajv.getSchema('https://8vim.github.io/schemas/schema')
}

// Helper function to validate all json files in the baseDir
export async function jsonValidator(exclude) {
  const baseDir = core.getInput('base_dir').trim()
  const jsonExtension = core.getInput('json_extension').trim()
  const jsonExcludeRegex = core.getInput('json_exclude_regex').trim()
  const schemaDir = core.getInput('schema_dir').trim()
  const yamlAsJson = core.getInput('yaml_as_json').trim() === 'true'
  const yamlExtension = core.getInput('yaml_extension').trim()
  const yamlExtensionShort = core.getInput('yaml_extension_short').trim()

  // remove trailing slash from baseDir
  const baseDirSanitized = baseDir.replace(/\/$/, '')

  // check if regex is enabled
  var skipRegex = null
  if (jsonExcludeRegex && jsonExcludeRegex !== '') {
    skipRegex = new RegExp(jsonExcludeRegex)
  }

  // setup the schema (if provided)
  const validate = await schema(schemaDir)

  // loop through all json files in the baseDir and validate them
  var result = {
    success: true,
    passed: 0,
    failed: 0,
    skipped: 0,
    violations: []
  }

  const yamlGlob = `${yamlExtension.replace(
    '.',
    ''
  )}, ${yamlExtensionShort.replace('.', '')}`

  const glob = yamlAsJson
    ? `**/*{${jsonExtension},${yamlGlob}}`
    : `**/*${jsonExtension}`

  const files = globSync(glob, {cwd: baseDirSanitized})
  for (const file of files) {
    // construct the full path to the file
    const fullPath = `${baseDirSanitized}/${file}`

    // If an exclude regex is provided, skip json files that match
    if (skipRegex !== null) {
      if (skipRegex.test(fullPath)) {
        core.info(`skipping due to exclude match: ${fullPath}`)
        result.skipped++
        continue
      }
    }

    if (exclude.isExcluded(fullPath)) {
      core.info(`skipping due to exclude match: ${fullPath}`)
      result.skipped++
      continue
    }

    var data

    try {
      // try to parse the file
      if (fullPath.endsWith('.yaml')) {
        data = parse(readFileSync(fullPath, 'utf8'))
      } else {
        data = JSON.parse(readFileSync(fullPath, 'utf8'))
      }
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

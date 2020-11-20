import * as ts from 'typescript'

import { COMPILER_OPTIONS, TYPE_OUT_FILE, COMPONENT_OUT_FILE } from './constants'
import { resolveModule } from './resolve'

export const createProgramForModule = (module: string) => {
  const compilerHost = ts.createCompilerHost(COMPILER_OPTIONS)
  const resolvedFileName = resolveModule(compilerHost, module, __filename)
  const program = ts.createProgram({
    rootNames: [resolvedFileName],
    options: COMPILER_OPTIONS,
    host: compilerHost,
  })
  const typeChecker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(resolvedFileName)

  if (!sourceFile) {
    throw new Error(`Could not get source file for module "${module}"`)
  }

  return {
    sourceFile,
    compilerHost,
    program,
    typeChecker,
  }
}

export const typeCheckResults = () => {
  const program = ts.createProgram({
    rootNames: [TYPE_OUT_FILE, COMPONENT_OUT_FILE],
    options: COMPILER_OPTIONS,
  })

  const typeSourceFile = program.getSourceFile(TYPE_OUT_FILE)
  const componentSourceFile = program.getSourceFile(COMPONENT_OUT_FILE)
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program, typeSourceFile),
    ...ts.getPreEmitDiagnostics(program, componentSourceFile),
  ]

  diagnostics.forEach((diagnostic) => {
    if (diagnostic.file) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!)

      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')

      console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`)
    } else {
      console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    }
  })

  const exitCode = diagnostics.length ? 1 : 0
  console.log(`Process exiting with code '${exitCode}'.`)
  process.exit(exitCode)
}
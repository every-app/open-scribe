import Foundation
import OpenZenCLI

// `OpenZen --cli <command>` runs a smoke/sign-in command (OpenZenCLI) under the app's own signed
// identity, so it shares the app's Keychain items. Anything else starts the menu-bar app.
if CommandLine.arguments.count > 1 && CommandLine.arguments[1] == "--cli" {
  exit(await CLI.run(Array(CommandLine.arguments.dropFirst(2))))
}
OpenZenApp.main()

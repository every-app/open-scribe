import Foundation
import TalkCLI

// `Talk --cli <command>` runs a smoke/sign-in command (TalkCLI) under the app's own signed
// identity, so it shares the app's Keychain items. Anything else starts the menu-bar app.
if CommandLine.arguments.count > 1 && CommandLine.arguments[1] == "--cli" {
  exit(await CLI.run(Array(CommandLine.arguments.dropFirst(2))))
}
TalkApp.main()

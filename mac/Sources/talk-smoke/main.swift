import Foundation
import TalkCLI

// `swift run talk-smoke …`: see TalkCLI/CLI.swift for the commands.
//
// The Keychain commands (signin, status, refresh, signout, --keychain) are handed to the installed,
// signed app binary (`Talk --cli …`): Keychain items belong to the code identity that wrote
// them, and this `swift run` binary's ad-hoc identity changes every build, so the app (or this
// tool) would hit a Keychain prompt nobody can click. TALK_APP_BINARY overrides the path.
var args = Array(CommandLine.arguments.dropFirst())
let keychainCommands: Set<String> = ["signin", "status", "refresh", "signout", "token", "app-state"]

if args.count == 2 && args[1] == "--keychain" {
  args = ["api", "--keychain"]
} else if args.count == 2 && !keychainCommands.contains(args[0]) && !args[1].hasPrefix("--") {
  // <app-url> <token>: no Keychain, run here.
  exit(await CLI.run(["api"] + args))
}
guard let command = args.first, keychainCommands.contains(command) || args == ["api", "--keychain"] else {
  FileHandle.standardError.write(Data((CLI.usage + "\n").utf8))
  exit(2)
}

let binary = ProcessInfo.processInfo.environment["TALK_APP_BINARY"]
  ?? NSHomeDirectory() + "/Applications/Talk.app/Contents/MacOS/Talk"
guard FileManager.default.isExecutableFile(atPath: binary) else {
  FileHandle.standardError.write(Data("FAIL no app at \(binary); run mac/scripts/build-app.sh first\n".utf8))
  exit(1)
}
let argv = ([binary, "--cli"] + args).map { strdup($0) } + [nil]
execv(binary, argv)
FileHandle.standardError.write(Data("FAIL couldn't run \(binary): \(String(cString: strerror(errno)))\n".utf8))
exit(1)

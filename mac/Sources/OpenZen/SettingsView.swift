import OpenZenCore
import ServiceManagement
import SwiftUI

/// Sign-in (or the account, once signed in) and the three permissions.
struct SettingsView: View {
  @ObservedObject var model: AppModel

  var body: some View {
    Form {
      if model.isSignedIn {
        AccountSection(model: model)
      } else {
        SignInSection(model: model)
      }
      PermissionsSection()
      GeneralSection()
    }
    .formStyle(.grouped)
    .frame(width: 460)
    .fixedSize(horizontal: false, vertical: true)
  }
}

private struct AccountSection: View {
  @ObservedObject var model: AppModel

  var body: some View {
    Section("Account") {
      LabeledContent("Signed in as", value: model.me?.email ?? model.me?.name ?? "…")
      LabeledContent("App", value: model.appURL?.host ?? "")
      LabeledContent("Method") {
        if case .oauth = model.credentials { Text("Every App") } else { Text("Access token") }
      }
      LabeledContent("Google Calendar") {
        if model.calendarConnected {
          Text("Connected")
        } else {
          Button("Connect…") { model.connectCalendar() }
        }
      }
      HStack {
        Spacer()
        Button("Sign Out", role: .destructive) { model.signOut() }
      }
    }
  }
}

private struct SignInSection: View {
  enum Method: String, CaseIterable, Identifiable {
    case everyApp = "Every App"
    case token = "Access Token"
    var id: String { rawValue }
  }

  @ObservedObject var model: AppModel
  @AppStorage("signIn.method") private var method: Method = .token
  @AppStorage("signIn.appURL") private var appURL = ""
  @State private var token = ""

  var body: some View {
    Section {
      Picker("Sign in with", selection: $method) {
        ForEach(Method.allCases) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)

      TextField("App URL", text: $appURL, prompt: Text("https://open-zen.example.com"))
      switch method {
      case .everyApp:
        Text("Your browser opens your Gateway to sign in, then comes back here.")
          .font(.caption).foregroundStyle(.secondary)
      case .token:
        SecureField("Token", text: $token, prompt: Text("epat_…"))
        Text("Make one in Manage workspace → Tokens → New token: Full access, bound to OpenZen.")
          .font(.caption).foregroundStyle(.secondary)
      }

      if let error = model.signInError {
        Text(error).font(.callout).foregroundStyle(.red)
      }

      HStack {
        Spacer()
        if model.signingIn {
          ProgressView().controlSize(.small)
          if method == .everyApp { Button("Cancel") { model.cancelSignIn() } }
        }
        Button("Sign In") { submit() }
          .keyboardShortcut(.defaultAction)
          .disabled(model.signingIn)
      }
    } header: {
      Text("Sign in to OpenZen")
    }
  }

  private func submit() {
    switch method {
    case .everyApp: model.signInWithEveryApp(appURLText: appURL)
    case .token: model.signIn(appURLText: appURL, token: token)
    }
  }
}

private struct PermissionsSection: View {
  @State private var microphone = Permissions.microphone
  @State private var notifications = Permissions.Status.unknown

  var body: some View {
    Section("Permissions") {
      row("Microphone", "Your side of the call.", microphone) {
        if microphone == .notAsked {
          Task {
            _ = await Permissions.ensureMicrophone()
            microphone = Permissions.microphone
          }
        } else {
          Permissions.openSettings("Privacy_Microphone")
        }
      }
      row("System Audio Recording", "The other side of the call. macOS asks the first time.", .unknown) {
        Permissions.primeSystemAudio()
      }
      row("Notifications", "A reminder two minutes before each meeting.", notifications) {
        if notifications == .notAsked {
          Task {
            await Permissions.requestNotifications()
            notifications = await Permissions.notifications()
          }
        } else {
          NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!)
        }
      }
      Text("Audio goes straight to OpenAI for transcription and is never saved.")
        .font(.caption).foregroundStyle(.secondary)
    }
    .task { await reload() }
    .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
      Task { await reload() }
    }
  }

  private func reload() async {
    microphone = Permissions.microphone
    notifications = await Permissions.notifications()
  }

  private func row(_ title: String, _ detail: String, _ status: Permissions.Status, action: @escaping () -> Void) -> some View {
    LabeledContent {
      HStack {
        Text(status.label).foregroundStyle(status == .denied ? .red : .secondary)
        if status != .granted {
          Button(status == .notAsked || status == .unknown ? "Allow…" : "Open Settings…", action: action)
        }
      }
    } label: {
      Text(title)
      Text(detail)
    }
  }
}

/// Launch at login through SMAppService (as Scrawl does): reminders only arrive while OpenZen runs.
private struct GeneralSection: View {
  @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
  @State private var error: String?

  var body: some View {
    Section("General") {
      Toggle("Open OpenZen at login", isOn: $launchAtLogin)
        .onChange(of: launchAtLogin) { _, on in
          do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            error = nil
          } catch {
            self.error = error.localizedDescription
            launchAtLogin = SMAppService.mainApp.status == .enabled
          }
        }
      if SMAppService.mainApp.status == .requiresApproval {
        Text("Allow OpenZen in System Settings → General → Login Items.")
          .font(.caption).foregroundStyle(.secondary)
      }
      if let error { Text(error).font(.caption).foregroundStyle(.red) }
    }
  }
}

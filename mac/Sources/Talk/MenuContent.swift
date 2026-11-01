import TalkCore
import SwiftUI

struct MenuContent: View {
  @ObservedObject var model: AppModel
  @ObservedObject var recorder: Recorder
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    if model.isSignedIn {
      recording
      upcoming
      Divider()
      Button("Meetings…") { show("meetings") }
        .keyboardShortcut("m")
      Button("Open Talk in Browser") { model.openWebApp() }
      if let host = model.appURL?.host {
        Text("Signed in to \(host)")
      }
    } else {
      Text("Not signed in")
      Button("Sign In…") { show("settings") }
    }
    Divider()
    Button("Settings…") { show("settings") }
      .keyboardShortcut(",")
    Button("Quit Talk") { NSApp.terminate(nil) }
      .keyboardShortcut("q")
  }

  @ViewBuilder private var recording: some View {
    switch recorder.state {
    case .idle:
      Button("Record Now") { model.recordNow() }
        .keyboardShortcut("r")
      if let id = recorder.lastMeetingID {
        Button("Open Last Meeting's Notes") { model.openMeeting(id: id) }
      }
    case .starting(let title):
      Text("Starting “\(title)”…")
    case .recording(_, let title, let since):
      Text("● Recording “\(title)” since \(since.formatted(date: .omitted, time: .shortened))")
      Text(recorder.liveLine ?? "Listening…")
      if let warning = recorder.warning { Text("⚠︎ \(warning)") }
      Button("Stop Recording") { model.stopRecording() }
        .keyboardShortcut(".")
    case .stopping(let title):
      Text("Saving “\(title)”…")
    }
    if let error = recorder.lastError { Text("⚠︎ \(error)") }
  }

  @ViewBuilder private var upcoming: some View {
    Divider()
    if !model.calendarConnected {
      Button("Connect Google Calendar…") { model.connectCalendar() }
    } else if model.events.isEmpty {
      Text(model.calendarError.map { "Calendar: \($0)" } ?? "No meetings in the next 24 hours")
    } else {
      Text("Upcoming")
      ForEach(model.events.prefix(8)) { event in
        Menu(Self.label(event)) {
          Button("Record") { model.record(event) }
            .disabled(recorder.isActive)
          if let url = event.conferenceURL {
            Button("Join Call") { NSWorkspace.shared.open(url) }
          }
        }
      }
    }
  }

  static func label(_ event: CalendarEvent) -> String {
    let time = event.start.formatted(date: .omitted, time: .shortened)
    let day = Calendar.current.isDateInToday(event.start) ? "" : event.start.formatted(.dateTime.weekday(.abbreviated)) + " "
    return "\(day)\(time)  \(event.title)"
  }

  private func show(_ id: String) {
    openWindow(id: id)
    activateApp()
  }
}
